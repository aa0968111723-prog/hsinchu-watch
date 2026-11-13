const TOOL_SCOPES = {
  search_sources: "reader",
  list_source_registry: "reader",
  fetch_source_document: "collector",
  verify_source_url: "verifier",
  verify_publication_date: "verifier",
  collect_latest_news: "collector",
  extract_article_metadata: "collector",
  detect_duplicate_articles: "verifier",
  find_related_events: "reader",
  compare_source_claims: "verifier",
  create_article_candidate: "collector",
  submit_article_batch: "collector",
  get_review_queue: "verifier",
  approve_verified_article: "publisher",
  reject_article: "publisher",
  revise_article: "publisher",
  retract_article: "admin",
  import_government_dataset: "collector",
  sync_governance_records: "collector",
  sync_transport_data: "collector",
  sync_environment_data: "collector",
  sync_election_data: "collector",
  sync_poll_metadata: "collector",
  query_public_records: "reader",
  search_existing_articles: "reader",
  get_pipeline_status: "reader",
  get_latest_successful_run: "reader",
  get_failed_sources: "reader",
  retry_failed_job: "admin",
  list_audit_logs: "admin",
};

const RANK = { reader: 1, collector: 2, verifier: 2, publisher: 3, admin: 4 };

export function scopeFor(tool) {
  return TOOL_SCOPES[tool] || null;
}

export function authorize(authorization, tool, tokens) {
  const required = scopeFor(tool);
  if (!required) return { ok: false, status: 404, error: "unknown_tool" };
  const header = String(authorization || "");
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return { ok: false, status: 401, error: "authentication_required" };
  const token = match[1];
  const scope = Object.entries(tokens || {}).find(([, value]) => value && value === token)?.[0];
  if (!scope) return { ok: false, status: 401, error: "invalid_token" };
  if (RANK[scope] < RANK[required] || (required === "verifier" && scope === "collector") || (required === "collector" && scope === "verifier")) {
    return { ok: false, status: 403, error: "insufficient_scope", scope };
  }
  if (required === "admin" && scope !== "admin") return { ok: false, status: 403, error: "insufficient_scope", scope };
  return { ok: true, scope };
}
