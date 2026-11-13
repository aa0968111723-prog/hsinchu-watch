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
    const checked = article.date_checked === true ? 1 : article.date_checked === false ? 0 : null;
    const related = JSON.stringify((article.related_urls || []).filter((url) => String(url).startsWith("https://")));
    const hash = (await digest(`${article.source_url}\n${article.original_title}\n${article.publisher_timestamp}\n${article.claim_kind || ""}\n${article.verification_status || ""}\n${checked ?? ""}\n${article.page_published_at || ""}\n${related}`)).slice(0, 32);
    const existing = await db.prepare("SELECT content_hash, content_version FROM articles WHERE source_url = ?").bind(article.source_url).first();
    const event = linkEvents([article])[0];
    if (!existing) {
      await db.prepare(`INSERT INTO articles (
        id, source_url, original_title, source_name, source_type, publisher_timestamp, timestamp_precision,
        fetched_at, verified_at, topic, region_id, event_id, source_license, verification_status, review_status, claim_kind,
        date_checked, page_published_at, feed_time_kind, related_urls,
        content_hash, content_version, attribution, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(
        id, article.source_url, article.original_title, article.source_name || null, article.source_type || null,
        article.publisher_timestamp, precision(article.publisher_timestamp), article.fetched_at || now,
        article.region_id || null, event.id, article.verification_status, article.review_status, article.claim_kind || null,
        checked, article.page_published_at || null, article.feed_time_kind || null, related,
        hash, article.source_name || null, now, now,
      ).run();
      await db.prepare("INSERT INTO article_versions (id, article_id, content_version, original_title, content_hash, created_at) VALUES (?, ?, 1, ?, ?, ?)").bind(crypto.randomUUID(), id, article.original_title, hash, now).run();
      inserted += 1;
    } else if (existing.content_hash !== hash) {
      const version = Number(existing.content_version) + 1;
      await db.prepare(`UPDATE articles SET original_title = ?, publisher_timestamp = ?, timestamp_precision = ?, fetched_at = ?, region_id = ?, event_id = ?, verification_status = ?, review_status = ?, claim_kind = ?, date_checked = ?, page_published_at = ?, feed_time_kind = ?, related_urls = ?, content_hash = ?, content_version = ?, updated_at = ? WHERE source_url = ?`).bind(
        article.original_title, article.publisher_timestamp, precision(article.publisher_timestamp), article.fetched_at || now,
        article.region_id || null, event.id, article.verification_status, article.review_status, article.claim_kind || null,
        checked, article.page_published_at || null, article.feed_time_kind || null, related, hash, version, now, article.source_url,
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

export async function persistModelReview(db, { proposals, now }) {
  let inserted = 0;
  for (const proposal of proposals || []) {
    const reason = `model_proposal ${proposal.source_url} ${proposal.original_title}`.slice(0, 500);
    const existing = await db.prepare("SELECT id FROM review_queue WHERE reason = ? AND status = 'open'").bind(reason).first();
    if (existing) continue;
    await db.prepare("INSERT INTO review_queue (id, article_id, reason, status, created_at) VALUES (?, NULL, ?, 'open', ?)").bind(crypto.randomUUID(), reason, now).run();
    inserted += 1;
  }
  return { inserted };
}

export async function persistPublicRecords(db, { records, now, actor = "scheduler" }) {
  let inserted = 0;
  for (const record of records || []) {
    if (!record?.year || !record.dataset_url || !record.list_url) continue;
    const spent = record.spent_amount === undefined || record.spent_amount === "" ? null : record.spent_amount;
    const existing = await db.prepare("SELECT id, spent_text FROM final_accounts WHERE region_id = ? AND year = ?").bind("hsinchu-county", record.year).first();
    if (!existing) {
      await db.prepare("INSERT INTO final_accounts (id, region_id, year, spent_text, unit, dataset_url, list_url, note) VALUES (?, 'hsinchu-county', ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), record.year, spent, record.unit ?? null, record.dataset_url, record.list_url, record.note || "").run();
      inserted += 1;
    } else if ((existing.spent_text ?? null) !== spent) {
      await db.prepare("UPDATE final_accounts SET spent_text = ?, unit = ? WHERE id = ?").bind(spent, record.unit ?? null, existing.id).run();
    }
  }
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_public_records', ?, ?)").bind(crypto.randomUUID(), actor, `inserted=${inserted}`, now).run();
  return { inserted };
}

export async function persistPopulation(db, { population, now, actor = "scheduler" }) {
  const period = population?.period || "";
  let upserted = 0;
  for (const row of population?.rows || []) {
    if (!row?.area_code || !row.area_label) continue;
    const total = row.total === undefined || row.total === "" ? null : row.total;
    const existing = await db.prepare("SELECT total_text, area_label FROM population_counts WHERE area_code = ? AND period = ?").bind(row.area_code, period).first();
    if (!existing) {
      await db.prepare("INSERT INTO population_counts (area_code, period, area_label, total_text, period_text, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(row.area_code, period, row.area_label, total, population.period_text || null, population.dataset_url, population.source_url, now).run();
      upserted += 1;
    } else if ((existing.total_text ?? null) !== total || existing.area_label !== row.area_label) {
      await db.prepare("UPDATE population_counts SET area_label = ?, total_text = ?, period_text = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE area_code = ? AND period = ?").bind(row.area_label, total, population.period_text || null, population.dataset_url, population.source_url, now, row.area_code, period).run();
    }
  }
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_population', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistTransport(db, { parking, now, actor = "scheduler" }) {
  const ids = [];
  let upserted = 0;
  for (const lot of parking?.lots || []) {
    if (!lot?.name) continue;
    const id = (await digest(`${lot.name}\n${lot.address || ""}\n${lot.district || ""}`)).slice(0, 32);
    ids.push(id);
    const summary = [lot.name, lot.district || "行政區未填", lot.kind || "型式未填", lot.spaces || "格數未填", lot.fee || "收費未填"].join("｜");
    const existing = await db.prepare("SELECT summary FROM transport_updates WHERE id = ?").bind(id).first();
    if (!existing) {
      await db.prepare("INSERT INTO transport_updates (id, region_id, summary, source_url, published_at) VALUES (?, ?, ?, ?, NULL)").bind(id, lot.region_id, summary, parking.source_url).run();
      upserted += 1;
    } else if (existing.summary !== summary) {
      await db.prepare("UPDATE transport_updates SET region_id = ?, summary = ?, source_url = ? WHERE id = ?").bind(lot.region_id, summary, parking.source_url, id).run();
    }
  }
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    await db.prepare(`DELETE FROM transport_updates WHERE source_url = ? AND id NOT IN (${placeholders})`).bind(parking.source_url, ...ids).run();
  }
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_transport', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistSchools(db, { schools, now, actor = "scheduler" }) {
  const period = schools?.period || "";
  let upserted = 0;
  for (const row of schools?.schools || []) {
    if (!row?.name || !row.township) continue;
    const zone = row.zone === undefined || row.zone === "" ? null : row.zone;
    const existing = await db.prepare("SELECT zone_text FROM school_zones WHERE school_name = ? AND township = ? AND period = ?").bind(row.name, row.township, period).first();
    if (!existing) {
      await db.prepare("INSERT INTO school_zones (school_name, township, township_code, zone_text, period, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(row.name, row.township, row.township_code, zone, period, schools.dataset_url, schools.source_url, now).run();
      upserted += 1;
    } else if ((existing.zone_text ?? null) !== zone) {
      await db.prepare("UPDATE school_zones SET township_code = ?, zone_text = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE school_name = ? AND township = ? AND period = ?").bind(row.township_code, zone, schools.dataset_url, schools.source_url, now, row.name, row.township, period).run();
    }
  }
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_schools', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
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
