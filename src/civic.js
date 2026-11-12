import sections from './lib/civic-sections.json'
import { buildCivicSnapshot } from './lib/civic-adapter.js'
import './styles.css'
import './visual.css'
import './mobile.css'

const FILES = [
  ['manifest', '/data/manifest.json'],
  ['governance', '/data/governance.json'],
  ['governanceRegistry', '/data/governance-registry.json'],
  ['candidates', '/data/candidate-review.json'],
  ['refreshLog', '/data/civic/refresh-log.json'],
]

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]))
}

function textOrUnknown(value, empty = '尚未取得') {
  if (value === null || value === undefined || value === '') return empty
  return String(value)
}

function healthLabel(health) {
  return {
    unknown: '沒有成功紀錄',
    ok: '最近一次成功',
    stale: '失敗後沿用上一筆',
    failed: '失敗，沒有可保留的資料',
    blocked: '來源受阻',
  }[health] || health
}

function sourceKind(kind) {
  return {
    project_page: '工程頁',
    project_register: '工程清冊',
    agency_release: '機關發布',
    official_notice: '公告',
    data_catalog: '資料目錄',
    council_records: '議事資料',
    national_catalog: '中央目錄',
  }[kind] || kind
}

function money(value) {
  if (value === null || value === undefined) return '尚未取得'
  return new Intl.NumberFormat('zh-TW').format(value) + ' 元'
}

async function loadOne(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } })
  if (response.status === 404) return { ok: false, missing: true, status: 404 }
  if (!response.ok) return { ok: false, missing: false, status: response.status }
  return { ok: true, data: await response.json() }
}

function renderFacts(snapshot) {
  const rows = [
    ['資料產生', textOrUnknown(snapshot.times.data_generated_at, '尚未讀到')],
    ['介面更新', textOrUnknown(snapshot.times.ui_updated_at, '尚未讀到')],
    ['快照整理', textOrUnknown(snapshot.times.manifest_finalized_at, '尚未讀到')],
    ['人物新聞列', textOrUnknown(snapshot.counts.items_rows, '尚未讀到')],
    ['不重複網址', textOrUnknown(snapshot.counts.items_unique_url, '尚未讀到')],
    ['治理案卷', textOrUnknown(snapshot.counts.governance_projects, '尚未讀到')],
    ['正式候選人', textOrUnknown(snapshot.counts.official_candidates, '尚未讀到')],
    ['法案逐筆', '尚未收錄'],
  ]
  return `<dl class="civic-facts">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`
}

function renderSections() {
  return `<div class="civic-grid">${sections.sections.map(section => `<article class="civic-card"><h3><a href="${escapeHtml(section.href)}">${escapeHtml(section.title)}</a></h3><p>${escapeHtml(section.summary)}</p></article>`).join('')}</div>`
}

function renderRefresh(refresh) {
  return `<section class="civic-card" id="refresh" aria-labelledby="refresh-title"><h2 id="refresh-title">來源刷新</h2><p>可用來源的檢查週期是 20 分鐘，失敗會退避並保留上一筆成功內容。排程設定、實際成功與正式站發布要分開看。</p><dl class="civic-facts"><div><dt>週期</dt><dd>${escapeHtml(refresh.interval_minutes)} 分鐘</dd></div><div><dt>狀態</dt><dd>${escapeHtml(healthLabel(refresh.health))}</dd></div><div><dt>最後嘗試</dt><dd>${escapeHtml(textOrUnknown(refresh.last_attempt_at, '沒有紀錄'))}</dd></div><div><dt>最後成功</dt><dd>${escapeHtml(textOrUnknown(refresh.last_success_at, '沒有成功紀錄'))}</dd></div><div><dt>下次檢查</dt><dd>${escapeHtml(textOrUnknown(refresh.next_due_at, '尚未排入這份快照'))}</dd></div></dl><p class="civic-note">${refresh.configured ? '' : '這份快照還沒有刷新日誌。介面更新日期不是抓取成功時間。'}</p></section>`
}

function renderSources(sources) {
  if (!sources) return '<p class="civic-alert">治理來源目錄沒有載入，案卷列表先留空。</p>'
  const rows = sources.map(source => `<tr><td>${escapeHtml(source.name)}</td><td>${escapeHtml(sourceKind(source.kind))}</td><td>${escapeHtml(healthLabel(source.health))}</td><td>${escapeHtml(textOrUnknown(source.checked_at, '未知'))}</td><td>${escapeHtml(textOrUnknown(source.last_success_at, '沒有成功抓取'))}</td><td><a href="${escapeHtml(source.url)}">來源</a></td></tr>`).join('')
  return `<div class="civic-scroll"><table class="civic-table"><thead><tr><th>來源</th><th>類型</th><th>刷新</th><th>查閱日</th><th>最後成功</th><th>連結</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function renderProjects(snapshot) {
  if (!snapshot.projects) return ''
  const pending = new Map((snapshot.geography || []).map(row => [row.id, row]))
  return snapshot.projects.map(project => {
    const geo = pending.get(project.id)
    const located = geo && geo.geometry ? '已有座標' : '待定位'
    const progress = project.progress
      ? `${project.progress.value}%（機關表列的工程進度，不是驗收或成效）`
      : '尚未取得'
    return `<article class="civic-card"><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.agency || '機關未標')} · ${escapeHtml(project.status || '狀態未標')}</p><p>狀態日期 ${escapeHtml(textOrUnknown(project.status_as_of, '未知'))} · 位置 ${escapeHtml(located)}</p><p>工程進度 ${escapeHtml(progress)}</p><p>核定 ${escapeHtml(money(project.budget.approved_twd))} · 決標 ${escapeHtml(money(project.budget.contract_twd))} · 實支 ${escapeHtml(money(project.budget.spent_twd))}</p><p class="civic-note">${project.missing_evidence.length ? '待補：' + escapeHtml(project.missing_evidence.join('、')) : '這筆案卷沒有另列待補項目。'}</p></article>`
  }).join('')
}

function renderCandidates(snapshot) {
  if (!snapshot.candidates) return '<p class="civic-alert">正式名單沒有載入。</p>'
  const races = new Map((snapshot.races || []).map(race => [race.id, race.name]))
  const items = snapshot.candidates.map(person => `<li>${escapeHtml(races.get(person.race_id) || person.race_id)} · ${escapeHtml(person.ballot_number)}. ${escapeHtml(person.name)}</li>`).join('')
  return `<ol class="civic-list">${items}</ol><p class="civic-note">名單來自選委會號次資料。歷史參選人與評論者留在原人物頁，不併入這份正式名單。</p>`
}

function render(snapshot, failures) {
  const alerts = failures.filter(item => !item.missing).map(item => `<p class="civic-alert">${escapeHtml(item.label)}載入失敗（HTTP ${escapeHtml(item.status)}）。已顯示其餘讀到的快照。</p>`).join('')
  document.getElementById('civicStatus').textContent = snapshot.loaded.manifest
    ? `資料 ${textOrUnknown(snapshot.times.data_generated_at, '時間未知')}`
    : '快照未完整載入'
  document.getElementById('civicBoard').innerHTML = `
    ${alerts}
    <section aria-labelledby="civic-title"><p class="civic-lead">選舉觀察仍在上方選單。這裡把地方治理、中央資料、地圖、人物、網路聲音與完整紀錄接到同一份快照。</p><h2 id="civic-title">現在這份快照</h2>${renderFacts(snapshot)}<p class="civic-note">人物新聞列與不重複網址來自 manifest，完整資料頁的合併筆數在<a href="/archive.html">完整資料</a>計算。兩邊不各算一套。</p></section>
    <section aria-labelledby="sections-title"><h2 id="sections-title">閱讀入口</h2>${renderSections()}</section>
    <section id="central" aria-labelledby="central-title"><h2 id="central-title">中央與法案</h2><p>法案逐筆：尚未收錄。目錄來源：${snapshot.central.catalog_source_ids.length ? escapeHtml(snapshot.central.catalog_source_ids.join('、')) : '這份來源目錄裡還沒有中央目錄。'}</p><p class="civic-note">目錄可以打開，不代表法案內容已經逐筆核對。</p></section>
    ${renderRefresh(snapshot.refresh)}
    <section aria-labelledby="source-title"><h2 id="source-title">治理來源</h2>${renderSources(snapshot.sources)}<div class="civic-actions"><button id="civicRetry" type="button">重試未載入的檔案</button></div></section>
    <section aria-labelledby="project-title"><h2 id="project-title">治理案卷與待定位</h2><div class="civic-grid">${renderProjects(snapshot)}</div><p class="civic-note"><a href="/maps.html">議題地圖</a>維持原入口。新的地理地圖要等座標證據，不用城市中心填空。</p></section>
    <section aria-labelledby="roster-title"><h2 id="roster-title">正式候選人</h2>${renderCandidates(snapshot)}</section>
    <section class="civic-card" id="method" aria-labelledby="method-title"><h2 id="method-title">方法與來源</h2><p>主張、機關發布、報導、意見、質疑、回應、查核與司法程序分開。報導整理不是獨立查核。某一筆沒有回應，只表示這份紀錄沒有載入回應。</p><p>發布日、蒐集日、查閱日與介面更新日分開。民調數字仍只在逐筆核對後、且未遇封關時出現。匿名留言不顯示帳號。</p><p><a href="/manual.html">提供公開來源</a> · <a href="/archive.html">匯出完整資料</a> · <a href="/compare.html#reviewMethod">候選人閱讀標準</a></p></section>`
  document.getElementById('civicBoard').ariaBusy = 'false'
  document.getElementById('civicRetry').addEventListener('click', () => loadDesk())
}

async function loadDesk() {
  const docs = {}
  const failures = []
  const labels = {
    manifest: '統計快照',
    governance: '治理案卷',
    governanceRegistry: '治理來源',
    candidates: '正式名單',
    refreshLog: '刷新日誌',
  }
  await Promise.all(FILES.map(async ([key, path]) => {
    const result = await loadOne(path)
    if (result.ok) docs[key] = result.data
    else failures.push({ key, label: labels[key], status: result.status, missing: result.missing })
  }))
  render(buildCivicSnapshot(docs), failures)
}

loadDesk().catch(error => {
  document.getElementById('civicStatus').textContent = '讀取失敗'
  document.getElementById('civicBoard').innerHTML = `<p class="civic-alert">${escapeHtml(error.message || '無法讀取快照')}</p><div class="civic-actions"><button id="civicRetry" type="button">重試未載入的檔案</button></div>`
  document.getElementById('civicRetry').addEventListener('click', () => loadDesk())
})
