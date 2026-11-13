/**
 * Figure: layer-board (catalogued as illustration).
 * A drafting board with three hinged acetate sheets. Boundary, claim and
 * verified survey stay separate; only the verified sheet takes the pin.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { basePlate, k, knob, labelPlate, tools } from "../lib/kit.mjs";
import { emitFigure } from "../lib/emit.mjs";
import { FLAT, LAYERS, RAISED, createBoard, describe } from "./model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDTH = 640;
const HEIGHT = 420;

const PLATE = { x: -108, y: -78, w: 216, d: 156, r: 10 };
const BOARD = { x: -78, y: -52, w: 156, d: 108, r: 3 };
const BOARD_Z = 4;
const SHEET_Z = BOARD_Z + 3;
const SHEET = { x: -62, y: -40, w: 118, d: 78, r: 1.4 };
const HINGE_Y = SHEET.y - 6;
const PIN = { x: 68, y: 8 };

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -14, 0), [-70, -50, 70], [90, 50, 8], [PIN.x, PIN.y, SHEET_Z + RAISED + 28]],
  WIDTH,
  HEIGHT,
  { pad: 32, azimuth: 40, elevation: 33 },
);
const T = tools(P);
const { S, L, D, at } = T;

function boardDeck() {
  const out = [];
  out.push(S(k.slabOf(BOARD, BOARD_Z, 5, P, 5, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BOARD, 4), BOARD_Z + 5, P, 4), { tone: "faint" }));
  // Grid etched into the board — drafting marks, not a real map.
  for (let step = 1; step <= 5; step++) {
    const x = BOARD.x + 14 + step * 22;
    out.push(L(k.lineOnTop([x, BOARD.y + 10], [x, BOARD.y + BOARD.d - 10], BOARD_Z + 5, P), { tone: "faint" }));
  }
  for (let step = 1; step <= 3; step++) {
    const y = BOARD.y + 16 + step * 20;
    out.push(L(k.lineOnTop([BOARD.x + 12, y], [BOARD.x + BOARD.w - 12, y], BOARD_Z + 5, P), { tone: "faint" }));
  }
  // Corner clips that hold the stack.
  for (const [x, y] of [
    [BOARD.x + 6, BOARD.y + BOARD.d - 8],
    [BOARD.x + BOARD.w - 6, BOARD.y + BOARD.d - 8],
  ]) {
    out.push(S(k.slabOf({ x: x - 5, y: y - 3, w: 10, d: 8, r: 1 }, BOARD_Z + 5, 3, P, 3, 0.25), { tone: "lo" }));
    out.push(D([at([x, y, BOARD_Z + 8])], { size: 0.4 }));
  }
  out.push(labelPlate(T, { x: -70, y: 48, w: 52, d: 12, r: 1.2 }, 0));
  return out.join("");
}

function hinges() {
  const out = [];
  for (const x of [SHEET.x + 18, SHEET.x + SHEET.w - 18]) {
    out.push(S(k.cylinder(x, HINGE_Y, 3.4, BOARD_Z, 4, P, 16), { tone: "lo" }));
    out.push(S(k.cylinder(x, HINGE_Y, 2.4, BOARD_Z + 4, 10, P, 16), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(x, HINGE_Y, 3.6, BOARD_Z + 14, 2, P, 16), { tone: "mid" }));
  }
  out.push(S(k.slabOf({ x: SHEET.x + 10, y: HINGE_Y - 4, w: SHEET.w - 20, d: 8, r: 1 }, BOARD_Z + 14, 3, P, 3, 0.3), { tone: "mid" }));
  return out.join("");
}

/** Drawing that lives on one acetate sheet. */
function sheetFace(kind, z) {
  const out = [];
  const top = z + 1.2;
  out.push(S(k.slabOf(SHEET, z, 1.2, P, 4, 0.35), { tone: kind === "verified" ? "hi" : "mid", lit: kind === "verified", crease: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(SHEET, 3), top, P, 3), { tone: "faint" }));

  if (kind === "boundary") {
    // Closed administrative outline — not a street map.
    const inset = k.insetPlan(SHEET, 14);
    out.push(L(k.planOutline(inset, top, P, 4), { tone: "lo" }));
    out.push(L(k.planOutline(k.insetPlan(inset, 6), top, P, 3), { tone: "faint" }));
    out.push(D([at([inset.x + 4, inset.y + 4, top]), at([inset.x + inset.w - 4, inset.y + inset.d - 4, top])], { size: 0.38 }));
  } else if (kind === "claim") {
    // Offset claim polygon — deliberately not aligned with the boundary.
    const claim = { x: SHEET.x + 22, y: SHEET.y + 18, w: 70, d: 44, r: 2 };
    out.push(L(k.planOutline(claim, top, P, 4), { tone: "lo" }));
    out.push(L(k.lineOnTop([claim.x + 6, claim.y + 10], [claim.x + claim.w - 10, claim.y + 10], top, P), { tone: "faint", free: true }));
    out.push(L(k.lineOnTop([claim.x + 6, claim.y + 18], [claim.x + claim.w - 22, claim.y + 18], top, P), { tone: "faint", free: true }));
    out.push(L(k.lineOnTop([claim.x + 6, claim.y + 26], [claim.x + claim.w - 16, claim.y + 26], top, P), { tone: "faint", free: true }));
  } else {
    // Verified parcel with tick marks at surveyed corners and a pin hole.
    const parcel = { x: SHEET.x + 18, y: SHEET.y + 16, w: 78, d: 48, r: 1.5 };
    out.push(L(k.planOutline(parcel, top, P, 4), { tone: "lo" }));
    for (const [x, y] of k.corners(parcel, 0)) {
      out.push(L(k.lineOnTop([x - 3, y], [x + 3, y], top, P), { tone: "mid" }));
      out.push(L(k.lineOnTop([x, y - 3], [x, y + 3], top, P), { tone: "mid" }));
      out.push(D([at([x, y, top])], { size: 0.36, tone: "hi" }));
    }
    out.push(S(k.cylinder(PIN.x - 8, PIN.y - 4, 3.2, top, 0.6, P, 14), { tone: "lo", crease: "none" }));
    out.push(L(k.ring(PIN.x - 8, PIN.y - 4, 3.2, top, P, 16), { tone: "lo" }));
  }

  // Tab label on the near edge.
  const tabX = SHEET.x + (kind === "boundary" ? 8 : kind === "claim" ? 46 : 84);
  out.push(S(k.slabOf({ x: tabX, y: SHEET.y + SHEET.d - 2, w: 28, d: 10, r: 1 }, z, 1.4, P, 3, 0.2), { tone: "hi", crease: "none" }));
  out.push(L(k.lineOnTop([tabX + 4, SHEET.y + SHEET.d + 3], [tabX + 22, SHEET.y + SHEET.d + 3], z + 1.4, P), { tone: "lo", free: true }));
  return out.join("");
}

function sheets({ live }) {
  const start = createBoard(2);
  return LAYERS.map((layer, index) => {
    const z0 = SHEET_Z + index * 1.6;
    const body = sheetFace(layer.id, z0);
    if (live) {
      const lift = start.lift[index];
      const xf = k.translateAlong(P, [0, 0, lift]);
      return `<g data-sheet="${index}" transform="${xf}" data-layer="${layer.id}">${body}</g>`;
    }
    // Still preview: verified sheet slightly raised so the stack reads.
    const lift = index === 2 ? RAISED * 0.4 : FLAT;
    const xf = k.translateAlong(P, [0, 0, lift]);
    return `<g transform="${xf}" opacity="${index === 2 ? 1 : 0.72}">${body}</g>`;
  }).join("");
}

function registrationPin({ live }) {
  const start = createBoard(2);
  const baseZ = SHEET_Z + 2 * 1.6 + 1.2;
  const stem = [
    S(k.cylinder(PIN.x, PIN.y, 2.2, baseZ, 4, P, 14), { tone: "lo" }),
    S(k.cylinder(PIN.x, PIN.y, 1.6, baseZ + 4, 18, P, 14), { tone: "mid", crease: "none" }),
    knob(T, PIN.x, PIN.y, 3.4, baseZ + 22, 5, { count: 12, lit: true }),
  ].join("");
  if (!live) {
    return `<g transform="${k.translateAlong(P, [0, 0, 0])}">${stem}</g>`;
  }
  // Pin travels down into the verified hole when that layer is chosen.
  const drop = (1 - start.pin) * 14;
  return `<g data-pin transform="${k.translateAlong(P, [0, 0, drop])}">${stem}</g>`;
}

function sideRail() {
  const out = [];
  out.push(S(k.slabOf({ x: 74, y: -36, w: 14, d: 72, r: 1.5 }, BOARD_Z, 8, P, 3, 0.35), { tone: "mid" }));
  for (let i = 0; i < 3; i++) {
    const y = -24 + i * 22;
    out.push(S(k.cylinder(81, y, 2.8, BOARD_Z + 8, 3, P, 12), { tone: "lo" }));
    out.push(D([at([81, y, BOARD_Z + 11])], { size: 0.35 }));
  }
  return out.join("");
}

function body({ live }) {
  return [
    basePlate(T, PLATE),
    boardDeck(),
    hinges(),
    sideRail(),
    sheets({ live }),
    registrationPin({ live }),
  ];
}

const label =
  "疊圖校準板。行政界線、主張範圍與核對圖層是三張分開的透明片。只有核對圖層能上銷；主張範圍不能當成已核對的案址。";
const start = createBoard(2);
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

const controls = `<div class="fig-group" role="group" aria-label="圖層">${LAYERS.map(
  (layer, index) => `<button type="button" data-layer="${index}" aria-pressed="${index === 2}">${layer.short}</button>`,
).join("")}</div>`;

export default emitFigure({
  id: "layer-board",
  source: HERE,
  width: WIDTH,
  height: HEIGHT,
  fig: "示意 6",
  title: "疊圖校準板",
  hint: "選圖層，看哪一張能上銷",
  readout: describe(start),
  keys: [
    { mark: "lit", label: "核對圖層：銷孔對準後才能引用" },
    { mark: "raised", label: "主張範圍：不是核對結果" },
  ],
  caption:
    "地圖上的界線、主張與核對是三張片。掀開主張不會變成核對；只有核對圖層能上銷。這不是任何真實地籍或工程的現況圖。",
  note: "原創示意插畫。不描繪特定地號或工程；數字與日期只能來自來源紀錄。",
  stage: {
    label: "疊圖校準板。左右方向鍵切換圖層",
    max: LAYERS.length - 1,
    now: 2,
    text: describe(start),
  },
  svg,
  preview,
  controls,
  data: { axes: T.axes, raised: RAISED, flat: FLAT, sheetZ: SHEET_Z, sheetStep: 1.6, pinBase: SHEET_Z + 2 * 1.6 + 1.2 },
});
