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
  assert.equal(selectArticles([{ original_title: "全國新聞", source_url: "https://www.cna.com.tw/a", publisher_timestamp: "2026-11-13T00:00:00+08:00" }]).length, 0);
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

test("anonymous and under-scoped writes are rejected", () => {
  assert.equal(authorize(null, "submit_article_batch", tokens).status, 401);
  assert.equal(authorize("Bearer reader-token", "submit_article_batch", tokens).status, 403);
  assert.equal(authorize("Bearer collector-token", "retract_article", tokens).status, 403);
  const accepted = handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    body: { tool: "submit_article_batch", input: { articles: [{ original_title: "竹北開工", source_url: "https://www.hsinchu.gov.tw/a", publisher_timestamp: "2026-11-13" }] } },
  });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.accepted, 1);
});

test("blocks private and off-allowlist fetches", () => {
  assert.equal(allowedUrl("http://169.254.169.254/latest"), false);
  assert.equal(allowedUrl("https://example.com/story"), false);
  assert.equal(allowedUrl("https://www.hsinchu.gov.tw/News.aspx"), true);
  const blocked = handleMcp({
    authorization: "Bearer collector-token",
    tokens,
    body: { tool: "fetch_source_document", input: { url: "https://example.com/secret" } },
  });
  assert.equal(blocked.status, 400);
});

test("gemini stays off without a key or when the cap is hit", () => {
  assert.equal(decideGemini({}, {}).use, false);
  assert.equal(decideGemini({ GEMINI_API_KEY: "present" }, { tokens_today: 200000 }).reason, "daily_token_cap");
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
  assert.equal(poll.fact_fields_allowed, false);
  assert.deepEqual(mergeRun(previous, { ok: false, error: "down" }).articles, previous.articles);
});

test("city list keeps a dated municipal item and drops a blank date", async () => {
  const { normalizeCityHtml } = await import("../src/adapters.js");
  const rows = normalizeCityHtml('<a href="/hccg/app/data/view?module=municipalnews&amp;id=1" title="新竹市道路修復"><span class="date">115-11-12</span></a><a href="/hccg/app/data/view?module=municipalnews&amp;id=2" title="沒有日期"><span class="date"></span></a>');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].publisher_timestamp, "2026-11-12");
  assert.equal(rows[0].source_url, "https://www.hccg.gov.tw/hccg/app/data/view?module=municipalnews&id=1");
});

test("published news file stays within the real cap", () => {
  const data = JSON.parse(readFileSync(new URL("../../../public/data/news-intel/latest.json", import.meta.url), "utf8"));
  assert.ok(data.count <= 20);
  assert.equal(data.gemini.use, false);
  assert.ok(data.articles.every((article) => article.title && article.url.startsWith("https://")));
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
