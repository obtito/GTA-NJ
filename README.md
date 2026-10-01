# GTA-NJ · 南京 3D 可交互城市场景

以 Three.js 手写的南京城市三维沙盘。参考 [GTA_SZ](https://github.com/linranff/GTA_SZ) 的做法：城市底图程序化生成，
**地标单独精构建**，并在其占地范围内排除程序化底商建筑。

无构建步骤、无 CDN 依赖 —— 用任意静态服务器打开 `index.html` 即可。

```bash
python -m http.server 8080     # 或任意静态服务器
# 打开 http://localhost:8080/
```

> 必须通过 HTTP 访问（`type="module"` 的跨域限制），直接双击 `file://` 打开无法加载。

---

## 目录结构

```
index.html          页面骨架 + importmap（three / OrbitControls / Sky 映射到 vendor/）
css/style.css       浅色玻璃拟态 UI
js/
  geo.js            经纬度换算、随机与噪声、太阳状态 sunState()
  lib.js            材质缓存、程序化贴图、shader 补丁叠加、实例化方块群、环境强度登记
  world.js          地形、山体、长江水面自定义着色器、道路
  city.js           片区网格、程序化楼群（含裙房/退台）、行道树、车流
  landmarks.js      22 处地标的几何构建器（现代塔楼走 OSM 真实轮廓；古典/亭台走 arch.js）
  arch.js           中式建筑高保真构件库：举折/反宇/翼角高度场 + 正脊/戗脊/正吻/斗拱/须弥座/攒尖宝顶
  ambient.js        城市级烘焙环境光遮蔽（移植自 GTA_SZ city-ambient-bake/occlusion）
  environment.js    共享 HDR 环境：程序化天空 → PMREM → scene.environment
  data.js           地标的经纬度 / 实测数据 / 构建参数（唯一数据源，UI 直接读取）
  main.js           场景装配、渲染、交互、UI 绑定
vendor/             three.module.js · OrbitControls.js · Sky.js（本地化，离线可用）
tools/
  smoke.mjs         Node 构建冒烟测试 + 地标高度校验
  debugtop.mjs      诊断：列出每个地标最高的若干构件
  check.mjs         静态语法预检（纯解析，不执行；防止改动导致整页白屏）
  osm/             OpenStreetMap 实测外轮廓（紫峰主楼 8 点切角三角、中华门/总统府/老门东/新街口/中山陵等）
```

---

## 尺度约定

场景用 **两套**水平/竖向比例，这是为了在「看得见山形」与「单体不失真」之间取得平衡：

| 记号 | 含义 | 换算 | 用途 |
| --- | --- | --- | --- |
| `vU(m)` | 竖向 | 1 单位 = 30 m | 所有高度，统一 3.33 倍竖向夸张 |
| `hU(m)` | 水平·组群 | 1 单位 = 100 m | 组群平面、轴线长度、桥跨、场地直径 |
| `footU(m)` | 水平·单体 | 1 单位 = 30 m | **仅**用于单件竖立物（塔、楼、碑、华表、单体大殿）自身平面 |

规则：**凡有明确轴线 / 超大平台的组群一律用 `hU`**，避免同一组内两套比例尺打架；
单件竖立物用 `footU`，使其长宽比与真实一致。

地理换算（`js/geo.js`）：原点 `118.7550°E, 32.0550°N`，北 = −Z。
投影为**以原点为中央子午线的横轴墨卡托（高斯-克吕格，WGS84 椭球）**——
早期的「固定 km/度」平面近似会让东西向距离系统性偏短 0.109%（最差点对 25 m），
改用正经投影后，全场景点对距离与 Vincenty 椭球大地线的偏差降到 **0.0 m**（见 `tools/geocheck.mjs`）。

---

## 光影与细节：移植自 GTA_SZ 的四项技法

GTA_SZ 是 Babylon 实现，这里按 Three.js 的等价能力逐项落地。四项技法都在同一条原则下：
**能离线预计算的绝不放到运行时逐帧算**。

### 1. 城市级烘焙环境光遮蔽 · `js/ambient.js`

> 屏幕空间 AO 只能覆盖几米范围、太阳阴影又受 shadow box 限制，真正缺的是
> 「城市自身的阴影衰减」——深巷、塔基、裙房屋顶相对开阔广场与林荫大道的明暗差。

由建筑 footprint **一次性烘焙**一张「天空可见度」场，运行时每个像素只做**一次纹理采样**，
不增加任何 pass / buffer / 几何：

1. footprint 扫描线栅格化到高度场（重叠处由更高的建筑占据）
2. 地平线扫描：每个方位取遇到的最陡遮挡坡度 `tanθ = (H − y) / d`，该切片的天空可见度为
   Lambertian 加权的 `cos²θ = 1 / (1 + tan²θ)`
3. 三个接收高度通道（0 / 30 / 90 m）写入 RGB，超过 `fadeTop = 320 m` 淡出为全亮
4. 只把一小部分施加到直射光，让受光面保留 shadow-map 的对比，阴影处才加深

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `cell` | 0.6 单位（60 m） | 栅格边长 |
| `steps` | 0.5…8 格（30–480 m） | 近场加密、远场收敛 |
| `directions / phases` | 16 / 2 | 相位数把固定扇面绕塔楼画出的条带打散成细噪 |
| 直射份额 | 白天 0.30 / 黄昏 0.24 / 夜间 0 | 夜间只剩灯光，不再压暗 |
| 强度·地面 / 墙面 / 屋顶 | 0.85 / 0.60 / 0.70 | 墙面 `inset = 2 m`，读到自己 footprint 内部的自排除场，而不是路缘 |

烘焙结果（本机 1275 栋楼 + 22 处地标，约 165 ms）：

```
栅格 592×465 · 有效单元 46,889 · 地面通道可见度 p05=0.58（深巷/塔基） p50=0.99（一般街道）
```

### 2. 共享 HDR 环境 · `js/environment.js`

GTA_SZ 用 Poly Haven 的 CC0 HDR 同时供天空、水面与 PBR 反射。本项目完全离线，
改用**程序化天空（Preetham）经 `PMREMGenerator` 预过滤**得到等价的立方体环境贴图：

- **显示与辐射分离**：给眼睛看的天空走 ACES tone mapping；喂给材质的 IBL 必须是线性 HDR。
  PMREM 烘焙时内部会把 `renderer.toneMapping` 置为 `NoToneMapping`，两条链路自动分开
- **太阳方向同源**：实时平行光、环境烘焙、水面高光都读 `geo.js` 的 `sunState()`
- **按 0.5 小时量化 + LRU 缓存**：滑动时间轴只在跨过半个钟点时才付一次烘焙代价
- 逐材质 `envMapIntensity` 区分：玻璃幕墙 1.15、车漆 1.25、土地山体 0.35–0.45
- 有了 IBL 后，半球光 / 环境光退为补色（×0.58），避免与天空辐射重复补光

### 3. 体量分层 · `js/city.js`

塔楼不再是一根方柱，按 GTA_SZ 的体量做法拆成三层，全部走同一条实例化管线：

- **裙房 podium**：楼高 > 85 m 时贴地外扩 1.2–1.4 倍、高 16–34 m，给塔楼一个底座
- **退台 setback**：楼高 > 150 m 时上部收进到 0.6–0.8 倍，形成阶梯轮廓
- **屋顶设备 / 天线**：既有细节，现在与裙房、退台一起参与生长动画

### 4. 焦点距离驱动的阴影契约 · `js/main.js`

太阳阴影只在 shadow box 内生效，box 固定就必然在街景下过粗、航拍下不够。
每帧按「相机到焦点的距离」重算平行光正交视锥半幅 `d = clamp(dist × 0.62 + 24, 26, 240)`，
并把光源与目标跟随焦点；`bias` / `normalBias` 随 texel 的世界尺寸缩放，
避免缩放过程中出现闪烁的自阴影条纹。

### 水面与城市同源

`world.js` 的水面着色器新增地平线 / 天顶双色天空渐变与太阳眩光核（`uHorizon` / `uZenith` / `uSunI`），
与 PBR 用的环境贴图共用同一套时刻参数——远看是同一片天。

---

## 性能

上述技法全部上线后，每帧要付的代价也随之上升。这一节记录本轮针对「页面卡顿」的治理，
按收益从大到小排列。其中第 0 条是根因，其余是常规优化。

### 0. 主循环被两条互相续期的链驱动了（根因）

```js
function loop() {
  requestAnimationFrame(loop);   // ← 链 B：每个回调再登记一个
  ...
}
renderer.setAnimationLoop(loop); // ← 链 A：three 内部同样自我续期
```

`WebGLAnimation.onAnimationFrame` 自身就会 `requestAnimationFrame(onAnimationFrame)`，
于是存在**两条各自续期的链**：每帧每个回调都再排一个，`loop` 的并发数逐帧线性累加——
第 n 帧渲染 n 次。10 秒 60 fps 就是每帧 600 次 `renderer.render`，表现为「越用越卡」。

修复：删掉 `loop()` 内的 `requestAnimationFrame`，主循环只由 `setAnimationLoop` 驱动。

> 顺带说明为什么这类错误不会被立刻发现：它不报错、不掉帧到零，只是随着运行时间平滑劣化。

### 1. Sky 参与 early-z

`Sky` 是整屏的 Preetham 大气积分（十几处 `pow`/`exp`），是最贵的一层。它的顶点着色器
把深度推到远平面（`gl_Position.z = gl_Position.w`），且 `depthWrite: false`。
把它排到队列最后（`sky.renderOrder = 1000`）后，被地形楼群盖住的像素会在深度测试阶段被整片剔掉；
此前它排在队列最前，等于每帧全屏无谓跑一遍。

### 2. 静态合批 · `lib.js` 的 `mergeStaticMeshes()`

地标是逐个零件搭出来的，构件极碎。`mergeStaticMeshes()` 把子树内**同材质**的静态 mesh 合并，
并对每个零件做几何到根空间的矩阵烘焙。22 处地标 **969 → 309 mesh**（剩余部分为动态部件与多材质组）。
注意必须逐分量用 `getX/getY/getZ` 读 position，不能对 `InterleavedBufferAttribute` 整块 `subarray`。
**`InstancedMesh` 必须逐实例 `getMatrixAt` 展开再烘焙**——早期只烘焙 `matrixWorld` 会忽略
`instanceMatrix`，使柱网 / 斗拱 / 栏板等全部塌缩成单位盒（见「高度校验机制」第 1 条）。

### 3. 自适应分辨率（ ladder 作用在基准 DPR 上）

```js
RES_STEPS = [0.62, 0.75, 0.88, 1.0, 1.15]
RES_BASE  = min(devicePixelRatio, 1.5)
```

> 曾经写成 `min(step, devicePixelRatio)`：在 DPR=1 的普通屏上恒等于 1，整条降档阶梯形同虚设，
> 卡顿时反而无处可降。倍率 ladder 必须作用在基准之上，低端才有下探空间。

fps < 34 连续 2 次降档、> 56 连续 6 次升档。

### 4. 其余

| 手段 | 说明 |
| --- | --- |
| 拾取代理两级检测 | 每个地标一个 `visible = false` 的 Box 代理（r160 的 raycast **不检查** visible，见 `three.module.js:51042`）。悬停只打 22 个盒子；点击先粗筛再对单一地标精确 raycast |
| hover 帧节流 | `pointermove` 只登记 `hoverPending`，由 `flushHover()` 在下一帧统一处理，避免一次移动里多次 raycast |
| 阴影按需更新 | `shadowMap.autoUpdate = false`，仅在相机 / 焦点 / 太阳方向 / 视锥半幅真的变了时才 `needsUpdate`；相机停住时 shadow pass 开销归零 |
| PMREM 节流 | `applyTime` 只登记 `envPending`，由 `flushEnv()` 按「冷却 1.2 s + 停手 0.2 s + 自动走时累积 0.5 h」三条件裁决烘焙时机 |
| 标签写回去重 | 22 个标签每帧 3 处样式写入会拖出强制重排；缓存上一次写进 DOM 的值，仅在 `display` / 位移 > 0.5 px / 状态位变化时才写回，并缓存视口尺寸而不是每帧读 `window.innerWidth` |
| 山体停投影 | 4.6 万三角形的山体 `castShadow = false`，它们投出的阴影肉眼不可辨 |
| 小地图降频 | 0.09 s → 0.2 s |

### 静态预检

上面的第 0 条（重复声明导致整页白屏）在浏览器里是静默失败：改完代码到打开页面之间没有任何告警。
因此加了纯解析的语法体检，**不执行、不解析依赖**：

```bash
npm run check     # vm.SourceTextModule 逐个解析 js/*.js 与 tools/*.mjs
npm run smoke     # 先 check 再跑构建冒烟测试
```

> 用 `node --check` 逐个 spawn 子进程在受限沙箱里会 `EBUSY`，所以改用 `vm.SourceTextModule`
> 在同一进程内做语法解析：它能在不执行的前提下捕获 `Identifier 'x' has already been declared`。

### 第二轮治理（本次）

在四项技法全部上线之后，又做了一轮「剩余热点」清扫，按类型归档：

| 类型 | 手段 | 说明 |
| --- | --- | --- |
| 性能 | 小地图静态层缓存 | 片区 / 长江 / 城墙每 0.2 s 全量重绘纯属白烧——静态底图渲染进离屏 canvas 画一次，之后每帧 `drawImage` 复用，动态层只剩 22 个地标点 + 相机扇形 |
| 性能 | `setEnvIntensity` 去抖 | 自动昼夜每帧路过这里逐材质写 `envMapIntensity`；变化 < 0.004 直接跳过 |
| 性能 | 飞行动画零分配 | `updateAnim` 每帧 `clone()` 两个 Vector3 + 一个 Spherical；改为模块级预分配临时对象，飞行期间的 GC 压力归零 |
| 性能 | 主循环 DOM 查询缓存 | `$('#timeVal')` / `$('#timeSlider')` 每帧各查一次 DOM，改为模块加载时缓存一次 |
| 画面 | 夜间星空 + 月光 | 此前入夜后天空全黑。新增 1300 颗上半球布点星空（透明通道在 Sky 之后绘制、随 `night` 淡入）与一盏冷色低强度月光平行光，维持夜间轮廓可读 |
| 体验 | `?t=22.5` 时刻深链 | URL 直接落到指定时刻，调试夜景 / 分享带时刻的链接 |
| 体验 | 搜索修复 | README 一直声称「按名称、英文名或标签检索」，实现里只匹配了名称——补上英文名与标签，并支持回车直达第一个命中项 |
| 体验 | 操作提示自动淡出 | 底部操作提示 9 s 后淡出，不长期占用视线 |
| 结构 | git 版本控制 | 项目此前无任何版本控制，改坏无法回退。已 `git init` 并以「优化前快照」为基线提交 |
| 结构 | 清理一次性调试脚本 | `tools/dbg*.mjs` 是排障时的一次性脚本，已删除（保留在 git 历史） |

---

## 地标建模方法

### 真实轮廓数据源（OSM）

能拿到公开实测轮廓的地标，优先用 OpenStreetMap 的 building 多边形，而不是手写近似矩形：

- `js/landmarks.js` 内的 `ZIFENG_MAIN / ZIFENG_PODIUM / ZIFENG_SEC` 即取自 OSM 节点
  （紫峰主楼 `osmId 140809508`，为 **8 点切角三角**平面，不是正三角形）。
  运行时 `toLocal()` 把经纬度换算到场景坐标并本地化到落点，再交给 `taperPoly()` 逐段收分至 450 m。
- `tools/osm/` 下另存了若干地标的原始 OSM 提取（中华门瓮城、总统府、老门东、新街口、中山陵等），
  用于核对面阔 / 进深 / 轴线，作为 `data.js` 与 `arch.js` 的输入依据。

> 现代塔楼（紫峰 450 m、河西 320 m、新街口 160 m）走「OSM 真实轮廓 + 分段收分」；
> 古典与亭台走 `arch.js` 的构件化装配。两条路线都保证「模型最高点 = `heightM` 实测值」。

### 中式建筑高保真构件库 · `js/arch.js`

早期屋面是 `LatheGeometry` 旋转出的**圆穹顶**——屋檐是圆的、没有举折、没有翼角，一眼假。
现改为按真实木构做法重建，全部以「高度场」生成曲面：

- **屋面高度场**：以正脊（或上层檐）为源、檐口矩形为界，逐顶点量高度
  - 举折 `pow(u,k)`（k>1）：檐口平缓、近脊陡峻
  - 反宇 `upA·(1−u/upR)²`：檐口导数变负，微微上翘
  - 翼角 `cornerA·(|x|/hw+|z|/hd−1)²·(1−u)^0.7`：四角额外抬升，形成戗脊起翘
- **构件库**（`arch.js` 导出）：
  - 屋顶：`hipRoof`(庑殿) / `gableHipRoof`(歇山) / `gableRoof`(悬山·硬山)，均带 **正脊 + 正吻（吞脊兽）+ 四条戗脊**
  - 台基：`pedestal`(须弥座：上下枋 + 束腰 + 圭脚) / `balustrade`(栏板)
  - 木构：`postGrid`(柱网) / `dougong`(斗拱：栌斗 + 华拱两层出跳 + 散斗) / `wallBody`(墙体含隔扇)
  - 殿堂：`chineseHall`(须弥座台基 + 柱网 + 墙体 + 斗拱 + 曲面屋顶) / `storiedPavilion`(楼阁式，攒尖宝顶)
  - 宝顶：`finial` = 须弥座 + 相轮 + 宝珠，**尺寸随举高 `rise` 收**，附加高 ≈ `rise·0.14`，不会突破 `data.js` 总高
  - 脊饰：`sweepRect()` 沿折线扫出方口管，供正脊 / 戗脊复用
  - 幕墙：`curtainMullions()` 单元竖挺（实例化）
- **脊饰 / 宝顶随宽放大的坑**：早期 `ridgeSize` 仅取 `min(w,d)·0.055`、宝顶取 `rs·5.2`，
  **宽屋顶的脊饰 / 宝顶会拔高总高** → 总统府 +11.5%、博物院 +11.1%、阅江楼 +28%、玄武湖 +95%。
  现改为随 `rise` 收（`ridgeSize = min(…, rise·0.20)`、宝顶 `finialRS = min(rs, rise·0.03)`），全部收敛到 8% 内。

> 关键纪律：**装饰件不再叠加到总高之外**。`chineseHall` / `makePavilion` 会先为宝顶、脊饰预留举高
> （如 `chineseHall` 取 `roofActual = finial ? roofRise·0.876 : roofRise`），使
> 「台基 + 屋身 + 屋面 + 宝顶」严格等于 `pedestalH + bodyH + roofRise`，
> 这是 22 处地标高度校验全部落在 8% 容差内的根因（见下一节）。

---

## 地标数据口径

`js/data.js` 是唯一数据源，每个地标包含：

- `lon / lat` —— 落位经纬度。点位取建筑/山峰本体而非景区大门（如紫金山取头陀岭 `32.0637°N`）
- `params` —— 构建参数，全部来自实测（跨径、层数、面阔、进深、高宽等）
- `spec` —— 展示用的实测数据表，UI 右侧信息卡直接渲染
- `heightM` —— **该地标相对本地地面的实测总高（m）**，用于自动校验模型是否失真
- `desc / tags / cat`

- **地标数据口径**：19 处地标的 `lon/lat` 已逐条与权威来源核对并回写（`tools/georef.mjs`
  固化了参照表：每条注明来源与取点口径——区域类地标如中山陵取祭堂、明孝陵取陵宫、
  玄武湖取湖心，来源为 zh.wikipedia 信息框坐标与 OSM Nominatim，双源互证）。
  核对前最大偏差 3.67 km（长江大桥旧坐标偏北）、0.8–1 km 级者 8 处；
  长江大桥南移后，长江中心线在桥位处同步修正，并补画了南京眼所跨的**夹江**支汊。
  城墙/河西/仙林为示意性组群，未设唯一参照点。

---

## 高度校验机制

`tools/smoke.mjs` 在构建后逐项对照「模型真实顶点最高点」与 `heightM`，误差 > 8% 报警：

```bash
npm run smoke          # 或 node tools/smoke.mjs
npm run topdebug       # 列出每个地标最高的构件，定位失真来源
node tools/geocheck.mjs   # 相对位置保真：场景点对间距 vs Vincenty 椭球大地线
node tools/georef.mjs     # 绝对位置保真：data.js 坐标 vs 权威参照（OSM / zhwiki）
```

两个关键细节：

1. **按真实顶点量测，不用 `Box3`**。`Box3.setFromObject` 变换的是「局部包围盒的 8 个角」，
   倾斜 35° 的球体因此会虚增约 25%（南京眼斜塔就曾被判出 +11% 的假偏差）。
   `vertexTop()` 逐个顶点做世界变换，才是几何真值。
2. **组群类免检**。`supertall` 之外的 `mausoleum / tomb / mountainref / wallmark`
   依附自然地形，几何顶面必然包含地形抬升，与「单栋建筑高 XX 米」不可比，
   输出标记为 `组群` 而非偏差值。

冒烟测试同时会烘焙城市 AO 并打印可见度分位，用于确认 AO 场真的生效（而不是一张全白图）。

当前 `npm run smoke` 实测（22 处，组群类标记「组群」免检）：

```
supertall 紫峰大厦   450 m  偏差 0.0%   · towercluster 河西 320 m 偏差 0.0%（已修 NaN）
trussbridge 长江大桥 70 m  · citygate 中华门 20 m  · eyebridge 南京眼 82.5 m
stadium 奥体中心 67.061 m · station 南京南站 58.3 m
classical 总统府 16 m(2.7%) · 博物院 20 m(2.2%)
pavilion 阅江楼 52 m(0.4%) · temple 鸡鸣寺 44.8 m / 栖霞寺 18.04 m · memorial 雨花台 42 m
lake 玄武湖 16 m(0.7%) · oldtown 夫子庙 26 m(4.7%) / 老门东 26 m(4.8%) · campus 仙林 48 m(3.4%)
block 新街口 160 m(-0.3%) · 其余（紫金山/中山陵/明孝陵/城墙）为组群类，按地形抬升免检
```

绝大多数落在 0.0–0.4%，少数带「台基 + 多层屋身 + 屋面」的古典 / 老城类在 2–5%，
均远低于 8% 容差。古典类 2–3% 来自须弥座 + 屋身的台阶收分，属真实构造而非建模误差。

> 南京眼的三个公开数值彼此约有 2% 口径差：倾角 35° × 斜向 102.464 m 得到垂高 ≈ 83.9 m，
> 与「竖向 82.5 m」不符。模型以竖向为准、据此反解轴向 ≈ 100.7 m，`spec` 中已注明。

### 两个已修复的校验假象与崩溃

1. **`mergeStaticMeshes` 实例化塌缩（既坏渲染也假量测）**。
   原实现只对 `InstancedMesh` 烘焙 `matrixWorld`，忽略 `instanceMatrix`，
   于是柱网 / 斗拱 / 栏板 / 幕墙竖挺等所有实例被塌缩成**一个单位盒**（y∈[0,1]），
   渲染上只见白模、量测上顶点被读成 y≈1.0。**现改为逐实例 `getMatrixAt` 展开**再烘焙，
   渲染与高度校验都恢复真实。注意 `smoke.mjs` 的 `vertexTop()` 同样要逐实例展开，
   否则会重复同一假象。
2. **`towercluster` 复用 `supertall` 漏传 `lon/lat` → NaN**。
   `towercluster`（河西 320 m）调用 `supertall` 时未透传 `lm.lon/lat`，
   `toV2(undefined, undefined)` 产出 `NaN`，污染整组 `taperPoly` 的 X/Z（Y 正常），
   导致 `computeBoundingBox` 报 `NaN`、校验整组失效。**现改为 `BUILDERS.supertall({ ...lm, params })` 透传 `lm`**，复跑 `done`、smoke 全绿。



---

## 依赖与测试约定

- 浏览器侧：`index.html` 的 importmap 把 `three` 指向 `vendor/`，**完全离线可用**
- Node 侧：`node_modules/three/` 只是一个转发垫片（`export * from '../../vendor/three.module.js'`），
  用来让 Node 解析裸导入 `three`。它不含第三方代码，也不参与浏览器加载

---

## 交互

- **视角**：左键拖拽旋转 / 滚轮缩放 / 右键平移；`Esc` 关闭信息卡与帮助面板
- **地标**：左侧索引点击即飞行，也可用顶部搜索框按名称、英文名或标签检索（回车直达首个命中）
- **信息卡**：右侧展示该地标的 `spec` 实测数据表与经纬度，「飞抵此处」「环绕浏览」二次操作
- **昼夜**：底部时刻滑块驱动日照、天空色、夜间灯光；「自动昼夜」自动推移，「城市生长」重播楼群生长动画
- **开关**：标签 / 车流 / 阴影 / 自动昼夜 / 环绕
- **小地图**：右下角 Canvas 实时显示视点位置，点击可直接跳转
- 顶部「收起」隐藏面板、「全屏」进入沉浸浏览
- **深链**：`?t=22.5` 指定时刻，`?lm=nanjingeye` 开场飞到指定地标（`?lm=none` 保持全景），可组合分享
