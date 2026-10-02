// Local luminaires: only the LED diffuser emits. Masonry is lit by a bounded
// pool of real spot lights, with inverse-square falloff in metre photometry.
// The metre→scene factor is PER-RIG: gate/Zhonghua rigs derive it from the
// owner's world scale (uniformly 1:30), the continuous-wall rig (world-scale
// group whose authored metres already render at 1:30) passes it explicitly.
import * as THREE from 'three';

const WARM = '#ffc477';
const _worldScale = new THREE.Vector3();   // r160 的 getWorldScale 必须显式给 target

export function createArchitecturalLighting(owner, { metre = null } = {}) {
  const emitter = new THREE.MeshStandardMaterial({ color: '#958c78', roughness: .6,
    emissive: WARM, emissiveIntensity: 0, toneMapped: false });
  emitter.name = 'warm-led-diffuser';
  emitter.userData.architecturalEmitter = true;
  const rig = { lights: [], night: 0, emitter, stripCount: 0, metre };
  Object.defineProperty(rig, 'owner', { value: owner });
  owner.userData.architecturalLighting = rig;
  function strip(points, { width = .1, name = 'architectural-led-strip' } = {}) {
    if (points.length < 2) return null;
    // Keep every authored corner; arc-length resampling would cut across the
    // upturned roof edge and bury parts of a thin diffuser inside the tiles.
    const positions = [], indices = [], tangent = new THREE.Vector3(), side = new THREE.Vector3(), normal = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), ring = 6;
    const vertices = points.map(p => new THREE.Vector3(...p));
    const closed = vertices.length > 2 && vertices[0].distanceToSquared(vertices.at(-1)) < 1e-10;
    if (closed) vertices.pop();
    for (let i = 0; i < vertices.length; i++) {
      const nextVertex = closed ? (i + 1) % vertices.length : Math.min(i + 1, vertices.length - 1);
      const prevVertex = closed ? (i + vertices.length - 1) % vertices.length : Math.max(i - 1, 0);
      tangent.subVectors(vertices[nextVertex], vertices[prevVertex]).normalize();
      side.crossVectors(up, tangent);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0); else side.normalize();
      normal.crossVectors(tangent, side).normalize();
      for (let j = 0; j < ring; j++) {
        const a = j * Math.PI * 2 / ring, u = Math.cos(a) * width / 2, v = Math.sin(a) * width / 2;
        const p = vertices[i];
        positions.push(p.x + side.x * u + normal.x * v, p.y + side.y * u + normal.y * v, p.z + side.z * u + normal.z * v);
        if (closed || i < vertices.length - 1) {
          const k = i * ring + j, next = i * ring + (j + 1) % ring;
          const end = ((i + 1) % vertices.length) * ring;
          indices.push(k, end + (j + 1) % ring, end + j, k, next, end + (j + 1) % ring);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, emitter); mesh.name = name;
    mesh.userData.closedLightStrip = closed;
    owner.add(mesh); rig.stripCount++;
    return mesh;
  }
  // Coordinates are local to owner. Range and power always use metre units;
  // the metre→scene factor is per-rig (rig.metre ?? owner world scale).
  function spot({ position, target, normal, power = 90, range = 22, angle = 1.05, priority = 1,
    color = WARM, penumbra = .8 }) {
    const light = { position: new THREE.Vector3(...position), target: new THREE.Vector3(...target),
      normal: normal ? new THREE.Vector3(...normal) : null,
      power, range, angle, priority, color: new THREE.Color(color), penumbra,
      worldPosition: new THREE.Vector3(), worldTarget: new THREE.Vector3() };
    Object.defineProperty(light, 'rig', { value: rig });
    rig.lights.push(light); return light;
  }
  function setNight(value) {
    rig.night = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
    emitter.emissiveIntensity = rig.night * 1.8;
  }
  return { strip, spot, setNight, rig };
}

export function createArchitecturalLightPool(scene, { limit = 8, maxDistance = 8 } = {}) {
  limit = Math.min(8, Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 8)));
  const group = new THREE.Group(); group.name = 'architectural-light-pool'; group.visible = false; scene.add(group);
  const slots = Array.from({ length: limit }, () => {
    const light = new THREE.SpotLight(WARM, 0, .22, 1.05, .8, 2);
    light.name = 'local-led-wall-wash'; group.add(light, light.target);
    return light;
  });
  let rigs = [], previous = new Set();
  const sources = new Set(), outward = new THREE.Vector3(), towardCamera = new THREE.Vector3(), cameraPosition = new THREE.Vector3();
  function setRoots(roots) {
    sources.clear();
    for (const root of roots) root?.traverse(o => {
      if (o.userData.architecturalLighting) sources.add(o.userData.architecturalLighting);
    });
    rigs = [...sources]; previous.clear();
  }
  function update(camera) {
    camera.getWorldPosition(cameraPosition);
    const candidates = [];
    for (const rig of rigs) {
      if (rig.night <= 0) continue;
      // 每 rig 的米→场景因子：显式传入优先(连续墙组 scale=1 但 authored 米按 1:30 渲染)，
      // 否则取 owner 的世界等比缩放(门组/中华门组 = 1/30)。
      const metre = rig.metre ?? rig.owner.getWorldScale(_worldScale).x;
      let visible = true;
      for (let o = rig.owner; o; o = o.parent) if (!o.visible) { visible = false; break; }
      if (!visible) continue;
      rig.owner.updateWorldMatrix(true, false);
      for (const source of rig.lights) {
        source.worldPosition.copy(source.position).applyMatrix4(rig.owner.matrixWorld);
        source.worldTarget.copy(source.target).applyMatrix4(rig.owner.matrixWorld);
        const distance = source.worldPosition.distanceTo(cameraPosition);
        if (distance > maxDistance) continue;
        // Prefer the lit facade facing the viewer, then nearby fixtures. A small
        // hysteresis prevents repeated switching when two fixtures are equidistant.
        if (source.normal) outward.copy(source.normal).transformDirection(rig.owner.matrixWorld);
        else outward.subVectors(source.worldPosition, source.worldTarget);
        outward.y = 0;
        // Judge the visible facade, not whether the camera has passed an
        // outward-mounted fixture while approaching that facade.
        towardCamera.subVectors(cameraPosition, source.worldTarget); towardCamera.y = 0;
        const facing = outward.dot(towardCamera) >= 0 ? 1 : 2.5;
        source.score = distance * facing / source.priority * (previous.has(source) ? .88 : 1);
        candidates.push(source);
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    previous = new Set(candidates.slice(0, limit));
    group.visible = previous.size > 0;
    slots.forEach((light, i) => {
      const source = candidates[i];
      const metre = source ? (source.rig.metre ?? source.rig.owner.getWorldScale(_worldScale).x) : 1;
      light.intensity = source ? source.power * metre ** 2 * source.rig.night : 0;
      if (!source) return;
      light.position.copy(source.worldPosition); light.target.position.copy(source.worldTarget);
      light.distance = source.range * metre; light.angle = source.angle;
      light.color.copy(source.color); light.penumbra = source.penumbra;
    });
  }
  return { group, lights: slots, setRoots, update };
}
