import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const stamp = Date.now().toString();
const ui = join(root, '.build-ui');
const stage = join(root, '.build-release-' + stamp);
const dist = join(root, 'dist');
for (const path of [ui, stage, dist]) {
  if (!resolve(path).startsWith(root + sep) || resolve(path) === root) throw new Error('Build path outside repository');
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', ui]);
run(python, [join(root, 'tools/release/assemble-production.py'), join(root, 'public'), ui, stage]);
run(python, [join(root, 'tools/release/prepare_release.py'), stage]);
if (existsSync(dist)) {
  const backup = join(root, '.build-backups', 'dist-' + stamp);
  if (!resolve(backup).startsWith(root + sep)) throw new Error('Backup outside repository');
  mkdirSync(dirname(backup), { recursive: true });
  renameSync(dist, backup);
}
renameSync(stage, dist);
console.log('Complete site assembled in dist/');
