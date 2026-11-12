import { filter, node, observationList, personOptions, sourceLink } from './lib/observations.js'

const labels = { pos: '正面', neg: '負面', mixed: '正負並陳' }
const panel = document.getElementById('watch-comments')

void observationList(panel, 'comments.json', ({ people, threads, entries }) => {
  const person = filter('人物', '全部人物', personOptions(people))
  const direction = filter('方向', '全部方向', Object.entries(labels))
  const platforms = new Set(Object.values(threads).map(thread => thread.platform))
  const origin = filter('來源', '全部來源', [...platforms].map(name => [name, name]))
  return {
    filters: [person, direction, origin],
    matching: () => entries.filter(entry =>
      (!person.control.value || person.control.value === entry.personId) &&
      (!direction.control.value || direction.control.value === entry.kind) &&
      (!origin.control.value || origin.control.value === threads[entry.thread].platform)),
    count(rows) {
      if (!rows.length) return '這個篩選範圍暫無已核對留言。'
      const messages = new Set(rows.map(row => row.commentId)).size
      return `符合 ${messages} 則留言，涉及 ${rows.length} 筆人物觀點。`
    },
    render(entry) {
      const thread = threads[entry.thread]
      const row = node('li')
      const heading = node('div', 'observation-byline')
      heading.append(node('strong', null, people[entry.personId].name), node('span', 'badge ' + entry.kind, labels[entry.kind]))
      const time = node('time', null, entry.at.slice(0, 16).replace('T', ' '))
      time.dateTime = entry.at
      const meta = node('p', 'when observation-meta')
      meta.append(time, node('span', null, [thread.platform, entry.locator].filter(Boolean).join(' · ')),
        sourceLink(thread.url, thread.platform === 'Dcard' ? '開啟原留言' : '開啟原串'))
      row.append(heading, node('p', 'observation-text', entry.summary), meta)
      return row
    },
  }
})
