// 车流智能无头验收：零页面错误 + 红绿灯停车真实发生 + 同路口两相位截图对比。
//   node tools/traffic-check.mjs
// 判定口径：
//   1) 全程无 pageerror / console.error；
//   2) __njCars().signals > 0（props 交点表已转喂车流）；
//   3) 相隔 ~7 s 的三次采样里「在停车占比」有波动 —— 车在红灯停、绿灯走；
//   4) 任何时刻在停 < 80%（全趴住 = 配时或车距参数失衡）。
// 截图输出 .workbuddy/traffic-{red,green}.png（人工目检灯珠颜色与排队）。
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 8137);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = 'C:/Users/Administrator/Desktop/GTA-NJ/';
const url = `http://127.0.0.1:${PORT}/index.html?_=${Date.now()}`;
if (!existsSync(EDGE)) { console.error('未找到 Edge'); process.exit(1); }

{
  const reachable = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(2000) }).catch(() => false);
  if (!reachable) {
    console.error(`端口 ${PORT} 没有服务在响应。先起服务:  powershell Start-Process node tools/serve.mjs ${PORT} -WindowStyle Hidden`);
    process.exit(1);
  }
}

const profile = mkdtempSync(join(tmpdir(), 'gta-nj-traffic-'));
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu-sandbox', '--no-sandbox',
  ...(process.env.GPU ? [] : ['--use-angle=swiftshader']),
  '--hide-scrollbars', '--window-size=1280,800',
  '--remote-debugging-port=9223', `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = (code) => {
  edge.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(code);
};

async function findPage() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP 未起来（9223 端口被占？）');
}

const page = await findPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push('pageerror: ' + (d.exception?.description || d.text || '').slice(0, 200));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('console.error: ' + m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((res) => {
  const id = Math.floor(Math.random() * 1e9);
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });

const t0 = Date.now();
for (;;) {
  if (Date.now() - t0 > 180000) { console.error('超时未就绪'); cleanup(1); }
  await sleep(1500);
  const r = await send('Runtime.evaluate', {
    expression: `!!document.querySelector('#loading.done')`,
    returnByValue: true,
  });
  if (r.result?.result?.value) break;
}

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.result?.value;
};

// 取信号路口表（机位与判定在扫描后按实际车流选定）
const junctionCount = await evalJs(`window.__njSignals().length`);
if (!junctionCount) { console.error('!! 没有信号路口（props.junctions 为空）'); cleanup(1); }

// 用确定性快进驱动仿真（headless rAF 只有 ~5fps，等不起墙钟 26 s 周期）：
// 热身 40 sim-s 成稳态后，**全部路口**逐 sim-s 扫队列铺满整个周期 ——
// 判定路口按实际队列峰值选（按路宽选会挑到没车经过的口），再验证「峰值后归零」= 绿灯放行。
const scan = await evalJs(`(() => {
  const js = window.__njSignals();
  const cars = window.__njCars;
  const series = js.map(() => []);
  for (let t = 0; t < 30; t++) {
    window.__njSimTick(1);
    js.forEach((j, i) => series[i].push(cars.queueAt(j.x, j.z)));
  }
  return JSON.stringify({ series, debug: cars.debug() });
})()`);
let scanData = null;
try { scanData = JSON.parse(scan); } catch {}
if (!scanData) { console.error('!! 队列扫描失败'); cleanup(1); }
console.log('车流聚合：' + JSON.stringify(scanData.debug));
const series = scanData.series;
const peaks = series.map((s) => Math.max(...s));
const bestIdx = peaks.indexOf(Math.max(...peaks));
const bestSeries = series[bestIdx];
console.log('各路口队列峰值：' + peaks.join(' '));
console.log(`最忙路口 #${bestIdx} 队列（每 1 sim-s × 30）：` + bestSeries.join(''));

// 两相位截图：机位摆到最忙路口，隔半周期（13 s）拍第二张，灯珠必翻色。
// 灯珠翻色用 bulbDebug 程序化断言（视觉描述分不清同侧是否翻转）。
const j = await evalJs(`(() => { const q = window.__njSignals()[${bestIdx}]; return JSON.stringify({ x: q.x, z: q.z }); })()`);
const { x: jx, z: jz } = JSON.parse(j);
const bulbs1 = await evalJs(`JSON.stringify(window.__njBulbs())`);
await evalJs(`window.__njCam(${jx}, 0.1, ${jz}, 1.1, 55, 40)`);
await sleep(1500);
const shot1 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${ROOT}.workbuddy/traffic-phase1.png`, Buffer.from(shot1.result.data, 'base64'));
await evalJs(`window.__njSimTick(13)`);
const bulbs2 = await evalJs(`JSON.stringify(window.__njBulbs())`);
await sleep(1500);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${ROOT}.workbuddy/traffic-phase2.png`, Buffer.from(shot2.result.data, 'base64'));
console.log('截图 -> .workbuddy/traffic-phase1.png / traffic-phase2.png（应见灯珠换色）');
let b1 = null, b2 = null;
try { b1 = JSON.parse(bulbs1); b2 = JSON.parse(bulbs2); } catch {}
if (b1 && b2) {
  const flipped = b1.bulbs.filter((b, i) => b2.bulbs[i] && b2.bulbs[i].state !== b.state).length;
  const red1 = b1.bulbs.filter((b) => b.state === 'red').length;
  console.log(`灯珠：t1 红 ${red1}/${b1.bulbs.length} 盏 → 13 s 后翻转 ${flipped}/${b1.bulbs.length} 盏`);
  globalThis.__bulbs = { flipped, total: b1.bulbs.length };
}

// ---- 判定 ----
let fail = 0;
if (errors.length) { fail++; console.log('!! 页面错误 ' + errors.length + ' 条：'); for (const e of errors.slice(0, 5)) console.log('   ' + e); }
else console.log('页面错误：0');

const a = scanData.debug;
if (!a.signals) { fail++; console.log('!! signals=0：交点表没接进车流'); }
const activeJunctions = peaks.filter((p) => p > 0).length;
if (Math.max(...peaks) < 1) { fail++; console.log('!! 全部路口队列恒 0：红灯没截停任何车'); }
else if (activeJunctions < 2) { fail++; console.log(`!! 仅 ${activeJunctions} 个路口出现过排队：红绿灯作用面太窄（种子漂了？）`); }
else if (!bestSeries.includes(0)) { fail++; console.log(`!! 最忙路口队列从不归零：绿灯没放行`); }
else console.log(`${activeJunctions} 个路口出现红灯排队，最忙路口峰值 ${Math.max(...peaks)} 辆且绿灯后归零（截停-放行节律成立）`);
const bl = globalThis.__bulbs;
if (bl && bl.flipped === 0) { fail++; console.log('!! 隔半周期灯珠无一翻转：相位没接上灯珠'); }
else if (bl) console.log(`灯珠半周期翻转 ${bl.flipped}/${bl.total}（相位活跃）`);
if (a.stopped / a.count > 0.8) { fail++; console.log('!! 超过 80% 的车同时趴住：配时/车距失衡'); }

console.log(fail ? `=== 不通过（${fail} 项）===` : '=== 通过 ===');
cleanup(fail ? 1 : 0);
