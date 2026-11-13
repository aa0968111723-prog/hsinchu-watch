import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ADAPTERS } from "./adapters.js";
import { runHour } from "./run.js";

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
      source_name: article.source_name,
    })),
    last_success_at: existing.last_success_at || null,
  };
} catch {
  previous = { articles: [], last_success_at: null };
}
const result = await runHour({
  adapters: ADAPTERS,
  fetcher: (url) => fetch(url, { headers: { "user-agent": "HsinchuNewsIntel/0.1" } }),
  env: {},
  previous,
  now: new Date().toISOString(),
});
const payload = {
  ok: result.ok,
  retained: result.retained,
  last_success_at: result.last_success_at,
  count: result.articles.length,
  failures: result.failures,
  gemini: result.gemini,
  articles: result.articles.map((article) => ({
    title: article.original_title,
    url: article.source_url,
    published_at: article.publisher_timestamp,
    region_id: article.region_id,
    verification_status: article.verification_status,
    source_name: article.source_name,
  })),
};
mkdirSync(new URL("../state/", import.meta.url), { recursive: true });
writeFileSync(new URL("../state/last-run.json", import.meta.url), JSON.stringify(payload, null, 2));
if (result.ok) writeFileSync(publicUrl, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ ok: result.ok, retained: result.retained, count: result.articles.length, failures: result.failures, gemini: result.gemini }, null, 2));
