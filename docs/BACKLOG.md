# 开发后备清单(2026-10-03 检索定稿)

> 来源:GitHub 全量检索(29 代理 + 逐条许可核实)+ 代码级可行性复核。
> 结论:不存在可复用的南京城墙/城门 3D 数据集——墙线/门址继续自维护(OSM 门址 + zhwiki 双源)。

## 待做(按优先级)

| # | 事项 | 依赖/触发条件 | 预估 |
|---|---|---|---|
| 1 | **行人 Phase 2**(recast-navigation-js):navmesh 避让/红绿灯停步/穿街过马路——Phase 1 轨道式(320 人)已于 2026-10-03 上线(e631b7a) | Phase 1 已交付 | 1-2 天 |
| 2 | **轨道版车流智能**(不引库):车道内跟车减速 + 红绿灯停车点,消灭同车道穿插 | KayKit 红绿灯已入(本轮) | 半天 |
| 3 | **Yuka 车流 AI**(MIT,three.js 维护者之作):NPC 车对玩家驾驶的反应 | GTA-WH 玩法期 | 1-2 天 |
| 4 | **streets-gl 屋顶/退台算法移植**(MIT,24 个屋顶生成器):先花 10 分钟在 streets.gl 在线版查南京 OSM `roof:shape`/`building:levels` 覆盖率,标签富才值得移植 | 数据覆盖率验证 | 1-2 天(若验证通过) |
| 5 | **Pyrosm/OSMnx 离线提取**(MIT,Python 3.11 就绪):整城真实楼高/断网批量拉 OSM;GeoFabrik 中国 PBF ~1GB | 出现批量数据需求时 | 按需 |
| 6 | **OSM2World 真值对照**(MIT):跑一片新街口/鼓楼导出 OBJ,量程序化楼群体量偏差 | **需先装 JVM**(本机无 Java);只当尺子,产出不进场景 | 一次性 |
| 7 | **3DTilesRendererJS**(NASA,Apache-2.0):接 Google 实景 3D Tiles 的未来路径;注意数据条款偏展示用途 | 实景需求出现 | 按需 |

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
