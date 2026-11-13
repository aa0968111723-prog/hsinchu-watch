import { collectAdapters } from "./adapters.js";
import { allowedUrl } from "./allowlist.js";
import { acceptModelProposals, decideGemini, selectArticles } from "./pipeline.js";
import { pageDateAgrees, publicationFields, readPagePublishedAt } from "./verify.js";

export const FETCH_TIMEOUT_MS = 15000;

export function sourceFetch(url) {
  return fetch(url, {
    headers: { "user-agent": "HsinchuNewsIntel/0.1" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

export function publishableResult(previous, result) {
  if (result?.ok && !(result.articles || []).length && (previous?.articles || []).length) {
    return {
      ...result,
      retained: true,
      articles: previous.articles,
      last_success_at: previous.last_success_at || result.last_success_at,
    };
  }
  return result;
}

export function mergeRun(previous, result) {
  if (!result.ok) {
    return {
      ok: false,
      retained: true,
      articles: previous?.articles || [],
      last_success_at: previous?.last_success_at || null,
      error: result.error,
      failures: result.failures || [],
      announcements: previous?.announcements || [],
      public_records: previous?.public_records || [],
      model_review: previous?.model_review || [],
    };
  }
  return {
    ok: true,
    retained: false,
    articles: result.articles,
    last_success_at: result.finished_at,
    failures: result.failures || [],
    gemini: result.gemini,
    announcements: result.announcements || [],
    public_records: result.public_records || [],
    model_review: result.model_review || [],
  };
}

export async function runHour({ fetcher, adapters, env, previous, now }) {
  const decision = decideGemini(env || {}, { tokens_today: 0, requests_this_hour: 0 });
  const called = Boolean(decision.use && typeof env?.propose === "function");
  const gemini = { ...decision, called };
  try {
    const collected = await collectAdapters(fetcher, adapters);
    if (!collected.candidates.length && collected.failures.length) {
      return mergeRun(previous, { ok: false, error: "all_sources_failed", failures: collected.failures });
    }
    const councilFailed = collected.failures.some((failure) => failure.id === "hsinchu-county-council");
    const freshNotices = collected.candidates.filter((item) => item.source_id === "hsinchu-county-council").map((item) => ({
      title: item.original_title,
      url: item.source_url,
      published_at: item.publisher_timestamp,
      source_name: item.source_name,
    }));
    const announcements = councilFailed ? (previous?.announcements || []) : freshNotices;
    const accountsFailed = collected.failures.some((failure) => failure.id === "hsc-expenditure-final");
    const freshRecords = collected.candidates.filter((item) => item.source_id === "hsc-expenditure-final").map((item) => ({
      year: item.year,
      spent_amount: item.spent_amount,
      unit: null,
      source_name: item.source_name,
      dataset_url: item.dataset_url,
      list_url: item.source_url,
      note: "年度欄是民國年，這裡換成西元。金額維持原文字。單位未標示，不換算。這是歲出決算數，不是驗收或實支。",
    }));
    const publicRecords = accountsFailed ? (previous?.public_records || []) : freshRecords;
    const proposals = called ? await env.propose() : [];
    const modelReview = acceptModelProposals(proposals);
    const selected = selectArticles(collected.candidates).map((article) => ({
      ...article,
      ...publicationFields(article),
      fetched_at: now,
    }));
    const articles = [];
    for (const article of selected) {
      if (!allowedUrl(article.source_url)) {
        articles.push(article);
        continue;
      }
      try {
        const response = await fetcher(article.source_url);
        const html = response?.ok ? await response.text() : "";
        const agrees = pageDateAgrees(article.publisher_timestamp, html, { dayOnly: article.feed_time_kind === "updated" });
        const pagePublishedAt = readPagePublishedAt(html);
        if (agrees === false) {
          articles.push({ ...article, verification_status: "UNVERIFIED", review_status: "needs_review", fact_fields_allowed: false, date_checked: false, page_published_at: pagePublishedAt });
        } else {
          articles.push({ ...article, date_checked: agrees, page_published_at: pagePublishedAt });
        }
      } catch {
        articles.push({ ...article, date_checked: null });
      }
    }
    return mergeRun(previous, {
      ok: true,
      articles,
      failures: collected.failures,
      finished_at: now,
      gemini,
      announcements,
      public_records: publicRecords,
      model_review: modelReview,
    });
  } catch (error) {
    return mergeRun(previous, { ok: false, error: String(error.message || error).slice(0, 180) });
  }
}
