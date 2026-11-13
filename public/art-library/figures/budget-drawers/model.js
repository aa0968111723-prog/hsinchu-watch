/**
 * Budget drawers. A project's budget is three separate amounts, stored apart
 * and never derived from one another: approved_twd, contract_twd, spent_twd.
 * Each sits in its own drawer. A drawer with a recorded amount opens. A drawer
 * whose amount is null is latched shut, which is not the same as holding 0.
 *
 * No amount is built into the figure. Amounts come from the record that is
 * bound to it (public/data/governance.json on the site).
 */
import { clamp, follow, spring } from "../motion.js";

export const LAYERS = [
  { id: "approved_twd", label: "核定" },
  { id: "contract_twd", label: "決標" },
  { id: "spent_twd", label: "實支" },
];

/** World units a drawer slides out. */
export const TRAVEL = 44;

const NUMBER = new Intl.NumberFormat("zh-Hant-TW");
export const formatTwd = (value) => `${NUMBER.format(value)} 元`;

export function createCabinet() {
  return {
    bound: false,
    chosen: 0,
    drawers: LAYERS.map(() => ({ state: "unbound", value: null, want: 0, at: 0, rate: 0, rattle: false })),
  };
}

/**
 * Binds a budget record. `undefined` unbinds. `null` means the project has no
 * budget record at all, so every layer is unknown.
 */
export function bind(cabinet, budget) {
  cabinet.bound = budget !== undefined;
  cabinet.drawers.forEach((drawer, index) => {
    const value = budget ? budget[LAYERS[index].id] : null;
    drawer.value = typeof value === "number" ? value : null;
    drawer.state = !cabinet.bound ? "unbound" : drawer.value === null ? "unknown" : "known";
    drawer.want = 0;
    drawer.rattle = false;
  });
}

export function choose(cabinet, index) {
  cabinet.chosen = clamp(index, 0, LAYERS.length - 1);
}

/** Pulls or pushes a drawer. A latched drawer only rattles. Returns true if it will open or close. */
export function toggle(cabinet, index = cabinet.chosen) {
  choose(cabinet, index);
  const drawer = cabinet.drawers[cabinet.chosen];
  if (drawer.state === "unknown") {
    drawer.rattle = true;
    return false;
  }
  drawer.want = drawer.want ? 0 : 1;
  return true;
}

/** Advances every drawer. Returns true while anything still moves. */
export function advance(cabinet, dt, calm) {
  let moving = false;
  for (const drawer of cabinet.drawers) {
    if (drawer.state === "unknown") {
      // A tug against the latch: a short push out, then the spring brings it home.
      if (drawer.rattle) {
        drawer.rattle = false;
        if (!calm) drawer.rate = 70;
      }
      const state = { at: drawer.at, rate: drawer.rate };
      const rested = spring(state, 0, dt, 360, 22, calm);
      drawer.at = Math.max(0, state.at);
      drawer.rate = drawer.at === 0 && state.rate < 0 ? 0 : state.rate;
      if (!rested && (drawer.at !== 0 || drawer.rate !== 0)) moving = true;
    } else {
      const target = drawer.want * TRAVEL;
      drawer.at = follow(drawer.at, target, dt, 0.22, calm);
      drawer.rate = 0;
      if (drawer.at !== target) moving = true;
    }
  }
  return moving;
}

/** Whether a drawer is far enough out for its slip to be read. */
export const isOpen = (drawer) => drawer.at > TRAVEL * 0.6;

/** What one layer says, in full. Used for the list under the figure. */
export function layerText(drawer) {
  if (drawer.state === "unbound") return "還沒選案卷";
  // "Not recorded here" is about this site's file, not about what the agency has published.
  if (drawer.state === "unknown") return "本站沒有紀錄，不是 0 元";
  return formatTwd(drawer.value);
}

/** The readout: the chosen layer, as the drawer shows it right now. */
export function describe(cabinet) {
  const drawer = cabinet.drawers[cabinet.chosen];
  const label = LAYERS[cabinet.chosen].label;
  if (drawer.state === "known" && !isOpen(drawer)) return `${label} · 有紀錄，拉開來看`;
  return `${label} · ${layerText(drawer)}`;
}
