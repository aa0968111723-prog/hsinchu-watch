import { startLiveReload, footerHTML, itemHTML } from './lib/data.js'
import './lib/mobile-nav.js'
import { installImageFallback } from './lib/charts.js'
import { keywordCloudHTML, loadKeywords } from './lib/keywords-ui.js'
installImageFallback()

let all = null
let kwPayload = null
const pageSize = 12
const personFilter = document.getElementById('personFilter')
const more = document.getElementById('opinionMore')
let limit = pageSize

function render() {
  if (!all) return
  const v = personFilter.value
  const rows = all.filter(i => !v || i.person_id === v)
  const visible = rows.slice(0, limit)
  document.getElementById('opinionCount').textContent = rows.length
    ? `顯示 ${visible.length} 則，共 ${rows.length} 則媒體評論。`
    : '這個篩選範圍暫無媒體評論。'
  document.getElementById('list').innerHTML = rows.length
    ? visible.map(i => itemHTML(i, { showPerson: true })).join('')
    : ''
  more.hidden = visible.length >= rows.length
  const cloud = document.getElementById('kwCloud')
  if (cloud && kwPayload) cloud.innerHTML = keywordCloudHTML(kwPayload, { personId: v || '', limit: 12, open: false })
}
personFilter.addEventListener('change', () => { limit = pageSize; render() })
more.addEventListener('click', () => { limit += pageSize; render() })

loadKeywords().then(kw => { kwPayload = kw; render() }).catch(() => {})

startLiveReload({
  onData({ items, stats }){
    if (!stats) return
    all = items.filter(i => i.type === 'commentary' || i.platform === 'commentary')
    render()
    document.getElementById('footer').innerHTML = footerHTML(stats)
  }
})
