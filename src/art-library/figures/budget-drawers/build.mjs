/**
 * Figure: budget drawers.
 * A three-drawer cabinet. Top to bottom: approved, contract, spent. A drawer
 * with a recorded amount slides open and shows its slip. A drawer with no
 * record is held by a latch. What moves: one drawer, when the reader pulls it.
 *
 * Painter's order. Seen from this camera, one point hides another only when
 * it is further along +x, +y and +z at once. So each tier is drawn as:
 * left wall, the dark opening, the drawer, right wall, divider plate, latch.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { basePlate, k, labelPlate, tools } from "../lib/kit.mjs";
import { emitFigure } from "../lib/emit.mjs";
import { LAYERS, TRAVEL, createCabinet, describe, layerText } from "./model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDTH = 680;
const HEIGHT = 470;

// The plate reaches just past a fully opened drawer, so the cabinet fills the card.
const PLATE = { x: -62, y: -80, w: 124, d: 144, r: 9 };
const X0 = -46;
const X1 = 46;
const Y0 = -66;
const FACE = -2;
const WALL = 3;
const PLINTH = 5;
const OPEN = 18;
const DIVIDER = 2;
const TIER = OPEN + DIVIDER;
const CAP_Z = PLINTH + LAYERS.length * TIER;
const FRONT = 2.2;
/** Layer 0 is the top drawer. */
const tierZ = (index) => PLINTH + (LAYERS.length - 1 - index) * TIER;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -15, 0), [X0, Y0, CAP_Z + 9], [X1, Y0, CAP_Z + 9], [X0, FACE + FRONT + TRAVEL + 4, PLINTH]],
  WIDTH,
  HEIGHT,
  { pad: 40, azimuth: 58, elevation: 40 },
);
const T = tools(P);
const { S, L, D, at } = T;
const facePath = (points) => k.pathOf(points.map((point) => at(point)), true);

function drawer(index) {
  const z = tierZ(index);
  const left = X0 + WALL + 0.8;
  const width = X1 - X0 - WALL * 2 - 1.6;
  const back = FACE - 60;
  const floorTop = z + 2;
  const sideTop = z + 13;
  const out = [];
  out.push(S(k.slabOf({ x: left, y: back, w: width, d: 60, r: 0.6 }, z + 0.8, 1.2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: left, y: back, w: width, d: 1.6, r: 0.4 }, floorTop, sideTop - floorTop, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf({ x: left, y: back, w: 1.6, d: 60, r: 0.4 }, floorTop, sideTop - floorTop, P, 2), { tone: "mid" }));
  // The slip: a form lying in the drawer. Its ruled lines stand for writing and show only when an amount is recorded.
  const slip = { x: -26, y: FACE - 42, w: 52, d: 32, r: 0.8 };
  out.push(S(k.slabOf(slip, floorTop, 0.7, P, 3), { tone: "hi", crease: "none" }));
  const slipLines = [6, 12, 18, 24].map((dy, row) => k.lineOnTop([slip.x + 5, slip.y + dy], [slip.x + slip.w - 5 - row * 7, slip.y + dy], floorTop + 0.7, P)).join("");
  out.push(`<g class="fig-when" data-rules="${index}">${L(slipLines, { tone: "mid", free: true })}</g>`);
  out.push(S(k.slabOf({ x: left + width - 1.6, y: back, w: 1.6, d: 60, r: 0.4 }, floorTop, sideTop - floorTop, P, 2), { tone: "mid" }));
  const front = { x: X0 + WALL + 0.3, y: FACE, w: X1 - X0 - WALL * 2 - 0.6, d: FRONT, r: 0.8 };
  out.push(`<g data-front="${index}">${S(k.slabOf(front, z + 0.5, OPEN - 1, P, 3, 0.4), { tone: "hi", crease: "lo" })}</g>`);
  // Label holder on the drawer front: a frame, and the label's printed lines when an amount is recorded.
  const faceY = FACE + FRONT;
  const holder = [[16, z + 9.5], [38, z + 9.5], [38, z + 15], [16, z + 15]].map(([x, height]) => [x, faceY, height]);
  out.push(L(facePath(holder), { tone: "lo" }));
  const labelLines = [11.4, 13.2].map((height, row) => k.segment([19, faceY, z + height], [35 - row * 6, faceY, z + height], P)).join("");
  out.push(`<g class="fig-when" data-rules="${index}">${L(labelLines, { tone: "mid", free: true })}</g>`);
  out.push(S(k.slabOf({ x: -13, y: faceY, w: 26, d: 3, r: 1.2 }, z + 6.5, 3, P, 3, 0.3), { tone: "mid" }));
  return out.join("");
}

function tier(index, { live }) {
  const z = tierZ(index);
  const depth = FACE - Y0;
  const out = [];
  out.push(S(k.slabOf({ x: X0, y: Y0, w: WALL, d: depth, r: 0.6 }, z, OPEN, P, 2), { tone: "mid" }));
  const opening = [[X0 + WALL, z], [X1 - WALL, z], [X1 - WALL, z + OPEN], [X0 + WALL, z + OPEN]].map(([x, height]) => [x, FACE, height]);
  out.push(`<path class="fig-void" d="${facePath(opening)}"/>`);
  const attrs = live ? ` data-drawer="${index}" data-hit="${index}"` : "";
  out.push(`<g${attrs}>${drawer(index)}</g>`);
  out.push(S(k.slabOf({ x: X1 - WALL, y: Y0, w: WALL, d: depth, r: 0.6 }, z, OPEN, P, 2), { tone: "mid" }));
  out.push(D([[X1, Y0 + 10, z + OPEN / 2], [X1, FACE - 10, z + OPEN / 2]].map((point) => at(point)), { size: 0.42 }));
  out.push(S(k.slabOf({ x: X0, y: Y0, w: X1 - X0, d: depth, r: 0.8 }, z + OPEN, DIVIDER, P, 3), { tone: "mid", crease: "none" }));
  // The latch that holds a drawer with no record. It bridges the right post and the drawer front.
  const latch = { x: X1 - WALL - 7, y: FACE + FRONT + 0.2, w: 10, d: 3, r: 0.9 };
  const latchSolid = S(k.slabOf(latch, z + 6, 6, P, 3, 0.3), { tone: "hi", crease: "lo", className: "mat-clay" }) + D([at([latch.x + 7.6, latch.y + 3, z + 9])], { size: 0.45, tone: "hi" });
  out.push(`<g class="fig-when" data-latch="${index}">${latchSolid}</g>`);
  return out.join("");
}

function cabinet({ live }) {
  const out = [];
  const foot = { x: X0 - 2, y: Y0 - 2, w: X1 - X0 + 4, d: FACE - Y0 + 4, r: 2 };
  out.push(S(k.slabOf(foot, 0, PLINTH, P, 4, 0.5), { tone: "mid" }));
  for (let index = LAYERS.length - 1; index >= 0; index--) out.push(tier(index, { live }));
  const cap = { x: X0 - 2, y: Y0 - 2, w: X1 - X0 + 4, d: FACE - Y0 + 4, r: 2 };
  out.push(S(k.slabOf(cap, CAP_Z, 3, P, 4, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(cap, 4), CAP_Z + 3, P, 4), { tone: "faint" }));
  // A ledger on top: the book the three amounts are copied from.
  const book = { x: -30, y: -54, w: 40, d: 28, r: 1.2 };
  const pages = [1.2, 2.4].map((dz) => k.sideSeam(book, CAP_Z + 3 + dz, P, 3)).join("");
  out.push(S(k.slabOf(book, CAP_Z + 3, 4, P, 3, 0.4), { tone: "mid", crease: "lo", className: "mat-sand", inner: L(pages, { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(book, 3), CAP_Z + 7, P, 3), { tone: "faint" }));
  return out.join("");
}

function body({ live }) {
  return [basePlate(T, PLATE), cabinet({ live }), labelPlate(T, { x: 12, y: 50, w: 42, d: 11, r: 1 }, 0)];
}

const label = "預算三層抽屜。一座三層的檔案櫃，由上到下是核定、決標、實支。有紀錄的抽屜可以拉開，裡面有一張單據；沒有紀錄的抽屜被門閂扣住。";
const start = createCabinet();
const svg = k.figureSvg({ width: WIDTH, height: HEIGHT, label, body: body({ live: true }) });
const preview = k.figureSvg({ width: WIDTH, height: HEIGHT, label, standalone: "light", body: body({ live: false }) });

const controls = [
  `<div class="fig-group"><label>案卷<select data-project><option value="">不綁案卷，只看三層</option></select></label></div>`,
  `<div class="fig-group" role="group" aria-label="預算的三層">${LAYERS.map((layer, index) => `<button type="button" data-layer="${index}" aria-pressed="false">${layer.label}</button>`).join("")}</div>`,
  `<dl class="fig-facts">${LAYERS.map((layer, index) => `<dt>${layer.label}</dt><dd data-value="${index}">${layerText(start.drawers[index])}</dd>`).join("")}</dl>`,
  `<p class="fig-source" data-source></p>`,
].join("");

export default emitFigure({
  id: "budget-drawers",
  source: HERE,
  width: WIDTH,
  height: HEIGHT,
  fig: "示意 2",
  title: "預算三層抽屜",
  hint: "選案卷，再拉抽屜",
  readout: describe(start),
  keys: [
    { mark: "lit", label: "選中的那一層" },
    { mark: "raised", label: "上核定、中決標、下實支，三筆分開記" },
  ],
  caption:
    "核定、決標、實支是三筆各自記的金額，不能從另外兩筆推出來。有紀錄的那一層拉得開，沒有紀錄的那一層被門閂扣住：扣住是本站還沒有收錄，不是 0 元，也不代表機關沒有公開。金額來自選定的案卷，這個元件本身不帶任何數字。",
  note: "原創示意元件。金額讀自站上的治理案卷；沒有選案卷時不顯示任何數字。",
  stage: {
    label: "預算三層抽屜。上下方向鍵選一層，空白鍵拉開或推回",
    max: LAYERS.length - 1,
    now: 0,
    text: `${LAYERS[0].label}：${layerText(start.drawers[0])}`,
  },
  svg,
  preview,
  controls,
  data: { axes: T.axes, travel: TRAVEL },
});
