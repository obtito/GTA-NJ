// Independent visibility/solid-volume regression for the present-day Zhonghua Gate.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildZhonghuamen, ZHONGHUAMEN } from '../js/zhonghuamen.js';
import { mergeStaticMeshes } from '../js/lib.js';

const model = buildZhonghuamen();
model.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(model);
assert.ok(Math.abs(bounds.max.y * 30 - 20.45) < 0.001, 'top remains 20.45m');
assert.ok(Math.abs(bounds.min.y) < 0.000001, 'base is on ground');
assert.ok(Math.abs((bounds.max.x - bounds.min.x) * 30 - 118.5) < 0.01, '118.5m width');
assert.ok(Math.abs(bounds.min.z * 30 + 128) < 0.01, '128m inward depth');
assert.deepEqual(model.scale.toArray(), [1 / 30, 1 / 30, 1 / 30], 'uniform horizontal/vertical scale');
assert.equal(model.userData.chambers.length, 27);
const distribution = {};
for (const c of model.userData.chambers) distribution[c.tier] = (distribution[c.tier] || 0) + 1;
assert.deepEqual(distribution, { 'main-lower': 6, 'main-upper': 7, 'west-ramp': 7, 'east-ramp': 7 });

function hit(originM, direction, distanceM = 160) {
  model.updateMatrixWorld(true);
  const origin = new THREE.Vector3(...originM).multiplyScalar(1 / 30);
  const ray = new THREE.Raycaster(origin, new THREE.Vector3(...direction), 0, distanceM / 30);
  return ray.intersectObject(model, true)[0];
}
function verifyVoids() {
  // Rays must pass all four doors, not merely disappear into a painted black inset.
  for (const height of [1.1, 5.2, 8.35]) {
    assert.equal(hit([0, height, 1], [0, 0, -1]), undefined, `four clear passages at ${height}m`);
  }
  assert.ok(hit([4, 1, 1], [0, 0, -1]), 'front piers are solid');
  assert.ok(hit([2.4, 8.35, 1], [0, 0, -1]), 'arch shoulder is stone, not a rectangular cutout');
  const ceiling = hit([0, 1, -25], [0, 1, 0]);
  assert.ok(ceiling && Math.abs(ceiling.point.y * 30 - 8.7) < 0.03, 'vault has a real curved soffit');
  // All three courtyards are open to the sky and reach the thin ground paving.
  for (const z of [-64, -87, -113]) {
    const floor = hit([10, 25, z], [0, -1, 0]);
    assert.ok(floor && floor.point.y * 30 < 0.06, `open courtyard at z=${z}`);
  }
  // Every cave opens inward and ends in masonry; none is a facade rectangle or outward breach.
  for (const chamber of model.userData.chambers) {
    const origin = chamber.entrance.map((v, i) => v - chamber.direction[i] * 0.3);
    origin[1] += 1.2;
    const end = hit(origin, chamber.direction, 70);
    assert.ok(end && end.distance * 30 > 3.5, `${chamber.tier} has usable depth`);
    assert.ok(end.distance * 30 < 54, `${chamber.tier} is a blind chamber`);
  }
  // The large upper platform must be solid away from its vaulted chambers.
  const pier = hit([4.2, 25, -20], [0, -1, 0]);
  assert.ok(pier && Math.abs(pier.point.y * 30 - ZHONGHUAMEN.upperDeckM) < 0.02, 'solid upper deck');
}
verifyVoids();
let meshes = 0, triangles = 0;
model.traverse(o => {
  if (!o.isMesh) return;
  meshes++;
  triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3;
  for (const v of o.geometry.attributes.position.array) assert.ok(Number.isFinite(v), 'finite vertices');
});
assert.ok(triangles < 90000, 'bounded detail budget');
const wrapper = new THREE.Group(); wrapper.add(model);
mergeStaticMeshes(wrapper, new Set());
// Merging moves meshes onto wrapper; verify unchanged main-axis visibility there too.
wrapper.updateMatrixWorld(true);
const ray = new THREE.Raycaster(new THREE.Vector3(0, .1667, .0333), new THREE.Vector3(0, 0, -1), 0, 4.667);
assert.equal(ray.intersectObject(wrapper, true).length, 0, 'static batching preserves passage holes');
console.log(`中华门通过：118.5×128m，20.45m总高，四券门轴线贯通、三露天院、27真拱藏兵洞、等比/实体/合批；${meshes} meshes，${triangles} triangles。`);
