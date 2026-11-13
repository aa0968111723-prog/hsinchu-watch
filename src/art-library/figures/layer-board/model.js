/**
 * Layer calibration board.
 * Three acetate sheets on a drafting board: administrative boundary, claim
 * area, and verified survey. Only the verified sheet takes the registration
 * pin. Claim is never treated as verified.
 */
import { clamp, follow } from "../motion.js";

export const LAYERS = [
  { id: "boundary", label: "行政界線", short: "界線", pin: false },
  { id: "claim", label: "主張範圍", short: "主張", pin: false },
  { id: "verified", label: "核對圖層", short: "核對", pin: true },
];

/** Millimetres the chosen sheet rises above the stack. */
export const RAISED = 22;
export const FLAT = 0;

export function createBoard(start = 2) {
  const chosen = clamp(start, 0, LAYERS.length - 1);
  const lift = LAYERS.map((_, index) => (index === chosen ? RAISED : FLAT));
  return {
    chosen,
    lift,
    goal: lift.slice(),
    pin: LAYERS[chosen].pin ? 1 : 0,
    pinGoal: LAYERS[chosen].pin ? 1 : 0,
  };
}

export function choose(board, index) {
  board.chosen = clamp(index, 0, LAYERS.length - 1);
  board.goal = LAYERS.map((_, i) => (i === board.chosen ? RAISED : FLAT));
  board.pinGoal = LAYERS[board.chosen].pin ? 1 : 0;
}

export function describe(board) {
  const layer = LAYERS[board.chosen];
  const rising = board.lift[board.chosen] < RAISED - 0.4;
  if (layer.id === "boundary") {
    return rising ? `${layer.label} · 掀起中` : `${layer.label} · 界線不是案址`;
  }
  if (layer.id === "claim") {
    return rising ? `${layer.label} · 掀起中` : `${layer.label} · 主張不是核對`;
  }
  if (board.pin < 0.85) return `${layer.label} · 對準銷孔`;
  return `${layer.label} · 銷已卡住，可引用`;
}

export function advance(board, dt, calm) {
  let moving = false;
  for (let index = 0; index < LAYERS.length; index++) {
    board.lift[index] = follow(board.lift[index], board.goal[index], dt, 0.2, calm);
    if (Math.abs(board.lift[index] - board.goal[index]) < 0.03) board.lift[index] = board.goal[index];
    else moving = true;
  }
  board.pin = follow(board.pin, board.pinGoal, dt, 0.18, calm);
  if (Math.abs(board.pin - board.pinGoal) < 0.02) board.pin = board.pinGoal;
  else moving = true;
  return moving;
}
