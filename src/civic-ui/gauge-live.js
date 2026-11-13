/** Moves the measuring bench. One loop, writes attributes on refs, stops when
 *  settled or off screen, and goes still for reduced motion, data saver, small
 *  devices or when the reader switches motion off.
 */
import "./vendor/iso.css";
import { plateHtml } from "./vendor/iso-kit.mjs";
import { createGauge } from "./gauge.mjs";
import { formatCount, formatShare } from "./model.mjs";

const follow = (value, target, dt, tau) => value + (target - value) * (1 - Math.exp(-dt / tau));

export function motionOff() {
  const root = document.documentElement;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  if (root.dataset.civicMotion === "off") return true;
  if (root.dataset.civicMotion === "on") return false;
  const nav = navigator;
  return nav.connection?.saveData === true
    || (Number.isFinite(nav.deviceMemory) && nav.deviceMemory <= 2)
    || (Number.isFinite(nav.hardwareConcurrency) && nav.hardwareConcurrency <= 2);
}

/** rows: [{ id, label, short, count, share }] on one shared scale; share null = not loaded. */
export function mountGauge(stage, { rows, chosen = 0, fig = "圖 1", title, hint, caption, keys, label, onShow, onChoose, tour = false, intro = true }) {
  const gauge = createGauge(rows);
  let data = rows;
  const stackOf = (row) => ({
    tall: gauge.heightOf(row.share, row.count),
    state: row.share === null ? "unknown" : "known",
  });
  const goal = data.map((row) => stackOf(row).tall);
  const tall = [...goal];
  const state = { x: gauge.centerX(chosen), z: tall[chosen], target: chosen, phase: "rest", slot: -1 };

  stage.classList.add("civic-stage", "iso");
  stage.dataset.theme = "light";
  stage.innerHTML = plateHtml({
    fig,
    title,
    hint,
    keys,
    caption,
    body: gauge.svg(data.map(stackOf), chosen, label),
  });
  const ref = {
    readout: stage.querySelector("[data-readout]"),
    gauge: stage.querySelector("[data-gauge]"),
    slider: stage.querySelector("[data-slider]"),
    arm: stage.querySelector("[data-arm]"),
    slots: [...stage.querySelectorAll("[data-slot]")],
    papers: [...stage.querySelectorAll("[data-paper]")],
  };
  state.slot = ref.slots.findIndex((slot) => slot.contains(ref.arm));

  // The first time the bench comes into view the arm lowers onto the first
  // stack once: under a second, and only if motion is welcome.
  if (intro && !motionOff()) {
    state.z = tall[chosen] + gauge.clear + 6;
    state.phase = "settle";
  }

  let frame = 0;
  let last = 0;
  let visible = false;
  let touring = false;
  let toured = !tour;
  let idle = 0;
  let clock = 0;
  let laps = 0;
  let wasBusy = false;
  let dirty = true;

  const setTransform = (node, value) => (value ? node.setAttribute("transform", value) : node.removeAttribute("transform"));
  const between = (from, to) => {
    let top = 0;
    for (let index = Math.min(from, to); index <= Math.max(from, to); index++) top = Math.max(top, tall[index], goal[index]);
    return top + gauge.clear;
  };

  function paintPaper(index) {
    ref.papers[index].innerHTML = gauge.paperSvg(index, tall[index], {
      lit: index === state.target,
      state: data[index].share === null ? "unknown" : "known",
    });
  }

  function say() {
    const row = data[state.target];
    if (state.phase !== "rest") ref.readout.textContent = `量高規移往${row.short}`;
    else if (row.share === null) ref.readout.textContent = `${row.label} 尚未載入`;
    else ref.readout.textContent = `${row.label} ${formatCount(row.count)} 筆 · 刻度 ${formatShare(row.share)}`;
  }

  function draw() {
    setTransform(ref.gauge, gauge.gaugeShift(state.x));
    setTransform(ref.slider, gauge.sliderShift(state.z));
    setTransform(ref.arm, gauge.armShift(state.x, state.z));
    const slot = gauge.slotOf(state.x);
    if (slot !== state.slot) {
      ref.slots[slot].append(ref.arm);
      state.slot = slot;
    }
    say();
  }

  function step(dt, calm) {
    let busy = false;
    for (let index = 0; index < tall.length; index++) {
      if (tall[index] === goal[index]) continue;
      tall[index] = calm ? goal[index] : follow(tall[index], goal[index], dt, 0.16);
      if (Math.abs(tall[index] - goal[index]) < 0.03) tall[index] = goal[index];
      else busy = true;
      paintPaper(index);
    }
    const tx = gauge.centerX(state.target);
    const tz = tall[state.target];
    if (calm) {
      state.x = tx;
      state.z = tz;
      state.phase = "rest";
      return busy;
    }
    if (state.phase === "rise") {
      const lift = between(gauge.nearest(state.x), state.target);
      state.z = follow(state.z, lift + 0.4, dt, 0.11);
      if (state.z >= lift - 0.2) state.phase = "travel";
    } else if (state.phase === "travel") {
      state.x = follow(state.x, tx, dt, 0.19);
      state.z = follow(state.z, between(gauge.nearest(state.x), state.target), dt, 0.16);
      if (Math.abs(state.x - tx) < 0.2) {
        state.x = tx;
        state.phase = "settle";
      }
    } else if (state.phase === "settle") {
      state.z = follow(state.z, tz, dt, 0.13);
      if (Math.abs(state.z - tz) < 0.04) {
        state.z = tz;
        state.phase = "rest";
      }
    } else {
      state.z = tz;
    }
    return busy || state.phase !== "rest";
  }

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    const calm = motionOff();
    if (!toured && !calm) {
      idle += dt;
      if (!touring && idle > 1.6) touring = true;
      if (touring) {
        clock += dt;
        if (clock > 3.4 && state.phase === "rest") {
          clock = 0;
          // One lap, then stay put: the tour shows the bench works, it is not a screensaver.
          if (++laps >= data.length) toured = true;
          show((state.target + 1) % data.length);
        }
      }
    }
    const busy = step(dt, calm);
    if (busy || wasBusy || dirty) draw();
    wasBusy = busy;
    dirty = false;
    const waiting = !toured && !calm;
    frame = visible && (busy || waiting) ? requestAnimationFrame(tick) : 0;
    if (!frame) last = 0;
  }

  function run() {
    if (frame) return;
    if (motionOff()) {
      step(0, true);
      draw();
      return;
    }
    if (!visible) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  /** Move the gauge and the lit stack. Does not count as the reader's choice. */
  function show(index) {
    const next = Math.max(0, Math.min(data.length - 1, index));
    const previous = state.target;
    state.target = next;
    if (previous !== next) {
      paintPaper(previous);
      paintPaper(next);
    }
    if (Math.abs(state.x - gauge.centerX(next)) < 0.2) state.phase = "settle";
    else state.phase = state.z >= between(gauge.nearest(state.x), next) - 0.2 ? "travel" : "rise";
    dirty = true;
    onShow?.(data[next], next);
    run();
  }

  function describe() {
    const row = data[state.target];
    stage.setAttribute("aria-valuenow", String(state.target + 1));
    stage.setAttribute("aria-valuetext", row.share === null
      ? `${row.label}，尚未載入`
      : `${row.label}，${formatCount(row.count)} 筆，共同刻度 ${formatShare(row.share)}`);
  }

  function choose(index, { silent = false } = {}) {
    toured = true;
    touring = false;
    show(index);
    describe();
    if (!silent) onChoose?.(data[state.target], state.target);
  }

  /** New counts on the same trays: the paper grows or shrinks and the gauge follows. */
  function update(nextRows) {
    data = nextRows;
    for (let index = 0; index < data.length; index++) {
      const next = stackOf(data[index]);
      const wasUnknown = ref.papers[index].querySelector(".civic-unknown") !== null;
      goal[index] = next.tall;
      if ((next.state === "unknown") !== wasUnknown) {
        tall[index] = next.tall;
        paintPaper(index);
      }
    }
    if (state.phase === "rest") state.phase = "settle";
    dirty = true;
    describe();
    run();
  }

  stage.tabIndex = 0;
  stage.setAttribute("role", "slider");
  stage.setAttribute("aria-label", label);
  stage.setAttribute("aria-valuemin", "1");
  stage.setAttribute("aria-valuemax", String(data.length));
  stage.setAttribute("aria-orientation", "horizontal");
  stage.addEventListener("click", (event) => {
    const hit = event.target.closest("[data-tray]");
    if (hit) choose(Number(hit.dataset.tray));
  });
  stage.addEventListener("keydown", (event) => {
    const moves = {
      ArrowRight: state.target + 1, ArrowDown: state.target + 1,
      ArrowLeft: state.target - 1, ArrowUp: state.target - 1,
      Home: 0, End: data.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    choose(moves[event.key]);
  });
  const observer = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run();
  }, { rootMargin: "120px 0px" });
  observer.observe(stage);
  const quiet = matchMedia("(prefers-reduced-motion: reduce)");
  const settle = () => run();
  quiet.addEventListener("change", settle);
  document.addEventListener("civic:motion", settle);

  describe();
  draw();
  return {
    choose,
    update,
    target: () => state.target,
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      quiet.removeEventListener("change", settle);
      document.removeEventListener("civic:motion", settle);
    },
  };
}
