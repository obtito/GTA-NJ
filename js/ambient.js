// 城市级环境光遮蔽（思路移植自 GTA_SZ 的 city-ambient-bake / city-ambient-occlusion，实现改为 Three.js）
//
// 为什么需要它：屏幕空间 AO 只能覆盖几米范围、太阳阴影又受 shadow box 限制，真正缺的是
// 「城市自身的阴影衰减」——深巷、塔基、裙房屋顶相对开阔广场与林荫大道的明暗差。
//
// 做法：由建筑 footprint 离线烘焙一张「天空可见度」场（地平线扫描 + Lambertian cos² 加权），
// 运行时每个像素只做一次纹理采样，不增加任何 pass / buffer / 几何。
// 按表面类型区分强度（地面 / 墙面 / 屋顶），并只把一小部分施加到直射光 ——
// 让受光面保留 shadow-map 的对比，而阴影处加深。
//
// 尺度：水平 1 单位 = 100 m，竖向 1 单位 = 30 m（与 geo.js 一致）

import * as THREE from 'three';
import { patchMaterial } from './lib.js';

export const CITY_AMBIENT = {
  cell: 0.6,                 // 栅格边长（场景单位）
  pad: 6,                    // 栅格外扩（场景单位）
  heights: [0, 30, 90],      // 三个通道的接收高度（米）
  fadeTop: 320,              // 米：高于此高度完全不受遮挡
  directions: 16,            // 扫描方位数
  phases: 2,                 // 方位扇面的相位数：把固定扇面绕塔楼画出的条带打散成细噪
  steps: [0.5, 1, 1.5, 2, 3, 4, 6, 8],   // 采样步距（栅格）：近场加密，远场到 8 格 ≈ 480 m
  reach: 8,                  // 栅格：距任何 footprint 超过此距离的单元保持全亮并跳过
};

/** 强度 = 烘焙遮蔽的施加比例；inset = 沿法线内移的米数（墙面读到自己 footprint 内部的自排除场，而不是路缘的路面） */
export const CITY_AMBIENT_LOOK = {
  ground: { strength: 0.85, inset: 0 },
  wall: { strength: 0.60, inset: 2.0 },
  roof: { strength: 0.70, inset: 0 },
};

const M_PER_U_H = 100;
const M_PER_U_V = 30;

/* ---------------- 运行时共享 uniform ---------------- */

// 烘焙完成前的占位：1×1 全亮，保证未烘焙时 shader 读到 1.0（完全不遮挡）而不是采样到空纹理
const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
WHITE.needsUpdate = true;

const U = {
  uCityMap: { value: WHITE },
  uCityOrigin: { value: new THREE.Vector2() },
  uCitySize: { value: new THREE.Vector2() },
  uCityHeights: { value: new THREE.Vector4(0, 30, 90, 320) },
};
// 每个表面一套 params（strength / inset / direct），三者的 z 由光照模式统一驱动
const SURF_U = {};
for (const k of Object.keys(CITY_AMBIENT_LOOK)) {
  const look = CITY_AMBIENT_LOOK[k];
  SURF_U[k] = { value: new THREE.Vector3(look.strength, look.inset, 0.3) };
}

const registry = [];   // 已注入的材质，烘焙完成后统一 needsUpdate
let ready = false;

/* ---------------- 烘焙 ---------------- */

/** 旋转矩形的四个角（闭合），与 three 的 rotation.y 约定一致 */
function rectPoly(b) {
  const co = Math.cos(b.rot), si = Math.sin(b.rot);
  const pts = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = sx * b.rw * 0.5, lz = sz * b.rd * 0.5;
    pts.push([b.x + lx * co + lz * si, b.z - lx * si + lz * co]);
  }
  pts.push(pts[0]);
  return pts;
}

/** 扫描线填充每个 footprint；重叠处由更高的建筑占据该单元 */
function rasterize(grid, occluders) {
  const { minX, minZ, cell, w, h } = grid;
  occluders.forEach((b, index) => {
    const poly = rectPoly(b);
    const id = index + 1;
    let minR = Infinity, maxR = -Infinity;
    for (const p of poly) {
      const r = (p[1] - minZ) / cell;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    const r0 = Math.max(0, Math.floor(minR)), r1 = Math.min(h - 1, Math.ceil(maxR));
    for (let row = r0; row <= r1; row++) {
      const z = minZ + (row + 0.5) * cell;
      const xs = [];
      for (let i = 0; i < poly.length - 1; i++) {
        const [x0, z0] = poly[i], [x1, z1] = poly[i + 1];
        if ((z0 <= z && z1 > z) || (z1 <= z && z0 > z)) xs.push(x0 + ((z - z0) / (z1 - z0)) * (x1 - x0));
      }
      xs.sort((a, c) => a - c);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c0 = Math.max(0, Math.round((xs[i] - minX) / cell));
        const c1 = Math.min(w - 1, Math.round((xs[i + 1] - minX) / cell) - 1);
        for (let c = c0; c <= c1; c++) {
          const k = row * w + c;
          if (b.heightM > grid.heightM[k]) { grid.heightM[k] = b.heightM; grid.ids[k] = id; }
        }
      }
    }
  });
}

const FANS = (() => {
  const out = [];
  for (let p = 0; p < CITY_AMBIENT.phases; p++) {
    const fan = [];
    for (let i = 0; i < CITY_AMBIENT.directions; i++) {
      const a = ((i + p / CITY_AMBIENT.phases) * Math.PI * 2) / CITY_AMBIENT.directions;
      fan.push([Math.cos(a), Math.sin(a)]);
    }
    out.push(fan);
  }
  return out;
})();

/** 地平线扫描：每个方位取遇到的最陡遮挡坡度 tanθ=(H-y)/d，该切片的天空可见度为 cos²θ=1/(1+tan²θ) */
function skyVisibility(grid, cx, cz, yM, selfId, dirs) {
  const { w, h, heightM, ids, cell } = grid;
  const cellM = cell * M_PER_U_H;
  let sum = 0;
  for (const [dx, dz] of dirs) {
    let tan = 0;
    for (const d of CITY_AMBIENT.steps) {
      const c = Math.round(cx + dx * d), r = Math.round(cz + dz * d);
      if (c < 0 || r < 0 || c >= w || r >= h) break;
      const k = r * w + c;
      const hM = heightM[k];
      if (hM <= yM || ids[k] === selfId) continue;
      const t = (hM - yM) / (d * cellM);
      if (t > tan) tan = t;
    }
    sum += 1 / (1 + tan * tan);
  }
  return sum / dirs.length;
}

/** 距任何 footprint 在 reach 格以内的单元（可分离膨胀：先行后列） */
function activeMask(grid) {
  const { width: w, height: h, ids } = grid;
  const reach = CITY_AMBIENT.reach;
  const mask = new Uint8Array(w * h);
  const rows = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    let last = -Infinity;
    for (let c = 0; c < w; c++) { if (ids[r * w + c]) last = c; if (c - last <= reach) rows[r * w + c] = 1; }
    last = Infinity;
    for (let c = w - 1; c >= 0; c--) { if (ids[r * w + c]) last = c; if (last - c <= reach) rows[r * w + c] = 1; }
  }
  for (let c = 0; c < w; c++) {
    let last = -Infinity;
    for (let r = 0; r < h; r++) { if (rows[r * w + c]) last = r; if (r - last <= reach) mask[r * w + c] = 1; }
    last = Infinity;
    for (let r = h - 1; r >= 0; r--) { if (rows[r * w + c]) last = r; if (last - r <= reach) mask[r * w + c] = 1; }
  }
  return mask;
}

/**
 * 烘焙城市 AO。
 * @param occluders [{ x, z, rw, rd, rot, heightM }] 场景单位 / 米
 * @returns { texture, minX, minZ, width, height } —— 失败返回 null
 */
export function bakeCityAmbient(occluders) {
  if (!occluders || !occluders.length) return null;
  const cell = CITY_AMBIENT.cell, pad = CITY_AMBIENT.pad;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of occluders) {
    const poly = rectPoly(b);
    for (const p of poly) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
  }
  if (!Number.isFinite(minX)) return null;
  minX = Math.floor(minX) - pad; minZ = Math.floor(minZ) - pad;
  const w = Math.max(1, Math.ceil((Math.ceil(maxX) + pad - minX) / cell));
  const h = Math.max(1, Math.ceil((Math.ceil(maxZ) + pad - minZ) / cell));

  const grid = { minX, minZ, cell, width: w, height: h, w, h, heightM: new Float32Array(w * h), ids: new Int32Array(w * h) };
  rasterize(grid, occluders);
  const mask = activeMask(grid);

  const [h0, h1, h2] = CITY_AMBIENT.heights;
  const data = new Uint8Array(w * h * 4);
  const samples = [];                 // 地面通道的可见度，用于统计与自检
  let active = 0, occSum = 0;
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const k = r * w + c;
      if (!mask[k]) { data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = 255; continue; }
      active++;
      const selfId = grid.ids[k];
      const fan = FANS[(((c * 73856093) ^ (r * 19349663)) >>> 0) & (CITY_AMBIENT.phases - 1)];
      const v0 = skyVisibility(grid, c, r, h0, selfId, fan);
      const v1 = skyVisibility(grid, c, r, h1, selfId, fan);
      const v2 = skyVisibility(grid, c, r, h2, selfId, fan);
      data[k * 4] = Math.round(v0 * 255);
      data[k * 4 + 1] = Math.round(v1 * 255);
      data[k * 4 + 2] = Math.round(v2 * 255);
      occSum += v0;
      samples.push(v0);
    }
  }
  samples.sort((a, b) => a - b);
  const pct = (q) => (samples.length ? samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] : 1);

  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  U.uCityMap.value = texture;
  U.uCityOrigin.value.set(minX, minZ);
  U.uCitySize.value.set(w * cell, h * cell);
  U.uCityHeights.value.set(h0, h1, h2, CITY_AMBIENT.fadeTop);
  ready = true;
  for (const m of registry) m.needsUpdate = true;

  return {
    texture, minX, minZ, width: w, height: h,
    activeCells: active,
    meanVisibility: active ? occSum / active : 1,
    // 分位数：p05 是深巷/塔基的暗处，p50 是一般街道
    p05: pct(0.05), p50: pct(0.5), p95: pct(0.95),
  };
}

/** 由城市实例与地标收集遮挡体 */
export function collectOccluders(city, landmarkItems) {
  const out = [];
  if (city && city.buckets) {
    for (const b of city.buckets) {
      for (const it of b.items) {
        // full = 含退台的总高；ow/od = 含裙房的外轮廓
        out.push({
          x: it.x, z: it.z, rot: it.rot || 0,
          rw: it.ow || it.w, rd: it.od || it.d,
          heightM: (it.full || it.h) * M_PER_U_V,
        });
      }
    }
  }
  if (landmarkItems) {
    const box = new THREE.Box3();
    for (const it of landmarkItems) {
      if (!it.group) continue;
      box.setFromObject(it.group);
      if (!Number.isFinite(box.min.x)) continue;
      out.push({
        x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2,
        rw: Math.max(0.4, box.max.x - box.min.x), rd: Math.max(0.4, box.max.z - box.min.z),
        rot: 0, heightM: Math.max(4, (it.top || 0.2) * M_PER_U_V),
      });
    }
  }
  return out;
}

/* ---------------- 材质注入 ---------------- */

const VERT_TAIL = /* glsl */`
#ifdef USE_INSTANCING
  vCityPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vCityNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vCityPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vCityNrm = normalize(mat3(modelMatrix) * objectNormal);
#endif
`;

const FRAG_HEAD = /* glsl */`
uniform sampler2D uCityMap;
uniform vec2 uCityOrigin;
uniform vec2 uCitySize;
uniform vec3 uCityParams;
uniform vec4 uCityHeights;
varying vec3 vCityPos;
varying vec3 vCityNrm;

// 世界点 p、法线 n 处的天空可见度：三个烘焙高度按世界高度混合，超过最后一个后淡出为全亮。
// 栅格之外视为没有城市，不做任何遮挡。
float cityAmbientAt(vec3 p, vec3 n) {
  vec2 off = vec2(n.x, n.z);
  float len = length(off);
  if (len > 0.001) off = (off / len) * uCityParams.y * 0.01;   // inset：米 -> 场景单位
  vec2 uv = (p.xz - off - uCityOrigin) / uCitySize;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
  vec3 s = texture2D(uCityMap, uv).rgb;
  float y = max(p.y, 0.0) * ${M_PER_U_V.toFixed(1)};
  float h0 = uCityHeights.x, h1 = uCityHeights.y, h2 = uCityHeights.z;
  float ao = y < h1 ? mix(s.r, s.g, clamp((y - h0) / (h1 - h0), 0.0, 1.0))
                    : mix(s.g, s.b, clamp((y - h1) / (h2 - h1), 0.0, 1.0));
  ao = mix(ao, 1.0, smoothstep(h2, uCityHeights.w, y));
  return mix(1.0, ao, uCityParams.x);
}
`;

const FRAG_TAIL = /* glsl */`
{
  float cityAo = cityAmbientAt(vCityPos, vCityNrm);
  reflectedLight.indirectDiffuse *= cityAo;
  reflectedLight.indirectSpecular *= cityAo;
  reflectedLight.directDiffuse *= mix(1.0, cityAo, uCityParams.z);
  reflectedLight.directSpecular *= mix(1.0, cityAo, uCityParams.z * 0.5);
}
`;

/** 给一个 MeshStandardMaterial 注入城市 AO（surface: ground | wall | roof） */
export function applyCityAmbient(material, surface = 'ground') {
  if (!material || !material.isMeshStandardMaterial) return material;
  if (material.userData.cityAmbient) return material;
  material.userData.cityAmbient = surface;
  const params = SURF_U[surface] || SURF_U.ground;

  patchMaterial(material, 'cityAmbient', (shader) => {
    shader.uniforms.uCityMap = U.uCityMap;
    shader.uniforms.uCityOrigin = U.uCityOrigin;
    shader.uniforms.uCitySize = U.uCitySize;
    shader.uniforms.uCityParams = params;
    shader.uniforms.uCityHeights = U.uCityHeights;

    shader.vertexShader = 'varying vec3 vCityPos;\nvarying vec3 vCityNrm;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n' + VERT_TAIL,
    );
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n' + FRAG_TAIL,
    );
  });
  registry.push(material);
  return material;
}

/** 批量注入 */
export function applyCityAmbientAll(materials, surface) {
  for (const m of materials || []) applyCityAmbient(m, surface);
  return materials;
}

/** 直射光受 AO 影响的份额：白天 0.30 / 黄昏 0.24 / 夜间 0 */
export function setCityAmbientDirect(direct) {
  for (const k of Object.keys(SURF_U)) SURF_U[k].value.z = direct;
}

export function isCityAmbientReady() { return ready; }
