import DATA from "./data.js";
import { LAYERS, advance, bind, choose, createCabinet, describe, layerText, toggle } from "./model.js";
import { loop, mover, speaker, tour } from "../runtime.js";

/**
 * Wires one budget cabinet. With `options.project` (or data-project on the host)
 * it binds that governance project as soon as the records load.
 */
export function mount(root, options = {}) {
  const stage = root.querySelector(".iso-stage");
  const svg = stage.querySelector("svg");
  const part = (name, index) => svg.querySelector(`[data-${name}="${index}"]`);
  const drawers = LAYERS.map((_, index) => part("drawer", index));
  const fronts = LAYERS.map((_, index) => part("front", index).querySelector(".iso-solid"));
  const latches = LAYERS.map((_, index) => part("latch", index));
  const rules = LAYERS.map((_, index) => [...svg.querySelectorAll(`[data-rules="${index}"]`)]);
  const buttons = [...root.querySelectorAll("[data-layer]")];
  const values = LAYERS.map((_, index) => root.querySelector(`[data-value="${index}"]`));
  const select = root.querySelector("[data-project]");
  const source = root.querySelector("[data-source]");
  const move = mover(DATA.axes);
  const voice = speaker(root, stage);
  const listeners = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const cabinet = createCabinet();
  let projects = [];
  let sources = {};
  let seen = "";
  let step = -1;

  function draw() {
    cabinet.drawers.forEach((drawer, index) => drawers[index].setAttribute("transform", move(0, drawer.at, 0)));
    voice.say(describe(cabinet));
    const now = `${cabinet.chosen}|${cabinet.drawers.map((drawer) => `${drawer.state}${drawer.value}${drawer.want}`).join()}`;
    if (now === seen) return;
    seen = now;
    cabinet.drawers.forEach((drawer, index) => {
      fronts[index].toggleAttribute("data-lit", index === cabinet.chosen);
      latches[index].toggleAttribute("data-on", drawer.state === "unknown");
      for (const line of rules[index]) line.toggleAttribute("data-on", drawer.state === "known");
      buttons[index].setAttribute("aria-pressed", String(drawer.want === 1));
      values[index].textContent = layerText(drawer);
    });
    const chosen = cabinet.drawers[cabinet.chosen];
    voice.describe(`${LAYERS[cabinet.chosen].label}：${layerText(chosen)}`, cabinet.chosen);
  }

  function tick(dt, calm) {
    if (guide.on) {
      guide.clock += dt;
      const next = Math.floor(guide.clock / 2.3);
      if (next !== step) {
        step = next;
        const previous = cabinet.drawers[cabinet.chosen];
        if (previous.want) toggle(cabinet);
        toggle(cabinet, step % LAYERS.length);
      }
    }
    const moving = advance(cabinet, dt, calm);
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

  function showSource(project) {
    source.replaceChildren();
    if (!project) return;
    if (!project.budget) {
      source.textContent = "本站這個案卷還沒有收錄預算紀錄，三層都扣著。這不代表機關沒有公開。";
      return;
    }
    const origin = sources[project.budget.source_id];
    source.append("金額來源：");
    if (origin) {
      const link = document.createElement("a");
      link.href = origin.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${origin.agency}〈${origin.name}〉`;
      source.append(link, `，本站查閱日 ${origin.checked_at}。`);
    } else {
      source.append("紀錄沒有列出來源。");
    }
  }

  function bindProject(id) {
    const project = projects.find((row) => row.id === id);
    bind(cabinet, project ? project.budget : undefined);
    showSource(project);
  }

  async function loadProjects() {
    try {
      const read = async (path) => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`${path} ${response.status}`);
        return response.json();
      };
      const [governance, registry] = await Promise.all([read("/data/governance.json"), read("/data/governance-registry.json")]);
      if (listeners.signal.aborted) return;
      projects = governance.projects;
      sources = Object.fromEntries(registry.sources.map((row) => [row.id, row]));
      for (const project of projects) {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = project.title;
        select.append(option);
      }
      if (options.project && projects.some((row) => row.id === options.project)) {
        select.value = options.project;
        act(() => bindProject(options.project));
      }
    } catch (error) {
      select.disabled = true;
      source.textContent = "讀不到案卷資料。抽屜可以操作，但不會顯示金額。";
      console.warn("budget drawers: no project records", error);
    }
  }

  on(select, "change", () => act(() => bindProject(select.value)));
  buttons.forEach((button, index) => on(button, "click", () => act(() => toggle(cabinet, index))));
  on(stage, "click", (event) => {
    const hit = event.target.closest("[data-hit]");
    if (hit) act(() => toggle(cabinet, Number(hit.dataset.hit)));
  });
  on(stage, "keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") act(() => choose(cabinet, cabinet.chosen + 1));
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") act(() => choose(cabinet, cabinet.chosen - 1));
    else if (event.key === "Home") act(() => choose(cabinet, 0));
    else if (event.key === "End") act(() => choose(cabinet, LAYERS.length - 1));
    else if (event.key === " " || event.key === "Enter") act(() => toggle(cabinet));
    else return;
    event.preventDefault();
  });

  draw();
  loadProjects();
  return {
    destroy() {
      listeners.abort();
      guide.stop();
      engine.stop();
    },
  };
}
