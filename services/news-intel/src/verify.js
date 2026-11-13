export function parsePublisherTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{4}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

const HIGH_RISK = ["民調", "支持度", "起訴", "羈押", "判決", "預算執行率", "完工驗收"];

export function classifyArticle(article) {
  if (!article?.publisher_timestamp || !article?.source_url) return "UNVERIFIED";
  const blob = `${article.original_title || ""} ${article.summary || ""}`;
  if (HIGH_RISK.some((word) => blob.includes(word))) return "UNVERIFIED";
  if (article.source_type === "official_rss" || article.source_type === "official_html") return "SINGLE_SOURCE";
  if (article.source_type === "news_rss") return "SINGLE_SOURCE";
  return "UNVERIFIED";
}

export function publicationFields(article) {
  const status = classifyArticle(article);
  return {
    verification_status: status,
    review_status: status === "UNVERIFIED" ? "needs_review" : "pending_index",
    fact_fields_allowed: status === "VERIFIED_OFFICIAL" || status === "VERIFIED_MULTI_SOURCE",
  };
}
