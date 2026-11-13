import { writeFileSync, mkdirSync } from "node:fs";
import { ADAPTERS } from "./adapters.js";
import { runHour } from "./run.js";

const result = await runHour({
  adapters: ADAPTERS,
  fetcher: (url) => fetch(url, { headers: { "user-agent": "HsinchuNewsIntel/0.1" } }),
  env: {},
  previous: { articles: [], last_success_at: null },
  now: new Date().toISOString(),
});
mkdirSync(new URL("../state/", import.meta.url), { recursive: true });
writeFileSync(new URL("../state/last-run.json", import.meta.url), JSON.stringify({
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
}, null, 2));
console.log(JSON.stringify({ ok: result.ok, count: result.articles.length, failures: result.failures, gemini: result.gemini }, null, 2));
