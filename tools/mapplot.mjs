// tools/mapplot.mjs — 生成一张自上而下的平面图（SVG），用于脱离 3D 视图核对几何真值
//
// 为什么需要它：3D 视角受相机角度、遮挡、浏览器缓存影响，双方可能"看到的不是同一件事"。
// 平面图直接由 js/data.js + buildCity() 的落位数据绘制，是几何真值的直接投影：
//   · 城墙是否切进玄武湖
//   · 城墙沿线是否留出建筑净空
//   · 长江 / 夹江 / 湖泊与地标落位
//
// 用法: node tools/mapplot.mjs [输出路径]

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { toV2, smoothPolyline, polylineLength } from '../js/geo.js';
import { CITY_WALL, LAKES, RIVER, LANDMARKS, DISTRICTS } from '../js/data.js';
import { buildCity, districtGridLines } from '../js/city.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || path.join(ROOT, '.workbuddy', 'map.html');

const V = (lon, lat) => toV2(lon, lat);

/* ---- 收集要素（场景单位） ---- */
const wall = smoothPolyline(CITY_WALL.map(([lo, la]) => V(lo, la)), 7);
const rivers = RIVER.pts.map(([lo, la]) => V(lo, la));
const branches = (RIVER.branches || []).map((b) => b.pts.map(([lo, la]) => V(lo, la)));
const lakes = LAKES.map((l) => l.pts.map(([lo, la]) => V(lo, la)));
const marks = LANDMARKS.map((m) => ({ ...m, p: V(m.lon, m.lat) }));

const lm = { exclusions: [] };
const city = buildCity({ exclusions: lm.exclusions });
const buildings = [];
for (const b of city.buckets) for (const it of b.items) buildings.push(it);

/* ---- 视口 ---- */
const all = [...wall, ...rivers, ...lakes.flat(), ...marks.map((m) => m.p)];
const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]);
const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
const W = 1180, H = 900, pad = 40;
const k = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (z1 - z0));
const px = (p) => [pad + (p[0] - x0) * k, pad + (p[1] - z0) * k];   // 东→右，南→下（与常规地图一致）
const poly = (pts) => pts.map(px).map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');

/* ---- SVG ---- */
const wallKm = (polylineLength(wall.concat([wall[0]])) / 10).toFixed(1);
const rect = (it, fill) => {
  const [cx, cy] = px([it.x, it.z]);
  const w = Math.max(1, it.w * k), d = Math.max(1, it.d * k);
  const rot = (it.rot || 0) * 180 / Math.PI;
  return `<rect x="${(-w / 2).toFixed(1)}" y="${(-d / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${d.toFixed(1)}" fill="${fill}" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${(rot).toFixed(1)})"/>`;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#f6f7f5"/>
<g>
  ${DISTRICTS.map((d) => {
    const c = px(V(d.lon, d.lat));
    const w = d.w * 10 * k, h = d.d * 10 * k;
    return `<rect x="${(c[0] - w / 2).toFixed(1)}" y="${(c[1] - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(120,140,120,.08)" stroke="rgba(90,110,90,.25)" transform="rotate(${d.rot} ${c[0].toFixed(1)} ${c[1].toFixed(1)})"/>`;
  }).join('\n  ')}
</g>
<path d="${poly(rivers)} L${''}" fill="none" stroke="#5c9bc0" stroke-width="${(RIVER.halfWidth * 2 * k).toFixed(1)}" stroke-opacity=".55" stroke-linecap="round"/>
${branches.map((b) => `<path d="${poly(b)}" fill="none" stroke="#5c9bc0" stroke-width="${(2.2 * 2 * k).toFixed(1)}" stroke-opacity=".5" stroke-linecap="round"/>`).join('\n')}
${lakes.map((l) => `<path d="${poly(l)} Z" fill="#7fb6d6" fill-opacity=".75" stroke="#5c9bc0" stroke-width="1"/>`).join('\n')}
<g>${buildings.map((b) => rect(b, 'rgba(70,78,88,.55)')).join('')}</g>
<path d="${poly(wall)} Z" fill="none" stroke="#a13f2c" stroke-width="${Math.max(1.6, 0.2 * k).toFixed(1)}" stroke-linejoin="round"/>
${marks.map((m) => {
    const c = px(m.p);
    const key = ['zifeng', 'xuanwu', 'zhonghuamen', 'zhongshanling', 'mingxiaoling', 'citywall', 'nanjingeye', 'yangtzebridge'].includes(m.id);
    return `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${key ? 4 : 2.4}" fill="${key ? '#c0452f' : '#2f6fd6'}"/>`
      + (key ? `<text x="${(c[0] + 7).toFixed(1)}" y="${(c[1] + 4).toFixed(1)}" font-size="12" fill="#1e2733" font-family="sans-serif">${m.name}</text>` : '');
  }).join('\n')}
<text x="${pad}" y="${H - 14}" font-size="13" fill="#1e2733" font-family="sans-serif">
  城墙周长 ${wallKm} km · 建筑 ${buildings.length} 栋 · 地标 ${marks.length} 处 · 1 px ≈ ${(100 / k).toFixed(0)} m（横轴东向为右、纵轴南向为下）
</text>
</svg>`;

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>GTA-NJ 平面图 · 几何真值核对</title>
<style>
  body{margin:0;background:#f4f6f8;font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#1e2733}
  .wrap{padding:18px 22px}
  h1{font-size:15px;margin:0 0 4px}
  p{margin:0 0 12px;font-size:12px;color:#64707f;line-height:1.7}
  .legend{display:flex;gap:18px;font-size:12px;margin:10px 0}
  .legend i{display:inline-block;width:12px;height:12px;margin-right:5px;vertical-align:-1px}
  svg{border:1px solid rgba(20,30,45,.12);border-radius:10px;background:#fff}
</style></head><body><div class="wrap">
<h1>南京 3D 场景 · 平面图（由当前 data.js 直接绘制，非 3D 渲染）</h1>
<p>这张图不经过相机与着色，纯粹是落位数据的正交投影：用于核对「城墙是否切入玄武湖」「城墙沿线是否留出建筑净空」。</p>
<div class="legend">
  <span><i style="background:#a13f2c"></i>明城墙（${wallKm} km）</span>
  <span><i style="background:#7fb6d6"></i>湖泊</span>
  <span><i style="background:#5c9bc0"></i>长江 / 夹江</span>
  <span><i style="background:rgba(70,78,88,.55)"></i>程序化建筑 footprint（${buildings.length})</span>
  <span><i style="background:#c0452f"></i>关键地标</span>
</div>
${svg}
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`平面图已生成: ${OUT}`);
console.log(`城墙周长 ${wallKm} km · 建筑 ${buildings.length} 栋`);
