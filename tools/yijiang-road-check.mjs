// Yijiang-only regression: a continuous asphalt apron with no raised bore obstructions.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CITY_GATES } from '../js/data.js';
import { gateMaterials } from '../js/gate-model.js';
import { buildGateModel, gatePortals } from '../js/gates.js';

const gt = CITY_GATES.find(g => g.name === '挹江门'), shared = gateMaterials();
const pavingColor = shared.paving.color.getHex(), pavingRoughness = shared.paving.roughness;
const raw = buildGateModel(gt, { merge: false, materials: shared });
const merged = buildGateModel(gt, { materials: shared });
const road = raw.getObjectByName('yijiang:continuous-road');
assert.ok(road, 'Yijiang has one named continuous road surface');
raw.updateMatrixWorld(true);
assert.notEqual(road.material, shared.paving, 'asphalt does not mutate shared gate paving');
assert.equal(shared.paving.color.getHex(), pavingColor);
assert.equal(shared.paving.roughness, pavingRoughness);
const bounds = new THREE.Box3().setFromObject(road);
assert.ok((bounds.max.x - bounds.min.x) * 30 <= gt.widthM + 1e-5, 'road remains within gate width');
assert.ok(Math.abs(bounds.min.z * 30 + gt.depthM / 2 + 5) < 1e-5 && Math.abs(bounds.max.z * 30 - gt.depthM / 2 - 5) < 1e-5,
  'approach depth stays inside the previous preview bounds');
assert.ok(Math.abs(bounds.max.y * 30 - .07) < 1e-6 && Math.abs(bounds.min.y - bounds.max.y) < 1e-7,
  'asphalt is a thin surface at 7 cm, not three raised blocks');

const ray = new THREE.Raycaster(), portals = gatePortals(gt);
for (const model of [raw, merged]) {
  model.updateMatrixWorld(true);
  const asphalt = [];
  model.traverse(o => { if (o.isMesh && o.material.name === 'yijiang-asphalt') asphalt.push(o); });
  assert.equal(asphalt.length, 1, 'batching keeps the asphalt as one surface');
  for (const z of [-gt.depthM / 2 - 2, gt.depthM / 2 + 2]) {
    for (const x of [portals[0].x, (portals[0].x + portals[1].x) / 2, portals[1].x,
      (portals[1].x + portals[2].x) / 2, portals[2].x]) {
      ray.set(new THREE.Vector3(x / 30, .1, z / 30), new THREE.Vector3(0, -1, 0));
      ray.near = 0; ray.far = .2;
      const hits = ray.intersectObjects(asphalt);
      assert.ok(hits.length && Math.abs(hits[0].point.y - .0023333) < 1e-7, 'apron stays connected between all three openings');
    }
  }
  for (const p of portals) {
    ray.set(new THREE.Vector3(p.x / 30, .06, (gt.depthM / 2 + 1) / 30), new THREE.Vector3(0, 0, -1));
    ray.near = 0; ray.far = (gt.depthM + 2) / 30;
    assert.equal(ray.intersectObject(model, true).length, 0, 'all three pedestrian-height bore paths remain clear');
  }
  for (const night of [0, 1, 0]) {
    model.userData.setNight(night);
    assert.equal(asphalt[0].material.color.getHex(), 0x4b4f55, 'day/night does not recolor asphalt');
    assert.equal(asphalt[0].material.emissiveIntensity, 0, 'road remains normally lit at night');
  }
}
for (const gate of CITY_GATES.filter(g => g.name !== '中华门' && g.name !== '挹江门')) {
  const model = buildGateModel(gate, { merge: false, materials: shared });
  assert.equal(model.getObjectByName('yijiang:continuous-road'), undefined, `${gate.name}: no Yijiang paving applied`);
}
assert.equal(shared.paving.color.getHex(), pavingColor, 'all other gates retain their original paving color');
console.log('Yijiang road OK: continuous 43 × 28 m asphalt, unchanged preview extent, three clear bores, merge and material isolation.');
