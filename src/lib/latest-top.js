/**
 * 011 — 「最新新聞置頂」：近 24h／今日大型卡片。
 * 資料：published latest.json（或同等 items 陣列）；不硬編碼條目；不發明圖片。
 */
export const PERSON_ORDER_011 = Object.freeze(['wu', 'xu', 'zheng'])
export const WINDOW_MS = 24 * 60 * 60 * 1000
export const EXCERPT_MAX = 30
export const DISPLAY_MAX = 12
export const IMG_FIELDS = Object.freeze(['image_url', 'og_image', 'thumbnail_url', 'thumbnail', 'image'])

const PERSON_SHORT = Object.freeze({ wu: '吳', xu: '徐', zheng: '鄭' })

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

export function isSafeHttpUrl(u) {
  try {
    const x = new URL(String(u || ''))
    return x.protocol === 'http:' || x.protocol === 'https:'
  } catch {
    return false
  }
}

export function parseTimeMs(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const t = Date.parse(String(value))
  return Number.isNaN(t) ? null : t
}

/** 優先 published_at → first_seen_at → collected_at */
export function itemTimestampMs(it) {
  if (!it) return null
  return (
    parseTimeMs(it.published_at) ??
    parseTimeMs(it.first_seen_at) ??
    parseTimeMs(it.collected_at)
  )
}

/**
 * 相對時間（Asia/Taipei 語意的「現在」用呼叫端 now；文案固定中文）。
 * 「X 分鐘前／X 小時前」；未滿 1 分「剛剛」；≥24h「X 天前」。
 */
export function formatRelativeTW(isoOrMs, now = Date.now()) {
  const t = typeof isoOrMs === 'number' ? isoOrMs : parseTimeMs(isoOrMs)
  if (t == null) return '時間未知'
  const sec = Math.max(0, Math.floor((Number(now) - t) / 1000))
  if (sec < 60) return '剛剛'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分鐘前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小時前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
}

/** 台北日曆日 YYYY-MM-DD */
export function taipeiDateKey(ms, timeZone = 'Asia/Taipei') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

export function truncateExcerpt(text, max = EXCERPT_MAX) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if ([...s].length <= max) return s
  return `${[...s].slice(0, max).join('')}…`
}

export function itemImageUrl(it) {
  for (const f of IMG_FIELDS) {
    const u = it && it[f]
    if (typeof u === 'string' && isSafeHttpUrl(u)) return u
  }
  return null
}

export function personOrderIndex(id) {
  const i = PERSON_ORDER_011.indexOf(id)
  return i < 0 ? 99 : i
}

/**
 * 近 24 小時：有時間戳且 now−t ∈ [0, 24h]。
 * 排序：時間新→舊；同分依 wu→xu→zheng。
 * 僅保留有 source_name + 安全 http(s) 連結者。
 */
export function filterLast24h(items, now = Date.now()) {
  const n = Number(now)
  const kept = []
  for (const raw of items || []) {
    const it = raw || {}
    const href = String(it.url || it.source_url || '').trim()
    const name = String(it.source_name || '').trim()
    if (!name || !isSafeHttpUrl(href)) continue
    const t = itemTimestampMs(it)
    if (t == null) continue
    const age = n - t
    if (age < 0 || age > WINDOW_MS) continue
    kept.push({ ...it, url: it.url || href, source_url: it.source_url || href, _ts: t })
  }
  kept.sort((a, b) => {
    if (b._ts !== a._ts) return b._ts - a._ts
    return personOrderIndex(a.person_id) - personOrderIndex(b.person_id)
  })
  return kept
}

function placeholderThumb(it) {
  const pid = it.person_id || ''
  const short = PERSON_SHORT[pid] || (it.person ? String(it.person)[0] : '?')
  const tag = String((it.topics && it.topics[0]) || it.source_name || '').trim().slice(0, 8)
  const portrait = ['wu', 'xu', 'zheng', 'chiu'].includes(pid) ? `/img/persons/${pid}.jpg` : ''
  const mark = portrait
    ? `<img class="lt-ph-portrait" src="${escapeHtml(portrait)}" alt="" width="56" height="56" loading="lazy" decoding="async">`
    : `<span class="lt-ph-mark">${escapeHtml(short || '?')}</span>`
  return `<div class="lt-thumb lt-thumb-ph" data-p="${escapeHtml(pid)}" aria-hidden="true">${mark}${portrait || tag ? `<span class="lt-ph-src">${portrait ? '人物肖像' : escapeHtml(tag)}</span>` : ''}</div>`
}

function thumbBlock(it) {
  const img = itemImageUrl(it)
  if (!img || new URL(img).pathname.startsWith('/img/persons/')) return placeholderThumb(it)
  return `<div class="lt-thumb lt-thumb-img"><img src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="160" height="120"></div>`
}

export function latestCardHTML(it, now = Date.now()) {
  const href = String(it.url || it.source_url || '')
  const t = it._ts ?? itemTimestampMs(it)
  const rel = formatRelativeTW(t, now)
  const todayKey = taipeiDateKey(now)
  const isToday = t != null && taipeiDateKey(t) === todayKey
  const excerpt = truncateExcerpt(it.anonymous_excerpt || it.summary || '')
  const who = it.person ? `<span class="lt-who">${escapeHtml(it.person)}</span>` : ''
  const todayBadge = isToday ? '<span class="lt-badge-today">今日</span>' : ''
  return `<a class="lt-card" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-item-id="${escapeHtml(it.id || '')}" data-person="${escapeHtml(it.person_id || '')}">
  ${thumbBlock(it)}
  <div class="lt-body">
    <div class="lt-meta">${escapeHtml(it.source_name || '來源不明')} · <time datetime="${escapeHtml(it.published_at || it.collected_at || '')}">${escapeHtml(rel)}</time> ${todayBadge}</div>
    <h3 class="lt-title">${escapeHtml(it.title || '(無標題)')}</h3>
    ${excerpt ? `<p class="lt-excerpt">${escapeHtml(excerpt)}</p>` : ''}
    <div class="lt-foot">${who}<span class="lt-open">開啟原文</span></div>
  </div>
</a>`
}

export function renderLatestTopHTML(items, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now()
  const list = filterLast24h(items, now)
  const max = Number.isFinite(opts.displayMax) ? opts.displayMax : DISPLAY_MAX
  const shown = list.slice(0, max)
  const heading = opts.heading || (opts.featured ? '最新消息' : '最新新聞置頂')
  if (opts.featured && shown.length) {
    const lead = list.find(it => ['news', 'google_news', 'cna'].includes(it.platform) && it.published_at) || shown[0]
    const remainder = list.filter(it => it !== lead).slice(0, Math.max(0, max - 1))
    return `<div class="lt-edition">
  <header class="lt-head"><h2>${escapeHtml(heading)}</h2><p class="lt-sub">近 24 小時收錄 ${list.length} 則</p></header>
  ${latestCardHTML(lead, now)}
  ${remainder.length ? `<details class="lt-more"${opts.expanded ? ' open' : ''}><summary>更多最新消息</summary>
    <div class="lt-grid">${remainder.map(it => latestCardHTML(it, now)).join('')}</div></details>` : ''}
</div>`
  }
  if (!list.length) {
    return `<section class="lt-block" aria-label="${escapeHtml(heading)}">
  <header class="lt-head"><h2>${escapeHtml(heading)}</h2><p class="lt-sub">近 24 小時（Asia/Taipei）</p></header>
  <p class="lt-empty" data-empty="1">近 24 小時尚無已核可來源的新聞。稍後自動更新。</p>
</section>`
  }
  const more = list.length > shown.length ? ` · 置頂顯示 ${shown.length}/${list.length}` : ''
  return `<section class="lt-block" aria-label="${escapeHtml(heading)}">
  <header class="lt-head"><h2>${escapeHtml(heading)}</h2><p class="lt-sub">近 24 小時 · ${list.length} 則（今日標籤依台北日曆）${more}</p></header>
  <div class="lt-grid">${shown.map(it => latestCardHTML(it, now)).join('')}</div>
</section>`
}
