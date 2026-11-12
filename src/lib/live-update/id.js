/**
 * 項目識別與去重鍵。
 * 有 id 用 id；否則用穩定欄位雜湊（person_id|url|published_at|title）。
 */

/** 簡單穩定字串雜湊（FNV-1a 32-bit → hex），不依賴 crypto，瀏覽器／Node 皆可。 */
export function stableHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 產生項目唯一鍵。 */
export function itemKey(item) {
  if (!item || typeof item !== 'object') return 'invalid';
  if (item.id != null && String(item.id).trim() !== '') {
    return `id:${String(item.id)}`;
  }
  const parts = [
    item.person_id ?? item.person ?? '',
    item.url ?? '',
    item.published_at ?? '',
    item.title ?? '',
    item.platform ?? '',
  ].map((x) => String(x));
  return `h:${stableHash(parts.join('|'))}`;
}

/** 以鍵去重，保留先出現者；回傳 { unique, byKey }。 */
export function dedupeItems(items) {
  const byKey = new Map();
  const unique = [];
  for (const it of items || []) {
    const k = itemKey(it);
    if (byKey.has(k)) continue;
    byKey.set(k, it);
    unique.push(it);
  }
  return { unique, byKey };
}

/**
 * 找出相對 knownKeys 的新項目（依陣列順序）。
 * @param {object[]} incoming
 * @param {Set<string>|Map} knownKeys
 */
export function findNewItems(incoming, knownKeys) {
  const known = knownKeys instanceof Set
    ? knownKeys
    : new Set(knownKeys instanceof Map ? knownKeys.keys() : knownKeys || []);
  const news = [];
  for (const it of incoming || []) {
    const k = itemKey(it);
    if (!known.has(k)) news.push(it);
  }
  return news;
}
