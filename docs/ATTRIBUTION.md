# 资产署名(ATTRIBUTION)— GTA-NJ

本项目(南京城市)以程序化生成为主,少量外部资产按其许可证署名如下。

| 资产 | 来源 | 许可证 | 署名 |
|---|---|---|---|
| `assets/ferrari.glb`(演示 GLB) | [three.js examples](https://github.com/mrdoob/three.js) `examples/models/gltf/ferrari.glb`,用于 [webgl_materials_car](https://threejs.org/examples/webgl_materials_car.html) | 随 three.js 示例分发 | Ferrari 458 Italia 模型 by **vicent091036**,保留本表即视为署名 |
| `assets/cars/*.glb` + `Textures/colormap.png`(8 台车:sedan/taxi/suv/van/police/hatchback-sports/truck/race) | [Kenney Car Kit](https://kenney.nl/assets/car-kit),经 [shorepine/kenney](https://github.com/shorepine/kenney) 镜像 | **CC0 1.0** | 无需署名,仍致谢 Kenney |
| `assets/textures/brick_diffuse.jpg` / `brick_bump.jpg` | [mrdoob/three.js](https://github.com/mrdoob/three.js) examples/textures | 随 three.js 示例分发 | three.js authors |
| `assets/textures/rough_concrete_diff_2k.jpg` / `rough_concrete_nor_gl_2k.jpg` / `rough_concrete_rough_2k.jpg` | [Poly Haven](https://polyhaven.com/a/rough_concrete) | **CC0** | 无需署名 |
| `vendor/three.module.js` 等 | three.js r160 | MIT | Copyright © 2010-2024 three.js authors |
| `vendor/GLTFLoader.js` / `DRACOLoader.js` / `utils/BufferGeometryUtils.js` | three.js r160 examples(vendor 本地化,index.html importmap `three/addons/` → `./vendor/`) | MIT | 同上 |
| Draco 解码器 `assets/draco/gltf/`(`draco_decoder.wasm` + `draco_wasm_wrapper.js`) | google/draco | Apache-2.0 | Copyright © 2017 Google Draco Authors |
| `data/metro-3d.json`(南京地铁线网几何:15 线/263 站坐标与轨道折线) | 车站坐标与轨道几何 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),经 [AFAP/nanjing-metro](https://github.com/AFAP/nanjing-metro) 整理(MIT);本项目仅取几何,不使用其站点文字资料 | **ODbL**(几何衍生数据) | 南京地铁线网几何:© OpenStreetMap contributors(ODbL),经 AFAP/nanjing-metro 整理(MIT) |
| `assets/props/*.glb`(街景道具 8 件:`trafficlight_A` / `bench` / `dumpster` / `firehydrant` / `trash_A` / `trash_B` / `bush` / `box_A`) | [KayKit City Builder Bits 1.0](https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0) by Kay Lousberg,取 `Assets/gltf/` 对应 `.gltf+.bin` + `citybits_texture.png` 单图集,经 gltf-transform 转 GLB(内嵌图集)并 Draco 压缩 | **CC0 1.0** | 无需署名,仍致谢 Kay Lousberg / KayKit |
| `js/spiritway.js`(明孝陵神道石像生:六兽 + 翁仲程序化造型) | 构造法移植自 [hafewa/chinese-ancient-architecture-sandbox](https://github.com/hafewa/chinese-ancient-architecture-sandbox) `src/Decorations.js` 的 `createStoneLion`(须弥座三层 + 复合原语造型),按本项目尺度体系重写并扩展为六兽体系 | **MIT** | Copyright © hafewa;保留本表即视为署名 |
| `assets/spiritway/winged-guardian.glb`(跪翼守门神兽,北齐 550-577,北响堂山中窟,F1916.345,神道麒麟位) | [Smithsonian 3D Open Access](https://3d.si.edu/object/3d/3d_package:0dc68216-3651-44c7-99cf-18e5d4d1eb9f)(Freer|Sackler 藏品扫描),取 100k 面 Draco GLB 档 | **CC0**(Smithsonian Open Access,公有领域) | 无需署名,仍致谢 Smithsonian DPO |
| `assets/spiritway/lion-pair.glb`(守狮对:踏球雄 + 抚崽雌,神道立狮位) | [3dassets.dev Imperial China](https://3dassets.dev/) 「Guardian Lion Pair」(id 36211) | **CC0** | 无需署名 |
| `assets/spiritway/incense-burner.glb`(石香炉,享殿台基) | [3dassets.dev Imperial China](https://3dassets.dev/) 「Stone Incense Burner」(id 36190) | **CC0** | 无需署名 |
| `assets/spiritway/balustrade.glb`(石栏杆段,享殿台基缘) | [3dassets.dev Imperial China](https://3dassets.dev/) 「Stone Balustrade Run」(id 36174) | **CC0** | 无需署名 |
| `assets/spiritway/arch-bridge.glb`(御河桥·石拱桥,明孝陵金水河) | [3dassets.dev Imperial China](https://3dassets.dev/) 「Arched Stone Bridge」(id 36169) | **CC0** | 无需署名 |

## 尺度注记(ferrari.glb)

- 原始模型按真实车辆尺度建模(未在文件内验证精确米数,不声称具体数值)。
- 其在 GTA-NJ 场景中的缩放属**展示尺度**:对齐本项目车流/街道的视觉语言,非地理真值;落地时以车流车道宽与路网尺度为参照调 `scale`。

## 新增资产守则

- 只引入 **CC0** 或 **CC-BY**(CC-BY 在本表登记署名)
- **CC-BY-NC(非商用)一律不进仓库**
- 模型统一 GLB、Y-up、米制,Draco 压缩可用(解码器已内置 `assets/draco/gltf/`)

| 南京核心区建筑轮廓(离线审计用) | Overture Maps buildings(2026-09-23.1);混源:OSM 衍生部分 © OpenStreetMap contributors(ODbL)+ zenodo east_asian_buildings(doi:10.5281/zenodo.8174931) | 仅本地离线审计,**不随仓库分发**(已在 .gitignore;审计方法见 docs/AUDIT_城市体量真值对照.md) |
