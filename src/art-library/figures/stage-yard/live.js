import DATA from "./data.js";
import {
  STAGES,
  advance,
  bind,
  choose,
  createYard,
  describe,
  pegText,
  stagesFromEvents,
} from "./model.js";
import { loop, mover, speaker, tour } from "../runtime.js";

/**
 * Wires one stage yard. With `options.project` (or data-project on the host)
 * it binds that governance project's events as soon as the records load.
 */
export function mount(root, options = {}) {
  const stage = root.querySelector(".iso-stage");
  const svg = stage.querySelector("svg");
  const board = svg.querySelector("[data-board]");
  const buttons = [...root.querySelectorAll("[data-stage]")];
  const values = STAGES.map((_, index) => root.querySelector(`[data-value="${index}"]`));
  const rules = STAGES.map((_, index) => root.querySelector(`[data-rules="${index}"]`));
  const blanks = STAGES.map((_, index) => root.querySelector(`[data-blank="${index}"]`));
  const select = root.querySelector("[data-project]");
  const source = root.querySelector("[data-source]");
  const move = mover(DATA.axes);
  const voice = speaker(root, stage);
  const listeners = new AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const yard = createYard(0);
  let projects = [];
  let sources = {};
  let seen = "";
  let step = -1;

  function draw() {
    board.setAttribute("transform", move(yard.x, 0, 0));
    voice.say(describe(yard));
    const now = `${yard.chosen}|${yard.pegs.map((peg) => peg.state + (peg.record?.date || "")).join()}`;
    if (now === seen) return;
    seen = now;
    yard.pegs.forEach((peg, index) => {
      rules[index].toggleAttribute("data-on", peg.state === "known");
      blanks[index].toggleAttribute("data-on", peg.state === "unknown");
      buttons[index].setAttribute("aria-pressed", String(index === yard.chosen));
      values[index].textContent = pegText(peg);
    });
    voice.describe(`${STAGES[yard.chosen].label}：${pegText(yard.pegs[yard.chosen])}`, yard.chosen);
  }

  function tick(dt, calm) {
    if (guide.on) {
      guide.clock += dt;
      const next = Math.floor(guide.clock / 2.4);
      if (next !== step) {
        step = next;
        choose(yard, step % STAGES.length);
      }
    }
    const moving = advance(yard, dt, calm);
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
    const known = yard.pegs.filter((peg) => peg.state === "known");
    if (!known.length) {
      source.textContent = "本站這個案卷還沒有收錄可對上五個階段的事件。這不代表工程沒有進度，也不代表機關沒有公開。";
      return;
    }
    source.append("階段來源：");
    const ids = [...new Set(known.map((peg) => peg.record.source_id).filter(Boolean))];
    if (!ids.length) {
      source.append("事件有摘要，但沒有列 source_id。");
      return;
    }
    ids.forEach((id, index) => {
      const origin = sources[id];
      if (index) source.append("；");
      if (origin) {
        const link = document.createElement("a");
        link.href = origin.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `${origin.agency}〈${origin.name}〉`;
        source.append(link, `，本站查閱日 ${origin.checked_at}`);
      } else {
        source.append(id);
      }
    });
    source.append("。百分比進度不會被讀成任一階段。");
  }

  function bindProject(id) {
    const project = projects.find((row) => row.id === id);
    bind(yard, project ? stagesFromEvents(project.events) : undefined);
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
      source.textContent = "讀不到案卷資料。測板可以操作，但不會顯示階段日期。";
      console.warn("stage yard: no project records", error);
    }
  }

  on(select, "change", () => act(() => bindProject(select.value)));
  buttons.forEach((button, index) => on(button, "click", () => act(() => choose(yard, index))));
  on(stage, "click", (event) => {
    const hit = event.target.closest("[data-hit]");
    if (hit) act(() => choose(yard, Number(hit.dataset.hit)));
  });
  on(stage, "keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") act(() => choose(yard, yard.chosen + 1));
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") act(() => choose(yard, yard.chosen - 1));
    else if (event.key === "Home") act(() => choose(yard, 0));
    else if (event.key === "End") act(() => choose(yard, STAGES.length - 1));
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
