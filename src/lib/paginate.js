/** 列表分頁：先顯示 pageSize，之後每次 +pageSize */
export function paginate(rows, visibleCount, pageSize = 30) {
  const list = Array.isArray(rows) ? rows : []
  const vis = Math.max(0, Number(visibleCount) || 0)
  const size = Math.max(1, Number(pageSize) || 30)
  const shown = list.slice(0, vis)
  const hasMore = list.length > vis
  return {
    shown,
    total: list.length,
    hasMore,
    nextCount: vis + size,
    remain: Math.max(0, list.length - vis),
  }
}
