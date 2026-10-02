// 程序化城市：建筑、行道树、车流
import * as THREE from 'three';
import { toV2, toV2List, mY, makeRandom, clamp, pointInPolygon, distToPolyline, smoothPolyline } from './geo.js';
import { DISTRICTS, PARKS, RIVER, LAKES, CITY_WALL } from './data.js';
import { makeFacadeTexture, makeWindowTexture, makeRoofTexture, patchMaterial, instancedBoxes, registerEnv } from './lib.js';
import { terrainHeight } from './world.js';

const RIVER_PTS = toV2List(RIVER.pts);
const LAKE_POLYS = LAKES.map((l) => toV2List(l.pts));
const WALL_PTS = toV2List(CITY_WALL);

/* ============ 掩膜：水体 / 山体 / 城墙 / 地标占地 之上不生成建筑 ============ */
// 城墙开槽：WALL_CLEAR 为墙体两侧的净空（场景单位，1 单位 = 100 m）。
// 城垣沿线本就有护城河与保护带，楼群压在墙上既失真又必然穿模。
const WALL_CLEAR = 0.55;
function blocked(x, z, exclusions) {
  if (distToPolyline(x, z, RIVER_PTS) < RIVER.halfWidth + 1.2) return true;
  if (distToPolyline(x, z, WALL_PTS) < WALL_CLEAR) return true;
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
  oldtown: { side: '#e8dfd1', roof: '#9e4630', rough: 0.95, metal: 0.0, emissive: 0.7, env: 0.5 },
  industrial: { side: '#d0d2ce', roof: '#8d918e', rough: 0.9, metal: 0.12, emissive: 0.55, env: 0.68 },
  campus: { side: '#e5e2d9', roof: '#6c7a67', rough: 0.9, metal: 0.02, emissive: 1.0, env: 0.66 },
};
const TYPE_STYLE = {
  downtown: 'glass', modern: 'glass', residential: 'concrete',
  oldtown: 'oldtown', industrial: 'industrial', campus: 'campus',
};

/** 逐实例 UV 重映射：同一张立面/窗光贴图，按楼体宽高与随机偏移取不同区域 */
function patchUV(m) {
  patchMaterial(m, 'aUv', (shader) => {
    shader.vertexShader = 'attribute vec4 aUv;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = vMapUv * aUv.zw + aUv.xy;
      #endif
      #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv = vEmissiveMapUv * aUv.zw + aUv.xy;
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
      lines.push({ name: d.name, w: 0.22, pts: [toWorld(lx, -D / 2), toWorld(lx, D / 2)] });
    }
    for (let j = 0; j <= nz; j++) {
      const lz = -D / 2 + j * cell;
      lines.push({ name: d.name, w: 0.22, pts: [toWorld(-W / 2, lz), toWorld(W / 2, lz)] });
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

  const group = new THREE.Group();
  group.name = 'city';

  const buckets = {};   // style -> { items, podium, setback }
  const details = { cap: [], antenna: [] };
  const mats = { wall: [], roof: [], misc: [] };

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
        if (blocked(x, z, exclusions)) continue;

        const r = Math.hypot(lx, lz) / maxR;
        const core = Math.pow(clamp(1 - r * 0.95, 0, 1), d.type === 'oldtown' ? 2.2 : 1.35);
        const tall = Math.pow(rand(), d.type === 'downtown' ? 1.7 : 2.4);
        let hMeters = hMin + (hMax - hMin) * (0.25 + 0.75 * tall) * (0.55 + 0.45 * core);
        if (d.type === 'industrial') hMeters = hMin + (hMax - hMin) * rand();
        if (d.type === 'campus') hMeters = hMin + (hMax - hMin) * Math.pow(rand(), 2.0);
        const h = Math.max(0.35, mY(hMeters));

        const fw = cell * (0.52 + rand() * 0.34);
        const fd = cell * (0.52 + rand() * 0.34);
        const yRot = rot + (rand() - 0.5) * 0.12;

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
      }
    }
  }

  // 构建 InstancedMesh
  const meshes = [];
  for (const [styleKey, bucket] of Object.entries(buckets)) {
    const st = STYLES[styleKey];
    if (!bucket.items.length) continue;
    const sideMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(st.side),
      map: facade,
      emissiveMap: windowsTex,
      emissive: new THREE.Color('#ffc98a'),
      emissiveIntensity: 0,
      roughness: st.rough,
      metalness: st.metal,
    });
    patchUV(sideMat);
    registerEnv(sideMat, st.env);
    const roofMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(st.roof), map: roofTex, roughness: 0.95, metalness: 0.05,
    });
    patchUV(roofMat);
    registerEnv(roofMat, st.env * 0.55);
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a5f63'), roughness: 1 });
    registerEnv(darkMat, st.env * 0.5);
    // 六个面各一套：侧墙 / 侧墙 / 屋顶 / 底面 / 侧墙 / 侧墙
    const materials = [sideMat, sideMat, roofMat, darkMat, sideMat, sideMat];
    mats.wall.push(sideMat);
    mats.roof.push(roofMat);
    mats.misc.push(darkMat);

    const mesh = instancedBoxes(bucket.items, materials);
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
      const m = instancedBoxes(bucket.podium, materials);
      m.name = 'podium:' + styleKey;
      group.add(m);
      bucket.detailList.push({ mesh: m, items: bucket.podium });
      meshes.push(m);
    }
    if (bucket.setback.length) {
      const m = instancedBoxes(bucket.setback, materials);
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
      if (blocked(x, z, exclusions)) continue;
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

/* ============ 车流 ============ */
export function buildCars(centerlines, count = 110, seed = 999) {
  const rand = makeRandom(seed);
  const lines = centerlines.filter((l) => l.w > 2.5);
  if (!lines.length) return { group: new THREE.Group(), update: () => {} };
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const carMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.35 });
  registerEnv(carMat, 1.25);            // 车漆靠环境反射出“湿润感”
  const mesh = new THREE.InstancedMesh(geo, carMat, count);
  mesh.frustumCulled = false;
  const cars = [];
  const palette = ['#d8dde3', '#3b4250', '#8d3a33', '#2f5b8b', '#c9a227', '#37474f', '#6b7280'];
  const col = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const li = (rand() * lines.length) | 0;
    cars.push({ li, t: rand(), speed: (0.004 + rand() * 0.012) * (rand() > 0.5 ? 1 : -1), lane: (rand() > 0.5 ? 1 : -1) * 0.22, y: 0.22 });
    col.set(palette[(rand() * palette.length) | 0]);
    mesh.setColorAt(i, col);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

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

  function update(dt, visible = true) {
    if (!visible) return;
    for (let i = 0; i < count; i++) {
      const c = cars[i];
      c.t += c.speed * dt;
      const m = meta[c.li];
      const [x, z, ang] = sample(m, c.t, c.lane);
      dummy.position.set(x, c.y, z);
      dummy.rotation.set(0, ang, 0);
      dummy.scale.set(0.11, 0.09, 0.24);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function setNight(k) {
    carMat.emissive = new THREE.Color(0xffd9a0);
    carMat.emissiveIntensity = k * 0.55;
  }

  const group = new THREE.Group();
  group.name = 'cars';
  group.add(mesh);
  return { group, update, setNight, count, mats: [carMat] };
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
