import { CITY_CATALOG_LIST, CITY_CATALOG_URL, COUNTY_ELECTION_PAGE, COUNTY_PARKING_PAGE, COUNTY_PARKING_URL, COUNTY_POPULATION_PAGE, COUNTY_POPULATION_URL, COUNTY_SCHOOL_PAGE, COUNTY_SCHOOL_URL, COUNTY_VISITOR_PAGE, COUNTY_VISITOR_URL, collectAdapters, normalizeCityCatalog, normalizeCountyParking, normalizeCountyPopulation, normalizeCountySchools, normalizeCountyVisitors, normalizeElectionNotice, populationPeriod, schoolZonePeriod, visitorPeriod } from "./adapters.js";
import { allowedUrl } from "./allowlist.js";
import { acceptModelProposals, decideGemini, selectArticles } from "./pipeline.js";
import { pageDateAgrees, publicationFields, readPagePublishedAt } from "./verify.js";

export const FETCH_TIMEOUT_MS = 15000;

export async function sourceFetch(url, fetcher = fetch) {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!allowedUrl(current)) throw new Error("url_not_allowed");
    const response = await fetcher(current, {
      headers: { "user-agent": "HsinchuNewsIntel/0.1" },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers?.get?.("location") || "";
    if (!location) return response;
    current = new URL(location, current).toString();
  }
  throw new Error("too_many_redirects");
}

export function dateCheckOptions(article) {
  return { dayOnly: article?.feed_time_kind === "updated" || article?.source_type === "official_rss" || article?.source_type === "official_html" };
}

export function publishableResult(previous, result) {
  if (result?.ok && !(result.articles || []).length && (previous?.articles || []).length) {
    return {
      ...result,
      retained: true,
      articles: previous.articles,
      last_success_at: previous.last_success_at || result.last_success_at,
    };
  }
  return result;
}

export function mergeRun(previous, result) {
  if (!result.ok) {
    return {
      ok: false,
      retained: true,
      articles: previous?.articles || [],
      last_success_at: previous?.last_success_at || null,
      error: result.error,
      failures: result.failures || [],
      announcements: previous?.announcements || [],
      public_records: previous?.public_records || [],
      city_catalog: previous?.city_catalog || null,
      population: previous?.population || null,
      parking: previous?.parking || null,
      schools: previous?.schools || null,
      visitors: previous?.visitors || null,
      election: previous?.election || null,
      model_review: previous?.model_review || [],
    };
  }
  return {
    ok: true,
    retained: false,
    articles: result.articles,
    last_success_at: result.finished_at,
    failures: result.failures || [],
    gemini: result.gemini,
    announcements: result.announcements || [],
    public_records: result.public_records || [],
    city_catalog: result.city_catalog || null,
    population: result.population === undefined ? (previous?.population || null) : result.population,
    parking: result.parking === undefined ? (previous?.parking || null) : result.parking,
    schools: result.schools === undefined ? (previous?.schools || null) : result.schools,
    visitors: result.visitors === undefined ? (previous?.visitors || null) : result.visitors,
    election: result.election === undefined ? (previous?.election || null) : result.election,
    model_review: result.model_review || [],
  };
}

async function loadElectionNotice(fetcher, previous) {
  const kept = previous?.election ? { ...previous.election, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_ELECTION_PAGE);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const notice = normalizeElectionNotice(await response.text());
    if (!notice?.title) return kept;
    return {
      ...notice,
      source_url: COUNTY_ELECTION_PAGE,
      published_at: null,
      retained: false,
      note: "頁面沒有發布日期，不拿抓取時間充當。號次在附件，這裡不轉寫人名。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyVisitors(fetcher, previous) {
  const kept = previous?.visitors ? { ...previous.visitors, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_VISITOR_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const rows = normalizeCountyVisitors(await response.text());
    if (!rows.length) return kept;
    const period = visitorPeriod(rows);
    return {
      source_url: COUNTY_VISITOR_PAGE,
      dataset_url: COUNTY_VISITOR_URL,
      period: period.period,
      period_text: period.period_text,
      rows,
      retained: false,
      note: "人次、增減和成長率沿用資料檔原文，不另加總，也不另算。",
    };
  } catch {
    return kept;
  }
}

async function loadCountySchools(fetcher, previous) {
  const kept = previous?.schools ? { ...previous.schools, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const page = await fetcher(COUNTY_SCHOOL_PAGE);
    const file = await fetcher(COUNTY_SCHOOL_URL);
    if (!page?.ok || !file?.ok || typeof page.text !== "function" || typeof file.text !== "function") return kept;
    const schools = normalizeCountySchools(await file.text());
    if (!schools.length) return kept;
    const period = schoolZonePeriod(await page.text());
    return {
      source_url: COUNTY_SCHOOL_PAGE,
      dataset_url: COUNTY_SCHOOL_URL,
      period: period.period,
      period_text: period.period_text,
      count: schools.length,
      schools,
      retained: false,
      note: "只留學校名稱、鄉鎮市和學區原文。年度沿用資料集描述，沒有月份就不補月。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyParking(fetcher, previous) {
  const kept = previous?.parking ? { ...previous.parking, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_PARKING_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const lots = normalizeCountyParking(await response.text());
    if (!lots.length) return kept;
    return {
      source_url: COUNTY_PARKING_PAGE,
      dataset_url: COUNTY_PARKING_URL,
      count: lots.length,
      lots,
      retained: false,
      note: "只留名稱、行政區、地址、型式、格數原文和收費方式。不含電話、分機、公司名稱或證號。格數不換算。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyPopulation(fetcher, previous) {
  const kept = previous?.population ? { ...previous.population, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const page = await fetcher(COUNTY_POPULATION_PAGE);
    const file = await fetcher(COUNTY_POPULATION_URL);
    if (!page?.ok || !file?.ok || typeof page.text !== "function" || typeof file.text !== "function") return kept;
    const rows = normalizeCountyPopulation(await file.text());
    if (!rows.length) return kept;
    const period = populationPeriod(await page.text());
    return {
      source_url: COUNTY_POPULATION_PAGE,
      dataset_url: COUNTY_POPULATION_URL,
      period: period.period,
      period_text: period.period_text,
      rows,
      retained: false,
      note: "只列性別為計的總計。人數沿用資料檔原文。縣合計的區域別在資料檔寫 D-，代碼是 10004000。",
    };
  } catch {
    return kept;
  }
}

async function loadCityCatalog(fetcher, previous) {
  const kept = previous?.city_catalog || null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(CITY_CATALOG_URL);
    if (!response?.ok || typeof response.arrayBuffer !== "function") return kept;
    const datasets = normalizeCityCatalog(new TextDecoder("big5").decode(new Uint8Array(await response.arrayBuffer())));
    if (!datasets.length) return kept;
    return { source_url: CITY_CATALOG_URL, list_url: CITY_CATALOG_LIST, count: datasets.length, datasets };
  } catch {
    return kept;
  }
}

export async function runHour({ fetcher, adapters, env, previous, now, hidden = new Set() }) {
  const decision = decideGemini(env || {}, { tokens_today: 0, requests_this_hour: 0 });
  const called = Boolean(decision.use && typeof env?.propose === "function");
  const gemini = { ...decision, called };
  try {
    const collected = await collectAdapters(fetcher, adapters);
    if (!collected.candidates.length && collected.failures.length) {
      return mergeRun(previous, { ok: false, error: "all_sources_failed", failures: collected.failures });
    }
    const councilFailed = collected.failures.some((failure) => failure.id === "hsinchu-county-council");
    const freshNotices = collected.candidates.filter((item) => item.source_id === "hsinchu-county-council").map((item) => ({
      title: item.original_title,
      url: item.source_url,
      published_at: item.publisher_timestamp,
      source_name: item.source_name,
    }));
    const announcements = councilFailed ? (previous?.announcements || []) : freshNotices;
    const accountsFailed = collected.failures.some((failure) => failure.id === "hsc-expenditure-final");
    const freshRecords = collected.candidates.filter((item) => item.source_id === "hsc-expenditure-final").map((item) => ({
      year: item.year,
      spent_amount: item.spent_amount,
      unit: null,
      source_name: item.source_name,
      dataset_url: item.dataset_url,
      list_url: item.source_url,
      note: "年度欄是民國年，這裡換成西元。金額維持原文字。單位未標示，不換算。這是歲出決算數，不是驗收或實支。",
    }));
    const publicRecords = accountsFailed ? (previous?.public_records || []) : freshRecords;
    const cityFailed = collected.failures.some((failure) => failure.id === "hsinchu-city-news");
    if (cityFailed) {
      for (const article of previous?.articles || []) {
        const url = String(article.source_url || article.url || "");
        if (!url.includes("://www.hccg.gov.tw/")) continue;
        collected.candidates.push({
          original_title: article.original_title || article.title,
          source_url: url,
          publisher_timestamp: article.publisher_timestamp || article.published_at,
          source_name: article.source_name || "新竹市政府",
          source_type: "official_html",
          source_id: "hsinchu-city-news",
          region_id: article.region_id,
          date_checked: article.date_checked,
          page_published_at: article.page_published_at,
          feed_time_kind: article.feed_time_kind,
          retained_source: true,
        });
      }
    }
    const proposals = called ? await env.propose() : [];
    const modelReview = acceptModelProposals(proposals);
    const selected = selectArticles(collected.candidates, hidden).map((article) => ({
      ...article,
      ...publicationFields(article),
      fetched_at: now,
    }));
    const articles = [];
    for (const article of selected) {
      if (article.retained_source || !allowedUrl(article.source_url)) {
        articles.push(article);
        continue;
      }
      try {
        const response = await fetcher(article.source_url);
        const html = response?.ok ? await response.text() : "";
        const agrees = pageDateAgrees(article.publisher_timestamp, html, dateCheckOptions(article));
        const pagePublishedAt = readPagePublishedAt(html);
        if (agrees === false) {
          articles.push({ ...article, verification_status: "UNVERIFIED", review_status: "needs_review", fact_fields_allowed: false, date_checked: false, page_published_at: pagePublishedAt });
        } else {
          articles.push({ ...article, date_checked: agrees, page_published_at: pagePublishedAt });
        }
      } catch {
        articles.push({ ...article, date_checked: null });
      }
    }
    return mergeRun(previous, {
      ok: true,
      articles,
      failures: collected.failures,
      finished_at: now,
      gemini,
      announcements,
      public_records: publicRecords,
      city_catalog: await loadCityCatalog(fetcher, previous),
      population: await loadCountyPopulation(fetcher, previous),
      parking: await loadCountyParking(fetcher, previous),
      schools: await loadCountySchools(fetcher, previous),
      visitors: await loadCountyVisitors(fetcher, previous),
      election: await loadElectionNotice(fetcher, previous),
      model_review: modelReview,
    });
  } catch (error) {
    return mergeRun(previous, { ok: false, error: String(error.message || error).slice(0, 180) });
  }
}
