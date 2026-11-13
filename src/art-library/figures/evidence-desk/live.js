import DATA from "./data.js";
import { ORIGINS, STOPS, advance, choose, clearMarks, createDesk, describe, press, under } from "./model.js";
import { loop, mover, speaker, tour } from "../runtime.js";

/** Wires one evidence desk to its model. Returns a handle whose destroy() stops everything. */
export function mount(root) {
  const stage = root.querySelector(".iso-stage");
  const svg = stage.querySelector("svg");
  const tray = svg.querySelector('[data-part="tray"]');
  const stampParts = [...svg.querySelectorAll('[data-part="stamp"]')];
  const marks = ORIGINS.map((_, index) => svg.querySelector(`[data-mark="${index}"]`));
  const chips = [...root.querySelectorAll("[data-origin]")];
  const move = mover(DATA.axes);
  const voice = speaker(root, stage);
  const listeners = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const desk = createDesk(DATA.start);
  let seen = "";

  function draw() {
    tray.setAttribute("transform", move(desk.x, 0, 0));
    const lifted = move(0, 0, desk.lift.at);
    for (const part of stampParts) part.setAttribute("transform", lifted);
    voice.say(describe(under(desk.x), desk.stamped));
    // Marks, chips and the spoken value change only when the choice or a stamp does.
    const now = `${desk.index}|${desk.stamped.join()}`;
    if (now === seen) return;
    seen = now;
    marks.forEach((mark, index) => mark.toggleAttribute("data-on", desk.stamped[index]));
    chips.forEach((chip, index) => chip.setAttribute("aria-pressed", String(index === desk.index)));
    voice.describe(describe(desk.index, desk.stamped), desk.index);
  }

  function tick(dt, calm) {
    if (guide.on && desk.press === "idle") {
      guide.clock += dt;
      choose(desk, Math.floor(guide.clock / 2.6) % STOPS.length);
    }
    const moving = advance(desk, dt, calm);
    draw();
    return guide.on || moving;
  }

  const engine = loop(stage, tick);
  const guide = tour(engine.run);
  const act = (change) => {
    guide.touch();
    change();
    draw();
    engine.run();
  };

  chips.forEach((chip, index) => on(chip, "click", () => act(() => choose(desk, index))));
  const stampButton = root.querySelector('[data-act="stamp"]');
  const resetButton = root.querySelector('[data-act="reset"]');
  if (stampButton) on(stampButton, "click", () => act(() => press(desk)));
  if (resetButton) on(resetButton, "click", () => act(() => clearMarks(desk)));

  on(stage, "click", (event) => {
    const hit = event.target.closest("[data-hit]");
    if (!hit) return;
    if (hit.dataset.hit === "stamp") act(() => press(desk));
    else act(() => choose(desk, Number(hit.dataset.hit)));
  });

  on(stage, "keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") act(() => choose(desk, desk.index + 1));
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") act(() => choose(desk, desk.index - 1));
    else if (event.key === "Home") act(() => choose(desk, 0));
    else if (event.key === "End") act(() => choose(desk, STOPS.length - 1));
    else if (event.key === " " || event.key === "Enter") act(() => press(desk));
    else return;
    event.preventDefault();
  });

  draw();
  return {
    destroy() {
      listeners.abort();
      guide.stop();
      engine.stop();
    },
  };
}
