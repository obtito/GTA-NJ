// Surviving Shicheng / Hanximen enclosure in today's Hanzhongmen Square.
// Source and uncertainty: docs/CITY_GATES_REFERENCES.md. This is an aerial-photo
// approximation of the surviving footprint, not the 121.4 x 122.6 m old castle.
// The caller builds the principal platform at z = 0; +Z is outside the city.
import * as THREE from 'three';
import { masonryBox as box, vaultedWall, archDress, gatePlaque } from './gate-model.js';

function wallRun(parent, mats, points, thickness, label, perimeterLighting, scale) {
  const sectionHeights = [], normals = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    const h = (a[2] + b[2]) / 2;
    sectionHeights.push(h);
    normals.push([dz / length, -dx / length]);
    const section = new THREE.Group();
    section.name = label + ':' + i;
    section.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
    section.rotation.y = Math.atan2(dx, dz);
    parent.add(section);
    box(section, mats.brick, 0, 0, 0, thickness, h, length + .35, 'retained-wing-masonry');
    box(section, mats.top, 0, h, 0, thickness + .08, .16, length + .2, 'retained-wing-cap');
    // Unequal surviving lengths are deliberate. Never close the missing north wing.
    if (h > 4) box(section, mats.brick, -thickness / 2 + .35, h + .16, 0,
      .7, .75, length + .2, 'low-outer-parapet');
  }
  // Follow each surviving run as its own closed rim. The negative local-X
  // edge is inset past the low parapet; both lines sit on the actual deck cap.
  // Heights remain constant along each built section, with vertical steps at
  // the joins, rather than a sloping cable floating above the stepped masonry.
  const insetNegative = sectionHeights.some(h => h > 4) ? .9 : .18;
  function edge(offset) {
    const rim = [];
    for (let i = 0; i < points.length; i++) {
      const before = normals[Math.max(0, i - 1)], after = normals[Math.min(i, normals.length - 1)];
      const denominator = 1 + before[0] * after[0] + before[1] * after[1];
      const x = points[i][0] + (before[0] + after[0]) * offset / denominator;
      const z = points[i][1] + (before[1] + after[1]) * offset / denominator;
      const incoming = sectionHeights[Math.max(0, i - 1)] + .205;
      const outgoing = sectionHeights[Math.min(i, sectionHeights.length - 1)] + .205;
      rim.push([x, incoming, z]);
      if (incoming !== outgoing) rim.push([x, outgoing, z]);
    }
    return rim;
  }
  const rim = [...edge(thickness / 2 - .18), ...edge(-thickness / 2 + insetNegative).reverse()];
  rim.push([...rim[0]]);
  perimeterLighting.push({ points: rim.map(p => p.map(v => v * scale)),
    name: `hanzhong:${label}:perimeter`, width: .1 });
}

/** Add the surviving inner enclosure, keeping the first portal entirely clear. */
export function buildHanzhongRemains(g, mats, gt) {
  const remains = new THREE.Group();
  remains.name = 'hanzhong-surviving-enclosure';
  g.add(remains);

  // Width relates to this site's surviving platform; it is not a historical survey.
  const scale = (gt.widthM || 58) / 58;
  remains.scale.setScalar(scale);
  // Consumed by installGateLighting after the complete gate has been built.
  // All points are in the main gate group's metre coordinates, not remains space.
  const perimeterLighting = [];
  g.userData.perimeterLighting = perimeterLighting;
  const rearZ = -92, rearHeight = 9.2, rearThickness = 6.5;
  const rearPortal = { x: 0, width: 5.6, spring: 3.7, rise: 2.8 };
  vaultedWall(remains, mats.brick, { width: 101, height: rearHeight,
    depth: rearThickness, z: rearZ, portals: [rearPortal], name: 'surviving-second-vault' });
  archDress(remains, mats, rearPortal, rearThickness, rearZ);
  box(remains, mats.top, 0, rearHeight, rearZ, 101, .18, rearThickness + .08, 'second-vault-cap');
  for (const side of [-1, 1]) {
    box(remains, mats.brick, 0, rearHeight + .18, rearZ + side * (rearThickness / 2 - .35),
      101, .72, .7, 'second-vault-low-parapet');
  }
  gatePlaque(remains, '汉西门', 0, 7.65, rearZ + rearThickness / 2 + .16,
    { width: 2.55, height: 1 });
  // Closed rectangle on the second gate's coping, inside its two parapets.
  const rearRimX = 101 / 2 - .25, rearRimZ = rearThickness / 2 - .9;
  perimeterLighting.push({
    points: [
      [-rearRimX, rearHeight + .225, rearZ + rearRimZ],
      [rearRimX, rearHeight + .225, rearZ + rearRimZ],
      [rearRimX, rearHeight + .225, rearZ - rearRimZ],
      [-rearRimX, rearHeight + .225, rearZ - rearRimZ],
      [-rearRimX, rearHeight + .225, rearZ + rearRimZ],
    ].map(p => p.map(v => v * scale)),
    name: 'hanzhong:second-vault:perimeter', width: .1,
  });

  // South wall bends with the old boat-shaped enclosure. It survives independently
  // beside the broad principal platform, leaving a real open route between them.
  wallRun(remains, mats, [
    [46, -10, 7.4], [51, -26, 8.0], [53, -43, 8.8],
    [53, -60, 9.1], [51.5, -77, 9.2], [49.5, -92, 9.2],
  ], 4.5, 'south-curved-wing', perimeterLighting, scale);

  // The north wing is incomplete: only its rear return and isolated lower trace
  // remain. No continuous bounding wall or invented intermediate transverse wall.
  wallRun(remains, mats, [
    [-49.5, -92, 9.2], [-52, -80, 7.8], [-53, -71, 4.8],
  ], 4.3, 'north-rear-remnant', perimeterLighting, scale);
  wallRun(remains, mats, [
    [-49, -18, 1.3], [-52, -29, 1.9], [-54, -40, 1.5],
  ], 3.6, 'north-low-trace', perimeterLighting, scale);

  // Modern square paving joins both surviving passages without blocking a bore.
  const innerFace = -(gt.depthM || 36) / (2 * scale);
  const pathLength = Math.abs(rearZ - innerFace) + rearThickness + 5;
  box(remains, mats.paving, 0, -.025, (rearZ + innerFace) / 2,
    4.2, .055, pathLength, 'square-pedestrian-axis');
  box(remains, mats.paving, 0, -.03, -81, 94, .05, 13, 'square-rear-paving');

  // Original hall is absent. Small column bases indicate its location on the
  // first platform, without inventing an intact tower or a second platform.
  const platformY = gt.wallH || 10;
  for (const x of [-18, -6, 6, 18]) for (const z of [-8, 6]) {
    box(g, mats.stone, x * scale, platformY + .02, z * scale,
      .95 * scale, .18 * scale, .95 * scale, 'surviving-hall-column-base');
  }

  remains.userData.accuracy = 'Aerial-photo approximation; surviving topology documented, dimensions estimated.';
  g.userData.siteBounds = {
    minX: -56 * scale, maxX: 56 * scale,
    minZ: -99 * scale, maxZ: (gt.depthM || 36) / 2,
  };
  g.userData.secondaryPortals = [{ ...rearPortal, x: 0, z: rearZ * scale,
    width: rearPortal.width * scale, height: (rearPortal.spring + rearPortal.rise) * scale,
    depth: rearThickness * scale }];
  return remains;
}
