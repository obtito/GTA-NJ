import { createArchitecturalLighting } from './architectural-lighting.js';

// Modern auxiliary lighting follows the surviving structure. The layout is a
// presentation treatment, not a surveyed inventory of the site's luminaires.
export function installGateLighting(g, gt) {
  const lighting = createArchitecturalLighting(g);
  if (gt.kind === 'ruin' && gt.profile !== 'hanzhong') return lighting;
  const referencePilot = gt.lightingProfile === 'yijiang-reference';
  if (referencePilot) {
    // The warm perimeter is the main night-time feature; surfaces receive
    // only restrained reflected light from the auxiliary fixtures.
    lighting.rig.emitter.color.set('#30271b');
    lighting.rig.emitter.emissive.set('#ffa83d');
  }
  // Photo-led Yijiang pilot: the warm outline follows the masonry teeth.
  // Side returns meet the existing continuous-wall strip at its original level.
  // Fixture positions/photometry are a rendering approximation, not a survey.
  function crenellatedCap(width, height, depth) {
    const x = width / 2 + .08, z = depth / 2 + .09;
    const low = height + .85, high = height + 1.83, jointY = height - .16;
    const count = Math.max(2, Math.floor(width / 1.9));
    const front = [[-x, low, z]];
    for (let i = 0; i < count; i++) {
      const center = -width / 2 + (i + .5) * width / count;
      front.push([center - .54, low, z], [center - .54, high, z],
        [center + .54, high, z], [center + .54, low, z]);
    }
    front.push([x, low, z]);
    const back = front.slice().reverse().map(([px, py]) => [px, py, -z]);
    lighting.strip([...front, [x, jointY, z], [x, jointY, -z], ...back,
      [-x, jointY, -z], [-x, jointY, z], front[0]], { width: .065, name: 'cap-perimeter-led-strip' });
    for (const side of [-1, 1]) {
      for (const fraction of [-.375, -.125, .125, .375]) {
        const px = width * fraction;
        // Broad, fully feathered downward spill just outside the coping.
        // A short reach leaves the lower wall and portal interiors in shade.
        lighting.spot({ position: [px, height - .18, side * (depth / 2 + 2.8)],
          target: [px, height - 2.6, side * depth / 2], normal: [0, 0, side],
          power: 8, range: 14, angle: 1.32, penumbra: 1, color: '#ffce93', priority: 1 });
      }
    }
  }
  function cap(width, height, depth, z = 0) {
    const x = width / 2 + .08, front = z + depth / 2 + .08, back = z - depth / 2 - .08, y = height - .16;
    lighting.strip([[-x, y, front], [x, y, front], [x, y, back], [-x, y, back], [-x, y, front]],
      { name: 'cap-perimeter-led-strip' });
    for (const side of [-1, 1]) {
      const face = z + side * (depth / 2 + .08);
      const count = Math.max(2, Math.ceil(width / 13));
      for (let i = 0; i < count; i++) {
        const x = (i + .5) * width / count - width / 2;
        lighting.spot({ position: [x, height - .16, face + side * .65],
          target: [x, Math.max(1, height - 6), z + side * depth / 2], power: 170, range: 22, priority: 1 });
      }
    }
    for (const side of [-1, 1]) lighting.spot({ position: [side * (width / 2 + .75), y, z],
      target: [side * width / 2, Math.max(1, height - 6), z], normal: [side, 0, 0], power: 95, range: 18, priority: .85 });
  }
  function portal(p, depth, z = 0) {
    for (const side of [-1, 1]) {
      // Follow the intrados immediately inside the arch: a real opening remains
      // between the jambs, with the source slightly proud of the stone dress.
      const face = z + side * (depth / 2 + .26), r = p.width / 2 + .13;
      const points = [[p.x - r, .4, face], [p.x - r, p.spring, face]];
      for (let i = 1; i <= 28; i++) {
        const a = Math.PI - i * Math.PI / 28;
        points.push([p.x + r * Math.cos(a), p.spring + (p.rise + .13) * Math.sin(a), face]);
      }
      points.push([p.x + r, .4, face]);
      lighting.strip(points, { width: .085, name: 'vault-led-strip' });
      lighting.spot({ position: [p.x, p.spring + p.rise - .18, z + side * (depth / 2 - .45)],
        target: [p.x, .1, z + side * (depth / 2 - 1.5)], power: 28, range: 12, angle: 1.15, priority: .85 });
    }
  }
  if (referencePilot) crenellatedCap(gt.widthM, gt.wallH, gt.depthM);
  else {
    cap(gt.widthM, gt.wallH, gt.depthM);
    for (const p of g.userData.portals) portal(p, gt.depthM);
  }
  if (gt.towerSpec) {
    const { width, depth, body, roof, tiers = 1 } = gt.towerSpec, base = gt.wallH + .05;
    function eave(w, d, rise, y) {
      const points = [];
      // Same edge samples and upturned-corner profile as arch.js gableHipRoof.
      for (const [a, b, steps] of [
        [[-w / 2, -d / 2], [w / 2, -d / 2], 22],
        [[w / 2, -d / 2], [w / 2, d / 2], 16],
        [[w / 2, d / 2], [-w / 2, d / 2], 22],
        [[-w / 2, d / 2], [-w / 2, -d / 2], 16],
      ]) for (let i = 0; i < steps; i++) {
        const t = i / steps, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        const corner = Math.max(0, Math.abs(x) / (w / 2) + Math.abs(z) / (d / 2) - 1);
        const edgeX = Math.abs(Math.abs(x) - w / 2) < .001 ? Math.sign(x) * .06 : 0;
        const edgeZ = Math.abs(Math.abs(z) - d / 2) < .001 ? Math.sign(z) * .06 : 0;
        points.push([x + edgeX, y + rise * .32 * (.154 + .1875 * corner ** 2) + .015, z + edgeZ]);
      }
      points.push(points[0]); lighting.strip(points, { width: referencePilot ? .07 : .09, name: 'eave-led-strip' });
    }
    eave(width * 1.30, depth * 1.30, roof, base + .6 + body);
    if (tiers === 2) eave(width * 1.42, depth * 1.46, roof * .4, base + body * .48);
    for (const side of [-1, 1]) for (const x of [-width * .27, width * .27]) {
      if (referencePilot) {
        lighting.spot({ position: [x, base + body * .76, side * (depth / 2 + 5.5)],
          target: [x, base + body * .48, side * depth / 2], normal: [0, 0, side],
          power: 24, range: 22, angle: 1.14, penumbra: 1, color: '#ffe4bf', priority: 1 });
        lighting.spot({ position: [x, base + .6 + body + roof + 1.7, side * (depth / 2 + 6)],
          target: [x, base + .6 + body + roof * .38, side * depth * .36], normal: [0, 0, side],
          power: 32, range: 25, angle: 1.16, penumbra: 1, color: '#eee8d1', priority: 1 });
      } else lighting.spot({ position: [x, base + body * .86, side * (depth / 2 + .55)],
          target: [x, base + body * .3, side * depth / 2], power: 48, range: 12, priority: 1.25 });
    }
  }
  if (gt.court) {
    const { width, depth, height, entry = 10, side = -1, thickness = 6 } = gt.court;
    const z0 = side * gt.depthM / 2, z1 = side * (gt.depthM / 2 + depth);
    // One closed outer outline follows the shoulder walls, both side walls,
    // and the far gate wall. Return along the inner coping around the open court.
    const x = width / 2 + .08, mainX = gt.widthM / 2 + .08, y = height - .16;
    const near = z0 - side * (thickness / 2 + .08), far = z1 + side * (thickness / 2 + .08);
    lighting.strip([[-mainX, y, near], [-x, y, near], [-x, y, far], [x, y, far], [x, y, near], [mainX, y, near],
      [mainX, y, z0 + side * (thickness / 2 - .08)], [x - thickness, y, z0 + side * (thickness / 2 - .08)],
      [x - thickness, y, z1 - side * (thickness / 2 + .08)], [-x + thickness, y, z1 - side * (thickness / 2 + .08)],
      [-x + thickness, y, z0 + side * (thickness / 2 - .08)], [-mainX, y, z0 + side * (thickness / 2 - .08)],
      [-mainX, y, near]], { name: 'barbican-perimeter-led-strip' });
    portal({ x: entry, width: gt.court.span || 4.5, spring: Math.min(3.7, height * .42), rise: Math.min(2.25, height * .3) }, thickness, z1);
    for (const sx of [-1, 1]) {
      lighting.spot({ position: [sx * (width / 2 + .7), y, (z0 + z1) / 2],
        target: [sx * width / 2, Math.max(1, height - 5), (z0 + z1) / 2], normal: [sx, 0, 0], power: 100, range: 18, priority: .85 });
    }
  }
  for (const strip of g.userData.perimeterLighting || []) lighting.strip(strip.points, { width: strip.width || .1, name: strip.name });
  return lighting;
}
