/**
 * 視覺化元件（純 SVG／CSS，無外部函式庫、無 CDN）。
 * 中立原則：三人同尺寸、同座標軸、非政黨色（赭／梅／石墨）＋不同記號形狀與線型，色盲也能分辨。
 * 一律只從 stats / items / polls 既有 JSON 欄位繪製；不改資料語意。
 */
import { escapeHtml, safeHref, labels } from './data.js'
import { icon, platIcon, thumbHTML, itemImageUrl, installImageFallback, designedThumbHTML, keywordChipsHTML, keywordCloudHTML, keywordCloudByPersonHTML, aggregateKeywords } from './thumb.js'
export { icon, platIcon, thumbHTML, itemImageUrl, installImageFallback, designedThumbHTML, keywordChipsHTML, keywordCloudHTML, keywordCloudByPersonHTML, aggregateKeywords }

/** 首頁主卡只這三人。邱臣遠在人物清單、人物頁與比較頁。 */
export const HOME_CARD_ORDER = Object.freeze(['wu', 'xu', 'zheng'])
export const PERSON_ORDER = ['wu', 'xu', 'zheng', 'chiu']
export const PERSON_META = Object.freeze({
  wu: { id: 'wu', name: '吳旭智', role: '竹北市長候選人', party: '中國國民黨' },
  xu: { id: 'xu', name: '徐欣瑩', role: '新竹縣長候選人', party: '中國國民黨' },
  zheng: { id: 'zheng', name: '鄭朝方', role: '新竹縣長候選人', party: '民主進步黨' },
  chiu: { id: 'chiu', name: '邱臣遠', role: '竹北市長參選人', party: '台灣民眾黨' },
})
export const PERSON_STYLE = {
  wu:    { color: '#9A6212', soft: '#F3E6D0', marker: 'circle',   dash: '',     short: '吳' },
  xu:    { color: '#7E3F82', soft: '#EBDCEC', marker: 'square',   dash: '7 4',  short: '徐' },
  zheng: { color: '#374151', soft: '#DCE0E6', marker: 'triangle', dash: '2 4',  short: '鄭' },
  chiu:  { color: '#3D5A73', soft: '#D9E3EA', marker: 'diamond',  dash: '4 3',  short: '邱' },
}
export const SENT_COLOR = { pos: '#3B7D6B', neu: '#B9B0A3', neg: '#A8483A' }
export const SENT_LABEL = { pos: '偏正', neu: '中立', neg: '偏負' }
const PLAT_COLOR = ['#7A6A58', '#C2A878', '#8A7F98', '#6F8F8A', '#B07C6A', '#9AA27A', '#A5A5A5']

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const fmt = (v) => num(v).toLocaleString('zh-TW')

/* ---------- 頭像：官方肖像（GWOIA，自架）或首字色塊；三人同尺寸處理 ---------- */
const PERSON_PHOTO = Object.freeze({
  wu: '/img/persons/wu.jpg',
  xu: '/img/persons/xu.jpg',
  zheng: '/img/persons/zheng.jpg',
  chiu: '/img/persons/chiu.jpg',
})
const PERSON_PHOTO_CREDIT = Object.freeze({
  wu: '照片：內政部民政司（GWOIA）',
  xu: '照片：立法院（GWOIA）',
  zheng: '照片：內政部（GWOIA）',
  chiu: '照片：Wikimedia Commons／新竹市政府（GWOIA）',
})
export function photoCreditHTML(personId) {
  const c = PERSON_PHOTO_CREDIT[personId]
  return c ? `<p class="photo-credit muted fine">${escapeHtml(c)}</p>` : ''
}
export function avatarHTML(person, size = 'md') {
  const st = PERSON_STYLE[person.id] || { color: '#5C564F', soft: '#E8E2D9' }
  const ch = escapeHtml(String(person.name || '?').slice(0, 1))
  const src = PERSON_PHOTO[person.id]
  if (src) {
    return `<span class="avatar avatar-photo avatar-${size}" style="--pc:${st.color};--ps:${st.soft}" title="${escapeHtml(PERSON_PHOTO_CREDIT[person.id] || '')}"><img src="${escapeHtml(src)}" alt="" width="72" height="72" loading="lazy" decoding="async" /><span class="avatar-fallback" aria-hidden="true">${ch}</span></span>`
  }
  return `<span class="avatar avatar-${size}" style="--pc:${st.color};--ps:${st.soft}" aria-hidden="true">${ch}</span>`
}
export function personDot(id) {
  const st = PERSON_STYLE[id]
  return st ? `<span class="pdot" style="--pc:${st.color}" aria-hidden="true">${st.short}</span>` : ''
}

/* ---------- 日期工具（Asia/Taipei） ---------- */
export function taipeiDay(d) {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(d instanceof Date ? d : new Date(d))
  } catch { return '' }
}
export function dayRange(endDay, n) {
  const [y, m, d] = endDay.split('-').map(Number)
  const end = Date.UTC(y, m - 1, d)
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(new Date(end - i * 86400000).toISOString().slice(0, 10))
  return out
}

/* ---------- 標記形狀 ---------- */
function marker(kind, x, y, r, color, hollow = false) {
  const fill = hollow ? '#FFFCF7' : color
  const sw = hollow ? 2 : 1
  if (kind === 'square') return `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" fill="${fill}" stroke="${color}" stroke-width="${sw}"/>`
  if (kind === 'triangle') return `<path d="M${x.toFixed(1)} ${(y - r - 1).toFixed(1)}L${(x + r + 1).toFixed(1)} ${(y + r).toFixed(1)}L${(x - r - 1).toFixed(1)} ${(y + r).toFixed(1)}Z" fill="${fill}" stroke="${color}" stroke-width="${sw}"/>`
  if (kind === 'diamond') return `<path d="M${x.toFixed(1)} ${(y - r - 1).toFixed(1)}L${(x + r + 1).toFixed(1)} ${y.toFixed(1)}L${x.toFixed(1)} ${(y + r + 1).toFixed(1)}L${(x - r - 1).toFixed(1)} ${y.toFixed(1)}Z" fill="${fill}" stroke="${color}" stroke-width="${sw}"/>`
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r + 0.5}" fill="${fill}" stroke="${color}" stroke-width="${sw}"/>`
}

function niceMax(v) {
  if (v <= 4) return 4
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p
  return 10 * p
}

/* ---------- 折線圖（聲量時間線） ---------- */
const narrow = () => typeof window !== 'undefined' && window.innerWidth < 600
export function lineChartSVG({ days, series, w = narrow() ? 380 : 680, h = narrow() ? 250 : 260, ariaLabel = '聲量折線圖' }) {
  const L = 34, R = 12, T = 14, B = 26
  const iw = w - L - R, ih = h - T - B
  const maxV = niceMax(Math.max(1, ...series.flatMap(s => s.values)))
  const n = days.length
  const X = (i) => L + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const Y = (v) => T + ih - (v / maxV) * ih
  let g = ''
  for (let k = 0; k <= 4; k++) {
    const v = (maxV / 4) * k, y = Y(v)
    g += `<line class="grid" x1="${L}" x2="${w - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="ax" x="${L - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`
  }
  const ticks = Math.min(6, n)
  for (let k = 0; k < ticks; k++) {
    const i = ticks === 1 ? 0 : Math.round((k / (ticks - 1)) * (n - 1))
    g += `<text class="ax" x="${X(i).toFixed(1)}" y="${h - 6}" text-anchor="middle">${days[i].slice(5).replace('-', '/')}</text>`
  }
  let body = ''
  for (const s of series) {
    const st = PERSON_STYLE[s.id] || { color: '#5C564F', dash: '', marker: 'circle' }
    const pts = s.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
    body += `<polyline class="ln" fill="none" stroke="${st.color}" stroke-width="2.4" stroke-linejoin="round" stroke-dasharray="${st.dash}" points="${pts}"/>`
    if (n <= 62) {
      s.values.forEach((v, i) => {
        if (v > 0) body += `<g>${marker(st.marker, X(i), Y(v), 3, st.color)}<title>${escapeHtml(s.name)} ${days[i]}：${v} 則</title></g>`
      })
    }
  }
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(ariaLabel)}" preserveAspectRatio="xMidYMid meet">${g}${body}</svg>`
}

export function legendHTML(persons) {
  return `<ul class="legend">${persons.map(p => {
    const st = PERSON_STYLE[p.id] || { color: '#5C564F', dash: '', marker: 'circle' }
    return `<li><svg viewBox="0 0 34 12" width="34" height="12" aria-hidden="true"><line x1="1" x2="33" y1="6" y2="6" stroke="${st.color}" stroke-width="2.4" stroke-dasharray="${st.dash}"/>${marker(st.marker, 17, 6, 3, st.color)}</svg><span>${escapeHtml(p.name)}</span></li>`
  }).join('')}</ul>`
}

/* ---------- 迷你折線（人物卡） ---------- */
export function sparkSVG(values, maxV, color, w = 220, h = 46) {
  const n = values.length
  if (!n) return ''
  const m = Math.max(1, maxV)
  const X = (i) => 2 + (n <= 1 ? 0 : (i / (n - 1)) * (w - 4))
  const Y = (v) => h - 4 - (v / m) * (h - 10)
  const pts = values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)
  const area = `M${X(0).toFixed(1)},${h - 4} L${pts.join(' L')} L${X(n - 1).toFixed(1)},${h - 4}Z`
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="近 ${n} 日聲量走勢"><path d="${area}" fill="${color}" opacity=".14"/><polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${pts.join(' ')}"/></svg>`
}

/* ---------- 100% 堆疊條（語氣／平台） ---------- */
export function stackHTML(parts, { total } = {}) {
  const sum = total != null ? total : parts.reduce((a, p) => a + num(p.value), 0)
  if (!sum) return '<div class="stack empty" role="img" aria-label="尚無資料"><span class="muted">尚無資料</span></div>'
  const segs = parts.filter(p => num(p.value) > 0).map(p => {
    const pct = (num(p.value) / sum) * 100
    return `<span class="seg" style="width:${pct.toFixed(2)}%;background:${p.color}" title="${escapeHtml(p.label)} ${p.value}（${pct.toFixed(1)}%）">${pct >= 9 ? `<b>${Math.round(pct)}%</b>` : ''}</span>`
  }).join('')
  const aria = parts.filter(p => num(p.value) > 0).map(p => `${p.label} ${p.value}`).join('、')
  return `<div class="stack" role="img" aria-label="${escapeHtml(aria)}">${segs}</div>`
}
export function keyHTML(parts) {
  return `<ul class="key">${parts.map(p => `<li><i style="background:${p.color}"></i>${escapeHtml(p.label)} <b>${fmt(p.value)}</b></li>`).join('')}</ul>`
}
export function sentParts(sent = {}) {
  return ['pos', 'neu', 'neg'].map(k => ({ key: k, label: SENT_LABEL[k], value: num(sent[k]), color: SENT_COLOR[k] }))
}
export function platParts(platforms = {}) {
  const { PLAT } = labels()
  return Object.entries(platforms).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({
    key: k, label: PLAT[k] || k, value: num(v), color: PLAT_COLOR[i % PLAT_COLOR.length],
  }))
}

/* ---------- 甜甜圈 ---------- */
export function donutSVG(parts, { size = 132, centerTop = '', centerBottom = '' } = {}) {
  const sum = parts.reduce((a, p) => a + num(p.value), 0)
  const r = 46, c = 2 * Math.PI * r
  let off = 0
  let arcs = ''
  if (sum) {
    for (const p of parts) {
      const v = num(p.value); if (!v) continue
      const len = (v / sum) * c
      arcs += `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${escapeHtml(p.label)} ${v}</title></circle>`
      off += len
    }
  } else arcs = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="#E8E2D9" stroke-width="16"/>`
  const aria = parts.filter(p => num(p.value) > 0).map(p => `${p.label} ${p.value}`).join('、') || '尚無資料'
  return `<svg class="donut" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${escapeHtml(aria)}">${arcs}<text x="60" y="58" text-anchor="middle" class="d-top">${escapeHtml(centerTop)}</text><text x="60" y="74" text-anchor="middle" class="d-bot">${escapeHtml(centerBottom)}</text></svg>`
}

/* ---------- 橫條（媒體／議題） ---------- */
export function hbarsHTML(rows, { color = '#7A6A58', max } = {}) {
  const m = max || Math.max(1, ...rows.map(r => num(r.value)))
  return `<div class="hbars">${rows.map(r => `<div class="hb"><span class="hb-l" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span><span class="hb-t"><span class="hb-f" style="width:${(num(r.value) / m * 100).toFixed(1)}%;background:${r.color || color}"></span></span><span class="hb-v">${fmt(r.value)}</span></div>`).join('')}</div>`
}

/** 議題：每題三條同長度基準的細橫條（吳→徐→鄭同順序） */
export function topicBarsHTML(topicCompare, persons, limit = 9) {
  const topics = Object.keys(topicCompare || {}).map(t => ({
    t, sum: persons.reduce((s, p) => s + num(topicCompare[t][p.id]), 0),
  })).sort((a, b) => b.sum - a.sum).slice(0, limit)
  if (!topics.length) return '<p class="muted">尚無議題資料</p>'
  const max = Math.max(1, ...topics.flatMap(({ t }) => persons.map(p => num(topicCompare[t][p.id]))))
  return `<div class="topics">${topics.map(({ t }) => `<div class="tp"><div class="tp-name">${escapeHtml(t)}</div><div class="tp-bars">${persons.map(p => {
    const st = PERSON_STYLE[p.id] || { color: '#5C564F' }
    const v = num(topicCompare[t][p.id])
    return `<div class="tp-row"><span class="tp-who">${escapeHtml(String(p.name).slice(0, 1))}</span><span class="hb-t"><span class="hb-f" style="width:${(v / max * 100).toFixed(1)}%;background:${st.color}"></span></span><span class="hb-v">${v}</span></div>`
  }).join('')}</div></div>`).join('')}</div>`
}

/* ---------- 民調趨勢（只畫 verified；0–100 固定軸） ---------- */
export function pollTrendSVG({ polls, personIds, persons, w = narrow() ? 380 : 520, h = narrow() ? 280 : 300, ariaLabel }) {
  const L = 36, R = 14, T = 14, B = 30
  const iw = w - L - R, ih = h - T - B
  const pts = []
  for (const p of polls) {
    const t = Date.parse(`${p.field_end || String(p.published_at || '').slice(0, 10)}T12:00:00+08:00`)
    if (!Number.isFinite(t)) continue
    for (const id of personIds) if (p.support && p.support[id] != null) pts.push({ id, t, v: num(p.support[id]), p })
  }
  if (!pts.length) return ''
  let t0 = Math.min(...pts.map(x => x.t)), t1 = Math.max(...pts.map(x => x.t))
  if (t1 - t0 < 86400000 * 14) { t0 -= 86400000 * 7; t1 += 86400000 * 7 }
  const X = (t) => L + ((t - t0) / (t1 - t0)) * iw
  const Y = (v) => T + ih - (Math.max(0, Math.min(100, v)) / 100) * ih
  let g = ''
  for (let k = 0; k <= 5; k++) {
    const v = k * 20, y = Y(v)
    g += `<line class="grid" x1="${L}" x2="${w - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 6}" y="${y + 4}" text-anchor="end">${v}%</text>`
  }
  for (let k = 0; k < 5; k++) {
    const t = t0 + (k / 4) * (t1 - t0)
    const lab = (t1 - t0) > 150 * 86400000 ? taipeiDay(t).slice(2, 7).replace('-', '/') : taipeiDay(t).slice(5).replace('-', '/')
    g += `<text class="ax" x="${X(t).toFixed(1)}" y="${h - 8}" text-anchor="middle">${lab}</text>`
  }
  // 同一對決情境的點才連線（不同情境不可直接比較 → 空心點、不連線）
  const scen = {}
  for (const x of pts) (scen[`${x.id}|${x.p.scenario}`] ||= []).push(x)
  const counts = {}
  for (const x of pts) counts[x.p.scenario] = (counts[x.p.scenario] || 0) + 1
  const mainScenario = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
  let body = ''
  for (const [k, arr] of Object.entries(scen)) {
    const [id, sc] = k.split('|')
    const st = PERSON_STYLE[id] || { color: '#5C564F', dash: '', marker: 'circle' }
    arr.sort((a, b) => a.t - b.t)
    if (sc === mainScenario && arr.length > 1) {
      body += `<polyline fill="none" stroke="${st.color}" stroke-width="2.2" stroke-dasharray="${st.dash}" stroke-linejoin="round" points="${arr.map(a => `${X(a.t).toFixed(1)},${Y(a.v).toFixed(1)}`).join(' ')}"/>`
    }
  }
  for (const x of pts) {
    const st = PERSON_STYLE[x.id] || { color: '#5C564F', marker: 'circle' }
    const hollow = x.p.scenario !== mainScenario
    const name = (persons.find(q => q.id === x.id) || {}).name || x.id
    const href = safeHref(x.p.url)
    const mk = `<g>${marker(st.marker, X(x.t), Y(x.v), 4.5, st.color, hollow)}<title>${escapeHtml(name)} ${x.v}%｜${escapeHtml(x.p.org || '')} 調查至 ${escapeHtml(x.p.field_end || '')}｜${escapeHtml(x.p.scenario || '')}</title></g>`
    body += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${mk}</a>` : mk
  }
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(ariaLabel || '已核對民調趨勢')}">${g}${body}</svg>`
}
