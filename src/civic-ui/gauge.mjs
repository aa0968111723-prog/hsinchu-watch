/** Figure: a measuring bench for paper.
 *
 *  Nine letter trays stand in a row in front of a graduated back wall. Each
 *  tray holds one kind of record, and its paper is as tall as that kind's count
 *  on one linear scale. A height gauge rides the top of the wall: its arm lifts
 *  clear, glides to the chosen tray and settles on the paper, so the arm's
 *  height on the scale is the reading. Nothing is drawn in perspective, and a
 *  kind too small to show a thickness is drawn as a single sheet.
 *
 *  This module is pure geometry (strings in, strings out) so the same picture
 *  can be built in Node for checks. gauge-live.js moves it.
 */
import * as k from "./vendor/iso-kit.mjs";

export const FULL = 56;        // world height of a stack whose share is 1
const FLOOR = 1.6;             // top of a tray floor
const SHEET = 0.9;             // below this a non-empty stack is one sheet
const SHEET_THICK = 0.3;
const PITCH = 34;
const TRAY_W = 28;
const TRAY_Y = -12;
const TRAY_D = 30;
const WALL_H = FLOOR + FULL + 8;
const PLATE_H = 8;
const FOOT_H = 4;
const CLEAR = 5;               // how far the arm lifts above the tallest stack it passes

const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);

export function createGauge(kinds, { width = 720, azimuth = 58, pad = 20 } = {}) {
  const count = kinds.length;
  const row = count * PITCH - (PITCH - TRAY_W);
  const x0 = -row / 2;
  const trayX = (index) => x0 + index * PITCH;
  const centerX = (index) => trayX(index) + TRAY_W / 2;
  const WALL = { x: x0 - 8, y: -32, w: row + 16, d: 6, r: 1 };
  const FACE_Y = WALL.y + WALL.d;
  const PLATE = { x: x0 - 22, y: -44, w: row + 44, d: 78, r: 10 };
  const extent = [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H - 3, 0),
    [WALL.x, WALL.y, WALL_H + 11],
    [WALL.x + WALL.w, WALL.y, WALL_H + 11],
    [WALL.x + WALL.w, FACE_Y + 4, WALL_H + 11],
  ];
  // The width sets the scale; the height is then whatever the bench needs, so
  // the card is not padded with empty paper above and below.
  const loose = k.fitProjection(extent, width, 4000, { pad, azimuth });
  const ys = extent.map((point) => k.iso(point, loose)[1]);
  const height = Math.ceil(Math.max(...ys) - Math.min(...ys) + pad * 2);
  const P = k.fitProjection(extent, width, height, { pad, azimuth });
  const at = (point) => k.iso(point, P);
  const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

  const paperPlan = (index) => ({ x: trayX(index) + 3, y: TRAY_Y + 2, w: TRAY_W - 6, d: TRAY_D - 4.5, r: 0.5 });

  /** World height of a stack. A counted kind too thin to draw is one sheet. */
  function heightOf(share, countValue) {
    if (share === null || share === undefined) return 0;
    const tall = Math.max(0, Math.min(1, share)) * FULL;
    if (tall >= SHEET) return tall;
    return Number(countValue) > 0 ? SHEET_THICK : 0;
  }

  /** The paper in one tray. `state` is "known", or "unknown" for a kind whose
   *  file is not loaded: a dotted outline, never an empty tray. */
  function paperSvg(index, tall, { lit = false, state = "known" } = {}) {
    const plan = paperPlan(index);
    if (state === "unknown") return L(k.planOutline(plan, FLOOR, P, 4), { tone: "mid", dotted: true, className: "civic-unknown" });
    if (tall <= 0) return "";
    // Lines of print on the top sheet: they stand for text, so they may end on the bare page.
    const printOn = (z) => L([0.24, 0.42, 0.6].map((t, line) => k.lineOnTop(
      [plan.x + 3, plan.y + plan.d * t],
      [plan.x + plan.w - (line === 2 ? 9 : 3), plan.y + plan.d * t],
      z,
      P,
    )).join(""), { tone: "lo", free: true, className: "civic-print" });
    if (tall < SHEET) {
      return S(k.slabOf(plan, FLOOR, SHEET_THICK, P, 4), { tone: "hi", crease: "none", lit, className: "civic-paper civic-sheet-leaf" })
        + printOn(FLOOR + SHEET_THICK + 0.02);
    }
    const seams = [];
    for (let z = 4; z < tall - 1.5; z += 4) seams.push(k.sideSeam(plan, FLOOR + z, P, 4));
    const top = FLOOR + tall + 0.02;
    const print = printOn(top);
    return S(k.slabOf(plan, FLOOR, tall, P, 4, 0.35), {
      tone: "hi",
      lit,
      className: "civic-paper",
      inner: L(seams.join(""), { tone: "faint" }),
    }) + print;
  }

  function bench() {
    const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
    for (const [x, y] of byDepth(k.corners(PLATE, 20))) {
      out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.4, P, 26), { tone: "lo", className: "civic-m-wood" }));
      out.push(S(k.cylinder(x, y, 5.2, -PLATE_H - FOOT_H + 1.4, FOOT_H - 1.4, P, 26), { tone: "mid", className: "civic-m-wood" }));
    }
    out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.4), { tone: "mid", className: "civic-m-wood" }));
    out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
    const screws = k.corners(PLATE, 11);
    out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.1, 0, P, 16)).join(""), { tone: "lo" }));
    out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
    for (let index = 0; index < count; index++) {
      const plate = { x: trayX(index) + 5, y: TRAY_Y + TRAY_D + 3, w: TRAY_W - 10, d: 6, r: 1 };
      out.push(S(k.slabOf(plate, 0, 0.7, P, 3), { tone: "lo", crease: "none", className: "civic-m-kraft" }));
      const rules = [[2.2, plate.w - 3], [3.9, plate.w - 7]].map(([dy, length]) =>
        k.lineOnTop([plate.x + 2.4, plate.y + dy], [plate.x + 2.4 + length - 2.4, plate.y + dy], 0.72, P)).join("");
      out.push(L(rules, { tone: "lo", free: true }));
      out.push(D([at([plate.x + 1.3, plate.y + 3, 0.72]), at([plate.x + plate.w - 1.3, plate.y + 3, 0.72])], { size: 0.36, tone: "mid" }));
    }
    return out.join("");
  }

  function wall() {
    const marks = { zero: [], major: [], minor: [] };
    for (let step = 0; step <= 10; step++) {
      const seam = k.sideSeam(WALL, FLOOR + (step / 10) * FULL, P, 3);
      (step === 0 ? marks.zero : step % 5 === 0 ? marks.major : marks.minor).push(seam);
    }
    const inner = L(marks.minor.join(""), { tone: "lo" }) + L(marks.major.join(""), { tone: "hi" }) + L(marks.zero.join(""), { tone: "hi" });
    const cap = { x: WALL.x + 2, y: WALL.y + 1.2, w: WALL.w - 4, d: WALL.d - 2.4, r: 0.6 };
    const rivets = [];
    for (let x = cap.x + 2.5; x <= cap.x + cap.w - 2; x += PITCH) rivets.push(at([x, cap.y + cap.d / 2, WALL_H + 0.9]));
    // Two shoes hold the wall to the bench. The far one is drawn first.
    const shoe = (x) => {
      const plan = { x, y: WALL.y - 2.5, w: 6, d: WALL.d + 5, r: 1 };
      return S(k.slabOf(plan, 0, 9, P, 3, 0.5), { tone: "mid", className: "civic-m-steel" })
        + D([at([x + 3, plan.y + 1.6, 9]), at([x + 3, plan.y + plan.d - 1.6, 9])], { size: 0.42, tone: "mid" });
    };
    return [
      shoe(WALL.x - 4),
      S(k.slabOf(WALL, 0, WALL_H, P, 3, 0.5), { tone: "mid", className: "civic-m-wood civic-wall", inner }),
      S(k.slabOf(cap, WALL_H, 0.9, P, 3), { tone: "lo", crease: "none", className: "civic-m-steel" }),
      D(rivets, { size: 0.42, tone: "mid" }),
      shoe(WALL.x + WALL.w - 2),
    ].join("");
  }

  /** Everything of the gauge that stays behind the trays: strip, saddle, slider. */
  function gaugeBack(tall) {
    const cx = centerX(0);
    const strip = { x: cx - 2.4, y: FACE_Y, w: 4.8, d: 1.4, r: 0.3 };
    const ticks = { major: [], minor: [] };
    for (let step = 0; step <= 20; step++) {
      (step % 2 === 0 ? ticks.major : ticks.minor).push(k.sideSeam(strip, FLOOR + (step / 20) * FULL, P, 2));
    }
    const saddle = { x: cx - 7, y: WALL.y - 2, w: 14, d: WALL.d + 5, r: 1.5 };
    const slider = { x: cx - 5, y: FACE_Y + 1.4, w: 10, d: 4, r: 0.8 };
    const knob = [cx, WALL.y + WALL.d / 2];
    const lock = [cx + 2.6, slider.y + 2];
    const shift = sliderShift(tall);
    return [
      S(k.slabOf(strip, 0, WALL_H, P, 2), {
        tone: "mid",
        className: "civic-m-steel",
        inner: L(ticks.minor.join(""), { tone: "lo" }) + L(ticks.major.join(""), { tone: "mid" }),
      }),
      S(k.slabOf(saddle, WALL_H + 0.9, 4.6, P, 4, 0.6), { tone: "mid", className: "civic-m-steel" }),
      D(k.corners(saddle, 2).map(([x, y]) => at([x, y, WALL_H + 5.5])), { size: 0.4, tone: "mid" }),
      S(k.cylinder(knob[0], knob[1], 2.7, WALL_H + 5.5, 3.6, P, 22), { tone: "mid", className: "civic-m-steel" }),
      L(k.knurl(knob[0], knob[1], 2.7, WALL_H + 5.5, WALL_H + 9.1, 20, P), { tone: "lo" }),
      L(k.lineOnTop(knob, [knob[0] + 2.7, knob[1]], WALL_H + 9.1, P), { tone: "hi" }),
      D([at([knob[0], knob[1], WALL_H + 9.1])], { size: 0.45, tone: "hi" }),
      `<g data-slider${shift ? ` transform="${shift}"` : ""}>`,
      S(k.slabOf(slider, FLOOR, 5, P, 3, 0.5), { tone: "hi", className: "civic-m-steel" }),
      S(k.cylinder(lock[0], lock[1], 1.5, FLOOR + 5, 1.8, P, 16), { tone: "mid", className: "civic-m-steel" }),
      L(k.knurl(lock[0], lock[1], 1.5, FLOOR + 5, FLOOR + 6.8, 12, P, 0.3), { tone: "lo" }),
      D([at([cx - 2.6, slider.y + 2, FLOOR + 5])], { size: 0.4, tone: "mid" }),
      `</g>`,
    ].join("");
  }

  /** The arm and its pad, built resting on an empty tray floor at tray 0. */
  function arm() {
    const cx = centerX(0);
    const beam = { x: cx - 2, y: FACE_Y + 5.4, w: 4, d: 24.6, r: 0.8 };
    const tip = [cx, beam.y + beam.d - 3.4];
    return [
      S(k.cylinder(tip[0], tip[1], 3.2, FLOOR, 1.4, P, 22), { tone: "hi", className: "civic-m-steel" }),
      S(k.slabOf(beam, FLOOR + 1.4, 2, P, 3, 0.4), { tone: "hi", className: "civic-m-steel" }),
      D([at([tip[0], tip[1], FLOOR + 3.4]), at([cx, beam.y + 2.2, FLOOR + 3.4])], { size: 0.42, tone: "hi" }),
    ].join("");
  }

  function tray(index, paper) {
    const x = trayX(index);
    const floor = { x, y: TRAY_Y, w: TRAY_W, d: TRAY_D, r: 1.2 };
    const rim = (left) => ({ x: left, y: TRAY_Y, w: 1.6, d: TRAY_D, r: 0.5 });
    const lip = { x: x + 1.6, y: TRAY_Y + TRAY_D - 1.4, w: TRAY_W - 3.2, d: 1.4, r: 0.3 };
    return [
      `<g data-tray="${index}">`,
      `<title>${String(kinds[index].label ?? "").replace(/[&<>"]/g, "")}</title>`,
      S(k.slabOf(floor, 0, FLOOR, P, 4, 0.4), { tone: "mid", className: "civic-m-kraft" }),
      L(k.planOutline(k.insetPlan(floor, 2.4), FLOOR, P, 4), { tone: "faint" }),
      S(k.slabOf(rim(x), FLOOR, 3.2, P, 2), { tone: "mid", className: "civic-m-kraft" }),
      `<g data-paper="${index}">${paper}</g>`,
      S(k.slabOf(rim(x + TRAY_W - 1.6), FLOOR, 3.2, P, 2), { tone: "mid", className: "civic-m-kraft" }),
      S(k.slabOf(lip, FLOOR, 1.2, P, 2), { tone: "mid", crease: "none", className: "civic-m-kraft" }),
      // A wide invisible target so a tap on a short stack still lands on its tray.
      `<path class="civic-hit-area" d="${k.slabOf({ ...floor, x: x - 3, w: TRAY_W + 6 }, 0, FULL * 0.3, P, 2).fill}"/>`,
      `</g>`,
    ].join("");
  }

  const gaugeShift = (x) => {
    const dx = x - centerX(0);
    return Math.abs(dx) < 0.005 ? "" : k.translateAlong(P, [dx, 0, 0]);
  };
  const sliderShift = (tall) => (tall < 0.005 ? "" : k.translateAlong(P, [0, 0, tall]));
  const armShift = (x, tall) => {
    const dx = x - centerX(0);
    return Math.abs(dx) < 0.005 && tall < 0.005 ? "" : k.translateAlong(P, [dx, 0, tall]);
  };
  /** Painter's slot of the arm: once its near edge passes a tray's far edge it
   *  is drawn after that tray, because it can then cover that tray's paper. */
  const slotOf = (x) => Math.max(0, Math.min(count - 1, Math.floor((x + 2 - (x0 - 3)) / PITCH)));
  const nearest = (x) => Math.max(0, Math.min(count - 1, Math.round((x - centerX(0)) / PITCH)));

  /** The whole figure at rest on `chosen`. `stacks` is [{ tall, state }]. */
  function svg(stacks, chosen = 0, label = "") {
    const x = centerX(chosen);
    const tall = stacks[chosen]?.tall ?? 0;
    const slot = slotOf(x);
    const body = [
      bench(),
      wall(),
      `<g data-gauge${gaugeShift(x) ? ` transform="${gaugeShift(x)}"` : ""}>${gaugeBack(tall)}</g>`,
    ];
    for (let index = 0; index < count; index++) {
      const stack = stacks[index] || { tall: 0, state: "known" };
      body.push(tray(index, paperSvg(index, stack.tall, { lit: index === chosen, state: stack.state })));
      body.push(`<g data-slot="${index}">${index === slot ? `<g data-arm${armShift(x, tall) ? ` transform="${armShift(x, tall)}"` : ""}>${arm()}</g>` : ""}</g>`);
    }
    return k.figureSvg({ width, height, label, body });
  }

  return {
    P, count, width, height, centerX, heightOf, paperSvg, svg,
    gaugeShift, sliderShift, armShift, slotOf, nearest,
    clear: CLEAR, pitch: PITCH,
  };
}
