/** 關鍵字字雲／chips（讀 public/data/keywords.json；相容 chips 陣列或 raw persons 物件）。 */
import { escapeHtml } from './data.js'

const ORDER = ['wu', 'xu', 'zheng']
const META = {
  wu: { race: '竹北市長', party_short: '國民黨' },
  xu: { race: '新竹縣長', party_short: '國民黨' },
  zheng: { race: '新竹縣長', party_short: '民進黨' },
}
const GROUP_WEIGHT = { names: 3, titles: 3, campaign: 2, places: 2, policies: 2, events: 2, query_extra: 1, shared_places: 1, shared_topics: 1 }

function chipsFromRaw(doc) {
  const personsObj = doc.persons || {}
  const shared = []
  for (const t of doc.shared_places || []) shared.push({ term: t, weight: 1, group: 'shared_places' })
  for (const t of doc.shared_topics || []) shared.push({ term: t, weight: 1, group: 'shared_topics' })
  const out = []
  for (const id of ORDER) {
    const p = personsObj[id]
    if (!p) continue
    const chips = []
    const seen = new Set()
    for (const g of ['titles', 'campaign', 'places', 'policies', 'events', 'query_extra']) {
      for (const term of p[g] || []) {
        const s = String(term || '').trim()
        if (!s || seen.has(s) || s === p.name) continue
        seen.add(s)
        chips.push({ term: s, weight: GROUP_WEIGHT[g] || 1, group: g })
      }
    }
    // 共用詞每人各附一份（中立對等）
    for (const c of shared) {
      if (seen.has(c.term)) continue
      seen.add(c.term)
      chips.push(c)
    }
    out.push({
      id,
      name: p.name || id,
      race: META[id]?.race || '',
      party_short: META[id]?.party_short || '',
      chips,
    })
  }
  return out
}

function normalizePayload(payload) {
  if (!payload) return null
  if (Array.isArray(payload.persons)) return payload
  if (payload.persons && typeof payload.persons === 'object') {
    return { version: payload.version || 1, persons: chipsFromRaw(payload) }
  }
  return null
}

export function keywordCloudHTML(payload, opts = {}) {
  const norm = normalizePayload(payload)
  if (!norm || !Array.isArray(norm.persons)) return ''
  const filterId = opts.personId || ''
  const persons = filterId ? norm.persons.filter(p => p.id === filterId) : norm.persons
  if (!persons.length) return ''
  const lim = opts.limit != null ? opts.limit : 14
  const blocks = persons.map(p => {
    const chips = (p.chips || []).slice(0, lim).map(c =>
      `<span class="kw" data-w="${escapeHtml(c.weight)}" data-g="${escapeHtml(c.group)}">${escapeHtml(c.term)}</span>`
    ).join('')
    return `<div class="kw-person" data-p="${escapeHtml(p.id)}">` +
      `<h3><span class="who-chip" data-p="${escapeHtml(p.id)}">${escapeHtml(p.name)}</span>` +
      `<span class="muted" style="font-weight:400;font-size:.78rem">${escapeHtml(p.race)} · ${escapeHtml(p.party_short)}</span></h3>` +
      `<div class="kw-cloud">${chips}</div></div>`
  }).join('')
  const openAttr = opts.open === false ? '' : ' open'
  return `<section class="panel kw-panel" aria-label="關鍵字"><details class="kw-details"${openAttr}><summary class="sumh">關鍵字</summary>` +
    `<p class="muted" style="margin:.2rem 0 .6rem;font-size:.82rem">全名才算姓名命中；職稱須同篇有全名或新竹縣／竹北。以下供瀏覽與比對，不做單獨歸屬。</p>` +
    `<div class="kw-by">${blocks}</div></details></section>`
}

export async function loadKeywords() {
  try {
    const r = await fetch('/data/keywords.json', { cache: 'no-store' })
    if (!r.ok) return null
    return normalizePayload(await r.json())
  } catch { return null }
}
