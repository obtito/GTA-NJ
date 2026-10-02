// 无头浏览器截图：node tools/shot.mjs <输出名> <?query 串>
//   query 以 http 开头 → 直接打那个地址（自检用隔离页）；
//   否则拼 http://127.0.0.1:8138/index.html<query>，用 ?cam=/?gate=/?t= 之类调试机位打开即所见。
// 注意：--screenshot 必须给绝对路径，Edge 按自身 cwd 解析相对路径会静默落空。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const out = process.argv[2] || 'shot.png';
const query = process.argv[3] || '';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = /^http/.test(query) ? query : `http://127.0.0.1:8138/index.html${query}`;
const target = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
const ROOT = 'C:/Users/Administrator/Desktop/GTA-NJ/';
const file = `${ROOT}.workbuddy/${out}`;
if (!existsSync(EDGE)) { console.error('未找到 Edge'); process.exit(1); }
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--no-sandbox',
  '--hide-scrollbars', '--window-size=1280,800',
  '--virtual-time-budget=14000',
  `--screenshot=${file}`, target,
], { stdio: 'ignore', timeout: 600000 });
console.log('ok ->', file);
