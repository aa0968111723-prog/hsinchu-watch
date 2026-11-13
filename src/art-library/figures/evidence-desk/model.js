/**
 * Evidence desk. Two separate facts about one record, in the words the data uses:
 * who said it (claim_origin) and whether it was checked (verification_status).
 * Sliding the card tray changes the first. Only the stamp changes the second.
 *
 * Everything the figure shows comes from this model. It has no DOM, so the
 * same rules run in the page and in tests/art-library/figures.test.mjs.
 */
import { clamp, follow, spring } from "../motion.js";

export const ORIGINS = [
  { id: "agency_release", label: "機關發布" },
  { id: "news_report", label: "新聞報導" },
  { id: "legislative_record", label: "議事紀錄" },
  { id: "public_post", label: "公開貼文" },
];

export const STATUS = { unreviewed: "未逐筆核對", corroborated: "已有佐證" };

/** World units. Stack centres sit PITCH apart on the tray, the stamp stays put. */
export const PITCH = 30;
export const FIRST = -46;
export const STACK = { w: 22, d: 36, h: 12 };
export const STAMP = { x: 0, y: -6, lift: 14 };

export const centreOf = (index) => FIRST + index * PITCH;
export const stopOf = (index) => STAMP.x - centreOf(index);
export const STOPS = ORIGINS.map((_, index) => stopOf(index));

/** The stack squarely under the stamp at tray offset x, or -1 between stacks. */
export function under(x) {
  return STOPS.findIndex((stop) => Math.abs(stop - x) < 0.6);
}

export function describe(index, stamped) {
  if (index < 0) return "卡片架移動中 · 章沒有落下";
  return `${ORIGINS[index].label} · ${stamped[index] ? STATUS.corroborated : STATUS.unreviewed}`;
}

export function createDesk(start = 0) {
  return {
    index: start, // the stack the reader chose
    goal: STOPS[start], // where the tray is heading
    x: STOPS[start], // where the tray is
    lift: { at: STAMP.lift, rate: 0 }, // stamp height above the cards
    stamped: ORIGINS.map(() => false),
    press: "idle", // idle → down → hold → up → idle
    pressed: start, // the stack a press is meant for
    dwell: 0,
  };
}

export function choose(desk, index) {
  desk.index = clamp(index, 0, STOPS.length - 1);
}

/** Starts a press for the chosen stack. A press already under way is not restarted. */
export function press(desk) {
  if (desk.press !== "idle") return false;
  desk.press = "down";
  desk.pressed = desk.index;
  return true;
}

export function clearMarks(desk) {
  desk.stamped.fill(false);
}

/**
 * Advances the desk by dt seconds. Returns true while anything still moves.
 * `calm` is reduced motion: the tray and the stamp reach their targets at once.
 */
export function advance(desk, dt, calm) {
  // A press is for the stack chosen when it began: the tray finishes going there first.
  // After contact the tray stays put until the stamp has lifted clear of the cards.
  if (desk.press === "idle") desk.goal = STOPS[desk.index];
  else if (desk.press === "down") desk.goal = STOPS[desk.pressed];
  else if (desk.press === "up" && desk.lift.at > STAMP.lift * 0.45) desk.goal = STOPS[desk.index];
  desk.x = follow(desk.x, desk.goal, dt, 0.26, calm);

  if (desk.press === "down" && desk.x === desk.goal) {
    if (calm) {
      desk.stamped[desk.pressed] = true;
      desk.press = "idle";
    } else {
      spring(desk.lift, -1.5, dt, 520, 30, false);
      if (desk.lift.at <= 0) {
        desk.lift.at = 0;
        desk.lift.rate = 0;
        desk.stamped[desk.pressed] = true;
        desk.press = "hold";
        desk.dwell = 0;
      }
    }
  } else if (desk.press === "hold") {
    desk.dwell += dt;
    if (desk.dwell > 0.18) desk.press = "up";
  } else if (desk.press === "up") {
    if (spring(desk.lift, STAMP.lift, dt, 240, 26, calm)) desk.press = "idle";
  }
  return desk.x !== STOPS[desk.index] || desk.press !== "idle";
}
