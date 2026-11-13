import { handleMcp } from "./mcp.js";
import { persistAnnouncements, persistArticles, persistBusShelters, persistCameras, persistChargers, persistElectricBuses, persistGasStations, persistHeritage, persistHydrants, persistKindergartens, persistModelReview, persistPopulation, persistPublicRecords, persistSchools, persistSpecialClasses, persistToilets, persistTransport, persistUsePermitSummary, snapshotPayload } from "./persist.js";
import { runHour, sourceFetch } from "./run.js";

async function previousSnapshot(env) {
  if (!env.DB) return { articles: [], last_success_at: null };
  const row = await env.DB.prepare("SELECT articles_json, last_success_at FROM published_snapshots WHERE id = 1").first();
  if (!row) return { articles: [], last_success_at: null };
  return { articles: JSON.parse(row.articles_json), last_success_at: row.last_success_at };
}

const mcpState = { idempotency: new Map() };

function tokensFromEnv(env) {
  return {
    reader: env.NEWS_INTEL_READER_TOKEN,
    collector: env.NEWS_INTEL_COLLECTOR_TOKEN,
    verifier: env.NEWS_INTEL_VERIFIER_TOKEN,
    publisher: env.NEWS_INTEL_PUBLISHER_TOKEN,
    admin: env.NEWS_INTEL_ADMIN_TOKEN,
  };
}

export async function applyScheduledResult(db, previous, result) {
  if (result?.ok && result.articles?.length) {
    const hiddenRows = await db.prepare("SELECT source_url FROM articles WHERE review_status IN ('rejected', 'retracted') OR verification_status = 'RETRACTED'").all();
    const hidden = new Set((hiddenRows.results || []).map((row) => row.source_url));
    result.articles = result.articles.filter((article) => !hidden.has(article.source_url));
  }
  await db.prepare(
    "INSERT INTO agent_runs (id, started_at, finished_at, status, article_count, gemini_used, error) VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), result.ok ? "ok" : "failed", result.articles?.length || 0, result.gemini?.use ? 1 : 0, result.ok ? null : result.error || null).run();
  if (result.ok && result.announcements?.length) {
    await persistAnnouncements(db, { announcements: result.announcements, now: result.last_success_at });
  }
  if (result.ok && result.public_records?.length) {
    await persistPublicRecords(db, { records: result.public_records, now: result.last_success_at });
  }
  if (result.ok && result.population?.rows?.length && result.population.retained !== true) {
    await persistPopulation(db, { population: result.population, now: result.last_success_at });
  }
  if (result.ok && result.parking?.lots?.length && result.parking.retained !== true) {
    await persistTransport(db, { parking: result.parking, now: result.last_success_at });
  }
  if (result.ok && result.schools?.schools?.length && result.schools.retained !== true) {
    await persistSchools(db, { schools: result.schools, now: result.last_success_at });
  }
  if (result.ok && result.model_review?.length) {
    await persistModelReview(db, { proposals: result.model_review, now: result.last_success_at });
  }
  const snapshot = snapshotPayload(previous, result);
  if (snapshot.replaced) {
    await persistArticles(db, { articles: result.articles, now: result.last_success_at });
    await db.prepare(
      "INSERT INTO published_snapshots (id, articles_json, last_success_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET articles_json = excluded.articles_json, last_success_at = excluded.last_success_at"
    ).bind(JSON.stringify(snapshot.articles), snapshot.last_success_at).run();
  }
  if (result.ok && result.kindergartens?.kindergartens?.length && result.kindergartens.retained !== true) {
    await persistKindergartens(db, { kindergartens: result.kindergartens, now: result.last_success_at });
  }
  if (result.ok && result.cameras?.rows?.length && result.cameras.retained !== true) {
    await persistCameras(db, { cameras: result.cameras, now: result.last_success_at });
  }
  if (result.ok && result.special_classes?.classes?.length && result.special_classes.retained !== true) {
    await persistSpecialClasses(db, { specialClasses: result.special_classes, now: result.last_success_at });
  }
  if (result.ok && result.use_permits?.count && result.use_permits.retained !== true) {
    await persistUsePermitSummary(db, { usePermits: result.use_permits, now: result.last_success_at });
  }
  if (result.ok && result.hydrants?.hydrants?.length && result.hydrants.retained !== true) {
    await persistHydrants(db, { hydrants: result.hydrants, now: result.last_success_at });
  }
  if (result.ok && result.bus_shelters?.shelters?.length && result.bus_shelters.retained !== true) {
    await persistBusShelters(db, { shelters: result.bus_shelters, now: result.last_success_at });
  }
  if (result.ok && result.toilets?.toilets?.length && result.toilets.retained !== true) {
    await persistToilets(db, { toilets: result.toilets, now: result.last_success_at });
  }
  if (result.ok && result.heritage?.sites?.length && result.heritage.retained !== true) {
    await persistHeritage(db, { heritage: result.heritage, now: result.last_success_at });
  }
  if (result.ok && result.chargers?.chargers?.length && result.chargers.retained !== true) {
    await persistChargers(db, { chargers: result.chargers, now: result.last_success_at });
  }
  if (result.ok && result.gas_stations?.stations?.length && result.gas_stations.retained !== true) {
    await persistGasStations(db, { stations: result.gas_stations, now: result.last_success_at });
  }
  if (result.ok && result.electric_buses?.rows?.length && result.electric_buses.retained !== true) {
    await persistElectricBuses(db, { buses: result.electric_buses, now: result.last_success_at });
  }
  return snapshot;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/v1/public-records") {
      const rows = env.DB
        ? await env.DB.prepare("SELECT year, spent_text, unit, dataset_url, list_url, note FROM final_accounts ORDER BY year DESC").all()
        : { results: [] };
      let population = [];
      if (env.DB) {
        try {
          const people = await env.DB.prepare("SELECT area_code, area_label, total_text, period, period_text, dataset_url, source_url FROM population_counts ORDER BY area_code LIMIT 30").all();
          population = people.results || [];
        } catch (error) {
          if (!String(error.message || error).includes("no such table")) throw error;
        }
      }
      return Response.json({ records: rows.results || [], population, note: "spent_text 是資料檔原文，不是驗收或實支。population 只列資料檔性別為計的總計。" });
    }
    if (request.method === "GET" && url.pathname === "/api/v1/news") {
      const rows = env.DB
        ? await env.DB.prepare("SELECT id, original_title, source_url, publisher_timestamp, region_id, verification_status, review_status, claim_kind, date_checked, page_published_at, feed_time_kind, related_urls, source_unavailable FROM articles WHERE review_status NOT IN ('rejected', 'retracted') AND verification_status != 'RETRACTED' ORDER BY publisher_timestamp DESC LIMIT 20").all()
        : { results: [] };
      const articles = (rows.results || []).map((row) => {
        let related = [];
        try {
          related = JSON.parse(row.related_urls || "[]");
        } catch {
          related = [];
        }
        return { ...row, related_urls: Array.isArray(related) ? related : [], source_unavailable: row.source_unavailable === 1 };
      });
      return Response.json({ articles, note: "pending_index 不是已查核事實" });
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      const body = await request.json().catch(() => null);
      const result = await handleMcp({
        authorization: request.headers.get("authorization"),
        body,
        tokens: tokensFromEnv(env),
        state: mcpState,
        db: env.DB,
        fetcher: sourceFetch,
      });
      return Response.json(result.body, { status: result.status });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },

  async scheduled(_event, env) {
    const previous = await previousSnapshot(env);
    const result = await runHour({
      fetcher: sourceFetch,
      env,
      previous,
      now: new Date().toISOString(),
    });
    if (!env.DB) return;
    await applyScheduledResult(env.DB, previous, result);
  },
};
