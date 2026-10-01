// 南京 3D 场景 · 地理坐标换算与噪声工具
// 水平：1 单位 = 100 米（10 单位/公里）；垂直：1 单位 = 30 米（略作夸张以便观感）

export const UPK = 10;                 // units per km (horizontal)
export const VPM = 1 / 30;             // units per meter (vertical)
export const ORIGIN_LON = 118.7550;    // 场景原点（大致为南京主城几何中心）
export const ORIGIN_LAT = 32.0550;

/* ==================== 投影：以原点为中央子午线的横轴墨卡托（高斯-克吕格） ====================
 *
 * 曾经这里是「固定 km/度」的等距圆柱近似：
 *     x = (lon - ORIGIN_LON) * KM_PER_LON * UPK，KM_PER_LON = 94.30
 * 该常数只在原点纬度上成立。场景东西跨度近 40 km、纬度跨 31.96°–32.15°，
 * 常数系数因此带来系统性缩放误差 —— tools/geocheck.mjs 实测：
 * 东西向点对平均短 0.109%，最差点对（南京眼↔仙林）偏 25 m，达不到 1:1。
 *
 * 现改为正经的横轴墨卡托：中央子午线取原点经度，椭球取 WGS84/CGCS2000，
 * 子午线弧长、卯酉圈半径、子午线收敛与尺度畸变全部按级数展开到 l⁶。
 * 由于最远点距中央子午线不足 0.25°，截断误差在毫米量级 —— 对 1:1 复刻而言足够。
 * 校验方式见 tools/geocheck.mjs：用与投影无关的 Vincenty 椭球大地线做第三方真值。
 */
const DEG = Math.PI / 180;

const ECC_A = 6378137.0;                  // 长半轴 (m)
const ECC_F = 1 / 298.257223563;          // 扁率
const E2 = ECC_F * (2 - ECC_F);           // e²
const EP2 = E2 / (1 - E2);                // e'²

// 子午线弧长级数系数（精确到 e⁸）
const AR = (() => {
  const e2 = E2, e4 = e2 * e2, e6 = e4 * e2, e8 = e4 * e4;
  return {
    a0: 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256 - (175 * e8) / 16384,
    a2: (3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024 + (105 * e8) / 4096,
    a4: (15 * e4) / 256 + (45 * e6) / 1024 + (525 * e8) / 16384,
    a6: (35 * e6) / 3072 + (175 * e8) / 12288,
    a8: (315 * e8) / 131072,
  };
})();

/** 赤道至纬度 B 的子午线弧长（B 为弧度）
 *  Snyder《Map Projections》式 3-21：系数已含 1/n，正弦项**不再**除 2、4、6、8。
 *  （早期版本多除了分母，导致南北向每度多算 114 m —— 正是 geocheck 里那 930 ppm 的来源）
 */
function meridianArc(B) {
  return ECC_A * (
    AR.a0 * B
    - AR.a2 * Math.sin(2 * B)
    + AR.a4 * Math.sin(4 * B)
    - AR.a6 * Math.sin(6 * B)
    + AR.a8 * Math.sin(8 * B)
  );
}

/**
 * 高斯投影正算：经纬度(度) → [东向米, 北向米]（相对中央子午线 L0，未加带号与 500 km 偏移）
 */
export function gaussForward(lon, lat, L0 = ORIGIN_LON) {
  const B = lat * DEG;
  const l = (lon - L0) * DEG;
  const sB = Math.sin(B), cB = Math.cos(B), tB = sB / cB;
  const t2 = tB * tB, t4 = t2 * t2;
  const cB2 = cB * cB, cB3 = cB2 * cB, cB5 = cB3 * cB2;
  const eta2 = EP2 * cB2, eta4 = eta2 * eta2;
  const N = ECC_A / Math.sqrt(1 - E2 * sB * sB);   // 卯酉圈半径
  const l2 = l * l, l3 = l2 * l, l4 = l3 * l, l5 = l4 * l, l6 = l5 * l;

  const north = meridianArc(B)
    + (N / 2) * sB * cB * l2
    + (N / 24) * sB * cB3 * (5 - t2 + 9 * eta2 + 4 * eta4) * l4
    + (N / 720) * sB * cB5 * (61 - 58 * t2 + t4) * l6;

  const east = N * cB * l
    + (N / 6) * cB3 * (1 - t2 + eta2) * l3
    + (N / 120) * cB5 * (5 - 18 * t2 + t4 + 14 * eta2 - 58 * eta2 * t2) * l5;

  return [east, north];
}

// 原点自身的投影坐标：所有落位都相对它做差
const ORIGIN_EN = gaussForward(ORIGIN_LON, ORIGIN_LAT);

/** 经纬度 -> 场景 XZ 平面坐标（北 = -Z，1 单位 = 100 m） */
export function toV2(lon, lat) {
  const [e, n] = gaussForward(lon, lat);
  return [(e - ORIGIN_EN[0]) / 100, -(n - ORIGIN_EN[1]) / 100];
}
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

/** 场景坐标 -> 经纬度：牛顿迭代反解高斯投影（仅供信息展示，4 步即收敛到亚米级） */
export function toLonLat(x, z) {
  const east = x * 100 + ORIGIN_EN[0];
  const north = -z * 100 + ORIGIN_EN[1];
  let lat = ORIGIN_LAT + (north - ORIGIN_EN[1]) / 110900;   // 等距圆柱初值
  let lon = ORIGIN_LON + (east - ORIGIN_EN[0]) / 94300;
  for (let i = 0; i < 4; i++) {
    const [e, n] = gaussForward(lon, lat);
    const de = e - east, dn = n - north;
    const h = 1e-7;
    const [eL] = gaussForward(lon + h, lat);
    const [, nB] = gaussForward(lon, lat + h);
    const de_dlon = (eL - e) / h;      // ∂east/∂lon（每度）
    const dn_dlat = (nB - n) / h;      // ∂north/∂lat（每度）
    lon -= de / de_dlon;
    lat -= dn / dn_dlat;
  }
  return [lon, lat];
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
