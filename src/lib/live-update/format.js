/**
 * 時間與狀態文案（Asia/Taipei 顯示）、退避與抖動。
 */

const TZ = 'Asia/Taipei';

export function formatClock(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date).replace(/\//g, '-');
  } catch {
    return date.toISOString();
  }
}

/** 「最後更新 X 分鐘前」；未滿 1 分顯示「剛剛」。 */
export function formatAge(lastUpdatedAt, now = Date.now()) {
  if (lastUpdatedAt == null) return '尚未更新';
  const ms = Math.max(0, now - Number(lastUpdatedAt));
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return '最後更新：剛剛';
  const min = Math.floor(sec / 60);
  if (min < 60) return `最後更新：${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `最後更新：${hr} 小時前`;
  const day = Math.floor(hr / 24);
  return `最後更新：${day} 天前`;
}

/**
 * 指數退避：base * 2^failCount，上限 max。
 * PERF_BUDGET：2→4→8…≤30m；jitterRatio 預設 ±20%。
 * @param {number} failCount 已失敗次數（從 0 起算第一次失敗）
 * @param {number} baseMs 預設 2 分鐘
 * @param {number} maxMs 預設 30 分鐘
 * @param {number} [jitterRatio=0.2]
 * @param {() => number} [rand=Math.random] 回傳 [0,1)
 */
export function nextBackoffMs(
  failCount,
  baseMs = 2 * 60 * 1000,
  maxMs = 30 * 60 * 1000,
  jitterRatio = 0.2,
  rand = Math.random,
) {
  const n = Math.max(0, failCount | 0);
  const raw = Math.min(maxMs, baseMs * Math.pow(2, n));
  if (!jitterRatio) return raw;
  const j = 1 + (rand() * 2 - 1) * jitterRatio;
  return Math.max(0, Math.round(raw * j));
}

/** 正常輪詢間隔加上 ±jitter。 */
export function withJitter(intervalMs, jitterRatio = 0.2, rand = Math.random) {
  if (!jitterRatio) return intervalMs;
  const j = 1 + (rand() * 2 - 1) * jitterRatio;
  return Math.max(0, Math.round(intervalMs * j));
}

/** 解析 ISO／毫秒時間戳；失敗回 null。 */
export function parseTimeMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
}

export function isNewBadgeActive(item, now = Date.now(), newBadgeMs = 24 * 60 * 60 * 1000) {
  if (!item) return false;
  if (item._viewed) return false;
  const raw = item.published_at || item.collected_at || item._arrivedAt;
  if (!raw) return Boolean(item._isNew);
  const t = typeof raw === 'number' ? raw : Date.parse(raw);
  if (Number.isNaN(t)) return Boolean(item._isNew);
  return now - t <= newBadgeMs;
}
