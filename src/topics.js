import { startLiveReload, footerHTML, escapeHtml, fmtTW, safeHref, sourceHTML } from './lib/data.js'
import './lib/mobile-nav.js'
import { orderedPersons } from './lib/panels.js'
import { PERSON_STYLE } from './lib/charts.js'

const picker = document.getElementById('topicPicker')
const state = document.getElementById('topicState')
const chart = document.getElementById('topicChart')
const detail = document.getElementById('topicDetail')
const sources = document.getElementById('topicSources')
const table = document.getElementById('topicTable')
const format = new Intl.NumberFormat('zh-TW')
let active = ''
let rows = []
let persons = []
let latest = []
let latestAvailable = false
let scale = 1

function articleHTML(item) {
  const title = escapeHtml(item.title || '無標題')
  const href = safeHref(item.source_url) || safeHref(item.url)
  const date = item.published_at ? fmtTW(item.published_at) : '發布時間未標'
  return `<li>
    <h4>${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</h4>
    <div class="topic-source-meta"><span>${escapeHtml(date)}</span>${sourceHTML(item)}</div>
  </li>`
}

function renderSelection() {
  const row = rows.find(entry => entry.name === active)
  chart.hidden = !row
  if (!row) {
    state.textContent = '目前尚無可呈現的議題統計。'
    return
  }

  for (const button of picker.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.topic === active))
  }
  state.textContent = `共 ${rows.length} 個議題 · 目前查看${row.name}`
  const bars = row.counts.map((count, i) => {
    const person = persons[i]
    const color = PERSON_STYLE[person.id]?.color || '#5c564f'
    return `<li class="topic-bar">
      <span>${escapeHtml(person.name)}</span>
      <span class="topic-track" aria-hidden="true"><span style="--topic-value:${count / scale * 100}%;--topic-color:${color}"></span></span>
      <b>${format.format(count)}</b>
    </li>`
  }).join('')
  detail.innerHTML = `<div class="topic-detail-head">
    <div><p class="topic-eyebrow">議題收錄</p><h2 id="topicDetailTitle">${escapeHtml(row.name)}</h2></div>
    <div class="topic-total"><strong>${format.format(row.total)}</strong><span>人次收錄</span></div>
  </div>
  <ul class="topic-bars" aria-label="各人物收錄篇數">${bars}</ul>
  <p class="topic-state">各議題共用 0–${format.format(scale)} 則刻度。同篇若分列多位人物，合計會分別計入。</p>`

  const matches = latest.filter(item => Array.isArray(item.topics) && item.topics.includes(active))
  sources.innerHTML = `<h3>近期相關來源</h3>
    <p class="topic-state">取自最新索引，最多列出 6 則，可點開原文查閱。</p>
    ${matches.length ? `<ul class="topic-articles">${matches.slice(0, 6).map(articleHTML).join('')}</ul>` :
    `<p class="topic-source-empty">${latestAvailable ? '最新索引目前沒有收錄這個議題的文章。' : '目前無法讀取最新索引。'}</p>`}`
}

picker.addEventListener('click', event => {
  const button = event.target.closest('button[data-topic]')
  if (!button || button.dataset.topic === active) return
  active = button.dataset.topic
  renderSelection()
})

startLiveReload({
  onData({ stats, items, itemsError }) {
    if (!stats) {
      state.textContent = '目前無法讀取議題統計。'
      return
    }
    persons = orderedPersons(stats)
    latest = Array.isArray(items) ? items : []
    latestAvailable = Array.isArray(items) && !itemsError
    rows = Object.entries(stats.topic_compare || {}).map(([name, counts]) => {
      const values = persons.map(person => Number(counts?.[person.id]) || 0)
      return { name, counts: values, total: values.reduce((sum, count) => sum + count, 0) }
    }).sort((a, b) => b.total - a.total)
    scale = Math.max(1, ...rows.flatMap(row => row.counts))
    if (!rows.some(row => row.name === active)) active = rows[0]?.name || ''

    const focused = picker.contains(document.activeElement) ? document.activeElement.dataset.topic : ''
    picker.innerHTML = rows.map(({ name }) =>
      `<button type="button" data-topic="${escapeHtml(name)}" aria-controls="topicChart" aria-pressed="false">${escapeHtml(name)}</button>`
    ).join('')
    if (focused) Array.from(picker.querySelectorAll('button')).find(button => button.dataset.topic === focused)?.focus({ preventScroll: true })
    renderSelection()
    table.innerHTML = rows.length ? `<table>
      <thead><tr><th scope="col">議題</th>${persons.map(person => `<th scope="col">${escapeHtml(person.name)}</th>`).join('')}<th scope="col">合計</th></tr></thead>
      <tbody>${rows.map(row => `<tr><th scope="row">${escapeHtml(row.name)}</th>${row.counts.map(count => `<td>${format.format(count)}</td>`).join('')}<td>${format.format(row.total)}</td></tr>`).join('')}</tbody>
    </table>` : '<p class="topic-state">目前尚無可呈現的議題統計。</p>'
    document.getElementById('footer').innerHTML = footerHTML(stats)
  },
})
