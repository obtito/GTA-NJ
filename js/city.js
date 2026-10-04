// 程序化城市：建筑、行道树、车流
import * as THREE from 'three';
import { toV2, toV2List, mY, makeRandom, clamp, pointInPolygon, distToPolyline, smoothPolyline, hU, vU, M_PER_U_H, M_PER_U_V } from './geo.js';
import { DISTRICTS, PARKS, RIVER, LAKES, CITY_WALL, ROADS } from './data.js';
import { mat, loadTexture, makeFacadeTexture, makeWindowTexture, makeRoofTexture, patchMaterial, instancedBoxes, registerEnv } from './lib.js';
import { terrainHeight } from './world.js';
import { phaseFor } from './signals.js';

const RIVER_PTS = toV2List(RIVER.pts);
// 夹江等支流（data.js 里字段是 halfWidth）：路灯避水要连支流一起查
const RIVER_BRANCHES = (RIVER.branches || []).map((b) => ({ hw: b.halfWidth, pts: toV2List(b.pts) }));
const LAKE_POLYS = LAKES.map((l) => toV2List(l.pts));
const WALL_PTS = toV2List(CITY_WALL);

/* ============ 掩膜：水体 / 山体 / 城墙 / 道路 / 地标占地 之上不生成建筑 ============ */
/* 道路走廊：楼体、行道树一律不能落到沥青上 —— 这是“楼从马路里长出来”的根因。
 * 走廊取 buildRoads 实际用的平滑中心线（与 world.js roadCorridor 同几何），
 * 判定阈值 = 该路红线半宽 + padM（建筑留裙房外挑与 MiB 误差，树留树冠半径）。
 * 先过 AABB 早退，14 条路 × 逐楼候选也不会拖慢生成。 */
const ROAD_LANES = ROADS.map((r) => {
  const pts = toV2List(smoothPolyline(r.pts, 6));
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
  }
  return { hw: r.widthM / 2 / M_PER_U_H, pts, x0, x1, z0, z1 };
});
/** padM：额外的水平净空（米）。传 null 表示只查点本身。 */
function onRoad(x, z, padM = 0) {
  const pad = padM / M_PER_U_H;
  for (const o of ROAD_LANES) {
    if (x < o.x0 - pad || x > o.x1 + pad || z < o.z0 - pad || z > o.z1 + pad) continue;
    if (distToPolyline(x, z, o.pts) < o.hw + pad) return true;
  }
  return false;
}
/** 线段与轴对齐矩形是否相交（把线段按 slab 裁剪到矩形里） */
function segRectOverlap(ax, az, bx, bz, hw, hd) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, d, h] of [[ax, dx, hw], [az, dz, hd]]) {
    if (Math.abs(d) < 1e-9) { if (p < -h || p > h) return false; continue; }
    let u0 = (-h - p) / d, u1 = (h - p) / d;
    if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
    t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
    if (t0 > t1) return false;
  }
  return true;
}
/** 楼体占地（含裙房外挑）是否压到红线。
 *  只查四角会漏掉「路斜穿大楼、四角都在路外」这种情形 —— 新街口一带的 130 m 大盘
 *  就正好是这样，中心骑在中山路上而四角干干净净。这里按**线段-矩形相交**判：
 *  把每条路中心线折线变换到楼体局部系，矩形按路面半宽膨胀后做 slab 裁剪。 */
function footprintOnRoad(x, z, hw, hd, rot) {
  const c = Math.cos(-rot), s = Math.sin(-rot);
  for (const o of ROAD_LANES) {
    const reach = hw + hd;
    if (x + reach < o.x0 || x - reach > o.x1 || z + reach < o.z0 || z - reach > o.z1) continue;
    for (let i = 0; i < o.pts.length - 1; i++) {
      const a = o.pts[i], b = o.pts[i + 1];
      const ax = (a[0] - x) * c - (a[1] - z) * s, az = (a[0] - x) * s + (a[1] - z) * c;
      const bx = (b[0] - x) * c - (b[1] - z) * s, bz = (b[0] - x) * s + (b[1] - z) * c;
      if (segRectOverlap(ax, az, bx, bz, hw + o.hw, hd + o.hw)) return true;
    }
  }
  return false;
}

// 城墙开槽：WALL_CLEAR 为墙体两侧的净空（场景单位，1 单位 = 100 m）。
// 城垣沿线本就有护城河与保护带，楼群压在墙上既失真又必然穿模。
// 墙体断面等比 1:30 后外皮 ≈ vU(10.35)=0.345，此处保持「墙外皮 + 45m 真实净空」= 0.78。
const WALL_CLEAR = 0.78;
function blocked(x, z, exclusions, padM = 0) {
  if (distToPolyline(x, z, RIVER_PTS) < RIVER.halfWidth + 1.2) return true;
  if (distToPolyline(x, z, WALL_PTS) < WALL_CLEAR) return true;
  if (onRoad(x, z, padM)) return true;
  for (const p of LAKE_POLYS) if (pointInPolygon(x, z, p)) return true;
  if (terrainHeight(x, z) > 0.45) return true;
  for (const e of exclusions) {
    const dx = x - e[0], dz = z - e[1];
    if (dx * dx + dz * dz < e[2] * e[2]) return true;
  }
  return false;
}

/* ============ 风格材质 ============ */
// env：共享环境贴图（天空 IBL）的强度——玻璃幕墙要亮，老旧街区要弱，与 GTA_SZ 的逐材质 IBL 一致
const STYLES = {
  glass: { side: '#dde5ec', roof: '#4a5057', rough: 0.28, metal: 0.45, emissive: 1.25, env: 1.15 },
  concrete: { side: '#e3dfd7', roof: '#9a9994', rough: 0.92, metal: 0.03, emissive: 0.95, env: 0.62 },
  oldtown: { side: '#e8dfd1', roof: '#9e4630', rough: 0.95, metal: 0.0, emissive: 0.7, env: 0.5, brick: true },   // 老城南：照片砖纹（brickDiff+brickBump）
  industrial: { side: '#d0d2ce', roof: '#8d918e', rough: 0.9, metal: 0.12, emissive: 0.55, env: 0.68 },
  campus: { side: '#e5e2d9', roof: '#6c7a67', rough: 0.9, metal: 0.02, emissive: 1.0, env: 0.66 },
};
const TYPE_STYLE = {
  downtown: 'glass', modern: 'glass', residential: 'concrete',
  oldtown: 'oldtown', industrial: 'industrial', campus: 'campus',
};

/** 逐实例 UV 重映射：同一张立面/窗光贴图，按楼体宽高与随机偏移取不同区域；
 *  法线/粗糙度/凹凸贴图按额外倍率 texK 加密（照片纹理的物理尺寸 ≠ 窗格尺寸） */
function patchUV(m, texK = 1) {
  patchMaterial(m, 'aUv', (shader) => {
    shader.vertexShader = 'attribute vec4 aUv;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = vMapUv * aUv.zw + aUv.xy;
      #endif
      #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv = vEmissiveMapUv * aUv.zw + aUv.xy;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv = vNormalMapUv * aUv.zw * ${texK.toFixed(2)} + aUv.xy;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = vRoughnessMapUv * aUv.zw * ${texK.toFixed(2)} + aUv.xy;
      #endif
      #ifdef USE_BUMPMAP
        vBumpMapUv = vBumpMapUv * aUv.zw + aUv.xy;
      #endif`
    );
  });
  return m;
}

/* ============ 片区路网（供道路渲染与车流使用） ============ */
export function districtGridLines() {
  const lines = [];
  for (const d of DISTRICTS) {
    const [cx, cz] = toV2(d.lon, d.lat);
    const rot = (d.rot * Math.PI) / 180;
    const W = d.w * 10, D = d.d * 10, cell = d.cell;
    const nx = Math.max(1, Math.round(W / cell)), nz = Math.max(1, Math.round(D / cell));
    const c = Math.cos(rot), s = Math.sin(rot);
    const toWorld = (lx, lz) => [cx + lx * c - lz * s, cz + lx * s + lz * c];
    for (let i = 0; i <= nx; i++) {
      const lx = -W / 2 + i * cell;
      // grid: true —— 片区格网街是「楼间留缝」的示意线,不铺装(buildRoads 跳过渲染),
      // 只作为车行 centerline 与楼块布局依据;铺成沥青带会把整城地面盖白。
      lines.push({ name: d.name, w: 0.22, grid: true, pts: [toWorld(lx, -D / 2), toWorld(lx, D / 2)] });
    }
    for (let j = 0; j <= nz; j++) {
      const lz = -D / 2 + j * cell;
      lines.push({ name: d.name, w: 0.22, grid: true, pts: [toWorld(-W / 2, lz), toWorld(W / 2, lz)] });
    }
  }
  return lines;
}

/* ============ 建筑 ============ */
export function buildCity({ exclusions = [], seed = 20261001 } = {}) {
  const rand = makeRandom(seed);
  const facade = makeFacadeTexture();
  const windowsTex = makeWindowTexture();
  const roofTex = makeRoofTexture();

  // 照片级 CC0 贴图（Poly Haven，见 docs/ATTRIBUTION）；node 下 loadTexture 返回 null，全部判空回退程序化
  const brickDiff = loadTexture('./assets/textures/brick_diffuse.jpg');
  const brickBump = loadTexture('./assets/textures/brick_bump.jpg', { srgb: false });
  const concDiff = loadTexture('./assets/textures/rough_concrete_diff_2k.jpg');   // 预留：立面底色仍走程序窗格
  const concNor = loadTexture('./assets/textures/rough_concrete_nor_gl_2k.jpg', { srgb: false });
  const concRough = loadTexture('./assets/textures/rough_concrete_rough_2k.jpg', { srgb: false });

  const group = new THREE.Group();
  group.name = 'city';

  const buckets = {};   // style -> { items, podium, setback }
  const details = { cap: [], antenna: [], parapet: [], tank: [], ac: [], shop: [], crown: [] };
  const mats = { wall: [], roof: [], misc: [] };
  let shopMatRef = null;   // 商铺基座材质：setNight 点亮 storefront 灯带

  /** 局部坐标（相对建筑中心，含旋转）→ 世界坐标（GTA-WH 手法照抄） */
  const local = (x, z, lx, lz, rot) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [x + lx * c - lz * s, z + lx * s + lz * c];
  };

  for (const d of DISTRICTS) {
    const style = TYPE_STYLE[d.type] || 'concrete';
    const bucket = (buckets[style] = buckets[style] || { items: [], podium: [], setback: [] });
    const [cx, cz] = toV2(d.lon, d.lat);
    const rot = (d.rot * Math.PI) / 180;
    const W = d.w * 10, D = d.d * 10, cell = d.cell;
    const nx = Math.max(1, Math.round(W / cell)), nz = Math.max(1, Math.round(D / cell));
    const c = Math.cos(rot), s = Math.sin(rot);
    const [hMin, hMax] = d.hm;
    const maxR = Math.hypot(W, D) / 2;

    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (rand() > d.density) continue;
        const lx = -W / 2 + (i + 0.5) * cell + (rand() - 0.5) * cell * 0.18;
        const lz = -D / 2 + (j + 0.5) * cell + (rand() - 0.5) * cell * 0.18;
        const x = cx + lx * c - lz * s;
        const z = cz + lx * s + lz * c;
        const fw = cell * (0.52 + rand() * 0.34);
        const fd = cell * (0.52 + rand() * 0.34);
        const yRot = rot + (rand() - 0.5) * 0.12;
        // 楼体（含最高 1.44× 的裙房）四角都不能压到路面，否则就成“楼从马路里长出来”
        if (blocked(x, z, exclusions) || footprintOnRoad(x, z, fw * 0.72, fd * 0.72, yRot)) continue;

        const r = Math.hypot(lx, lz) / maxR;
        const core = Math.pow(clamp(1 - r * 0.95, 0, 1), d.type === 'oldtown' ? 2.2 : 1.35);
        const tall = Math.pow(rand(), d.type === 'downtown' ? 1.7 : 2.4);
        let hMeters = hMin + (hMax - hMin) * (0.25 + 0.75 * tall) * (0.55 + 0.45 * core);
        if (d.type === 'industrial') hMeters = hMin + (hMax - hMin) * rand();
        if (d.type === 'campus') hMeters = hMin + (hMax - hMin) * Math.pow(rand(), 2.0);
        const h = Math.max(0.35, mY(hMeters));

        /* ---- 体量分层（GTA_SZ 的 podium / setback 做法）：塔楼不再是一根方柱 ---- */
        let hShaft = h;
        let ow = fw, od = fd;                      // 外轮廓（供 AO 烘焙的遮挡 footprint）

        // 裙房：贴地向外扩一圈的低体量，街道视角下给塔楼一个“底座”
        if (hMeters > 85 && rand() > 0.26) {
          const ph = Math.min(h * 0.32, mY(16 + rand() * 18));
          const pw = fw * (1.22 + rand() * 0.22), pd = fd * (1.22 + rand() * 0.22);
          bucket.podium.push({ x, z, y: 0, w: pw, h: ph, d: pd, rot: yRot, r2: rand(), r3: rand() });
          ow = pw; od = pd;
        }
        // 退台：上部收进一截，形成阶梯状轮廓
        if (hMeters > 150 && rand() > 0.32) {
          const sh = h * (0.16 + rand() * 0.24);
          hShaft = h - sh;
          bucket.setback.push({
            x, z, y: hShaft, h: sh,
            w: fw * (0.60 + rand() * 0.22), d: fd * (0.60 + rand() * 0.22),
            rot: yRot, r2: rand(), r3: rand(),
          });
        }

        bucket.items.push({
          x, z, y: 0, w: fw, h: hShaft, d: fd, rot: yRot,
          r2: rand(), r3: rand(), shade: 0.86 + rand() * 0.28, tint: d.tint,
          full: h, ow, od,
        });

        // 屋顶设备 / 天线
        if (h > 2.2 && rand() > 0.45) {
          details.cap.push({ x, z, y: h, w: fw * (0.3 + rand() * 0.3), h: 0.28 + rand() * 0.4, d: fd * 0.5, rot: yRot });
        }
        if (h > 7 && rand() > 0.55) {
          details.antenna.push({ x, z, y: h, h: 0.9 + rand() * 2.2 });
        }

        /* ---- 立面与屋顶细节件（治“方块感”：女儿墙/水箱/空调外机/商铺基座/楼冠，GTA-WH 手法按 hU/vU 换算） ----
         * 阈值一律用米制判断；水平尺寸走 hU（1 单位=100 m），竖向走 vU（1 单位=30 m）。
         * 基准面跟本文件现有先例：水箱/楼冠与屋顶设备同挂 h（含退台时为退台顶），
         * 女儿墙环 hShaft（主楼体顶面；有退台时正好环住退台塔身）。 */
        // 女儿墙：顶面四边矮墙（厚 0.4 m、高 0.9 m）
        if (hShaft > vU(15)) {
          const pw = vU(0.9);
          const pt = hU(0.4), pin = hU(0.2);
          for (const [ex, ez, rw, rd] of [
            [0, -(fd / 2 - pin), fw, pt], [0, fd / 2 - pin, fw, pt],
            [-(fw / 2 - pin), 0, pt, fd], [fw / 2 - pin, 0, pt, fd],
          ]) {
            const [px, pz] = local(x, z, ex, ez, yRot);
            details.parapet.push({ x: px, z: pz, y: hShaft, w: rw, h: pw, d: rd, rot: yRot, tint: '#ffffff', shade: 0.92 });
          }
        }
        // 屋顶水箱/电梯机房（62% 概率；tw 直接用 fw/fd 场景单位比例）
        if (rand() < 0.62) {
          const [tx, tz] = local(x, z, (rand() - 0.5) * fw * 0.4, (rand() - 0.5) * fd * 0.4, yRot);
          const tw = Math.min(fw, fd) * (0.2 + rand() * 0.14);
          details.tank.push({ x: tx, z: tz, y: h, w: tw, h: vU(2.0) + rand() * vU(1.8), d: tw * 0.85, rot: yRot + (rand() - 0.5) * 0.3 });
        }
        // 空调外机：立面悬挂（60 m 以下低层建筑为主；立面宽 >8 m 才摆得开）
        if (hShaft < vU(60) && fw > hU(8)) {
          const n = 2 + Math.floor(rand() * 4);
          for (let k = 0; k < n; k++) {
            const side = Math.floor(rand() * 4);
            const hy = vU(3) + rand() * Math.max(0, hShaft - vU(5));   // 挂高 3 m 起，留出人视高度
            const lx = side < 2 ? 0 : (side === 2 ? fw / 2 + hU(0.3) : -fw / 2 - hU(0.3));
            const lz = side === 0 ? fd / 2 + hU(0.3) : side === 1 ? -fd / 2 - hU(0.3) : (rand() - 0.5) * fd * 0.7;
            const lxx = side < 2 ? (rand() - 0.5) * fw * 0.7 : lx;
            const [ax, az] = local(x, z, lxx, lz, yRot);
            details.ac.push({ x: ax, z: az, y: hy, w: hU(1.15), h: vU(0.8), d: hU(0.5), rot: yRot + (side >= 2 ? Math.PI / 2 : 0) });
          }
        }
        // 商铺基座：临街底层深色 storefront 带（高 min(4.4, 楼高×0.24) m，外扩 0.3 m一圈）
        if (hShaft > vU(18)) {
          const sh = vU(Math.min(4.4, hShaft * M_PER_U_V * 0.24));    // hShaft×30 折回米制再取比例
          details.shop.push({ x, z, y: 0, w: fw + hU(0.6), h: sh, d: fd + hU(0.6), rot: yRot, tint: '#3a3f46', shade: 1 });
        }
        // 楼冠：高层顶部收分冠部（>60 m 且 35% 概率）
        if (hMeters > 60 && rand() < 0.35) {
          details.crown.push({ x, z, y: h, w: fw * 0.72, h: vU(2.6) + rand() * vU(3.2), d: fd * 0.72, rot: yRot });
        }
      }
    }
  }

  // 构建 InstancedMesh
  const meshes = [];
  for (const [styleKey, bucket] of Object.entries(buckets)) {
    const st = STYLES[styleKey];
    if (!bucket.items.length) continue;
    // 贴图策略（GTA-WH 手法）：老城砖构用照片砖纹（diffuse+bump）；混凝土系挂程序窗格 + 照片混凝土法线/粗糙度；
    // 玻璃幕墙保持纯程序化——幕墙不吃混凝土颗粒
    let extra = {};
    if (st.brick && brickDiff) {
      extra = brickBump ? { bumpMap: brickBump, bumpScale: 0.35 } : {};
    } else if (styleKey !== 'glass' && concNor) {
      extra = { normalMap: concNor, ...(concRough ? { roughnessMap: concRough } : {}), normalScale: new THREE.Vector2(0.55, 0.55) };
    }
    const sideMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(st.side),
      map: st.brick && brickDiff ? brickDiff : facade,
      emissiveMap: windowsTex,
      emissive: new THREE.Color('#ffc98a'),
      emissiveIntensity: 0,
      roughness: st.rough,
      metalness: st.metal,
      ...extra,
    });
    patchUV(sideMat, st.brick ? 1 : 3.5);
    registerEnv(sideMat, st.env);
    const roofMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(st.roof), map: roofTex, roughness: 0.95, metalness: 0.05,
      ...(concNor && !st.brick ? { normalMap: concNor, normalScale: new THREE.Vector2(0.3, 0.3) } : {}),
    });
    patchUV(roofMat, 3.5);
    registerEnv(roofMat, st.env * 0.55);
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a5f63'), roughness: 1 });
    registerEnv(darkMat, st.env * 0.5);
    // 六个面各一套：侧墙 / 侧墙 / 屋顶 / 底面 / 侧墙 / 侧墙
    const materials = [sideMat, sideMat, roofMat, darkMat, sideMat, sideMat];
    mats.wall.push(sideMat);
    mats.roof.push(roofMat);
    mats.misc.push(darkMat);

    // 砖构照片贴图按真实尺度平铺：一格 2.6 m（水平 hU / 竖向 vU 分别换算）；其余风格维持程序窗格默认口径
    const uvOpts = st.brick ? { uvU: hU(2.6), uvV: vU(2.6) } : {};
    const mesh = instancedBoxes(bucket.items, materials, uvOpts);
    mesh.name = 'buildings:' + styleKey;
    group.add(mesh);
    bucket.mesh = mesh;
    bucket.sideMat = sideMat;
    bucket.roofMat = roofMat;
    bucket.style = st;
    bucket.detailList = [];
    meshes.push(mesh);

    // 裙房与退台复用同一套六面材质，屋顶/底面自动正确
    if (bucket.podium.length) {
      const m = instancedBoxes(bucket.podium, materials, uvOpts);
      m.name = 'podium:' + styleKey;
      group.add(m);
      bucket.detailList.push({ mesh: m, items: bucket.podium });
      meshes.push(m);
    }
    if (bucket.setback.length) {
      const m = instancedBoxes(bucket.setback, materials, uvOpts);
      m.name = 'setback:' + styleKey;
      group.add(m);
      bucket.detailList.push({ mesh: m, items: bucket.setback });
      meshes.push(m);
    }
  }

  // 屋顶设备
  if (details.cap.length) {
    const capMat = new THREE.MeshStandardMaterial({ color: 0x8d9095, roughness: 0.9 });
    registerEnv(capMat, 0.6);
    const m = instancedBoxes(details.cap, capMat);
    m.name = 'rooftopCaps';
    m.receiveShadow = true;
    group.add(m);
    meshes.push(m);
    mats.misc.push(capMat);
  }
  if (details.antenna.length) {
    const antMat = new THREE.MeshStandardMaterial({ color: 0x7b8288, roughness: 0.6, metalness: 0.4 });
    registerEnv(antMat, 0.9);
    const geo = new THREE.CylinderGeometry(0.04, 0.06, 1, 6).translate(0, 0.5, 0);
    const m = new THREE.InstancedMesh(geo, antMat, details.antenna.length);
    m.frustumCulled = false;
    const dummy = new THREE.Object3D();
    details.antenna.forEach((a, i) => {
      dummy.position.set(a.x, a.y, a.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, a.h, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.name = 'antennas';
    group.add(m);
    meshes.push(m);
    mats.misc.push(antMat);
  }
  // 女儿墙（浅色混凝土，同楼体色系）
  if (details.parapet.length) {
    const pm = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.9 });
    registerEnv(pm, 0.5);
    const m = instancedBoxes(details.parapet, pm, { uvU: hU(8), uvV: vU(1) });
    m.name = 'parapets';
    group.add(m); meshes.push(m);
    mats.misc.push(pm);
  }
  // 屋顶水箱/机房（银灰金属）
  if (details.tank.length) {
    const tm = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.55, metalness: 0.45 });
    registerEnv(tm, 0.8);
    const m = instancedBoxes(details.tank, tm, { uvU: hU(4), uvV: vU(3) });
    m.name = 'tanks';
    group.add(m); meshes.push(m);
    mats.misc.push(tm);
  }
  // 空调外机（米白塑料壳；不投影——按需刷新的阴影体系下，动效全无的小件不值得占阴影 pass）
  if (details.ac.length) {
    const am = new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.65 });
    registerEnv(am, 0.5);
    const m = instancedBoxes(details.ac, am, { cast: false, uvU: hU(1.2), uvV: vU(0.8) });
    m.name = 'acUnits';
    group.add(m); meshes.push(m);
    mats.misc.push(am);
  }
  // 商铺基座（深色 storefront，夜间亮一条）
  if (details.shop.length) {
    const sm = new THREE.MeshStandardMaterial({
      color: 0x2e3238, roughness: 0.6,
      emissive: new THREE.Color('#ffb85e'), emissiveIntensity: 0,
    });
    sm.userData.shopGlow = true;
    registerEnv(sm, 0.7);
    const m = instancedBoxes(details.shop, sm, { uvU: hU(12), uvV: vU(4) });
    m.name = 'shopBases';
    group.add(m); meshes.push(m);
    mats.misc.push(sm);
    shopMatRef = sm;
  }
  // 楼冠（高层顶部收分冠部）
  if (details.crown.length) {
    const cm = new THREE.MeshStandardMaterial({ color: 0xa9b0b6, roughness: 0.5, metalness: 0.35 });
    registerEnv(cm, 0.9);
    const m = instancedBoxes(details.crown, cm, { uvU: hU(10), uvV: vU(4) });
    m.name = 'crowns';
    group.add(m); meshes.push(m);
    mats.misc.push(cm);
  }

  /* ---- 生长动画 ---- */
  const allBuckets = Object.values(buckets).filter((b) => b.mesh);
  const dummy = new THREE.Object3D();
  function growMesh(mesh, items, p) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const delay = clamp(0.55 - Math.hypot(it.x, it.z) / 420, 0, 0.55);
      const local = clamp((p * 1.5 - delay) / 0.45, 0, 1);
      const e = local < 1 ? 1 - Math.pow(1 - local, 3) : 1;
      dummy.position.set(it.x, (it.y || 0) * e, it.z);
      dummy.rotation.set(0, it.rot || 0, 0);
      dummy.scale.set(it.w, Math.max(0.02, it.h * e), it.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  function setGrowth(p) {
    for (const b of allBuckets) {
      growMesh(b.mesh, b.items, p);
      for (const d of b.detailList) growMesh(d.mesh, d.items, p);
    }
  }
  setGrowth(0);

  /* ---- 夜间灯光 ---- */
  function setNight(k) {
    for (const b of allBuckets) b.sideMat.emissiveIntensity = k * b.style.emissive;
    if (shopMatRef) shopMatRef.emissiveIntensity = k * 1.8;   // 底层商铺灯带
  }

  return {
    group, meshes, buckets: allBuckets, mats,
    setGrowth, setNight,
    count: allBuckets.reduce((s, b) => s + b.items.length, 0),
  };
}

/* ============ 行道树 / 绿地 ============ */
export function buildTrees({ exclusions = [], seed = 4242 } = {}) {
  const rand = makeRandom(seed);
  const group = new THREE.Group();
  group.name = 'trees';

  const items = [];
  for (const p of PARKS) {
    const [cx, cz] = toV2(p.lon, p.lat);
    const rx = p.rx * 10, rz = p.rz * 10;
    for (let i = 0; i < p.count * 2 && items.length < p.count + items.length; i++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand());
      const x = cx + Math.cos(a) * rx * rr;
      const z = cz + Math.sin(a) * rz * rr;
      // padM=8：树冠离红线留 8 m，树根踩进沥青会露白、也压到人行道铺装
      if (blocked(x, z, exclusions, 8)) continue;
      items.push({ x, z, y: terrainHeight(x, z), t: rand(), s: 0.55 + rand() * 0.85, c: rand() });
      if (items.length >= p.count) break;
    }
  }

  const n = items.length;
  const trunkGeo = new THREE.CylinderGeometry(0.055, 0.085, 1, 6).translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b5340, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true, vertexColors: false });
  registerEnv(trunkMat, 0.3);
  registerEnv(crownMat, 0.42);          // 树冠只需要一点点天空补光，太多会发灰
  const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const crown = new THREE.InstancedMesh(crownGeo, crownMat, n);
  trunk.frustumCulled = false; crown.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const greens = ['#4b7a3c', '#568a41', '#3d6b34', '#6d9445', '#456f38'];
  items.forEach((it, i) => {
    const h = 0.9 * it.s;
    dummy.position.set(it.x, it.y, it.z);
    dummy.rotation.set(0, it.t * 6.28, 0);
    dummy.scale.set(it.s, h, it.s);
    dummy.updateMatrix();
    trunk.setMatrixAt(i, dummy.matrix);

    const cr = 0.62 + it.c * 0.5;
    dummy.position.set(it.x, it.y + h * 0.92, it.z);
    dummy.rotation.set(it.t, it.t * 3.3, it.t * 2.1);
    dummy.scale.set(cr * it.s, cr * it.s * (0.85 + it.c * 0.4), cr * it.s);
    dummy.updateMatrix();
    crown.setMatrixAt(i, dummy.matrix);
    col.set(greens[(it.c * greens.length) | 0]).multiplyScalar(0.85 + it.t * 0.3);
    crown.setColorAt(i, col);
  });
  trunk.instanceMatrix.needsUpdate = true;
  crown.instanceMatrix.needsUpdate = true;
  if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
  trunk.castShadow = crown.castShadow = true;
  group.add(trunk, crown);
  return { group, count: n, mats: [trunkMat, crownMat] };
}

/* ============ 路灯（主干道双侧交错布设，夜间点亮） ============ */
export function buildStreetLights(centerlines, surfaceAt, seed = 777) {
  const group = new THREE.Group();
  group.name = 'streetlights';
  const poles = [], heads = [];
  for (const l of centerlines) {
    if (l.gate || l.w < 0.35) continue;   // 城门引桥段穿墙走，不布灯；次干道窄路也不布
    const pts = l.pts;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const d = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(d / hU(48));            // 48 m 一盏
      if (!n) continue;
      const dx = (bx - ax) / d, dz = (bz - az) / d;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const side = ((i + k) % 2 === 0) ? 1 : -1;   // 双侧交错
        // 路侧偏移必须 ≥ 0.33（w=0.4 时正好 0.33）：再往里就是 0.165~0.275 的车流车道带，同侧车会持续穿灯杆
        const off = (l.w / 2 + 0.13) * side;
        const x = ax + (bx - ax) * t - dz * off;
        const z = az + (bz - az) * t + dx * off;
        // 水域跳过：主江道 + 夹江支流——绕城/江北大道跨江段的灯杆不能立进水里
        if (distToPolyline(x, z, RIVER_PTS) < RIVER.halfWidth + 0.5) continue;
        let wet = false;
        for (const b of RIVER_BRANCHES) {
          if (distToPolyline(x, z, b.pts) < b.hw + 0.3) { wet = true; break; }
        }
        if (wet) continue;
        const gy = surfaceAt ? surfaceAt(x, z) : 0.06;
        // 杆截面 0.010 = 1 m（真实 0.22 m 换算成水平单位仅 0.0022，全城视距下不可见，
        // 这里只做 4.5× 的可见性补偿；主干道红线 40 m 的尺度下它才是该有的那根杆子）。
        poles.push({ x, z, y: gy, w: 0.010, h: vU(9.5), d: 0.010 });
        // 灯头向路心回偏 12%·off 当悬臂（WH 原版手法）
        heads.push({
          x: x + dz * off * 0.12, z: z - dx * off * 0.12, y: gy + vU(9.3),
          w: 0.036, h: 0.016, d: 0.026, rot: Math.atan2(dx, dz),
        });
      }
    }
  }
  const poleMat = mat('#4d5256', { rough: 0.7, metal: 0.3 });
  const poleMesh = instancedBoxes(poles, poleMat, { cast: false, receive: false, uvU: 2, uvV: 6 });
  if (poleMesh) group.add(poleMesh);

  // 灯头会随昼夜动画改 emissiveIntensity，禁走 mat() 共享缓存
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffdf9e, emissiveIntensity: 0.05, roughness: 0.4 });
  registerEnv(headMat, 0.5);
  const headMesh = instancedBoxes(heads, headMat, { cast: false, receive: false, uvU: 2, uvV: 6 });
  if (headMesh) group.add(headMesh);

  return {
    group, count: poles.length,
    setNight(k) { headMat.emissiveIntensity = 0.05 + k * 3.4; },
    mats: [poleMat],
  };
}

/* ============ 车流（Kenney CC0 车模实例化；node / 缺资源时回退方块车流） ============
 * v2 车流智能（不引库）：同车道 IDM-lite 跟车（消灭穿插）+ 红绿灯停车线（相位真值在 signals.js，
 * 与 props.js 灯珠共用）。车道 = (线路, 行进方向)：lane 偏移与 dir 绑定成右侧通行。 */
export async function buildCars(centerlines, count = 110, seed = 999) {
  const rand = makeRandom(seed);
  const lines = centerlines.filter((l) => l.w > 0.35);   // 主干道（单位与路宽同口径）
  const group = new THREE.Group();
  group.name = 'cars';
  if (!lines.length) return { group, update: () => {}, setNight: () => {} };

  // IDM-lite 参数（场景单位）：车长 0.26 / 最小车距 0.12 / 头时距 1 s / 舒适加减速。
  // 期望车速用世界单位固定档（0.05-0.13 u/s ≈ 2-5 个车长/秒）——v1 按线长换算会让
  // 长线车快到 1.5 u/s，刹车距离 6 u 远超红前瞻窗，等于全线闯红灯。
  const CAR_LEN = 0.26, S_MIN = 0.12, T_HEAD = 1.0, A_MAX = 0.09, B_MAX = 0.18;
  const SQAB = Math.sqrt(A_MAX * B_MAX);
  const pickV0 = () => 0.05 + rand() * 0.08;
  const mod = (a, n) => ((a % n) + n) % n;
  /** IDM 加速度：gap 到前车（或停车线这类 vObs=0 的虚拟障碍） */
  const idm = (v, v0, gap, vObs) => {
    const sStar = S_MIN + Math.max(0, v * T_HEAD + (v - vObs) * v / (2 * SQAB));
    return A_MAX * (1 - Math.pow(v / v0, 4)) - A_MAX * Math.pow(sStar / Math.max(gap, 0.02), 2);
  };

  // 车模装载：assets.js 必须函数内动态 import（其内部含 three/addons bare specifier，node 顶层解析会炸 smoke）
  let loadMergedGLB = null;
  try { ({ loadMergedGLB } = await import('./assets.js')); } catch { /* node / 缺文件：走方块回退 */ }
  const MODELS = ['./assets/cars/sedan.glb', './assets/cars/taxi.glb', './assets/cars/suv.glb',
    './assets/cars/van.glb', './assets/cars/police.glb', './assets/cars/hatchback-sports.glb'];
  const models = [];
  for (const u of MODELS) {
    let m = null;
    try { m = loadMergedGLB ? await loadMergedGLB(u) : null; } catch { m = null; }
    if (!m) continue;
    // 归一化：目标车长 0.23 场景单位（对齐 0.24 方块车与 ferrari 演示的视觉口径）；
    // 竖直居中烘焙——NJ 车流中心线在 y=0.22，车身几何中心对齐它（不是 WH 的贴地 offY）
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    const len = Math.max(bb.max.z - bb.min.z, bb.max.x - bb.min.x, 0.01);
    const s = 0.23 / len;
    models.push({ geometry: m.geometry, material: m.material, s, offY: -(bb.min.y + bb.max.y) / 2 * s });
  }

  // 预计算折线累积长度
  const meta = lines.map((l) => {
    const lens = [];
    let total = 0;
    const pts = l.pts.length > 2 ? l.pts : resampleLine(l.pts, 3);
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(d); total += d;
    }
    return { pts, lens, total };
  });

  const dummy = new THREE.Object3D();
  const cars = [];
  let meshes = [];        // 车身 InstancedMesh（方块 1 个，或每车型 1 个）
  let carMatRef = null;   // 方块回退分支的整车材质（GLB 分支为 null，mats 相应为空）

  // 头/尾灯带：与车身同款中心盒几何（lib 的 UNIT.box 是底对齐，混用会把灯装到车顶线上）
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffedb0, emissiveIntensity: 0.05 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x7a1410, emissive: 0xc01808, emissiveIntensity: 0.05 });
  registerEnv(headMat, 0.4);
  registerEnv(tailMat, 0.4);
  const headMesh = new THREE.InstancedMesh(geo, headMat, count);
  const tailMesh = new THREE.InstancedMesh(geo, tailMat, count);
  headMesh.frustumCulled = tailMesh.frustumCulled = false;
  headMesh.castShadow = tailMesh.castShadow = false;   // 阴影按需刷新，动体影子会冻住

  if (models.length) {
    // 每车型一个 InstancedMesh，车辆轮流分配；容量按均分上取整，用后裁到实际数
    const perModel = Math.ceil(count / models.length);
    meshes = models.map((m) => {
      const im = new THREE.InstancedMesh(m.geometry, m.material, perModel);
      im.frustumCulled = false;
      im.castShadow = false;   // NJ 阴影按需刷新：动体禁投影（车流先例）
      im.userData = { s: m.s, offY: m.offY, used: 0 };
      group.add(im);
      return im;
    });
    for (let i = 0; i < count; i++) {
      const li = (rand() * lines.length) | 0;
      const im = meshes[i % models.length];
      const dir = rand() > 0.5 ? 1 : -1;                       // 行进方向 = 车道（右侧通行）
      cars.push({ li, dir, s: rand() * meta[li].total, v: 0, v0: pickV0(), lane: dir * 0.22, y: 0.22, mesh: im, idx: im.userData.used++ });
    }
    for (const im of meshes) im.count = im.userData.used;
  } else {
    // 回退：方块车流（node / 资源缺失，保持原行为）
    const carMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.35 });
    registerEnv(carMat, 1.25);            // 车漆靠环境反射出“湿润感”
    carMatRef = carMat;
    const mesh = new THREE.InstancedMesh(geo, carMat, count);
    mesh.frustumCulled = false;
    meshes = [mesh];
    group.add(mesh);
    const palette = ['#d8dde3', '#3b4250', '#8d3a33', '#2f5b8b', '#c9a227', '#37474f', '#6b7280'];
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const li = (rand() * lines.length) | 0;
      const dir = rand() > 0.5 ? 1 : -1;
      cars.push({ li, dir, s: rand() * meta[li].total, v: 0, v0: pickV0(), lane: dir * 0.22, y: 0.22, mesh, idx: i, box: true });
      col.set(palette[(rand() * palette.length) | 0]);
      mesh.setColorAt(i, col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  group.add(headMesh, tailMesh);

  function sample(m, t, offset) {
    let target = ((t % 1) + 1) % 1 * m.total;
    for (let i = 0; i < m.lens.length; i++) {
      if (target <= m.lens[i] || i === m.lens.length - 1) {
        const f = m.lens[i] ? Math.min(1, target / m.lens[i]) : 0;
        const ax = m.pts[i][0], az = m.pts[i][1], bx = m.pts[i + 1][0], bz = m.pts[i + 1][1];
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz) || 1;
        const x = ax + dx * f, z = az + dz * f;
        return [x + (-dz / len) * offset, z + (dx / len) * offset, Math.atan2(dx, dz)];
      }
      target -= m.lens[i];
    }
    return [0, 0, 0];
  }

  /* ---- 信号灯停车线注入（main.js 在 props 构建后调用；不调用则纯跟车无红绿灯） ----
   * 把每个路口中心投影到每条车行线：垂距 < 本路半宽 + 0.25 视为「本线穿过该口」，
   * 按切向与 A/B 轴夹角判定本线是路口的哪条路，横向路口的半宽决定停车线退距。 */
  let signalStops = lines.map(() => []);   // setSignals 未注入（node/smoke）时保持纯跟车
  let clock = 0;   // 相位时钟：与 props.js 灯珠各自累计，相位偏移本身随机、起点差几帧无感
  function setSignals(junctions = []) {
    signalStops = lines.map(() => []);
    for (const j of junctions) {
      for (let li = 0; li < lines.length; li++) {
        const m = meta[li];
        let acc = 0, best = null;
        for (let i = 0; i < m.pts.length - 1; i++) {
          const [ax, az] = m.pts[i], [bx, bz] = m.pts[i + 1];
          const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
          if (!L2) { acc += m.lens[i]; continue; }
          const f = ((j.x - ax) * dx + (j.z - az) * dz) / L2;
          if (f < 0 || f > 1) { acc += m.lens[i]; continue; }
          const px = ax + dx * f, pz = az + dz * f;
          const d = Math.hypot(j.x - px, j.z - pz);
          if (d > lines[li].w / 2 + 0.25) { acc += m.lens[i]; continue; }
          if (best && d >= best.d) { acc += m.lens[i]; continue; }
          const ux = dx / Math.sqrt(L2), uz = dz / Math.sqrt(L2);
          const axis = Math.abs(ux * j.dAx + uz * j.dAz) >= Math.abs(ux * j.dBx + uz * j.dBz) ? 'a' : 'b';
          best = { d, s: acc + Math.sqrt(L2) * f, axis, j, crossHalf: (axis === 'a' ? j.wB : j.wA) / 2 };
          acc += m.lens[i];
        }
        if (best) signalStops[li].push(best);
      }
    }
    for (const a of signalStops) a.sort((p, q) => p.s - q.s);
  }

  function update(dt, visible = true) {
    clock += dt;   // 相位钟无条件推进：图层隐藏只冻物理不冻相位——否则关开车流图层会让
    if (!visible) return;   // 车/灯珠/行人三钟永久漂移（绿珠车停/红珠车走，行人放行窗口也随之失配）
    // 车道分组（li × dir）+ 按弧长排序：前车即序列下一辆（环形跨界缝也成立）
    const groups = new Map();
    for (const c of cars) {
      const k = c.li * 2 + (c.dir > 0 ? 0 : 1);
      const g = groups.get(k);
      if (g) g.push(c); else groups.set(k, [c]);
    }
    for (const g of groups.values()) {
      g.sort((p, q) => p.s - q.s);
      const m = meta[g[0].li], total = m.total, stops = signalStops[g[0].li];
      for (let i = 0; i < g.length; i++) {
        const c = g[i];
        // 跟车：同车道前车。dir=-1 沿弧长递减行驶，前方是排序中的上一个元素——
        // 取反会让每辆反向车给身后的车刹车，整车道连环锁死（死锁就是这么来的）
        let acc = A_MAX * (1 - Math.pow(c.v / c.v0, 4));
        if (g.length > 1) {
          const lead = g[c.dir > 0 ? (i + 1) % g.length : (i + g.length - 1) % g.length];
          const gap = mod((lead.s - c.s) * c.dir, total) - CAR_LEN;
          acc = idm(c.v, c.v0, gap, lead.v);
        }
        // 红灯：把停车线当作 vObs=0 的虚拟前车，取更保守的一条。
        // 前瞻窗 = 当前车速的刹车距离 + 头时距行程 + 余量（车速被封顶后 ≈0.9 u，写死会漏快车）。
        // 停车线在口心前 crossHalf+0.15：IDM 静止车头停在 crossHalf+0.155，让清行人过街线
        // （人行道带 crossHalf+0.09~0.12 + 推挤 0.01）——0.04 会让整条过街带正压在排队头车车体上
        if (stops.length) {
          const see = Math.max(0.9, (c.v * c.v) / (2 * B_MAX) + c.v * T_HEAD + 0.2);
          for (const st of stops) {
            const dist = mod((st.s - c.s) * c.dir, total) - (st.crossHalf + 0.15);
            if (dist < 0 || dist > see) continue;            // 已过线 / 远超刹车视距不干预
            const ph = phaseFor(st.j, clock)[st.axis];
            if (ph === 'green') continue;
            acc = Math.min(acc, idm(c.v, c.v0, dist, 0));
          }
        }
        c.v = Math.max(0, Math.min(c.v + acc * dt, c.v0 * 1.25));
        c.s = mod(c.s + c.dir * c.v * dt, total);
      }
    }
    // 矩阵写入（与 v1 相同的摆放逻辑，t 改由弧长换算）
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const m = meta[c.li];
      const [x, z, ang] = sample(m, c.s / m.total, c.lane);
      if (c.box) {
        dummy.position.set(x, c.y, z);
        dummy.scale.set(0.11, 0.09, 0.24);
      } else {
        const ud = c.mesh.userData;
        dummy.position.set(x, c.y + ud.offY, z);   // 车身中心烘焙到车流中心线 y=0.22
        dummy.scale.setScalar(ud.s);
      }
      dummy.rotation.set(0, ang, 0);
      dummy.updateMatrix();
      c.mesh.setMatrixAt(c.idx, dummy.matrix);
      // 头/尾灯带沿车轴前后各 0.125（车头方向 ang 的单位向量是 sin/cos）
      const fx = Math.sin(ang), fz = Math.cos(ang);
      dummy.position.set(x + fx * 0.125, c.y + 0.012, z + fz * 0.125);
      dummy.scale.set(0.08, 0.025, 0.012);
      dummy.updateMatrix();
      headMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x - fx * 0.125, c.y + 0.012, z - fz * 0.125);
      dummy.updateMatrix();
      tailMesh.setMatrixAt(i, dummy.matrix);
    }
    for (const im of meshes) im.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    tailMesh.instanceMatrix.needsUpdate = true;
  }

  function setNight(k) {
    if (carMatRef) {
      carMatRef.emissive = new THREE.Color(0xffd9a0);
      carMatRef.emissiveIntensity = k * 0.35;   // 整车微光下调，让位给头尾灯带
    }
    headMat.emissiveIntensity = 0.05 + k * 3.2;   // GLB 分支下车灯仍由灯带承担
    tailMat.emissiveIntensity = 0.05 + k * 2.4;
  }

  update(0);   // 构造即写好全部矩阵缓冲，避免首帧残留单位矩阵
  return {
    group, update, setNight, setSignals, count, mats: carMatRef ? [carMatRef] : [],
    /** 单路口队列长度（traffic-check 用）：点附近 r 内慢车/停车数——红灯时应涨、绿灯应清零 */
    queueAt(x, z, r = 0.6) {
      let q = 0;
      for (const c of cars) {
        const m = meta[c.li];
        const [px, pz] = sample(m, c.s / m.total, c.lane);
        if (Math.hypot(px - x, pz - z) < r && c.v < c.v0 * 0.3) q++;
      }
      return q;
    },
    /** 诊断：点附近车的完整状态（li/dir/v/v0/到各停车线的距离与当前相位）——死锁排查用 */
    debugNear(x, z, r = 0.8) {
      const out = [];
      const mod2 = (a, n) => ((a % n) + n) % n;
      for (const c of cars) {
        const m = meta[c.li];
        const [px, pz] = sample(m, c.s / m.total, c.lane);
        if (Math.hypot(px - x, pz - z) > r) continue;
        const stops = (signalStops[c.li] || []).map((st) => ({
          axis: st.axis, phase: phaseFor(st.j, clock)[st.axis],
          dist: Math.round((mod2((st.s - c.s) * c.dir, m.total) - (st.crossHalf + 0.04)) * 100) / 100,
        }));
        out.push({ li: c.li, dir: c.dir, v: Math.round(c.v * 1000) / 1000, v0: Math.round(c.v0 * 1000) / 1000, stops });
      }
      return out;
    },
    debug() {   // window.__njCars 巡检用：在停的车占比过高说明红灯配时或车距参数失衡
      let stopped = 0, signals = 0;
      const perLine = [];   // [线长, 车数, 停车数]：短线过饱和（塞不下）一眼可见
      for (let li = 0; li < meta.length; li++) perLine.push([Math.round(meta[li].total * 10) / 10, 0, 0]);
      for (const c of cars) {
        const st = c.v < c.v0 * 0.15;
        if (st) stopped++;
        perLine[c.li][1]++;
        if (st) perLine[c.li][2]++;
      }
      for (const a of signalStops) signals += a.length;
      return {
        count: cars.length, stopped, lines: lines.length, signals,
        clock: Math.round(clock * 10) / 10,
        perLine: perLine.filter((p) => p[1]).map((p) => p.join('/')).join(' '),
      };
    },
  };
}

function resampleLine(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  return out;
}
