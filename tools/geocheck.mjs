// tools/geocheck.mjs — 地理保真度自检：场景里的相对位置，与真实地图上的相对位置是否 1:1
//
// 思路：不信任任何单一换算，改用「独立于投影的第三方算法」做交叉验证。
//   真值  —— Vincenty 反解（WGS84 椭球大地线，mm 级）
//   场景  —— js/geo.js 的 toV2() 落位，距离 = 场景单位 × 100 m
// 两者逐对比较。只要「任意两点的场景间距 / 真实间距」恒等于 1，位置就是 1:1 的；
// 这个判据与原点选在哪、投影怎么定都无关，能同时暴露
//   ① 比例系数写错（KM_PER_LON / KM_PER_LAT）
//   ② 平面近似带来的畸变（经纬网收敛）
//   ③ 某个地标落位算错（如曾经的 hexi NaN）
//
// 用法: node tools/geocheck.mjs

import { toV2, toLonLat, polylineLength, pointInPolygon, smoothPolyline } from '../js/geo.js';
import { LANDMARKS, CITY_WALL, LAKES } from '../js/data.js';

/* ---------- WGS84 椭球大地线（Vincenty 反解） ---------- */
const A = 6378137.0;
const F = 1 / 298.257223563;
const B = A * (1 - F);

function vincenty(lon1, lat1, lon2, lat2) {
  const L = ((lon2 - lon1) * Math.PI) / 180;
  const U1 = Math.atan((1 - F) * Math.tan((lat1 * Math.PI) / 180));
  const U2 = Math.atan((1 - F) * Math.tan((lat2 * Math.PI) / 180));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1);
  const sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L;
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    const ss = Math.sqrt(cU2 * sl * (cU2 * sl) + (cU1 * sU2 - sU1 * cU2 * cl) ** 2);
    if (ss === 0) return 0;
    const cs = sU1 * sU2 + cU1 * cU2 * cl;
    const sig = Math.atan2(ss, cs);
    const sa = (cU1 * cU2 * sl) / ss;
    const c2a = 1 - sa * sa;
    const c2sm = c2a === 0 ? 0 : cs - (2 * sU1 * sU2) / c2a;
    const C = (F / 16) * c2a * (4 + F * (4 - 3 * c2a));
    const lamNew = L + (1 - C) * F * sa * (sig + C * ss * (c2sm + C * cs * (-1 + 2 * c2sm ** 2)));
    if (Math.abs(lamNew - lam) < 1e-14) {
      const u2 = (c2a * (A * A - B * B)) / (B * B);
      const k1 = (Math.sqrt(1 + u2) - 1) / (Math.sqrt(1 + u2) + 1);
      const AA = (1 + k1 * k1 / 4) / (1 - k1);
      const BB = k1 * (1 - (3 * k1 * k1) / 8);
      const dsig = BB * ss * (c2sm + (BB / 4) * (cs * (-1 + 2 * c2sm ** 2)
        - (BB / 6) * c2sm * (-3 + 4 * ss ** 2) * (-3 + 4 * c2sm ** 2)));
      return B * AA * (sig - dsig);
    }
    lam = lamNew;
  }
  return NaN;
}

/* ---------- 逐对比较 ---------- */
const pts = LANDMARKS.map((l) => ({ id: l.id, name: l.name, lon: l.lon, lat: l.lat, p: toV2(l.lon, l.lat) }));

const rows = [];
for (let i = 0; i < pts.length; i++) {
  for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j];
    const real = vincenty(a.lon, a.lat, b.lon, b.lat);            // 米
    if (!Number.isFinite(real) || real < 1) continue;
    const scene = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) * 100;   // 单位 → 米
    rows.push({ a: a.id, b: b.id, real, scene, err: scene - real, ppm: (scene - real) / real * 1e6 });
  }
}

rows.sort((x, y) => Math.abs(y.err) - Math.abs(x.err));

console.log('=== 场景相对位置 vs 真实大地线距离（WGS84 / Vincenty）===');
console.log(`地标 ${pts.length} 个 · 点对 ${rows.length} 组\n`);

console.log('偏差最大的 12 组：');
console.log('  A            B            真实(m)     场景(m)     偏差(m)    相对(ppm)');
for (const r of rows.slice(0, 12)) {
  console.log(
    `  ${r.a.padEnd(12)} ${r.b.padEnd(12)} ${r.real.toFixed(1).padStart(9)} ${r.scene.toFixed(1).padStart(11)} `
    + `${(r.err >= 0 ? '+' : '') + r.err.toFixed(1)}`.padStart(10)
    + `${(r.err >= 0 ? '+' : '') + r.ppm.toFixed(0)}`.padStart(11),
  );
}

const abs = rows.map((r) => Math.abs(r.err));
const mean = abs.reduce((s, v) => s + v, 0) / abs.length;
const max = Math.max(...abs);
const p95 = abs.slice().sort((a, b) => a - b)[Math.floor(abs.length * 0.95)];
console.log(`\n绝对偏差：平均 ${mean.toFixed(1)} m · p95 ${p95.toFixed(1)} m · 最大 ${max.toFixed(1)} m`);

// 尺度各向异性：分别统计「偏东西向」与「偏南北向」的点对，定位是 KM_PER_LON 还是 KM_PER_LAT 的问题
const ew = rows.filter((r) => Math.abs(pts.find((p) => p.id === r.a).p[0] - pts.find((p) => p.id === r.b).p[0])
  > Math.abs(pts.find((p) => p.id === r.a).p[1] - pts.find((p) => p.id === r.b).p[1]));
const ns = rows.filter((r) => !ew.includes(r));
const statOf = (list) => {
  if (!list.length) return '（无样本）';
  const m = list.reduce((s, r) => s + r.err / r.real, 0) / list.length;
  return `平均相对偏差 ${(m * 1e6).toFixed(0)} ppm（${(m * 100).toFixed(3)}%）· n=${list.length}`;
};
console.log(`东西向为主：${statOf(ew)}`);
console.log(`南北向为主：${statOf(ns)}`);

/* ---------- 城墙 vs 水体 / 周长 ---------- */
{
  const inside = [];
  for (const [lo, la] of CITY_WALL) {
    for (const l of LAKES) if (pointInPolygon(lo, la, l.pts)) inside.push(`${l.name}(${lo},${la})`);
  }
  // polylineLength 吃的是场景单位：先把经纬度落位再量，1 单位 = 100 m → km = 单位/10
  const wallU = CITY_WALL.concat([CITY_WALL[0]]).map(([lo, la]) => toV2(lo, la));
  const km = polylineLength(wallU) / 10;
  console.log("=== 明城墙折线 ===");
  console.log(`周长 ${km.toFixed(2)} km（实测：京城原 35.267 km / 现存约 25 km）`);
  console.log(inside.length ? `WARN  有 ${inside.length} 个墙点落在湖体内：${inside.join('、')}` : 'OK  无墙点落在湖体内（湖完整位于城外）');

  // 渲染用的是 smoothPolyline(CITY_WALL, 7)——Catmull-Rom 会过冲，
  // 顶点在湖外不代表渲染出来的线也在湖外，必须按实际渲染的折线再查一遍
  const sm = smoothPolyline(CITY_WALL.map(([lo, la]) => toV2(lo, la)), 7).concat([]);
  const closed = sm.concat([sm[0]]);
  let hit = 0, total = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const a = closed[i], b = closed[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2));
    for (let k = 0; k <= n; k++) {
      const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n;
      const [lo, la] = toLonLat(x, z);
      total++;
      for (const l of LAKES) if (pointInPolygon(lo, la, l.pts)) { hit++; break; }
    }
  }
  console.log(`渲染折线（Catmull-Rom 平滑后）采样 ${total} 点，落入湖体 ${hit} 点 `
    + (hit ? 'WARN  平滑过冲把墙推进了湖里' : 'OK  渲染出来的墙不进湖'));
  console.log('');
}

const worst = max;
console.log(`\n${worst <= 20 ? 'OK  最大偏差 ≤ 20 m（城市沙盘可接受的 1:1）' : 'WARN  存在 > 20 m 的偏差，换算系数或投影需修正'}`);
