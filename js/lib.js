// 通用几何 / 贴图工具
import * as THREE from 'three';

/* ---------------- 材质缓存 ---------------- */
const matCache = new Map();
export function mat(hex, opts = {}) {
  const key = hex + '|' + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: opts.rough ?? 0.85,
    metalness: opts.metal ?? 0.05,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    map: opts.map || null,
    flatShading: !!opts.flat,
  });
  matCache.set(key, m);
  registerEnv(m, opts.env ?? 0.5);
  return m;
}

/* ---------------- 程序化贴图 ---------------- */
function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** 建筑立面（带窗格），配合 facade 贴图使用 */
export function makeFacadeTexture() {
  if (typeof document === 'undefined') return null;
  const S = 256, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#e8eaec'; ctx.fillRect(0, 0, S, S);
  // 楼层分格
  const rows = 16, cols = 16, step = S / rows;
  ctx.fillStyle = '#d8dbe0';
  for (let r = 0; r < rows; r++) ctx.fillRect(0, r * step + step - 1.5, S, 1.5);
  for (let col = 0; col <= cols; col++) ctx.fillRect(col * step - 1, 0, 1.5, S);
  // 窗
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const v = Math.random();
      ctx.fillStyle = v > 0.7 ? '#9fb0bd' : v > 0.35 ? '#7f8d99' : '#a5b0b8';
      ctx.fillRect(col * step + 2, r * step + 2, step - 5, step - 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 夜间窗光：黑白遮罩（同一套网格，与立面窗位置对齐） */
export function makeWindowTexture() {
  if (typeof document === 'undefined') return null;
  const S = 256, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, S, S);
  const rows = 16, cols = 16, step = S / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const v = Math.random();
      if (v < 0.34) continue;                       // 未点亮的窗
      const lit = v < 0.72 ? 90 : v < 0.92 ? 180 : 255;
      ctx.fillStyle = `rgb(${lit},${Math.round(lit * 0.93)},${Math.round(lit * 0.78)})`;
      ctx.fillRect(col * step + 2, r * step + 2, step - 5, step - 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 屋顶：细颗粒 */
export function makeRoofTexture() {
  if (typeof document === 'undefined') return null;
  const S = 128, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#b9bcc0'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(${120 + Math.random() * 90 | 0},${120 + Math.random() * 90 | 0},${120 + Math.random() * 90 | 0},0.5)`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 草地 / 地面：多尺度斑块，营造田块与地类层次 */
export function makeGroundTexture(repeat = 260) {
  if (typeof document === 'undefined') return null;
  const S = 512, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#b9bfa5'; ctx.fillRect(0, 0, S, S);
  // 大块地类斑块
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const w = 30 + Math.random() * 130, h = 30 + Math.random() * 130;
    const g = Math.random();
    ctx.fillStyle = g > 0.62 ? 'rgba(150,168,124,0.30)'
      : g > 0.32 ? 'rgba(196,196,176,0.26)' : 'rgba(126,146,98,0.26)';
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.5, h * 0.5, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // 细碎颗粒
  for (let i = 0; i < 14000; i++) {
    const g = Math.random();
    ctx.fillStyle = g > 0.5 ? 'rgba(150,168,124,0.55)' : 'rgba(196,196,176,0.5)';
    ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // 田垄／土路的细线理
  ctx.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * S;
    ctx.strokeStyle = `rgba(${120 + Math.random() * 60 | 0},${118 + Math.random() * 50 | 0},${96 + Math.random() * 40 | 0},0.22)`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(S * 0.3, y + (Math.random() - 0.5) * 40, S * 0.7, y + (Math.random() - 0.5) * 40, S, y + (Math.random() - 0.5) * 20);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- 几何构建 ---------------- */

/** 强制朝上的四边形集合构造器 */
export class QuadBuilder {
  constructor() { this.pos = []; this.uv = []; this.idx = []; }
  /** p: [[x,z],...] 顺时针或逆时针均可，自动纠正为朝上 */
  addPoly(p, y = 0, uvScale = 0.1) {
    if (p.length < 3) return this;
    // 依据前三点计算朝向，必要时反转，保证法线朝上
    const ux = p[1][0] - p[0][0], uz = p[1][1] - p[0][1];
    const vx = p[2][0] - p[0][0], vz = p[2][1] - p[0][1];
    const ny = uz * vx - ux * vz;
    const pts = ny < 0 ? p.slice().reverse() : p;
    const base = this.pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      this.pos.push(pts[i][0], y, pts[i][1]);
      this.uv.push(pts[i][0] * uvScale, pts[i][1] * uvScale);
    }
    for (let i = 1; i < pts.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
    return this;
  }
  addRect(cx, cz, w, d, y = 0, rot = 0, uvScale = 0.1) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const hw = w / 2, hd = d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [
      cx + x * c - z * s, cz + x * s + z * c,
    ]);
    this.addPoly(corners, y, uvScale);
    return this;
  }
  build(flat = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    if (flat) {
      const n = new Float32Array((this.pos.length / 3) * 3);
      for (let i = 0; i < n.length / 3; i++) n[i * 3 + 1] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    } else g.computeVertexNormals();
    return g;
  }
}

/**
 * 沿折线生成带状面（道路 / 河流），自动纠正朝上
 * width 可为数值或回调 (t01) => number
 */
export function ribbonGeometry(points, width, y = 0.02, uvScale = 0.12) {
  const n = points.length;
  const pos = [], uv = [], idx = [];
  let acc = 0; const cum = [0];
  for (let i = 1; i < n; i++) {
    acc += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    cum.push(acc);
  }
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const w = typeof width === 'function' ? width(n > 1 ? i / (n - 1) : 0) : width;
    // 侧向法线 n = (-dz, dx)，依次写入 A(+n 侧) 与 B(-n 侧)
    pos.push(points[i][0] - dz * w * 0.5, y, points[i][1] + dx * w * 0.5);
    pos.push(points[i][0] + dz * w * 0.5, y, points[i][1] - dx * w * 0.5);
    const u = cum[i] * uvScale;
    uv.push(u, 0, u, 1);
    if (i < n - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const nor = new Float32Array((pos.length / 3) * 3);
  for (let i = 0; i < nor.length / 3; i++) nor[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** 简单多边形 -> XZ 平面上的水平面片 */
export function polygonGeometry(points, y = 0, holes = []) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);          // XY -> XZ
  g.translate(0, y, 0);
  // ShapeGeometry 的朝向：旋转后可能朝下，检查并翻转
  const nor = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < nor.length / 3; i++) nor[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const idx = g.index.array;
  if (idx && idx.length >= 3) {
    const p0 = [], p1 = [], p2 = [];
    ['x', 'y', 'z'].forEach((k, j) => {
      p0.push(g.attributes.position.array[idx[0] * 3 + j]);
      p1.push(g.attributes.position.array[idx[1] * 3 + j]);
      p2.push(g.attributes.position.array[idx[2] * 3 + j]);
    });
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const ny = u[2] * v[0] - u[0] * v[2];
    if (ny < 0) {
      const arr = Array.from(idx);
      for (let i = 0; i < arr.length; i += 3) {
        const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t;
      }
      g.setIndex(arr);
    }
  }
  return g;
}

/* ---------------- 材质 shader 补丁（可叠加，自动维护 program 缓存键） -------------
 * 同一材质可能被多处改写（立面 UV 重映射、城市 AO、雾……）。
 * 直接覆盖 onBeforeCompile 会互相踩踏，因此统一走这里：
 * 补丁按名字去重、按注册顺序执行，customProgramCacheKey 由补丁名拼出，
 * 保证「补丁组合不同 => 程序不同」，组合相同则共用程序。
 */
export function patchMaterial(material, name, fn) {
  const list = material.userData.__patches || (material.userData.__patches = []);
  if (list.some((p) => p.name === name)) return material;
  list.push({ name, fn });
  material.onBeforeCompile = (shader, renderer) => {
    for (const p of list) p.fn(shader, renderer);
  };
  material.customProgramCacheKey = () => list.map((p) => p.name).join('|');
  return material;
}

/* ---------------- 环境反射强度登记表 ----------------
 * 共享环境贴图（PMREM）按材质分别控制强度：玻璃幕墙要亮、土地山体要弱。
 */
const ENV_MATS = [];
export function registerEnv(material, base = 0.5) {
  if (!material || material.userData.envRegistered) return material;
  material.userData.envRegistered = true;
  material.userData.envBase = base;
  material.envMapIntensity = base;
  ENV_MATS.push(material);
  return material;
}
let lastEnvK = -1;
export function setEnvIntensity(k) {
  // 自动昼夜每帧都会路过这里；逐材质写 envMapIntensity 是白烧，值几乎不变时直接跳过
  if (Math.abs(k - lastEnvK) < 0.004) return;
  lastEnvK = k;
  for (const m of ENV_MATS) m.envMapIntensity = (m.userData.envBase ?? 1) * k;
}

/* ---------------- 单位几何体（以原点为底，便于按 scale 摆放） ---------------- */
export const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16).translate(0, 0.5, 0),
  cone4: new THREE.ConeGeometry(0.5, 1, 4).translate(0, 0.5, 0),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
};

/**
 * 实例化方块群（楼体、裙房、退台、屋顶设备……）
 * items: [{ x, z, y, w, h, d, rot, r2, r3, tint, shade }]
 * 自带 aUv 实例化属性（配合 patchMaterial 的 'aUv' 补丁做逐实例 UV 重映射）
 */
export function instancedBoxes(items, material, opts = {}) {
  const n = items.length;
  if (!n) return null;
  const geo = UNIT.box.clone();
  const uvArr = new Float32Array(n * 4);
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.castShadow = opts.cast !== false;
  mesh.receiveShadow = opts.receive !== false;
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const b = items[i];
    dummy.position.set(b.x, b.y || 0, b.z);
    dummy.rotation.set(0, b.rot || 0, 0);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (b.tint) {
      col.set(b.tint);
      if (b.shade !== undefined) col.multiplyScalar(b.shade);
      mesh.setColorAt(i, col);
    }
    uvArr[i * 4] = b.r2 ?? 0.5;
    uvArr[i * 4 + 1] = b.r3 ?? 0.5;
    uvArr[i * 4 + 2] = Math.max(1, Math.round(b.w / (opts.uvU || 1.45)));
    uvArr[i * 4 + 3] = Math.max(1, Math.round(b.h / (opts.uvV || 1.6)));
  }
  geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uvArr, 4));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/**
 * 合批：把一棵子树里「静态且同材质」的 mesh 合并成少量大 mesh。
 *
 * 这是本项目最大的一笔性能开销来源：22 处地标共 1121 个 mesh，主 pass 与阴影 pass
 * 各画一遍，每帧约 2200 次 draw call；合并后降到约 180 次。
 *
 * @param root     待合并子树的根（通常是某个地标的 group）
 * @param exclude  需要保持原样的节点集合（会动的部件，如水面船只）及其子孙
 * @returns        { before, after, tris } 便于在控制台核对收益
 */
export function mergeStaticMeshes(root, exclude = null) {
  const skip = new Set();
  if (exclude && exclude.size) {
    for (const e of exclude) { const s = [e]; while (s.length) { const n = s.pop(); skip.add(n); (n.children || []).forEach((c) => s.push(c)); } }
  }

  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const tmpM = new THREE.Matrix4();
  const buckets = new Map();          // material -> [{ geo, cast, receive }]
  const doomed = [];                  // [mesh, parent]

  let before = 0;
  const im = new THREE.Matrix4();
  const collect = (o) => {
    for (const c of o.children.slice()) {
      if (skip.has(c)) continue;
      if (c.isMesh) {
        if (c.userData && c.userData.noMerge) continue;   // 实例化装饰构件保持原样（单 draw call，不被展开合批）
        if (!c.geometry || !c.geometry.attributes.position) continue;
        if (Array.isArray(c.material)) continue;          // 多材质 mesh 不动
        before++;
        const key = c.material.uuid;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { material: c.material, list: [], cast: false, receive: false }));
        if (c.isInstancedMesh) {
          // InstancedMesh 的实例位置/缩放存放在 instanceMatrix 里，必须逐实例展开，
          // 否则只会把「单位立方体」按 mesh 的世界矩阵烘焙一次，所有实例塌缩成一个盒子。
          const base = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
          for (let ii = 0; ii < c.count; ii++) {
            c.getMatrixAt(ii, im);
            const world = new THREE.Matrix4().multiplyMatrices(c.matrixWorld, im);
            const g2 = base.clone();
            if (!g2.attributes.normal) g2.computeVertexNormals();
            if (!g2.attributes.uv) {
              const n = g2.attributes.position.count;
              g2.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
            }
            g2.applyMatrix4(tmpM.multiplyMatrices(inv, world));
            b.list.push(g2);
          }
          base.dispose();
        } else {
          let geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
          if (!geo.attributes.normal) geo.computeVertexNormals();
          if (!geo.attributes.uv) {
            const n = geo.attributes.position.count;
            geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
          }
          geo.applyMatrix4(tmpM.multiplyMatrices(inv, c.matrixWorld));
          b.list.push(geo);
        }
        b.cast = b.cast || !!c.castShadow;
        b.receive = b.receive || !!c.receiveShadow;
        doomed.push([c, o]);
      } else if (c.children && c.children.length) collect(c);
    }
  };
  collect(root);

  let after = 0, tris = 0;
  for (const b of buckets.values()) {
    if (!b.list.length) continue;
    const geo = concatGeometries(b.list);
    for (const g of b.list) g.dispose();
    const m = new THREE.Mesh(geo, b.material);
    m.name = 'merged';
    m.castShadow = b.cast;
    m.receiveShadow = b.receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
    after++;
    tris += (geo.attributes.position ? geo.attributes.position.count : 0) / 3;
  }
  for (const [mesh, parent] of doomed) parent.remove(mesh);
  return { before, after, tris: Math.round(tris) };
}

/** 把属性结构一致的一组几何首尾相接（只保留 position / normal / uv） */
function concatGeometries(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let vo = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    const c = p.count;
    // 逐分量读取而非整块拷贝：兼容 InterleavedBufferAttribute
    for (let i = 0; i < c; i++) {
      const o3 = (vo + i) * 3, o2 = (vo + i) * 2;
      pos[o3] = p.getX(i); pos[o3 + 1] = p.getY(i); pos[o3 + 2] = p.getZ(i);
      nor[o3] = n.getX(i); nor[o3 + 1] = n.getY(i); nor[o3 + 2] = n.getZ(i);
      uv[o2] = t.getX(i); uv[o2 + 1] = t.getY(i);
    }
    vo += c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

/** 快速放置一个 mesh（单位几何 + scale + 旋转） */
export function put(parent, geo, material, { pos = [0, 0, 0], scale = [1, 1, 1], rot = 0, rotX = 0, rotZ = 0 }) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(scale[0], scale[1], scale[2]);
  m.rotation.set(rotX, rot, rotZ);
  parent.add(m);
  return m;
}
