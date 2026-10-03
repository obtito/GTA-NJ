// KayKit 街景道具包（City Builder Bits，CC0）：红绿灯落主干道交叉口，小品沿街 + 人流地标聚落
// 资产：assets/props/*.glb（gltf→glb 内嵌单图集 + Draco 压缩，清单与许可见 docs/ATTRIBUTION.md）
// 接线（main.js）：props = await buildStreetProps({ centerlines: roads.centerlines, exclusions: lm.exclusions })
//
// 尺度口径：场景水平 1 单位 = 100 m、竖向 1 单位 = 30 m。真实 1:100 的 2 m 长椅只有 0.02 单位，
// 全城视距下不可见 —— 全部按「车长 0.23 / 路灯杆 0.32」的视觉语言放大到可读档位，等比缩放不压 Y。
// node 安全（tools/smoke.mjs）：assets.js 必须函数内动态 import（其顶层含 three/addons bare specifier），
// 失败即整体回退为空 group，不抛。
import * as THREE from 'three';
import { toV2List, makeRandom, hU, vU, distToPolyline } from './geo.js';
import { RIVER } from './data.js';
import { registerEnv } from './lib.js';
import { phaseFor } from './signals.js';

// 水域避让口径与 buildStreetLights 一致：主江道 + 夹江支流
const RIVER_PTS = toV2List(RIVER.pts);
const RIVER_BRANCHES = (RIVER.branches || []).map((b) => ({ hw: b.halfWidth, pts: toV2List(b.pts) }));

/* ============ 道具类型表（KayKit 单图集 8 件，全部以 y=0 为底、单 mesh 单材质） ============
 * along/size：归一化基准轴与目标尺寸（场景单位）——量 Box3 定 scale，底面贴路面 y=0.06。
 * place：junction＝只落交叉口（红绿灯）；street＝沿街 + 地标聚落随机挑。
 * weight：小品抽签权重（长椅/垃圾桶/绿植常见，货箱/垃圾箱少些）。 */
const PROP_TYPES = [
  { id: 'trafficlight', file: 'trafficlight_A.glb', along: 'y', size: vU(4.2), place: 'junction' },   // 红绿灯目标高 4.2 m ≈ 0.14 单位
  { id: 'bench',    file: 'bench.glb',       along: 'x', size: 0.10,  place: 'street', weight: 3 },  // 长椅：座面向路
  { id: 'dumpster', file: 'dumpster.glb',    along: 'x', size: 0.14,  place: 'street', weight: 2 },  // 大垃圾箱
  { id: 'hydrant',  file: 'firehydrant.glb', along: 'y', size: 0.05,  place: 'street', weight: 2 },  // 消防栓
  { id: 'trashA',   file: 'trash_A.glb',     along: 'x', size: 0.055, place: 'street', weight: 3 },  // 垃圾桶（矮圆桶）
  { id: 'trashB',   file: 'trash_B.glb',     along: 'x', size: 0.045, place: 'street', weight: 2 },  // 垃圾桶（小方桶）
  { id: 'bush',     file: 'bush.glb',        along: 'y', size: 0.11,  place: 'street', weight: 3 },  // 绿植：远矮于行道树，只当灌木读
  { id: 'box',      file: 'box_A.glb',       along: 'x', size: 0.09,  place: 'street', weight: 2 },  // 纸箱货堆：街角摊位杂物
];
const STREET_TYPES = PROP_TYPES.filter((p) => p.place === 'street');
const TYPE_TOTAL_W = STREET_TYPES.reduce((s, p) => s + p.weight, 0);

// 人流地标（老门东 / 夫子庙 / 新街口）：半径 1.5 单位内每处聚 8-12 件
const CROWD_SPOTS = [[25.8, 46.1], [26.3, 38.4], [22.6, 12.7]];

const MAJOR_W = 0.4;      // 主干道门槛：红绿灯求交 / 沿街小品布设同口径
const JUNCTION_CAP = 40;  // 交点上限：网格路两两求交后取前 40 个，防爆量
const JUNCTION_DEDUP = 0.5;

/** 线段求交（返回交点 [x,z] 或 null；平行 / 线段外不相交都返回 null） */
function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1x = bx - ax, r1z = bz - az, r2x = dx - cx, r2z = dz - cz;
  const den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * r2z - (cz - az) * r2x) / den;
  const u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [ax + r1x * t, az + r1z * t];
}

/* ============ 街景道具：红绿灯 + 小品（KayKit CC0，一类型一个 InstancedMesh） ============ */
export async function buildStreetProps({ centerlines = [], exclusions = [], seed = 4242 } = {}) {
  const rand = makeRandom(seed);
  const group = new THREE.Group();
  group.name = 'streetprops';
  const mats = [];

  const majors = centerlines.filter((l) => !l.gate && l.w >= MAJOR_W);   // 城门引桥段不布道具
  const onWater = (x, z) => {
    if (distToPolyline(x, z, RIVER_PTS) < RIVER.halfWidth + 0.5) return true;
    for (const b of RIVER_BRANCHES) if (distToPolyline(x, z, b.pts) < b.hw + 0.3) return true;
    return false;
  };
  const inExclusion = (x, z) => {
    for (const e of exclusions) {
      const dx = x - e[0], dz = z - e[1];
      if (dx * dx + dz * dz < e[2] * e[2]) return true;
    }
    return false;
  };
  // 不能落在另一条主干道的沥青上（沿街偏移只保证出了本路，路口处会踩到横向路）
  const onOtherAsphalt = (x, z, self) => {
    for (const l of majors) {
      if (l === self) continue;
      if (distToPolyline(x, z, l.pts) < l.w / 2 + 0.03) return true;
    }
    return false;
  };
  const pickStreetType = () => {
    let r = rand() * TYPE_TOTAL_W;
    for (const p of STREET_TYPES) { r -= p.weight; if (r <= 0) return p; }
    return STREET_TYPES[0];
  };

  /* ---- 1) 红绿灯：主干道中心线两两求交，去重后每交点 1-2 盏落路角 ---- */
  const junctions = [];
  outer:
  for (let i = 0; i < majors.length; i++) {
    for (let j = i + 1; j < majors.length; j++) {
      const A = majors[i], B = majors[j];
      for (let a = 1; a < A.pts.length; a++) {
        const [ax, az] = A.pts[a - 1], [bx, bz] = A.pts[a];
        const dA = Math.hypot(bx - ax, bz - az); if (!dA) continue;
        for (let b = 1; b < B.pts.length; b++) {
          const [cx, cz] = B.pts[b - 1], [dx, dz] = B.pts[b];
          const p = segIntersect(ax, az, bx, bz, cx, cz, dx, dz);
          if (!p) continue;
          // 去重（平滑折线常在同一路口反复相交）；上限防爆量
          if (junctions.some((q) => Math.hypot(q.x - p[0], q.z - p[1]) < JUNCTION_DEDUP)) continue;
          if (inExclusion(p[0], p[1]) || onWater(p[0], p[1])) continue;
          junctions.push({
            x: p[0], z: p[1],
            dAx: (bx - ax) / dA, dAz: (bz - az) / dA,        // A 路切向（朝向沿路用）
            dBx: (dx - cx) / Math.hypot(dx - cx, dz - cz),   // B 路切向
            dBz: (dz - cz) / Math.hypot(dx - cx, dz - cz),
            wA: A.w, wB: B.w,
          });
          if (junctions.length >= JUNCTION_CAP) break outer;
        }
      }
    }
  }

  const spots = PROP_TYPES.map(() => []);   // 每类型一批 { x, z, rot, s }；下标 0 固定是 junction 类红绿灯
  const placed = [];   // 全体落点（含红绿灯与地标聚落），用于最小间距防叠件
  const tooClose = (x, z, d) => placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < d);
  for (const q of junctions) {
    // 路角：出 A 路红线半宽 + 出 B 路红线半宽（对角双角各一盏，或只放一盏）
    const nAx = -q.dAz, nAz = q.dAx;                       // A 路法向
    const nBx = -q.dBz, nBz = q.dBx;                       // B 路法向
    const k1 = rand() < 0.5 ? 1 : -1;
    const count = rand() < 0.75 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const sgn = k === 0 ? k1 : -k1;
      const x = q.x + (nAx * (q.wA / 2 + 0.05) + nBx * (q.wB / 2 + 0.05)) * sgn;
      const z = q.z + (nAz * (q.wA / 2 + 0.05) + nBz * (q.wB / 2 + 0.05)) * sgn;
      if (inExclusion(x, z) || onWater(x, z)) continue;
      placed.push([x, z]);
      // 双灯分工：k=0 面 A 路来车（A 轴相位），k=1 转 B 路切向显 B 轴 —— 灯珠变色据此
      const axis = k === 0 ? 'a' : 'b';
      const rot = axis === 'a' ? Math.atan2(q.dAx, q.dAz) : Math.atan2(q.dBx, q.dBz);
      spots[0].push({ x, z, rot, s: 0.92 + rand() * 0.16, axis, j: q });
    }
  }

  /* ---- 2) 沿街小品：主干道每 150-250 m 错落一件，路侧偏移避开 0.165~0.275 车流带 ---- */
  for (const l of majors) {
    const pts = l.pts;
    // 路侧偏移必须 ≥ 0.33（w=0.4 时正好 0.33）：再往里就是车流车道带，同侧车会持续穿道具
    const baseOff = Math.max(l.w / 2 + 0.13, 0.33);
    let acc = 0;                                           // 距上一件的弧长（跨段结转）
    let gap = hU(150) + rand() * hU(100);                  // 150-250 m 一件
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const d = Math.hypot(bx - ax, bz - az); if (!d) continue;
      const dx = (bx - ax) / d, dz = (bz - az) / d;
      const ang = Math.atan2(dx, dz);
      let t = 0;
      while (t < d) {
        const remain = d - t;
        if (acc + remain < gap) { acc += remain; break; }  // 本段走完还凑不满一个间距，结转到下一段
        t += gap - acc;                                    // 走到下一个放件点（恰在段尾也放，顶点仍在中心线上）
        acc = 0;
        gap = hU(150) + rand() * hU(100);
        const side = rand() < 0.5 ? 1 : -1;                // 双侧错落
        const off = (baseOff + rand() * 0.05) * side;
        const x = ax + (bx - ax) * (t / d) - dz * off;
        const z = az + (bz - az) * (t / d) + dx * off;
        if (inExclusion(x, z) || onWater(x, z) || onOtherAsphalt(x, z, l)) continue;
        if (tooClose(x, z, 0.1)) continue;
        placed.push([x, z]);
        const p = pickStreetType();
        spots[PROP_TYPES.indexOf(p)].push({ x, z, rot: ang + (rand() - 0.5) * 0.7, s: 0.9 + rand() * 0.2 });
      }
    }
  }

  /* ---- 3) 人流地标聚落：老门东 / 夫子庙 / 新街口 半径 1.5 内每处 8-12 件 ---- */
  for (const [sx, sz] of CROWD_SPOTS) {
    const n = 8 + Math.floor(rand() * 5);
    let ok = 0;
    for (let tries = 0; tries < 40 && ok < n; tries++) {
      const r = Math.sqrt(rand()) * 1.5, a = rand() * Math.PI * 2;
      const x = sx + Math.sin(a) * r, z = sz + Math.cos(a) * r;
      if (inExclusion(x, z) || onWater(x, z) || onOtherAsphalt(x, z, null)) continue;
      if (tooClose(x, z, 0.12)) continue;
      placed.push([x, z]);
      const p = pickStreetType();
      spots[PROP_TYPES.indexOf(p)].push({ x, z, rot: rand() * Math.PI * 2, s: 0.9 + rand() * 0.2 });
      ok++;
    }
  }

  /* ---- 4) 装载 GLB → 归一化 → 一类型一个 InstancedMesh ---- */
  // GLB 装载必须函数内动态 import + try/catch：node 下 three/addons 解析失败要回退空,不炸 smoke
  let loadMergedGLB = null;
  try { ({ loadMergedGLB } = await import('./assets.js')); } catch { /* node / 缺资源：空道具组 */ }
  const dummy = new THREE.Object3D();
  let count = 0;
  for (let ti = 0; ti < PROP_TYPES.length; ti++) {
    const p = PROP_TYPES[ti];
    if (!spots[ti].length) continue;
    let m = null;
    try { m = loadMergedGLB ? await loadMergedGLB('./assets/props/' + p.file) : null; } catch { m = null; }
    if (!m || !m.geometry || !m.material) continue;
    // 归一化：按目标尺寸定 scale；原点搬到道具底面中心（绕自身旋转不偏心），实例底面贴路面 0.06
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    const dim = bb.max[p.along] - bb.min[p.along];
    if (!(dim > 0)) continue;
    const s = p.size / dim;
    m.geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    registerEnv(m.material, 0.5);   // 静物吃一点天空补光即可，多了发灰
    const im = new THREE.InstancedMesh(m.geometry, m.material, spots[ti].length);
    im.frustumCulled = false;
    im.castShadow = true;           // 静物可投影（阴影按需刷新，动体才禁投影）
    im.receiveShadow = true;
    spots[ti].forEach((sp, i) => {
      dummy.position.set(sp.x, 0.06, sp.z);
      dummy.rotation.set(0, sp.rot, 0);
      dummy.scale.setScalar(s * sp.s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
    mats.push(m.material);
    count += spots[ti].length;
  }

  /* ---- 5) 红绿灯灯珠（v2 车流智能配套）：三色各一 InstancedMesh，MeshBasic + 逐实例色 ----
   * 合并 GLB 是单图集单材质，没法逐实例变灯色 —— 灯珠独立成三份小实例悬浮在灯头位置，
   * toneMapped:false 读作自发光。相位真值在 signals.js，与 city.js 车流停车共用。 */
  let bulbMeshes = null, bulbStates = null, signalClock = 0;
  const lightSpots = spots[0];
  const BULB_NAMES = ['red', 'yellow', 'green'];
  const ON_COLOR = { red: new THREE.Color(0xff2d1a), yellow: new THREE.Color(0xffb300), green: new THREE.Color(0x1fe36a) };
  const OFF_COLOR = new THREE.Color(0x16130f);
  if (lightSpots.length) {
    const bg = new THREE.SphereGeometry(0.0042, 8, 6);
    bulbMeshes = {};
    for (const name of BULB_NAMES) {
      const im = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lightSpots.length);
      im.frustumCulled = false;
      im.castShadow = im.receiveShadow = false;   // 灯珠不进阴影链
      group.add(im);
      bulbMeshes[name] = im;
    }
    const d = new THREE.Object3D();
    lightSpots.forEach((sp, i) => {
      const hgt = vU(4.2) * sp.s;                 // 与道具同款目标高（含实例随机比例）
      const cy = hgt * 0.84;                      // 灯头取杆顶段
      const fx = Math.sin(sp.rot), fz = Math.cos(sp.rot);
      const fwd = hgt * 0.11;                     // 灯面沿朝向外抛一点，别埋进杆里
      for (let k = 0; k < 3; k++) {               // 红上绿下，间隔 0.055h
        d.position.set(sp.x + fx * fwd, cy + (1 - k) * hgt * 0.055, sp.z + fz * fwd);
        d.updateMatrix();
        bulbMeshes[BULB_NAMES[k]].setMatrixAt(i, d.matrix);
      }
    });
    bulbStates = lightSpots.map(() => '');
    applyBulbs();   // 构造即着色，避免任何一帧以白色（材质本色）灯珠渲染
  }
  function applyBulbs() {
    if (!bulbMeshes) return;
    let dirty = false;
    lightSpots.forEach((sp, i) => {
      const st = phaseFor(sp.j, signalClock)[sp.axis];
      if (st === bulbStates[i]) return;           // 相位没翻不写色
      bulbStates[i] = st;
      for (const name of BULB_NAMES) {
        bulbMeshes[name].setColorAt(i, name === st ? ON_COLOR[name] : OFF_COLOR);
      }
      dirty = true;
    });
    if (dirty) for (const name of BULB_NAMES) bulbMeshes[name].instanceColor.needsUpdate = true;
  }

  return {
    group, count, mats,
    junctions,          // 完整交点表（含切向/路宽）：main.js 转喂 cars.setSignals 做停车线
    update(dt) { signalClock += dt; applyBulbs(); },
    /** 诊断：各灯位当前亮色（traffic-check 断言隔半周期翻色用） */
    bulbDebug() {
      return {
        clock: Math.round(signalClock * 10) / 10,
        bulbs: lightSpots.map((sp, i) => ({ axis: sp.axis, state: bulbStates[i] })),
      };
    },
    setNight() {},      // 灯珠 toneMapped:false 恒亮，日夜无需调
  };
}
