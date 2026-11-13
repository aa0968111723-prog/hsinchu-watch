import { handleMcp } from "./mcp.js";
import { decideGemini, selectArticles } from "./pipeline.js";

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
        ? await env.DB.prepare("SELECT id, original_title, source_url, publisher_timestamp, region_id, verification_status FROM articles ORDER BY publisher_timestamp DESC LIMIT 20").all()
        : { results: [] };
      return Response.json({ articles: rows.results || [], note: "pending_index 不是已查核事實" });
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      const body = await request.json().catch(() => null);
      const result = handleMcp({
        authorization: request.headers.get("authorization"),
        body,
        tokens: tokensFromEnv(env),
      });
      return Response.json(result.body, { status: result.status });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },

  async scheduled(_event, env) {
    const decision = decideGemini(env, { tokens_today: 0, requests_this_hour: 0 });
    const selected = selectArticles([]);
    if (env.DB) {
      await env.DB.prepare(
        "INSERT INTO agent_runs (id, started_at, finished_at, status, article_count, gemini_used, error) VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), "ok", selected.length, decision.use ? 1 : 0, decision.use ? null : decision.reason).run();
    }
  },
};
