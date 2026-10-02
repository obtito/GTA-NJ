// 中华门现状模型。内部几何统一以米建立，出厂只作一次 xyz = 1 / 30 缩放
// （与城墙体系及紫峰同口径；门址地理落位不变）。
// 已核实：118.5 × 128 m，三重内瓮城/四道门，藏兵洞 6 + 7 + 7 + 7。
// 南京市文旅局（2023）：https://wlj.nanjing.gov.cn/ztzl/mcq/gzqk/202302/t20230228_3838766.html
// 南京地方志（2024）：https://dfz.nanjing.gov.cn/gzdt/202404/t20240416_4209910.html
// 后者给出 20.45 m 高度；地方志《南京建筑志》记券道 52.60 × 5.33 × 8.70 m，
// 上层 65.15 × 47.20 m。台阶分层、内院间距、各藏兵洞净尺寸/进深和曲道线位仍为建模估计，
// 尚无现状测绘图，不能将本模型称为测绘级复刻。现状不补建已消失的木构城楼或千斤闸。
import * as THREE from 'three';
import { vU } from './geo.js';
import { registerEnv } from './lib.js';
import { createArchitecturalLighting } from './architectural-lighting.js';

export const ZHONGHUAMEN = Object.freeze({
  widthM: 118.5, depthM: 128, heightM: 20.45,
  lowerDeckM: 10.75, upperDeckM: 18.65, parapetM: 1.8,
  mainPassageM: { width: 5.33, height: 8.7, depth: 52.6 },
  gateCentersM: [0, -75.8, -101.1, -124.88],
  verified: ['overall plan', 'four axial passages', 'three courtyards', '6+7+7+7 chambers'],
  estimated: ['level split', 'courtyard spacing', 'wall thickness', 'chamber sizes', 'modern stair route'],
});

let masonryTexture;
function brickTexture() {
  if (masonryTexture || typeof document === 'undefined') return masonryTexture || null;
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160;
  const c = canvas.getContext('2d');
  c.fillStyle = '#4b4d49'; c.fillRect(0, 0, 320, 160);
  for (let row = 0; row < 8; row++) for (let col = -1; col < 6; col++) {
    const n = ((row * 31 + col * 17 + 163) % 19) / 19;
    const shade = Math.round(118 + n * 31);
    c.fillStyle = `rgb(${shade},${shade + 1},${shade - 8})`;
    c.fillRect(col * 64 + (row % 2) * 32 + 1, row * 20 + 1, 62, 18);
    c.fillStyle = `rgba(45,46,38,${0.05 + n * 0.13})`;
    c.fillRect(col * 64 + (row % 2) * 32 + 5, row * 20 + 4, 45, 2);
  }
  masonryTexture = new THREE.CanvasTexture(canvas);
  masonryTexture.wrapS = masonryTexture.wrapT = THREE.RepeatWrapping;
  masonryTexture.colorSpace = THREE.SRGBColorSpace;
  masonryTexture.anisotropy = 4;
  return masonryTexture;
}

function metricUV(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = [];
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    uv.push((ny > nx && ny > nz ? p.getX(i) : nx > nz ? p.getZ(i) : p.getX(i)) / 4,
      (ny > nx && ny > nz ? p.getZ(i) : p.getY(i)) / 2);
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

function mesh(g, geo, material, name) {
  const m = new THREE.Mesh(metricUV(geo), material);
  m.name = name || 'zhonghuamen:masonry'; m.castShadow = m.receiveShadow = true; g.add(m); return m;
}

function box(g, material, x, y, z, w, h, d, name) {
  const geo = new THREE.BoxGeometry(w, h, d); geo.translate(x, y + h / 2, z);
  return mesh(g, geo, material, name);
}

// 以轮廓的凹口形成拱洞，再贯穿挤出；洞的地面与外界连通，无封底、黑片或假拱圈。
function notchedProfile(width, topAt, openings) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  for (const o of [...openings].sort((a, b) => a.x - b.x)) {
    const r = o.w / 2, spring = o.h - r;
    shape.lineTo(o.x - r, 0); shape.lineTo(o.x - r, spring);
    for (let i = 0; i <= 28; i++) {
      const a = Math.PI - i * Math.PI / 28;
      shape.lineTo(o.x + Math.cos(a) * r, spring + Math.sin(a) * r);
    }
    shape.lineTo(o.x + r, 0);
  }
  shape.lineTo(width / 2, 0); shape.lineTo(width / 2, topAt(width / 2));
  shape.lineTo(-width / 2, topAt(-width / 2)); shape.closePath();
  return shape;
}

function archWall(g, material, { width, height, depth, x = 0, y = 0, z = 0, openings, name }) {
  const geo = new THREE.ExtrudeGeometry(notchedProfile(width, () => height, openings),
    { depth, steps: 1, bevelEnabled: false, curveSegments: 28 });
  geo.translate(x, y, z - depth / 2);
  return mesh(g, geo, material, name);
}

function archDress(g, stone, { x = 0, y = 0, z, w, h, rot = 0, name = 'arch-stones' }) {
  const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = rot; group.name = name;
  const r = w / 2, spring = h - r, ring = Math.min(0.55, w * 0.13);
  const seg = 17;
  for (let i = 0; i < seg; i++) {
    const a = i * Math.PI / seg + 0.009, b = (i + 1) * Math.PI / seg - 0.009;
    const shape = new THREE.Shape();
    shape.moveTo(Math.cos(a) * r, spring + Math.sin(a) * r);
    shape.lineTo(Math.cos(a) * (r + ring), spring + Math.sin(a) * (r + ring));
    shape.lineTo(Math.cos(b) * (r + ring), spring + Math.sin(b) * (r + ring));
    shape.lineTo(Math.cos(b) * r, spring + Math.sin(b) * r); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
    geo.translate(0, 0, -0.09); mesh(group, geo, stone);
  }
  const rows = Math.max(1, Math.ceil(spring / 0.55));
  for (let i = 0; i < rows; i++) for (const side of [-1, 1]) {
    box(group, stone, side * (r + ring / 2), i * spring / rows, 0,
      ring, spring / rows - 0.018, 0.2);
  }
  g.add(group);
}

function battlements(g, material, x1, z1, x2, z2, baseY, { crenels = true, height = 1.8 } = {}) {
  const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
  const seg = new THREE.Group(); seg.position.set((x1 + x2) / 2, baseY, (z1 + z2) / 2);
  seg.rotation.y = -Math.atan2(dz, dx); g.add(seg);
  box(seg, material, 0, 0, 0, len, crenels ? 0.72 : height, 0.6, 'zhonghuamen:parapet');
  if (!crenels) return;
  const n = Math.max(1, Math.round(len / 2.8));
  for (let i = 0; i < n; i++) box(seg, material, -len / 2 + (i + 0.5) * len / n,
    0.72, 0, Math.min(1.45, len / n), height - 0.72, 0.72, 'zhonghuamen:merlon');
}

function namePlaque(g, x, y, z) {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const c = canvas.getContext('2d'); c.fillStyle = '#a39b87'; c.fillRect(0, 0, 512, 128);
  c.strokeStyle = '#686254'; c.lineWidth = 5; c.strokeRect(4, 4, 504, 120);
  c.fillStyle = '#383831'; c.font = 'bold 83px "KaiTi", "STKaiti", serif';
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('中 華 門', 256, 70);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 1.5), material); p.position.set(x, y, z); g.add(p);
}

/** 主门南外立面 z=0；地面 y=0；瓮城朝 -Z 展开；城墙在 x=±59.25 接入。 */
export function buildZhonghuamen() {
  const g = new THREE.Group(); g.name = 'zhonghuamen:present-day';
  const c = ZHONGHUAMEN, half = c.widthM / 2, lower = c.lowerDeckM, upper = c.upperDeckM;
  const stone = new THREE.MeshStandardMaterial({ color: '#efeee9', roughness: 0.97, map: brickTexture() });
  const dress = new THREE.MeshStandardMaterial({ color: '#929486', roughness: 1 });
  const paving = new THREE.MeshStandardMaterial({ color: '#c5c1b3', roughness: 1, map: brickTexture() });
  for (const material of [stone, dress, paving]) registerEnv(material, .45);
  const central = { x: 0, w: c.mainPassageM.width, h: c.mainPassageM.height };
  const lowerRooms = [-31.2, -20.8, -10.4, 10.4, 20.8, 31.2].map(x => ({ x, w: 5.4, h: 6.0 }));
  // 下层台体：一个贯通门道与六间朝北敞口、朝南封闭的藏兵洞。
  archWall(g, stone, { width: c.widthM, height: lower, depth: 51.3, z: -26.95,
    openings: [central, ...lowerRooms], name: 'zhonghuamen:main-lower-caves' });
  archWall(g, stone, { width: c.widthM, height: lower, depth: 1.3, z: -0.65,
    openings: [central], name: 'zhonghuamen:main-front' });
  archDress(g, dress, { z: 0.02, ...central, name: 'zhonghuamen:gate-1' });
  archDress(g, dress, { z: -52.62, ...central });
  const chambers = [];
  for (const room of lowerRooms) {
    archDress(g, dress, { ...room, z: -52.62 });
    chambers.push({ tier: 'main-lower', entrance: [room.x, 0, -52.6], width: room.w, height: room.h, direction: [0, 0, 1] });
  }
  // 退台的第二层：七间独立拱券藏兵洞，朝北平台开口，前部保留实体砖石。
  const upperW = 65.15, upperD = 47.2, front = -1.5, rear = front - upperD;
  const upperRooms = Array.from({ length: 7 }, (_, i) => ({ x: (i - 3) * 8.4, w: 6.0, h: 6.0 }));
  archWall(g, stone, { width: upperW, height: upper - lower, depth: 44.34,
    y: lower, z: rear + 44.34 / 2, openings: upperRooms, name: 'zhonghuamen:upper-caves' });
  box(g, stone, 0, lower, front - (upperD - 44.34) / 2, upperW, upper - lower, upperD - 44.34);
  for (const room of upperRooms) {
    archDress(g, dress, { ...room, y: lower, z: rear - 0.02 });
    chambers.push({ tier: 'main-upper', entrance: [room.x, lower, rear], width: room.w, height: room.h, direction: [0, 0, 1] });
  }
  for (const z of [front, rear]) battlements(g, stone, -upperW / 2 + 0.4, z, upperW / 2 - 0.4, z, upper);
  for (const x of [-upperW / 2 + 0.36, upperW / 2 - 0.36]) battlements(g, stone, x, rear, x, front, upper);
  // 主台低翼的垛口与两侧城墙连接，宽度不被女墙或假基座扩大。
  battlements(g, stone, -half + 0.4, -0.4, -upperW / 2 - 0.4, -0.4, lower);
  battlements(g, stone, upperW / 2 + 0.4, -0.4, half - 0.4, -0.4, lower);
  for (const x of [-half + 0.4, half - 0.4]) battlements(g, stone, x, -52.6, x, -0.4, lower);

  // 三道内门墙之间是露天院落，绝不以整块盒体填平瓮城。
  const courtWidth = 86.5;
  c.gateCentersM.slice(1).forEach((z, i) => {
    const depth = i === 2 ? 6 : 6.2;
    archWall(g, stone, { width: courtWidth, height: lower, depth, z, openings: [central],
      name: `zhonghuamen:inner-wall-${i + 2}` });
    for (const face of [-1, 1]) archDress(g, dress, { ...central, z: z + face * (depth / 2 + 0.02),
      name: face === 1 ? `zhonghuamen:gate-${i + 2}` : 'arch-stones' });
    battlements(g, stone, -courtWidth / 2, z + depth / 2 - 0.4,
      courtWidth / 2, z + depth / 2 - 0.4, lower);
    battlements(g, stone, -courtWidth / 2, z - depth / 2 + 0.4,
      courtWidth / 2, z - depth / 2 + 0.4, lower, { crenels: false, height: 0.9 });
  });
  // 墙外侧为直立护墙；东西马道在其内缓升，砖石断面真实包围各七个盲洞。
  const rampStart = -125.5, rampEnd = -52.6, rampLen = rampEnd - rampStart;
  const rampTop = z => 0.18 + (z - rampStart) / rampLen * (lower - 0.18);
  for (const side of [-1, 1]) {
    const innerX = side * courtWidth / 2, outerX = side * half;
    box(g, stone, side * (half - 0.65), 0, -90.3, 1.3, lower, 75.4);
    battlements(g, stone, side * (half - 0.4), -127.6, side * (half - 0.4), -52.6, lower);
    const roomZs = [-59, -65, -71, -77, -83, -89, -95];
    const rooms = roomZs.map(z => ({ x: z - (rampStart + rampEnd) / 2, w: 3.85, h: Math.min(4.5, rampTop(z - 1.93) - 0.55) }));
    const profile = notchedProfile(rampLen, u => rampTop(u + (rampStart + rampEnd) / 2), rooms);
    const geo = new THREE.ExtrudeGeometry(profile, { depth: 13.4, bevelEnabled: false, curveSegments: 28 });
    // profile X → local Z；挤出轴 → 本侧 X。对两侧保持洞口向院内。
    const position = geo.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const u = position.getX(i), y = position.getY(i), depth = position.getZ(i);
      position.setXYZ(i, innerX + side * depth, y, u + (rampStart + rampEnd) / 2);
    }
    // 该置换只在西侧保手性；东侧反转三角形顶点，保证单双面光照/射线一致。
    if (side === 1) {
      for (const key of Object.keys(geo.attributes)) {
        const attr = geo.attributes[key], item = attr.itemSize;
        for (let i = 0; i < attr.count; i += 3) for (let j = 0; j < item; j++) {
          const a = (i + 1) * item + j, b = (i + 2) * item + j, t = attr.array[a];
          attr.array[a] = attr.array[b]; attr.array[b] = t;
        }
      }
    }
    geo.computeVertexNormals(); mesh(g, geo, stone, `zhonghuamen:ramp-${side}`);
    // 盲洞后部留实体外墙，绝不贯穿城外。
    box(g, stone, outerX - side * 1.6, 0, -90.3, 1.9, lower, 75.4);
    rooms.forEach((room, i) => {
      const z = roomZs[i];
      archDress(g, dress, { x: innerX - side * 0.02, z, w: room.w, h: room.h, rot: -side * Math.PI / 2 });
      chambers.push({ tier: side < 0 ? 'west-ramp' : 'east-ramp', entrance: [innerX, 0, z],
        width: room.w, height: room.h, direction: [side, 0, 0] });
    });
    // 马道礓磋防滑条，随坡面升起；无需密集高面数石块。
    for (let i = 0; i < 86; i++) {
      const z = rampStart + (i + 0.5) * rampLen / 86;
      box(g, dress, side * 49.7, rampTop(z) + 0.012, z, 12.3, 0.055, 0.12, 'zhonghuamen:ramp-tread');
    }
  }

  // 今日游览曲道：在西侧台肩接一条上层游览步道；线位为示意待测。
  for (const side of [-1]) {
    const x = side * 37.5, stepCount = 34, run = 25.5, rise = upper - lower;
    for (let i = 0; i < stepCount; i++) {
      box(g, paving, x, lower, -48.9 + (i + 0.5) * run / stepCount,
        3.2, rise * (i + 1) / stepCount, run / stepCount, 'zhonghuamen:visitor-stair-estimate');
    }
    box(g, paving, side * 35, upper - 0.25, -22.7, 7.0, 0.25, 3.0, 'zhonghuamen:upper-landing');
  }
  // 一层地面薄铺装；厚度在 y≥0 内，门洞视线不会被填土遮挡。
  box(g, paving, 0, 0, -64, c.widthM, 0.04, c.depthM, 'zhonghuamen:paving');
  namePlaque(g, 0, 10.0, 0.11);
  g.scale.setScalar(vU(1));
  g.userData.metersPerUnit = 30;
  g.userData.chambers = chambers;
  g.userData.gatePassages = c.gateCentersM.map((z, i) => ({ index: i + 1, x: 0, z, width: central.w, height: central.h }));
  g.userData.presentDay = true;
  g.userData.modelEvidence = { verified: c.verified, estimated: c.estimated };
  g.userData.wallConnection = { halfWidthM: half, deckM: lower, z: 0 };
  // 夜景只点亮约 8–10 cm 的灯带；砖石仍由环境与共用聚光灯池照明。
  // 灯带绕行实体压顶、券洞内缘和马道边缘，不把整面城墙处理为发光材质。
  const lighting = createArchitecturalLighting(g);
  const strip = (points, name, width = 0.09) => lighting.strip(points, { width, name: `zhonghuamen:light:${name}` });
  const capY = lower + 0.055, halfLight = 0.05;
  // 主台与两侧外护墙在台顶连成 U 形实体。灯带沿其完整周界闭合，
  // 到北端沿各自墙头折返，不能跨过两段护墙之间没有台面的空地。
  // 半灯宽内收让管体恰好留在现有 118.5 × 128 m 轮廓内。
  const outerX = half - halfLight, innerGuardX = half - 2.55 + halfLight;
  const northZ = -128 + halfLight, southZ = -halfLight, mainRearZ = -52.6 + halfLight;
  strip([
    [-outerX, capY, southZ], [outerX, capY, southZ],
    [outerX, capY, northZ], [innerGuardX, capY, northZ],
    [innerGuardX, capY, mainRearZ], [-innerGuardX, capY, mainRearZ],
    [-innerGuardX, capY, northZ], [-outerX, capY, northZ],
    [-outerX, capY, southZ],
  ], 'lower-and-guard-perimeter', 0.10);
  // 上层四边沿女墙内侧的实际步道顶面铺成一环，转角连续、不穿过垛口底座。
  const upperEdgeX = upperW / 2 - 0.73, upperFrontZ = front - 0.40, upperRearZ = rear + 0.40;
  const upperCapY = upper + 0.055;
  strip([
    [-upperEdgeX, upperCapY, upperFrontZ], [upperEdgeX, upperCapY, upperFrontZ],
    [upperEdgeX, upperCapY, upperRearZ], [-upperEdgeX, upperCapY, upperRearZ],
    [-upperEdgeX, upperCapY, upperFrontZ],
  ], 'upper-perimeter', 0.10);
  for (const side of [-1, 1]) {
    lighting.spot({ position: [side * 19, lower - 0.08, 0.35], target: [side * 19, 4.3, 0],
      power: 90, range: 25, angle: 1.05, priority: 1.15 });
  }
  for (const x of [-19, 19]) lighting.spot({ position: [x, lower - 0.08, -52.96], target: [x, 4.3, -52.6],
    power: 90, range: 25, angle: 1.05, priority: 1.05 });
  for (const [z, face] of [[front, 1], [rear, -1]]) {
    lighting.spot({ position: [0, upper - 0.08, z + face * 0.4], target: [0, lower + 3.5, z],
      power: 85, range: 25, angle: 1.05, priority: 1.05 });
  }
  c.gateCentersM.slice(1).forEach((z, i) => {
    const depth = i === 2 ? 6 : 6.2;
    // 内门墙的前、后与两端在同一段顶面内闭合，留开两侧女墙的实体底座。
    const edgeX = courtWidth / 2 - halfLight, frontZ = z + depth / 2 - 0.8, backZ = z - depth / 2 + 0.8;
    strip([
      [-edgeX, capY, frontZ], [edgeX, capY, frontZ],
      [edgeX, capY, backZ], [-edgeX, capY, backZ], [-edgeX, capY, frontZ],
    ], `court-wall-${i + 2}-perimeter`, 0.10);
    for (const face of [-1, 1]) {
      const wallFace = z + face * depth / 2;
      for (const x of [-17, 17]) lighting.spot({ position: [x, lower - 0.08, wallFace + face * 0.38],
        target: [x, 4.2, wallFace], power: 85, range: 23, angle: 1.05, priority: 1 });
    }
  });
  // 沿实际坡面放置灯带，避免在藏兵洞前上空悬挂一条水平光线。
  for (const side of [-1, 1]) strip([
    [side * (courtWidth / 2 + 0.18), rampTop(-124.5) + 0.075, -124.5],
    [side * (courtWidth / 2 + 0.18), rampTop(-53) + 0.075, -53],
  ], `ramp-edge-${side}`, 0.08);
  // 四道门的南北两侧都照明；拱带略收进洞内，中心视线及净空检测射线不受遮挡。
  const gateFaces = [[-0.28, -52.32], ...c.gateCentersM.slice(1).map((z, i) => {
    const halfDepth = (i === 2 ? 6 : 6.2) / 2;
    return [z + halfDepth - 0.28, z - halfDepth + 0.28];
  })];
  const archRadius = central.w / 2 - 0.075, spring = central.h - central.w / 2;
  gateFaces.forEach((faces, i) => faces.forEach((z, face) => {
    const points = [[-archRadius, 0.35, z], [-archRadius, spring, z]];
    for (let j = 1; j <= 28; j++) {
      const a = Math.PI - j * Math.PI / 28;
      points.push([Math.cos(a) * archRadius, spring + Math.sin(a) * archRadius, z]);
    }
    points.push([archRadius, 0.35, z]);
    strip(points, `arch-${i + 1}-${face}`, 0.10);
    lighting.spot({ position: [1.65, 8.12, z], target: [central.w / 2, 3.8, z + (face ? 1.7 : -1.7)],
      power: 55, range: 12, angle: 1.0, priority: 0.85 });
  }));
  g.userData.setNight = lighting.setNight;
  return g;
}
