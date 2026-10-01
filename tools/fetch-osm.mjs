// 从 OpenStreetMap（Overpass API）抓取各地标周边的真实建筑轮廓，落到 tools/osm/<id>.json。
// 目的：地标不再用「手估的矩形」，而是按真实 footprint 建体量。
//
// 受限于沙箱不能 spawn 子进程，这里用 Node 内置 fetch（Node 18+）。
// OSM 数据遵循 ODbL，使用时需署名 OpenStreetMap contributors。
//
// 用法：node tools/fetch-osm.mjs [id ...]        # 不传 id 则抓全部

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tools', 'osm');
mkdirSync(outDir, { recursive: true });

const { LANDMARKS } = await import('../js/data.js');

// 每个地标要抓多大范围（m）。组群类给大一点，单体建筑给小一点。
const RADIUS = {
  zifeng: 220, xinjiekou: 320, xuanwu: 200, zijinshan: 300,
  zhongshanling: 320, mingxiaoling: 320, confucius: 260, zhonghuamen: 260,
  citywall: 260, yangtzebridge: 400, nanjingeye: 260, olympic: 420,
  southstation: 360, yuejianglou: 300, presidential: 240, museum: 300,
  yuhuatai: 300, jimingsi: 200, qixiasi: 300, laomendong: 300,
  hexi: 420, xianlin: 500,
};

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(q, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ep = ENDPOINTS[i % ENDPOINTS.length];
    try {
      const res = await fetch(ep + '?data=' + encodeURIComponent(q), {
        headers: { 'User-Agent': 'GTA-NJ/1.0 (OSM footprint fetch for educational city model)' },
        signal: AbortSignal.timeout(60000),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${txt.slice(0, 120)}`);
      const json = JSON.parse(txt);
      return json;
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

/** 球面多边形面积（m²），用于按体量排序找出主体 */
function polyArea(pts) {
  // 先搬到局部平面：经度按南京纬度缩放
  const k = Math.cos((32.05 * Math.PI) / 180);
  const xy = pts.map((p) => [p.lon * k * 111320, p.lat * 110540]);
  let a = 0;
  for (let i = 0, n = xy.length; i < n; i++) {
    const j = (i + 1) % n;
    a += xy[i][0] * xy[j][1] - xy[j][0] * xy[i][1];
  }
  return Math.abs(a / 2);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const list = only.length ? LANDMARKS.filter((l) => only.includes(l.id)) : LANDMARKS;

for (const lm of list) {
  const r = RADIUS[lm.id] ?? 250;
  const q = `[out:json][timeout:60];(
  way["building"](around:${r},${lm.lat},${lm.lon});
  way["building:part"](around:${r},${lm.lat},${lm.lon});
  relation["building"](around:${r},${lm.lat},${lm.lon});
);out tags geom;`;
  let json;
  try {
    json = await query(q);
  } catch (e) {
    console.log(`✗ ${lm.id.padEnd(14)} 抓取失败：${e.message}`);
    continue;
  }
  const ways = (json.elements || [])
    .filter((e) => e.type === 'way' && e.geometry && e.geometry.length > 2)
    .map((e) => {
      // 闭合环去重：OSM 的 way 首尾节点相同
      const pts = e.geometry.slice();
      if (pts.length > 1) {
        const a = pts[0], b = pts[pts.length - 1];
        if (Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9) pts.pop();
      }
      const t = e.tags || {};
      return {
        osmId: e.id,
        name: t.name || t['name:zh'] || t['alt_name'] || '',
        area: Math.round(polyArea(pts)),
        levels: t['building:levels'] ? Number(t['building:levels']) : null,
        height: t.height ? parseFloat(String(t.height).replace(/[^\d.]/g, '')) : null,
        minHeight: t['min_height'] ? parseFloat(String(t['min_height']).replace(/[^\d.]/g, '')) : null,
        kind: t.building || t['building:part'] || '',
        pts: pts.map((p) => [Number(p.lon.toFixed(7)), Number(p.lat.toFixed(7))]),
      };
    })
    .sort((a, b) => b.area - a.area);

  writeFileSync(join(outDir, lm.id + '.json'), JSON.stringify({
    id: lm.id, name: lm.name, center: [lm.lon, lm.lat], radius: r,
    fetched: new Date().toISOString(), ways,
  }, null, 1));

  const named = ways.filter((w) => w.name);
  console.log(
    `✓ ${lm.id.padEnd(14)} ${String(ways.length).padStart(3)} 个轮廓 / ${named.length} 个带名字 · 最大 ${Math.round(ways[0]?.area || 0)} m²` +
    (named[0] ? `  「${named[0].name}」` : ''),
  );
  await sleep(1200);   // 别把公共 Overpass 实例打爆
}

console.log('\n原始轮廓已写入 tools/osm/。下一步：挑出各地标的主休 folksman_polygon 并 bake 成 js/footprints.js');
