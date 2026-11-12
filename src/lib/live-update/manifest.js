/**
 * manifest.json 輔助：比對檔案 hash、組出版本 query（非時間戳）。
 *
 * 預期格式（對齊 PERF_BUDGET）：
 * {
 *   "generated_at": "2026-11-09T23:40:00+08:00",
 *   "timezone": "Asia/Taipei",
 *   "version": "<overall>",
 *   "files": {
 *     "stats.json": { "sha256": "...", "bytes": 0 },
 *     "items.json": { "sha256": "...", "bytes": 0, "items": 0 }
 *   }
 * }
 */

/** 取出檔案條目的內容雜湊（sha256 優先，其次 hash／etag／version）。 */
export function fileHash(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry.sha256 || entry.hash || entry.etag || entry.version || null;
}

/**
 * 比較上一版與新版 manifest，回傳需要重抓的邏輯檔名列表。
 * @param {object|null} prevManifest
 * @param {object} nextManifest
 * @param {string[]} watchFiles 例如 ['items.json','stats.json']
 */
export function changedWatchFiles(prevManifest, nextManifest, watchFiles) {
  const prevFiles = (prevManifest && prevManifest.files) || {};
  const nextFiles = (nextManifest && nextManifest.files) || {};
  const changed = [];
  for (const name of watchFiles || []) {
    const nextH = fileHash(nextFiles[name]);
    const prevH = fileHash(prevFiles[name]);
    // 第一次（無 prev）或 hash 不同 → 需要抓
    if (!prevManifest || nextH == null || prevH == null || nextH !== prevH) {
      changed.push(name);
    }
  }
  return changed;
}

/**
 * 用內容 hash 當快取鍵（?v=<12hex>），絕不用時間戳。
 * hash 為空則回傳原 URL（不加 query）。
 */
export function withVersionQuery(url, hash) {
  if (!url) return url;
  if (!hash) return url;
  const short = String(hash).replace(/[^a-fA-F0-9]/g, '').slice(0, 12) || String(hash).slice(0, 12);
  // 去掉既有 v= / t= / _= 再加 v=
  let base = String(url);
  base = base.replace(/([?&])(v|t|_)=[^&]*/g, '$1').replace(/[?&]$/, '').replace(/\?&/, '?');
  if (base.endsWith('?')) base = base.slice(0, -1);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}v=${encodeURIComponent(short)}`;
}

/** 確認 URL 不含時間戳破快取參數。 */
export function hasForbiddenCacheBust(url) {
  return /[?&](t|_)=/.test(String(url || ''));
}
