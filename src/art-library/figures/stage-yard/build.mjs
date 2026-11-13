/**
 * Figure: stage yard.
 * A survey board with five stage pegs and a pointer that visits one peg.
 * What moves: the board under a fixed pointer. A peg with a sourced event
 * shows a lit tag; a peg with no record stays blank.
 *
 * Painter's order: plate, rails, board with pegs (back to front), gantry,
 * pointer, label plate.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { basePlate, k, knob, labelPlate, rulerStrip, tools } from "../lib/kit.mjs";
import { emitFigure } from "../lib/emit.mjs";
import { FIRST, PITCH, POINTER_X, STAGES, STOPS, createYard, describe, pegText } from "./model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDTH = 720;
const HEIGHT = 460;

const PLATE = { x: -148, y: -78, w: 296, d: 156, r: 9 };
const BOARD = { x: FIRST - 18, y: -48, w: (STAGES.length - 1) * PITCH + 36, d: 78, r: 3 };
const BOARD_Z = 4;
const PEG_BASE = BOARD_Z + 3;

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -16, 0),
    [FIRST - 20, -50, 64],
    [FIRST + (STAGES.length - 1) * PITCH + 20, 40, 8],
    [POINTER_X, -6, 72],
  ],
  WIDTH,
  HEIGHT,
  { pad: 34, azimuth: 42, elevation: 34 },
);
const T = tools(P);
const { S, L, D, at } = T;

function rails() {
  const out = [];
  for (const y of [-36, 18]) {
    out.push(S(k.slabOf({ x: FIRST - 22, y, w: (STAGES.length - 1) * PITCH + 44, d: 5, r: 1 }, 0, 3, P, 3, 0.35), { tone: "mid" }));
    out.push(D([FIRST - 10, FIRST + (STAGES.length - 1) * PITCH + 10].map((x) => at([x, y + 2.5, 3])), { size: 0.4 }));
  }
  for (const x of [FIRST - 28, FIRST + (STAGES.length - 1) * PITCH + 22]) {
    out.push(S(k.slabOf({ x, y: -40, w: 6, d: 64, r: 1.2 }, 0, 7, P, 3, 0.4), { tone: "mid" }));
    out.push(D([at([x + 3, -30, 7]), at([x + 3, 16, 7])], { size: 0.42 }));
  }
  return out.join("");
}

function peg(index) {
  const x = FIRST + index * PITCH;
  const out = [];
  // Socket on the board.
  out.push(S(k.cylinder(x, -8, 5.2, PEG_BASE, 2, P, 20), { tone: "mid" }));
  out.push(L(k.ring(x, -8, 5.2, PEG_BASE + 2, P, 20), { tone: "lo" }));
  // The five stages are different fixtures, not a rising bar of progress.
  if (index === 0) {
    // Planned: four survey stakes and a string outline.
    for (const [dx, dy] of [[-7, -18], [7, -18], [-7, 4], [7, 4]]) {
      out.push(S(k.cylinder(x + dx, dy, 1.1, PEG_BASE + 2, 14, P, 12), { tone: "mid", crease: "none" }));
      out.push(S(k.cylinder(x + dx, dy, 1.8, PEG_BASE + 16, 2, P, 12), { tone: "hi" }));
    }
    out.push(L(k.lineOnTop([x - 7, -18], [x + 7, -18], PEG_BASE + 12, P), { tone: "lo" }));
    out.push(L(k.lineOnTop([x + 7, -18], [x + 7, 4], PEG_BASE + 12, P), { tone: "lo" }));
    out.push(L(k.lineOnTop([x + 7, 4], [x - 7, 4], PEG_BASE + 12, P), { tone: "lo" }));
    out.push(L(k.lineOnTop([x - 7, 4], [x - 7, -18], PEG_BASE + 12, P), { tone: "lo" }));
  } else if (index === 1) {
    // Under construction: an open scaffold cube.
    const frame = { x: x - 9, y: -20, w: 18, d: 24, r: 0.8 };
    out.push(S(k.slabOf(frame, PEG_BASE + 2, 2, P, 3), { tone: "mid" }));
    for (const [px, py] of k.corners(frame, 1.5)) {
      out.push(S(k.cylinder(px, py, 1.3, PEG_BASE + 4, 22, P, 12), { tone: "mid", crease: "none" }));
    }
    out.push(S(k.slabOf(k.insetPlan(frame, 1), PEG_BASE + 26, 2, P, 3), { tone: "mid" }));
    // Brace lines must land on the posts; free would let the line-end check pass a floating stroke.
    const posts = k.corners(frame, 1.5);
    out.push(L(k.lineOnTop(posts[0], posts[3], PEG_BASE + 16, P), { tone: "faint" }));
    out.push(L(k.lineOnTop(posts[1], posts[2], PEG_BASE + 16, P), { tone: "faint" }));
    out.push(D(posts.map(([px, py]) => at([px, py, PEG_BASE + 16])), { size: 0.4 }));
  } else if (index === 2) {
    // Completed: a solid closed block, no seal and no open door.
    const block = { x: x - 10, y: -20, w: 20, d: 26, r: 1.2 };
    out.push(S(k.slabOf(block, PEG_BASE + 2, 22, P, 4, 0.5), { tone: "hi", crease: "lo" }));
    out.push(L(k.planOutline(k.insetPlan(block, 2.5), PEG_BASE + 24, P, 3), { tone: "faint" }));
    out.push(D([at([x - 6, -16, PEG_BASE + 24]), at([x + 6, -16, PEG_BASE + 24]), at([x - 6, 0, PEG_BASE + 24]), at([x + 6, 0, PEG_BASE + 24])], { size: 0.4 }));
  } else if (index === 3) {
    // Accepted: the same block with a seal plate on the face.
    const block = { x: x - 10, y: -20, w: 20, d: 26, r: 1.2 };
    out.push(S(k.slabOf(block, PEG_BASE + 2, 22, P, 4, 0.5), { tone: "hi", crease: "lo" }));
    const seal = { x: x - 5, y: 6.2, w: 10, d: 2.2, r: 0.8 };
    out.push(S(k.slabOf(seal, PEG_BASE + 10, 8, P, 3, 0.3), { tone: "hi", crease: "lo", className: "mat-clay" }));
    out.push(L(k.ring(x, 7.2, 2.4, PEG_BASE + 18, P, 16), { tone: "lo" }));
    out.push(D([at([x, 7.2, PEG_BASE + 18])], { size: 0.45, tone: "hi" }));
  } else {
    // In use: the block with an open doorway and a lit lamp over the door.
    const block = { x: x - 10, y: -20, w: 20, d: 26, r: 1.2 };
    out.push(S(k.slabOf(block, PEG_BASE + 2, 22, P, 4, 0.5), { tone: "hi", crease: "lo" }));
    const door = [[x - 3.5, PEG_BASE + 4], [x + 3.5, PEG_BASE + 4], [x + 3.5, PEG_BASE + 16], [x - 3.5, PEG_BASE + 16]].map(([px, z]) => [px, 6.2, z]);
    out.push(`<path class="fig-void" d="${k.pathOf(door.map((point) => at(point)), true)}"/>`);
    out.push(S(k.cylinder(x, 7.2, 1.6, PEG_BASE + 18, 4, P, 14), { tone: "hi", lit: true }));
    out.push(D([at([x, 7.2, PEG_BASE + 22])], { size: 0.5, tone: "hi" }));
  }
  // Tag holder under the peg. Rule lines appear only when a record is bound.
  const tag = { x: x - 8, y: 14, w: 16, d: 8, r: 1 };
  out.push(S(k.slabOf(tag, PEG_BASE, 1.2, P, 3), { tone: "mid", crease: "none" }));
  const rules = [2.5, 4.5].map((dy, row) => k.lineOnTop([tag.x + 2, tag.y + dy], [tag.x + tag.w - 2 - row * 3, tag.y + dy], PEG_BASE + 1.2, P)).join("");
  out.push(`<g class="fig-when" data-rules="${index}">${L(rules, { tone: "mid", free: true })}</g>`);
  // Blank cover for an unrecorded stage.
  out.push(`<g class="fig-when" data-blank="${index}">${S(k.slabOf(k.insetPlan(tag, 1.2), PEG_BASE + 1.2, 0.6, P, 2), { tone: "lo", crease: "none" })}</g>`);
  return out.join("");
}

function board({ live }) {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(BOARD, 4), BOARD_Z, 0.2, P)}" style="filter:blur(4px)"/>`];
  out.push(S(k.slabOf(BOARD, BOARD_Z, 3, P, 5, 0.55), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BOARD, 3), PEG_BASE, P, 4), { tone: "faint" }));
  out.push(rulerStrip(T, { x: FIRST - 10, y: BOARD.y + BOARD.d - 12, w: (STAGES.length - 1) * PITCH + 20, d: 6, r: 1 }, PEG_BASE, {
    from: FIRST - 4,
    to: FIRST + (STAGES.length - 1) * PITCH + 4,
    step: PITCH / 2,
    every: 2,
  }));
  STAGES.forEach((_, index) => {
    const attrs = live ? ` data-peg="${index}" data-hit="${index}"` : "";
    out.push(`<g${attrs}>${peg(index)}</g>`);
  });
  const handle = [BOARD.x + BOARD.w - 8, BOARD.y + BOARD.d + 2];
  out.push(S(k.slabOf({ x: handle[0] - 2.2, y: BOARD.y + BOARD.d - 2, w: 4.4, d: 4, r: 1 }, BOARD_Z + 1, 3, P, 2), { tone: "mid", crease: "none" }));
  out.push(knob(T, handle[0], handle[1], 3.1, BOARD_Z, 6));
  return out.join("");
}

function gantry() {
  const out = [];
  const foot = { x: POINTER_X - 14, y: -70, w: 28, d: 18, r: 2 };
  out.push(S(k.slabOf(foot, 0, 5, P, 4, 0.45), { tone: "mid" }));
  out.push(S(k.cylinder(POINTER_X, -61, 4.2, 5, 3, P, 22), { tone: "mid" }));
  out.push(S(k.cylinder(POINTER_X, -61, 2.8, 8, 52, P, 22), { tone: "mid", crease: "none" }));
  out.push(L([24, 40].map((z) => k.sideArc(POINTER_X, -61, 2.8, z, P, 12)).join(""), { tone: "faint" }));
  out.push(S(k.cylinder(POINTER_X, -61, 3.8, 60, 3, P, 22), { tone: "mid" }));
  const arm = { x: POINTER_X - 4, y: -61, w: 8, d: 48, r: 1.5 };
  out.push(S(k.slabOf(arm, 56, 5, P, 4, 0.4), { tone: "mid" }));
  out.push(D([at([POINTER_X, -40, 61]), at([POINTER_X, -20, 61])], { size: 0.42 }));
  out.push(knob(T, POINTER_X + 8, -55, 3, 5, 7, { lit: true }));
  // Fixed pointer tip over the chosen peg.
  out.push(S(k.cylinder(POINTER_X, -8, 2.2, 28, 28, P, 16), { tone: "hi", crease: "none", lit: true }));
  out.push(S(k.cylinder(POINTER_X, -8, 3.4, 24, 4, P, 18), { tone: "hi", lit: true }));
  out.push(D([at([POINTER_X, -8, 56])], { size: 0.5, tone: "hi" }));
  return out.join("");
}

function body({ live }) {
  const start = STOPS[0];
  const boardGroup = live
    ? `<g data-board transform="${k.translateAlong(P, [start, 0, 0])}">${board({ live })}</g>`
    : `<g transform="${k.translateAlong(P, [start, 0, 0])}">${board({ live })}</g>`;
  return [
    basePlate(T, PLATE),
    rails(),
    boardGroup,
    gantry(),
    labelPlate(T, { x: 78, y: 48, w: 48, d: 12, r: 1 }, 0),
  ];
}

const label =
  "階段工地模型。測板上有規劃、施工、完工、驗收、啟用五根樁，測桿只對準其中一根。有來源事件的樁會亮標籤；沒有紀錄的樁保持空白。完工不是驗收，驗收不是啟用。";
const start = createYard(0);
const svg = k.figureSvg({ width: WIDTH, height: HEIGHT, label, body: body({ live: true }) });
const preview = k.figureSvg({ width: WIDTH, height: HEIGHT, label, standalone: "light", body: body({ live: false }) });

const controls = [
  `<div class="fig-group"><label>案卷<select data-project><option value="">不綁案卷，只看五個階段</option></select></label></div>`,
  `<div class="fig-group" role="group" aria-label="政策階段">${STAGES.map((stage, index) => `<button type="button" data-stage="${index}" aria-pressed="${index === 0}">${stage.label}</button>`).join("")}</div>`,
  `<dl class="fig-facts">${STAGES.map((stage, index) => `<dt>${stage.label}</dt><dd data-value="${index}">${pegText(start.pegs[index])}</dd>`).join("")}</dl>`,
  `<p class="fig-source" data-source></p>`,
].join("");

export default emitFigure({
  id: "stage-yard",
  source: HERE,
  width: WIDTH,
  height: HEIGHT,
  fig: "示意 3",
  title: "階段工地模型",
  hint: "選案卷，再點階段",
  readout: describe(start),
  keys: [
    { mark: "lit", label: "測桿：對準目前選到的階段" },
    { mark: "raised", label: "五根樁：規劃、施工、完工、驗收、啟用，互不推算" },
  ],
  caption:
    "規劃、施工、完工、驗收、啟用是五個分開的階段。本站有來源事件的那一根樁才會亮標籤；沒有紀錄的樁保持空白，不是 0% 進度。『準備驗收』或『目標完工』不會點亮驗收或完工。百分比進度不會被讀成任一階段。",
  note: "原創示意元件。階段讀自站上的治理案卷事件；沒有選案卷時不顯示任何日期。這不是特定工地的現況圖。",
  stage: {
    label: "階段工地模型。左右方向鍵選階段",
    max: STAGES.length - 1,
    now: 0,
    text: `${STAGES[0].label}：${pegText(start.pegs[0])}`,
  },
  svg,
  preview,
  controls,
  data: { axes: T.axes, stops: STOPS },
});
