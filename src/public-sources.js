import { filter, node, observationList, personOptions, sourceLink } from './lib/observations.js'

const panel = document.getElementById('watch-sources')
const normal = text => text.trim().normalize('NFKC').toLowerCase()

function loadSources() {
  void observationList(panel, 'sources.json', ({ people, entries }) => {
    const person = filter('人物', '全部人物', personOptions(people))
    const search = filter('找文章或來源')
    return {
      filters: [person, search],
      matching() {
        const query = normal(search.control.value)
        return entries.filter(entry =>
          (!person.control.value || entry.personIds.includes(person.control.value)) &&
          (!query || normal(entry.title + ' ' + entry.source).includes(query)))
      },
      count: rows => `符合 ${rows.length} 筆，索引共 ${entries.length} 筆。`,
      render(entry) {
        const row = node('li')
        const when = node('time', null, entry.date)
        when.dateTime = entry.date
        const metadata = node('p', 'when observation-meta')
        metadata.append(when, node('span', null, entry.source))
        const names = node('p', 'when', entry.personIds.map(id => people[id].name).join('、'))
        row.append(
          metadata,
          sourceLink(entry.url, entry.title),
          names,
        )
        return row
      },
    }
  })
}

function openFromHash() {
  if (location.hash === '#watch-sources') panel.open = true
}
window.addEventListener('hashchange', openFromHash)
openFromHash()
if (panel.open) loadSources()
else {
  panel.addEventListener('toggle', function openOnce() {
    if (!panel.open) return
    panel.removeEventListener('toggle', openOnce)
    loadSources()
  })
}
