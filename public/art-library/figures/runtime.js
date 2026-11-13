/**
 * Page side of the civic figures: one frame loop per figure, the idle tour,
 * and the readout. Plain browser module, no dependencies. Motion is time
 * based and stops when the figure is settled or off screen.
 */
export const still = matchMedia("(prefers-reduced-motion: reduce)");

/** Weak devices and data-saver sessions get no idle tour. Input still works. */
export const frugal =
  (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 2) ||
  Boolean(navigator.connection && navigator.connection.saveData);

export { clamp, follow, spring } from "./motion.js";

/** Turns a world offset into an SVG translate, from the axis vectors the build measured. */
export function mover(axes) {
  const round = (value) => Math.round(value * 100) / 100;
  return (x = 0, y = 0, z = 0) =>
    `translate(${round(x * axes.x[0] + y * axes.y[0] + z * axes.z[0])} ${round(x * axes.x[1] + y * axes.y[1] + z * axes.z[1])})`;
}

/**
 * One frame loop per figure. `tick(dt, calm)` returns true while anything is
 * still moving. The loop sleeps when the stage leaves the viewport.
 */
export function loop(stage, tick) {
  let frame = 0;
  let last = 0;
  let visible = false;
  let dead = false;
  const step = (now) => {
    frame = 0;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    const moving = tick(dt, still.matches);
    if (moving && visible && !dead) frame = requestAnimationFrame(step);
    else last = 0;
  };
  const run = () => {
    if (!frame && visible && !dead) frame = requestAnimationFrame(step);
  };
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) run();
    },
    { rootMargin: "120px 0px" },
  );
  observer.observe(stage);
  still.addEventListener("change", run);
  return {
    run,
    stop() {
      dead = true;
      observer.disconnect();
      still.removeEventListener("change", run);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}

/**
 * An idle tour that plays only while nobody is using the figure.
 * `touch()` pauses it and schedules it to resume later.
 */
export function tour(run, { after = 3600 } = {}) {
  let timer = 0;
  const state = { on: !still.matches && !frugal, clock: 0 };
  state.touch = () => {
    state.on = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.on = !still.matches && !frugal;
      state.clock = 0;
      run();
    }, after);
  };
  state.stop = () => {
    state.on = false;
    clearTimeout(timer);
  };
  return state;
}

/** Writes the readout corner and the stage's spoken value, each only when it changes. */
export function speaker(root, stage) {
  const readout = root.querySelector("[data-readout]");
  let shown = "";
  let spoken = "";
  return {
    say(text) {
      if (text !== shown && readout) {
        shown = text;
        readout.textContent = text;
      }
    },
    describe(text, value) {
      if (text === spoken) return;
      spoken = text;
      stage.setAttribute("aria-valuetext", text);
      if (value !== undefined) stage.setAttribute("aria-valuenow", String(value));
    },
  };
}
