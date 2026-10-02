/* 道路体检：把「一比一」和「不穿模」先量化出来，不靠目视。
 *   1) 路面中心线的地形断面 —— 路面被山体吞掉的比例（龙蟠路旧线位 22%）
 *   2) 过水段有没有抬成桥面 —— 路面标高必须高于水面
 *   3) 离城墙带够不够远 —— 路面带宽 40 m，中心离墙 < 半宽 + 墙半宽就压墙
 *   4) 横断面有没有铺满整幅红线 —— 分区之间留缝会在路面上露出底下草地
 *      （中山南路曾因为非机动车道那条 sadd() 参数写反被丢弃，横向缺 4.5 m）
 *   5) 楼群有没有压在沥青上 —— 「楼从马路里长出来」是穿模最常见的样子
 * 用法：node tools/roadcheck.mjs
 */
import * as THREE from 'three';
import { toV2List, M_PER_U_H, smoothPolyline } from '../js/geo.js';
import { ROADS, RIVER, LAKES, CITY_WALL, CITY_GATES, gateHalfLenM } from '../js/data.js';
import { terrainHeight, roadCutHeight } from '../js/world.js';
import { roadSection } from '../js/data.js';

const ROAD_Y = -0.045;     // buildRoads 里的城市道路标高（单位）
const DECK_RISE = 0.85;    // 桥面离水面的高度（单位）
const M_PER_U_V = 30;

/* ---------- 水面 ---------- */
const segDist = (poly, x, z) => {
  let d = 1e9;
  for (let i = 0; i < poly.length - 1; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const L2 = dx * dx + dz * dz || 1;
    let t = ((x - x0) * dx + (z - z0) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    d = Math.min(d, Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)));
  }
  return d;
};
const inWater = (x, z) => [
  { half: RIVER.halfWidth * 0.86, poly: toV2List(RIVER.pts), y: 0.35 },
  ...(RIVER.branches || []).map((b) => ({ half: b.halfWidth, poly: toV2List(b.pts), y: 0.34 })),
  ...LAKES.map((l) => ({ half: 0, poly: toV2List(l.pts), y: 0.3, closed: true })),
].filter((b) => (b.closed
  ? (() => { let f = false; for (let i = 0, j = b.poly.length - 1; i < b.poly.length; j = i++) {
      const [xi, zi] = b.poly[i], [xj, zj] = b.poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) f = !f; } return f; })()
  : segDist(b.poly, x, z) < b.half));

/* ---------- 城墙带 ----------
 * 墙身断面已等比 1:30（墙线地理仍 1:100），底宽 14~20 m 在地理读数下放大 10/3，
 * 取半厚 33 m（= 10 m × 100/30）。路面外缘离墙中心线必须 ≥ 半路宽 + 半墙厚，
 * 否则沥青会从墙基里穿出去。唯一例外是城门洞：过门的路本来就该穿过墙体。 */
const WALL_HALF = 33;
const wallPts = toV2List(CITY_WALL);
const distToWallM = (x, z) => segDist([...wallPts, wallPts[0]], x, z) * M_PER_U_H;
const gatePts = CITY_GATES.map((g) => ({
  x: toV2List([[g.lon, g.lat]])[0][0],
  z: toV2List([[g.lon, g.lat]])[0][1],
  half: gateHalfLenM(g),
}));
/** 是否位于某个城门的通行范围里（门宽的一半 + 60 m 城台/瓮城喇叭口 + 半路宽）。
 *  门体断面 1:30、墙线地理 1:100，门半长按 ×100/30 折算成地理米。
 *  过门的路本来就要穿过墙体，门两侧（含进城引道）贴着城台也是实情，不能算穿模。 */
const inGatePass = (x, z, roadHalf) => gatePts.some((g) => (
  Math.hypot(g.x - x, g.z - z) * M_PER_U_H < g.half * 100 / 30 + 100 + roadHalf
));

/* ---------- 横断面覆盖率 ----------
 * bands 是相对中心线的横向米数，必须从 -W/2 一直铺到 +W/2、相邻两带首尾相接。
 * 留缝 = 路面漏底（下面就是地面那层草地）；重叠 = z-fighting。 */
function sectionGap(sec) {
  const bs = [...sec.bands].sort((a, b) => a.lo - b.lo);
  let cur = -sec.W / 2, worstGap = 0, worstAt = 0, worstOver = 0;
  for (const b of bs) {
    if (b.lo > cur) { const g = b.lo - cur; if (g > worstGap) { worstGap = g; worstAt = cur; } }
    else if (cur - b.lo > worstOver) worstOver = cur - b.lo;
    cur = Math.max(cur, b.hi);
  }
  const tail = sec.W / 2 - cur;
  if (tail > worstGap) { worstGap = tail; worstAt = cur; }
  return { worstGap, worstAt, worstOver };
}

/* ---------- 逐条体检 ---------- */
let hill = 0, sink = 0, wall = 0, tot = 0;
let gapMax = 0, gapDetail = [];
const rows = [];
const wallDetail = [];

for (const r of ROADS) {
  const sec = roadSection(r);
  // 必须沿 world.js buildRoads 实际用的那条平滑中心线采样：
  // 直线折线在路口处的偏差可达 130 m，拿它去判切坡会全线误报。
  const pts = toV2List(smoothPolyline(r.pts, 6));
  let cHill = 0, cSink = 0, cWall = 0, n = 0, peak = -1e9;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const steps = Math.max(4, Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 12));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      n++; tot++;
      const raw = terrainHeight(x, z);
      const cut = roadCutHeight(raw, x, z);          // 山体网格实际会削到这么低
      const water = inWater(x, z);
      const deck = water.length ? Math.max(ROAD_Y, water[0].y + DECK_RISE) : ROAD_Y;
      peak = Math.max(peak, cut);
      if (cut > deck + 1e-4) cHill++;               // 地形还高过路面 → 路面埋在土里
      if (deck - water.length * 0 > 0 && deck < water[0].y) cSink++;   // 桥面低于水面
      if (distToWallM(x, z) < sec.W / 2 + WALL_HALF && !inGatePass(x, z, sec.W / 2)) {
        cWall++;
        if (wallDetail.length < 12) {
          const g = gatePts.map((q) => ({ n: CITY_GATES[gatePts.indexOf(q)].name, d: Math.hypot(q.x - x, q.z - z) * M_PER_U_H }))
            .sort((a, b) => a.d - b.d)[0];
          wallDetail.push(r.name + ' 离墙' + distToWallM(x, z).toFixed(1) + 'm 最近门=' + g.n + ' ' + g.d.toFixed(0) + 'm'
            + '  位置 ' + (118.7550 + x * 100 / 94419).toFixed(4) + ',' + (32.0550 - z * 100 / 111320).toFixed(4));
        }
      }
    }
  }
  hill += cHill; sink += cSink; wall += cWall;
  const g = sectionGap(sec);
  if (g.worstGap > gapMax) gapMax = g.worstGap;
  if (g.worstGap > 0.1) gapDetail.push(r.name + ' 断面缺 ' + g.worstGap.toFixed(2) + ' m（从 t=' + g.worstAt.toFixed(2) + ' m 起）');
  const pct = (v) => ((v / n) * 100).toFixed(1) + '%';
  rows.push([
    r.name.padEnd(15, '　'),
    '红线' + String(sec.W).padStart(3) + 'm',
    '断面' + String(sec.bands.length).padStart(3) + '带',
    '车道' + sec.lane.toFixed(2) + 'm',
    '地形峰' + (peak * M_PER_U_V).toFixed(0).padStart(3) + 'm',
    (cHill ? '✗埋山 ' + pct(cHill).padStart(6) : '·埋山     0.0%'),
    (cSink ? '✗沉水 ' + pct(cSink).padStart(6) : '·沉水     0.0%'),
    (cWall ? '✗压墙 ' + pct(cWall).padStart(6) : '·压墙     0.0%'),
    (g.worstGap > 0.1 ? '✗缺带 ' + g.worstGap.toFixed(2) + 'm' : '·铺满   100%'),
  ].join('  '));
}
console.log(rows.join('\n'));
console.log('—'.repeat(112));
console.log('合计：埋山 ' + hill + ' / 沉水 ' + sink + ' / 压墙 ' + wall + ' 采样（共 ' + tot + '）'
  + ' ｜ 断面最大缺带 ' + gapMax.toFixed(2) + ' m');
if (wall > 0) {
  console.log('\n压墙明细（看最近城门：离门最近的自然是「过门」，离门很远的就是真穿墙）');
  console.log(wallDetail.join('\n'));
}
if (gapDetail.length) {
  console.log('\n缺带明细（分区之间没接上，路面会露出底下的草地）');
  console.log(gapDetail.join('\n'));
}

/* ---------- 楼群压沥青 ---------- */
const LANES = ROADS.map((r) => ({
  hw: (roadSection(r).W / 2) / M_PER_U_H,
  pts: toV2List(smoothPolyline(r.pts, 6)),
}));
const onAsphalt = (x, z) => LANES.some((l) => segDist(l.pts, x, z) < l.hw);
{
  const { buildCity } = await import('../js/city.js');
  const city = buildCity({});
  let meshes = 0, inst = 0, bad = 0, detail = 0, worst = null;
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  city.group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    meshes++;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m4);
      m4.decompose(pos, rot, scl);
      inst++;
      // 实例几何是单位盒，缩放已含 w/h/d；取较大边的一半当占地半径（保守）
      const half = Math.max(Math.abs(scl.x), Math.abs(scl.z)) * 50;
      if (!onAsphalt(pos.x, pos.z)) continue;
      if (half < 5) { detail++; continue; }        // 空调外机/女儿墙这类构件贴脸沿街是常态
      bad++;
      if (!worst) worst = '(' + pos.x.toFixed(2) + ', ' + pos.z.toFixed(2) + ') 占地半宽 ' + half.toFixed(1) + ' m';
    }
  });
  console.log('\n楼体压红线：实例 ' + inst + ' 个（' + meshes + ' 组 InstancedMesh）；'
    + '楼体（占地 ≥10 m）压在红线上 ' + bad + ' 个' + (worst ? '，首个 ' + worst : '')
    + '；小型构件贴线 ' + detail + ' 个（空调外机/女儿墙一类，允许）');
}
