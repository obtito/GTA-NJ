// 明孝陵神道石像生 · 程序化六兽（狮/獬豸/骆驼/象/麒麟/马）+ 翁仲（文臣/武将）
// 造型构造法移植自 hafewa/chinese-ancient-architecture-sandbox (MIT)：
//   须弥座三层（下枋/束腰/上枋）+ 复合原语造型（躯干/胸/头/颈/卷毛/口鼻/四肢）。
// 本模块按该构造法重写并扩展为神道六兽体系，适配本仓材质与合批管线。
// 尺度： Statue 内部以「米」为坐标单位搭建（真实体量），整体 scale=1/30（=vU/footU 口径，
//   单体长宽比真实）；落位与朝向由调用方给场景坐标。
// 精修版（2026-10-04）：特写目检反馈「积木感」——原语分段翻倍（sph 16×12 / cyl 12 / cone 10），
//   兽首加鬃毛层/鼻梁/獠牙/眉弓，兽躯加背弧/肋条/蹄钟，翁仲改钟形下摆三段袍+竖褶+
//   腰带玉佩+层叠甲片+颌须+面部。件数 ~45-60/尊，合批后 32 尊 ~18 万三角，预算内。

import * as THREE from 'three';
import { registerEnv } from './lib.js';

/* ---------------- 原语工具（米单位 · 投影无光照合批用） ---------------- */

function box(g, m, x, y, z, w, h, d, ry = 0, rx = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

// y = 柱底（rx 时改为自 (x,y,z) 向 +Z 伸出，适配颈/鼻等水平件）
function cyl(g, m, x, y, z, r, h, seg = 12, rt = null, rx = 0) {
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
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

function cone(g, m, x, y, z, r, h, rx = 0, seg = 10) {
  const geo = new THREE.ConeGeometry(r, h, seg);
  if (rx) geo.rotateX(rx);
  geo.translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

/** 须弥座：下枋—束腰（四角蜀柱）—上枋 + 座沿口。返回座面高度（米）。 */
function sumeru(g, m, w, d, hh = 0.5) {
  box(g, m, 0, hh * 0.18, 0, w, hh * 0.36, d);
  box(g, m, 0, hh * 0.58, 0, w * 0.86, hh * 0.28, d * 0.9);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])              // 束腰转角蜀柱
    box(g, m, sx * w * 0.39, hh * 0.58, sz * d * 0.41, w * 0.09, hh * 0.3, d * 0.09);
  box(g, m, 0, hh * 0.84, 0, w * 0.95, hh * 0.32, d * 0.97);
  box(g, m, 0, hh * 1.02, 0, w * 0.88, hh * 0.06, d * 0.9);        // 座沿口
  return hh;
}

/* ---------------- 通用头部/躯干件（米单位，面朝 +Z） ---------------- */

/**
 * 兽首（精修版）：头盒+顶弧破方 / 鼻梁 / 口鼻+垂颌+獠牙 / 双目+眉弓 / 锥耳 /
 * 鬃毛层（顶排卷球+两侧列球，mane>0 时启用）/ 额角（horn，米）。
 */
function beastHead(g, m, x, y, z, s, opt = {}) {
  const { snout = 0.72, ears = 0.34, mane = 0, curls = 0, jaw = 0, fangs = false, horn = 0 } = opt;
  box(g, m, x, y, z, s, s * 0.92, s * 0.92);
  sph(g, m, x, y + s * 0.36, z - s * 0.04, s * 0.5, 0.94, 0.5, 0.9);          // 顶弧破方
  sph(g, m, x, y + s * 0.14, z + s * 0.5, s * 0.11);                          // 鼻梁
  sph(g, m, x, y + s * 0.05, z + s * 0.6, s * 0.12);
  box(g, m, x, y - s * 0.2, z + s * (0.42 + snout * 0.22), s * snout, s * 0.42, s * 0.36); // 口鼻
  box(g, m, x, y - s * 0.06, z + s * (0.46 + snout * 0.3), s * snout * 0.92, s * 0.1, s * 0.14); // 吻部上翘唇线
  if (jaw > 0) {
    box(g, m, x, y - s * 0.48, z + s * 0.32, s * (0.42 + snout * 0.45), s * jaw, s * 0.34); // 垂颌
    if (fangs) for (const sx of [-1, 1])
      box(g, m, x + sx * s * 0.18, y - s * 0.42, z + s * 0.46, s * 0.08, s * 0.12, s * 0.06);
  }
  for (const sx of [-1, 1]) {                                                 // 双目+眉弓
    sph(g, m, x + sx * s * 0.26, y + s * 0.2, z + s * 0.44, s * 0.1);
    box(g, m, x + sx * s * 0.26, y + s * 0.33, z + s * 0.4, s * 0.24, s * 0.05, s * 0.1);
  }
  if (ears > 0) for (const sx of [-1, 1])
    cone(g, m, x + sx * s * 0.46, y + s * 0.4, z - s * 0.08, s * 0.1, s * ears);
  if (mane > 0) {
    for (let i = 0; i < 5; i++) {                                             // 顶排卷球
      const k = (i / 4) * 2 - 1;
      sph(g, m, x + k * s * 0.55, y + s * (0.58 - Math.abs(k) * 0.12), z - s * 0.2 - Math.abs(k) * s * 0.06, s * 0.17);
    }
    for (const sx of [-1, 1]) for (let j = 0; j < 3; j++)                     // 两侧列球
      sph(g, m, x + sx * s * (0.5 + j * 0.05), y + s * (0.44 - j * 0.19), z - s * 0.16 + j * s * 0.02, s * 0.14);
    box(g, m, x, y + s * 0.5, z - s * 0.34, s * 1.04, s * 0.5, s * 0.24);     // 颈后鬃盘（联排底衬）
    for (const sx of [-1, 1]) box(g, m, x + sx * s * 0.42, y + s * 0.46, z - s * 0.3, s * 0.18, s * 0.62, s * 0.2); // 颈侧鬃帘
  } else if (curls > 0) {
    for (let i = 0; i < curls; i++) {
      const k = curls === 1 ? 0 : (i / (curls - 1)) * 2 - 1;
      sph(g, m, x + k * s * 0.5, y + s * (0.55 - Math.abs(k) * 0.1), z - s * 0.16 - Math.abs(k) * s * 0.05, s * 0.16);
    }
  }
  if (horn > 0) cone(g, m, x, y + s * 0.62, z + s * 0.04, s * 0.08, s * horn, -0.35);
}

/** 站姿四肢：柱腿+蹄钟+厚臀；躯干背弧与侧肋由 bodyArc 提供。 */
function standingLegs(g, m, legH, bodyL, spread, lr) {
  for (const sx of [-1, 1]) {
    for (const [tx, tz] of [[spread * 0.6, bodyL * 0.34], [spread * 0.66, -bodyL * 0.3]]) {
      cyl(g, m, sx * tx, 0.12, tz, lr, legH - 0.12, 10);
      cyl(g, m, sx * tx, 0, tz, lr * 1.22, 0.14, 10, lr * 1.42);              // 蹄钟
    }
    sph(g, m, sx * spread * 0.72, legH * 0.18, -bodyL * 0.44, lr * 1.5, 1, 0.8, 1.25); // 臀股
  }
}

/** 躯干：主盒 + 背脊弧 + 两侧浮雕肋条。 */
function bodyArc(g, m, y, w, l, h) {
  box(g, m, 0, y, 0, w, h, l);
  sph(g, m, 0, y + h * 0.45, 0.05, w * 0.52, 1, 0.42, l * 0.92);              // 背脊弧
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++)                       // 肋条（浅浮雕探出）
    box(g, m, sx * (w / 2 + 0.015), y + h * 0.1, -0.28 + i * 0.5, 0.035, h * 0.55, 0.07);
}

/* ---------------- 六兽（均为「一立一卧」两态，座面 y=0 起算） ---------------- */

/** 狮：鬃毛层首 + 垂颌獠牙 + 前踞后蹲。立 2.4 m，卧 1.7 m */
function lion(g, m, lying) {
  const pedH = sumeru(g, m, 1.7, 2.4, 0.55);
  if (lying) {
    bodyArc(g, m, pedH + 0.5, 0.78, 1.7, 0.72);
    box(g, m, 0, pedH + 0.14, 0.72, 0.62, 0.28, 0.66);
    sph(g, m, 0, pedH + 0.62, 0.72, 0.3, 1.1, 1.0, 0.85);
    beastHead(g, m, 0, pedH + 1.18, 0.62, 0.52, { mane: 1, snout: 0.75, jaw: 0.34, fangs: true });
    sph(g, m, 0, pedH + 0.34, -0.92, 0.16, 1, 0.7, 1.4);
  } else {
    standingLegs(g, m, 0.85, 1.5, 0.5, 0.15);
    bodyArc(g, m, pedH + 1.05, 0.7, 1.5, 0.66);
    sph(g, m, 0, pedH + 1.1, 0.55, 0.34, 1.1, 1.2, 0.9);
    beastHead(g, m, 0, pedH + 1.62, 0.55, 0.52, { mane: 1, snout: 0.75, jaw: 0.34, fangs: true });
    cone(g, m, 0, pedH + 1.0, -0.8, 0.12, 0.7, -0.7);
  }
}

/** 獬豸：狮身独角（额生角锥），神羊垂胡。立 2.3 m */
function xiezhi(g, m, lying) {
  const pedH = sumeru(g, m, 1.7, 2.4, 0.55);
  if (lying) {
    bodyArc(g, m, pedH + 0.44, 0.7, 1.66, 0.6);
    box(g, m, 0, pedH + 0.12, 0.72, 0.56, 0.24, 0.6);
    beastHead(g, m, 0, pedH + 1.0, 0.6, 0.48, { curls: 3, jaw: 0.4, ears: 0.3, fangs: true });
  } else {
    standingLegs(g, m, 0.8, 1.45, 0.48, 0.13);
    bodyArc(g, m, pedH + 0.98, 0.62, 1.45, 0.6);
    beastHead(g, m, 0, pedH + 1.52, 0.52, 0.48, { curls: 3, jaw: 0.4, ears: 0.3, fangs: true });
  }
  cone(g, m, 0, pedH + (lying ? 1.34 : 1.86), lying ? 0.66 : 0.68, 0.09, 0.55, -0.35); // 独角后倾
}

/** 骆驼：双峰驼，长颈昂首。立 3.1 m（峰顶） */
function camel(g, m, lying) {
  const pedH = sumeru(g, m, 1.9, 2.7, 0.6);
  const by = lying ? pedH + 0.62 : pedH + 1.42;
  if (lying) {
    bodyArc(g, m, by, 0.86, 1.9, 0.72);
    box(g, m, 0, pedH + 0.14, 0.78, 0.7, 0.26, 0.56);
    for (const sz of [-1, 1]) box(g, m, 0, pedH + 0.32, sz * 0.72, 0.56, 0.5, 0.34);
  } else {
    standingLegs(g, m, 1.15, 1.9, 0.56, 0.16);
    bodyArc(g, m, by, 0.82, 1.9, 0.78);
  }
  sph(g, m, 0, by + 0.5, -0.3, 0.34, 1, 0.85, 1.25);
  sph(g, m, 0, by + 0.5, 0.3, 0.34, 1, 0.85, 1.25);
  cyl(g, m, 0, by + 0.42, 0.78, 0.17, 0.85, 10, 0.21, 0.5);
  beastHead(g, m, 0, by + 1.28, 1.06, 0.4, { ears: 0.5, snout: 0.8, jaw: 0.2 });
  box(g, m, 0, by - 0.3, -0.98, 0.1, 0.5, 0.16);
}

/** 象：巨躯垂鼻双牙大耳。立 3.3 m（背），通长 4.2 m */
function elephant(g, m, lying) {
  const pedH = sumeru(g, m, 2.3, 3.3, 0.6);
  const by = lying ? pedH + 0.9 : pedH + 1.6;
  if (lying) {
    sph(g, m, 0, by, -0.1, 1.16, 1, 0.95, 1.35);
    box(g, m, 0, pedH + 0.3, 0.95, 1.7, 0.5, 0.7);
  } else {
    standingLegs(g, m, 1.3, 2.6, 0.72, 0.24);
    sph(g, m, 0, by, -0.15, 1.14, 1, 0.95, 1.3);
  }
  sph(g, m, 0, by + 0.34, 1.1, 0.62, 1, 0.95, 0.95);
  sph(g, m, 0, by + 0.72, 1.02, 0.3, 1.1, 0.5, 1);                            // 额弧
  for (const sx of [-1, 1]) {                                                 // 大耳（双片错叠）
    box(g, m, sx * 0.74, by + 0.3, 0.9, 0.32, 1.12, 0.6, sx * 0.12);
    box(g, m, sx * 0.78, by + 0.26, 0.62, 0.2, 0.9, 0.36, sx * 0.2);
  }
  for (let i = 0; i < 3; i++)                                                 // 垂鼻三级柱（渐细）
    cyl(g, m, 0, by + 0.02 - i * 0.4, 1.5 + i * 0.06, 0.13 - i * 0.02, 0.44, 10, 0.11 - i * 0.02, 0.16);
  for (const sx of [-1, 1]) cone(g, m, sx * 0.3, by - 0.16, 1.62, 0.07, 0.62, 1.9); // 獠牙前伸
}

/** 麒麟：鹿身龙首，颈脊鬣棘，双角后倾。立 2.4 m */
function qilin(g, m, lying) {
  const pedH = sumeru(g, m, 1.8, 2.5, 0.55);
  if (lying) {
    bodyArc(g, m, pedH + 0.46, 0.66, 1.7, 0.6);
    box(g, m, 0, pedH + 0.13, 0.72, 0.54, 0.26, 0.58);
    beastHead(g, m, 0, pedH + 1.08, 0.64, 0.44, { snout: 1.05, ears: 0.42, jaw: 0.32, fangs: true });
  } else {
    standingLegs(g, m, 0.9, 1.6, 0.5, 0.12);
    bodyArc(g, m, pedH + 1.08, 0.6, 1.6, 0.62);
    beastHead(g, m, 0, pedH + 1.68, 0.56, 0.44, { snout: 1.05, ears: 0.42, jaw: 0.32, fangs: true });
  }
  for (let i = 0; i < 4; i++) {                                               // 颈脊鬣棘
    const t = i / 3;
    sph(g, m, 0, pedH + (lying ? 1.0 : 1.6) + t * 0.12, 0.5 - t * 1.0, 0.09);
  }
  for (const sx of [-0.35, 0.35]) cone(g, m, sx, pedH + (lying ? 1.4 : 2.0), 0.42, 0.07, 0.5, -0.4);
}

/** 马：鞍鞯备齐的仪仗马。立 2.9 m（耳顶） */
function horse(g, m, lying) {
  const pedH = sumeru(g, m, 1.8, 2.6, 0.55);
  const by = lying ? pedH + 0.66 : pedH + 1.34;
  if (lying) {
    bodyArc(g, m, by, 0.64, 1.76, 0.66);
    box(g, m, 0, pedH + 0.14, 0.76, 0.54, 0.28, 0.6);
  } else {
    standingLegs(g, m, 1.05, 1.7, 0.48, 0.11);
    bodyArc(g, m, by, 0.62, 1.7, 0.68);
  }
  box(g, m, 0, by + 0.3, -0.1, 0.66, 0.14, 0.9);                              // 鞍鞯
  box(g, m, 0, by + 0.26, -0.55, 0.7, 0.2, 0.2);                              // 后鞧
  sph(g, m, 0, by + 0.42, -0.1, 0.3, 1.15, 0.55, 1);
  for (const sx of [-1, 1]) box(g, m, sx * 0.36, by + 0.34, -0.1, 0.08, 0.3, 0.75); // 鞍两侧鞯翼
  cyl(g, m, 0, by + 0.42, 0.66, 0.16, 0.72, 10, 0.2, 0.55);
  beastHead(g, m, 0, by + 1.14, 0.98, 0.36, { ears: 0.55, snout: 0.85, jaw: 0.18 });
  cyl(g, m, 0, by - 0.24, -0.95, 0.07, 0.66, 8, 0.03, -2.2);
}

/* ---------------- 翁仲（文臣 / 武将，通高 3.18 m 含座） ---------------- */

/** 袍身三段：钟形下摆—胸腰—肩收，附竖褶、腰带与玉佩。返回肩线高度（米）。 */
function robe(g, m, pedH, robeH) {
  const hem = robeH * 0.62;                                                   // 钟形下摆（下宽上收）
  cyl(g, m, 0, pedH, 0, 0.64, hem, 14, 0.47);
  cyl(g, m, 0, pedH + hem, 0, 0.47, robeH * 0.3, 14, 0.43);                   // 胸腰段
  for (let i = 0; i < 8; i++) {                                               // 竖褶（下摆光、上半身显）
    const a = (i / 8) * Math.PI * 2;
    box(g, m, Math.sin(a) * 0.52, pedH + hem * 0.25, Math.cos(a) * 0.52,
      0.055, hem * 0.75 + robeH * 0.3, 0.045, -a);
  }
  cyl(g, m, 0, pedH + hem + robeH * 0.3 - 0.09, 0, 0.5, 0.18, 14);            // 腰带
  box(g, m, 0, pedH + hem + robeH * 0.3 - 0.08, 0.5, 0.14, 0.16, 0.08);       // 带钩
  for (const sx of [-1, 1]) box(g, m, sx * 0.12, pedH + hem * 0.62, 0.56, 0.1, 0.3, 0.04); // 玉佩绦
  return pedH + hem + robeH * 0.3;
}

/** 首级：头盒+面部（目/鼻/口）+ 颌下长须。 */
function head(g, m, y, beard = true) {
  sph(g, m, 0, y + 0.2, 0, 0.21, 0.95, 1, 0.95);                              // 颅型（球破方）
  box(g, m, 0, y + 0.14, 0.12, 0.26, 0.24, 0.16);                             // 颊腮
  for (const sx of [-1, 1]) sph(g, m, sx * 0.1, y + 0.3, 0.185, 0.05);       // 双目
  cone(g, m, 0, y + 0.24, 0.19, 0.055, 0.17, 1.3);                            // 鼻梁
  box(g, m, 0, y + 0.12, 0.2, 0.15, 0.04, 0.035);                             // 口
  if (beard) cone(g, m, 0, y + 0.05, 0.16, 0.075, 0.32, 2.6);                 // 颌下长须（下垂锥）
  for (const sx of [-1, 1]) box(g, m, sx * 0.14, y + 0.1, 0.12, 0.07, 0.24, 0.06); // 颊须
}

/** 武将：盔缨按剑，层叠甲片。宽袍柱身 + 肩铠 + 盔 + 剑 */
function wuGeneral(g, m) {
  const pedH = sumeru(g, m, 1.3, 1.3, 0.4);
  const shoulder = robe(g, m, pedH, 1.95);
  for (let r = 0; r < 3; r++)                                                 // 三排弧形甲片
    for (let i = -1; i <= 1; i++) {
      const w = 0.24 - r * 0.03;
      box(g, m, i * (w + 0.015), shoulder - 0.62 + r * 0.17, 0.455 + r * 0.008, w, 0.15, 0.05, i * -0.12);
    }
  for (const sx of [-1, 1]) {                                                 // 肩吞兽（球+前小盒）
    sph(g, m, sx * 0.52, shoulder + 0.07, 0, 0.19);
    box(g, m, sx * 0.5, shoulder + 0.05, 0.17, 0.12, 0.1, 0.1);
  }
  head(g, m, shoulder + 0.06);
  cone(g, m, 0, shoulder + 0.46, 0, 0.24, 0.34);                              // 盔
  cyl(g, m, 0, shoulder + 0.42, 0, 0.26, 0.07, 12);                           // 盔沿
  sph(g, m, 0, shoulder + 0.86, 0, 0.1);                                      // 盔缨
  cone(g, m, 0, shoulder + 0.5, 0, 0.07, 0.42, 0);                            // 缨穗（竖）
  box(g, m, 0, shoulder - 0.75, 0.5, 0.12, 1.42, 0.2);                        // 剑身直立于胸腹前
  sph(g, m, 0.1, shoulder - 0.35, 0.5, 0.06); sph(g, m, -0.1, shoulder - 0.35, 0.5, 0.06); // 按剑双手
  cyl(g, m, 0, shoulder + 0.55, 0.5, 0.045, 0.16, 8);                         // 剑柄
  box(g, m, 0, shoulder + 0.68, 0.5, 0.42, 0.12, 0.3);                        // 剑格
  sph(g, m, 0, shoulder + 0.78, 0.5, 0.09);                                   // 剑镡球
}

/** 文臣：进贤冠持笏。袍身拱手 + 笏板 */
function wenMinister(g, m) {
  const pedH = sumeru(g, m, 1.3, 1.3, 0.4);
  const shoulder = robe(g, m, pedH, 1.95);
  for (const sx of [-1, 1]) {                                                 // 两侧大袖袋（斜置扁盒+肩过渡球）
    sph(g, m, sx * 0.5, shoulder + 0.02, 0.18, 0.17);
    box(g, m, sx * 0.56, shoulder - 0.18, 0.22, 0.34, 0.5, 0.28, -sx * 0.35);
    sph(g, m, sx * 0.4, shoulder - 0.4, 0.36, 0.11);                          // 拱手前臂端
  }
  box(g, m, 0, shoulder - 0.2, 0.34, 0.56, 0.34, 0.26);                       // 拱手广袖（胸前）
  sph(g, m, 0, shoulder - 0.28, 0.48, 0.09);                                  // 拱手
  head(g, m, shoulder + 0.06);
  box(g, m, 0, shoulder + 0.46, 0, 0.42, 0.24, 0.42);                         // 进贤冠
  box(g, m, 0, shoulder + 0.6, 0, 0.28, 0.06, 0.28);                          // 冠梁
  box(g, m, 0, shoulder + 0.48, 0.22, 0.3, 0.05, 0.06);                       // 冠前额梁
  box(g, m, 0, shoulder - 0.3, 0.44, 0.24, 0.8, 0.05);                        // 笏板（双手所持）
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

/* ---------------- CC0 扫描件替换（main.js「装载外部 GLB 资产」阶段异步调） ----------------
 * Smithsonian 跪翼守门神兽（北齐响堂山，Draco）与 3dassets.dev Imperial China 守狮对/
 * 石香炉（KHR_mesh_quantization），全部 CC0，清单与许可见 docs/ATTRIBUTION.md。
 * GLB 异步而 buildLandmarks 同步：程序化兽先立着，精模到位后按 slot 挂进同位置；
 * 任一环节失败走 fallback 补程序化兽——神道永不开天窗。 */

/**
 * @param {THREE.Group} lmGroup  明孝陵组（slots 坐标即组内局部坐标）
 * @param {object} slots  { lion:{x,z,yW,yE}, qilin:{...}, burner:{x,y,z,ry} }（缺项跳过）
 * @param {function} fallback  (kind,x,y,z,ry)=>void 程序化兜底
 */
export async function dressSpiritWay(lmGroup, slots, fallback) {
  let loadGLB = null;
  try { ({ loadGLB } = await import('./assets.js')); } catch { return; }
  const box = new THREE.Box3();
  const env = (w) => w.traverse((o) => {
    if (!o.isMesh) return;
    for (const mm of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (mm) registerEnv(mm, 0.5);
    }
  });
  const norm = (unit, targetU) => {                     // 底面中心归原点、总高=targetU
    box.setFromObject(unit);
    const h = box.max.y - box.min.y;
    if (!(h > 0)) return null;
    const s = targetU / h;
    unit.scale.multiplyScalar(s);
    unit.position.set((-(box.min.x + box.max.x) / 2) * s, -box.min.y * s, (-(box.min.z + box.max.z) / 2) * s);
    const w = new THREE.Group();
    w.add(unit);
    return w;
  };
  const put = (tpl, x, y, z, ry) => {
    const c = tpl.clone(true);
    c.position.set(x, y, z);
    c.rotation.y = ry;
    lmGroup.add(c);
    return c;
  };
  const side = (s) => (s > 0 ? -Math.PI / 2 : Math.PI / 2);   // 东西相对，面朝神道中心

  // 守狮对（踏球/抚崽两尊 mesh，各归一后东西各一）
  if (slots.lion) {
    const L = slots.lion;
    let done = false;
    const lion = await loadGLB('./assets/spiritway/lion-pair.glb').catch(() => null);
    if (lion) {
      const units = lion.children.filter((c) => c.isMesh);
      if (units.length === 2) {
        done = units.every((u, i) => {
          const w = norm(u, 2.55 / 30);
          if (!w) return false;
          env(w);
          const sx = i === 0 ? -1 : 1;
          put(w, sx * L.x, sx < 0 ? L.yW : L.yE, L.z, side(sx));
          return true;
        });
      }
    }
    if (!done && fallback) for (const sx of [-1, 1])
      fallback('lion', sx * L.x, sx < 0 ? L.yW : L.yE, L.z, side(sx), false);
  }
  // 跪翼守门神兽（麒麟位；单 mesh 激光扫描）
  if (slots.qilin) {
    const Q = slots.qilin;
    const glb = await loadGLB('./assets/spiritway/winged-guardian.glb').catch(() => null);
    const w = glb && norm(glb, 2.4 / 30);
    if (w) {
      env(w);
      for (const sx of [-1, 1]) put(w, sx * Q.x, sx < 0 ? Q.yW : Q.yE, Q.z, side(sx));
    } else if (fallback) for (const sx of [-1, 1])
      fallback('qilin', sx * Q.x, sx < 0 ? Q.yW : Q.yE, Q.z, side(sx), false);
  }
  // 石香炉（享殿台基南缘）
  if (slots.burner) {
    const B = slots.burner;
    const glb = await loadGLB('./assets/spiritway/incense-burner.glb').catch(() => null);
    const w = glb && norm(glb, 2.8 / 30);
    if (w) { env(w); put(w, B.x, B.y, B.z, B.ry || 0); }
  }
  // 御河桥（神道跨金水河；目标跨径 hU(30)=30 m，沿 X 轴摆放后旋转到位）
  if (slots.bridge) {
    const B = slots.bridge;
    const glb = await loadGLB('./assets/spiritway/arch-bridge.glb').catch(() => null);
    if (glb) {
      box.setFromObject(glb);
      const span = box.max.x - box.min.x;
      if (span > 0) {
        const s = (30 / 100) / span;                     // 目标跨径 30 m 的场景尺度
        glb.scale.multiplyScalar(s);
        glb.position.set((-(box.min.x + box.max.x) / 2) * s, -box.min.y * s, (-(box.min.z + box.max.z) / 2) * s);
        const w = new THREE.Group();
        w.add(glb);
        env(w);
        put(w, B.x, B.y, B.z, B.ry || 0);
      }
    }
  }
  // 石栏杆（沿台基边线逐段排；高 1.2 m 归一，段长按 GLB 自身比例，无缝相接）
  if (slots.balustrade && slots.balustrade.edges) {
    const glb = await loadGLB('./assets/spiritway/balustrade.glb').catch(() => null);
    const tpl = glb && norm(glb, 1.2 / 30);
    if (tpl) {
      env(tpl);
      box.setFromObject(tpl);
      const segLen = box.max.x - box.min.x;
      if (segLen > 0) {
        for (const e of slots.balustrade.edges) {
          const dx = e.x1 - e.x0, dz = e.z1 - e.z0;
          const len = Math.hypot(dx, dz);
          const n = Math.max(1, Math.round(len / segLen));
          const ry = Math.atan2(dx, dz) - Math.PI / 2;          // GLB 长边沿 +X → 对齐边线方向
          for (let i = 0; i < n; i++) {
            const c = tpl.clone(true);
            c.position.set(e.x0 + (dx * (i + 0.5)) / n, slots.balustrade.y, e.z0 + (dz * (i + 0.5)) / n);
            c.rotation.y = ry;
            lmGroup.add(c);
          }
        }
      }
    }
  }
}
