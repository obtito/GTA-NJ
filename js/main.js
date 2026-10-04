// 南京 3D 交互场景 · 主程序
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { Sky } from 'three/addons/Sky.js';
import {
  buildGround, buildMountains, createWaterMaterial, buildWater,
  buildMountainForest, buildRoads, buildWall, terrainHeight,
} from './world.js';
import { buildCity, buildTrees, buildCars, buildStreetLights, districtGridLines } from './city.js';
import { buildLandmarks } from './landmarks.js';
import { buildGates, gateRoadLines, gateFrame } from './gates.js';
import { buildFerry } from './transit.js';
import { buildStreetProps } from './props.js';
import { buildMetro } from './metro.js';
import { buildPedestrians } from './pedestrians.js';
import { loadGLB } from './assets.js';
import { dressSpiritWay } from './spiritway.js';
import { createEnvironment } from './environment.js';
import { createArchitecturalLightPool } from './architectural-lighting.js';
import { collectOccluders, bakeCityAmbient, applyCityAmbient, setCityAmbientDirect } from './ambient.js';
import { setEnvIntensity } from './lib.js';
import { CATEGORIES, DISTRICTS, RIVER, CITY_WALL, CITY_GATES, ROADS } from './data.js';
import { toV2, toV2List, clamp, lerp, sunState, easeInOutCubic, vU, hU, M_PER_U_H } from './geo.js';

/* ==================== DOM ==================== */
const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const loadBar = $('#loadBar');
const loadText = $('#loadText');

const CAT_COLOR = {};
for (const c of CATEGORIES) CAT_COLOR[c.key] = c.color;

// 主循环里每帧要碰的 DOM 节点只查一次
const elTimeVal = $('#timeVal');
const elTimeSlider = $('#timeSlider');

/* ==================== 渲染器 / 场景 ==================== */
let renderer, scene, camera, controls, sky, sunLight, hemi, ambient, waterMat;
let moonLight, stars;
let architecturalLights;
let city, trees, cars, roads, waterGroup, gates, walls;
let lights, ferry;
let props, metro;
let peds;
let env = null;                       // 共享 HDR 环境（PMREM）
let landmarkItems = [];
let labelEls = [];
let grow = 1, autoTime = false, timeHours = 15;
let activeId = null;
let anim = null;
// 待注入城市 AO 的材质，按表面类型分组
const aoTargets = { ground: [], wall: [], roof: [] };
let aoInfo = null;
const clock = new THREE.Clock();

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // 起步不得超过 RES_BASE（自适应 ladder 的 1.0 档），见 applyResolution()
  renderer.setPixelRatio(RES_BASE);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.68;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  architecturalLights = createArchitecturalLightPool(scene, { maxDistance: 26 });   // 门体 1:30 后取景距离放大,择近半径同步
  scene.fog = new THREE.Fog(0xd8e4ee, 320, 1100);

  camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.015, 4000);
  camera.position.set(120, 130, 190);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = .65;
  controls.maxDistance = 900;
  controls.target.set(0, 2, 0);
  controls.autoRotateSpeed = 0.32;
  controls.update();

  // 天空
  sky = new Sky();
  sky.scale.setScalar(12000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.82;
  // Sky 是整屏的 Preetham 大气积分（十几次 pow/exp），是最贵的一层。
  // 它的顶点着色器把 z 推到远平面（gl_Position.z = gl_Position.w），
  // 所以把它排到最后绘制时，被地形楼群盖住的像素会在深度测试阶段直接被剔掉 ——
  // 否则它排在队列最前、整屏无谓跑一遍，航拍视角下等于白烧一半 GPU。
  sky.renderOrder = 1000;
  scene.add(sky);

  hemi = new THREE.HemisphereLight(0xcfe3f2, 0x6f7259, 0.7);
  scene.add(hemi);
  ambient = new THREE.AmbientLight(0xffffff, 0.22);
  scene.add(ambient);

  sunLight = new THREE.DirectionalLight(0xfff3e0, 2.6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  // 视锥半幅 / near / far / bias 每帧按焦点距离重算，见 updateShadowFocus()
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 1400;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // 夜间月光：太阳落下后场景不再只剩黑，一盏冷色的低强度平行光维持可读的轮廓
  moonLight = new THREE.DirectionalLight(0x8ea6c8, 0);
  scene.add(moonLight);
  scene.add(moonLight.target);

  // 夜间星空：上半球随机布点，透明通道在天空之后绘制，只随 night 因子淡入
  {
    const N = 1300;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      // y ∈ (0.06, 1]，拒绝地平线附近的星；半径 3500 位于远裁剪面 4000 之内
      const y = 0.06 + Math.random() * 0.94;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 3500;
      pos[i * 3 + 1] = y * 3500;
      pos[i * 3 + 2] = Math.sin(a) * r * 3500;
      // 冷暖微差：大部分偏白，少数偏蓝 / 偏暖
      c.setHSL(0.55 + (Math.random() - 0.5) * 0.25, 0.25 * Math.random(), 0.72 + Math.random() * 0.28);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({
      size: 2.2, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    stars.frustumCulled = false;
    scene.add(stars);
  }

  // 共享 HDR 环境：程序化天空 -> PMREM，供玻璃幕墙、车漆等地物的 PBR 反射使用
  env = createEnvironment(renderer);
}

/* ==================== 昼夜 ==================== */
const sunDir = new THREE.Vector3();
const skyColor = new THREE.Color();
const horizonColor = new THREE.Color();
const zenithColor = new THREE.Color();

// 共享环境的重烘焙（PMREM）要几十毫秒，不能跟着时间轴逐帧跑：
// applyTime 只登记 envPending，由主循环按「冷却 + 停手」两个条件触发。
let envPending = null;
let lastEnvMs = -1e9;
let lastEnvHours = -1e9;
let lastTimeChangeMs = 0;
let envReady = false;

function applyEnv(hours) {
  if (!env) { envPending = null; return; }
  lastEnvMs = performance.now();
  const tex = env.update(hours);
  if (tex) { scene.environment = tex; envReady = true; }
  applyEnvCompensation(hours);
}

/** 有了 IBL 之后，半球光/环境光退为补色：再叠满会与天空辐射重复补光、把画面冲淡 */
function applyEnvCompensation(hours) {
  const s = sunState(hours);
  const fill = envReady ? 0.58 : 1;
  hemi.intensity = lerp(0.26, 0.72, s.day) * fill;
  ambient.intensity = lerp(0.10, 0.26, s.day) * fill;
  setEnvIntensity(lerp(0.45, 1.0, Math.max(s.day, s.dusk * 0.6)));
}

function applyTime(hours) {
  timeHours = hours;
  // 太阳状态唯一来源：实时平行光、共享环境烘焙、水面高光全部读同一份
  const s = sunState(hours);
  const { day, night, dusk } = s;
  sunDir.set(s.dir.x, s.dir.y, s.dir.z);
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  sky.material.uniforms.turbidity.value = lerp(3.2, 8.5, dusk);
  sky.material.uniforms.rayleigh.value = lerp(0.8, 2.4, dusk);

  // 共享 HDR 环境交给 applyEnv() 节流执行，这里只登记待办
  envPending = hours;
  lastTimeChangeMs = performance.now();
  applyEnvCompensation(hours);

  sunLight.intensity = lerp(0.05, 2.9, Math.pow(day, 0.7));
  sunLight.color.setHSL(lerp(0.07, 0.13, day), lerp(0.55, 0.12, day), lerp(0.5, 0.75, day));
  hemi.color.setHSL(0.58, lerp(0.35, 0.42, day), lerp(0.22, 0.72, day + 0.15));
  hemi.groundColor.setHSL(0.18, 0.18, lerp(0.10, 0.28, day));

  // 天空/雾颜色近似
  skyColor.setHSL(0.58, lerp(0.35, 0.45, dusk), lerp(0.10, 0.78, day));
  scene.fog.color.copy(skyColor);
  renderer.toneMappingExposure = lerp(0.52, 0.72, day);

  // 星空与月光：只在入夜后淡入，白天/黄昏保持零开销（透明物体在天空之后绘制）
  if (stars) stars.material.opacity = night * 0.9;
  if (moonLight) {
    moonLight.intensity = night * 0.16;
    // 月亮大致出现在太阳的对面：把太阳方向的水平分量反转、抬高
    moonLight.position.set(-sunDir.x * 400, Math.max(260, -sunDir.y * 400), -sunDir.z * 400);
    moonLight.target.position.set(0, 0, 0);
    moonLight.target.updateMatrixWorld();
  }

  if (waterMat) {
    // 水面反射与 PBR 共用同一片天空：地平线取雾色提亮，天顶取更深的蓝
    horizonColor.copy(skyColor).offsetHSL(0, -0.04, 0.07);
    zenithColor.setHSL(0.60, lerp(0.30, 0.55, day), lerp(0.08, 0.40, day));
    waterMat.uniforms.uSunDir.value.copy(sunDir);
    waterMat.uniforms.uNight.value = night;
    waterMat.uniforms.uSky.value.copy(skyColor);
    waterMat.uniforms.uHorizon.value.copy(horizonColor);
    waterMat.uniforms.uZenith.value.copy(zenithColor);
    waterMat.uniforms.uSunI.value = lerp(0.04, 1.0, Math.pow(day, 0.7));
  }
  if (city) city.setNight(night);
  if (cars) cars.setNight(Math.max(night, dusk * 0.4));
  if (lights) lights.setNight(Math.max(night, dusk * 0.4));   // 路灯灯头，与车灯同口径黄昏先起
  if (metro) metro.setNight(Math.max(night, dusk * 0.4));     // 地铁站点夜光
  if (roads) roads.glow.material.opacity = clamp(night * 0.55 + dusk * 0.18, 0, 0.7);
  // 城墙亮化：墙身两面连续洗墙灯带 + 墙体泛光，黄昏先起、入夜全亮（参考南京城墙现有夜景）
  if (walls && walls.setNight) walls.setNight(Math.max(night, dusk * 0.5));
  if (gates) gates.setNight(Math.max(night, dusk * 0.5));   // 压顶/券洞/檐口灯带与局部洗墙光
  if (landmarkItems) for (const it of landmarkItems) it.setNight && it.setNight(night);   // 地标夜景（窗光/冠缘发光）

  // 城市 AO 施加到直射光的份额：白天 0.30 / 黄昏 0.24 / 夜间 0（夜间只剩灯光，别再压暗）
  setCityAmbientDirect((1 - night) * lerp(0.30, 0.24, dusk));

  const hh = Math.floor(hours);
  const mm = Math.floor((hours - hh) * 60);
  elTimeVal.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* ==================== 阴影契约：焦点距离驱动 ==================== */
// GTA_SZ 的经验：太阳阴影只在 shadow box 内生效，box 固定就必然在街景下过粗、航拍下不够。
// 这里让视锥半幅跟随「相机到焦点的距离」：贴地看时收到几十米，俯瞰全城时放宽到数百米，
// 同时 bias / normalBias 随 texel 的世界尺寸缩放，避免缩放过程中出现闪烁的自阴影条纹。
const shadowState = { d: 0 };
function updateShadowFocus() {
  if (!sunLight) return;
  const focus = controls.target;
  const dist = camera.position.distanceTo(focus);
  const d = clamp(dist * 0.62 + 24, 26, 240);

  sunLight.target.position.copy(focus);
  sunLight.target.updateMatrixWorld();
  sunLight.position.copy(focus).addScaledVector(sunDir, 600);

  if (Math.abs(d - shadowState.d) > shadowState.d * 0.05 || shadowState.d === 0) {
    shadowState.d = d;
    const cam = sunLight.shadow.camera;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
    cam.updateProjectionMatrix();
    const texel = (2 * d) / sunLight.shadow.mapSize.x;   // 一个阴影 texel 覆盖多少场景单位
    sunLight.shadow.bias = -0.0004 - texel * 0.0016;
    sunLight.shadow.normalBias = clamp(texel * 2.2, 0.12, 0.9);
  }
}

/* ==================== 构建流程 ==================== */
async function build() {
  const marks = [];
  const total = 8;
  const step = async (label, fn, pct) => {
    loadText.textContent = label + '……';
    loadBar.style.width = pct + '%';
    await new Promise((r) => setTimeout(r, 30));
    // await 兼容异步步骤（如 GLB 装载）；同步 fn 的返回值经 await 原样透传
    const out = await fn();
    marks.push(label);
    return out;
  };

  await step('初始化渲染器', initRenderer, 8);
  await step('生成地形与山体', () => {
    const g = buildGround();
    scene.add(g.mesh);
    aoTargets.ground.push(g.mat);
    const mo = buildMountains();
    scene.add(mo.group);
  }, 22);
  await step('铺设长江与湖泊', () => {
    waterMat = createWaterMaterial();
    waterGroup = buildWater(waterMat);
    scene.add(waterGroup);
  }, 36);
  await step('砌筑明城墙', () => {
    const w = buildWall();
    scene.add(w.group);
    aoTargets.wall.push(...w.mats);
    walls = w;
  }, 46);
  const lm = await step('复刻精细地标', () => {
    const r = buildLandmarks();
    scene.add(r.group);
    return r;
  }, 62);

  landmarkItems = lm.items;
  for (const it of landmarkItems) {
    const stack = [it.group];
    while (stack.length) {
      const n = stack.pop();
      n.userData.lid = it.id;
      for (const c of n.children || []) stack.push(c);
    }
  }

  await step('复刻十五座城门', () => {
    const g = buildGates({ exclusions: lm.exclusions });
    scene.add(g.group);
    gates = g;   // 材质在 AO 烘焙阶段统一登记（见「烘焙城市环境光遮蔽」）
  }, 68);
  architecturalLights.setRoots([walls.group, gates.group, lm.group]);

  await step('生成城市街区路网', () => {
    const grid = districtGridLines();
    // 穿门道路：通行门沿墙线法向铺路，从门洞与豁口穿过（遗址门为较窄的园区路）
    roads = buildRoads([...grid, ...gateRoadLines()]);
    scene.add(roads.mesh);
    scene.add(roads.glow);
    aoTargets.ground.push(...roads.mats);
    return grid;
  }, 72);

  await step('生长楼群与行道树', async () => {
    city = buildCity({ exclusions: lm.exclusions });
    scene.add(city.group);
    city.setGrowth(0);
    aoTargets.wall.push(...city.mats.wall, ...city.mats.misc);
    aoTargets.roof.push(...city.mats.roof);

    const t = buildTrees({ exclusions: lm.exclusions });
    trees = t.group;
    scene.add(trees);
    aoTargets.wall.push(...t.mats);

    // 紫金山林相（松 60%/阔叶 40%，~7 万实例混交）。exclusions 传「收窄副本」：
    // 地标排他圆是为挡楼设计的（两陵 r=8u+，直径 1.6km），直传会在山坡上留秃圆；
    // 山上没有楼群可挡，封顶 3.5u 只护住建筑本体一圈。神道走廊小圆（0.2u 级）不受影响。
    const forest = buildMountainForest({ exclusions: lm.exclusions.map((e) => [e[0], e[1], Math.min(e[2], 3.5)]) });
    scene.add(forest.group);
    console.log(`[GTA-NJ] 紫金山林相：${forest.count} 棵（马尾松 60%/阔叶 40%）`);

    cars = await buildCars(roads.centerlines, 120);   // Kenney 车模异步装载(node/失败回退方块)
    scene.add(cars.group);
    aoTargets.ground.push(...cars.mats);   // 车在街谷底部，吃最重的遮蔽

    // 主干道路灯（移植 GTA-WH 夜景）：杆与灯头各一组实例，夜间一次 uniform 点亮全城
    lights = buildStreetLights(roads.centerlines, roads.surfaceAt);
    scene.add(lights.group);
    console.log(`[GTA-NJ] 路灯：${lights.count} 根`);

    // 中山码头—浦口 宁浦轮渡：江面往返班轮（独立于地标的观赏渔船）
    ferry = buildFerry();
    scene.add(ferry.group);

    // KayKit 街景道具（CC0 单图集）：红绿灯落路口、小吃车/长椅/垃圾箱沿街+人流地标聚落
    props = await buildStreetProps({ centerlines: roads.centerlines, exclusions: lm.exclusions });
    scene.add(props.group);
    console.log(`[GTA-NJ] 街景道具：${props.count} 件（信号路口 ${props.junctions.length} 处）`);
    // 车流智能：红绿灯交点表转喂车流做停车线（灯珠变色在 props.update，相位同源）
    cars.setSignals?.(props.junctions);

    // 行人（Phase 2 门控）：主干人行道双侧 + 三处 POI 环绕 + 红绿灯停步/过街
    peds = buildPedestrians({ centerlines: roads.centerlines, exclusions: lm.exclusions });
    peds.setSignals?.(props.junctions);   // 门控注入（与 cars.setSignals 相邻同款；不注入则退回 Phase 1 行为）
    scene.add(peds.group);
    console.log(`[GTA-NJ] 行人：${peds.count} 人（信号门 ${peds.debug().gates} 处）`);
  }, 88);

  await step('装载外部 GLB 资产', async () => {
    // 明孝陵神道 CC0 精模：Smithsonian 跪翼守门兽（麒麟位）/守狮对/石香炉替换程序化件。
    // 必须在首个 applyTime 之前（同下：晚注册材质停在未补偿 base 值）。
    const mxl = lm.items.find((it) => it.id === 'mingxiaoling');
    if (mxl?.spiritSlots) {
      await dressSpiritWay(mxl.group, mxl.spiritSlots, mxl.spiritFallback);
      console.log('[GTA-NJ] 神道精模：CC0 扫描件（守狮对/翼兽/香炉）已落位');
    }

    // 外部资产管线演示（Draco 压缩 GLB）。场景水平 1:100，真实尺度的车小如指甲，
    // 按车流的视觉语言归一到车长 ≈0.24 单位；等比缩放、不压 Y（城墙同款等比口径）。
    // 注意：此步必须在首个 applyTime 之前 —— setEnvIntensity 有 |Δk|<0.004 早退，
    // 晚注册的材质会停在未补偿的 base 值。
    const car = await loadGLB('./assets/ferrari.glb', { pos: [23.7, 0.065, 12.9], rot: 0.6, scale: 0.05 });
    if (car) console.log('[GTA-NJ] GLB 资产：ferrari.glb 已装载（新街口广场演示）');

    // 中山路静态停车：Kenney 车贴路缘排开（归一到车流视觉语言 0.23 单位车长，等比不压 Y）
    {
      // 找主干道不能靠名字：中山路已并入「中山南路·中山北路」——注意 '中山南路' 并不以
      // '中山路' 开头(第三字是'南'),startsWith 会静默失配,必须用包含匹配
      const zsl = ROADS.find((r) => r.name.startsWith('中山南') || r.name.startsWith('中山路'));
      if (zsl) {
      const [ax0, az0] = toV2(zsl.pts[1][0], zsl.pts[1][1]);    // 新街口北侧
      const [ax1, az1] = toV2(zsl.pts[0][0], zsl.pts[0][1]);    // 向南排开
      const dx = ax1 - ax0, dz = az1 - az0;
      const seg = Math.hypot(dx, dz);
      const ang = Math.atan2(dx, dz);                           // 与车流同向约定
      const nx = dz / seg, nz = -dx / seg;                      // 路法向
      const off = zsl.widthM / 2 / M_PER_U_H + 0.028;           // 贴路缘（红线外沿 + 半个车长）
      const parked = ['sedan.glb', 'taxi.glb', 'suv.glb', 'van.glb', 'police.glb', 'hatchback-sports.glb', 'truck.glb', 'race.glb'];
      let parkedOk = 0;
      for (let i = 0; i < parked.length; i++) {
        const t = 0.06 + i * 0.075;
        const g = await loadGLB('./assets/cars/' + parked[i]);
        if (!g) continue;
        const b1 = new THREE.Box3().setFromObject(g);
        const len = Math.max(b1.max.z - b1.min.z, b1.max.x - b1.min.x, 0.01);
        g.scale.setScalar(0.23 / len);
        g.rotation.y = ang;
        g.updateMatrixWorld(true);
        const b2 = new THREE.Box3().setFromObject(g);
        const px = ax0 + dx * t + nx * off, pz = az0 + dz * t + nz * off;
        g.position.set(px - (b2.max.x + b2.min.x) / 2, 0.06 - b2.min.y, pz - (b2.max.z + b2.min.z) / 2);
        scene.add(g);
        parkedOk++;
      }
      if (parkedOk) console.log(`[GTA-NJ] 中山路路边停车：${parkedOk} 台 Kenney 车`);
      }
    }

    // 南京地铁线网（AFAP/nanjing-metro 整理的 OSM 几何,ODbL）：高架实体走廊 + 地下半透明线
    try {
      const res = await fetch('./data/metro-3d.json');
      if (res.ok) {
        metro = buildMetro(await res.json());
        scene.add(metro.group);
        console.log(`[GTA-NJ] 地铁线网：${metro.lines} 条线 · ${metro.stations} 站`);
      }
    } catch (e) { console.warn('[GTA-NJ] 地铁数据不可用：', e.message); }
  }, 98);

  await step('烘焙城市环境光遮蔽', () => {
    // 地标也参与遮挡：塔楼脚下、城门洞、巷子里的明暗差靠这张场
    const seen = new Set();
    const collectMats = (root) => root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m && m.isMeshStandardMaterial && !seen.has(m)) { seen.add(m); aoTargets.wall.push(m); }
      }
    });
    collectMats(lm.group);
    if (gates) collectMats(gates.group);   // 城台/城楼/遗址台基同样吃街谷遮蔽

    const occ = collectOccluders(city, landmarkItems);
    // 先注入（登记材质），再烘焙 —— 烘焙结束会统一置 needsUpdate 触发重编译
    for (const surface of Object.keys(aoTargets)) {
      for (const m of aoTargets[surface]) applyCityAmbient(m, surface);
    }
    aoInfo = bakeCityAmbient(occ);
    return aoInfo;
  }, 96);

  await step('点亮万家灯火', () => {
    applyTime(15);
    buildLabels();
    buildList();
    buildLegend();
    buildPickProxies();
  }, 100);

  $('#statBuild').textContent = `${city.count.toLocaleString()} 建筑 · ${landmarkItems.length} 地标`;
  // 加载时间戳：用于自检"看到的是不是最新构建"——与当前时钟不符即缓存页
  const now = new Date();
  $('#statLoad').textContent = `加载 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  console.log('[GTA-NJ] 构建完成 · 阶段：', marks.join(' / '));
  console.log('[GTA-NJ] 城市 AO：', aoInfo ? `${aoInfo.width}×${aoInfo.height}, 有效单元 ${aoInfo.activeCells}, 平均天空可见度 ${aoInfo.meanVisibility.toFixed(3)}` : '未生成');
  console.log(
    '[GTA-NJ] 地标合批：', lm.merged ? `${lm.merged.before} → ${lm.merged.after} mesh` : '未启用',
    ' · 拾取代理', pickProxies.length, '个',
  );
}

/* ==================== 标签 ==================== */
function buildLabels() {
  const layer = $('#labels');
  layer.innerHTML = '';
  labelEls = landmarkItems.map((it) => {
    const el = document.createElement('div');
    el.className = 'label';
    el.innerHTML = `<b>${it.name}</b>`;
    el.dataset.id = it.id;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      selectById(it.id, true);
    });
    layer.appendChild(el);
    // last 缓存上一次写进 DOM 的值：只有真的变了才写回。
    // 22 个标签 × 每帧 3 处样式写入，足以把主线程拖出强制重排。
    return { el, item: it, last: { on: null, x: NaN, y: NaN, dim: null, act: null } };
  });
}

const tmpV = new THREE.Vector3();
let vw = window.innerWidth, vh = window.innerHeight;   // 缓存视口，避免每帧读 window 触发重排
function updateLabels() {
  const camDist = camera.position.distanceTo(controls.target);
  for (const { el, item, last } of labelEls) {
    tmpV.copy(item.pos);
    tmpV.y += item.labelY;
    const dist = tmpV.distanceTo(camera.position);
    tmpV.project(camera);
    const behind = tmpV.z > 1;
    const x = (tmpV.x * 0.5 + 0.5) * vw;
    const y = (-tmpV.y * 0.5 + 0.5) * vh;
    const on = !behind && x > -80 && x < vw + 80 && y > -40 && y < vh + 40 && dist < 900;
    if (on !== last.on) { el.style.display = on ? 'block' : 'none'; last.on = on; }
    if (!on) continue;
    if (!(Math.abs(x - last.x) < 0.5 && Math.abs(y - last.y) < 0.5)) {
      last.x = x; last.y = y;
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    const dim = dist >= camDist * 1.1;
    if (dim !== last.dim) { el.classList.toggle('dim', dim); last.dim = dim; }
    const act = item.id === activeId;
    if (act !== last.act) { el.classList.toggle('active', act); last.act = act; }
  }
}

/* ==================== 地标列表 ==================== */
function buildList() {
  const body = $('#listBody');
  body.innerHTML = '';
  const groups = {};
  for (const it of landmarkItems) (groups[it.cat] = groups[it.cat] || []).push(it);
  for (const cat of Object.keys(groups)) {
    const t = document.createElement('div');
    t.className = 'cat-title';
    t.textContent = cat;
    body.appendChild(t);
    for (const it of groups[cat]) {
      const row = document.createElement('div');
      row.className = 'item';
      row.dataset.id = it.id;
      row.dataset.name = it.name;
      row.dataset.en = it.en || '';
      row.dataset.tags = (it.tags || []).join(',');
      const dot = `<span class="dot" style="background:${CAT_COLOR[it.cat] || '#888'}"></span>`;
      const hei = it.top > 3 ? `<span class="h">${Math.round(it.top * 30)}m</span>` : '';
      row.innerHTML = `${dot}<span class="nm">${it.name}</span>${hei}`;
      row.addEventListener('click', () => selectById(it.id, true));
      body.appendChild(row);
    }
  }
  $('#listCount').textContent = landmarkItems.length;
}

/** 按名称 / 英文名 / 标签过滤列表；空串恢复全部 */
function filterList(raw) {
  const q = raw.trim().toLowerCase();
  document.querySelectorAll('.item').forEach((el) => {
    const hit = !q
      || el.dataset.name.toLowerCase().includes(q)
      || (el.dataset.en && el.dataset.en.toLowerCase().includes(q))
      || (el.dataset.tags && el.dataset.tags.toLowerCase().includes(q));
    el.style.display = hit ? 'flex' : 'none';
  });
}

function buildLegend() {
  const el = $('#legend');
  el.innerHTML = CATEGORIES
    .filter((c) => landmarkItems.some((i) => i.cat === c.key))
    .map((c) => `<span><i style="background:${c.color}"></i>${c.key}</span>`)
    .join('');
}

/* ==================== 信息卡 ==================== */
function showInfo(it) {
  const card = $('#infoCard');
  $('#infoCat').textContent = it.cat;
  $('#infoName').textContent = it.name;
  $('#infoEn').textContent = it.en || '';
  $('#infoTags').innerHTML = (it.tags || []).map((t) => `<i>${t}</i>`).join('');
  $('#infoDesc').textContent = it.desc || '';
  $('#infoSpec').innerHTML = (it.spec || []).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  $('#infoCoord').textContent = `${it.lat.toFixed(4)}° N, ${it.lon.toFixed(4)}° E`;
  card.classList.remove('hidden');
}

function selectById(id, fly = true) {
  const it = landmarkItems.find((i) => i.id === id);
  if (!it) return;
  activeId = id;
  showInfo(it);
  document.querySelectorAll('.item.active').forEach((e) => e.classList.remove('active'));
  const row = document.querySelector(`.item[data-id="${id}"]`);
  if (row) {
    row.classList.add('active');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if (fly) {
    const dist = clamp(it.top * 3.2 + 16, 22, 120);
    flyTo(it.pos.clone().setY(it.pos.y + it.top * 0.45), dist, 62, (Math.random() * 40 - 20 + 25) * Math.PI / 180);
  }
}

/* ==================== 相机飞行 ==================== */
// 预分配临时对象：飞行期间每帧执行本函数，任何 clone()/new 都是白白的 GC 压力
const _sph = new THREE.Spherical();
const _off = new THREE.Vector3();
const _tgt = new THREE.Vector3();
function flyTo(targetPos, dist, polarDeg, azimuthRad, dur = 1500) {
  const now = performance.now();
  const off = camera.position.clone().sub(controls.target);
  const sph0 = new THREE.Spherical().setFromVector3(off);
  const sph1 = new THREE.Spherical(dist, THREE.MathUtils.degToRad(clamp(polarDeg, 5, 88)), azimuthRad);
  // 取最短角路径
  let da = sph1.theta - sph0.theta;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  anim = {
    t0: now, dur, sph0, sph1, da,
    from: controls.target.clone(), to: targetPos.clone(),
  };
  controls.autoRotate = false;
  $('#tgSpin').classList.remove('active');
}

/** 直接落位（不播动画）：与 flyTo 同一套球坐标约定，供 ?gate= 这类链接打开即所见 */
function placeCamera(targetPos, dist, polarDeg, azimuthRad) {
  anim = null;
  _sph.set(dist, THREE.MathUtils.degToRad(clamp(polarDeg, 5, 88)), azimuthRad);
  _off.setFromSpherical(_sph);
  controls.target.copy(targetPos);
  camera.position.copy(targetPos).add(_off);
  camera.lookAt(targetPos);
  controls.update();
}

/** 城门视角落位：与模型共用墙外法向，按等比后的实际体量取景（?gate= 深链与巡检钩子共用）。
 *  门体等比 1:30 后：机位抬高 vU(8)，视距按体量 ×3.33。 */
function gotoGateView(gt) {
  const [gx, gz] = toV2(gt.lon, gt.lat);
  const fr = gateFrame(gt);
  placeCamera(new THREE.Vector3(gx, Math.max(-.05, terrainHeight(gx, gz) - .05) + vU(8), gz),
    gt.name === '中华门' ? 9.33 : gt.court ? 7 : 4.33, 68,
    Math.atan2(fr.normal[0] * fr.zOut, fr.normal[1] * fr.zOut));
}

function updateAnim() {
  if (!anim) return false;
  const t = clamp((performance.now() - anim.t0) / anim.dur, 0, 1);
  const e = easeInOutCubic(t);
  const r = lerp(anim.sph0.radius, anim.sph1.radius, e);
  const p = lerp(anim.sph0.phi, anim.sph1.phi, e);
  const a = anim.sph0.theta + anim.da * e;
  _tgt.copy(anim.from).lerp(anim.to, e);
  _off.setFromSpherical(_sph.set(r, p, a));
  camera.position.copy(_tgt).add(_off);
  controls.target.copy(_tgt);
  if (t >= 1) anim = null;
  return true;
}

/* ==================== 拾取 ==================== */
// 直接对几百个地标 mesh 做 raycast，鼠标每移动一次就要测试数万个三角形，是最容易被忽略的卡顿源。
// 因此每个地标生成一个不参与渲染的包围盒代理：
//   · 悬停（决定光标样式）只用代理，22 次盒测试即可
//   · 点击先用代理粗筛，再对命中的那一个地标做精确 raycast，保证选中不糊
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let down = null;
const pickProxies = [];        // { mesh, id, meshes: [] }
const proxyMeshes = [];        // 缓存 flat 列表，避免每次悬停都新建数组
const proxyMat = new THREE.MeshBasicMaterial();

function setRay(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
}

function buildPickProxies() {
  pickProxies.length = 0;
  proxyMeshes.length = 0;
  for (const it of landmarkItems) {
    const box = new THREE.Box3().setFromObject(it.group);
    if (!Number.isFinite(box.min.x) || box.isEmpty()) continue;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // 略微收进一点点，避免相邻地标的代理互相重叠导致误判
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), proxyMat);
    proxy.position.copy(center);
    proxy.visible = false;      // 不渲染；three 的 raycast 不看 visible，仍会被命中
    proxy.updateMatrixWorld();
    proxy.userData.lid = it.id;
    scene.add(proxy);
    const meshes = [];
    it.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    pickProxies.push({ mesh: proxy, id: it.id, meshes });
    proxyMeshes.push(proxy);
  }
}

/** 粗拾取：只打代理盒，返回地标 id 与其精确 mesh 列表 */
function pickCoarse(ev) {
  setRay(ev);
  const hits = ray.intersectObjects(proxyMeshes, false);
  if (!hits.length) return null;
  return pickProxies.find((p) => p.mesh === hits[0].object) || null;
}

function pick(ev) {
  const coarse = pickCoarse(ev);
  if (!coarse) return null;
  if (!coarse.meshes.length) return coarse.id;
  const hits = ray.intersectObjects(coarse.meshes, false);
  return hits.length ? coarse.id : null;   // 点在代理盒空隙里就不算选中
}

function pickHover(ev) {
  const coarse = pickCoarse(ev);
  return coarse ? coarse.id : null;
}

canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const dt = performance.now() - down.t;
  down = null;
  if (moved > 6 || dt > 500) return;
  const id = pick(e);
  if (id) selectById(id, true);
  else {
    activeId = null;
    $('#infoCard').classList.add('hidden');
    document.querySelectorAll('.item.active').forEach((el) => el.classList.remove('active'));
  }
});
let hoverPending = null;
canvas.addEventListener('pointermove', (e) => {
  if (down) return;
  hoverPending = e;   // 到下一帧再算，避免一次移动里多次 pointermove 反复 raycast
});
function flushHover() {
  if (!hoverPending) return;
  const e = hoverPending;
  hoverPending = null;
  canvas.style.cursor = pickHover(e) ? 'pointer' : 'grab';
}

/* ==================== 小地图 ==================== */
const mm = $('#minimap');
const mctx = mm.getContext('2d');
const MM_EXT = 150; // 场景单位半幅
const RIVER_PTS = toV2List(RIVER.pts);
const WALL_PTS = toV2List(CITY_WALL);

const mm2px = (p) => [
  ((p[0] + MM_EXT) / (MM_EXT * 2)) * mm.width,
  ((p[1] + MM_EXT) / (MM_EXT * 2)) * mm.height,
];
const px2mm = (x, y) => [
  (x / mm.width) * MM_EXT * 2 - MM_EXT,
  (y / mm.height) * MM_EXT * 2 - MM_EXT,
];

/* 小地图静态层（片区 / 长江 / 城墙）只画一次，之后每帧 drawImage 复用。
 * 此前每 0.2 s 全量重绘 393 段路网折线，其中 95% 的像素与上一帧完全相同。 */
const mmStatic = document.createElement('canvas');
mmStatic.width = mm.width; mmStatic.height = mm.height;
const sctx = mmStatic.getContext('2d');
function renderStaticMinimap() {
  const w = mm.width, h = mm.height;
  sctx.clearRect(0, 0, w, h);
  sctx.fillStyle = '#eef1f3';
  sctx.fillRect(0, 0, w, h);

  // 片区
  sctx.fillStyle = 'rgba(150,165,150,.22)';
  for (const d of DISTRICTS) {
    const c = toV2(d.lon, d.lat);
    const px = mm2px(c);
    sctx.save();
    sctx.translate(px[0], px[1]);
    sctx.rotate(-(d.rot * Math.PI) / 180);
    sctx.fillRect(-((d.w * 10) / (MM_EXT * 2)) * w / 2, -((d.d * 10) / (MM_EXT * 2)) * h / 2,
      ((d.w * 10) / (MM_EXT * 2)) * w, ((d.d * 10) / (MM_EXT * 2)) * h);
    sctx.restore();
  }

  // 长江
  sctx.strokeStyle = '#5c9bc0';
  sctx.lineWidth = 5;
  sctx.lineJoin = 'round';
  sctx.beginPath();
  RIVER_PTS.forEach((p, i) => {
    const q = mm2px(p);
    if (i === 0) sctx.moveTo(q[0], q[1]); else sctx.lineTo(q[0], q[1]);
  });
  sctx.stroke();

  // 城墙
  sctx.strokeStyle = 'rgba(150,120,90,.85)';
  sctx.lineWidth = 1.2;
  sctx.beginPath();
  WALL_PTS.forEach((p, i) => {
    const q = mm2px(p);
    if (i === 0) sctx.moveTo(q[0], q[1]); else sctx.lineTo(q[0], q[1]);
  });
  sctx.closePath();
  sctx.stroke();
}
renderStaticMinimap();

function drawMinimap() {
  mctx.clearRect(0, 0, mm.width, mm.height);
  mctx.drawImage(mmStatic, 0, 0);

  // 地标
  for (const it of landmarkItems) {
    const q = mm2px([it.pos.x, it.pos.z]);
    mctx.fillStyle = CAT_COLOR[it.cat] || '#666';
    mctx.beginPath();
    mctx.arc(q[0], q[1], it.id === activeId ? 3.6 : 2, 0, Math.PI * 2);
    mctx.fill();
    if (it.id === activeId) {
      mctx.strokeStyle = '#fff';
      mctx.lineWidth = 1.2;
      mctx.stroke();
    }
  }

  // 相机
  const cq = mm2px([camera.position.x, camera.position.z]);
  const tq = mm2px([controls.target.x, controls.target.z]);
  const ang = Math.atan2(tq[1] - cq[1], tq[0] - cq[0]);
  mctx.fillStyle = 'rgba(192,69,47,.16)';
  mctx.beginPath();
  mctx.moveTo(cq[0], cq[1]);
  mctx.arc(cq[0], cq[1], 22, ang - 0.5, ang + 0.5);
  mctx.closePath();
  mctx.fill();
  mctx.fillStyle = '#c0452f';
  mctx.beginPath();
  mctx.arc(cq[0], cq[1], 3, 0, Math.PI * 2);
  mctx.fill();
}

mm.addEventListener('click', (e) => {
  const r = mm.getBoundingClientRect();
  const [x, z] = px2mm(e.clientX - r.left, e.clientY - r.top);
  const off = camera.position.clone().sub(controls.target);
  const y = Math.max(3, terrainHeight(x, z));
  flyTo(new THREE.Vector3(x, y, z), clamp(off.length() * 0.55, 25, 220), 58, Math.atan2(off.x, off.z));
});

/* ==================== UI ==================== */
function bindUI() {
  const slider = $('#timeSlider');
  slider.addEventListener('input', () => {
    autoTime = false;
    $('#tgAuto').classList.remove('active');
    applyTime(parseFloat(slider.value));
  });
  document.querySelectorAll('[data-time]').forEach((b) => {
    b.addEventListener('click', () => {
      autoTime = false;
      $('#tgAuto').classList.remove('active');
      const v = parseFloat(b.dataset.time);
      slider.value = v;
      applyTime(v);
    });
  });

  const toggle = (id, fn) => {
    const el = $(id);
    el.addEventListener('click', () => {
      const on = !el.classList.contains('active');
      el.classList.toggle('active', on);
      fn(on);
    });
  };
  toggle('#tgLabels', (on) => {
    $('#labels').style.display = on ? 'block' : 'none';
  });
  toggle('#tgCars', (on) => { cars.group.visible = on; });
  toggle('#tgShadow', (on) => { renderer.shadowMap.enabled = on; scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; }); });
  toggle('#tgAuto', (on) => { autoTime = on; });
  toggle('#tgSpin', (on) => { controls.autoRotate = on; });

  $('#btnGrow').addEventListener('click', () => { grow = 0; });
  $('#btnReset').addEventListener('click', () => {
    activeId = null;
    $('#infoCard').classList.add('hidden');
    flyTo(new THREE.Vector3(0, 4, 0), 330, 55, Math.PI * 0.28, 1600);
  });
  $('#btnFull').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  });
  $('#btnCollapse').addEventListener('click', () => document.body.classList.toggle('collapsed'));
  $('#btnHelp').addEventListener('click', () => $('#help').classList.toggle('hidden'));
  $('#helpClose').addEventListener('click', () => $('#help').classList.add('hidden'));
  $('#infoClose').addEventListener('click', () => $('#infoCard').classList.add('hidden'));
  $('#btnFly').addEventListener('click', () => { if (activeId) selectById(activeId, true); });
  $('#btnOrbit').addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    $('#tgSpin').classList.toggle('active', controls.autoRotate);
  });
  // 搜索：README 承诺「按名称、英文名或标签检索」，这里三处都要匹配
  const searchEl = $('#search');
  searchEl.addEventListener('input', () => filterList(searchEl.value));
  searchEl.addEventListener('keydown', (e) => {
    // 回车直达第一个命中项，免去伸手去点列表
    if (e.key !== 'Enter') return;
    const first = document.querySelector('.item:not([style*="display: none"])');
    if (first) { selectById(first.dataset.id, true); searchEl.blur(); }
  });

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#infoCard').classList.add('hidden');
      $('#help').classList.add('hidden');
    }
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  vw = window.innerWidth; vh = window.innerHeight;
  drawMinimap();
}

/* ==================== 自适应分辨率 ==================== */
// 兜底策略：帧率持续偏低就下调渲染倍率，恢复后再逐步升回来。
// 与其让用户在低帧率里卡着操作，不如牺牲一点锐度换取流畅。
// 倍率 ladder 作用在「基准 DPR」之上，而不是直接等于 DPR：
// 否则在 devicePixelRatio=1 的普通屏上 Math.min(step, 1) 恒等于 1，整条降档阶梯形同虚设，
// 卡顿时反而无处可降。现在低端能下探到 0.62 倍原生分辨率。
const RES_STEPS = [0.62, 0.75, 0.88, 1.0, 1.15];
const RES_BASE = Math.min(window.devicePixelRatio || 1, 1.5);
let resIdx = 3;                        // 从 1.0 档（= RES_BASE）起步
let lowStreak = 0, highStreak = 0;
function applyResolution(idx) {
  resIdx = clamp(idx, 0, RES_STEPS.length - 1);
  const target = Math.max(0.5, RES_BASE * RES_STEPS[resIdx]);
  if (Math.abs(renderer.getPixelRatio() - target) < 0.01) return;
  renderer.setPixelRatio(target);
  renderer.setSize(window.innerWidth, window.innerHeight);
}
function adaptResolution(fps) {
  if (fps < 34) { lowStreak++; highStreak = 0; } else if (fps > 56) { highStreak++; lowStreak = 0; } else { lowStreak = highStreak = 0; }
  if (lowStreak >= 2 && resIdx > 0) { applyResolution(resIdx - 1); lowStreak = 0; }
  else if (highStreak >= 6 && resIdx < RES_STEPS.length - 1) { applyResolution(resIdx + 1); highStreak = 0; }
}

/* ==================== 阴影按需更新 ==================== */
// 默认每帧都要把整个场景再画一遍进 shadow map。这里关掉自动更新，
// 只在「太阳方向 / 相机 / 焦点 / 阴影视锥」真的变了时才补画一次 ——
// 相机停住时（看信息卡、读数据）这一遍开销直接归零。
const shadowPrev = { sun: new THREE.Vector3(9, 9, 9), cam: new THREE.Vector3(), tgt: new THREE.Vector3(), d: 0 };
function updateShadowOnDemand() {
  renderer.shadowMap.autoUpdate = false;
  const moved = shadowPrev.cam.distanceToSquared(camera.position) > 0.0025
    || shadowPrev.tgt.distanceToSquared(controls.target) > 0.0025
    || shadowPrev.sun.distanceToSquared(sunDir) > 1e-6
    || Math.abs(shadowPrev.d - shadowState.d) > 0.5;
  if (moved) {
    shadowPrev.cam.copy(camera.position);
    shadowPrev.tgt.copy(controls.target);
    shadowPrev.sun.copy(sunDir);
    shadowPrev.d = shadowState.d;
    renderer.shadowMap.needsUpdate = true;
    shadowsSettled = false;
  }
}
let shadowsSettled = false;

/* ==================== 主循环 ==================== */
let frames = 0, acc = 0, mmAcc = 0;

// 冷却 + 停手：四十毫秒级的 PMREM 烘焙不能打断交互。
// ① 冷却：任意两次烘焙至少隔 ENV_COOLDOWN；
// ② 停手：拖时间滑块时静止满 ENV_SETTLE 才动；
// ③ 漂移：自动走时永不静止，改用累计跨度兜底，避免 IBL 停在旧太阳上。
const ENV_COOLDOWN = 1200;
const ENV_SETTLE = 200;
const ENV_DRIFT = 0.5;
function flushEnv(nowMs) {
  if (envPending === null || !env) { envPending = null; return; }
  if (nowMs - lastEnvMs <= ENV_COOLDOWN) return;
  const settled = nowMs - lastTimeChangeMs > ENV_SETTLE;
  const drifted = Math.abs(envPending - lastEnvHours) >= ENV_DRIFT;
  if (!envReady || settled || drifted) {
    lastEnvHours = envPending;
    applyEnv(envPending);
    envPending = null;
  }
}
function loop() {
  // 注意：这里不能再写 requestAnimationFrame(loop)。
  // 主循环由 renderer.setAnimationLoop(loop) 驱动，它内部已经有一条自续期的
  // requestAnimationFrame 链（见 WebGLAnimation.onAnimationFrame）；两条链并存会
  // 让每帧的回调数逐帧累加 —— 第 n 帧就要渲染 n 次，页面必然越跑越卡。
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  const nowMs = performance.now();

  if (autoTime) {
    applyTime((timeHours + dt * 0.35) % 24);
    elTimeSlider.value = timeHours;
  }
  // 共享环境贴图重烘焙（PMREM）要几十毫秒，必须节流：
  // applyTime 只登记待办，真正的烘焙时机由 flushEnv() 裁决。
  flushEnv(nowMs);
  if (grow < 1) {
    grow = Math.min(1, grow + dt * 0.42);
    city.setGrowth(grow);
  }
  if (waterMat) waterMat.uniforms.uTime.value = t;
  if (cars) cars.update(dt, cars.group.visible);
  if (props) props.update(dt);   // 红绿灯灯珠按 signals.js 相位变色（与车流停车共用真值）
  if (peds) peds.update(dt);
  if (ferry) ferry.update(dt);
  flushHover();

  const animating = updateAnim();
  if (!animating) controls.update();
  updateShadowFocus();   // 阴影视锥跟随焦点距离（街景收紧 / 航拍放宽）
  updateShadowOnDemand();

  // 水面陆游载体
  for (const it of landmarkItems) {
    for (const b of it.floaters) b.position.y = 0.36 + Math.sin(t * 1.2 + it.pos.x) * 0.06;
    if (it.tick) it.tick(t, dt);        // 地标逐帧动画（航空障碍灯闪烁等）
  }

  updateLabels();

  mmAcc += dt;
  if (mmAcc > 0.2) { drawMinimap(); mmAcc = 0; }

  acc += dt; frames++;
  if (acc > 0.6) {
    const fps = Math.round(frames / acc);
    $('#statFps').textContent = `${fps} FPS`;
    $('#statCam').textContent = `视距 ${Math.round(camera.position.distanceTo(controls.target))}u ≈ ${(camera.position.distanceTo(controls.target) / 10).toFixed(1)}km`;
    adaptResolution(fps);
    frames = 0; acc = 0;
  }

  architecturalLights.update(camera);
  renderer.render(scene, camera);
}

/* ==================== 启动 ==================== */
(async function main() {
  await build();
  bindUI();
  renderer.setAnimationLoop(loop);
  // 开场：城市由地平线生长
  grow = 0;
  // URL 参数：?t=22.5 指定时刻；?lm=nanjingeye 指定地标；?gate=神策门 指定城门视角
  // （二者可组合，便于分享"某时刻 + 某处"的链接，也便于无交互地截图自检）
  let lmParam = 'zifeng';
  let gateParam = '';
  let camParam = '';
  let openFlight = true;
  try {
    const q = new URLSearchParams(location.search);
    const tParam = parseFloat(q.get('t'));
    if (Number.isFinite(tParam)) {
      timeHours = clamp(tParam, 0, 24);
      applyTime(timeHours);
      elTimeSlider.value = timeHours;
    }
    if (q.get('lm') !== null) lmParam = q.get('lm');
    // ?gate=神策门 —— 城门视角（现/复建门看见城台券门，遗址门看见豁口与文保台基）
    if (q.get('gate')) gateParam = q.get('gate');
    // 调试机位 ?cam=<lon>,<lat>,<高m>,<视距?> —— 临时用于贴脸看墙面材质
    if (q.get('cam')) camParam = q.get('cam');
  } catch (e) {}

  // 城门视角与模型共用墙外法向，按等比后的实际体量取景。
  const gateSel = CITY_GATES.find((g2) => g2.name === gateParam);
  if (gateSel) {
    // 指定了城门就直接落位（不放开场动画），保证链接打开即所见
    gotoGateView(gateSel);
    openFlight = false;
  }
  let camSel = false;
  if (camParam) {
    const c = camParam.split(',').map(Number);
    if (c.length === 6 && c.every(Number.isFinite)) {
      const [cx, cz] = toV2(c[0], c[1]);
      placeCamera(new THREE.Vector3(cx, c[2], cz), c[3], c[4], (c[5] * Math.PI) / 180);
      openFlight = false;
      camSel = true;
    }
  }
  if (openFlight) flyTo(new THREE.Vector3(0, 4, 0), 420, 46, Math.PI * 0.28, 2600);
  if (lmParam !== 'none' && !gateSel && !camSel) setTimeout(() => selectById(lmParam, true), 700);

  // 无头巡检钩子（tools/tour.mjs）：一页多 POI 免刷新导航。
  // 用 placeCamera 而非 flyTo —— selectById 的方位角带随机，截图不可复现；
  // 赋值先于遮罩收起，waitForSelector('#loading.done') 命中时 API 必已就绪。
  // 无头自检用：射线查「某个坐标最上面那层是谁」。tools/roadcheck.mjs 的渲染复核靠它，
  // 也是排查「路面被盖住」这类只能在 GPU 上复现的问题的唯一入口（射线走 CPU，看到的和
  // 屏幕上的可以不一致 —— 地面遮住路面那次就是这么定位的）。
  window.__njScene = scene;
  window.__njTHREE = THREE;
  window.__njCamera = camera;
  window.__njCars = cars;   // 巡检:车流智能对象(debug 聚合统计 / queueAt 单路口队列)
  window.__njSignals = () => props?.junctions || [];   // 巡检:信号路口坐标表(traffic-check 取景用)
  window.__njBulbs = () => props?.bulbDebug();         // 巡检:灯珠亮色(traffic-check 断言翻色用)
  window.__njPeds = peds;                              // 巡检:行人门控(debug 三态计数 / violations 安全不变量)
  // 无头取景入口:直接 set camera.position 会被 OrbitControls 的内部球坐标每帧拉回,
  // 必须走 placeCamera(同步写 controls.target)。shot/traffic-check 共用。
  window.__njCam = (x, y, z, dist, polarDeg, azimuthDeg = 40) =>
    placeCamera(new THREE.Vector3(x, y, z), dist, polarDeg, azimuthDeg * Math.PI / 180);
  // 无头验收用确定性快进:车流物理/灯珠相位/行人门控同 tick 推进(headless rAF 只有 ~5fps,墙钟等不起 26s 周期)
  window.__njSimTick = (secs, step = 0.05) => {
    let n = Math.round(secs / step);
    while (n--) { cars?.update(step, true); props?.update?.(step); peds?.update?.(step); }
  };
  window.__njTour = {
    ready: true,
    pois: [...landmarkItems.map((i) => i.id), ...CITY_GATES.map((g) => 'gate:' + g.name)],
    setTime(h) {
      autoTime = false;
      $('#tgAuto').classList.remove('active');
      applyTime(clamp(h, 0, 24));
      elTimeSlider.value = h;
    },
    goto(id) {
      $('#hint').classList.add('fade');   // 巡检不等 9 秒提示条淡出
      if (id.startsWith('gate:')) {
        const gt = CITY_GATES.find((g) => g.name === id.slice(5));
        if (!gt) return false;
        $('#infoCard').classList.add('hidden');
        gotoGateView(gt);
        return true;
      }
      const it = landmarkItems.find((i) => i.id === id);
      if (!it) return false;
      selectById(id, false);              // 信息卡 + 列表高亮，不播飞行
      const dist = clamp(it.top * 3.2 + 16, 22, 120);   // 与 selectById 同取景公式，方位角固定
      placeCamera(it.pos.clone().setY(it.pos.y + it.top * 0.45), dist, 62, 25 * Math.PI / 180);
      return true;
    },
  };
  // 带参数打开的是"某时刻 + 某处"的直达链接：开场遮罩直接撤掉，不做淡出，
  // 打开即所见（也让无交互截图自检拿到的就是最终画面）
  const direct = !!gateSel || lmParam !== 'zifeng' || location.search.length > 1;
  const elLoad = $('#loading');
  if (direct) elLoad.style.transition = 'none';
  setTimeout(() => elLoad.classList.add('done'), direct ? 0 : 700);
  // 操作提示只在刚进入时有引导价值，读完即淡出，不长期占用底部视线
  setTimeout(() => $('#hint').classList.add('fade'), 9000);
})();
