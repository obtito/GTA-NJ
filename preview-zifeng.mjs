import * as THREE from 'three';
import { BUILDERS } from './js/landmarks.js';
import { LANDMARKS } from './js/data.js';
import { toV2 } from './js/geo.js';

const lm = LANDMARKS.find((l) => l.id === 'zifeng');
const g = BUILDERS.supertall(lm);
const [cx, cz] = toV2(lm.lon, lm.lat);
g.position.set(cx, 0, cz);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0e1a');          // 夜景底
scene.add(g);

// 地面（夜间压暗）
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(600, 600),
  new THREE.MeshStandardMaterial({ color: '#2a3326', roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(cx, 0, cz);
ground.receiveShadow = true;
scene.add(ground);

const cam = new THREE.PerspectiveCamera(44, 1280 / 900, 0.1, 2000);
let orbit = 0.95;
const orbitR = 19, orbitY = 10;
let lookY = 7.0;
cam.position.set(cx + Math.cos(orbit) * orbitR, orbitY, cz + Math.sin(orbit) * orbitR);
cam.lookAt(cx, lookY, cz);

// 夜间补光：冷调月光 + 弱环境，让玻璃塔身与龙鳞仍可辨，但氛围压暗以突出窗光
const moon = new THREE.DirectionalLight(0xbcd2ff, 1.1);
moon.position.set(cx + 30, 70, cz + 25);
scene.add(moon);
const nightAmb = new THREE.AmbientLight(0x4a5a78, 0.5);
scene.add(nightAmb);
const nightHemi = new THREE.HemisphereLight(0x223047, 0x10160f, 0.5);
scene.add(nightHemi);
const rim = new THREE.DirectionalLight(0xffe6c2, 1.2);
rim.position.set(cx - 20, 25, cz - 28);
scene.add(rim);

// 白天补光：强太阳 + 天空环境光（紫峰幕墙是银灰反光玻璃，日光下应读作「浅银绿」而非黑）
const sun = new THREE.DirectionalLight(0xfff2e0, 2.0);
sun.position.set(cx + 55, 90, cz + 30);
sun.visible = false;
scene.add(sun);
const dayAmb = new THREE.AmbientLight(0xcfe0ee, 1.1);
dayAmb.visible = false;
scene.add(dayAmb);
const dayHemi = new THREE.HemisphereLight(0xbfd8ee, 0x6a7264, 1.1);
dayHemi.visible = false;
scene.add(dayHemi);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(1280, 900);
renderer.setPixelRatio(1.25);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// 环境反射：紫峰幕墙的银亮感全靠 env 反射（metalness 0.6 没有 env 就是一片黑）。
// 主 app 走 js/environment.js 的 PMREM；预览这里自建一个「天-地」双色球环境，8 行搞定。
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const skyGeo = new THREE.SphereGeometry(200, 16, 12);
  const pos = skyGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cSky = new THREE.Color('#bcd3e6'), cGround = new THREE.Color('#6a7264'), cTmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, pos.getY(i) / 200 * 0.5 + 0.5));
    cTmp.lerpColors(cGround, cSky, Math.pow(t, 0.7));
    colors[i * 3] = cTmp.r; colors[i * 3 + 1] = cTmp.g; colors[i * 3 + 2] = cTmp.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  envScene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // 太阳亮斑：幕墙「银亮」的关键 —— 真实玻璃的反光是天空中的太阳点，
  // 均匀环境球没有亮点，金属立面就只有漫反射灰。
  const sunDir = new THREE.Vector3(55, 90, 30).normalize();
  const sunBlob = new THREE.Mesh(
    new THREE.SphereGeometry(28, 12, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.4, 4.2) }),   // HDR 亮斑（>1）
  );
  sunBlob.position.copy(sunDir).multiplyScalar(180);
  envScene.add(sunBlob);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
}

// 夜景：窗光拉亮、冠缘发光（?mode=day 可切白天，便于核对比例）
let night = true;
let orbitFrozen = false;
let orbitR2 = orbitR;
try {
  const q = new URLSearchParams(location.search);
  if (q.get('mode') === 'day') night = false;
  if (q.get('angle') !== null) { orbit = parseFloat(q.get('angle')) || 0; orbitFrozen = true; }  // 固定视角截图用
  if (q.get('r') !== null) orbitR2 = parseFloat(q.get('r')) || orbitR;                            // 固定距离
  if (q.get('ly') !== null) lookY = parseFloat(q.get('ly')) || lookY;                             // 注视高度
} catch (e) {}
const applyNight = () => {
  if (g.userData.setNight) g.userData.setNight(night ? 1 : 0);
  scene.background.set(night ? '#0a0e1a' : '#cfe0ea');
  moon.visible = night; nightAmb.visible = night; nightHemi.visible = night; rim.visible = night;
  sun.visible = !night; dayAmb.visible = !night; dayHemi.visible = !night;
  ground.material.color.set(night ? '#2a3326' : '#5d6a5a');
};
applyNight();
window.addEventListener('keydown', (e) => { if (e.key === 'n' || e.key === 'N') { night = !night; applyNight(); } });
window.addEventListener('wheel', (e) => { orbitR2 = Math.min(40, Math.max(8, orbitR2 + Math.sign(e.deltaY) * 1.5)); });

const clock = new THREE.Clock();
function loop() {
  const t = clock.elapsedTime;
  if (!orbitFrozen) orbit += 0.0035;
  cam.position.x = cx + Math.cos(orbit) * orbitR2;
  cam.position.z = cz + Math.sin(orbit) * orbitR2;
  cam.position.y = orbitFrozen ? 9.0 : orbitY + Math.sin(orbit * 0.7) * 1.2;   // 固定视角时保持水平平视，便于对比轮廓
  cam.lookAt(cx, lookY, cz);
  if (g.userData.tick) g.userData.tick(t);          // 航空障碍灯闪烁
  renderer.render(scene, cam);
  requestAnimationFrame(loop);
}
loop();
