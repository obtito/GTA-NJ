# 开发后备清单(2026-10-03 检索定稿)

> 来源:GitHub 全量检索(29 代理 + 逐条许可核实)+ 代码级可行性复核。
> 结论:不存在可复用的南京城墙/城门 3D 数据集——墙线/门址继续自维护(OSM 门址 + zhwiki 双源)。

## 待做(按优先级)

| # | 事项 | 依赖/触发条件 | 预估 |
|---|---|---|---|
| 1 | ~~行人 Phase 2~~ **已完成(2026-10-04)**:三态机门控过街 + 联合走廊 + 视觉推挤,`npm run ped:check` 验收;recast 路线实测否决 | — | — |
| 2 | ~~轨道版车流智能~~ **已完成(2026-10-04)**:IDM-lite 跟车 + signals.js 相位真值红绿灯停车 + 灯珠变色,`npm run traffic:check` 验收 | — | — |
| 9 | **行人 Phase 2.5**:换边斑马线(过街后按概率横穿本路到对侧,等本路轴红);行人静态道具避让(穿长椅/垃圾箱,需 per-ped 侧向偏移);orbit 人群与 line 人群的视觉分流 | Phase 2 已交付 | 1 天 |
| 10 | **推挤零分配优化**:grid Map → Int32Array 开放寻址(帧间 memset -1),sampleTrack 出参复用——当前 +0.03ms/帧(0.7% 预算)可接受,调大 TOTAL 时再做 | TOTAL 调大 | 2 h |
| 3 | **Yuka 车流 AI**(MIT,three.js 维护者之作):NPC 车对玩家驾驶的反应 | GTA-WH 玩法期 | 1-2 天 |
| 4 | **streets-gl 屋顶/退台算法移植**(MIT,24 个屋顶生成器):先花 10 分钟在 streets.gl 在线版查南京 OSM `roof:shape`/`building:levels` 覆盖率,标签富才值得移植 | 数据覆盖率验证 | 1-2 天(若验证通过) |
| 5 | **Pyrosm/OSMnx 离线提取**(MIT,Python 3.11 就绪):整城真实楼高/断网批量拉 OSM;GeoFabrik 中国 PBF ~1GB | 出现批量数据需求时 | 按需 |
| 6 | **OSM2World 真值对照**(MIT):跑一片新街口/鼓楼导出 OBJ,量程序化楼群体量偏差 | **需先装 JVM**(本机无 Java);只当尺子,产出不进场景 | 一次性 |
| 7 | **3DTilesRendererJS**(NASA,Apache-2.0):接 Google 实景 3D Tiles 的未来路径;注意数据条款偏展示用途 | 实景需求出现 | 按需 |

## 已完成(2026-10-04)

- **行人 Phase 2(红绿灯门控过街)**:WALK/WAIT/CROSS 三态机;门=横路中心线×轨道交点的物理跨距带
  (不截断,宽斜门按需提速 vNeed≤0.14 保证红窗内穿完);带重叠合并为联合走廊(等所有被穿轴共红,
  同路口 a/b 轴互补不合并);放行判据 axisRemain(signals.js 单一真源,含黄灯 2s 预告)≥跨距/速度+1.2s;
  视觉推挤只进渲染偏移(s/θ 权威不动,活锁结构性不存在);orbit 整圆避开车行沥青(新街口收成广场小人群);
  车侧停车线退到口心 crossHalf+0.15 让清过街带。对抗评审 8 条发现全修(含三钟漂移、smoke 硬门槛)。
  验收 `npm run ped:check`:0 违例安全不变量、等灯-放行节律、单帧 0.10ms<0.2ms 红线
- **recast-navigation-js 实测否决**(评审证据):node24 可跑、init 18ms,但 320 agent crowd.update
  avg 1.2ms/p95 1.5ms vs 现轨道循环 0.037ms(**33×超 240fps 红线**);且本项目地形解析式、
  无行走面 mesh 可喂,合成输入=轨道图本身。未来近景自由人群再评估纯 TS 的 navcat 同类
- **轨道版车流智能**(不引库,半天档):js/signals.js 相位真值模块(26 s 周期,坐标哈希错相)一源两用——
  props.js 灯珠(三色 InstancedMesh + toneMapped:false)与 city.js 车流停车线共用;
  车流 v2 = IDM-lite 跟车(右侧通行车道绑定,消灭同车道穿插)+ 红灯虚拟前车截停 + 刹车视距自适应前瞻窗。
  排障记录:① dir=-1 前车索引取反导致反向车道连环锁死(修);② 期望速度按线长换算会让长线车快到闯灯(改固定世界单位档);
  ③ headless rAF ~5fps 墙钟等不起 26 s 周期 → `window.__njSimTick` 确定性快进;
  ④ OrbitControls 会把直设的 camera.position 拉回 → `window.__njCam` 走 placeCamera。
  验收 `npm run traffic:check`:12/12 灯珠半周期翻色、3 路口截停-放行节律、零死锁零页面错误

## 已完成(2026-10-03)

- **KayKit 街景道具包**(CC0):红绿灯/垃圾桶/长椅/灌木/纸箱等 602 件,单图集合批
- **南京地铁 15 线 263 站**(AFAP/nanjing-metro,MIT+ODbL):高架实体走廊 + 地下半透明线 + 站点
- **GLB 全量 Draco 压缩**:3.15→1.67MB(gltf-transform 离线,运行时零改动)
- **行人 Phase 1**(轨道式 320 人):人行道双侧 + 三 POI 环绕,零依赖
- **城市体量真值对照**(原计划 OSM2World,实际改用 Overture Maps——Overpass/Geofabrik 被墙而 Overture 可达):
  13,975 栋真值 vs 程序化,结论「街区体块风格、体量不胖略稀(占地 22% vs 32%)、近景缺逐栋颗粒度」,
  详见 docs/AUDIT_城市体量真值对照.md;真值数据留存 data/nanjing-buildings.json,**逐栋升级路线的数据已就位**
- 新增后备项 8:**逐栋建筑升级**——用 Overture 分布(中位 171m²)把街区体块拆为 5-15 栋/街区

## 明确不做(排雷存档)

- **three-mesh-bvh**:AO 是扫描线地平线法、terrainHeight 是解析式、拾取已两级代理——无落脚点(2026-10-03 代码级论证)
- **proj4js**:geocheck 已有 Vincenty 亚米级交叉验证,再叠一层收益趋零
- **Quaternius**:2026-08-28 起改自定义 QAL(禁资产再分发),与公开仓库政策冲突
- **Microsoft 全球建筑轮廓**:中国无覆盖;OSM/ODbL 仍是唯一真实建筑源
- **map3d 整包 GLB**:与程序化分区风格冲突,只可借其导出管线
