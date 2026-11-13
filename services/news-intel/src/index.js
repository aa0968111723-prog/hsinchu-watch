import { handleMcp } from "./mcp.js";
import { persistAnnouncements, persistArticles, snapshotPayload } from "./persist.js";
import { runHour } from "./run.js";

async function previousSnapshot(env) {
  if (!env.DB) return { articles: [], last_success_at: null };
  const row = await env.DB.prepare("SELECT articles_json, last_success_at FROM published_snapshots WHERE id = 1").first();
  if (!row) return { articles: [], last_success_at: null };
  return { articles: JSON.parse(row.articles_json), last_success_at: row.last_success_at };
}

function tokensFromEnv(env) {
  return {
    reader: env.NEWS_INTEL_READER_TOKEN,
    collector: env.NEWS_INTEL_COLLECTOR_TOKEN,
    verifier: env.NEWS_INTEL_VERIFIER_TOKEN,
    publisher: env.NEWS_INTEL_PUBLISHER_TOKEN,
    admin: env.NEWS_INTEL_ADMIN_TOKEN,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/v1/news") {
      const rows = env.DB
        ? await env.DB.prepare("SELECT id, original_title, source_url, publisher_timestamp, region_id, verification_status, review_status FROM articles WHERE review_status NOT IN ('rejected', 'retracted') AND verification_status != 'RETRACTED' ORDER BY publisher_timestamp DESC LIMIT 20").all()
        : { results: [] };
      return Response.json({ articles: rows.results || [], note: "pending_index 不是已查核事實" });
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      const body = await request.json().catch(() => null);
      const result = await handleMcp({
        authorization: request.headers.get("authorization"),
        body,
        tokens: tokensFromEnv(env),
        db: env.DB,
        fetcher: (target) => fetch(target, { headers: { "user-agent": "HsinchuNewsIntel/0.1" } }),
      });
      return Response.json(result.body, { status: result.status });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },

  async scheduled(_event, env) {
    const previous = await previousSnapshot(env);
    const result = await runHour({
      fetcher: (url) => fetch(url, { headers: { "user-agent": "HsinchuNewsIntel/0.1" } }),
      env,
      previous,
      now: new Date().toISOString(),
    });
    if (!env.DB) return;
    await env.DB.prepare(
      "INSERT INTO agent_runs (id, started_at, finished_at, status, article_count, gemini_used, error) VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), result.ok ? "ok" : "failed", result.articles.length, result.gemini?.use ? 1 : 0, result.ok ? null : result.error).run();
    if (result.ok && result.announcements?.length) {
      await persistAnnouncements(env.DB, { announcements: result.announcements, now: result.last_success_at });
    }
    const snapshot = snapshotPayload(previous, result);
    if (snapshot.replaced) {
      await persistArticles(env.DB, { articles: result.articles, now: result.last_success_at });
      await env.DB.prepare(
        "INSERT INTO published_snapshots (id, articles_json, last_success_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET articles_json = excluded.articles_json, last_success_at = excluded.last_success_at"
      ).bind(JSON.stringify(snapshot.articles), snapshot.last_success_at).run();
    }
  },
};
