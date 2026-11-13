import { collectAdapters } from "./adapters.js";
import { decideGemini, selectArticles } from "./pipeline.js";
import { publicationFields } from "./verify.js";

export function mergeRun(previous, result) {
  if (!result.ok) {
    return {
      ok: false,
      retained: true,
      articles: previous?.articles || [],
      last_success_at: previous?.last_success_at || null,
      error: result.error,
      failures: result.failures || [],
    };
  }
  return {
    ok: true,
    retained: false,
    articles: result.articles,
    last_success_at: result.finished_at,
    failures: result.failures || [],
    gemini: result.gemini,
  };
}

export async function runHour({ fetcher, adapters, env, previous, now }) {
  const gemini = decideGemini(env || {}, { tokens_today: 0, requests_this_hour: 0 });
  try {
    const collected = await collectAdapters(fetcher, adapters);
    if (!collected.candidates.length && collected.failures.length) {
      return mergeRun(previous, { ok: false, error: "all_sources_failed", failures: collected.failures });
    }
    const articles = selectArticles(collected.candidates).map((article) => ({
      ...article,
      ...publicationFields(article),
      fetched_at: now,
    }));
    return mergeRun(previous, {
      ok: true,
      articles,
      failures: collected.failures,
      finished_at: now,
      gemini,
    });
  } catch (error) {
    return mergeRun(previous, { ok: false, error: String(error.message || error).slice(0, 180) });
  }
}
