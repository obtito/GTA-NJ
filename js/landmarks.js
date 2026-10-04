// 南京地标 · 按公开实测数据精确建模
// 参考 GTA_SZ：地标单独精细构建，并在其占地范围内排除程序化底商建筑（EXCLUSION）。
//
// 【尺度约定】所有单位均为「场景单位」
//   vU(m)    竖向：1 单位 = 30 m —— 统一 3.33 倍竖向夸张，地标之间的高差关系真实
//   hU(m)    水平：1 单位 = 100 m —— 组群平面、轴线长度、桥跨、场地直径。优于"看得见真实比例尺"
//   footU(m) 单体截面：与竖向同比例 —— 仅用于**单件竖立物**（塔、楼、碑、华表、单体大殿）的自身平面，
//             使其长宽比不失真。凡有明确轴线/超大平台的组群一律用 hU，避免同一组内两套比例尺打架。
//
// 每个构建器都应保证：最高点相对地面 <=> heightM / metersPerUnit（默认 30；城墙体系的门同为 30——门体等比 1:30）。
// tools/smoke.mjs 会逐项对照顶点最高点，误差超过 8% 即报警。
//
// 中式屋顶全部改用 arch.js 的高保真构件（举折/反宇/翼角高度场 + 正脊/戗脊/正吻/斗拱/须弥座），
// 取代原先「LatheGeometry 旋转体」那种一眼假的圆形屋檐。

import * as THREE from 'three';
import { toV2, toV2List, vU, hU, footU, bearingToRot, makeRandom, clamp, distToPolyline } from './geo.js';
import { LANDMARKS, RIVER, CITY_GATES } from './data.js';
import { UNIT, mat, mergeStaticMeshes, registerEnv } from './lib.js';
import { terrainHeight } from './world.js';
import { buildZifeng } from './zifeng.js';
import { buildZhonghuamen } from './zhonghuamen.js';
import { gateFrame } from './wall-layout.js';
import { SPIRIT_BEASTS, addBeast, addWengZhong } from './spiritway.js';
import {
  hipRoof, gableHipRoof, gableRoof, pedestal, chineseHall, storiedPavilion,
} from './arch.js';

const C = {
  stone: '#c2bbb0', stoneD: '#948d80', brick: '#a8825f',
  red: '#a13f2c', redD: '#7a2f20', tileBlue: '#3c5f96', tileGold: '#c9a227',
  tileGreen: '#52704d', tileGrey: '#6e757a',
  white: '#eae7de', glassA: '#9fc0d8', glassB: '#7ea3c0', wood: '#8a5a34',
  dark: '#4b5158', metal: '#a8b0b6', green: '#4b7a3c', terrace: '#cfcac0',
  gold: '#d9b451', marble: '#e8e3d6',
};

const M_STONE = () => mat(C.stone, { rough: 0.96 });
const M_MARBLE = () => mat(C.marble, { rough: 0.92 });

/* 花岗石皮：神道石像生专用（纯色 Standard 在特写下就是塑料感）。
 * 细颗粒（云母/石英点）+ 风化蚀斑，同源 canvas 兼作 bump；单例缓存保合批。 */
let graniteMat = null;
function M_GRANITE() {
  if (graniteMat) return graniteMat;
  let tex = null;
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    let s = 77;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    c.fillStyle = '#c6bfb4'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2800; i++) {                       // 花岗岩颗粒
      const v = rnd();
      c.fillStyle = v > 0.78 ? '#8d867a' : v > 0.52 ? '#dcd6ca' : '#b3ac9f';
      c.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5);
    }
    for (let i = 0; i < 26; i++) {                         // 风化蚀斑
      const x = rnd() * 256, y = rnd() * 256, r = 8 + rnd() * 26;
      const g = c.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(118,114,102,0.22)'); g.addColorStop(1, 'rgba(118,114,102,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
  }
  graniteMat = new THREE.MeshStandardMaterial({
    color: tex ? 0xffffff : C.stone, roughness: 0.95,
    map: tex || null, bumpMap: tex, bumpScale: 0.25,
  });
  registerEnv(graniteMat, 0.5);
  return graniteMat;
}
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------- 基础构件（结构/非屋面用，保留） ---------------- */

function addBox(g, material, x, y, z, w, h, d, ry = 0) {
  const m = new THREE.Mesh(UNIT.box, material);
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}

function addCyl(g, material, x, y, z, r, h, seg = 16, rt = null, ry = 0) {
  const geo = new THREE.CylinderGeometry(rt === null ? r : rt, r, h, seg);
  geo.translate(0, h / 2, 0);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}

function addCone(g, material, x, y, z, r, h, seg = 12) {
  const geo = new THREE.ConeGeometry(r, h, seg);
  geo.translate(0, h / 2, 0);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

/** 华表 / 石望柱：六角收分柱身 + 承露盘 + 火珠 */
function stele(g, material, x, y, z, r, h, ry = 0) {
  addCyl(g, material, x, y, z, r, h * 0.9, 6, r * 0.82, ry);
  addCyl(g, material, x, y + h * 0.9, z, r * 1.45, r * 0.38, 10);   // 承露盘
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.85, 10, 8), material);
  cap.position.set(x, y + h * 0.9 + r * 0.62, z);                   // 火珠
  cap.castShadow = true;
  g.add(cap);
  return g;
}

/** 核拱屋顶（长条形）: len 沿 X，depth 沿 Z，rise 净矢高；底面在 y=0 */
function barrelVault(len, depth, rise, sext = 40) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, sext, 1, false, 0, Math.PI);
  geo.rotateZ(Math.PI / 2);            // 轴转到 X，拱腹朝 +Y
  geo.scale(len / 2, rise, depth / 2);
  geo.computeVertexNormals();
  return geo;
}

/** 石拱桥：桥面按正弦起拱，底面自 y=0 起，顶面最高点严格 = rise + deck（+rail 栏板另计） */
function humpBridge(g, material, x0, z0, x1, z1, width, rise, deck, rail = 0, segs = 16) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(dx, dz);
  const seg = len / segs;
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const top = rise * Math.sin(Math.PI * t) + deck;
    const cx = x0 + (dx * (i + 0.5)) / segs, cz = z0 + (dz * (i + 0.5)) / segs;
    addBox(g, material, cx, 0, cz, width, top, seg * 1.04, ang);
    if (rail > 0) {
      for (const s of [-1, 1]) {
        const ox = Math.cos(ang) * s * width * 0.5, oz = -Math.sin(ang) * s * width * 0.5;
        addBox(g, material, cx + ox, top, cz + oz, width * 0.12, rail, seg * 1.04, ang);
      }
    }
  }
}

/** 立柱一环 */
function colonnade(g, material, y, h, rx, rz, n, r = 0.05, round = true) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx, z = Math.sin(a) * rz;
    if (round) addCyl(g, material, x, y, z, r, h, 10);
    else addBox(g, material, x, y, z, r * 1.6, h, r * 1.6);
  }
}

/* ---------------- 高保真中式屋面（arch.js 接入） ---------------- */

/**
 * 中式屋顶 drop-in：w/d 为檐口跨度（已是出檐后的尺寸），h 为举高。
 * type: 'hip'(庑殿) | 'gable-hip'(歇山) | 'gable'(悬山/硬山)。
 * 返回 Group，底面贴 y=0，顶点升到 y=h。脊线/戗脊/正吻由 arch.js 生成。
 */
function cRoof(w, d, h, color = C.tileGold, type = 'gable-hip', opts = {}) {
  let roof;
  if (type === 'hip') {
    roof = hipRoof({
      w, d, rise: h, ridgeLen: opts.ridgeLen ?? w * 0.46, color,
      ridgeColor: opts.ridgeColor || C.tileGrey, segX: 18, segZ: 18, finial: !!opts.finial,
    });
  } else if (type === 'gable') {
    roof = gableRoof({
      w, d, rise: h, color, ridgeColor: opts.ridgeColor || C.tileGrey, segX: 14, segZ: 14,
    });
  } else {
    roof = gableHipRoof({
      w, d, rise: h, ridgeLen: opts.ridgeLen ?? w * 0.42, color,
      ridgeColor: opts.ridgeColor || C.tileGrey, segX: 18, segZ: 18, finial: !!opts.finial,
    });
  }
  roof.position.y = 0;
  return roof;
}

/** 一进厅堂（独立 group，总高 = wallH + roofH）；屋顶按形制生成真实翼角/戗脊。
 *  立面三件套：檐柱圈（朱柱探出墙皮）+ 檐下额枋彩画带 + 柱间槛窗（窗盒+竖棂）。
 *  ——光板盒墙在特写里就是「糊」的主因，柱框/彩画/窗棂给立面立骨架。 */
function makeHall(w, d, wallH, roofH, roofColor = C.red, wallColor = C.white, ry = 0, type = 'gable-hip') {
  const grp = new THREE.Group();
  addBox(grp, mat(wallColor, { rough: 0.9 }), 0, 0, 0, w * 0.94, wallH, d * 0.94, ry);
  const face = (d * 0.94) / 2;
  const n = Math.max(3, Math.round(w / hU(12)));
  const colM = mat('#8f2f26', { rough: 0.85 });
  for (let i = 0; i < n; i++) {
    const x = -w * 0.44 + (w * 0.88 * i) / (n - 1);
    for (const sz of [-1, 1]) addCyl(grp, colM, x, 0, sz * (face + footU(0.35)), footU(0.5), wallH, 10);
  }
  for (const sz of [-1, 1]) {                                          // 额枋彩画带（青地金缘）+ 檐口压线
    addBox(grp, mat('#2c5f4f', { rough: 0.8 }), 0, wallH - vU(1.7), sz * (face + footU(0.42)), w * 0.92, vU(1.05), footU(0.8), ry);
    addBox(grp, mat('#c8a24b', { rough: 0.6 }), 0, wallH - vU(0.6), sz * (face + footU(0.44)), w * 0.92, vU(0.22), footU(0.85), ry);
  }
  const winM = mat('#3c3a34', { rough: 0.95 });
  for (let i = 0; i < n - 1; i++) {                                    // 柱间槛窗：窗盒 + 三竖棂
    const x0 = -w * 0.44 + (w * 0.88 * i) / (n - 1), x1 = -w * 0.44 + (w * 0.88 * (i + 1)) / (n - 1);
    const xm = (x0 + x1) / 2, ww = (x1 - x0) * 0.66;
    addBox(grp, winM, xm, vU(1.1), face + 0.006, ww, wallH - vU(3.2), 0.012, ry);
    for (let k = -1; k <= 1; k++)
      addBox(grp, mat('#57534a', { rough: 0.9 }), xm + (k * ww) / 3.2, vU(1.1), face + 0.014, footU(0.35), wallH - vU(3.2), 0.01, ry);
  }
  const rf = cRoof(w * 1.2, d * 1.2, roofH, roofColor, type);
  rf.position.y = wallH;
  rf.rotation.y = ry;
  grp.add(rf);
  return grp;
}

/**
 * 亭（开敞）：台基 + 柱圈 + 攒尖顶（ridgeLen=0）。
 * 入参 totalH 为「台基顶面以上的亭子总高」；内部按 台基16% / 柱身54% / 屋面30% 切分，
 * 并为宝顶预留约 14% 的举高，使「台基 + 柱身 + 屋面 + 宝顶」严格等于 totalH（不突破 data.js 总高）。
 * 玄武湖的洲台(padH)另计，组合最高点 = padH + totalH = pavH。
 */
function makePavilion(w, d, totalH, roofH, color = C.red, wallColor = C.white, ry = 0, bays = 4) {
  const grp = new THREE.Group();
  const pedestalH = totalH * 0.16;
  const colTop = totalH * 0.70;            // 柱顶（含台基）
  const colH = colTop - pedestalH;
  // 屋面举高：为攒尖宝顶预留 ~14% 的空间，使 台基+柱身+屋面+宝顶 === totalH
  const rise = Math.min(roofH ?? totalH * 0.28, (totalH - colTop) / 1.141);
  const p = pedestal(w * 1.18, d * 1.18, pedestalH, C.marble);
  grp.add(p);
  const colMat = mat(wallColor, { rough: 0.9 });
  const nx = bays + 1, nz = Math.max(2, Math.round(bays * 0.7));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
    const x = -w / 2 + (w * i) / (nx - 1), z = -d / 2 + (d * j) / (nz - 1);
    addCyl(grp, colMat, x, pedestalH, z, totalH * 0.05, colH, 10);
  }
  const rf = hipRoof({ w: w * 1.25, d: d * 1.25, rise, ridgeLen: 0, color, finial: true, segX: 12, segZ: 12 });
  rf.position.y = colTop;
  rf.rotation.y = ry;
  grp.add(rf);
  return grp;
}

/**
 * 楼阁式塔：总高严格等于 totalH（含塔刹）。
 * 每层的屋顶改为 arch 攒尖（ridgeLen=0）——方塔四坡、八角塔亦以四坡近似，
 * 取代原先旋转对称的 Lathe 圆顶。
 */
function makePagoda({ tiers, totalH, baseW, sides = 4, bodies = ['#e8e3d5', '#c9b9a0'], roofs = [C.tileGold, C.red], ry = 0 }) {
  const grp = new THREE.Group();
  const finialH = Math.max(baseW * 0.6, totalH * 0.11);
  const avail = totalH - finialH;
  const prof = [];
  for (let i = 0; i < tiers; i++) {
    const k = 1 - (i / tiers) * 0.5;
    prof.push({ w: baseW * k, body: baseW * 0.80 * k, roof: baseW * 0.42 * k });
  }
  let hp = 0;
  for (let i = 0; i < tiers; i++) hp += prof[i].body + prof[i].roof * 0.55;
  const s = avail / hp;
  let y = 0;
  for (let i = 0; i < tiers; i++) {
    const { w, body, roof } = prof[i];
    const bh = body * s, rh = roof * s;
    if (sides > 5) addCyl(grp, mat(bodies[i % 2], { rough: 0.9 }), 0, y, 0, w * 0.5, bh, sides, w * 0.47, ry + Math.PI / sides);
    else addBox(grp, mat(bodies[i % 2], { rough: 0.9 }), 0, y, 0, w * 0.66, bh, w * 0.66, ry + Math.PI / 4);
    const rf = hipRoof({ w: w * 0.92, d: w * 0.92, rise: rh, ridgeLen: 0, color: roofs[i % 2], segX: 10, segZ: 10 });
    rf.position.y = y + bh;
    rf.rotation.y = ry + (sides > 5 ? Math.PI / 8 : 0);
    grp.add(rf);
    y += bh + rh * 0.55;
  }
  addCyl(grp, mat(C.gold, { metal: 0.55, rough: 0.35 }), 0, y, 0, baseW * 0.07, finialH * 0.72, 10, baseW * 0.045);
  const pearlR = Math.max(0.02, baseW * 0.13);
  const pearl = new THREE.Mesh(new THREE.SphereGeometry(pearlR, 12, 10), mat(C.gold, { metal: 0.6, rough: 0.3 }));
  pearl.position.y = totalH - pearlR;      // 顶点严格到 totalH
  grp.add(pearl);
  return grp;
}

/* ---------------- 河流转向（桥梁自动正交过江） ---------------- */

const RIVER_PTS = toV2List(RIVER.pts);
const EYE_BRANCH_PTS = toV2List((RIVER.branches && RIVER.branches[0] ? RIVER.branches[0] : RIVER).pts);
function riverCrossBearing(x, z, pts = RIVER_PTS) {
  let best = Infinity, dir = [1, 0];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / (len * len);
    t = clamp(t, 0, 1);
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; dir = [dx / len, dz / len]; }
  }
  const bearing = (Math.atan2(dir[0], -dir[1]) * 180) / Math.PI;
  return (bearing + 90 + 360) % 360;
}

/* ---------------- 真实轮廓挤压（紫峰等） ---------------- */

function centroid(pts) {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
}
function toLocal(pts, cx, cz) {
  return pts.map(([lo, la]) => { const [x, z] = toV2(lo, la); return [x - cx, z - cz]; });
}

/** 竖向（无收分）挤压一个多边形为墙体，y0->y1 */
function extrudePoly(pts, y0, y1, material) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1])));
  const h = y1 - y0;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, 0);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** 收分挤压：y0 处按 r0 缩放、y1 处按 r1 缩放（向形心收进）→ 锥形塔身 */
function taperPoly(pts, y0, r0, y1, r1, material) {
  const c = centroid(pts);
  const sc = (p, f) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f];
  const n = pts.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const a = sc(pts[i], r0), b = sc(pts[(i + 1) % n], r0);
    const cc = sc(pts[(i + 1) % n], r1), d = sc(pts[i], r1);
    const base = i * 4;
    pos.push(a[0], y0, a[1], b[0], y0, b[1], cc[0], y1, cc[1], d[0], y1, d[1]);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** 螺旋管（绕 Y 轴的 helix，用于紫峰桅杆的斜纹网格外壳）。dir=±1 控制旋向 */
function helixTube(radius, height, turns, tubeR, dir, segments = 160) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = dir * turns * Math.PI * 2 * t;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, t * height, Math.sin(a) * radius));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segments, tubeR, 6, false);
}

/* ---------- 紫峰大厦专属：龙鳞幕墙 + 空中花园（高保真立面） ---------- */

/* ===== 六段式阶梯主体构建器（实景照片实测标定）=====
   实测方法：用天线尖（450 m）与圆顶基座（381 m）在照片上标定像素比例，逐段量出台阶高度；
   且同一道台阶在塔身左右两侧的高度差 ~10–14 m → 退台绕塔身盘旋上升，
   这就是「不同角度看到的轮廓不一样」的几何本质（taperPoly 绕形心均匀缩放做不到这一点）。
   模型化：三角平面 3 条主边 = 3 个面，每面的分段表按 FACE_OFF 逐面错移；
   顶点收分比 = 相邻两条边所属面的均值（圆角过渡）；台阶只在错移面跳变 →
   台阶盖面只在那个面出现 → 螺旋露台自动生成。 */
function profileR(prof, h) {
  // 分段线性插值；同高度两个条目 = 台阶跳变（取跳后值）
  if (h <= prof[0][0]) return prof[0][1];
  for (let i = 1; i < prof.length; i++) {
    if (h <= prof[i][0] + 1e-9) {
      const h0 = prof[i - 1][0], r0 = prof[i - 1][1], h1 = prof[i][0], r1 = prof[i][1];
      if (h1 - h0 < 1e-9) return r1;
      return r0 + (r1 - r0) * ((h - h0) / (h1 - h0));
    }
  }
  return prof[prof.length - 1][1];
}

/* 实测分段（roofH 比）：S1 0–0.730 长直板 → S2 0.730–0.895 → S3 0.895–0.942
   → S4 0.942–0.979 → S5 0.979–1.000 屋顶 → S6 冠部层叠带（另建）。
   台阶跳变量按照片逐级加大（越高收得越急）。
   坑：buildSteppedBody 的顶点收分比取「相邻两面均值」→ 台阶深度到顶点处减半，
   再被逐面错移拆成两道半步 → 跳变必须给到 ~2 倍，均值后才有肉眼可读的 6–7%。 */
const ZF_STEP_BASE = [
  [0.000, 1.000],
  [0.730, 0.950], [0.730, 0.830],     // S1→S2 台阶（278 m，72F 观光厅/机械层）
  [0.895, 0.800], [0.895, 0.670],     // S2→S3 台阶（341 m）
  [0.942, 0.640], [0.942, 0.540],     // S3→S4 台阶（359 m）
  [0.979, 0.510], [0.979, 0.420],     // S4→S5 台阶（373 m）
  [1.000, 0.420],                     // 屋顶（各面收敛，上接层叠冠带）
];
const ZF_FACE_OFF = [0.0, 0.018, 0.036];   // 各面台阶错移量（绕向螺旋；符号可翻转校准）

function buildSteppedBody(g, pts, roofHm, wallMat, capMat, opts = {}) {
  const c = centroid(pts);
  const n = pts.length;
  const off = opts.faceOff || [0, 0, 0];
  // 1) 边长排序：3 条最长边 = 3 个主面（绕向排序）；其余边归给绕向下一条主边所在面
  const edgeLen = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const faceEdges = edgeLen.map((l, i) => [l, i]).sort((a, b) => b[0] - a[0]).slice(0, 3)
    .map((x) => x[1]).sort((a, b) => a - b);
  const edgeFace = new Array(n);
  {
    let f = 0;
    for (let i = 0; i < n; i++) {
      if (f < 2 && i > faceEdges[f]) f++;          // 主边 fe_k 及之后、下一主边之前 → 面 f
      edgeFace[i] = f;
      if (i === faceEdges[f]) { /* 主边本身属于面 f */ }
    }
  }
  // 2) 每面独立分段表（按 FACE_OFF 错移，断点钳制到 [0,1]，最后收敛到屋顶 r=0.42）
  const faceProf = [0, 1, 2].map((f) => {
    const o = off[f] || 0;
    const prof = [];
    for (const [h, r] of ZF_STEP_BASE) {
      const hc = Math.min(1, h === 0 ? 0 : h + (h >= 1 ? 0 : o));
      prof.push([hc, r]);
    }
    prof.sort((a, b) => a[0] - b[0]);
    return prof;
  });
  // 3) 顶点收分比 = 相邻两边所属面的均值
  const rAt = (vtx, hFrac) => {
    const f1 = edgeFace[(vtx - 1 + n) % n], f2 = edgeFace[vtx];
    return (profileR(faceProf[f1], hFrac) + profileR(faceProf[f2], hFrac)) / 2;
  };
  // 4) 高度断点并集
  const hs = new Set([0, 1]);
  for (const prof of faceProf) for (const [h] of prof) { if (h > 0 && h < 1) hs.add(h); }
  const H = [...hs].sort((a, b) => a - b);
  const sc = (p, r) => [c[0] + (p[0] - c[0]) * r, c[1] + (p[1] - c[1]) * r];
  const wallPos = [], capPos = [];
  const quad = (arr, A, B, C, D) => { arr.push(...A, ...B, ...C, ...A, ...C, ...D); };
  const eps = 0.0008;
  // 5) 墙面：每边 × 每个高度区间一个四边形（顶点各自收分）。
  //    坑：profileR 在「恰好等于断点高度」时返回跳后值 → 若墙面直接用 rAt(h)，
  //    断点两侧的墙都接到跳后 r，台阶被抹平（实测渲染成光板）。所以区间下端取 rAt(h0+eps)、
  //    上端取 rAt(h1-eps) —— 让跳变真实发生，水平盖面负责填补台阶。
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let k = 0; k < H.length - 1; k++) {
      const h0 = H[k], h1 = H[k + 1];
      if (h1 - h0 < 1e-6) continue;
      const y0 = vU(h0 * roofHm), y1 = vU(h1 * roofHm);
      const j = (i + 1) % n;
      const ra0 = rAt(i, h0 + eps), rb0 = rAt(j, h0 + eps);
      const ra1 = rAt(i, h1 - eps), rb1 = rAt(j, h1 - eps);
      const A0 = sc(a, ra0), B0 = sc(b, rb0), A1 = sc(a, ra1), B1 = sc(b, rb1);
      quad(wallPos, [A0[0], y0, A0[1]], [B0[0], y0, B0[1]], [B1[0], y1, B1[1]], [A1[0], y1, A1[1]]);
    }
  }
  // 6) 台阶盖面（螺旋露台）：在每条边、每个断点处，若 r 有跳变则补水平盖面
  for (let k = 1; k < H.length - 0; k++) {
    const hB = H[k];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const j = (i + 1) % n;
      const raM = rAt(i, hB - eps), rbM = rAt(j, hB - eps);
      const raP = rAt(i, hB + eps), rbP = rAt(j, hB + eps);
      if (Math.abs(raP - raM) < 1e-4 && Math.abs(rbP - rbM) < 1e-4) continue;   // 该面无台阶
      const y = vU(hB * roofHm);
      const A0 = sc(a, raM), B0 = sc(b, rbM), A1 = sc(a, raP), B1 = sc(b, rbP);
      quad(capPos, [A0[0], y, A0[1]], [B0[0], y, B0[1]], [B1[0], y, B1[1]], [A1[0], y, A1[1]]);
    }
  }
  // 7) 屋顶封面（三角扇）
  {
    const y = vU(roofHm);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const A = sc(pts[i], rAt(i, 1)), B = sc(pts[j], rAt(j, 1));
      capPos.push(c[0], y, c[1], A[0], y, A[1], B[0], y, B[1]);
    }
  }
  const mk = (pos, m) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  mk(wallPos, wallMat);
  if (capPos.length) mk(capPos, capMat);
  return { rAt, edgeLen, edgeFace };
}
/** 给定场景高度（vU 单位）与收分控制点，返回该处平面相对形心的收分比 */
function planScaleAt(yScene, ctrl) {
  const m = yScene * 30;                          // vU 逆变换：1 单位 = 30 m
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [h0, r0] = ctrl[i], [h1, r1] = ctrl[i + 1];
    if (m >= h0 && m <= h1) {
      const t = (m - h0) / (h1 - h0 || 1);
      return r0 + (r1 - r0) * t;
    }
  }
  return ctrl[ctrl.length - 1][1];
}

/* 龙鳞幕墙：沿收分三角棱柱表面铺「外凸板块」，每两层错位半模，
   形成紫峰标志性的龙鳞肌理（SOM 原设计：三角单元幕墙、平面上外凸、两层错位半模）。
   单 InstancedMesh（noMerge，保持 1 draw call，不被展开合批）。 */
/* 龙鳞幕墙（统一立面语言）：玻璃鳞片 + 窗光融为一体。
   鳞片是青蓝玻璃的「龙鳞」肌理；窗光是贴在鳞面上的自发光层（普通混合 + 顶点色），
   与鳞片共用同一套网格 —— 立面只此一套语言，白天窗光 opacity=0 完全不可见。
   窗光明暗（关键：three r160 vendor 的 instanceColor 不给片元着色 → 用合并几何 + 顶点色，单 draw call）：
   · 每层随机「入住率」occ（0.20–0.70）：有的楼层偏暗、有的偏亮 → 立面整层明暗节奏（真实夜景感）；
   · 每扇窗亮度独立 b = 0.34+0.76·rand^1.3（幂次偏暗），~7% 再 ×1.3「亮灯户」→ 有暗有亮、层次分明；
   · 暖色 ~75%（琥珀，逐户随机）+ ~25% 冷白；boostFloors 指定整层高亮（如 72 层观光厅 281.8 m）。 */
function addDragonScale(g, pts, yBot, yTop, scaleMat, glowMat, ctrl, boostFloors) {
  const c = centroid(pts);
  const band = vU(4.0);            // 每层 ~4 m
  const module = 0.042;            // 沿周长步距 ~4.2 m
  const protr = 0.016;             // 外凸深度（对照照片：真鳞 0.5 m，远处是细腻纹理；
                                   // 早先 0.04=1.2 m 太深，立面被读成「毛糙锥面」）
  const ny = Math.ceil((yTop - yBot) / band);
  const scaleData = [], winPos = [], winCol = [];
  const litBase = new THREE.Color(1.0, 0.52, 0.20);    // 琥珀（浅了会被 ACES 压缩洗白、r-b 差距消失）
  const coolBase = new THREE.Color(0.50, 0.68, 1.0);   // 冷白窗（少量）
  const col = new THREE.Color();
  // ctrl 两种形态：数组 → planScaleAt 全棱柱统一收分；函数 (vtxIdx, yScene) → 逐顶点收分（螺旋退台）
  const rOf = (typeof ctrl === 'function') ? ctrl : (vtx, y) => planScaleAt(y, ctrl);
  for (let f = 0; f < ny; f++) {
    const y = yBot + (f + 0.5) * band;
    const poly = pts.map((p, j) => { const r = rOf(j, y); return [c[0] + (p[0] - c[0]) * r, c[1] + (p[1] - c[1]) * r]; });
    const n = poly.length;
    const off = (f % 2) ? module * 0.5 : 0;          // 每两层错位半模（龙鳞）
    // 本层「入住率」：整层明暗节奏（真实夜景不是每层均匀亮、也没有全黑楼层）
    const occ = Math.random();
    let litP = 0.20 + 0.50 * occ, bMul = 1.0;
    if (boostFloors) {
      const yM = y * 30;                             // 场景单位 → 米（vU=m/30）
      for (const bf of boostFloors) if (Math.abs(yM - bf.yM) < bf.dy) { litP = Math.max(litP, 0.95); bMul = bf.k; }
    }
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1e-6;
      const ux = dx / len, uz = dz / len;
      let Nx = uz, Nz = -ux;                          // 边法线
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (Nx * (c[0] - mx) + Nz * (c[1] - mz) > 0) { Nx = -Nx; Nz = -Nz; }  // 取外法线
      const steps = Math.max(1, Math.floor(len / module));
      for (let s = 0; s <= steps; s++) {
        const d = (s * module + off) % len;
        const px = a[0] + ux * d, pz = a[1] + uz * d;
        const ang = Math.atan2(Nx, Nz);
        scaleData.push([px + Nx * protr * 0.5, y, pz + Nz * protr * 0.5, ang]);        // 玻璃鳞片
        if (Math.random() < litP) {
          // 坑：鳞片盒外表面在 1.5×protr 处（实例定位 0.5p + 盒几何平移 0.5p），
          //     窗光必须放在 1.5×protr 之外，否则被埋进盒里、深度测试全剔 → 一片黑。
          winPos.push([px + Nx * (protr * 1.5 + 0.012), y, pz + Nz * (protr * 1.5 + 0.012), ang]);
          const Ang = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.random()));   // 暖窗比例：均值 0.75，逐户随机
          let b2 = 0.34 + 0.76 * Math.pow(Math.random(), 1.3);               // 明暗分布：多偏暗、少数亮（层次）
          b2 *= bMul;
          if (Math.random() < 0.07) b2 = Math.min(1.5, b2 * 1.3);            // 少数「亮灯户」
          const base = Math.random() < Ang ? litBase : coolBase;             // 暖为主，偶尔冷白
          col.copy(base).multiplyScalar(b2);
          if (Math.random() < Math.max(0, Ang - 0.5) * 0.9) col.r = Math.min(1.25, col.r * 1.12);  // 暖倾向者更暖
          winCol.push(col.clone());
        }
      }
    }
  }
  if (!scaleData.length) return;
  // 玻璃鳞片（青蓝玻璃系，单 draw call）
  const sg = new THREE.BoxGeometry(module * 0.94, band * 0.9, protr);
  sg.translate(0, 0, protr * 0.5);
  const scaleMesh = new THREE.InstancedMesh(sg, scaleMat, scaleData.length);
  const mm = new THREE.Matrix4();
  scaleData.forEach((p, i) => { mm.makeRotationY(p[3]); mm.setPosition(p[0], p[1], p[2]); scaleMesh.setMatrixAt(i, mm); });
  scaleMesh.instanceMatrix.needsUpdate = true;
  scaleMesh.castShadow = true; scaleMesh.receiveShadow = true;
  scaleMesh.userData.noMerge = true;
  g.add(scaleMesh);
  // 窗光：合并 BufferGeometry + 顶点色（instanceColor 在 r160 不给片元着色；vertexColors 是受支持路径）。
  // 材质色(glowMat.color，setNight 拉 0→1.6) × 顶点色(暖/冷 × 独立亮度) = 最终发光。
  if (winPos.length) {
    const wQ = module * 0.70, hQ = band * 0.58;      // 窗面略小于鳞片 → 读作「鳞内亮窗」
    const posArr = new Float32Array(winPos.length * 12);
    const colArr = new Float32Array(winPos.length * 12);
    const idxArr = new Uint32Array(winPos.length * 6);
    const hw = wQ * 0.5, hh = hQ * 0.5;
    winPos.forEach((p, i) => {
      const ca = Math.cos(p[3]), sa = Math.sin(p[3]);
      const qx = [-hw, hw, hw, -hw], qy = [-hh, -hh, hh, hh];
      for (let k = 0; k < 4; k++) {
        const o = (i * 4 + k) * 3;
        posArr[o] = p[0] + qx[k] * ca;               // rotationY(θ)：x'=x·cosθ，z'=-x·sinθ（z=0 的平面）
        posArr[o + 1] = p[1] + qy[k];
        posArr[o + 2] = p[2] - qx[k] * sa;
        colArr[o] = winCol[i].r; colArr[o + 1] = winCol[i].g; colArr[o + 2] = winCol[i].b;
      }
      const o6 = i * 6, v0 = i * 4;
      idxArr[o6] = v0; idxArr[o6 + 1] = v0 + 1; idxArr[o6 + 2] = v0 + 2;
      idxArr[o6 + 3] = v0; idxArr[o6 + 4] = v0 + 2; idxArr[o6 + 5] = v0 + 3;
    });
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    wg.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    wg.setIndex(new THREE.BufferAttribute(idxArr, 1));
    const winMesh = new THREE.Mesh(wg, glowMat);
    winMesh.userData.noMerge = true;                 // 顶点色网格不参与合批，保持单 draw call
    winMesh.frustumCulled = false;                   // 顶点已含实例位置，包围球计算跨大量实例易失准
    g.add(winMesh);
  }
}

/* 空中花园 / 中庭：SOM 原设计「每 4 层设置的中庭，在办公层为每层多提供两个转角办公室空间」。
   因此中庭是**立面凹进**（不是外凸的绿环——外凸会读成「把楼层隔开的箍」），
   凹进处填入绿化露台，形成盘龙意象的深绿嵌板。 */
function addSkyGardens(g, pts, ctrl, roofHm) {
  const c = centroid(pts);
  const fracs = [0.20, 0.34, 0.48, 0.62, 0.76];     // 5 处中庭，沿高度均匀（≈每 4 层一处的放大表达）
  const gardenMat = mat('#5c8f42', { rough: 1 });     // 深绿（退进阴影里，不抢立面）
  for (const fr of fracs) {
    const y = vU(roofHm * fr);
    const r = planScaleAt(y, ctrl) * 0.965;          // 凹进 3.5%（嵌入立面，而非外凸）
    const poly = pts.map((p) => [c[0] + (p[0] - c[0]) * r, c[1] + (p[1] - c[1]) * r]);
    g.add(extrudePoly(poly, y, y + vU(2.2), gardenMat));
  }
}

/* 注：窗光已并入 addDragonScale（加色发光层，与鳞片同网格），不再单独建网格，避免双层立面冲突。 */

/* 裙房屋顶花园：绿化薄板 + 点缀小乔木（实例化，noMerge）。treeCount 控制乔木数量以调节基座调性。 */
function addRoofGarden(g, poly, yTop, treeCount = 16) {
  const c = centroid(poly);
  const n = poly.length;
  let cx = 0, cz = 0; for (const p of poly) { cx += p[0]; cz += p[1]; } cx /= n; cz /= n;
  const green = mat('#4f7a42', { rough: 1 });
  g.add(extrudePoly(poly, yTop, yTop + vU(0.6), green));        // 屋顶绿化薄板（沉绿，不抢主体）
  const trees = [];
  for (let k = 0; k < treeCount; k++) {
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 0.42;
    trees.push([cx + Math.cos(a) * rr, yTop + vU(0.6), cz + Math.sin(a) * rr]);
  }
  const treeGeo = new THREE.ConeGeometry(0.05, 0.14, 6).translate(0, 0.07, 0);
  const treeMat = mat('#35622e', { rough: 1 });
  const ti = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
  const mm = new THREE.Matrix4();
  trees.forEach((p, i) => {
    const s = 0.7 + Math.random() * 0.4;
    mm.makeScale(s, s, s); mm.setPosition(p[0], p[1], p[2]); ti.setMatrixAt(i, mm);
  });
  ti.instanceMatrix.needsUpdate = true; ti.userData.noMerge = true;
  g.add(ti);
}

/* 紫峰大厦真实轮廓（OSM 实测，单位：经纬度；运行时换算为场景坐标并本地化） */
const ZIFENG_MAIN = [
  [118.7781014, 32.062422], [118.7777385, 32.0627166], [118.7777183, 32.0627721],
  [118.7779384, 32.0628862], [118.7782096, 32.0629544], [118.7782587, 32.0629002],
  [118.7782337, 32.0624534], [118.7781786, 32.0624179],
];
const ZIFENG_PODIUM = [
  [118.7772309, 32.0628825], [118.7771468, 32.0628171], [118.7779653, 32.0621463],
  [118.7779922, 32.0621749], [118.7780214, 32.0622111], [118.7780327, 32.0622472],
  [118.7780394, 32.062293], [118.7780102, 32.0623444], [118.7780282, 32.0623596],
  [118.7780507, 32.0623329], [118.7780664, 32.0623044], [118.7780596, 32.062253],
  [118.7780664, 32.0622073], [118.7781014, 32.062422], [118.7777385, 32.0627166],
  [118.7777183, 32.0627721], [118.7782096, 32.0629544], [118.7782587, 32.0629002],
  [118.7782691, 32.0633083], [118.7782294, 32.0632523], [118.7781727, 32.0632555],
  [118.7781708, 32.0633083], [118.7778912, 32.0633131], [118.7778496, 32.0632491],
  [118.7775227, 32.0632427], [118.7773411, 32.0631668], [118.7773103, 32.0631404],
  [118.777162, 32.0630128], [118.7771527, 32.062989], [118.7771553, 32.0629652],
  [118.7771623, 32.0629402],
];
const ZIFENG_SEC = [
  [118.7773411, 32.0631668], [118.7773103, 32.0631404], [118.777162, 32.0630128],
  [118.7771527, 32.062989], [118.7771553, 32.0629652], [118.7771623, 32.0629402],
  [118.7772309, 32.0628825], [118.7774319, 32.0627071], [118.7775322, 32.0630049],
];

/* ---------------- 各地标构建器 ---------------- */

export const BUILDERS = {
  /* ===== 紫峰大厦 450 m / 屋顶 381 m / 塔尖 69 m / 裙房 44 m / 副楼 99.5 m =====
     主楼采用 OSM 实测的「切角三角」平面，逐段收分；裙房/副楼亦用真实轮廓。 */
  supertall(lm) {
    if (lm.id === 'zifeng') return buildZifeng(lm);
    const p = lm.params;
    const g = new THREE.Group();
    const [cx, cz] = toV2(lm.lon, lm.lat);
    // 单件竖立物平面必须用 footU（= m/30，与竖向 vU 同比例）；否则竖向被夸 3.33 倍 → 塔身变细针。
    const FOOT = 100 / 30;
    const mainPts = toLocal(ZIFENG_MAIN, cx, cz).map(([x, z]) => [x * FOOT, z * FOOT]);
    const podiumPts = toLocal(ZIFENG_PODIUM, cx, cz).map(([x, z]) => [x * FOOT, z * FOOT]);
    const secPts = toLocal(ZIFENG_SEC, cx, cz).map(([x, z]) => [x * FOOT, z * FOOT]);

    // 材质（对照实景照片）：紫峰幕墙是「浅银绿灰」高反光玻璃，不是深青 ——
    // 早先 #356b78 在弱光下整栋近黑（与照片完全两回事）。metal 降到 0.45：
    // 保留 env 太阳反射带的同时，漫反射也能抬亮背光面（均匀环境球下 metal 0.6 整体发闷）。
    const glass = mat('#9fb6bb', { metal: 0.45, rough: 0.22, env: 1.3, side: THREE.DoubleSide });
    const glass2 = mat('#b0c4c7', { metal: 0.4, rough: 0.26, env: 1.2, side: THREE.DoubleSide }); // 裙房/副楼：同系略亮
    const scaleMat = mat('#b2c6c9', { metal: 0.55, rough: 0.16, env: 1.4, side: THREE.DoubleSide }); // 龙鳞：银绿玻璃系
    const steel = mat('#c2ccd2', { metal: 0.6, rough: 0.3, side: THREE.DoubleSide });
    // 窗光层（顶点色：每扇窗独立暖/冷与明暗）。必须普通混合而非加色：
    // 加色会把窗色叠加到被月光照亮的幕墙上（显示空间直接相加）→ 亮窗全部饱和成白（实测 warm 26/7983）；
    // 普通混合 = 窗是自发光面，色相保真；白天 opacity=0 完全不可见。
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    glowMat.color.setScalar(0.0);

    // 裙房 44 m（7 层，OSM 真实轮廓）
    g.add(taperPoly(podiumPts, 0, 1.0, vU(p.podium), 0.985, glass2));
    // 副楼 99.5 m（24 层，OSM 真实轮廓）
    g.add(taperPoly(secPts, 0, 1.0, vU(p.secondary), 0.92, glass2));

    /* ===== 主楼主体：六段式阶梯收分（实景照片实测标定）=====
       关键认知（两条都来自用户纠正 + 照片验证）：
       ① 紫峰是六段式：S1 0–0.730 长直板 → S2 0.730–0.895 → S3 0.895–0.942
          → S4 0.942–0.979 → S5 0.979–1.0 → S6 冠部层叠带（下接圆顶桅杆）；
       ② 退台绕塔身盘旋：同一道台阶在不同面高度差 ~10–14 m，所以不同角度轮廓不同。
       buildSteppedBody 按此建模（每面独立分段表 + 顶点均值 + 螺旋露台盖面）。 */
    const roofH = p.roofH, totalH = p.totalH;
    const capMat = mat('#b7c2c7', { metal: 0.5, rough: 0.42, side: THREE.DoubleSide });  // 露台盖面：浅铝灰
    const body = buildSteppedBody(g, mainPts, roofH, glass, capMat, { faceOff: ZF_FACE_OFF });
    const rAtV = (vtx, yScene) => body.rAt(vtx, (yScene * 30) / roofH);   // 场景单位 → roofH 比
    // 平均收分比（需要整圈统一尺寸的场合：观光厅玻璃带、冠缘发光带、圆顶底径）
    const avgR = (yScene) => {
      let s = 0;
      for (let i = 0; i < mainPts.length; i++) s += body.rAt(i, (yScene * 30) / roofH);
      return s / mainPts.length;
    };

    // 龙鳞幕墙 + 窗光（统一立面语言）：贴螺旋退台表面，单实例化 + 顶点色窗光
    // boostFloors：72 层观光厅（紫峰实测 281.8 m ≈ roofH 0.740，恰在 S1→S2 大台阶处）整层高亮。
    // ⚠ 按 roofH 比例、且仅紫峰本体（totalH≥400）启用，否则 towercluster 每栋塔都会多一圈亮带。
    const boostFloors = p.totalH >= 400 ? [{ yM: roofH * 0.740, dy: 2.4, k: 1.3 }] : null;
    addDragonScale(g, mainPts, vU(3), vU(roofH * 0.987), scaleMat, glowMat, rAtV, boostFloors);

    // 空中花园（每 4 层设置的中庭，SOM 原设计）：凹进式绿化嵌板（外凸会读成「箍」）
    addSkyGardens(g, mainPts, [[0, 1.0], [roofH * 0.46, 0.92], [roofH * 0.73, 0.90], [roofH, 0.44]], roofH);

    // 72 层观光厅（紫峰实测 281.8 m = roofH 的 0.740）：全景观光层，四周通体落地玻璃 ——
    // 用玻璃带表现，而不是加一圈凸出的钢环（那会读成「把楼层隔开的箍」）。
    // 高度按 roofH 比例（supertall 被 towercluster 复用，不可写死米数）。
    const obsM = roofH * 0.740;
    if (p.totalH >= 400) {                            // 仅紫峰本体（450 m）有观光厅
      g.add(taperPoly(mainPts, vU(obsM) - vU(0.4), avgR(vU(obsM) - vU(0.4)) * 0.998,
                      vU(obsM) + vU(3.4), avgR(vU(obsM) + vU(3.4)) * 0.998, glass2));
    }

    /* ===== 冠部 / 塔尖（对照实景照片重做）=====
       照片事实：屋顶之上是「圆顶（光滑过渡）→ 粗壮圆柱桅杆（表面有明显螺旋斜纹网格，
       直径 ≈ 屋顶段宽度的 1/4，高 ≈ 塔尖的 55%）→ 细天线（塔尖顶 30%）」。
       早先版本是「细锥 + 1 m 细针」，与实物完全两回事（避雷针分离感的根源之一）。
       ⚠ 高度一律按塔尖高度 spireH0 比例（supertall 被 towercluster 复用）。 */
    const crownY0 = vU(roofH);
    const wTop = avgR(crownY0);                        // 屋顶处平均收分比（各面收敛值）
    const mastTop = vU(totalH);
    const spireH0 = mastTop - crownY0;               // 塔尖全高（紫峰 69 m）
    const steelMast = mat('#93a4aa', { metal: 0.6, rough: 0.3, side: THREE.DoubleSide });  // DoubleSide：穹顶底面/台带内壁不可背面剔除
    const steelDark = mat('#7d8c92', { metal: 0.55, rough: 0.38, side: THREE.DoubleSide });

    /* ===== 冠部 / 塔尖：与塔身同一套「台阶收分」语言，一体化（用户明确要求：
       整个建筑和塔尖是一体的，除了分节处，塔顶不要有太大突出 —— 放弃独立的
       圆顶 + 粗桅杆方案）。屋顶之上延续台阶收分：台阶逐级加密、收分逐级加大，
       平滑收敛到天线径，没有任何独立的「帽子/穹顶/粗杆」构件。 */
    const cSteps = [                                 // [roofH 之上的高度比, 收分比]（台阶语言）
      [0.000, wTop],
      [0.030, wTop * 0.920],                          // 台阶 1
      [0.070, wTop * 0.780],                          // 台阶 2
      [0.120, wTop * 0.600],                          // 台阶 3
      [0.180, wTop * 0.420],                          // 台阶 4
      [0.260, wTop * 0.260],                          // 台阶 5
      [0.360, 0.100],                                 // 台阶 6（≈10 m 全宽，与天线径衔接）
      [0.440, 0.052],
      [0.600, 0.028],                                 // 过渡到细天线径
      [1.000, 0.028],
    ];
    const cLocal = centroid(mainPts);
    for (let i = 0; i < cSteps.length - 1; i++) {
      const y0c = crownY0 + spireH0 * cSteps[i][0];
      const y1c = crownY0 + spireH0 * cSteps[i + 1][0];
      const r0c = cSteps[i][1], r1c = cSteps[i + 1][1];
      g.add(taperPoly(mainPts, y0c, r0c, y1c, r1c, steelMast));        // 侧壁（同语言）
      if (r0c - r1c > 0.05) {                                          // 台阶处补实心盖（仅分节处允许中断）
        const capPoly = mainPts.map((q) => [cLocal[0] + (q[0] - cLocal[0]) * r1c, cLocal[1] + (q[1] - cLocal[1]) * r1c]);
        g.add(extrudePoly(capPoly, y1c - vU(0.10), y1c, steelMast));
      }
    }
    // 末端实心收头（0.028 收分比 ≈ 3 m 全宽 → 直接被天线穿过）
    {
      const rEnd = cSteps[cSteps.length - 1][1];
      const capPoly = mainPts.map((q) => [cLocal[0] + (q[0] - cLocal[0]) * rEnd, cLocal[1] + (q[1] - cLocal[1]) * rEnd]);
      g.add(extrudePoly(capPoly, mastTop - vU(0.12), mastTop, steelMast));
    }

    // 细天线（塔尖顶段内穿出 → 总高 450 m）：从最后一级台阶内部起，与塔尖连续一体
    const mastBase = crownY0 + spireH0 * 0.42;
    const antR = 0.016;                              // ≈0.5 m 直径（照片：细天线）
    addCyl(g, steelMast, 0, mastBase, 0, antR, mastTop - mastBase, 10);

    // 冠缘发光带：夜间身份光。坑：早先用 taperPoly(..., wTop*1.02, ..., wTop*1.02, ...) 生成
    // 一个「上下等宽、半宽 10 m、高 1.2 m」的扁盘贴屋面 —— 它比塔尖根部（半宽 9.5 m）还宽，
    // 视觉上就是卡在「塔尖与避雷针之间」的一圈突出圆盘。改为：随塔尖收分、不超出塔身，
    // 并统一竖直拉伸到塔尖首段高度（是「塔尖表面的一圈光」，不是「额外加的一圈环」）。
    const glowY0 = crownY0 + vU(0.2), glowY1 = crownY0 + vU(2.4);
    const crownGlowMat = new THREE.MeshStandardMaterial({
      color: '#ffcaa0', emissive: new THREE.Color('#ff8a3c'), emissiveIntensity: 0.0, roughness: 0.5,
    });
    const crownGlow = taperPoly(
      mainPts,
      glowY0, avgR(glowY0) * 1.006,                    // 仅外凸 0.6%（贴面发光线，不是凸缘）
      glowY1, avgR(glowY1) * 1.006,
      crownGlowMat,
    );
    crownGlow.userData.noMerge = true;
    g.add(crownGlow);

    // 两盏航空障碍灯（红）：顶灯（双闪）+ 桅杆中灯（错相单闪）。
    // 加大本体 + 加色光晕：远景/静帧里也要读得出红点（此前 1–2 px 常被阈值吃掉）。
    const beaconMatTop = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 1 });
    const beaconMatMid = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 1 });
    const beaconTop = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), beaconMatTop);
    beaconTop.position.y = mastTop - 0.11; beaconTop.userData.beacon = true;
    const beaconMid = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), beaconMatMid);   // 细天线上的中灯（缩小）
    beaconMid.position.y = mastBase + (mastTop - mastBase) * 0.5; beaconMid.userData.beacon = true;
    g.add(beaconTop); g.add(beaconMid);
    // 光晕（加色红晕，随障碍灯同步闪烁）
    const haloMatTop = new THREE.MeshBasicMaterial({ color: 0xff5040, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false });
    const haloMatMid = haloMatTop.clone();
    const haloTop = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), haloMatTop);
    haloTop.position.copy(beaconTop.position);
    const haloMid = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), haloMatMid);
    haloMid.position.copy(beaconMid.position);
    g.add(haloTop); g.add(haloMid);

    // 裙房屋顶花园（基座调性压低：乔木更少更小）
    addRoofGarden(g, podiumPts, vU(p.podium), 16);

    // 副楼：与主楼同一套统一立面（龙鳞 + 窗光），薄冠收口，形成家族感
    addDragonScale(g, secPts, vU(2), vU(p.secondary * 0.97), scaleMat, glowMat, [[0, 1.0], [p.secondary, 0.92]]);
    g.add(taperPoly(secPts, vU(p.secondary * 0.97), 0.92, vU(p.secondary), 0.8, steel));

    g.userData.beacon = beaconTop;
    g.userData.beacons = [beaconTop, beaconMid];
    g.userData.crownGlow = crownGlow;
    if (!g.userData.__winMats) g.userData.__winMats = [glowMat];   // 窗光层（加色）统一受夜间控制

    // 夜间控制：窗光拉亮（材质色 × 顶点色 = 每扇窗独立的暖/冷与明暗）、冠缘发光环身份光
    let nightK = 0;                                                // 障碍灯/光晕也随夜况显隐（白天不闪红点）
    g.userData.setNight = (k) => {
      const ks = clamp(k, 0, 1);
      nightK = ks;
      if (g.userData.__winMats) for (const m of g.userData.__winMats) { m.color.setScalar(lerp(0.0, 1.7, ks)); m.opacity = ks; }
      if (crownGlowMat) crownGlowMat.emissiveIntensity = lerp(0.0, 1.6, ks);
      // 冠部夜间泛光（真实紫峰：圆顶/桅杆夜间被冷白泛光照亮，是夜景剪影的一部分）
      steelMast.emissive.setRGB(0.36, 0.42, 0.50).multiplyScalar(lerp(0.0, 0.55, ks));
      steelDark.emissive.setRGB(0.30, 0.36, 0.44).multiplyScalar(lerp(0.0, 0.45, ks));
    };
    // 逐帧：航空障碍灯双闪序列（顶灯双闪、中灯错相单闪；熄灭期保持微亮，避免静帧全隐）
    g.userData.tick = (t) => {
      const ph = t % 2.0;
      const topOn = (ph < 0.14) || (ph > 0.34 && ph < 0.48) ? 1 : 0.18;
      const midOn = (ph > 1.0 && ph < 1.16) ? 1 : 0.18;
      beaconMatTop.opacity = topOn * nightK; beaconTop.scale.setScalar(topOn > 0.5 ? 1 : 0.55);
      beaconMatMid.opacity = midOn * nightK; beaconMid.scale.setScalar(midOn > 0.5 ? 1 : 0.55);
      haloMatTop.opacity = 0.85 * topOn * nightK;
      haloMatMid.opacity = 0.65 * midOn * nightK;
    };
    return g;
  },

  /* ===== 新街口商圈 ===== */
  block(lm) {
    const p = lm.params;
    const g = new THREE.Group();
    const rand = makeRandom(20240401);
    for (let i = 0; i < p.towers; i++) {
      const a = (i / p.towers) * Math.PI * 2 + 0.4;
      const r = hU(p.r) * (0.35 + rand() * 0.65);
      const w = hU(45 + rand() * 45), d = hU(40 + rand() * 40);
      const h = vU(p.hMin + rand() * (p.hMax - p.hMin));
      addBox(g, mat(rand() > 0.55 ? '#cfd6dc' : '#d9d2c6', { rough: 0.45, metal: 0.3 }),
        Math.cos(a) * r, 0, Math.sin(a) * r, w, h, d, rand() * 0.6);
    }
    const ringMat = mat('#e2e6ea', { rough: 0.85 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(hU(p.ringR), 0.09, 8, 48).rotateX(Math.PI / 2), ringMat);
    ring.position.y = vU(p.ringH);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      addCyl(g, mat('#d5d8db', { rough: 0.9 }), Math.cos(a) * hU(p.ringR), 0, Math.sin(a) * hU(p.ringR), 0.07, vU(p.ringH), 8);
    }
    g.add(ring);
    return g;
  },

  /* ===== 玄武湖五洲：洲上亭榭 + 堤桥 =====
     全组最高点 = 亭榭顶面 = pavH（实测 16 m）。洲台 2.2 m + 亭榭自身 13.8 m ===== */
  lake(lm) {
    const p = lm.params;
    const g = new THREE.Group();
    const spots = [[-5.5, -2.6], [1.8, -5.4], [5.6, 0.8], [-1.6, 4.4], [4.6, 3.6]];
    const padH = vU(2.2);                       // 洲面高出常水位约 2.2 m
    const bodyH = vU(p.pavH) - padH;            // 亭榭自身 13.8 m
    const bankMat = mat('#7f8f58', { rough: 1 });
    spots.forEach((s, i) => {
      addCyl(g, bankMat, s[0], 0, s[1], hU(p.islandR), padH, 22, hU(p.islandR * 0.82));
      const pav = makePavilion(footU(26), footU(20), bodyH, bodyH * 0.5, i % 2 ? C.red : C.redD, C.white, i * 0.7);
      pav.position.set(s[0], padH, s[1]);
      g.add(pav);
    });
    // 堤桥
    const bridgeMat = mat(C.stone, { rough: 0.95 });
    const pairs = [[[-4.2, -0.9], [1.0, -2.6]], [[3.6, 0.2], [0.8, -3.4]], [[-0.8, 3.6], [-4.4, 1.8]]];
    for (let i = 0; i < (p.bridge || 3); i++) {
      const [p0, p1] = pairs[i % pairs.length];
      humpBridge(g, bridgeMat, p0[0], p0[1], p1[0], p1[1], footU(p.bridgeW), vU(p.bridgeRise), vU(0.9), vU(1.1));
    }
    return g;
  },

  /* ===== 紫金山：标高 448.9 m 的头陀岭 + 海拔约 267 m 的紫金山天文台 ===== */
  mountainref(lm, ctx) {
    const p = lm.params;
    const g = new THREE.Group();
    const gy = (xx, zz) => terrainHeight(ctx.x + xx, ctx.z + zz) - ctx.groundY;
    const pav = makePavilion(footU(20), footU(15), vU(6), vU(8), C.tileGold, '#e2dccb', 0.4);
    pav.position.y = gy(0, 0);
    g.add(pav);
    addCyl(g, mat('#b9bfc4', { metal: 0.4, rough: 0.5 }), footU(16), gy(footU(16), 0), 0, 0.05, vU(28), 6);
    if (p.observatory) {
      const ox = hU(620), oz = -hU(300);
      const oy = gy(ox, oz);
      const o = new THREE.Group();
      addBox(o, M_MARBLE(), 0, 0, 0, footU(24), vU(6), footU(17));
      const domeGeo = new THREE.SphereGeometry(footU(9), 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      const dome = new THREE.Mesh(domeGeo, mat('#c9d2d6', { metal: 0.35, rough: 0.45 }));
      dome.position.y = vU(6);
      dome.castShadow = true;
      o.add(dome);
      addBox(o, mat('#5d666c', { rough: 0.6 }), 0, vU(6) + footU(2), footU(7), footU(6), footU(7), footU(1.5));
      o.position.set(ox, oy, oz);
      g.add(o);
    }
    return g;
  },

  /* ===== 中山陵：博爱坊—墓道—陵门—碑亭—392 级石阶—祭堂—墓室（轴线约 720 m，落差 73 m） ===== */
  mausoleum(lm, ctx) {
    const p = lm.params;
    const g = new THREE.Group();
    // 轴原点 = 祭堂（data.js 坐标口径即祭堂），轴线向南下到博爱坊。
    // 旧版把祭堂放在原点以北 640 m，等于整条轴线向北错位、祭堂被推到主峰脚下。
    const zGate = hU(720);           // 博爱坊
    const zLingMen = hU(280);        // 陵门
    const zBeiTing = hU(210);        // 碑亭
    const zTop = 0;                  // 祭堂所在第十层平台 = 轴原点
    const zTomb = -hU(38);           // 墓室

    const gy = (zz) => terrainHeight(ctx.x, ctx.z + zz) - ctx.groundY;
    const drop = vU(p.drop);
    const tOf = (zz) => clamp((zGate - zz) / (zGate - zTop), 0, 1);
    const groundAt = (zz) => Math.max(gy(zz), gy(zGate) + drop * tOf(zz)) - 0.02;

    // 博爱坊：宽 17.3 m，高 11 m，三间四柱冲天式，蓝琉璃瓦歇山
    const pw = hU(p.gateW), ph = vU(p.gateH);
    const post = M_MARBLE();
    for (const sx of [-pw / 2, -pw / 6, pw / 6, pw / 2]) {
      const inner = Math.abs(sx) < pw / 3;                 // 冲天式：中柱穿檐而出
      addBox(g, post, sx, groundAt(zGate), zGate, footU(1.8), ph * (inner ? 1.14 : 1.05), footU(1.8));
      addCyl(g, post, sx, groundAt(zGate), zGate + footU(0.5), footU(1.0), vU(1.3), 8);  // 抱鼓石
      if (inner) {                                         // 冲天柱头冠
        const dome = new THREE.Mesh(new THREE.SphereGeometry(footU(1.15), 10, 8), post);
        dome.position.set(sx, groundAt(zGate) + ph * 1.14, zGate);
        dome.castShadow = true;
        g.add(dome);
      }
    }
    for (const sx of [-pw / 2, pw / 2]) {
      const rf = cRoof(footU(7), footU(6), vU(p.gateH * 0.22), C.tileBlue, 'gable-hip');
      rf.position.set(sx, groundAt(zGate) + ph, zGate);
      g.add(rf);
    }
    addBox(g, post, 0, groundAt(zGate) + ph * 0.72, zGate, pw * 0.96, vU(1.6), footU(1.4));
    addBox(g, mat('#2c4a76', { rough: 0.6 }), 0, groundAt(zGate) + ph * 0.72 + vU(1.6), zGate + footU(0.8), pw * 0.3, vU(2.2), footU(0.3));  // 「博爱」匾额
    const gRoof = cRoof(pw * 1.4, footU(6), vU(p.gateH * 0.24), C.tileBlue, 'gable-hip');
    gRoof.position.set(0, groundAt(zGate) + ph, zGate);
    g.add(gRoof);

    // 墓道
    const roadMat = mat('#cfcabf', { rough: 0.95 });
    const NS = 14;
    for (let i = 0; i < NS; i++) {
      const z0 = zLingMen + ((zGate - zLingMen) * i) / NS;
      const z1 = zLingMen + ((zGate - zLingMen) * (i + 1)) / NS;
      const zm = (z0 + z1) / 2, seg = Math.abs(z1 - z0) * 1.03;
      addBox(g, roadMat, 0, groundAt(zm) - 0.04, zm, hU(p.tombRoadW), 0.05, seg);
      addBox(g, mat('#b9b3a6', { rough: 1 }), 0, groundAt(zm) - 0.02, zm, hU(p.tombRoadC), 0.03, seg);
    }
    for (let i = 0; i < 16; i++) {
      const zz = zLingMen + ((zGate - zLingMen) * (i + 0.5)) / 16;
      for (const sx of [-1, 1]) {
        addCyl(g, mat('#4a5b3d', { rough: 1 }), sx * hU(14), groundAt(zz), zz, footU(3), vU(7), 6, footU(1));
      }
    }

    // 陵门：宽 24 m，进深 8.8 m，高 16.5 m，单檐歇山蓝琉璃瓦
    const lmW = hU(p.lingMenW), lmD = hU(p.lingMenD), lmH = vU(p.lingMenH);
    const yLM = groundAt(zLingMen);
    addBox(g, M_MARBLE(), 0, yLM, zLingMen, lmW, lmH * 0.62, lmD);
    const lmRoof = cRoof(lmW * 1.25, lmD * 1.4, lmH * 0.42, C.tileBlue, 'gable-hip');
    lmRoof.position.set(0, yLM + lmH * 0.62, zLingMen);
    g.add(lmRoof);
    for (let i = 0; i < 5; i++) {
      const x = -lmW * 0.4 + (i / 4) * lmW * 0.8;
      addBox(g, mat('#3a3a36', { rough: 1 }), x, yLM, zLingMen + lmD / 2 + 0.01, hU(3.2), lmH * 0.5, 0.04);
    }

    // 碑亭：边长约 12 m，高 17 m，重檐歇山；碑高约 9 m
    const yBT = groundAt(zBeiTing);
    const bt = makeHall(hU(p.pavilionW), hU(p.pavilionW), vU(p.pavilionH * 0.55), vU(p.pavilionH * 0.45), C.tileBlue, C.marble, 0, 'gable-hip');
    bt.position.set(0, yBT, zBeiTing);
    g.add(bt);
    const guiMat = mat('#7d7668', { rough: 0.95 });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(hU(2.0), 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), guiMat);
    shell.scale.set(1, vU(1.3) / hU(2.0), 1.25);
    shell.position.set(0, yBT, zBeiTing);
    shell.castShadow = shell.receiveShadow = true;
    g.add(shell);                                          // 龟趺（赑屃）背甲
    addBox(g, guiMat, 0, yBT + vU(0.6), zBeiTing + hU(1.9), hU(1.1), vU(0.9), hU(1.0));   // 昂首
    addBox(g, guiMat, 0, yBT, zBeiTing - hU(2.1), hU(1.2), vU(0.6), hU(0.8));             // 尾
    addBox(g, mat('#8f8878', { rough: 0.9 }), 0, yBT + vU(1.2), zBeiTing, hU(3.0), vU(p.steleH), hU(1.1));

    // 392 级石阶分 10 段、8 个平台
    const secStart = zBeiTing - hU(30);
    const nSec = p.sections;
    for (let i = 0; i < nSec; i++) {
      const za = secStart + ((zTop - secStart) * i) / nSec;
      const zb = secStart + ((zTop - secStart) * (i + 1)) / nSec;
      const zm = (za + zb) / 2;
      const w = hU(52 - (i * 2.2));
      addBox(g, mat(C.terrace, { rough: 0.95 }), 0, groundAt(zm) - 0.06, zm, w, Math.max(0.05, groundAt(za) - groundAt(zm) + 0.12), Math.abs(zb - za) * 1.02);
      if (i < nSec - 1) {
        addBox(g, mat('#d8d2c6', { rough: 0.95 }), 0, groundAt(zb) - 0.05, zb, w * 1.04, 0.06, hU(9));
      }
    }

    // 第十层大平台
    const yHall = groundAt(zTop);
    addBox(g, mat('#ded8cb', { rough: 0.92 }), 0, yHall - vU(2), zTop, hU(p.terraceW), vU(2.2), hU(p.terraceD));
    // 祭堂：长 30 m（进深）× 宽 22.5 m（面阔）× 高 26 m，蓝琉璃瓦重檐歇山
    const hW = hU(p.hallW), hD = hU(p.hallL), hH = vU(p.hallH);
    addBox(g, M_MARBLE(), 0, yHall, zTop, hW, hH * 0.58, hD);
    // 南立面：三座圆拱门（祭堂原型为西式拱券立面）+ 额匾。
    // 组内 +z=南（博爱坊 zGate=+7.2 为准），门面必须装在南侧——首版 face=zTop−hD/2
    // 装到了背面，从台阶方向(南)看整个立面是光板。贴面件一律探出南墙皮。
    const face = zTop + hD / 2;
    const doorM = mat('#2b2b28', { rough: 1 });
    for (const dx of [-hW * 0.27, 0, hW * 0.27]) {
      const dH = hH * 0.4, dW = footU(3.2);
      addBox(g, doorM, dx, yHall, face + 0.01, dW, dH, 0.04);
      const arch = new THREE.Mesh(new THREE.CircleGeometry(dW / 2, 12, 0, Math.PI), doorM);
      arch.position.set(dx, yHall + dH, face + 0.008);     // 半圆拱券脸（朝南）
      g.add(arch);
      addBox(g, mat('#e8e3d6', { rough: 0.7 }), dx, yHall + dH + vU(1.1), face + 0.006, footU(2.2), vU(1.4), 0.012);       // 门额
    }
    addBox(g, mat('#2c4a76', { rough: 0.55 }), 0, yHall + hH * 0.5, face + 0.006, hW * 0.42, vU(2.0), 0.012);             // 「民族民权民生」额匾
    for (let i = 0; i < 6; i++) {                          // 南立面壁柱（望柱式分划）
      const x = -hW * 0.42 + (i / 5) * hW * 0.84;
      addCyl(g, mat('#efe9da', { rough: 0.85 }), x, yHall, zTop + hD / 2 + footU(1), footU(1.7), hH * 0.58, 10);
    }
    // 东西山墙各两樘圆拱窗 + 檐口线脚（花岗石本色，不施彩画——中山陵建筑语汇）
    {
      const sideM = mat('#3c3a34', { rough: 0.95 });
      for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) {
        const zz = zTop - hD * 0.26 + i * hD * 0.52;
        const sxc = sx * (hW / 2 + 0.006);
        addBox(g, sideM, sxc, yHall + hH * 0.14, zz, 0.012, hH * 0.28, footU(2.0));
        const wa = new THREE.Mesh(new THREE.CircleGeometry(footU(1.0), 10, 0, Math.PI), sideM);
        wa.position.set(sxc, yHall + hH * 0.14 + hH * 0.28, zz);
        wa.rotation.y = (sx * Math.PI) / 2;
        g.add(wa);
      }
      for (const [ty, th, tw] of [[hH * 0.6, hH * 0.028, 1.0], [hH * 0.66, hH * 0.022, 0.97]])
        addBox(g, mat('#efe9da', { rough: 0.8 }), 0, yHall + ty, zTop, hW * tw, th, hD * tw);
    }
    addBox(g, mat('#cfc7b4', { rough: 0.9 }), 0, yHall + hH * 0.58, zTop, hW * 1.05, hH * 0.06, hD * 1.05);
    const hallRoof1 = cRoof(hW * 1.28, hD * 1.25, hH * 0.26, C.tileBlue, 'gable-hip');
    hallRoof1.position.set(0, yHall + hH * 0.64, zTop);
    g.add(hallRoof1);
    const hallRoof2 = cRoof(hW * 1.05, hD * 1.02, hH * 0.32, C.tileBlue, 'gable-hip');
    hallRoof2.position.set(0, yHall + hH * 0.74, zTop);
    g.add(hallRoof2);
    for (const sx of [-1, 1]) stele(g, M_MARBLE(), sx * hW * 0.72, yHall, zTop + hD / 2 + hU(9), footU(1.0), vU(p.huaBiaoH));

    // 墓室：直径 18 m，高 11 m
    const yTb = groundAt(zTomb) + vU(3);
    addCyl(g, mat('#ded8cb', { rough: 0.92 }), 0, groundAt(zTomb), zTomb, hU(p.tombDia) * 0.5, vU(3), 24);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(hU(p.tombDia) * 0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      mat('#e2dccb', { rough: 0.9 }),
    );
    core.scale.set(1, vU(p.tombCoreH - 1) / (hU(p.tombDia) * 0.5), 1);
    core.position.set(0, yTb, zTomb);
    core.castShadow = true;
    g.add(core);
    return g;
  },

  /* ===== 明孝陵：下马坊—大金门—四方城—神道石刻—棂星门—享殿—方城明楼—宝顶 ===== */
  tomb(lm, ctx) {
    const p = lm.params;
    const g = new THREE.Group();
    const gy = (xx, zz) => terrainHeight(ctx.x + xx, ctx.z + zz) - ctx.groundY;
    const zSpirit = hU(760);
    const zLingXing = hU(330);
    const zMen = hU(230);
    const zBei = hU(160);
    const zXiang = hU(60);
    const zFang = 0;
    const zBao = -hU(210);
    // 序列前奏（真实平面是「曲尺」弯道，模型维持直线轴简化）：下马坊—大金门—四方城。
    const zXiaMa = hU(1650), zDaJin = hU(1430), zSiFang = hU(1220);
    const zYuHe = hU(290);       // 御河桥（棂星门与文武方门之间的金水河上）

    /* ---- 下马坊：两柱一开间石坊（「诸司官员下马」谕禁碑） ---- */
    {
      const y0 = gy(0, zXiaMa);
      for (const sx of [-1, 1]) {
        addBox(g, M_GRANITE(), sx * hU(3), y0, zXiaMa, footU(1.6), vU(1), footU(1.6));       // 抱柱基石
        addBox(g, M_GRANITE(), sx * hU(3), y0 + vU(1), zXiaMa, footU(0.85), vU(6.5), footU(0.85)); // 坊柱
      }
      addBox(g, M_GRANITE(), 0, y0 + vU(7.5), zXiaMa, hU(7.6), vU(1.1), footU(1.1));          // 额枋
      addBox(g, mat('#b6ae9c', { rough: 0.9 }), 0, y0 + vU(6.1), zXiaMa + footU(0.6), hU(4.6), vU(1.5), footU(0.12)); // 谕禁碑匾
      const xmRoof = cRoof(hU(9), footU(3), vU(1.9), C.tileGrey, 'hip');
      xmRoof.position.set(0, y0 + vU(8.3), zXiaMa);
      g.add(xmRoof);
    }

    /* ---- 大金门：砖券城台门楼（明孝陵正门，三孔券洞单檐歇山） ---- */
    {
      const y0 = gy(0, zDaJin);
      addBox(g, mat(C.brick, { rough: 0.95 }), 0, y0, zDaJin, hU(28), vU(9), hU(12));
      const djFace = zDaJin + hU(6) + 0.01;                                                   // 南墙皮
      for (const dx of [-hU(8), 0, hU(8)]) {
        addBox(g, mat('#2b2b28', { rough: 1 }), dx, y0, djFace, hU(4.4), vU(5.2), 0.04);       // 券洞暗盒
        const arch = new THREE.Mesh(new THREE.CircleGeometry(hU(2.2), 12, 0, Math.PI), mat('#2b2b28', { rough: 1 }));
        arch.position.set(dx, y0 + vU(5.2), djFace + 0.008);
        g.add(arch);
      }
      addBox(g, mat('#9a917e', { rough: 0.85 }), 0, y0 + vU(9) - vU(0.7), djFace - 0.004, hU(24), vU(0.8), 0.06); // 檐口线脚
      const djRoof = cRoof(hU(32), hU(14), vU(3.8), C.tileGrey, 'gable-hip');
      djRoof.position.set(0, y0 + vU(9), zDaJin);
      g.add(djRoof);
    }

    /* ---- 四方城：神功圣德碑碑亭（26 m 见方重檐，内置永乐碑+龟趺） ---- */
    {
      const y0 = gy(0, zSiFang);
      addBox(g, M_GRANITE(), 0, y0, zSiFang, hU(30), vU(1.2), hU(30));                        // 台基
      addBox(g, mat(C.brick, { rough: 0.95 }), 0, y0 + vU(1.2), zSiFang, hU(24), vU(7.5), hU(24)); // 亭身
      for (const [px, pz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {                             // 四面券洞暗盒
        const w = px ? 0.04 : hU(4.2), d = pz ? 0.04 : hU(4.2);
        addBox(g, mat('#2b2b28', { rough: 1 }), px * (hU(12) + 0.01), y0 + vU(1.2), pz * (hU(12) + 0.01), w, vU(4.6), d);
      }
      const sfRoof1 = cRoof(hU(27), hU(27), vU(3.4), C.tileGrey, 'hip');
      sfRoof1.position.set(0, y0 + vU(8.7), zSiFang);
      g.add(sfRoof1);
      const sfRoof2 = cRoof(hU(18), hU(18), vU(4.4), C.tileGrey, 'hip');
      sfRoof2.position.set(0, y0 + vU(11), zSiFang);
      g.add(sfRoof2);
      // 内碑（亭身内，南侧券洞可见）：龟趺+碑身+碑首
      const shell = new THREE.Mesh(new THREE.SphereGeometry(hU(2.6), 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M_GRANITE());
      shell.scale.set(1, vU(1.4) / hU(2.6), 1.3);
      shell.position.set(0, y0 + vU(1.2), zSiFang - hU(1));
      shell.castShadow = shell.receiveShadow = true;
      g.add(shell);
      addBox(g, M_GRANITE(), 0, y0 + vU(1.8), zSiFang + hU(1.4), hU(1.5), vU(1.2), hU(1.4));   // 龟首
      addBox(g, M_GRANITE(), 0, y0 + vU(2.6), zSiFang, hU(5.6), vU(7.5), hU(1.5));            // 碑身
      addBox(g, M_GRANITE(), 0, y0 + vU(10.2), zSiFang, hU(6.4), vU(1.8), hU(1.9));           // 碑首
    }

    const stone = M_GRANITE();   // 神道石像生：花岗石皮（颗粒+蚀斑+bump），特写不再是塑料纯色
    // 石兽 6 种各 2 对（两立两卧），自南（狮）而北（马）；两两相对，面朝神道中心。
    // 北端收 12%，给望柱与翁仲段让位（几何构造见 spiritway.js）。
    const halfL = (hU(p.spiritRoadL) / 2) * 0.88;
    // 神道石板铺装：山体是一整片渐变绿，没有这条浅色轴线的话，空中俯瞰
    // （紫金山侧看过来）石像生走廊完全淹没在林海里——铺装就是神道的可读性本身。
    // 贴地形 ribbon：左右边缘逐点采样地形高度，坡地上不悬空；北端铺到方城前。
    {
      const z0 = hU(1720), z1 = -hU(10), N = 40, w = hU(23);
      const pos = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const zz = z0 + ((z1 - z0) * i) / N;
        pos.push(-w / 2, gy(-w / 2, zz) + 0.015, zz, w / 2, gy(w / 2, zz) + 0.015, zz);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const paving = new THREE.Mesh(geo, mat('#a9a08c', { rough: 0.96 }));
      paving.receiveShadow = true;
      g.add(paving);
    }
    // 立姿狮/麒麟两对由 CC0 扫描件异步替换（spiritway.dressSpiritWay），此处只记槽位；
    // 卧姿对与加载失败回退仍走程序化——神道永不开天窗。
    const GLB_KINDS = new Set(['lion', 'qilin']);
    const spiritSlots = {};
    for (let i = 0; i < p.statuePairs; i++) {
      const zz = zSpirit + halfL - ((i + 0.5) / p.statuePairs) * halfL * 2;
      const kind = SPIRIT_BEASTS[Math.floor(i / 2) % SPIRIT_BEASTS.length];
      const lying = i % 2 === 1;
      if (!lying && GLB_KINDS.has(kind)) {
        if (!spiritSlots[kind]) spiritSlots[kind] = { x: hU(14), z: zz, yW: gy(-hU(14), zz), yE: gy(hU(14), zz) };
        continue;
      }
      for (const sx of [-1, 1]) {
        addBeast(g, stone, kind, sx * hU(14), gy(sx * hU(14), zz), zz, lying, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
    }
    // 石望柱 1 对 → 翁仲（武将 2 对在前、文臣 2 对在后，均面南）
    const zWangZhu = hU(475);
    for (const sx of [-1, 1]) stele(g, stone, sx * hU(14), gy(sx * hU(14), zWangZhu), zWangZhu, footU(1.1), vU(p.wangZhuH));
    for (let i = 0; i < p.wengZhong / 2; i++) {
      const zz = hU(445) - i * hU(30);
      for (const sx of [-1, 1]) {
        addWengZhong(g, stone, sx * hU(14), gy(sx * hU(14), zz), zz, i >= 2);
      }
    }
    // 棂星门（三间两垣式）歇山灰瓦
    const yLx = gy(0, zLingXing);
    for (const sx of [-hU(9), 0, hU(9)]) addBox(g, M_MARBLE(), sx, yLx, zLingXing, footU(1.6), vU(8), footU(1.6));
    const lxRoof = cRoof(hU(28), footU(5), vU(2.6), C.tileGrey, 'gable-hip');
    lxRoof.position.set(0, yLx + vU(8), zLingXing);
    g.add(lxRoof);

    /* ---- 御河桥（金水桥）：神道过金水河的拱桥，CC0 石拱桥 GLB 异步落位 ----
     * 水带横神道（东西向），铺装带上是桥面；两侧展开的水面让「跨河」成立。 */
    {
      const yW = Math.max(gy(-hU(12), zYuHe), gy(hU(12), zYuHe)) - 0.02;
      const waterMat = new THREE.MeshStandardMaterial({ color: 0x3f5a66, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.9 });
      registerEnv(waterMat, 0.55);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(hU(150), hU(9)).rotateX(-Math.PI / 2), waterMat);
      band.position.set(0, yW, zYuHe);
      band.receiveShadow = true;
      g.add(band);
    }

    // 文武方门 / 碑殿 / 享殿
    const yX = gy(0, zXiang);
    addBox(g, mat('#c9c2b2', { rough: 0.95 }), 0, yX - vU(1), zXiang, hU(p.hallBaseL), vU(p.hallBaseH + 1), hU(p.hallBaseW));
    const xd = makeHall(hU(p.hallBaseL * 0.62), hU(p.hallBaseW * 0.7), vU(9), vU(9), C.red, '#e9e3d5', 0, 'gable-hip');
    xd.position.set(0, yX + vU(p.hallBaseH), zXiang);
    g.add(xd);
    const yB = gy(0, zBei);
    const bd = makeHall(hU(28), hU(18), vU(7), vU(7), C.tileGrey, '#dbd3c2', 0, 'gable-hip');
    bd.position.set(0, yB, zBei);
    g.add(bd);
    const yMn = gy(0, zMen);
    addBox(g, mat(C.brick, { rough: 0.95 }), 0, yMn, zMen, hU(34), vU(11), hU(6));
    {   // 文武方门南立面：五门洞贴面（明孝陵中轴 +z=南）+ 檐口线脚
      const mf = zMen + hU(3) + 0.01;
      for (let i = 0; i < 5; i++) {
        const x = -hU(13) + (i / 4) * hU(26);
        addBox(g, mat('#2b2b28', { rough: 1 }), x, yMn, mf, hU(3.4), vU(6.5), 0.04);
      }
      addBox(g, mat('#9a917e', { rough: 0.85 }), 0, yMn + vU(11) - vU(0.8), mf - 0.004, hU(30), vU(0.9), 0.06);
    }
    const mnRoof = cRoof(hU(40), hU(9), vU(4.2), C.tileGrey, 'gable-hip');
    mnRoof.position.set(0, yMn + vU(11), zMen);
    g.add(mnRoof);

    /* ---- 陵宫红墙：文武方门两侧展开，围合 享殿—碑殿—方城 区（朱墙+黄琉璃瓦压顶）。
     * 南墙正中即文武方门（hU(34) 宽，墙段从门侧接出）；北墙闭合到方城前，
     * 宝顶自成宝城环（见后），方城以北不归红墙管。 ---- */
    {
      const wallMat = mat('#9e3b2c', { rough: 0.92 });
      const capMat = mat(C.tileGold, { rough: 0.55 });
      const hW2 = vU(5.5), hT = vU(2), xEnd = hU(90);
      const zSouth = zMen, zNorth = -hU(215);
      const seg = (x, z, w, d) => {
        const y = gy(x, z);
        addBox(g, wallMat, x, y + hW2 / 2, z, w, hW2, d);
        addBox(g, capMat, x, y + hW2 + vU(0.35), z, w * 1.15, vU(0.7), d * 1.15);   // 黄瓦压顶
      };
      for (const sx of [-1, 1]) seg(sx * (hU(17) + (xEnd - hU(17)) / 2), zSouth, xEnd - hU(17), hT); // 南墙（门两侧）
      // 东西墙跨 745 m 坡地：单长盒必然一侧悬空——分 6 段逐段贴地形
      for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) {
        const za = zSouth + ((zNorth - zSouth) * i) / 6, zb = zSouth + ((zNorth - zSouth) * (i + 1)) / 6;
        seg(sx * xEnd, (za + zb) / 2, hT, Math.abs(zb - za) * 1.02);
      }
      // 北墙同样分段（跨宝城前坡脚）
      for (let i = 0; i < 4; i++) {
        const xa = -xEnd + (xEnd * 2 * i) / 4, xb = -xEnd + (xEnd * 2 * (i + 1)) / 4;
        seg((xa + xb) / 2, zNorth, Math.abs(xb - xa) * 1.02, hT);
      }
    }

    // 方城
    const yF = gy(0, zFang);
    const fcW = hU(p.fangChengW), fcD = hU(p.fangChengD), fcH = vU(p.fangChengH);
    addBox(g, mat('#b3ab9a', { rough: 0.96 }), 0, yF, zFang, fcW, fcH, fcD);
    addBox(g, mat('#3a3a36', { rough: 1 }), 0, yF, zFang - fcD / 2 + footU(1), hU(6), fcH * 0.62, footU(3));
    addBox(g, mat('#c7c0af', { rough: 0.95 }), 0, yF + fcH, zFang, fcW * 1.02, vU(1.0), fcD * 1.02);
    // 明楼：39.45 × 18.47 m，重檐歇山覆黄琉璃瓦
    const mlW = hU(p.mingLouW), mlD = hU(p.mingLouD);
    addBox(g, mat(C.brick, { rough: 0.92 }), 0, yF + fcH + vU(1), zFang, mlW, vU(11), mlD);
    const mlRoof1 = cRoof(mlW * 1.2, mlD * 1.3, vU(5), C.tileGold, 'gable-hip');
    mlRoof1.position.set(0, yF + fcH + vU(12), zFang);
    g.add(mlRoof1);
    const mlRoof2 = cRoof(mlW * 0.92, mlD * 0.98, vU(6), C.tileGold, 'gable-hip');
    mlRoof2.position.set(0, yF + fcH + vU(14.5), zFang);
    g.add(mlRoof2);

    // 宝顶 / 宝城
    const yBao = gy(0, zBao);
    const baoR = hU(p.baoDingD) / 2;
    // 偏暖的橄榄绿：山体是 #4a6b3c→#3b5a30 的冷渐变，同色系的 0x5d7048 在航拍里
    // 直接融进山坡——宝顶是独龙阜上人为堆填的封土树阵，色调偏黄才读得出「一座圆丘」。
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(baoR, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x7d8b4f, roughness: 1 }),
    );
    mound.scale.set(1, vU(30) / baoR, 1);
    // 下沉 6 m：宝顶是 400 m 宽的穹顶，坡地上逐点锚定必然一侧悬空——
    // 下沉让上坡侧多埋（不可见）、下坡侧贴住地面
    mound.position.set(0, yBao - vU(6), zBao);
    mound.receiveShadow = true;
    mound.castShadow = true;   // 30 m 高的封土丘投影帮它在山体上读出立体
    g.add(mound);
    // 宝城墙：石色提亮一档，环丘一圈的 readout 主要靠它
    const ring = new THREE.Mesh(new THREE.TorusGeometry(baoR * 0.99, vU(p.baoChengWallH) * 0.5, 6, 60).rotateX(Math.PI / 2),
      mat('#b3ab98', { rough: 0.97 }));
    ring.position.set(0, yBao - vU(6) + vU(p.baoChengWallH) * 0.5, zBao);
    g.add(ring);

    // 石香炉槽（享殿台基南缘）+ 御河桥槽 + 石栏杆沿台基三边（CC0 扫描件异步落位）
    // 台基盒中心 yX−vU(1)、高 vU(hallBaseH+1) → 台面 ≈ yX+vU(1.0)
    spiritSlots.burner = { x: 0, y: yX + vU(1.0), z: zXiang + hU(10), ry: 0 };
    spiritSlots.bridge = { x: 0, y: gy(0, zYuHe), z: zYuHe, ry: 0 };
    {
      const bL = hU(p.hallBaseL) / 2, bW = hU(p.hallBaseW) / 2, yTop = yX + vU(1.0);
      // 南面踏道（三级踏步，hU(24) 宽）——栏杆让开这一段
      const stepH = vU(p.hallBaseH + 1) / 3, stepD = vU(1.4);
      for (let s = 0; s < 3; s++) {
        addBox(g, mat('#c2bbb0', { rough: 0.95 }), 0,
          yX + vU(1.0) - stepH * (s + 0.5),                              // 自台面逐级下降
          zXiang + bW + stepD * (s + 0.5), hU(24), stepH, stepD);
      }
      spiritSlots.balustrade = { y: yTop, edges: [
        { x0: -bL, z0: zXiang + bW, x1: -hU(12), z1: zXiang + bW },                     // 南缘（踏道两侧）
        { x0: hU(12), z0: zXiang + bW, x1: bL, z1: zXiang + bW },
        { x0: -bL, z0: zXiang - bW, x1: -bL, z1: zXiang + bW },                          // 东西缘
        { x0: bL, z0: zXiang - bW, x1: bL, z1: zXiang + bW },
      ] };
    }
    g.userData.spiritSlots = spiritSlots;
    g.userData.spiritFallback = (kind, x, y, z, ry) => addBeast(g, stone, kind, x, y, z, false, ry);
    return g;
  },

  /* ===== 城南传统街区肌理（夫子庙 · 老门东）：硬山屋面 ===== */
  oldtown(lm) {
    const p = lm.params;
    const g = new THREE.Group();
    const rand = makeRandom(lm.id.charCodeAt(0) * 977);
    const hMax = p.hMax || 26;
    for (let i = 0; i < p.blocks; i++) {
      const x = (rand() - 0.5) * hU(560), z = (rand() - 0.5) * hU(430);
      const w = hU(46 + rand() * 34), d = hU(34 + rand() * 26);
      const ry = rand() * 0.5;
      const total = i === 0 ? vU(hMax) : vU(hMax - 15 + rand() * 15);
      const roofH = vU(4 + rand() * 3);
      const bodyH = total - roofH;
      addBox(g, mat(i % 3 ? '#e6ded1' : '#d9cdbb', { rough: 0.95 }), x, 0, z, w, bodyH, d, ry);
      const rf = cRoof(w * 1.5, d * 1.45, roofH, rand() > 0.45 ? C.red : C.redD, 'gable');
      rf.position.set(x, bodyH, z);
      rf.rotation.y = ry;
      g.add(rf);
    }
    if (p.boat) {
      const boat = new THREE.Group();
      addBox(boat, mat(C.wood, { rough: 0.9 }), 0, 0, 0, hU(26), vU(4), hU(8));
      addBox(boat, mat('#efe6d4', { rough: 0.9 }), -hU(2), vU(4), 0, hU(12), vU(6), hU(7));
      const rf = cRoof(hU(16), hU(9), vU(5), C.red, 'gable-hip');
      rf.position.set(-hU(2), vU(10), 0);
      boat.add(rf);
      boat.position.set(hU(180), 0.36, hU(240));
      boat.rotation.y = 0.5;
      g.add(boat);
      g.userData.boat = boat;
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(footU(3), 10, 8), new THREE.MeshBasicMaterial({ color: 0xffcf7a }));
    lamp.position.set(0, vU(20), 0);
    g.add(lamp);
    return g;
  },

  /* ===== 中华门现状：等比米制，真实券洞、三院四门、双层城台及 27 藏兵洞 ===== */
  citygate(lm) {
    const g = buildZhonghuamen();
    const gt = CITY_GATES.find(gate => gate.name === '中华门') || lm;
    const frame = gateFrame(gt);
    g.rotation.y = Math.atan2(frame.normal[0], frame.normal[1]) + (frame.zOut < 0 ? Math.PI : 0);
    return g;
  },

  /* ===== 南京长江大桥：正桥 9 墩 10 跨 1 576 m，上层公路 19.5 m / 下层铁路 14 m ===== */
  trussbridge(lm, ctx) {
    const p = lm.params;
    const g = new THREE.Group();
    g.rotation.y = bearingToRot(riverCrossBearing(ctx.x, ctx.z));
    const L = hU(p.mainSpan);
    const steel = mat('#7d8790', { metal: 0.5, rough: 0.5 });
    const concrete = mat('#b6b0a3', { rough: 0.95 });
    addBox(g, steel, 0, vU(p.deckH), 0, footU(p.roadW), vU(3), L);
    addBox(g, concrete, 0, vU(p.deckH - 14), 0, footU(p.railW), vU(4), L);
    const nbay = Math.max(2, Math.round(L / hU(78)));
    for (let i = 0; i <= nbay; i++) {
      const z = -L / 2 + (i / nbay) * L;
      for (const sx of [-1, 1]) addCyl(g, steel, sx * footU(p.roadW * 0.45), vU(p.deckH - 14), z, 0.07, vU(14), 6);
      addBox(g, steel, 0, vU(p.deckH + 2), z, footU(p.roadW * 0.92), 0.1, 0.1);
    }
    for (const sx of [-1, 1]) addBox(g, steel, sx * footU(p.roadW * 0.45), vU(p.deckH + 2), 0, 0.12, 0.12, L);
    for (let i = 0; i < p.piers; i++) {
      const z = -L / 2 + ((i + 0.5) / p.piers) * L;
      addBox(g, mat('#a49e91', { rough: 0.95 }), 0, 0, z, footU(16), vU(p.deckH - 16), footU(10));
    }
    // 桥头堡：70 m，三面红旗
    const HT = vU(p.towerH);
    const bandT = vU(1.2), capH = vU(7), flagH = vU(7);
    const bodyT = HT - bandT - capH - flagH;
    const yFlag = bodyT + bandT + capH;
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xd02b1e });
    for (const sz of [-L / 2 - footU(6), L / 2 + footU(6)]) {
      addBox(g, concrete, 0, 0, sz, footU(24), bodyT, footU(18));
      addBox(g, mat('#cfc8b8', { rough: 0.9 }), 0, bodyT, sz, footU(27), bandT, footU(21));
      const rf = cRoof(footU(30), footU(24), capH, C.redD, 'gable-hip');
      rf.position.set(0, bodyT + bandT, sz);
      g.add(rf);
      addBox(g, flagMat, 0, yFlag, sz + footU(9), footU(7), flagH, footU(0.6));
      for (const sx of [-1, 1]) addBox(g, flagMat, sx * footU(13.5), yFlag, sz, footU(0.6), flagH, footU(7));
    }
    /* ---- 引桥（2026-10-04 衔接优化）：正桥 1 576 m 短于江面斜交宽度，两端悬在水上 ----
     * 沿桥轴直线延伸双层引桥到岸（data.js 已把过江顶点捻直到轴上）：铁路箱延伸到岸上
     * 1.2 u 处的隧道洞门，洞后遮蔽段把列车 wrap 全程挡住——此前列车在半空凭空出现/消失；
     * 公路面板顶 1.05 与正桥同高，压住 world.js 的过江路面带（水面 0.35 + DECK_RISE 0.65
     * = 1.0 = vU(30)），岸侧带子自然从面板端头落地。墩子水面段落进水下，岸上段落地形。 */
    const worldAt = (lz) => [ctx.x + Math.sin(g.rotation.y) * lz, ctx.z + Math.cos(g.rotation.y) * lz];
    const bankDist = (sgn) => {                    // 主桥端 → 出水边（+0.3 u 岸线余量）的轴长
      for (let d = 0.1; d < 9.5; d += 0.05) {
        const [wx, wz] = worldAt(sgn * (L / 2 + d));
        if (distToPolyline(wx, wz, RIVER_PTS) > RIVER.halfWidth + 0.3) return d;
      }
      return 6;
    };
    const HT_FACE = L / 2 + footU(6) + footU(9);   // 桥头堡外缘（堡体 footU(18) 深，中心 L/2+footU(6)）
    const portalMat = mat('#9a948a', { rough: 0.95 });
    const tunnelMat = mat('#211d19', { rough: 1 });
    const trackEnd = { 1: 0, '-1': 0 };           // 两侧轨面终点（列车行程边界）
    for (const sgn of [1, -1]) {
      const bank = bankDist(sgn);
      const raLen = bank + 0.2;                    // 公路引桥：桥头堡外缘 → 出水边
      addBox(g, steel, 0, vU(p.deckH), sgn * (HT_FACE + raLen / 2), footU(p.roadW), vU(3), raLen);
      const railLen = bank + 1.2;                  // 铁路引桥：多走 1.2 u 岸上到洞门
      addBox(g, concrete, 0, vU(p.deckH - 14), sgn * (HT_FACE + railLen / 2), footU(p.railW), vU(4), railLen);
      const nPiers = Math.max(1, Math.round(railLen / hU(80)));
      for (let i = 0; i <= nPiers; i++) {
        const pz = sgn * (HT_FACE + (railLen / nPiers) * (i + 0.5));
        const [wx, wz] = worldAt(pz);
        const overWater = distToPolyline(wx, wz, RIVER_PTS) < RIVER.halfWidth + 0.3;
        const base = overWater ? -0.12 : terrainHeight(wx, wz) - 0.05;
        const hP = vU(p.deckH - 14) - base + vU(2);
        addBox(g, concrete, 0, base + hP / 2, pz, footU(7), hP, footU(7));
      }
      // 洞门：混凝土门脸 + 深色塞块（塞块深 0.42 u > 轨面延伸 0.35 u，wrap 点藏在塞块后）
      const portalZ = HT_FACE + railLen;
      addBox(g, portalMat, 0, vU(p.deckH - 14) + vU(7), sgn * portalZ, footU(p.railW + 10), vU(15), footU(3));
      addBox(g, tunnelMat, 0, vU(p.deckH - 14) + vU(6), sgn * (portalZ + 0.21), footU(p.railW + 5), vU(13), 0.42);
      trackEnd[sgn] = portalZ + 0.35;
    }

    // 桥灯：21 对灯柱保留，42 颗暖白灯球合并为单个 InstancedMesh（夜里 emissive 渐亮）
    const postMat = mat('#e6e9ea', { rough: 0.7 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffcf82, emissiveIntensity: 0.06, roughness: 0.4 });
    registerEnv(lampMat, 0.5);
    const lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 8, 6), lampMat, 42);
    lampMesh.userData.noMerge = true;        // 合批会把实例逐个烘焙冻结，动不得
    lampMesh.castShadow = false;
    const lampDummy = new THREE.Object3D();
    let li = 0;
    for (let i = 0; i <= 20; i++) {
      const z = -L / 2 + (i / 20) * L;
      for (const sx of [-1, 1]) {
        addCyl(g, postMat, sx * footU(p.roadW * 0.45), vU(p.deckH + 3), z, 0.04, vU(9), 6);
        lampDummy.position.set(sx * footU(p.roadW * 0.45), vU(p.deckH + 12), z);
        lampDummy.updateMatrix();
        lampMesh.setMatrixAt(li++, lampDummy.matrix);   // 构建期写满 42 个初始矩阵
      }
    }
    g.add(lampMesh);

    /* ---- 下层铁路双线对向列车：铁路面底 vU(deckH-14)、厚 vU(4)，轨面 = vU(deckH-10) + 轨道结构 vU(0.6) ----
     * 行程 = 全轨（引桥北端 → 正桥 → 引桥南端，两端各含 0.35 u 洞内遮蔽段）：列车从洞门里
     * 开出来、进洞消失，wrap 转场全程被塞块挡住。 */
    const RAIL_TOP = vU(p.deckH - 14) + vU(4) + vU(0.6);
    const Z_MIN = -trackEnd[-1], Z_MAX = trackEnd[1];
    const RANGE_M = (Z_MAX - Z_MIN) * 100;
    const trainMat = mat('#c8ccd2', { rough: 0.4, metal: 0.3 });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, emissive: 0xffe9b0, emissiveIntensity: 0.05 });
    registerEnv(winMat, 0.5);
    const CARS = 10, CAR_GAP = 27 / RANGE_M;   // 车间距 27 m 折算成全行程参数
    const wrap01 = (v) => ((v % 1) + 1) % 1;
    const carDummy = new THREE.Object3D();
    const mkTrainMesh = (material, w, h, len) => {
      const m = new THREE.InstancedMesh(UNIT.box.clone(), material, CARS);
      m.userData.noMerge = true;          // 动体：合批会逐实例烘焙冻结
      m.frustumCulled = false;            // 实例整体包围盒不随动画更新
      m.castShadow = false;               // shadowMap 按需刷新，动体影子会冻在旧位置
      m.userData.dims = [w, h, len];
      g.add(m);
      return m;
    };
    // 双线对向：横向 ±footU(2) 错开（railW 14 m 桥面容纳两条 3.4 m 车宽的线）
    const tracks = [
      { off: footU(2), dir: 1, phase: 0.0, body: mkTrainMesh(trainMat, footU(3.4), vU(4.2), hU(25)), win: mkTrainMesh(winMat, footU(3.5), vU(1.1), hU(22)) },
      { off: -footU(2), dir: -1, phase: 0.5, body: mkTrainMesh(trainMat, footU(3.4), vU(4.2), hU(25)), win: mkTrainMesh(winMat, footU(3.5), vU(1.1), hU(22)) },
    ];
    const placeTrain = (tr) => {
      for (let i = 0; i < CARS; i++) {
        const ti = wrap01(tr.phase - tr.dir * i * CAR_GAP);   // 车头在前，后车按间距 27 m 跟随
        carDummy.position.set(tr.off, RAIL_TOP, Z_MIN + ti * (Z_MAX - Z_MIN));
        carDummy.rotation.set(0, tr.dir < 0 ? Math.PI : 0, 0);
        carDummy.scale.set(tr.body.userData.dims[0], tr.body.userData.dims[1], tr.body.userData.dims[2]);
        carDummy.updateMatrix();
        tr.body.setMatrixAt(i, carDummy.matrix);
        carDummy.position.y = RAIL_TOP + vU(2.2);             // 窗带落在车身上半
        carDummy.scale.set(tr.win.userData.dims[0], tr.win.userData.dims[1], tr.win.userData.dims[2]);
        carDummy.updateMatrix();
        tr.win.setMatrixAt(i, carDummy.matrix);
      }
      tr.body.instanceMatrix.needsUpdate = true;
      tr.win.instanceMatrix.needsUpdate = true;
    };
    tracks.forEach(placeTrain);           // 构建期先按 t=0 摆好全部初始矩阵
    g.userData.tick = (t, dt) => {
      for (const tr of tracks) {
        tr.phase = wrap01(tr.phase + dt * (0.252 / (Z_MAX - Z_MIN)) * tr.dir);   // 0.252 u/s ≈ 90 km/h，匀速循环
        placeTrain(tr);
      }
    };
    g.userData.setNight = (k) => {
      lampMat.emissiveIntensity = 0.06 + k * 3.6;   // 桥灯暖白（只动强度，不动色相）
      winMat.emissiveIntensity = 0.05 + k * 2.2;    // 车窗灯带
    };
    return g;
  },

  /* ===== 南京眼步行桥 ===== */
  eyebridge(lm, ctx) {
    const p = lm.params;
    const g = new THREE.Group();
    // 跨的是夹江支汊（不是长江主汊），桥轴垂直于夹江走向
    g.rotation.y = bearingToRot(riverCrossBearing(ctx.x, ctx.z, EYE_BRANCH_PTS));
    const L = hU(p.mainBridgeL);
    const span = hU(p.span);
    const lean = (p.towerLean * Math.PI) / 180;
    const headR = footU(6.5);
    const white = mat('#eef1f3', { metal: 0.2, rough: 0.35 });
    // 塔根有 0.3 基座抬离(塔根贴水面,不悬水下);竖向总高以「基座 + 塔身 + 顶球」= towerH 为准,
    // 旧版没扣基座,导致实测顶点 82.5+9=91.5m,对 heightM=82.5 超差 10.9%(smoke WARN)。
    const towerBase = 0.3;
    const slant = (vU(p.towerH) - towerBase - headR) / Math.cos(lean);
    const tipY = Math.cos(lean) * slant;
    addBox(g, white, 0, vU(18), 0, footU((p.deckWMin + p.deckWMax) / 2), vU(2.4), L);
    addBox(g, white, 0, vU(18), (L + span) / 4, footU(p.deckWMax * 0.8), vU(2.2), span * 0.5);
    for (const sz of [-1, 1]) {
      const tz = sz * (span / 2 + hU(70));
      const tower = new THREE.Group();
      addCyl(tower, white, 0, 0, 0, footU(7), slant, 14, footU(4));
      const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 16, 12), white);
      head.position.y = slant;
      tower.add(head);
      tower.rotation.z = -sz * lean;
      tower.position.set(0, towerBase, tz);   // 塔根落到水面附近，而不是悬在水面之下
      g.add(tower);
      const pts = [];
      const n = 9;
      const tipZ = tz - sz * Math.sin(lean) * slant;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push(new THREE.Vector3(0, towerBase + tipY, tipZ));   // 锚在塔顶球心(含基座高)
        pts.push(new THREE.Vector3(0, vU(20.4), tz - sz * (span * 0.5 + t * (L * 0.5 - span * 0.5))));
      }
      const lg = new THREE.BufferGeometry().setFromPoints(pts);
      g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xf2f5f7, transparent: true, opacity: 0.85 })));
    }
    for (const sz of [-1, 1]) {
      addCyl(g, white, 0, 0.3, sz * (L / 2 - footU(8)), footU(9), vU(18), 12);
      // 引桥坡道：桥面在 18 m 高度，直落到两岸（旧版悬空断头）
      const rampLen = hU(240);
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(footU(p.deckWMin + 4), 0.1, rampLen), white);
      ramp.position.set(0, (vU(18) + 0.08) / 2, sz * (L / 2 + rampLen / 2));
      ramp.rotation.x = sz * Math.atan2(vU(18) - 0.08, rampLen);
      ramp.castShadow = true;
      g.add(ramp);
    }
    return g;
  },

  /* ===== 南京奥体中心主体育场 ===== */
  stadium(lm) {
    const p = lm.params;
    const g = new THREE.Group();
    const R = hU(p.bowlR);
    const white = mat('#e6e9ea', { rough: 0.55, metal: 0.15 });
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.86, vU(p.standsH), 56, 1, true),
      mat('#d9dde0', { rough: 0.8, side: THREE.DoubleSide }),
    );
    bowl.castShadow = true;
    g.add(bowl);
    const lidGeo = new THREE.SphereGeometry(R * 0.99, 56, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const lid = new THREE.Mesh(lidGeo, new THREE.MeshStandardMaterial({
      color: 0xe9ecee, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide,
    }));
    lid.position.y = vU(p.standsH);
    lid.scale.set(1, vU(p.roofH - p.standsH) / (R * 0.99), 1);
    lid.castShadow = true;
    g.add(lid);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.99, 0.11, 8, 60).rotateX(Math.PI / 2), white);
    ring.position.y = vU(p.roofH) - 0.06;
    g.add(ring);
    colonnade(g, white, vU(p.standsH * 0.55), vU(p.standsH * 0.45), R * 1.06, R * 1.06, 28, 0.09);
    const field = new THREE.Mesh(new THREE.CircleGeometry(1, 56).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x4c7a3f, roughness: 1 }));
    field.scale.set(hU(p.fieldRx), 1, hU(p.fieldRz));
    field.position.y = 0.12;
    g.add(field);
    const chord = hU(p.archSpan), spring = vU(8), tubeR = footU(3.2);
    const rise = vU(p.archTopH) - spring - tubeR;
    for (const sx of [-1, 1]) {
      const leanOut = sx * rise;
      const xArch = sx * R * 0.55;
      const pts = [];
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        const k = 1 - Math.pow(2 * t - 1, 2);
        pts.push(new THREE.Vector3(xArch + leanOut * k, spring + rise * k, -chord / 2 + t * chord));
      }
      const arc = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 72, tubeR, 10, false),
        mat('#c0392b', { rough: 0.5, metal: 0.25 }),
      );
      arc.castShadow = true;
      g.add(arc);
      for (const ez of [-chord / 2, chord / 2]) {
        addBox(g, mat('#a8a49b', { rough: 0.95 }), xArch, 0, ez, footU(11), spring, footU(11));
      }
    }
    return g;
  },

  /* ===== 南京南站 ===== */
  station(lm) {
    const p = lm.params;
    const g = new THREE.Group();
    const white = mat('#dfe3e5', { rough: 0.6, metal: 0.2 });
    const stone = mat('#b9b3a6', { rough: 0.95 });
    const L = hU(p.len), W = hU(p.wide);
    const eave = vU(p.eaveH), top = vU(p.height);
    addBox(g, stone, 0, 0, 0, L, vU(p.platH), W);
    addBox(g, white, 0, vU(p.platH), 0, L * 0.99, eave - vU(p.platH), W * 0.98);
    for (let i = 0; i < 22; i++) {
      addBox(g, mat('#9fc0d8', { metal: 0.4, rough: 0.25 }), -L / 2 + ((i + 0.5) / 22) * L, vU(p.platH) + vU(4), W * 0.5, 0.12, eave - vU(p.platH) - vU(8), 0.02);
    }
    const vault = new THREE.Mesh(barrelVault(L * 0.99, W * 0.98, top - eave, 48), white);
    vault.position.y = eave;
    vault.castShadow = true;
    g.add(vault);
    for (const sz of [-1, 1]) {
      addBox(g, white, 0, vU(p.platH), sz * (W * 0.5 + hU(38)), L * 0.96, vU(1.6), hU(72));
      for (let i = 0; i < 9; i++) {
        addCyl(g, white, -L / 2 + ((i + 0.5) / 9) * L, vU(p.platH) - vU(10), sz * (W * 0.5 + hU(66)), 0.09, vU(10), 8);
      }
      for (let i = 0; i < p.tracks; i++) {
        addBox(g, mat('#8d9195', { rough: 0.8 }), -L / 2 + ((i + 0.5) / p.tracks) * L, vU(p.platH) + 0.04, sz * (W * 0.5 + hU(20 + i * 5)), L * 0.9 / p.tracks, 0.08, 0.03);
      }
    }
    return g;
  },

  /* ===== 阅江楼·狮子山：7 层 52 m，L 形犄角平面；黄琉璃瓦镶绿琉璃瓦边 =====
     主体以 chineseHall（须弥座 + 柱网 + 斗拱 + 庑殿顶）构建，次翼另起 smaller 楼阁，呈 L 形。 */
  pavilion(lm, ctx) {
    const p = lm.params;
    const g = new THREE.Group();
    const base = terrainHeight(ctx.x, ctx.z) - ctx.groundY;
    const H = vU(p.height) - vU(2.5);       // 主楼自身 49.5 m
    const main = chineseHall({
      w: footU(34), d: footU(34),
      pedestalH: vU(2.5), bodyH: H * 0.52, roofRise: H * 0.48,
      bays: 5, depthBays: 3, roofType: 'hip', ridgeLen: footU(34) * 0.5,
      finial: true, roofColor: C.tileGold, ridgeColor: C.tileGreen,
      stoneColor: C.marble, postColor: C.red, wallColor: C.white,
      dougongTier: 2,
    });
    main.position.y = base;
    g.add(main);
    // 次翼（面西）：较小的重檐楼阁
    const wing = chineseHall({
      w: footU(24), d: footU(24),
      pedestalH: vU(2.5), bodyH: vU(14), roofRise: vU(9),
      bays: 4, depthBays: 3, roofType: 'gable-hip', finial: false,
      roofColor: C.tileGold, ridgeColor: C.tileGreen, stoneColor: C.marble,
      postColor: C.red, wallColor: C.white, dougongTier: 2,
    });
    wing.position.set(footU(-26), base, footU(26));
    wing.rotation.y = Math.PI * 0.5;
    g.add(wing);
    // 东侧配亭
    const side = makePavilion(footU(20), footU(14), vU(6), vU(6), C.redD, '#e6ddcb', 0, 4);
    side.position.set(footU(38), base + vU(2.5), footU(34));
    g.add(side);
    return g;
  },

  /* ===== 佛寺（鸡鸣寺 / 栖霞寺）：殿堂 + 石塔 ===== */
  temple(lm, ctx) {
    const p = lm.params;
    const g = new THREE.Group();
    const base = terrainHeight(ctx.x, ctx.z) - ctx.groundY;
    const w = footU(p.hallW), d = footU(p.hallD);
    const hall = chineseHall({
      w, d, pedestalH: vU(1.2), bodyH: vU(p.hallH * 0.6), roofRise: vU(p.hallH * 0.4),
      bays: 5, depthBays: 3, roofType: 'gable-hip', finial: false,
      roofColor: C.red, ridgeColor: C.tileGreen, stoneColor: C.marble,
      postColor: C.red, wallColor: '#e9e3d5', dougongTier: 2,
    });
    hall.position.y = base;
    g.add(hall);
    const back = chineseHall({
      w: w * 0.82, d: d * 0.82, pedestalH: vU(1.2), bodyH: vU(p.hallH * 0.5), roofRise: vU(p.hallH * 0.42),
      bays: 4, depthBays: 3, roofType: 'gable-hip', finial: false,
      roofColor: C.redD, ridgeColor: C.tileGreen, stoneColor: C.marble,
      postColor: C.red, wallColor: '#e9e3d5', dougongTier: 2,
    });
    back.position.set(0, base, -d * 1.5);
    g.add(back);
    // 塔：方塔/八角塔，攒尖屋顶（arch）
    const pag = makePagoda({
      tiers: p.tiers, totalH: vU(p.pagodaH), baseW: footU(p.pagodaBase),
      sides: p.oct ? 8 : 4, bodies: ['#efe9da', '#e2dccb'], roofs: [C.tileGrey, C.red],
    });
    pag.position.set(w * 1.5, base, 0);
    g.add(pag);
    addBox(g, mat(C.brick, { rough: 0.9 }), 0, base, d * 1.1, w * 1.2, vU(5.5), footU(2.4));
    if (p.dense) {
      for (let i = 0; i < 5; i++) {
        addBox(g, mat('#b3a894', { rough: 0.95 }), -w * 1.6, base, -d * 2.4 - i * footU(6), footU(12), vU(4 + i * 0.6), footU(4));
      }
    }
    return g;
  },

  /* ===== 仿古大殿（总统府 / 南京博物院历史馆） ===== */
  classical(lm) {
    const p = lm.params;
    const g = new THREE.Group();
    const roofColor = p.roof === 'blue' ? C.tileBlue : C.tileGrey;
    const isHip = p.roof === 'blue';           // 南博历史馆仿辽庑殿；总统府硬山
    const w = footU(p.w), d = footU(p.d), H = vU(p.hallH);
    const body = mat(lm.id === 'presidential' ? '#e3dbc9' : '#ddd4c2', { rough: 0.9 });
    // 总高严格为 H：台基 0.10 + 墙体 0.34 + 额枋 0.04 + 柱廊 0.26 + 下檐 0.16 + 上檐 0.10
    addBox(g, mat('#cfc7b4', { rough: 0.95 }), 0, 0, 0, w * 1.08, H * 0.10, d * 1.08);
    addBox(g, body, 0, H * 0.10, 0, w, H * 0.34, d);
    addBox(g, mat('#d8cfba', { rough: 0.9 }), 0, H * 0.44, 0, w * 1.04, H * 0.04, d * 1.05);
    for (let i = 0; i < p.cols; i++) {
      const x = -w * 0.4 + (i / (p.cols - 1)) * w * 0.8;
      addCyl(g, mat('#efe9da', { rough: 0.85 }), x, H * 0.48, -d * 0.5 - footU(0.6), footU(1.7), H * 0.26, 10);
    }
    const rf = cRoof(w * 1.12, d * 1.14, H * 0.16, roofColor, isHip ? 'hip' : 'gable');
    rf.position.y = H * 0.74;
    g.add(rf);
    const rf2 = cRoof(w * 0.88, d * 0.9, H * 0.10, roofColor, isHip ? 'hip' : 'gable');
    rf2.position.y = H * 0.90;
    g.add(rf2);
    addBox(g, mat('#cfc7b4', { rough: 0.95 }), 0, H * 0.10, d * 0.62, w * 0.46, H * 0.34, footU(10));
    return g;
  },

  /* ===== 雨花台烈士纪念碑 ===== */
  memorial(lm, ctx) {
    const p = lm.params;
    const g = new THREE.Group();
    const base = terrainHeight(ctx.x, ctx.z) - ctx.groundY;
    for (let i = 0; i < p.terraces; i++) {
      const w = hU(p.base) * (1 - i * 0.26);
      addBox(g, M_STONE(), 0, base, 0, w, vU(1.2), w);
    }
    const y0 = base + vU(1.2);
    const capH = footU(4);
    const bodyH = vU(p.monumentH) - capH - vU(1.2);
    const obelisk = new THREE.Mesh(
      new THREE.CylinderGeometry(footU(4.2), footU(6.5), bodyH, 4),
      mat('#d8d3c4', { rough: 0.9 }),
    );
    obelisk.rotation.y = Math.PI / 4;
    obelisk.position.y = y0 + bodyH / 2;
    obelisk.castShadow = true;
    g.add(obelisk);
    const cap = addCone(g, mat('#e8e3d6', { rough: 0.9 }), 0, y0 + bodyH, 0, footU(6.5), capH, 4);
    cap.rotation.y = Math.PI / 4;
    return g;
  },

  /* ===== 河西金融城塔群 ===== */
  towercluster(lm) {
    const p = lm.params;
    const g = new THREE.Group();
    const rand = makeRandom(3311);
    for (let i = 0; i < p.towers; i++) {
      const h = i === 0 ? p.hMax : p.hMin + (p.hMax - p.hMin) * Math.pow(rand(), 1.3);
      // 必须透传 lm 的 lon/lat（supertall 用它把 OSM 真实轮廓本地化），否则 toV2(undefined) → NaN
      const t = BUILDERS.supertall({
        ...lm,
        params: { totalH: h, roofH: h * 0.86, beaconH: h * 0.14, base: 34 + rand() * 18, podium: 26, secondary: 0, rot: rand() * 90 },
      });
      const a = (i / p.towers) * Math.PI * 2;
      const r = hU(p.r) * (0.35 + rand() * 0.7);
      t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r * 0.85);
      g.add(t);
    }
    return g;
  },

  /* ===== 仙林大学城 ===== */
  campus(lm) {
    const p = lm.params;
    const g = new THREE.Group();
    const rand = makeRandom(5150);
    const hMax = p.hMax || 48;
    for (let i = 0; i < p.blocks; i++) {
      const a = (i / p.blocks) * Math.PI * 2 + rand() * 0.5;
      const r = hU(p.r) * (0.3 + rand() * 0.7);
      const w = hU(90 + rand() * 70), d = hU(50 + rand() * 40);
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.8;
      const roofH = vU(6 + rand() * 3);
      const total = i === 0 ? vU(hMax) : vU(hMax - 28 + rand() * 28);
      const bodyH = total - roofH;
      addBox(g, mat('#e7e2d6', { rough: 0.9 }), x, 0, z, w, bodyH, d, rand() * 0.4);
      const rf = cRoof(w * 1.06, d * 1.06, roofH, rand() > 0.5 ? C.tileGreen : C.brick, 'gable');
      rf.position.set(x, bodyH, z);
      rf.rotation.y = rand() * 0.4;
      g.add(rf);
    }
    return g;
  },

  /* ===== 明城墙（墙体由 world.js 生成，此处仅作标注锚点） ===== */
  wallmark() { return new THREE.Group(); },
};

/* ---------------- 占地排除半径（单位） ---------------- */

function exclusionRadius(lm) {
  const p = lm.params || {};
  switch (lm.model) {
    case 'supertall': return Math.max(footU(160), 3.6);
    case 'block': return hU(p.r || 170) * 1.15;
    case 'lake': return 0;
    case 'mountainref': return 0;
    case 'wallmark': return 0;
    case 'mausoleum': return 8.0;
    case 'tomb': return 8.2;
    case 'oldtown': return 5.2;
    case 'citygate': return footU(Math.hypot(118.5 / 2, 128) + 6);   // 门体等比 1:30,占地随体量
    case 'trussbridge': return 0;
    case 'eyebridge': return 0;
    case 'stadium': return Math.max(hU(p.bowlR || 130) * 2.0, 6);
    case 'station': return Math.max(hU(p.len || 420) * 0.62, 5);
    case 'pavilion': return 4.0;
    case 'temple': return 3.4;
    case 'classical': return Math.max(footU(p.w || 60) * 1.2, 3.4);
    case 'memorial': return Math.max(hU(p.base || 70) * 0.7, 4.0);
    case 'towercluster': return Math.max(hU(p.r || 90) * 1.6, 7);
    case 'campus': return Math.max(hU(p.r || 450) * 0.75, 6);
    default: return 3;
  }
}

/* ---------------- 构建全部地标 ---------------- */

export function buildLandmarks({ merge = true } = {}) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const items = [];
  const exclusions = [];
  let beforeMeshes = 0, afterMeshes = 0;

  for (const lm of LANDMARKS) {
    const [x, z] = toV2(lm.lon, lm.lat);
    const groundY = terrainHeight(x, z);
    const builder = BUILDERS[lm.model];
    const g = new THREE.Group();
    g.name = 'lm:' + lm.id;
    let built = null;
    if (builder) {
      built = builder(lm, { x, z, groundY });
      g.add(built);
    }
    // 等比城门与同高城墙落在平地 y=-0.05；旧有其它地标仍沿用其原基准。
    g.position.set(x, lm.model === 'citygate' ? Math.max(-0.05, groundY - 0.05) : Math.max(0, groundY - 0.05), z);
    group.add(g);
    g.updateMatrixWorld(true);

    /* ---- 合批：同材质的静态构件合并成大 mesh ---- */
    const keep = new Set();
    if (built) {
      const collectAnimated = (o) => {
        if (o.userData.boat || o.userData.beacon) keep.add(o);
        (o.children || []).forEach(collectAnimated);
      };
      collectAnimated(built);
    }
    if (merge) {
      const stat = mergeStaticMeshes(g, keep);
      beforeMeshes += stat.before; afterMeshes += stat.after;
    }

    const box = new THREE.Box3().setFromObject(g);
    const ref = built && isFinite(built.userData.refTop) ? built.userData.refTop : NaN;
    const modelTop = Number.isFinite(box.max.y) ? box.max.y - g.position.y : 0;
    const top = Number.isFinite(ref) ? ref : Math.max(modelTop, 0.2);

    items.push({
      id: lm.id, name: lm.name, en: lm.en, cat: lm.cat, tags: lm.tags,
      desc: lm.desc, spec: lm.spec || [], lon: lm.lon, lat: lm.lat, model: lm.model,
      group: g,
      pos: new THREE.Vector3(x, Math.max(0, groundY), z),
      top,
      modelH: Math.max(modelTop, 0) * (built?.userData.metersPerUnit || 30),
      metersPerUnit: built?.userData.metersPerUnit || 30,
      heightM: lm.heightM || 0,
      labelY: top + 1.2,
      floaters: built && built.userData.boat ? [built.userData.boat] : [],
      beacon: built && built.userData.beacon,
      tick: built && built.userData.tick,
      setNight: built && built.userData.setNight,
      // 神道 CC0 精模槽位（明孝陵专有；main.js 装载 GLB 阶段消费）
      spiritSlots: (built && built.userData.spiritSlots) || null,
      spiritFallback: (built && built.userData.spiritFallback) || null,
    });
    const ex = exclusionRadius(lm);
    if (ex > 0) exclusions.push([x, z, ex]);
    // 跨河桥：沿桥轴布一圈排他圆，禁止两岸楼群穿进 30 m 高的桥面/引桥
    if (lm.model === 'trussbridge' || lm.model === 'eyebridge') {
      const isEye = lm.model === 'eyebridge';
      const rot = bearingToRot(riverCrossBearing(x, z, isEye ? EYE_BRANCH_PTS : RIVER_PTS));
      const spanL = hU(lm.params.mainSpan || lm.params.mainBridgeL);
      const half = spanL / 2 + (isEye ? 2.6 : 1.2);
      for (let zz = -half; zz <= half; zz += 1.4) {
        exclusions.push([x + Math.sin(rot) * zz, z + Math.cos(rot) * zz, 1.5]);
      }
    }
    // 明孝陵神道走廊：石像生沿轴铺到组原点以北 10.8u，远超 8.2u 的圆心保护圈——
    // 沿轴布小排他圆（同 trussbridge 手法），树心不再落进铺装/雕像带。
    if (lm.model === 'tomb') {
      const half = (hU(800) / 2) * 0.88;
      for (let zz = hU(310); zz <= hU(760) + half + hU(25); zz += 0.15) {
        exclusions.push([x, z + zz, hU(20)]);
      }
    }
  }
  return {
    group, items, exclusions,
    merged: merge ? { before: beforeMeshes, after: afterMeshes } : null,
  };
}
