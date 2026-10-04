// 行人 Phase 2 无头验收：门控三态真实发生 + 安全不变量恒成立 + 等灯队列会放行。
//   node tools/pedestrian-check.mjs
// 判定口径（行人步速 ~0.035 u/s，300+ sim-s 才有足够统计量）：
//   1) 全程无 pageerror / console.error；
//   2) 门数 > 0（junctions 注入成功）；
//   3) 500 sim-s 采样中观察到 waiting>0（红灯有人等）与 crossing>0（有人过街）；
//   4) violations 恒 0 —— 穿越中被穿轴永远是红/黄（放行判据不失效，人不会被放行车流穿过）；
//   5) 最忙路口的等待队列在绿灯后清零（等灯-放行节律成立）；
//   6) 坐标零 NaN。
// 截图输出 .workbuddy/ped-phase{1,2}.png（等灯队列 vs 放行后的同路口）。
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

const profile = mkdtempSync(join(tmpdir(), 'gta-nj-ped-'));
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu-sandbox', '--no-sandbox',
  ...(process.env.GPU ? [] : ['--use-angle=swiftshader']),
  '--hide-scrollbars', '--window-size=1280,800',
  '--remote-debugging-port=9231', `--user-data-dir=${profile}`,
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
      const list = await (await fetch('http://127.0.0.1:9231/json/list')).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP 未起来（9231 端口被占？）');
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

// 热身 40 sim-s 成稳态，随后 100 × 5 sim-s 采样（共 500 sim-s ≈ 行人走 17u，门到达统计量足够）
await evalJs(`window.__njSimTick(40)`);
const samples = [];
const junctionSeries = [];
for (let k = 0; k < 100; k++) {
  await evalJs(`window.__njSimTick(5)`);
  const s = await evalJs(`(() => {
    const d = window.__njPeds.debug();
    const js = window.__njSignals();
    const per = js.map((j) => window.__njPeds.waitingAt(j.x, j.z, 0.7));
    return JSON.stringify({ ...d, viol: window.__njPeds.violations(), per });
  })()`);
  samples.push(JSON.parse(s));
}
console.log('采样摘要（每 5 sim-s × 100）：');
const agg = samples.reduce((a, s) => {
  a.maxWait = Math.max(a.maxWait, s.waiting); a.maxCross = Math.max(a.maxCross, s.crossing);
  a.maxViol = Math.max(a.maxViol, s.viol); a.gates = s.gates; a.nan = Math.max(a.nan, s.nan);
  return a;
}, { maxWait: 0, maxCross: 0, maxViol: 0, gates: 0, nan: 0 });
console.log('  ' + JSON.stringify(agg));
const waits = samples.map((s) => s.waiting).join('');
const crosses = samples.map((s) => s.crossing).join('');
console.log(`  waiting 序列: ${waits}`);
console.log(`  crossing 序列: ${crosses}`);

// 最忙路口：等待峰值最大者，断言其序列「峰值后归零」（绿灯放行）
const nJ = samples[0].per.length;
const perPeak = new Array(nJ).fill(0);
const perSeries = samples.map((s) => s.per);
for (let j = 0; j < nJ; j++) for (const per of perSeries) if (per[j] > perPeak[j]) perPeak[j] = per[j];
const bestJ = perPeak.indexOf(Math.max(...perPeak));
const bestSeries = perSeries.map((per) => per[bestJ]).join('');
console.log(`各路口等待峰值: ${perPeak.join(' ')}；最忙 #${bestJ} 序列: ${bestSeries}`);

// 两相位截图：机位到最忙路口，隔半周期拍第二张
const jpos = await evalJs(`JSON.stringify(window.__njSignals()[${Math.max(bestJ, 0)}] || window.__njSignals()[0])`);
const { x: jx, z: jz } = JSON.parse(jpos);
await evalJs(`window.__njCam(${jx}, 0.1, ${jz}, 0.9, 52, 40)`);
await sleep(1500);
const shot1 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${ROOT}.workbuddy/ped-phase1.png`, Buffer.from(shot1.result.data, 'base64'));
await evalJs(`window.__njSimTick(13)`);
await sleep(1500);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${ROOT}.workbuddy/ped-phase2.png`, Buffer.from(shot2.result.data, 'base64'));
console.log('截图 -> .workbuddy/ped-phase1.png / ped-phase2.png');

// 性能红线断言：单次 update(1/240) 壁钟（100 次均值）。阈值 0.2ms = node 实测 0.066ms 的
// 3 倍余量；浏览器与 node 同 V8，数字可直接对照。headless swiftshader 不影响纯 JS 侧计时。
const perfMs = await evalJs(`(() => {
  const t = performance.now();
  for (let k = 0; k < 100; k++) window.__njPeds.update(1 / 240);
  return (performance.now() - t) / 100;
})()`);

// ---- 判定 ----
let fail = 0;
if (perfMs > 0.2) { fail++; console.log(`!! 行人 update 单帧 ${perfMs.toFixed(3)}ms > 0.2ms 红线（240fps 预算被吃穿）`); }
else console.log(`行人 update 单帧 ${perfMs.toFixed(3)}ms（红线 0.2ms 内）`);
if (errors.length) { fail++; console.log('!! 页面错误 ' + errors.length + ' 条：'); for (const e of errors.slice(0, 5)) console.log('   ' + e); }
else console.log('页面错误：0');
if (!agg.gates) { fail++; console.log('!! gates=0：junctions 没接进行人门控'); }
if (!agg.maxWait) { fail++; console.log('!! 500 sim-s 无人等灯：门控未生效'); }
if (agg.gates && !agg.maxCross) { fail++; console.log('!! 有人等灯但无人过街：放行判据失效（死等）'); }
if (agg.maxViol) { fail++; console.log(`!! 安全不变量失守 ${agg.maxViol} 人次：绿灯期有人在穿越走廊`); }
else console.log('安全不变量：穿越期被穿轴恒红/黄（0 违例）');
if (agg.nan) { fail++; console.log('!! 坐标 NaN：' + agg.nan); }
if (Math.max(...perPeak) > 0) {
  const peakIdx = bestSeries.indexOf(String(Math.max(...perPeak)));
  const after = bestSeries.slice(peakIdx);
  if (!after.includes('0')) { fail++; console.log(`!! 最忙路口等待队列从不归零：绿灯没放行（${bestSeries}）`); }
  else console.log(`最忙路口等待峰值 ${Math.max(...perPeak)} 人，绿灯后归零（等灯-放行节律成立）`);
} else {
  console.log('（本轮无路口聚集等待——线上人到达门是泊松过程，弱断言：全局 waiting 峰值 ' + agg.maxWait + '）');
}

console.log(fail ? `=== 不通过（${fail} 项）===` : '=== 通过 ===');
cleanup(fail ? 1 : 0);
