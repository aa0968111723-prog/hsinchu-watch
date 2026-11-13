import DATA from "./data.js";
import { LAYERS, advance, choose, createBoard, describe } from "./model.js";
import { loop, mover, speaker, tour } from "../runtime.js";

export function mount(root) {
  const stage = root.querySelector(".iso-stage");
  const svg = stage.querySelector("svg");
  const sheets = LAYERS.map((_, index) => svg.querySelector(`[data-sheet="${index}"]`));
  const pin = svg.querySelector("[data-pin]");
  const buttons = [...root.querySelectorAll("button[data-layer]")];
  const move = mover(DATA.axes);
  const voice = speaker(root, stage);
  const listeners = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const board = createBoard(2);
  let seen = "";
  let step = -1;

  function draw() {
    sheets.forEach((node, index) => {
      if (!node) return;
      node.setAttribute("transform", move(0, 0, board.lift[index]));
      node.toggleAttribute("data-active", index === board.chosen);
    });
    if (pin) {
      const drop = (1 - board.pin) * 14;
      pin.setAttribute("transform", move(0, 0, drop));
      pin.toggleAttribute("data-seated", board.pin > 0.85);
    }
    voice.say(describe(board));
    const now = `${board.chosen}|${board.lift.map((value) => Math.round(value)).join(",")}|${Math.round(board.pin * 10)}`;
    if (now === seen) return;
    seen = now;
    buttons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === board.chosen)));
    voice.describe(describe(board), board.chosen);
  }

  function tick(dt, calm) {
    if (guide.on) {
      guide.clock += dt;
      const next = Math.floor(guide.clock / 2.8);
      if (next !== step) {
        step = next;
        choose(board, step % LAYERS.length);
      }
    }
    const moving = advance(board, dt, calm);
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

  buttons.forEach((button, index) => on(button, "click", () => act(() => choose(board, index))));
  on(stage, "keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") act(() => choose(board, board.chosen + 1));
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") act(() => choose(board, board.chosen - 1));
    else if (event.key === "Home") act(() => choose(board, 0));
    else if (event.key === "End") act(() => choose(board, LAYERS.length - 1));
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
