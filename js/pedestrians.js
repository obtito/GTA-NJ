// 行人系统 Phase 2：轨道式行人 + 红绿灯门控过街 + 视觉推挤（零依赖、node 安全）
// 接线（main.js）：peds = buildPedestrians({ centerlines, exclusions })
//                 peds.setSignals(props.junctions)   ← props 构建后注入（不注入则退回 Phase 1 行为）
//
// 尺度口径：水平 1 单位 = 100 m、竖向 1 单位 = 30 m。真实 1.7 m 行人合 vU(1.7)=0.057 单位高，
// 全城视距下真实半径 0.0025 细不可见 —— 半径加粗一倍取 0.005（口径同路灯杆的可见性补偿）。
// 速度：真实 1.3 m/s 折到水平单位仅 0.013/s，街景几乎不动；取 0.035/s（≈2.7× 真实，可感知又不卡通）。
// 两种轨道：
//   line  —— 主干道人行道带（路侧偏移 w/2+0.09~0.12：路灯 0.33 内侧、清出 0.165-0.275 的
//            车流车道带 —— 等灯行人不会站进停止车队车体里），端点折返；
//            偏移在布点时烘成「恒定路侧距离」折线（外角圆弧、内角裁交），采样照抄
//            buildCars 的累积弧长手法 —— 弯道处到中线距离恒定、帧间无跳变（车流靠平滑
//            中心线掩盖转角法向翻转，行人慢速近观藏不住，必须烘焙）。
//   orbit —— 老门东/夫子庙/新街口三处 POI 环绕（半径 0.15-0.6 圆周），循环，无门控。
//
// Phase 2 门控（设计经三视角评审合并：轨道门控派 × recast 实测否决派 × 失败模式怀疑派）：
//   - 门 = 横路中心线与轨道交点 ±half（half=(wCross/2+0.09)/sinθ 物理跨距不截断——截断会让
//     出带点仍在车道带内提前收尾；宽斜门靠按需提速 vNeed≤0.14 在红窗内穿完）。带触及轨道
//     两端 0.06 内整门作废（折返点永不带闸）；WALK 中落在带内一律退回路缘等待（防御分支）。
//   - 带重叠的门合并为联合走廊：过街要等所有被穿轴同时受保护（独立相位可共红）；同路口
//     a/b 轴互补永不共红，不合并、按序各自过。
//   - 三态机 WALK/WAIT/CROSS；前方距离无环判定（折返轨道禁 mod —— 车流的环形公式在这里
//     会给出假前方，人在无门处凭空停步）。
//   - 放行判据 axisRemain（signals.js 单一真源，含黄灯 2s 预告窗）≥ 跨距/过街速度 + 1.2s。
//     过街速度 max(1.6×步速, 0.055)：慢人不提速穿 0.52u 要 18.6s > B 红 13s，必提速才无死锁
//     （vNeed=span/10.5 钳 0.14 ⇒ need≤11.7s < 13s，任何门/速度档结构性无饥饿）。
//   - 推挤只进渲染偏移（vx,vz 以 4/s 指数回零、模长钳 0.01），s/θ 权威不动 —— WAIT 被推
//     出触发区、orbit 被推力螺旋吸入中心这类活锁在结构上不可能发生。
//   - recast-navigation-js 已实测否决（评审证据）：320 agent crowd.update 1.2ms vs 现轨道
//     循环 0.037ms（33× 超 240fps 红线），且本项目地形解析式、无行走面 mesh 可喂。
import * as THREE from 'three';
import { toV2List, makeRandom, distToPolyline } from './geo.js';
import { RIVER } from './data.js';
import { registerEnv } from './lib.js';
import { phaseFor, axisRemain } from './signals.js';

// 水域避让口径与 buildStreetLights / buildStreetProps 一致：主江道 + 夹江支流
const RIVER_PTS = toV2List(RIVER.pts);
const RIVER_BRANCHES = (RIVER.branches || []).map((b) => ({ hw: b.halfWidth, pts: toV2List(b.pts) }));

// 人流 POI（与 buildStreetProps 的 CROWD_SPOTS 同源）：老门东 / 夫子庙 / 新街口
const POIS = [[25.8, 46.1], [26.3, 38.4], [22.6, 12.7]];

const TOTAL = 320;          // 总人数
const POI_SHARE = 0.4;      // 其中 40% 聚在 POI 半径 1.2 内（环绕轨道）
const MAJOR_W = 0.4;        // 主干道门槛：行人与路灯/红绿灯同口径（城门引桥段 l.gate 跳过）

// Phase 2 门控常量（评审裁定值；SAFETY 与带外移是硬下限，压低会复现人车互穿）
const CROSS_BOOST = 1.6;    // 过街提速倍数（现实 1.2-1.5× 的夸张版，保 13s 红窗内穿完）
const CROSS_VMIN = 0.055;   // 过街速度下限：慢人 0.028×1.6=0.045 不够，抬到 0.055
const CROSS_SAFETY = 1.2;   // 放行安全余量（秒）：清尾车 + 变灯缓冲
const GATE_MARGIN = 0.06;   // 门带必须离轨道两端多远（折返点不带闸）
const GATE_CURB = 0.09;     // 半跨路缘余量：出带点 = wCross/2+0.09 > 车道带外缘 0.275（w=0.4 时）
const SIN_MIN = 0.5;        // 轨道与横路最小交角正弦（近平行不成门）
const HALF_CAP = 0.65;      // 半跨理智上限（仅防平滑曲线伪超长门；物理跨距本身不再截断）
const VNEED_WINDOW = 10.5;  // 宽门按需提速的目标穿完秒数（红窗 13 − SAFETY 1.2 − 余 1.3）
const VNEED_CAP = 0.14;     // 按需提速上限（再快就不是走路是小跑卡通了）
const PUSH_R = 0.016;       // 推挤半径（视觉档：两胶囊 0.005 半径 + 人距）
const PUSH_CELL = 0.02;     // 空间哈希格宽（≥PUSH_R 保证 3×3 邻域够用）

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
    // 人行道带：路侧偏移 w/2+0.09~0.12 —— 路灯（0.33）内侧，且外缘 ≥0.29 清出
    // 0.165-0.275 的车流车道带：等灯行人才不会站进停止车队车体里（评审硬前提）
    const side = rand() < 0.5 ? 1 : -1;
    const off = (l.w / 2 + 0.09 + rand() * 0.03) * side;
    const track = buildTrack(offsetPolyline(l.pts, off));   // 偏移烘焙进轨道
    const speed = 0.028 + rand() * 0.014;
    for (let k = 0; k < 8; k++) {                           // 起点抽签，最多 8 次避开排除圆/水域
      const s = rand() * track.total;
      const [x, z] = sampleTrack(track, s / track.total);
      if (!ok(x, z)) continue;
      peds.push({
        line: true, track, s, dir: rand() < 0.5 ? 1 : -1,
        speed, vCross: Math.max(speed * CROSS_BOOST, CROSS_VMIN),
        state: 'walk', gate: null, gates: [], hold: 0.006 + rand() * 0.03,
        side, off, bobPhase: rand() * Math.PI * 2, colorIdx: (rand() * PALETTE.length) | 0,
      });
      break;
    }
  }

  // 40% 环绕 POI：以 POI 为心、半径 0.15-0.6 的圆周行走（角速度 = speed/r，循环不折返）。
  // 注意只查水域、不查 exclusions：三处 POI 心本身都落在地标保护圆内（老门东/夫子庙 r=5.2、
  // 新街口 r=1.95）—— 排除圆是给楼群/树这类静态物留的净空，行人本就该逛地标街区，
  // 逐圆排除会把 40% 的 POI 人流整个清零（与分布规格自相矛盾）。
  // 整圆避开车行沥青（评审实测：新街口旁主干距 POI 心仅 0.315，不查的话 orbit 人每圈
  // 两次横穿活车流且无任何红绿灯保护）：24 角采样全过才收圈，口径照抄 props 的
  // w/2+0.05。新街口沥青带 0.09-0.54 全程盖住常规半径档，逐级收半径找最小干净圈兜底。
  const carLines = centerlines.filter((l) => l.w > 0.35);
  const circleOk = (cx, cz, r) => {
    for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      const x = cx + Math.cos(th) * r, z = cz + Math.sin(th) * r;
      if (onWater(x, z)) return false;
      for (const l of carLines) if (distToPolyline(x, z, l.pts) < l.w / 2 + 0.05) return false;
    }
    return true;
  };
  const pushOrbit = (r, cx, cz) => peds.push({
    line: false, r, cx, cz, t: rand(), dir: rand() < 0.5 ? 1 : -1,
    speed: 0.028 + rand() * 0.014, side: rand() < 0.5 ? 1 : -1,
    bobPhase: rand() * Math.PI * 2, colorIdx: (rand() * PALETTE.length) | 0,
  });
  const poiN = TOTAL - lineN;
  const perPoi = Math.floor(poiN / POIS.length);
  for (let p = 0; p < POIS.length; p++) {
    const n = perPoi + (p < poiN - perPoi * POIS.length ? 1 : 0);   // 余数摊到前几个
    const [cx, cz] = POIS[p];
    for (let i = 0; i < n; i++) {
      let placed = false;
      for (let k = 0; k < 8 && !placed; k++) {
        const r = 0.15 + rand() * 0.45;
        if (!circleOk(cx, cz, r)) continue;
        pushOrbit(r, cx, cz);
        placed = true;
      }
      if (!placed) {
        for (const r of [0.12, 0.09, 0.07, 0.05, 0.035]) {          // 最小干净圈：广场上聚成小人群
          if (circleOk(cx, cz, r)) { pushOrbit(r, cx, cz); placed = true; break; }
        }
      }
      // 逐级兜底全失败（POI 心在沥青正中）才放弃此人——现网三 POI 均不会走到这
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

  /* ---- 信号门注入（main.js 在 props 构建后调用；不调用则 gates 全空 = Phase 1 行为） ----
   * 门 = 横路中心线与该行人轨道的交点：沿路口两轴各作一条 ±0.5 的中心线段，与轨道逐段
   * segIntersect（段长即域界——不做沿线距离判域，斜交时 dj=off/sinT 会被 1/sinT 放大误杀，
   * 主干斜口整段裸穿）。交角正弦 < SIN_MIN（近平行）跳过。半跨取物理值 (wCross/2+GATE_CURB)/sinT
   * 不截断（截断会让出带点仍在车道带内、cross 提前收尾）；宽门靠按需提速 vNeed 在红窗内穿完。
   * 等的轴 = 被穿中心线所属轴（沿 A 走的人穿 B 街，等 B 红）。带重叠的门合并为联合走廊：
   * 过街要等所有被穿轴同时受保护——独立相位的两条街可以共红；同路口的 a/b 轴互补永不共红，
   * 这种（轨道斜穿同一口的两条路）不合并、按序各自过。门带触及轨道两端 GATE_MARGIN 内整门
   * 作废——折返点翻转 dir 会把穿越搅成无限往返。 */
  let gatesTotal = 0;
  function setSignals(junctions = []) {
    gatesTotal = 0;
    for (const p of peds) {
      if (!p.line) continue;
      const m = p.track;
      const gs = [];
      for (const j of junctions) {
        for (const ax of ['a', 'b']) {
          const rdx = ax === 'a' ? j.dAx : j.dBx, rdz = ax === 'a' ? j.dAz : j.dBz;
          const wCross = ax === 'a' ? j.wA : j.wB;
          const ax0 = j.x - rdx * 0.5, az0 = j.z - rdz * 0.5;      // 过街中心线段（路口两侧各 0.5）
          const bx0 = j.x + rdx * 0.5, bz0 = j.z + rdz * 0.5;
          let acc = 0;
          for (let i = 0; i < m.pts.length - 1; i++) {
            const [sx, sz] = m.pts[i], [ex, ez] = m.pts[i + 1];
            const hit = segIntersect(ax0, az0, bx0, bz0, sx, sz, ex, ez);
            const segLen = m.lens[i];
            if (hit) {
              const dj = Math.hypot(hit[0] - j.x, hit[1] - j.z);
              const f = Math.min(1, Math.hypot(hit[0] - sx, hit[1] - sz) / (segLen || 1));
              const tdx = (ex - sx) / (segLen || 1), tdz = (ez - sz) / (segLen || 1);
              const sinT = Math.abs(tdx * rdz - tdz * rdx);
              if (sinT >= SIN_MIN) {
                const half = Math.min((wCross / 2 + GATE_CURB) / sinT, HALF_CAP);
                const sMid = acc + segLen * f;
                const sIn = sMid - half, sOut = sMid + half;
                if (sIn > GATE_MARGIN && sOut < m.total - GATE_MARGIN) {
                  gs.push({ sIn, sOut, dj, js: [{ j, axis: ax }] });
                }
              }
            }
            acc += segLen;
          }
        }
      }
      gs.sort((a, b) => a.sIn - b.sIn);
      // 带重叠 → 联合走廊（span/vNeed 随之扩张）；例外：同路口异轴（a/b 互补永不共红，合并=死等）
      const merged = [];
      for (const g of gs) {
        const last = merged[merged.length - 1];
        const sameJDiffAxis = last && last.js.length === 1 && g.js.length === 1
          && last.js[0].j === g.js[0].j && last.js[0].axis !== g.js[0].axis;
        if (last && g.sIn < last.sOut && !sameJDiffAxis) {
          last.sOut = Math.max(last.sOut, g.sOut);
          last.js.push(...g.js);
        } else {
          merged.push({ sIn: g.sIn, sOut: g.sOut, js: g.js.slice() });
        }
      }
      for (const g of merged) {
        g.span = g.sOut - g.sIn;
        g.vNeed = Math.min(g.span / VNEED_WINDOW, VNEED_CAP);   // 宽门按需提速：任何门 need≤11.7s<13s 无饥饿
      }
      p.gates = merged;
      gatesTotal += merged.length;
      // 出生位重掷：不落在任何门带 ±0.05 内。8 次随机失败则落「最大无门间隙」中点侧——
      // 确定性兜底（轨道被门带大面积覆盖时随机重掷会全数失败，开局就有人站在路口中间）
      if (merged.some((g) => p.s > g.sIn - 0.05 && p.s < g.sOut + 0.05)) {
        let placed = false;
        for (let k = 0; k < 8 && !placed; k++) {
          p.s = rand() * m.total;
          placed = !merged.some((g) => p.s > g.sIn - 0.05 && p.s < g.sOut + 0.05);
        }
        if (!placed) {
          let lo = 0, bestLen = -1, bestLo = 0, bestHi = 0;
          for (const g of merged) {
            const hi = g.sIn - 0.05;
            if (hi - lo > bestLen) { bestLen = hi - lo; bestLo = lo; bestHi = hi; }
            lo = g.sOut + 0.05;
          }
          if (m.total - 0.05 - lo > bestLen) { bestLo = lo; bestHi = m.total - 0.05; }
          p.s = bestLen > 0 ? bestLo + (bestHi - bestLo) * (0.2 + rand() * 0.6) : m.total * 0.5;
        }
      }
    }
  }

  /** 线段求交（props.js 同款）：返回交点 [x,z] 或 null */
  function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
    const r1x = bx - ax, r1z = bz - az, r2x = dx - cx, r2z = dz - cz;
    const den = r1x * r2z - r1z * r2x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((cx - ax) * r2z - (cz - az) * r2x) / den;
    const u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return [ax + r1x * t, az + r1z * t];
  }

  /** 放行判据：联合走廊里每条被穿轴的受保护剩余（含黄灯预告）都够穿完 + 安全余量。
   *  vEff = 行人自身过街速度与门的按需提速取大（宽斜门要小跑才赶得上一个红窗） */
  function canEnter(g, p) {
    const vEff = Math.max(p.vCross, g.vNeed);
    const need = g.span / vEff + CROSS_SAFETY;
    return g.js.every((ja) => axisRemain(ja.j, ja.axis, clock) >= need);
  }

  /* ---- 逐帧推进：三态门控 + 折返/循环 + 走路颠簸 + 视觉推挤 + 写实例矩阵 ---- */
  const dummy = new THREE.Object3D();
  const px = new Float32Array(count), pz = new Float32Array(count), py = new Float32Array(count);
  const vx = new Float32Array(count), vz = new Float32Array(count);   // 推挤渲染偏移（权威量之外的）
  let clock = 0;   // 相位时钟：与 cars/props 三钟各自累计（同款先例），phaseOffset 错相下几帧漂移无感
  function update(dt) {
    clock += dt;
    /* 1) 推进 + 轨道位 */
    for (let i = 0; i < count; i++) {
      const p = peds[i];
      let x, z, ang;
      if (p.line) {
        const m = p.track;
        if (p.state === 'cross') {
          const vEff = Math.max(p.vCross, p.gate.vNeed);
          p.s += p.dir * vEff * dt;                     // 过街提速（宽门按需再提），commit 不看灯（黄灯起跑者靠 SAFETY 收尾）
          const exit = p.dir > 0 ? p.gate.sOut + 0.008 : p.gate.sIn - 0.008;
          if ((p.s - exit) * p.dir >= 0) { p.state = 'walk'; p.gate = null; }
          p.bobPhase += vEff * dt * 260;
        } else if (p.state === 'wait') {
          if (canEnter(p.gate, p)) p.state = 'cross';   // 同门所有 WAIT 同帧放行 = 灯放一批的队列视觉
          // bob 冻结：收步站定
        } else {
          p.s += p.dir * p.speed * dt;
          if (p.s > m.total) { p.s = 2 * m.total - p.s; p.dir = -1; }   // 线轨道：端点折返
          else if (p.s < 0) { p.s = -p.s; p.dir = 1; }
          p.bobPhase += p.speed * dt * 260;
          // 门触发：最近的前方门（无环判定——折返轨道上 mod 会给出假前方，人在无门处凭空停步）
          const gs = p.gates;
          for (let k = 0; k < gs.length; k++) {
            const g = p.dir > 0 ? gs[k] : gs[gs.length - 1 - k];
            const entry = p.dir > 0 ? g.sIn : g.sOut;   // 行进方向上的带入口（dir<0 从 sOut 进）
            const d = (entry - p.s) * p.dir;
            if (d <= 1e-4) continue;                    // 身后的门跳过
            if (d <= p.speed * dt + 2e-4) {
              p.gate = g;
              if (canEnter(g, p)) p.state = 'cross';
              else { p.state = 'wait'; p.s = entry - p.dir * p.hold; }   // hold 随机 → 沿人行道排成纵列
            }
            break;                                      // 第一个前方的门就是最近的
          }
          // 防御：WALK 中落在带内（相邻门重叠链等瞬态）一律退回本方向的路缘等待——
          // 不做「直接穿」：穿下一门不看它的轴相位，绿灯期等于把人送进车流（安全不变量失守）
          if (p.state === 'walk') {
            for (const g of gs) {
              if (p.s > g.sIn - 0.004 && p.s < g.sOut + 0.004) {
                const entry = p.dir > 0 ? g.sIn : g.sOut;   // 本行进方向上的带入口=身后的路缘
                p.state = 'wait'; p.gate = g;
                p.s = entry - p.dir * (p.hold + 0.004);
                break;
              }
            }
          }
        }
        [x, z, ang] = sampleTrack(m, p.s / m.total);
        if (p.dir < 0) ang += Math.PI;                  // 折返后半段沿反方向走
      } else {
        // 圆轨道：θ 匀速推进（角速度 = speed/r），循环取模（orbit 无门，恒 WALK）
        p.t = (((p.t + (p.dir * p.speed * dt) / (p.r * Math.PI * 2)) % 1) + 1) % 1;
        const th = p.t * Math.PI * 2;
        const rr = p.r + p.side * 0.004;                // 同半径双人也错开一点，减少重叠
        x = p.cx + Math.cos(th) * rr;
        z = p.cz + Math.sin(th) * rr;
        ang = Math.atan2(-Math.sin(th) * p.dir, Math.cos(th) * p.dir);
        p.bobPhase += p.speed * dt * 260;
      }
      px[i] = x; pz[i] = z;
      py[i] = 0.06 + Math.abs(Math.sin(p.bobPhase)) * 0.004;
      dummy.rotation.set(0, ang, 0);   // 朝向在此设置，pass 3 只改位置重写矩阵
    }
    /* 2) 视觉推挤：空间哈希 + 近距对推。只进 (vx,vz) 渲染偏移、指数回零 —— s/θ/r 权威量
     *    不动，WAIT 被推出触发区 / orbit 被推力吸入中心这类耦合在结构上不存在。 */
    const decay = Math.exp(-4 * dt);
    for (let i = 0; i < count; i++) { vx[i] *= decay; vz[i] *= decay; }
    const grid = new Map();
    for (let i = 0; i < count; i++) {
      const key = ((Math.floor(px[i] / PUSH_CELL) + 8192) << 14) | (Math.floor(pz[i] / PUSH_CELL) + 8192);
      const b = grid.get(key);
      if (b) b.push(i); else grid.set(key, [i]);
    }
    for (let i = 0; i < count; i++) {
      const cx = Math.floor(px[i] / PUSH_CELL), cz = Math.floor(pz[i] / PUSH_CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const b = grid.get(((cx + ox + 8192) << 14) | (cz + oz + 8192));
        if (!b) continue;
        for (const j of b) {
          if (j <= i) continue;                         // 每对只处理一次
          const dx = px[j] - px[i], dz = pz[j] - pz[i];
          const d2 = dx * dx + dz * dz;
          if (d2 >= PUSH_R * PUSH_R || d2 < 1e-12) continue;
          const d = Math.sqrt(d2), m2 = (PUSH_R - d) * 0.2 / d;   // 总量 (R-d)*0.4 对半分
          vx[i] -= dx * m2; vz[i] -= dz * m2;
          vx[j] += dx * m2; vz[j] += dz * m2;
        }
      }
    }
    /* 3) 写矩阵（轨道位 + 推挤偏移，模长钳 0.01：带下缘 0.29-0.01 仍 > 车带 0.275） */
    for (let i = 0; i < count; i++) {
      const l = Math.hypot(vx[i], vz[i]);
      const k = l > 0.01 ? 0.01 / l : 1;
      dummy.position.set(px[i] + vx[i] * k, py[i], pz[i] + vz[i] * k);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(0);   // 构造即写好全部矩阵缓冲，避免首帧残留单位矩阵
  return {
    group, count, update, setSignals,
    /** 巡检：三态计数 + 门数（pedestrian-check 断言用） */
    debug() {
      let walking = 0, waiting = 0, crossing = 0, linePeds = 0, bad = 0;
      for (const p of peds) {
        if (!p.line) continue;
        linePeds++;
        if (p.state === 'wait') waiting++;
        else if (p.state === 'cross') crossing++;
        else walking++;
        if (!Number.isFinite(p.s)) bad++;
      }
      return { total: count, linePeds, walking, waiting, crossing, gates: gatesTotal, nan: bad, clock: Math.round(clock * 10) / 10 };
    },
    /** 安全不变量：穿越中但任一被穿轴已是绿灯（= 放行判据失守，人会被放行车流穿过）。必须恒 0 */
    violations() {
      let v = 0;
      for (const p of peds) {
        if (!p.line || p.state !== 'cross' || !p.gate) continue;
        if (p.gate.js.some((ja) => phaseFor(ja.j, clock)[ja.axis] === 'green')) v++;
      }
      return v;
    },
    /** 点附近等待人数（pedestrian-check 取景/断言用） */
    waitingAt(x, z, r = 0.6) {
      let q = 0;
      for (let i = 0; i < count; i++) {
        const p = peds[i];
        if (p.line && p.state === 'wait' && Math.hypot(px[i] - x, pz[i] - z) < r) q++;
      }
      return q;
    },
  };
}
