import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CITY_GATES } from './js/data.js';
import { buildGateModel } from './js/gates.js';
import { buildZhonghuamen } from './js/zhonghuamen.js';
import { mergeStaticMeshes } from './js/lib.js';
import { createArchitecturalLightPool } from './js/architectural-lighting.js';

const host = document.querySelector('#viewport'), scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(35, 1, .002, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.minDistance = .18; controls.maxDistance = 53;   // 门体 1:30 后中华门取景 ~9.6u,留足余量
controls.maxPolarAngle = Math.PI * .49; controls.autoRotateSpeed = .7;
const groundMat = new THREE.MeshStandardMaterial({ color: '#d6dccf', roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), groundMat);
ground.rotation.x = -Math.PI / 2; ground.position.y = -.002; ground.receiveShadow = true; scene.add(ground);
const hemisphere = new THREE.HemisphereLight('#ecf3eb', '#838a72', 2.3), ambient = new THREE.AmbientLight('#e5e9da', .45);
const sun = new THREE.DirectionalLight('#fff2d8', 3.2); sun.position.set(-2, 3, 4); sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -.0001; sun.shadow.normalBias = .0004;
Object.assign(sun.shadow.camera, { left: -7.5, right: 7.5, top: 7.5, bottom: -7.5, near: .1, far: 40 });   // 阴影盒随 1:30 门体放大;mapSize 对冲 texel 变粗
const fill = new THREE.DirectionalLight('#ccdce6', .8); fill.position.set(2, 1, -3);
scene.add(hemisphere, ambient, sun, sun.target, fill);
const architecturalLights = createArchitecturalLightPool(scene, { maxDistance: 53 });
let current, bounds, night = new URL(location.href).searchParams.get('night') === '1', lightsOn = true, view = 'perspective';
const cache = new Map(), statuses = { existing: '现存', rebuilt: '复建', ruin: '遗址' };
const list = document.querySelector('#gateList');
for (const [i, gate] of CITY_GATES.entries()) {
  const button = document.createElement('button'); button.dataset.gate = gate.name;
  const index = document.createElement('span'); index.className = 'idx'; index.textContent = String(i + 1).padStart(2, '0');
  const name = document.createElement('span'); name.textContent = gate.name;
  const state = document.createElement('small'); state.textContent = statuses[gate.kind];
  button.append(index, name, state); button.addEventListener('click', () => selectGate(gate)); list.appendChild(button);
}
function frame() {
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z, .35);
  const fov = THREE.MathUtils.degToRad(camera.fov), fit = Math.min(Math.tan(fov / 2), Math.tan(fov / 2) * camera.aspect);
  const distance = extent / (2 * fit) * 1.42;
  const direction = view === 'front' ? new THREE.Vector3(0, .10, 1) : view === 'back' ? new THREE.Vector3(0, .10, -1)
    : view === 'top' ? new THREE.Vector3(0, 1, .001) : new THREE.Vector3(1.2, .85, 1.6);
  camera.position.copy(center).addScaledVector(direction.normalize(), distance);
  controls.target.copy(center); controls.update();
}
function setNight(value) {
  night = value;
  document.body.classList.toggle('night', night);
  scene.background = new THREE.Color(night ? '#1a272e' : '#e3e7dd');
  groundMat.color.set(night ? '#293a3b' : '#d6dccf');
  hemisphere.intensity = night ? .38 : 2.3; ambient.intensity = night ? .10 : .45;
  sun.color.set(night ? '#9cb6d8' : '#fff2d8');
  sun.intensity = night ? .14 : 3.2; fill.intensity = night ? .12 : .8;
  current?.userData.setNight?.(night && lightsOn ? 1 : 0);
  document.querySelector('#night').setAttribute('aria-pressed', String(night));
  document.querySelector('#lighting').setAttribute('aria-pressed', String(lightsOn));
  document.querySelector('#lighting').disabled = !night;
  const url = new URL(location.href); url.searchParams.set('night', night ? '1' : '0'); history.replaceState(null, '', url);
}
function selectGate(gate) {
  if (current) scene.remove(current);
  if (!cache.has(gate.name)) {
    let model;
    if (gate.name === '中华门') {
      model = buildZhonghuamen();
      mergeStaticMeshes(model, null);
    } else model = buildGateModel(gate);
    cache.set(gate.name, model);
  }
  current = cache.get(gate.name); scene.add(current);
  architecturalLights.setRoots([current]);
  bounds = new THREE.Box3().setFromObject(current);
  document.querySelector('#name').textContent = gate.name;
  document.querySelector('#status').textContent = `TODAY / ${statuses[gate.kind]}`;
  document.querySelector('#summary').textContent = gate.note;
  document.querySelector('#dimensions').textContent = gate.name === '中华门' ? '平面 118.5 × 128 m · 记载高度 20.45 m · 三重内瓮城'
    : gate.kind === 'ruin' ? '现存遗址与门址表达 · 未复原已消失的城楼'
    : `城台约 ${gate.widthM} × ${gate.depthM} m · ${gate.bays} 孔券门${gate.tower ? ' · 城楼' : ''}`;
  document.querySelector('#accuracy').textContent = gate.accuracy + '。本模型长宽高等比；不等同于测绘级复刻。';
  list.querySelectorAll('button').forEach(b => { const active = b.dataset.gate === gate.name; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
  const url = new URL(location.href); url.searchParams.set('gate', gate.name); history.replaceState(null, '', url);
  frame(); setNight(night);
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  view = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); frame();
}));
document.querySelector('#night').addEventListener('click', () => setNight(!night));
document.querySelector('#lighting').addEventListener('click', () => { lightsOn = !lightsOn; setNight(night); });
document.querySelector('#spin').addEventListener('click', event => { controls.autoRotate = !controls.autoRotate; event.currentTarget.setAttribute('aria-pressed', String(controls.autoRotate)); });
function resize() { camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(host.clientWidth, host.clientHeight); if (bounds) frame(); }
window.addEventListener('resize', resize); resize();
try { selectGate(CITY_GATES.find(g => g.name === new URL(location.href).searchParams.get('gate')) || CITY_GATES.find(g => g.name === '玄武门')); }
catch (error) { document.querySelector('#error').textContent = '模型加载失败：' + error.message; throw error; }
renderer.setAnimationLoop(() => { controls.update(); architecturalLights.update(camera); renderer.render(scene, camera); });
