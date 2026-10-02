// Present-day gates. Build in metres, then scale all axes uniformly to the map.
// Gates are scaled uniformly at 1:30 (same convention as Zifeng Tower); their
// geographic placement stays unchanged.
import * as THREE from 'three';
import { hU, vU } from './geo.js';
import { CITY_GATES } from './data.js';
import { mergeStaticMeshes, registerEnv } from './lib.js';
import { terrainHeight } from './world.js';
import { gateFrame } from './wall-layout.js';
import { buildHanzhongRemains } from './hanzhongmen.js';
import { installGateLighting } from './gate-lighting.js';
import { gateMaterials, masonryBox as box, vaultedWall, archDress, parapet, gatePlaque, tower, stairs } from './gate-model.js';
export { wallFrame, gateFrame } from './wall-layout.js';

export function gatePortals(gt) {
  return (gt.openings || [{ x: 0, width: gt.span || 7, spring: 4.5 }]).map(p => ({ ...p, rise: p.rise ?? p.width / 2 }));
}

function path(g, mats, points, width) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const mesh = box(g, mats.paving, (a[0] + b[0]) / 2, .015, (a[1] + b[1]) / 2,
      width, .055, Math.hypot(dx, dz));
    mesh.rotation.y = Math.atan2(dx, dz);
  }
}

function yijiangRoadSurface(g, gt, portals) {
  // This busy road reads as one asphalt surface, including the areas between
  // the three bores. Its footprint stays inside the previous approach bounds.
  const left = Math.min(...portals.map(p => p.x - p.width / 2));
  const right = Math.max(...portals.map(p => p.x + p.width / 2));
  const width = Math.min(gt.widthM, right - left + 8), depth = gt.depthM + 10;
  const asphalt = new THREE.MeshStandardMaterial({ color: '#4b4f55', roughness: .96,
    metalness: 0, emissive: 0x000000, emissiveIntensity: 0 });
  asphalt.name = 'yijiang-asphalt'; registerEnv(asphalt, .4);
  const geometry = new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(geometry, asphalt);
  surface.name = 'yijiang:continuous-road';
  surface.position.set((left + right) / 2, .07, 0);
  surface.receiveShadow = true;
  g.add(surface);
}

function court(parent, mats, gt) {
  if (!gt.court) return;
  const { width, depth, height, entry = 10, side = -1, thickness = 6 } = gt.court;
  const g = new THREE.Group(); g.name = 'barbican'; parent.add(g);
  const z0 = side * gt.depthM / 2, z1 = side * (gt.depthM / 2 + depth);
  const stairLength = Math.min(depth - 4, height * 1.75);
  // Close the shoulders between the narrower main platform and wider outer court.
  const shoulderWidth = (width - gt.widthM) / 2;
  if (shoulderWidth > 0) for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(sx * (gt.widthM / 2 + shoulderWidth / 2), 0, z0);
    g.add(shoulder); box(shoulder, mats.brick, 0, 0, 0, shoulderWidth + .1, height, thickness);
    parapet(shoulder, mats, shoulderWidth + .1, thickness, height);
  }
  for (const sx of [-1, 1]) {
    const wing = new THREE.Group(); wing.position.set(sx * (width / 2 - thickness / 2), 0, (z0 + z1) / 2);
    wing.rotation.y = Math.PI / 2; g.add(wing);
    box(wing, mats.brick, 0, 0, 0, depth + thickness, height, thickness);
    const gapX = (z0 + z1) / 2 - (z0 + side * stairLength);
    parapet(wing, mats, depth + thickness, thickness, height,
      { gaps: sx < 0 ? [{ side: 1, from: gapX - 1.8, to: gapX + 1.8 }] : [] });
  }
  const p = { x: entry, width: gt.court.span || 4.5, spring: Math.min(3.7, height * .42), rise: Math.min(2.25, height * .3) };
  vaultedWall(g, mats.brick, { width, height, depth: thickness, z: z1, portals: [p], name: 'barbican-vault' });
  archDress(g, mats, p, thickness, z1);
  const cap = new THREE.Group(); cap.position.z = z1; g.add(cap); parapet(cap, mats, width, thickness, height);
  box(g, mats.paving, 0, -.04, (z0 + z1) / 2, width - thickness, .08, depth);
  path(g, mats, [[0, 0], [0, z0 + side * depth * .45], [entry, z1]], 3.1);
  stairs(g, mats, { x: -width / 2 + thickness + 1.35, z: z0, width: 2.7,
    length: stairLength, height, direction: side });
  box(g, mats.stone, -width / 2 + thickness + 1.35, height - .2,
    z0 + side * (stairLength + .65), 2.7, .2, 1.3, 'stair-landing');
  g.userData.entry = { x: entry, z: z1 };
}

function ruin(g, mats, gt) {
  // Demolished gates get modest site markers, never conjectural standing towers.
  const corridor = 12, half = gt.widthM / 2;
  for (const sx of [-1, 1]) {
    const w = Math.max(3, half - corridor);
    box(g, mats.paving, sx * (corridor + w / 2), -.05, 0, w, .12, gt.depthM, 'site-paving');
    if (gt.remnant) for (let i = 0; i < 5; i++) box(g, mats.ruin, sx * (corridor + (i + .5) * w / 5), 0, 0,
      w / 5 + .01, gt.remnant * (.65 + .35 * Math.sin((i + 1) * 1.73) ** 2), gt.depthM * .55, 'surviving-remnant');
  }
  if (gt.court) court(g, mats, gt);
  const x = half - 2;
  box(g, mats.stone, x, 0, gt.depthM / 2 + 2, 2.4, .35, 1.2, 'site-marker');
  box(g, mats.trim, x, .35, gt.depthM / 2 + 2, 1.7, 1.2, .5);
  gatePlaque(g, gt.name + '遗址', x, .98, gt.depthM / 2 + 2.26, { width: 1.5, height: .75 });
  g.userData.portals = [];
}

/** Detached model: local +Z faces outside the city. */
export function buildGateModel(gt, { merge = true, materials = null } = {}) {
  const mats = materials || gateMaterials(), g = new THREE.Group();
  g.name = 'gate:' + gt.name;
  Object.assign(g.userData, { metersPerUnit: 30, accuracy: gt.accuracy, gateName: gt.name });
  if (gt.kind === 'ruin' && gt.profile !== 'hanzhong') ruin(g, mats, gt);
  else {
    const portals = gatePortals(gt);
    vaultedWall(g, gt.facade === 'render' ? mats.render : mats.brick, { width: gt.widthM, height: gt.wallH, depth: gt.depthM, portals, name: 'main-vaulted-platform' });
    for (const p of portals) archDress(g, mats, p, gt.depthM, 0, gt.dress === 'stone');
    // Footing deliberately stops at each opening so the barrel stays clear.
    let left = -gt.widthM / 2;
    for (const p of [...portals, { x: gt.widthM / 2, width: 0 }]) {
      const right = p.x - p.width / 2;
      if (right > left) for (const side of [-1, 1]) box(g, mats.stone, (left + right) / 2, 0,
        side * (gt.depthM / 2 + .045), right - left, .75, .16);
      left = p.x + p.width / 2;
    }
    box(g, mats.top, 0, gt.wallH - .18, 0, gt.widthM, .18, gt.depthM);
    parapet(g, mats, gt.widthM, gt.depthM, gt.wallH, { crenels: gt.crenels !== false });
    if (gt.facade === 'render') for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) box(g, mats.trim, 0, gt.wallH - 1.8 + i * .45,
        side * (gt.depthM / 2 + .1), 15 - i * 3, .22, .25, 'stepped-lintel-trim');
    }
    const mid = portals.reduce((a, p) => Math.abs(p.x) < Math.abs(a.x) ? p : a, portals[0]);
    for (const side of [-1, 1]) gatePlaque(g, gt.name, mid.x,
      Math.min(gt.wallH - 1.1, mid.spring + mid.rise + 1.25), side * (gt.depthM / 2 + .23),
      { side, width: gt.plaqueWidth || 3.2 });
    if (gt.towerSpec) tower(g, mats, gt.towerSpec, gt.wallH + .05);
    court(g, mats, gt);
    if (gt.profile === 'hanzhong') buildHanzhongRemains(g, mats, gt);
    g.userData.portals = portals;
    if (gt.name === '挹江门') yijiangRoadSurface(g, gt, portals);
    else for (const p of portals) path(g, mats, [[p.x, -gt.depthM / 2 - 5], [p.x, gt.depthM / 2 + 5]], Math.max(2, p.width - 1));
  }
  g.userData.platform = { width: gt.widthM, depth: gt.depthM, height: gt.kind === 'ruin' && gt.profile !== 'hanzhong' ? (gt.remnant || .12) : gt.wallH };
  g.scale.setScalar(vU(1));
  const lighting = installGateLighting(g, gt);
  g.userData.setNight = lighting.setNight;
  if (merge) mergeStaticMeshes(g);
  return g;
}

export function buildGates({ merge = true, exclusions = [] } = {}) {
  const group = new THREE.Group(); group.name = 'gates';
  const mats = gateMaterials(), models = [];
  for (const gt of CITY_GATES) {
    if (gt.name === '中华门') continue;
    const fr = gateFrame(gt), g = buildGateModel(gt, { merge, materials: mats });
    g.rotation.y = Math.atan2(fr.normal[0], fr.normal[1]) + (fr.zOut < 0 ? Math.PI : 0);
    g.position.set(fr.x, Math.max(-.05, terrainHeight(fr.x, fr.z) - .05), fr.z);
    group.add(g); models.push(g);
    const extent = Math.max((gt.siteWidthM || gt.widthM) / 2, gt.innerExtentM || 0, gt.depthM / 2 + (gt.court?.depth || 0));
    exclusions.push([fr.x, fr.z, vU(extent + 24)]);
  }
  return { group, models, mats: Object.values(mats), plaques: [], setNight(k) { models.forEach(g => g.userData.setNight(k)); } };
}

/** Traffic uses the actual bore centres and clear widths. Scenic gates are pedestrian. */
export function gateRoadLines(lenM = 520) {
  const out = [];
  for (const gt of CITY_GATES) {
    if (!gt.road) continue;
    const fr = gateFrame(gt), turn = fr.zOut;
    const portals = gt.kind === 'ruin' ? [{ x: 0, width: 22 }] : gatePortals(gt).filter(p => p.traffic !== false);
    for (const p of portals) {
      // Portal-centre offset follows the enlarged (1:30) bores; the ±260 m
      // approach along the gate normal stays geographic (hU), as does the
      // road width.
      const toWorld = (x, z) => [fr.x + turn * (fr.localX[0] * vU(x) + fr.normal[0] * hU(z)),
        fr.z + turn * (fr.localX[1] * vU(x) + fr.normal[1] * hU(z))];
      out.push({ name: gt.name, gate: gt.name, elevation: Math.max(-.05, terrainHeight(fr.x, fr.z) - .05) + vU(0.09),
        w: hU(Math.max(2, p.width - 1.2)),
        pts: [toWorld(p.x, lenM / 2), toWorld(p.x, 0), toWorld(p.x, -lenM / 2)] });
    }
  }
  return out;
}
