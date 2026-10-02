// 地形：地面、山体、水面、道路、城墙
import * as THREE from 'three';
import { toV2, toV2List, mY, vU, hU, fbm, noise2, smoothstep as smooth, smoothPolyline, resample, distToPolyline, clamp } from './geo.js';
import { RIVER, LAKES, ISLANDS, ROADS, MOUNTAINS, CITY_WALL, CITY_GATES, LANDMARKS, gateHalfLenM } from './data.js';
import {
  mat, UNIT, put, ribbonGeometry, polygonGeometry, QuadBuilder, registerEnv,
  makeGroundTexture, makeWallBrickTexture, makeWallBrickNormalMap, makeWallStoneTexture, makeWallTopTexture,
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
  // w 直接就是场景单位（1 单位 = 100 m）：0.5 → 50 m，符合真实主干道宽度。
  // 旧版写成 r.w * 10 = 500 m 宽的路面带，整条中山东路变成了吞掉沿线地标的大平原。
  for (const r of ROADS) {
    lines.push({ name: r.name, w: r.w, pts: toV2List(smoothPolyline(r.pts, 6)) });
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

  // 夜间发光的道路中心线（只画主干道）
  const glowBuilder = new QuadBuilder();
  for (const l of lines) {
    if (l.w < 0.35) continue;
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

/* ---------------- 墙体：连续剖面扫掠 ----------------
 *
 * 旧的城墙是「一串盒子」：每段墙一个独立 Box，摆在各自的方法线上。
 * 两个必然后果——拐角处盒子互不相让，外墙角啃出一个个切口和凸榫；
 * 底边一律压在 y=0，遇到有高差的地面就悬空或陷进地里。
 *
 * 现在整段墙是一次扫掠出来的连续带（sweep）：沿折线逐点求 miter 法向
 * （拐角取相邻两段法向的加权平均，超出限幅时退化为斜接），
 * 同一条剖面环一路推过去，接缝只在城门豁口处才断；墙基再按地形落,
 * 于是墙是「长」在地面上的，不是「摆」在地上的。
 */

/** 墙体剖面（米）：t 沿墙厚方向（+t 朝城外），h 自墙基算起 */
const WALL_H = 20;                 // 墙高（实测 14–21 m，取中）
const WALL_BASE = 20;              // 底宽（实测 14–20 m）
const WALL_TOP = 7;                // 顶宽（实测 4–9 m）
const WALL_SINK = 1.5;             // 墙基埋入地面，杜绝悬空
const TOP_RISE = 0.4;              // 城顶散水：内低外高，向城内排水
const PLINTH_H = 1.3;              // 条石勒脚高
const PLINTH_OUT = 0.45;           // 勒脚外挑（墙脚防水的那一圈石裙）
/* 垛口：现存 13616 个垛 ÷ 现存 25.09 km 墙长 → 平均间距 1.84 m */
const MERLON_PITCH = 1.84, MERLON_W = 0.95, MERLON_T = 0.55, MERLON_H = 1.8;

/** 沿一段墙求「站」：miter 法向 + 沿线累计米数 + 地形高程 */
function wallStations(run, cx, cz) {
  // 一、逐段求法向（朝城外）
  const segN = [];
  for (let i = 0; i < run.length - 1; i++) {
    let dx = run[i + 1][0] - run[i][0], dz = run[i + 1][1] - run[i][1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    let nx = -dz, nz = dx;
    if ((run[i][0] - cx) * nx + (run[i][1] - cz) * nz < 0) { nx = -nx; nz = -nz; }
    segN.push({ dx, dz, nx, nz });
  }
  // 二、每个顶点取相邻两段法向之和（斜接 miter）再归一化 ——
  //    拐角因此是一条连续的棱，而不是两个方盒互相啃出来的切口
  const st = [];
  for (let i = 0; i < run.length; i++) {
    const k = Math.min(i, segN.length - 1);
    const prev = k > 0 ? segN[k - 1] : segN[k], next = segN[k];
    let nx = prev.nx + next.nx, nz = prev.nz + next.nz;
    const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
    if ((run[i][0] - cx) * nx + (run[i][1] - cz) * nz < 0) { nx = -nx; nz = -nz; }
    st.push({ x: run[i][0], z: run[i][1], nx, nz, ang: Math.atan2(next.dx, next.dz), s: 0, y: 0 });
  }
  // 沿线累计（米）——UV 靠它，砖号才能 1:1 铺开
  for (let i = 1; i < st.length; i++) {
    st[i].s = st[i - 1].s + Math.hypot(st[i].x - st[i - 1].x, st[i].z - st[i - 1].z) * 100;
  }
  // 墙基随地形：与城门锚点用同一套算法（Math.max(0, terrain)），保证门与墙严丝合缝
  for (const p of st) p.y = Math.max(0, terrainHeight(p.x, p.z)) - hU(WALL_SINK);
  return st;
}

/** 把墙段端头吸附到城台侧面上。
 *  墙段是绕着城门豁口切出来的，端头只会「离门大概 60 m」——而城台沿墙只有 ~24 m 宽，
 *  于是墙头到城台侧面之间空出几十米，整圈墙看着是断了三截。
 *  做法：以端点处的墙切向为轴，把端投影到「离门中心 ±城台半长」的位置（垂向偏移保留）。 */
function snapRunEnds(pts, gates) {
  if (pts.length < 2 || !gates.length) return pts;
  const nearest = (p) => {
    let best = null, bd = 0.9;                       // 0.9 单位 ≈ 90 m
    for (const g of gates) {
      const d = Math.hypot(p[0] - g.x, p[1] - g.z);
      if (d < bd) { bd = d; best = g; }
    }
    return best;
  };
  const snap = (p, fromStart) => {
    const g = nearest(p);
    if (!g) return null;
    const q = pts[fromStart ? 1 : pts.length - 2];
    let dx = q[0] - p[0], dz = q[1] - p[1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const wx = p[0] - g.x, wz = p[1] - g.z;
    const along = wx * dx + wz * dz;
    const ox = wx - along * dx, oz = wz - along * dz;  // 端头不在线上时的侧向偏移
    // 往城里（门里）多啃 40 cm：端头埋进城台侧面，既不露缝也不共面打架
    const s = (along >= 0 ? 1 : -1) * (g.h + hU(0.4));
    return [g.x + ox + dx * s, g.z + oz + dz * s];
  };
  const a = snap(pts[0], true), b = snap(pts[pts.length - 1], false);
  const out = a ? [a, ...pts] : pts.slice();
  if (b) out.push(b);
  // 去重：吸附后若与端点重合就别留两个点（零长段会让 miter 方向变脏）
  const ded = [out[0]];
  for (let i = 1; i < out.length; i++) {
    if (Math.hypot(out[i][0] - ded[ded.length - 1][0], out[i][1] - ded[ded.length - 1][1]) > 1e-4) ded.push(out[i]);
  }
  return ded;
}

/** 按沿线米数插值出站（垛口按 1.84 m 等距布点，站距本身是不均匀的） */
function stationAtS(st, s) {
  for (let i = 1; i < st.length; i++) {
    if (st[i].s >= s || i === st.length - 1) {
      const a = st[i - 1], b = st[i];
      const t = clamp((s - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
      const nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t;
      const L = Math.hypot(nx, nz) || 1;
      // 朝向沿用站点里存好的 ang（站上只有 nx/nz，没有 segN 的 dx/dz）
      let da = b.ang - a.ang;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      return {
        x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
        nx: nx / L, nz: nz / L, ang: a.ang + da * t,
        y: a.y + (b.y - a.y) * t, s,
      };
    }
  }
  return st[0];
}

/** 在站内取一点：t/h 为剖面米数 */
function stationPoint(s, t, h) {
  return [s.x + s.nx * hU(t), s.y + vU(h), s.z + s.nz * hU(t)];
}

/** 面扫掠器：把剖面上的一条边沿整段墙连续铺开，顶点 UV 直接以「米」计 */
class WallStrip {
  constructor() { this.pos = []; this.uv = []; this.idx = []; }
  /**
   * 剖面顶点顺序已按外法线定死（外壁自上而下、内壁自下而上、城顶由内向外），
   * 所以这里不用事后翻面：u=沿线米、v=高度米，贴图按真实砖号 1:1 铺，墙再长也拉不花。
   */
  face(stations, ta, ha, tb, hb, uvU, uvV) {
    const base = this.pos.length / 3;
    for (let i = 0; i < stations.length - 1; i++) {
      const s = stations[i], s2 = stations[i + 1];
      const u0 = s.s * uvU, u1 = s2.s * uvU, v0 = ha * uvV, v1 = hb * uvV;
      this.pos.push(...stationPoint(s, ta, ha), ...stationPoint(s, tb, hb),
        ...stationPoint(s2, tb, hb), ...stationPoint(s2, ta, ha));
      this.uv.push(u0, v0, u0, v1, u1, v1, u1, v0);
      const o = base + i * 4;
      this.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    return this;
  }
  build() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

export function buildWall() {
  const group = new THREE.Group();
  group.name = 'citywall';
  const poly = smoothPolyline(toV2List(CITY_WALL), 7);
  const closed = poly.concat([poly[0]]);
  const gatePts = CITY_GATES.map((gt) => toV2(gt.lon, gt.lat));
  // 城台沿墙半长（米）——墙段端头按它吸附，垛口也按它让位
  const gateInfo = CITY_GATES.map((gt, i) => ({
    x: gatePts[i][0], z: gatePts[i][1], h: hU(gateHalfLenM(gt)),
  }));
  // 距城门多近算豁口：城台沿墙还不到 30 m，切 60 m 是为了让城台两侧各有余量
  const GATE_OPEN = 0.6;
  const nearGate = (x, z) => gatePts.some((q) => Math.hypot(x - q[0], z - q[1]) < GATE_OPEN);
  // 垛口让位用精确边界（比 GATE_OPEN 贴得更近，墙头到城台之间不留空档）
  const onGate = (x, z) => gateInfo.some((g) => Math.hypot(x - g.x, z - g.z) < g.h);

  // 环心：用来判定「哪一侧是城外」，墙厚方向 +t 一律朝城外
  let cx = 0, cz = 0;
  for (const p of closed) { cx += p[0]; cz += p[1]; }
  cx /= closed.length; cz /= closed.length;

  // 按城门豁口把整圈墙切成若干连续段（run），段内一条带到底，只段间接在城门上
  const runs = [];
  let cur = [];
  const flush = () => { if (cur.length > 1) runs.push(cur); cur = []; };
  for (let i = 0; i < closed.length - 1; i++) {
    const [x0, z0] = closed[i], [x1, z1] = closed[i + 1];
    if (Math.hypot(x1 - x0, z1 - z0) < 0.2) continue;
    if (nearGate((x0 + x1) / 2, (z0 + z1) / 2)) { flush(); continue; }
    cur.push(closed[i]);
  }
  flush();
  // 端头精确对接城台侧面（否则墙与城门之间空一截）
  runs.forEach((r, i) => { runs[i] = snapRunEnds(r, gateInfo); });
  const stations = runs.map((r) => wallStations(r, cx, cz));

  const bh = WALL_BASE / 2, th = WALL_TOP / 2;
  const brickB = new WallStrip(), stoneB = new WallStrip(), topB = new WallStrip(), bandB = new WallStrip();
  for (const st of stations) {
    // 外壁：外顶 → 外底（自上而下，法线才朝城外）；断面是梯形，外壁上收
    brickB.face(st, th, WALL_H, bh, -WALL_SINK, 1 / 4, 1 / 2);
    // 内壁：内底 → 内顶
    brickB.face(st, -bh, -WALL_SINK, -th, WALL_H, 1 / 4, 1 / 2);
    // 城顶散水：内低外高（平砖竖砌，向城内排水）
    topB.face(st, -th, WALL_H - TOP_RISE, th, WALL_H + TOP_RISE, 1 / 1.6, 1 / 1.2);
    // 条石勒脚：外挑 0.45 m 压住墙脚，一圈石裙
    stoneB.face(st, bh + PLINTH_OUT, PLINTH_H, bh + PLINTH_OUT, -WALL_SINK, 1 / 2.4, 1 / 1.2);
    stoneB.face(st, -(bh + PLINTH_OUT), -WALL_SINK, -(bh + PLINTH_OUT), PLINTH_H, 1 / 2.4, 1 / 1.2);
    // 夜间洗墙灯带：贴着墙面上部（离顶 0.3–3.2 m），随墙身倾斜
    const fT = (0.3 + WALL_H) / (WALL_H + WALL_SINK), fB = (3.2 + WALL_H) / (WALL_H + WALL_SINK);
    for (const side of [1, -1]) {
      const t0 = side * (th + (bh - th) * fT) + side * 0.07;
      const t1 = side * (th + (bh - th) * fB) + side * 0.07;
      bandB.face(st, t0, WALL_H - 0.3, t1, WALL_H - 3.2, 1 / 4, 1 / 2);
    }
  }

  // 材质：城砖（含法线，砖缝有起伏）、墙脚条石、城顶甃砖。
  // 有贴图时 color 只当染色用，一律给接近中性的浅色——早先砖色 × 深底色的乘法
  // 把墙面压到亮度 ~50，白天看着就是一块黑；现在贴图自带砖色，墙面与草地同一档。
  const brickTex = makeWallBrickTexture(), brickNrm = makeWallBrickNormalMap();
  const wallMat = mat('#ffffff', { rough: 0.94, env: 0.45, map: brickTex, normalMap: brickNrm });
  const topMat = mat('#e2dccb', { rough: 0.92, env: 0.4, map: makeWallTopTexture() });
  const stoneMat = mat('#ded7c6', { rough: 0.9, env: 0.4, map: makeWallStoneTexture() });
  const merlonMat = mat('#bdb6a5', { rough: 0.94, env: 0.45 });

  for (const [g, m] of [[brickB.build(), wallMat], [topB.build(), topMat], [stoneB.build(), stoneMat]]) {
    if (!g) continue;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 垛口：按实测间距 1.84 m（= 现存 13616 个垛 ÷ 25.09 km 墙长）等距布垛
  const dummy = new THREE.Object3D();
  let merlonN = 0;
  for (const st of stations) merlonN += Math.max(0, st[st.length - 1].s) / MERLON_PITCH;
  const merlons = new THREE.InstancedMesh(UNIT.box, merlonMat, Math.ceil(merlonN) + runs.length);
  let mi = 0;
  for (const st of stations) {
    const sEnd = st[st.length - 1].s;
    for (let sp = 0; sp <= sEnd; sp += MERLON_PITCH) {
      const p = stationAtS(st, sp);
      if (onGate(p.x, p.z)) continue;                       // 垛口同样给城门让位
      dummy.position.set(
        p.x + p.nx * hU(th - MERLON_T / 2), p.y + vU(WALL_H + MERLON_H / 2 - TOP_RISE), p.z + p.nz * hU(th - MERLON_T / 2),
      );
      dummy.rotation.set(0, p.ang, 0);
      dummy.scale.set(hU(MERLON_T), vU(MERLON_H), hU(MERLON_W));
      dummy.updateMatrix();
      merlons.setMatrixAt(mi++, dummy.matrix);
    }
  }
  merlons.count = mi;
  merlons.instanceMatrix.needsUpdate = true;
  merlons.castShadow = merlons.receiveShadow = true;
  group.add(merlons);

  // 夜间亮化：墙身两面连续洗墙灯带 + 墙体泛光。
  // 灯带做在墙面上而非墙顶：从街上看是一道贴着墙走的暖光，从空中看是墙线亮边；
  // 泛光用材质 emissive（不参与光照计算，仅随 night 因子起落），
  // 让整段墙在夜里是"被照亮的石头"而不是一条黑剪影——参考南京城墙现有夜景。
  const lightMat = new THREE.MeshBasicMaterial({
    color: 0xffbe70, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  });
  const band = bandB.build();
  const lights = new THREE.Group();
  lights.name = 'wallLights';
  if (band) {
    const mesh = new THREE.Mesh(band, lightMat);
    mesh.frustumCulled = false;
    lights.add(mesh);
  }
  group.add(lights);

  const floodMats = [wallMat, merlonMat, stoneMat, topMat];
  const FLOOD = new THREE.Color('#6b5a3c');
  function setNight(k) {
    const n = clamp(k, 0, 1);
    lightMat.opacity = n * 0.8;
    for (const m of floodMats) {
      m.emissive.copy(FLOOD);
      m.emissiveIntensity = n * 0.62;
    }
  }

  // ends 只给自检脚本用：拿墙段两端去比对最近城门的半长，看有没有接歪 / 接不上
  const ends = runs.map((r) => ({ a: r[0], b: r[r.length - 1] }));
  return { group, polygon: closed, mats: floodMats, glow: lights, glowMat: lightMat, setNight, ends };
}
