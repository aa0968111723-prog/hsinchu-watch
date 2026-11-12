/**
 * Footer source-status helpers (010-footer).
 * Prefer stats.source_status written at finalize from published items/polls.
 * Optional computeSourceStatus() mirrors scripts/source_status.py for tests / fallback.
 */

const ICONS = {
  active: '✓',
  empty: '○',
  error: '!',
  disabled: '–',
  disabled_carry: '◉',
  skipped: '–',
  pending: '?',
}

function countPlatform(items, platform) {
  return (items || []).filter((i) => i && i.platform === platform).length
}

function latestPlatform(items, platform) {
  const times = (items || [])
    .filter((i) => i && i.platform === platform)
    .map((i) => i.collected_at || i.published_at)
    .filter(Boolean)
  return times.length ? times.sort().at(-1) : null
}

function feedOk(stats, key) {
  const feeds = (((stats || {}).source_stats || {}).cna || {}).feeds || {}
  return Number(feeds[key] || 0)
}

/** Mirror of scripts/source_status.py — counts from args only. */
export function computeSourceStatus(items, polls, stats) {
  const ss = (stats && stats.source_stats) || {}
  const rows = []
  const add = (row) => rows.push(row)

  for (const [id, label, feedKey] of [
    ['cna_atom', '中央社 Atom', 'cna_atom'],
    ['udn_opinion', '聯合新聞網·意見 RSS', 'udn_opinion'],
    ['mirrormedia', '鏡週刊 RSS', 'mirrormedia'],
  ]) {
    let nItems = 0
    if (id === 'cna_atom') {
      nItems = (items || []).filter(
        (i) =>
          String(i.source_name || '').includes('中央社') ||
          String(i.url || '').includes('cna.com.tw'),
      ).length
    }
    const feedN = feedOk(stats, feedKey)
    const empty = nItems === 0 && feedN === 0
    add({
      id,
      label,
      group: 'active_collectors',
      status: empty ? 'empty' : 'active',
      status_text: empty ? '目前 0 篇，暫停顯示' : `目前 ${nItems || feedN} 篇`,
      count: nItems,
      last_updated: null,
      reason: empty ? `feeds.${feedKey}=0 且發布 items 無對應列` : null,
    })
  }

  function pttBoard(board) {
    const needleSrc = `PTT ${board}`
    const needleUrl = `/bbs/${board}/`
    return (items || []).filter((i) => {
      if (i.platform !== 'ptt') return false
      const src = String(i.source_name || '')
      const url = String(i.url || '')
      const b = String(i.board || '')
      return src === needleSrc || url.includes(needleUrl) || b === board
    })
  }
  for (const [board, label, sid] of [
    ['Hsinchu', 'PTT 新竹板', 'ptt_hsinchu'],
    ['Gossiping', 'PTT 八卦板', 'ptt_gossiping'],
  ]) {
    const rows = pttBoard(board)
    const n = rows.length
    const times = rows
      .map((i) => i.collected_at || i.published_at)
      .filter(Boolean)
    add({
      id: sid,
      label,
      group: 'active_collectors',
      status: n ? 'active' : 'empty',
      status_text: n ? `目前 ${n} 篇` : '目前 0 篇，暫停顯示',
      count: n,
      last_updated: times.length ? times.reduce((a, b) => (a > b ? a : b)) : null,
      reason: null,
    })
  }

  const ly = ss.ly || {}
  const lyN = countPlatform(items, 'ly')
  if (ly.error || lyN === 0) {
    add({
      id: 'ly',
      label: '立法院開放資料',
      group: 'active_collectors',
      status: ly.error ? 'error' : 'empty',
      status_text: '目前 0 篇，暫停顯示',
      count: lyN,
      last_updated: null,
      reason: ly.error || '發布 items 無 ly 列',
    })
  } else {
    add({
      id: 'ly',
      label: '立法院開放資料',
      group: 'active_collectors',
      status: 'active',
      status_text: `目前 ${lyN} 篇`,
      count: lyN,
      last_updated: latestPlatform(items, 'ly'),
      reason: null,
    })
  }

  const webN = countPlatform(items, 'website')
  add({
    id: 'websites',
    label: '候選人官網',
    group: 'active_collectors',
    status: webN === 0 ? 'empty' : 'active',
    status_text: webN === 0 ? '暫無文章頁（待 sitemap）' : `目前 ${webN} 篇`,
    count: webN,
    last_updated: latestPlatform(items, 'website'),
    reason: webN === 0 ? '發布 items 中 platform=website 為 0；待 sitemap 收文章頁' : null,
  })

  const councilN = countPlatform(items, 'council')
  add({
    id: 'council',
    label: '新竹縣議會／縣府公開頁',
    group: 'active_collectors',
    status: councilN ? 'active' : 'empty',
    status_text: councilN ? `目前 ${councilN} 篇` : '目前 0 篇，暫停顯示',
    count: councilN,
    last_updated: latestPlatform(items, 'council'),
    reason: null,
  })

  const gn = (items || []).filter((i) => i.source_name === 'Google News').length
  add({
    id: 'google_news',
    label: 'Google News（已停止新抓取）',
    group: 'history',
    status: 'disabled_carry',
    status_text: `歷史保留 ${gn} 篇；新抓取已停`,
    count: gn,
    last_updated: latestPlatform(items, 'news'),
    reason: (ss.google_news && ss.google_news.disabled) || 'robots.txt',
  })

  const verified = (polls || []).filter((p) => p && p.verified)
  const verifiedGroups = verified.length
  const verifiedReports = verified.reduce((s, p) => s + Number(p.report_count || 1), 0)
  add({
    id: 'polls',
    label: '民調（核可數字）',
    group: 'history',
    status: verifiedReports ? 'active' : 'empty',
    status_text: verifiedReports
      ? `核可數字 ${verifiedReports} 則（合併顯示 ${verifiedGroups} 組）；polls 列表共 ${(polls || []).length} 筆`
      : '目前 0 篇，暫停顯示',
    count: (polls || []).length,
    verified_figure_reports: verifiedReports,
    verified_groups: verifiedGroups,
    last_updated: null,
    reason: (ss.polls && ss.polls.disabled) || null,
  })

  const comN = countPlatform(items, 'commentary')
  add({
    id: 'commentary',
    label: '媒體評論（歷史保留）',
    group: 'history',
    status: 'disabled_carry',
    status_text: `歷史保留 ${comN} 篇；新抓取已停`,
    count: comN,
    last_updated: latestPlatform(items, 'commentary'),
    reason: (ss.commentary && ss.commentary.disabled) || 'robots.txt',
  })

  add({
    id: 'youtube',
    label: 'YouTube',
    group: 'history',
    status: 'disabled',
    status_text: '目前 0 篇，未啟用',
    count: countPlatform(items, 'youtube'),
    last_updated: null,
    reason: (ss.youtube && ss.youtube.disabled) || '未啟用',
  })

  const xm = ss.x_mentions || {}
  add({
    id: 'x_mentions',
    label: 'X 提及',
    group: 'history',
    status: xm.skipped ? 'skipped' : 'disabled',
    status_text: '目前 0 篇，未啟用',
    count: countPlatform(items, 'x'),
    last_updated: null,
    reason: xm.reason || xm.disabled || '未啟用',
  })

  return rows
}

export function renderSourceStatusHTML(rows, escapeHtml) {
  const esc = escapeHtml || ((s) => String(s))
  const active = (rows || []).filter((r) => r.group === 'active_collectors')
  const history = (rows || []).filter((r) => r.group !== 'active_collectors')
  const renderList = (list) =>
    `<ul class="source-status-list">${list
      .map((r) => {
        const st = r.status || 'pending'
        const icon = ICONS[st] || '?'
        return `<li class="source-status-item" data-source-id="${esc(r.id || '')}">` +
          `<span class="source-status-name">${esc(r.label || '')}</span> ` +
          `<span class="source-status-pill source-status-${esc(st)}">` +
          `<span class="source-status-icon" aria-hidden="true">${icon}</span>` +
          `<span class="source-status-text">${esc(r.status_text || '狀態待確認')}</span></span>` +
          (r.reason ? `<div class="source-status-reason">${esc(r.reason)}</div>` : '') +
          `</li>`
      })
      .join('')}</ul>`
  return (
    `<div class="source-status-block">` +
    `<p class="source-status-heading">目前抓取來源狀態</p>${renderList(active)}` +
    `<p class="source-status-heading">停用／歷史保留／核可民調</p>${renderList(history)}` +
    `<p class="source-status-note">來源狀態依已發布資料計算（finalize 寫入 stats.source_status）；不以 raw data/ 未過篩列數為準。</p>` +
    `</div>`
  )
}
