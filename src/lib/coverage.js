const timeOptions = {
  timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}
const timeFormat = new Intl.DateTimeFormat('zh-TW', { ...timeOptions, year: 'numeric' })
const shortTimeFormat = new Intl.DateTimeFormat('zh-TW', timeOptions)

export function coverageCount(stats, personId, period) {
  const count = stats?.by_person?.[personId]?.[period]
  return Number.isInteger(count) && count >= 0 ? count : null
}

export function coverageTime(stats) {
  const date = Date.parse(stats?.generated_at)
  return Number.isFinite(date) ? timeFormat.format(date) : ''
}

export function shortCoverageTime(value) {
  const date = Date.parse(value)
  return Number.isFinite(date) ? shortTimeFormat.format(date) : ''
}
