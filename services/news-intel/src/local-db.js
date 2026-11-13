import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyScheduledResult } from "./index.js";

export function openNewsDb(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  for (const name of ["0001_init.sql", "0002_snapshot.sql", "0003_final_accounts.sql", "0006_population.sql", "0007_school_zones.sql", "0009_public_rosters.sql", "0010_fire_hydrants.sql", "0011_bus_shelters.sql", "0012_accessible_toilets.sql"]) {
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  for (const name of ["0004_article_dates.sql", "0005_related_urls.sql", "0008_source_unavailable.sql"]) {
    for (const statement of readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8").split(";")) {
    const sql = statement.trim();
    if (!sql) continue;
    try {
      db.exec(sql);
    } catch (error) {
      if (!String(error.message || error).includes("duplicate column")) throw error;
    }
    }
  }
  return {
    prepare(sql) {
      const statement = (params) => ({
        bind(...next) {
          return statement(next);
        },
        async run() {
          db.prepare(sql).run(...params);
          return { success: true };
        },
        async all() {
          return { results: db.prepare(sql).all(...params) };
        },
        async first() {
          return db.prepare(sql).get(...params) || null;
        },
      });
      return statement([]);
    },
  };
}

export function resultFromPublished(payload) {
  return {
    ok: Boolean(payload?.ok),
    articles: (payload?.articles || []).map((article) => ({
      original_title: article.title || article.original_title,
      source_url: article.url || article.source_url,
      publisher_timestamp: article.published_at || article.publisher_timestamp,
      region_id: article.region_id,
      verification_status: article.verification_status,
      review_status: article.verification_status === "UNVERIFIED" ? "needs_review" : "pending_index",
      claim_kind: article.claim_kind,
      source_name: article.source_name,
      source_type: String(article.url || article.source_url || "").includes("cna.com.tw") ? "news_rss" : "official_rss",
      fetched_at: payload.last_success_at,
    })),
    announcements: (payload?.announcements || []).map((item) => ({
      original_title: item.title || item.original_title,
      source_url: item.url || item.source_url,
      publisher_timestamp: item.published_at || item.publisher_timestamp,
      source_name: item.source_name,
    })),
    public_records: payload?.public_records || [],
    model_review: payload?.model_review || [],
    gemini: payload?.gemini,
    last_success_at: payload?.last_success_at,
  };
}

export async function hiddenSourceUrls(db) {
  const database = db || openNewsDb(fileURLToPath(new URL("../state/news.sqlite", import.meta.url)));
  const rows = await database.prepare("SELECT source_url FROM articles WHERE review_status IN ('rejected', 'retracted') OR verification_status = 'RETRACTED'").all();
  return new Set((rows.results || []).map((row) => row.source_url));
}

export function withoutHidden(articles, hidden) {
  return (articles || []).filter((article) => !hidden.has(article.source_url));
}

export async function storeRun(result) {
  const file = fileURLToPath(new URL("../state/news.sqlite", import.meta.url));
  const db = openNewsDb(file);
  await applyScheduledResult(db, { articles: [], announcements: [], public_records: [], model_review: [] }, result);
}
