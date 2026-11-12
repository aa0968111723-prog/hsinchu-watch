/**
 * 渲染層剔除留言者帳號／個資欄位；保留來源欄位。
 */

export const ACCOUNT_FIELDS = Object.freeze([
  'author', 'author_name', 'author_id',
  'username', 'user_name', 'user_id',
  'account', 'account_name', 'account_id',
  'handle', 'screen_name', 'display_name',
  'avatar', 'avatar_url', 'profile_url', 'profile_image',
  'user', 'poster', 'poster_name',
  'commenter', 'commenter_name', 'commenter_id',
]);

/** 來源相關欄位：sanitize 絕不可刪 */
export const SOURCE_FIELDS = Object.freeze([
  'source_name', 'source_url', 'url', 'title', 'id',
]);

const ACCOUNT_SET = new Set(ACCOUNT_FIELDS);

function scrubObject(obj, depth) {
  if (obj == null || typeof obj !== 'object' || depth > 6) return obj;
  if (Array.isArray(obj)) return obj.map((x) => scrubObject(x, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (ACCOUNT_SET.has(k)) continue;
    if (k === 'from' || k === 'owner') continue;
    out[k] = scrubObject(v, depth + 1);
  }
  return out;
}

export function sanitizeItem(item) {
  if (!item || typeof item !== 'object') return item;
  const out = scrubObject(item, 0);
  // 顯式保住來源（即便被誤刪也能從原物件回填）
  if (item.source_name != null) out.source_name = item.source_name;
  if (item.url != null) out.url = item.url;
  if (item.source_url != null) out.source_url = item.source_url;
  return out;
}

export function sanitizeItems(items) {
  return (items || []).map(sanitizeItem);
}

/** 正規化來源：主線欄位為 url；source_url 為別名。 */
export function normalizeSource(item) {
  if (!item || typeof item !== 'object') return item;
  const out = { ...item };
  const href = String(out.source_url || out.url || '').trim();
  const name = String(out.source_name || '').trim();
  out.source_name = name;
  out.url = String(out.url || href).trim();
  out.source_url = href || out.url;
  return out;
}

/**
 * 缺 source_name 或可點連結 → 剔除（exclude），並回傳稽核清單。
 * @returns {{ kept: object[], excluded: object[] }}
 */
export function filterItemsWithSource(items, { mark = false } = {}) {
  const kept = [];
  const excluded = [];
  for (const raw of items || []) {
    const it = normalizeSource(sanitizeItem(raw));
    const okName = Boolean(it.source_name);
    const okUrl = isSafeHttpUrl(it.source_url || it.url);
    if (okName && okUrl) {
      kept.push(it);
    } else if (mark) {
      kept.push({ ...it, _missing_source: true });
      excluded.push({ id: it.id, reason: !okName ? 'no_source_name' : 'no_safe_url', title: it.title });
    } else {
      excluded.push({ id: it.id, reason: !okName ? 'no_source_name' : 'no_safe_url', title: it.title });
    }
  }
  return { kept, excluded };
}

/** 只允許 http／https */
export function isSafeHttpUrl(u) {
  if (!u || typeof u !== 'string') return false;
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch {
    return false;
  }
}
