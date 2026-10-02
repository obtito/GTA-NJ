// tools/serve.mjs — 本地开发服务器（强制不缓存）
//
// 为什么不用 `python -m http.server`：它只回 Last-Modified、不回 Cache-Control，
// 浏览器/预览面板会把 ES 模块缓存住。改了 js/*.js 之后刷新仍是旧页面，
// 表现为"改了半天界面毫无变化"，极易误判成修改没生效。
// 这里对所有响应加 no-store，并在启动时打印版本号便于核对。
//
// 用法: npm run serve   （默认 http://localhost:8137/）

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT) || 8137;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
};

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!path.resolve(file).startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }

  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store, must-revalidate',
    Pragma: 'no-cache',
  });
  res.end(body);
}).listen(PORT, () => {
  console.log(`[GTA-NJ] http://localhost:${PORT}/  (no-store · 根目录 ${ROOT})`);
});
