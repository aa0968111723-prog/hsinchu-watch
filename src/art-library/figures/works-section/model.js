/**
 * Public-works cross-section board.
 * A cutaway of a generic embankment with drain, pavement and railing.
 * Layers are schematic only: choosing a layer names the part, never a
 * completion percentage or a real project site.
 */
import { clamp, follow } from "../motion.js";

export const LAYERS = [
  { id: "fill", label: "回填層", short: "回填", note: "示意填土，不是某案的土方量" },
  { id: "drain", label: "排水管", short: "排水", note: "示意管線，不是現況管徑" },
  { id: "pavement", label: "路面層", short: "路面", note: "示意鋪面，不是驗收厚度" },
  { id: "rail", label: "護欄", short: "護欄", note: "示意護欄，不是已完工證明" },
];

export const FOCUS = 18;
export const REST = 0;

export function createSection(start = 2) {
  const chosen = clamp(start, 0, LAYERS.length - 1);
  return {
    chosen,
    lift: LAYERS.map((_, index) => (index === chosen ? FOCUS : REST)),
    goal: LAYERS.map((_, index) => (index === chosen ? FOCUS : REST)),
  };
}

export function choose(section, index) {
  section.chosen = clamp(index, 0, LAYERS.length - 1);
  section.goal = LAYERS.map((_, i) => (i === section.chosen ? FOCUS : REST));
}

export function describe(section) {
  const layer = LAYERS[section.chosen];
  const rising = section.lift[section.chosen] < FOCUS - 0.4;
  if (rising) return `${layer.label} · 剖開中`;
  return `${layer.label} · ${layer.note}`;
}

export function advance(section, dt, calm) {
  let moving = false;
  for (let index = 0; index < LAYERS.length; index++) {
    section.lift[index] = follow(section.lift[index], section.goal[index], dt, 0.2, calm);
    if (Math.abs(section.lift[index] - section.goal[index]) < 0.03) section.lift[index] = section.goal[index];
    else moving = true;
  }
  return moving;
}
