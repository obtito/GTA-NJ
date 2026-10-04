// 构建冒烟测试（Node）：不依赖浏览器 DOM，验证数据→几何管线无异常
// 并逐项校验「地标模型高度 vs data.js 声明的实测高度」，误差 > 8% 视为失真。
const w = await import('../js/world.js');
const c = await import('../js/city.js');
const l = await import('../js/landmarks.js');
const THREE = await import('three');

// 旋转体的 Box3 会把「局部 AABB 的 8 个角」整体变换，倾斜 35° 的球体会虚增约 25%。
// 因此这里改用真实顶点求最高点，避免误判。
// 注意：InstancedMesh 的实例位置/缩放在 instanceMatrix 里，必须逐实例变换，
// 否则会把单位立方体顶点 (y≈1) 当成实例最高点，造成虚假超差。
function vertexTop(obj, baseY) {
  const v = new THREE.Vector3();
  const im = new THREE.Matrix4();
  let maxY = -Infinity;
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    if (o.isInstancedMesh) {
      const attr = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
      if (!attr) return;
      const n = attr.count;
      for (let ii = 0; ii < o.count; ii++) {
        o.getMatrixAt(ii, im);
        const world = new THREE.Matrix4().multiplyMatrices(o.matrixWorld, im);
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(attr, i).applyMatrix4(world);
          if (v.y > maxY) maxY = v.y;
        }
      }
    } else if (o.isMesh || o.isLineSegments) {
      const attr = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
      if (!attr) return;
      const idx = o.geometry.index;
      const n = idx ? idx.count : attr.count;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(attr, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
        if (v.y > maxY) maxY = v.y;
      }
    }
  });
  return Number.isFinite(maxY) ? maxY - baseY : -Infinity;
}

function report(name, obj) {
  let meshes = 0, tris = 0;
  if (obj && obj.traverse) {
    obj.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh || o.isLineSegments) {
        meshes++;
        const g = o.geometry;
        if (g && g.index) tris += (g.index.count / 3) * (o.isInstancedMesh ? o.count : 1);
        else if (g && g.attributes.position) tris += (g.attributes.position.count / 3) * (o.isInstancedMesh ? o.count : 1);
      }
    });
  }
  console.log(name.padEnd(12) + ' meshes=' + String(meshes).padStart(5) + ' tris≈' + Math.round(tris).toLocaleString());
  return { meshes, tris };
}

// 高度依赖客观地形走向的组合（山体/轴线），几何顶面必然包含地形抬升，放宽校验
const SLOPE = new Set(['mausoleum', 'tomb', 'mountainref', 'wallmark']);

console.log('=== GTA-NJ 构建冒烟测试 ===');
const ground = w.buildGround();
report('地面', ground.mesh);
const mts = w.buildMountains();
report('山体', mts.group);
const wm = w.createWaterMaterial();
const water = w.buildWater(wm);
report('水体', water);

const lm = l.buildLandmarks();
report('地标', lm.group);
console.log('地标点数=' + lm.items.length + ' 排除区=' + lm.exclusions.length);

console.log('');
console.log('--- 地标高度校验（模型顶点 vs data.js 实测高度）---');
console.log('（山峰/陵寝轴线/城墙这类以地形为基准的群组，几何顶面必然含自然地形抬升，标记为「组群」不做比对）');
let warn = 0;
for (const it of lm.items) {
  const modelM = Math.max(vertexTop(it.group, it.group.position.y) * (it.metersPerUnit || 30), 0);
  const refM = it.heightM || 0;
  const isGroup = SLOPE.has(it.model);
  const tol = isGroup ? 999 : 0.08;
  const exact = isGroup ? '组群' : (refM ? (((modelM - refM) / refM) * 100).toFixed(1) + '%' : '?');
  let mark = 'OK  ';
  if (!isGroup && refM && Math.abs(modelM - refM) / refM > tol) { mark = 'WARN'; warn++; }
  console.log(
    mark + ' ' + it.id.padEnd(15) + it.model.padEnd(14) +
    ' 模型=' + String(Math.round(modelM)).padStart(4) + 'm' +
    ' 实测=' + String(refM).padStart(6) + 'm' +
    ' 偏差=' + String(exact).padStart(7) +
    '  pos=(' + it.pos.x.toFixed(1) + ',' + it.pos.z.toFixed(1) + ')',
  );
}
console.log(warn ? '!! 共 ' + warn + ' 项超出 8% 容差' : '全部地标均与实测数据吻合（容差 8%）');

// 地标逐帧动画与夜景分支（长江大桥列车 / 桥灯 / 航空障碍灯等）
{
  let ticked = 0, nighted = 0;
  for (const it of lm.items) {
    if (it.tick) { it.tick(1.2, 0.016); ticked++; }
    if (it.setNight) { it.setNight(1); nighted++; }
  }
  console.log('地标动画钩子：tick=' + ticked + ' setNight=' + nighted);
}

console.log('');
const grid = c.districtGridLines();
console.log('片区路网线段=' + grid.length);

// 城墙与城门：曾因未被 smoke 覆盖，运行时的 ReferenceError(hU 未导入) 只在浏览器里爆发
const wall = w.buildWall();
report('城墙', wall.group);

// 城门：现存/复建出券门+城台，遗址门只留豁口与文保台基
const gm = await import('../js/gates.js');
const gates = gm.buildGates();
gates.setNight(1);          // 夜间亮化分支也要跑一遍（灯带 opacity / 窗光 emissive）
report('城门', gates.group);
const gateRoads = gm.gateRoadLines();
console.log('穿门道路=' + gateRoads.length + ' 条（通行门沿墙线法向铺路）');

const roads = w.buildRoads([...grid, ...gateRoads]);
report('道路', roads.mesh);

const city = c.buildCity({ exclusions: lm.exclusions });
report('楼群', city.group);
console.log('建筑实例=' + city.count);
city.setGrowth(1);
city.setNight(1);

const trees = c.buildTrees({ exclusions: lm.exclusions });
report('行道树', trees.group);

const cars = await c.buildCars(roads.centerlines, 60);   // async:GLB 车模,node 下走方块回退分支
cars.update(0.016, true);
cars.setNight(1);              // 车灯分支：头灯带/尾灯带 emissiveIntensity 也要跑到
report('车流', cars.group);

// 行人 Phase 2（红绿灯门控）：junctions 来自 props（node 下 GLB 缺失，但路口几何在装载前已算好）。
// 行人步速 ~0.035 u/s，30s 只走 1u 到不了门——跑 300 sim-s（6000 tick）统计三态峰值才有意义。
let hardFail = 0;   // 行人块的断言是硬门槛（其他块的 '!!' 多为观察性）：退化必须让退出码非 0 才接得了 CI
{
  const pm = await import('../js/props.js');
  const props = await pm.buildStreetProps({ centerlines: roads.centerlines, exclusions: lm.exclusions });
  const pd = await import('../js/pedestrians.js');
  const peds = pd.buildPedestrians({ centerlines: roads.centerlines, exclusions: lm.exclusions });
  peds.setSignals(props.junctions);
  let maxWait = 0, maxCross = 0, maxViol = 0;
  for (let k = 0; k < 6000; k++) {
    peds.update(0.05);
    if ((k & 15) === 0) {   // 每 0.8s 采样一次足够抓峰值（三态停留都 ≥ 数秒）
      const d = peds.debug();
      if (d.waiting > maxWait) maxWait = d.waiting;
      if (d.crossing > maxCross) maxCross = d.crossing;
      if (peds.violations() > maxViol) maxViol = peds.violations();
    }
  }
  report('行人', peds.group);
  const fin = peds.debug();
  console.log(`行人门控：${fin.linePeds} 线上人 / ${fin.gates} 门 / 300s 峰值 waiting=${maxWait} crossing=${maxCross} violations=${maxViol}`);
  if (!fin.gates) { console.log('!! 行人门控为 0：junctions 没接上（props 侧路口求交空转？）'); hardFail++; }
  else if (maxWait === 0) { console.log('!! 300s 内无人等灯：门控未生效'); hardFail++; }
  else if (maxCross === 0) { console.log('!! 300s 内无人过街：放行判据永不满足（死锁）'); hardFail++; }
  if (fin.nan) { console.log('!! 行人坐标 NaN：' + fin.nan); hardFail++; }
  if (maxViol > 0) { console.log('!! 安全不变量失守：绿灯期穿越走廊 ' + maxViol + ' 人次'); hardFail++; }
}

// 主干道路灯（GTA-WH 夜景移植）：实例规模 + 夜间分支回归。
// 阈值 w>=0.35 全部 13 条主干入选；跨江/夹江段按 distToPolyline 跳过。
const lights = c.buildStreetLights(roads.centerlines, roads.surfaceAt);
lights.setNight(1);
report('路灯', lights.group);
if (lights.count > 1000) console.log('路灯实例=' + lights.count + '（预期 ~2500，已跳过水域段）');
else console.log('!! 路灯实例异常偏少：' + lights.count);

// 中山码头—浦口轮渡：班轮往返，单步推进不抛、折返钳制生效
const tr = await import('../js/transit.js');
const ferry = tr.buildFerry();
ferry.update(0.016);
report('轮渡', ferry.group);

console.log('');
console.log('--- 城市级烘焙 AO（移植自 GTA_SZ）---');
const amb = await import('../js/ambient.js');
const occ = amb.collectOccluders(city, lm.items);
const t0 = Date.now();
const info = amb.bakeCityAmbient(occ);
const dt = Date.now() - t0;
console.log(
  '遮挡体=' + occ.length +
  ' 栅格=' + (info ? info.width + '×' + info.height : '-') +
  ' 有效单元=' + (info ? info.activeCells.toLocaleString() : 0) +
  ' 平均天空可见度=' + (info ? info.meanVisibility.toFixed(3) : '-') +
  ' 耗时=' + dt + 'ms',
);
if (!info) console.log('!! AO 未生成');
else {
  console.log(
    '地面通道可见度分位： p05=' + info.p05.toFixed(3) + '（深巷/塔基）  p50=' + info.p50.toFixed(3) +
    '（一般街道）  p95=' + info.p95.toFixed(3) + '（开阔地）',
  );
  if (info.meanVisibility > 0.99) console.log('!! AO 场几乎全亮，烘焙可能未生效');
  else console.log('AO 场已生成（数值越低表示该处越被城市遮挡）');
}

console.log('=== 通过 ===');
process.exit(hardFail ? 1 : 0);   // 行人门控等硬门槛失守时以非 0 退出（tour 同款，可接 CI）
