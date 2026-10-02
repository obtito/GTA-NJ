// 城墙段与城门的对接自检：node tools/wallcheck.mjs
// 墙段端头应当正好落在相应城门的城台沿墙半长上（差 40cm 是故意埋进城台的）。
import { toV2 } from '../js/geo.js';
import { CITY_GATES, gateHalfLenM } from '../js/data.js';
import { buildWall } from '../js/world.js';

const w = buildWall();
const gates = CITY_GATES.map((gt) => ({
  name: gt.name, kind: gt.kind,
  x: toV2(gt.lon, gt.lat)[0], z: toV2(gt.lon, gt.lat)[1],
  h: gateHalfLenM(gt) / 30,
}));

let bad = 0, checked = 0;
for (const { a, b } of w.ends) {
  for (const [p, tag] of [[a, 'A'], [b, 'B']]) {
    let best = null, bd = Infinity;
    for (const g of gates) {
      const d = Math.hypot(p[0] - g.x, p[1] - g.z);
      if (d < bd) { bd = d; best = g; }
    }
    if (!best || bd > 4.5) continue;             // 搜索半径须盖过中华门半宽 1.975u（1:30）
    const want = best.h + 0.4 / 30;              // 城台半长 + 埋入的 40cm（门体 1:30）
    const err = (bd - want) * 30;                // 按门体 1:30 口径换算成米
    checked++;
    const ok = Math.abs(err) < 6;
    if (!ok) bad++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${tag} 端 ${(bd * 30).toFixed(1)}m  vs ${best.name}(${best.kind}) 半长${(best.h * 30).toFixed(1)}m 误差${err.toFixed(1)}cm`);
  }
}
console.log(`\n城门对接：检查 ${checked} 个墙端，异常 ${bad} 个`);
console.log(`墙段数 ${w.ends.length} · 环线点数 ${w.polygon.length}`);
process.exit(bad ? 1 : 0);
