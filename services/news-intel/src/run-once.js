import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ADAPTERS, catalogForPublish, splitCityCatalog, splitKindergartens, splitParking, splitSchools } from "./adapters.js";
import { articleChanges } from "./pipeline.js";
import { backupPreviousNews } from "./backup.js";
import { hiddenSourceUrls, storeRun, withoutHidden } from "./local-db.js";
import { publishableResult, runHour, sourceFetch } from "./run.js";

const publicUrl = new URL("../../../public/data/news-intel/latest.json", import.meta.url);
const catalogUrl = new URL("../../../public/data/news-intel/city-catalog.json", import.meta.url);
const parkingUrl = new URL("../../../public/data/news-intel/parking.json", import.meta.url);
const schoolUrl = new URL("../../../public/data/news-intel/school-zones.json", import.meta.url);
const kindergartenUrl = new URL("../../../public/data/news-intel/kindergartens.json", import.meta.url);
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
      source_unavailable: article.source_unavailable === true,
      related_urls: article.related_urls || [],
    })),
    last_success_at: existing.last_success_at || null,
    announcements: existing.announcements || [],
    public_records: existing.public_records || [],
    city_catalog: existing.city_catalog || null,
    population: existing.population || null,
    parking: existing.parking || null,
    schools: existing.schools || null,
    kindergartens: existing.kindergartens || null,
    cameras: existing.cameras || null,
    visitors: existing.visitors || null,
    beds: existing.beds || null,
    debt: existing.debt || null,
    air: existing.air || null,
    election: existing.election || null,
  };
} catch {
  previous = { articles: [], last_success_at: null };
}
const started = Date.now();
let hidden = new Set();
try {
  hidden = await hiddenSourceUrls();
} catch (error) {
  console.log(JSON.stringify({ database: "failed", error: String(error.message || error).slice(0, 180) }));
}
const result = await runHour({
  adapters: ADAPTERS,
  fetcher: sourceFetch,
  env: {},
  previous,
  now: new Date().toISOString(),
  hidden,
});
previous.articles = withoutHidden(previous.articles, hidden);
result.articles = withoutHidden(result.articles, hidden);
const publishable = publishableResult(previous, result);
const catalogParts = splitCityCatalog(publishable.city_catalog);
const catalogPublish = catalogForPublish(catalogParts.download, catalogParts.summary, previous.city_catalog, (download) => {
  writeFileSync(catalogUrl, JSON.stringify(download));
});
const parkingParts = splitParking(publishable.parking);
const parkingPublish = catalogForPublish(parkingParts.download, parkingParts.summary, previous.parking, (download) => {
  writeFileSync(parkingUrl, JSON.stringify(download));
});
const schoolParts = splitSchools(publishable.schools);
const schoolPublish = catalogForPublish(schoolParts.download, schoolParts.summary, previous.schools, (download) => {
  writeFileSync(schoolUrl, JSON.stringify(download));
});
const kindergartenParts = splitKindergartens(publishable.kindergartens);
const kindergartenPublish = catalogForPublish(kindergartenParts.download, kindergartenParts.summary, previous.kindergartens, (download) => {
  writeFileSync(kindergartenUrl, JSON.stringify(download));
});
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
    source_unavailable: article.source_unavailable === true,
    source_name: article.source_name,
    related_urls: article.related_urls || [],
  })),
  announcements: publishable.announcements || [],
  public_records: publishable.public_records || [],
  city_catalog: catalogPublish.summary,
  population: publishable.population ? {
    source_url: publishable.population.source_url,
    dataset_url: publishable.population.dataset_url,
    period: publishable.population.period,
    period_text: publishable.population.period_text,
    rows: publishable.population.rows,
    note: publishable.population.note,
  } : null,
  parking: parkingPublish.summary,
  schools: schoolPublish.summary,
  kindergartens: kindergartenPublish.summary,
  cameras: publishable.cameras ? {
    source_url: publishable.cameras.source_url,
    dataset_url: publishable.cameras.dataset_url,
    period: publishable.cameras.period,
    period_text: publishable.cameras.period_text,
    rows: publishable.cameras.rows,
    note: publishable.cameras.note,
  } : null,
  visitors: publishable.visitors ? {
    source_url: publishable.visitors.source_url,
    dataset_url: publishable.visitors.dataset_url,
    period: publishable.visitors.period,
    period_text: publishable.visitors.period_text,
    rows: publishable.visitors.rows,
    note: publishable.visitors.note,
  } : null,
  beds: publishable.beds ? {
    source_url: publishable.beds.source_url,
    dataset_url: publishable.beds.dataset_url,
    rows: publishable.beds.rows,
    note: publishable.beds.note,
  } : null,
  debt: publishable.debt ? {
    source_url: publishable.debt.source_url,
    dataset_url: publishable.debt.dataset_url,
    period: publishable.debt.period,
    period_text: publishable.debt.period_text,
    unit: publishable.debt.unit,
    long_term: publishable.debt.long_term,
    short_term: publishable.debt.short_term,
    per_person: publishable.debt.per_person,
    self_liquidating: publishable.debt.self_liquidating,
    note: publishable.debt.note,
  } : null,
  air: publishable.air ? {
    source_url: publishable.air.source_url,
    dataset_url: publishable.air.dataset_url,
    period: publishable.air.period,
    period_text: publishable.air.period_text,
    unit: null,
    rows: publishable.air.rows,
    note: publishable.air.note,
  } : null,
  election: publishable.election ? {
    title: publishable.election.title,
    source_url: publishable.election.source_url,
    published_at: null,
    files: publishable.election.files || [],
    note: publishable.election.note,
  } : null,
  changes: articleChanges(previous.articles, publishable.articles),
  duration_ms: Date.now() - started,
  model_review: publishable.model_review || [],
};
mkdirSync(new URL("../state/", import.meta.url), { recursive: true });
try {
  await storeRun(publishable);
} catch (error) {
  console.log(JSON.stringify({ database: "failed", error: String(error.message || error).slice(0, 180) }));
}
writeFileSync(new URL("../state/last-run.json", import.meta.url), JSON.stringify(payload, null, 2));
const backup = publishable.ok
  ? backupPreviousNews(fileURLToPath(publicUrl), fileURLToPath(new URL("../state/backups/", import.meta.url)))
  : { backed_up: false };
if (publishable.ok) writeFileSync(publicUrl, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ ok: publishable.ok, retained: publishable.retained, count: publishable.articles.length, failures: publishable.failures, gemini: publishable.gemini, duration_ms: payload.duration_ms, backed_up: backup.backed_up }, null, 2));
