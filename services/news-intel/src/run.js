import { CITY_CATALOG_LIST, CITY_CATALOG_URL, COUNTY_AIR_PAGE, COUNTY_AIR_URL, COUNTY_BED_PAGE, COUNTY_BED_URL, COUNTY_CAMERA_PAGE, COUNTY_CAMERA_URL, COUNTY_DEBT_PAGE, COUNTY_DEBT_URL, COUNTY_ELECTION_PAGE, COUNTY_KINDERGARTEN_PAGE, COUNTY_KINDERGARTEN_URL, COUNTY_PARKING_PAGE, COUNTY_PARKING_URL, COUNTY_POPULATION_PAGE, COUNTY_POPULATION_URL, COUNTY_SCHOOL_PAGE, COUNTY_SCHOOL_URL, COUNTY_SPECIAL_PAGE, COUNTY_SPECIAL_URL, COUNTY_PERMIT_PAGE, COUNTY_PERMIT_URL, COUNTY_HYDRANT_PAGE, COUNTY_HYDRANT_URL, COUNTY_SHELTER_PAGE, COUNTY_SHELTER_URL, COUNTY_TOILET_PAGE, COUNTY_TOILET_URL, COUNTY_HERITAGE_PAGE, COUNTY_HERITAGE_URL, COUNTY_CHARGER_PAGE, COUNTY_CHARGER_URL, COUNTY_VISITOR_PAGE, COUNTY_VISITOR_URL, cameraListPeriod, collectAdapters, kindergartenPeriod, normalizeCityCatalog, normalizeCountyAir, normalizeCountyBeds, normalizeCountyBusShelters, normalizeCountyCameras, normalizeCountyChargers, normalizeCountyDebt, normalizeCountyHeritage, normalizeCountyHydrants, normalizeCountyKindergartens, normalizeCountyParking, normalizeCountyPopulation, normalizeCountySchools, normalizeCountyToilets, normalizeCountyVisitors, normalizeElectionNotice, normalizeSpecialClasses, populationPeriod, schoolZonePeriod, specialClassPeriod, summarizeUsePermits, toiletUpdatePeriod, visitorPeriod } from "./adapters.js";
import { allowedUrl } from "./allowlist.js";
import { acceptModelProposals, decideGemini, selectArticles } from "./pipeline.js";
import { pageDateAgrees, publicationFields, readPagePublishedAt } from "./verify.js";

export const FETCH_TIMEOUT_MS = 15000;

export function pageUnavailable(html, url) {
  const text = String(html || "");
  const finalUrl = String(url || "");
  return /\/error\/?$/.test(finalUrl) || text.includes("Whitelabel Error Page");
}

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
      kindergartens: previous?.kindergartens || null,
      cameras: previous?.cameras || null,
      special_classes: previous?.special_classes || null,
      use_permits: previous?.use_permits || null,
      hydrants: previous?.hydrants || null,
      bus_shelters: previous?.bus_shelters || null,
      toilets: previous?.toilets || null,
      heritage: previous?.heritage || null,
      chargers: previous?.chargers || null,
      visitors: previous?.visitors || null,
      beds: previous?.beds || null,
      debt: previous?.debt || null,
      air: previous?.air || null,
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
    kindergartens: result.kindergartens === undefined ? (previous?.kindergartens || null) : result.kindergartens,
    cameras: result.cameras === undefined ? (previous?.cameras || null) : result.cameras,
    special_classes: result.special_classes === undefined ? (previous?.special_classes || null) : result.special_classes,
    use_permits: result.use_permits === undefined ? (previous?.use_permits || null) : result.use_permits,
    hydrants: result.hydrants === undefined ? (previous?.hydrants || null) : result.hydrants,
    bus_shelters: result.bus_shelters === undefined ? (previous?.bus_shelters || null) : result.bus_shelters,
    toilets: result.toilets === undefined ? (previous?.toilets || null) : result.toilets,
    heritage: result.heritage === undefined ? (previous?.heritage || null) : result.heritage,
    chargers: result.chargers === undefined ? (previous?.chargers || null) : result.chargers,
    visitors: result.visitors === undefined ? (previous?.visitors || null) : result.visitors,
    beds: result.beds === undefined ? (previous?.beds || null) : result.beds,
    debt: result.debt === undefined ? (previous?.debt || null) : result.debt,
    air: result.air === undefined ? (previous?.air || null) : result.air,
    election: result.election === undefined ? (previous?.election || null) : result.election,
    model_review: result.model_review || [],
  };
}

async function loadCountyAir(fetcher, previous) {
  const kept = previous?.air ? { ...previous.air, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_AIR_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const air = normalizeCountyAir(await response.text());
    if (!air?.rows?.length) return kept;
    return {
      ...air,
      source_url: COUNTY_AIR_PAGE,
      dataset_url: COUNTY_AIR_URL,
      retained: false,
      note: "只留檔案裡最新的民國年月。這不是今天的即時空氣。數值沿用原文，欄名沒有單位就不另加。「—」和空值維持未填。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyDebt(fetcher, previous) {
  const kept = previous?.debt ? { ...previous.debt, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_DEBT_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const debt = normalizeCountyDebt(await response.text());
    if (!debt) return kept;
    return {
      ...debt,
      source_url: COUNTY_DEBT_PAGE,
      dataset_url: COUNTY_DEBT_URL,
      retained: false,
      note: "金額沿用欄位原文。單位是欄名寫的新臺幣元。這是未償餘額，不是歲出決算或實支。0 是資料檔的 0。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyBeds(fetcher, previous) {
  const kept = previous?.beds ? { ...previous.beds, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_BED_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const rows = normalizeCountyBeds(await response.text());
    if (!rows.length) return kept;
    return {
      source_url: COUNTY_BED_PAGE,
      dataset_url: COUNTY_BED_URL,
      rows,
      retained: false,
      note: "只列急性一般病床的許可數和開放數，沿用原文。檔案寫 0 就保留 0。其他床別不加總。",
    };
  } catch {
    return kept;
  }
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

async function loadCountyKindergartens(fetcher, previous) {
  const kept = previous?.kindergartens ? { ...previous.kindergartens, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const page = await fetcher(COUNTY_KINDERGARTEN_PAGE);
    const file = await fetcher(COUNTY_KINDERGARTEN_URL);
    if (!page?.ok || !file?.ok || typeof page.text !== "function" || typeof file.text !== "function") return kept;
    const kindergartens = normalizeCountyKindergartens(await file.text());
    if (!kindergartens.length) return kept;
    const period = kindergartenPeriod(await page.text());
    return {
      source_url: COUNTY_KINDERGARTEN_PAGE,
      dataset_url: COUNTY_KINDERGARTEN_URL,
      period: null,
      period_text: period.period_text,
      count: kindergartens.length,
      kindergartens,
      retained: false,
      note: "只留名稱、主題分類、郵遞區號和住址。不含電話。學年度沿用資料集描述，不換成西元年。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyCameras(fetcher, previous) {
  const kept = previous?.cameras ? { ...previous.cameras, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const page = await fetcher(COUNTY_CAMERA_PAGE);
    const file = await fetcher(COUNTY_CAMERA_URL);
    if (!page?.ok || !file?.ok || typeof page.text !== "function" || typeof file.text !== "function") return kept;
    const rows = normalizeCountyCameras(await file.text());
    if (!rows.length) return kept;
    const period = cameraListPeriod(await page.text());
    return {
      source_url: COUNTY_CAMERA_PAGE,
      dataset_url: COUNTY_CAMERA_URL,
      period: period.period,
      period_text: period.period_text,
      rows,
      retained: false,
      note: "沿用資料檔的設置地點、取締項目和速限原文。這是設備清冊，不是今日執法紀錄。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyChargers(fetcher, previous) {
  const kept = previous?.chargers ? { ...previous.chargers, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_CHARGER_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const chargers = normalizeCountyChargers(await response.text());
    if (!chargers.length) return kept;
    return {
      source_url: COUNTY_CHARGER_PAGE,
      dataset_url: COUNTY_CHARGER_URL,
      count: chargers.length,
      chargers,
      retained: false,
      note: "只留設置單位、地址、郵遞區號和備註。設置單位是店名或公司名。檔案沒有日期欄，不拿抓取時間充當。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyHeritage(fetcher, previous) {
  const kept = previous?.heritage ? { ...previous.heritage, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_HERITAGE_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const sites = normalizeCountyHeritage(await response.text());
    if (!sites.length) return kept;
    return {
      source_url: COUNTY_HERITAGE_PAGE,
      dataset_url: COUNTY_HERITAGE_URL,
      count: sites.length,
      sites,
      retained: false,
      note: "只留名稱、類別、指定別、鄉鎮簡稱、地址和權屬原文。鄉鎮沒有寫市鎮鄉就不補字。檔案沒有日期欄，不拿抓取時間充當。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyToilets(fetcher, previous) {
  const kept = previous?.toilets ? { ...previous.toilets, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_TOILET_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const raw = await response.text();
    const toilets = normalizeCountyToilets(raw);
    if (!toilets.length) return kept;
    const period = toiletUpdatePeriod(raw);
    return {
      source_url: COUNTY_TOILET_PAGE,
      dataset_url: COUNTY_TOILET_URL,
      period: period.period,
      period_text: period.period_text,
      count: toilets.length,
      toilets,
      retained: false,
      note: "只留名稱、鄉鎮、村里、地址、類型和備註。最後更新時間沿用資料檔，不是抓取時間。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyBusShelters(fetcher, previous) {
  const kept = previous?.bus_shelters ? { ...previous.bus_shelters, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_SHELTER_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const shelters = normalizeCountyBusShelters(await response.text());
    if (!shelters.length) return kept;
    return {
      source_url: COUNTY_SHELTER_PAGE,
      dataset_url: COUNTY_SHELTER_URL,
      count: shelters.length,
      shelters,
      retained: false,
      note: "只留站名、路段、年度原文、方向、路線和管理機關。年度不換成西元年。完工與否沿用「是」或「否」。",
    };
  } catch {
    return kept;
  }
}

async function loadCountyHydrants(fetcher, previous) {
  const kept = previous?.hydrants ? { ...previous.hydrants, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_HYDRANT_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const hydrants = normalizeCountyHydrants(await response.text());
    if (!hydrants.length) return kept;
    return {
      source_url: COUNTY_HYDRANT_PAGE,
      dataset_url: COUNTY_HYDRANT_URL,
      count: hydrants.length,
      hydrants,
      retained: false,
      note: "只留編號、水源編號、設置地點、型式和壓力原文。沒有設置地點的列不收入。壓力單位沿用欄名。檔案沒有日期欄，不拿抓取時間充當。",
    };
  } catch {
    return kept;
  }
}

async function loadUsePermits(fetcher, previous) {
  const kept = previous?.use_permits ? { ...previous.use_permits, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_PERMIT_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const summary = summarizeUsePermits(await response.text());
    if (!summary?.count) return kept;
    return {
      source_url: COUNTY_PERMIT_PAGE,
      dataset_url: COUNTY_PERMIT_URL,
      ...summary,
      retained: false,
      note: "只留筆數，以及資料集名稱 68 到 107 年範圍內的最早和最晚發照日期。範圍外的日期另計，不拿來當起迄。工程造價不加總，也不是實支或驗收。",
    };
  } catch {
    return kept;
  }
}

async function loadSpecialClasses(fetcher, previous) {
  const kept = previous?.special_classes ? { ...previous.special_classes, retained: true } : null;
  if (typeof fetcher !== "function") return kept;
  try {
    const response = await fetcher(COUNTY_SPECIAL_URL);
    if (!response?.ok || typeof response.text !== "function") return kept;
    const raw = await response.text();
    const classes = normalizeSpecialClasses(raw);
    if (!classes.length) return kept;
    const period = specialClassPeriod(raw);
    return {
      source_url: COUNTY_SPECIAL_PAGE,
      dataset_url: COUNTY_SPECIAL_URL,
      period: period.period,
      period_text: period.period_text,
      count: classes.length,
      classes,
      retained: false,
      note: "只留校名、班級類型和地址。不含電話。日期沿用班級類型欄名，不是抓取時間。",
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
          source_unavailable: article.source_unavailable === true,
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
      if (!allowedUrl(article.source_url)) {
        articles.push(article);
        continue;
      }
      try {
        const response = await fetcher(article.source_url);
        const html = response?.ok && typeof response.text === "function" ? await response.text() : "";
        if (!response?.ok || pageUnavailable(html, response?.url || "")) {
          articles.push({ ...article, source_unavailable: true });
          continue;
        }
        const agrees = pageDateAgrees(article.publisher_timestamp, html, dateCheckOptions(article));
        const pagePublishedAt = readPagePublishedAt(html);
        if (agrees === false) {
          articles.push({ ...article, source_unavailable: false, verification_status: "UNVERIFIED", review_status: "needs_review", fact_fields_allowed: false, date_checked: false, page_published_at: pagePublishedAt });
        } else {
          articles.push({ ...article, source_unavailable: false, date_checked: agrees, page_published_at: pagePublishedAt });
        }
      } catch {
        articles.push({ ...article, source_unavailable: true });
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
      kindergartens: await loadCountyKindergartens(fetcher, previous),
      cameras: await loadCountyCameras(fetcher, previous),
      special_classes: await loadSpecialClasses(fetcher, previous),
      use_permits: await loadUsePermits(fetcher, previous),
      hydrants: await loadCountyHydrants(fetcher, previous),
      bus_shelters: await loadCountyBusShelters(fetcher, previous),
      toilets: await loadCountyToilets(fetcher, previous),
      heritage: await loadCountyHeritage(fetcher, previous),
      chargers: await loadCountyChargers(fetcher, previous),
      visitors: await loadCountyVisitors(fetcher, previous),
      beds: await loadCountyBeds(fetcher, previous),
      debt: await loadCountyDebt(fetcher, previous),
      air: await loadCountyAir(fetcher, previous),
      election: await loadElectionNotice(fetcher, previous),
      model_review: modelReview,
    });
  } catch (error) {
    return mergeRun(previous, { ok: false, error: String(error.message || error).slice(0, 180) });
  }
}
