// 只打包 atlas.html 的本線專用設定：整合前用來確認頁面打包後（雜湊檔名、公開資料複製）仍可運作。
// 不取代根目錄的 vite.config.js；第四線整合時只要在那邊的 input 加上 atlas。
// 打包：node node_modules/vite/bin/vite.js build --config tests/map/vite.atlas.config.mjs
// 開發：node node_modules/vite/bin/vite.js --config tests/map/vite.atlas.config.mjs --port 5183 --strictPort --host 127.0.0.1
//       （開發伺服器不監看建置產物；否則 Windows 上 npm run build 最後把暫存資料夾改名成 dist 時會 EPERM）
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root,
  publicDir: 'public',
  server: { watch: { ignored: ['**/.build-*/**', '**/dist/**', '**/artifacts/**', '**/.cache/**'] } },
  build: {
    outDir: resolve(root, 'artifacts/atlas-build'),
    emptyOutDir: true,
    rollupOptions: { input: { atlas: resolve(root, 'atlas.html') } },
  },
});
