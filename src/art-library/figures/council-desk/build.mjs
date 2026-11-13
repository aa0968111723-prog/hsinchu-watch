/**
 * Figure: council desk.
 * A clerk's dais with three binders and a gavel. The binders slide under a
 * fixed gavel. Striking the gavel is a gesture, not a vote tally.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { basePlate, k, knob, labelPlate, tools } from "../lib/kit.mjs";
import { emitFigure } from "../lib/emit.mjs";
import { BINDERS, FIRST, GAVEL_X, PITCH, REST, STOPS, createDesk, describe } from "./model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDTH = 680;
const HEIGHT = 440;

const PLATE = { x: -130, y: -72, w: 260, d: 144, r: 9 };
const DAIS = { x: -88, y: -42, w: 176, d: 72, r: 3 };
const DAIS_Z = 8;
const BINDER_Z = DAIS_Z + 3;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -15, 0), [-90, -50, 70], [90, 40, 8], [GAVEL_X, -8, 64]],
  WIDTH,
  HEIGHT,
  { pad: 32, azimuth: 40, elevation: 33 },
);
const T = tools(P);
const { S, L, D, at } = T;

function binder(index) {
  const x = FIRST + index * PITCH;
  const plan = { x: x - 12, y: -28, w: 24, d: 40, r: 1.2 };
  const out = [];
  out.push(S(k.slabOf(plan, BINDER_Z, 14, P, 3, 0.45), { tone: index === 1 ? "hi" : "mid", crease: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(plan, 2.2), BINDER_Z + 14, P, 3), { tone: "faint" }));
  const spineFrom = [plan.x + 3, plan.y + 8];
  const spineTo = [plan.x + 3, plan.y + plan.d - 4];
  out.push(L(k.lineOnTop(spineFrom, spineTo, BINDER_Z + 14, P), { tone: "lo" }));
  out.push(D([at([spineFrom[0], spineFrom[1], BINDER_Z + 14]), at([spineTo[0], spineTo[1], BINDER_Z + 14])], { size: 0.42 }));
  const tab = { x: plan.x + 4 + index * 4, y: plan.y - 3, w: 9, d: 7, r: 1 };
  out.push(S(k.slabOf(tab, BINDER_Z + 12, 4, P, 3, 0.3), { tone: "hi", crease: "lo" }));
  out.push(D([at([plan.x + 8, plan.y + 14, BINDER_Z + 14]), at([plan.x + 8, plan.y + 26, BINDER_Z + 14])], { size: 0.4 }));
  return out.join("");
}

function tray({ live }) {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(DAIS, 4), DAIS_Z, 0.2, P)}" style="filter:blur(4px)"/>`];
  out.push(S(k.slabOf(DAIS, DAIS_Z, 3, P, 5, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(DAIS, 3), BINDER_Z, P, 4), { tone: "faint" }));
  BINDERS.forEach((_, index) => {
    const attrs = live ? ` data-binder="${index}" data-hit="${index}"` : "";
    out.push(`<g${attrs}>${binder(index)}</g>`);
  });
  const handle = [DAIS.x + DAIS.w - 8, DAIS.y + DAIS.d + 2];
  out.push(S(k.slabOf({ x: handle[0] - 2, y: DAIS.y + DAIS.d - 2, w: 4, d: 4, r: 1 }, DAIS_Z + 1, 3, P, 2), { tone: "mid", crease: "none" }));
  out.push(knob(T, handle[0], handle[1], 3, DAIS_Z, 6));
  return out.join("");
}

function stand() {
  const out = [];
  const post = [GAVEL_X - 52, -8];
  out.push(S(k.slabOf({ x: post[0] - 10, y: post[1] - 10, w: 20, d: 20, r: 2 }, 0, 6, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(post[0], post[1], 3.4, 6, 48, P, 22), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(post[0], post[1], 4.4, 54, 3, P, 22), { tone: "mid" }));
  const arm = { x: post[0], y: -4, w: GAVEL_X - post[0] + 4, d: 8, r: 1.5 };
  out.push(S(k.slabOf(arm, 50, 5, P, 4, 0.4), { tone: "mid" }));
  out.push(D([at([post[0] + 12, 0, 55]), at([GAVEL_X - 10, 0, 55])], { size: 0.42 }));
  return out.join("");
}

function gavelHead() {
  // Drawn at rest height; live.js translates along z by (at - REST).
  const z0 = BINDER_Z + 14;
  return [
    S(k.cylinder(GAVEL_X, -8, 2.1, z0, REST + 8, P, 16), { tone: "hi", crease: "none", lit: true }),
    S(k.cylinder(GAVEL_X, -8, 5.5, z0 + REST, 8, P, 24, 0.5), { tone: "hi", lit: true }),
    L(k.ring(GAVEL_X, -8, 5.5, z0 + REST + 1, P, 24), { tone: "lo" }),
    L(k.ring(GAVEL_X, -8, 5.5, z0 + REST + 7, P, 24), { tone: "lo" }),
    D([at([GAVEL_X, -8, z0 + REST + 8])], { size: 0.5, tone: "hi" }),
  ].join("");
}

function body({ live }) {
  const start = STOPS[0];
  const trayGroup = live
    ? `<g data-tray transform="${k.translateAlong(P, [start, 0, 0])}">${tray({ live })}</g>`
    : `<g transform="${k.translateAlong(P, [start, 0, 0])}">${tray({ live })}</g>`;
  const head = live ? `<g data-gavel>${gavelHead()}</g>` : `<g>${gavelHead()}</g>`;
  return [basePlate(T, PLATE), trayGroup, stand(), head, labelPlate(T, { x: 62, y: 48, w: 44, d: 11, r: 1 }, 0)];
}

const label = "議事台。台上有提案、審查、決議三本夾，議事槌對準目前選到的那一本。敲槌只是示意動作，不是表決結果，也不會把提案推成決議。";
const start = createDesk(0);
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

const controls = [
  `<div class="fig-group" role="group" aria-label="議事步驟">${BINDERS.map((binder, index) => `<button type="button" data-binder="${index}" aria-pressed="${index === 0}">${binder.label}</button>`).join("")}</div>`,
  `<div class="fig-group"><button type="button" data-act="strike">敲槌（示意）</button></div>`,
].join("");

export default emitFigure({
  id: "council-desk",
  source: HERE,
  width: WIDTH,
  height: HEIGHT,
  fig: "示意 4",
  title: "議事台",
  hint: "選夾，空白鍵敲槌",
  readout: describe(start),
  keys: [
    { mark: "lit", label: "議事槌：示意動作，不是表決結果" },
    { mark: "raised", label: "三本夾：提案、審查、決議，互不推算" },
  ],
  caption:
    "提案、審查、決議是三本分開的夾。選到哪一本就只讀那一本；敲槌不會把提案變成決議，也不會寫出贊成反對票數。真實議事結果只能來自來源紀錄。",
  note: "原創示意元件。不綁定特定議案，也不顯示票數或日期。",
  stage: {
    label: "議事台。左右方向鍵選夾，空白鍵敲槌",
    max: BINDERS.length - 1,
    now: 0,
    text: describe(start),
  },
  svg,
  preview,
  controls,
  data: { axes: T.axes, stops: STOPS, binderZ: BINDER_Z, rest: REST },
});
