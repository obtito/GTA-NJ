// 静态预检：只把源码解析成 ES Module 记录，不执行、不解析依赖、不碰 WebGL/DOM。
// 存在的意义：main.js 一旦出现重名 let/const 之类的问题，浏览器是整页白屏且毫无提示，
// 从「改完代码」到「打开页面才发现白屏」之间没有任何告警，排查成本极高。
// 用 `node --check` 逐个 spawn 子进程在受限环境里会 EBUSY，所以改用 vm.SourceTextModule
// 在同一个进程里做纯语法解析。
// 用法：npm run check
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => p.replace(root + '\\', '').replace(/\//g, '/');
const files = [
  ...readdirSync(root).filter((f) => f.endsWith('.mjs')).map((f) => join(root, f)),
  ...readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'js', f)),
  ...readdirSync(join(root, 'tools')).filter((f) => f.endsWith('.mjs')).map((f) => join(root, 'tools', f)),
];

if (typeof vm.SourceTextModule !== 'function') {
  console.error('需要 --experimental-vm-modules：node --experimental-vm-modules tools/check.mjs');
  process.exit(2);
}

let bad = 0;
for (const f of files) {
  try {
    new vm.SourceTextModule(readFileSync(f, 'utf8'), { identifier: pathToFileURL(f).href });
  } catch (e) {
    bad++;
    console.error(`✗ ${rel(f)}  ${e.message}`);
    const loc = e.stack?.match(/<anonymous>:(\d+)/);
    if (loc) console.error(`    .js:${loc[1]}`);
  }
}
console.log(bad ? `语法预检失败：${bad}/${files.length} 个文件有语法错误` : `语法预检通过：${files.length} 个文件`);
process.exit(bad ? 1 : 0);
