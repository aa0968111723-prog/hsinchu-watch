import DATA from "./data.js";
import { OPEN, STATES, advance, choose, createBay, describe } from "./model.js";
import { loop, mover, speaker, tour } from "../runtime.js";

export function mount(root) {
  const stage = root.querySelector(".iso-stage");
  const svg = stage.querySelector("svg");
  const plaque = svg.querySelector("[data-plaque]");
  const buttons = [...root.querySelectorAll("button[data-state]")];
  const move = mover(DATA.axes);
  const voice = speaker(root, stage);
  const listeners = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const bay = createBay(1);
  let seen = "";
  let step = -1;

  function draw() {
    plaque.setAttribute("transform", move(0, 0, bay.seated - OPEN));
    plaque.toggleAttribute("data-empty", bay.seated <= OPEN + 0.2);
    plaque.style.opacity = bay.seated <= OPEN + 0.05 ? "0.12" : "1";
    voice.say(describe(bay));
    const now = `${bay.chosen}|${Math.round(bay.seated)}`;
    if (now === seen) return;
    seen = now;
    buttons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === bay.chosen)));
    voice.describe(describe(bay), bay.chosen);
  }

  function tick(dt, calm) {
    if (guide.on) {
      guide.clock += dt;
      const next = Math.floor(guide.clock / 2.6);
      if (next !== step) {
        step = next;
        choose(bay, step % STATES.length);
      }
    }
    const moving = advance(bay, dt, calm);
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

  buttons.forEach((button, index) => on(button, "click", () => act(() => choose(bay, index))));
  on(stage, "keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") act(() => choose(bay, bay.chosen + 1));
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") act(() => choose(bay, bay.chosen - 1));
    else if (event.key === "Home") act(() => choose(bay, 0));
    else if (event.key === "End") act(() => choose(bay, STATES.length - 1));
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
