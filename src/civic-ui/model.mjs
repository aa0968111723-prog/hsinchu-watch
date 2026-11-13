/** One model for the figure, the tables and the cards.
 *
 *  Everything a component draws as a length comes from here, so a stack of
 *  paper, a table bar and a readout can never disagree. Unknown stays null all
 *  the way to the screen: it is never drawn as zero.
 */

export const KIND_SHORT = Object.freeze({
  news: "新聞", source: "來源", policy: "政策", poll: "民調", comment: "留言",
  stance: "立場", official: "發言", monitor: "待複核", governance: "治理",
});

/** What a record is, kept apart from whether it is true. */
export const ORIGINS = Object.freeze({
  claim: { label: "人物／機關主張", tone: "clay" },
  agency: { label: "機關發布", tone: "sky" },
  report: { label: "既有報導整理", tone: "stone" },
  opinion: { label: "意見", tone: "wheat" },
  challenge: { label: "質疑", tone: "plum" },
  response: { label: "回應", tone: "sage" },
  check: { label: "查核", tone: "sage" },
  judicial: { label: "司法程序", tone: "plum" },
  index: { label: "來源索引", tone: "stone" },
  poll: { label: "民調紀錄", tone: "sky" },
  pending: { label: "待複核", tone: "wheat" },
  unknown: { label: "待交叉佐證", tone: "stone" },
});

const KIND_ORIGIN = Object.freeze({
  news: "report", policy: "report", stance: "report", official: "claim", comment: "opinion",
  poll: "poll", source: "index", monitor: "pending", governance: "agency",
});

const CLAIM_ORIGIN = Object.freeze({
  independently_reported: "report", self_claimed: "claim", uncorroborated: "unknown",
});

const EVENT_KIND = Object.freeze({
  agency_report: "機關發布", official_notice: "機關公告", register_update: "機關表列更新",
});

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

/** http(s) only, no credentials. Anything else is not a link. */
export function safeHref(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function isKnown(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

/** A linear scale shared by every reading of the same rows.
 *  `max` pins the scale (a filtered view keeps the full snapshot's scale so the
 *  stacks shrink instead of re-stretching). A null count stays null. */
export function scaleOf(rows, { max } = {}) {
  const known = rows.filter((row) => isKnown(row.count)).map((row) => Number(row.count));
  const top = isKnown(max) && Number(max) > 0 ? Number(max) : (known.length ? Math.max(...known) : 0);
  return {
    max: top,
    total: known.reduce((sum, count) => sum + count, 0),
    complete: known.length === rows.length,
    rows: rows.map((row) => {
      const count = isKnown(row.count) ? Number(row.count) : null;
      const share = count === null || top <= 0 ? null : Math.min(1, count / top);
      return { ...row, count, share, short: row.short || KIND_SHORT[row.id] || row.label };
    }),
  };
}

export function formatCount(value) {
  return isKnown(value) ? Number(value).toLocaleString("zh-TW") : "未知";
}

function trimZeros(text) {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** Percent text with enough digits that a non-zero share never prints as 0. */
export function formatShare(share) {
  if (!isKnown(share)) return "未知";
  const pct = Number(share) * 100;
  if (pct <= 0) return "0%";
  if (pct >= 99.95) return "100%";
  if (pct >= 10) return `${trimZeros(pct.toFixed(1))}%`;
  if (pct >= 1) return `${trimZeros(pct.toFixed(2))}%`;
  if (pct >= 0.01) return `${trimZeros(pct.toFixed(3))}%`;
  return "不到 0.01%";
}

export function formatTwd(value) {
  return isKnown(value) ? `${Number(value).toLocaleString("zh-TW")} 元` : "尚未收錄";
}

/** 975,210,000 → 9.75 億元. Rounded for reading; the exact figure sits beside it. */
export function formatTwdShort(value) {
  if (!isKnown(value)) return "尚未收錄";
  const number = Number(value);
  if (Math.abs(number) >= 1e8) return `${trimZeros((number / 1e8).toFixed(2))} 億元`;
  if (Math.abs(number) >= 1e4) return `${trimZeros((number / 1e4).toFixed(1))} 萬元`;
  return `${number.toLocaleString("zh-TW")} 元`;
}

/** Dates keep the precision the source gave. A month is not padded to a day. */
export function dateLabel(value, precision) {
  if (!value) return "未標示";
  const text = String(value);
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (day && precision !== "month" && precision !== "year") return `${day[1]}/${day[2]}/${day[3]}`;
  const month = /^(\d{4})-(\d{2})/.exec(text);
  if (month && precision !== "year") return `${month[1]} 年 ${Number(month[2])} 月`;
  const year = /^(\d{4})/.exec(text);
  return year ? `${year[1]} 年` : "未標示";
}

/** Sortable key that keeps month-only dates after the days of that month. */
export function dateKey(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{4}-\d{2}/.test(text)) return `${text.slice(0, 7)}-99`;
  if (/^\d{4}/.test(text)) return `${text.slice(0, 4)}-99-99`;
  return "";
}

export function eventLabel(kind) {
  return EVENT_KIND[kind] || "事件紀錄";
}

export function originOf(kind, record = {}) {
  const key = CLAIM_ORIGIN[record.claim_origin] || KIND_ORIGIN[kind] || "unknown";
  return { key, ...ORIGINS[key] };
}

/** Engineering progress only. 100% is completion of works, not acceptance. */
export function progressReadout(progress) {
  const value = progress && typeof progress === "object" ? progress.value : progress;
  const asOf = progress && typeof progress === "object" ? progress.as_of ?? null : null;
  if (!isKnown(value)) {
    return { known: false, value: null, asOf, text: "工程進度尚未收錄", note: "沒有數字不代表進度是零。" };
  }
  const number = Math.max(0, Math.min(100, Number(value)));
  return {
    known: true,
    value: number,
    asOf,
    text: `工程進度 ${trimZeros(number.toFixed(2))}%`,
    note: number >= 100
      ? "100% 是工程進度，不等於已驗收、點交、營運或有成效。"
      : (asOf ? "" : "來源沒有標示這個數字的基準日。"),
  };
}

/** Budget lines on one scale. Missing lines stay in place as unknown. */
export function budgetReadout(budget) {
  const lines = [
    { key: "approved_twd", label: "核定經費" },
    { key: "contract_twd", label: "決標金額" },
    { key: "spent_twd", label: "實際支用" },
  ].map((line) => ({ ...line, value: budget && isKnown(budget[line.key]) ? Number(budget[line.key]) : null }));
  const known = lines.filter((line) => line.value !== null).map((line) => line.value);
  const max = known.length ? Math.max(...known) : 0;
  return {
    known: known.length > 0,
    max,
    lines: lines.map((line) => ({ ...line, share: line.value === null || max <= 0 ? null : line.value / max })),
  };
}

/** Verified poll figures only, on their own 0–100 scale. */
export function pollBar(value) {
  if (!isKnown(value)) return null;
  const number = Number(value);
  return number < 0 || number > 100 ? null : number;
}

/** Official roster order: race, then ballot number. Never by volume or party. */
export function rosterOrder(review) {
  const races = (review?.races || []).map((race) => race.id);
  return [...(review?.candidates || [])].sort((a, b) =>
    (races.indexOf(a.race_id) - races.indexOf(b.race_id)) || ((a.ballot_number || 0) - (b.ballot_number || 0)));
}

export function filterProjects(projects, { region = "", topic = "", query = "", savedOnly = false, saved = [] } = {}) {
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase();
  return projects.filter((project) =>
    (!region || project.region_id === region)
    && (!topic || project.topic_id === topic)
    && (!savedOnly || saved.includes(project.id))
    && (!needle || [project.title, project.agency, project.summary, project.phase_label]
      .join(" ").normalize("NFKC").toLocaleLowerCase().includes(needle)));
}

/** Rows of the side-by-side table. Every cell is text; unknown says so. */
export function compareRows(projects, registry) {
  const name = (list, id) => (list || []).find((item) => item.id === id)?.name || "未標示";
  const cell = (project, pick) => pick(project);
  const fields = [
    ["地區", (p) => name(registry?.regions, p.region_id)],
    ["議題", (p) => name(registry?.topics, p.topic_id)],
    ["主辦機關", (p) => p.agency || "未標示"],
    ["目前階段", (p) => p.phase_label || "未標示"],
    ["階段紀錄日期", (p) => dateLabel(p.phase_as_of, /^\d{4}-\d{2}$/.test(String(p.phase_as_of || "")) ? "month" : "day")],
    ["工程進度", (p) => { const r = progressReadout(p.progress); return r.known ? `${trimZeros(r.value.toFixed(2))}%` : "尚未收錄"; }],
    ["進度基準日", (p) => (isKnown(p.progress?.value) ? dateLabel(p.progress?.as_of) : "不適用")],
    ["來源所列目標", (p) => (p.target ? dateLabel(p.target.value, p.target.precision) : "尚未收錄")],
    ["核定經費", (p) => formatTwd(p.budget?.approved_twd)],
    ["決標金額", (p) => formatTwd(p.budget?.contract_twd)],
    ["實際支用", (p) => formatTwd(p.budget?.spent_twd)],
    ["事件紀錄", (p) => `${(p.events || []).length} 筆`],
    ["待補證據", (p) => `${(p.missing_evidence || []).length} 項`],
  ];
  return fields.map(([label, pick]) => ({ label, cells: projects.map((project) => cell(project, pick)) }));
}

/** Map sidebar contract (CONTRACTS.md, Geography): an item without evidence
 *  for a place has geometry null and goes to the to-locate list. */
export const PRECISION = Object.freeze({
  site: "工地或場址", street: "路段", area: "行政區範圍", unknown: "尚無座標來源",
});

export function placeItems(projects) {
  return (projects || []).map((project) => ({
    id: project.id,
    title: project.title,
    region_id: project.region_id,
    topic_id: project.topic_id,
    status: project.phase_label || "",
    geometry: project.geometry ?? null,
    location_precision: project.geometry ? (project.location_precision || "unknown") : "unknown",
    coordinate_source: project.geometry ? (project.coordinate_source ?? null) : null,
  }));
}

export function splitByLocation(items) {
  const located = [];
  const pending = [];
  for (const item of items) {
    const point = item.geometry?.type === "Point" && Array.isArray(item.geometry.coordinates)
      && item.geometry.coordinates.length === 2 && item.geometry.coordinates.every(isKnown);
    const sourced = Boolean(item.coordinate_source?.url);
    ((item.geometry && (point || item.geometry.type !== "Point") && sourced) ? located : pending).push(item);
  }
  return { located, pending };
}

/** Saved ids in this browser only. Storage can be blocked; the list still works. */
export function createStore(key, storage) {
  let memory = [];
  const box = storage === undefined ? (() => { try { return globalThis.localStorage; } catch { return null; } })() : storage;
  const read = () => {
    try {
      const parsed = JSON.parse(box?.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : memory;
    } catch {
      return memory;
    }
  };
  const write = (ids) => {
    memory = [...new Set(ids)];
    try { box?.setItem(key, JSON.stringify(memory)); } catch { /* private mode: keep it in memory */ }
    return memory;
  };
  memory = read();
  return {
    all: () => read(),
    has: (id) => read().includes(id),
    toggle: (id) => write(read().includes(id) ? read().filter((item) => item !== id) : [...read(), id]),
    clear: () => write([]),
  };
}

/** True when the snapshot the page is serving is not the one the counts were
 *  taken from. `inputs` are the manifest file hashes recorded at count time. */
export function summaryIsStale(summary, manifest) {
  if (!summary?.inputs || !manifest?.files) return null;
  return Object.entries(summary.inputs).some(([name, sha]) => manifest.files[name]?.sha256 !== sha);
}
