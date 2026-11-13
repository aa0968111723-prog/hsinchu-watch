import { ADAPTERS, CITY_CATALOG_LIST, CITY_CATALOG_URL, COUNTY_AIR_PAGE, COUNTY_AIR_URL, COUNTY_BED_PAGE, COUNTY_BED_URL, COUNTY_CAMERA_PAGE, COUNTY_CAMERA_URL, COUNTY_DEBT_PAGE, COUNTY_DEBT_URL, COUNTY_ELECTION_PAGE, COUNTY_KINDERGARTEN_PAGE, COUNTY_KINDERGARTEN_URL, COUNTY_PARKING_PAGE, COUNTY_PARKING_URL, COUNTY_POPULATION_PAGE, COUNTY_POPULATION_URL, COUNTY_SCHOOL_PAGE, COUNTY_SCHOOL_URL, COUNTY_SPECIAL_PAGE, COUNTY_SPECIAL_URL, COUNTY_PERMIT_PAGE, COUNTY_PERMIT_URL, COUNTY_HYDRANT_PAGE, COUNTY_HYDRANT_URL, COUNTY_SHELTER_PAGE, COUNTY_SHELTER_URL, COUNTY_TOILET_PAGE, COUNTY_TOILET_URL, COUNTY_HERITAGE_PAGE, COUNTY_HERITAGE_URL, COUNTY_CHARGER_PAGE, COUNTY_CHARGER_URL, COUNTY_GAS_PAGE, COUNTY_GAS_URL, COUNTY_EBUS_PAGE, COUNTY_EBUS_URL, COUNTY_VISITOR_PAGE, COUNTY_VISITOR_URL, MOENV_AIR_URL, normalizeCountyAir, normalizeCountyBeds, normalizeCountyBusShelters, normalizeCountyCameras, normalizeCountyChargers, normalizeCountyDebt, normalizeCountyElectricBuses, normalizeCountyGasStations, normalizeCountyHeritage, normalizeCountyHydrants, normalizeCountyKindergartens, normalizeCountyParking, normalizeCountyPopulation, normalizeCountySchools, normalizeCountyToilets, normalizeCountyVisitors, normalizeElectionNotice, normalizeFinalAccounts, normalizeSpecialClasses, summarizeUsePermits, toiletUpdatePeriod } from "./adapters.js";
import { authorize, consumeWrite } from "./auth.js";
import { allowedUrl } from "./allowlist.js";
import { linkEvents, regionFor, selectArticles } from "./pipeline.js";
import { persistPopulation, persistPublicRecords, persistSchools, persistTransport } from "./persist.js";
import { parsePublisherTimestamp } from "./verify.js";

export const TOOLS = [
  "search_sources", "list_source_registry", "fetch_source_document", "verify_source_url",
  "verify_publication_date", "collect_latest_news", "extract_article_metadata",
  "detect_duplicate_articles", "find_related_events", "compare_source_claims",
  "create_article_candidate", "submit_article_batch", "get_review_queue",
  "approve_verified_article", "reject_article", "revise_article", "retract_article",
  "import_government_dataset", "sync_governance_records", "sync_transport_data",
  "sync_environment_data", "sync_election_data", "sync_poll_metadata",
  "query_public_records", "search_existing_articles", "get_pipeline_status",
  "get_latest_successful_run", "get_failed_sources", "retry_failed_job", "list_audit_logs",
];

const WRITE_TOOLS = new Set([
  "submit_article_batch", "collect_latest_news", "create_article_candidate",
  "approve_verified_article", "reject_article", "revise_article", "retract_article",
  "import_government_dataset", "sync_transport_data", "sync_election_data",
]);
const defaultWriteRates = new Map();

function sources() {
  return [
    ...ADAPTERS.map((adapter) => ({ id: adapter.id, kind: adapter.kind, ...adapter.discover() })),
    { id: "hccg-opendata-catalog", kind: "open_data", url: CITY_CATALOG_URL, docs: CITY_CATALOG_LIST, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-population", kind: "open_data", url: COUNTY_POPULATION_URL, docs: COUNTY_POPULATION_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-parking", kind: "transport", url: COUNTY_PARKING_URL, docs: COUNTY_PARKING_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-elementary-zones", kind: "education", url: COUNTY_SCHOOL_URL, docs: COUNTY_SCHOOL_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-kindergartens", kind: "education", url: COUNTY_KINDERGARTEN_URL, docs: COUNTY_KINDERGARTEN_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-speed-cameras", kind: "public_safety", url: COUNTY_CAMERA_URL, docs: COUNTY_CAMERA_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-special-classes", kind: "education", url: COUNTY_SPECIAL_URL, docs: COUNTY_SPECIAL_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-use-permits", kind: "construction", url: COUNTY_PERMIT_URL, docs: COUNTY_PERMIT_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-hydrants", kind: "public_safety", url: COUNTY_HYDRANT_URL, docs: COUNTY_HYDRANT_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-bus-shelters", kind: "transport", url: COUNTY_SHELTER_URL, docs: COUNTY_SHELTER_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-accessible-toilets", kind: "public_facility", url: COUNTY_TOILET_URL, docs: COUNTY_TOILET_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-heritage", kind: "culture", url: COUNTY_HERITAGE_URL, docs: COUNTY_HERITAGE_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-chargers", kind: "transport", url: COUNTY_CHARGER_URL, docs: COUNTY_CHARGER_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-gas-stations", kind: "transport", url: COUNTY_GAS_URL, docs: COUNTY_GAS_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-electric-buses", kind: "transport", url: COUNTY_EBUS_URL, docs: COUNTY_EBUS_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-visitors", kind: "open_data", url: COUNTY_VISITOR_URL, docs: COUNTY_VISITOR_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-hospital-beds", kind: "health", url: COUNTY_BED_URL, docs: COUNTY_BED_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-public-debt", kind: "governance", url: COUNTY_DEBT_URL, docs: COUNTY_DEBT_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hsc-air-particles", kind: "environment", url: COUNTY_AIR_URL, docs: COUNTY_AIR_PAGE, license: "政府資料開放授權條款", free: true, needs_key: false },
    { id: "hccec-draw", kind: "election", url: COUNTY_ELECTION_PAGE, docs: "https://web.cec.gov.tw/hccec", license: "選舉委員會網站公開公告，只存標題與附件連結", free: true, needs_key: false },
    { id: "moenv-aqx-p-432", kind: "environment", url: MOENV_AIR_URL, docs: "https://data.moenv.gov.tw/", license: "未取得 api_key，不當作公開來源", free: false, needs_key: true },
  ];
}

async function audit(db, actor, action, target) {
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), actor, action, target, new Date().toISOString()).run();
}

export function compareClaims(left, right) {
  const compact = (value) => String(value || "").replace(/\s+/g, "");
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return "incomplete";
  const numbers = (value) => [...value.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]);
  const leftNumbers = numbers(a);
  const rightNumbers = numbers(b);
  if (leftNumbers.length && rightNumbers.length && leftNumbers.join(",") !== rightNumbers.join(",")) return "disputed";
  if (a === b || a.includes(b) || b.includes(a)) return "same";
  return "not_compared";
}

export async function handleMcp({ authorization, body, tokens, state, db, fetcher }) {
  const tool = body?.tool;
  const input = body?.input || {};
  const gate = authorize(authorization, tool, tokens);
  if (!gate.ok) return { status: gate.status, body: { error: gate.error } };
  const idempotencyKey = WRITE_TOOLS.has(tool) ? String(body?.idempotency_key || "") : "";
  const cacheKey = `${gate.scope}:${tool}:${idempotencyKey}`;
  const cached = idempotencyKey ? state?.idempotency?.get(cacheKey) : null;
  if (cached) return { status: cached.status, body: { ...cached.body, replayed: true } };
  if (WRITE_TOOLS.has(tool) && !consumeWrite({
    store: state?.rateStore || defaultWriteRates,
    token: `${gate.scope}:${tool}`,
    now: state?.now ?? Date.now(),
    limit: state?.rateLimit ?? 120,
  })) {
    return { status: 429, body: { error: "rate_limited" } };
  }
  function remember(result) {
    if (idempotencyKey && state?.idempotency && result.status < 500) state.idempotency.set(cacheKey, { status: result.status, body: result.body });
    return result;
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-hospital-beds") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_BED_URL);
      if (!response.ok) return { status: 502, body: { error: `beds_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let rows;
    try {
      rows = normalizeCountyBeds(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!rows.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: rows.length, rows, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-visitors") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_VISITOR_URL);
      if (!response.ok) return { status: 502, body: { error: `visitors_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let rows;
    try {
      rows = normalizeCountyVisitors(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!rows.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: rows.length, rows, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-elementary-zones") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_SCHOOL_URL);
      if (!response.ok) return { status: 502, body: { error: `schools_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let schools;
    try {
      schools = normalizeCountySchools(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!schools.length) return { status: 409, body: { error: "empty_dataset" } };
    const record = { source_url: COUNTY_SCHOOL_PAGE, dataset_url: COUNTY_SCHOOL_URL, period: null, count: schools.length, schools };
    if (db) await persistSchools(db, { schools: record, now: new Date().toISOString() });
    return remember({ status: 200, body: { count: schools.length, schools, stored: Boolean(db) } });
  }
  if (tool === "sync_environment_data") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_AIR_URL);
      if (!response.ok) return { status: 502, body: { error: `air_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let air;
    try {
      air = normalizeCountyAir(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!air?.rows?.length) return { status: 409, body: { error: "empty_dataset" } };
    return { status: 200, body: { air, stored: false } };
  }
  if (tool === "sync_governance_records") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_DEBT_URL);
      if (!response.ok) return { status: 502, body: { error: `debt_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let debt;
    try {
      debt = normalizeCountyDebt(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!debt) return { status: 409, body: { error: "empty_dataset" } };
    return { status: 200, body: { debt, stored: false } };
  }
  if (tool === "sync_election_data") {
    let raw = input.html;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_ELECTION_PAGE);
      if (!response.ok) return { status: 502, body: { error: `election_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    const notice = normalizeElectionNotice(raw);
    if (!notice?.title) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { ...notice, source_url: COUNTY_ELECTION_PAGE, candidates_written: 0 } });
  }
  if (tool === "sync_transport_data") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_PARKING_URL);
      if (!response.ok) return { status: 502, body: { error: `parking_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let lots;
    try {
      lots = normalizeCountyParking(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!lots.length) return { status: 409, body: { error: "empty_dataset" } };
    const parking = { source_url: COUNTY_PARKING_PAGE, dataset_url: COUNTY_PARKING_URL, count: lots.length, lots };
    if (db) await persistTransport(db, { parking, now: new Date().toISOString() });
    return remember({ status: 200, body: { count: lots.length, lots, stored: Boolean(db) } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-population") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_POPULATION_URL);
      if (!response.ok) return { status: 502, body: { error: `population_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let rows;
    try {
      rows = normalizeCountyPopulation(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!rows.length) return { status: 409, body: { error: "empty_dataset" } };
    const population = {
      source_url: COUNTY_POPULATION_PAGE,
      dataset_url: COUNTY_POPULATION_URL,
      period: null,
      period_text: null,
      rows,
    };
    if (db) await persistPopulation(db, { population, now: new Date().toISOString() });
    return remember({ status: 200, body: { population, stored: Boolean(db) } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-electric-buses") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_EBUS_URL);
      if (!response.ok) return { status: 502, body: { error: `electric_buses_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let rows;
    try {
      rows = normalizeCountyElectricBuses(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!rows.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: rows.length, rows, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-gas-stations") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_GAS_URL);
      if (!response.ok) return { status: 502, body: { error: `gas_stations_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let stations;
    try {
      stations = normalizeCountyGasStations(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!stations.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: stations.length, stations, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-chargers") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_CHARGER_URL);
      if (!response.ok) return { status: 502, body: { error: `chargers_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let chargers;
    try {
      chargers = normalizeCountyChargers(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!chargers.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: chargers.length, chargers, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-heritage") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_HERITAGE_URL);
      if (!response.ok) return { status: 502, body: { error: `heritage_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let sites;
    try {
      sites = normalizeCountyHeritage(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!sites.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: sites.length, sites, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-accessible-toilets") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_TOILET_URL);
      if (!response.ok) return { status: 502, body: { error: `toilets_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let toilets;
    try {
      toilets = normalizeCountyToilets(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!toilets.length) return { status: 409, body: { error: "empty_dataset" } };
    const period = toiletUpdatePeriod(raw);
    return remember({ status: 200, body: { count: toilets.length, period: period.period, period_text: period.period_text, toilets, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-bus-shelters") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_SHELTER_URL);
      if (!response.ok) return { status: 502, body: { error: `bus_shelters_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let shelters;
    try {
      shelters = normalizeCountyBusShelters(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!shelters.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: shelters.length, shelters, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-hydrants") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_HYDRANT_URL);
      if (!response.ok) return { status: 502, body: { error: `hydrants_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let hydrants;
    try {
      hydrants = normalizeCountyHydrants(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!hydrants.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: hydrants.length, hydrants, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-use-permits") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_PERMIT_URL);
      if (!response.ok) return { status: 502, body: { error: `use_permits_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let summary;
    try {
      summary = summarizeUsePermits(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!summary?.count) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { ...summary, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-special-classes") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_SPECIAL_URL);
      if (!response.ok) return { status: 502, body: { error: `special_classes_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let classes;
    try {
      classes = normalizeSpecialClasses(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!classes.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: classes.length, classes, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-speed-cameras") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_CAMERA_URL);
      if (!response.ok) return { status: 502, body: { error: `cameras_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let rows;
    try {
      rows = normalizeCountyCameras(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!rows.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: rows.length, rows, stored: false } });
  }
  if (tool === "import_government_dataset" && input.dataset === "hsc-kindergartens") {
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher(COUNTY_KINDERGARTEN_URL);
      if (!response.ok) return { status: 502, body: { error: `kindergartens_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let kindergartens;
    try {
      kindergartens = normalizeCountyKindergartens(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    if (!kindergartens.length) return { status: 409, body: { error: "empty_dataset" } };
    return remember({ status: 200, body: { count: kindergartens.length, kindergartens, stored: false } });
  }
  if (tool === "import_government_dataset") {
    if (input.dataset !== "hsc-expenditure-final") return { status: 409, body: { error: "adapter_not_connected" } };
    let raw = input.payload;
    if (!raw && fetcher) {
      const response = await fetcher("https://ws.hsinchu.gov.tw/001/Upload/1/opendata/8774/181/3a4b5634-9141-414a-a0f6-422e45ccab19.json");
      if (!response.ok) return { status: 502, body: { error: `final_account_${response.status}` } };
      raw = await response.text();
    }
    if (!raw) return { status: 409, body: { error: "fetcher_unavailable" } };
    let rows;
    try {
      rows = normalizeFinalAccounts(raw);
    } catch {
      return { status: 400, body: { error: "invalid_dataset" } };
    }
    const records = rows.map((row) => ({
      year: row.year,
      spent_amount: row.spent_amount,
      unit: null,
      source_name: row.source_name,
      dataset_url: row.dataset_url,
      list_url: row.source_url,
      note: "年度欄是民國年，這裡換成西元。金額維持原文字。單位未標示，不換算。這是歲出決算數，不是驗收或實支。",
    }));
    if (db) await persistPublicRecords(db, { records, now: new Date().toISOString() });
    return remember({ status: 200, body: { records, stored: Boolean(db) } });
  }
  if (tool === "sync_poll_metadata") {
    return { status: 409, body: { error: "poll_source_not_connected", fact_fields_allowed: false } };
  }
  if (tool === "retry_failed_job") return { status: 409, body: { error: "job_runner_not_connected" } };
  if (tool === "fetch_source_document" || tool === "verify_source_url") {
    if (!allowedUrl(input.url)) return { status: 400, body: { error: "url_not_allowed" } };
    if (tool === "verify_source_url") return { status: 200, body: { allowed: true } };
    if (!fetcher) return { status: 409, body: { error: "fetcher_unavailable" } };
    const response = await fetcher(input.url);
    return { status: 200, body: { url: input.url, http_status: response.status, ok: Boolean(response.ok) } };
  }
  if (tool === "search_sources") {
    const query = String(input.query || "").trim().toLowerCase();
    if (!query) return { status: 400, body: { error: "query_required" } };
    return { status: 200, body: { sources: sources().filter((source) => `${source.id} ${source.url} ${source.license}`.toLowerCase().includes(query)) } };
  }
  if (tool === "list_source_registry") return { status: 200, body: { sources: sources() } };
  if (tool === "submit_article_batch" || tool === "collect_latest_news" || tool === "create_article_candidate") {
    const articles = selectArticles(input.articles || (input.article ? [input.article] : []));
    return remember({ status: 202, body: { accepted: articles.length, articles, review_status: "pending_index", scope: gate.scope } });
  }
  if (tool === "extract_article_metadata") {
    const published = parsePublisherTimestamp(input.publisher_timestamp);
    return { status: 200, body: { original_title: String(input.original_title || "").trim(), source_url: String(input.source_url || ""), publisher_timestamp: published, region_id: regionFor(`${input.original_title || ""} ${input.summary || ""}`), accepted: Boolean(published && input.source_url && input.original_title) } };
  }
  if (tool === "verify_publication_date") {
    const parsed = parsePublisherTimestamp(input.publisher_timestamp);
    return { status: 200, body: { parsed, accepted: Boolean(parsed) } };
  }
  if (tool === "detect_duplicate_articles") {
    const articles = input.articles || [];
    return { status: 200, body: { articles: articles.length, events: linkEvents(articles).length } };
  }
  if (tool === "find_related_events") {
    const selected = selectArticles(input.articles || []);
    return { status: 200, body: { articles: selected.map((article) => ({ source_url: article.source_url, related_urls: article.related_urls || [] })) } };
  }
  if (tool === "compare_source_claims") {
    const left = String(input.left || "").trim();
    const right = String(input.right || "").trim();
    if (!left || !right) return { status: 400, body: { error: "claims_required" } };
    return { status: 200, body: { relation: compareClaims(left, right) } };
  }
  if (tool === "get_latest_successful_run") return { status: 200, body: state?.lastRun || { status: "none" } };
  if (tool === "get_failed_sources") return { status: 200, body: { failures: state?.failures || [] } };
  if (tool === "get_pipeline_status") return { status: 200, body: state || { status: "idle" } };
  if (tool === "approve_verified_article" && input.verification_status !== "VERIFIED_OFFICIAL" && input.verification_status !== "VERIFIED_MULTI_SOURCE") {
    return { status: 409, body: { error: "not_verified_fact" } };
  }
  if (!db) return { status: 503, body: { error: "database_unavailable" } };
  if (tool === "search_existing_articles") {
    const query = String(input.query || "").trim();
    if (!query) return { status: 400, body: { error: "query_required" } };
    const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await db.prepare("SELECT id, original_title, source_url, verification_status, review_status FROM articles WHERE original_title LIKE ? ESCAPE '\\' OR source_url = ? ORDER BY publisher_timestamp DESC LIMIT 20").bind(like, query).all();
    return { status: 200, body: { articles: rows.results || [] } };
  }
  if (tool === "query_public_records") {
    const rows = await db.prepare("SELECT id, title, source_url, published_on FROM government_announcements ORDER BY published_on DESC LIMIT 20").all();
    const accounts = await db.prepare("SELECT year, spent_text, unit, dataset_url, list_url FROM final_accounts ORDER BY year DESC LIMIT 20").all();
    let population = [];
    try {
      const people = await db.prepare("SELECT area_code, area_label, total_text, period, period_text FROM population_counts ORDER BY area_code LIMIT 30").all();
      population = people.results || [];
    } catch (error) {
      if (!String(error.message || error).includes("no such table")) throw error;
    }
    return { status: 200, body: { records: rows.results || [], final_accounts: accounts.results || [], population } };
  }
  if (tool === "get_review_queue") {
    const rows = await db.prepare("SELECT id, article_id, reason, status FROM review_queue WHERE status = 'open' ORDER BY created_at DESC LIMIT 20").all();
    return { status: 200, body: { queue: rows.results || [] } };
  }
  if (tool === "list_audit_logs") {
    const rows = await db.prepare("SELECT actor, action, target, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 20").all();
    return { status: 200, body: { logs: rows.results || [] } };
  }
  const sourceUrl = String(input.source_url || "");
  if (!sourceUrl.startsWith("https://")) return { status: 400, body: { error: "source_url_required" } };
  const existing = await db.prepare("SELECT id, verification_status, review_status, content_version FROM articles WHERE source_url = ?").bind(sourceUrl).first();
  if (!existing) return { status: 404, body: { error: "article_not_found" } };
  const now = new Date().toISOString();
  if (tool === "approve_verified_article") {
    if (input.verification_status !== existing.verification_status) return { status: 409, body: { error: "not_verified_fact" } };
    await db.prepare("UPDATE articles SET review_status = 'published', updated_at = ? WHERE source_url = ?").bind(now, sourceUrl).run();
    await audit(db, gate.scope, "approve_article", sourceUrl);
    return { status: 200, body: { approved: true } };
  }
  if (tool === "reject_article") {
    await db.prepare("UPDATE articles SET review_status = 'rejected', updated_at = ? WHERE source_url = ?").bind(now, sourceUrl).run();
    await audit(db, gate.scope, "reject_article", sourceUrl);
    return { status: 200, body: { rejected: true } };
  }
  if (tool === "revise_article") {
    const title = String(input.original_title || "").trim();
    if (!title) return { status: 400, body: { error: "title_required" } };
    const version = Number(existing.content_version) + 1;
    await db.prepare("UPDATE articles SET original_title = ?, content_version = ?, updated_at = ? WHERE source_url = ?").bind(title, version, now, sourceUrl).run();
    await db.prepare("INSERT INTO article_versions (id, article_id, content_version, original_title, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), existing.id, version, title, "revision", now).run();
    await audit(db, gate.scope, "revise_article", sourceUrl);
    return { status: 200, body: { content_version: version } };
  }
  if (tool === "retract_article") {
    await db.prepare("UPDATE articles SET verification_status = 'RETRACTED', review_status = 'retracted', updated_at = ? WHERE source_url = ?").bind(now, sourceUrl).run();
    await audit(db, gate.scope, "retract_article", sourceUrl);
    return { status: 200, body: { retracted: true } };
  }
  return { status: 404, body: { error: "tool_not_implemented" } };
}
