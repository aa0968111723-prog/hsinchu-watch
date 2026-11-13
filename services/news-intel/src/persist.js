import { linkEvents } from "./pipeline.js";
import { parsePublisherTimestamp } from "./verify.js";

async function digest(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function articleId(sourceUrl) {
  return (await digest(sourceUrl)).slice(0, 32);
}

function precision(timestamp) {
  if (/^\d{4}$/.test(timestamp)) return "year";
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return "day";
  return "minute";
}

export function snapshotPayload(previous, result) {
  if (!result?.ok || !result.articles?.length) {
    return {
      articles: previous?.articles || [],
      last_success_at: previous?.last_success_at || null,
      replaced: false,
    };
  }
  return { articles: result.articles, last_success_at: result.last_success_at, replaced: true };
}

export async function persistArticles(db, { articles, now, actor = "scheduler" }) {
  let inserted = 0;
  let revised = 0;
  const stored = [];
  for (const article of articles || []) {
    const id = await articleId(article.source_url);
    const hash = (await digest(`${article.source_url}\n${article.original_title}\n${article.publisher_timestamp}\n${article.claim_kind || ""}`)).slice(0, 32);
    const existing = await db.prepare("SELECT content_hash, content_version FROM articles WHERE source_url = ?").bind(article.source_url).first();
    const event = linkEvents([article])[0];
    if (!existing) {
      await db.prepare(`INSERT INTO articles (
        id, source_url, original_title, source_name, source_type, publisher_timestamp, timestamp_precision,
        fetched_at, verified_at, topic, region_id, event_id, source_license, verification_status, review_status, claim_kind,
        content_hash, content_version, attribution, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(
        id, article.source_url, article.original_title, article.source_name || null, article.source_type || null,
        article.publisher_timestamp, precision(article.publisher_timestamp), article.fetched_at || now,
        article.region_id || null, event.id, article.verification_status, article.review_status, article.claim_kind || null,
        hash, article.source_name || null, now, now,
      ).run();
      await db.prepare("INSERT INTO article_versions (id, article_id, content_version, original_title, content_hash, created_at) VALUES (?, ?, 1, ?, ?, ?)").bind(crypto.randomUUID(), id, article.original_title, hash, now).run();
      inserted += 1;
    } else if (existing.content_hash !== hash) {
      const version = Number(existing.content_version) + 1;
      await db.prepare(`UPDATE articles SET original_title = ?, publisher_timestamp = ?, timestamp_precision = ?, fetched_at = ?, region_id = ?, event_id = ?, verification_status = ?, review_status = ?, claim_kind = ?, content_hash = ?, content_version = ?, updated_at = ? WHERE source_url = ?`).bind(
        article.original_title, article.publisher_timestamp, precision(article.publisher_timestamp), article.fetched_at || now,
        article.region_id || null, event.id, article.verification_status, article.review_status, article.claim_kind || null, hash, version, now, article.source_url,
      ).run();
      await db.prepare("INSERT INTO article_versions (id, article_id, content_version, original_title, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, version, article.original_title, hash, now).run();
      revised += 1;
    }
    if (article.review_status === "needs_review") {
      const queued = await db.prepare("SELECT id FROM review_queue WHERE article_id = ? AND status = 'open'").bind(id).first();
      if (!queued) {
        await db.prepare("INSERT INTO review_queue (id, article_id, reason, status, created_at) VALUES (?, ?, 'high_risk_unverified', 'open', ?)").bind(crypto.randomUUID(), id, now).run();
      }
    }
    stored.push({ ...article, id, event_id: event.id });
  }
  for (const event of linkEvents(stored)) {
    await db.prepare("INSERT INTO events (id, title, region_id, occurred_on, created_at) VALUES (?, ?, ?, NULL, ?) ON CONFLICT(id) DO NOTHING").bind(event.id, event.title, null, now).run();
    for (const url of event.article_ids) {
      const id = stored.find((article) => article.source_url === url)?.id;
      if (id) await db.prepare("INSERT INTO event_article_links (event_id, article_id) VALUES (?, ?) ON CONFLICT(event_id, article_id) DO NOTHING").bind(event.id, id).run();
    }
  }
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_articles', ?, ?)").bind(crypto.randomUUID(), actor, `inserted=${inserted};revised=${revised}`, now).run();
  return { inserted, revised };
}

export async function persistAnnouncements(db, { announcements, now, actor = "scheduler" }) {
  let inserted = 0;
  const agency = await db.prepare("SELECT id FROM government_agencies WHERE id = ?").bind("hsinchu-county-council").first();
  if (!agency) {
    await db.prepare("INSERT INTO government_agencies (id, name, region_id) VALUES (?, ?, ?)").bind("hsinchu-county-council", "新竹縣議會", "hsinchu-county").run();
  }
  for (const item of announcements || []) {
    const published = parsePublisherTimestamp(item.publisher_timestamp);
    const title = String(item.original_title || "").trim();
    const sourceUrl = String(item.source_url || "");
    if (!published || !title || !sourceUrl.startsWith("https://www.hcc.gov.tw/")) continue;
    const existing = await db.prepare("SELECT id, title FROM government_announcements WHERE source_url = ?").bind(sourceUrl).first();
    if (!existing) {
      await db.prepare("INSERT INTO government_announcements (id, agency_id, title, source_url, published_on, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), "hsinchu-county-council", title, sourceUrl, published, now).run();
      inserted += 1;
    } else if (existing.title !== title) {
      await db.prepare("UPDATE government_announcements SET title = ?, published_on = ? WHERE id = ?").bind(title, published, existing.id).run();
    }
  }
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_announcements', ?, ?)").bind(crypto.randomUUID(), actor, `inserted=${inserted}`, now).run();
  return { inserted };
}
