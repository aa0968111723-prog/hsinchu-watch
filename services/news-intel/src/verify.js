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
const CANDIDATE_WORDS = ["助選", "政見", "候選人", "掃街", "造勢", "拜票"];
const LEGAL_WORDS = ["搜索", "偵查", "交保", "聲押", "起訴", "羈押", "判決"];

export function claimKind(article) {
  const blob = `${article?.original_title || ""} ${article?.summary || ""}`;
  if (blob.includes("民調") || blob.includes("支持度")) return "poll";
  if (["開工", "完工", "落成", "驗收", "進度"].some((word) => blob.includes(word))) return "project_progress";
  if (LEGAL_WORDS.some((word) => blob.includes(word))) return "legal_status";
  if (article?.source_type === "official_rss" || article?.source_type === "official_html") return "official_notice";
  if (article?.source_type === "news_rss" && (CANDIDATE_WORDS.some((word) => blob.includes(word)) || String(article?.original_title || "").includes("："))) return "candidate_statement";
  if (blob.includes("評論") || blob.includes("社論")) return "commentary";
  return "news_report";
}

export function classifyArticle(article) {
  if (!article?.publisher_timestamp || !article?.source_url) return "UNVERIFIED";
  const blob = `${article.original_title || ""} ${article.summary || ""}`;
  if (HIGH_RISK.some((word) => blob.includes(word))) return "UNVERIFIED";
  if (article.source_type === "official_rss" || article.source_type === "official_html") return "SINGLE_SOURCE";
  if (article.source_type === "news_rss") return "SINGLE_SOURCE";
  return "UNVERIFIED";
}

export function readPagePublishedAt(html) {
  const match = String(html || "").match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (!match) return null;
  const text = match[1].trim();
  const normalized = text.includes("T") ? text : `${text.replace(" ", "T")}+08:00`;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function pageDateAgrees(publishedAt, html) {
  const pageTime = readPagePublishedAt(html);
  if (!pageTime) return null;
  const feedTime = Date.parse(publishedAt);
  if (Number.isNaN(feedTime)) return false;
  return Math.abs(Date.parse(pageTime) - feedTime) < 5 * 60 * 1000;
}

export function publicationFields(article) {
  const status = classifyArticle(article);
  return {
    verification_status: status,
    review_status: status === "UNVERIFIED" ? "needs_review" : "pending_index",
    claim_kind: claimKind(article),
    fact_fields_allowed: status === "VERIFIED_OFFICIAL" || status === "VERIFIED_MULTI_SOURCE",
  };
}
