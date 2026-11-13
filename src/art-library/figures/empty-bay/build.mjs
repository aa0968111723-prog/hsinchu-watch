/**
 * Figure: empty bay.
 * A plaque stand with one bay. When the bay is empty, the groove is visible.
 * A plaque only sits there when a record is present. Empty is not zero.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { basePlate, k, knob, labelPlate, tools } from "../lib/kit.mjs";
import { emitFigure } from "../lib/emit.mjs";
import { OPEN, SEATED, STATES, createBay, describe } from "./model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDTH = 640;
const HEIGHT = 420;

const PLATE = { x: -96, y: -70, w: 192, d: 140, r: 9 };
const STAND = { x: -34, y: -28, w: 68, d: 44, r: 2 };
const STAND_Z = 6;
const BAY_Z = STAND_Z + 4;
const BAY = { x: -22, y: -18, w: 44, d: 28, r: 1.2 };
const PLAQUE = { x: -18, y: -14, w: 36, d: 20, r: 1 };

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -14, 0), [-40, -40, 70], [40, 40, 8], [0, 0, BAY_Z + SEATED + 8]],
  WIDTH,
  HEIGHT,
  { pad: 34, azimuth: 42, elevation: 34 },
);
const T = tools(P);
const { S, L, D, at } = T;

function stand() {
  const out = [];
  out.push(S(k.slabOf(STAND, STAND_Z, 4, P, 4, 0.45), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(STAND, 3), BAY_Z, P, 4), { tone: "faint" }));
  out.push(D(k.corners(STAND, 4).map(([x, y]) => at([x, y, BAY_Z])), { size: 0.4 }));
  // Side walls of the bay.
  out.push(S(k.slabOf({ x: BAY.x - 3, y: BAY.y - 2, w: 3, d: BAY.d + 4, r: 0.8 }, BAY_Z, 18, P, 3, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: BAY.x + BAY.w, y: BAY.y - 2, w: 3, d: BAY.d + 4, r: 0.8 }, BAY_Z, 18, P, 3, 0.3), { tone: "mid" }));
  // Back board.
  out.push(S(k.slabOf({ x: BAY.x - 2, y: BAY.y - 4, w: BAY.w + 4, d: 3, r: 0.8 }, BAY_Z, 22, P, 3, 0.35), { tone: "mid" }));
  // Floor of the bay with the empty groove.
  out.push(S(k.slabOf(BAY, BAY_Z, 2, P, 3, 0.3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(BAY, 2.5), BAY_Z + 2, P, 3), { tone: "faint" }));
  out.push(L(k.lineOnTop([BAY.x + 4, BAY.y + 8], [BAY.x + BAY.w - 4, BAY.y + 8], BAY_Z + 2, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([BAY.x + 4, BAY.y + 14], [BAY.x + BAY.w - 10, BAY.y + 14], BAY_Z + 2, P), { tone: "faint" }));
  // Lip at the front.
  out.push(S(k.slabOf({ x: BAY.x - 1, y: BAY.y + BAY.d - 1, w: BAY.w + 2, d: 4, r: 0.8 }, BAY_Z, 4, P, 3, 0.25), { tone: "mid" }));
  const retain = [BAY.x - 8, BAY.y + BAY.d + 6];
  out.push(knob(T, retain[0], retain[1], 2.8, STAND_Z, 5));
  out.push(knob(T, BAY.x + BAY.w + 8, retain[1], 2.8, STAND_Z, 5));
  return out.join("");
}

function plaque() {
  // Drawn at rest height OPEN; live.js translates along z by (seated - OPEN).
  const z = BAY_Z + 2;
  return [
    S(k.slabOf(PLAQUE, z, 3, P, 3, 0.4), { tone: "hi", lit: true, crease: "lo" }),
    L(k.planOutline(k.insetPlan(PLAQUE, 2), z + 3, P, 3), { tone: "lo" }),
    L(k.lineOnTop([PLAQUE.x + 4, PLAQUE.y + 6], [PLAQUE.x + PLAQUE.w - 4, PLAQUE.y + 6], z + 3, P), { tone: "lo" }),
    L(k.lineOnTop([PLAQUE.x + 4, PLAQUE.y + 10], [PLAQUE.x + PLAQUE.w - 10, PLAQUE.y + 10], z + 3, P), { tone: "faint" }),
    L(k.lineOnTop([PLAQUE.x + 4, PLAQUE.y + 14], [PLAQUE.x + PLAQUE.w - 16, PLAQUE.y + 14], z + 3, P), { tone: "faint" }),
    D([at([PLAQUE.x + 6, PLAQUE.y + 6, z + 3]), at([PLAQUE.x + PLAQUE.w - 6, PLAQUE.y + 6, z + 3])], { size: 0.42, tone: "hi" }),
  ].join("");
}

function posts() {
  const out = [];
  for (const x of [-48, 48]) {
    out.push(S(k.cylinder(x, -40, 3.2, 0, 4, P, 18), { tone: "mid" }));
    out.push(S(k.cylinder(x, -40, 2.4, 4, 42, P, 18), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(x, -40, 3.4, 46, 2, P, 18), { tone: "mid" }));
  }
  out.push(S(k.slabOf({ x: -50, y: -44, w: 100, d: 8, r: 1.5 }, 46, 4, P, 3, 0.35), { tone: "mid" }));
  out.push(D([at([-40, -40, 50]), at([40, -40, 50])], { size: 0.4 }));
  return out.join("");
}

function body({ live }) {
  const start = createBay(1);
  const plaqueGroup = live
    ? `<g data-plaque transform="${k.translateAlong(P, [0, 0, start.seated - OPEN])}" data-empty="${start.seated <= OPEN + 0.2}">${plaque()}</g>`
    : `<g transform="${k.translateAlong(P, [0, 0, 0])}" opacity="0.08">${plaque()}</g>`;
  return [basePlate(T, PLATE), posts(), stand(), plaqueGroup, labelPlate(T, { x: 48, y: 42, w: 40, d: 10, r: 1 }, 0)];
}

const label = "空格銘牌架。空格表示本站沒有這筆紀錄，不是 0，也不是待補的假數字。只有有來源紀錄時，銘牌才會放進那一格。";
const start = createBay(1);
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label,
  body: body({ live: true }),
});
const preview = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label,
  standalone: "light",
  body: body({ live: false }),
});

const controls = `<div class="fig-group" role="group" aria-label="空狀態">${STATES.map(
  (state, index) => `<button type="button" data-state="${index}" aria-pressed="${index === 1}">${state.label}</button>`,
).join("")}</div>`;

export default emitFigure({
  id: "empty-bay",
  source: HERE,
  width: WIDTH,
  height: HEIGHT,
  fig: "示意 5",
  title: "空格銘牌架",
  hint: "選狀態，看空格與銘牌",
  readout: describe(start),
  keys: [
    { mark: "lit", label: "銘牌：只有有來源紀錄時才放入" },
    { mark: "raised", label: "空格：沒有紀錄，不是 0" },
  ],
  caption:
    "空格是真實的介面狀態。沒有紀錄就留空，不要改成 0，也不要放一張假銘牌。有來源紀錄時，銘牌才會坐進那一格。",
  note: "原創示意元件。不帶金額、百分比或日期；那些只能來自來源紀錄。",
  stage: {
    label: "空格銘牌架。左右方向鍵切換狀態",
    max: STATES.length - 1,
    now: 1,
    text: describe(start),
  },
  svg,
  preview,
  controls,
  data: { axes: T.axes, open: OPEN, seated: SEATED, bayZ: BAY_Z },
});
