/**
 * Locates the anatomy kit and offers the few shared bench parts every civic
 * figure stands on, so a set of figures keeps one scale and one finish.
 *
 * The kit itself is not part of this repository. Built figures are committed
 * under public/art-library/figures/, so a rebuild is only needed to change one.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "../../../..");
export const PUBLIC = join(ROOT, "public");
export const FIGURES_OUT = join(PUBLIC, "art-library", "figures");

const candidates = [
  process.env.ANATOMY_KIT,
  join(ROOT, ".cursor/skills/anatomy/kit"),
  join(homedir(), ".cursor/skills/anatomy/kit"),
  join(homedir(), ".agents/skills/anatomy/kit"),
].filter(Boolean);
export const KIT_DIR = candidates.find((dir) => existsSync(join(dir, "iso-kit.mjs")));
if (!KIT_DIR) {
  throw new Error("anatomy kit not found. Set ANATOMY_KIT to the folder that holds iso-kit.mjs.");
}
export const k = await import(pathToFileURL(join(KIT_DIR, "iso-kit.mjs")).href);
export const KIT_LICENSE = readFileSync(join(KIT_DIR, "..", "LICENSE"), "utf8").trim();

/** Short drawing helpers bound to one projection. */
export function tools(P) {
  const at = (point) => k.iso(point, P);
  const depth = (point) => k.depthOf([point[0], point[1], point[2] ?? 0], P);
  return {
    P,
    at,
    S: (paths, style = {}) => k.solidSvg(paths, style),
    L: (d, style = {}) => k.lineSvg(d, style),
    D: (points, style = {}) => k.dotsSvg(points, style),
    byDepth: (points) => [...points].sort((a, b) => depth(a) - depth(b)),
    /** Screen vectors of one world unit along each axis, for the live page. */
    axes: {
      x: k.axisVector(P, [1, 0, 0]),
      y: k.axisVector(P, [0, 1, 0]),
      z: k.axisVector(P, [0, 0, 1]),
    },
  };
}

/** The visible front half of a horizontal circle, as screen points. */
export function frontArc(cx, cy, radius, z, P, steps = 20) {
  const [vx, vy] = k.towardViewer(P);
  const facing = Math.atan2(vy, vx);
  const points = [];
  for (let step = 0; step <= steps; step++) {
    const angle = facing - Math.PI / 2 + (step / steps) * Math.PI;
    points.push(k.iso([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z], P));
  }
  return points;
}

/**
 * A clip that shows a vertical rod only above the face it slides out of.
 * The clip stays still while the rod moves under it.
 */
export function clipAbove(id, cx, cy, radius, z, P) {
  // Everything above the face's level line, plus the near half of the hole.
  // Wider parts on the rod (a knob) must stay clear of that line by design.
  const arc = frontArc(cx, cy, radius, z, P, 24);
  const first = arc[0];
  const last = arc[arc.length - 1];
  const left = Math.min(first[0], last[0]) - 2000;
  const right = Math.max(first[0], last[0]) + 2000;
  const sky = Math.min(first[1], last[1]) - 2000;
  const ordered = first[0] <= last[0] ? arc : [...arc].reverse();
  const points = [[left, ordered[0][1]], ...ordered, [right, ordered[ordered.length - 1][1]], [right, sky], [left, sky]];
  return `<clipPath id="${id}"><path d="${k.pathOf(points, true)}"/></clipPath>`;
}

/** Base plate on four flanged feet, with a groove and corner screws. */
export function basePlate(T, plate, { thickness = 10, foot = 5 } = {}) {
  const { P, S, L, D, at, byDepth } = T;
  const under = -thickness - foot;
  const out = [`<path class="iso-halo" d="${k.haloOf(plate, under, thickness, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(plate, 20))) {
    out.push(S(k.cylinder(x, y, 7.2, under, 1.7, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.2, under + 1.7, foot - 1.7, P, 24), { tone: "mid" }));
  }
  out.push(S(k.slabOf(plate, -thickness, thickness, P, 8, 1.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(plate, 6), 0, P), { tone: "faint" }));
  const screws = k.corners(plate, 12);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.3, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  return out.join("");
}

/** A ruler strip. Its major ticks fall on multiples of step * every. */
export function rulerStrip(T, strip, z, { from, to, step = 6, every = 5 }) {
  const { P, S, L, D, at } = T;
  const top = z + 0.7;
  const out = [S(k.slabOf(strip, z, 0.7, P, 3), { tone: "lo", crease: "none" })];
  const ticks = k.topTicks(from, to, step, every, strip.y + 0.05, top, [1.8, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + strip.d - 1.6, top]), at([strip.x + strip.w - 2, strip.y + strip.d - 1.6, top])], { size: 0.42 }));
  return out.join("");
}

/** A name plate. Its three rules stand for printed text, so they may stop on the face. */
export function labelPlate(T, plan, z) {
  const { P, S, L, D, at } = T;
  const top = z + 0.8;
  const out = [S(k.slabOf(plan, z, 0.8, P, 3), { tone: "mid", crease: "lo" })];
  out.push(L(k.planOutline(k.insetPlan(plan, 1.6), top, P, 3), { tone: "faint" }));
  const left = plan.x + 6;
  const lengths = [plan.w - 12, plan.w - 22, plan.w - 30];
  lengths.forEach((length, index) => {
    const y = plan.y + 3.6 + index * 2.4;
    out.push(L(k.lineOnTop([left, y], [left + length, y], top, P), { tone: index ? "faint" : "lo", free: true }));
  });
  out.push(D([at([plan.x + 2.6, plan.y + plan.d / 2, top]), at([plan.x + plan.w - 2.6, plan.y + plan.d / 2, top])], { size: 0.42 }));
  return out.join("");
}

/** A knurled knob on a short neck, with a pointer line on top. */
export function knob(T, cx, cy, radius, z, height, { count = 18, lit = false } = {}) {
  const { P, S, L, D, at } = T;
  return [
    S(k.cylinder(cx, cy, radius, z, height, P, 24), { tone: lit ? "hi" : "mid", lit }),
    L(k.knurl(cx, cy, radius, z, z + height, count, P), { tone: "lo" }),
    D([at([cx, cy, z + height])], { size: 0.45, tone: "hi" }),
  ].join("");
}
