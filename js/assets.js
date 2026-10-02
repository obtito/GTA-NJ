// GLB 资产加载器:外部建模素材统一入口(GTA-NJ 南京城市项目)
//
// 用法:
//   import { loadGLB } from './assets.js';
//   const car = await loadGLB('assets/ferrari.glb', { pos:[x,y,z], rot:0.6, scale:1 });
//   scene.add(car);
//
// 模型规范:GLB(gltf 2.0),Draco 压缩自动解码(assets/draco/),单位=米(Y-up,与场景一致)
// 依赖:index.html importmap 已把 three/addons/ 映射到 ./vendor/(GLTFLoader/DRACOLoader 本地化)。
// 许可提醒:只放 CC0 / CC-BY(署名写入 docs/ATTRIBUTION.md);CC-BY-NC 不进仓库。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/DRACOLoader.js';

let loader = null;

function getLoader() {
  if (loader) return loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath('./assets/draco/gltf/');
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

const cache = new Map();

/**
 * 加载 GLB 并放置到场景坐标。
 * @param {string} url 资产路径(相对 index.html)
 * @param {object} opts { pos:[x,y,z], rot:Y弧度, scale:数值|向量, shadows }
 * @returns {Promise<THREE.Group>} 已定位的模型组(失败时 resolve(null),不抛)
 */
export async function loadGLB(url, opts = {}) {
  let gltf;
  if (cache.has(url)) {
    gltf = { scene: cache.get(url).clone(true) };
  } else {
    try {
      gltf = await getLoader().loadAsync(url);
      cache.set(url, gltf.scene);
    } catch (e) {
      console.warn(`[GTA-NJ] GLB 加载失败 ${url}:`, e.message);
      return null;
    }
  }
  const root = gltf.scene;
  // 变换
  if (opts.pos) root.position.set(...opts.pos);
  if (opts.rot) root.rotation.y = opts.rot;
  if (opts.scale != null) {
    if (Array.isArray(opts.scale)) root.scale.set(...opts.scale);
    else root.scale.setScalar(opts.scale);
  }
  // 阴影 + 规范化(贴图各向异性)
  const doShadow = opts.shadows !== false;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = doShadow;
      o.receiveShadow = doShadow;
      // GLB 多分组网格 material 可能是数组,逐个处理避免漏掉/静默无效
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        if (m?.map) m.map.anisotropy = 4;
      }
    }
  });
  return root;
}

/** 预加载(Loading 阶段用) */
export function preloadGLB(url) {
  if (cache.has(url)) return Promise.resolve();
  return getLoader().loadAsync(url).then((g) => cache.set(url, g.scene)).catch(() => {});
}

/**
 * 合并 GLB 为单几何+单材质(供 InstancedMesh 车流复用)。
 * 返回 { geometry, material } 或 null。单 colormap 车模合并后材质无损。
 */
export async function loadMergedGLB(url) {
  const root = await loadGLB(url);
  if (!root) return null;
  // 收集网格 → 手动拼接(避免 mergeStaticMeshes 的多材质分桶)
  const geos = [];
  let material = null;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    geos.push(g);
    if (material == null) material = Array.isArray(o.material) ? (o.material[0] ?? null) : o.material;
  });
  if (!geos.length) return null;
  // 拼接 position/normal/uv
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let vo = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const o3 = (vo + i) * 3, o2 = (vo + i) * 2;
      pos[o3] = p.getX(i); pos[o3 + 1] = p.getY(i); pos[o3 + 2] = p.getZ(i);
      nor[o3] = n.getX(i); nor[o3 + 1] = n.getY(i); nor[o3 + 2] = n.getZ(i);
      uv[o2] = t.getX(i); uv[o2 + 1] = t.getY(i);
    }
    vo += p.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return { geometry: geo, material };
}
