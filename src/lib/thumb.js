/** 圖示與文章縮圖（無依賴，供 data.js／charts.js 共用）。圖片只熱連結原站，不下載、不存檔。 */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const safeHref = (u) => { try { const x = new URL(u); return (x.protocol === 'http:' || x.protocol === 'https:') ? u : null } catch { return null } }
const escapeHtml = esc

/* ---------- 圖示（24x24 線條） ---------- */
const ICONS = {
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2V5z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12h7M7 15h4"/>',
  commentary: '<path d="M4 5h16v11H9l-5 4V5z"/><path d="M8 9h8M8 12h5"/>',
  poll: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  council: '<path d="M3 10l9-6 9 6"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9M3 20h18"/>',
  ly: '<path d="M3 10l9-6 9 6"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9M3 20h18"/>',
  ptt: '<rect x="4" y="5" width="16" height="12" rx="2"/><path d="M8 21l4-4 4 4"/><path d="M8 10h8M8 13h5"/>',
  youtube: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
  facebook: '<path d="M14 8h2V5h-2c-2.2 0-4 1.8-4 4v2H8v3h2v7h3v-7h2.2l.8-3H13V9c0-.6.4-1 1-1z"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/><circle cx="17" cy="7" r="1" fill="currentColor" stroke="none"/>',
  threads: '<path d="M12 4c-3 0-5.5 2-5.5 5.2 0 4.2 3.2 6.3 5.5 7.3 2.3-1 5.5-3.1 5.5-7.3C17.5 6 15 4 12 4z"/><path d="M8.5 11.5c.4 2.2 2 3.5 3.5 3.5s3.1-1.3 3.5-3.5"/>',
  x: '<path d="M5 5l14 14M19 5L5 19"/>',
  website: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
  manual: '<path d="M5 19l1-4L16 5l3 3L9 18l-4 1z"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5 9-5z"/><path d="M3 14l9 5 9-5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  gov: '<path d="M3 10l9-6 9 6"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9M3 20h18"/>',
  party: '<path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.9 7.2 18l.9-5.4L4.2 8.7l5.4-.8z"/>',
}
export function icon(name, cls = '') {
  const p = ICONS[name] || ICONS.doc
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`
}
export function platIcon(platform) {
  const m = { google_news: 'news', cna: 'news' }
  const k = m[platform] || platform
  return icon(ICONS[k] ? k : 'doc')
}

const PERSON_SHORT = Object.freeze({ wu: '吳', xu: '徐', zheng: '鄭', chiu: '邱' })
const PLAT_LABEL = Object.freeze({
  news: '新聞', commentary: '評論', poll: '民調', ptt: 'PTT', youtube: '影音',
  facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads',
  x: '貼文', website: '官網', council: '議會', gov: '公所', party: '政黨',
  manual: '手動', ly: '立院',
})

/* ---------- 文章圖片（只熱連結原站，不下載、不存檔） ---------- */
const IMG_FIELDS = ['image_url', 'og_image', 'thumbnail_url', 'thumbnail', 'image']
export function itemImageUrl(it) {
  for (const f of IMG_FIELDS) {
    const u = it && it[f]
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) return safeHref(u)
  }
  return null
}

function cardMeta(it) {
  const pid = String((it && it.person_id) || '')
  const short = PERSON_SHORT[pid] || (it && it.person ? String(it.person).slice(0, 1) : '訊')
  const topics = (it && Array.isArray(it.topics)) ? it.topics : []
  const topic = String(topics[0] || '')
  const plat = String((it && it.platform) || '')
  const label = topic || PLAT_LABEL[plat] || '資訊'
  return { pid, short, topic, plat, label }
}

function visualInnerHTML(meta) {
  return `<span class="thumb-visual-inner">` +
    `<span class="thumb-initial" aria-hidden="true">${escapeHtml(meta.short)}</span>` +
    `<span class="thumb-topic">${escapeHtml(meta.label)}</span>` +
    `</span>`
}

/** 無原圖：候選人色塊＋姓＋議題／平台（對齊 visual.css；絕不用灰框） */
export function designedThumbHTML(it) {
  const m = cardMeta(it || {})
  return `<div class="thumb thumb-ph thumb-visual" data-p="${escapeHtml(m.pid)}" role="img" aria-label="${escapeHtml(m.short)}｜${escapeHtml(m.label)}">${visualInnerHTML(m)}</div>`
}

export function thumbHTML(it, href, sourceLabel) {
  const img = itemImageUrl(it)
  const m = cardMeta(it || {})
  if (!img) return designedThumbHTML(it || {})
  return `<figure class="thumb has-img" data-p="${escapeHtml(m.pid)}"><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img class="thumb-img" src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="140" height="105"><span class="thumb-ph thumb-visual" data-p="${escapeHtml(m.pid)}">${visualInnerHTML(m)}</span></a><figcaption><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">圖：${escapeHtml(sourceLabel || '原報導')}</a></figcaption></figure>`
}

/** img 載入失敗 → 設計卡（CSP 禁 inline handler，改用 capture 監聽） */
export function installImageFallback() {
  if (typeof document === 'undefined' || document.__imgFallback) return
  document.__imgFallback = true
  document.addEventListener('error', (e) => {
    const t = e.target
    if (!(t && t.tagName === 'IMG')) return
    const wrap = t.parentElement
    if (wrap && wrap.classList && wrap.classList.contains('avatar-photo')) {
      wrap.classList.add('img-failed'); return
    }
    if (!t.classList.contains('thumb-img')) return
    const box = t.closest('.thumb')
    if (!box) { t.remove(); return }
    const pid = box.getAttribute('data-p') || ''
    box.classList.remove('has-img')
    box.classList.add('thumb-ph', 'thumb-visual')
    box.querySelector('figcaption')?.remove()
    const a = box.querySelector('a')
    const keep = box.querySelector('.thumb-visual-inner')
    if (a) {
      if (keep) box.appendChild(keep)
      a.remove()
    }
    if (!box.querySelector('.thumb-visual-inner')) {
      box.insertAdjacentHTML('beforeend', visualInnerHTML(cardMeta({ person_id: pid })))
    }
    t.remove()
  }, true)
}

/** 關鍵字芯片 */
export function keywordChipsHTML(terms, { max = 12, cls = 'kw-chip' } = {}) {
  const rows = (terms || []).slice(0, max)
  if (!rows.length) return ''
  return `<div class="kw-chips">${rows.map((t) => {
    const term = typeof t === 'string' ? t : (t && t.term) || ''
    const count = typeof t === 'object' && t && t.count != null ? t.count : null
    if (!term) return ''
    const n = count != null ? ` ${escapeHtml(count)}` : ''
    return `<span class="${cls} kw" data-w="${count && count >= 8 ? 3 : count && count >= 3 ? 2 : 1}">${escapeHtml(term)}${n}</span>`
  }).join('')}</div>`
}

/** 由條目 topics 聚合關鍵字雲 */
export function aggregateKeywords(items, { personId = null, max = 24 } = {}) {
  const NAMES = new Set(['吳旭智', '徐欣瑩', '鄭朝方'])
  const bag = new Map()
  for (const it of items || []) {
    if (personId && it.person_id !== personId) continue
    for (const t of it.topics || []) {
      const s = String(t || '').trim()
      if (!s || NAMES.has(s)) continue
      bag.set(s, (bag.get(s) || 0) + 1)
    }
  }
  return [...bag.entries()].map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, 'zh-Hant'))
    .slice(0, max)
}

export function keywordCloudHTML(items, opts = {}) {
  const rows = aggregateKeywords(items, opts)
  if (!rows.length) return '<p class="muted fine">尚無關鍵字統計</p>'
  const max = rows[0].count || 1
  return `<div class="kw-cloud" aria-label="關鍵字">${rows.map(({ term, count }) => {
    const w = count >= Math.max(3, max * 0.5) ? 3 : count >= 2 ? 2 : 1
    return `<span class="kw" data-w="${w}" title="${escapeHtml(count)} 則">${escapeHtml(term)} <b>${escapeHtml(count)}</b></span>`
  }).join('')}</div>`
}

export function keywordCloudByPersonHTML(items) {
  const order = [
    { id: 'wu', name: '吳旭智' },
    { id: 'xu', name: '徐欣瑩' },
    { id: 'zheng', name: '鄭朝方' },
  ]
  return `<div class="kw-by">${order.map((p) => {
    const cloud = keywordCloudHTML(items, { personId: p.id, max: 14 })
    return `<div class="kw-person" data-p="${p.id}" style="--pc:var(--pc)"><h4><span class="who-chip" data-p="${p.id}">${escapeHtml(p.name)}</span> 關鍵字</h4>${cloud}</div>`
  }).join('')}</div>`
}
