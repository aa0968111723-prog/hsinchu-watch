import assert from "node:assert/strict";
import test from "node:test";
import { ARCHIVE_SUMMARY } from "./archive-summary.mjs";
import { createGauge } from "./gauge.mjs";
import {
  budgetReadout, compareRows, filterProjects, formatShare, isKnown, placeItems,
  pollBar, progressReadout, rosterOrder, scaleOf, splitByLocation, summaryIsStale,
} from "./model.mjs";

const counts = ARCHIVE_SUMMARY.open.counts;

test("published archive counts are the shared scale, and they add up", () => {
  assert.equal(ARCHIVE_SUMMARY.open.total, 18422);
  assert.equal(counts.news, 9164);
  assert.equal(counts.source, 7205);
  assert.equal(counts.policy, 1879);
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 18422);
  assert.equal(ARCHIVE_SUMMARY.blackout.counts.poll, 0);
  assert.equal(ARCHIVE_SUMMARY.blackout.total + ARCHIVE_SUMMARY.blackout.held + counts.poll, 18422);
});

test("paper height, table share and readout use one scale, and a small count is not zero", () => {
  const rows = Object.entries(counts).map(([id, count]) => ({ id, count }));
  const scale = scaleOf(rows);
  assert.equal(scale.max, 9164);
  const news = scale.rows.find((row) => row.id === "news");
  const governance = scale.rows.find((row) => row.id === "governance");
  assert.equal(news.share, 1);
  assert.equal(formatShare(governance.share), "0.044%");
  const gauge = createGauge(scale.rows);
  assert.equal(gauge.heightOf(news.share, news.count), gauge.heightOf(1, 9164));
  assert.ok(gauge.heightOf(governance.share, governance.count) > 0);
  assert.equal(gauge.heightOf(null, null), 0);
  const html = gauge.svg(scale.rows.map((row) => ({ tall: gauge.heightOf(row.share, row.count), state: "known" })));
  assert.equal(html.includes("data-tray"), true);
  assert.equal((html.match(/class="iso-solid/g) || []).length > 40, true);
});

test("missing progress and spending stay unknown, and 100% is not acceptance", () => {
  const missing = progressReadout(null);
  assert.equal(missing.known, false);
  assert.equal(missing.value, null);
  const done = progressReadout({ value: 100, as_of: "2026-06-01" });
  assert.match(done.note, /驗收/);
  const partial = progressReadout({ value: 77.25, as_of: null });
  assert.equal(partial.value, 77.25);
  assert.match(partial.note, /基準日/);
  const budget = budgetReadout({ approved_twd: 975210000, contract_twd: 752800000, spent_twd: null });
  assert.equal(budget.lines.find((line) => line.key === "spent_twd").share, null);
  assert.equal(budget.lines.find((line) => line.key === "approved_twd").share, 1);
  assert.equal(budgetReadout(null).known, false);
});

test("poll percentages use their own 0–100 scale", () => {
  assert.equal(pollBar(44.1), 44.1);
  assert.equal(pollBar(0), 0);
  assert.equal(pollBar(null), null);
  assert.equal(pollBar(101), null);
  assert.equal(isKnown(null), false);
});

test("filters, comparison and the map list do not invent a place", () => {
  const projects = [
    { id: "a", title: "道路", region_id: "taipei", topic_id: "transport", agency: "工務局", summary: "", phase_label: "開工", progress: null, budget: null, events: [], missing_evidence: ["驗收"] },
    { id: "b", title: "住宅", region_id: "new-taipei", topic_id: "housing", agency: "都發局", summary: "", phase_label: "施工", progress: { value: 10, as_of: null }, budget: null, events: [{ date: "2026-01-01" }], missing_evidence: [] },
  ];
  assert.deepEqual(filterProjects(projects, { region: "taipei" }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterProjects(projects, { savedOnly: true, saved: ["b"] }).map((item) => item.id), ["b"]);
  const rows = compareRows(projects, { regions: [{ id: "taipei", name: "台北市" }, { id: "new-taipei", name: "新北市" }], topics: [] });
  assert.equal(rows.find((row) => row.label === "工程進度").cells[0], "尚未收錄");
  const places = placeItems(projects);
  assert.equal(places.every((item) => item.geometry === null), true);
  assert.deepEqual(splitByLocation(places).located, []);
  assert.equal(splitByLocation(places).pending.length, 2);
  const located = splitByLocation([{ ...places[0], geometry: { type: "Point", coordinates: [121.5, 25.0] }, coordinate_source: { url: "https://example.test/a" } }]);
  assert.equal(located.located.length, 1);
});

test("the roster stays in ballot order and a moved snapshot is noticed", () => {
  const review = { races: [{ id: "county" }, { id: "town" }], candidates: [{ id: "b", race_id: "town", ballot_number: 2 }, { id: "a", race_id: "county", ballot_number: 1 }] };
  assert.deepEqual(rosterOrder(review).map((person) => person.id), ["a", "b"]);
  assert.equal(summaryIsStale(ARCHIVE_SUMMARY, { files: ARCHIVE_SUMMARY.inputs && Object.fromEntries(Object.entries(ARCHIVE_SUMMARY.inputs).map(([name, sha]) => [name, { sha256: sha }])) }), false);
  assert.equal(summaryIsStale(ARCHIVE_SUMMARY, { files: { ...Object.fromEntries(Object.entries(ARCHIVE_SUMMARY.inputs).map(([name, sha]) => [name, { sha256: sha }])), "items.json": { sha256: "changed" } } }), true);
});
