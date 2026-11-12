import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  adaptArchiveRow,
  adaptGeography,
  adaptProject,
  adaptSource,
  applyRefreshResult,
  buildCivicSnapshot,
  noteHttpStatus,
} from '../../src/lib/civic-adapter.js'

const project = adaptProject({
  id: 'sample-road',
  title: '樣本道路',
  region_id: 'hsinchu-county',
  topic_id: 'transport',
  agency: '樣本機關',
  phase_label: '施工中',
  phase_as_of: '2026-11-12',
  progress: { value: 100, source_id: 'sample', as_of: '2026-11-12' },
  budget: { approved_twd: 10, contract_twd: null, spent_twd: null },
  events: [{ source_id: 'sample', date: '2026-11-12' }],
  missing_evidence: ['驗收'],
  outcome: { label: '完成', evidence_refs: [] },
})
assert.equal(project.progress.value, 100)
assert.equal(project.progress.means, 'reported_progress')
assert.equal(project.outcome, null)
assert.equal(project.acceptance, null)
assert.equal(project.budget.spent_twd, null)
assert.equal(project.budget.contract_twd, null)

const source = adaptSource({
  id: 'ly-data',
  name: '立法院開放資料',
  kind: 'national_catalog',
  url: 'https://data.ly.gov.tw/',
  region_id: null,
  agency: '立法院',
  checked_at: '2026-11-12',
  health: 'ok',
})
assert.equal(source.health, 'unknown')
assert.equal(source.last_success_at, null)
assert.deepEqual(source.region_ids, [])

const row = adaptArchiveRow({
  kind: 'news',
  key: 'news:1',
  status: 'recorded',
  people: ['wu'],
  url: 'https://example.com/story',
  summary: '報導摘錄',
  date: '2026-11-01',
  record: { id: 'story-1', published_at: '2026-11-01' },
})
assert.equal(row.claim_origin, 'report')
assert.equal(row.verification_status, 'reported')
assert.equal(row.stats_eligible, true)
assert.equal(row.response_in_record, null)
assert.equal(noteHttpStatus(row, 200).verification_status, 'reported')
const downgraded = noteHttpStatus({ ...row, verification_status: 'corroborated', verification_basis: 'http_status' }, 200)
assert.equal(downgraded.verification_status, 'unreviewed')

const pending = adaptArchiveRow({ kind: 'monitor', key: 'monitor:1', status: 'pending', people: [], record: {}, summary: '待審' })
assert.equal(pending.verification_status, 'unreviewed')
assert.equal(pending.stats_eligible, false)

assert.equal(adaptGeography({ id: 'sample-road' }).geometry, null)
assert.equal(adaptGeography({ id: 'sample-road' }).location_precision, 'unknown')

const kept = { payload: { rows: 3 }, last_success_at: '2026-11-13T00:00:00.000Z', consecutive_failures: 0 }
const failed = applyRefreshResult(kept, { at: '2026-11-13T01:00:00.000Z', ok: false, error: 'timeout', payload: { rows: 0 } })
assert.deepEqual(failed.payload, kept.payload)
assert.equal(failed.last_success_at, kept.last_success_at)
assert.equal(failed.health, 'stale')
assert.equal(failed.next_due_at, '2026-11-13T01:20:00.000Z')
const again = applyRefreshResult(failed, { at: '2026-11-13T02:00:00.000Z', ok: false, error: 'timeout' })
assert.equal(again.next_due_at, '2026-11-13T02:40:00.000Z')
const succeeded = applyRefreshResult(again, { at: '2026-11-13T03:00:00.000Z', ok: true, payload: { rows: 4 } })
assert.equal(succeeded.health, 'ok')
assert.equal(succeeded.last_success_at, '2026-11-13T03:00:00.000Z')
assert.deepEqual(succeeded.payload, { rows: 4 })
assert.equal(succeeded.next_due_at, '2026-11-13T03:20:00.000Z')
assert.throws(() => applyRefreshResult(null, { ok: true, payload: {} }))

const sections = JSON.parse(await readFile(new URL('../../src/lib/civic-sections.json', import.meta.url), 'utf8'))
const snapshot = buildCivicSnapshot({
  manifest: { generated_at: '2026-11-12T06:31:54.830322+08:00', ui_updated_at: '2026-11-12T23:45:01+08:00', counts: { items_rows: 9164, items_unique_url: 6958, polls: 83, pending_review: 81 } },
  governance: { reviewed_at: '2026-11-12', projects: [{ id: 'sample-road', title: '樣本道路', region_id: 'hsinchu-county', phase_label: '施工中', progress: { value: 100, source_id: 'sample' }, budget: { approved_twd: 10, contract_twd: null, spent_twd: null }, events: [], missing_evidence: [] }] },
  governanceRegistry: { sources: [{ id: 'ly-data', name: '立法院開放資料', kind: 'national_catalog', url: 'https://data.ly.gov.tw/', agency: '立法院', checked_at: '2026-11-12' }] },
  candidates: { checked_at: '2026-11-12', races: [{ id: 'county_magistrate', name: '新竹縣長' }], candidates: [{ id: 'zheng', name: '鄭朝方', race_id: 'county_magistrate', ballot_number: 1 }] },
})
assert.equal(snapshot.counts.items_rows, 9164)
assert.equal(snapshot.counts.bill_rows, null)
assert.equal(snapshot.counts.governance_projects, 1)
assert.equal(snapshot.central.bill_rows, null)
assert.deepEqual(snapshot.central.catalog_source_ids, ['ly-data'])
assert.equal(snapshot.refresh.health, 'unknown')
assert.equal(snapshot.refresh.configured, false)
assert.equal(snapshot.times.data_generated_at === snapshot.times.ui_updated_at, false)
assert.equal(snapshot.projects[0].outcome, null)
assert.equal(sections.sections.length, 8)

console.log(JSON.stringify({ civicAdapter: 'passed', sections: sections.sections.length }))
