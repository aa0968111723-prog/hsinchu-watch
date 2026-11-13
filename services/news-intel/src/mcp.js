import { ADAPTERS, normalizeFinalAccounts } from "./adapters.js";
import { authorize } from "./auth.js";
import { allowedUrl } from "./allowlist.js";
import { linkEvents, regionFor, selectArticles } from "./pipeline.js";
import { persistPublicRecords } from "./persist.js";
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

const UNCONNECTED = new Set([
  "sync_governance_records", "sync_transport_data", "sync_environment_data",
  "sync_election_data", "sync_poll_metadata",
]);

function sources() {
  return ADAPTERS.map((adapter) => ({ id: adapter.id, kind: adapter.kind, ...adapter.discover() }));
}

async function audit(db, actor, action, target) {
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), actor, action, target, new Date().toISOString()).run();
}

export async function handleMcp({ authorization, body, tokens, state, db, fetcher }) {
  const tool = body?.tool;
  const input = body?.input || {};
  const gate = authorize(authorization, tool, tokens);
  if (!gate.ok) return { status: gate.status, body: { error: gate.error } };
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
    return { status: 200, body: { records, stored: Boolean(db) } };
  }
  if (UNCONNECTED.has(tool)) return { status: 409, body: { error: "adapter_not_connected" } };
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
    return { status: 202, body: { accepted: articles.length, articles, review_status: "pending_index", scope: gate.scope } };
  }
  if (tool === "extract_article_metadata") {
    const published = parsePublisherTimestamp(input.publisher_timestamp);
    return { status: 200, body: { original_title: String(input.original_title || "").trim(), source_url: String(input.source_url || ""), publisher_timestamp: published, region_id: regionFor(`${input.original_title || ""} ${input.summary || ""}`), accepted: Boolean(published && input.source_url && input.original_title) } };
  }
  if (tool === "verify_publication_date") {
    const parsed = parsePublisherTimestamp(input.publisher_timestamp);
    return { status: 200, body: { parsed, accepted: Boolean(parsed) } };
  }
  if (tool === "detect_duplicate_articles" || tool === "find_related_events") {
    const articles = input.articles || [];
    return { status: 200, body: { articles: articles.length, events: linkEvents(articles).length } };
  }
  if (tool === "compare_source_claims") {
    const left = String(input.left || "").trim();
    const right = String(input.right || "").trim();
    if (!left || !right) return { status: 400, body: { error: "claims_required" } };
    return { status: 200, body: { relation: left === right ? "same" : "disputed" } };
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
    return { status: 200, body: { records: rows.results || [], final_accounts: accounts.results || [] } };
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
