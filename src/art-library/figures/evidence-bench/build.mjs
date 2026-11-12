/**
 * Figure: evidence stamp bench.
 * A carriage carries three folders. A stamp drops onto the folder beneath it.
 * The readout names that evidence class. Folder thickness belongs to this model only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CARRIAGE_TOP,
  F0,
  FD,
  FOLDERS,
  FW,
  FY,
  REACH,
  STEP,
  STAMP_X,
  STAMP_Y,
  STOPS,
  contactHeight,
  readout,
} from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const OUT = join(ROOT, "public/art-library/figures/evidence-bench");

const kitPath = [
  process.env.ANATOMY_KIT,
  join(homedir(), ".cursor/skills/anatomy/kit/iso-kit.mjs"),
  join(homedir(), ".agents/skills/anatomy/kit/iso-kit.mjs"),
].find((path) => path && existsSync(path));
if (!kitPath) throw new Error("anatomy kit not found; set ANATOMY_KIT to iso-kit.mjs");
const k = await import(pathToFileURL(kitPath).href);

const WIDTH = 680;
const HEIGHT = 440;
const PLATE = { x: -158, y: -92, w: 316, d: 184, r: 10 };
const PLATE_H = 11;
const FOOT_H = 5;
const CARRIAGE = { x: -10, y: -32, w: F0 + (FOLDERS.length - 1) * STEP + FW + 20, d: 64, r: 3 };

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    [-136, 0, 96],
    [STAMP_X + 16, STAMP_Y, 100],
    [150, 78, 8],
  ],
  WIDTH,
  HEIGHT,
  { pad: 28, azimuth: 38, elevation: 32 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 20))) {
    out.push(S(k.cylinder(x, y, 7.2, -PLATE_H - FOOT_H, 1.7, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.2, -PLATE_H - FOOT_H + 1.7, FOOT_H - 1.7, P, 24), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 6), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 12);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.3, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  for (const [x, y] of k.corners(PLATE, 28)) {
    out.push(S(k.slabOf({ x: x - 4, y: y - 3, w: 8, d: 6, r: 1 }, 0, 1.2, P, 3, 0.3), { tone: "lo", crease: "none" }));
  }
  const strip = { x: -120, y: PLATE.y + PLATE.d - 16, w: 150, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.7, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 5, strip.y + 0.8, 0.7, [1.8, 3.4], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.4, 0.7]), at([strip.x + strip.w - 2, strip.y + 3.4, 0.7])], { size: 0.42 }));
  const name = { x: 46, y: PLATE.y + PLATE.d - 18, w: 78, d: 10, r: 1 };
  out.push(S(k.slabOf(name, 0, 0.8, P, 3), { tone: "hi", crease: "lo" }));
  out.push(L(k.lineOnTop([name.x + 6, name.y + 3], [name.x + name.w - 6, name.y + 3], 0.8, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([name.x + 6, name.y + 5.2], [name.x + name.w - 14, name.y + 5.2], 0.8, P), { tone: "faint" }));
  out.push(L(k.lineOnTop([name.x + 6, name.y + 7.4], [name.x + name.w - 22, name.y + 7.4], 0.8, P), { tone: "faint" }));
  const ink = { x: 108, y: -80, w: 34, d: 26, r: 2 };
  out.push(S(k.slabOf(ink, 0, 4, P, 4, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(ink, 4), 4, 0.6, P, 3), { tone: "hi", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(ink, 4), 4.6, P, 4), { tone: "lo" }));
  return out.join("");
}

function rails() {
  const out = [];
  for (const y of [-28, 24]) {
    out.push(S(k.slabOf({ x: -96, y, w: 220, d: 5, r: 1 }, 0, 3, P, 3, 0.35), { tone: "mid" }));
    out.push(D([-80, 110].map((x) => at([x, y + 2.5, 3])), { size: 0.4 }));
  }
  for (const x of [-102, 126]) {
    out.push(S(k.slabOf({ x, y: -32, w: 6, d: 64, r: 1.2 }, 0, 7, P, 3, 0.4), { tone: "mid" }));
    out.push(D([at([x + 3, -24, 7]), at([x + 3, 24, 7])], { size: 0.42 }));
  }
  return out.join("");
}

function gantry() {
  const out = [];
  const foot = { x: -146, y: -12, w: 28, d: 24, r: 2 };
  out.push(S(k.slabOf(foot, 0, 6, P, 4, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(foot, 3), 6, 4, P, 3, 0.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(foot, 4), 10, P, 3), { tone: "faint" }));
  out.push(D([at([-140, -6, 10]), at([-126, -6, 10]), at([-140, 6, 10])], { size: 0.4 }));
  const post = [-132, 0];
  out.push(S(k.cylinder(post[0], post[1], 5.2, 10, 3, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(post[0], post[1], 3.4, 13, 63, P, 24), { tone: "mid", crease: "none" }));
  out.push(L([28, 48].map((z) => k.sideArc(post[0], post[1], 3.4, z, P, 14)).join(""), { tone: "faint" }));
  out.push(S(k.cylinder(post[0], post[1], 4.4, 76, 3, P, 24), { tone: "mid" }));
  const arm = { x: -128, y: -5, w: STAMP_X + 14 - (-128), d: 10, r: 2 };
  out.push(S(k.slabOf(arm, 74, 6, P, 4, 0.45), { tone: "mid" }));
  out.push(D([at([arm.x + 10, 0, 80]), at([arm.x + arm.w - 16, 0, 80])], { size: 0.42 }));
  const knob = [post[0] + 8, foot.y + foot.d + 2];
  out.push(S(k.cylinder(knob[0], knob[1], 3.1, 6, 7, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(knob[0], knob[1], 3.1, 6, 13, 16, P), { tone: "lo" }));
  out.push(D([at([knob[0], knob[1], 13])], { size: 0.45, tone: "hi" }));
  out.push(S(k.cylinder(STAMP_X, STAMP_Y, 4.2, 72, 10, P, 24), { tone: "mid" }));
  out.push(L(k.ring(STAMP_X, STAMP_Y, 4.2, 82, P, 24), { tone: "lo" }));
  return out.join("");
}

function carriage() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CARRIAGE, 4), 3, 0.2, P)}" style="filter:blur(4px)"/>`];
  out.push(S(k.slabOf(CARRIAGE, 3, CARRIAGE_TOP - 3, P, 5, 0.55), { tone: "mid" }));
  out.push(L(k.lineOnTop([CARRIAGE.x + 4, -22], [CARRIAGE.x + CARRIAGE.w - 4, -22], CARRIAGE_TOP, P), { tone: "faint" }));
  out.push(L(k.lineOnTop([CARRIAGE.x + 4, 22], [CARRIAGE.x + CARRIAGE.w - 4, 22], CARRIAGE_TOP, P), { tone: "faint" }));
  out.push(D([-4, 28, 60, 92].map((x) => at([x, CARRIAGE.y + 3, CARRIAGE_TOP])), { size: 0.38, tone: "lo" }));
  FOLDERS.forEach((folder, index) => {
    const plan = { x: F0 + index * STEP, y: FY, w: FW, d: FD, r: 1.2 };
    const top = CARRIAGE_TOP + folder.thickness;
    const tone = index === 2 ? "hi" : "mid";
    out.push(S(k.slabOf(plan, CARRIAGE_TOP, folder.thickness, P, 3, 0.45), { tone, crease: "lo" }));
    out.push(L(k.planOutline(k.insetPlan(plan, 2.2), top, P, 3), { tone: "faint" }));
    out.push(L(k.lineOnTop([plan.x + 3, plan.y + 8], [plan.x + 3, plan.y + plan.d - 4], top, P), { tone: "lo" }));
    const tabX = plan.x + 3 + index * 5;
    const tab = { x: tabX, y: plan.y - 3, w: 8, d: 7, r: 1 };
    out.push(S(k.slabOf(tab, top - 1, 4, P, 3, 0.3), { tone: "hi", crease: "lo" }));
    out.push(D([at([plan.x + 8, plan.y + 16, top]), at([plan.x + 8, plan.y + 28, top])], { size: 0.4 }));
  });
  const handle = [CARRIAGE.x + CARRIAGE.w - 8, CARRIAGE.y + CARRIAGE.d + 2];
  out.push(S(k.slabOf({ x: handle[0] - 2.2, y: CARRIAGE.y + CARRIAGE.d - 2, w: 4.4, d: 4, r: 1 }, 4, 3, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(handle[0], handle[1], 3.2, 3, 6, P, 18), { tone: "mid" }));
  out.push(L(k.knurl(handle[0], handle[1], 3.2, 3, 9, 16, P), { tone: "lo" }));
  return out.join("");
}

function stamp() {
  const out = [];
  out.push(S(k.cylinder(STAMP_X, STAMP_Y, 8, 0, 5, P, 32, 0.6), { tone: "hi", lit: true }));
  out.push(L(k.ring(STAMP_X, STAMP_Y, 5.2, 5, P, 28), { tone: "lo" }));
  out.push(S(k.cylinder(STAMP_X, STAMP_Y, 2.15, 5, 92, P, 18), { tone: "hi", crease: "none", lit: true }));
  return out.join("");
}

const start = STOPS[2];
const startHeight = contactHeight(start);
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "證據壓印台。滑座上有三本證據夾，壓印頭落在正下方那一本，讀數只報這台模型的夾別與夾厚，不是政策百分比。",
  body: [
    plate(),
    rails(),
    gantry(),
    `<g data-part="carriage" transform="${k.translateAlong(P, [start, 0, 0])}">${carriage()}</g>`,
    `<g data-part="stamp" transform="${k.translateAlong(P, [0, 0, startHeight])}">${stamp()}</g>`,
  ],
});

const preview = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "證據壓印台靜態預覽，示意來源可信度的三種夾別。",
  standalone: "light",
  body: [
    plate(),
    rails(),
    gantry(),
    `<g transform="${k.translateAlong(P, [start, 0, 0])}">${carriage()}</g>`,
    `<g transform="${k.translateAlong(P, [0, 0, startHeight])}">${stamp()}</g>`,
  ],
});

const kitSource = readFileSync(kitPath, "utf8").replace(/^export /gm, "");
const live = `
const P = ${JSON.stringify(P)};
const FOLDERS = ${JSON.stringify(FOLDERS)};
const STOPS = ${JSON.stringify(STOPS)};
const REACH = ${JSON.stringify(REACH)};
const STAMP_X = ${STAMP_X}, FW = ${FW}, F0 = ${F0}, STEP = ${STEP}, CARRIAGE_TOP = ${CARRIAGE_TOP};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const carriage = svg.querySelector('[data-part="carriage"]');
const stamp = svg.querySelector('[data-part="stamp"]');
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const folderUnder = (tx) => FOLDERS.findIndex((_, index) => {
  const left = F0 + index * STEP;
  const x = STAMP_X - tx;
  return x >= left && x <= left + FW;
});
const contactHeight = (tx) => {
  const index = folderUnder(tx);
  return index < 0 ? CARRIAGE_TOP : CARRIAGE_TOP + FOLDERS[index].thickness;
};
const say = (tx) => {
  const index = folderUnder(tx);
  return index < 0 ? "夾與夾之間 · 壓在台面" : FOLDERS[index].label + " · 夾厚 " + FOLDERS[index].thickness;
};
let x = ${start}, target = x, tip = { at: ${startHeight}, rate: 0 };
let frame = 0, last = 0, clock = 0, touring = !still.matches, visible = false, idleTimer = 0, described = "";
const tourAt = (t) => STOPS[Math.floor(t / 2.4) % STOPS.length];
function describe(text, index) {
  if (text === described) return;
  described = text;
  stage.setAttribute("aria-valuetext", text);
  stage.setAttribute("aria-valuenow", String(index));
}
function draw() {
  carriage.setAttribute("transform", translateAlong(P, [x, 0, 0]));
  stamp.setAttribute("transform", translateAlong(P, [0, 0, tip.at]));
  const text = say(x);
  if (readout.textContent !== text) readout.textContent = text;
  describe(text, Math.max(0, folderUnder(x)));
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring && !calm) { clock += dt; target = tourAt(clock); }
  x = calm ? target : x + (target - x) * (1 - Math.exp(-dt / 0.28));
  if (Math.abs(target - x) < 0.02) x = target;
  const want = contactHeight(x);
  const stiff = 380, drag = calm ? 2 * Math.sqrt(380) : 24;
  for (let i = 0; i < 4; i++) { tip.rate += ((want - tip.at) * stiff - tip.rate * drag) * dt / 4; tip.at += tip.rate * dt / 4; }
  if (Math.abs(want - tip.at) < 0.01 && Math.abs(tip.rate) < 0.01) { tip.at = want; tip.rate = 0; }
  draw();
  const settled = !touring && x === target && tip.rate === 0 && tip.at === want;
  frame = visible && !(calm && settled) && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (next) => {
  touring = false;
  target = clamp(next, REACH[0], REACH[1]);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { touring = !still.matches; clock = 0; run(); }, 3600);
  run();
};
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointerdown", (event) => {
  const box = svg.getBoundingClientRect();
  const share = clamp((event.clientX - box.left) / box.width, 0, 1);
  steer(REACH[1] + share * (REACH[0] - REACH[1]));
});
stage.addEventListener("keydown", (event) => {
  const here = STOPS.reduce((best, stop, index) => (Math.abs(stop - target) < Math.abs(STOPS[best] - target) ? index : best), 0);
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") to = Math.min(STOPS.length - 1, here + 1);
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = Math.max(0, here - 1);
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = STOPS.length - 1;
  if (to === null) return;
  event.preventDefault();
  steer(STOPS[to]);
});
document.querySelectorAll("[data-folder]").forEach((button) => {
  button.addEventListener("click", () => steer(STOPS[Number(button.dataset.folder)]));
});
draw();
`;

const controls = `<div class="bench-controls">${FOLDERS.map((folder, index) => `<button type="button" data-folder="${index}">${folder.label}</button>`).join("")}</div>`;
const body = k.plateHtml({
  fig: "圖 1",
  title: "證據壓印台",
  hint: "拖曳、方向鍵或下方按鈕",
  readout: readout(start, startHeight),
  keys: [
    { mark: "lit", label: "壓印頭：落在正下方的夾上" },
    { mark: "raised", label: "三本夾，由左到右是尚未核對、機關報告、獨立查核" },
  ],
  caption: "這是來源可信度的示意儀器。夾厚 8、14、20 是這台模型自己的厚度，用來讓壓印頭有確實的落點；它不是政策百分比、預算執行率或民調。真實照片與這台儀器分開編號。",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="證據壓印台。左右方向鍵切換三本證據夾" aria-valuemin="0" aria-valuemax="2" aria-valuenow="2" aria-valuetext="${readout(start, startHeight)}">${svg}</div>${controls}`,
});

let html = k.pageHtml({
  title: "證據壓印台",
  theme: "light",
  body,
  script: kitSource + live,
  width: 760,
});
html = html
  .replace('lang="en"', 'lang="zh-Hant"')
  .replace(
    "</style>",
    `body{font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif}
body[data-theme="light"]{--anatomy-page:#f4efe6}
.iso-page{width:min(760px,100% - 16px);margin:12px auto 28px}
.bench-controls{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.75rem}
.bench-controls button{min-height:44px;min-width:44px;padding:.55rem 1rem;border-radius:999px;border:1px solid #e3d6c6;background:#fffaf4;color:#2b261f;font:inherit;cursor:pointer}
.bench-controls button:focus-visible{outline:3px solid #2f6a56;outline-offset:2px}
.iso-stage{touch-action:pan-y}
@media (prefers-reduced-motion: reduce){.iso-stage{scroll-behavior:auto}}
</style>`,
  );

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "index.html"), html);
writeFileSync(join(OUT, "preview.svg"), preview);
console.log("wrote", OUT);
