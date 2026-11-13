import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ADAPTERS } from "./adapters.js";
import { hiddenSourceUrls, storeRun, withoutHidden } from "./local-db.js";
import { publishableResult, runHour, sourceFetch } from "./run.js";

const publicUrl = new URL("../../../public/data/news-intel/latest.json", import.meta.url);
let previous = { articles: [], last_success_at: null };
try {
  const existing = JSON.parse(readFileSync(publicUrl, "utf8"));
  previous = {
    articles: (existing.articles || []).map((article) => ({
      original_title: article.title,
      source_url: article.url,
      publisher_timestamp: article.published_at,
      region_id: article.region_id,
      verification_status: article.verification_status,
      claim_kind: article.claim_kind,
      date_checked: article.date_checked,
      page_published_at: article.page_published_at,
      feed_time_kind: article.feed_time_kind,
      source_name: article.source_name,
    })),
    last_success_at: existing.last_success_at || null,
    announcements: existing.announcements || [],
    public_records: existing.public_records || [],
  };
} catch {
  previous = { articles: [], last_success_at: null };
}
const result = await runHour({
  adapters: ADAPTERS,
  fetcher: sourceFetch,
  env: {},
  previous,
  now: new Date().toISOString(),
});
let hidden = new Set();
try {
  hidden = await hiddenSourceUrls();
} catch (error) {
  console.log(JSON.stringify({ database: "failed", error: String(error.message || error).slice(0, 180) }));
}
previous.articles = withoutHidden(previous.articles, hidden);
result.articles = withoutHidden(result.articles, hidden);
const publishable = publishableResult(previous, result);
const payload = {
  ok: publishable.ok,
  retained: publishable.retained,
  last_success_at: publishable.last_success_at,
  count: publishable.articles.length,
  failures: publishable.failures,
  gemini: publishable.gemini,
  articles: publishable.articles.map((article) => ({
    title: article.original_title,
    url: article.source_url,
    published_at: article.publisher_timestamp,
    region_id: article.region_id,
    verification_status: article.verification_status,
    claim_kind: article.claim_kind,
    date_checked: article.date_checked,
    page_published_at: article.page_published_at || null,
    feed_time_kind: article.feed_time_kind || "",
    source_name: article.source_name,
  })),
  announcements: publishable.announcements || [],
  public_records: publishable.public_records || [],
  model_review: publishable.model_review || [],
};
mkdirSync(new URL("../state/", import.meta.url), { recursive: true });
try {
  await storeRun(publishable);
} catch (error) {
  console.log(JSON.stringify({ database: "failed", error: String(error.message || error).slice(0, 180) }));
}
writeFileSync(new URL("../state/last-run.json", import.meta.url), JSON.stringify(payload, null, 2));
if (publishable.ok) writeFileSync(publicUrl, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ ok: publishable.ok, retained: publishable.retained, count: publishable.articles.length, failures: publishable.failures, gemini: publishable.gemini }, null, 2));
