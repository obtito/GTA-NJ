// 南京明城墙 · 十五座城门 · 逐门单独建模与夜间亮化
//
// 每座门都是独立 group（gate:神策门 / gate:挹江门 …），形制按该门真实情况分开写：
//
//   existing 现存 —— 城台 + 券门（多孔按孔数并列）+ 压顶雉堞 + 门额石匾
//     神策门：现存唯一保留清代外瓮城（瓮门偏东与主门错开）+ 歇山城楼
//     清凉门：现存券门 + 明初内瓮城（瓮门错开）
//     中山门 / 挹江门 / 解放门：三孔券门（1928 迎柩改筑 / 1912 海陵门 / 1954 新开）
//     玄武门：单孔，通玄武湖（1908 丰润门）
//   rebuilt 复建 —— 与现存同形制 + 城楼（太平门 2014、仪凤门 2006 依明制复建）
//   ruin     遗址 —— 不再有门：只留豁口 + 分开两侧的遗址台基、瓮城残垣、文保碑
//     （通济门、光华门、金川门、钟阜门、汉中门、水西门）
//
// 道路：能通行的门铺穿门道路；三孔门的车流走侧面门洞（真实中山门即如此）；
// 有瓮城的门道路在两门之间折一道（主门洞 → 瓮城门错开，不能直穿）；
// 不通车或已是遗址的门（中华门景区、各处遗址）不铺车行道。
//
// 夜间：城台压顶灯带 + 瓮城门灯带 + 城楼檐口窗光，强度随 night 因子；
// 连续洗墙灯带在 world.js 的城墙里沿墙顶铺（同一套夜景色）。参考南京城墙现有夜景亮化。

import * as THREE from 'three';
import { toV2, hU, vU, smoothPolyline, clamp } from './geo.js';
import { CITY_GATES, CITY_WALL } from './data.js';
import { mat, UNIT, mergeStaticMeshes, registerEnv } from './lib.js';
import { gableHipRoof } from './arch.js';
import { terrainHeight } from './world.js';

/* ---------- 墙线局部坐标架 ---------- */
const WALL_U = smoothPolyline(CITY_WALL.map(([lo, la]) => toV2(lo, la)), 7);
// 城心（墙线采样点均值）：城墙法向本身没有内外之分，用它判定「墙外侧」
const CITY_C = WALL_U.reduce((a, p) => [a[0] + p[0] / WALL_U.length, a[1] + p[1] / WALL_U.length], [0, 0]);

/** 墙线上离 (x,z) 最近处的局部坐标架：
 *  tangent 沿墙单位向量 · normal 穿墙单位向量 · outward 城心→墙外 · wallDist 到墙线距离 */
export function wallFrame(x, z) {
  let best = Infinity, tan = [1, 0];
  for (let i = 0; i < WALL_U.length; i++) {
    const a = WALL_U[i], b = WALL_U[(i + 1) % WALL_U.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[1]) * dz) / len2;
    t = clamp(t, 0, 1);
    const px = a[0] + dx * t, pz = a[1] + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; const L = Math.hypot(dx, dz) || 1; tan = [dx / L, dz / L]; }
  }
  const normal = [-tan[1], tan[0]];
  const ox = x - CITY_C[0], oz = z - CITY_C[1];
  const oL = Math.hypot(ox, oz) || 1;
  return { tangent: tan, normal, outward: [ox / oL, oz / oL], wallDist: best };
}

/** 门的局部坐标架：
 *  局部 +Z = 世界法向（group.rotation.y 按此设）· 局部 +X = 世界向量 (nz, -nx)
 *  zOut = +1 表示墙外落在局部 +Z 一侧，-1 表示在 -Z 一侧 */
function gateFrame(gt) {
  const [x, z] = toV2(gt.lon, gt.lat);
  const fr = wallFrame(x, z);
  const { normal, outward } = fr;
  const zOut = (normal[0] * outward[0] + normal[1] * outward[1]) >= 0 ? 1 : -1;
  return { x, z, ...fr, zOut, localX: [normal[1], -normal[0]] };
}

/* 遗址处道路走廊半宽（台基与残垣在此让开，车行道从中间穿过） */
const RUIN_CORRIDOR = hU(11);

/* 局部 (lateral, along) → 世界坐标；along 沿「墙外」方向，lateral 沿局部 +X */
function localToWorld(fr, u, v) {
  return [
    fr.x + fr.localX[0] * u + fr.normal[0] * v * fr.zOut,
    fr.z + fr.localX[1] * u + fr.normal[1] * v * fr.zOut,
  ];
}

/* ---------- 穿门道路 ---------- */
/** 通行门沿墙线法向铺路；三孔门走侧洞；有瓮城的门在瓮门与主门之间折一道。 */
export function gateRoadLines(lenM = 520) {
  const out = [];
  for (const gt of CITY_GATES) {
    if (!gt.road) continue;                       // 中华门为景区，门洞不通车
    const fr = gateFrame(gt);
    const half = hU(lenM) / 2;
    const spanM = gt.span || 7;
    const bays = gt.bays || 1;
    // 三孔门：车流走侧面门洞（与 archBay 侧孔同位：span + 4.5 + 6），中孔不通车
    const lane = bays >= 3 ? hU(spanM + 10.5) : 0;
    const urnDep = gt.urn && gt.urn !== 'ruin' ? hU(gt.urnDep || 40) : 0;
    const urnOff = gt.urn && gt.urn !== 'ruin' ? hU(gt.urnOff || 12) : 0;
    let wp;
    if (gt.urn === 'outer') wp = [[urnOff, half], [urnOff, urnDep], [0, 0], [0, -half]];
    else if (gt.urn === 'inner') wp = [[0, half], [0, 0], [urnOff, -urnDep], [urnOff, -half]];
    else wp = [[lane, half], [lane, 0], [lane, -half]];
    const pts = wp.map(([u, v]) => localToWorld(fr, u, v));
    // 遗址处为城市道路（20m 四车道）；现存/复建门洞内路宽收窄到券洞净宽-1m
    out.push({
      name: gt.name + (urnOff && gt.urn !== 'ruin' ? '（穿瓮城）' : ''),
      w: gt.kind === 'ruin' ? hU(20) : hU(Math.max(5, spanM - 1)),
      pts,
    });
  }
  return out;
}

/* ---------- 材质 ---------- */
const M = () => ({
  stone: mat('#8f8577', { rough: 0.95, env: 0.5 }),        // 城台（与城墙同色）
  stoneD: mat('#7a7166', { rough: 0.96, env: 0.5 }),
  brick: mat('#a8825f', { rough: 0.95, env: 0.5 }),        // 券门砌砖
  base: mat('#b3a894', { rough: 1, env: 0.45 }),           // 遗址台基（夯土）
  ruin: mat('#9c9488', { rough: 1, env: 0.45 }),           // 遗址残垣
  towerWall: mat('#b03a2e', { rough: 0.9, env: 0.45 }),    // 城楼墙体（朱红）
  towerBase: mat('#cfc8b8', { rough: 0.92, env: 0.5 }),
  stele: mat('#6f6a60', { rough: 0.85, env: 0.45 }),       // 石匾 / 文保碑
});

/** 门额石匾：匾面写该门现存名或旧称（node 环境无 canvas 时退回素色石匾） */
function plaqueMat(text) {
  let tex = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#463f37'; g.fillRect(0, 0, 256, 96);
    g.strokeStyle = '#b9ad93'; g.lineWidth = 6; g.strokeRect(5, 5, 246, 86);
    g.fillStyle = '#efe6cf';
    g.font = 'bold 54px "Songti SC","SimSun",serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 52);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ffffff'), roughness: 0.8, metalness: 0, map: tex,
  });
  registerEnv(m, 0.4);
  return m;
}

const put = (g, m, x, y, z, w, h, d) => {
  const mesh = new THREE.Mesh(UNIT.box, m);
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
};

/* ---------- 券门 ---------- */
/** 单孔券门：两侧墩台 + 券肩 + 前后两道半圆券脸 + 券下砖壁。
 *  hM 为这一孔所在墙体的高度(m)；起券高度取 6m（实测城门起券多在 5–7m）。 */
function archBay(g, mats, cx, spanM, hM, depth, springM = 6) {
  const s = hU(spanM);
  const pierW = hU(4.5);
  const springH = vU(springM);
  const r = s / 2;
  const spandrelH = Math.max(0.02, hM - springH - r);

  put(g, mats.stone, cx - (s + pierW) / 2, 0, 0, pierW, springH, depth);
  put(g, mats.stone, cx + (s + pierW) / 2, 0, 0, pierW, springH, depth);
  if (spandrelH > 0.02) put(g, mats.stone, cx, springH + r + spandrelH / 2, 0, s + pierW * 2, spandrelH, depth);
  const ringGeo = new THREE.TorusGeometry(r, hU(0.55), 5, 14, Math.PI);
  for (const sz of [-1, 1]) {
    const ring = new THREE.Mesh(ringGeo, mats.brick);
    ring.position.set(cx, springH, (sz * depth) / 2);
    ring.castShadow = true;
    g.add(ring);
  }
  for (const sx of [-1, 1]) put(g, mats.brick, cx + sx * (s / 2 + hU(0.3)), springH / 2, 0, hU(0.6), springH, depth * 0.98);
  return { s, pierW };
}

/* ---------- 城楼 ---------- */
function gateTower(g, mats, w, d, y0) {
  const bw = w * 0.86, bd = d * 0.62, bh = vU(9.5);
  put(g, mats.towerBase, 0, y0, 0, w, vU(1.2), d * 0.9);
  put(g, mats.towerWall, 0, y0 + vU(1.2), 0, bw, bh, bd);
  const winMat = mat('#ffcf8a', { rough: 0.6, emissive: '#ffb347', emissiveIntensity: 0 });
  for (let i = -2; i <= 2; i++) {
    for (const sz of [-1, 1]) {
      put(g, winMat, i * (bw / 5.2), y0 + vU(1.2) + bh * 0.55, sz * (bd / 2 + 0.02), hU(1.8), vU(3), 0.03);
    }
  }
  const roof = gableHipRoof({
    w: bw * 1.28, d: bd * 1.5, rise: vU(7), color: '#5a6b5a', ridgeColor: '#3a3630',
    segX: 14, segZ: 14,
  });
  roof.position.y = y0 + vU(1.2) + bh;
  g.add(roof);
  return winMat;
}

/* ---------- 瓮城 ---------- */
/**
 * 瓮城：主门之外再围一道小城，瓮门与主门错开（真实形制，车辆需在瓮城内折行）。
 * 现存门建实体券门；遗址门只留低矮残垣，正面在道路走廊处断开。
 * @param side +1 建在局部 +Z 一侧，-1 建在 -Z 一侧
 */
function urnCourt(g, mats, { side, widthU, depU, wallH, offU, spanM, ruin }) {
  const sub = new THREE.Group();
  sub.position.z = side * depU;
  g.add(sub);
  const half = widthU / 2;
  const h = ruin ? vU(1.2) : wallH * 0.78;
  const t = ruin ? hU(9) : hU(7);
  const m = ruin ? mats.ruin : mats.stone;

  // 两侧翼墙（从主城台伸向正面）
  for (const sx of [-1, 1]) put(g, m, sx * half, 0, (side * depU) / 2, t, h, depU);

  if (ruin) {
    // 遗址：只留基槽轮廓，正面在道路走廊处断开
    const seg = (a, b) => { if (b - a > hU(0.5)) put(sub, m, (a + b) / 2, 0, 0, b - a, h, t); };
    seg(-half, offU - RUIN_CORRIDOR);
    seg(offU + RUIN_CORRIDOR, half);
  } else {
    const { s, pierW } = archBay(sub, mats, offU, spanM, h, t, 5.5);
    // 券门两侧补砌至翼墙
    const leftLen = half + (offU - (s + pierW) / 2 - pierW / 2);
    const rightLen = half - offU - (s + pierW) / 2 - pierW / 2;
    if (leftLen > 0.01) put(sub, m, -half + leftLen / 2, 0, 0, leftLen, h, t);
    if (rightLen > 0.01) put(sub, m, offU + (s + pierW) / 2 + pierW / 2 + rightLen / 2, 0, 0, rightLen, h, t);
    // 雉堞：正面 + 两侧翼墙
    const n = Math.max(2, Math.round(widthU / hU(3.4)));
    for (let i = 0; i <= n; i++) put(sub, mats.stone, -half + (i / n) * widthU, h + vU(0.8), 0, hU(2.0), vU(1.6), t * 0.7);
    for (const sx of [-1, 1]) {
      const k = Math.max(2, Math.round(depU / hU(3.4)));
      for (let i = 1; i <= k; i++) put(g, mats.stone, sx * half, h + vU(0.8), side * (i / k) * depU, t * 0.7, vU(1.6), hU(2.0));
    }
  }
  return sub;
}

/* ---------- 遗址（无门，仅存豁口） ---------- */
/** 台基与残墙在中轴让出 RUIN_CORRIDOR 宽的道路走廊 —— 真实遗址广场即被道路分成两块 */
function gateRuin(g, mats, gt, spanM) {
  const d = hU(30);
  const half = RUIN_CORRIDOR;
  const wRuin = hU(spanM) / 2 + hU(9);                  // 残墙（门址两侧）
  for (const sx of [-1, 1]) {
    const wBase = hU(17);                               // 每侧台基宽
    const x0 = sx * half, x1 = sx * (half + wBase);
    put(g, mats.base, (x0 + x1) / 2, vU(0.45), 0, wBase, vU(0.9), d);
    put(g, mats.ruin, sx * (half + wRuin / 2), vU(0.9), 0, wRuin, vU(1.8), d * 0.8);
  }
  // 文保碑：碑座 + 碑身 + 碑首（立在残墙外缘，不压台基）
  const bx = half + wRuin + hU(4);
  put(g, mats.stele, bx, vU(0.35), d * 0.34, hU(2.4), vU(0.7), hU(1.4));
  put(g, mats.stele, bx, vU(1.5), d * 0.34, hU(1.6), vU(2.3), hU(0.5));
  put(g, mats.stele, bx, vU(2.8), d * 0.34, hU(1.9), vU(0.5), hU(0.7));
  void gt;
  return null;
}

/* ---------- 主构建 ---------- */
export function buildGates({ merge = true } = {}) {
  const group = new THREE.Group();
  group.name = 'gates';
  const mats = M();
  const nightMats = [];
  const plaques = [];

  for (const gt of CITY_GATES) {
    // 中华门由地标单独精建模（三道内瓮城 / 27 藏兵洞），此处不再重复
    if (gt.name === '中华门') continue;

    const fr = gateFrame(gt);
    const g = new THREE.Group();
    g.name = 'gate:' + gt.name;
    g.rotation.y = Math.atan2(fr.normal[0], fr.normal[1]);   // 局部 +Z = 墙线法向
    g.position.set(fr.x, Math.max(0, terrainHeight(fr.x, fr.z) - 0.05), fr.z);

    const wallHM = gt.wallH || 20;
    const wallH = vU(wallHM);
    const depth = hU(26);                                     // 城台进深 ≈ 墙厚
    const bays = gt.bays || 1;
    const span = gt.span || 7;
    const zOut = fr.zOut;

    if (gt.kind === 'ruin') {
      gateRuin(g, mats, gt, span);
      if (gt.urn) {
        // 瓮城遗迹：残垣轮廓，正面让开道路走廊（道路走正中，不再有错位门洞）
        urnCourt(g, mats, {
          side: zOut, widthU: hU(72), depU: hU(gt.urnDep || 30),
          wallH, offU: 0, spanM: span, ruin: true,
        });
      }
    } else {
      const { s, pierW } = archBay(g, mats, 0, span, wallH, depth);
      if (bays >= 3) for (const sx of [-1, 1]) archBay(g, mats, sx * (s + pierW + hU(6)), span * 0.8, wallH, depth);
      const totalW = bays >= 3 ? (s + pierW * 2) + 2 * (s * 0.8 + pierW + hU(6)) : s + pierW * 2;
      // 压顶
      put(g, mats.stoneD, 0, wallH - vU(1.2), 0, totalW, vU(1.2), depth * 0.96);
      // 雉堞（内外两列）
      const n = Math.max(2, Math.round(totalW / hU(3.2)));
      for (let i = 0; i <= n; i++) {
        const px = -totalW / 2 + (i / n) * totalW;
        for (const sz of [-1, 1]) put(g, mats.stone, px, wallH, sz * (depth / 2 - hU(2.4)), hU(2.0), vU(1.6), hU(3.0));
      }
      if (gt.tower) nightMats.push(gateTower(g, mats, totalW * 0.92, depth, wallH));
      // 门额石匾（挂在外立面）：写现存门名或旧称
      const pm = plaqueMat(gt.name);
      const plaque = new THREE.Mesh(UNIT.box, pm);
      plaque.position.set(0, vU(7) + hU(span / 2) + vU(1.6), (zOut * depth) / 2 + zOut * 0.03);
      plaque.scale.set(totalW * 0.3, vU(2.3), 0.05);
      plaque.rotation.y = zOut > 0 ? 0 : Math.PI;
      plaque.castShadow = true;
      g.add(plaque);
      plaques.push(pm);

      if (gt.urn === 'outer' || gt.urn === 'inner') {
        urnCourt(g, mats, {
          side: gt.urn === 'outer' ? zOut : -zOut,
          widthU: hU(gt.urn === 'outer' ? 74 : 66),
          depU: hU(gt.urnDep || 40),
          wallH, offU: hU(gt.urnOff || 12),
          spanM: span * 0.9, ruin: false,
        });
      }
    }

    group.add(g);
    g.updateMatrixWorld(true);
    if (merge) mergeStaticMeshes(g, null);
  }

  // 夜间亮化：城台压顶灯带 + 瓮城正面灯带 + 城楼檐口窗光
  // 灯带是竖立的窄条（法向朝外），宽度=门宽、高约 2m，贴在城台外立面上缘
  const QUAD = new THREE.PlaneGeometry(1, 1);          // XY 平面，法向 +Z（不是 UNIT.plane 的躺平片）
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffc178, transparent: true, opacity: 0, depthWrite: false });
  const strips = new THREE.Group();
  strips.name = 'gateLights';
  const addStrip = (cx, cy, cz, wU, hU_, rotY, off) => {
    const m = new THREE.Mesh(QUAD, stripMat);
    m.position.set(cx + Math.sin(rotY) * off, cy, cz + Math.cos(rotY) * off);
    m.rotation.y = rotY;
    m.scale.set(wU, hU_, 1);
    strips.add(m);
    return m;
  };
  for (const gt of CITY_GATES) {
    if (gt.kind === 'ruin' || gt.name === '中华门') continue;
    const fr = gateFrame(gt);
    const yBase = Math.max(0, terrainHeight(fr.x, fr.z));
    const rotY = Math.atan2(fr.normal[0], fr.normal[1]);
    const bandH = vU(2.0);
    const bandY = vU((gt.wallH || 20) - 1.1);
    const wGate = hU((gt.span || 7) + 11) * (gt.bays >= 3 ? 2.6 : 1);
    // 城台内外两面各一道洗墙灯（夜里的城墙两面都亮，只照亮进城一侧会很怪）
    addStrip(fr.x, yBase + bandY, fr.z, wGate, bandH, rotY, fr.zOut * hU(0.4));
    addStrip(fr.x, yBase + bandY, fr.z, wGate, bandH, rotY + Math.PI, -fr.zOut * hU(0.4));
    if (gt.urn === 'outer' || gt.urn === 'inner') {
      const side = gt.urn === 'outer' ? fr.zOut : -fr.zOut;
      const dep = hU(gt.urnDep || 40);
      const cx = fr.x + fr.normal[0] * side * dep, cz = fr.z + fr.normal[1] * side * dep;
      const cy = yBase + vU((gt.wallH || 20) * 0.78 - 1.1);
      const wUrn = hU(gt.urn === 'outer' ? 74 : 66);
      addStrip(cx, cy, cz, wUrn, bandH, rotY, side * hU(0.4));       // 瓮城正面（朝外）
      addStrip(cx, cy, cz, wUrn, bandH, rotY + Math.PI, -side * hU(0.4)); // 瓮城内侧
    }
  }
  group.add(strips);

  // 夜间泛光材质：城台/瓮城（与城墙共用同一 stone 材质实例）、雉堞、城楼、遗址台基
  const floodMats = [mats.stone, mats.stoneD, mats.towerWall, mats.towerBase, mats.base, mats.ruin]
    .filter((m, i, a) => a.indexOf(m) === i);
  const FLOOD = new THREE.Color('#6b5a3c');

  function setNight(k) {
    const n = clamp(k, 0, 1);
    stripMat.opacity = n * 0.85;
    for (const m of nightMats) m.emissiveIntensity = n * 1.6;
    // 城台/瓮城/遗址台基同样泛光：夜里是"被照亮的石头"，不是黑剪影
    for (const m of floodMats) {
      m.emissive.copy(FLOOD);
      m.emissiveIntensity = n * 0.62;
    }
  }

  return { group, setNight, plaques, mats: [stripMat, ...nightMats, ...plaques] };
}
