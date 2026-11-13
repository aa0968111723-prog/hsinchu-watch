import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorize } from "../src/auth.js";
import { allowedUrl } from "../src/allowlist.js";
import { articleChanges, chooseBackups, decideGemini, formatDuration, linkEvents, placeLabel, regionFor, regionGroup, selectArticles } from "../src/pipeline.js";
import { handleMcp } from "../src/mcp.js";
import { mergeRun, runHour } from "../src/run.js";
import { publicationFields } from "../src/verify.js";

const tokens = { reader: "reader-token", collector: "collector-token", verifier: "verifier-token", publisher: "publisher-token", admin: "admin-token" };

test("news times are shown in Taipei and date-only values stay unchanged", async () => {
  const { readFileSync } = await import("node:fs");
  const { taipeiStamp } = await import("../../../public/news-intel-time.js");
  assert.equal(taipeiStamp("2026-11-13T14:16:16.000Z"), "2026-11-13 22:16:16 臺北時間");
  assert.equal(taipeiStamp("2026-11-13T15:52:37.184Z"), "2026-11-13 23:52:37 臺北時間");
  assert.equal(taipeiStamp("2026-11-06"), "2026-11-06");
  assert.equal(taipeiStamp("2017"), "2017");
  assert.equal(taipeiStamp(""), "");
  const html = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  const source = html.match(/function taipeiStamp\(value\) \{[\s\S]*?\n\}/);
  assert.ok(source);
  const pageStamp = new Function(`${source[0]}; return taipeiStamp;`)();
  assert.equal(pageStamp("2026-11-13T14:16:16.000Z"), taipeiStamp("2026-11-13T14:16:16.000Z"));
  assert.equal(html.includes('type="module"'), false);
  assert.equal(html.includes("new URL(href).host"), true);
  assert.equal(html.includes("catch {"), true);
});

test("districts stay inside the city or county filter", () => {
  assert.equal(regionGroup("hsinchu-city-xiangshan"), "hsinchu-city");
  assert.equal(regionGroup("hsinchu-county"), "hsinchu-county");
  assert.equal(regionGroup("zhubei"), "hsinchu-county");
  assert.equal(regionGroup(""), "");
  assert.equal(regionFor("黃國昌竹北助選，新竹縣"), "zhubei");
  assert.equal(regionFor("香山高中，新竹市"), "hsinchu-city-xiangshan");
  assert.equal(regionFor("新竹縣政府公告"), "hsinchu-county");
  assert.equal(regionFor("湖口再到竹北"), "hukou");
  assert.equal(regionFor("澳洲消防員訪竹縣", "新竹縣行程行經北埔"), "hsinchu-county");
  assert.equal(regionFor("沒有地名", "只有北埔"), null);
  assert.equal(regionFor("竹市警察局無人機隊成軍"), "hsinchu-city");
  assert.equal(regionFor("竹縣加嗅系統維護"), "hsinchu-county");
  assert.equal(selectArticles([{ original_title: "澳洲消防員訪竹縣", summary: "行程行經北埔", source_url: "https://www.hsinchu.gov.tw/fire", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news" }])[0].region_id, "hsinchu-county");
  assert.equal(selectArticles([{ original_title: "竹北助選", summary: "新竹縣", source_url: "https://www.cna.com.tw/zb", publisher_timestamp: "2026-11-13", source_id: "cna-atom" }])[0].region_id, "zhubei");
  assert.equal(placeLabel("zhubei"), "新竹縣竹北");
  assert.equal(placeLabel("hsinchu-city-xiangshan"), "新竹市香山");
  const html = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  assert.equal(html.includes('data-region="hsinchu-city"'), true);
  assert.equal(html.includes('data-region="hsinchu-county"'), true);
});

test("the http mcp entry replays the same write", async () => {
  const worker = (await import("../src/index.js")).default;
  const env = { NEWS_INTEL_COLLECTOR_TOKEN: "collector-http" };
  const payload = JSON.stringify({
    tool: "submit_article_batch",
    idempotency_key: "http-batch-1",
    input: { articles: [{ original_title: "竹北道路開工", source_url: "https://www.hsinchu.gov.tw/http", publisher_timestamp: "2026-11-13T02:00:00Z", source_id: "hsinchu-county-news" }] },
  });
  const headers = { authorization: "Bearer collector-http", "content-type": "application/json" };
  const first = await worker.fetch(new Request("https://news.local/mcp", { method: "POST", headers, body: payload }), env);
  const replay = await worker.fetch(new Request("https://news.local/mcp", { method: "POST", headers, body: payload }), env);
  const firstBody = await first.json();
  const replayBody = await replay.json();
  assert.equal(first.status, 202);
  assert.equal(firstBody.accepted, 1);
  assert.equal(replay.status, 202);
  assert.equal(replayBody.replayed, true);
  assert.equal(replayBody.accepted, 1);
});

test("a backup failure still lets the news file be replaced", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { backupPreviousNews } = await import("../src/backup.js");
  const dir = mkdtempSync(join(tmpdir(), "hsinchu-news-"));
  const failed = backupPreviousNews(dir, join(dir, "backups"));
  assert.equal(failed.backed_up, false);
  assert.equal(typeof failed.error, "string");
  assert.equal(backupPreviousNews(join(dir, "missing.json"), join(dir, "backups")).backed_up, false);
});

test("old news backups are removed after the newest twenty-four", () => {
  const names = ["latest-b.json", "latest-a.json", "latest-c.json", "notes.txt"];
  const chosen = chooseBackups(names, 2);
  assert.deepEqual(chosen.keep, ["latest-b.json", "latest-c.json"]);
  assert.deepEqual(chosen.remove, ["latest-a.json"]);
  assert.equal(chooseBackups(Array.from({ length: 25 }, (_, index) => `latest-${String(index).padStart(2, "0")}.json`)).keep.length, 24);
});

test("round duration is a whole number of seconds", () => {
  assert.equal(formatDuration(22_400), "本輪抓取 22 秒。");
  assert.equal(formatDuration(0), "本輪抓取 0 秒。");
  assert.equal(formatDuration(-1), "");
  const html = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  assert.equal(html.includes("本輪抓取"), true);
  assert.equal(html.includes("沒有讀到新文章。"), true);
  assert.equal(html.includes("新竹市政府列表"), true);
  assert.equal(html.includes("沒有補假資料。${roundNote}"), true);
});

test("the first news list has no previous diff", () => {
  assert.equal(articleChanges([], [{ source_url: "https://www.hsinchu.gov.tw/a", original_title: "新竹縣公告" }]), null);
  const diff = articleChanges(
    [{ source_url: "https://www.hsinchu.gov.tw/a", original_title: "舊公告" }],
    [{ source_url: "https://www.hsinchu.gov.tw/b", original_title: "新公告" }],
  );
  assert.deepEqual(diff.added, ["新公告"]);
  assert.deepEqual(diff.removed, ["舊公告"]);
  assert.deepEqual(articleChanges(
    [{ url: "https://www.hsinchu.gov.tw/a", title: "同一則" }],
    [{ source_url: "https://www.hsinchu.gov.tw/a", original_title: "同一則" }],
  ), { added: [], removed: [] });
});

test("city catalog keeps dataset names and drops contact fields", async () => {
  const { normalizeCityCatalog } = await import("../src/adapters.js");
  const rows = normalizeCityCatalog("資料產生時間,2026/11/14\n資料集名稱,資料來源,聯絡人,聯絡電話,提供格式,資料說明\n新竹市路燈,工務處,王小明,03-5216121,CSV;JSON,說明,多餘");
  assert.deepEqual(rows, [{ name: "新竹市路燈", agency: "工務處", formats: "CSV;JSON" }]);
  const { catalogForPublish } = await import("../src/adapters.js");
  const failedCatalog = catalogForPublish({ datasets: [] }, { count: 2 }, { count: 981 }, () => { throw new Error("disk full"); });
  assert.equal(failedCatalog.written, false);
  assert.equal(failedCatalog.summary.count, 981);
  const writtenCatalog = catalogForPublish({ datasets: [] }, { count: 2 }, { count: 981 }, () => {});
  assert.equal(writtenCatalog.written, true);
  assert.equal(writtenCatalog.summary.count, 2);
  const reordered = normalizeCityCatalog("聯絡電話,提供格式,資料集名稱,資料來源\n03-5216121,CSV,新竹市路燈,工務處");
  assert.deepEqual(reordered, [{ name: "新竹市路燈", agency: "工務處", formats: "CSV" }]);
  assert.equal(JSON.stringify(reordered).includes("03-5216121"), false);
  const { splitCityCatalog } = await import("../src/adapters.js");
  const parts = splitCityCatalog({ source_url: "https://opendata.hccg.gov.tw/OpenDataCSV.aspx", list_url: "https://opendata.hccg.gov.tw/OpenDataList.aspx?n=1&sms=9059", count: 1, datasets: rows });
  assert.equal(parts.summary.datasets, undefined);
  assert.equal(parts.summary.download_url, "/data/news-intel/city-catalog.json");
  assert.equal(parts.download.datasets[0].name, "新竹市路燈");
  const { runHour } = await import("../src/run.js");
  const kept = await runHour({
    previous: { articles: [], city_catalog: { count: 2, datasets: [{ name: "舊目錄", agency: "交通處", formats: "CSV" }] } },
    now: "2026-11-14T00:00:00.000Z",
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(kept.city_catalog.count, 2);
  assert.equal(kept.articles.length, 1);
  const registry = await handleMcp({ authorization: "Bearer reader-token", tokens, body: { tool: "list_source_registry" } });
  assert.equal(registry.body.sources.some((source) => source.id === "hccg-opendata-catalog" && source.needs_key === false), true);
});

test("county population keeps the file total and the D- label", async () => {
  const { normalizeCountyPopulation, populationPeriod } = await import("../src/adapters.js");
  const rows = normalizeCountyPopulation(JSON.stringify([
    { "行政區域代碼": "10004000", "區域別": "D-", "性別": "計", "總計": "5" },
    { "行政區域代碼": "10004000", "區域別": "D-", "性別": "男", "總計": "1" },
    { "行政區域代碼": "10004010", "區域別": "竹北市", "性別": "計", "總計": " " },
  ]));
  assert.deepEqual(rows, [
    { area_code: "10004000", area_label: "D-", total: "5" },
    { area_code: "10004010", area_label: "竹北市", total: null },
  ]);
  assert.deepEqual(populationPeriod("<div>資料集描述： 115年10月新竹縣各鄉鎮市現住人口</div>"), { period: "2026-10", period_text: "115年10月" });
  assert.deepEqual(populationPeriod("<p>115年10月出現在別處</p>"), { period: null, period_text: null });
  const kept = await runHour({
    previous: { articles: [], population: { rows: [{ area_code: "10004010", area_label: "竹北市", total: "9" }] } },
    now: "2026-11-14T01:00:00.000Z",
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(kept.population.rows[0].total, "9");
  assert.equal(kept.population.retained, true);
  const page = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  assert.equal(page.includes("資料檔區域別為 D-"), true);
  assert.equal(page.includes("沒有補 0"), true);
  const { openNewsDb } = await import("../src/local-db.js");
  const db = openNewsDb(":memory:");
  const imported = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    db,
    body: { tool: "import_government_dataset", input: { dataset: "hsc-population", payload: JSON.stringify([{ "行政區域代碼": "10004010", "區域別": "竹北市", "性別": "計", "總計": "5" }, { "行政區域代碼": "10004010", "區域別": "竹北市", "性別": "女", "總計": "2" }]) } },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.population.rows.length, 1);
  assert.equal(imported.body.population.rows[0].total, "5");
  const stored = await db.prepare("SELECT total_text FROM population_counts WHERE area_code = ?").bind("10004010").first();
  const budgets = await db.prepare("SELECT COUNT(*) AS n FROM project_budgets").first();
  const accounts = await db.prepare("SELECT COUNT(*) AS n FROM final_accounts").first();
  assert.equal(stored.total_text, "5");
  assert.equal(budgets.n, 0);
  assert.equal(accounts.n, 0);
  const registry = await handleMcp({ authorization: "Bearer reader-token", tokens, body: { tool: "list_source_registry" } });
  const air = registry.body.sources.find((source) => source.id === "moenv-aqx-p-432");
  assert.equal(air.needs_key, true);
  assert.equal(air.free, false);
  const blocked = await handleMcp({ authorization: "Bearer collector-token", tokens, body: { tool: "sync_environment_data" } });
  assert.equal(blocked.status, 409);
});

test("county parking drops phone numbers and keeps the space text", async () => {
  const { normalizeCountyParking, splitParking } = await import("../src/adapters.js");
  const lots = normalizeCountyParking(JSON.stringify([
    { "停車場名稱": "湖口鄉中興立體停車場", "行政區": "湖口鄉", "停車場地址-地號": "湖口鄉興湖段", "型式": "立體", "停車格數量": "小型車167格", "收費方式": "計時", "電話": "03-0000000", "分機": "1", "公司名稱": "某公司", "證號": "003-4" },
    { "停車場名稱": " ", "行政區": "竹北市", "電話": "03-111" },
    { "停車場名稱": "地址未填場", "行政區": "別處", "停車格數量": "", "收費方式": "" },
  ]));
  assert.equal(lots.length, 2);
  assert.equal(lots[0].region_id, "hukou");
  assert.equal(lots[0].spaces, "小型車167格");
  assert.equal(lots[1].region_id, null);
  assert.equal(lots[1].spaces, null);
  assert.equal(JSON.stringify(lots).includes("03-0000000"), false);
  assert.equal(JSON.stringify(lots).includes("某公司"), false);
  assert.equal(JSON.stringify(lots).includes("003-4"), false);
  const parts = splitParking({ source_url: "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=271", dataset_url: "https://ws.hsinchu.gov.tw/parking.json", count: lots.length, lots });
  assert.equal(parts.summary.lots, undefined);
  assert.equal(parts.download.lots.length, 2);
  const kept = await runHour({
    previous: { articles: [], parking: { count: 3, source_url: "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=271" } },
    now: "2026-11-14T01:10:00.000Z",
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(kept.parking.count, 3);
  assert.equal(kept.parking.retained, true);
  const { openNewsDb } = await import("../src/local-db.js");
  const db = openNewsDb(":memory:");
  const synced = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    db,
    body: { tool: "sync_transport_data", input: { payload: JSON.stringify([{ "停車場名稱": "湖口鄉中興立體停車場", "行政區": "湖口鄉", "停車場地址-地號": "湖口鄉興湖段", "型式": "立體", "停車格數量": "小型車167格", "收費方式": "計時", "電話": "03-0000000" }]) } },
  });
  const row = await db.prepare("SELECT summary, published_at, region_id FROM transport_updates").first();
  const budgets = await db.prepare("SELECT COUNT(*) AS n FROM project_budgets").first();
  assert.equal(synced.status, 200);
  assert.equal(synced.body.lots[0].spaces, "小型車167格");
  assert.equal(row.region_id, "hukou");
  assert.equal(row.published_at, null);
  assert.equal(String(row.summary).includes("03-0000000"), false);
  assert.equal(budgets.n, 0);
  const reader = await handleMcp({ authorization: "Bearer reader-token", tokens, body: { tool: "sync_transport_data", input: { payload: "[]" } } });
  assert.equal(reader.status, 403);
  const page = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  assert.equal(page.includes("不含電話"), true);
});

test("county school zones keep the description year and the zone text", async () => {
  const { normalizeCountySchools, schoolZonePeriod, splitSchools } = await import("../src/adapters.js");
  const schools = normalizeCountySchools(JSON.stringify([
    { "鄉鎮市區代碼": "10004020", "鄉鎮市": "竹東鎮", "學校名稱": "瑞峰國小", "所屬學區": "上坪里。" },
    { "鄉鎮市": "新埔鄉", "學校名稱": "未映射國小", "所屬學區": "" },
    { "鄉鎮市": "竹東鎮", "學校名稱": " ", "所屬學區": "不應出現" },
  ]));
  assert.deepEqual(schools, [
    { name: "瑞峰國小", township: "竹東鎮", township_code: "10004020", region_id: "zhudong", zone: "上坪里。" },
    { name: "未映射國小", township: "新埔鄉", township_code: null, region_id: null, zone: null },
  ]);
  assert.deepEqual(schoolZonePeriod("<p>資料集描述： 114年各鄉鎮市國民小學學區資料</p><p>115年10月</p>"), { period: "2025", period_text: "114年" });
  assert.deepEqual(schoolZonePeriod("<p>114年出現在別處</p>"), { period: null, period_text: null });
  const parts = splitSchools({ source_url: "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=350", dataset_url: "https://ws.hsinchu.gov.tw/schools.json", period: "2025", period_text: "114年", count: 1, schools });
  assert.equal(parts.summary.schools, undefined);
  const kept = await runHour({
    previous: { articles: [], schools: { count: 2, period_text: "114年" } },
    now: "2026-11-14T01:20:00.000Z",
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(kept.schools.count, 2);
  assert.equal(kept.schools.retained, true);
  const { openNewsDb } = await import("../src/local-db.js");
  const db = openNewsDb(":memory:");
  const imported = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    db,
    body: { tool: "import_government_dataset", input: { dataset: "hsc-elementary-zones", payload: JSON.stringify([{ "鄉鎮市": "竹東鎮", "學校名稱": "瑞峰國小", "所屬學區": "上坪里。" }]) } },
  });
  const row = await db.prepare("SELECT zone_text, period FROM school_zones WHERE school_name = ?").bind("瑞峰國小").first();
  const announcements = await db.prepare("SELECT COUNT(*) AS n FROM education_announcements").first();
  assert.equal(imported.status, 200);
  assert.equal(imported.body.schools[0].zone, "上坪里。");
  assert.equal(row.zone_text, "上坪里。");
  assert.equal(row.period, "");
  assert.equal(announcements.n, 0);
  const page = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  assert.equal(page.includes("沒有月份就不補月") || page.includes("沒有寫年度"), true);
});

test("county visitor counts stay as written and are not added together", async () => {
  const { normalizeCountyVisitors, visitorPeriod } = await import("../src/adapters.js");
  const rows = normalizeCountyVisitors(JSON.stringify([
    { "觀光遊憩區別": "內灣老街", "民國年": "115", "月份": "06", "遊客人次": "100158", "上年同月份遊客人次": "121970", "增減數": "-21812", "成長率": "-0.1788" },
    { "觀光遊憩區別": " ", "遊客人次": "1" },
    { "觀光遊憩區別": "空白人次", "民國年": "115", "月份": "06", "遊客人次": "", "增減數": "" },
  ]));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].visits, "100158");
  assert.equal(rows[0].change, "-21812");
  assert.equal(rows[1].visits, null);
  assert.deepEqual(visitorPeriod(rows.slice(0, 1)), { period: "2026-06", period_text: "115年06月" });
  assert.deepEqual(visitorPeriod([rows[0], { ...rows[0], month: "07" }]), { period: null, period_text: null });
  const kept = await runHour({
    previous: { articles: [], visitors: { rows: [{ name: "內灣老街", visits: "1" }] } },
    now: "2026-11-14T01:20:00.000Z",
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(kept.visitors.rows[0].visits, "1");
  assert.equal(kept.visitors.retained, true);
  const { openNewsDb } = await import("../src/local-db.js");
  const db = openNewsDb(":memory:");
  const imported = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    db,
    body: { tool: "import_government_dataset", input: { dataset: "hsc-visitors", payload: JSON.stringify([{ "觀光遊憩區別": "內灣老街", "民國年": "115", "月份": "06", "遊客人次": "100158", "增減數": "-21812" }]) } },
  });
  const polls = await db.prepare("SELECT COUNT(*) AS n FROM poll_results").first();
  const budgets = await db.prepare("SELECT COUNT(*) AS n FROM project_budgets").first();
  assert.equal(imported.status, 200);
  assert.equal(imported.body.stored, false);
  assert.equal(imported.body.rows[0].change, "-21812");
  assert.equal(polls.n, 0);
  assert.equal(budgets.n, 0);
  const page = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  assert.equal(page.includes("不另加總"), true);
});

test("an election notice keeps the attachment links and no candidate names", async () => {
  const { normalizeElectionNotice } = await import("../src/adapters.js");
  const { allowedUrl } = await import("../src/allowlist.js");
  const notice = normalizeElectionNotice(`<title>115年地方公職人員選舉候選人姓名號次抽籤結果</title><a href="https://web.cec.gov.tw/api/file/a.pdf">縣長抽籤結果 pdf</a><a href="https://example.com/secret.pdf">不收</a>`);
  assert.equal(notice.published_at, null);
  assert.deepEqual(notice.files, [{ label: "縣長抽籤結果 pdf", url: "https://web.cec.gov.tw/api/file/a.pdf" }]);
  assert.equal(JSON.stringify(notice).includes("鄭朝方"), false);
  assert.equal(allowedUrl("https://web.cec.gov.tw/hccec/article/65398"), true);
  assert.equal(allowedUrl("https://cec.gov.tw/a"), false);
  const kept = await runHour({
    previous: { articles: [], election: { title: "舊公告", files: [] } },
    now: "2026-11-14T01:20:00.000Z",
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(kept.election.title, "舊公告");
  assert.equal(kept.election.retained, true);
  const { openNewsDb } = await import("../src/local-db.js");
  const db = openNewsDb(":memory:");
  const synced = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    db,
    body: { tool: "sync_election_data", input: { html: `<title>115年地方公職人員選舉候選人姓名號次抽籤結果</title><a href="https://web.cec.gov.tw/api/file/a.pdf">縣長抽籤結果 pdf</a>` } },
  });
  const candidates = await db.prepare("SELECT COUNT(*) AS n FROM candidates").first();
  const polls = await db.prepare("SELECT COUNT(*) AS n FROM poll_results").first();
  assert.equal(synced.status, 200);
  assert.equal(synced.body.candidates_written, 0);
  assert.equal(synced.body.published_at, null);
  assert.equal(candidates.n, 0);
  assert.equal(polls.n, 0);
  const page = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  assert.equal(page.includes("不轉寫人名"), true);
});

test("source fetch stops when a redirect leaves the allowlist", async () => {
  const { sourceFetch } = await import("../src/run.js");
  const calls = [];
  await assert.rejects(() => sourceFetch("https://www.hccg.gov.tw/", async (url) => {
    calls.push(url);
    return { status: 301, headers: { get: () => "https://example.com/secret" } };
  }), /url_not_allowed/);
  assert.deepEqual(calls, ["https://www.hccg.gov.tw/"]);
  const followed = await sourceFetch("https://www.hccg.gov.tw/", async (url) => {
    if (url === "https://www.hccg.gov.tw/") return { status: 301, headers: { get: () => "/hccg/index" } };
    return { status: 200, ok: true, url };
  });
  assert.equal(followed.ok, true);
  assert.equal(followed.url, "https://www.hccg.gov.tw/hccg/index");
  await assert.rejects(() => sourceFetch("https://example.com/a", async () => ({ status: 200, ok: true })), /url_not_allowed/);
});

test("an empty city list keeps the previous city articles", async () => {
  const result = await runHour({
    previous: {
      articles: [{
        original_title: "新竹市舊聞",
        source_url: "https://www.hccg.gov.tw/hccg/app/data/view?module=municipalnews&id=1",
        publisher_timestamp: "2026-11-13",
        source_name: "新竹市政府",
        region_id: "hsinchu-city",
        date_checked: true,
        page_published_at: "2026-11-13",
      }],
    },
    now: "2026-11-14T01:20:00.000Z",
    adapters: [
      { id: "hsinchu-city-news", async fetch() { return "<html></html>"; }, normalize() { return []; } },
      { id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-14T00:00:00.000Z", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } },
    ],
    fetcher: async (url) => {
      if (String(url).includes("hccg.gov.tw")) throw new Error("retained city page was fetched");
      return { ok: true, status: 200, text: async () => "" };
    },
  });
  const city = result.articles.find((article) => article.source_url.includes("municipalnews"));
  assert.equal(city.original_title, "新竹市舊聞");
  assert.equal(city.date_checked, true);
});

test("different wording is not treated as a disputed claim", async () => {
  const { compareClaims, handleMcp: mcp } = await import("../src/mcp.js");
  assert.equal(compareClaims("新竹市公告", "新竹市公告"), "same");
  assert.equal(compareClaims("新竹市 公告", "新竹市公告"), "same");
  assert.equal(compareClaims("20篇", "20篇新聞"), "same");
  assert.equal(compareClaims("新竹市公告", "新竹縣公告"), "not_compared");
  assert.equal(compareClaims("115年10月人口598017", "115年11月人口598018"), "disputed");
  const result = await mcp({
    authorization: "Bearer verifier-token",
    tokens,
    body: { tool: "compare_source_claims", input: { left: "新竹市公告", right: "新竹縣公告" } },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.relation, "not_compared");
});

test("hospital bed counts stay as written and are not added together", async () => {
  const { normalizeCountyBeds } = await import("../src/adapters.js");
  const rows = normalizeCountyBeds(JSON.stringify([
    { "機構名稱": "大安醫院", "急性-一般病床-許可數": "20", "急性-一般病床-開放數": "0", "加護病床": "3" },
    { "機構名稱": " ", "急性-一般病床-開放數": "5" },
    { "機構名稱": "空白開放數", "急性-一般病床-許可數": "", "急性-一般病床-開放數": "" },
  ]));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].acute_general_open, "0");
  assert.equal(rows[1].acute_general_open, null);
  assert.equal(JSON.stringify(rows).includes("加護"), false);
  const kept = await runHour({
    previous: { articles: [], beds: { rows: [{ name: "大安醫院", acute_general_open: "0" }] } },
    now: "2026-11-14T01:30:00.000Z",
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(kept.beds.rows[0].acute_general_open, "0");
  assert.equal(kept.beds.retained, true);
  const imported = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    body: { tool: "import_government_dataset", input: { dataset: "hsc-hospital-beds", payload: JSON.stringify([{ "機構名稱": "大安醫院", "急性-一般病床-許可數": "20", "急性-一般病床-開放數": "0", "加護病床": "3" }]) } },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.stored, false);
  assert.equal(imported.body.rows[0].acute_general_open, "0");
  assert.equal(JSON.stringify(imported.body).includes("加護"), false);
  const page = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  assert.equal(page.includes("其他床別不加總"), true);
});

test("county debt keeps the latest original balances and a written zero", async () => {
  const { normalizeCountyDebt } = await import("../src/adapters.js");
  const debt = normalizeCountyDebt(JSON.stringify([
    { "項目": "截至105年1月底止", "一年以上債務未償餘額-新臺幣元": "1", "短期債務未償餘額-新臺幣元": "2", "平均每人負擔債務-新臺幣元": "3", "自償性債務未償餘額-含非營業特種基金-新臺幣元": "4" },
    { "項目": "截至115年10月底止", "一年以上債務未償餘額-新臺幣元": "5000000000", "短期債務未償餘額-新臺幣元": "0", "平均每人負擔債務-新臺幣元": "8358", "自償性債務未償餘額-含非營業特種基金-新臺幣元": "" },
    { "項目": "不是月份", "一年以上債務未償餘額-新臺幣元": "9" },
  ]));
  assert.equal(debt.period, "2026-10");
  assert.equal(debt.period_text, "截至115年10月底止");
  assert.equal(debt.unit, "新臺幣元");
  assert.equal(debt.long_term, "5000000000");
  assert.equal(debt.short_term, "0");
  assert.equal(debt.self_liquidating, null);
  const kept = await runHour({
    previous: { articles: [], debt: { period_text: "截至115年9月底止", short_term: "0" } },
    now: "2026-11-14T02:00:00.000Z",
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(kept.debt.period_text, "截至115年9月底止");
  assert.equal(kept.debt.retained, true);
  const synced = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    body: { tool: "sync_governance_records", input: { payload: JSON.stringify([{ "項目": "截至115年10月底止", "一年以上債務未償餘額-新臺幣元": "5000000000", "短期債務未償餘額-新臺幣元": "0", "平均每人負擔債務-新臺幣元": "8358", "自償性債務未償餘額-含非營業特種基金-新臺幣元": "0" }]) } },
  });
  assert.equal(synced.status, 200);
  assert.equal(synced.body.stored, false);
  assert.equal(synced.body.debt.short_term, "0");
  const page = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  assert.equal(page.includes("不是歲出決算或實支"), true);
});

test("county air readings keep the latest month and blank marks", async () => {
  const { normalizeCountyAir } = await import("../src/adapters.js");
  const air = normalizeCountyAir(JSON.stringify([
    { "測站名稱": "竹北站上半月", "民國年月": "11301", "懸浮微粒_TSP": "45", "懸浮微粒_PM10": "—", "懸浮微粒_PM2.5": "", "落塵量": "3.5" },
    { "測站名稱": "竹東站下半月", "民國年月": "11411", "懸浮微粒_TSP": "70", "懸浮微粒_PM10": "0", "懸浮微粒_PM2.5": "15", "落塵量": "" },
  ]));
  assert.equal(air.period, "2025-11");
  assert.equal(air.period_text, "11411");
  assert.equal(air.unit, null);
  assert.equal(air.rows.length, 1);
  assert.equal(air.rows[0].tsp, "70");
  assert.equal(air.rows[0].pm10, "0");
  assert.equal(air.rows[0].dust, null);
  const kept = await runHour({
    previous: { articles: [], air: { period_text: "11410", rows: [{ station: "舊站", tsp: "1" }] } },
    now: "2026-11-14T02:00:00.000Z",
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(kept.air.period_text, "11410");
  assert.equal(kept.air.retained, true);
  const synced = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    body: { tool: "sync_environment_data", input: { payload: JSON.stringify([{ "測站名稱": "竹東站下半月", "民國年月": "11411", "懸浮微粒_TSP": "70", "懸浮微粒_PM10": "—", "懸浮微粒_PM2.5": "15", "落塵量": "" }]) } },
  });
  assert.equal(synced.status, 200);
  assert.equal(synced.body.stored, false);
  assert.equal(synced.body.air.rows[0].pm10, null);
  const page = readFileSync(new URL("../../../public/news-hourly.html", import.meta.url), "utf8");
  assert.equal(page.includes("不是今天的即時空氣"), true);
});

test("a hidden url is skipped and the next article fills the list", () => {
  const rows = selectArticles([
    { original_title: "新竹市新公告", source_url: "https://www.hsinchu.gov.tw/new", publisher_timestamp: "2026-11-13T09:00:00.000Z", source_id: "hsinchu-city-news" },
    { original_title: "新竹縣舊公告", source_url: "https://www.hsinchu.gov.tw/old", publisher_timestamp: "2026-11-12", source_id: "hsinchu-county-news" },
  ], new Set(["https://www.hsinchu.gov.tw/new"]));
  assert.deepEqual(rows.map((row) => row.source_url), ["https://www.hsinchu.gov.tw/old"]);
});

test("an empty successful hour keeps the previous news list", async () => {
  const { publishableResult } = await import("../src/run.js");
  const previous = { articles: [{ original_title: "新竹縣仍在", source_url: "https://www.hsinchu.gov.tw/live" }], last_success_at: "2026-11-13T01:00:00.000Z" };
  const kept = publishableResult(previous, { ok: true, articles: [], last_success_at: "2026-11-13T02:00:00.000Z" });
  assert.equal(kept.retained, true);
  assert.equal(kept.articles.length, 1);
  assert.equal(kept.last_success_at, "2026-11-13T01:00:00.000Z");
});

test("source fetches give up before the next hourly run", async () => {
  const { FETCH_TIMEOUT_MS } = await import("../src/run.js");
  const { PUBLISH_TIMEOUT_MS } = await import("../src/publish-gate.js");
  assert.equal(FETCH_TIMEOUT_MS < PUBLISH_TIMEOUT_MS, true);
});

test("does not invent articles when the hour is empty", () => {
  assert.deepEqual(selectArticles([]), []);
  assert.equal(selectArticles([{ original_title: "新竹市公告", source_url: "https://www.hccg.gov.tw/a", publisher_timestamp: "不是日期" }]).length, 0);
  assert.equal(selectArticles([{ original_title: "新竹市公告", source_url: "https://www.hccg.gov.tw/a", publisher_timestamp: "Fri, 13 Nov 2026 09:05:00 GMT" }]).length, 1);
});

test("caps at 20 and collapses reprints", () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    original_title: `新竹市公告${index}`,
    source_url: `https://www.cna.com.tw/news/${index}`,
    publisher_timestamp: "2026-11-13T01:00:00+08:00",
  }));
  assert.equal(selectArticles(rows).length, 20);
  const reprints = linkEvents([
    { original_title: "竹北道路開工", source_url: "https://www.cna.com.tw/a" },
    { original_title: "竹北道路開工", source_url: "https://www.hsinchu.gov.tw/b" },
  ]);
  assert.equal(reprints.length, 1);
  assert.equal(reprints[0].article_ids.length, 2);
  const kept = selectArticles([
    { original_title: "竹北道路開工", source_url: "https://www.cna.com.tw/a", publisher_timestamp: "2026-11-13T02:00:00Z", source_id: "cna-atom" },
    { original_title: "竹北道路開工", source_url: "https://www.hsinchu.gov.tw/b", publisher_timestamp: "2026-11-13T01:00:00Z", source_id: "hsinchu-county-news" },
    { original_title: "新竹市另一則", source_url: "https://www.hccg.gov.tw/c", publisher_timestamp: "2026-11-13T03:00:00Z", source_id: "hsinchu-city-news" },
  ]);
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.find((row) => row.original_title === "竹北道路開工").related_urls, ["https://www.hsinchu.gov.tw/b"]);
  const outside = selectArticles([
    { original_title: "竹北道路開工", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13T02:00:00Z", source_id: "hsinchu-county-news" },
    { original_title: "竹北道路開工", source_url: "https://example.com/reprint", publisher_timestamp: "2026-11-13T01:00:00Z", source_id: "cna-atom" },
    { original_title: "新竹市外部轉載", source_url: "https://example.com/story", publisher_timestamp: "2026-11-13T03:00:00Z", source_id: "cna-atom" },
  ]);
  assert.deepEqual(outside.map((row) => row.source_url), ["https://www.hsinchu.gov.tw/a"]);
  assert.deepEqual(outside[0].related_urls, []);
  const distinct = linkEvents([
    { original_title: "新竹縣政府今日對外說明這項公共工程的後續進度並且強調第一階段", source_url: "https://www.hsinchu.gov.tw/a" },
    { original_title: "新竹縣政府今日對外說明這項公共工程的後續進度並且強調第二階段", source_url: "https://www.hsinchu.gov.tw/b" },
  ]);
  assert.equal(distinct.length, 2);
  assert.notEqual(distinct[0].id, distinct[1].id);
});

test("anonymous and under-scoped writes are rejected", async () => {
  assert.equal(authorize(null, "submit_article_batch", tokens).status, 401);
  assert.equal(authorize("Bearer reader-token", "submit_article_batch", tokens).status, 403);
  assert.equal(authorize("Bearer collector-token", "retract_article", tokens).status, 403);
  const accepted = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    body: { tool: "submit_article_batch", input: { articles: [{ original_title: "竹北開工", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13" }] } },
  });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.accepted, 1);
});

test("blocks private and off-allowlist fetches", async () => {
  assert.equal(allowedUrl("http://169.254.169.254/latest"), false);
  assert.equal(allowedUrl("https://example.com/story"), false);
  assert.equal(allowedUrl("https://www.hsinchu.gov.tw/News.aspx"), true);
  assert.equal(allowedUrl("https://cna.com.tw/news/a"), true);
  assert.equal(allowedUrl("https://www.cna.com.tw/news/a"), true);
  assert.equal(allowedUrl("https://hsinchu.gov.tw/a"), false);
  assert.equal(allowedUrl("https://www.hcc.gov.tw/detail?program=151&article=3465"), true);
  const blocked = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    body: { tool: "fetch_source_document", input: { url: "https://example.com/secret" } },
  });
  assert.equal(blocked.status, 400);
});

test("gemini stays off without a key or when the cap is hit", async () => {
  assert.equal(decideGemini({}, {}).use, false);
  assert.equal(decideGemini({ GEMINI_API_KEY: "present" }, { tokens_today: 200000 }).reason, "daily_token_cap");
  let proposed = false;
  const quiet = await runHour({
    env: { propose() { proposed = true; return []; } },
    now: "2026-11-13T02:00:00.000Z",
    previous: { articles: [] },
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/real", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: true, status: 200, text: async () => "" }),
  });
  const guarded = await runHour({
    env: {
      GEMINI_API_KEY: "present",
      async propose() {
        return [
          { original_title: "模型虛構的新竹市新聞", source_url: "https://example.com/a", publisher_timestamp: "2026-11-13" },
          { original_title: "模型提出的竹北開工", source_url: "https://www.hsinchu.gov.tw/model", publisher_timestamp: "2026-11-13", source_type: "official_rss" },
          { original_title: "新竹市民調支持度模型稿", source_url: "https://www.cna.com.tw/model", publisher_timestamp: "2026-11-13", source_type: "news_rss" },
        ];
      },
    },
    now: "2026-11-13T02:00:00.000Z",
    previous: { articles: [] },
    adapters: [{ id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/real", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } }],
    fetcher: async () => ({ ok: true, status: 200, text: async () => "" }),
  });
  assert.equal(proposed, false);
  assert.equal(quiet.gemini.called, false);
  assert.equal(quiet.articles.length, 1);
  assert.equal(guarded.articles.map((article) => article.original_title).includes("模型提出的竹北開工"), false);
  assert.equal(guarded.model_review.length, 2);
  assert.equal(guarded.model_review.every((article) => article.verification_status === "UNVERIFIED" && article.fact_fields_allowed === false), true);
  const { DatabaseSync } = await import("node:sqlite");
  const { persistModelReview } = await import("../src/persist.js");
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  const d1 = {
    prepare(sql) {
      const statement = (params) => ({
        bind(...next) { return statement(next); },
        async run() { db.prepare(sql).run(...params); return { success: true }; },
        async all() { return { results: db.prepare(sql).all(...params) }; },
        async first() { return db.prepare(sql).get(...params) || null; },
      });
      return statement([]);
    },
  };
  const stored = await persistModelReview(d1, { proposals: guarded.model_review, now: "2026-11-13T02:00:00.000Z" });
  const repeated = await persistModelReview(d1, { proposals: guarded.model_review, now: "2026-11-13T03:00:00.000Z" });
  assert.equal(stored.inserted, 2);
  assert.equal(repeated.inserted, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles").get().n, 0);
});

test("a failed hour keeps the last successful articles", async () => {
  const previous = { articles: [{ original_title: "既有新竹市公告", source_url: "https://www.hccg.gov.tw/a" }], last_success_at: "2026-11-13T01:00:00+08:00" };
  const failed = await runHour({
    previous,
    now: "2026-11-13T02:00:00+08:00",
    adapters: [{ id: "down", async fetch() { throw new Error("timeout"); }, normalize() { return []; } }],
    fetcher: async () => ({ ok: false, status: 503, text: async () => "" }),
  });
  assert.equal(failed.retained, true);
  assert.equal(failed.articles.length, 1);
  assert.equal(failed.last_success_at, "2026-11-13T01:00:00+08:00");
  const poll = publicationFields({ original_title: "新竹市民調支持度", source_url: "https://www.cna.com.tw/a", publisher_timestamp: "2026-11-13", source_type: "news_rss", summary: "支持度" });
  assert.equal(poll.verification_status, "UNVERIFIED");
  assert.equal(poll.claim_kind, "poll");
  assert.equal(poll.fact_fields_allowed, false);
  const speech = publicationFields({ original_title: "吳旭智：將持續爭取選民認同", source_url: "https://www.cna.com.tw/b", publisher_timestamp: "2026-11-13T14:16:16.000Z", source_type: "news_rss" });
  assert.equal(speech.claim_kind, "candidate_statement");
  assert.equal(speech.fact_fields_allowed, false);
  const speechProject = publicationFields({ original_title: "候選人助選並視察開工", source_url: "https://www.cna.com.tw/c", publisher_timestamp: "2026-11-13", source_type: "news_rss" });
  assert.equal(speechProject.claim_kind, "candidate_statement");
  assert.equal(speechProject.fact_fields_allowed, false);
  const legal = publicationFields({ original_title: "新竹工程案起訴", source_url: "https://www.cna.com.tw/d", publisher_timestamp: "2026-11-13", source_type: "news_rss" });
  assert.equal(legal.claim_kind, "legal_status");
  assert.equal(legal.verification_status, "UNVERIFIED");
  assert.equal(legal.fact_fields_allowed, false);
  for (const title of ["新竹搜索", "新竹偵查", "新竹交保", "新竹聲押"]) {
    const stage = publicationFields({ original_title: title, source_url: "https://www.cna.com.tw/legal", publisher_timestamp: "2026-11-13", source_type: "news_rss" });
    assert.equal(stage.claim_kind, "legal_status");
    assert.equal(stage.verification_status, "UNVERIFIED");
    assert.equal(stage.review_status, "needs_review");
    assert.equal(stage.fact_fields_allowed, false);
  }
  const { pageDateAgrees } = await import("../src/verify.js");
  const { readPagePublishedAt } = await import("../src/verify.js");
  assert.equal(readPagePublishedAt('"datePublished": "2026-11-13T21:56:00+08:00"'), "2026-11-13T13:56:00.000Z");
  assert.equal(pageDateAgrees("2026-11-13T14:16:16.000Z", '"datePublished": "2026-11-13T21:56:00+08:00"'), false);
  assert.equal(pageDateAgrees("2026-11-13T14:16:16.000Z", '"datePublished": "2026-11-13T21:56:00+08:00"', { dayOnly: true }), true);
  const { dateCheckOptions } = await import("../src/run.js");
  assert.equal(pageDateAgrees("2026-11-13T05:55:00.000Z", '"datePublished": "2026-11-13T13:43:22+08:00"', dateCheckOptions({ source_type: "official_rss" })), true);
  assert.equal(pageDateAgrees("2026-11-13T05:55:00.000Z", '"datePublished": "2026-11-12T13:43:22+08:00"', dateCheckOptions({ source_type: "official_rss" })), false);
  assert.equal(dateCheckOptions({ source_type: "news_rss", feed_time_kind: "" }).dayOnly, false);
  const { normalizeCnaAtom } = await import("../src/adapters.js");
  const cna = normalizeCnaAtom('<entry><title>竹北開工</title><link href="https://www.cna.com.tw/a"/><updated>2026-11-13T22:16:16+08:00</updated></entry>');
  assert.equal(cna[0].feed_time_kind, "updated");
  assert.equal(pageDateAgrees("2026-11-13T09:05:00.000Z", '"datePublished": "2026-11-13 17:05:09"'), true);
  assert.equal(pageDateAgrees("2026-11-13T09:05:00.000Z", '"datePublished": "2026-11-12 17:05:09"'), false);
  assert.equal(pageDateAgrees("2026-11-13T09:05:00.000Z", "<p>沒有日期</p>"), null);
  assert.equal(pageDateAgrees("2026-11-06", "<p>發布日期：115-11-06</p>"), true);
  assert.equal(pageDateAgrees("2026-11-13T09:05:00.000Z", '"datePublished": "2026-11-13 17:05:09" 發布日期：115-11-12'), true);
  assert.equal(pageDateAgrees("2026-11-06", "<p>發布日期：115-11-05</p>"), false);
  const project = publicationFields({ original_title: "新竹市立棒球場改善工程正式完工", source_url: "https://www.hccg.gov.tw/a", publisher_timestamp: "2026-11-01", source_type: "official_html" });
  assert.equal(project.claim_kind, "project_progress");
  assert.equal(project.fact_fields_allowed, false);
  assert.deepEqual(mergeRun(previous, { ok: false, error: "down" }).articles, previous.articles);
});

test("newer dated items outrank older ones and council notices keep their source date", async () => {
  const older = { original_title: "新竹縣舊公告", source_url: "https://www.hsinchu.gov.tw/old", publisher_timestamp: "2026-10-01", source_id: "hsinchu-county-news" };
  const newer = { original_title: "新竹市新公告", source_url: "https://www.hccg.gov.tw/new", publisher_timestamp: "2026-11-13T09:00:00.000Z", source_id: "hsinchu-city-news" };
  assert.equal(selectArticles([older, newer])[0].source_url, newer.source_url);
  const { normalizeCouncilHtml } = await import("../src/adapters.js");
  const rows = normalizeCouncilHtml(`<main class="new"><section class="new_list"><a href="detail?program=151&article=3465"></a><p class="new-box__date">2026.10.30</p><h4 class="new-box__title">本會第20屆第8次定期會延會變更議事日程表<公告></h4></section><section class="new_list"><a href="detail?program=151&article=3442"></a><p class="new-box__date">2026.10.27</p><h4 class="new-box__title">本會第20屆第8次定期會變更議事日程表</h4></section><section class="trivia-box__list"><a href="detail?article=1"></a><p class="trivia-box-date">2026-02-13</p><h3>活動花絮</h3></section></main>`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].original_title, "本會第20屆第8次定期會延會變更議事日程表<公告>");
  assert.equal(rows[0].publisher_timestamp, "2026-10-30");
  assert.equal(rows[0].source_url, "https://www.hcc.gov.tw/detail?program=151&article=3465");
  assert.equal(rows[1].source_url, "https://www.hcc.gov.tw/detail?program=151&article=3442");
  assert.equal(rows[0].region_id, "hsinchu-county");
  assert.equal(selectArticles(rows).length, 0);
});

test("city list keeps a dated municipal item and drops a blank date", async () => {
  const { normalizeCityHtml } = await import("../src/adapters.js");
  const rows = normalizeCityHtml('<a href="/hccg/app/data/view?module=municipalnews&amp;id=1" title="新竹市道路修復"><span class="date">115-11-12</span></a><a href="/hccg/app/data/view?module=municipalnews&amp;id=2" title="沒有日期"><span class="date"></span></a>');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].publisher_timestamp, "2026-11-12");
  assert.equal(rows[0].source_url, "https://www.hccg.gov.tw/hccg/app/data/view?module=municipalnews&id=1");
  const headed = normalizeCityHtml('<a href="/hccg/app/data/view?module=municipalnews&amp;id=9"><h3>新竹市堤防整修</h3><div class="griddate">115-11-13</div></a>');
  assert.equal(headed.length, 1);
  assert.equal(headed[0].original_title, "新竹市堤防整修");
  assert.equal(headed[0].publisher_timestamp, "2026-11-13");
  const shell = normalizeCityHtml("<html><title>市政新聞-新竹市政府全球資訊網</title><p>您的瀏覽器不支援JavaScript功能，若網頁功能無法正常使用時，請開啟瀏覽器JavaScript狀態</p></html>");
  assert.deepEqual(shell, []);
});

test("final accounts keep blank amounts empty and stay out of the news list", async () => {
  const { normalizeFinalAccounts } = await import("../src/adapters.js");
  const rows = normalizeFinalAccounts(JSON.stringify([
    { "年度": "105", "歲出決算數": "1" },
    { "年度": "106", "歲出決算數": "19340599" },
    { "年度": "107", "歲出決算數": "" },
    { "年度": "108", "歲出決算數": "0" },
    { "年度": "109", "歲出決算數": "25151903.17" },
  ]));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].year, 2017);
  assert.equal(rows[1].spent_amount, null);
  assert.equal(rows[2].spent_amount, "0");
  assert.equal(rows[3].spent_amount, "25151903.17");
  assert.equal(selectArticles(rows).length, 0);
  const retained = await runHour({
    previous: { articles: [], public_records: [{ year: 2020, spent_amount: "1", unit: null }] },
    now: "2026-11-13T02:00:00.000Z",
    adapters: [
      { id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } },
      { id: "hsc-expenditure-final", async fetch() { throw new Error("timeout"); }, normalize() { return []; } },
    ],
    fetcher: async () => ({ ok: false, status: 503, text: async () => "" }),
  });
  assert.equal(retained.public_records[0].spent_amount, "1");
  assert.equal(retained.articles.length, 1);
});

test("a verification change revises the stored article", async () => {
  const { openNewsDb } = await import("../src/local-db.js");
  const { persistArticles } = await import("../src/persist.js");
  const db = openNewsDb(":memory:");
  const article = {
    original_title: "新竹縣道路公告",
    source_url: "https://www.hsinchu.gov.tw/a",
    publisher_timestamp: "2026-11-13",
    region_id: "hsinchu-county",
    verification_status: "UNVERIFIED",
    review_status: "needs_review",
    claim_kind: "official_notice",
    source_name: "新竹縣政府",
    source_type: "official_rss",
  };
  await persistArticles(db, { articles: [article], now: "2026-11-13T02:00:00.000Z" });
  const revised = await persistArticles(db, {
    articles: [{ ...article, verification_status: "SINGLE_SOURCE", review_status: "pending_index", date_checked: true, page_published_at: "2026-11-13T09:05:00.000Z", feed_time_kind: "published" }],
    now: "2026-11-13T03:00:00.000Z",
  });
  const row = await db.prepare("SELECT verification_status, content_version, date_checked, page_published_at FROM articles").first();
  assert.equal(revised.revised, 1);
  assert.equal(row.verification_status, "SINGLE_SOURCE");
  assert.equal(row.content_version, 2);
  assert.equal(row.date_checked, 1);
  assert.equal(row.page_published_at, "2026-11-13T09:05:00.000Z");
});

test("a retracted source stays out of the next published list", async () => {
  const { hiddenSourceUrls, openNewsDb, withoutHidden } = await import("../src/local-db.js");
  const { persistArticles } = await import("../src/persist.js");
  const db = openNewsDb(":memory:");
  await persistArticles(db, {
    articles: [{
      original_title: "新竹縣已撤稿",
      source_url: "https://www.hsinchu.gov.tw/retracted",
      publisher_timestamp: "2026-11-13",
      region_id: "hsinchu-county",
      verification_status: "RETRACTED",
      review_status: "retracted",
      claim_kind: "official_notice",
      source_name: "新竹縣政府",
      source_type: "official_rss",
    }],
    now: "2026-11-13T02:00:00.000Z",
  });
  const hidden = await hiddenSourceUrls(db);
  const visible = withoutHidden([
    { source_url: "https://www.hsinchu.gov.tw/retracted", original_title: "新竹縣已撤稿" },
    { source_url: "https://www.hsinchu.gov.tw/live", original_title: "新竹縣仍在" },
  ], hidden);
  assert.equal(hidden.has("https://www.hsinchu.gov.tw/retracted"), true);
  assert.deepEqual(visible.map((article) => article.source_url), ["https://www.hsinchu.gov.tw/live"]);
});

test("a scheduled success does not revive a retracted article", async () => {
  const { openNewsDb } = await import("../src/local-db.js");
  const { persistArticles } = await import("../src/persist.js");
  const { applyScheduledResult } = await import("../src/index.js");
  const db = openNewsDb(":memory:");
  const retracted = {
    original_title: "新竹縣已撤稿",
    source_url: "https://www.hsinchu.gov.tw/retracted",
    publisher_timestamp: "2026-11-13T09:00:00.000Z",
    region_id: "hsinchu-county",
    verification_status: "RETRACTED",
    review_status: "retracted",
    claim_kind: "official_notice",
    source_name: "新竹縣政府",
    source_type: "official_rss",
  };
  await persistArticles(db, { articles: [retracted], now: "2026-11-13T01:00:00.000Z" });
  const fresh = { ...retracted, source_url: "https://www.hsinchu.gov.tw/live", original_title: "新竹縣新公告", verification_status: "SINGLE_SOURCE", review_status: "pending_index" };
  await applyScheduledResult(db, { articles: [] }, {
    ok: true,
    articles: [{ ...retracted, verification_status: "SINGLE_SOURCE", review_status: "pending_index" }, fresh],
    last_success_at: "2026-11-13T02:00:00.000Z",
    announcements: [],
  });
  const oldRow = await db.prepare("SELECT verification_status FROM articles WHERE source_url = ?").bind(retracted.source_url).first();
  const visible = await db.prepare("SELECT source_url FROM articles WHERE verification_status != 'RETRACTED'").all();
  assert.equal(oldRow.verification_status, "RETRACTED");
  assert.deepEqual(visible.results.map((row) => row.source_url), [fresh.source_url]);
});

test("local database opens the final-account migration", async () => {
  const { openNewsDb } = await import("../src/local-db.js");
  const db = openNewsDb(":memory:");
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE name = 'final_accounts'").first();
  assert.equal(table.name, "final_accounts");
});

test("published news file stays within the real cap", () => {
  const data = JSON.parse(readFileSync(new URL("../../../public/data/news-intel/latest.json", import.meta.url), "utf8"));
  assert.ok(data.count <= 20);
  assert.equal(data.gemini.use, false);
  assert.equal(data.gemini.called, false);
  assert.ok(data.articles.every((article) => article.title && allowedUrl(article.url)));
  assert.equal(typeof data.duration_ms, "number");
  assert.ok(data.duration_ms >= 0);
  assert.ok(Array.isArray(data.changes?.added) && Array.isArray(data.changes?.removed));
  assert.ok(data.articles.every((article) => article.verification_status !== "VERIFIED_OFFICIAL" && article.verification_status !== "VERIFIED_MULTI_SOURCE"));
  const taipeiDay = (value) => {
    const text = String(value || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(text));
  };
  for (const article of data.articles) {
    if (article.date_checked === true && article.page_published_at) {
      assert.equal(taipeiDay(article.published_at), taipeiDay(article.page_published_at), article.title);
    }
  }
  assert.ok((data.public_records || []).every((record) => record.unit === null && (record.spent_amount === null || typeof record.spent_amount === "string")));
  if (data.city_catalog) {
    assert.equal(data.city_catalog.datasets, undefined);
    assert.ok(data.city_catalog.count > 0);
  }
  assert.ok(data.population.rows.length >= 13);
  assert.match(data.population.period, /^\d{4}-\d{2}$/);
  assert.equal(data.population.rows.some((row) => row.area_code === "10004000" && row.area_label === "D-"), true);
  assert.ok(data.population.rows.every((row) => row.total === null || /^\d+$/.test(row.total)));
  assert.equal(JSON.stringify(data.population).includes("@"), false);
  assert.ok(data.parking.count >= 100);
  assert.equal(data.parking.lots, undefined);
  const parking = JSON.parse(readFileSync(new URL("../../../public/data/news-intel/parking.json", import.meta.url), "utf8"));
  assert.equal(parking.lots.length, data.parking.count);
  assert.ok(parking.lots.every((lot) => lot.name && (lot.spaces === null || typeof lot.spaces === "string")));
  assert.ok(parking.lots.every((lot) => !Object.keys(lot).some((key) => /電話|公司|證號|分機/.test(key))));
  assert.ok(parking.lots.filter((lot) => lot.district === "新埔鄉").every((lot) => lot.region_id === null));
  assert.ok(data.schools.count >= 80);
  assert.match(data.schools.period, /^\d{4}$/);
  assert.equal(data.schools.schools, undefined);
  const schools = JSON.parse(readFileSync(new URL("../../../public/data/news-intel/school-zones.json", import.meta.url), "utf8"));
  assert.equal(schools.schools.length, data.schools.count);
  assert.equal(schools.period_text, data.schools.period_text);
  assert.ok(schools.schools.every((row) => row.name && row.township && (row.zone === null || typeof row.zone === "string")));
  assert.ok(data.visitors.rows.length >= 1);
  assert.match(data.visitors.period, /^\d{4}-\d{2}$/);
  assert.equal(data.visitors.total, undefined);
  assert.ok(data.visitors.rows.every((row) => row.name && (row.visits === null || /^\d+$/.test(row.visits)) && (row.change === null || /^-?\d+$/.test(row.change))));
  assert.equal(data.election.published_at, null);
  assert.ok(String(data.election.title || "").includes("抽籤結果"));
  assert.ok(data.election.files.length >= 1);
  assert.ok(data.election.files.every((file) => String(file.url).startsWith("https://web.cec.gov.tw/api/file/") && String(file.url).endsWith(".pdf")));
  assert.equal(JSON.stringify(data.election).includes("鄭朝方"), false);
  assert.ok(data.beds.rows.length >= 1);
  assert.equal(data.beds.total, undefined);
  assert.ok(data.beds.rows.every((row) => row.name && (row.acute_general_open === null || /^\d+$/.test(row.acute_general_open)) && (row.acute_general_permitted === null || /^\d+$/.test(row.acute_general_permitted))));
  assert.equal(data.debt.unit, "新臺幣元");
  assert.match(data.debt.period, /^\d{4}-\d{2}$/);
  assert.ok([data.debt.long_term, data.debt.short_term, data.debt.per_person, data.debt.self_liquidating].every((value) => value === null || /^\d+$/.test(value)));
  assert.equal(data.air.unit, null);
  assert.match(data.air.period, /^\d{4}-\d{2}$/);
  assert.match(data.air.period_text, /^\d{5}$/);
  assert.ok(data.air.rows.length >= 1);
  assert.ok(data.air.rows.every((row) => row.station && [row.tsp, row.pm10, row.pm25, row.dust].every((value) => value === null || /^\d+(?:\.\d+)?$/.test(value))));
});

test("a failed council fetch keeps the previous notices", async () => {
  const previous = { articles: [], announcements: [{ title: "舊公告", url: "https://www.hcc.gov.tw/detail?program=151&article=1", published_at: "2026-10-30", source_name: "新竹縣議會" }] };
  const result = await runHour({
    previous,
    now: "2026-11-13T02:00:00.000Z",
    adapters: [
      { id: "hsinchu-county-news", async fetch() { return ""; }, normalize() { return [{ original_title: "新竹縣道路公告", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13", source_id: "hsinchu-county-news", source_name: "新竹縣政府", source_type: "official_rss" }]; } },
      { id: "hsinchu-county-council", async fetch() { throw new Error("timeout"); }, normalize() { return []; } },
    ],
    fetcher: async () => ({ ok: false, status: 503, text: async () => "" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.announcements.length, 1);
  assert.equal(result.announcements[0].title, "舊公告");
  const registry = await handleMcp({ authorization: "Bearer reader-token", tokens, body: { tool: "list_source_registry" } });
  assert.equal(registry.body.sources.some((source) => source.id === "hsinchu-county-council" && source.url === "https://www.hcc.gov.tw/" && source.needs_key === false), true);
  const failed = await handleMcp({ authorization: "Bearer reader-token", tokens, state: { failures: [{ id: "hsinchu-county-council", error: "timeout" }] }, body: { tool: "get_failed_sources" } });
  assert.equal(failed.body.failures[0].id, "hsinchu-county-council");
});

test("mcp checks dates, duplicates, and refuses unverified facts", async () => {
  const date = await handleMcp({
    authorization: "Bearer verifier-token",
    tokens,
    body: { tool: "verify_publication_date", input: { publisher_timestamp: "不是日期" } },
  });
  assert.equal(date.body.accepted, false);
  const dupes = await handleMcp({
    authorization: "Bearer verifier-token",
    tokens,
    body: { tool: "detect_duplicate_articles", input: { articles: [
      { original_title: "竹北開工", source_url: "https://www.hsinchu.gov.tw/a" },
      { original_title: "竹北開工", source_url: "https://www.cna.com.tw/b" },
    ] } },
  });
  assert.equal(dupes.body.events, 1);
  const related = await handleMcp({
    authorization: "Bearer reader-token",
    tokens,
    body: { tool: "find_related_events", input: { articles: [
      { original_title: "竹北道路開工", source_url: "https://www.cna.com.tw/a", publisher_timestamp: "2026-11-13T02:00:00Z", source_id: "cna-atom" },
      { original_title: "竹北道路開工", source_url: "https://www.hsinchu.gov.tw/b", publisher_timestamp: "2026-11-13T01:00:00Z", source_id: "hsinchu-county-news" },
    ] } },
  });
  assert.equal(related.status, 200);
  assert.deepEqual(related.body.articles[0].related_urls, ["https://www.hsinchu.gov.tw/b"]);
  const refused = await handleMcp({
    authorization: "Bearer publisher-token",
    tokens,
    body: { tool: "approve_verified_article", input: { verification_status: "SINGLE_SOURCE" } },
  });
  assert.equal(refused.status, 409);
  const idempotency = new Map();
  const rateStore = new Map();
  const batch = {
    tool: "submit_article_batch",
    idempotency_key: "batch-1",
    input: { articles: [{ original_title: "竹北道路開工", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13T02:00:00Z", source_id: "hsinchu-county-news" }] },
  };
  const rate = { idempotency, rateStore, now: 1_000, rateLimit: 1 };
  const first = await handleMcp({ authorization: "Bearer collector-token", tokens, state: rate, body: batch });
  const replay = await handleMcp({ authorization: "Bearer collector-token", tokens, state: rate, body: batch });
  const limited = await handleMcp({ authorization: "Bearer collector-token", tokens, state: rate, body: { ...batch, idempotency_key: "batch-2" } });
  assert.equal(first.status, 202);
  assert.equal(first.body.accepted, 1);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.accepted, 1);
  assert.equal(limited.status, 429);
});

test("migration creates the article and audit tables", () => {
  const sql = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
  for (const table of ["articles", "events", "review_queue", "agent_runs", "audit_logs", "project_budgets", "poll_methodologies"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /UNIQUE\(source_url\)/);
  assert.match(sql, /approved_twd/);
  assert.match(sql, /spent_twd/);
});

test("applied migration serves articles and keeps unverified claims out of fact tables", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { persistArticles, snapshotPayload } = await import("../src/persist.js");
  const worker = (await import("../src/index.js")).default;
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0002_snapshot.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0004_article_dates.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0005_related_urls.sql", import.meta.url), "utf8"));
  const d1 = {
    prepare(sql) {
      const statement = (params) => ({
        bind(...next) {
          return statement(next);
        },
        async run() {
          db.prepare(sql).run(...params);
          return { success: true };
        },
        async all() {
          return { results: db.prepare(sql).all(...params) };
        },
        async first() {
          return db.prepare(sql).get(...params) || null;
        },
      });
      return statement([]);
    },
  };
  const articles = [
    {
      original_title: "竹北道路開工",
      source_url: "https://www.hsinchu.gov.tw/a",
      publisher_timestamp: "2026-11-13T01:00:00.000Z",
      region_id: "zhubei",
      verification_status: "SINGLE_SOURCE",
      review_status: "pending_index",
      source_name: "新竹縣政府",
      source_type: "official_rss",
      fetched_at: "2026-11-13T02:00:00.000Z",
      related_urls: ["https://www.cna.com.tw/related", "http://example.com/no"],
    },
    {
      original_title: "新竹市民調支持度",
      source_url: "https://www.cna.com.tw/b",
      publisher_timestamp: "2026-11-13T01:30:00.000Z",
      region_id: "hsinchu-city",
      verification_status: "UNVERIFIED",
      review_status: "needs_review",
      source_name: "中央社",
      source_type: "news_rss",
      fetched_at: "2026-11-13T02:00:00.000Z",
    },
  ];
  const first = await persistArticles(d1, { articles, now: "2026-11-13T02:00:00.000Z" });
  const repeat = await persistArticles(d1, { articles, now: "2026-11-13T03:00:00.000Z" });
  const revised = await persistArticles(d1, {
    articles: [{ ...articles[0], original_title: "竹北道路開工更正" }],
    now: "2026-11-13T04:00:00.000Z",
  });
  const response = await worker.fetch(new Request("https://news.local/api/v1/news"), { DB: d1 });
  const body = await response.json();
  assert.equal(first.inserted, 2);
  assert.equal(repeat.inserted + repeat.revised, 0);
  assert.equal(revised.revised, 1);
  assert.equal(body.articles.length, 2);
  assert.deepEqual(body.articles.find((article) => article.source_url === "https://www.hsinchu.gov.tw/a").related_urls, ["https://www.cna.com.tw/related"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM poll_results").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_budgets").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM review_queue WHERE status = 'open'").get().n, 1);
  assert.equal(db.prepare("SELECT content_version FROM articles WHERE source_url = ?").get(articles[0].source_url).content_version, 2);
  const { persistAnnouncements } = await import("../src/persist.js");
  const notices = await persistAnnouncements(d1, {
    announcements: [{ original_title: "本會第20屆第8次定期會延會變更議事日程表", source_url: "https://www.hcc.gov.tw/detail?program=151&article=3465", publisher_timestamp: "2026-10-30" }],
    now: "2026-11-13T02:00:00.000Z",
  });
  const repeated = await persistAnnouncements(d1, {
    announcements: [{ original_title: "本會第20屆第8次定期會延會變更議事日程表", source_url: "https://www.hcc.gov.tw/detail?program=151&article=3465", publisher_timestamp: "2026-10-30" }],
    now: "2026-11-13T03:00:00.000Z",
  });
  assert.equal(notices.inserted, 1);
  assert.equal(repeated.inserted, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM government_announcements").get().n, 1);
  const kept = snapshotPayload({ articles: [{ original_title: "舊資料" }], last_success_at: "2026-11-13T01:00:00.000Z" }, { ok: true, articles: [] });
  assert.equal(kept.replaced, false);
  assert.equal(kept.articles.length, 1);
  const { sameSnapshot } = await import("../src/publish-gate.js");
  const { deployCommand, PUBLISH_TIMEOUT_MS } = await import("../src/publish-gate.js");
  assert.match(deployCommand("C:\\mirror", "C:\\wrangler.js"), /node "C:\\wrangler.js" pages deploy .*--commit-message "Publish the hourly Hsinchu news index"/);
  assert.equal(PUBLISH_TIMEOUT_MS < 60 * 60 * 1000, true);
  const { cloudflareApiReachable } = await import("../src/publish-gate.js");
  assert.equal((await cloudflareApiReachable(async () => { throw new Error("timeout"); })).ok, false);
  let probed = "";
  assert.equal((await cloudflareApiReachable(async (url) => { probed = url; return { status: 200 }; })).ok, true);
  assert.equal(probed.includes("/pages/projects/hsinchu-watch"), true);
  assert.equal((await cloudflareApiReachable(async () => ({ status: 400 }))).status, 400);
  assert.equal((await cloudflareApiReachable(async () => ({ status: 403 }))).ok, false);
  assert.equal((await cloudflareApiReachable(async () => ({ status: 503 }))).ok, false);
  const { cloudflareAuthHeaders, cloudflareRefreshNeeded } = await import("../src/publish-gate.js");
  assert.equal(cloudflareRefreshNeeded('oauth_token = "test-token"\nexpiration_time = "2099-01-01T00:00:00.000Z"\nrefresh_token = "refresh"', Date.parse("2026-11-13T16:00:00.000Z")), false);
  assert.equal(cloudflareRefreshNeeded('oauth_token = "test-token"\nexpiration_time = "2026-11-13T16:16:00.000Z"\nrefresh_token = "refresh"', Date.parse("2026-11-13T16:14:00.000Z")), true);
  assert.equal(cloudflareRefreshNeeded('oauth_token = "test-token"\nexpiration_time = "2020-01-01T00:00:00.000Z"', Date.parse("2026-11-13T16:14:00.000Z")), false);
  assert.deepEqual(cloudflareAuthHeaders(""), {});
  assert.deepEqual(cloudflareAuthHeaders('oauth_token = "test-token"\nexpiration_time = "2020-01-01T00:00:00.000Z"'), {});
  assert.equal(cloudflareAuthHeaders('oauth_token = "test-token"\nexpiration_time = "2099-01-01T00:00:00.000Z"').authorization, "Bearer test-token");
  assert.equal(sameSnapshot({ index: "a", civic: "b" }, { index: "a", civic: "c" }), false);
  assert.equal(sameSnapshot({ index: "a", civic: "b" }, { index: "a", civic: "b" }), true);
  const unconnected = await handleMcp({ authorization: "Bearer collector-token", tokens, body: { tool: "sync_poll_metadata" } });
  assert.equal(unconnected.status, 409);
  const refusedDataset = await handleMcp({ authorization: "Bearer collector-token", tokens, body: { tool: "import_government_dataset", input: { dataset: "unknown" } } });
  const imported = await handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    body: { tool: "import_government_dataset", input: { dataset: "hsc-expenditure-final", payload: JSON.stringify([{ "年度": "109", "歲出決算數": "25151903.17" }, { "年度": "108", "歲出決算數": "" }]) } },
  });
  assert.equal(refusedDataset.status, 409);
  assert.equal(imported.body.records[0].spent_amount, null);
  assert.equal(imported.body.records[1].spent_amount, "25151903.17");
  assert.equal(imported.body.stored, false);
  const rejected = await handleMcp({ authorization: "Bearer publisher-token", tokens, db: d1, body: { tool: "reject_article", input: { source_url: articles[1].source_url } } });
  const retracted = await handleMcp({ authorization: "Bearer admin-token", tokens, db: d1, body: { tool: "retract_article", input: { source_url: articles[0].source_url } } });
  const after = await worker.fetch(new Request("https://news.local/api/v1/news"), { DB: d1 });
  const visible = await after.json();
  assert.equal(rejected.status, 200);
  assert.equal(retracted.status, 200);
  assert.equal(visible.articles.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM articles").get().n, 2);
  const found = await handleMcp({ authorization: "Bearer reader-token", tokens, db: d1, body: { tool: "search_existing_articles", input: { query: "竹北道路開工更正" } } });
  assert.equal(found.body.articles.length, 1);
  assert.equal(found.body.articles[0].verification_status, "RETRACTED");
});

test("a failed scheduled round keeps the previous database rows", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { applyScheduledResult } = await import("../src/index.js");
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0002_snapshot.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0004_article_dates.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0005_related_urls.sql", import.meta.url), "utf8"));
  const d1 = {
    prepare(sql) {
      const statement = (params) => ({
        bind(...next) { return statement(next); },
        async run() { db.prepare(sql).run(...params); return { success: true }; },
        async all() { return { results: db.prepare(sql).all(...params) }; },
        async first() { return db.prepare(sql).get(...params) || null; },
      });
      return statement([]);
    },
  };
  const article = {
    original_title: "新竹縣道路公告",
    source_url: "https://www.hsinchu.gov.tw/a",
    publisher_timestamp: "2026-11-13T09:00:00.000Z",
    region_id: "hsinchu-county",
    verification_status: "SINGLE_SOURCE",
    review_status: "pending_index",
    claim_kind: "official_notice",
    date_checked: true,
    page_published_at: "2026-11-13T09:00:00.000Z",
    feed_time_kind: "published",
    source_name: "新竹縣政府",
    source_type: "official_rss",
    fetched_at: "2026-11-13T10:00:00.000Z",
  };
  const first = await applyScheduledResult(d1, { articles: [] }, { ok: true, articles: [article], last_success_at: "2026-11-13T10:00:00.000Z", announcements: [] });
  const second = await applyScheduledResult(d1, { articles: [article], last_success_at: "2026-11-13T10:00:00.000Z" }, { ok: false, articles: [article], error: "all_sources_failed", announcements: [] });
  const stored = db.prepare("SELECT original_title, claim_kind FROM articles").get();
  const snapshot = db.prepare("SELECT last_success_at FROM published_snapshots WHERE id = 1").get();
  assert.equal(first.replaced, true);
  assert.equal(second.replaced, false);
  assert.equal(stored.original_title, "新竹縣道路公告");
  const visible = await (await import("../src/index.js")).default.fetch(new Request("https://news.local/api/v1/news"), { DB: d1 });
  const body = await visible.json();
  assert.equal(body.articles[0].claim_kind, "official_notice");
  assert.equal(body.articles[0].date_checked, 1);
  assert.equal(body.articles[0].page_published_at, "2026-11-13T09:00:00.000Z");
  assert.equal(stored.claim_kind, "official_notice");
  assert.equal(snapshot.last_success_at, "2026-11-13T10:00:00.000Z");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_budgets").get().n, 0);
});

test("final account text stays unchanged in the database and the read API", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { persistPublicRecords } = await import("../src/persist.js");
  const worker = (await import("../src/index.js")).default;
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0002_snapshot.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0004_article_dates.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0005_related_urls.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0003_final_accounts.sql", import.meta.url), "utf8"));
  const d1 = {
    prepare(sql) {
      const statement = (params) => ({
        bind(...next) { return statement(next); },
        async run() { db.prepare(sql).run(...params); return { success: true }; },
        async all() { return { results: db.prepare(sql).all(...params) }; },
        async first() { return db.prepare(sql).get(...params) || null; },
      });
      return statement([]);
    },
  };
  const records = [
    { year: 2018, spent_amount: "20531850.69", unit: null, dataset_url: "https://ws.hsinchu.gov.tw/a.json", list_url: "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=181", note: "原文" },
    { year: 2017, spent_amount: null, unit: null, dataset_url: "https://ws.hsinchu.gov.tw/a.json", list_url: "https://www.hsinchu.gov.tw/OpenDataDetail.aspx?n=902&s=181", note: "空欄" },
  ];
  const first = await persistPublicRecords(d1, { records, now: "2026-11-13T02:00:00.000Z" });
  const repeat = await persistPublicRecords(d1, { records, now: "2026-11-13T03:00:00.000Z" });
  const response = await worker.fetch(new Request("https://news.local/api/v1/public-records"), { DB: d1 });
  const body = await response.json();
  const queried = await handleMcp({ authorization: "Bearer reader-token", tokens, db: d1, body: { tool: "query_public_records" } });
  assert.equal(first.inserted, 2);
  assert.equal(repeat.inserted, 0);
  assert.equal(body.records[0].spent_text, "20531850.69");
  assert.equal(body.records[1].spent_text, null);
  assert.equal(queried.body.final_accounts.length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_budgets").get().n, 0);
});
