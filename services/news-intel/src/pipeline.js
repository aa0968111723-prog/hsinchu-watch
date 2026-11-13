export const MAX_ARTICLES = 20;

const TOWNS = [
  ["新竹市", "hsinchu-city"],
  ["東區", "hsinchu-city-east"],
  ["北區", "hsinchu-city-north"],
  ["香山", "hsinchu-city-xiangshan"],
  ["新竹縣", "hsinchu-county"],
  ["竹北", "zhubei"],
  ["竹東", "zhudong"],
  ["湖口", "hukou"],
  ["新豐", "xinfeng"],
  ["新埔", "xinpu"],
  ["關西", "guanxi"],
  ["芎林", "qionglin"],
  ["寶山", "baoshan"],
  ["北埔", "beipu"],
  ["峨眉", "emei"],
  ["橫山", "hengshan"],
  ["尖石", "jianshi"],
  ["五峰", "wufeng"],
];

export function regionFor(text) {
  const hits = TOWNS.filter(([name]) => String(text || "").includes(name)).map(([, id]) => id);
  return hits[0] || null;
}

export function normalizeTitle(title) {
  return String(title || "").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

export function selectArticles(candidates) {
  const seen = new Set();
  const selected = [];
  for (const item of candidates || []) {
    const url = String(item?.source_url || "");
    const title = String(item?.original_title || "").trim();
    if (!url.startsWith("https://") || !title || !item?.publisher_timestamp) continue;
    if (!regionFor(`${title} ${item.summary || ""}`)) continue;
    const key = normalizeTitle(title);
    if (seen.has(url) || seen.has(key)) continue;
    seen.add(url);
    seen.add(key);
    selected.push({
      ...item,
      original_title: title,
      source_url: url,
      region_id: regionFor(`${title} ${item.summary || ""}`),
      verification_status: item.verification_status || "SINGLE_SOURCE",
      review_status: "pending_index",
    });
    if (selected.length >= MAX_ARTICLES) break;
  }
  return selected;
}

export function linkEvents(articles) {
  const events = new Map();
  for (const article of articles) {
    const key = normalizeTitle(article.original_title).slice(0, 24);
    if (!events.has(key)) {
      events.set(key, { id: `evt-${key.slice(0, 12) || "item"}`, title: article.original_title, article_ids: [] });
    }
    events.get(key).article_ids.push(article.source_url);
  }
  return [...events.values()];
}

export const COST_POLICY = {
  gemini_requests_per_hour_cap: 4,
  daily_token_cap: 200000,
  on_quota_exceeded: "free_sources_only",
  note: "估算上限，不是帳單。沒有 GEMINI_API_KEY 時不呼叫 Gemini。",
};

export function decideGemini(env, usage) {
  if (!env?.GEMINI_API_KEY) return { use: false, reason: "missing_gemini_key" };
  if ((usage?.tokens_today || 0) >= COST_POLICY.daily_token_cap) return { use: false, reason: "daily_token_cap" };
  if ((usage?.requests_this_hour || 0) >= COST_POLICY.gemini_requests_per_hour_cap) return { use: false, reason: "hourly_request_cap" };
  return { use: true, reason: "within_cap" };
}
