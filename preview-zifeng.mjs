import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BUILDERS } from './js/landmarks.js';
import { LANDMARKS } from './js/data.js';

const lm = LANDMARKS.find((landmark) => landmark.id === 'zifeng');
const building = BUILDERS.supertall(lm);
const scene = new THREE.Scene();
scene.add(building);

// Keep the individual building at the origin. Its model uses one common scale
// for plan and height, independent of the city map's geographic placement.
const bounds = new THREE.Box3().setFromObject(building);
const size = bounds.getSize(new THREE.Vector3());
const center = bounds.getCenter(new THREE.Vector3());
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 600);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label', '紫峰大厦交互式三维模型');

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 2;
controls.maxDistance = 100;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotateSpeed = 0.6;
controls.target.copy(center);

// The large ground fades into the background; no visible platform edge or
// oversized horizon distracts from the silhouette.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshStandardMaterial({ color: '#d5dde0', roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = bounds.min.y - 0.014;
ground.receiveShadow = true;
scene.add(ground);
const ambient = new THREE.AmbientLight(0xddeaf4, 0.65);
const hemi = new THREE.HemisphereLight(0xe0efff, 0x9fa9ad, 1.7);
const key = new THREE.DirectionalLight(0xfff4e6, 2.8);
key.position.set(22, 38, 25);
key.castShadow = true;
key.target.position.copy(center);
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 90 });
key.shadow.normalBias = 0.012;
key.shadow.bias = -0.00008;
scene.add(key.target);
const fill = new THREE.DirectionalLight(0xb9d4f1, 0.8);
fill.position.set(-24, 18, -18);
scene.add(ambient, hemi, key, fill);

// A soft sky plus large reflected light sources makes the glass legible from
// every angle. Separate environments retain cool, subdued night reflections.
const pmrem = new THREE.PMREMGenerator(renderer);
function makeEnvironment(night) {
  const environment = new THREE.Scene();
  const skyGeometry = new THREE.SphereGeometry(100, 32, 20);
  const position = skyGeometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const sky = new THREE.Color(night ? '#364f70' : '#d8e9f5');
  const horizon = new THREE.Color(night ? '#162437' : '#aebabe');
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const amount = THREE.MathUtils.clamp(position.getY(i) / 100 * 0.5 + 0.5, 0, 1);
    color.lerpColors(horizon, sky, Math.pow(amount, 0.65));
    color.toArray(colors, i * 3);
  }
  skyGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  environment.add(new THREE.Mesh(skyGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const [x, y, z, brightness] of [[-50, 30, -45, 2.8], [40, 55, 45, 4.0]]) {
    const light = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 65),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(night ? brightness * 0.14 : brightness), side: THREE.DoubleSide }),
    );
    light.position.set(x, y, z);
    light.lookAt(0, 0, 0);
    environment.add(light);
  }
  const result = pmrem.fromScene(environment, 0.03);
  environment.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  return result;
}
const dayEnvironment = makeEnvironment(false);
const nightEnvironment = makeEnvironment(true);
pmrem.dispose();

const query = new URLSearchParams(location.search);
function queryNumber(name, fallback) {
  const raw = query.get(name);
  const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
const initialAngle = queryNumber('angle', 2.35);
let night = query.get('mode') === 'night';
let automaticFraming = true;

function updateDirectionButtons(angle = null) {
  document.querySelectorAll('[data-angle]').forEach((button) => {
    button.setAttribute('aria-pressed', String(angle !== null && Math.abs(Number(button.dataset.angle) - angle) < 0.001));
  });
}
function setRotation(enabled) {
  controls.autoRotate = enabled;
  document.getElementById('rotate').setAttribute('aria-pressed', String(enabled));
  if (enabled) updateDirectionButtons();
}
function applyLighting() {
  const background = night ? '#101c2d' : '#e4ebef';
  scene.background = new THREE.Color(background);
  scene.fog = new THREE.Fog(background, 40, 115);
  scene.environment = (night ? nightEnvironment : dayEnvironment).texture;
  ground.material.color.set(night ? '#162335' : '#d5dde0');
  ambient.color.set(night ? '#6e8ba9' : '#ddeaf4');
  ambient.intensity = night ? 0.3 : 0.35;
  hemi.color.set(night ? '#637fa6' : '#e0efff');
  hemi.groundColor.set(night ? '#141e2d' : '#9fa9ad');
  hemi.intensity = night ? 0.7 : 0.9;
  key.color.set(night ? '#a6c7ef' : '#fff4e6');
  key.intensity = night ? 0.8 : 2.3;
  fill.intensity = night ? 0.45 : 0.8;
  renderer.toneMappingExposure = night ? 1.05 : 1.08;
  building.userData.setNight?.(night ? 1 : 0);
  document.body.classList.toggle('night', night);
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String((button.dataset.mode === 'night') === night));
  });
}

function fitDistance() {
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  // Reserve space for the controls on short/mobile screens. Bounding the
  // horizontal diagonal also keeps the podium visible at every azimuth.
  const horizontalExtent = Math.hypot(size.x, size.z);
  const verticalFit = size.y / (2 * Math.tan(verticalFov / 2));
  const horizontalFit = horizontalExtent / (2 * Math.tan(horizontalFov / 2));
  return Math.max(verticalFit, horizontalFit) * (window.innerWidth < 650 ? 1.48 : 1.30) + horizontalExtent * 0.3;
}
function frameBuilding(angle = initialAngle, respectQuery = false) {
  controls.target.copy(center);
  if (respectQuery) controls.target.y = queryNumber('ly', center.y);
  const distance = respectQuery ? THREE.MathUtils.clamp(queryNumber('r', fitDistance()), 2, 100) : fitDistance();
  camera.position.set(
    center.x + Math.cos(angle) * distance,
    controls.target.y + distance * 0.12,
    center.z + Math.sin(angle) * distance,
  );
  camera.lookAt(controls.target);
  controls.update();
}
function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (automaticFraming) {
    const angle = Math.atan2(camera.position.z - controls.target.z, camera.position.x - controls.target.x);
    frameBuilding(angle);
  }
}
// Set size before fitting, so both portrait and landscape start with the full
// spire and podium in view. Explicit query parameters remain useful for review.
camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();
renderer.setSize(window.innerWidth, window.innerHeight);
frameBuilding(initialAngle, true);
automaticFraming = !query.has('r') && !query.has('ly');
applyLighting();

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => { night = button.dataset.mode === 'night'; applyLighting(); });
}
for (const button of document.querySelectorAll('[data-angle]')) {
  button.addEventListener('click', () => {
    const angle = Number(button.dataset.angle);
    setRotation(false);
    frameBuilding(angle);
    automaticFraming = true;
    updateDirectionButtons(angle);
  });
}
document.getElementById('rotate').addEventListener('click', () => setRotation(!controls.autoRotate));
document.getElementById('facade-detail').addEventListener('click', () => {
  setRotation(false);
  automaticFraming = false;
  updateDirectionButtons();
  // Match the review camera: angle=2.35&r=8&ly=8 (240 m at 30 m/unit).
  const angle = 2.35, distance = 8;
  controls.target.copy(center).setY(8);
  camera.position.set(
    center.x + Math.cos(angle) * distance,
    controls.target.y + distance * 0.12,
    center.z + Math.sin(angle) * distance,
  );
  camera.lookAt(controls.target);
  controls.update();
});
document.getElementById('fit').addEventListener('click', () => {
  setRotation(false);
  frameBuilding();
  automaticFraming = true;
  updateDirectionButtons();
});
controls.addEventListener('start', () => {
  automaticFraming = false;
  setRotation(false);
  updateDirectionButtons();
});
window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'n') { night = !night; applyLighting(); }
});
const clock = new THREE.Clock();
function loop() {
  const delta = clock.getDelta();
  controls.update(delta);
  building.userData.tick?.(clock.elapsedTime);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
