/**
 * Council desk. Three binders on a dais: proposal, review, resolution.
 * Having a proposal does not invent a review or a resolution. The gavel is
 * the subject that moves; the binders only change which step is being read.
 *
 * No vote tally or passage date is built into the figure.
 */
import { clamp, follow, spring } from "../motion.js";

export const BINDERS = [
  { id: "proposal", label: "提案" },
  { id: "review", label: "審查" },
  { id: "resolution", label: "決議" },
];

export const PITCH = 36;
export const FIRST = -36;
export const GAVEL_X = 0;
export const REST = 18;
export const STRIKE = 0;

export const centreOf = (index) => FIRST + index * PITCH;
export const stopOf = (index) => GAVEL_X - centreOf(index);
export const STOPS = BINDERS.map((_, index) => stopOf(index));

export function createDesk(start = 0) {
  return {
    chosen: start,
    x: STOPS[start],
    goal: STOPS[start],
    gavel: { at: REST, rate: 0 },
    strike: "idle",
    dwell: 0,
  };
}

export function choose(desk, index) {
  desk.chosen = clamp(index, 0, BINDERS.length - 1);
  desk.goal = STOPS[desk.chosen];
}

/** Starts a gavel strike on the chosen binder. A strike already under way is kept. */
export function strike(desk) {
  if (desk.strike !== "idle") return false;
  desk.strike = "down";
  return true;
}

export function describe(desk) {
  const binder = BINDERS[desk.chosen];
  if (desk.strike !== "idle") return `${binder.label} · 議事槌落下（示意，不是表決結果）`;
  return `${binder.label} · 只讀這一本，不推算另外兩本`;
}

export function advance(desk, dt, calm) {
  if (desk.strike === "idle") desk.goal = STOPS[desk.chosen];
  desk.x = follow(desk.x, desk.goal, dt, 0.26, calm);

  if (desk.strike === "down") {
    if (calm || desk.x === desk.goal) {
      if (calm) {
        desk.gavel.at = REST;
        desk.gavel.rate = 0;
        desk.strike = "idle";
      } else {
        spring(desk.gavel, STRIKE - 1, dt, 480, 28, false);
        if (desk.gavel.at <= STRIKE) {
          desk.gavel.at = STRIKE;
          desk.gavel.rate = 0;
          desk.strike = "hold";
          desk.dwell = 0;
        }
      }
    }
  } else if (desk.strike === "hold") {
    desk.dwell += dt;
    if (desk.dwell > 0.16) desk.strike = "up";
  } else if (desk.strike === "up") {
    if (spring(desk.gavel, REST, dt, 260, 24, calm)) desk.strike = "idle";
  }

  return desk.x !== desk.goal || desk.strike !== "idle";
}
