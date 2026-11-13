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
    const unavailable = article.source_unavailable === true ? 1 : 0;
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
    await db.prepare("UPDATE articles SET source_unavailable = ? WHERE source_url = ?").bind(unavailable, article.source_url).run();
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

async function deleteMissing(db, table, datasetUrl, columns, keys) {
  if (!datasetUrl || !keys.length) return;
  const tuple = `(${columns.join(", ")})`;
  const placeholders = keys.map(() => `(${columns.map(() => "?").join(", ")})`).join(",");
  await db.prepare(`DELETE FROM ${table} WHERE dataset_url = ? AND ${tuple} NOT IN (${placeholders})`).bind(datasetUrl, ...keys.flat()).run();
}

export async function persistKindergartens(db, { kindergartens, now, actor = "scheduler" }) {
  const periodText = kindergartens?.period_text || "";
  const keys = [];
  let upserted = 0;
  for (const row of kindergartens?.kindergartens || []) {
    const name = String(row?.name || "").trim();
    const address = String(row?.address || "").trim();
    if (!name || !address) continue;
    keys.push([name, address, periodText]);
    const category = row.category || null;
    const postal = row.postal_code || null;
    const township = row.township || null;
    const region = row.region_id || null;
    const existing = await db.prepare("SELECT category, postal_code, township, region_id FROM kindergarten_roster WHERE name = ? AND address = ? AND period_text = ?").bind(name, address, periodText).first();
    if (!existing) {
      await db.prepare("INSERT INTO kindergarten_roster (name, address, period_text, category, postal_code, township, region_id, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(name, address, periodText, category, postal, township, region, kindergartens.dataset_url, kindergartens.source_url, now).run();
      upserted += 1;
    } else if ((existing.category ?? null) !== category || (existing.postal_code ?? null) !== postal || (existing.township ?? null) !== township || (existing.region_id ?? null) !== region) {
      await db.prepare("UPDATE kindergarten_roster SET category = ?, postal_code = ?, township = ?, region_id = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE name = ? AND address = ? AND period_text = ?").bind(category, postal, township, region, kindergartens.dataset_url, kindergartens.source_url, now, name, address, periodText).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "kindergarten_roster", kindergartens?.dataset_url, ["name", "address", "period_text"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_kindergartens', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistCameras(db, { cameras, now, actor = "scheduler" }) {
  const periodText = cameras?.period_text || "";
  const keys = [];
  let upserted = 0;
  for (const row of cameras?.rows || []) {
    const place = String(row?.place || "").trim();
    const district = String(row?.district || "").trim();
    if (!place || !district) continue;
    const code = row.code == null || String(row.code).trim() === "" ? "" : String(row.code).trim();
    keys.push([place, district, periodText, code]);
    const speed = row.speed_limit == null || row.speed_limit === "" ? null : String(row.speed_limit);
    const existing = await db.prepare("SELECT speed_limit FROM speed_cameras WHERE place = ? AND district = ? AND period_text = ? AND code = ?").bind(place, district, periodText, code).first();
    if (!existing) {
      await db.prepare("INSERT INTO speed_cameras (place, district, period_text, code, region_id, kind, offense, latitude, longitude, direction, speed_limit, station, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(place, district, periodText, code, row.region_id || null, row.kind || null, row.offense || null, row.latitude || null, row.longitude || null, row.direction || null, speed, row.station || null, cameras.dataset_url, cameras.source_url, now).run();
      upserted += 1;
    } else if ((existing.speed_limit ?? null) !== speed) {
      await db.prepare("UPDATE speed_cameras SET region_id = ?, kind = ?, offense = ?, latitude = ?, longitude = ?, direction = ?, speed_limit = ?, station = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE place = ? AND district = ? AND period_text = ? AND code = ?").bind(row.region_id || null, row.kind || null, row.offense || null, row.latitude || null, row.longitude || null, row.direction || null, speed, row.station || null, cameras.dataset_url, cameras.source_url, now, place, district, periodText, code).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "speed_cameras", cameras?.dataset_url, ["place", "district", "period_text", "code"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_cameras', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistSpecialClasses(db, { specialClasses, now, actor = "scheduler" }) {
  const periodText = specialClasses?.period_text || "";
  const period = specialClasses?.period || null;
  const keys = [];
  let upserted = 0;
  for (const row of specialClasses?.classes || []) {
    const name = String(row?.name || "").trim();
    const address = String(row?.address || "").trim();
    if (!name || !address) continue;
    const code = row.code == null || String(row.code).trim() === "" ? "" : String(row.code).trim();
    keys.push([name, address, periodText, code]);
    const classType = row.class_type || null;
    const existing = await db.prepare("SELECT class_type FROM special_classes WHERE name = ? AND address = ? AND period_text = ? AND code = ?").bind(name, address, periodText, code).first();
    if (!existing) {
      await db.prepare("INSERT INTO special_classes (name, address, period_text, code, class_type, township, region_id, period, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(name, address, periodText, code, classType, row.township || null, row.region_id || null, period, specialClasses.dataset_url, specialClasses.source_url, now).run();
      upserted += 1;
    } else if ((existing.class_type ?? null) !== classType) {
      await db.prepare("UPDATE special_classes SET class_type = ?, township = ?, region_id = ?, period = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE name = ? AND address = ? AND period_text = ? AND code = ?").bind(classType, row.township || null, row.region_id || null, period, specialClasses.dataset_url, specialClasses.source_url, now, name, address, periodText, code).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "special_classes", specialClasses?.dataset_url, ["name", "address", "period_text", "code"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_special_classes', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistUsePermitSummary(db, { usePermits, now, actor = "scheduler" }) {
  if (!usePermits?.dataset_url || !Number.isInteger(usePermits.count)) return { upserted: 0 };
  const existing = await db.prepare("SELECT permit_count, earliest_issue_date, latest_issue_date FROM use_permit_summaries WHERE dataset_url = ?").bind(usePermits.dataset_url).first();
  const values = [usePermits.source_url, usePermits.count, usePermits.dated || 0, usePermits.outside || 0, usePermits.unreadable || 0, usePermits.earliest_issue_date || null, usePermits.latest_issue_date || null, now, usePermits.dataset_url];
  if (!existing) {
    await db.prepare("INSERT INTO use_permit_summaries (source_url, permit_count, dated, outside_count, unreadable, earliest_issue_date, latest_issue_date, fetched_at, dataset_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(...values).run();
  } else {
    await db.prepare("UPDATE use_permit_summaries SET source_url = ?, permit_count = ?, dated = ?, outside_count = ?, unreadable = ?, earliest_issue_date = ?, latest_issue_date = ?, fetched_at = ? WHERE dataset_url = ?").bind(...values).run();
  }
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_use_permits', ?, ?)").bind(crypto.randomUUID(), actor, `count=${usePermits.count}`, now).run();
  return { upserted: 1 };
}

export async function persistHydrants(db, { hydrants, now, actor = "scheduler" }) {
  const keys = [];
  let upserted = 0;
  for (const row of hydrants?.hydrants || []) {
    const place = String(row?.place || "").trim();
    if (!place) continue;
    const code = row.code == null || String(row.code).trim() === "" ? "" : String(row.code).trim();
    keys.push([code, place]);
    const pressure = row.pressure == null || row.pressure === "" ? null : String(row.pressure);
    const existing = await db.prepare("SELECT pressure, kind FROM fire_hydrants WHERE code = ? AND place = ?").bind(code, place).first();
    if (!existing) {
      await db.prepare("INSERT INTO fire_hydrants (code, place, water_code, kind, pressure, township, region_id, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(code, place, row.water_code || null, row.kind || null, pressure, row.township || null, row.region_id || null, hydrants.dataset_url, hydrants.source_url, now).run();
      upserted += 1;
    } else if ((existing.pressure ?? null) !== pressure || (existing.kind ?? null) !== (row.kind || null)) {
      await db.prepare("UPDATE fire_hydrants SET water_code = ?, kind = ?, pressure = ?, township = ?, region_id = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE code = ? AND place = ?").bind(row.water_code || null, row.kind || null, pressure, row.township || null, row.region_id || null, hydrants.dataset_url, hydrants.source_url, now, code, place).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "fire_hydrants", hydrants?.dataset_url, ["code", "place"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_hydrants', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistBusShelters(db, { shelters, now, actor = "scheduler" }) {
  const keys = [];
  let upserted = 0;
  for (const row of shelters?.shelters || []) {
    const name = String(row?.name || "").trim();
    if (!name) continue;
    const code = row.code == null || String(row.code).trim() === "" ? "" : String(row.code).trim();
    const year = row.year == null || String(row.year).trim() === "" ? "" : String(row.year).trim();
    keys.push([code, name, year]);
    const opened = row.opened || null;
    const existing = await db.prepare("SELECT opened, routes FROM bus_shelters WHERE code = ? AND name = ? AND year = ?").bind(code, name, year).first();
    if (!existing) {
      await db.prepare("INSERT INTO bus_shelters (code, name, year, kind, road, direction, routes, agency, opened, integrated, township, region_id, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(code, name, year, row.kind || null, row.road || null, row.direction || null, row.routes || null, row.agency || null, opened, row.integrated || null, row.township || null, row.region_id || null, shelters.dataset_url, shelters.source_url, now).run();
      upserted += 1;
    } else if ((existing.opened ?? null) !== opened || (existing.routes ?? null) !== (row.routes || null)) {
      await db.prepare("UPDATE bus_shelters SET kind = ?, road = ?, direction = ?, routes = ?, agency = ?, opened = ?, integrated = ?, township = ?, region_id = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE code = ? AND name = ? AND year = ?").bind(row.kind || null, row.road || null, row.direction || null, row.routes || null, row.agency || null, opened, row.integrated || null, row.township || null, row.region_id || null, shelters.dataset_url, shelters.source_url, now, code, name, year).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "bus_shelters", shelters?.dataset_url, ["code", "name", "year"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_bus_shelters', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistToilets(db, { toilets, now, actor = "scheduler" }) {
  const keys = [];
  let upserted = 0;
  const periodText = toilets?.period_text || null;
  for (const row of toilets?.toilets || []) {
    const name = String(row?.name || "").trim();
    if (!name) continue;
    const code = row.code == null || String(row.code).trim() === "" ? "" : String(row.code).trim();
    const township = row.township || "";
    keys.push([code, name, township]);
    const existing = await db.prepare("SELECT address, kind FROM accessible_toilets WHERE code = ? AND name = ? AND township = ?").bind(code, name, township).first();
    if (!existing) {
      await db.prepare("INSERT INTO accessible_toilets (code, name, township, region_id, village, address, kind, note, period_text, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(code, name, township, row.region_id || null, row.village || null, row.address || null, row.kind || null, row.note || null, periodText, toilets.dataset_url, toilets.source_url, now).run();
      upserted += 1;
    } else if ((existing.address ?? null) !== (row.address || null) || (existing.kind ?? null) !== (row.kind || null)) {
      await db.prepare("UPDATE accessible_toilets SET region_id = ?, village = ?, address = ?, kind = ?, note = ?, period_text = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE code = ? AND name = ? AND township = ?").bind(row.region_id || null, row.village || null, row.address || null, row.kind || null, row.note || null, periodText, toilets.dataset_url, toilets.source_url, now, code, name, township).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "accessible_toilets", toilets?.dataset_url, ["code", "name", "township"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_toilets', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistHeritage(db, { heritage, now, actor = "scheduler" }) {
  const keys = [];
  let upserted = 0;
  for (const row of heritage?.sites || []) {
    const name = String(row?.name || "").trim();
    if (!name) continue;
    const code = row.code == null || String(row.code).trim() === "" ? "" : String(row.code).trim();
    const township = row.township || "";
    keys.push([code, name, township]);
    const ownership = row.ownership || null;
    const existing = await db.prepare("SELECT ownership, designation FROM heritage_sites WHERE code = ? AND name = ? AND township = ?").bind(code, name, township).first();
    if (!existing) {
      await db.prepare("INSERT INTO heritage_sites (code, name, township, region_id, heritage_kind, designation, postal_code, address, ownership, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(code, name, township, row.region_id || null, row.heritage_kind || null, row.designation || null, row.postal_code || null, row.address || null, ownership, heritage.dataset_url, heritage.source_url, now).run();
      upserted += 1;
    } else if ((existing.ownership ?? null) !== ownership || (existing.designation ?? null) !== (row.designation || null)) {
      await db.prepare("UPDATE heritage_sites SET region_id = ?, heritage_kind = ?, designation = ?, postal_code = ?, address = ?, ownership = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE code = ? AND name = ? AND township = ?").bind(row.region_id || null, row.heritage_kind || null, row.designation || null, row.postal_code || null, row.address || null, ownership, heritage.dataset_url, heritage.source_url, now, code, name, township).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "heritage_sites", heritage?.dataset_url, ["code", "name", "township"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_heritage', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistChargers(db, { chargers, now, actor = "scheduler" }) {
  const keys = [];
  let upserted = 0;
  for (const row of chargers?.chargers || []) {
    const name = String(row?.name || "").trim();
    if (!name) continue;
    const code = row.code == null || String(row.code).trim() === "" ? "" : String(row.code).trim();
    keys.push([code, name]);
    const address = row.address || null;
    const existing = await db.prepare("SELECT address FROM ev_chargers WHERE code = ? AND name = ?").bind(code, name).first();
    if (!existing) {
      await db.prepare("INSERT INTO ev_chargers (code, name, postal_code, address, note, township, region_id, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(code, name, row.postal_code || null, address, row.note || null, row.township || null, row.region_id || null, chargers.dataset_url, chargers.source_url, now).run();
      upserted += 1;
    } else if ((existing.address ?? null) !== address) {
      await db.prepare("UPDATE ev_chargers SET postal_code = ?, address = ?, note = ?, township = ?, region_id = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE code = ? AND name = ?").bind(row.postal_code || null, address, row.note || null, row.township || null, row.region_id || null, chargers.dataset_url, chargers.source_url, now, code, name).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "ev_chargers", chargers?.dataset_url, ["code", "name"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_chargers', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistGasStations(db, { stations, now, actor = "scheduler" }) {
  const keys = [];
  let upserted = 0;
  for (const row of stations?.stations || []) {
    const name = String(row?.name || "").trim();
    if (!name) continue;
    const code = row.code == null || String(row.code).trim() === "" ? "" : String(row.code).trim();
    keys.push([code, name]);
    const opened = row.opened_on || null;
    const existing = await db.prepare("SELECT opened_on, address FROM gas_stations WHERE code = ? AND name = ?").bind(code, name).first();
    if (!existing) {
      await db.prepare("INSERT INTO gas_stations (code, name, operator, opened_on, address, supplier, note, township, region_id, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(code, name, row.operator || null, opened, row.address || null, row.supplier || null, row.note || null, row.township || null, row.region_id || null, stations.dataset_url, stations.source_url, now).run();
      upserted += 1;
    } else if ((existing.opened_on ?? null) !== opened || (existing.address ?? null) !== (row.address || null)) {
      await db.prepare("UPDATE gas_stations SET operator = ?, opened_on = ?, address = ?, supplier = ?, note = ?, township = ?, region_id = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE code = ? AND name = ?").bind(row.operator || null, opened, row.address || null, row.supplier || null, row.note || null, row.township || null, row.region_id || null, stations.dataset_url, stations.source_url, now, code, name).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "gas_stations", stations?.dataset_url, ["code", "name"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_gas_stations', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistElectricBuses(db, { buses, now, actor = "scheduler" }) {
  const keys = [];
  let upserted = 0;
  for (const row of buses?.rows || []) {
    const route = String(row?.route || "").trim();
    if (!route) continue;
    const code = row.code == null || String(row.code).trim() === "" ? "" : String(row.code).trim();
    const routeNumber = row.route_number == null || String(row.route_number).trim() === "" ? "" : String(row.route_number).trim();
    keys.push([code, route, routeNumber]);
    const vehicles = row.vehicles == null || row.vehicles === "" ? null : String(row.vehicles);
    const existing = await db.prepare("SELECT vehicles, model FROM electric_bus_routes WHERE code = ? AND route = ? AND route_number = ?").bind(code, route, routeNumber).first();
    if (!existing) {
      await db.prepare("INSERT INTO electric_bus_routes (code, route, route_number, county, vehicles, brand, model, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(code, route, routeNumber, row.county || null, vehicles, row.brand || null, row.model || null, buses.dataset_url, buses.source_url, now).run();
      upserted += 1;
    } else if ((existing.vehicles ?? null) !== vehicles || (existing.model ?? null) !== (row.model || null)) {
      await db.prepare("UPDATE electric_bus_routes SET county = ?, vehicles = ?, brand = ?, model = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE code = ? AND route = ? AND route_number = ?").bind(row.county || null, vehicles, row.brand || null, row.model || null, buses.dataset_url, buses.source_url, now, code, route, routeNumber).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "electric_bus_routes", buses?.dataset_url, ["code", "route", "route_number"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_electric_buses', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistFarms(db, { farms, now, actor = "scheduler" }) {
  const keys = [];
  let upserted = 0;
  for (const row of farms?.farms || []) {
    const name = String(row?.name || "").trim();
    if (!name) continue;
    const code = row.code == null || String(row.code).trim() === "" ? "" : String(row.code).trim();
    keys.push([code, name]);
    const expiry = row.valid_until || null;
    const existing = await db.prepare("SELECT valid_until, status FROM organic_farms WHERE code = ? AND name = ?").bind(code, name).first();
    if (!existing) {
      await db.prepare("INSERT INTO organic_farms (code, name, postal_code, address, township, region_id, certifier, transition_cert, organic_cert, valid_until, status, area, products, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(code, name, row.postal_code || null, row.address || null, row.township || null, row.region_id || null, row.certifier || null, row.transition_cert || null, row.organic_cert || null, expiry, row.status || null, row.area || null, row.products || null, farms.dataset_url, farms.source_url, now).run();
      upserted += 1;
    } else if ((existing.valid_until ?? null) !== expiry || (existing.status ?? null) !== (row.status || null)) {
      await db.prepare("UPDATE organic_farms SET postal_code = ?, address = ?, township = ?, region_id = ?, certifier = ?, transition_cert = ?, organic_cert = ?, valid_until = ?, status = ?, area = ?, products = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE code = ? AND name = ?").bind(row.postal_code || null, row.address || null, row.township || null, row.region_id || null, row.certifier || null, row.transition_cert || null, row.organic_cert || null, expiry, row.status || null, row.area || null, row.products || null, farms.dataset_url, farms.source_url, now, code, name).run();
      upserted += 1;
    }
  }
  await deleteMissing(db, "organic_farms", farms?.dataset_url, ["code", "name"], keys);
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_farms', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
  return { upserted };
}

export async function persistRescue(db, { rescue, now, actor = "scheduler" }) {
  const keys = [];
  let upserted = 0;
  for (const row of rescue?.rows || []) {
    const region = String(row?.region || "").trim();
    if (!region) continue;
    keys.push(region);
    const general = row.general_ambulances || null;
    const existing = await db.prepare("SELECT general_ambulances, transports FROM rescue_stats WHERE region = ?").bind(region).first();
    if (!existing) {
      await db.prepare("INSERT INTO rescue_stats (region, region_id, general_ambulances, intensive_ambulances, transports, not_transported, dataset_url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(region, row.region_id || null, general, row.intensive_ambulances || null, row.transports || null, row.not_transported || null, rescue.dataset_url, rescue.source_url, now).run();
      upserted += 1;
    } else if ((existing.general_ambulances ?? null) !== general || (existing.transports ?? null) !== (row.transports || null)) {
      await db.prepare("UPDATE rescue_stats SET region_id = ?, general_ambulances = ?, intensive_ambulances = ?, transports = ?, not_transported = ?, dataset_url = ?, source_url = ?, fetched_at = ? WHERE region = ?").bind(row.region_id || null, general, row.intensive_ambulances || null, row.transports || null, row.not_transported || null, rescue.dataset_url, rescue.source_url, now, region).run();
      upserted += 1;
    }
  }
  if (keys.length && rescue?.dataset_url) {
    const placeholders = keys.map(() => "?").join(",");
    await db.prepare(`DELETE FROM rescue_stats WHERE dataset_url = ? AND region NOT IN (${placeholders})`).bind(rescue.dataset_url, ...keys).run();
  }
  await db.prepare("INSERT INTO audit_logs (id, actor, action, target, created_at) VALUES (?, ?, 'persist_rescue', ?, ?)").bind(crypto.randomUUID(), actor, `upserted=${upserted}`, now).run();
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
