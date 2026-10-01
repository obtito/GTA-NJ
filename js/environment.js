// 共享 HDR 环境（思路移植自 GTA_SZ 的 environment：一张 HDR 同时供天空、水面与 PBR 反射使用）
//
// GTA_SZ 用的是 Poly Haven 的 CC0 HDR；本项目完全离线，因此改用程序化天空（three 的 Sky / Preetham）
// 作为 HDR 源，用 PMREMGenerator 预过滤成立方体环境贴图。
//
// 关键分工（GTA_SZ 文档里反复强调的一条）：
//   · 显示用的天空：经过 ACES tone mapping，是给眼睛看的；
//   · IBL 用的辐射：必须是线性 HDR，不能先被 tone mapping 压过肩部，否则高光全被抹平。
// PMREMGenerator 在烘焙时内部会把 renderer.toneMapping 临时置为 NoToneMapping，
// 正好实现了这个分离——所以我们只需共用同一个 Sky 网格，两条链路自动分开。
//
// 太阳方向取自 geo.js 的 sunState()，与实时平行光严格同源（GTA_SZ：solar direction from HDR）。

import * as THREE from 'three';
import { Sky } from 'three/addons/Sky.js';
import { sunState, lerp } from './geo.js';

const QUANT = 0.5;        // 环境按 0.5 小时量化缓存（太阳每小时约移动 15°，0.5h 足够细）
const MAX_CACHE = 5;      // LRU 上限：每个 256² 立方体 UV 目标约几 MB

export function createEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();

  // 单独一份天空：只用于烘焙，不参与主场景渲染
  const sky = new Sky();
  sky.scale.setScalar(1000);
  // PMREM 烘焙时会关掉 autoClear，六个面共用同一个深度缓冲且不清零；
  // Sky 默认 depthTest 为真，很容易被引擎留下的深度值整片丢弃。关掉深度测试/写入后，
  // 天空必然铺满每个面，与深度缓冲的初始状态无关。
  sky.material.depthTest = false;
  sky.material.depthWrite = false;
  sky.material.toneMapped = false;   // 显示链路才做 tone mapping，IBL 辐射必须保持线性 HDR
  sky.frustumCulled = false;
  const envScene = new THREE.Scene();
  envScene.add(sky);
  const u = sky.material.uniforms;

  const cache = new Map();     // key(小时) -> { rt, t }
  let currentKey = null;
  let currentRT = null;
  let ready = false;

  /** 把天空配置到指定钟点（与主场景 applyTime 用同一套参数曲线） */
  function configure(hours) {
    const s = sunState(hours);
    u.sunPosition.value.set(s.dir.x, s.dir.y, s.dir.z);
    u.turbidity.value = lerp(3.2, 8.5, s.dusk);
    u.rayleigh.value = lerp(0.8, 2.4, s.dusk);
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.82;
    u.up.value.set(0, 1, 0);
    return s;
  }

  function evict() {
    while (cache.size > MAX_CACHE) {
      let oldestKey = null, oldestT = Infinity;
      for (const [k, v] of cache) if (v.t < oldestT) { oldestT = v.t; oldestKey = k; }
      const hit = cache.get(oldestKey);
      cache.delete(oldestKey);
      if (hit && hit.rt !== currentRT) hit.rt.dispose();
    }
  }

  /** 取（或烘焙）某一钟点的环境贴图 */
  function bake(hours) {
    const key = Math.round(hours / QUANT) * QUANT;
    const hit = cache.get(key);
    if (hit) { hit.t = performance.now(); return hit.rt.texture; }
    configure(key);
    const rt = pmrem.fromScene(envScene, 0, 1, 20000);
    cache.set(key, { rt, t: performance.now() });
    evict();
    return rt.texture;
  }

  /**
   * 更新到指定钟点。返回环境贴图（scene.environment 应设为它）。
   * 命中缓存时不重烘焙，因此滑动时间轴只在跨越 0.5 小时时才付一次烘焙代价。
   */
  function update(hours) {
    const key = Math.round(hours / QUANT) * QUANT;
    if (key === currentKey && currentRT) { cache.get(key).t = performance.now(); return currentRT.texture; }
    try {
      const tex = bake(hours);
      const hit = cache.get(key);
      if (hit) currentRT = hit.rt;
      currentKey = key;
      ready = true;
      return tex;
    } catch (e) {
      // 烘焙失败不应拖垮整个场景：退回到「太阳 + 半球光」的解析光照
      console.warn('[GTA-NJ] 环境烘焙失败，回退为纯解析光照：', e);
      return null;
    }
  }

  function dispose() {
    for (const v of cache.values()) v.rt.dispose();
    cache.clear();
    currentRT = null; currentKey = null; ready = false;
    pmrem.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
  }

  return {
    update,
    bake,
    dispose,
    isReady: () => ready,
    /** 当前缓存的小时键，便于调试面板显示 */
    key: () => currentKey,
    size: () => cache.size,
  };
}
