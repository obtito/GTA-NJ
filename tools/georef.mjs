// tools/georef.mjs — 地标坐标的权威参照表与对表工具
//
// 场景几何是否 1:1（tools/geocheck.mjs）与「数据源本身对不对」是两件事：
// 投影再准，data.js 里的经纬度写错了，地标照样落在错误的位置。
// 本文件把每个地标的权威坐标固化成表——逐条注明**来源**与**取点口径**，
// 因为区域类地标（陵寝、湖泊、街区）本就没有唯一的"坐标"，
// 必须说清取的是哪一点，否则"偏差多少"无从谈起。
//
// 来源：zh.wikipedia 条目信息框坐标 / OpenStreetMap Nominatim（2026-10 核对）
// 用法: node tools/georef.mjs

import { LANDMARKS } from '../js/data.js';

/** id -> { lon, lat, src, ref }  ref = 该坐标取的是哪个点 */
export const GEO_REF = {
  zifeng:        { lon: 118.77806,    lat: 32.062472,  src: 'OSM 紫峰大厦 + zhwiki', ref: '主楼' },
  xinjiekou:     { lon: 118.7789021,  lat: 32.0435852, src: 'OSM 新街口',            ref: '中山路 × 中山东路路口' },
  xuanwu:        { lon: 118.798206,   lat: 32.073022,  src: 'zhwiki 玄武湖',          ref: '湖面中心' },
  zijinshan:     { lon: 118.8371947,  lat: 32.0726364, src: 'OSM 头陀岭',             ref: '主峰头陀岭' },
  zhongshanling: { lon: 118.8482694,  lat: 32.0644167, src: 'zhwiki 中山陵',          ref: '祭堂' },
  mingxiaoling:  { lon: 118.834568,   lat: 32.060305,  src: 'zhwiki 明孝陵',          ref: '陵宫·方城明楼' },
  confucius:     { lon: 118.7827931,  lat: 32.0204106, src: 'OSM 夫子庙 way 590937998', ref: '夫子庙景区质心' },
  zhonghuamen:   { lon: 118.776442,   lat: 32.014164,  src: 'zhwiki 中华门',          ref: '瓮城城台' },
  yangtzebridge: { lon: 118.73972,    lat: 32.11528,   src: 'zhwiki + OSM 双源一致',  ref: '正桥中点' },
  nanjingeye:    { lon: 118.6968727,  lat: 31.9983110, src: 'OSM 南京眼步行桥',       ref: '主桥' },
  olympic:       { lon: 118.7197,     lat: 32.0106417, src: 'zhwiki 南京奥体中心',    ref: '主体育场' },
  southstation:  { lon: 118.7931417,  lat: 31.9707167, src: 'zhwiki + OSM 双源一致',  ref: '站房中心' },
  yuejianglou:   { lon: 118.7411583,  lat: 32.0962889, src: 'zhwiki 阅江楼',          ref: '楼' },
  presidential:  { lon: 118.79222,    lat: 32.04472,   src: 'zhwiki 近代史遗址博物馆', ref: '门楼' },
  museum:        { lon: 118.8201722,  lat: 32.0415,    src: 'zhwiki 南京博物院',      ref: '历史馆（中山东路南侧院内）' },
  yuhuatai:      { lon: 118.7754,     lat: 31.9990,    src: 'zhwiki 雨花台',          ref: '烈士纪念碑' },
  jimingsi:      { lon: 118.79000,    lat: 32.06306,   src: 'zhwiki 鸡鸣寺',          ref: '寺' },
  qixiasi:       { lon: 118.95417,    lat: 32.15417,   src: 'zhwiki 栖霞寺',          ref: '寺' },
  laomendong:    { lon: 118.7822575,  lat: 32.0134640, src: 'OSM 老门东',             ref: '街区' },
  // 以下三项为示意性/组群类，无唯一权威点，保留 data.js 原值
  // citywall 城垣周长 25 km；hexi 商圈沿江东中路展开；xianlin 大学城组团
};

/* ---------- 两点球面大地距离（此处只需米级，用 haversine 足够） ---------- */
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function geoDist(lon1, lat1, lon2, lat2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

{
  const rows = [];
  for (const lm of LANDMARKS) {
    const r = GEO_REF[lm.id];
    if (!r) { rows.push({ id: lm.id, name: lm.name, d: null }); continue; }
    rows.push({ id: lm.id, name: lm.name, d: geoDist(lm.lon, lm.lat, r.lon, r.lat), ref: r.ref, src: r.src });
  }
  rows.sort((a, b) => (b.d ?? -1) - (a.d ?? -1));

  console.log('=== data.js 地标坐标 vs 权威参照 ===\n');
  console.log('  地标            偏差      取点口径                 来源');
  for (const r of rows) {
    if (r.d === null) { console.log(`  ${r.id.padEnd(14)} （示意/组群，未设参照点）`); continue; }
    const flag = r.d <= 30 ? 'OK  ' : r.d <= 200 ? '近似' : '偏差';
    console.log(
      `  ${r.name.padEnd(12)} ${(r.d >= 1000 ? (r.d / 1000).toFixed(2) + ' km' : r.d.toFixed(0) + ' m').padStart(8)}`
      + `  ${flag} ${r.ref.padEnd(18)} ${r.src}`,
    );
  }
  const fixed = rows.filter((r) => r.d !== null);
  const worst = Math.max(...fixed.map((r) => r.d));
  console.log(`\n已核 ${fixed.length} 项 · 最大偏差 ${worst >= 1000 ? (worst / 1000).toFixed(2) + ' km' : worst.toFixed(0) + ' m'}`);
}
