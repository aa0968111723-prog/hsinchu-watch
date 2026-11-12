import { escapeHtml } from './data.js'
import { coverageCount } from './coverage.js'

const format = new Intl.NumberFormat('zh-TW')
const depth = [8, -5]

// The tally rail and markers use the same fixed oblique projection.
function prism(x, y, width, height, ink) {
  const [dx, dy] = depth
  const edge = x + width
  const bottom = y + height
  return `<path fill="${ink.side}" d="M${edge} ${y}l${dx} ${dy}V${bottom + dy}l${-dx} ${-dy}Z"/>
    <rect class="${ink.className}" x="${x}" y="${y}" width="${width}" height="${height}" fill="${ink.front}"/>
    <path fill="${ink.top}" d="M${x} ${y}l${dx} ${dy}h${width}l${-dx} ${-dy}Z"/>
    <path d="M${x} ${y}H${edge}V${bottom}" fill="none" stroke="#fff9" stroke-width=".55"/>`
}

function tallyRail(left, right, baseline, centers) {
  const fasteners = [left + 5, right - 5].map(x =>
    `<circle cx="${x}" cy="${baseline + 6}" r="2" fill="#bca78c" stroke="#826b51" stroke-width=".6"/>
     <path d="M${x - 1} ${baseline + 6.4}l2 -.8" stroke="#594430" stroke-width=".7"/>`).join('')
  const sockets = centers.map(x =>
    `<path d="M${x - 17} ${baseline}h34l5 -3h-34Z" fill="#b5a694"/>
     <path d="M${x - 15} ${baseline + 1}h30v3h-30Z" fill="#827362"/>
     <path d="M${x - 13} ${baseline + 2}h26v1h-26Z" fill="#e0d2bd"/>`).join('')
  const feet = [left + 10, right - 17].map(x =>
    `${prism(x, baseline + 9, 12, 4, { front: '#685340', side: '#493b2e', top: '#a58b6c' })}
     <path d="M${x - 2} ${baseline + 14}h17" stroke="#77614a" stroke-width="1.2" opacity=".3"/>`).join('')
  const ruler = Array.from({ length: 31 }, (_, index) => {
    const x = left + 13 + index * (right - left - 26) / 30
    return `<path d="M${x} ${baseline + 5}v${index % 5 === 0 ? 3 : 1.5}" stroke="#91785b" stroke-width=".5"/>`
  }).join('')
  return `<path d="M${left + 5} ${baseline + 15}H${right + 4}l-5 3H${left - 2}Z" fill="#594837" opacity=".1"/>
    ${feet}
    ${prism(left, baseline, right - left, 9, { front: '#c6b7a2', top: '#e1d5c2', side: '#9b8976', className: 'pulse-rail' })}
    <path d="M${left} ${baseline + 1}H${right}" stroke="#f1e9dc" stroke-width="1"/>
    ${ruler}${sockets}${fasteners}`
}

export function pulseHTML(stats, people, period) {
  const rows = people.flatMap(person => {
    const value = coverageCount(stats, person.id, period)
    return value === null ? [] : [{ ...person, value }]
  })
  if (!rows.length) return '<p>這個時段暫無可用統計。</p>'

  const left = 38, right = 345, baseline = 139, plotHeight = 102
  const values = people.flatMap(person => ['last_24h', 'last_7d']
    .map(key => coverageCount(stats, person.id, key)).filter(value => value !== null))
  const maximum = Math.max(...values)
  const interval = maximum < 20 ? 1 : 5
  const step = Math.max(1, Math.ceil(maximum / (4 * interval)) * interval)
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = baseline - plotHeight * index / 4
    return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" />
      <text class="pulse-scale" x="${left - 6}" y="${y + 3.5}" text-anchor="end">${format.format(index * step)}</text>`
  }).join('')
  const ticks = Array.from({ length: 21 }, (_, index) => {
    const y = baseline - plotHeight * index / 20
    const length = index % 5 === 0 ? 5 : 2.4
    return `<path d="M${left - length} ${y}H${left}" />`
  }).join('')
  const centers = rows.map((_, index) => left + (index + .5) * (right - left) / rows.length)
  const columns = rows.map(({ name, value }, index) => {
    const center = centers[index]
    const x = center - 13
    const y = baseline - plotHeight * value / (4 * step)
    const geometry = value > 0
      ? prism(x, y, 26, baseline - y, { front: '#7b5941', top: '#c1a07c', side: '#493728', className: 'pulse-bar' })
      : `<path d="M${x} ${baseline}h26" stroke="#675b4e" stroke-width="1.5"/>`
    return `${geometry}
      <text class="pulse-value" x="${center}" y="${y - 10}" text-anchor="middle">${format.format(value)}</text>
      <text class="pulse-name" x="${center}" y="171" text-anchor="middle">${escapeHtml(name)}</text>`
  }).join('')
  const accessible = `${period === 'last_7d' ? '近 7 日' : '近 24 小時'}，${rows.map(row => `${row.name} ${format.format(row.value)} 件`).join('、')}`
  const tableRows = rows.map(row => `<tr><th scope="row">${escapeHtml(row.name)}</th>${['last_24h', 'last_7d'].map(key => {
    const count = coverageCount(stats, row.id, key)
    return `<td>${count === null ? '未提供' : format.format(count)}</td>`
  }).join('')}</tr>`).join('')
  return `<svg class="pulse-chart" viewBox="0 0 362 180" role="img" aria-label="${escapeHtml(accessible)}">
    <text class="pulse-scale" x="${left - 8}" y="13" text-anchor="end">件</text>
    <path d="M${left - 3} ${baseline + 1}V${baseline - plotHeight - 2}" stroke="#e2d7c5" stroke-width="6"/>
    <g class="pulse-grid" aria-hidden="true">${grid}<path d="M${left} ${baseline}V${baseline - plotHeight}"/>${ticks}</g>
    <g aria-hidden="true">${tallyRail(left, right, baseline, centers)}</g>
    <g aria-hidden="true">${columns}</g>
  </svg><div class="pulse-numbers" id="pulseNumbers" hidden><table>
    <caption>人物收錄件數，同一資料快照；各人物可能收錄同一篇原文。</caption>
    <thead><tr><th scope="col">人物</th><th scope="col">24 小時</th><th scope="col">近 7 日</th></tr></thead>
    <tbody>${tableRows}</tbody></table></div>`
}
