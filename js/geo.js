// 南京 3D 场景 · 地理坐标换算与噪声工具
// 水平：1 单位 = 100 米（10 单位/公里）；垂直：1 单位 = 30 米（略作夸张以便观感）

export const UPK = 10;                 // units per km (horizontal)
export const VPM = 1 / 30;             // units per meter (vertical)
export const ORIGIN_LON = 118.7550;    // 场景原点（大致为南京主城几何中心）
export const ORIGIN_LAT = 32.0550;

const KM_PER_LON = 94.30;   // 南京纬度下 1 经度 ≈ 94.3 km
const KM_PER_LAT = 110.90;  // 1 纬度 ≈ 110.9 km

export function xFromLon(lon) { return (lon - ORIGIN_LON) * KM_PER_LON * UPK; }
export function zFromLat(lat) { return -(lat - ORIGIN_LAT) * KM_PER_LAT * UPK; }

/** 经纬度 -> 场景 XZ 平面坐标（北 = -Z） */
export function toV2(lon, lat) { return [xFromLon(lon), zFromLat(lat)]; }
export function toV2List(list) { return list.map(([lo, la]) => toV2(lo, la)); }

/** 米 -> 场景高度单位（统一 3.33 倍竖向夸张） */
export function mY(m) { return m * VPM; }

/* ---- 地标精确建模用的三类比例 ---- */
export const M_PER_U_H = 100;                       // 水平：1 单位 = 100 m（平面落位、桥跨、河宽）
export const M_PER_U_V = 30;                        // 竖向：1 单位 =  30 m
export const hU = (m) => m / M_PER_U_H;             // 平面真实尺寸
export const vU = (m) => m / M_PER_U_V;             // 竖向高度
export const footU = (m) => m / M_PER_U_V;          // 单体截面/占地：与竖向同比例，保持真实长宽比

/** 方位角(自北顺时针, 度) -> 场景 rotation.y：北为 -Z，东为 +X */
export const bearingToRot = (deg) => Math.PI - (deg * Math.PI) / 180;

/** 场景坐标 -> 经纬度（用于信息展示） */
export function toLonLat(x, z) {
  return [ORIGIN_LON + x / (KM_PER_LON * UPK), ORIGIN_LAT - z / (KM_PER_LAT * UPK)];
}

/* ---------------- 随机数 / 噪声 ---------------- */

export function makeRandom(seed = 1) {
  let a = seed >>> 0 || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(i, j, seed) {
  let n = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
  n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** 二维值噪声，0~1 */
export function noise2(x, y, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 分形叠加噪声，0~1 */
export function fbm(x, y, oct = 4, seed = 1) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

/* ---------------- 几何工具 ---------------- */

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 点到折线的最短距离 */
export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) best = d;
  }
  return best;
}

/** 折线累计长度 */
export function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** 沿折线按比例取点 */
export function samplePolyline(pts, t) {
  const lens = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(l); total += l;
  }
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i]) {
      const f = lens[i] ? target / lens[i] : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
        Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]),
      ];
    }
    target -= lens[i];
  }
  const last = pts[pts.length - 1], prev = pts[pts.length - 2] || last;
  return [last[0], last[1], Math.atan2(last[0] - prev[0], last[1] - prev[1])];
}

/** 重采样折线（按最大间距） */
export function resample(pts, maxStep = 4) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / maxStep));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  return out;
}

/** Catmull-Rom 平滑 */
export function smoothPolyline(pts, samplesPerSeg = 6) {
  if (pts.length < 3) return pts.slice();
  const ext = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, z]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------------- 太阳（实时光照与 IBL 烘焙共用的唯一来源） ---------------- */

const DEG = Math.PI / 180;

/**
 * 给定钟点求太阳状态。
 * f：0 = 6:00 日出，1 = 18:00 日落，之后为夜间（f 到 2）
 * dir 为单位向量（+Y 朝天），与 three 的 SphericalCoords(r=1, phi=90°-高度角, theta=方位角) 一致。
 */
export function sunState(hours) {
  const f = (((hours - 6) % 24) + 24) % 24 / 12;
  const azimuth = 90 + f * 180;
  const elevation = 62 * Math.sin(f * Math.PI);
  const ce = Math.cos(elevation * DEG);
  return {
    f,
    azimuth,
    elevation,
    dir: { x: ce * Math.sin(azimuth * DEG), y: Math.sin(elevation * DEG), z: ce * Math.cos(azimuth * DEG) },
    // 白天权重 / 夜晚权重 / 晨昏权重：三者都已在 0~1
    day: clamp(Math.sin(f * Math.PI), 0, 1),
    night: clamp((8 - elevation) / 22, 0, 1),
    dusk: Math.pow(clamp(1 - Math.abs(elevation) / 22, 0, 1), 1.6),
  };
}

/** 把 sunState 的方位/高度写进 three 的 Vector3（避免 geo.js 依赖 three） */
export function sunDirectionTo(v, s) { return v.set(s.dir.x, s.dir.y, s.dir.z); }
