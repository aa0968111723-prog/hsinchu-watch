import { loadJSON, safeHref } from './data.js'

export function node(tag, className, content) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (content !== undefined) element.textContent = content
  return element
}

export function sourceLink(url, label) {
  const href = safeHref(url)
  if (!href) return node('span', null, label)
  const anchor = node('a', null, label)
  anchor.href = href
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  return anchor
}

export function personOptions(people) {
  return Object.entries(people).map(([id, profile]) => [
    id, profile.status ? `${profile.name}（${profile.status}）` : profile.name,
  ])
}

export function filter(label, empty, options) {
  const control = node(options ? 'select' : 'input')
  if (options) {
    control.append(new Option(empty, ''))
    for (const [value, text] of options) control.append(new Option(text, value))
  } else {
    control.type = 'search'
    control.enterKeyHint = 'search'
  }
  const field = node('label', null, label)
  field.append(control)
  return { field, control }
}

export async function observationList(panel, filename, configure) {
  const status = panel.querySelector('[role="status"]')
  const list = panel.querySelector('ul')
  const controls = panel.querySelector('.filters')
  const more = panel.querySelector('button')
  list.setAttribute('aria-busy', 'true')
  try {
    const data = await loadJSON('/observations/' + filename)
    const { filters, matching, render, count } = configure(data)
    const pageSize = 12
    let limit = pageSize
    const reset = node('button', 'observation-reset', '清除篩選')
    reset.type = 'button'
    status.after(reset)
    function draw(offset = 0) {
      const entries = matching()
      status.textContent = count(entries)
      const rows = entries.slice(offset, limit).map(render)
      if (offset) list.append(...rows)
      else list.replaceChildren(...rows)
      more.hidden = entries.length <= limit
      reset.hidden = !filters.some(({ control }) => control.value)
      return rows
    }
    for (const { field, control } of filters) {
      controls.append(field)
      control.addEventListener(control.type === 'search' ? 'input' : 'change', () => {
        limit = pageSize
        draw()
      })
    }
    reset.addEventListener('click', () => {
      for (const { control } of filters) control.value = ''
      limit = pageSize
      draw()
      filters[0]?.control.focus()
    })
    more.addEventListener('click', () => {
      const offset = limit
      limit += pageSize
      const [first] = draw(offset)
      first?.querySelector('a')?.focus()
    })
    controls.hidden = false
    draw()
  } catch {
    status.textContent = '資料暫時無法載入。'
  } finally {
    list.setAttribute('aria-busy', 'false')
  }
  if (location.hash === '#' + panel.id) panel.scrollIntoView({ block: 'start' })
}
