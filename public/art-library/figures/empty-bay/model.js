/**
 * Empty bay. One plaque stand with a single bay.
 * An empty bay means there is no record here. It is not zero, and it is not
 * a filled plaque waiting to be invented.
 */
import { clamp, follow } from "../motion.js";

export const STATES = [
  { id: "unbound", label: "還沒選紀錄", plaque: false },
  { id: "missing", label: "本站沒有紀錄", plaque: false },
  { id: "present", label: "有來源紀錄", plaque: true },
];

export const OPEN = 0;
export const SEATED = 14;

export function createBay(start = 1) {
  const chosen = clamp(start, 0, STATES.length - 1);
  return {
    chosen,
    seated: STATES[chosen].plaque ? SEATED : OPEN,
    goal: STATES[chosen].plaque ? SEATED : OPEN,
  };
}

export function choose(bay, index) {
  bay.chosen = clamp(index, 0, STATES.length - 1);
  bay.goal = STATES[bay.chosen].plaque ? SEATED : OPEN;
}

export function describe(bay) {
  const state = STATES[bay.chosen];
  if (state.id === "present") {
    if (bay.seated < SEATED - 0.2) return `${state.label} · 銘牌正放入`;
    return `${state.label} · 銘牌在架上`;
  }
  if (bay.seated > OPEN + 0.2) return `${state.label} · 銘牌正取出`;
  if (state.id === "missing") return `${state.label} · 空格不是 0`;
  return `${state.label} · 空格先留著`;
}

export function advance(bay, dt, calm) {
  bay.goal = STATES[bay.chosen].plaque ? SEATED : OPEN;
  bay.seated = follow(bay.seated, bay.goal, dt, 0.22, calm);
  if (Math.abs(bay.seated - bay.goal) < 0.02) bay.seated = bay.goal;
  return bay.seated !== bay.goal;
}
