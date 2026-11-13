import { allowedUrl } from "./allowlist.js";
import { parsePublisherTimestamp, publicationFields } from "./verify.js";

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

const COUNTY_TOWNS = new Set(["zhubei", "zhudong", "hukou", "xinfeng", "xinpu", "guanxi", "qionglin", "baoshan", "beipu", "emei", "hengshan", "jianshi", "wufeng"]);

export function regionGroup(id) {
  const text = String(id || "");
  if (text.startsWith("hsinchu-city")) return "hsinchu-city";
  if (text.startsWith("hsinchu-county") || COUNTY_TOWNS.has(text)) return "hsinchu-county";
  return "";
}

const BROAD_PLACES = [
  ["新竹市", "hsinchu-city"],
  ["新竹縣", "hsinchu-county"],
  ["竹市", "hsinchu-city"],
  ["竹縣", "hsinchu-county"],
];
const BROAD_NAMES = new Set(BROAD_PLACES.map(([name]) => name));

function matchPlace(text, broadOnly = false) {
  const source = String(text || "");
  const names = broadOnly ? BROAD_PLACES : [...TOWNS, ...BROAD_PLACES];
  const hits = names.filter(([name]) => source.includes(name));
  const specific = hits.filter(([name]) => !BROAD_NAMES.has(name));
  const pool = specific.length ? specific : hits;
  if (!pool.length) return null;
  pool.sort((left, right) => source.indexOf(left[0]) - source.indexOf(right[0]));
  return pool[0][1];
}

export function regionFor(title, summary = "") {
  return matchPlace(title) || matchPlace(summary, true);
}

const PLACE_LABELS = Object.fromEntries(TOWNS.map(([name, id]) => [id, name === "新竹市" || name === "新竹縣" ? name : `${name.startsWith("新竹") ? "" : regionGroup(id) === "hsinchu-city" ? "新竹市" : "新竹縣"}${name}`]));

export function placeLabel(id) {
  return PLACE_LABELS[id] || (regionGroup(id) === "hsinchu-city" ? "新竹市" : regionGroup(id) === "hsinchu-county" ? "新竹縣" : "地區未標");
}

export function normalizeTitle(title) {
  return String(title || "").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

const OFFICIAL_HSINCHU = new Set(["hsinchu-county-news", "hsinchu-city-news", "hsinchu-county-council"]);

export function selectArticles(candidates, hidden = new Set()) {
  const seen = new Set();
  const selected = [];
  const ranked = [...(candidates || [])].sort((left, right) => {
    const leftTime = parsePublisherTimestamp(left?.publisher_timestamp) || "";
    const rightTime = parsePublisherTimestamp(right?.publisher_timestamp) || "";
    return rightTime.localeCompare(leftTime);
  });
  for (const item of ranked) {
    const url = String(item?.source_url || "");
    const title = String(item?.original_title || "").trim();
    const published = parsePublisherTimestamp(item?.publisher_timestamp);
    if (!allowedUrl(url) || !title || !published || hidden.has(url) || item.source_id === "hsinchu-county-council" || item.source_id === "hsc-expenditure-final") continue;
    const fallback = item.source_id === "hsinchu-city-news" ? "hsinchu-city" : "hsinchu-county";
    const region = regionFor(title, item.summary || "") || (OFFICIAL_HSINCHU.has(item.source_id) ? (item.region_id || fallback) : null);
    if (!region) continue;
    const key = normalizeTitle(title);
    if (seen.has(url)) continue;
    if (seen.has(key)) {
      const kept = selected.find((article) => normalizeTitle(article.original_title) === key);
      if (kept && !(kept.related_urls || []).includes(url)) kept.related_urls = [...(kept.related_urls || []), url];
      continue;
    }
    if (selected.length >= MAX_ARTICLES) continue;
    seen.add(url);
    seen.add(key);
    selected.push({
      ...item,
      original_title: title,
      source_url: url,
      region_id: region,
      publisher_timestamp: published,
      review_status: "pending_index",
      related_urls: [],
    });
  }
  return selected;
}

export function chooseBackups(names, keep = 24) {
  const sorted = [...names].filter((name) => name.startsWith("latest-") && name.endsWith(".json")).sort();
  const extra = Math.max(0, sorted.length - keep);
  return { remove: sorted.slice(0, extra), keep: sorted.slice(extra) };
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  return `本輪抓取 ${Math.round(ms / 1000)} 秒。`;
}

export function articleChanges(previous, next) {
  const before = previous || [];
  if (!before.length) return null;
  const beforeUrls = new Set(before.map((article) => article.source_url || article.url));
  const afterUrls = new Set((next || []).map((article) => article.source_url || article.url));
  return {
    added: (next || []).filter((article) => !beforeUrls.has(article.source_url || article.url)).map((article) => article.original_title || article.title),
    removed: before.filter((article) => !afterUrls.has(article.source_url || article.url)).map((article) => article.original_title || article.title),
  };
}

export function acceptModelProposals(proposals) {
  return selectArticles((proposals || []).filter((item) => allowedUrl(item?.source_url))).map((article) => ({
    ...article,
    ...publicationFields(article),
    verification_status: "UNVERIFIED",
    review_status: "needs_review",
    fact_fields_allowed: false,
    proposed_by: "model",
  }));
}

function eventId(key) {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `evt-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function linkEvents(articles) {
  const events = new Map();
  for (const article of articles) {
    const key = normalizeTitle(article.original_title) || article.source_url;
    if (!events.has(key)) {
      events.set(key, { id: eventId(key), title: article.original_title, article_ids: [] });
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
