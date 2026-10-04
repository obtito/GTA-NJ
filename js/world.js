// 地形：地面、山体、水面、道路、城墙
import * as THREE from 'three';
import { makeMasonryTexture } from './masonry-texture.js';
import { toV2, toV2List, mY, vU, hU, fbm, noise2, makeRandom, smoothstep as smooth, smoothPolyline, resample, distToPolyline, clamp, M_PER_U_H, M_PER_U_V } from './geo.js';
import { RIVER, LAKES, ISLANDS, ROADS, MOUNTAINS, CITY_WALL, CITY_GATES, LANDMARKS, gateHalfLenM, roadSection } from './data.js';
import { WALL_LINE, WALL_CENTER, gateFrame } from './wall-layout.js';
import { createArchitecturalLighting } from './architectural-lighting.js';
import {
  mat, UNIT, put, ribbonGeometry, polygonGeometry, QuadBuilder, registerEnv,
  makeGroundTexture, makeWallStoneTexture, makeWallTopTexture,
  makeAsphaltTexture, makeSidewalkTexture, makeCurbTexture, makeLaneMarkTexture,
} from './lib.js';

/* ==================== 高度场 ==================== */

const mountainInfo = MOUNTAINS.map((m, i) => {
  const [x, z] = toV2(m.lon, m.lat);
  return {
    ...m, x, z,
    rxU: m.rx * 10, rzU: m.rz * 10,
    hU: mY(m.height) * (m.height > 300 ? 1.12 : 1.0),
    seed: 71 + i * 13,
  };
});

/* ---- 场地垫层 ----
 * 中山陵 / 明孝陵这类「长轴线 + 大平台」的组群落在紫金山南坡上：
 * 构件逐点锚定地形，宽平台必然局部埋没或悬空（穿模）。
 * 垫层把圈内标高混到「按实测数据的线性坡」上——
 * 中山陵：祭堂 158 m → 博爱坊 85 m（spec：祭堂平台海拔 158 m、落差 73 m）；
 * 明孝陵：宝顶 105 m → 神道南端 60 m。
 * 权重只在圆心 55% 内全量生效、向边缘 smoothstep 归零，
 * 因此垫层与自然地形在边缘连续过渡，不会拉出断崖。 */
const SITE_PADS = [
  {
    id: 'zhongshanling', r: 6.2, cz: 3.6,   // 圆心在轴线中点（祭堂南侧 360 m）
    grad: (dzz) => vU(158) - (vU(158) - vU(85)) * (dzz / 7.2),           // dzz 相对祭堂，南正；祭堂158m→博爱坊85m
  },
  {
    id: 'mingxiaoling', r: 7.6, cz: 2.75,   // 圆心在宝顶(-210m)~神道南端(+760m) 中点
    grad: (dzz) => vU(105) - (vU(105) - vU(60)) * ((dzz + 2.1) / 9.7),   // dzz 相对方城
  },
].map((p) => {
  const lm = LANDMARKS.find((l) => l.id === p.id);
  const [x, z] = toV2(lm.lon, lm.lat);
  return { x, z: z + p.cz, r: p.r, grad: p.grad, z0: z };
});

/** 山体影响下的地面高度（单位） */
export function terrainHeight(x, z) {
  for (const p of SITE_PADS) {
    const dx = (x - p.x) / p.r, dz = (z - p.z) / p.r;
    const r2 = dx * dx + dz * dz;
    if (r2 >= 1) continue;
    const r = Math.sqrt(r2);
    // 中心权重：r<0.55 全量，之后平滑退到 0（边缘处完全等于自然地形）
    const w = smooth(clamp((1 - r) / 0.45, 0, 1));
    if (w <= 0) continue;
    const grad = p.grad(z - p.z0);
    return grad * w + terrainNatural(x, z) * (1 - w);
  }
  return terrainNatural(x, z);
}

function terrainNatural(x, z) {
  let h = 0;
  for (const m of mountainInfo) {
    const dx = (x - m.x) / m.rxU, dz = (z - m.z) / m.rzU;
    const r = Math.sqrt(dx * dx + dz * dz);
    if (r >= 1) continue;
    const fall = Math.pow(Math.cos((r * Math.PI) / 2), 1.8);
    const rough = 0.62 + 0.62 * fbm(x * 0.075, z * 0.075, 4, m.seed) * m.rough;
    const detail = 0.9 + 0.2 * noise2(x * 0.4, z * 0.4, m.seed + 5);
    h += fall * rough * detail * m.hU;
  }
  return h;
}

export function mountains() { return mountainInfo; }

/* ==================== 地面 ==================== */

export function buildGround() {
  // 必须细分：900 单位（90 km）见方只切 2 个三角形时，GPU 的深度插值在这种超大三角形上
  // 误差可达数十厘米，而路面只比地面高 0.005 单位（15 cm）—— 结果是地面把路面盖掉，
  // 站在中山南路上看到的是草地。射线检测走 CPU 双精度，完全看不到这个问题，所以极易误判。
  const g = new THREE.PlaneGeometry(900, 900, 120, 120).rotateX(-Math.PI / 2);
  const tex = makeGroundTexture();
  const m = new THREE.MeshStandardMaterial({ color: 0xb6c0a2, roughness: 1, metalness: 0, map: tex });
  registerEnv(m, 0.45);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = -0.05;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  // 地面是全场最低的一层：**不写深度 + 第一个画**。这样它既不会盖住只高 15 cm 的路面，
  // 也不会漏出背后的天空（后面的山体/道路/楼群照常按深度正常遮挡它）。
  mesh.renderOrder = -1000;
  m.depthWrite = false;
  return { mesh, mat: m, mats: [m] };
}

/* ==================== 山体 ==================== */

export function buildMountains() {
  const group = new THREE.Group();
  group.name = 'mountains';
  const mats = [];
  for (const mo of mountainInfo) {
    const sizeX = mo.rxU * 2.4, sizeZ = mo.rzU * 2.4;
    const seg = 88;
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, seg, seg).rotateX(-Math.PI / 2);
    geo.translate(mo.x, 0, mo.z);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color('#4a6b3c'), mid = new THREE.Color('#3b5a30'), high = new THREE.Color('#6b6552');
    let maxH = 0;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), z = pos.getZ(i);
      const raw = terrainHeight(x, z);
      // 山体网格间距约 80 m，而走廊只有 96 m 宽：走廊常常正好落在两个顶点之间，
      // 这时「只削到 48 m 以内」的 roadCutHeight 会被三角形插值抵消，路面照样埋在土里。
      // 所以只要地形高过路面 30 m（真会挡路）且顶点离路中线不足 55 m，就把它直接压平到路面标高，
      // 保证路面两侧一定有一圈贴着路面的顶点 —— 现实里的切坡台地也是这个样子。
      // 注意：这里只压 Y、不动 XZ；把顶点平移到中线上会拉出退化三角面。
      if (raw > ROAD_Y + 1 && roadDistM(x, z) < 55) {
        pos.setY(i, ROAD_Y - 0.012);
        maxH = Math.max(maxH, ROAD_Y - 0.012);
        continue;
      }
      const h = roadCutHeight(raw, x, z);
      pos.setY(i, h);
      maxH = Math.max(maxH, h);
    }
    for (let i = 0; i < pos.count; i++) {
      const t = clamp(pos.getY(i) / (maxH || 1), 0, 1);
      const c = t < 0.72
        ? low.clone().lerp(mid, t / 0.72)
        : mid.clone().lerp(high, (t - 0.72) / 0.28);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true, side: THREE.DoubleSide, flatShading: false,
    });
    registerEnv(material, 0.35);
    const mesh = new THREE.Mesh(geo, material);
    // 山体只接收阴影、不投射：它自身有 4.6 万三角形，投影只会白白吃掉一遍 shadow pass
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
    mats.push(material);
  }
  return { group, mats };
}

/* ==================== 山体林相（紫金山） ====================
 * 现状山体是渐变顶点色——航拍看是一块绿板。buildMountainForest 给最高那座山
 * （mountainInfo 按 hU 识别 = 紫金山）撒 ~7 万棵实例树，两种形态混播：
 *   马尾松 60%：细 cylinder 干 + ConeGeometry 锥冠（深松绿 #2d4a28 系随机明度）
 *   阔叶   40%：icosahedron 冠（黄绿 #4a6b34 系）
 * 树高 0.3–0.55u（竖向口径 9–16m），山顶（标高越高）树更矮更稀——风口的贴地矮林。
 *
 * 拒绝采样条件（ bounding 椭圆内，rxU/rzU 即山体自身脚印 ）：
 *   1. 渲染面标高 > 0.35u（确实在山坡上，避开山脚平地城区；低频噪声抖动林线）
 *   2. 坡度：与 ±6m 邻点高差 < 0.10u（真实约 27°，陡崖不长树；见下方 SLOPE_MAX 注）
 *   3. 距道路中心线 ≥ 55m（与 buildMountains 的切坡/压平走廊同宽）
 *   4. 明孝陵神道走廊矩形：|x-75.14| < 0.22u 且 z∈[-6.5,11.5]（铺装+石像生带）
 *   5. exclusions 楼群/地标排他圆 [x,z,r]（与 buildTrees 同款判定；
 *      中山陵/明孝陵组群靠调用方传 lm.exclusions 保护，同 buildTrees 惯例）
 *
 * 关键：树根标高不用裸 terrainHeight，而是**预烘与 buildMountains 完全同款的
 * 89×89 顶点高度网格**（含路侧压平 + roadCutHeight 切坡），按 PlaneGeometry 的
 * 实际三角剖分（对角线 b–d，即 u+v=1）做精确插值。山体网格间距约 79m，而路侧
 * 压平带只有 55m 宽——切坡边缘的三角形是从路面标高斜上自然地形的长坡，用裸
 * terrainHeight 放树会在切坡带悬空几十米。
 *
 * 密度自适应：先探 2 万样本测接受率，再按 target/rate 定撒点数（封顶 60 万），
 * 排他圆多寡变化时总数仍稳定在 ~7 万。
 *
 * 返回 { group('mountainforest'), count, mats }；castShadow=false（7 万实例不进
 * shadow pass）、frustumCulled=false（实例矩阵覆盖整山，包围球剔除没意义）。
 * 合计 3 个 InstancedMesh（干共享一个，松冠/阔叶冠各一），≤4 个 draw call。 */
export function buildMountainForest({ exclusions = [], seed = 20261005, target = 70000 } = {}) {
  const group = new THREE.Group();
  group.name = 'mountainforest';
  const rand = makeRandom(seed);
  const zj = mountainInfo.reduce((a, b) => (!a || b.hU > a.hU ? b : a), null);
  if (!zj) return { group, count: 0, mats: [] };

  /* ---- 渲染面高度网格（与 buildMountains 同 seg/尺寸/压平公式） ---- */
  const SEG = 88;
  const sizeX = zj.rxU * 2.4, sizeZ = zj.rzU * 2.4;
  const stepX = sizeX / SEG, stepZ = sizeZ / SEG;
  const gx0 = zj.x - sizeX / 2, gz0 = zj.z - sizeZ / 2;
  const W = SEG + 1;
  const grid = new Float32Array(W * W);
  for (let iy = 0; iy <= SEG; iy++) {
    for (let ix = 0; ix <= SEG; ix++) {
      const vx = gx0 + ix * stepX, vz = gz0 + iy * stepZ;
      const raw = terrainHeight(vx, vz);
      grid[iy * W + ix] = raw > ROAD_Y + 1 && roadDistM(vx, vz) < 55
        ? ROAD_Y - 0.012
        : roadCutHeight(raw, vx, vz);
    }
  }
  /** 渲染面上任意点的精确标高：PlaneGeometry(88×88) 三角 (a,b,d)/(b,c,d)，对角线 b–d 即 u+v=1 */
  function surface(x, z) {
    const u = clamp((x - gx0) / stepX, 0, SEG - 1e-4);
    const v = clamp((z - gz0) / stepZ, 0, SEG - 1e-4);
    const ix = u | 0, iy = v | 0, fu = u - ix, fv = v - iy;
    const ha = grid[iy * W + ix], hb = grid[(iy + 1) * W + ix];
    const hd = grid[iy * W + ix + 1], hc = grid[(iy + 1) * W + ix + 1];
    return fu + fv < 1
      ? ha + (hb - ha) * fv + (hd - ha) * fu
      : hc + (hb - hc) * (1 - fu) + (hd - hc) * (1 - fv);
  }

  /* ---- 道路走廊（与 roadDistM 同几何，AABB 早退：紫金山离主城路网远，逐点全量折线太慢） ---- */
  const lanes = roadCorridor().map((pts) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
    }
    return { pts, x0, x1, z0, z1 };
  });
  const ROAD_KEEP_U = 55 / M_PER_U_H;   // 0.55u = 55m
  function nearRoad(x, z) {
    for (const l of lanes) {
      if (x < l.x0 - ROAD_KEEP_U || x > l.x1 + ROAD_KEEP_U || z < l.z0 - ROAD_KEEP_U || z > l.z1 + ROAD_KEEP_U) continue;
      if (distToPolyline(x, z, l.pts) < ROAD_KEEP_U) return true;
    }
    return false;
  }

  /* ---- 明孝陵神道走廊（矩形，铺装+石像生带） ---- */
  const inSpiritWay = (x, z) => Math.abs(x - 75.14) < 0.22 && z >= -6.5 && z <= 11.5;
  const inExcl = (x, z) => {
    for (const e of exclusions) {
      const dx = x - e[0], dz = z - e[1];
      if (dx * dx + dz * dz < e[2] * e[2]) return true;
    }
    return false;
  };

  const EPS = hU(6);          // ±6m 邻点（水平）
  // 坡度阈值 0.10u/6m ≈ 真实 27°（换算含 1:30 竖向夸张）。任务书的 0.06u 实测偏严：
  // 山体基坡（约 0.05u/6m）+ 粗糙噪声就到阈值，中山坡整圈秃成「绿板穹顶」。
  const SLOPE_MAX = 0.10;
  const PEAK = zj.hU;
  const picked = [];
  function trySample() {
    const a = rand() * Math.PI * 2, rr = Math.sqrt(rand());
    const x = zj.x + Math.cos(a) * zj.rxU * rr;
    const z = zj.z + Math.sin(a) * zj.rzU * rr;
    const y = surface(x, z);
    // 山脚林线：0.35u 基准上加低频噪声抖动，避免整圈笔直的等高线式边界
    if (y <= 0.35 + (noise2(x * 0.25, z * 0.25, 555) - 0.5) * 0.12) return null;
    if (Math.abs(surface(x + EPS, z) - y) >= SLOPE_MAX || Math.abs(surface(x - EPS, z) - y) >= SLOPE_MAX
      || Math.abs(surface(x, z + EPS) - y) >= SLOPE_MAX || Math.abs(surface(x, z - EPS) - y) >= SLOPE_MAX) return null;
    if (nearRoad(x, z) || inSpiritWay(x, z) || inExcl(x, z)) return null;
    // 山顶更矮更稀：t 加噪声抖动打散等高线圈层，风口矮林不排成同心圆带
    const t = clamp(y / PEAK + (noise2(x * 0.3, z * 0.3, 999) - 0.5) * 0.35, 0, 1);
    if (rand() > 1 - 0.55 * t * t) return null;   // 山顶风口更稀
    return { x, y, z, t, pine: rand() < 0.6 };
  }
  // 探针 2 万样本测接受率 → 自适应撒点数；attempts 是**总样本数**，探针命中的样本直接留用
  const PROBE = 20000;
  for (let i = 0; i < PROBE; i++) { const s = trySample(); if (s) picked.push(s); }
  const rate = picked.length / PROBE;
  const attempts = rate > 1e-4 ? Math.min(Math.round(target / rate), 600000) : 0;
  for (let i = PROBE; i < attempts; i++) { const s = trySample(); if (s) picked.push(s); }

  const n = picked.length;
  const mats = [];
  if (!n) return { group, count: 0, mats };

  /* ---- 几何/材质：干共享一个网格（半径由实例缩放控制），松冠/阔叶冠各一 ---- */
  const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 6, 1, true).translate(0, 0.5, 0);   // 开口：底埋地里、顶进冠
  const coneGeo = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0);                     // 18 tri（侧面 12+底 6）
  const ballGeo = new THREE.IcosahedronGeometry(1, 0);                                      // 20 tri
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b5340, roughness: 1 });
  const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const broadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  registerEnv(trunkMat, 0.3);
  registerEnv(pineMat, 0.42);    // 树冠只要一点点天空补光，太多会发灰（同 buildTrees）
  registerEnv(broadMat, 0.42);
  mats.push(trunkMat, pineMat, broadMat);

  const nPine = picked.reduce((s, p) => s + (p.pine ? 1 : 0), 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const pines = new THREE.InstancedMesh(coneGeo, pineMat, nPine);
  const broads = new THREE.InstancedMesh(ballGeo, broadMat, n - nPine);
  trunks.name = 'mforest:trunks'; pines.name = 'mforest:pine'; broads.name = 'mforest:broad';
  for (const m of [trunks, pines, broads]) { m.castShadow = false; m.frustumCulled = false; }

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const pineA = new THREE.Color('#2d4a28'), pineB = new THREE.Color('#40603a');
  const broadA = new THREE.Color('#4a6b34'), broadB = new THREE.Color('#6f8f42');
  let ti = 0, pi = 0, bi = 0;
  for (const s of picked) {
    const hf = 1 - 0.42 * s.t;                       // 山顶更矮（贴地矮林）
    const H = (0.30 + rand() * 0.25) * hf;           // 0.3–0.55u（9–16m）
    const yaw = rand() * Math.PI * 2;
    if (s.pine) {
      const cr = H * (0.24 + rand() * 0.09);         // 锥冠底半径
      dummy.position.set(s.x, s.y - 0.01, s.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(cr * 0.15, H * 0.62, cr * 0.15);   // 细干
      dummy.updateMatrix();
      trunks.setMatrixAt(ti++, dummy.matrix);
      dummy.position.set(s.x, s.y + H * 0.34, s.z);
      dummy.scale.set(cr, H * (0.58 + rand() * 0.14), cr);
      dummy.updateMatrix();
      pines.setMatrixAt(pi, dummy.matrix);
      col.copy(pineA).lerp(pineB, rand()).multiplyScalar(0.78 + rand() * 0.42);
      pines.setColorAt(pi++, col);
    } else {
      const cr = H * (0.30 + rand() * 0.10);         // 冠半径
      dummy.position.set(s.x, s.y - 0.01, s.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(cr * 0.2, H * 0.5, cr * 0.2);
      dummy.updateMatrix();
      trunks.setMatrixAt(ti++, dummy.matrix);
      const tilt = rand() * 0.5 - 0.25;
      dummy.position.set(s.x, s.y + H * 0.5, s.z);
      dummy.rotation.set(tilt, yaw, tilt * 0.6);
      dummy.scale.set(cr, cr * (0.8 + rand() * 0.35), cr);
      dummy.updateMatrix();
      broads.setMatrixAt(bi, dummy.matrix);
      col.copy(broadA).lerp(broadB, rand()).multiplyScalar(0.78 + rand() * 0.42);
      broads.setColorAt(bi++, col);
    }
  }
  trunks.instanceMatrix.needsUpdate = true;
  pines.instanceMatrix.needsUpdate = true;
  broads.instanceMatrix.needsUpdate = true;
  if (pines.instanceColor) pines.instanceColor.needsUpdate = true;
  if (broads.instanceColor) broads.instanceColor.needsUpdate = true;
  group.add(trunks, pines, broads);
  return { group, count: n, mats };
}

/* ==================== 水面 ==================== */

export function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uNight: { value: 0 },
        uDeep: { value: new THREE.Color('#2b5f86') },
        uShallow: { value: new THREE.Color('#5aa0bd') },
        uSky: { value: new THREE.Color('#bcd6e8') },
        // 与 PBR 共享的“环境”：地平线色 / 天顶色 / 太阳能量，让水面的反射与天空同源
        uHorizon: { value: new THREE.Color('#cfe0ec') },
        uZenith: { value: new THREE.Color('#4d82c4') },
        uSunI: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      },
    ]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime, uNight, uSunI;
      uniform vec3 uDeep, uShallow, uSky, uSunDir, uHorizon, uZenith;
      varying vec3 vWorld;

      // 天空渐变：与 PBR 用的环境贴图同源（地平线亮、天顶深）
      vec3 skyGrad(vec3 dir) {
        float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        return mix(uHorizon, uZenith, pow(t, 0.7));
      }

      float wave(vec2 p, float t) {
        float w = sin(p.x * 0.30 + t * 0.55) * 0.5;
        w += sin(p.y * 0.24 - t * 0.42) * 0.5;
        w += sin((p.x + p.y) * 0.13 + t * 0.31) * 0.35;
        w += sin((p.x - p.y * 0.7) * 0.51 - t * 0.9) * 0.16;
        return w;
      }

      void main() {
        float t = uTime;
        float e = 0.7;
        float h  = wave(vWorld.xz, t);
        float hx = wave(vWorld.xz + vec2(e, 0.0), t);
        float hz = wave(vWorld.xz + vec2(0.0, e), t);
        vec3 N = normalize(vec3(-(hx - h) / e, 1.6, -(hz - h) / e));
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);

        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.2);
        vec3 base = mix(uDeep, uShallow, clamp(h * 0.22 + 0.45, 0.0, 1.0));
        vec3 R = reflect(-V, N);
        vec3 refl = mix(skyGrad(R), uSky, 0.35);
        base = mix(base, refl, fres * 0.85);

        float spec = pow(clamp(dot(R, L), 0.0, 1.0), 120.0) * 1.6;
        float glitter = pow(clamp(dot(normalize(vec3(N.x, 0.9, N.z)), L), 0.0, 1.0), 8.0) * 0.10;
        // 太阳在水面的高光核：与共享 HDR 环境里的太阳同源
        float glint = pow(clamp(dot(R, L), 0.0, 1.0), 900.0) * uSunI * 8.0;

        vec3 col = base + spec * (1.0 - uNight * 0.75) + glitter + glint * (1.0 - uNight);
        col *= mix(1.0, 0.30, uNight);
        col = mix(col, col * vec3(0.72, 0.80, 1.0) + vec3(0.012, 0.02, 0.05), uNight);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

export function buildWater(material) {
  const group = new THREE.Group();
  group.name = 'water';

  // 长江
  const pts = smoothPolyline(toV2List(RIVER.pts), 8);
  const geo = ribbonGeometry(pts, (t) => RIVER.halfWidth * 2 * (0.78 + 0.34 * Math.sin(Math.PI * clamp(t, 0, 1)) + 0.06 * Math.sin(t * 26)), 0.35, 0.05);
  const river = new THREE.Mesh(geo, material);
  river.name = 'river';
  group.add(river);

  // 支汊（夹江）：窄航道，宽度不再做主江那样的摆动
  for (const br of RIVER.branches || []) {
    const bp = smoothPolyline(toV2List(br.pts), 8);
    const bg = ribbonGeometry(bp, br.halfWidth * 2, 0.34, 0.05);
    const bm = new THREE.Mesh(bg, material);
    bm.name = 'branch:' + (br.name || '夹江');
    group.add(bm);
  }

  // 湖泊
  for (const lake of LAKES) {
    const poly = toV2List(lake.pts);
    const g = polygonGeometry(poly, 0.3);
    const m = new THREE.Mesh(g, material);
    m.name = 'lake:' + lake.name;
    group.add(m);
  }

  // 沙洲（抬高的陆地）
  for (const isl of ISLANDS) {
    const poly = toV2List(isl.pts);
    const center = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
    // 轻微抬升：三角化的陆地面
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
    const gg = new THREE.ShapeGeometry(shape, 1);
    gg.rotateX(Math.PI / 2);
    const pos = gg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i) - center[0], pos.getZ(i) - center[1]);
      // 江心洲/八卦洲是冲积平原岛，真实高程仅数米——旧版鼓到 33 m，
      // 会把南京眼的西引桥整个吞进"绿丘"里
      pos.setY(i, Math.min(0.18, 0.05 + 0.35 * Math.exp(-d * d / (12 * 12))));
    }
    gg.computeVertexNormals();
    const mi = new THREE.Mesh(gg, mat('#9fb27a', { rough: 1, side: THREE.DoubleSide }));
    mi.receiveShadow = true;
    group.add(mi);
  }
  return group;
}

/* ==================== 道路 ==================== */

/** All road layers share gate ground elevations; city-wide roads are clipped around masonry. */
function roadGateZones(extraLines) {
  return CITY_GATES.map(gt => {
    const fr = gateFrame(gt), court = gt.court;
    // 门区矩形随门台按 1:30（vU）量取；authored 米出自门的场地数据，不再是地理路带量。
    const halfW = vU(Math.max(gt.siteWidthM || gt.widthM || gateHalfLenM(gt) * 2, court?.width || 0) / 2);
    const halfD = vU((gt.depthM || 20) / 2);
    const explicit = extraLines.find(l => l.gate === gt.name && Number.isFinite(l.elevation));
    return {
      ...fr, name: gt.name, halfW,
      minZ: Math.min(-halfD - (court?.side < 0 ? vU(court.depth) : 0), -vU(gt.innerExtentM || 0)),
      maxZ: halfD + (court?.side > 0 ? vU(court.depth) : 0),
      elevation: explicit?.elevation ?? Math.max(-0.05, terrainHeight(fr.x, fr.z) - 0.05) + vU(0.09),
    };
  });
}

function zonePoint(x, z, g) {
  const dx = x - g.x, dz = z - g.z;
  return [(dx * g.localX[0] + dz * g.localX[1]) * g.zOut, (dx * g.normal[0] + dz * g.normal[1]) * g.zOut];
}

function roadSurfaceAt(x, z, zones) {
  // 跨水段抬成桥面（南京长江大桥的公路面离水面几十米），其余是城市道路标高；
  // 城门区再叠上城门地坪。三者取「离得最近的那套权重最高者」，与旧逻辑一致。
  const water = waterLevelAt(x, z);
  let value = water > 0 ? Math.max(ROAD_Y, water + DECK_RISE) : ROAD_Y;
  let strength = water > 0 ? 1 : 0;
  for (const g of zones) {
    const [u, v] = zonePoint(x, z, g);
    const dx = Math.max(0, Math.abs(u) - g.halfW), dz = Math.max(0, g.minZ - v, v - g.maxZ);
    const weight = smooth(clamp(1 - Math.hypot(dx, dz) / hU(150), 0, 1));
    if (weight > strength) { value = ROAD_Y + (g.elevation - ROAD_Y) * weight; strength = weight; }
  }
  return value;
}

function clipRoadLine(line, zones) {
  if (line.gate) return [line];
  const pieces = [];
  for (let i = 1; i < line.pts.length; i++) {
    const a = line.pts[i - 1], b = line.pts[i];
    let intervals = [[0, 1]];
    for (const g of zones) {
      const pa = zonePoint(a[0], a[1], g), pb = zonePoint(b[0], b[1], g);
      // Expanding by half the road width protects the complete road strip, not just its centre.
      const pad = line.w / 2 + hU(2), lo = [-g.halfW - pad, g.minZ - pad], hi = [g.halfW + pad, g.maxZ + pad];
      let enter = 0, leave = 1, hits = true;
      for (let axis = 0; axis < 2; axis++) {
        const delta = pb[axis] - pa[axis];
        if (Math.abs(delta) < 1e-12) { if (pa[axis] < lo[axis] || pa[axis] > hi[axis]) hits = false; continue; }
        const t0 = (lo[axis] - pa[axis]) / delta, t1 = (hi[axis] - pa[axis]) / delta;
        enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1));
        if (enter >= leave) hits = false;
      }
      if (!hits) continue;
      intervals = intervals.flatMap(([start, end]) => {
        if (leave <= start || enter >= end) return [[start, end]];
        const out = [];
        if (enter > start) out.push([start, enter]);
        if (leave < end) out.push([leave, end]);
        return out;
      });
    }
    for (const [start, end] of intervals) {
      const point = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const p = point(start), q = point(end), previous = pieces[pieces.length - 1];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6) continue;
      const last = previous?.pts[previous.pts.length - 1];
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1e-7) previous.pts.push(q);
      else pieces.push({ ...line, pts: [p, q] });
    }
  }
  return pieces;
}

/** Add slope vertices only near a gate; a remote kilometre-long segment stays a single segment. */
function sampleRoadApproaches(line, zones) {
  const pts = [line.pts[0]];
  for (let i = 1; i < line.pts.length; i++) {
    const a = line.pts[i - 1], b = line.pts[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ranges = [];
    for (const g of zones) {
      const pa = zonePoint(a[0], a[1], g), pb = zonePoint(b[0], b[1], g);
      // Include strip edges, so even a wide road entering the transition gets enough vertices.
      const pad = hU(150) + line.w / 2;
      const lo = [-g.halfW - pad, g.minZ - pad], hi = [g.halfW + pad, g.maxZ + pad];
      let start = 0, end = 1, hits = true;
      for (let axis = 0; axis < 2; axis++) {
        const delta = pb[axis] - pa[axis];
        if (Math.abs(delta) < 1e-12) { if (pa[axis] < lo[axis] || pa[axis] > hi[axis]) hits = false; continue; }
        const t0 = (lo[axis] - pa[axis]) / delta, t1 = (hi[axis] - pa[axis]) / delta;
        start = Math.max(start, Math.min(t0, t1)); end = Math.min(end, Math.max(t0, t1));
        if (start >= end) hits = false;
      }
      if (hits) ranges.push([start, end]);
    }
    const cuts = [...new Set([0, 1, ...ranges.flat()])].sort((x, y) => x - y);
    for (let k = 1; k < cuts.length; k++) {
      const start = cuts[k - 1], end = cuts[k], middle = (start + end) / 2;
      const nearGate = ranges.some(([lo, hi]) => middle >= lo && middle <= hi);
      const count = nearGate ? Math.max(1, Math.ceil(length * (end - start) / hU(8))) : 1;
      for (let n = 1; n <= count; n++) {
        const t = start + (end - start) * n / count;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return { ...line, pts };
}

/** 城市道路统一标高。
 *  早先路面写死 0.06，而地面在 -0.05、城门内道路是 max(-0.05, terrain) + 0.0009，
 *  三处各高一截，城门口就是一道 3 m 高的断崖，城外还整条浮在地面上方。 */
export const ROAD_Y = -0.045;   // 导出供校验脚本对齐「引道重新接回城市路面标高」的语义断言

/* ---------------- 道路走廊：山体切坡 ----------------
 * 山区公路是「切山坡」过去的：把走廊内的地形削到路面标高。
 * 不削的话路面（常数标高）会直接插进紫金山 —— 龙蟠路 22% 的采样点就埋在山体里。 */
let corridorCache = null;
function roadCorridor() {
  if (!corridorCache) corridorCache = ROADS.map((r) => toV2List(smoothPolyline(r.pts, 6)));
  return corridorCache;
}
/** 到最近道路中心线的水平距离（米） */
export function roadDistM(x, z) {
  let best = Infinity;
  for (const l of roadCorridor()) { const d = distToPolyline(x, z, l) * M_PER_U_H; if (d < best) best = d; }
  return best;
}
/** 山体网格顶点专用：把走廊内的地形压到路面标高，边缘 9 m 内平滑回到原地形 */
export function roadCutHeight(h, x, z) {
  const d = roadDistM(x, z);
  if (d > 48) return h;
  const t = clamp((d - 27) / 9, 0, 1);
  const cap = ROAD_Y - 0.012;
  return Math.min(h, cap + (h - cap) * smooth(t));
}

/* ---------------- 水面（供桥梁抬升） ---------------- */
let waterCache = null;
function waterBands() {
  if (!waterCache) {
    waterCache = [
      { pts: toV2List(smoothPolyline(RIVER.pts, 8)), half: RIVER.halfWidth * 0.86, y: 0.35 },
      ...(RIVER.branches || []).map((b) => ({ pts: toV2List(smoothPolyline(b.pts, 8)), half: b.halfWidth, y: 0.34 })),
      ...LAKES.map((l) => ({ pts: toV2List(l.pts), half: 0, y: 0.3, closed: true })),
    ];
  }
  return waterCache;
}
/** 该点所在的水面标高（单位），0 = 不在水上 */
function waterLevelAt(x, z) {
  for (const b of waterBands()) {
    if (b.closed) {
      let inside = false;
      for (let i = 0, j = b.pts.length - 1; i < b.pts.length; j = i++) {
        const [xi, zi] = b.pts[i], [xj, zj] = b.pts[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return b.y;
    } else if (distToPolyline(x, z, b.pts) < b.half) return b.y;
  }
  return 0;
}
/** 跨水段的桥面标高：水面 + 通航净空。垂直 1 单位 = 30 m，南京长江大桥公路面
 *  离水面约 50 m，这里取 0.85 单位（≈26 m）——够高、看着像桥，又不至于飞上天。 */
const DECK_RISE = 0.65;   // 过江路面 = 水面 0.35 + 0.65 = 1.0 = vU(30)，与长江大桥公路面同高
                           // （旧值 0.85 会高出桥面 0.15u，路面带悬在桁架上方斜穿）

/* ---------------- 断面扫掠 ---------------- */
/** 沿折线按 ~12 m 取站，站点法向取前后段的中心差分（拐角自动斜接，不出现缺口） */
function roadStations(pts, surfaceAt, stepM = 12) {
  const p = resample(pts, hU(stepM));
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    out.push({ x: p[i][0], z: p[i][1], nx: -dz, nz: dx, s: 0, y: surfaceAt(p[i][0], p[i][1]) });
  }
  let s = 0;
  for (let i = 1; i < out.length; i++) {
    s += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z) * M_PER_U_H;
    out[i].s = s;
  }
  return out;
}

/** 一条横断面带（或一条标线）沿整条路扫过去。u 用沿线米数、v 用米数（标线 v=0..1），
 *  这样贴图永远是实物尺度，路再长也不会被拉花。 */
class BandSweep {
  constructor() { this.pos = []; this.uv = []; this.idx = []; }
  /** aM/bM：横向偏移（米，相对中心线）；yaM/ybM：相对路面标高的高差（米） */
  add(st, aM, bM, yaM, ybM, us, vs, vUnit = false) {
    const base = this.pos.length / 3;
    for (let i = 0; i < st.length; i++) {
      const q = st[i];
      for (const [t, y, v] of [[aM, yaM, 0], [bM, ybM, 1]]) {
        this.pos.push(q.x + q.nx * hU(t), q.y + vU(y), q.z + q.nz * hU(t));
        this.uv.push(q.s * us, vUnit ? v : t * vs);
      }
    }
    for (let i = 0; i < st.length - 1; i++) {
      const o = base + i * 2;
      // o=[i,a] o+1=[i,b] o+2=[i+1,a] o+3=[i+1,b] —— 绕序 (o,o+1,o+2)(o,o+3,o+2) 法线朝上
      this.idx.push(o, o + 1, o + 2, o, o + 3, o + 2);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    const n = new Float32Array((this.pos.length / 3) * 3);
    for (let i = 0; i < n.length / 3; i++) n[i * 3 + 1] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/* ---------------- 道路几何 ---------------- */

const bbox = (pts) => {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const [x, z] of pts) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
  return [a, b, c, d];
};

/** 合并同材质的若干 sweep，并按顶点数分块（reduce draw call）。
 *  为什么必须分块：整城铺装合起来每个材质有 10 万~20 万顶点，索引只能用 Uint32。
 *  软件渲染（无头自检用的 SwiftShader）在大 Uint32 索引网格上会**整片整片漏画三角形**，
 *  表现为路面浮出一层人字纹、从缺掉的地方直接看到背景 —— 几何本身是健康的（CPU 射线
 *  命中、三角形面积分布都正常），排查了很久才定位到渲染器这一层。
 *  分块到 6 万顶点以内后索引回到 Uint16，软硬件两条路都稳。 */
function mergeGeosChunked(list, maxVerts = 60000) {
  const out = [];
  let batch = [], verts = 0;
  const flush = () => {
    if (!batch.length) return;
    const g = mergeGeos(batch);
    if (g) out.push(g);
    batch = []; verts = 0;
  };
  for (const g of list) {
    if (!g || !g.attributes.position || !g.index) continue;
    const n = g.attributes.position.count;
    if (verts + n > maxVerts) flush();
    batch.push(g); verts += n;
  }
  flush();
  return out;
}

/** 合并同材质的若干 sweep（reduce draw call） */
function mergeGeos(list) {
  const geos = list.filter((g) => g && g.attributes.position && g.index);
  if (!geos.length) return null;
  if (geos.length === 1) return geos[0];
  let np = 0, ni = 0;
  for (const g of geos) { np += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(np * 3), uv = new Float32Array(np * 2), nor = new Float32Array(np * 3);
  // 分块后 np 必 ≤ 65536，索引就能用 Uint16 —— 见 mergeGeosChunked 的注释
  const idx = np <= 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
    uv.set(g.attributes.uv.array.subarray(0, n * 2), vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += n; io += gi.length;
  }
  for (let i = 0; i < np; i++) nor[i * 3 + 1] = 1;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** 返回 { mesh, glow, centerlines, mats, surfaceAt } —— centerlines 供车辆行驶使用 */
export function buildRoads(extraLines = []) {
  const zones = roadGateZones(extraLines);
  const surfaceAt = (x, z) => roadSurfaceAt(x, z, zones);

  const sourceLines = ROADS.map((r) => ({
    // w 是场景单位（1 单位 = 100 m）：0.5 → 50 m，符合真实主干道红线宽。
    // 旧版写成 r.w * 10 = 500 m 宽的路面带，整条中山东路变成了吞掉沿线地标的大平原。
    name: r.name, w: hU(roadSection(r).W), pts: toV2List(smoothPolyline(r.pts, 8)),
  })).concat(extraLines);
  const centerlines = sourceLines.flatMap((l) => clipRoadLine(l, zones));

  const group = new THREE.Group();
  group.name = 'roads';

  const asphalt = mat('#ffffff', { rough: 0.93, metal: 0, env: 0.5, map: makeAsphaltTexture() });
  const auxMat = mat('#95989b', { rough: 0.96, metal: 0, env: 0.45, map: makeAsphaltTexture() });
  const bikeMat = mat('#a8aaa8', { rough: 0.96, metal: 0, env: 0.42, map: makeAsphaltTexture() });
  const walkMat = mat('#ffffff', { rough: 0.98, metal: 0, env: 0.4, map: makeSidewalkTexture() });
  const curbMat = mat('#ffffff', { rough: 0.9, metal: 0, env: 0.45, map: makeCurbTexture() });
  const greenMat = mat('#7d9164', { rough: 1, metal: 0, env: 0.35 });
  const markWhite = mat('#ffffff', { rough: 0.78, metal: 0, env: 0.3, map: makeLaneMarkTexture(), transparent: true, alphaTest: 0.3 });
  const markYellow = mat('#ffffff', { rough: 0.78, metal: 0, env: 0.3, map: makeLaneMarkTexture(128, '#d9b451'), transparent: true, alphaTest: 0.3 });
  const mats = [asphalt, auxMat, bikeMat, walkMat, curbMat, greenMat, markWhite, markYellow];
  // 注意：这里**不要**用 polygonOffset 去解决「铺装与地面只差 15 cm」的共面问题。
  // 它的偏移量正比于深度斜率，掠射视角下同一条路的两个三角形会拿到不同的偏移，
  // 结果是路面浮出锯齿状的黑白三角。正确解法见 buildGround()：地面不写深度、最先画。

  const bucket = new Map();                       // 材质 → 几何列表
  const push = (m, geo) => {
    if (!geo) return;
    if (!bucket.has(m)) bucket.set(m, []);
    bucket.get(m).push(geo);
  };

  const MARK = 0.15;                 // 标线宽 15 cm（真实值）
  const MARK_LIFT = 0.02;            // 标线离路面 2 cm，压住 z-fighting
  const srcBox = sourceLines.map((l) => bbox(l.pts));
  const nearOther = (x, z, self) => sourceLines.some((l, i) => (
    i !== self && srcBox[i][0] <= x && x <= srcBox[i][1] && srcBox[i][2] <= z && z <= srcBox[i][3]
    && distToPolyline(x, z, l.pts) * M_PER_U_H < 26));        // < 26 m 视为路口范围

  const glowB = new BandSweep();     // 夜间发光的车道线（与标线同位、略高）

  ROADS.forEach((r, ri) => {
    const sec = roadSection(r);
    const line = { name: r.name, w: hU(sec.W), pts: toV2List(smoothPolyline(r.pts, 8)) };
    for (const piece of clipRoadLine(line, zones)) {
      const st = roadStations(piece.pts, surfaceAt);
      if (st.length < 2) continue;
      const junction = st.map((q) => nearOther(q.x, q.z, ri));

      // ---- 横断面铺装：人行道 / 侧石顶面 / 非机动车道 / 机动车道 / 辅道 / 土路肩 / 中央分隔带 ----
      const kindMat = { sidewalk: walkMat, curbtop: walkMat, bike: bikeMat, aux: auxMat, verge: greenMat, median: greenMat };
      for (const b of sec.bands) {
        const m = b.kind === 'motor' || b.kind === 'hard' ? asphalt : kindMat[b.kind];
        if (!m) continue;
        const sb = new BandSweep();
        // u = 沿线米/8、v = 横向米/8：贴图永远是实物尺度，路再长也不会被拉花
        sb.add(st, b.lo, b.hi, b.y, b.y, 1 / 8, b.kind === 'sidewalk' || b.kind === 'curbtop' ? 1 / 2 : 1 / 8);
        push(m, sb.build());
      }
      // 侧石立面：路面 → 人行道顶，厚 0.25 m，法线朝车行道（winding 见 BandSweep）
      for (const s of [-1, 1]) {
        const x0 = s * (sec.half - sec.sidewalk);
        const sb = new BandSweep();
        sb.add(st, x0, x0 - s * sec.curbW, 0, 0.16, 1, 1 / 0.6);
        push(curbMat, sb.build());
      }

      // ---- 车道标线 ----
      const motorOuter = -sec.half + sec.sidewalk + sec.curbW + sec.hard + sec.bike;   // 单向车道区外缘
      const midEdge = sec.median / 2;
      const mark = (a, b, m) => {
        const sb = new BandSweep();
        sb.add(st, a, b, MARK_LIFT, MARK_LIFT, 1 / 12, 1, true);
        push(m, sb.build());
      };
      // 虚线（车道分界）：逐段跳过路口
      for (let i = 1; i < sec.lanes; i++) {
        const a = motorOuter + sec.lane * i;
        const sb = new BandSweep();
        for (let k = 0; k < st.length - 1; k++) {
          if (junction[k] || junction[k + 1]) continue;
          sb.add([st[k], st[k + 1]], a - MARK / 2, a + MARK / 2, MARK_LIFT, MARK_LIFT, 1 / 12, 1, true);
        }
        push(markWhite, sb.build());
        glowB.add(st, a - MARK / 2, a + MARK / 2, MARK_LIFT + 0.01, MARK_LIFT + 0.01, 1 / 12, 1, true);
      }
      // 实线：跨路口的整条不画（路口里本来就没有车道线）
      if (!junction.some(Boolean)) {
        for (const s of [-1, 1]) {
          const outer = s * motorOuter;                    // 车道外缘白实线
          mark(s < 0 ? outer - MARK : outer, s < 0 ? outer : outer - MARK, markWhite);
          const mid = s * midEdge;                         // 中分带边黄实线
          mark(s < 0 ? mid - MARK : mid, s < 0 ? mid : mid - MARK, markYellow);
          glowB.add(st, s < 0 ? mid - MARK : mid, s < 0 ? mid : mid - MARK,
            MARK_LIFT + 0.01, MARK_LIFT + 0.01, 1 / 12, 1, true);
        }
      }
    }
  });

  // 穿门路与片区格网路（extraLines）：主干 forEach 之外的窄幅铺装。
  // 主干道被门区裁剪后，门洞正下方与近引道由这些线补上——此前只靠主干路宽度
  // 偶然盖住洞心，门体等比 1:30 后多孔门洞心横向散开 ±0.43u，超出主干半宽。
  // 采样只在门区附近细分（sampleRoadApproaches），远端公里级路段保持单四边形，
  // 与「remote 10 km road remains one quad」的回归口径一致。
  // extraLineTris 单独上报:校验要测「穿门路自身的门区细分」,不能被路口虚线
  // 跳过(junction 抑制)造成的主干减面淹没。
  let extraLineTris = 0;
  for (const l of sourceLines.slice(ROADS.length)) {
    if (l.grid) continue;   // 片区格网街是楼间留缝的示意线,不铺装(铺了会盖白全城地面)
    const graded = sampleRoadApproaches(l, zones);
    const st = [];
    for (let i = 0; i < graded.pts.length; i++) {
      const a = graded.pts[Math.max(0, i - 1)], b = graded.pts[Math.min(graded.pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      st.push({
        x: graded.pts[i][0], z: graded.pts[i][1], nx: -dz, nz: dx, s: 0,
        y: surfaceAt(graded.pts[i][0], graded.pts[i][1]),
      });
    }
    for (let i = 1; i < st.length; i++) st[i].s = st[i - 1].s + Math.hypot(st[i].x - st[i - 1].x, st[i].z - st[i - 1].z) * M_PER_U_H;
    if (st.length < 2) continue;
    const sb = new BandSweep();
    // 横向偏移用米：l.w 是场景单位（1:100），BandSweep 内部再 hU 换算
    sb.add(st, -l.w * M_PER_U_H / 2, l.w * M_PER_U_H / 2, 0, 0, 1 / 8, 1 / 8);
    const ribbon = sb.build();
    extraLineTris += ribbon.index.count / 3;
    push(asphalt, ribbon);
  }

  for (const [m, list] of bucket) {
    for (const geo of mergeGeosChunked(list)) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  for (const g of group.children) g.name = 'roads';

  // 夜间发光的车道线：整条主干道亮起来的是标线，不是一条糊满路面的宽光带
  const glowGeo = glowB.build();
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffe2b4, transparent: true, opacity: 0, depthWrite: false });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.name = 'roadGlow';

  return { mesh: group, glow, centerlines, mats, surfaceAt, extraLineTris };
}

/* ==================== 明城墙 ==================== */

// 本剖面使用米制且 XYZ 同比缩放；墙线仍沿现有地理控制点，不把插值当成测绘成果。
export const WALL_PROFILE = Object.freeze({
  heightM: 20, baseM: 20, topM: 7, sinkM: 1.5,
  outerParapetM: 0.9, innerParapetM: 0.85, parapetThicknessM: 0.55,
  merlonHeightM: 0.9, merlonWidthM: 0.95, merlonPitchM: 1.84,
});
const P = WALL_PROFILE;
const TOP_RISE = 0.05, PLINTH_H = 1.3, PLINTH_OUT = 0.35;
const JOINT_INSET_M = 0.4;
// 城墙断面（含门）按 1:30 竖向比例（vU）放大，墙线走向仍按 1:100 地理比例（hU）；
// 该比值用于沿线量的米→s 参数换算与贴图 v 向密度补偿，保证砖石贴图保持实物尺度。
const WALL_UV_V = M_PER_U_H / M_PER_U_V;

// 门台和相邻墙顶必须共享同一地形基准。埋基只作用于墙底，不重复从整墙高度扣除。
const wallBaseY = (x, z) => Math.max(-0.05, terrainHeight(x, z) - 0.05);

function gateWallInfo(gt) {
  const fr = gateFrame(gt);
  const isRuin = gt.kind === 'ruin' && gt.profile !== 'hanzhong';
  const depthM = gt.depthM || P.baseM;
  return {
    ...fr, name: gt.name, kind: gt.kind,
    halfM: gateHalfLenM(gt), depthM,
    heightM: isRuin ? Math.max(0.12, gt.remnant ?? 0.12) : (gt.joinDeckH ?? gt.wallDeckM ?? gt.wallH ?? P.heightM),
    baseM: Math.min(P.baseM, depthM),
    topM: Math.min(P.topM, Math.max(0.6, depthM - 1)),
    baseY: wallBaseY(fr.x, fr.z),
    parapetFactor: isRuin ? 0 : 1,
  };
}

/** 沿同一条闭合墙线的弧长切口；每扇门恰好产生左右两端，避免远处平行墙被误切。
 * 保留原墙线，门侧最后 40 cm 埋入门台，接头法向与门台共用 gateFrame。
 */
function wallRuns(gates) {
  const ring = WALL_LINE.concat([WALL_LINE[0]]), distances = [0];
  for (let i = 1; i < ring.length; i++) distances.push(distances[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const length = distances[distances.length - 1];
  const sorted = [...gates].sort((a, b) => a.along - b.along);
  // 门占地沿墙量也切到 vU：门台按 1:30 放大后，其半宽占据的墙线弧长相应变长。
  const sidePoint = (g, sign) => [g.x + g.localX[0] * vU(sign * (g.halfM - JOINT_INSET_M)), g.z + g.localX[1] * vU(sign * (g.halfM - JOINT_INSET_M))];
  return sorted.map((a, i) => {
    const b = sorted[(i + 1) % sorted.length];
    const start = a.along + vU(a.halfM), end = b.along + (i === sorted.length - 1 ? length : 0) - vU(b.halfM);
    const pts = [sidePoint(a, 1)];
    for (let lap = 0; lap < 2; lap++) {
      for (let k = 0; k < ring.length - 1; k++) {
        const s = distances[k] + lap * length;
        if (s > start + 1e-7 && s < end - 1e-7) pts.push(ring[k]);
      }
    }
    pts.push(sidePoint(b, -1));
    const clean = pts.filter((p, j) => !j || Math.hypot(p[0] - pts[j - 1][0], p[1] - pts[j - 1][1]) > 1e-6);
    return { points: resample(clean, hU(8)), startGate: a, endGate: b };
  });
}

function wallStations(run) {
  const { points: pts, startGate, endGate } = run;
  const st = pts.map(([x, z], i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1], len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    let nx = -tz, nz = tx;
    if ((x - WALL_CENTER[0]) * nx + (z - WALL_CENTER[1]) * nz < 0) { nx = -nx; nz = -nz; }
    return { x, z, nx, nz, ang: Math.atan2(tx, tz), s: 0, y: wallBaseY(x, z), heightM: P.heightM, baseM: P.baseM, topM: P.topM, parapetFactor: 1 };
  });
  for (let i = 1; i < st.length; i++) st[i].s = st[i - 1].s + Math.hypot(st[i].x - st[i - 1].x, st[i].z - st[i - 1].z) * 100;
  const lengthM = st[st.length - 1].s;
  const blendM = Math.min(110, lengthM / 3);
  for (const p of st) {
    for (const [g, d] of [[startGate, p.s], [endGate, lengthM - p.s]]) {
      const mix = smooth(clamp(1 - d / Math.max(1, blendM), 0, 1));
      if (!mix) continue;
      p.y += (g.baseY - p.y) * mix;
      p.heightM += (g.heightM - p.heightM) * mix;
      p.baseM += (g.baseM - p.baseM) * mix;
      p.topM += (g.topM - p.topM) * mix;
      p.parapetFactor += (g.parapetFactor - p.parapetFactor) * mix;
      const turnMix = smooth(clamp(1 - d / 35, 0, 1));
      p.nx += (g.normal[0] * g.zOut - p.nx) * turnMix;
      p.nz += (g.normal[1] * g.zOut - p.nz) * turnMix;
    }
    const normalLength = Math.hypot(p.nx, p.nz) || 1;
    p.nx /= normalLength; p.nz /= normalLength;
  }
  // 端头断面直接取门台坐标系：弯曲墙段也不会斜着切进券洞或伸出城台。
  for (const [p, g] of [[st[0], startGate], [st[st.length - 1], endGate]]) {
    p.nx = g.normal[0] * g.zOut; p.nz = g.normal[1] * g.zOut;
    p.ang = Math.atan2(g.localX[0], g.localX[1]);
  }
  return st;
}

function stationAtS(st, s, cursor) {
  while (cursor.i < st.length - 1 && st[cursor.i].s < s) cursor.i++;
  const a = st[Math.max(0, cursor.i - 1)], b = st[cursor.i];
  const t = clamp((s - a.s) / Math.max(1e-9, b.s - a.s), 0, 1), out = { s };
  for (const k of ['x', 'z', 'nx', 'nz', 'y', 'heightM', 'baseM', 'topM', 'parapetFactor']) out[k] = a[k] + (b[k] - a[k]) * t;
  const len = Math.hypot(out.nx, out.nz) || 1; out.nx /= len; out.nz /= len;
  out.ang = Math.atan2(-out.nz, out.nx);
  return out;
}

const valueAt = (v, s) => typeof v === 'function' ? v(s) : v;
// 连续墙唯一的米→世界换算缝：断面横向 t 与高度 h 必须同用 vU（1:30），
// 否则墙顶/贴图/垛口的横向尺度与高度不成比例。
function stationPoint(s, t, h) {
  return [s.x + s.nx * vU(valueAt(t, s)), s.y + vU(valueAt(h, s)), s.z + s.nz * vU(valueAt(t, s))];
}

/** 连续剖面带。每个四边形检查绕序，凹凸拐点两面的光照都保持正确。 */
class WallStrip {
  constructor() { this.pos = []; this.uv = []; this.idx = []; }
  quad(points, uv, normal) {
    const o = this.pos.length / 3;
    const facing = ([i, j, k]) => {
      const a = points[i], b = points[j], c = points[k];
      const u = b.map((n, q) => n - a[q]), v = c.map((n, q) => n - a[q]);
      return (u[1] * v[2] - u[2] * v[1]) * normal[0] + (u[2] * v[0] - u[0] * v[2]) * normal[1] + (u[0] * v[1] - u[1] * v[0]) * normal[2];
    };
    let triangles = [[0, 1, 2], [0, 2, 3]];
    // 内凹转角采用另一条对角线，避免把非凸四边形拆出一个反向三角形。
    if (facing(triangles[0]) * facing(triangles[1]) < 0) triangles = [[0, 1, 3], [1, 2, 3]];
    this.pos.push(...points.flat()); this.uv.push(...uv);
    for (const triangle of triangles) {
      const [a, b, c] = triangle;
      this.idx.push(...(facing(triangle) < 0 ? [o + a, o + c, o + b] : [o + a, o + b, o + c]));
    }
  }
  face(st, ta, ha, tb, hb, direction, uvU = 0.25, uvV = 0.5 * WALL_UV_V) { // v 向按 100/30 补偿，砖保持实物尺度
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i], b = st[i + 1];
      const normal = direction === 'up' ? [0, 1, 0] : direction === 'down' ? [0, -1, 0] : [a.nx * direction, 0, a.nz * direction];
      const av = direction === 'up' ? valueAt(ta, a) : valueAt(ha, a);
      const bv = direction === 'up' ? valueAt(tb, a) : valueAt(hb, a);
      this.quad([stationPoint(a, ta, ha), stationPoint(a, tb, hb), stationPoint(b, tb, hb), stationPoint(b, ta, ha)],
        [a.s * uvU, av * uvV, a.s * uvU, bv * uvV, b.s * uvU, bv * uvV, b.s * uvU, av * uvV], normal);
    }
    return this;
  }
  cap(s, corners, normal) {
    this.quad(corners.map(([t, h]) => stationPoint(s, t, h)), [0, 0, 0, 1, 1, 1, 1, 0], normal);
  }
  build() {
    if (!this.pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx); geo.computeVertexNormals();
    return geo;
  }
}

export function buildWall() {
  const group = new THREE.Group(); group.name = 'citywall';
  // 城墙 rig 显式传 per-rig metre：墙的 authored 米已按 1:30（vU）渲染，米制光度换算用 1/30。
  const lighting = createArchitecturalLighting(group, { metre: vU(1) });
  const gates = CITY_GATES.map(gateWallInfo), runs = wallRuns(gates), stations = runs.map(wallStations);
  const brickB = new WallStrip(), stoneB = new WallStrip(), topB = new WallStrip(), bandB = new WallStrip(), channelB = new WallStrip();
  const lightJoints = [];
  const bh = s => s.baseM / 2, th = s => s.topM / 2, top = s => s.heightM;
  for (let runIndex = 0; runIndex < stations.length; runIndex++) {
    const st = stations[runIndex], run = runs[runIndex], lightStations = st.slice();
    for (const [index, gate, side] of [[0, run.startGate, 1], [st.length - 1, run.endGate, -1]]) {
      // Masonry remains embedded 40 cm into the gate. Only the fixture end moves
      // 48 cm onto its visible side-perimeter LED, at width / 2 + 8 cm.
      // Zhonghua's top-mounted U loop has a different supported route; demolished
      // gate sites have no platform loop to connect and must remain open.
      if (gate.name === '中华门' || gate.parapetFactor === 0) continue;
      const endpoint = {
        ...st[index],
        x: gate.x + gate.localX[0] * vU(side * (gate.halfM + 0.08)),
        z: gate.z + gate.localX[1] * vU(side * (gate.halfM + 0.08)),
      };
      lightStations[index] = endpoint;
      lightJoints.push({ gate: gate.name, side, station: endpoint });
    }
    brickB.face(st, th, top, bh, -P.sinkM, 1);
    brickB.face(st, s => -bh(s), -P.sinkM, s => -th(s), top, -1);
    topB.face(st, s => -th(s), s => top(s) - TOP_RISE, th, s => top(s) + TOP_RISE, 'up', 1 / 1.6, (1 / 1.2) * WALL_UV_V); // v 向按 100/30 补偿，砖保持实物尺度
    for (const side of [1, -1]) {
      const edge = s => side * th(s), inner = s => side * (th(s) - P.parapetThicknessM);
      const parapet = s => top(s) + (side > 0 ? P.outerParapetM : P.innerParapetM) * s.parapetFactor;
      brickB.face(st, edge, top, edge, parapet, side);
      brickB.face(st, inner, parapet, inner, top, -side);
      topB.face(st, edge, parapet, inner, parapet, 'up');
      // 勒脚沿收分墙脚逐渐接回，不悬出一条没有顶面的石裙。
      const plinth = s => Math.min(PLINTH_H, s.heightM * 0.45);
      const foot = s => side * (bh(s) + PLINTH_OUT);
      const atPlinth = s => side * (bh(s) + (th(s) - bh(s)) * (plinth(s) + P.sinkM) / (top(s) + P.sinkM));
      stoneB.face(st, foot, -P.sinkM, foot, plinth, side, 1 / 2.4, (1 / 1.2) * WALL_UV_V); // v 向按 100/30 补偿，砖保持实物尺度
      stoneB.face(st, foot, plinth, atPlinth, plinth, 'up', 1 / 2.4, (1 / 1.2) * WALL_UV_V); // v 向按 100/30 补偿，砖保持实物尺度
      // A recessed 8 cm LED line sits below the coping. The masonry itself never emits light.
      const bandTop = s => Math.max(0, top(s) - 0.12), bandBottom = s => Math.max(0, top(s) - 0.20);
      const channelTop = s => Math.max(0, top(s) - 0.09), channelBottom = s => Math.max(0, top(s) - 0.23);
      const faceOffset = (s, h, offset) => side * (bh(s) + (th(s) - bh(s)) * (h + P.sinkM) / (top(s) + P.sinkM) + offset);
      channelB.face(lightStations, s => faceOffset(s, channelTop(s), 0.022), channelTop, s => faceOffset(s, channelBottom(s), 0.022), channelBottom, side);
      bandB.face(lightStations, s => faceOffset(s, bandTop(s), 0.035), bandTop, s => faceOffset(s, bandBottom(s), 0.035), bandBottom, side);
    }
    // 遗址端头以及接缝下方都封闭，低视角不再穿过无厚度的墙壳。
    for (const [s, next] of [[st[0], st[1]], [st[st.length - 1], st[st.length - 2]]]) {
      const normal = [s.x - next.x, 0, s.z - next.z];
      brickB.cap(s, [[-bh(s), -P.sinkM], [bh(s), -P.sinkM], [th(s), top(s)], [-th(s), top(s)]], normal);
      for (const side of [1, -1]) {
        const a = side * th(s), b = side * (th(s) - P.parapetThicknessM), h = top(s) + (side > 0 ? P.outerParapetM : P.innerParapetM) * s.parapetFactor;
        brickB.cap(s, [[a, top(s)], [b, top(s)], [b, h], [a, h]], normal);
      }
    }
  }

  const wallMat = mat('#ffffff', { rough: 0.94, env: 0.45, map: makeMasonryTexture() });
  const topMat = mat('#e2dccb', { rough: 0.92, env: 0.4, map: makeWallTopTexture() });
  const stoneMat = mat('#ded7c6', { rough: 0.9, env: 0.4, map: makeWallStoneTexture() });
  const merlonMat = mat('#bdb6a5', { rough: 0.94, env: 0.45 });
  const channelMat = mat('#292720', { rough: 0.8, metal: 0.45, env: 0.3 });
  const masonryMats = [wallMat, merlonMat, stoneMat, topMat, channelMat];
  for (const m of masonryMats) { m.emissive.set(0x000000); m.emissiveIntensity = 0; }
  for (const [name, geometry, material] of [['wall:masonry', brickB.build(), wallMat], ['wall:walkway', topB.build(), topMat], ['wall:footing', stoneB.build(), stoneMat]]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }

  // 垛口节距必须随墙线放大（s 是 1:100 地理米，垛距是 1:30 断面米），否则垛块互相穿插。
  const capacity = stations.reduce((sum, st) => sum + Math.ceil(st[st.length - 1].s / (P.merlonPitchM * WALL_UV_V)), 0);
  const merlons = new THREE.InstancedMesh(UNIT.box, merlonMat, capacity), dummy = new THREE.Object3D();
  merlons.name = 'wall:merlons'; let count = 0;
  for (const st of stations) {
    const end = st[st.length - 1].s, cursor = { i: 1 };
    // 半个垛宽退让：整个实例都位于墙段内，不把端头垛块插到门台上。节距/退让按 WALL_UV_V 折算到 s。
    for (let s = P.merlonPitchM * WALL_UV_V / 2; s < end - P.merlonWidthM * WALL_UV_V / 2; s += P.merlonPitchM * WALL_UV_V) {
      const p = stationAtS(st, s, cursor);
      if (p.parapetFactor < 0.6 || p.heightM < 3) continue;
      const t = p.topM / 2 - P.parapetThicknessM / 2;
      // UNIT.box 底在 y=0；以前多加半个垛高导致雉堞悬空。垛块三轴全按 vU（1:30）。
      dummy.position.set(p.x + p.nx * vU(t), p.y + vU(p.heightM + P.outerParapetM * p.parapetFactor), p.z + p.nz * vU(t));
      dummy.rotation.set(0, p.ang, 0);
      dummy.scale.set(vU(P.parapetThicknessM), vU(P.merlonHeightM * p.parapetFactor), vU(P.merlonWidthM));
      dummy.updateMatrix(); merlons.setMatrixAt(count++, dummy.matrix);
    }
  }
  merlons.count = count; merlons.instanceMatrix.needsUpdate = true;
  merlons.castShadow = merlons.receiveShadow = true; group.add(merlons);

  // Candidate wall washers only; the shared nearest-light pool owns the real SpotLights.
  // power/range/灯高/瞄准高/沿墙步距均为 authored 米，全部不动：
  // 位置经 stationPoint（vU）换算，米制光度经 per-rig metre（1/30）换算。
  for (const st of stations) {
    const cursor = { i: 1 }, end = st[st.length - 1].s;
    for (let distanceM = 20; distanceM < end - 2; distanceM += 40) {
      const s = stationAtS(st, distanceM, cursor);
      if (s.heightM < 3) continue;
      const lampH = s.heightM - 0.16, aimH = Math.max(0.7, lampH - 6);
      const wallFace = h => s.baseM / 2 + (s.topM - s.baseM) / 2 * (h + P.sinkM) / (s.heightM + P.sinkM);
      lighting.spot({
        position: stationPoint(s, wallFace(lampH) + 0.8, lampH),
        target: stationPoint(s, wallFace(aimH) + 0.03, aimH),
        normal: [s.nx, 0, s.nz],
        power: 90, range: 22, angle: 1.05, priority: 0.45,
      });
    }
  }

  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffbe70, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const lights = new THREE.Group(); lights.name = 'wallLights';
  const channel = new THREE.Mesh(channelB.build(), channelMat); channel.name = 'wall:light-channel';
  channel.receiveShadow = true; group.add(channel);
  const band = new THREE.Mesh(bandB.build(), lightMat); band.name = 'wall:lighting'; band.visible = false; lights.add(band); group.add(lights);
  function setNight(k) {
    const n = clamp(k, 0, 1); lightMat.opacity = n * 0.8; band.visible = n > 0;
    lighting.setNight(n);
    for (const m of masonryMats) { m.emissive.set(0x000000); m.emissiveIntensity = 0; }
  }
  setNight(0);
  const ends = stations.map((st, i) => ({
    a: [st[0].x, st[0].z], b: [st[st.length - 1].x, st[st.length - 1].z],
    start: { station: st[0], gate: runs[i].startGate, side: 1 },
    end: { station: st[st.length - 1], gate: runs[i].endGate, side: -1 },
  }));
  return { group, polygon: WALL_LINE.concat([WALL_LINE[0]]), mats: masonryMats, glow: lights, glowMat: lightMat, setNight, ends, lightJoints, profile: P };
}
