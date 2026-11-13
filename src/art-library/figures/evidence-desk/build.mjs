/**
 * Figure: evidence desk.
 * A tray carries four stacks of record cards, one per claim_origin. A stamp
 * hangs over the stack under it and only comes down when the reader presses it.
 * What moves: the tray picks who said it; the stamp records that it was checked.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { basePlate, clipAbove, frontArc, k, knob, labelPlate, rulerStrip, tools } from "../lib/kit.mjs";
import { emitFigure } from "../lib/emit.mjs";
import { ORIGINS, STACK, STAMP, STOPS, centreOf, describe } from "./model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDTH = 680;
const HEIGHT = 440;
const START = 0;

const PLATE = { x: -150, y: -78, w: 300, d: 156, r: 10 };
const TRAY = { x: -68, y: -40, w: 136, d: 68, r: 3 };
const TRAY_Z = 3;
const TRAY_TOP = 8;
const STACK_Y = -24;
const STACK_TOP = TRAY_TOP + STACK.h;
const POST = [0, -62];
const ARM = { x: -5, y: -67, w: 10, d: 53, r: 2 };
const ARM_Z = 56;
const ARM_TOP = 62;
const HOUSING = { x: -8, y: -14, w: 16, d: 16, r: 2.5 };
const HOUSING_Z = 52;
const HOUSING_TOP = 70;
const SHAFT = 2.2;
// At full press the knob still stands 4 above the housing, clear of the gland clip.
const KNOB_Z = HOUSING_TOP + 4;
const POINTER_X = 14;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -15, 0), [STAMP.x, STAMP.y, KNOB_Z + 6 + STAMP.lift + 2], [POST[0], POST[1], ARM_TOP + 2]],
  WIDTH,
  HEIGHT,
  { pad: 46, azimuth: 40, elevation: 30 },
);
const T = tools(P);
const { S, L, D, at } = T;

function column() {
  const out = [];
  const foot = { x: POST[0] - 12, y: POST[1] - 12, w: 24, d: 24, r: 2 };
  out.push(S(k.slabOf(foot, 0, 6, P, 4, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(foot, 3), 6, 4, P, 3, 0.4), { tone: "mid" }));
  out.push(D(k.corners(foot, 3).map(([x, y]) => at([x, y, 6])), { size: 0.42 }));
  out.push(S(k.cylinder(POST[0], POST[1], 5.2, 10, 3, P, 24), { tone: "mid" }));
  out.push(
    S(k.cylinder(POST[0], POST[1], 3.4, 13, ARM_Z - 13, P, 24), {
      tone: "mid",
      crease: "none",
      inner: L([28, 42].map((z) => k.sideArc(POST[0], POST[1], 3.4, z, P, 14)).join(""), { tone: "faint" }),
    }),
  );
  return out.join("");
}

function rails() {
  const out = [];
  for (const y of [-34, 17]) {
    out.push(S(k.slabOf({ x: -124, y, w: 248, d: 5, r: 1 }, 0, 3, P, 3, 0.35), { tone: "mid" }));
    out.push(D([-116, 116].map((x) => at([x, y + 2.5, 3])), { size: 0.4 }));
  }
  return out.join("");
}

function stop(x) {
  const plan = { x, y: -38, w: 6, d: 64, r: 1.2 };
  return S(k.slabOf(plan, 0, 7, P, 3, 0.4), { tone: "mid" }) + D([at([x + 3, -30, 7]), at([x + 3, 18, 7])], { size: 0.42 });
}

function tray() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(TRAY, 4), TRAY_Z, 0.2, P)}" style="filter:blur(4px)"/>`];
  out.push(S(k.slabOf(TRAY, TRAY_Z, TRAY_TOP - TRAY_Z, P, 5, 0.55), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(TRAY, 2.4), TRAY_TOP, P, 4), { tone: "faint" }));
  out.push(D([-60, -30, 0, 30, 60].map((x) => at([x, TRAY.y + TRAY.d - 2.4, TRAY_TOP])), { size: 0.38, tone: "lo" }));
  ORIGINS.forEach((_, index) => {
    const centre = centreOf(index);
    const tab = { x: centre - 10 + index * 4, y: STACK_Y - 2.4, w: 8, d: 2, r: 0.6 };
    out.push(S(k.slabOf(tab, TRAY_TOP, STACK.h + 4, P, 2, 0.25), { tone: "mid", crease: "lo", className: "mat-sand" }));
  });
  ORIGINS.forEach((_, index) => {
    const centre = centreOf(index);
    const plan = { x: centre - STACK.w / 2, y: STACK_Y, w: STACK.w, d: STACK.d, r: 1.2 };
    const seams = [3, 6, 9].map((dz) => k.sideSeam(plan, TRAY_TOP + dz, P, 3)).join("");
    const cards = S(k.slabOf(plan, TRAY_TOP, STACK.h, P, 3, 0.4), { tone: "hi", crease: "lo", inner: L(seams, { tone: "faint" }) });
    const topCard = L(k.planOutline(k.insetPlan(plan, 2.2), STACK_TOP, P, 3), { tone: "faint" });
    const mark = `<path class="iso-line fig-mark" data-mark="${index}" d="${k.ring(centre, STAMP.y, 5.4, STACK_TOP + 0.05, P, 32)}${k.ring(centre, STAMP.y, 2.2, STACK_TOP + 0.05, P, 20)}"/>`;
    out.push(`<g data-hit="${index}">${cards}${topCard}${mark}</g>`);
  });
  const pointer = { x: POINTER_X - 1.2, y: TRAY.y + TRAY.d, w: 2.4, d: 5, r: 0.6 };
  out.push(S(k.slabOf(pointer, TRAY_Z + 1, TRAY_TOP - TRAY_Z - 1, P, 2), { tone: "hi", crease: "none" }));
  const handle = [TRAY.x + TRAY.w - 6, TRAY.y + TRAY.d + 3.5];
  out.push(S(k.slabOf({ x: handle[0] - 2.2, y: TRAY.y + TRAY.d, w: 4.4, d: 2, r: 0.8 }, TRAY_Z + 1, 3, P, 2), { tone: "mid", crease: "none" }));
  out.push(knob(T, handle[0], handle[1] + 1, 3.2, TRAY_Z, 6));
  return out.join("");
}

function stampLower() {
  const top = HOUSING_TOP - 2 - STAMP.lift;
  return [
    S(k.cylinder(STAMP.x, STAMP.y, 7, STACK_TOP, 5, P, 32, 0.6), { tone: "hi", lit: true, className: "mat-sage" }),
    L(k.ring(STAMP.x, STAMP.y, 4.6, STACK_TOP + 5, P, 28), { tone: "lo" }),
    S(k.cylinder(STAMP.x, STAMP.y, SHAFT, STACK_TOP + 5, top - STACK_TOP - 5, P, 18), { tone: "hi", crease: "none", lit: true }),
  ].join("");
}

function bridge() {
  const out = [];
  out.push(S(k.slabOf(ARM, ARM_Z, ARM_TOP - ARM_Z, P, 4, 0.45), { tone: "mid" }));
  out.push(D([at([0, ARM.y + 5, ARM_TOP]), at([0, ARM.y + ARM.d - 6, ARM_TOP])], { size: 0.45 }));
  const seam = k.sideSeam(HOUSING, HOUSING_Z + 4, P, 4);
  out.push(S(k.slabOf(HOUSING, HOUSING_Z, HOUSING_TOP - HOUSING_Z, P, 4, 0.5), { tone: "mid", inner: L(seam, { tone: "faint" }) }));
  out.push(D(k.corners(HOUSING, 2.6).map(([x, y]) => at([x, y, HOUSING_TOP])), { size: 0.4 }));
  out.push(L(k.ring(STAMP.x, STAMP.y, SHAFT + 1.4, HOUSING_TOP, P, 24), { tone: "lo" }));
  return out.join("");
}

function stampUpper() {
  const from = HOUSING_TOP - 2 - STAMP.lift;
  return [
    S(k.cylinder(STAMP.x, STAMP.y, SHAFT, from, KNOB_Z - from, P, 18), { tone: "hi", crease: "none", lit: true }),
    knob(T, STAMP.x, STAMP.y, 5, KNOB_Z, 6, { count: 22, lit: true }),
  ].join("");
}

function front() {
  const out = [];
  out.push(rulerStrip(T, { x: -42, y: 36, w: 114, d: 7, r: 1 }, 0, { from: -36, to: 66 }));
  out.push(labelPlate(T, { x: -138, y: 50, w: 62, d: 13, r: 1 }, 0));
  const pad = { x: 98, y: 36, w: 38, d: 28, r: 2 };
  out.push(S(k.slabOf(pad, 0, 4, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(pad, 4), 4, 1, P, 3), { tone: "mid", crease: "none", className: "mat-clay" }));
  return out.join("");
}

function body({ live }) {
  const lift = k.translateAlong(P, [0, 0, STAMP.lift]);
  const slide = k.translateAlong(P, [STOPS[START], 0, 0]);
  const part = (name) => (live ? ` data-part="${name}"` : "");
  const hit = live ? ' data-hit="stamp"' : "";
  const glandArc = k.pathOf(frontArc(STAMP.x, STAMP.y, SHAFT + 0.25, HOUSING_TOP, P, 16));
  return [
    basePlate(T, PLATE),
    column(),
    stop(-130),
    rails(),
    `<g${part("tray")} transform="${slide}">${tray()}</g>`,
    stop(124),
    `<g${part("stamp")}${hit} transform="${lift}">${stampLower()}</g>`,
    bridge(),
    `<defs>${clipAbove("ed-gland", STAMP.x, STAMP.y, SHAFT + 0.25, HOUSING_TOP, P)}</defs>`,
    `<g clip-path="url(#ed-gland)"><g${part("stamp")}${hit} transform="${lift}">${stampUpper()}</g></g>`,
    L(glandArc, { tone: "mid" }),
    front(),
  ];
}

const label = "證據分類台。滑動的卡片架上有四疊來源卡：機關發布、新聞報導、議事紀錄、公開貼文。一枚查核章懸在其中一疊上方，按下才會落下並留下章印。";
const stamped = ORIGINS.map(() => false);
const svg = k.figureSvg({ width: WIDTH, height: HEIGHT, label, body: body({ live: true }) });
const preview = k.figureSvg({ width: WIDTH, height: HEIGHT, label, standalone: "light", body: body({ live: false }) });

const controls = [
  `<div class="fig-group" role="group" aria-label="來源類別">${ORIGINS.map((origin, index) => `<button type="button" data-origin="${index}" aria-pressed="${index === START}">${origin.label}</button>`).join("")}</div>`,
  `<div class="fig-group"><button type="button" data-act="stamp" data-primary>蓋查核章</button><button type="button" data-act="reset">換一批新卡</button></div>`,
].join("");

export default emitFigure({
  id: "evidence-desk",
  source: HERE,
  width: WIDTH,
  height: HEIGHT,
  fig: "示意 1",
  title: "證據分類台",
  hint: "選一疊來源卡，再蓋章",
  readout: describe(START, stamped),
  keys: [
    { mark: "lit", label: "查核章：按下才落下，只在那一疊留下章印" },
    { mark: "raised", label: "四疊來源卡：機關發布、新聞報導、議事紀錄、公開貼文" },
  ],
  caption:
    "誰說的（claim_origin）和有沒有逐筆核對（verification_status）是兩個欄位。滑動卡片架只是換一疊，不會多出章印：抓得到網頁、RSS 裡有這一則，都不算核對。這是示意儀器，不代表任何一筆實際紀錄的狀態。",
  note: "原創示意元件。不含任何政策數字，也不代表特定案件。",
  stage: {
    label: "證據分類台。左右方向鍵換一疊來源卡，空白鍵蓋查核章",
    max: ORIGINS.length - 1,
    now: START,
    text: describe(START, stamped),
  },
  svg,
  preview,
  controls,
  data: { axes: T.axes, start: START },
});
