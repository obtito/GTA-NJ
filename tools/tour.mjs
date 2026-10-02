// 全 POI 无头巡检验收:一页多 POI 免刷新导航,逐点定机位截图 + 页面错误收集
// 用法: node tools/tour.mjs                 → 巡检 window.__njTour.pois 全部 37 项(22 地标 + 15 城门)
//       node tools/tour.mjs zifeng gate:中华门  → 只巡指定子集
//       TOUR_NIGHT=1 node tools/tour.mjs   → 夜景轮(21.5h);默认白天 15h
// 截图输出 docs/shots/tour/;零页面错误且张数齐全时退出码 0,可直接接 CI。
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';

// Playwright 复用 GTA-SZ 的安装,浏览器用 ms-playwright 缓存的 Chromium;两者缺一直接退出
const PW_PATH = 'C:/Users/Administrator/Desktop/GTA-SZ/node_modules/playwright/index.js';
const CHROME_PATH = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe';
for (const p of [PW_PATH, CHROME_PATH]) {
  if (!existsSync(p)) {
    console.error(`巡检依赖缺失: ${p}`);
    console.error('兜底方案: 用 tools/shot.mjs(Edge --headless=new)做单点截图验收。');
    process.exit(1);
  }
}
const require = createRequire(import.meta.url);
const { chromium } = require(PW_PATH);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8151;                    // 避开 serve 默认 8137 与 GTA-WH tour 的 8150
const OUT = resolve(root, 'docs/shots/tour');
mkdirSync(OUT, { recursive: true });

const NIGHT_H = process.env.TOUR_NIGHT === '1' ? 21.5 : 15;   // 白天 15 / 夜景 21.5
const LOAD_TIMEOUT = 120000;          // 全城构建含 AO 烘焙,给足 2 分钟

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portUp = () => new Promise((r) => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 2000 }, (res) => { res.resume(); r(true); });
  req.on('error', () => r(false));
  req.on('timeout', () => { req.destroy(); r(false); });
});

// 端口已被占用 → 直接复用现成服务;否则自起本仓 serve.mjs,退出时 kill
let server = null;
if (await portUp()) {
  console.log(`端口 ${PORT} 已有服务, 直接复用`);
} else {
  server = spawn(process.execPath, [resolve(root, 'tools/serve.mjs'), String(PORT)], { stdio: 'pipe' });
  for (let i = 0; i < 50 && !(await portUp()); i++) await sleep(200);
  if (!(await portUp())) { console.error(`serve.mjs 未能在端口 ${PORT} 起来`); server.kill(); process.exit(1); }
}

const errors = [];
let pois = [];
let shots = 0;
try {
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`));
  page.on('console', (m) => {
    // favicon 404 是噪音(Chrome 的该类消息文本不含 URL,必须连 location().url 一起判),其余 error 一律计入
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (/favicon/i.test(m.text()) || /favicon/i.test(url)) return;
    errors.push(`[console] ${m.text().slice(0, 300)}${url ? ' @ ' + url.slice(0, 120) : ''}`);
  });

  // ?lm=none 直达模式: 立即收遮罩且跳过开场自动选中
  await page.goto(`http://127.0.0.1:${PORT}/?lm=none`, { waitUntil: 'domcontentloaded' });
  // 加载遮罩完成后是隐藏状态(display:none 一类),等「挂上 .done」而非「可见」
  await page.waitForSelector('#loading.done', { timeout: LOAD_TIMEOUT, state: 'attached' });

  const allPois = await page.evaluate(() => (window.__njTour ? window.__njTour.pois : null));
  if (!Array.isArray(allPois) || !allPois.length) throw new Error('页面侧 window.__njTour.pois 不可用');
  pois = process.argv.slice(2).length ? process.argv.slice(2) : allPois;
  console.log(`巡检 ${pois.length}/${allPois.length} 个 POI · ${NIGHT_H}h${process.env.TOUR_NIGHT === '1' ? '(夜景)' : ''} → docs/shots/tour/`);

  // 开拍前统一定时刻, 等 PMREM 重烘焙(ENV_COOLDOWN=1200ms)落定
  await page.evaluate((h) => window.__njTour.setTime(h), NIGHT_H);
  await page.waitForTimeout(1800);

  for (const [i, id] of pois.entries()) {
    const t0 = Date.now();
    const ok = await page.evaluate((pid) => window.__njTour.goto(pid), id);
    if (!ok) errors.push(`[goto] ${id}: __njTour.goto 返回 false(未命中该 POI)`);
    await page.waitForTimeout(i === 0 ? 1600 : 1200);
    // gate:中华门 → gate-中华门.png;":"换"-",再剔除 Windows 非法字符(中文保留)
    const file = id.replace(/:/g, '-').replace(/[\\/:*?"<>|]/g, '');
    await page.screenshot({ path: resolve(OUT, `${file}.png`) });
    shots++;
    console.log(`${ok ? '✓' : '✗'} ${id} → ${file}.png (${Date.now() - t0}ms)`);
  }
  await browser.close();
} catch (e) {
  console.error('巡检失败:', e.message);
  errors.push(`[fatal] ${String(e.message).slice(0, 300)}`);
} finally {
  if (server) server.kill();
}
if (errors.length) {
  console.log(`✗ ${shots}/${pois.length} · ${errors.length} 处错误:`);
  for (const e of errors) console.log('  ' + e);
} else {
  console.log(`✓ ${shots}/${pois.length} · 无页面错误`);
}
process.exit(errors.length || shots !== pois.length ? 1 : 0);
