import { orderedPersons, pollNumbersOK, pollTrendPanelHTML } from './lib/panels.js'
import './lib/mobile-nav.js'
import { startLiveReload, footerHTML, escapeHtml, safeUrl, sourceHTML, fmtTW, isPollBlackout } from './lib/data.js'

const races = { county_magistrate: '新竹縣長', zhubei_mayor: '竹北市長' }
const tracked = { wu: '吳旭智', xu: '徐欣瑩', zheng: '鄭朝方' }
const chart = document.getElementById('pollChart')
const latest = document.getElementById('pollTrend')
const list = document.getElementById('pollList')
const filters = document.getElementById('pollFilters')
const race = document.getElementById('pollRace')
const verification = document.getElementById('pollVerification')
const results = document.getElementById('pollResults')
const more = document.getElementById('pollMore')
const pageSize = 12
let reportLimit = pageSize
let reports = []

function raceId(poll) {
  return Object.hasOwn(races, poll.race) ? poll.race : Object.keys(races).find(id => races[id] === poll.race)
}

function pollBars(poll) {
  const rows = Object.entries(tracked).flatMap(([id, name]) => {
    const raw = poll.support?.[id]
    const value = Number(raw)
    if (raw == null || String(raw).trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) return []
    return [`<li class="poll-bar-row"><span>${name}</span><div class="poll-track" aria-hidden="true"><div class="poll-fill" style="width:${value}%"></div></div><strong>${escapeHtml(value)}%</strong></li>`]
  })
  if (!rows.length) return ''
  return `<div class="poll-scale" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div><ul class="poll-bars" aria-label="支持度">${rows.join('')}</ul>`
}

function pollFacts(poll) {
  const facts = [['調查期間', poll.period], ['有效樣本', poll.sample_size], ['對決情境', poll.scenario]]
  return `<dl class="poll-facts">${facts.filter(([, value]) => value != null && value !== '').map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`
}

function matchupsHTML(poll) {
  const matchups = (poll.matchups || []).filter(matchup => matchup.scenario !== poll.scenario)
  if (!matchups.length) return ''
  const rows = matchups.map(matchup => {
    const others = (matchup.other_candidates || []).map(escapeHtml).join('、')
    return `<div class="poll-matchup"><p>${escapeHtml(matchup.scenario || '')}${others ? `（另含 ${others}，本站不列其數字）` : ''}</p>${pollBars(matchup)}</div>`
  })
  return `<details class="poll-extra"><summary>查看其他對決情境（${matchups.length}）</summary>${rows.join('')}</details>`
}

function reportHTML(poll) {
  const verified = pollNumbersOK(poll)
  const label = races[raceId(poll)] || poll.race_label || '選區未註明'
  const related = (poll.reports || []).slice(1)
  return `<li data-item-card="1">
    <div class="poll-tags"><span class="badge">${escapeHtml(label)}</span><span class="badge ${verified ? 'poll-verified' : ''}">${verified ? '已核對民調' : '民調報導'}</span></div>
    <div class="title"><a href="${escapeHtml(safeUrl(poll.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(poll.title)}</a></div>
    <div class="when">${fmtTW(poll.published_at)} · ${sourceHTML(poll)}</div>
    ${verified ? `${pollFacts(poll)}${pollBars(poll)}${matchupsHTML(poll)}` : ''}
    ${verified && poll.period_note ? `<p class="muted">${escapeHtml(poll.period_note)}</p>` : ''}
    ${!verified && poll.pending_note ? `<p class="muted">${escapeHtml(poll.pending_note)}，暫不顯示數字。</p>` : ''}
    ${verified && related.length ? `<p class="muted">其他報導 ${related.map(sourceHTML).join('、')}</p>` : ''}
  </li>`
}

function renderReports() {
  if (isPollBlackout()) {
    filters.hidden = true
    more.hidden = true
    results.textContent = '封關期間暫停列出民調報導。'
    list.replaceChildren()
    return
  }
  const visible = reports.filter(poll =>
    (!race.value || raceId(poll) === race.value) &&
    (!verification.value || pollNumbersOK(poll) === (verification.value === 'verified')))
  results.textContent = visible.length ? `顯示 ${Math.min(visible.length, reportLimit)} 則，共 ${visible.length} 則報導。` : '此篩選條件暫無報導。'
  list.innerHTML = visible.slice(0, reportLimit).map(reportHTML).join('')
  more.hidden = reportLimit >= visible.length
}

for (const select of [race, verification]) {
  select.addEventListener('change', () => {
    reportLimit = pageSize
    renderReports()
  })
}
more.addEventListener('click', () => {
  reportLimit += pageSize
  renderReports()
})

function render(polls, stats) {
  latest.setAttribute('aria-busy', 'false')
  chart.innerHTML = pollTrendPanelHTML(polls, orderedPersons(stats))
  if (isPollBlackout()) {
    reports = []
    latest.innerHTML = '<p class="warn">封關期間（11/18 00:00–11/28 16:00 台北）暫停顯示民調數字。</p>'
    renderReports()
    return
  }

  const verified = polls.filter(pollNumbersOK)
  const studyCards = Object.entries(races).map(([id, label]) => {
    const poll = verified.filter(poll => raceId(poll) === id && poll.support && Object.keys(poll.support).length)
      .sort((a, b) => String(b.field_end || '').localeCompare(String(a.field_end || '')))[0]
    return `<article class="poll-study"><h3>${label}</h3>${poll ?
      `<p class="poll-study-source">${escapeHtml(poll.org || poll.source_name)} <a href="${escapeHtml(safeUrl(poll.url))}" target="_blank" rel="noopener noreferrer">查閱原文</a></p>${pollFacts(poll)}${pollBars(poll)}` :
      '<p class="muted">目前沒有已核對民調。</p>'}</article>`
  })
  const reportCount = verified.reduce((total, poll) => total + ((poll.reports || []).length || 1), 0)
  latest.innerHTML = `<div class="poll-studies">${studyCards.join('')}</div>
    <p class="muted poll-note">各選區依調查結束日選出最新一份。已核對 ${verified.length} 份民調，對應 ${reportCount} 則報導。比例軸固定 0–100%。</p>
    <details class="poll-extra"><summary>收錄與圖表說明</summary><p>本站收錄公開報導。機構、調查期間、樣本數和個別人選數字經核對後，才繪製本站追蹤人選的數值。尚未核對者僅列報導標題與來源。</p></details>`
  reports = polls.filter(poll => poll.url && /^https?:\/\//i.test(poll.url) && poll.source_name)
    .sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0))
  filters.hidden = false
  renderReports()
}

startLiveReload({
  fetchImpl(url, options) {
    if (isPollBlackout() && new URL(url, location.href).pathname === '/data/polls.json') {
      return Promise.resolve(Response.json([]))
    }
    return fetch(url, options)
  },
  onData({ stats, polls }) {
    if (!stats) return
    render(Array.isArray(polls) ? polls : [], stats)
    document.getElementById('footer').innerHTML = footerHTML(stats)
  },
})
