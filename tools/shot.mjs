// 无头浏览器截图：node tools/shot.mjs <输出名> <?query 串> [等待上限 ms]
//   query 以 http 开头 → 直接打那个地址（自检用隔离页）；
//   否则拼 http://127.0.0.1:$PORT/index.html<query>（PORT 环境变量，默认 8137 与 serve.mjs 一致），
//   用 ?cam=/?gate=/?t= 之类调试机位打开即所见。
//
// 为什么不用 `msedge --screenshot --virtual-time-budget=14000`（旧写法）：
// 虚拟时间只快进定时器，不等真实网络/CPU。本项目的首屏要拉 1.6 MB 的 ferrari.glb
// + 6 台车模 + Draco 解码 + AO 烘焙，几秒到几十秒不等；虚拟时间预算会在页面还停在
// 「装载外部 GLB 资产」时就到期，截出来是**加载遮罩**（一块灰底 + 进度条），
// 白跑一轮还容易误判成"改动没生效"。改成走 CDP：等 #loading.done 真正挂上再截。
//
// 端口预检：serve 没起/起在别的端口时，立即报错并给出命令提示——
// 不预检的话 Edge 会对着 connection-refused 干等满 waitMs(默认 180s) 才超时。
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] || 'shot.png';
const query = process.argv[3] || '';
const waitMs = Number(process.argv[4] || 180000);
const PORT = Number(process.env.PORT || 8137);   // 与 tools/serve.mjs 默认一致;tour.mjs 自起 8151 互不干扰
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = /^http/.test(query) ? query : `http://127.0.0.1:${PORT}/index.html${query}`;
const target = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
const ROOT = 'C:/Users/Administrator/Desktop/GTA-NJ/';
const file = `${ROOT}.workbuddy/${out}`;
if (!existsSync(EDGE)) { console.error('未找到 Edge'); process.exit(1); }

// 端口预检（仅对本地地址）：连不上就立刻失败，不浪费一整轮 waitMs
if (/^http:\/\/127\.0\.0\.1/.test(url)) {
  const reachable = await fetch(url, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok || r.status === 304).catch(() => false);
  if (!reachable) {
    console.error(`端口 ${PORT} 没有服务在响应(${url})。`);
    console.error(`先起服务:  node tools/serve.mjs ${PORT}    (或 PORT=<端口> node tools/shot.mjs 指定)`);
    process.exit(1);
  }
}

const profile = mkdtempSync(join(tmpdir(), 'gta-nj-cdp-'));
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu-sandbox', '--no-sandbox',
  ...(process.env.GPU ? [] : ['--use-angle=swiftshader']),
  '--hide-scrollbars', '--window-size=1280,800',
  '--remote-debugging-port=9222', `--user-data-dir=${profile}`,
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
      const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP 未起来（9222 端口被占？）');
}

const page = await findPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const id = Math.floor(Math.random() * 1e9);
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: target });

const t0 = Date.now();
let stage = '';
for (;;) {
  if (Date.now() - t0 > waitMs) { console.error(`超时未就绪（最后阶段：${stage}）`); cleanup(1); }
  await sleep(1500);
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const l = document.querySelector('#loading'); return l && l.classList.contains('done') ? '1' : ('0|' + (l ? l.innerText.replace(/\\s+/g, ' ').slice(0, 48) : 'no-loading')); })()`,
    returnByValue: true,
  });
  const v = r.result && r.result.result && r.result.result.value;
  if (v === '1') break;
  if (v) stage = v.slice(2);
}
// 再等两帧动画 + 相机落位，避免截在首帧
await sleep(2500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (!shot.result || !shot.result.data) { console.error('截图失败'); cleanup(1); }
writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
console.log('ok ->', file);
cleanup(0);
