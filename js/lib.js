// 通用几何 / 贴图工具
import * as THREE from 'three';

/* ---------------- 材质缓存 ---------------- */
const matCache = new Map();
export function mat(hex, opts = {}) {
  // 缓存键要把贴图折算成固定标记，否则每个贴图对象都会生成一份巨大的 toJSON 实体
  const key = hex + '|' + JSON.stringify(opts, (k, v) => (v && v.isTexture ? 'TEX' : v));
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: opts.rough ?? 0.85,
    metalness: opts.metal ?? 0.05,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    map: opts.map || null,
    normalMap: opts.normalMap || null,
    bumpMap: opts.bumpMap || null,
    roughnessMap: opts.roughnessMap || null,
    flatShading: !!opts.flat,
  });
  if (opts.normalScale) m.normalScale.copy(opts.normalScale);
  matCache.set(key, m);
  registerEnv(m, opts.env ?? 0.5);
  return m;
}

/* ---------------- 照片级贴图加载（Poly Haven CC0，assets/textures/） ---------------- */
let _texLoader = null;
export function loadTexture(url, { srgb = true, aniso = 4 } = {}) {
  if (typeof document === 'undefined') return null;   // node 环境（tools/smoke.mjs）无 TextureLoader，直接返回 null
  if (!_texLoader) _texLoader = new THREE.TextureLoader();
  const t = _texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/* ---------------- 程序化贴图 ---------------- */
function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** 建筑立面（带窗格），配合 facade 贴图使用 */
export function makeFacadeTexture() {
  if (typeof document === 'undefined') return null;
  const S = 256, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#e8eaec'; ctx.fillRect(0, 0, S, S);
  // 楼层分格
  const rows = 16, cols = 16, step = S / rows;
  ctx.fillStyle = '#d8dbe0';
  for (let r = 0; r < rows; r++) ctx.fillRect(0, r * step + step - 1.5, S, 1.5);
  for (let col = 0; col <= cols; col++) ctx.fillRect(col * step - 1, 0, 1.5, S);
  // 窗
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const v = Math.random();
      ctx.fillStyle = v > 0.7 ? '#9fb0bd' : v > 0.35 ? '#7f8d99' : '#a5b0b8';
      ctx.fillRect(col * step + 2, r * step + 2, step - 5, step - 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 夜间窗光：黑白遮罩（同一套网格，与立面窗位置对齐） */
export function makeWindowTexture() {
  if (typeof document === 'undefined') return null;
  const S = 256, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, S, S);
  const rows = 16, cols = 16, step = S / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const v = Math.random();
      if (v < 0.34) continue;                       // 未点亮的窗
      const lit = v < 0.72 ? 90 : v < 0.92 ? 180 : 255;
      ctx.fillStyle = `rgb(${lit},${Math.round(lit * 0.93)},${Math.round(lit * 0.78)})`;
      ctx.fillRect(col * step + 2, r * step + 2, step - 5, step - 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 屋顶：细颗粒 */
export function makeRoofTexture() {
  if (typeof document === 'undefined') return null;
  const S = 128, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#b9bcc0'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(${120 + Math.random() * 90 | 0},${120 + Math.random() * 90 | 0},${120 + Math.random() * 90 | 0},0.5)`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 草地 / 地面：多尺度斑块，营造田块与地类层次 */
export function makeGroundTexture(repeat = 260) {
  if (typeof document === 'undefined') return null;
  const S = 512, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#b9bfa5'; ctx.fillRect(0, 0, S, S);
  // 大块地类斑块
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const w = 30 + Math.random() * 130, h = 30 + Math.random() * 130;
    const g = Math.random();
    ctx.fillStyle = g > 0.62 ? 'rgba(150,168,124,0.30)'
      : g > 0.32 ? 'rgba(196,196,176,0.26)' : 'rgba(126,146,98,0.26)';
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.5, h * 0.5, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // 细碎颗粒
  for (let i = 0; i < 14000; i++) {
    const g = Math.random();
    ctx.fillStyle = g > 0.5 ? 'rgba(150,168,124,0.55)' : 'rgba(196,196,176,0.5)';
    ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // 田垄／土路的细线理
  ctx.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * S;
    ctx.strokeStyle = `rgba(${120 + Math.random() * 60 | 0},${118 + Math.random() * 50 | 0},${96 + Math.random() * 40 | 0},0.22)`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(S * 0.3, y + (Math.random() - 0.5) * 40, S * 0.7, y + (Math.random() - 0.5) * 40, S, y + (Math.random() - 0.5) * 20);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ================== 城墙砌体贴图（程序化） ==================
 *
 * 依据南京明城墙实测砌法：城砖 40×20×10 cm（约 3.5 亿块，九成以上带府县／窑户铭文），
 * 内外壁皆青砖，一顺一丁错缝，砖缝用石灰+糯米汁+桐油勾嵌；墙脚 1 m 余为花岗岩／石灰岩
 * 条石勒脚；城顶平砖竖砌散水（内低外高，向城内排水）。城砖有青灰／黄灰／赭灰三色，
 * 六百年风化后斑驳不匀，底部与缝内多苔藓水渍。
 *
 * 贴图按真实砖号排布（一格贴图＝N 米见方，砖块数即该边长内实际砖数），
 * 顶点 UV 直接用「米」为单位喂给贴图，于是墙无论多长、段有多短，
 * 砖缝都是 1:1 的实物尺度，绝不会被拉花。
 */

function wallPrng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** 由灰度高度图用 Sobel 求法线贴图（省掉手绘 normal map） */
function normalFromHeight(hc, strength = 2.6) {
  const S = hc.width;
  const src = hc.getContext('2d').getImageData(0, 0, S, S).data;
  const out = document.createElement('canvas');
  out.width = out.height = S;
  const octx = out.getContext('2d');
  const img = octx.createImageData(S, S);
  // 环绕取样：贴图是 RepeatWrapping，边缘必须接得上
  const gray = (x, y) => src[((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (gray(x + 1, y) - gray(x - 1, y)) * strength;
      const dy = (gray(x, y + 1) - gray(x, y - 1)) * strength;
      const l = Math.hypot(-dx, -dy, 1);
      const i = (y * S + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l) * 127 + 128;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/* 砖行布局：一顺一丁错缝（隔行错半砖），与真实砌法一致 */
function brickRows(S, cols, rows, offsetEvery = 2) {
  const bw = S / cols, bh = S / rows, out = [];
  for (let r = 0; r < rows; r++) {
    const off = (r % offsetEvery === 0 ? 0 : bw * 0.5);
    for (let k = 0; k < cols; k++) out.push([k * bw + off, r * bh, bw, bh]);
  }
  return out;
}

/** 城砖砌体 —— 颜色贴图（青灰／黄灰／赭灰，带铭文、风化、苔藓、水渍） */
export function makeWallBrickTexture(S = 512) {
  if (typeof document === 'undefined') return null;
  const c = canvas(S), ctx = c.getContext('2d');
  const rnd = wallPrng(13660266);
  const COLS = 10, ROWS = 10;                 // 一格 4 m × 2 m → 单砖 40×20 cm ✓
  const bw = S / COLS, bh = S / ROWS, gap = Math.max(2, S / 150);
  // 砖缝：石灰糯米汁勾嵌。这里压得比砖面暗——远景上 Brick 会被平均成一片灰，
  // 只有把缝做深、砖面做亮，墙面在几十米外才还读得出"砌体"而不是一块平板。
  ctx.fillStyle = '#6a665b'; ctx.fillRect(0, 0, S, S);
  const tones = ['#8b9189', '#7d8884', '#95978c', '#918b77', '#87918b', '#97938a', '#7c8b87', '#8b9285'];

  for (const [x, y, w, h] of brickRows(S, COLS, ROWS)) {
    ctx.fillStyle = tones[(rnd() * tones.length) | 0];
    ctx.fillRect(x + gap, y + gap, w - gap * 2, h - gap * 2);
    // 窑变与风化：砖面深浅不均
    for (let i = 0; i < 30; i++) {
      const a = 0.04 + rnd() * 0.13;
      ctx.fillStyle = rnd() > 0.5 ? `rgba(255,253,244,${a})` : `rgba(20,18,14,${a})`;
      ctx.fillRect(x + gap + rnd() * (w - gap * 2), y + gap + rnd() * (h - gap * 2), 2 + rnd() * 15, 2 + rnd() * 9);
    }
    // 砖棱：上棱受光提亮、下棱背光压暗，弱光下也能读出砖缝
    ctx.fillStyle = 'rgba(255,250,235,0.15)';
    ctx.fillRect(x + gap, y + gap, w - gap * 2, Math.max(1, gap * 0.7));
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + gap, y + h - gap - Math.max(1, gap * 0.75), w - gap * 2, Math.max(1, gap * 0.75));
    // 崩边：六百年的磕碰
    if (rnd() < 0.3) {
      ctx.fillStyle = '#a9a292';
      const ex = x + gap + rnd() * (w - gap * 2), ey = rnd() < 0.5 ? y + gap : y + h - gap;
      ctx.fillRect(ex, ey, 3 + rnd() * 10, 2 + rnd() * 5);
    }
    // 铭文：明初城砖九成以上刻府县／提调官／窑匠名，远看是字、近看是斑
    if (rnd() < 0.18) {
      ctx.fillStyle = 'rgba(46,44,38,0.5)';
      const cx0 = x + gap + w * 0.24, cy0 = y + gap + h * 0.3, gw = w * 0.5, gh = h * 0.42;
      const n = 2 + ((rnd() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const gx = cx0 + (i % 2) * gw * 0.5, gy = cy0 + ((i / 2) | 0) * gh * 0.5;
        ctx.fillRect(gx, gy, gw * 0.72, 1.6);
        ctx.fillRect(gx + gw * 0.16, gy, 1.6, gh * 0.6);
      }
    }
  }
  // 每皮砖整体色差：砌的时候就是一式一色，六百年后整层偏青／偏赭都很常见。
  // 这是远景唯一还能把"砌"读出来的大尺度信息，比逐砖随机有用得多。
  for (let r = 0; r < ROWS; r++) {
    const y = r * bh, v = (rnd() - 0.5) * 0.22;
    ctx.fillStyle = v > 0 ? `rgba(214,222,206,${v})` : `rgba(46,48,42,${-v})`;
    ctx.fillRect(0, y, S, bh);
  }
  // 大尺度风化斑：水汽沿墙洇开的一片片深浅（2–4 m 见方），
  // 逐砖随机在远处会被积分掉，这一层才留得住。
  for (let i = 0; i < 12; i++) {
    const x = rnd() * S, y = rnd() * S, r = S * (0.18 + rnd() * 0.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() > 0.45;
    g.addColorStop(0, dark ? 'rgba(40,44,36,0.20)' : 'rgba(226,224,208,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // 雨痕：顺墙而下的水渍（下部更重）
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, w = 2 + rnd() * 7, y0 = rnd() * S * 0.75;
    const grd = ctx.createLinearGradient(0, y0, 0, S);
    grd.addColorStop(0, 'rgba(60,58,48,0.02)');
    grd.addColorStop(1, `rgba(52,54,44,${0.06 + rnd() * 0.12})`);
    ctx.fillStyle = grd;
    ctx.fillRect(x, y0, w, S - y0);
  }
  // 苔藓与草：根部沿缝、底部最盛
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S, y = S * (0.45 + rnd() * 0.6), r = 3 + rnd() * 16;
    ctx.fillStyle = `rgba(${84 + rnd() * 40 | 0},${104 + rnd() * 40 | 0},${62 + rnd() * 26 | 0},${0.1 + rnd() * 0.2})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.5, rnd() * 3, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S, y = S * (0.7 + rnd() * 0.32);
    ctx.strokeStyle = `rgba(${96 + rnd() * 50 | 0},${118 + rnd() * 40 | 0},${70 + rnd() * 30 | 0},${0.35 + rnd() * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 7, y - 3 - rnd() * 7); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 城砖砌体 —— 高度图（砖面微拱、缝内凹陷），再由它求法线 */
export function makeWallBrickNormalMap(S = 256) {
  if (typeof document === 'undefined') return null;
  const c = canvas(S), ctx = c.getContext('2d');
  const COLS = 10, ROWS = 10, bw = S / COLS, bh = S / ROWS, gap = Math.max(1.5, S / 150);
  ctx.fillStyle = '#3a3a3a'; ctx.fillRect(0, 0, S, S);                 // 缝底
  for (const [x, y, w, h] of brickRows(S, COLS, ROWS)) {
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(x + gap, y + gap, w - gap * 2, h - gap * 2);
    // 砖面轻微起拱（中间略高）
    const g = ctx.createLinearGradient(0, y + gap, 0, y + h - gap);
    g.addColorStop(0, 'rgba(255,255,255,0.2)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(x + gap, y + gap, w - gap * 2, h - gap * 2);
  }
  const t = new THREE.CanvasTexture(normalFromHeight(c, 3.2));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 墙脚条石勒脚（花岗岩／石灰岩）：块 ~1.2×0.6 m 叠砌，糙面錾痕 */
export function makeWallStoneTexture(S = 256) {
  if (typeof document === 'undefined') return null;
  const c = canvas(S), ctx = c.getContext('2d');
  const rnd = wallPrng(924113);
  const COLS = 4, ROWS = 4;                    // 一格 2.4 m × 1.2 m → 单块 0.6×0.3 m
  const bw = S / COLS, bh = S / ROWS, gap = Math.max(2, S / 90);
  // 勒脚比墙身更耐风化、颜色更浅（花岗岩／石灰岩）：缝底也要浅，
  // 否则勒脚在立面上压出一条黑腰带，整段墙看着像塌了底。
  ctx.fillStyle = '#8f8a7c'; ctx.fillRect(0, 0, S, S);
  for (const [x, y, w, h] of brickRows(S, COLS, ROWS, 4)) {
    const v = 0.86 + rnd() * 0.26;
    ctx.fillStyle = `rgb(${(196 * v) | 0},${(188 * v) | 0},${(172 * v) | 0})`;
    ctx.fillRect(x + gap, y + gap, w - gap * 2, h - gap * 2);
    // 花岗岩粗粒 + 錾凿痕
    for (let i = 0; i < 220; i++) {
      const a = 0.06 + rnd() * 0.16;
      ctx.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      ctx.fillRect(x + gap + rnd() * (w - gap * 2), y + gap + rnd() * (h - gap * 2), 1 + rnd() * 3, 1 + rnd() * 2);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const yy = y + gap + rnd() * (h - gap * 2);
      ctx.beginPath(); ctx.moveTo(x + gap, yy); ctx.lineTo(x + w - gap, yy); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + gap, y + h - gap - Math.max(1, gap * 0.7), w - gap * 2, Math.max(1, gap * 0.7));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 城顶：平砖竖砌散水（内低外高），常年踩踏磨光 → 灰暗、缝深、局部积水痕 */
export function makeWallTopTexture(S = 256) {
  if (typeof document === 'undefined') return null;
  const c = canvas(S), ctx = c.getContext('2d');
  const rnd = wallPrng(770215);
  const COLS = 8, ROWS = 8;                    // 一格 1.6 m × 1.2 m，砖侧立 40×10 cm 排布
  const bw = S / COLS, bh = S / ROWS, gap = Math.max(2, S / 110);
  ctx.fillStyle = '#5f5c53'; ctx.fillRect(0, 0, S, S);       // 竖砖的深缝
  for (const [x, y, w, h] of brickRows(S, COLS, ROWS, 2)) {
    const v = 0.86 + rnd() * 0.22;
    ctx.fillStyle = `rgb(${(158 * v) | 0},${(155 * v) | 0},${(143 * v) | 0})`;
    ctx.fillRect(x + gap, y + gap, w - gap * 2, h - gap * 2);
    // 侧立砖只有 10 cm 厚，正面窄：主要靠砖棱把行数读出来
    ctx.fillStyle = 'rgba(255,250,236,0.13)';
    ctx.fillRect(x + gap, y + gap, w - gap * 2, Math.max(1, gap * 0.6));
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + gap, y + h - gap - Math.max(1, gap * 0.6), w - gap * 2, Math.max(1, gap * 0.6));
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
      ctx.fillRect(x + gap + rnd() * (w - gap * 2), y + gap + rnd() * (h - gap * 2), 2 + rnd() * 8, 2 + rnd() * 5);
    }
  }
  // 踩踏磨光带 + 水渍
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(120,120,110,0.3)');
  g.addColorStop(0.5, 'rgba(150,148,138,0.05)');
  g.addColorStop(1, 'rgba(112,112,104,0.28)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = `rgba(70,72,62,${0.05 + rnd() * 0.09})`;
    ctx.beginPath(); ctx.ellipse(rnd() * S, rnd() * S, 6 + rnd() * 26, 4 + rnd() * 14, rnd() * 3, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ---------------- 几何构建 ---------------- */

/** 强制朝上的四边形集合构造器 */
export class QuadBuilder {
  constructor() { this.pos = []; this.uv = []; this.idx = []; }
  /** p: [[x,z],...] 顺时针或逆时针均可，自动纠正为朝上 */
  addPoly(p, y = 0, uvScale = 0.1) {
    if (p.length < 3) return this;
    // 依据前三点计算朝向，必要时反转，保证法线朝上
    const ux = p[1][0] - p[0][0], uz = p[1][1] - p[0][1];
    const vx = p[2][0] - p[0][0], vz = p[2][1] - p[0][1];
    const ny = uz * vx - ux * vz;
    const pts = ny < 0 ? p.slice().reverse() : p;
    const base = this.pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      this.pos.push(pts[i][0], y, pts[i][1]);
      this.uv.push(pts[i][0] * uvScale, pts[i][1] * uvScale);
    }
    for (let i = 1; i < pts.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
    return this;
  }
  addRect(cx, cz, w, d, y = 0, rot = 0, uvScale = 0.1) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const hw = w / 2, hd = d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [
      cx + x * c - z * s, cz + x * s + z * c,
    ]);
    this.addPoly(corners, y, uvScale);
    return this;
  }
  build(flat = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    if (flat) {
      const n = new Float32Array((this.pos.length / 3) * 3);
      for (let i = 0; i < n.length / 3; i++) n[i * 3 + 1] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    } else g.computeVertexNormals();
    return g;
  }
}

/**
 * 沿折线生成带状面（道路 / 河流），自动纠正朝上
 * width 可为数值或回调 (t01) => number
 */
export function ribbonGeometry(points, width, y = 0.02, uvScale = 0.12) {
  const n = points.length;
  const pos = [], uv = [], idx = [];
  let acc = 0; const cum = [0];
  for (let i = 1; i < n; i++) {
    acc += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    cum.push(acc);
  }
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const w = typeof width === 'function' ? width(n > 1 ? i / (n - 1) : 0) : width;
    // 侧向法线 n = (-dz, dx)，依次写入 A(+n 侧) 与 B(-n 侧)
    pos.push(points[i][0] - dz * w * 0.5, y, points[i][1] + dx * w * 0.5);
    pos.push(points[i][0] + dz * w * 0.5, y, points[i][1] - dx * w * 0.5);
    const u = cum[i] * uvScale;
    uv.push(u, 0, u, 1);
    if (i < n - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const nor = new Float32Array((pos.length / 3) * 3);
  for (let i = 0; i < nor.length / 3; i++) nor[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** 简单多边形 -> XZ 平面上的水平面片 */
export function polygonGeometry(points, y = 0, holes = []) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);          // XY -> XZ
  g.translate(0, y, 0);
  // ShapeGeometry 的朝向：旋转后可能朝下，检查并翻转
  const nor = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < nor.length / 3; i++) nor[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const idx = g.index.array;
  if (idx && idx.length >= 3) {
    const p0 = [], p1 = [], p2 = [];
    ['x', 'y', 'z'].forEach((k, j) => {
      p0.push(g.attributes.position.array[idx[0] * 3 + j]);
      p1.push(g.attributes.position.array[idx[1] * 3 + j]);
      p2.push(g.attributes.position.array[idx[2] * 3 + j]);
    });
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const ny = u[2] * v[0] - u[0] * v[2];
    if (ny < 0) {
      const arr = Array.from(idx);
      for (let i = 0; i < arr.length; i += 3) {
        const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t;
      }
      g.setIndex(arr);
    }
  }
  return g;
}

/* ---------------- 材质 shader 补丁（可叠加，自动维护 program 缓存键） -------------
 * 同一材质可能被多处改写（立面 UV 重映射、城市 AO、雾……）。
 * 直接覆盖 onBeforeCompile 会互相踩踏，因此统一走这里：
 * 补丁按名字去重、按注册顺序执行，customProgramCacheKey 由补丁名拼出，
 * 保证「补丁组合不同 => 程序不同」，组合相同则共用程序。
 */
export function patchMaterial(material, name, fn) {
  const list = material.userData.__patches || (material.userData.__patches = []);
  if (list.some((p) => p.name === name)) return material;
  list.push({ name, fn });
  material.onBeforeCompile = (shader, renderer) => {
    for (const p of list) p.fn(shader, renderer);
  };
  material.customProgramCacheKey = () => list.map((p) => p.name).join('|');
  return material;
}

/* ---------------- 环境反射强度登记表 ----------------
 * 共享环境贴图（PMREM）按材质分别控制强度：玻璃幕墙要亮、土地山体要弱。
 */
const ENV_MATS = [];
export function registerEnv(material, base = 0.5) {
  if (!material || material.userData.envRegistered) return material;
  material.userData.envRegistered = true;
  material.userData.envBase = base;
  material.envMapIntensity = base;
  ENV_MATS.push(material);
  return material;
}
let lastEnvK = -1;
export function setEnvIntensity(k) {
  // 自动昼夜每帧都会路过这里；逐材质写 envMapIntensity 是白烧，值几乎不变时直接跳过
  if (Math.abs(k - lastEnvK) < 0.004) return;
  lastEnvK = k;
  for (const m of ENV_MATS) m.envMapIntensity = (m.userData.envBase ?? 1) * k;
}

/* ---------------- 单位几何体（以原点为底，便于按 scale 摆放） ---------------- */
export const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16).translate(0, 0.5, 0),
  cone4: new THREE.ConeGeometry(0.5, 1, 4).translate(0, 0.5, 0),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
};

/**
 * 实例化方块群（楼体、裙房、退台、屋顶设备……）
 * items: [{ x, z, y, w, h, d, rot, r2, r3, tint, shade }]
 * 自带 aUv 实例化属性（配合 patchMaterial 的 'aUv' 补丁做逐实例 UV 重映射）
 */
export function instancedBoxes(items, material, opts = {}) {
  const n = items.length;
  if (!n) return null;
  const geo = UNIT.box.clone();
  const uvArr = new Float32Array(n * 4);
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.castShadow = opts.cast !== false;
  mesh.receiveShadow = opts.receive !== false;
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const b = items[i];
    dummy.position.set(b.x, b.y || 0, b.z);
    dummy.rotation.set(0, b.rot || 0, 0);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (b.tint) {
      col.set(b.tint);
      if (b.shade !== undefined) col.multiplyScalar(b.shade);
      mesh.setColorAt(i, col);
    }
    uvArr[i * 4] = b.r2 ?? 0.5;
    uvArr[i * 4 + 1] = b.r3 ?? 0.5;
    uvArr[i * 4 + 2] = Math.max(1, Math.round(b.w / (opts.uvU || 1.45)));
    uvArr[i * 4 + 3] = Math.max(1, Math.round(b.h / (opts.uvV || 1.6)));
  }
  geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uvArr, 4));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/**
 * 合批：把一棵子树里「静态且同材质」的 mesh 合并成少量大 mesh。
 *
 * 这是本项目最大的一笔性能开销来源：22 处地标共 1121 个 mesh，主 pass 与阴影 pass
 * 各画一遍，每帧约 2200 次 draw call；合并后降到约 180 次。
 *
 * @param root     待合并子树的根（通常是某个地标的 group）
 * @param exclude  需要保持原样的节点集合（会动的部件，如水面船只）及其子孙
 * @returns        { before, after, tris } 便于在控制台核对收益
 */
export function mergeStaticMeshes(root, exclude = null) {
  const skip = new Set();
  if (exclude && exclude.size) {
    for (const e of exclude) { const s = [e]; while (s.length) { const n = s.pop(); skip.add(n); (n.children || []).forEach((c) => s.push(c)); } }
  }

  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const tmpM = new THREE.Matrix4();
  const buckets = new Map();          // material -> [{ geo, cast, receive }]
  const doomed = [];                  // [mesh, parent]

  let before = 0;
  const im = new THREE.Matrix4();
  const collect = (o) => {
    for (const c of o.children.slice()) {
      if (skip.has(c)) continue;
      if (c.isMesh) {
        if (c.userData && c.userData.noMerge) continue;   // 实例化装饰构件保持原样（单 draw call，不被展开合批）
        if (!c.geometry || !c.geometry.attributes.position) continue;
        if (Array.isArray(c.material)) continue;          // 多材质 mesh 不动
        before++;
        const key = c.material.uuid;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { material: c.material, list: [], cast: false, receive: false }));
        if (c.isInstancedMesh) {
          // InstancedMesh 的实例位置/缩放存放在 instanceMatrix 里，必须逐实例展开，
          // 否则只会把「单位立方体」按 mesh 的世界矩阵烘焙一次，所有实例塌缩成一个盒子。
          const base = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
          for (let ii = 0; ii < c.count; ii++) {
            c.getMatrixAt(ii, im);
            const world = new THREE.Matrix4().multiplyMatrices(c.matrixWorld, im);
            const g2 = base.clone();
            if (!g2.attributes.normal) g2.computeVertexNormals();
            if (!g2.attributes.uv) {
              const n = g2.attributes.position.count;
              g2.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
            }
            g2.applyMatrix4(tmpM.multiplyMatrices(inv, world));
            b.list.push(g2);
          }
          base.dispose();
        } else {
          let geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
          if (!geo.attributes.normal) geo.computeVertexNormals();
          if (!geo.attributes.uv) {
            const n = geo.attributes.position.count;
            geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
          }
          geo.applyMatrix4(tmpM.multiplyMatrices(inv, c.matrixWorld));
          b.list.push(geo);
        }
        b.cast = b.cast || !!c.castShadow;
        b.receive = b.receive || !!c.receiveShadow;
        doomed.push([c, o]);
      } else if (c.children && c.children.length) collect(c);
    }
  };
  collect(root);

  let after = 0, tris = 0;
  for (const b of buckets.values()) {
    if (!b.list.length) continue;
    const geo = concatGeometries(b.list);
    for (const g of b.list) g.dispose();
    const m = new THREE.Mesh(geo, b.material);
    m.name = 'merged';
    m.castShadow = b.cast;
    m.receiveShadow = b.receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
    after++;
    tris += (geo.attributes.position ? geo.attributes.position.count : 0) / 3;
  }
  for (const [mesh, parent] of doomed) parent.remove(mesh);
  return { before, after, tris: Math.round(tris) };
}

/** 把属性结构一致的一组几何首尾相接（只保留 position / normal / uv） */
function concatGeometries(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let vo = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    const c = p.count;
    // 逐分量读取而非整块拷贝：兼容 InterleavedBufferAttribute
    for (let i = 0; i < c; i++) {
      const o3 = (vo + i) * 3, o2 = (vo + i) * 2;
      pos[o3] = p.getX(i); pos[o3 + 1] = p.getY(i); pos[o3 + 2] = p.getZ(i);
      nor[o3] = n.getX(i); nor[o3 + 1] = n.getY(i); nor[o3 + 2] = n.getZ(i);
      uv[o2] = t.getX(i); uv[o2 + 1] = t.getY(i);
    }
    vo += c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

/** 快速放置一个 mesh（单位几何 + scale + 旋转） */
export function put(parent, geo, material, { pos = [0, 0, 0], scale = [1, 1, 1], rot = 0, rotX = 0, rotZ = 0 }) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(scale[0], scale[1], scale[2]);
  m.rotation.set(rotX, rot, rotZ);
  parent.add(m);
  return m;
}

/* ==================== 道路铺装 ====================
 * 沥青／标线／人行道一起才叫「一比一」：
 * 车道线宽 15 cm、虚线 4 m 划 + 6 m 空，这些尺寸都得落到贴图上。 */

/** 车行道沥青：粗骨料露石 + 轮辙 + 纵向接缝 + 补丁 */
export function makeAsphaltTexture(S = 512) {
  if (typeof document === 'undefined') return null;
  const c = canvas(S), ctx = c.getContext('2d');
  const rnd = wallPrng(551207);
  ctx.fillStyle = '#3b3d41'; ctx.fillRect(0, 0, S, S);

  // 粗骨料：露在外面的集料颗粒决定沥青的「砂感」，没有它贴图会糊成塑料板
  for (let i = 0; i < 26000; i++) {
    const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 2.1;
    const v = 0.72 + rnd() * 0.5;
    ctx.fillStyle = 'rgba(' + ((88 * v) | 0) + ',' + ((90 * v) | 0) + ',' + ((92 * v) | 0) + ',' + (0.25 + rnd() * 0.5) + ')';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }
  // 沥青胶结料斑：大尺度深浅不均
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S, r = S * (0.05 + rnd() * 0.14);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() > 0.45;
    g.addColorStop(0, dark ? 'rgba(20,21,24,0.30)' : 'rgba(120,122,126,0.20)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }
  /* 沥青贴图是 8 m × 8 m 一循环铺满整条路的（world.js：u = 沿线米/8，v = 横向米/8），
   * 所以**任何周期性成分都会被铺成规则网格**，再在掠射角下与像素栅格打出摩尔纹 ——
   * 表现就是路面上浮出一层层菱形/链条花纹（比真沥青显眼得多，一眼假）。
   * 早先这里画了 1 条纵向摊铺缝 + 3 条横向接缝 + 两条固定位置的轮辙磨光带，
   * 正好凑成 8 m / 2.7 m / 2.4 m 三个周期的网格。现在只留一条极淡的纵向缝，
   * 其余交给**非周期**的信息：骨料、胶结料斑、补丁。 */
  ctx.fillStyle = 'rgba(18,19,21,0.20)';
  ctx.fillRect(0, 0, S * 0.006, S);
  // 补丁：井盖周边补铺的方形块（城市道路上最多的一类小尺度信息）
  for (let i = 0; i < 9; i++) {
    const x = rnd() * S, y = rnd() * S, w = S * (0.05 + rnd() * 0.1), h = w * (0.5 + rnd() * 0.8);
    ctx.fillStyle = 'rgba(58,60,64,0.5)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(150,150,152,0.18)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
  // 大尺度深浅不均（非周期）：摊铺机一走一停留下的冷接缝区，比规则网格自然
  for (let i = 0; i < 5; i++) {
    const x = rnd() * S, y = rnd() * S, w = S * (0.25 + rnd() * 0.4), h = S * (0.12 + rnd() * 0.25);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(14,15,17,' + (0.06 + rnd() * 0.10).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 车道标线：u 沿行车方向一循环 = 12 m（4 m 划 + 8 m 空），v 沿线宽方向 */
export function makeLaneMarkTexture(S = 128, color = '#e8e6df') {
  if (typeof document === 'undefined') return null;
  const c = canvas(S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const dash = S * (4 / 12);
  ctx.fillStyle = color;
  ctx.fillRect(0, S * 0.10, dash, S * 0.80);
  // 磨损：标线用久了是斑驳的，整条纯白会像塑料
  const rnd = wallPrng(88117);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * dash, y = rnd() * S;
    ctx.fillStyle = 'rgba(0,0,0,' + (0.10 + rnd() * 0.35) + ')';
    ctx.fillRect(x, y, 1 + rnd() * 7, 1 + rnd() * 3);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(0, 0, dash, 2); ctx.fillRect(0, S - 3, dash, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 人行道：灰色混凝土地砖 + 盲道条（距路缘连续，横条状提示块） */
export function makeSidewalkTexture(S = 256) {
  if (typeof document === 'undefined') return null;
  const c = canvas(S), ctx = c.getContext('2d');
  const rnd = wallPrng(330091);
  ctx.fillStyle = '#a9a49b'; ctx.fillRect(0, 0, S, S);
  const N = 4, cell = S / N, gap = Math.max(2, S / 110);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const v = 0.9 + rnd() * 0.18;
    ctx.fillStyle = 'rgb(' + ((176 * v) | 0) + ',' + ((173 * v) | 0) + ',' + ((166 * v) | 0) + ')';
    ctx.fillRect(i * cell + gap, j * cell + gap, cell - gap * 2, cell - gap * 2);
  }
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * S, y = rnd() * S;
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // 盲道：贴图 x = 沿行车方向、y = 横向。导向盲道要沿行车方向连续、被横纹切断，
  // 画成「沿 x 的通条 + 沿 y 的横纹」——早先画反了，纹路会变成横着爬的栅栏。
  ctx.fillStyle = '#c8a449'; ctx.fillRect(0, S * 0.42, S, S * 0.16);
  ctx.fillStyle = '#8d6f2e';
  for (let y = S * 0.44; y < S * 0.57; y += S / 9) ctx.fillRect(0, y, S, S / 26);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 侧石立面：花岗岩条石，贴图横向 = 沿路 1 m 一块，纵向 = 侧石高度（上棱磨圆、底部积污） */
export function makeCurbTexture(S = 128) {
  if (typeof document === 'undefined') return null;
  const c = canvas(S), ctx = c.getContext('2d');
  const rnd = wallPrng(66123);
  ctx.fillStyle = '#8d8779'; ctx.fillRect(0, 0, S, S);
  const N = 6, w = S / N;
  for (let i = 0; i < N; i++) {
    const v = 0.9 + rnd() * 0.2;
    ctx.fillStyle = 'rgb(' + ((158 * v) | 0) + ',' + ((152 * v) | 0) + ',' + ((140 * v) | 0) + ')';
    ctx.fillRect(i * w + 1, 0, w - 2, S);
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';
      ctx.fillRect(i * w + rnd() * w, rnd() * S, 1 + rnd() * 6, 1 + rnd() * 3);
    }
    ctx.fillStyle = 'rgba(235,232,224,0.5)'; ctx.fillRect(i * w + 1, 0, w - 2, S * 0.14);
    ctx.fillStyle = 'rgba(40,38,34,0.45)'; ctx.fillRect(i * w + 1, S * 0.82, w - 2, S * 0.18);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
