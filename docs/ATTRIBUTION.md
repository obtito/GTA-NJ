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

## 尺度注记(ferrari.glb)

- 原始模型按真实车辆尺度建模(未在文件内验证精确米数,不声称具体数值)。
- 其在 GTA-NJ 场景中的缩放属**展示尺度**:对齐本项目车流/街道的视觉语言,非地理真值;落地时以车流车道宽与路网尺度为参照调 `scale`。

## 新增资产守则

- 只引入 **CC0** 或 **CC-BY**(CC-BY 在本表登记署名)
- **CC-BY-NC(非商用)一律不进仓库**
- 模型统一 GLB、Y-up、米制,Draco 压缩可用(解码器已内置 `assets/draco/gltf/`)
