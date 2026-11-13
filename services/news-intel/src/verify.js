const HIGH_RISK = ["民調", "支持度", "起訴", "羈押", "判決", "預算執行率", "完工驗收"];

export function classifyArticle(article) {
  if (!article?.publisher_timestamp || !article?.source_url) return "UNVERIFIED";
  const blob = `${article.original_title || ""} ${article.summary || ""}`;
  if (HIGH_RISK.some((word) => blob.includes(word))) return "UNVERIFIED";
  if (article.source_type === "official_rss") return "SINGLE_SOURCE";
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
