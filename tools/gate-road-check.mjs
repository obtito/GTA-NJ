// Integration regression: roads must pass through the openings, not the masonry above them.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CITY_GATES } from '../js/data.js';
import { buildRoads, terrainHeight, ROAD_Y } from '../js/world.js';
import { gateRoadLines, gatePortals } from '../js/gates.js';
import { gateFrame } from '../js/wall-layout.js';

const gateLines = gateRoadLines();
assert.ok(gateLines.every(l => l.gate), 'gate road routes identify their masonry opening');
const gt = CITY_GATES.find(g => g.name === '中山门'), frame = gateFrame(gt);
const point = distance => [frame.x + frame.normal[0] * distance, frame.z + frame.normal[1] * distance];
const adversarial = { name: 'wide-crossing-regression', w: 1, pts: [point(-4), point(4)] };
const hanzhong = CITY_GATES.find(g => g.name === '汉中门'), hf = gateFrame(hanzhong);
// 门体等比 1:30 后保护院落同步放大,横越线的跨度/内移量随体量 ×3.33(100/30),检验意图不变
const HK = 100 / 30;
const heritagePoint = u => [hf.x + hf.localX[0] * u * HK - hf.normal[0] * .65 * HK, hf.z + hf.localX[1] * u * HK - hf.normal[1] * .65 * HK];
const heritageCrossing = { name: 'heritage-site-regression', w: .08, pts: [heritagePoint(-1), heritagePoint(1)] };
const roads = buildRoads([...gateLines, adversarial, heritageCrossing]); roads.mesh.updateMatrixWorld(true);
const down = new THREE.Raycaster(), up = new THREE.Vector3(0, -1, 0);
let checked = 0;
for (const gate of CITY_GATES.filter(g => g.road && g.kind !== 'ruin')) {
  const f = gateFrame(gate), floor = Math.max(-0.05, terrainHeight(f.x, f.z) - 0.05);
  for (const portal of gatePortals(gate).filter(p => p.traffic !== false)) {
    const x = f.x + f.localX[0] * f.zOut * portal.x / 30;
    const z = f.z + f.localX[1] * f.zOut * portal.x / 30;
    down.set(new THREE.Vector3(x, floor + 2, z), up);
    const hits = down.intersectObject(roads.mesh);
    assert.ok(hits.length, `${gate.name}: road rendered beneath bore`);
    for (const hit of hits) assert.ok(Math.abs(hit.point.y - floor - .003) < 2e-6, `${gate.name}: no floating road slab crosses gate`);
    const ceiling = floor + (portal.spring + portal.rise) / 30;
    assert.ok(ceiling - hits[0].point.y > .1333, `${gate.name}: actual rendered road has usable clearance`);
    checked++;
  }
}

const clipped = roads.centerlines.filter(l => l.name === adversarial.name);
assert.equal(clipped.length, 2, 'a wide through-road is split around the gate');
const protectedHalfDepth = gt.depthM / 60 + adversarial.w / 2 + .02;
for (const line of clipped) {
  for (let i = 0; i <= 30; i++) {
    const t = i / 30, a = line.pts[0], b = line.pts[line.pts.length - 1];
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    const along = (x - frame.x) * frame.normal[0] + (z - frame.z) * frame.normal[1];
    assert.ok(Math.abs(along) >= protectedHalfDepth - 1e-7, 'entire broad road remains outside the protected gate volume');
  }
}
const near = roads.surfaceAt(frame.x, frame.z), distant = roads.surfaceAt(...point(4));
assert.ok(Math.abs(near + .047) < 1e-8, 'gate approach uses the gate floor');
assert.equal(distant, ROAD_Y, 'approach reconnects to the existing city road elevation');
const heritagePieces = roads.centerlines.filter(l => l.name === heritageCrossing.name);
assert.equal(heritagePieces.length, 2, 'scenic gate protects the full inner site, not just the main platform');
for (const line of heritagePieces) for (const p of line.pts) {
  const u = (p[0] - hf.x) * hf.localX[0] + (p[1] - hf.z) * hf.localX[1];
  assert.ok(Math.abs(u) >= hanzhong.siteWidthM / 60 + heritageCrossing.w / 2 + .02 - 1e-7,
    'road remains outside the wider Hanzhong courtyard');
}
// 路面已按顶点数分块为 Group(SwiftShader 大索引网格漏画修法),三角形数遍历子网格求和
const baseRoads = buildRoads(), triangleCount = r => {
  let n = 0;
  r.mesh.traverse(o => { if (o.isMesh && o.geometry?.index) n += o.geometry.index.count / 3; });
  return n;
};
const remoteRoads = buildRoads([{ name: 'remote-10km', w: .3, pts: [[800, 800], [900, 800]] }]);
assert.equal(triangleCount(remoteRoads) - triangleCount(baseRoads), 2, 'a remote 10 km road remains one quad');
const longCrossing = buildRoads([{ name: 'cross-city-10km', w: .06, pts: [point(-50), point(50)] }]);
// 只测穿门路自身的细分增量:全网格差值会被「路口虚线跳过」的主干减面淹没成负数
const extraTriangles = longCrossing.extraLineTris - remoteRoads.extraLineTris;
assert.ok(extraTriangles > 4 && extraTriangles < 500,
  'a long road crossing a gate subdivides only its short approach intervals');
console.log(`Gate road integration OK: ${checked} actual bore surfaces; broad-road and heritage-site clipping; approach elevations; 10 km local subdivision (${extraTriangles} added triangles).`);
