import DATA from "./data.js";
import { LAYERS, advance, choose, createSection, describe } from "./model.js";
import { loop, mover, speaker, tour } from "../runtime.js";

export function mount(root) {
  const stage = root.querySelector(".iso-stage");
  const svg = stage.querySelector("svg");
  const parts = LAYERS.map((_, index) => svg.querySelector(`[data-layer="${index}"]`));
  const buttons = [...root.querySelectorAll("button[data-layer]")];
  const move = mover(DATA.axes);
  const voice = speaker(root, stage);
  const listeners = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const section = createSection(2);
  let seen = "";
  let step = -1;

  function draw() {
    parts.forEach((node, index) => {
      if (!node) return;
      node.setAttribute("transform", move(0, 0, section.lift[index]));
      node.toggleAttribute("data-active", index === section.chosen);
    });
    voice.say(describe(section));
    const now = `${section.chosen}|${section.lift.map((value) => Math.round(value)).join(",")}`;
    if (now === seen) return;
    seen = now;
    buttons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === section.chosen)));
    voice.describe(describe(section), section.chosen);
  }

  function tick(dt, calm) {
    if (guide.on) {
      guide.clock += dt;
      const next = Math.floor(guide.clock / 2.7);
      if (next !== step) {
        step = next;
        choose(section, step % LAYERS.length);
      }
    }
    const moving = advance(section, dt, calm);
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

  buttons.forEach((button, index) => on(button, "click", () => act(() => choose(section, index))));
  on(stage, "keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") act(() => choose(section, section.chosen + 1));
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") act(() => choose(section, section.chosen - 1));
    else if (event.key === "Home") act(() => choose(section, 0));
    else if (event.key === "End") act(() => choose(section, LAYERS.length - 1));
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
