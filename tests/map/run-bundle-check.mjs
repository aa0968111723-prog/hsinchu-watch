#!/usr/bin/env node
// 打包後驗收：先用 tests/map/vite.atlas.config.mjs 把 atlas.html 打包到 artifacts/atlas-build，
// 起一個只服務該資料夾的靜態伺服器，再對它跑 verify-atlas.mjs。
// 用法：node tests/map/run-bundle-check.mjs [截圖資料夾]
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'artifacts/atlas-build');
const screenshots = process.argv[2] ?? join(root, 'artifacts/screens');
const run = (args) => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });

const build = run([join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'tests/map/vite.atlas.config.mjs']);
if (build.status !== 0) process.exit(build.status ?? 1);

// 送出正式站的安全標頭（public/_headers 的全站區塊，含 CSP），這樣行內腳本或外部連線被擋時測試會看到。
// HSTS 與 upgrade-insecure-requests 只對 https 有意義，本機 http 測試時拿掉。
function productionHeaders() {
  const lines = readFileSync(join(root, 'public/_headers'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '/*');
  const headers = {};
  for (let index = start + 1; index < lines.length && /^\s+\S/.test(lines[index]); index += 1) {
    const [name, ...rest] = lines[index].trim().split(':');
    if (name.toLowerCase() === 'strict-transport-security') continue;
    headers[name] = rest.join(':').trim().replace(/;\s*upgrade-insecure-requests/, '');
  }
  if (!headers['Content-Security-Policy']) throw new Error('public/_headers 裡找不到全站 CSP');
  return headers;
}
const security = productionHeaders();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = normalize(join(out, path === '/' ? 'atlas.html' : path));
  if (!file.startsWith(out + sep) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { ...security, 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, { ...security, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`打包後的頁面：${origin}/atlas.html（帶正式站 CSP：${security['Content-Security-Policy'].slice(0, 60)}…）`);
// 驗收腳本要用非同步的 spawn：spawnSync 會卡住這個行程的事件迴圈，上面的伺服器就回不了任何請求。
const status = await new Promise((done) => {
  const child = spawn(process.execPath, [join(root, 'tests/map/verify-atlas.mjs'), origin, screenshots], { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => done(code ?? 1));
  child.on('error', () => done(1));
});
server.close();
process.exit(status);
