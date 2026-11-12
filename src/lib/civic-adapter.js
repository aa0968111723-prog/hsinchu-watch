/**
 * 把既有快照投影成共用契約。
 * 不另算一套統計，也不把未知寫成 0、把 HTTP 成功寫成查核。
 */
export const REFRESH_INTERVAL_MS = 20 * 60 * 1000

const ORIGIN_BY_KIND = {
  news: 'report',
  policy: 'agency_release',
  poll: 'report',
  comment: 'opinion',
  source: 'unknown',
  official: 'agency_release',
  stance: 'claim',
  governance: 'agency_release',
  monitor: 'unknown',
}

export function backoffMs(failures) {
  const exponent = Math.min(3, Math.max(0, Number(failures) - 1))
  return REFRESH_INTERVAL_MS * (2 ** exponent)
}

export function applyRefreshResult(previous, attempt) {
  if (!attempt || typeof attempt.at !== 'string' || Number.isNaN(Date.parse(attempt.at))) {
    throw new Error('refresh attempt needs an ISO timestamp')
  }
  const prior = previous && typeof previous === 'object' ? previous : {}
  const priorPayload = Object.prototype.hasOwnProperty.call(prior, 'payload') ? prior.payload : null
  const priorSuccess = prior.last_success_at ?? null
  const priorFailures = Number.isInteger(prior.consecutive_failures) ? prior.consecutive_failures : 0
  const usable = attempt.ok === true && attempt.payload !== undefined && attempt.payload !== null
  if (!usable) {
    const failures = priorFailures + 1
    return {
      payload: priorPayload,
      last_attempt_at: attempt.at,
      last_success_at: priorSuccess,
      next_due_at: new Date(Date.parse(attempt.at) + backoffMs(failures)).toISOString(),
      consecutive_failures: failures,
      health: priorPayload == null ? 'failed' : 'stale',
      last_error: attempt.error || 'fetch_failed',
    }
  }
  return {
    payload: attempt.payload,
    last_attempt_at: attempt.at,
    last_success_at: attempt.at,
    next_due_at: new Date(Date.parse(attempt.at) + REFRESH_INTERVAL_MS).toISOString(),
    consecutive_failures: 0,
    health: 'ok',
    last_error: null,
  }
}

export function normalizeRefresh(log) {
  if (!log) {
    return {
      interval_minutes: 20,
      configured: false,
      enabled: false,
      last_attempt_at: null,
      last_success_at: null,
      next_due_at: null,
      consecutive_failures: null,
      health: 'unknown',
      last_error: null,
    }
  }
  const lastSuccess = log.last_success_at ?? null
  const lastAttempt = log.last_attempt_at ?? null
  const failures = Number.isInteger(log.consecutive_failures) ? log.consecutive_failures : null
  let health = 'unknown'
  if (lastSuccess && failures > 0) health = 'stale'
  else if (lastSuccess) health = 'ok'
  else if (lastAttempt) health = 'failed'
  return {
    interval_minutes: 20,
    configured: true,
    enabled: log.enabled === true,
    last_attempt_at: lastAttempt,
    last_success_at: lastSuccess,
    next_due_at: log.next_due_at ?? null,
    consecutive_failures: failures,
    health,
    last_error: log.last_error ?? null,
  }
}

export function adaptSource(source) {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    url: source.url,
    region_ids: source.region_id ? [source.region_id] : (source.region_ids || []),
    access_method: source.access_method || 'public_page',
    coverage_note: source.coverage_note || source.agency || null,
    last_attempt_at: source.last_attempt_at ?? null,
    last_success_at: source.last_success_at ?? null,
    next_due_at: source.next_due_at ?? null,
    health: source.last_success_at ? (source.health || 'unknown') : 'unknown',
    checked_at: source.checked_at ?? null,
    source_updated_at: source.source_updated_at ?? null,
  }
}

function evidenced(value) {
  return Boolean(value && Array.isArray(value.evidence_refs) && value.evidence_refs.length)
}

export function adaptProject(project) {
  const budget = project.budget || {}
  const progress = project.progress
  return {
    id: project.id,
    title: project.title,
    region_id: project.region_id,
    topic_id: project.topic_id ?? null,
    agency: project.agency ?? null,
    status: project.status || project.phase_label || project.phase || null,
    status_as_of: project.status_as_of ?? project.phase_as_of ?? null,
    target: project.target ? {
      value: project.target.value ?? null,
      precision: project.target.precision ?? null,
      label: project.target.label ?? null,
    } : null,
    budget: {
      approved_twd: budget.approved_twd ?? null,
      contract_twd: budget.contract_twd ?? null,
      spent_twd: budget.spent_twd ?? null,
    },
    events: project.events || [],
    evidence_refs: (project.events || []).map(event => event.source_id).filter(Boolean),
    missing_evidence: project.missing_evidence || [],
    progress: progress && typeof progress.value === 'number' ? {
      value: progress.value,
      source_id: progress.source_id || null,
      as_of: progress.as_of ?? null,
      means: 'reported_progress',
    } : null,
    acceptance: evidenced(project.acceptance) ? project.acceptance : null,
    operation: evidenced(project.operation) ? project.operation : null,
    outcome: evidenced(project.outcome) ? project.outcome : null,
  }
}

export function adaptGeography(project) {
  const geo = project.geography
  if (!geo || !geo.geometry) {
    return {
      id: project.id,
      geometry: null,
      location_precision: 'unknown',
      coordinate_source: null,
    }
  }
  return {
    id: project.id,
    geometry: geo.geometry,
    location_precision: geo.location_precision,
    coordinate_source: geo.coordinate_source,
  }
}

export function adaptArchiveRow(row) {
  const raw = row.record || {}
  const pending = row.status === 'pending'
  return {
    id: raw.id || row.key,
    kind: row.kind,
    source_id: raw.source_id || null,
    source_url: row.url || null,
    published_at: raw.published_at || raw.date || row.date || null,
    collected_at: raw.collected_at ?? null,
    checked_at: raw.checked_at ?? null,
    date_precision: datePrecision(raw.published_at || row.date),
    actor_refs: row.people || [],
    region_refs: raw.region_refs || [],
    text_excerpt: row.summary || null,
    claim_origin: ORIGIN_BY_KIND[row.kind] || 'unknown',
    verification_status: pending ? 'unreviewed' : 'reported',
    verification_basis: pending ? 'not_checked' : 'archive_record',
    stats_eligible: row.status === 'recorded',
    response_in_record: raw.response_in_record === true ? true : null,
  }
}

export function noteHttpStatus(record, status) {
  const next = { ...record, last_http_status: status ?? null }
  if (next.verification_status === 'corroborated' && next.verification_basis === 'http_status') {
    next.verification_status = 'unreviewed'
    next.verification_basis = 'not_checked'
  }
  return next
}

function datePrecision(value) {
  if (!value) return 'unknown'
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return 'datetime'
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return 'day'
  if (/^\d{4}-\d{2}$/.test(text)) return 'month'
  if (/^\d{4}$/.test(text)) return 'year'
  return 'unknown'
}

export function buildCivicSnapshot(docs) {
  const manifest = docs.manifest || null
  const registry = docs.governanceRegistry || null
  const governance = docs.governance || null
  const candidates = docs.candidates || null
  const projects = governance ? (governance.projects || []).map(adaptProject) : null
  const sources = registry ? (registry.sources || []).map(adaptSource) : null
  const counts = manifest?.counts || {}
  return {
    schema_version: 1,
    times: {
      data_generated_at: manifest?.generated_at ?? null,
      ui_updated_at: manifest?.ui_updated_at ?? null,
      manifest_finalized_at: manifest?.finalized_at ?? null,
      governance_reviewed_at: governance?.reviewed_at ?? null,
      roster_checked_at: candidates?.checked_at ?? null,
      refresh_last_success_at: normalizeRefresh(docs.refreshLog).last_success_at,
    },
    counts: {
      items_rows: counts.items_rows ?? null,
      items_unique_url: counts.items_unique_url ?? null,
      polls: counts.polls ?? null,
      pending_review: counts.pending_review ?? null,
      governance_projects: projects ? projects.length : null,
      governance_sources: sources ? sources.length : null,
      official_candidates: candidates ? (candidates.candidates || []).length : null,
      bill_rows: null,
    },
    sources,
    projects,
    geography: projects ? (governance.projects || []).map(adaptGeography) : null,
    candidates: candidates ? (candidates.candidates || []) : null,
    races: candidates ? (candidates.races || []) : null,
    refresh: normalizeRefresh(docs.refreshLog),
    central: {
      bill_rows: null,
      catalog_source_ids: (sources || []).filter(source => source.kind === 'national_catalog').map(source => source.id),
    },
    loaded: {
      manifest: Boolean(manifest),
      governance: Boolean(governance),
      governanceRegistry: Boolean(registry),
      candidates: Boolean(candidates),
      refreshLog: Boolean(docs.refreshLog),
    },
  }
}
