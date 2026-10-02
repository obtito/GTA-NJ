// Behavioural checks for local warm illumination, independent of WebGL rendering.
// Run: node tools/architectural-lighting-check.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createArchitecturalLighting, createArchitecturalLightPool } from '../js/architectural-lighting.js';
import { buildGates, buildGateModel } from '../js/gates.js';
import { CITY_GATES } from '../js/data.js';
import { buildWall } from '../js/world.js';
import { buildZhonghuamen } from '../js/zhonghuamen.js';
import { mergeStaticMeshes } from '../js/lib.js';

const failures = [];
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`); }
}
const active = pool => pool.lights.filter(light => light.intensity > 0);
const near = (actual, expected, label, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${label}: ${actual} vs ${expected}`);
const vectorNear = (actual, expected, label) => actual.toArray().forEach((n, i) => near(n, expected[i], `${label}[${i}]`));
function materials(root) {
  const result = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) result.add(material);
  });
  return [...result];
}
function snapshotNonEmitters(root) {
  return materials(root).filter(m => m.emissive && !m.userData.architecturalEmitter)
    .map(m => ({ material: m, emission: m.emissive.toArray(), intensity: m.emissiveIntensity }));
}
function unchangedMasonry(snapshot, label) {
  assert.ok(snapshot.length > 0, `${label}: inspected real surface materials`);
  for (const { material, emission, intensity } of snapshot) {
    assert.deepEqual(material.emissive.toArray(), emission, `${label}: surface emission color changed`);
    assert.equal(material.emissiveIntensity, intensity, `${label}: surface emission intensity changed`);
    assert.equal(material.emissive.getHex(), 0, `${label}: non-lamp surface emits its own light`);
  }
}

// A known fixture 10/20/30 metres from the origin, rotated 90 degrees and moved
// through two parents. Expected world coordinates are calculated explicitly.
const scene = new THREE.Scene(), carrier = new THREE.Group(), owner = new THREE.Group();
carrier.position.set(7, -2, 1); scene.add(carrier);
owner.position.set(2, 3, 4); owner.rotation.y = Math.PI / 2; owner.scale.setScalar(.01); carrier.add(owner);
const fixture = createArchitecturalLighting(owner);
fixture.strip([[9.5, 20, 30], [10.5, 20, 30]], { width: .08 });
fixture.spot({ position: [10, 20, 30], target: [10, 10, 30], range: 20, power: 100 });
const pool = createArchitecturalLightPool(scene), camera = new THREE.PerspectiveCamera();
camera.position.set(9.3, 1.2, 5.5); pool.setRoots([carrier]);

check('perimeter diffuser is closed at all four corners without a duplicated open seam', () => {
  const f = createArchitecturalLighting(new THREE.Group());
  const mesh = f.strip([[-10, 5, 4], [10, 5, 4], [10, 5, -4], [-10, 5, -4], [-10, 5, 4]]);
  assert.equal(mesh.userData.closedLightStrip, true);
  const edges = new Map(), index = mesh.geometry.index.array;
  for (let i = 0; i < index.length; i += 3) for (const [a, b] of [[index[i], index[i + 1]], [index[i + 1], index[i + 2]], [index[i + 2], index[i]]]) {
    const edge = a < b ? `${a}:${b}` : `${b}:${a}`;
    edges.set(edge, (edges.get(edge) || 0) + 1);
  }
  assert.ok([...edges.values()].every(count => count === 2), 'every edge is shared by two faces, including the closing corner');
  const bounds = new THREE.Box3().setFromObject(mesh);
  assert.ok(bounds.min.x < -10 && bounds.max.x > 10 && bounds.min.z < -4 && bounds.max.z > 4,
    'diffuser actually wraps front, rear and both sides');
});

check('default pool creates eight real warm SpotLights and attached targets', () => {
  assert.equal(pool.lights.length, 8);
  let count = 0; scene.traverse(o => { if (o.isLight) count++; });
  assert.equal(count, 8, 'fixture candidates must not each allocate a real light');
  for (const light of pool.lights) {
    assert.ok(light.isSpotLight && light.parent, 'live SpotLight attached to scene');
    assert.equal(light.target.parent, light.parent, 'target updates in the same scene graph');
    assert.ok(light.color.r > light.color.g && light.color.g > light.color.b, 'warm light color');
    assert.equal(light.decay, 2, 'physical inverse-square attenuation');
  }
});
check('configuration cannot exceed the hard eight-light budget', () => {
  for (const limit of [9, 100, Infinity, NaN]) {
    const bounded = createArchitecturalLightPool(new THREE.Scene(), { limit });
    assert.equal(bounded.lights.length, 8, `bounded limit ${limit}`);
  }
  assert.equal(createArchitecturalLightPool(new THREE.Scene(), { limit: 0 }).lights.length, 0);
});
check('a camera under a translated parent selects lights at its world location', () => {
  const s = new THREE.Scene(), building = new THREE.Group(), cameraCarrier = new THREE.Group();
  building.position.x = 100; cameraCarrier.position.x = 100;
  s.add(building, cameraCarrier);
  const c = new THREE.PerspectiveCamera(); c.position.set(0, .1, .3); cameraCarrier.add(c);
  const f = createArchitecturalLighting(building);
  f.spot({ position: [0, .1, 0], target: [0, 0, 0], range: 20 }); f.setNight(1);
  const p = createArchitecturalLightPool(s); p.setRoots([building]); p.update(c);
  assert.equal(active(p).length, 1, 'camera parent translation must not cull its nearby lamp');
  cameraCarrier.position.x = -100; p.update(c); assert.equal(active(p).length, 0);
});
check('explicit facade normals prefer the visible side of a rotated battered wall', () => {
  const s = new THREE.Scene(), building = new THREE.Group();
  building.rotation.y = Math.PI / 2; building.scale.setScalar(.01); s.add(building);
  const f = createArchitecturalLighting(building);
  // On a battered wall the lower aim point can lie farther outward than the
  // lamp. A lamp-to-aim vector alone would mistakenly prefer the hidden facade.
  f.spot({ position: [0, 2, 1], target: [0, 0, 2], normal: [0, 0, 1] });
  f.spot({ position: [0, 2, -1], target: [0, 0, -2], normal: [0, 0, -1] });
  f.setNight(1);
  const c = new THREE.PerspectiveCamera(); c.position.set(1, .02, 0);
  const p = createArchitecturalLightPool(s, { limit: 1 }); p.setRoots([building]); p.update(c);
  assert.equal(active(p).length, 1);
  assert.ok(active(p)[0].position.x > 0, 'light is on the visible facade');
  c.position.x = -1; p.update(c);
  assert.ok(active(p)[0].position.x < 0, 'light follows the opposite visible facade');
});
check('daylight disables both luminous diffuser and real lights', () => {
  fixture.setNight(0); pool.update(camera);
  assert.equal(active(pool).length, 0); assert.equal(fixture.rig.emitter.emissiveIntensity, 0);
});
check('reused light slots reset color and penumbra when changing between lighting profiles', () => {
  const s = new THREE.Scene(), c = new THREE.PerspectiveCamera();
  c.position.set(0, .1, .4);
  const neutralOwner = new THREE.Group(), warmOwner = new THREE.Group();
  s.add(neutralOwner, warmOwner);
  const neutral = createArchitecturalLighting(neutralOwner), warm = createArchitecturalLighting(warmOwner);
  neutral.spot({ position: [0, .1, 0], target: [0, 0, 0], color: '#edf0e8', penumbra: .95 });
  warm.spot({ position: [0, .1, 0], target: [0, 0, 0] });
  neutral.setNight(1); warm.setNight(1);
  const p = createArchitecturalLightPool(s, { limit: 1 });
  for (const [owner, color, penumbra] of [[neutralOwner, '#edf0e8', .95], [warmOwner, '#ffc477', .8]]) {
    p.setRoots([owner]); p.update(c);
    assert.equal(active(p).length, 1);
    assert.equal(active(p)[0].color.getHex(), new THREE.Color(color).getHex());
    near(active(p)[0].penumbra, penumbra, 'pooled beam softness');
  }
});
check('approaching the facade past an outward lamp does not select the hidden facade', () => {
  const s = new THREE.Scene(), owner = new THREE.Group(), c = new THREE.PerspectiveCamera();
  s.add(owner); c.position.set(0, .1, .06);
  const f = createArchitecturalLighting(owner);
  f.spot({ position: [0, .1, .2], target: [0, .1, .05], normal: [0, 0, 1] });
  f.spot({ position: [0, .1, 0], target: [0, .1, -.05], normal: [0, 0, -1] });
  f.setNight(1);
  const p = createArchitecturalLightPool(s, { limit: 1 }); p.setRoots([owner]); p.update(c);
  near(active(p)[0].position.z, .2, 'visible facade lamp when the camera is between lamp and wall');
});
check('Yijiang retains closed crenellation and eave lines without luminous portal rims', () => {
  const gt = CITY_GATES.find(gate => gate.name === '挹江门');
  const model = buildGateModel(gt, { merge: false }), outlines = [];
  model.traverse(o => { if (o.isMesh && o.material.userData.architecturalEmitter) outlines.push(o); });
  assert.equal(model.getObjectByName('vault-led-strip'), undefined, 'portal dress must not glow');
  assert.equal(outlines.length, 3, 'one perimeter and both eaves remain');
  assert.ok(outlines.every(o => o.userData.closedLightStrip), 'all retained lines form closed loops');
  model.updateWorldMatrix(true, true);
  const outlineBounds = new THREE.Box3().setFromObject(model.getObjectByName('cap-perimeter-led-strip'));
  assert.ok(outlineBounds.max.y > (gt.wallH + 1.79) / 30, 'line reaches the merlon caps');
  assert.ok(outlineBounds.min.y < gt.wallH / 30, 'side returns still reach continuous-wall lighting');
  const snapshots = snapshotNonEmitters(model), s = new THREE.Scene(), c = new THREE.PerspectiveCamera();
  s.add(model); const p = createArchitecturalLightPool(s); p.setRoots([model]);
  for (const side of [-1, 1]) {
    c.position.set(0, .67, side * 2.17); model.userData.setNight(1); p.update(c);
    assert.equal(active(p).length, 8);
    const counts = [0, 0, 0];
    for (const lamp of active(p)) {
      assert.ok(lamp.position.z * side > 0, 'available light slots serve the visible facade');
      const y = lamp.target.position.y * 30;
      counts[y < gt.wallH ? 0 : y < gt.wallH + .6 + gt.towerSpec.body ? 1 : 2]++;
    }
    assert.deepEqual(counts, [4, 2, 2], 'wall, hall and roof each retain illumination');
    unchangedMasonry(snapshots, 'Yijiang pilot');
  }
  model.userData.setNight(0); p.update(c);
  assert.equal(active(p).length, 0);
  assert.ok(outlines.every(o => o.material.emissiveIntensity === 0));
  unchangedMasonry(snapshots, 'Yijiang after lights off');
});
check('metre fixture follows owner translation, rotation, scale and nested parent', () => {
  fixture.setNight(1); pool.update(camera);
  assert.equal(active(pool).length, 1);
  const light = active(pool)[0];
  vectorNear(light.position, [9.3, 1.2, 4.9], 'lamp position');
  vectorNear(light.target.position, [9.3, 1.1, 4.9], 'lamp aim');
  near(light.distance, .2, '20 metre beam range');
  // At 1 metre (= .01 scene units), the inverse-square intensity recovers the
  // same numerical illumination as a metre-space light of intensity 100.
  near(light.intensity / (.01 ** 2), 100, 'world-scale intensity compensation');
  assert.ok(fixture.rig.emitter.emissiveIntensity > 0);
});
check('twilight scales real illumination and diffuser together, then clears stale light', () => {
  fixture.setNight(1); pool.update(camera);
  const full = active(pool)[0].intensity, diffuser = fixture.rig.emitter.emissiveIntensity;
  fixture.setNight(.25); pool.update(camera);
  near(active(pool)[0].intensity, full / 4, 'quarter-night light');
  near(fixture.rig.emitter.emissiveIntensity, diffuser / 4, 'quarter-night diffuser');
  fixture.setNight(0); pool.update(camera); assert.equal(active(pool).length, 0);
});
check('hidden owner or ancestor cannot illuminate visible surroundings', () => {
  fixture.setNight(1); pool.update(camera); assert.equal(active(pool).length, 1);
  owner.visible = false; pool.update(camera); assert.equal(active(pool).length, 0);
  owner.visible = true; carrier.visible = false; pool.update(camera); assert.equal(active(pool).length, 0);
  carrier.visible = true; pool.update(camera); assert.equal(active(pool).length, 1);
});
check('distance culling and root replacement release previous light slots', () => {
  camera.position.set(1000, 1000, 1000); pool.update(camera); assert.equal(active(pool).length, 0);
  camera.position.set(9.3, 1.2, 5.5); pool.update(camera); assert.equal(active(pool).length, 1);
  pool.setRoots([]); pool.update(camera); assert.equal(active(pool).length, 0);
  pool.setRoots([carrier]); pool.update(camera); assert.equal(active(pool).length, 1);
});
check('rig discovery, emitter control and light transforms survive outer-wrapper batching', () => {
  mergeStaticMeshes(carrier);
  assert.ok(materials(carrier).includes(fixture.rig.emitter), 'batched luminous geometry keeps controllable material');
  pool.setRoots([carrier]); fixture.setNight(1); pool.update(camera);
  assert.equal(active(pool).length, 1);
  vectorNear(active(pool)[0].position, [9.3, 1.2, 4.9], 'batched lamp position');
  carrier.position.x += 1; pool.update(camera);
  vectorNear(active(pool)[0].position, [10.3, 1.2, 4.9], 'moved batched lamp position');
  carrier.position.x -= 1;
  fixture.setNight(0); pool.update(camera);
  assert.equal(active(pool).length, 0); assert.equal(fixture.rig.emitter.emissiveIntensity, 0);
});
check('hundreds of candidates still use at most eight lights and track another facade', () => {
  const many = new THREE.Group(); many.scale.setScalar(.01); scene.add(many);
  const rig = createArchitecturalLighting(many);
  for (let i = 0; i < 240; i++) rig.spot({ position: [i * 2, 10, 1], target: [i * 2, 5, 0], range: 22 });
  rig.setNight(1); pool.setRoots([many]);
  camera.position.set(0, .1, .3); pool.update(camera); assert.equal(active(pool).length, 8);
  assert.ok(active(pool).every(light => light.position.x < .4), 'near facade receives the available lights');
  camera.position.set(4.7, .1, .3); pool.update(camera); assert.equal(active(pool).length, 8);
  assert.ok(active(pool).every(light => light.position.x > 4.2), 'pool follows camera to distant fixture group');
  rig.setNight(0); pool.update(camera); assert.equal(active(pool).length, 0);
});

// Exercise actual production builders. Gate batching occurs internally; Zhonghua
// is batched into an outer landmark wrapper, matching buildLandmarks in main.js.
const gates = buildGates(), wall = buildWall(), zhonghua = buildZhonghuamen();
const cityScene = new THREE.Scene(), landmarkWrapper = new THREE.Group();
landmarkWrapper.position.set(3, -.05, -4); landmarkWrapper.rotation.y = .7;
landmarkWrapper.add(zhonghua); cityScene.add(gates.group, wall.group, landmarkWrapper);
mergeStaticMeshes(landmarkWrapper);
const cityPool = createArchitecturalLightPool(cityScene);
cityPool.setRoots([gates.group, wall.group, landmarkWrapper]);
const gateSnapshots = gates.models.map(model => [model, snapshotNonEmitters(model)]);
const wallSnapshot = snapshotNonEmitters(wall.group), zhonghuaSnapshot = snapshotNonEmitters(landmarkWrapper);

check('all gates, Zhonghua and continuous walls keep non-emissive masonry through day/night', () => {
  for (const root of [gates.group, wall.group, landmarkWrapper]) for (const material of materials(root)) {
    if (material.userData.architecturalEmitter || material === wall.glowMat) continue;
    assert.ok(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial,
      'non-lamp surfaces must respond to scene lights, not use an unlit full-bright material');
  }
  for (const level of [0, .35, 1, 0]) {
    gates.setNight(level); wall.setNight(level); zhonghua.userData.setNight(level);
    for (const [model, snapshot] of gateSnapshots) unchangedMasonry(snapshot, model.name);
    unchangedMasonry(wallSnapshot, 'continuous wall'); unchangedMasonry(zhonghuaSnapshot, 'Zhonghua');
  }
});
check('every standing gate has functioning batched emitters and nearby real lighting', () => {
  for (const model of [...gates.models, zhonghua]) {
    const rig = model.userData.architecturalLighting;
    assert.ok(rig, `${model.name}: discoverable lighting rig`);
    if (!rig.lights.length) continue; // Bare demolished gate markers intentionally have no fixtures.
    const root = model === zhonghua ? landmarkWrapper : model;
    assert.ok(materials(root).includes(rig.emitter), `${model.name}: luminous strip survives batching`);
    cityPool.setRoots([root]); model.userData.setNight(1);
    model.updateWorldMatrix(true, false);
    camera.position.copy(model.localToWorld(rig.lights[0].position.clone())).add(new THREE.Vector3(.2, .1, .3));
    cityPool.update(camera);
    assert.ok(active(cityPool).length > 0 && active(cityPool).length <= 8, `${model.name}: local lamps illuminate`);
    assert.ok(rig.emitter.emissiveIntensity > 0, `${model.name}: strip is lit`);
    for (const light of active(cityPool)) {
      assert.ok(light.distance >= .4 && light.distance <= .834, `${model.name}: range is local metres, not city-wide`);
      assert.ok([...light.position.toArray(), ...light.target.position.toArray()].every(Number.isFinite));
    }
    root.visible = false; cityPool.update(camera); assert.equal(active(cityPool).length, 0, `${model.name}: hidden model stops lights`);
    root.visible = true; model.userData.setNight(0); cityPool.update(camera);
    assert.equal(active(cityPool).length, 0, `${model.name}: daytime clears lights`);
    assert.equal(rig.emitter.emissiveIntensity, 0);
  }
});
check('world-coordinate continuous-wall fixtures have correct local reach without double scaling', () => {
  const rig = wall.group.userData.architecturalLighting;
  assert.ok(rig.lights.length > 0);
  const source = rig.lights[0];
  cityPool.setRoots([wall.group]); wall.setNight(1);
  camera.position.copy(source.position).add(new THREE.Vector3(.1, .1, .3));
  cityPool.update(camera);
  assert.ok(active(cityPool).length > 0);
  const selected = active(cityPool).find(light => light.position.distanceTo(source.position) < 1e-8);
  assert.ok(selected, 'nearby wall candidate is selected at its existing world position');
  near(selected.distance, source.range / 30, 'wall range');
  const fall = selected.position.distanceTo(selected.target.position);
  assert.ok(fall > .065 && fall < .215, 'wall beam targets a few metres of facade');
  wall.setNight(0); cityPool.update(camera); assert.equal(active(cityPool).length, 0);
});

if (failures.length) {
  console.error(`Architectural lighting checks: ${passed} passed, ${failures.length} failed.`);
  process.exitCode = 1;
} else console.log(`Architectural lighting checks passed: ${passed} behaviours; all production masonry, metre transforms, warm light budget, visibility, batching and daylight reset.`);
