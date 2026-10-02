// Meter-space masonry. All three axes are scaled together by the caller.
import * as THREE from 'three';
import { makeWallStoneTexture, registerEnv } from './lib.js';
import { chineseHall, gableHipRoof } from './arch.js';
import { makeMasonryTexture } from './masonry-texture.js';

export function gateMaterials() {
  const brick = makeMasonryTexture({ meterUV: true });
  const stone = makeWallStoneTexture();
  if (stone) stone.repeat.set(1 / 2.4, 1 / 1.2);
  const material = (color, map = null, normalMap = null) => {
    const m = new THREE.MeshStandardMaterial({ color, map, normalMap, roughness: .94, metalness: 0 });
    if (normalMap) m.normalScale.set(.35, .35);
    registerEnv(m, .45);
    return m;
  };
  return {
    brick: material(brick ? '#efeee9' : '#8b9086', brick),
    stone: material(stone ? '#e1dbcf' : '#b7ad96', stone),
    trim: material('#aba795'), top: material('#b2ae9c'),
    timber: material('#573e30'), metal: material('#716857'),
    paving: material('#c7c2b2'), ruin: material('#908e7e'), render: material('#b0b2a8'),
  };
}

// Box y is always its bottom, never its centre. UVs are physical metres.
export function masonryBox(parent, material, x, y, z, w, h, d, name = '') {
  const geo = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, Math.abs(n.getX(i)) > .5 ? p.getZ(i) : p.getX(i),
      Math.abs(n.getY(i)) > .5 ? p.getZ(i) : p.getY(i));
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z); mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Filled masonry with real, bottom-open barrel vaults, including soffits.
 * Portals are {x,width,spring,rise}; rise is independent of span for segmental arches.
 * A notched outline avoids coplanar holes touching the outside boundary. */
export function vaultedWall(parent, material, { width, height, depth, portals, x = 0, y = 0, z = 0, name = 'vaulted-wall' }) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  for (const p of [...portals].sort((a, b) => a.x - b.x)) {
    const r = p.width / 2, rise = p.rise ?? r;
    shape.lineTo(p.x - r, 0); shape.lineTo(p.x - r, p.spring);
    for (let i = 1; i <= 28; i++) {
      const a = Math.PI * (1 - i / 28);
      shape.lineTo(p.x + Math.cos(a) * r, p.spring + Math.sin(a) * rise);
    }
    shape.lineTo(p.x + r, 0);
  }
  shape.lineTo(width / 2, 0); shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 28 });
  geo.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z); mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Individually jointed voussoirs, lying on the masonry face instead of a torus.
export function archDress(parent, mats, portal, depth, z = 0, stone = false) {
  const r = portal.width / 2, rise = portal.rise ?? r, t = stone ? .48 : .65;
  for (const side of [-1, 1]) {
    const face = z + side * (depth / 2 + .045);
    for (let i = 0; i < 23; i++) {
      const a = i / 23 * Math.PI + .008, b = (i + 1) / 23 * Math.PI - .008;
      const ring = new THREE.Shape();
      ring.moveTo(Math.cos(a) * r, Math.sin(a) * rise);
      ring.lineTo(Math.cos(b) * r, Math.sin(b) * rise);
      ring.lineTo(Math.cos(b) * (r + t), Math.sin(b) * (rise + t));
      ring.lineTo(Math.cos(a) * (r + t), Math.sin(a) * (rise + t)); ring.closePath();
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: .12, bevelEnabled: false }),
        i % 4 === 0 ? mats.stone : mats.trim);
      mesh.position.set(portal.x, portal.spring, face - (side < 0 ? .12 : 0));
      mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
    }
    for (const sx of [-1, 1]) {
      const courses = Math.ceil(portal.spring / .5);
      for (let j = 0; j < courses; j++) masonryBox(parent, mats.trim,
        portal.x + sx * (r + t / 2), j * portal.spring / courses, face,
        t, portal.spring / courses - .025, .16);
    }
  }
}

export function parapet(parent, mats, width, depth, y, { crenels = true, gaps = [] } = {}) {
  const z = depth / 2 - .42;
  for (const s of [-1, 1]) {
    const openings = gaps.filter(g => g.side === s).sort((a, b) => a.from - b.from);
    let start = -width / 2;
    for (const gap of [...openings, { from: width / 2, to: width / 2 }]) {
      if (gap.from > start) {
        const w = gap.from - start, x = (gap.from + start) / 2;
        masonryBox(parent, mats.brick, x, y, s * z, w, .65, .8);
        masonryBox(parent, mats.trim, x, y + .65, s * z, w, .16, .94);
      }
      start = gap.to;
    }
    if (crenels) {
      const n = Math.max(2, Math.floor(width / 1.9));
      for (let i = 0; i < n; i++) {
        const x = -width / 2 + (i + .5) * width / n;
        if (openings.some(g => x + .54 > g.from && x - .54 < g.to)) continue;
        masonryBox(parent, mats.brick, x, y + .81, s * z, .96, .84, .8);
        masonryBox(parent, mats.trim, x, y + 1.65, s * z, 1.08, .14, .96);
      }
    }
  }
  for (const s of [-1, 1]) masonryBox(parent, mats.brick, s * (width / 2 - .4), y, 0, .8, .8, depth - 1.6);
}

export function gatePlaque(parent, name, x, y, z, { width = 3.2, height = 1.35, side = 1 } = {}) {
  let map = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = 512; c.height = 224;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#b7b2a0'; ctx.fillRect(0, 0, 512, 224);
    ctx.strokeStyle = '#777362'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, 492, 204);
    ctx.fillStyle = '#37392f'; ctx.font = 'bold 120px "KaiTi","SimSun",serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, 256, 121, 462);
    map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : '#b7b2a0', roughness: .9 });
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(width, height), m);
  plaque.position.set(x, y, z); plaque.rotation.y = side < 0 ? Math.PI : 0;
  parent.add(plaque);
}

export function tower(parent, mats, spec, baseY) {
  const { width, depth, body, roof, tiers = 1, color = '#687368' } = spec;
  const hall = chineseHall({ w: width, d: depth, pedestalH: .6, bodyH: body,
    roofRise: roof, bays: spec.bays || 5, depthBays: 2, roofType: 'gable-hip',
    stoneColor: '#b8b2a0', postColor: '#794735', wallColor: '#846446',
    roofColor: color, ridgeColor: '#686451', dougongTier: 2, dougongUnit: .34,
    rails: false, doors: 2, segX: 22, segZ: 16 });
  hall.position.y = baseY; parent.add(hall);
  if (tiers === 2) {
    // Lower eave wraps a continuing upper storey; it is not a second detached hall.
    const lower = gableHipRoof({ w: width * 1.42, d: depth * 1.46, rise: roof * .4,
      color, ridgeColor: '#686451', segX: 22, segZ: 16 });
    lower.position.y = baseY + body * .48; parent.add(lower);
  }
  return hall;
}

export function stairs(parent, mats, { x, z, width = 3, length = 22, height, direction = -1 }) {
  const count = Math.max(5, Math.ceil(height / .22));
  for (let i = 0; i < count; i++) masonryBox(parent, mats.stone, x, 0,
    z + direction * (i + .5) * length / count, width, height * (i + 1) / count, length / count + .005);
}
