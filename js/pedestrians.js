// 行人系统 Phase 1：轨道式行人（与车流同思路，零依赖、node 安全）
// 接线（main.js）：peds = buildPedestrians({ centerlines: roads.centerlines, exclusions: lm.exclusions })
//
// 尺度口径：水平 1 单位 = 100 m、竖向 1 单位 = 30 m。真实 1.7 m 行人合 vU(1.7)=0.057 单位高，
// 全城视距下真实半径 0.0025 细不可见 —— 半径加粗一倍取 0.005（口径同路灯杆的可见性补偿）。
// 速度：真实 1.3 m/s 折到水平单位仅 0.013/s，街景几乎不动；取 0.035/s（≈2.7× 真实，可感知又不卡通）。
// 两种轨道：
//   line  —— 主干道人行道带（路侧偏移 w/2+0.05~0.10，在路灯 0.33 的内侧），端点折返；
//            偏移在布点时烘成「恒定路侧距离」折线（外角圆弧、内角裁交），采样照抄
//            buildCars 的累积弧长手法 —— 弯道处到中线距离恒定、帧间无跳变（车流靠平滑
//            中心线掩盖转角法向翻转，行人慢速近观藏不住，必须烘焙）。
//   orbit —— 老门东/夫子庙/新街口三处 POI 环绕（半径 0.15-0.6 圆周），循环。
// recast 避让是后续升级项，本版与车流一样只做轨道推进 + 走路颠簸。
import * as THREE from 'three';
import { toV2List, makeRandom, distToPolyline } from './geo.js';
import { RIVER } from './data.js';
import { registerEnv } from './lib.js';

// 水域避让口径与 buildStreetLights / buildStreetProps 一致：主江道 + 夹江支流
const RIVER_PTS = toV2List(RIVER.pts);
const RIVER_BRANCHES = (RIVER.branches || []).map((b) => ({ hw: b.halfWidth, pts: toV2List(b.pts) }));

// 人流 POI（与 buildStreetProps 的 CROWD_SPOTS 同源）：老门东 / 夫子庙 / 新街口
const POIS = [[25.8, 46.1], [26.3, 38.4], [22.6, 12.7]];

const TOTAL = 320;          // 总人数
const POI_SHARE = 0.4;      // 其中 40% 聚在 POI 半径 1.2 内（环绕轨道）
const MAJOR_W = 0.4;        // 主干道门槛：行人与路灯/红绿灯同口径（城门引桥段 l.gate 跳过）

// 外套调色板：秋冬暗色系为主 + 少量亮色（远处人群读成色点，亮色负责点睛）
const PALETTE = [
  '#3a3f4a', '#565d6b', '#8794a3', '#7d5a3c', '#a63d40',
  '#33658a', '#4a7c59', '#c29b4a', '#e8556d', '#f2c14e',
];

/* ---- 折线 → 累积弧长轨道（手法照抄 buildCars：逐段长度 + 弧长定位） ---- */
function buildTrack(pts) {
  const lens = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(d); total += d;
  }
  return { pts, lens, total };
}

/** 沿轨道按弧长比例取点，返回 [x, z, 切向角]（切向角与 buildCars 同式 atan2(dx, dz)） */
function sampleTrack(m, t) {
  let target = Math.max(0, Math.min(1, t)) * m.total;
  for (let i = 0; i < m.lens.length; i++) {
    if (target <= m.lens[i] || i === m.lens.length - 1) {
      const f = m.lens[i] ? Math.min(1, target / m.lens[i]) : 0;
      const ax = m.pts[i][0], az = m.pts[i][1], bx = m.pts[i + 1][0], bz = m.pts[i + 1][1];
      const dx = bx - ax, dz = bz - az;
      return [ax + dx * f, az + dz * f, Math.atan2(dx, dz)];
    }
    target -= m.lens[i];
  }
  return [m.pts[0][0], m.pts[0][1], 0];
}

/** 折线按路侧距离 off（带符号，>0 为行进方向左侧）烘焙偏移轨道：
 *  直段平移 off；转角在「远离中线」一侧走半径 |off| 的圆弧、在「切入中线」一侧
 *  裁到两条偏移线的交点 —— 全程到中线距离恒为 |off|，且路径连续（无转角跳变）。
 *  这是 CAD 折线偏移的标准 round/miter join，人行道带正好就是路的 buffer 轮廓线。 */
function offsetPolyline(pts, off) {
  const n = pts.length;
  if (n < 2) return pts.slice();
  const dir = [], nrm = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dz) || 1;
    dir.push([dx / l, dz / l]);
    nrm.push([-dz / l, dx / l]);
  }
  const at = (i, k) => [pts[k][0] + nrm[i][0] * off, pts[k][1] + nrm[i][1] * off];
  const out = [at(0, 0)];
  for (let i = 0; i < n - 2; i++) {
    const cross = dir[i][0] * dir[i + 1][1] - dir[i][1] * dir[i + 1][0];
    if (Math.abs(cross) < 1e-9) { out.push(at(i, i + 1)); continue; }   // 共线直行
    const turn = Math.atan2(cross, dir[i][0] * dir[i + 1][0] + dir[i][1] * dir[i + 1][1]);
    const inner = (cross > 0) === (off > 0);   // 转向侧与行人同侧 = 内角
    if (inner) {
      // 内角：两段偏移线相交于 Q，路径 …A_i → Q → B_{i+1}…（抄近道切内角）
      const ax = pts[i][0] + nrm[i][0] * off, az = pts[i][1] + nrm[i][1] * off;
      const bx = pts[i + 1][0] + nrm[i + 1][0] * off, bz = pts[i + 1][1] + nrm[i + 1][1] * off;
      const t = ((bx - ax) * dir[i + 1][1] - (bz - az) * dir[i + 1][0]) / cross;
      out.push([ax + dir[i][0] * t, az + dir[i][1] * t]);
    } else {
      // 外角：先到本段偏移终点，再绕顶点半径 |off| 圆弧过渡到下一段偏移起点
      out.push(at(i, i + 1));
      const v = pts[i + 1], r = Math.abs(off);
      const a0 = Math.atan2(nrm[i][1] * off, nrm[i][0] * off);
      const steps = Math.max(1, Math.ceil(Math.abs(turn) / 0.35));
      for (let k = 1; k <= steps; k++) {
        const a = a0 + turn * k / steps;
        out.push([v[0] + Math.cos(a) * r, v[1] + Math.sin(a) * r]);
      }
    }
  }
  out.push(at(n - 2, n - 1));
  return out;
}

export function buildPedestrians({ centerlines = [], exclusions = [], seed = 8899 } = {}) {
  const rand = makeRandom(seed);
  const group = new THREE.Group();
  group.name = 'pedestrians';

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

  const lines = centerlines.filter((l) => !l.gate && l.w >= MAJOR_W);

  /* ---- 布点：起点必须过排除圆与水域（口径同路灯：跨江段不生成） ---- */
  const peds = [];   // { line:true|false, track/r/cx/cz, t, dir, speed, side, bobPhase, colorIdx }
  const ok = (x, z) => !inExclusion(x, z) && !onWater(x, z);

  // 60% 均匀分配到各主干线双侧（轮转保证每条线人数一致，侧向随机近似对半）
  const lineN = TOTAL - Math.round(TOTAL * POI_SHARE);
  for (let i = 0; lines.length && i < lineN; i++) {
    const li = i % lines.length;
    const l = lines[li];
    // 人行道带：路侧偏移 w/2+0.05~0.10 —— 比路灯（0.33）更靠路，人行道在灯杆内侧
    const side = rand() < 0.5 ? 1 : -1;
    const off = (l.w / 2 + 0.05 + rand() * 0.05) * side;
    const track = buildTrack(offsetPolyline(l.pts, off));   // 偏移烘焙进轨道
    for (let k = 0; k < 8; k++) {                           // 起点抽签，最多 8 次避开排除圆/水域
      const t = rand();
      const [x, z] = sampleTrack(track, t);
      if (!ok(x, z)) continue;
      peds.push({
        line: true, track, t, dir: rand() < 0.5 ? 1 : -1,
        speed: 0.028 + rand() * 0.014, side, off,
        bobPhase: rand() * Math.PI * 2, colorIdx: (rand() * PALETTE.length) | 0,
      });
      break;
    }
  }

  // 40% 环绕 POI：以 POI 为心、半径 0.15-0.6 的圆周行走（角速度 = speed/r，循环不折返）。
  // 注意只查水域、不查 exclusions：三处 POI 心本身都落在地标保护圆内（老门东/夫子庙 r=5.2、
  // 新街口 r=1.95）—— 排除圆是给楼群/树这类静态物留的净空，行人本就该逛地标街区，
  // 逐圆排除会把 40% 的 POI 人流整个清零（与分布规格自相矛盾）。
  const poiN = TOTAL - lineN;
  const perPoi = Math.floor(poiN / POIS.length);
  for (let p = 0; p < POIS.length; p++) {
    const n = perPoi + (p < poiN - perPoi * POIS.length ? 1 : 0);   // 余数摊到前几个
    const [cx, cz] = POIS[p];
    for (let i = 0; i < n; i++) {
      const side = rand() < 0.5 ? 1 : -1;
      for (let k = 0; k < 8; k++) {
        const r = 0.15 + rand() * 0.45;
        const t = rand();
        if (onWater(cx + Math.cos(t * Math.PI * 2) * r, cz + Math.sin(t * Math.PI * 2) * r)) continue;
        peds.push({
          line: false, r, cx, cz, t, dir: rand() < 0.5 ? 1 : -1,
          speed: 0.028 + rand() * 0.014, side,
          bobPhase: rand() * Math.PI * 2, colorIdx: (rand() * PALETTE.length) | 0,
        });
        break;
      }
    }
  }

  const count = peds.length;
  if (!count) return { group, count, update: () => {} };

  /* ---- 渲染：胶囊近似一个 InstancedMesh（r160 有 CapsuleGeometry，核实存在则直接用；
   *    总高 0.045+2*0.005=0.055 ≈ vU(1.7)=0.057 的真实身高；底对齐便于落位地面） ---- */
  const H = 0.055;
  const geo = THREE.CapsuleGeometry
    ? new THREE.CapsuleGeometry(0.005, 0.045, 3, 8)
    : new THREE.CylinderGeometry(0.005, 0.005, H, 6);   // 兜底：同总高的圆柱体
  geo.translate(0, H / 2, 0);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  registerEnv(mat, 0.4);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;      // NJ 阴影按需刷新，动体投影会冻住（车流/路灯同例）
  group.add(mesh);

  const col = new THREE.Color();
  for (let i = 0; i < count; i++) mesh.setColorAt(i, col.set(PALETTE[peds[i].colorIdx]));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  /* ---- 逐帧推进：t 折返/循环、走路颠簸、朝向沿运动方向、写实例矩阵 ---- */
  const dummy = new THREE.Object3D();
  function update(dt) {
    for (let i = 0; i < count; i++) {
      const p = peds[i];
      p.bobPhase += p.speed * dt * 260;                 // 步频与步速挂钩（快走颠得快）
      const y = 0.06 + Math.abs(Math.sin(p.bobPhase)) * 0.004;
      let x, z, ang;
      if (p.line) {
        const m = p.track;
        p.t += (p.dir * p.speed * dt) / m.total;
        if (p.t > 1) { p.t = 2 - p.t; p.dir = -1; }     // 线轨道：端点折返
        else if (p.t < 0) { p.t = -p.t; p.dir = 1; }
        [x, z, ang] = sampleTrack(m, p.t);
        if (p.dir < 0) ang += Math.PI;                  // 折返后半段沿反方向走
      } else {
        // 圆轨道：θ 匀速推进（角速度 = speed/r），循环取模
        p.t = (((p.t + (p.dir * p.speed * dt) / (p.r * Math.PI * 2)) % 1) + 1) % 1;
        const th = p.t * Math.PI * 2;
        const rr = p.r + p.side * 0.004;                // 同半径双人也错开一点，减少重叠
        x = p.cx + Math.cos(th) * rr;
        z = p.cz + Math.sin(th) * rr;
        ang = Math.atan2(-Math.sin(th) * p.dir, Math.cos(th) * p.dir);
      }
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ang, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(0);   // 构造即写好全部矩阵缓冲，避免首帧残留单位矩阵
  return { group, count, update };
}
