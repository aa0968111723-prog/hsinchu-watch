/**
 * hsinchu-watch src/lib/data.js 替換草稿（PERF_r3 追加）
 * - 首頁：manifest + stats + latest.json（≤100）；絕不抓 items.json
 * - polls.json 僅民調頁；封閉期不請求
 * - 卡片顯示 source_name + 安全連結（url／source_url）
 * - 延遲 1h、手動合併、退避、隱藏暫停
 * - PERF r6：輪詢 3 分鐘；人物分片 404／失敗才 fallback items.json；評論頁維持 items.json
 *
 * APPLY：連同 ./live-update/ 一併複製到 src/lib/
 */
import {
  createLiveUpdate,
  withVersionQuery,
  hasForbiddenCacheBust,
  sanitizeItems,
  filterItemsWithSource,
  normalizeSource,
  isSafeHttpUrl,
  parseTimeMs,
  formatAge,
} from './live-update/live-update.js'
import { renderSourceStatusHTML } from './source-status.js'
import { shortCoverageTime } from './coverage.js'
import { thumbHTML, platIcon } from './thumb.js'

const SENT = { pos: '偏正', neg: '偏負', neu: '中立' }
const PLAT = {
  news: '新聞', ptt: 'PTT', ly: '立法院', website: '官網', council: '議會',
  poll: '民調', commentary: '評論', youtube: 'YouTube', x: 'X', manual: '手動',
  google_news: '新聞', cna: '中央社',
}

/**
 * 民調封閉期（選罷法第 53 條：投票日前十日起至投票截止）。
 * 主線尚無寫死投票日；此處可設定。預設依 Researchy 查核草案：
 * blackoutStart=2026-11-18、electionDate=2026-11-28（Asia/Taipei）。
 * 傳 null 關閉封閉期檢查。
 */
export const POLL_BLACKOUT_DEFAULTS = Object.freeze({
  // 精確時刻（Asia/Taipei）：2026-11-18 00:00 起至 2026-11-28 16:00 投票截止
  startMs: Date.parse('2026-11-18T00:00:00+08:00'),
  endMs: Date.parse('2026-11-28T16:00:00+08:00'),
})
/** 只有資料端標 verified=true（人工逐筆核對原文）的民調才顯示數字 */
export const POLL_NUMBERS_ENABLED = true

export function labels(){ return { SENT, PLAT } }

export async function loadJSON(path, opts = {}){
  const hash = opts && opts.hash
  const url = hash ? withVersionQuery(path, hash) : String(path)
  if (hasForbiddenCacheBust(url)) {
    throw new Error(`forbidden cache-bust query in ${url}`)
  }
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if(!r.ok) throw new Error(`${path} ${r.status}`)
  return r.json()
}

export function fmtTW(iso){
  if(!iso) return '時間未知'
  try{
    return new Date(iso).toLocaleString('zh-TW',{ timeZone:'Asia/Taipei', hour12:false })
  }catch{ return iso }
}

export function isNew(iso){
  if(!iso) return false
  try{ return (Date.now() - new Date(iso).getTime()) < 86400000 }catch{ return false }
}

export function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}

/** 只允許 http/https；否則回 null */
export function safeHref(u){
  return isSafeHttpUrl(u) ? u : null
}

/** 主線相容：不安全 URL 回 '#'（寫入 href 時仍須 escapeHtml） */
export function safeUrl(u){
  return safeHref(u) || '#'
}

/**
 * 封閉期判定。cfg 可覆寫 POLL_BLACKOUT_DEFAULTS；
 * cfg.disabled===true 或 blackoutStart==null → 永不封閉。
 */
export function isPollBlackout(now = new Date(), cfg = {}){
  const c = { ...POLL_BLACKOUT_DEFAULTS, ...(cfg || {}) }
  if (c.disabled) return false
  const t = now instanceof Date ? now.getTime() : Number(new Date(now))
  return t >= c.startMs && t < c.endMs
}

export function renderBars(el, map, color=false){
  const entries = Object.entries(map||{}).sort((a,b)=>b[1]-a[1])
  if(!entries.length){ el.innerHTML='<p class="muted">尚無資料</p>'; return }
  const max = Math.max(1, ...entries.map(x=>x[1]))
  el.innerHTML = entries.map(([k,v])=>{
    const label = SENT[k] || PLAT[k] || k
    const pct = Math.round(v/max*100)
    const cls = color ? k : ''
    return `<div class="bar-row"><span>${label}</span><div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div><span>${v}</span></div>`
  }).join('')
}

/** 來源列：名稱＋連結（示範用；rel=noopener；僅 http/https） */
export function sourceHTML(it){
  const n = normalizeSource(it || {})
  const name = escapeHtml(n.source_name || '來源不明')
  const href = safeHref(n.source_url || n.url)
  if (!href) {
    return `<span class="source missing" data-missing-source="1">${name}（無有效連結）</span>`
  }
  return `<a class="source" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${name}</a>`
}

export function itemHTML(it, opts = {}){
  const { SENT: S, PLAT: P } = labels()
  const n = normalizeSource(it || {})
  const sent = n.sentiment || 'neu'
  const neu = isNew(n.published_at || n.collected_at) ? '<span class="badge new">NEW</span>' : ''
  const topicChips = (n.topics||[]).map(t=>`<span class="chip-topic">${escapeHtml(t)}</span>`).join('')
  const href = safeHref(n.url || n.source_url) || '#'
  const missing = n._missing_source ? ' data-missing-source="1"' : ''
  const title = n.title || '(無標題)'
  const summary = (n.summary || '').trim()
  // 摘要與標題相同／高度重疊 → 不重複顯示
  const strip = (s) => s.replace(/\s+/g, '').replace(/[\|｜\-—–·•]/g, '')
  const sumNorm = strip(summary)
  const titleNorm = strip(title)
  const overlap = sumNorm && titleNorm && (sumNorm === titleNorm || titleNorm.includes(sumNorm) || sumNorm.includes(titleNorm.slice(0, Math.min(28, titleNorm.length))))
  const showSummary = Boolean(summary && sumNorm && !overlap)
  const summaryBlock = showSummary ? `<div class="muted">${escapeHtml(summary)}</div>` : ''
  const pid = n.person_id || ''
  return `<li data-item-card="1" data-id="${escapeHtml(n.id)}" data-p="${escapeHtml(pid)}"${missing} class="item sent-${escapeHtml(sent)}">
    ${thumbHTML(n, href, n.source_name)}
    <div class="item-main">
    <div class="when">${opts && opts.showPerson && n.person ? `<span class="who-chip" data-p="${escapeHtml(pid)}">${escapeHtml(n.person)}</span> ` : ''}${platIcon(n.platform)} ${fmtTW(n.published_at)} · ${P[n.platform]||n.platform} · ${sourceHTML(n)} ${neu}</div>
    <div class="title"><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></div>
    ${summaryBlock}
    <div class="item-tags">
      <span class="chip-stance ${escapeHtml(sent)}">${S[sent]||sent}</span>
      ${n.is_own_speech?'<span class="chip-topic">本人／陣營</span>':'<span class="chip-topic">提及</span>'}
      ${topicChips}
    </div>
    </div>
  </li>`
}

function outletLine(stats){
  const od = stats && stats.outlet_distribution
  const raw = od && od.overall && od.overall.outlets
  if (!raw) return ''
  const ov = Array.isArray(raw) ? raw.map(o => [o.name, o]) : Object.entries(raw)
  const top = ov.slice(0, 8)
  const rest = ov.slice(8).reduce((a, [, v]) => a + (v.count || 0), 0)
  const parts = top.map(([k, v]) => `${escapeHtml(k)} ${escapeHtml(v.count)}（${escapeHtml(Math.round((v.share || 0) * 1000) / 10)}%）`)
  if (rest) parts.push(`其他 ${escapeHtml(rest)}`)
  return `<p>新聞來自哪些媒體（全站，同一網址算一次）：${parts.join('、')}。</p>`
}

export function footerHTML(stats){
  const rows = Array.isArray(stats && stats.source_status) ? stats.source_status : []
  const statusBlock = rows.length
    ? renderSourceStatusHTML(rows, escapeHtml)
    : '<p class="source-status-pending">來源狀態待確認。</p>'
  return `<nav class="footer-nav" aria-label="網站資訊">
    <a href="/index.html">新竹選情觀察</a>
    <a href="/compare.html#watch-sources">公開來源索引</a>
    <a href="/manual.html">提供公開來源</a>
  </nav>
  <details class="footer-method">
    <summary>收錄方法與資料狀態</summary>
    <p>${escapeHtml(stats.disclaimer||'')}</p>
    ${statusBlock}
    ${outletLine(stats)}
    <p>民調數值需核對機構、調查期間、樣本、數字及原文。其他民調資料只列報導標題與連結。</p>
    <p>快照內有 ${escapeHtml(stats.total_items ?? '—')} 個不同網址。同一則內容涉及多人時，各人物分別計入。${stats.pending_review_count ? `另有 ${escapeHtml(stats.pending_review_count)} 筆待審。` : ''}</p>
    <p>資料時間 ${escapeHtml(fmtTW(stats.generated_at))}（台北）。網路留言以公開原文為來源，頁面省略帳號。</p>
  </details>`
}

/** 依路徑推斷監看範圍（PERF_r3：首頁用 latest，永不 items.json） */
export function resolveLiveWatch(opts = {}){
  const path = opts.pathname
    ?? (typeof location !== 'undefined' ? (location.pathname || '') : '')
  const search = opts.search
    ?? (typeof location !== 'undefined' ? (location.search || '') : '')
  const params = new URLSearchParams(search)
  const personId = opts.personId || params.get('id') || null

  const files = {
    'stats.json': '/data/stats.json',
    'latest.json': '/data/latest.json',
    'items.json': '/data/items.json',
    'items_zheng.json': '/data/items_zheng.json',
    'items_xu.json': '/data/items_xu.json',
    'items_wu.json': '/data/items_wu.json',
    'items_chiu.json': '/data/items_chiu.json',
    'polls.json': '/data/polls.json',
  }

  if (opts.watchFiles) {
    return {
      watchFiles: opts.watchFiles,
      itemsFile: opts.itemsFile ?? (opts.watchFiles.find(f => f.startsWith('items') || f === 'latest.json') || null),
      files,
      personId,
      mode: opts.mode || 'custom',
      loadPolls: Boolean(opts.loadPolls),
      fallbackItemsFile: opts.fallbackItemsFile || null,
    }
  }

  if (String(path).includes('person')) {
    const id = personId || 'wu'
    const shard = `items_${id}.json`
    return {
      watchFiles: ['stats.json', shard],
      itemsFile: shard,
      files,
      personId: id,
      mode: 'person',
      loadPolls: false,
      // PERF r6：僅分片 404／請求失敗時才用；成功但 0 筆不觸發
      fallbackItemsFile: 'items.json',
    }
  }

  if (String(path).includes('commentary')) {
    return {
      watchFiles: ['stats.json', 'items.json'],
      itemsFile: 'items.json',
      files,
      personId,
      mode: 'commentary',
      loadPolls: false,
      fallbackItemsFile: null,
    }
  }

  if (String(path).includes('polls')) {
    return {
      watchFiles: ['stats.json', 'polls.json'],
      itemsFile: null,
      files,
      personId,
      mode: 'polls',
      loadPolls: true,
      fallbackItemsFile: null,
    }
  }

  // 首頁／議題／手動：stats + latest；絕不 items.json
  return {
    watchFiles: ['stats.json', 'latest.json'],
    itemsFile: 'latest.json',
    files,
    personId,
    mode: String(path).includes('topics') ? 'topics' : 'home',
    loadPolls: false,
    fallbackItemsFile: null,
  }
}

/**
 * 每 3 分鐘檢查 manifest；回傳 stop。
 * 相容：startLiveReload({ onData, knownIds })
 * 可選：pollBlackout, watchFiles, personId, pathname, …
 */
export function startLiveReload(options = {}){
  const {
    onData,
    knownIds,
    watchFiles,
    personId,
    pathname,
    search,
    itemsFile,
    fetchImpl,
    document: docOpt,
    now,
    timers,
    rand,
    pollBlackout,
  } = options

  const doc = docOpt || (typeof document !== 'undefined' ? document : null)
  const watch = resolveLiveWatch({
    watchFiles, personId, pathname, search, itemsFile,
    mode: watchFiles ? 'custom' : undefined,
    loadPolls: options.loadPolls,
  })
  const banner = doc ? doc.getElementById('live-banner') : null
  const status = doc ? doc.getElementById('statusBox') : null
  const delay = doc ? doc.getElementById('delayWarn') : null

  let ids = new Set(knownIds || [])
  let cachedItems = []
  let cachedStats = null
  let cachedPolls = null
  let pendingNew = []
  let ready = false
  let lastExcluded = []

  const nowFn = now || (() => Date.now())

  function paintStatus(generatedAtIso){
    if (!status) return
    const clock = shortCoverageTime(generatedAtIso)
    status.textContent = clock ? `資料 ${clock}（台北）` : formatAge(parseTimeMs(generatedAtIso))
    status.title = clock ? `資料時間 ${fmtTW(generatedAtIso)}（台北）` : ''
  }

  function paintDelay(generatedAtIso){
    if (!delay) return
    const t = parseTimeMs(generatedAtIso)
    const ageH = t != null ? (Date.now() - t) / 3600000 : 999
    delay.classList.toggle('hidden', ageH <= 1)
    if (ageH > 1) {
      delay.textContent = '資料更新延遲（超過 1 小時未更新）'
      delay.dataset.state = 'delayed'
    } else {
      delay.dataset.state = 'ok'
    }
  }

  function emit(extra = {}){
    if (typeof onData !== 'function') return
    const ret = onData({
      items: cachedItems.slice(),
      stats: cachedStats,
      newOnes: pendingNew.slice(),
      polls: cachedPolls,
      excluded: lastExcluded.slice(),
      pollBlackout: isPollBlackout(new Date(nowFn()), pollBlackout),
      ...extra,
    })
    if (ret && typeof ret.then === 'function') ret.catch(() => {})
  }

  function ingestItems(rawList, { replace }){
    const { kept, excluded } = filterItemsWithSource(rawList, { mark: false })
    lastExcluded = excluded
    if (replace) {
      cachedItems = kept
      ids = new Set(kept.map(i => i.id).filter(Boolean))
      for (const k of (knownIds || [])) ids.add(k)
    }
    return kept
  }

  function renderBanner(){
    if (!banner || !doc) return
    const n = pendingNew.length
    if (n <= 0) {
      banner.classList.add('hidden')
      banner.innerHTML = ''
      return
    }
    banner.classList.remove('hidden')
    banner.setAttribute('role', 'status')
    banner.setAttribute('aria-live', 'polite')
    banner.innerHTML = ''
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = 'live-banner-btn'
    btn.textContent = `有 ${n} 則新內容`
    btn.setAttribute('aria-label', `有 ${n} 則新內容，按下後合併到列表`)
    btn.addEventListener('click', () => {
      const fromMod = (typeof live.mergePending === 'function') ? live.mergePending() : []
      const mergedRaw = (fromMod && fromMod.length) ? fromMod : pendingNew.slice()
      const { kept } = filterItemsWithSource(mergedRaw)
      pendingNew = []
      const map = new Map(cachedItems.map(i => [i.id || JSON.stringify(i), i]))
      for (const it of kept) {
        const k = it.id || JSON.stringify(it)
        if (!map.has(k)) {
          map.set(k, it)
          cachedItems.unshift(it)
        }
        if (it.id) ids.add(it.id)
      }
      renderBanner()
      emit({ newOnes: kept, merged: true })
    })
    banner.appendChild(btn)
  }

  const baseFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)

  async function wrappedFetch(url, init){
    // PERF r6：人物分片 404 不再吞成空陣列，交由 itemsError → fallback items.json
    return baseFetch(url, init)
  }

  // 防呆：首頁 watchFiles 不得含 items.json
  const safeWatch = watch.watchFiles.filter((f) => {
    if (watch.mode === 'home' || watch.mode === 'topics' || watch.mode === 'polls' || watch.mode === 'stats-only') {
      return f !== 'items.json'
    }
    return true
  })

  const live = createLiveUpdate({
    document: doc,
    fetchImpl: wrappedFetch,
    now: nowFn,
    timers,
    rand: rand || (() => 0.5),
    jitterRatio: 0.2,
    intervalMs: 180000,
    delayWarnMs: 60 * 60 * 1000,
    backoffBaseMs: 180000,
    backoffMaxMs: 30 * 60 * 1000,
    useHashQuery: true,
    urls: {
      manifest: '/data/manifest.json',
      files: watch.files,
    },
    watchFiles: safeWatch,
    itemsFile: watch.itemsFile || 'latest.json',
    statsFile: 'stats.json',
    elements: { banner: null, status: null, delayWarn: null, list: null },
    fetchOnStart: true,
    onFetch(info){
      if (info.error) {
        if (status) status.textContent = '資料載入失敗：' + (info.error.message || info.error)
        return
      }
      const changed = info.changed || []
      const gen =
        (info.manifest && info.manifest.generated_at) ||
        (info.stats && info.stats.generated_at) ||
        (cachedStats && cachedStats.generated_at) ||
        null
      paintStatus(gen)
      paintDelay(gen)

      const statsChanged = changed.includes('stats.json') && info.stats
      const itemsKey = watch.itemsFile
      const itemsChanged = itemsKey && changed.includes(itemsKey) && Array.isArray(info.items)

      if (statsChanged) cachedStats = info.stats
      if (itemsChanged) ingestItems(info.items, { replace: !ready })

      if (ready && info.news && info.news.length) {
        const { kept } = filterItemsWithSource(info.news)
        const pendIds = new Set(pendingNew.map(i => i.id).filter(Boolean))
        for (const it of kept) {
          if (it.id && (ids.has(it.id) || pendIds.has(it.id))) continue
          if (it.id && cachedItems.some(x => x.id === it.id)) continue
          pendingNew.push(it)
          if (it.id) pendIds.add(it.id)
        }
        renderBanner()
      }

      function applyPollsFromInfo(){
        if (!watch.loadPolls) return false
        if (isPollBlackout(new Date(nowFn()), pollBlackout)) {
          cachedPolls = null
          return true
        }
        if (info.files && Object.prototype.hasOwnProperty.call(info.files, 'polls.json')) {
          const raw = info.files['polls.json']
          if (raw && raw.__error) return false
          cachedPolls = Array.isArray(raw) ? raw : []
          return true
        }
        return false
      }

      function runPersonFallback(reason){
        if (!(watch.mode === 'person' && watch.fallbackItemsFile)) return Promise.resolve(false)
        return loadJSON(watch.files[watch.fallbackItemsFile])
          .then((raw) => {
            const arr = Array.isArray(raw) ? raw : []
            ingestItems(arr.filter(i => i.person_id === watch.personId), { replace: true })
            emit({ newOnes: [], initial: !ready, fallback: true, fallbackReason: reason })
            return true
          })
          .catch(() => false)
      }

      if (!ready) {
        ready = true
        applyPollsFromInfo()
        if (watch.loadPolls && cachedPolls == null && !isPollBlackout(new Date(nowFn()), pollBlackout)) {
          loadJSON(watch.files['polls.json']).then((raw) => {
            cachedPolls = Array.isArray(raw) ? raw : []
            finishInitial()
          }).catch(() => {
            cachedPolls = cachedStats && cachedStats.polls ? cachedStats.polls : []
            finishInitial()
          })
        } else {
          finishInitial()
        }
        function finishInitial(){
          // PERF r6：僅分片請求／解析失敗（itemsError）才 fallback；成功 0 筆不抓整包
          if (info.itemsError) {
            runPersonFallback(String(info.itemsError.message || info.itemsError)).then((ok) => {
              if (!ok) emit({ newOnes: [], initial: true, itemsError: info.itemsError })
            })
            return
          }
          emit({ newOnes: [], initial: true })
        }
        return
      }

      if (info.skippedDataFetch && !info.itemsError) return

      if (info.itemsError) {
        runPersonFallback(String(info.itemsError.message || info.itemsError))
        return
      }

      const pollsUpdated = applyPollsFromInfo()
      if (statsChanged || pollsUpdated || itemsChanged) {
        emit({ newOnes: pendingNew.slice() })
      }
    },
  })

  live.start().catch((e) => {
    if (status) status.textContent = '資料載入失敗：' + e.message
  })

  return () => live.stop()
}

export {
  resolveLiveWatch as _resolveLiveWatch,
  createLiveUpdate,
  withVersionQuery,
  hasForbiddenCacheBust,
  filterItemsWithSource,
  normalizeSource,
  isSafeHttpUrl,
}
