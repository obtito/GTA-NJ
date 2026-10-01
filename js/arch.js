// 高保真建筑构件库
//
// 之前 landmarks.js 里的中式建筑是「方块 + LatheGeometry 旋转体屋顶」，
// 屋檐是圆的、没有举折、没有翼角，一眼就看得出是糊的。这里按真实做法重建：
//
//  1. 屋面改由「高度场」生成：以正脊（或上层檐）为源、檐口矩形为界，
//     沿射线求相对位置 u ∈ [0(檐), 1(脊)]，高度 = rise · f(u)。
//     f 用三叠加合成中式屋顶的三条特征：
//       举折 u^k      —— 檐口平缓、近脊陡峻（k > 1）
//       反宇 upA      —— 檐口处导数变负，檐口微微上翘
//       翼角 cornerA  —— 四个转角额外抬升，形成戗脊起翘
//  2. 构件层面补齐 正脊/垂脊/戗脊/宝顶、柱网、额枋、斗拱、隔扇、须弥座、栏板，
//     让建筑在近景下也有东西可看。
//
// 坐标约定：入参一律为「场景单位」，且单体的平面与竖向同尺（footU / vU 都是 1u = 30 m），
// 所以这里的长宽高可以直接 1:1 视觉比对。

import * as THREE from 'three';
import { mat, UNIT, instancedBoxes } from './lib.js';
import { clamp, lerp } from './geo.js';

/** instancedBoxes 在空列表时返回 null，直接 add(null) 会在更新矩阵时炸掉 */
function addInst(parent, items, material, opts) {
  const mesh = instancedBoxes(items, material, opts);
  if (mesh) parent.add(mesh);
  return mesh;
}

/* ==================== 0. 通用小工具 ==================== */

function nearestOnPoly(px, pz, poly) {
  let bd = Infinity, bx = 0, bz = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    let t = l2 > 1e-12 ? ((px - a[0]) * dx + (pz - a[1]) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a[0] + dx * t, qz = a[1] + dz * t;
    const d = Math.hypot(px - qx, pz - qz);
    if (d < bd) { bd = d; bx = qx; bz = qz; }
  }
  return { d: bd, x: bx, z: bz };
}

/** 从矩形内部点 P 沿单位方向 dir 射出边界的距离 */
function rayExit(px, pz, dx, dz, hw, hd) {
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (hw - px) / dx);
  else if (dx < -1e-9) t = Math.min(t, (-hw - px) / dx);
  if (dz > 1e-9) t = Math.min(t, (hd - pz) / dz);
  else if (dz < -1e-9) t = Math.min(t, (-hd - pz) / dz);
  return t === Infinity ? 1e-4 : Math.max(1e-4, t);
}

/** 举折 / 反宇剖面：u=0 檐口，u=1 正脊，返回 0..1 */
function roofProfile(u, k, upA, upR) {
  let y = Math.pow(u, k);
  if (upR > 0 && u < upR) {
    const s = 1 - u / upR;
    y += upA * s * s;
  }
  return y;
}

/**
 * 生成屋面高度场 y = fn(x, z)
 * ridgeLen > 0：源是正脊线段（庑殿）；srcRect：源是上层檐的矩形轮廓（歇山下层）
 */
function makeHeightFn({ w, d, ridgeLen, srcRect, rise, k, upA, upR, cornerA }) {
  const hw = w / 2, hd = d / 2;
  const eps = Math.max(1e-4, Math.min(w, d) * 2e-3);
  let src;
  if (srcRect) {
    const sw = srcRect[0] / 2, sd = srcRect[1] / 2;
    src = [[-sw, -sd], [sw, -sd], [sw, sd], [-sw, sd]];
  } else {
    // 正脊退化为一条极窄的矩形，这样「到多边形距离」统一适用于脊与矩形顶
    src = [[-ridgeLen / 2, -eps], [ridgeLen / 2, -eps], [ridgeLen / 2, eps], [-ridgeLen / 2, eps]];
  }
  return function height(x, z) {
    const n = nearestOnPoly(x, z, src);
    let dx = x - n.x, dz = z - n.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return rise;
    dx /= len; dz /= len;
    const dmax = rayExit(x, z, dx, dz, hw, hd);
    const u = clamp(dmax / (n.d + dmax), 0, 1);
    let y = roofProfile(u, k, upA, upR);
    if (cornerA > 0) {
      const cn = clamp(Math.abs(x) / hw + Math.abs(z) / hd - 1, 0, 1);
      y += cornerA * cn * cn * Math.pow(1 - u, 0.7);
    }
    return rise * y;
  };
}

/** 用高度场铺一张面；flip=true 法线朝上 */
function gridSurface(w, d, segX, segZ, fn, flip) {
  const pos = [], uvs = [], idx = [];
  for (let j = 0; j <= segZ; j++) {
    for (let i = 0; i <= segX; i++) {
      const x = -w / 2 + (w * i) / segX;
      const z = -d / 2 + (d * j) / segZ;
      pos.push(x, fn(x, z), z);
      uvs.push(i / segX, j / segZ);
    }
  }
  const row = segX + 1;
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * row + i, b = a + 1, c = a + row, dd = c + 1;
      if (flip) idx.push(a, c, dd, a, dd, b);
      else idx.push(a, dd, c, a, b, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 沿折线扫出一个方口管（用于正脊 / 戗脊 / 屋脊装饰） */
function sweepRect(pts, s, material) {
  const N = pts.length;
  if (N < 2) return null;
  const pos = [], idx = [];
  const t = new THREE.Vector3(), side = new THREE.Vector3(), nrm = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(N - 1, i + 1)];
    t.set(next.x - prev.x, next.y - prev.y, next.z - prev.z);
    if (t.lengthSq() < 1e-12) t.set(0, 0, 1);
    t.normalize();
    side.crossVectors(up, t);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0); else side.normalize();
    nrm.crossVectors(t, side).normalize();
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(
        p.x + side.x * a * s * 0.5 + nrm.x * b * s * 0.5,
        p.y + side.y * a * s * 0.5 + nrm.y * b * s * 0.5,
        p.z + side.z * a * s * 0.5 + nrm.z * b * s * 0.5,
      );
    }
  }
  for (let i = 0; i < N - 1; i++) {
    const a = i * 4, b = (i + 1) * 4;
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      idx.push(a + k, b + k, b + k2, a + k, b + k2, a + k2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

/* ==================== 1. 屋顶 ==================== */

/**
 * 庑殿顶 / 四阿顶（ridgeLen=0 时退化为攒尖顶）
 * 返回 Group，原点在檐口标高；屋面从 y=0 升到 y=rise。
 * ridgeLen 相对建筑通面阔而言较短，通常 0.3~0.5 w。
 */
export function hipRoof({
  w, d, rise, ridgeLen = 0,
  k = 1.72, upA = 0.11, upR = 0.26, cornerA = 0.15,
  color = '#c9a227', segX = 20, segZ = 20,
  ridge = true, ridgeColor = '#4a4038', ridgeSize = null,
  finial = false, finialColor = '#d9b451', srcRect = null,
}) {
  const g = new THREE.Group();
  const hf = makeHeightFn({ w, d, ridgeLen, srcRect, rise, k, upA, upR, cornerA });
  const geo = gridSurface(w, d, segX, segZ, hf, true);
  const roof = new THREE.Mesh(geo, mat(color, { rough: 0.72, side: THREE.DoubleSide, env: 0.4 }));
  roof.castShadow = true; roof.receiveShadow = true;
  g.add(roof);

  // 脊/吻尺寸随「举高 rise」走，而不是随面阔 w——否则宽屋顶的脊饰会无端拔高建筑总高。
  const rs = Math.max(0.012, Math.min(ridgeSize ?? Math.max(0.02, Math.min(w, d) * 0.055), rise * 0.20));
  const rMat = mat(ridgeColor, { rough: 0.78, side: THREE.DoubleSide });

  if (ridge) {
    const sampleLine = (x0, z0, x1, z1, n = 14) => {
      const p = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = lerp(x0, x1, t), z = lerp(z0, z1, t);
        p.push(new THREE.Vector3(x, hf(x, z) + rs * 0.45, z));
      }
      return p;
    };
    const hw = w / 2, hd = d / 2, rl = ridgeLen / 2;

    if (ridgeLen > 1e-3) {
      // 正脊
      const top = sampleLine(-rl, 0, rl, 0, 8);
      const main = sweepRect(top, rs * 1.35, rMat);
      if (main) g.add(main);
      // 正吻（两端上翘的吞脊兽）——高度随 rise 收，避免宽屋顶脊饰过高
      for (const sx of [-1, 1]) {
        const bm = sweepRect([
          new THREE.Vector3(sx * rl, rs * 0.3, 0),
          new THREE.Vector3(sx * (rl + rs * 1.0), rise * 0.10, 0),
          new THREE.Vector3(sx * (rl + rs * 1.6), rise * 0.16, 0),
        ], rs * 0.6, rMat);
        if (bm) g.add(bm);
        bm?.position.setY(rise - rs * 0.3);
      }
      // 四条戗脊：正脊两端 → 四角
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(sweepRect(sampleLine(sx * rl, 0, sx * hw * 0.995, sz * hd * 0.995), rs, rMat));
      }
    } else {
      // 攒尖：由顶点辐射到四角的垂脊
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(sweepRect(sampleLine(0, 0, sx * hw * 0.995, sz * hd * 0.995), rs * 0.85, rMat));
      }
    }
  }

  if (finial) {
    // 宝顶：须弥座 + 相轮 + 宝珠。尺寸随「举高 rise」收，使宝顶附加高度 ≈ rise*0.14，
    // 不会突破 data.js 声明的总高（chineseHall / makePavilion 会为宝顶预留这部分举高）。
    const finialRS = Math.min(rs, rise * 0.03);
    const cx = new THREE.Group();
    const fm = mat(finialColor, { metal: 0.6, rough: 0.32, env: 1.0 });
    const base = new THREE.Mesh(UNIT.cyl.clone(), fm);
    base.scale.set(finialRS * 2.0, finialRS * 0.7, finialRS * 2.0);
    cx.add(base);
    const stem = new THREE.Mesh(UNIT.cyl.clone(), fm);
    stem.scale.set(finialRS * 0.45, finialRS * 2.8, finialRS * 0.45);
    stem.position.y = finialRS * 0.6;
    cx.add(stem);
    const ball = new THREE.Mesh(UNIT.sphere.clone(), fm);
    ball.scale.setScalar(finialRS * 1.3);
    ball.position.y = finialRS * 3.4;
    cx.add(ball);
    for (const m of cx.children) m.castShadow = true;
    cx.position.y = rise;
    g.add(cx);
  }
  return g;
}

/**
 * 歇山顶：上层短脊庑殿 + 下层一圈披檐 + 端部山花。
 * 用「外层檐口 → 上层檐」的两段式折线比拟真实收山做法。
 */
export function gableHipRoof({
  w, d, rise, ridgeLen = null, gableInset = 0.22, upperRatio = 0.68,
  k = 1.7, upA = 0.11, upR = 0.26, cornerA = 0.15,
  color = '#c9a227', ridgeColor = '#4a4038', segX = 18, segZ = 18, finial = false,
}) {
  const grp = new THREE.Group();
  const rl = ridgeLen ?? w * 0.42;

  // 下层：以「上层檐矩形轮廓」为源向四外披下，得到真正环绕的一圈披檐
  const uw = w * (1 - gableInset), ud = d * (1 - gableInset);
  const lowerRise = rise * (1 - upperRatio);
  const lower = hipRoof({
    w, d, rise: lowerRise, srcRect: [uw, ud], k: 1.35,
    upA: upA * 1.4, upR, cornerA: cornerA * 1.25,
    color, segX, segZ, ridge: false,
  });
  grp.add(lower);

  // 上层：正脊接近通长，只在两端保留小歇 —— 这正是歇山顶的轮廓来源
  const upper = hipRoof({
    w: uw, d: ud, rise: rise * upperRatio, ridgeLen: rl * 0.92,
    k, upA, upR, cornerA: cornerA * 0.7, color, segX, segZ,
    ridge: true, ridgeColor, finial,
  });
  upper.position.y = lowerRise;
  grp.add(upper);

  return grp;
}

/** 悬山 / 硬山双坡：用于民居与配殿 */
export function gableRoof({
  w, d, rise, k = 1.6, upA = 0.09, upR = 0.24,
  color = '#4f5a52', ridgeColor = '#3a3630', segX = 14, segZ = 14, barge = true,
}) {
  const grp = new THREE.Group();
  const hw = w / 2, hd = d / 2;
  const pos = [], uvs = [], idx = [];
  const twoSided = (z, i, j, flip) => {
    const x = -hw + (w * i) / segX;
    const u = j / segZ;                        // 0 在檐口，1 在脊
    const y = rise * roofProfile(u, k, upA, upR);
    pos.push(x, y, z);
    uvs.push(i / segX, u);
    return { x, y, z };
  };
  for (const sz of [-1, 1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= segZ; j++) {
      for (let i = 0; i <= segX; i++) twoSided(sz * hd, i, j);
    }
    const row = segX + 1;
    for (let j = 0; j < segZ; j++) for (let i = 0; i < segX; i++) {
      const a = base + j * row + i, b = a + 1, c = a + row, dd = c + 1;
      if (sz < 0) idx.push(a, c, dd, a, dd, b);
      else idx.push(a, dd, c, a, b, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const roof = new THREE.Mesh(g, mat(color, { rough: 0.8, side: THREE.DoubleSide }));
  roof.castShadow = true; roof.receiveShadow = true;
  grp.add(roof);

  // 脊尺寸随举高 rise 收（与 hipRoof 一致），避免宽屋顶脊饰拔高总高
  const rs = Math.max(0.012, Math.min(d * 0.05, rise * 0.20));
  const rMat = mat(ridgeColor, { rough: 0.8, side: THREE.DoubleSide });
  grp.add(sweepRect([
    new THREE.Vector3(-hw, rise + rs * 0.5, 0),
    new THREE.Vector3(hw, rise + rs * 0.5, 0),
  ], rs * 1.4, rMat));
  if (barge) {
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const pt = [];
      for (let j = 0; j <= 10; j++) {
        const u = j / 10;
        pt.push(new THREE.Vector3(sx * hw, rise * roofProfile(u, k, upA, upR), lerp(0, sz * hd, u)));
      }
      grp.add(sweepRect(pt, rs * 0.85, rMat));
    }
  }
  return grp;
}

/* ==================== 2. 台基 / 栏杆 ==================== */

/** 须弥座：束腰收进的基座（上下枋 + 束腰 + 圭脚） */
export function pedestal(w, d, h, color = '#e8e3d6', cols = null) {
  const g = new THREE.Group();
  const m = mat(color, { rough: 0.9, env: 0.45 });
  const bands = [
    { y: 0, s: 1.0, hh: 0.10 },
    { y: 0.10, s: 0.965, hh: 0.06 },
    { y: 0.16, s: 0.88, hh: 0.56 },   // 束腰（收进）
    { y: 0.72, s: 0.965, hh: 0.06 },
    { y: 0.78, s: 1.0, hh: 0.22 },
  ];
  for (const b of bands) {
    const box = new THREE.Mesh(UNIT.box, m);
    box.scale.set(w * b.s, h * b.hh, d * b.s);
    box.position.y = h * b.y;
    box.castShadow = true; box.receiveShadow = true;
    g.add(box);
  }
  // 束腰立柱（间柱）
  if (cols !== null) {
    const cm = mat(color, { rough: 0.88 });
    const n = cols;
    for (let i = 1; i < n; i++) {
      const x = -w / 2 + (w * i) / n;
      for (const sz of [-1, 1]) {
        const c = new THREE.Mesh(UNIT.box, cm);
        c.scale.set(h * 0.05, h * 0.56, h * 0.05);
        c.position.set(x, h * 0.16, (sz * d * 0.88) / 2);
        g.add(c);
      }
    }
  }
  return g;
}

/** 勾栏：栏板 + 望柱（沿矩形一圈） */
export function balustrade(w, d, h, color = '#e8e3d6', postStep = null) {
  const g = new THREE.Group();
  const pm = mat(color, { rough: 0.9 });
  const step = postStep ?? Math.max(h * 1.6, 0.35);
  const items = [];
  // 两条长边 + 两条短边（含起点/终点，转角处望柱会重合，肉眼不可见）
  const edges = [
    { len: w, rot: 0, off: [-0, -d / 2] },
    { len: w, rot: 0, off: [0, d / 2] },
    { len: d, rot: Math.PI / 2, off: [-w / 2, 0] },
    { len: d, rot: Math.PI / 2, off: [w / 2, 0] },
  ];
  for (const e of edges) {
    const n = Math.max(2, Math.round(e.len / step));
    for (let i = 0; i <= n; i++) {
      const t = (i / n - 0.5) * e.len;
      const x = e.off[0] + Math.cos(e.rot) * t;
      const z = e.off[1] + Math.sin(e.rot) * t;
      items.push({ x, z, y: 0, w: h * 0.16, h: h * 1.16, d: h * 0.16 });
    }
    // 栏板
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n - 0.5) * e.len;
      const x = e.off[0] + Math.cos(e.rot) * t;
      const z = e.off[1] + Math.sin(e.rot) * t;
      items.push({ x, z, y: h * 0.18, w: e.len / n * 0.86, h: h * 0.62, d: h * 0.1, rot: e.rot });
    }
    // 扶手（地栿上面的横枋）
    items.push({ x: e.off[0], z: e.off[1], y: h * 0.92, w: e.len, h: h * 0.16, d: h * 0.2, rot: e.rot });
    items.push({ x: e.off[0], z: e.off[1], y: 0, w: e.len, h: h * 0.16, d: h * 0.26, rot: e.rot });
  }
  const mesh = instancedBoxes(items, pm, { uvU: 1.2, uvV: 1.2 });
  if (mesh) { g.add(mesh); }
  return g;
}

/* ==================== 3. 木构：柱/枋/斗拱/装修 ==================== */

/**
 * 柱网 + 额枋 + 平板枋。
 * bays: 开间数；柱列沿面阔方向 bays+1 根，进深方向 depthBays+1 根。
 */
export function postGrid({
  w, d, h, bays = 7, depthBays = 3, r = null,
  color = '#a13f2c', beamColor = '#4d6b52', base = true,
}) {
  const g = new THREE.Group();
  const pr = r ?? Math.min(w / (bays + 1) * 0.16, h * 0.075);
  const cm = mat(color, { rough: 0.82, env: 0.4 });
  const bm = mat(beamColor, { rough: 0.8 });
  const items = [];
  const nx = bays + 1, nz = depthBays + 1;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      // 中国古建：尽间收窄，柱不落在正墙角上
      const x = lerp(-w / 2, w / 2, i / (nx - 1));
      const z = lerp(-d / 2, d / 2, j / (nz - 1));
      if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) {
        continue;   // 内柱略去，只做外檐一圈
      }
      items.push({ x, z, y: 0, w: pr * 2, h, d: pr * 2 });
      if (base) items.push({ x, z, y: -h * 0.02, w: pr * 2.9, h: h * 0.045, d: pr * 2.9 });
    }
  }
  g.add(instancedBoxes(items, cm, { uvU: 1.6, uvV: 1.6 }));

  // 额枋（柱顶横向拉接）+ 平板枋（再上一层）
  const bx = [];
  for (let j = 0; j < nz; j++) {
    const z = lerp(-d / 2, d / 2, j / (nz - 1));
    bx.push({ x: 0, z, y: h * 0.86, w: w, h: pr * 1.5, d: pr * 1.6 });
    bx.push({ x: 0, z, y: h * 0.95, w: w * 1.02, h: pr * 0.8, d: pr * 2.0 });
  }
  for (let i = 0; i < nx; i++) {
    const x = lerp(-w / 2, w / 2, i / (nx - 1));
    bx.push({ x, z: 0, y: h * 0.86, w: pr * 1.5, h: pr * 1.5, d: d });
    bx.push({ x, z: 0, y: h * 0.95, w: pr * 2.0, h: pr * 0.8, d: d * 1.02 });
  }
  g.add(instancedBoxes(bx, bm, { uvU: 1.6, uvV: 1.6 }));
  return g;
}

/**
 * 斗拱层：沿一圈布「栌斗 + 华拱两层出跳 + 散斗」。
 * 用实例化小块近似，近景才看得清；远看只是一条出檐阴影带。
 */
export function dougong({ w, d, y, unit = null, count = null, color = '#3f6b52', tier = 2 }) {
  const g = new THREE.Group();
  const u = unit ?? Math.min(w, d) * 0.045;
  const per = Math.max(4, count ?? Math.round(w / (u * 3.2)));
  const items = [];
  const edges = [
    { x0: -w / 2, z0: -d / 2, x1: w / 2, z1: -d / 2, ry: 0 },
    { x0: -w / 2, z0: d / 2, x1: w / 2, z1: d / 2, ry: 0 },
    { x0: -w / 2, z0: -d / 2, x1: -w / 2, z1: d / 2, ry: Math.PI / 2 },
    { x0: w / 2, z0: -d / 2, x1: w / 2, z1: d / 2, ry: Math.PI / 2 },
  ];
  for (const e of edges) {
    const len = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
    const n = Math.max(3, Math.round(per * (len / Math.max(w, d))));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = lerp(e.x0, e.x1, t), z = lerp(e.z0, e.z1, t);
      const dx = (e.x1 - e.x0) / len, dz = (e.z1 - e.z0) / len;
      // 出挑方向朝向外侧：该边的法线
      const nx = dz, nz = -dx;
      const sgn = Math.sign((x - 0) * nx + (z - 0) * nz) || 1;
      const ox = nx * sgn, oz = nz * sgn;
      // 栌斗
      items.push({ x, z, y, w: u, h: u * 0.55, d: u });
      // 华拱：逐层向外每跳 u*0.9
      for (let t2 = 1; t2 <= tier; t2++) {
        const off = u * 0.9 * t2;
        items.push({
          x: x + ox * off, z: z + oz * off, y: y + u * (0.55 + (t2 - 1) * 0.55),
          w: u * 2.2, h: u * 0.42, d: u * 0.62, rot: Math.atan2(dx, dz) + Math.PI / 2,
        });
        // 散斗
        items.push({ x: x + ox * off, z: z + oz * off, y: y + u * (0.97 + (t2 - 1) * 0.55), w: u * 0.6, h: u * 0.4, d: u * 0.6 });
      }
    }
  }
  const mesh = instancedBoxes(items, mat(color, { rough: 0.85 }), { uvU: 1.2, uvV: 1.2 });
  if (mesh) g.add(mesh);
  return g;
}

/** 墙体：隔扇Door / 槛窗 / 实墙，沿矩形四周布置 */
export function wallBody({
  w, d, h, y = 0, doorSide = 1, color = '#a13f2c', openingColor = '#3a3229',
  bays = 5, lattice = true, sillH = 0.18,
}) {
  const g = new THREE.Group();
  const wm = mat(color, { rough: 0.9 });
  const om = mat(openingColor, { rough: 0.85 });
  const items = [], opens = [];  const edges = [
    { cx: 0, cz: -d / 2, len: w, rot: 0, front: false },
    { cx: 0, cz: d / 2, len: w, rot: 0, front: true },
    { cx: -w / 2, cz: 0, len: d, rot: Math.PI / 2, front: false },
    { cx: w / 2, cz: 0, len: d, rot: Math.PI / 2, front: false },
  ];
  for (const e of edges) {
    const isFront = e.front && doorSide > 0;
    const t = h * 0.055;
    // 实墙体（留出门窗洞口的位置由 bays 决定）
    if (isFront) {
      const n = bays;
      for (let i = 0; i < n; i++) {
        const c = (i + 0.5) / n - 0.5;
        const px = e.cx + Math.cos(e.rot) * c * e.len;
        const pz = e.cz + Math.sin(e.rot) * c * e.len;
        const mid = i > 0 && i < n - 1;
        if (mid) {
          // 明间/次间：隔扇门到顶
          opens.push({ x: px, z: pz, y: y + h * sillH, w: e.len / n * 0.86, h: h * (1 - sillH - 0.06), d: t * 0.7, rot: e.rot });
        } else {
          // 梢间：槛窗
          opens.push({ x: px, z: pz, y: y + h * 0.42, w: e.len / n * 0.8, h: h * 0.5, d: t * 0.7, rot: e.rot });
        }
      }
    }
    items.push({ x: e.cx, z: e.cz, y, w: e.len, h, d: t, rot: e.rot });
  }
  if (items.length) g.add(instancedBoxes(items, wm, { uvU: 1.5, uvV: 1.5 }));
  if (opens.length && lattice) {
    const mesh = instancedBoxes(opens, om, { uvU: 1.5, uvV: 1.5 });
    if (mesh) g.add(mesh);
  }
  return g;
}

/* ==================== 4. 合成：一座殿宇 ==================== */

/**
 * 中式殿堂：须弥座台基 + 柱网 + 墙体（含隔扇）+ 斗拱 + 曲面屋顶
 * 总高严格等于 pedestalH + bodyH + roofRise（供 smoke 校验）。
 */
export function chineseHall({
  w, d, pedestalH, bodyH, roofRise,
  bays = 7, depthBays = 3,
  roofType = 'hip',                       // 'hip' | 'gable-hip' | 'gable'
  ridgeLen = null, finial = false,
  stoneColor = '#e8e3d6', postColor = '#a13f2c', wallColor = '#a13f2c',
  roofColor = '#c9a227', ridgeColor = '#4a4038',
  dougongTier = 2, dougongUnit = null, rails = true, doors = 1, segX = 16, segZ = 16,
}) {
  const g = new THREE.Group();

  if (pedestalH > 0) {
    const p = pedestal(w * 1.16, d * 1.16, pedestalH, stoneColor, bays);
    g.add(p);
    if (rails) {
      const b = balustrade(w * 1.16, d * 1.16, pedestalH * 0.42, stoneColor);
      b.position.y = pedestalH;
      g.add(b);
    }
  }
  const yWall = pedestalH;

  const posts = postGrid({ w, d, h: bodyH, bays, depthBays, color: postColor });
  posts.position.y = yWall;
  g.add(posts);

  const wb = wallBody({ w: w * 0.985, d: d * 0.985, h: bodyH * 0.92, y: yWall, color: wallColor, bays, doorSide: doors });
  g.add(wb);

  if (dougongTier > 0) {
    const dg = dougong({
      w: w * 1.03, d: d * 1.03, y: yWall + bodyH * 0.96,
      unit: dougongUnit, tier: dougongTier,
    });
    g.add(dg);
  }

  const eaveW = w * 1.30, eaveD = d * 1.30;   // 出檐（约柱高的 1/3 向四周摊开）
  // 宝顶（finial）会额外抬高 rise*0.14 左右，这里把举高按比例让出，
  // 使「台基 + 屋身 + 屋面 + 宝顶」严格等于 pedestalH + bodyH + roofRise（即 data.js 总高）。
  const roofActual = finial ? roofRise * 0.876 : roofRise;
  let roof;
  if (roofType === 'hip') {
    roof = hipRoof({ w: eaveW, d: eaveD, rise: roofActual, ridgeLen: ridgeLen ?? eaveW * 0.46, color: roofColor, ridgeColor, finial, segX, segZ });
  } else if (roofType === 'gable-hip') {
    roof = gableHipRoof({ w: eaveW, d: eaveD, rise: roofActual, ridgeLen: ridgeLen ?? eaveW * 0.42, color: roofColor, ridgeColor, finial, segX, segZ });
  } else {
    roof = gableRoof({ w: eaveW, d: eaveD, rise: roofActual, color: roofColor, ridgeColor, segX, segZ });
  }
  roof.position.y = yWall + bodyH;
  g.add(roof);
  return g;
}

/* ==================== 5. 楼阁 ==================== */

/**
 * 多层楼阁：每层 腰檐平座 + 主体，顶层收分后用歇山/攒尖顶。
 * floors: [{w,d,h}] 自下而上；顶层屋顶高度由 topRoof 指定。
 */
export function storiedPavilion({
  floors, eaveW, topRoof, topType = 'hip', ridgeLen = null, finial = true,
  postColor = '#a13f2c', wallColor = '#a13f2c', roofColor = '#c9a227',
  stoneColor = '#e8e3d6', terrace = true, bays = 5,
}) {
  const g = new THREE.Group();
  let y = 0;
  const eaveRise = eaveW * 0.20;
  floors.forEach((f, i) => {
    const last = i === floors.length - 1;
    const body = postGrid({ w: f.w, d: f.d, h: f.h, bays, depthBays: Math.max(2, Math.round(bays * 0.5)), color: postColor });
    body.position.y = y;
    g.add(body);
    if (!last) {
      const wb = wallBody({ w: f.w * 0.96, d: f.d * 0.96, h: f.h * 0.9, y, color: wallColor, bays });
      g.add(wb);
    }
    // 腰檐（平座）
    const ew = f.w * 1.26, ed = f.d * 1.26;
    const eave = hipRoof({
      w: ew, d: ed, rise: eaveRise, ridgeLen: ew * 0.42,
      color: roofColor, ridge: true, segX: 14, segZ: 14,
      k: 1.6, upA: 0.13, upR: 0.3, cornerA: 0.18,
    });
    eave.position.y = y + f.h - eaveRise * 0.55;
    g.add(eave);
    if (terrace && !last) {
      const bl = balustrade(f.w * 1.06, f.d * 1.06, f.h * 0.06, stoneColor);
      bl.position.y = y + f.h - eaveRise * 0.55 + eaveRise * 0.35;
      g.add(bl);
    }
    y += f.h;
  });
  const top = floors[floors.length - 1];
  let topR;
  if (topType === 'hip') {
    topR = hipRoof({ w: top.w * 1.30, d: top.d * 1.30, rise: topRoof, ridgeLen: ridgeLen ?? top.w * 0.5, color: roofColor, finial });
  } else {
    topR = hipRoof({ w: top.w * 1.30, d: top.d * 1.30, rise: topRoof, ridgeLen: 0, color: roofColor, finial });
  }
  topR.position.y = y;
  g.add(topR);
  return g;
}

/* ==================== 6. 现代：幕墙塔 ==================== */

/** 竖直幕墙竖挺 + 楼层线，贴着 boxes 生成的体块表面走一圈 */
export function curtainMullions({ w, d, y0, y1, colW = null, rowH = null, color = '#8e969c' }) {
  const cw = colW ?? Math.max(0.06, Math.min(w, d) / 7);
  const rh = rowH ?? Math.max(0.12, (y1 - y0) / 26);
  const items = [];
  const t = Math.min(w, d) * 0.012;
  for (let x = -w / 2; x <= w / 2 + 1e-6; x += cw) {
    items.push({ x, z: -d / 2 - t * 0.5, y: y0, w: t * 0.8, h: y1 - y0, d: t });
    items.push({ x, z: d / 2 + t * 0.5, y: y0, w: t * 0.8, h: y1 - y0, d: t });
  }
  for (let z = -d / 2; z <= d / 2 + 1e-6; z += cw) {
    items.push({ x: -w / 2 - t * 0.5, z, y: y0, w: t, h: y1 - y0, d: t * 0.8 });
    items.push({ x: w / 2 + t * 0.5, z, y: y0, w: t, h: y1 - y0, d: t * 0.8 });
  }
  for (let y = y0; y <= y1 + 1e-6; y += rh) {
    items.push({ x: 0, z: -d / 2 - t * 0.5, y, w: w, h: t * 0.9, d: t * 0.7 });
    items.push({ x: 0, z: d / 2 + t * 0.5, y, w: w, h: t * 0.9, d: t * 0.7 });
    items.push({ x: -w / 2 - t * 0.5, z: 0, y, w: t * 0.7, h: t * 0.9, d: d });
    items.push({ x: w / 2 + t * 0.5, z: 0, y, w: t * 0.7, h: t * 0.9, d: d });
  }
  const mesh = instancedBoxes(items, mat(color, { metal: 0.5, rough: 0.4 }), { uvU: 1.5, uvV: 1.5 });
  const g = new THREE.Group();
  if (mesh) g.add(mesh);
  return g;
}

export default {
  hipRoof, gableHipRoof, gableRoof, pedestal, balustrade,
  postGrid, dougong, wallBody, chineseHall, storiedPavilion, curtainMullions, sweepRect,
};
