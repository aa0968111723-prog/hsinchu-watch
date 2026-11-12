import { loadJSON, startLiveReload, footerHTML, itemHTML, escapeHtml, safeUrl, labels, fmtTW } from './lib/data.js'
import './lib/mobile-nav.js'
import { paginate } from './lib/paginate.js'
import { PERSON_ORDER, PERSON_META, PERSON_STYLE, avatarHTML, photoCreditHTML, donutSVG, sentParts, platParts, keyHTML, hbarsHTML, icon, installImageFallback } from './lib/charts.js'
import { keywordCloudHTML, loadKeywords } from './lib/keywords-ui.js'
import { volumePanelHTML, commentPanelHTML, kpiTileHTML, outletRows } from './lib/panels.js'
installImageFallback()
let lastStats = null
let range = 30
const donutBlock = (title, ic, parts, total) => `<h3>${icon(ic)} ${title}</h3><div class="donut-wrap">${donutSVG(parts, { centerTop: String(total), centerBottom: '則' })}${keyHTML(parts)}</div>`
const { PLAT } = labels()
const requested = new URLSearchParams(location.search).get('id')
const id = PERSON_ORDER.includes(requested) ? requested : PERSON_ORDER[0]
const $ = key => document.getElementById(key)
const normalize = value => value.trim().normalize('NFKC').toLocaleLowerCase('zh-TW')
const controls = ['q', 'platform', 'topic', 'own'].map($)
const known = PERSON_META[id]
let person = known

function renderPersonSwitch(){
  const el = document.getElementById('personSwitch')
  if(!el) return
  el.innerHTML = PERSON_ORDER.map(pid => {
    const meta = PERSON_META[pid]
    if(!meta) return ''
    const on = pid === id ? ' class="active" aria-current="page"' : ''
    return `<a${on} href="/person.html?id=${encodeURIComponent(pid)}">${escapeHtml(meta.name)}</a>`
  }).join('')
}
renderPersonSwitch()
renderIdentity()
const PAGE_SIZE = 30
let all = []
let tab = 'timeline'
let visibleCount = PAGE_SIZE

function filteredRows(){
  let rows = all
  if(tab === 'youtube') rows = rows.filter(i => i.platform === 'youtube')
  const q = normalize($('q').value)
  const platform = tab === 'youtube' ? '' : $('platform').value
  const topic = $('topic').value
  const own = $('own').value
  return rows.filter(it=>{
    if(platform && it.platform !== platform) return false
    if(topic && !(it.topics||[]).includes(topic)) return false
    if(own !== '' && Boolean(it.is_own_speech) !== (own === '1')) return false
    if(q && !normalize(`${it.title||''} ${it.summary||''}`).includes(q)) return false
    return true
  })
}

function updateLoadMore(total){
  const wrap = document.getElementById('loadMoreWrap')
  const btn = document.getElementById('loadMore')
  if(!wrap || !btn) return
  if(tab === 'comments' || total <= visibleCount){
    wrap.classList.add('hidden')
    btn.disabled = true
    return
  }
  wrap.classList.remove('hidden')
  btn.disabled = false
  const remain = total - visibleCount
  btn.textContent = `載入更多（還有 ${remain} 則）`
}

function apply(offset = 0){
  if(tab === 'comments') {
    if (lastStats) showComments(lastStats)
    return
  }
  if (!lastStats) return
  const rows = filteredRows()
  const { shown, total } = paginate(rows, visibleCount, PAGE_SIZE)
  $('count').textContent = total ? `顯示 ${shown.length}／${total} 則` : '此篩選條件暫無資料'
  $('clearPersonFilters').hidden = !controls.some(input => input.value && !input.disabled)
  const list = $('list')
  if (offset) {
    list.insertAdjacentHTML('beforeend', shown.slice(offset).map(itemHTML).join(''))
    list.children[offset]?.querySelector('.title a')?.focus()
  } else {
    list.innerHTML = shown.length ? shown.map(itemHTML).join('') : '<li class="muted">可以調整關鍵字或篩選條件再試。</li>'
  }
  updateLoadMore(total)
}

function showComments(stats){
  const ps = stats.by_person[id] || {}
  const ex = ps.comment_stats?.excerpts || []
  const sent = ps.comment_stats?.sentiment || {}
  document.getElementById('loadMoreWrap')?.classList.add('hidden')
  document.getElementById('list').innerHTML = `
    <li><div class="muted">僅統計與不具名短摘錄（≤30字），不顯示帳號／名字／頭像。</div>
    <div style="margin:.5rem 0">
      <span class="badge pos">正 ${sent.pos||0}</span>
      <span class="badge neu">中 ${sent.neu||0}</span>
      <span class="badge neg">負 ${sent.neg||0}</span>
      <span class="badge">樣本 ${ps.comment_stats?.samples||0}</span>
    </div></li>
    ${ex.length? ex.map(e=>`<li><span class="badge ${e.sentiment}">${e.sentiment}</span> 「${escapeHtml(e.text)}」 <a href="${escapeHtml(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">原文</a></li>`).join('') : '<li class="muted">尚無留言摘錄（PTT／YouTube 有命中才會出現）</li>'}`
}

$('tabs').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-tab]')
  if(!btn) return
  tab = btn.dataset.tab
  visibleCount = PAGE_SIZE
  for (const control of $('tabs').children) {
    control.classList.toggle('active', control === btn)
    control.setAttribute('aria-pressed', String(control === btn))
  }
  $('filtersPanel').hidden = tab === 'comments'
  $('personPlatform').hidden = tab === 'youtube'
  $('platform').disabled = tab === 'youtube'
  apply()
})

function resetPage() {
  visibleCount = PAGE_SIZE
  apply()
}
for (const input of controls) input.addEventListener(input.type === 'search' ? 'input' : 'change', resetPage)
$('clearPersonFilters').addEventListener('click', () => {
  for (const input of controls) if (!input.disabled) input.value = ''
  resetPage()
  $('q').focus()
})

document.getElementById('loadMore')?.addEventListener('click', ()=>{
  const offset = visibleCount
  visibleCount += PAGE_SIZE
  apply(offset)
})

function setOptions(select, values, caption, label = value => value) {
  const current = select.value
  select.replaceChildren(new Option(caption, ''), ...values.map(value => new Option(label(value), value)))
  select.value = values.includes(current) ? current : ''
}

startLiveReload({
  personId: id,
  onData({ items, stats }){
    if(!stats) return
    person = { ...known, ...(stats.persons || []).find(p => p.id === id) }
    lastStats = stats
    renderIdentity(stats)
    renderViz(stats, person)
    all = items.filter(i=>i.person_id===id)
    const plats = [...new Set(all.map(i => i.platform).filter(Boolean))]
    const topics = [...new Set(all.flatMap(i => i.topics || []))]
    setOptions($('platform'), plats, '全部平台', value => PLAT[value] || value)
    setOptions($('topic'), topics, '全部議題')
    document.getElementById('footer').innerHTML = footerHTML(stats);
    apply()
  }
})


// 012：本人發言（官網）獨立區塊（不混入時間軸、不計統計）；顯示官網缺口（例：鄭朝方無官網）
function renderOfficial(doc){
  const el = document.getElementById('officialList')
  if(!el) return
  const by = (doc && doc.by_person && doc.by_person[id]) || { count: 0, items: [], gap: null }
  const gap = by.gap && by.gap.has_official_site === false
    ? `<li class="muted" data-official-gap="1">${escapeHtml(by.gap.note || '無官網')}（已查證無符合條件的公開官網，故本區無資料）</li>` : ''
  const rows = (by.items || []).map(it => itemHTML({ ...it, summary: it.summary || '' }).replace('<span class="badge">本人／陣營</span>', '<span class="badge">本人發言（官網）</span>')).join('')
  el.innerHTML = gap + (rows || (gap ? '' : '<li class="muted">本輪官網沒有符合條件（含全名、日期、正文）的文章頁</li>'));
  const t = document.getElementById('officialTitle')
  if(t) t.textContent = `本人發言（官網）${by.count ? `（${by.count} 則）` : ''}`;
}
loadJSON('/data/manifest.json')
  .then(m => loadJSON('/data/official.json', { hash: m && m.files && m.files['official.json'] && m.files['official.json'].sha256 }))
  .then(renderOfficial).catch(()=>renderOfficial(null))


function renderIdentity(stats){
  const st = PERSON_STYLE[id] || { color:'#5C564F', soft:'#E8E2D9' }
  const ps = stats?.by_person?.[id]
  $('personName').textContent = person.name
  $('personRole').textContent = [person.role, person.party].filter(Boolean).join(' · ')
  document.title = `${person.name}｜新竹選情觀察`
  $('pBanner').style.setProperty('--pc', st.color)
  $('pBanner').style.setProperty('--ps', st.soft)
  const updated = stats?.generated_at
    ? `資料更新 <time datetime="${escapeHtml(stats.generated_at)}">${fmtTW(stats.generated_at)}</time>（台北）`
    : '資料載入中…'
  const kpis = ps ? `<div class="kpis kpis-in">${kpiTileHTML('doc', ps.total || 0, '總則數')}${kpiTileHTML('calendar', ps.last_7d || 0, '近 7 日')}${kpiTileHTML('clock', ps.last_24h || 0, '近 24 小時')}</div>` : ''
  $('pBanner').innerHTML = `<div class="person-identity">
    ${avatarHTML({ id, name: person.name }, 'xl')}
    <div class="pb-info"><p class="person-label">人物檔案</p><h2>${escapeHtml(person.name)}</h2>
    <p class="person-role">${escapeHtml(person.role || '')}</p><span class="badge party">${escapeHtml(person.party || '')}</span></div>
    ${photoCreditHTML(id)}
    </div>${kpis}<p class="person-updated muted">${updated}</p>`
}

function renderVolume(stats, person){
  $('pVolume').innerHTML = volumePanelHTML({ ...stats, persons: [person] }, [{ id, name: person.name }], range).replace('三人共用同一縱軸', '本頁縱軸依此人物自動縮放，與其他人物比較請看比較頁')
}

function renderViz(stats, person){
  const ps = stats.by_person[id] || {}
  const st = PERSON_STYLE[id] || { color:'#5C564F', soft:'#E8E2D9' }
  renderVolume(stats, person)
  const sp = sentParts(ps.sentiment), pp = platParts(ps.platforms)
  const tot = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0)
  $('pSent').innerHTML = '<details class="tone-review"><summary>自動語氣分類（非候選人評分）</summary>' + donutBlock('報導語氣分布', 'layers', sp, tot(ps.sentiment)) + '<p class="muted fine">既有自動標籤未在本輪逐筆重判；不是民意樣本、支持度或查核結論。請讀原文並對照多面向資料。</p></details>'
  $('pMix').innerHTML = donutBlock('來源類型組成', 'news', pp, tot(ps.platforms))
  const rows = outletRows(stats.outlet_distribution?.by_person?.[id]?.outlets)
  $('pOutlet').innerHTML = `<h3>${icon('website')} 主要媒體來源</h3>` + (rows.length ? hbarsHTML(rows.slice(0, 8), { color: st.color }) + `<p class="muted fine">共 ${rows.length} 個來源名稱。</p>` : '<p class="muted">尚無</p>')
  const tc = {}
  for (const [t, row] of Object.entries(stats.topic_compare || {})) if ((row[id] || 0) > 0) tc[t] = row
  const trows = Object.entries(tc).map(([t, r]) => ({ label: t, value: r[id] })).sort((a, b) => b.value - a.value).slice(0, 9)
  $('pTopic').innerHTML = `<h3>${icon('layers')} 議題分布</h3>` + (trows.length ? hbarsHTML(trows, { color: st.color }) : '<p class="muted">尚無</p>')
  $('pComment').innerHTML = commentPanelHTML({ ...stats, persons: [person] }, [{ id, name: person.name }])
}
document.getElementById('pVolume').addEventListener('click', e => {
  const b = e.target.closest('button[data-range]')
  if (!b || !lastStats) return
  range = Number(b.dataset.range)
  renderVolume(lastStats, person)
  $('pVolume').querySelector('button[aria-pressed="true"]')?.focus()
})

loadKeywords().then(kw => {
  const box = document.getElementById('kwCloud')
  if (!box || !kw) return
  box.innerHTML = keywordCloudHTML(kw, { personId: id })
}).catch(() => {})
