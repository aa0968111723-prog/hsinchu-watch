/**
 * hsinchu-watch 前端即時更新模組（原生 ESM，無框架依賴）。
 *
 * 輪詢流程（對齊 PERF_BUDGET）：
 *   可見 → 每 180s ±jitter：GET manifest.json
 *            ├─ 監視檔 hash 未變 → 不抓分片
 *            └─ hash 變了 → 只 GET 變更的 JSON（?v=<hash>，無 ?t=）
 *   隱藏 → 暫停；再可見 → 立刻 tick
 *   錯誤 → 指數退避（2m→4m→…≤30m）±20% jitter
 *
 * 延遲警示：以 manifest.generated_at 相對現在 ≥ 1 小時（PROMPT 定案）。
 * 新內容：顯示「有 N 則新內容」，按下才合併（不自動跳動）。
 */

import { itemKey, dedupeItems, findNewItems } from './id.js';
import {
  sanitizeItem,
  sanitizeItems,
  filterItemsWithSource,
  normalizeSource,
  isSafeHttpUrl,
  SOURCE_FIELDS,
} from './sanitize.js';
import {
  formatAge,
  formatClock,
  nextBackoffMs,
  withJitter,
  parseTimeMs,
  isNewBadgeActive,
} from './format.js';
import {
  fileHash,
  changedWatchFiles,
  withVersionQuery,
  hasForbiddenCacheBust,
} from './manifest.js';

export { itemKey, dedupeItems, findNewItems } from './id.js';
export {
  sanitizeItem,
  sanitizeItems,
  filterItemsWithSource,
  normalizeSource,
  isSafeHttpUrl,
  ACCOUNT_FIELDS,
  SOURCE_FIELDS,
} from './sanitize.js';
export {
  formatAge,
  formatClock,
  nextBackoffMs,
  withJitter,
  parseTimeMs,
  isNewBadgeActive,
} from './format.js';
export {
  fileHash,
  changedWatchFiles,
  withVersionQuery,
  hasForbiddenCacheBust,
} from './manifest.js';

const DEFAULTS = {
  urls: {
    /** 輕量清單；每次輪詢必抓（可不帶版本 query，靠 HTTP 快取／ETag） */
    manifest: './data/manifest.json',
    /** 邏輯檔名 → 實際 URL（目錄相對路徑） */
    files: {
      'items.json': './data/items.json',
      'stats.json': './data/stats.json',
    },
  },
  /**
   * 本頁要監視、hash 變才重抓的檔名。
   * 首頁建議只要 ['stats.json']；列表／人物頁可含 items。
   */
  watchFiles: ['items.json', 'stats.json'],
  /** 哪個 watch 檔當成「項目列表」來源（觸發 NEW／pending） */
  itemsFile: 'items.json',
  /** 哪個當 stats */
  statsFile: 'stats.json',
  intervalMs: 3 * 60 * 1000,
  /** PROMPT：超過 1 小時沒更新 → 延遲警示（以 manifest.generated_at） */
  delayWarnMs: 60 * 60 * 1000,
  newBadgeMs: 24 * 60 * 60 * 1000,
  offlineFailThreshold: 3,
  /** PERF：失敗從 2 分鐘起跳，上限 30 分鐘 */
  backoffBaseMs: 2 * 60 * 1000,
  backoffMaxMs: 30 * 60 * 1000,
  jitterRatio: 0.2,
  /** 分片 URL 是否附加 ?v=<hash>（內容變才變 URL；禁止 ?t=） */
  useHashQuery: true,
  elements: {
    banner: '#live-banner',
    status: '#statusBox',
    delayWarn: '#delayWarn',
    list: null,
  },
  renderItem: null,
  onMerge: null,
  onFetch: null,
  fetchImpl: null,
  now: null,
  timers: null,
  document: null,
  rand: null,
  fetchOnStart: true,
};

function resolveEl(doc, ref) {
  if (!ref) return null;
  if (typeof ref === 'string') return doc.querySelector(ref);
  return ref;
}

function asItemsArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

/**
 * @param {Partial<typeof DEFAULTS>} options
 */
export function createLiveUpdate(options = {}) {
  const cfg = {
    ...DEFAULTS,
    ...options,
    urls: {
      ...DEFAULTS.urls,
      ...(options.urls || {}),
      files: {
        ...DEFAULTS.urls.files,
        ...((options.urls && options.urls.files) || {}),
      },
    },
    elements: { ...DEFAULTS.elements, ...(options.elements || {}) },
    watchFiles: options.watchFiles || DEFAULTS.watchFiles,
  };

  const doc = cfg.document || (typeof document !== 'undefined' ? document : null);
  const fetchFn = cfg.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  const nowFn = cfg.now || (() => Date.now());
  const randFn = cfg.rand || Math.random;
  const timers = cfg.timers || {
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a),
  };

  /** @type {Map<string, object>} */
  let known = new Map();
  /** @type {object[]} */
  let pending = [];
  /** @type {object|null} */
  let lastStats = null;
  /** @type {object|null} */
  let lastManifest = null;
  /** 客戶端上次成功完成一次 tick（含「hash 未變」）的時間 */
  let lastPollOkAt = null;
  /** 資料新鮮度：manifest.generated_at */
  let dataGeneratedAt = null;
  let failCount = 0;
  let timerId = null;
  let running = false;
  let inFlight = false;
  let pausedByHidden = false;
  /** 是否已做過初次載入（用於不跳 banner） */
  let initialLoaded = false;

  const els = {
    banner: null,
    status: null,
    delayWarn: null,
    list: null,
  };

  function bindElements() {
    if (!doc) return;
    els.banner = resolveEl(doc, cfg.elements.banner);
    els.status = resolveEl(doc, cfg.elements.status);
    els.delayWarn = resolveEl(doc, cfg.elements.delayWarn);
    els.list = resolveEl(doc, cfg.elements.list);
  }

  function clearTimer() {
    if (timerId != null) {
      timers.clearTimeout(timerId);
      timerId = null;
    }
  }

  function schedule(ms) {
    clearTimer();
    if (!running || pausedByHidden) return;
    timerId = timers.setTimeout(() => {
      timerId = null;
      tick();
    }, ms);
  }

  function scheduleNormal() {
    schedule(withJitter(cfg.intervalMs, cfg.jitterRatio, randFn));
  }

  function scheduleBackoff() {
    const wait = nextBackoffMs(
      Math.max(0, failCount - 1),
      cfg.backoffBaseMs,
      cfg.backoffMaxMs,
      cfg.jitterRatio,
      randFn,
    );
    schedule(wait);
    return wait;
  }

  function freshnessMs() {
    // 優先 manifest.generated_at；否則用上次成功輪詢時間
    return dataGeneratedAt != null ? dataGeneratedAt : lastPollOkAt;
  }

  function updateStatusUI() {
    const t = nowFn();
    const fresh = freshnessMs();
    if (els.status) {
      const age = formatAge(fresh, t);
      const clock = fresh != null ? formatClock(new Date(fresh)) : '';
      els.status.textContent = clock ? `${age}（${clock} 台北）` : age;
    }
    const delayed = fresh != null && t - fresh >= cfg.delayWarnMs;
    const offline = failCount >= cfg.offlineFailThreshold;
    if (els.delayWarn) {
      if (offline) {
        els.delayWarn.textContent = '資料來源離線或連續更新失敗，請稍後再試';
        els.delayWarn.classList.remove('hidden');
        els.delayWarn.dataset.state = 'offline';
      } else if (delayed) {
        els.delayWarn.textContent = '資料更新延遲（超過 1 小時未更新）';
        els.delayWarn.classList.remove('hidden');
        els.delayWarn.dataset.state = 'delayed';
      } else {
        els.delayWarn.classList.add('hidden');
        els.delayWarn.dataset.state = 'ok';
      }
    }
  }

  function updateBannerUI() {
    if (!els.banner) return;
    const n = pending.length;
    if (n <= 0) {
      els.banner.classList.add('hidden');
      els.banner.innerHTML = '';
      return;
    }
    els.banner.classList.remove('hidden');
    els.banner.setAttribute('role', 'status');
    els.banner.setAttribute('aria-live', 'polite');
    els.banner.innerHTML = '';
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'live-banner-btn';
    btn.textContent = `有 ${n} 則新內容`;
    btn.setAttribute('aria-label', `有 ${n} 則新內容，按下後加入列表並捲到頂部`);
    btn.addEventListener('click', () => mergePending());
    els.banner.appendChild(btn);
  }

  function defaultRenderItem(item) {
    if (!doc) return null;
    const li = doc.createElement('article');
    li.className = 'live-item';
    li.dataset.key = itemKey(item);
    if (isNewBadgeActive(item, nowFn(), cfg.newBadgeMs)) {
      li.classList.add('is-new');
      const badge = doc.createElement('span');
      badge.className = 'badge-new';
      badge.textContent = 'NEW';
      li.appendChild(badge);
    }
    const a = doc.createElement('a');
    a.href = item.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.title || '(無標題)';
    li.appendChild(a);
    const meta = doc.createElement('div');
    meta.className = 'live-item-meta';
    const bits = [item.person, item.platform, item.source_name, item.published_at]
      .filter(Boolean);
    meta.textContent = bits.join(' · ');
    li.appendChild(meta);
    return li;
  }

  function prependToList(items) {
    if (!els.list || !items.length) return;
    const render = cfg.renderItem || defaultRenderItem;
    const frag = doc.createDocumentFragment();
    for (let i = items.length - 1; i >= 0; i--) {
      const node = render(sanitizeItem(items[i]));
      if (node) frag.appendChild(node);
    }
    els.list.insertBefore(frag, els.list.firstChild);
  }

  function mergePending() {
    if (!pending.length) return [];
    const toMerge = pending.slice();
    pending = [];
    updateBannerUI();
    for (const it of toMerge) {
      const k = itemKey(it);
      if (!known.has(k)) known.set(k, it);
    }
    prependToList(toMerge);
    if (typeof cfg.onMerge === 'function') {
      cfg.onMerge(toMerge, Array.from(known.values()), lastStats);
    }
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (doc && doc.documentElement) {
      doc.documentElement.scrollTop = 0;
      if (doc.body) doc.body.scrollTop = 0;
    }
    return toMerge;
  }

  function markViewed(keyOrItem) {
    const k = typeof keyOrItem === 'string' ? keyOrItem : itemKey(keyOrItem);
    const it = known.get(k);
    if (it) it._viewed = true;
    if (els.list) {
      const node = els.list.querySelector(`[data-key="${CSS.escape ? CSS.escape(k) : k}"]`);
      if (node) {
        node.classList.remove('is-new');
        const b = node.querySelector('.badge-new');
        if (b) b.classList.add('fade-out');
      }
    }
  }

  /**
   * 抓 JSON。禁止 ?t=／?= 時間戳；可選 ?v=<hash>。
   * @returns {{ data: any, url: string }}
   */
  async function fetchJson(url, hash) {
    const finalUrl = cfg.useHashQuery ? withVersionQuery(url, hash) : url;
    if (hasForbiddenCacheBust(finalUrl)) {
      throw new Error(`forbidden cache-bust in URL: ${finalUrl}`);
    }
    const res = await fetchFn(finalUrl, {
      // 讓瀏覽器／CDN 可用 ETag；不要 no-store 強迫重下
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${finalUrl}`);
      err.status = res.status;
      err.url = finalUrl;
      throw err;
    }
    const data = await res.json();
    return { data, url: finalUrl };
  }

  function applyItems(raw, { isInitial }) {
    const arr = asItemsArray(raw);
    const clean = sanitizeItems(arr).map((it) => ({
      ...it,
      _arrivedAt: it._arrivedAt || nowFn(),
    }));
    const { unique } = dedupeItems(clean);
    const news = findNewItems(unique, known);
    if (isInitial) {
      for (const it of unique) known.set(itemKey(it), it);
      pending = [];
      if (els.list && !els.list.childElementCount) {
        prependToList(unique.slice().reverse());
      }
      return { unique, news: [] };
    }
    if (news.length) {
      const pendKeys = new Set(pending.map(itemKey));
      for (const it of news) {
        const k = itemKey(it);
        if (!pendKeys.has(k)) {
          it._isNew = true;
          pending.push(it);
          pendKeys.add(k);
        }
      }
    }
    return { unique, news };
  }

  async function tick() {
    if (!running || inFlight || pausedByHidden) return;
    inFlight = true;
    const fetchedUrls = [];
    try {
      // 1) 先抓 manifest（不加時間戳）
      const manUrl = cfg.urls.manifest;
      if (hasForbiddenCacheBust(manUrl)) {
        throw new Error(`forbidden cache-bust in manifest URL: ${manUrl}`);
      }
      const manRes = await fetchFn(manUrl, {
        headers: { Accept: 'application/json' },
      });
      fetchedUrls.push(manUrl);
      if (!manRes.ok) {
        const err = new Error(`HTTP ${manRes.status} for ${manUrl}`);
        err.status = manRes.status;
        throw err;
      }
      const manifest = await manRes.json();
      const genMs = parseTimeMs(manifest.generated_at);
      if (genMs != null) dataGeneratedAt = genMs;

      const changed = changedWatchFiles(lastManifest, manifest, cfg.watchFiles);
      const isInitial = !initialLoaded;
      let itemsResult = null;
      let statsRaw = lastStats;
      const extraFiles = {};
      let itemsError = null;

      // 2) 只抓 hash 變更（或初次）的分片；items 分片失敗不拖垮整輪（供人物頁 fallback）
      for (const name of changed) {
        const path = cfg.urls.files[name];
        if (!path) continue;
        const hash = fileHash(manifest.files && manifest.files[name]);
        try {
          const { data, url } = await fetchJson(path, hash);
          fetchedUrls.push(url);
          if (name === cfg.itemsFile) {
            itemsResult = applyItems(data, { isInitial });
          } else if (name === cfg.statsFile) {
            statsRaw = data;
            lastStats = data;
          } else {
            extraFiles[name] = data;
          }
        } catch (fileErr) {
          fetchedUrls.push(String(path));
          if (name === cfg.itemsFile) {
            itemsError = fileErr;
          } else if (name === cfg.statsFile) {
            throw fileErr;
          } else {
            extraFiles[name] = {
              __error: true,
              message: String(fileErr && fileErr.message || fileErr),
              status: fileErr && fileErr.status,
            };
          }
        }
      }

      // 初次若 items 不在 watch／未變更清單（理論上初次全抓），補一次空結果
      if (isInitial && !itemsResult && cfg.watchFiles.includes(cfg.itemsFile)) {
        // changed 應已含 items；若 manifest 缺 files 條目，changedWatchFiles 仍會列入
      }

      lastManifest = manifest;
      lastPollOkAt = nowFn();
      failCount = 0;
      initialLoaded = true;
      updateBannerUI();
      updateStatusUI();
      if (typeof cfg.onFetch === 'function') {
        cfg.onFetch({
          manifest,
          changed,
          fetchedUrls: fetchedUrls.slice(),
          items: itemsResult ? itemsResult.unique : null,
          news: itemsResult ? itemsResult.news : [],
          stats: statsRaw,
          files: extraFiles,
          itemsError,
          pending: pending.slice(),
          skippedDataFetch: changed.length === 0 && !itemsError,
        });
      }
      scheduleNormal();
    } catch (err) {
      failCount += 1;
      updateStatusUI();
      const wait = scheduleBackoff();
      if (typeof cfg.onFetch === 'function') {
        cfg.onFetch({
          error: err,
          failCount,
          pending: pending.slice(),
          fetchedUrls: fetchedUrls.slice(),
          backoffMs: wait,
        });
      }
    } finally {
      inFlight = false;
    }
  }

  function onVisibility() {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return;
    if (d.hidden) {
      pausedByHidden = true;
      clearTimer();
    } else {
      pausedByHidden = false;
      if (running) tick();
    }
  }

  function start() {
    if (running) return Promise.resolve();
    running = true;
    bindElements();
    if (doc) doc.addEventListener('visibilitychange', onVisibility);
    updateStatusUI();
    if (cfg.fetchOnStart) return tick();
    scheduleNormal();
    return Promise.resolve();
  }

  function stop() {
    running = false;
    clearTimer();
    if (doc) doc.removeEventListener('visibilitychange', onVisibility);
  }

  function seed(items) {
    const clean = sanitizeItems(items || []);
    for (const it of clean) known.set(itemKey(it), it);
  }

  return {
    start,
    stop,
    mergePending,
    markViewed,
    seed,
    tick,
    getState: () => ({
      knownCount: known.size,
      pendingCount: pending.length,
      pending: pending.slice(),
      lastSuccessAt: lastPollOkAt,
      lastPollOkAt,
      dataGeneratedAt,
      failCount,
      lastStats,
      lastManifest,
      running,
      pausedByHidden,
      initialLoaded,
    }),
    _internals: { updateStatusUI, updateBannerUI, bindElements, cfg, freshnessMs },
  };
}

export default createLiveUpdate;
