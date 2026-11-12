import { loadJSON, startLiveReload, footerHTML, escapeHtml, safeUrl, sourceHTML, itemHTML, fmtTW, isPollBlackout, filterItemsWithSource } from './lib/data.js'
import './lib/mobile-nav.js'
import { HOME_CARD_ORDER, PERSON_ORDER, PERSON_META, PERSON_STYLE, avatarHTML, photoCreditHTML, sparkSVG, stackHTML, keyHTML, sentParts, thumbHTML, platIcon, icon, installImageFallback } from './lib/charts.js'
import {
  orderedPersons, volumeSeries, volumePanelHTML, sentimentPanelHTML, sourceMixPanelHTML, outletPanelHTML,
  outletByPersonHTML, topicPanelHTML, commentPanelHTML, pollTrendPanelHTML, kpiTileHTML,
} from './lib/panels.js'
import { renderLatestTopHTML } from './lib/latest-top.js'
import { keywordCloudHTML, loadKeywords } from './lib/keywords-ui.js'
import { renderPlatformSectionHTML, bindPlatformMore } from './lib/platform-section.js'
import { pulseHTML } from './lib/pulse.js'
import { coverageTime } from './lib/coverage.js'

installImageFallback();

let policiesCache = null;
let candidateRoster = null;
let policiesLoading = false;

function renderLatestAndPlatform(items){
  const el = $('latestTop');
  if (el) {
    const expanded = el.querySelector('details')?.open ?? window.matchMedia('(min-width: 760px)').matches
    el.innerHTML = renderLatestTopHTML(items || [], { featured: true, expanded, displayMax: 4 });
  }
  const plat = $('platformSection');
  if (!plat) return;
  if (policiesCache) {
    plat.innerHTML = renderPlatformSectionHTML(policiesCache, {roster:candidateRoster});
    bindPlatformMore(plat);
    return;
  }
  plat.innerHTML = '<p class="muted">正在讀取候選人政策來源。</p>';
  if (policiesLoading) return;
  policiesLoading = true;
  Promise.all([loadJSON('/data/policies.json'),loadJSON('/data/candidate-review.json')])
    .then(([p,registry]) => { policiesCache = Array.isArray(p) ? p : []; candidateRoster=registry.candidates.map(person=>({...person,role:`${registry.races.find(r=>r.id===person.race_id).name}候選人・${person.ballot_number}號`})); })
    .catch(() => { policiesCache = []; })
    .finally(() => {
      policiesLoading = false;
      const box = $('platformSection');
      if (box) {
        box.innerHTML = renderPlatformSectionHTML(policiesCache || [], {roster:candidateRoster});
        bindPlatformMore(box);
      }
    });
}

let lastStats = null
let lastItems = []
let pollsCache = null
let pollsLoading = false
let range = 30
let period = 'last_7d'
const $ = (id) => document.getElementById(id)
const pulsePeople = stats => PERSON_ORDER.filter(id => stats.by_person?.[id]).map(id => PERSON_META[id])
let pulseTableVisible = false

function syncPulseView() {
  const table = $('pulseNumbers')
  const chart = $('pulsePlot').querySelector('svg')
  if (table) table.hidden = !pulseTableVisible
  if (chart) chart.style.display = pulseTableVisible ? 'none' : ''
  const control = $('pulseView')
  control?.setAttribute('aria-expanded', String(pulseTableVisible))
  if (control) control.textContent = pulseTableVisible ? '返回立體圖' : '查看數字表'
}

function renderPulse(stats) {
  const people = pulsePeople(stats)
  $('pulsePlot').innerHTML = pulseHTML(stats, people, period)
  syncPulseView()
  const edition = coverageTime(stats)
  $('pulseEdition').textContent = edition ? `統計至 ${edition}（台北）` : '兩時段共用刻度'
  const shortcuts = $('dashPeople')
  if (!shortcuts.hasChildNodes()) {
    shortcuts.innerHTML = people.map(person => `<a href="/person.html?id=${encodeURIComponent(person.id)}">${avatarHTML(person)}<span>${escapeHtml(person.name)}</span></a>`).join('')
  }
  shortcuts.hidden = !people.length
}

function miniItem(i){
  const href = safeUrl(i.url || i.source_url)
  return `<li data-item-card="1" class="mini">${thumbHTML(i, href, i.source_name)}<div class="mini-main"><a class="mini-title" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(i.title||'')}</a><div class="when">${platIcon(i.platform)} ${sourceHTML(i)}${i.published_at ? ` · ${fmtTW(i.published_at).slice(0, 10)}` : ''}</div></div></li>`
}

function renderKpis(stats, persons){
  const sum = (k) => persons.reduce((s, p) => s + (stats.by_person[p.id]?.[k] || 0), 0)
  const outlets = (stats.outlet_distribution?.overall?.outlets || []).length
  $('kpis').innerHTML = [
    kpiTileHTML('doc', stats.total_items ?? '–', '快照不重複件數'),
    kpiTileHTML('clock', sum('last_24h'), '近 24 小時人物收錄量'),
    kpiTileHTML('calendar', sum('last_7d'), '近 7 日人物收錄量'),
    kpiTileHTML('website', outlets || '–', '來源名稱數'),
  ].join('')
}

function renderCards(stats, persons, items){
  const { series } = volumeSeries(stats, persons, 30)
  const maxV = Math.max(1, ...series.flatMap(s => s.values))
  $('cards').innerHTML = persons.map(p=>{
    const ps = stats.by_person[p.id] || {total:0,last_24h:0,last_7d:0,sentiment:{},latest:[]}
    const st = PERSON_STYLE[p.id] || { color:'#5C564F', soft:'#E8E2D9' }
    const own = items.filter(i => i.person_id === p.id).slice(0, 3)
    const base = own.length ? own : (filterItemsWithSource(ps.latest || [], { mark:false }).kept).slice(0, 3)
    const sp = series.find(s => s.id === p.id)
    const parts = sentParts(ps.sentiment)
    return `<article class="card pcard" style="--pc:${st.color};--ps:${st.soft}">
      <header class="pc-head">${avatarHTML(p, 'lg')}<div><h2><a href="/person.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a></h2><div class="muted">${escapeHtml(p.role)}</div><span class="badge party">${escapeHtml(p.party)}</span>${photoCreditHTML(p.id)}</div></header>
      <div class="pc-stats"><div><b>${ps.total||0}</b><span>總則數</span></div><div><b>${ps.last_7d||0}</b><span>近 7 日</span></div><div><b>${ps.last_24h||0}</b><span>近 24h</span></div></div>
      <div class="pc-spark">${sparkSVG(sp ? sp.values : [], maxV, st.color)}<span class="muted fine">近 30 日聲量（三人同一尺度）</span></div>
      ${stackHTML(parts)}${keyHTML(parts)}
      <ul class="mini-list">${base.map(miniItem).join('') || '<li class="muted">尚無</li>'}</ul>
      <p class="pc-more"><a href="/person.html?id=${encodeURIComponent(p.id)}">看 ${escapeHtml(p.name)} 完整時間軸 ${icon('arrow')}</a></p>
    </article>`
  }).join('')
}

function renderPanels(stats, persons){
  $('pVolume').innerHTML = volumePanelHTML(stats, persons, range)
  $('pSent').innerHTML = sentimentPanelHTML(stats, persons)
  $('pMix').innerHTML = sourceMixPanelHTML(stats, persons)
  $('pOutlet').innerHTML = outletPanelHTML(stats, persons)
  $('pOutletBy').innerHTML = outletByPersonHTML(stats, persons)
  $('pTopic').innerHTML = topicPanelHTML(stats, persons)
  $('pComment').innerHTML = commentPanelHTML(stats, persons)
  renderPoll(persons)
}

function renderPoll(persons){
  if (isPollBlackout()) { $('pPoll').innerHTML = pollTrendPanelHTML([], persons, { compact:true }); return }
  if (pollsCache) { $('pPoll').innerHTML = pollTrendPanelHTML(pollsCache, persons, { compact:true }); return }
  $('pPoll').innerHTML = `<h3>${icon('poll')} 民調趨勢</h3><p class="muted">載入中…</p>`
  if (pollsLoading) return
  pollsLoading = true
  loadJSON('/data/polls.json').then(p => { pollsCache = Array.isArray(p) ? p : []; if (lastStats) renderPoll(orderedPersons(lastStats)) })
    .catch(() => { $('pPoll').innerHTML = `<h3>${icon('poll')} 民調趨勢</h3><p class="muted">民調資料暫時無法載入。<a href="/polls.html">看民調頁</a></p>` })
    .finally(() => { pollsLoading = false })
}

function renderFeed(items){
  const kept = items.slice(0, 12)
  $('feed').innerHTML = kept.length ? kept.map(i => itemHTML(i, { showPerson:true })).join('') : '<li class="muted">尚無</li>'
}

$('pVolume').addEventListener('click', e => {
  const b = e.target.closest('button[data-range]')
  if (!b || !lastStats) return
  range = Number(b.dataset.range)
  $('pVolume').innerHTML = volumePanelHTML(lastStats, orderedPersons(lastStats), range)
})

document.querySelector('.pulse-period').addEventListener('click', event => {
  const button = event.target.closest('button[data-period]')
  if (!button) return
  period = button.dataset.period
  for (const option of button.parentElement.querySelectorAll('button')) {
    option.setAttribute('aria-pressed', String(option === button))
  }
  if (lastStats) renderPulse(lastStats)
})

$('pulseView')?.addEventListener('click', () => {
  pulseTableVisible = !pulseTableVisible
  syncPulseView()
})

startLiveReload({
  onData({ stats, items }){
    if(!stats) return
    lastStats = stats
    lastItems = Array.isArray(items) ? items : lastItems
    const persons = orderedPersons(stats)
    const cardPersons = persons.filter(p => HOME_CARD_ORDER.includes(p.id))
    renderPulse(stats)
    renderKpis(stats, persons);
    renderLatestAndPlatform(lastItems);
    renderCards(stats, cardPersons.length ? cardPersons : persons, lastItems);
    renderPanels(stats, persons)
    renderFeed(lastItems)
    const pr = $('pendingNote')
    if(pr) pr.textContent = stats.pending_review_count ? `待審 ${stats.pending_review_count} 筆（與非追蹤人物同篇共現，未列入統計）` : ''
    $('footer').innerHTML = footerHTML(stats)
  }
})

/* 關鍵字字雲（data/keywords.json → public/data） */
loadKeywords().then(kw => {
  let box = document.getElementById('kwCloud')
  if (!box) {
    box = document.createElement('div')
    box.id = 'kwCloud'
    const topic = document.getElementById('pTopic')
    if (topic && topic.parentElement) topic.parentElement.insertAdjacentElement('afterend', box)
    else document.querySelector('main.wrap')?.appendChild(box)
  }
  if (kw) box.innerHTML = keywordCloudHTML(kw)
}).catch(() => {})
