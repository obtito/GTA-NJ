// 地形：地面、山体、水面、道路、城墙
import * as THREE from 'three';
import { toV2, toV2List, mY, vU, fbm, noise2, smoothstep as smooth, smoothPolyline, resample, distToPolyline, clamp } from './geo.js';
import { RIVER, LAKES, ISLANDS, ROADS, MOUNTAINS, CITY_WALL, LANDMARKS } from './data.js';
import { mat, UNIT, put, ribbonGeometry, polygonGeometry, QuadBuilder, makeGroundTexture, registerEnv } from './lib.js';

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
  const g = new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2);
  const tex = makeGroundTexture();
  const m = new THREE.MeshStandardMaterial({ color: 0xb6c0a2, roughness: 1, metalness: 0, map: tex });
  registerEnv(m, 0.45);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = -0.05;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
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
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
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

/** 返回 { mesh, centerlines } —— centerlines 供车辆行驶使用 */
export function buildRoads(extraLines = []) {
  const lines = [];
  for (const r of ROADS) {
    lines.push({ name: r.name, w: r.w * 10, pts: toV2List(smoothPolyline(r.pts, 6)) });
  }
  for (const e of extraLines) lines.push(e);

  const builder = new QuadBuilder();
  for (const l of lines) {
    for (let i = 0; i < l.pts.length - 1; i++) {
      const [x0, z0] = l.pts[i], [x1, z1] = l.pts[i + 1];
      let dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      const nx = -dz * l.w * 0.5, nz = dx * l.w * 0.5;
      builder.addPoly([
        [x0 + nx, z0 + nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x0 - nx, z0 - nz],
      ], 0.06, 0.08);
    }
  }
  const roadMat = mat('#4b4f55', { rough: 0.95, metal: 0, env: 0.55 });
  const mesh = new THREE.Mesh(builder.build(), roadMat);
  mesh.name = 'roads';
  mesh.receiveShadow = true;

  // 夜间发光的道路中心线
  const glowBuilder = new QuadBuilder();
  for (const l of lines) {
    if (l.w < 3.2) continue;
    for (let i = 0; i < l.pts.length - 1; i++) {
      const [x0, z0] = l.pts[i], [x1, z1] = l.pts[i + 1];
      let dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      const nx = -dz * 0.16, nz = dx * 0.16;
      glowBuilder.addPoly([[x0 + nx, z0 + nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x0 - nx, z0 - nz]], 0.09, 0.2);
    }
  }
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false });
  const glow = new THREE.Mesh(glowBuilder.build(), glowMat);
  glow.name = 'roadGlow';

  return { mesh, glow, centerlines: lines, mats: [roadMat] };
}

/* ==================== 明城墙 ==================== */

export function buildWall() {
  const group = new THREE.Group();
  group.name = 'citywall';
  const poly = smoothPolyline(toV2List(CITY_WALL), 7);
  const closed = poly.concat([poly[0]]);
  const segs = [];
  for (let i = 0; i < closed.length - 1; i++) {
    const [x0, z0] = closed[i], [x1, z1] = closed[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.2) continue;
    segs.push({ x0, z0, x1, z1, len, ang: Math.atan2(x1 - x0, z1 - z0) });
  }

  const wallMat = mat('#8f8577', { rough: 0.95, env: 0.5 });
  const wallH = 2.6, wallW = 1.9;
  const body = new THREE.InstancedMesh(UNIT.box, wallMat, segs.length);
  const merlonMat = mat('#9a9082', { rough: 0.95, env: 0.5 });
  const merlonCount = segs.length * 3;
  const merlons = new THREE.InstancedMesh(UNIT.box, merlonMat, merlonCount);
  const dummy = new THREE.Object3D();
  let mi = 0;

  segs.forEach((s, i) => {
    dummy.position.set((s.x0 + s.x1) / 2, 0, (s.z0 + s.z1) / 2);
    dummy.rotation.set(0, s.ang, 0);
    dummy.scale.set(wallW, wallH, s.len * 1.02);
    dummy.updateMatrix();
    body.setMatrixAt(i, dummy.matrix);

    const n = 3, step = s.len / n;
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      const px = s.x0 + (s.x1 - s.x0) * f, pz = s.z0 + (s.z1 - s.z0) * f;
      dummy.position.set(px, wallH, pz);
      dummy.rotation.set(0, s.ang, 0);
      dummy.scale.set(wallW * 0.72, 0.55, step * 0.5);
      dummy.updateMatrix();
      merlons.setMatrixAt(mi++, dummy.matrix);
    }
  });
  body.count = segs.length;
  merlons.count = mi;
  body.instanceMatrix.needsUpdate = true;
  merlons.instanceMatrix.needsUpdate = true;
  body.castShadow = merlons.castShadow = true;
  body.receiveShadow = merlons.receiveShadow = true;
  group.add(body, merlons);
  return { group, polygon: closed, mats: [wallMat, merlonMat] };
}
