import DATA from "./data.js";
import { BINDERS, REST, advance, choose, createDesk, describe, strike } from "./model.js";
import { loop, mover, speaker, tour } from "../runtime.js";

export function mount(root) {
  const stage = root.querySelector(".iso-stage");
  const svg = stage.querySelector("svg");
  const tray = svg.querySelector("[data-tray]");
  const gavel = svg.querySelector("[data-gavel]");
  const buttons = [...root.querySelectorAll("button[data-binder]")];
  const hit = root.querySelector("[data-act='strike']");
  const move = mover(DATA.axes);
  const voice = speaker(root, stage);
  const listeners = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const desk = createDesk(0);
  let seen = "";
  let step = -1;

  function draw() {
    tray.setAttribute("transform", move(desk.x, 0, 0));
    gavel.setAttribute("transform", move(0, 0, desk.gavel.at - REST));
    voice.say(describe(desk));
    const now = `${desk.chosen}|${desk.strike}`;
    if (now === seen) return;
    seen = now;
    buttons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === desk.chosen)));
    voice.describe(describe(desk), desk.chosen);
  }

  function tick(dt, calm) {
    if (guide.on) {
      guide.clock += dt;
      const next = Math.floor(guide.clock / 2.5);
      if (next !== step) {
        step = next;
        choose(desk, step % BINDERS.length);
        if (step % 2 === 1) strike(desk);
      }
    }
    const moving = advance(desk, dt, calm);
    draw();
    return guide.on || moving;
  }

  const engine = loop(stage, tick);
  const guide = tour(engine.run);
  const act = (change) => {
    guide.touch();
    step = -1;
    change();
    draw();
    engine.run();
  };

  buttons.forEach((button, index) => on(button, "click", () => act(() => choose(desk, index))));
  on(hit, "click", () => act(() => strike(desk)));
  on(stage, "click", (event) => {
    const target = event.target.closest("[data-hit]");
    if (target) act(() => choose(desk, Number(target.dataset.hit)));
  });
  on(stage, "keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") act(() => choose(desk, desk.chosen + 1));
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") act(() => choose(desk, desk.chosen - 1));
    else if (event.key === "Home") act(() => choose(desk, 0));
    else if (event.key === "End") act(() => choose(desk, BINDERS.length - 1));
    else if (event.key === " " || event.key === "Enter") act(() => strike(desk));
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
