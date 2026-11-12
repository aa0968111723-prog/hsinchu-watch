/**
 * 011 — 「政績政見」三欄等權重版面。
 * 內容僅來自 published policies（若有）；否則占位（需來源＋日期），絕不發明政見。
 * 爭議項中性呈現（raised_by／responded／note）；未獨立查核數字標示；預設每人同 N 則＋展開。
 */
import { PERSON_ORDER_011, escapeHtml, isSafeHttpUrl, truncateExcerpt, parseTimeMs } from './latest-top.js'

export const POLICY_KINDS = Object.freeze({
  record: '政績',
  policy: '政見',
})

/** 中性欄位色（三人相同，不暗示偏好） */
export const PLATFORM_NEUTRAL = Object.freeze({
  border: '#CBD5E1',
  soft: '#F8FAFC',
  text: '#1E293B',
  muted: '#475569',
  accent: '#334155',
})

export const PERSON_META = Object.freeze({
  wu: { id: 'wu', name: '吳旭智', role: '竹北市長候選人' },
  xu: { id: 'xu', name: '徐欣瑩', role: '新竹縣長候選人' },
  zheng: { id: 'zheng', name: '鄭朝方', role: '新竹縣長候選人' },
})

/** 每欄預設顯示則數（三人相同，避免一欄視覺主導） */
export const DEFAULT_SHOW_N = 5

const UNCORROB_RE = /未獨立查核|未獨立核對|未獨立查證/

/**
 * 正規化 policies 陣列。缺 source_name／安全連結／日期 → 不採用（不顯示假內容）。
 * 支援 controversy／raised_by／responded／date_precision／source_type／note／uncorroborated。
 */
export function normalizePolicies(rawList) {
  const out = []
  for (const raw of rawList || []) {
    if (!raw || typeof raw !== 'object') continue
    const person_id = String(raw.person_id || '').trim()
    if (!PERSON_ORDER_011.includes(person_id)) continue
    const href = String(raw.source_url || raw.url || '').trim()
    const source_name = String(raw.source_name || '').trim()
    const when = raw.published_at || raw.date || raw.announced_at
    if (!source_name || !isSafeHttpUrl(href) || parseTimeMs(when) == null) continue
    // 不上站 fixture
    const title = String(raw.title || '').trim()
    if (!title || title.includes('【fixture】')) continue
    const kindRaw = raw.kind || raw.type
    const kind = kindRaw === 'record' || kindRaw === '政績' ? 'record' : 'policy'
    const note = String(raw.note || '').trim()
    const uncorroborated = Boolean(raw.uncorroborated) || UNCORROB_RE.test(note) || UNCORROB_RE.test(String(raw.summary || ''))
    out.push({
      id: raw.id || `${person_id}-${out.length}`,
      person_id,
      kind,
      title,
      summary: String(raw.summary || raw.excerpt || '').trim(),
      source_name,
      source_url: href,
      url: String(raw.url || href).trim(),
      published_at: when,
      date_precision: raw.date_precision || null,
      source_type: raw.source_type || null,
      controversy: Boolean(raw.controversy),
      raised_by: String(raw.raised_by || '').trim(),
      responded: (raw.responded === true || raw.responded === false) ? raw.responded : (raw.responded == null || raw.responded === '' ? null : String(raw.responded).trim()),
      note,
      uncorroborated,
    })
  }
  return out
}

export function groupPoliciesByPerson(list) {
  const g = { wu: [], xu: [], zheng: [] }
  for (const p of list) {
    if (g[p.person_id]) g[p.person_id].push(p)
  }
  return g
}

function placeholderSlots(personId, n = 2) {
  const slots = []
  for (let i = 0; i < n; i++) {
    slots.push(`<li class="plat-slot plat-slot-empty" data-person="${escapeHtml(personId)}" data-placeholder="1">
  <span class="plat-kind">待補</span>
  <p class="plat-slot-title">占位：請提供有<strong>來源＋日期</strong>的政績／政見條目</p>
  <p class="plat-slot-meta">欄位：<code>policies.json</code> → person_id / kind / title / source_name / source_url / published_at</p>
</li>`)
  }
  return slots.join('')
}

function formatDateTW(when) {
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(parseTimeMs(when)))
  } catch {
    return String(when)
  }
}

function entryHTML(p) {
  const kindLabel = p.controversy ? '爭議' : (POLICY_KINDS[p.kind] || '政見')
  const href = p.source_url || p.url
  const excerpt = truncateExcerpt(p.summary)
  const dateStr = formatDateTW(p.published_at)
  const badges = []
  if (p.controversy) badges.push('<span class="plat-kind plat-kind-controversy">爭議</span>')
  else badges.push(`<span class="plat-kind">${escapeHtml(kindLabel)}</span>`)
  if (p.uncorroborated) badges.push('<span class="plat-flag" title="數字或成效為當事人／報導說法">未獨立查核</span>')
  const controversyBits = []
  if (p.controversy && p.raised_by) {
    controversyBits.push(`<p class="plat-raised">提出：${escapeHtml(p.raised_by)}</p>`)
  }
  if (p.controversy) {
    if (p.responded === true) {
      const detail = p.note && /回應/.test(p.note) ? truncateExcerpt(p.note, 40) : '有公開回應（見來源）'
      controversyBits.push(`<p class="plat-responded">回應：${escapeHtml(detail)}</p>`)
    } else if (p.responded === false) {
      controversyBits.push(`<p class="plat-responded">回應：報導未載／尚無公開回應</p>`)
    } else if (p.note && /回應/.test(p.note)) {
      controversyBits.push(`<p class="plat-responded">${escapeHtml(truncateExcerpt(p.note, 40))}</p>`)
    }
  }
  return `<li class="plat-slot${p.controversy ? ' plat-slot-controversy' : ''}" data-id="${escapeHtml(p.id)}">
  <div class="plat-badges">${badges.join(' ')}</div>
  <a class="plat-slot-title" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a>
  ${excerpt ? `<p class="plat-excerpt">${escapeHtml(excerpt)}</p>` : ''}
  ${controversyBits.join('')}
  <p class="plat-slot-meta"><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.source_name)}</a> · <time datetime="${escapeHtml(String(p.published_at))}">${escapeHtml(dateStr)}</time></p>
</li>`
}

export function platformColumnHTML(personId, entries, opts = {}) {
  const showN = Number.isFinite(opts.showN) ? opts.showN : DEFAULT_SHOW_N
  const meta = PERSON_META[personId] || { id: personId, name: personId, role: '' }
  const total = entries.length
  const visible = entries.slice(0, showN)
  const hidden = entries.slice(showN)
  let body
  if (!total) {
    body = placeholderSlots(personId, 2)
  } else {
    body = visible.map(entryHTML).join('')
    if (hidden.length) {
      body += `<li class="plat-more-wrap" data-person="${escapeHtml(personId)}">
  <ul class="plat-list plat-list-more hidden" hidden>${hidden.map(entryHTML).join('')}</ul>
  <button type="button" class="plat-more-btn" data-plat-more="${escapeHtml(personId)}" aria-expanded="false">顯示更多（另 ${hidden.length} 則，共 ${total}）</button>
</li>`
    }
  }
  const countLabel = total ? `${total} 則` : '待補'
  return `<article class="plat-col" data-person="${escapeHtml(personId)}" data-count="${total}" style="--plat-border:${PLATFORM_NEUTRAL.border};--plat-soft:${PLATFORM_NEUTRAL.soft};--plat-text:${PLATFORM_NEUTRAL.text};--plat-muted:${PLATFORM_NEUTRAL.muted};--plat-accent:${PLATFORM_NEUTRAL.accent}">
  <header class="plat-col-head">
    <h3 class="plat-name">${escapeHtml(meta.name)} <span class="plat-count">${escapeHtml(countLabel)}</span></h3>
    <p class="plat-role">${escapeHtml(meta.role)}</p>
  </header>
  <ul class="plat-list">${body}</ul>
</article>`
}

/**
 * @param {object[]} [policiesRaw] published policies.json；缺省／空 → 三人占位
 * @param {object} [opts]
 */
export function renderPlatformSectionHTML(policiesRaw, opts = {}) {
  const heading = opts.heading || '政績政見'
  const showN = Number.isFinite(opts.showN) ? opts.showN : DEFAULT_SHOW_N
  const list = normalizePolicies(policiesRaw)
  const grouped = groupPoliciesByPerson(list)
  const counts = PERSON_ORDER_011.map(id => `${PERSON_META[id].name} ${ (grouped[id] || []).length }`)
  const cols = PERSON_ORDER_011.map(id => platformColumnHTML(id, grouped[id] || [], { showN }))
  const dataNote = list.length
    ? `<p class="plat-note">資料來自 <code>policies.json</code>（${list.length} 則；${counts.join('、')}）。每人預設顯示 ${showN} 則，可展開。爭議項中性標示提出者與回應；標「未獨立查核」者為自報／報導說法。</p><p class="plat-note plat-coverage">依公開可抓來源整理，部分媒體因網站規則未收錄，可能有遺漏。</p>`
    : `<p class="plat-note">目前尚無已核可的政績／政見資料檔。以下為<strong>等權重占位</strong>；協調者請提供 <code>/data/policies.json</code>（每則必含來源名稱、http(s) 連結、日期）。本區<strong>不發明</strong>政見內容。</p><p class="plat-note plat-coverage">依公開可抓來源整理，部分媒體因網站規則未收錄，可能有遺漏。</p>`
  return `<section class="plat-block" aria-label="${escapeHtml(heading)}">
  <header class="plat-head"><h2>${escapeHtml(heading)}</h2>${dataNote}</header>
  <div class="plat-grid" data-equal-weight="1" data-show-n="${showN}">${cols.join('')}</div>
</section>`
}

/** 綁定「顯示更多」；可重複呼叫（innerHTML 重繪後再 bind） */
export function bindPlatformMore(root = document) {
  const scope = root.getElementById ? root : document
  const grid = (scope.getElementById && scope.getElementById('platformSection')) || scope
  grid.querySelectorAll?.('button[data-plat-more]').forEach(btn => {
    if (btn.dataset.bound === '1') return
    btn.dataset.bound = '1'
    btn.addEventListener('click', () => {
      const wrap = btn.closest('.plat-more-wrap')
      const more = wrap && wrap.querySelector('.plat-list-more')
      if (!more) return
      const open = more.hasAttribute('hidden')
      if (open) {
        more.removeAttribute('hidden')
        more.classList.remove('hidden')
        btn.setAttribute('aria-expanded', 'true')
        btn.textContent = '收合'
      } else {
        more.setAttribute('hidden', '')
        more.classList.add('hidden')
        btn.setAttribute('aria-expanded', 'false')
        const n = more.querySelectorAll('.plat-slot').length
        const col = btn.closest('.plat-col')
        const total = col ? col.getAttribute('data-count') : ''
        btn.textContent = `顯示更多（另 ${n} 則${total ? `，共 ${total}` : ''}）`
      }
    })
  })
}

/** 測試／稽核：三欄 DOM 結構等權（欄數、class、inline CSS 變數一致） */
export function equalWeightAudit(html) {
  const cols = [...html.matchAll(/class="plat-col"/g)].length
  const placeholders = [...html.matchAll(/data-placeholder="1"/g)].length
  const hasEqualAttr = html.includes('data-equal-weight="1"')
  const styles = [...html.matchAll(/style="(--plat-border:[^"]+)"/g)].map(m => m[1])
  const allSameStyle = styles.length === 3 && styles.every(s => s === styles[0])
  return { cols, placeholders, hasEqualAttr, allSameStyle, ok: cols === 3 && hasEqualAttr && allSameStyle }
}
