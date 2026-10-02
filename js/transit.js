// 南京特色交通:中山码头—浦口 长江轮渡(宁浦线)
// 自 1910 年前后开航的过江轮渡(下关↔津浦铁路浦口站),至今仍是两岸通勤的活文物。
// 航线落位完全程序化:把中山码头真实经纬度投影到 world.js 画江面所用的同一条平滑中心线上,
// 过垂足做江道垂线即得航线——不硬编码任何坐标,江道数据改动时航线自动跟随。
import * as THREE from 'three';
import { toV2, toV2List, hU, vU, smoothPolyline } from './geo.js';
import { RIVER } from './data.js';
import { mat, put, UNIT } from './lib.js';

/**
 * 沿折线取点与朝向(弧长参数化采样器,移植自 GTA-WH transit.js)
 * 与 WH 原版的差别:at() 内把 t 钳制在 [0,1] 而非取模回绕——
 * 折返渡船的 t 由 update 显式钳制,若仍用回绕,t 越过 1 一个帧步长就会闪现回对岸。
 */
function makeRunner(pts, yOf) {
  const lens = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(d); total += d;
  }
  return {
    total,
    at(t) {
      let target = Math.max(0, Math.min(1, t)) * total;
      for (let i = 0; i < lens.length; i++) {
        if (target <= lens[i] || i === lens.length - 1) {
          const f = lens[i] ? Math.min(1, target / lens[i]) : 0;
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
          return {
            x: ax + (bx - ax) * f, z: az + (bz - az) * f,
            y: yOf ? yOf(ax + (bx - ax) * f, az + (bz - az) * f) : 0,
            ang: Math.atan2(bx - ax, bz - az),
          };
        }
        target -= lens[i];
      }
      return { x: pts[0][0], z: pts[0][1], y: 0, ang: 0 };
    },
  };
}

/* ==================== 长江轮渡(中山码头 ↔ 浦口,宁浦线) ==================== */
export function buildFerry() {
  const group = new THREE.Group();
  group.name = 'zhongshan-ferry';

  // —— 航线落位(程序化)——
  // 必须与 world.js buildWater 完全同一条链:RIVER.pts → toV2 → smoothPolyline(…, 8)。
  // 江面 ribbon 画在这套平滑点上,航线贴着同一几何求垂线,船才不会开出水缘。
  const centerline = smoothPolyline(toV2List(RIVER.pts), 8);
  const dock = toV2(118.7386, 32.0948);            // 中山码头(下关·江边路)

  // 逐段投影:码头在江道中心线上的垂足 foot + 该段江道方向 rdir
  let bestD = Infinity, foot = null, rdir = null;
  for (let i = 0; i < centerline.length - 1; i++) {
    const [ax, az] = centerline[i], [bx, bz] = centerline[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let f = ((dock[0] - ax) * dx + (dock[1] - az) * dz) / len2;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const px = ax + dx * f, pz = az + dz * f;
    const d = Math.hypot(dock[0] - px, dock[1] - pz);
    if (d < bestD) {
      bestD = d;
      foot = [px, pz];
      rdir = [dx / Math.sqrt(len2), dz / Math.sqrt(len2)];
    }
  }

  // 航线 = 过 foot 的江道垂线,两端各伸出 DOCK(7.8u ≈ 距平滑水缘尚余 0.2u+,
  // 给 62 m 船首留吃水余量;若江道数据改动导致端点出水的余量不足,可下调至 7.6/7.4)
  const DOCK = 7.8;
  const perp = [-rdir[1], rdir[0]];                // 江道垂线方向
  const ends = [
    [foot[0] - perp[0] * DOCK, foot[1] - perp[1] * DOCK],
    [foot[0] + perp[0] * DOCK, foot[1] + perp[1] * DOCK],
  ];
  // t=0 放在靠中山码头的一端(南岸),开航先向浦口
  const toDock = (p) => Math.hypot(p[0] - dock[0], p[1] - dock[1]);
  if (toDock(ends[1]) < toDock(ends[0])) ends.reverse();

  // —— 船体:宁浦线 ~62 m 级双向车客渡,平面 hU / 竖向 vU,盒体叠放 ——
  // 各盒基线为船体局部原点(吃水线),由 update 整体抬到 y=0.36(江面 0.35)
  const boat = new THREE.Group();
  const hullMat = mat('#33465e', { rough: 0.6 });   // 深蓝灰船体
  const cabinMat = mat('#e8eaec', { rough: 0.7 });  // 白色双层客舱
  const funnelMat = mat('#a8322a', { rough: 0.7 }); // 烟囱
  put(boat, UNIT.box, hullMat, { pos: [0, 0, 0], scale: [hU(13), vU(3.2), hU(62)] });
  put(boat, UNIT.box, cabinMat, { pos: [0, vU(3.0), 0], scale: [hU(11), vU(3.0), hU(52)] });
  put(boat, UNIT.box, cabinMat, { pos: [0, vU(5.8), 0], scale: [hU(9), vU(2.4), hU(34)] });
  put(boat, UNIT.cyl, funnelMat, { pos: [0, vU(8.0), hU(8)], scale: [hU(2.2), vU(3), hU(2.2)] });
  // 全部 castShadow = false(mesh 默认即关,不逐个开影):
  // NJ 的阴影贴图按需刷新,动体若开投影,影子会冻在旧位置
  group.add(boat);

  const runner = makeRunner(ends);
  let t = 0, dir = 1, elapsed = 0;
  function update(dt) {
    elapsed += dt;                                  // 累积时间代替挂钟(node 安全)
    t += dir * dt * 0.015;                          // 单程 1/0.015 ≈ 67 s,全程 2×7.8u = 1.56 km
    if (t >= 1) { t = 1; dir = -1; }                // 显式钳制折返,绝不取模回绕
    else if (t <= 0) { t = 0; dir = 1; }
    const p = runner.at(t);
    boat.position.set(p.x, 0.36, p.z);              // 江面 y=0.35,吃水线略抬
    boat.rotation.y = p.ang + (dir < 0 ? Math.PI : 0);
    boat.rotation.z = Math.sin(elapsed * 0.7) * 0.018;  // 轻微横摇(绕船自身纵轴)
  }
  update(0);                                        // 构建后立即摆好首帧

  console.log('[GTA-NJ] 中山码头轮渡: 宁浦线通航');
  return { group, update };
}
