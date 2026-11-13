/**
 * Stage yard. Five stages of a public works project sit as separate pegs on a
 * survey board: planned, under construction, completed, accepted, in use.
 * Completion is not acceptance, and acceptance is not occupancy. A peg only
 * lights when a sourced event for that stage is bound; a null stage is
 * unrecorded here, never zero progress and never inferred from another stage.
 *
 * No date or status is built into the figure. Events come from the governance
 * record bound to it.
 */
import { clamp, follow } from "../motion.js";

export const STAGES = [
  { id: "planned", label: "規劃" },
  { id: "under_construction", label: "施工" },
  { id: "completed", label: "完工" },
  { id: "accepted", label: "驗收" },
  { id: "in_use", label: "啟用" },
];

/** World units. Peg centres sit PITCH apart; the pointer stays put. */
export const PITCH = 34;
export const FIRST = -68;
export const POINTER_X = 0;

export const centreOf = (index) => FIRST + index * PITCH;
export const stopOf = (index) => POINTER_X - centreOf(index);
export const STOPS = STAGES.map((_, index) => stopOf(index));

/**
 * Conservative classifiers. Preparing language, target dates and a progress
 * percentage never promote a stage. Matching one stage never fills another.
 */
const MATCHERS = [
  {
    id: "in_use",
    test: (text) => /(取得使用執照|已啟用|已進住|已點交|已交屋)/.test(text) && !/準備/.test(text),
  },
  {
    id: "accepted",
    test: (text) => /(完成驗收|驗收合格|已驗收)/.test(text) && !/準備/.test(text),
  },
  {
    id: "completed",
    test: (text) =>
      /(列示完工|完工日期|已完工|竣工)/.test(text) && !/(目標完工|預定完工|預計完工|準備)/.test(text),
  },
  {
    id: "under_construction",
    test: (text) => /(開工|動土|在建|施工中)/.test(text),
  },
  {
    id: "planned",
    test: (text) => /(核定計畫|核定預算|規劃完成|用地取得)/.test(text),
  },
];

/** Picks at most one stage for one event summary. Later stages are tried first. */
export function stageOfSummary(summary) {
  const text = String(summary || "");
  for (const matcher of MATCHERS) {
    if (matcher.test(text)) return matcher.id;
  }
  return null;
}

/**
 * Builds the five stage slots from a list of events. The first matching event
 * for a stage wins. Stages with no match stay null. No stage is inferred from
 * another, and a progress percentage alone does not set any stage.
 */
export function stagesFromEvents(events) {
  const slots = Object.fromEntries(STAGES.map((stage) => [stage.id, null]));
  for (const event of events || []) {
    const id = stageOfSummary(event.summary);
    if (!id || slots[id]) continue;
    slots[id] = {
      date: event.date ?? null,
      precision: event.date_precision ?? event.precision ?? null,
      summary: event.summary,
      source_id: event.source_id ?? null,
      kind: event.kind ?? null,
    };
  }
  return slots;
}

export function createYard(start = 0) {
  return {
    bound: false,
    chosen: start,
    x: STOPS[start],
    goal: STOPS[start],
    pegs: STAGES.map(() => ({ state: "unbound", record: null })),
  };
}

/**
 * Binds stage records. `undefined` unbinds. `null` means the project has no
 * usable events, so every peg is unknown.
 */
export function bind(yard, slots) {
  yard.bound = slots !== undefined;
  yard.pegs.forEach((peg, index) => {
    const record = slots ? slots[STAGES[index].id] : null;
    peg.record = record;
    peg.state = !yard.bound ? "unbound" : record ? "known" : "unknown";
  });
}

export function choose(yard, index) {
  yard.chosen = clamp(index, 0, STAGES.length - 1);
  yard.goal = STOPS[yard.chosen];
}

export function advance(yard, dt, calm) {
  yard.x = follow(yard.x, yard.goal, dt, 0.26, calm);
  return yard.x !== yard.goal;
}

export function under(x) {
  return STOPS.findIndex((stop) => Math.abs(stop - x) < 0.6);
}

export function pegText(peg) {
  if (peg.state === "unbound") return "還沒選案卷";
  if (peg.state === "unknown") return "本站沒有這階段的紀錄";
  const when = peg.record.date || "日期未列";
  return `${when} · 有來源事件`;
}

export function describe(yard) {
  // The readout follows the chosen stage, not the board's mid-slide position,
  // so a tour or a click never flashes "移動中" as if the stage were missing.
  return `${STAGES[yard.chosen].label} · ${pegText(yard.pegs[yard.chosen])}`;
}
