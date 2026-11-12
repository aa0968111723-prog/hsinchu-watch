/** 各頁共用的圖表面板（只讀 stats／polls；三人同尺寸、吳→徐→鄭順序）。 */
import { escapeHtml, safeUrl, labels, isPollBlackout, POLL_NUMBERS_ENABLED } from './data.js'
import {
  PERSON_ORDER, PERSON_STYLE, SENT_COLOR, SENT_LABEL, lineChartSVG, legendHTML, sparkSVG, stackHTML, keyHTML,
  sentParts, platParts, donutSVG, hbarsHTML, topicBarsHTML, taipeiDay, dayRange, pollTrendSVG, icon, avatarHTML,
} from './charts.js'

const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
export function orderedPersons(stats) {
  const ps = stats.persons || []
  return [...ps].sort((a, b) => PERSON_ORDER.indexOf(a.id) - PERSON_ORDER.indexOf(b.id))
}
export function endDayOf(stats) {
  return taipeiDay(stats.generated_at ? new Date(stats.generated_at) : new Date()) || taipeiDay(new Date())
}
export function volumeSeries(stats, persons, nDays) {
  const end = endDayOf(stats)
  let days
  if (nDays === 0) {
    const all = persons.flatMap(p => Object.keys(stats.by_person[p.id]?.daily_volume || {}))
    const first = all.sort()[0] || end
    const span = Math.max(7, Math.round((Date.parse(end) - Date.parse(first)) / 86400000) + 1)
    days = dayRange(end, span)
  } else days = dayRange(end, nDays)
  const series = persons.map(p => {
    const dv = stats.by_person[p.id]?.daily_volume || {}
    return { id: p.id, name: p.name, values: days.map(d => n0(dv[d])) }
  })
  return { days, series }
}

const RANGES = [[14, '14 日'], [30, '30 日'], [90, '90 日'], [0, '全部']]
export function volumePanelHTML(stats, persons, range = 30) {
  const { days, series } = volumeSeries(stats, persons, range)
  const tabs = RANGES.map(([v, l]) => `<button type="button" data-range="${v}" class="${v === range ? 'active' : ''}" aria-pressed="${v === range}">${l}</button>`).join('')
  const rows = series.map(s => `<tr><th scope="row">${escapeHtml(s.name)}</th><td>${s.values.reduce((a, b) => a + b, 0)}</td></tr>`).join('')
  return `<div class="panel-head"><h3>${icon('clock')} 聲量時間線</h3><div class="seg-tabs" id="rangeTabs" role="group" aria-label="時間範圍">${tabs}</div></div>
    ${lineChartSVG({ days, series, ariaLabel: `${persons.map(p => p.name).join('、')}每日新增則數折線圖` })}
    ${legendHTML(persons)}
    <p class="muted fine">每日新增則數（依發布日；三人共用同一縱軸）。區間合計：${series.map(s => `${escapeHtml(s.name)} ${s.values.reduce((a, b) => a + b, 0)}`).join('、')}。</p>
    <details class="mini"><summary>看合計數字表</summary><table><thead><tr><th>人物</th><th>區間合計</th></tr></thead><tbody>${rows}</tbody></table></details>`
}

export function sentimentPanelHTML(stats, persons) {
  const rows = persons.map(p => {
    const ps = stats.by_person[p.id] || {}
    const parts = sentParts(ps.sentiment)
    return `<div class="mix-row"><div class="mix-who">${avatarHTML(p, 'xs')}<span>${escapeHtml(p.name)}</span></div>${stackHTML(parts)}${keyHTML(parts)}</div>`
  }).join('')
  return `<details class="tone-review"><summary>自動語氣分類（非候選人評分）</summary><h3>${icon('layers')} 報導語氣分布</h3>${rows}<p class="muted fine">僅依已收錄標題與摘要的既有自動標籤分類，未在本輪逐筆重判。不是民意樣本，也不表示支持、反對、查核結果或本站立場；請閱讀原文與候選人多面向資料。</p></details>`
}

export function sourceMixPanelHTML(stats, persons) {
  const rows = persons.map(p => {
    const ps = stats.by_person[p.id] || {}
    const parts = platParts(ps.platforms)
    return `<div class="mix-row"><div class="mix-who">${avatarHTML(p, 'xs')}<span>${escapeHtml(p.name)}</span></div>${stackHTML(parts)}${keyHTML(parts)}</div>`
  }).join('')
  return `<h3>${icon('news')} 來源類型組成</h3>${rows}<p class="muted fine">各人物頁面所列則數的平台占比（同一篇提及多人會分別計入）。</p>`
}

export function outletRows(raw) {
  if (!raw) return []
  return (Array.isArray(raw) ? raw : Object.entries(raw).map(([name, v]) => ({ name, ...v }))).map(o => ({ label: o.name, value: n0(o.count) }))
}
export function outletPanelHTML(stats, persons, { topN = 8 } = {}) {
  const od = stats.outlet_distribution
  const overall = outletRows(od?.overall?.outlets)
  if (!overall.length) return `<h3>${icon('website')} 媒體來源</h3><p class="muted">尚無資料</p>`
  const top = overall.slice(0, topN)
  const rest = overall.slice(topN).reduce((a, r) => a + r.value, 0)
  const rows = rest ? [...top, { label: `其他 ${overall.length - topN} 家`, value: rest, color: '#C9C0B2' }] : top
  return `<h3>${icon('website')} 媒體來源（全站，同網址算一次）</h3>${hbarsHTML(rows)}<p class="muted fine">共 ${overall.length} 個來源名稱、${n0(od.overall.total)} 則；單一媒體占比高低不代表立場。</p>`
}
export function outletByPersonHTML(stats, persons, topN = 5) {
  const cols = persons.map(p => {
    const rows = outletRows(stats.outlet_distribution?.by_person?.[p.id]?.outlets).slice(0, topN)
    const st = PERSON_STYLE[p.id] || { color: '#7A6A58' }
    return `<div class="col"><div class="mix-who">${avatarHTML(p, 'xs')}<span>${escapeHtml(p.name)}</span></div>${rows.length ? hbarsHTML(rows, { color: st.color }) : '<p class="muted">尚無</p>'}</div>`
  }).join('')
  return `<h3>${icon('website')} 各人物前 ${topN} 大來源</h3><div class="cols3">${cols}</div>`
}

export function topicPanelHTML(stats, persons, limit = 9) {
  return `<h3>${icon('layers')} 議題聲量比較</h3>${legendHTML(persons)}${topicBarsHTML(stats.topic_compare, persons, limit)}<p class="muted fine">每題同一尺度、吳→徐→鄭同順序；數字為各人物該議題命中則數。</p>`
}

export function commentPanelHTML(stats, persons) {
  const cols = persons.map(p => {
    const ps = stats.by_person[p.id] || {}
    const cs = ps.comment_stats || {}
    const samples = n0(cs.samples)
    const social = n0(ps.platforms?.ptt) + n0(ps.platforms?.youtube) + n0(ps.platforms?.x)
    const parts = sentParts(cs.sentiment)
    return `<div class="heat">
      <div class="mix-who">${avatarHTML(p, 'xs')}<span>${escapeHtml(p.name)}</span></div>
      <div class="heat-num"><b>${samples}</b><span>則留言樣本</span></div>
      <div class="heat-num"><b>${social}</b><span>則社群討論串（PTT／YouTube／X）</span></div>
      ${samples ? stackHTML(parts) + keyHTML(parts) : '<p class="muted fine">本輪尚無留言樣本</p>'}
    </div>`
  }).join('')
  return `<h3>${icon('commentary')} 留言與社群熱度（僅彙總）</h3><div class="cols3">${cols}</div><p class="muted fine">只呈現匿名彙總數字；不顯示帳號、名字或頭像。短摘錄（≤30 字）見各人物頁「網友留言」。</p>`
}

/* ---------- 民調 ---------- */
export function pollNumbersOK(p) {
  return POLL_NUMBERS_ENABLED && !isPollBlackout() && p.verified === true && !p.numbers_hidden
}
export function pollTrendPanelHTML(polls, persons, { compact = false } = {}) {
  if (isPollBlackout()) {
    return `<h3>${icon('poll')} 民調趨勢</h3><p class="warn">依選罷法封關期間（11/18 00:00–11/28 16:00 台北），不顯示民調數字。</p>`
  }
  const ok = (polls || []).filter(p => pollNumbersOK(p) && p.support && Object.keys(p.support).length)
  const reportsOnly = (polls || []).filter(p => !pollNumbersOK(p)).length
  const blocks = [
    ['county_magistrate', '新竹縣長', ['xu', 'zheng']],
    ['zhubei_mayor', '竹北市長', ['wu']],
  ].map(([race, name, ids]) => {
    const rp = ok.filter(p => p.race === race)
    const svg = pollTrendSVG({ polls: rp, personIds: ids, persons, ariaLabel: `${name}已核對民調趨勢` })
    if (!svg) return `<div class="poll-block"><h4>${name}</h4><p class="muted">目前沒有已核對的民調。</p></div>`
    const leg = legendHTML(persons.filter(p => ids.includes(p.id)))
    const latest = [...rp].sort((a, b) => String(b.field_end || '').localeCompare(String(a.field_end || '')))[0]
    return `<div class="poll-block"><h4>${name}｜已核對 ${rp.length} 份</h4>${svg}${leg}
      <p class="muted fine">實心＝多數民調採用的對決情境；空心＝其他情境（不連線、不直接比較）。縱軸固定 0–100%。點圖上的點可開原文。最新：${escapeHtml(latest.org)}，調查至 ${escapeHtml(latest.field_end || '')}，樣本 ${escapeHtml(latest.sample_size)}。</p></div>`
  }).join('')
  return `<h3>${icon('poll')} 民調趨勢（僅已核對原文者）</h3><div class="${compact ? 'cols2' : 'cols2'}">${blocks}</div>
    <p class="muted fine">另有 ${reportsOnly} 則「民調報導」尚未核對數字，不入圖，只列標題與來源。${compact ? ' <a href="/polls.html">看民調頁 →</a>' : ''}</p>`
}

export function kpiTileHTML(ic, value, label) {
  return `<div class="kpi">${icon(ic, 'kpi-ico')}<div><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div></div>`
}
