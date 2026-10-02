import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CITY_GATES } from '../js/data.js';
import { buildGateModel, buildGates, gatePortals, gateRoadLines } from '../js/gates.js';
import { gateFrame } from '../js/wall-layout.js';
import { terrainHeight } from '../js/world.js';

const expected = { '中山门': 3, '太平门': 3, '解放门': 1, '玄武门': 3, '神策门': 1, '仪凤门': 3, '挹江门': 3, '清凉门': 1 };
const ray = new THREE.Raycaster(), direction = new THREE.Vector3(0, 0, -1);
const trace = (g, x, y, depth) => {
  g.updateMatrixWorld(true);
  ray.set(new THREE.Vector3(x / 30, y / 30, (depth / 2 + 1) / 30), direction);
  ray.near = 0; ray.far = (depth + 2) / 30;
  return ray.intersectObject(g, true);
};
let meshTotal = 0;
for (const gt of CITY_GATES.filter(g => g.name !== '中华门')) {
  const raw = buildGateModel(gt, { merge: false }), batch = buildGateModel(gt);
  const a = new THREE.Box3().setFromObject(raw), b = new THREE.Box3().setFromObject(batch);
  assert(a.min.distanceTo(b.min) < 1e-5 && a.max.distanceTo(b.max) < 1e-5, `${gt.name}: batching changed bounds`);
  assert.equal(raw.scale.x, 1 / 30); assert.equal(raw.scale.y, 1 / 30); assert.equal(raw.scale.z, 1 / 30);
  if (expected[gt.name]) assert.equal(gatePortals(gt).length, expected[gt.name]);
  if (gt.kind !== 'ruin' || gt.profile === 'hanzhong') {
    const loop = raw.getObjectByName('cap-perimeter-led-strip');
    assert.equal(loop?.userData.closedLightStrip, true, `${gt.name}: platform light wraps all four sides`);
    const bounds = new THREE.Box3().setFromObject(loop);
    assert.ok(bounds.min.x < -gt.widthM / 60 && bounds.max.x > gt.widthM / 60,
      `${gt.name}: left and right coping illuminated`);
    assert.ok(bounds.min.z < -gt.depthM / 60 && bounds.max.z > gt.depthM / 60,
      `${gt.name}: front and rear coping illuminated`);
  }
  for (const group of [raw, batch]) {
    group.traverse(o => {
      if (!o.isMesh) return;
      if (group === batch) meshTotal++;
      assert(o.geometry.attributes.position.array.every(Number.isFinite), `${gt.name}: invalid vertex`);
    });
    if (gt.kind !== 'ruin' || gt.profile === 'hanzhong') {
      const portals = gatePortals(gt);
      for (const p of portals) {
        for (const y of [1.8, p.spring, p.spring + p.rise - .2])
          assert.equal(trace(group, p.x, y, gt.depthM).length, 0, `${gt.name}: blocked bore at ${p.x},${y}`);
        assert(trace(group, p.x, p.spring + p.rise + .8, gt.depthM).length > 0, `${gt.name}: missing spandrel`);
      }
      for (let i = 1; i < portals.length; i++) {
        const x = ((portals[i - 1].x + portals[i - 1].width / 2) + (portals[i].x - portals[i].width / 2)) / 2;
        assert(trace(group, x, 2, gt.depthM).length > 0, `${gt.name}: missing inter-bore pier`);
      }
    }
    group.userData.setNight(1); group.userData.setNight(0);
  }
}
const hanzhong = buildGateModel(CITY_GATES.find(g => g.name === '汉中门'));
hanzhong.updateMatrixWorld(true);
ray.set(new THREE.Vector3(0, .06, -2.8333), direction); ray.near = 0; ray.far = .5;
assert.equal(ray.intersectObject(hanzhong, true).length, 0, 'Hanzhong second vault must remain open');
for (const x of [-1.8, 1.767]) {
  ray.set(new THREE.Vector3(x, .0667, -1.4), direction); ray.near = 0; ray.far = .6;
  const count = ray.intersectObject(hanzhong, true).length;
  assert(x < 0 ? count === 0 : count > 0, 'Hanzhong must preserve its incomplete asymmetric enclosure');
}
const ensemble = buildGates(), roads = gateRoadLines();
assert.equal(ensemble.models.length, CITY_GATES.length - 1);
for (const gt of CITY_GATES.filter(g => g.name !== '中华门')) {
  const model = ensemble.models.find(g => g.userData.gateName === gt.name), frame = gateFrame(gt);
  assert(Math.abs(model.position.y - Math.max(-.05, terrainHeight(frame.x, frame.z) - .05)) < 1e-8);
  const gateRoads = roads.filter(r => r.name === gt.name);
  if (!gt.road) assert.equal(gateRoads.length, 0, `${gt.name}: traffic in pedestrian heritage site`);
  else if (gt.kind !== 'ruin') {
    const portals = gatePortals(gt).filter(p => p.traffic !== false);
    assert.equal(portals.length, gateRoads.length);
    model.updateMatrixWorld(true);
    for (let i = 0; i < portals.length; i++) {
      const p = portals[i], center = new THREE.Vector3(p.x, 0, 0).applyMatrix4(model.matrixWorld);
      assert(Math.hypot(center.x - gateRoads[i].pts[1][0], center.z - gateRoads[i].pts[1][1]) < 1e-7);
      assert(gateRoads[i].w < p.width / 30, `${gt.name}: road is wider than bore`);
    }
  }
}
console.log(`Gate checks passed: ${ensemble.models.length} models, true vault clearance before/after batching, solid piers, road alignment, ${meshTotal} batched meshes.`);
