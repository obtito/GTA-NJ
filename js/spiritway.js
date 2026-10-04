// 明孝陵神道石像生 · 程序化六兽（狮/獬豸/骆驼/象/麒麟/马）+ 翁仲（文臣/武将）
// 造型构造法移植自 hafewa/chinese-ancient-architecture-sandbox (MIT)：
//   须弥座三层（下枋/束腰/上枋）+ 复合原语造型（躯干/胸/头/颈/卷毛/口鼻/四肢）。
// 本模块按该构造法重写并扩展为神道六兽体系，适配本仓材质与合批管线。
// 尺度： Statue 内部以「米」为坐标单位搭建（真实体量），整体 scale=1/30（=vU/footU 口径，
//   单体长宽比真实）；落位与朝向由调用方给场景坐标。

import * as THREE from 'three';

/* ---------------- 原语工具（米单位 · 投影无光照合批用） ---------------- */

function box(g, m, x, y, z, w, h, d, ry = 0, rx = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry; mesh.rotation.x = rx;
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

function cyl(g, m, x, y, z, r, h, seg = 10, rt = null, rx = 0) {
  const geo = new THREE.CylinderGeometry(rt === null ? r : rt, r, h, seg);
  if (rx) geo.rotateX(rx);
  geo.translate(0, rx ? 0 : h / 2, rx ? h / 2 : 0);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

function sph(g, m, x, y, z, r, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

function cone(g, m, x, y, z, r, h, rx = 0) {
  const geo = new THREE.ConeGeometry(r, h, 8);
  if (rx) geo.rotateX(rx);
  geo.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

/** 须弥座：下枋—束腰—上枋三层（sandbox 构造法）。返回座面高度（米）。 */
function sumeru(g, m, w, d, hh = 0.5) {
  box(g, m, 0, hh * 0.18, 0, w, hh * 0.36, d);
  box(g, m, 0, hh * 0.58, 0, w * 0.86, hh * 0.28, d * 0.9);
  box(g, m, 0, hh * 0.84, 0, w * 0.95, hh * 0.32, d * 0.97);
  return hh;
}

/* ---------------- 通用头部/躯干件（米单位，面朝 +Z） ---------------- */

/** 兽首：头盒 + 口鼻 + 双目 + 双耳（earR=0 无耳）+ 选项卷毛鬃 */
function beastHead(g, m, x, y, z, s, opt = {}) {
  const { snout = 0.72, ears = 0.34, curls = 0, jaw = 0 } = opt;
  box(g, m, x, y, z, s, s, s * 0.92);
  box(g, m, x, y - s * 0.18, z + s * (0.42 + snout * 0.22), s * snout, s * 0.4, s * 0.34); // 口鼻
  sph(g, m, x - s * 0.24, y + s * 0.16, z + s * 0.42, s * 0.09);   // 双目
  sph(g, m, x + s * 0.24, y + s * 0.16, z + s * 0.42, s * 0.09);
  if (ears > 0) {
    box(g, m, x - s * 0.44, y + s * 0.42, z - s * 0.1, s * 0.14, s * ears, s * 0.1);
    box(g, m, x + s * 0.44, y + s * 0.42, z - s * 0.1, s * 0.14, s * ears, s * 0.1);
  }
  for (let i = 0; i < curls; i++) {                                  // 卷毛鬃（狮/獬豸）
    const k = curls === 1 ? 0 : (i / (curls - 1)) * 2 - 1;
    sph(g, m, x + k * s * 0.5, y + s * (0.52 - Math.abs(k) * 0.1), z - s * 0.16 - Math.abs(k) * s * 0.05, s * 0.16);
  }
  if (jaw > 0) box(g, m, x, y - s * 0.46, z + s * 0.3, s * 0.7, s * jaw, s * 0.3); // 颌/垂胡
}

/** 站姿四肢：前腿直立 + 后腿厚臀（cyl 半埋躯干，粗细 lr 按体量给） */
function standingLegs(g, m, legH, bodyL, spread, lr) {
  for (const sx of [-1, 1]) {
    cyl(g, m, sx * spread * 0.6, 0, bodyL * 0.34, lr, legH, 8);
    cyl(g, m, sx * spread * 0.66, 0, -bodyL * 0.3, lr, legH, 8);
    sph(g, m, sx * spread * 0.72, legH * 0.18, -bodyL * 0.44, lr * 1.5, 1, 0.8, 1.25); // 臀股
  }
}

/* ---------------- 六兽（均为「一立一卧」两态，座面 y=0 起算） ---------------- */

/** 狮：卷毛鬃首 + 前踞后蹲。立 2.4 m，卧 1.7 m */
function lion(g, m, lying) {
  const pedH = sumeru(g, m, 1.7, 2.4, 0.55);
  if (lying) {
    box(g, m, 0, pedH + 0.5, -0.1, 0.78, 0.72, 1.7);                       // 匍卧躯干
    box(g, m, 0, pedH + 0.14, 0.72, 0.62, 0.28, 0.66);                     // 前爪伏地
    sph(g, m, 0, pedH + 0.62, 0.72, 0.3, 1.1, 1.0, 0.85);                  // 胸
    beastHead(g, m, 0, pedH + 1.18, 0.62, 0.52, { curls: 5, snout: 0.75 });
    sph(g, m, 0, pedH + 0.34, -0.92, 0.16, 1, 0.7, 1.4);                   // 尾
  } else {
    standingLegs(g, m, 0.85, 1.5, 0.5, 0.15);
    box(g, m, 0, pedH + 1.05, -0.05, 0.7, 0.66, 1.5);                      // 躯干
    sph(g, m, 0, pedH + 1.1, 0.55, 0.34, 1.1, 1.2, 0.9);                   // 胸
    beastHead(g, m, 0, pedH + 1.62, 0.55, 0.52, { curls: 5, snout: 0.75 });
    cone(g, m, 0, pedH + 1.0, -0.8, 0.12, 0.7, -0.7);                      // 尾上竖
  }
}

/** 獬豸：狮身独角（额生角锥），神羊垂胡。立 2.3 m */
function xiezhi(g, m, lying) {
  const pedH = sumeru(g, m, 1.7, 2.4, 0.55);
  if (lying) {
    box(g, m, 0, pedH + 0.44, -0.1, 0.7, 0.6, 1.66);
    box(g, m, 0, pedH + 0.12, 0.72, 0.56, 0.24, 0.6);
    beastHead(g, m, 0, pedH + 1.0, 0.6, 0.48, { curls: 3, jaw: 0.4, ears: 0.3 });
    cone(g, m, 0, pedH + 1.28, 0.72, 0.09, 0.55, -0.35);                   // 独角后倾
  } else {
    standingLegs(g, m, 0.8, 1.45, 0.48, 0.13);
    box(g, m, 0, pedH + 0.98, -0.05, 0.62, 0.6, 1.45);
    beastHead(g, m, 0, pedH + 1.52, 0.52, 0.48, { curls: 3, jaw: 0.4, ears: 0.3 });
    cone(g, m, 0, pedH + 1.8, 0.64, 0.09, 0.55, -0.35);
  }
}

/** 骆驼：双峰驼，长颈昂首。立 3.1 m（峰顶） */
function camel(g, m, lying) {
  const pedH = sumeru(g, m, 1.9, 2.7, 0.6);
  const by = lying ? pedH + 0.62 : pedH + 1.42;
  if (lying) {
    box(g, m, 0, by, 0, 0.86, 0.72, 1.9);
    box(g, m, 0, pedH + 0.14, 0.78, 0.7, 0.26, 0.56);                      // 跪姿小腿后折
    for (const sz of [-1, 1]) box(g, m, 0, pedH + 0.32, sz * 0.72, 0.56, 0.5, 0.34);
  } else {
    standingLegs(g, m, 1.15, 1.9, 0.56, 0.16);
    box(g, m, 0, by, 0, 0.82, 0.78, 1.9);
  }
  sph(g, m, 0, by + 0.5, -0.3, 0.34, 1, 0.85, 1.25);                       // 双峰
  sph(g, m, 0, by + 0.5, 0.3, 0.34, 1, 0.85, 1.25);
  cyl(g, m, 0, by + 0.42, 0.78, 0.17, 0.85, 8, 0.21, 0.5);                 // 长颈前倾
  beastHead(g, m, 0, by + 1.28, 1.06, 0.4, { ears: 0.5, snout: 0.8 });
  box(g, m, 0, by - 0.3, -0.98, 0.1, 0.5, 0.16);                           // 尾
}

/** 象：巨躯垂鼻双牙大耳。立 3.3 m（背），通长 4.2 m */
function elephant(g, m, lying) {
  const pedH = sumeru(g, m, 2.3, 3.3, 0.6);
  const by = lying ? pedH + 0.9 : pedH + 1.6;
  if (lying) {
    sph(g, m, 0, by, -0.1, 1.16, 1, 0.95, 1.35);                           // 匍卧巨躯
    box(g, m, 0, pedH + 0.3, 0.95, 1.7, 0.5, 0.7);                         // 前腿侧伏
  } else {
    standingLegs(g, m, 1.3, 2.6, 0.72, 0.24);
    sph(g, m, 0, by, -0.15, 1.14, 1, 0.95, 1.3);
  }
  sph(g, m, 0, by + 0.34, 1.1, 0.62, 1, 0.95, 0.95);                       // 头
  box(g, m, -0.72, by + 0.3, 0.9, 0.34, 1.1, 0.62);                        // 大耳
  box(g, m, 0.72, by + 0.3, 0.9, 0.34, 1.1, 0.62);
  cyl(g, m, 0, by - 0.5, 1.45, 0.13, 1.15, 8, 0.075, 0.16);                // 垂鼻（微前弯）
  for (const sx of [-1, 1]) cone(g, m, sx * 0.3, by - 0.16, 1.62, 0.07, 0.62, 1.9); // 獠牙前伸
}

/** 麒麟：鹿身龙首，颈脊鬣棘，双角后倾。立 2.4 m */
function qilin(g, m, lying) {
  const pedH = sumeru(g, m, 1.8, 2.5, 0.55);
  if (lying) {
    box(g, m, 0, pedH + 0.46, -0.05, 0.66, 0.6, 1.7);
    box(g, m, 0, pedH + 0.13, 0.72, 0.54, 0.26, 0.58);
    beastHead(g, m, 0, pedH + 1.08, 0.64, 0.44, { snout: 1.05, ears: 0.42, jaw: 0.32 });
  } else {
    standingLegs(g, m, 0.9, 1.6, 0.5, 0.12);
    box(g, m, 0, pedH + 1.08, -0.05, 0.6, 0.62, 1.6);
    beastHead(g, m, 0, pedH + 1.68, 0.56, 0.44, { snout: 1.05, ears: 0.42, jaw: 0.32 });
  }
  for (let i = 0; i < 4; i++) {                                           // 颈脊鬣棘
    const t = i / 3;
    sph(g, m, 0, pedH + (lying ? 1.0 : 1.6) + t * 0.12, 0.5 - t * 1.0, 0.09);
  }
  for (const sx of [-0.35, 0.35]) cone(g, m, sx, pedH + (lying ? 1.36 : 1.98), 0.42, 0.07, 0.5, -0.4); // 双角
}

/** 马：鞍鞯备齐的仪仗马。立 2.9 m（耳顶） */
function horse(g, m, lying) {
  const pedH = sumeru(g, m, 1.8, 2.6, 0.55);
  const by = lying ? pedH + 0.66 : pedH + 1.34;
  if (lying) {
    box(g, m, 0, by, -0.05, 0.64, 0.66, 1.76);
    box(g, m, 0, pedH + 0.14, 0.76, 0.54, 0.28, 0.6);
  } else {
    standingLegs(g, m, 1.05, 1.7, 0.48, 0.11);
    box(g, m, 0, by, -0.05, 0.62, 0.68, 1.7);
  }
  box(g, m, 0, by + 0.3, -0.1, 0.66, 0.14, 0.9);                           // 鞍鞯
  sph(g, m, 0, by + 0.42, -0.1, 0.3, 1.15, 0.55, 1);                       // 鞍
  cyl(g, m, 0, by + 0.42, 0.66, 0.16, 0.72, 8, 0.2, 0.55);                 // 颈
  beastHead(g, m, 0, by + 1.14, 0.98, 0.36, { ears: 0.55, snout: 0.85 });
  cyl(g, m, 0, by - 0.24, -0.95, 0.07, 0.66, 6, 0.03, -2.2);              // 垂尾
}

/* ---------------- 翁仲（文臣 / 武将，通高 3.18 m 含座） ---------------- */

/** 武将：盔缨按剑。宽袍柱身 + 肩铠 + 盔 + 剑 */
function wuGeneral(g, m) {
  const pedH = sumeru(g, m, 1.3, 1.3, 0.4);
  cyl(g, m, 0, pedH, 0, 0.46, 2.0, 10, 0.6);                               // 袍身（上收下放）
  box(g, m, 0, pedH + 1.1, 0.42, 0.9, 0.3, 0.34);                          // 胸甲
  for (const sx of [-1, 1]) sph(g, m, sx * 0.52, pedH + 1.86, 0, 0.19);    // 肩
  box(g, m, 0, pedH + 2.06, 0.02, 0.38, 0.4, 0.38);                        // 首
  cone(g, m, 0, pedH + 2.28, 0, 0.24, 0.34);                               // 盔
  sph(g, m, 0, pedH + 2.62, 0, 0.1);                                       // 盔缨
  box(g, m, 0, pedH + 0.9, 0.5, 0.12, 1.5, 0.2);                           // 按剑（剑身直立于胸腹前）
  box(g, m, 0, pedH + 1.52, 0.5, 0.42, 0.12, 0.3);                         // 剑格
  sph(g, m, 0, pedH + 0.5, 0.5, 0.16);                                     // 剑镡球
}

/** 文臣：进贤冠持笏。袍身拱手 + 笏板 */
function wenMinister(g, m) {
  const pedH = sumeru(g, m, 1.3, 1.3, 0.4);
  cyl(g, m, 0, pedH, 0, 0.44, 2.0, 10, 0.58);
  box(g, m, 0, pedH + 1.06, 0.36, 0.86, 0.42, 0.3);                        // 拱手广袖
  for (const sx of [-1, 1]) sph(g, m, sx * 0.5, pedH + 1.82, 0, 0.18);
  box(g, m, 0, pedH + 2.02, 0.02, 0.38, 0.4, 0.38);
  box(g, m, 0, pedH + 2.26, 0, 0.42, 0.24, 0.42);                          // 进贤冠
  box(g, m, 0, pedH + 2.4, 0, 0.28, 0.06, 0.28);                           // 冠梁
  box(g, m, 0, pedH + 1.5, 0.44, 0.24, 0.8, 0.05);                         // 笏板（双手所持）
}

/* ---------------- 对外接口 ---------------- */

export const SPIRIT_BEASTS = ['lion', 'xiezhi', 'camel', 'elephant', 'qilin', 'horse'];

const BEAST_BUILDERS = { lion, xiezhi, camel, elephant, qilin, horse };

/**
 * 摆放一尊石兽。kind ∈ SPIRIT_BEASTS；lying=卧(跪)态；ry=0 时面朝 +Z。
 * x/y/z 为场景坐标（y=地面基标），内部按 1/30 等比缩放保持真实长宽比。
 */
export function addBeast(g, material, kind, x, y, z, lying, ry = 0) {
  const build = BEAST_BUILDERS[kind] || lion;
  const sub = new THREE.Group();
  build(sub, material, lying);
  sub.scale.setScalar(1 / 30);
  sub.position.set(x, y, z);
  sub.rotation.y = ry;
  g.add(sub);
  return sub;
}

/** 摆放一尊翁仲。wen=true 文臣 / false 武将。 */
export function addWengZhong(g, material, x, y, z, wen, ry = 0) {
  const sub = new THREE.Group();
  (wen ? wenMinister : wuGeneral)(sub, material);
  sub.scale.setScalar(1 / 30);
  sub.position.set(x, y, z);
  sub.rotation.y = ry;
  g.add(sub);
  return sub;
}
