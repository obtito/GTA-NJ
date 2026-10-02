// Verify actual built geometry and every gate connection, including the wraparound gate.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CITY_GATES, gateHalfLenM } from '../js/data.js';
import { buildWall, terrainHeight } from '../js/world.js';
import { gateFrame } from '../js/wall-layout.js';

const wall = buildWall(), connected = new Map();
assert.equal(wall.ends.length, CITY_GATES.length, 'one continuous wall run between every pair of gates');
for (const run of wall.ends) {
  for (const joint of [run.start, run.end]) {
    const { station: p, gate: g, side } = joint;
    const gt = CITY_GATES.find(v => v.name === g.name), frame = gateFrame(gt);
    const dx = p.x - frame.x, dz = p.z - frame.z;
    const localX = (dx * frame.localX[0] + dz * frame.localX[1]) * 30;
    const localZ = (dx * frame.normal[0] + dz * frame.normal[1]) * 30;
    assert.ok(Math.abs(localX - side * (gateHalfLenM(gt) - 0.4)) < 1e-7, `${g.name}: side joint overlaps gate by 40 cm`);
    assert.ok(Math.abs(localZ) < 1e-7, `${g.name}: wall centre crosses gate side at centre`);
    assert.ok(Math.abs(p.y - Math.max(-0.05, terrainHeight(frame.x, frame.z) - 0.05)) < 1e-9, `${g.name}: shared ground elevation`);
    const deckM = gt.kind === 'ruin' && gt.profile !== 'hanzhong' ? Math.max(0.12, gt.remnant ?? 0.12) : gt.joinDeckH ?? gt.wallDeckM ?? gt.wallH;
    assert.ok(Math.abs(p.heightM - deckM) < 1e-8, `${g.name}: walkway matches gate deck elevation`);
    assert.ok(Math.abs(p.nx * frame.normal[0] + p.nz * frame.normal[1]) > 0.999999, `${g.name}: end section parallel with gate depth`);
    assert.ok(p.baseM <= (gt.depthM || 20) + 1e-8, `${g.name}: wall foot fits gate side`);
    connected.set(g.name, (connected.get(g.name) || 0) + 1);
  }
}
for (const gt of CITY_GATES) assert.equal(connected.get(gt.name), 2, `${gt.name}: both sides connected`);

const wallPosition = wall.group.getObjectByName('wall:masonry').geometry.attributes.position;
const firstJoint = wall.ends[0].start.station;
assert.ok(Math.abs((wallPosition.getY(0) - wallPosition.getY(1)) * 30 - (firstJoint.heightM + wall.profile.sinkM)) < 0.001,
  'built masonry height has the same metre scale as its plan');
assert.ok(Math.abs(wallPosition.getY(0) - (firstJoint.y + firstJoint.heightM / 30)) < 1e-6,
  'wall deck vertex meets the gate deck without subtracting footing depth');

let vertices = 0, instances = 0;
wall.group.traverse(mesh => {
  if (!mesh.isMesh) return;
  const p = mesh.geometry.attributes.position, normal = mesh.geometry.attributes.normal;
  for (let i = 0; i < p.array.length; i++) assert.ok(Number.isFinite(p.array[i]), `${mesh.name}: finite vertex`);
  if (normal) for (const n of normal.array) assert.ok(Number.isFinite(n), `${mesh.name}: finite normal`);
  if (mesh.name === 'wall:walkway') {
    for (let i = 0; i < normal.count; i++) assert.ok(normal.getY(i) >= -1e-7, 'walkway and parapet coping face upward');
  }
  vertices += p.count;
  if (mesh.isInstancedMesh) {
    instances += mesh.count;
    const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); matrix.decompose(pos, rotation, scale);
      assert.ok(scale.y <= 0.030001 && scale.y > 0, 'merlon height uses metre scale, not vertical exaggeration');
      assert.ok(Math.abs(scale.x - 0.55 / 30) < 1e-6 && Math.abs(scale.z - 0.95 / 30) < 1e-6, 'merlon dimensions preserve XYZ metre ratio');
    }
  }
});
assert.ok(instances > 1000, 'wall merlons generated');
const led = wall.group.getObjectByName('wall:lighting'), slot = wall.group.getObjectByName('wall:light-channel');
assert.equal(led.visible, false, 'lighting starts off during the day');
assert.ok(slot?.material.isMeshStandardMaterial, 'dark fixture channel remains a normally lit material');
const ledPositions = led.geometry.attributes.position;
assert.ok(Math.abs((wallPosition.getY(0) - ledPositions.getY(0)) * 30 - .12) < .001,
  'light is recessed below the coping, not placed over the wall face');
for (let i = 0; i < ledPositions.count; i += 4) {
  for (const [a, b] of [[i, i + 1], [i + 3, i + 2]]) {
    const heightM = Math.abs(ledPositions.getY(a) - ledPositions.getY(b)) * 30;
    assert.ok(heightM <= 0.081, 'LED surface is at most 8 cm tall, never a wall-sized luminous sheet');
  }
}
const joinedGates = CITY_GATES.filter(g => g.name !== '中华门' && (g.kind !== 'ruin' || g.profile === 'hanzhong'));
assert.equal(wall.lightJoints.length, joinedGates.length * 2, 'both wall light ends meet every standing ordinary gate');
for (const joint of wall.lightJoints) {
  const gt = CITY_GATES.find(g => g.name === joint.gate), frame = gateFrame(gt), p = joint.station;
  const localX = ((p.x - frame.x) * frame.localX[0] + (p.z - frame.z) * frame.localX[1]) * 30;
  assert.ok(Math.abs(localX - joint.side * (gt.widthM / 2 + .08)) < 1e-7,
    `${gt.name}: fixture meets the visible side loop rather than ending inside masonry`);
  for (const face of [-1, 1]) {
    const h = p.heightM - .16;
    const t = face * (p.baseM / 2 + (p.topM - p.baseM) / 2 * (h + wall.profile.sinkM) / (p.heightM + wall.profile.sinkM) + .035);
    const expected = new THREE.Vector3(p.x + p.nx * t / 30, p.y + h / 30, p.z + p.nz * t / 30);
    let found = false;
    for (let i = 0; i < ledPositions.count && !found; i += 2) {
      const center = new THREE.Vector3().fromBufferAttribute(ledPositions, i)
        .add(new THREE.Vector3().fromBufferAttribute(ledPositions, i + 1)).multiplyScalar(.5);
      found = center.distanceTo(expected) < 5e-6;
    }
    assert.ok(found, `${gt.name}: actual ${face > 0 ? 'outer' : 'inner'} LED mesh reaches the gate loop`);
    assert.ok(Math.abs(h - (gt.wallH - .16)) < 1e-8, `${gt.name}: gate and wall light centre heights match`);
  }
}
assert.ok(wall.lightJoints.every(j => j.gate !== '中华门'), 'no unsupported bridge crosses Zhonghua front corner');
let ownedLights = 0;
wall.group.traverse(object => { if (object.isLight) ownedLights++; });
assert.equal(ownedLights, 0, 'continuous wall provides candidates without creating hundreds of real lights');
const lightingRig = wall.group.userData.architecturalLighting;
assert.ok(lightingRig, 'wall candidates register with the shared light pool');
assert.ok(lightingRig.lights.length > 100 && lightingRig.lights.length < 1000, 'wall registers spaced candidates rather than one light per brick');
assert.equal(lightingRig.night, 0, 'light candidates start disabled');
for (const source of lightingRig.lights) {
  assert.ok([...source.position.toArray(), ...source.target.toArray()].every(Number.isFinite), 'candidate coordinates are finite');
  assert.ok(source.position.y > source.target.y, 'wall washer aims down the wall');
  assert.ok(source.position.y - source.target.y <= .200003, 'a six-metre drop uses world units');
  assert.ok(source.range > 6 && source.range < 30, 'candidate range remains in metres for the shared pool');
}
for (const night of [0, .35, 1, 0]) {
  wall.setNight(night);
  assert.equal(wall.glowMat.opacity, night * .8);
  assert.equal(led.visible, night > 0);
  assert.equal(lightingRig.night, night, 'setNight also enables and disables pooled wall washers');
  for (const material of wall.mats) {
    assert.equal(material.emissive.getHex(), 0, 'masonry and fittings never glow on their own');
    assert.equal(material.emissiveIntensity, 0, 'night mode does not add emissive fill to masonry');
  }
}
console.log(`Wall structure OK: ${connected.size} gates / ${connected.size * 2} precise joints; ${vertices} vertices; ${instances} metre-scale merlons.`);
