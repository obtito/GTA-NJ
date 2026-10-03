// 南京地铁线网 3D 可视化
// 数据:data/metro-3d.json(AFAP/nanjing-metro 整理的 OSM ODbL 几何,仅取几何)
//   · lines[]     { id, name, station_ids }                       —— 15 条线路
//   · stations[]  { id, line_ids, coordinate:{longitude,latitude} } —— 263 站(换乘站已合并)
//   · ways[]      { line_ids, structure:'tunnel'|'bridge'|'surface_or_unknown',
//                   geometry:[[lon,lat,地表高程],…] }              —— 325 段轨道折线
// 高架/地下判定依据 way.structure(OSM railway 的 tunnel/bridge 标签衍生);
// 几何第三坐标是地表栅格高程(EGM96),NOTICE 明确「不是轨面标高」,故不用于竖向落位。
// 本模块 node 安全:不 fetch、不碰 DOM,数据由调用方传入。
import * as THREE from 'three';
import { toV2, hU, vU, distToPolyline } from './geo.js';
import { mat, ribbonGeometry, UNIT, instancedBoxes } from './lib.js';

/* ---------------- 场景标高(与 world.js 同一套常数) ---------------- */
const GROUND_Y = -0.05;               // 地面
const ROAD_Y = -0.045;                // 路面
const WATER_Y = 0.35;                 // 长江水面
const DECK_Y = vU(10);                // 高架走廊面 ≈ 0.333(轨面高 10 m 的观感高度)
const DECK_OVER_WATER_Y = WATER_Y + 0.02;   // 过江段桥面:水面上方 0.02
const TUNNEL_Y = ROAD_Y + 0.015;      // 地下线画在路面上方一点点的半透明示意线(-0.03)
const SURFACE_Y = ROAD_Y + 0.009;     // 地面段贴路(介于路面与地下示意线之间)

/* ---------------- 线路色(数据不含官方线路色 → 15 色调色板,顺序同数据 lines) ---------------- */
const LINE_COLORS = {
  '1': 0x2569d8, '2': 0xe0392f, '3': 0x2fa04c, '4': 0x8a4fbf, '5': 0xf0a52f,
  '6': 0xe05f92, '7': 0xef7a1f, '10': 0xd9b02e, 'S1': 0x2fbfae, 'S2': 0x8f5a3c,
  'S3': 0x38b3e0, 'S6': 0x40468f, 'S7': 0x8fae2a, 'S8': 0x35708e, 'S9': 0xb04a8f,
};
const FALLBACK_COLORS = [0x2569d8, 0xe0392f, 0x2fa04c, 0x8a4fbf, 0xf0a52f, 0xe05f92,
  0xef7a1f, 0x38b3e0, 0x8fae2a, 0x8f5a3c, 0x40468f, 0xb04a8f, 0x2fbfae, 0xd9b02e, 0x35708e];

/* ---------------- 长江中心线(简化复刻 data.js RIVER,仅用于过江段抬升/墩高判定) ---------------- */
const RIVER_LL = [
  [118.6250, 31.9250], [118.6520, 31.9620], [118.6700, 31.9950], [118.6860, 32.0280],
  [118.7000, 32.0580], [118.7200, 32.0870], [118.7397, 32.1153], [118.7520, 32.1380],
  [118.7620, 32.1580], [118.7750, 32.1780], [118.8000, 32.1880], [118.8600, 32.1900],
  [118.9600, 32.1780],
];
const BRANCH_LL = [                                   // 夹江(河西侧汊道)
  [118.6930, 31.9860], [118.6955, 31.9960], [118.6972, 32.0120], [118.6982, 32.0300],
  [118.6986, 32.0480], [118.6988, 32.0600],
];
const RIVER_HALF = 7.2;                               // 主江判定半宽(略保守于 RIVER.halfWidth 7.5)
const BRANCH_HALF = 1.9;

/* ---------------- 索引几何合并(逐 way 生成 → 按线/结构合批,压 draw call) ---------------- */
function mergeGeos(list) {
  let vCount = 0, iCount = 0;
  for (const g of list) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2), idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** 圆盘实例化(站点):items [{ x, z, y, d, h }] */
function instancedCylinders(items, material) {
  const mesh = new THREE.InstancedMesh(UNIT.cyl, material, items.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < items.length; i++) {
    const s = items[i];
    dummy.position.set(s.x, s.y, s.z);
    dummy.scale.set(s.d, s.h, s.d);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}

/* ================================================================================
 * buildMetro(net) —— net 为 data/metro-3d.json 解析后的对象
 * 返回 { group, lines, stations, transfers, setNight }
 * ================================================================================ */
export function buildMetro(net) {
  const group = new THREE.Group();
  group.name = 'nanjing-metro';

  // 长江中心线投影到场景坐标(过江判定用)
  const riverPts = RIVER_LL.map(([lo, la]) => toV2(lo, la));
  const branchPts = BRANCH_LL.map(([lo, la]) => toV2(lo, la));
  const overWater = (p) =>
    distToPolyline(p[0], p[1], riverPts) < RIVER_HALF ||
    distToPolyline(p[0], p[1], branchPts) < BRANCH_HALF;

  /* ---- 线路色表 ---- */
  const lineColor = new Map();
  (net.lines || []).forEach((l, i) => {
    lineColor.set(l.id, LINE_COLORS[l.id] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]);
  });
  const colorOf = (id) => lineColor.get(id) ?? 0x888888;

  /* ---- 站点:换乘判定(数据已合并多线共站;再按 60 m 空间聚类兜底) ---- */
  const stData = [];
  for (const s of net.stations || []) {
    const c = s.coordinate;
    if (!c || !Number.isFinite(c.longitude) || !Number.isFinite(c.latitude)) continue;
    const [x, z] = toV2(c.longitude, c.latitude);
    stData.push({ id: s.id, lines: s.line_ids || [], x, z });
  }
  // 空间聚类:距离 < 60 m(hU(60)=0.6u)判同一物理站;簇内 ≥2 条线即换乘
  const MERGE_D = hU(60);
  const clustered = stData.map(() => false);
  const transferSet = new Set();
  for (let i = 0; i < stData.length; i++) {
    if (clustered[i]) continue;
    const cluster = [i]; clustered[i] = true;
    for (let j = i + 1; j < stData.length; j++) {
      if (clustered[j]) continue;
      if (Math.hypot(stData[j].x - stData[i].x, stData[j].z - stData[i].z) < MERGE_D) {
        cluster.push(j); clustered[j] = true;
      }
    }
    const lines = new Set();
    cluster.forEach((k) => stData[k].lines.forEach((l) => lines.add(l)));
    if (lines.size >= 2) cluster.forEach((k) => transferSet.add(stData[k].id));
  }

  /* ---- 站点圆盘:每线一个实例化盘(换乘盘放大加白环) ---- */
  const stationMat = new Map();                       // lineId -> 材质(setNight 拉亮)
  const discItems = new Map();                        // lineId -> [{x,z,y,d,h}]
  const ringGeos = [];
  for (const s of stData) {
    const isTransfer = transferSet.has(s.id);
    const lineId = s.lines[0];
    const r = isTransfer ? 0.06 : 0.045;              // 半径:换乘 0.06u / 普通 0.045u
    if (!discItems.has(lineId)) discItems.set(lineId, []);
    discItems.get(lineId).push({ x: s.x, z: s.z, y: -0.034, d: r * 2, h: 0.012 });
    if (isTransfer) {
      const g = new THREE.RingGeometry(r + 0.012, r + 0.026, 28);
      g.rotateX(-Math.PI / 2);
      g.translate(s.x, -0.016, s.z);
      ringGeos.push(g);
    }
  }
  for (const [lineId, items] of discItems) {
    const col = colorOf(lineId);
    const m = mat(col, { emissive: col, emissiveIntensity: 0.3, rough: 0.6 });
    stationMat.set(lineId, m);
    group.add(instancedCylinders(items, m));
  }
  const ringMat = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.35, rough: 0.5, side: THREE.DoubleSide });
  if (ringGeos.length) {
    const ring = new THREE.Mesh(mergeGeos(ringGeos), ringMat);
    ring.castShadow = ring.receiveShadow = false;
    group.add(ring);
  }

  /* ---- 线路几何:按 structure 分桶(bridge 抬升高架 / tunnel 地下 / surface 贴地) ---- */
  // ribbons[lineId][kind] = [折线数组…]  ·  piers = [{x,z,y,w,h,d}]
  const ribbons = new Map();
  const piers = [];
  const addRun = (lineId, kind, pts) => {
    if (!ribbons.has(lineId)) ribbons.set(lineId, {});
    const b = ribbons.get(lineId);
    (b[kind] || (b[kind] = [])).push(pts);
  };

  for (const w of net.ways || []) {
    if (!w.geometry || w.geometry.length < 2) continue;
    const kind = w.structure === 'tunnel' ? 'tunnel'
      : w.structure === 'bridge' ? 'bridge' : 'surface';
    const lineId = (w.line_ids || [])[0];
    if (lineId === undefined) continue;
    const pts = w.geometry
      .filter((g) => Number.isFinite(g[0]) && Number.isFinite(g[1]))
      .map((g) => toV2(g[0], g[1]));
    if (pts.length < 2) continue;

    if (kind === 'bridge') {
      // 过江判定逐点做,切成水上/陆上连续段,分别给桥面高度
      let run = [pts[0]], runWater = overWater(pts[0]);
      const flush = (r, isWater) => {
        if (r.length >= 2) addRun(lineId, 'bridge', r);
        // 每 hU(40) 一根细墩,自地面(-0.05)立到桥面;首尾留 0.12u 不放墩
        const deckY = isWater ? DECK_OVER_WATER_Y : DECK_Y;
        const cum = [0];
        for (let i = 1; i < r.length; i++) {
          cum.push(cum[i - 1] + Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]));
        }
        const total = cum[cum.length - 1];
        const STEP = hU(40), MARGIN = 0.12;
        for (let d = MARGIN; d <= total - MARGIN; d += STEP) {
          let i = 1;
          while (i < cum.length - 1 && cum[i] < d) i++;
          const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
          piers.push({
            x: r[i - 1][0] + (r[i][0] - r[i - 1][0]) * t,
            z: r[i - 1][1] + (r[i][1] - r[i - 1][1]) * t,
            y: GROUND_Y, w: hU(2.4), d: hU(2.4), h: deckY - GROUND_Y,
          });
        }
      };
      for (let i = 1; i < pts.length; i++) {
        const ow = overWater(pts[i]);
        run.push(pts[i]);
        if (ow !== runWater) { flush(run, runWater); run = [pts[i]]; runWater = ow; }
      }
      flush(run, runWater);
    } else {
      addRun(lineId, kind, pts);
    }
  }

  /* ---- 成网格:每线高架/贴地共用一个实色材质,地下单独半透明材质 ---- */
  const WIDTH = { bridge: hU(5), surface: hU(4), tunnel: hU(3) };
  const Y = { bridge: DECK_Y, surface: SURFACE_Y, tunnel: TUNNEL_Y };
  for (const [lineId, kinds] of ribbons) {
    const col = colorOf(lineId);
    for (const kind of ['bridge', 'surface', 'tunnel']) {
      const runs = kinds[kind];
      if (!runs || !runs.length) continue;
      const geos = runs.map((r) => ribbonGeometry(r, WIDTH[kind], Y[kind], 0.3));
      const m = kind === 'tunnel'
        ? mat(col, { transparent: true, opacity: 0.55, rough: 0.9, side: THREE.DoubleSide })
        : mat(col, { rough: 0.75, side: THREE.DoubleSide });   // 高架走廊从桥下仰视也要有面
      const mesh = new THREE.Mesh(mergeGeos(geos), m);
      mesh.name = `metro:${lineId}:${kind}`;
      mesh.castShadow = mesh.receiveShadow = false;
      if (kind === 'tunnel') { mesh.renderOrder = 2; }   // 半透明地下线不写深度,晚于地面画
      group.add(mesh);
    }
  }

  /* ---- 高架墩:全线网合一个实例化盒子群 ---- */
  if (piers.length) {
    const pierMesh = instancedBoxes(piers, mat('#b9b7b2', { rough: 0.9 }), { cast: false, receive: false });
    if (pierMesh) { pierMesh.name = 'metro:piers'; group.add(pierMesh); }
  }

  /* ---- 夜间:站点(与换乘白环)点亮 ---- */
  function setNight(k) {
    const inten = 0.3 + k * 1.5;
    for (const m of stationMat.values()) m.emissiveIntensity = inten;
    ringMat.emissiveIntensity = 0.35 + k * 1.6;
  }

  return {
    group,
    lines: (net.lines || []).length,
    stations: stData.length,
    transfers: transferSet.size,
    setNight,
  };
}
