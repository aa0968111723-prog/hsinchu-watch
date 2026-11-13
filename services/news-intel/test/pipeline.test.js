import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorize } from "../src/auth.js";
import { allowedUrl } from "../src/allowlist.js";
import { decideGemini, linkEvents, selectArticles } from "../src/pipeline.js";
import { handleMcp } from "../src/mcp.js";
import { mergeRun, runHour } from "../src/run.js";
import { publicationFields } from "../src/verify.js";

const tokens = { reader: "reader-token", collector: "collector-token", verifier: "verifier-token", publisher: "publisher-token", admin: "admin-token" };

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

test("published news file stays within the real cap", () => {
  const data = JSON.parse(readFileSync(new URL("../../../public/data/news-intel/latest.json", import.meta.url), "utf8"));
  assert.ok(data.count <= 20);
  assert.equal(data.gemini.use, false);
  assert.ok(data.articles.every((article) => article.title && article.url.startsWith("https://")));
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
  const refused = await handleMcp({
    authorization: "Bearer publisher-token",
    tokens,
    body: { tool: "approve_verified_article", input: { verification_status: "SINGLE_SOURCE" } },
  });
  assert.equal(refused.status, 409);
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
  const { deployCommand } = await import("../src/publish-gate.js");
  assert.match(deployCommand("C:\\mirror"), /--commit-message "Publish the hourly Hsinchu news index"/);
  assert.equal(sameSnapshot({ index: "a", civic: "b" }, { index: "a", civic: "c" }), false);
  assert.equal(sameSnapshot({ index: "a", civic: "b" }, { index: "a", civic: "b" }), true);
  const unconnected = await handleMcp({ authorization: "Bearer collector-token", tokens, body: { tool: "sync_poll_metadata" } });
  assert.equal(unconnected.status, 409);
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
