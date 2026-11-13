import { authorize } from "./auth.js";
import { allowedUrl } from "./allowlist.js";
import { linkEvents, selectArticles } from "./pipeline.js";
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

export function handleMcp({ authorization, body, tokens, state }) {
  const tool = body?.tool;
  const gate = authorize(authorization, tool, tokens);
  if (!gate.ok) return { status: gate.status, body: { error: gate.error } };
  if (tool === "fetch_source_document" && !allowedUrl(body?.input?.url)) {
    return { status: 400, body: { error: "url_not_allowed" } };
  }
  if (tool === "submit_article_batch") {
    const articles = selectArticles(body?.input?.articles || []);
    return { status: 202, body: { accepted: articles.length, review_status: "pending_index", scope: gate.scope } };
  }
  if (tool === "verify_publication_date") {
    const parsed = parsePublisherTimestamp(body?.input?.publisher_timestamp);
    return { status: 200, body: { parsed, accepted: Boolean(parsed) } };
  }
  if (tool === "detect_duplicate_articles") {
    const articles = body?.input?.articles || [];
    return { status: 200, body: { articles: articles.length, events: linkEvents(articles).length } };
  }
  if (tool === "get_latest_successful_run") {
    return { status: 200, body: state?.lastRun || { status: "none" } };
  }
  if (tool === "approve_verified_article") {
    const status = body?.input?.verification_status;
    if (status !== "VERIFIED_OFFICIAL" && status !== "VERIFIED_MULTI_SOURCE") {
      return { status: 409, body: { error: "not_verified_fact" } };
    }
    return { status: 200, body: { approved: true, scope: gate.scope } };
  }
  if (tool === "get_pipeline_status") {
    return { status: 200, body: state || { status: "idle" } };
  }
  return { status: 200, body: { tool, scope: gate.scope, result: "ok" } };
}
