import { handleMcp } from "./mcp.js";
import { persistAnnouncements, persistArticles, persistModelReview, persistPublicRecords, snapshotPayload } from "./persist.js";
import { runHour, sourceFetch } from "./run.js";

async function previousSnapshot(env) {
  if (!env.DB) return { articles: [], last_success_at: null };
  const row = await env.DB.prepare("SELECT articles_json, last_success_at FROM published_snapshots WHERE id = 1").first();
  if (!row) return { articles: [], last_success_at: null };
  return { articles: JSON.parse(row.articles_json), last_success_at: row.last_success_at };
}

const mcpState = { idempotency: new Map() };

function tokensFromEnv(env) {
  return {
    reader: env.NEWS_INTEL_READER_TOKEN,
    collector: env.NEWS_INTEL_COLLECTOR_TOKEN,
    verifier: env.NEWS_INTEL_VERIFIER_TOKEN,
    publisher: env.NEWS_INTEL_PUBLISHER_TOKEN,
    admin: env.NEWS_INTEL_ADMIN_TOKEN,
  };
}

export async function applyScheduledResult(db, previous, result) {
  if (result?.ok && result.articles?.length) {
    const hiddenRows = await db.prepare("SELECT source_url FROM articles WHERE review_status IN ('rejected', 'retracted') OR verification_status = 'RETRACTED'").all();
    const hidden = new Set((hiddenRows.results || []).map((row) => row.source_url));
    result.articles = result.articles.filter((article) => !hidden.has(article.source_url));
  }
  await db.prepare(
    "INSERT INTO agent_runs (id, started_at, finished_at, status, article_count, gemini_used, error) VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), result.ok ? "ok" : "failed", result.articles?.length || 0, result.gemini?.use ? 1 : 0, result.ok ? null : result.error || null).run();
  if (result.ok && result.announcements?.length) {
    await persistAnnouncements(db, { announcements: result.announcements, now: result.last_success_at });
  }
  if (result.ok && result.public_records?.length) {
    await persistPublicRecords(db, { records: result.public_records, now: result.last_success_at });
  }
  if (result.ok && result.model_review?.length) {
    await persistModelReview(db, { proposals: result.model_review, now: result.last_success_at });
  }
  const snapshot = snapshotPayload(previous, result);
  if (snapshot.replaced) {
    await persistArticles(db, { articles: result.articles, now: result.last_success_at });
    await db.prepare(
      "INSERT INTO published_snapshots (id, articles_json, last_success_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET articles_json = excluded.articles_json, last_success_at = excluded.last_success_at"
    ).bind(JSON.stringify(snapshot.articles), snapshot.last_success_at).run();
  }
  return snapshot;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/v1/public-records") {
      const rows = env.DB
        ? await env.DB.prepare("SELECT year, spent_text, unit, dataset_url, list_url, note FROM final_accounts ORDER BY year DESC").all()
        : { results: [] };
      return Response.json({ records: rows.results || [], note: "spent_text 是資料檔原文，不是驗收或實支" });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/news") {
      const rows = env.DB
        ? await env.DB.prepare("SELECT id, original_title, source_url, publisher_timestamp, region_id, verification_status, review_status, claim_kind, date_checked, page_published_at, feed_time_kind, related_urls FROM articles WHERE review_status NOT IN ('rejected', 'retracted') AND verification_status != 'RETRACTED' ORDER BY publisher_timestamp DESC LIMIT 20").all()
        : { results: [] };
      const articles = (rows.results || []).map((row) => {
        let related = [];
        try {
          related = JSON.parse(row.related_urls || "[]");
        } catch {
          related = [];
        }
        return { ...row, related_urls: Array.isArray(related) ? related : [] };
      });
      return Response.json({ articles, note: "pending_index 不是已查核事實" });
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      const body = await request.json().catch(() => null);
      const result = await handleMcp({
        authorization: request.headers.get("authorization"),
        body,
        tokens: tokensFromEnv(env),
        state: mcpState,
        db: env.DB,
        fetcher: sourceFetch,
      });
      return Response.json(result.body, { status: result.status });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },

  async scheduled(_event, env) {
    const previous = await previousSnapshot(env);
    const result = await runHour({
      fetcher: sourceFetch,
      env,
      previous,
      now: new Date().toISOString(),
    });
    if (!env.DB) return;
    await applyScheduledResult(env.DB, previous, result);
  },
};
