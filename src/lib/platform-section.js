/**
 * 011 — 「政績政見」三欄等權重版面。
 * 內容僅來自 published policies（若有）；否則占位（需來源＋日期），絕不發明政見。
 * 爭議項中性呈現（raised_by／responded／note）；未獨立查核數字標示；預設每人同 N 則＋展開。
 */
import { PERSON_ORDER_011, escapeHtml, isSafeHttpUrl, truncateExcerpt, parseTimeMs } from './latest-top.js'

export const POLICY_KINDS = Object.freeze({
  record: '施政紀錄',
  policy: '政策主張',
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
export const DEFAULT_SHOW_N = 2

const UNCORROB_RE = /未獨立查核|未獨立核對|未獨立查證/

/**
 * 正規化 policies 陣列。缺 source_name／安全連結／日期 → 不採用（不顯示假內容）。
 * 支援 controversy／raised_by／responded／date_precision／source_type／note／uncorroborated。
 */
export function normalizePolicies(rawList, people = PERSON_ORDER_011) {
  const out = []
  for (const raw of rawList || []) {
    if (!raw || typeof raw !== 'object') continue
    const person_id = String(raw.person_id || '').trim()
    if (!people.includes(person_id)) continue
    const href = String(raw.source_url || raw.url || '').trim()
    const source_name = String(raw.source_name || '').trim()
    const when = raw.published_at || raw.date || raw.announced_at
    if (!source_name || !isSafeHttpUrl(href) || parseTimeMs(when) == null) continue
    // 不上站 fixture
    const title = String(raw.title || '').trim()
    if (!title || title.includes('【fixture】')) continue
    const kindRaw = raw.kind || raw.type
    const kind = kindRaw === 'record' || kindRaw === '政績' ? 'record' : (kindRaw === 'policy' || kindRaw === '政見' ? 'policy' : null)
    if (!kind) continue
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
      claim_origin: raw.claim_origin || null,
      controversy: Boolean(raw.controversy),
      raised_by: String(raw.raised_by || '').trim(),
      responded: (raw.responded === true || raw.responded === false) ? raw.responded : (raw.responded == null || raw.responded === '' ? null : String(raw.responded).trim()),
      note,
      uncorroborated,
    })
  }
  return out
}

export function groupPoliciesByPerson(list, people = PERSON_ORDER_011) {
  const g = Object.fromEntries(people.map(id=>[id,[]]))
  for (const p of list) {
    if (g[p.person_id]) g[p.person_id].push(p)
  }
  return g
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
  const kindLabel = p.controversy ? '質疑紀錄' : (POLICY_KINDS[p.kind] || '政見')
  const href = p.source_url || p.url
  const excerpt = truncateExcerpt(p.summary)
  const dateStr = formatDateTW(p.published_at)
  const badges = []
  if (p.controversy) badges.push('<span class="plat-kind plat-kind-controversy">質疑紀錄</span>')
  else badges.push(`<span class="plat-kind">${escapeHtml(kindLabel)}</span>`)
  if (p.uncorroborated) badges.push('<span class="plat-flag" title="數字或成效為當事人／報導說法">未獨立查核</span>')
  badges.push(`<span class="plat-flag">${p.claim_origin==='self_claimed'?'人物／機關主張':p.claim_origin==='independently_reported'?'報導整理・非查核結論':'說法來源未標示'}</span>`)
  const controversyBits = []
  if (p.controversy && p.raised_by) {
    controversyBits.push(`<p class="plat-raised">提出：${escapeHtml(p.raised_by)}</p>`)
  }
  if (p.controversy) {
    if (p.responded === true) {
      const detail = p.note && /回應/.test(p.note) ? truncateExcerpt(p.note, 40) : '既有欄位記載有回應，內容請核對原文'
      controversyBits.push(`<p class="plat-responded">回應：${escapeHtml(detail)}</p>`)
    } else if (p.responded === false) {
      controversyBits.push(`<p class="plat-responded">回應：此條目未記載，不能推論當事人未回應</p>`)
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
  const meta = opts.person || PERSON_META[personId] || { id: personId, name: personId, role: '' }
  const total = entries.length
  const visible = entries.slice(0, showN)
  const hidden = entries.slice(showN)
  let body
  if (!total) {
    body = '<li class="plat-slot plat-slot-empty"><p>本站尚未收錄此人的政策主張或施政紀錄。資料不足不代表沒有相關內容。</p></li>'
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
  const heading = opts.heading || '政策主張與施政紀錄'
  const roster=opts.roster
  if(!Array.isArray(roster)||!roster.length)return '<p class="muted">完整候選人資料暫時無法載入，請前往<a href="/compare.html#candidateReview">候選人多面向閱讀</a>查閱正式名單。</p>'
  const people=roster.map(p=>p.id)
  const showN = Number.isFinite(opts.showN) ? opts.showN : DEFAULT_SHOW_N
  const list = normalizePolicies(policiesRaw,people)
  const grouped = groupPoliciesByPerson(list,people)
  const counts = people.map(id => `${roster.find(p=>p.id===id).name} ${ (grouped[id] || []).length }`)
  const cols = people.map(id => platformColumnHTML(id, grouped[id] || [], { showN,person:roster.find(p=>p.id===id) }))
  const dataNote = list.length
    ? `<p class="plat-note">既有來源共 ${list.length} 則；${counts.join('、')}。條數只反映收錄量。依選區與選委會號次列出 ${roster.length} 人，每人先列 ${showN} 則，可展開。摘要尚未在本輪逐筆複核；施政紀錄不等於已證實政績。<a href="/compare.html#candidateReview">用共同面向閱讀</a></p><p class="plat-note plat-coverage">依公開可抓來源整理，部分媒體因網站規則未收錄，可能有遺漏。</p>`
    : `<p class="plat-note">本站尚未收錄可顯示的政策來源，以下保留候選人資料缺口。</p><p class="plat-note plat-coverage">依公開可抓來源整理，部分媒體因網站規則未收錄，可能有遺漏。</p>`
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
export function equalWeightAudit(html, expectedCols = 6) {
  const cols = [...html.matchAll(/class="plat-col"/g)].length
  const placeholders = [...html.matchAll(/data-placeholder="1"/g)].length
  const hasEqualAttr = html.includes('data-equal-weight="1"')
  const styles = [...html.matchAll(/style="(--plat-border:[^"]+)"/g)].map(m => m[1])
  const allSameStyle = styles.length === expectedCols && styles.every(s => s === styles[0])
  return { cols, placeholders, hasEqualAttr, allSameStyle, ok: cols === expectedCols && hasEqualAttr && allSameStyle }
}
