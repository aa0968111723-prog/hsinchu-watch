/**
 * Figure: works-section (catalogued as illustration).
 * A cutaway embankment with fill, drain, pavement and rail. Choosing a layer
 * names the part; it never invents a percentage or a real project.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { basePlate, k, knob, labelPlate, tools } from "../lib/kit.mjs";
import { emitFigure } from "../lib/emit.mjs";
import { FOCUS, LAYERS, REST, createSection, describe } from "./model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDTH = 680;
const HEIGHT = 440;

const PLATE = { x: -118, y: -82, w: 236, d: 164, r: 10 };
const BED = { x: -88, y: -36, w: 176, d: 88, r: 2 };
const BED_Z = 3;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -14, 0), [-90, -50, 70], [100, 50, 8], [0, -10, BED_Z + FOCUS + 40]],
  WIDTH,
  HEIGHT,
  { pad: 32, azimuth: 38, elevation: 32 },
);
const T = tools(P);
const { S, L, D, at } = T;

function ground() {
  const out = [];
  out.push(S(k.slabOf(BED, BED_Z, 4, P, 5, 0.45), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(BED, 5), BED_Z + 4, P, 4), { tone: "faint" }));
  // Cut face mark on the near edge.
  out.push(L(k.lineOnTop([BED.x + 8, BED.y + BED.d - 2], [BED.x + BED.w - 8, BED.y + BED.d - 2], BED_Z + 4, P), { tone: "lo" }));
  out.push(labelPlate(T, { x: -74, y: 48, w: 56, d: 12, r: 1.2 }, 0));
  return out.join("");
}

function fillBlock(z) {
  const block = { x: -70, y: -22, w: 140, d: 56, r: 1.5 };
  return [
    S(k.slabOf(block, z, 14, P, 4, 0.4), { tone: "mid" }),
    L(k.planOutline(k.insetPlan(block, 4), z + 14, P, 3), { tone: "faint" }),
    // Stratification lines on the cut face (schematic soil lifts).
    L(k.lineOnTop([block.x + 8, block.y + block.d - 1], [block.x + block.w - 8, block.y + block.d - 1], z + 5, P), { tone: "lo" }),
    L(k.lineOnTop([block.x + 8, block.y + block.d - 1], [block.x + block.w - 8, block.y + block.d - 1], z + 9, P), { tone: "faint" }),
  ].join("");
}

function drainPipe(z) {
  const cx = -8;
  const cy = 8;
  return [
    S(k.cylinder(cx, cy, 7, z, 18, P, 20), { tone: "lo" }),
    S(k.cylinder(cx, cy, 5.2, z + 1, 16, P, 20), { tone: "mid", crease: "none" }),
    L(k.ring(cx, cy, 7, z + 18, P, 20), { tone: "lo" }),
    L(k.ring(cx, cy, 5.2, z + 18, P, 18), { tone: "faint" }),
    // Bedding haunch under the pipe.
    S(k.slabOf({ x: cx - 14, y: cy - 10, w: 28, d: 20, r: 1 }, z - 2, 3, P, 3, 0.3), { tone: "lo" }),
  ].join("");
}

function pavement(z) {
  const slab = { x: -74, y: -26, w: 148, d: 64, r: 1.2 };
  return [
    S(k.slabOf(slab, z, 5, P, 4, 0.35), { tone: "hi", lit: true, crease: "lo" }),
    L(k.planOutline(k.insetPlan(slab, 3), z + 5, P, 3), { tone: "faint" }),
    L(k.lineOnTop([slab.x + 20, slab.y + 20], [slab.x + slab.w - 20, slab.y + 20], z + 5, P), { tone: "lo" }),
    L(k.lineOnTop([slab.x + 20, slab.y + 32], [slab.x + slab.w - 36, slab.y + 32], z + 5, P), { tone: "faint" }),
    D([at([slab.x + 10, slab.y + 10, z + 5]), at([slab.x + slab.w - 10, slab.y + 10, z + 5])], { size: 0.38 }),
  ].join("");
}

function railing(z) {
  const out = [];
  const y = -24;
  for (const x of [-60, -30, 0, 30, 60]) {
    out.push(S(k.cylinder(x, y, 1.8, z, 22, P, 12), { tone: "mid", crease: "none" }));
    out.push(D([at([x, y, z + 22])], { size: 0.32, tone: "hi" }));
  }
  out.push(S(k.slabOf({ x: -64, y: y - 2, w: 128, d: 4, r: 0.8 }, z + 20, 2.2, P, 3, 0.25), { tone: "hi", crease: "none" }));
  out.push(S(k.slabOf({ x: -64, y: y - 2, w: 128, d: 4, r: 0.8 }, z + 12, 1.6, P, 3, 0.2), { tone: "mid", crease: "none" }));
  out.push(knob(T, 78, y, 3.2, z + 8, 6, { count: 10 }));
  return out.join("");
}

const LAYER_DRAW = {
  fill: fillBlock,
  drain: drainPipe,
  pavement,
  rail: railing,
};

function layers({ live }) {
  const start = createSection(2);
  const baseZ = {
    fill: BED_Z + 4,
    drain: BED_Z + 8,
    pavement: BED_Z + 18,
    rail: BED_Z + 23,
  };
  return LAYERS.map((layer, index) => {
    const body = LAYER_DRAW[layer.id](baseZ[layer.id]);
    if (live) {
      const xf = k.translateAlong(P, [0, 0, start.lift[index]]);
      return `<g data-layer="${index}" transform="${xf}" data-part="${layer.id}">${body}</g>`;
    }
    const lift = index === 2 ? FOCUS * 0.35 : REST;
    const xf = k.translateAlong(P, [0, 0, lift]);
    return `<g transform="${xf}" opacity="${index === 2 ? 1 : 0.78}">${body}</g>`;
  }).join("");
}

function callouts() {
  // Small dimension ticks on the plate — schematic only, no numbers.
  const out = [];
  out.push(S(k.slabOf({ x: 86, y: -30, w: 12, d: 70, r: 1 }, BED_Z, 6, P, 3, 0.3), { tone: "mid" }));
  for (let i = 0; i < 4; i++) {
    const y = -18 + i * 16;
    out.push(L(k.lineOnTop([88, y], [96, y], BED_Z + 6, P), { tone: "lo" }));
    out.push(D([at([92, y, BED_Z + 6])], { size: 0.3 }));
  }
  return out.join("");
}

function body({ live }) {
  return [basePlate(T, PLATE), ground(), callouts(), layers({ live })];
}

const label =
  "公共建設剖面示意。回填、排水、路面與護欄是分開的構造層。選一層只說明那一層的名稱，不會寫出百分比或某案的進度。";
const start = createSection(2);
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

const controls = `<div class="fig-group" role="group" aria-label="構造層">${LAYERS.map(
  (layer, index) => `<button type="button" data-layer="${index}" aria-pressed="${index === 2}">${layer.short}</button>`,
).join("")}</div>`;

export default emitFigure({
  id: "works-section",
  source: HERE,
  width: WIDTH,
  height: HEIGHT,
  fig: "示意 7",
  title: "公共建設剖面",
  hint: "選一層，看構造名稱",
  readout: describe(start),
  keys: [
    { mark: "lit", label: "路面層：示意鋪面，不是驗收厚度" },
    { mark: "raised", label: "剖開：只標名稱，不帶百分比" },
  ],
  caption:
    "這是通用示意剖面，不是任何真實道路或橋梁的現況。選一層只讀那一層的名稱；完工、驗收與啟用仍要分開查來源紀錄。",
  note: "原創示意插畫。不描繪特定工程；百分比與日期只能來自來源紀錄。",
  stage: {
    label: "公共建設剖面。左右方向鍵切換構造層",
    max: LAYERS.length - 1,
    now: 2,
    text: describe(start),
  },
  svg,
  preview,
  controls,
  data: { axes: T.axes, focus: FOCUS, rest: REST },
});
