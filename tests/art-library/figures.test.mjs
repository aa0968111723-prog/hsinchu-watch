/**
 * Rules of the figures' models, without a browser.
 *   node --test tests/art-library/figures.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as budget from "../../src/art-library/figures/budget-drawers/model.js";
import * as council from "../../src/art-library/figures/council-desk/model.js";
import * as emptyBay from "../../src/art-library/figures/empty-bay/model.js";
import * as layers from "../../src/art-library/figures/layer-board/model.js";
import * as yard from "../../src/art-library/figures/stage-yard/model.js";
import {
  ORIGINS,
  STAMP,
  STATUS,
  STOPS,
  advance,
  choose,
  clearMarks,
  createDesk,
  describe,
  press,
  under,
} from "../../src/art-library/figures/evidence-desk/model.js";

const FRAME = 1 / 60;
const governance = JSON.parse(readFileSync(fileURLToPath(new URL("../../public/data/governance.json", import.meta.url)), "utf8"));

/** Runs a cabinet until it rests. */
function rest(cabinet, { calm = false, each = () => {}, limit = 20 } = {}) {
  for (let time = 0; time < limit; time += FRAME) {
    const moving = budget.advance(cabinet, FRAME, calm);
    each(cabinet);
    if (!moving) return;
  }
  assert.fail("the cabinet never came to rest");
}

/** Runs frames until the desk rests, calling `each` after every frame. Fails if it never rests. */
function settle(desk, { calm = false, each = () => {}, limit = 20 } = {}) {
  for (let time = 0; time < limit; time += FRAME) {
    const moving = advance(desk, FRAME, calm);
    each(desk);
    if (!moving) return time;
  }
  assert.fail("the desk never came to rest");
}

test("evidence desk uses the record vocabulary", () => {
  assert.deepEqual(ORIGINS.map((origin) => origin.id), ["agency_release", "news_report", "legislative_record", "public_post"]);
  assert.deepEqual(Object.keys(STATUS), ["unreviewed", "corroborated"]);
  assert.equal(describe(0, [false, false, false, false]), "機關發布 · 未逐筆核對");
  assert.equal(describe(3, [false, false, false, true]), "公開貼文 · 已有佐證");
  assert.equal(describe(-1, []), "卡片架移動中 · 章沒有落下");
});

test("sliding the tray never stamps anything", () => {
  const desk = createDesk(0);
  for (const index of [3, 1, 2, 0, 3]) {
    choose(desk, index);
    settle(desk, { each: (now) => assert.equal(now.lift.at, STAMP.lift, "the stamp stays up while the tray slides") });
    assert.equal(desk.x, STOPS[index]);
    assert.equal(under(desk.x), index);
  }
  assert.deepEqual(desk.stamped, [false, false, false, false]);
});

test("a press marks only the chosen stack, and only on contact", () => {
  const desk = createDesk(0);
  choose(desk, 2);
  assert.equal(press(desk), true);
  let markedAt = null;
  settle(desk, {
    each: (now) => {
      assert(now.lift.at >= 0, "the stamp never sinks into the cards");
      if (now.stamped[2] && !markedAt) markedAt = { x: now.x, lift: now.lift.at };
      if (now.lift.at < STAMP.lift) assert.equal(now.x, STOPS[2], "the stamp only comes down over a stack at rest");
    },
  });
  assert.deepEqual(markedAt, { x: STOPS[2], lift: 0 });
  assert.deepEqual(desk.stamped, [false, false, true, false]);
  assert.equal(desk.lift.at, STAMP.lift);
  assert.equal(describe(under(desk.x), desk.stamped), "議事紀錄 · 已有佐證");
});

test("a press started while the tray is moving waits for the chosen stack", () => {
  const desk = createDesk(0);
  choose(desk, 3);
  advance(desk, FRAME, false);
  assert.notEqual(desk.x, STOPS[3]);
  press(desk);
  settle(desk);
  assert.deepEqual(desk.stamped, [false, false, false, true]);
});

test("choosing another stack during a press is kept, and the tray waits for the stamp to lift", () => {
  const desk = createDesk(0);
  choose(desk, 2);
  press(desk);
  while (!desk.stamped[2]) advance(desk, FRAME, false);
  choose(desk, 3);
  assert.equal(press(desk), false, "a second press during a press is ignored");
  settle(desk, {
    each: (now) => {
      if (now.lift.at < STAMP.lift * 0.45) assert.equal(now.x, STOPS[2], "the tray does not slide under a lowered stamp");
    },
  });
  assert.equal(desk.x, STOPS[3]);
  assert.deepEqual(desk.stamped, [false, false, true, false]);
  assert.equal(describe(under(desk.x), desk.stamped), "公開貼文 · 未逐筆核對");
});

test("reduced motion reaches the same result in one step", () => {
  const desk = createDesk(0);
  choose(desk, 1);
  press(desk);
  assert.equal(advance(desk, FRAME, true), false);
  assert.equal(desk.x, STOPS[1]);
  assert.equal(desk.lift.at, STAMP.lift);
  assert.deepEqual(desk.stamped, [false, true, false, false]);
});

test("choices stay inside the four stacks, and new cards clear every mark", () => {
  const desk = createDesk(0);
  choose(desk, -5);
  assert.equal(desk.index, 0);
  choose(desk, 99);
  assert.equal(desk.index, STOPS.length - 1);
  press(desk);
  settle(desk, { calm: true });
  clearMarks(desk);
  assert.deepEqual(desk.stamped, [false, false, false, false]);
});

test("budget drawers show exactly what each governance record holds, and nothing else", () => {
  assert.deepEqual(budget.LAYERS.map((layer) => layer.id), ["approved_twd", "contract_twd", "spent_twd"]);
  assert(governance.projects.length >= 4);
  for (const project of governance.projects) {
    const cabinet = budget.createCabinet();
    budget.bind(cabinet, project.budget);
    cabinet.drawers.forEach((drawer, index) => {
      const recorded = project.budget ? project.budget[budget.LAYERS[index].id] : null;
      assert.equal(drawer.value, recorded, `${project.id} ${budget.LAYERS[index].id}`);
      assert.equal(drawer.state, recorded === null ? "unknown" : "known");
    });
  }
});

test("a layer with no record stays latched and is never shown as zero", () => {
  const project = governance.projects.find((row) => row.budget && row.budget.spent_twd === null && row.budget.approved_twd !== null);
  assert(project, "the pilot data has a project with an approved amount and no spending record");
  const cabinet = budget.createCabinet();
  budget.bind(cabinet, project.budget);
  const spent = cabinet.drawers[2];
  for (let pull = 0; pull < 5; pull++) {
    assert.equal(budget.toggle(cabinet, 2), false);
    rest(cabinet, { each: () => assert(spent.at >= 0 && spent.at < 6, "a latched drawer only rattles") });
  }
  assert.equal(spent.at, 0);
  assert.equal(budget.isOpen(spent), false);
  assert.equal(budget.describe(cabinet), "實支 · 本站沒有紀錄，不是 0 元");
  assert.notEqual(budget.layerText(spent), budget.formatTwd(0));
});

test("a recorded amount is read only once its drawer is open", () => {
  const project = governance.projects.find((row) => row.budget && row.budget.approved_twd !== null);
  const cabinet = budget.createCabinet();
  budget.bind(cabinet, project.budget);
  assert.equal(budget.describe(cabinet), "核定 · 有紀錄，拉開來看");
  assert.equal(budget.toggle(cabinet, 0), true);
  rest(cabinet);
  assert.equal(cabinet.drawers[0].at, budget.TRAVEL);
  assert.equal(budget.describe(cabinet), `核定 · ${budget.formatTwd(project.budget.approved_twd)}`);
  budget.toggle(cabinet, 0);
  rest(cabinet);
  assert.equal(cabinet.drawers[0].at, 0);
});

test("zero is a recorded amount, null is not", () => {
  const cabinet = budget.createCabinet();
  budget.bind(cabinet, { approved_twd: 0, contract_twd: null, spent_twd: null });
  assert.equal(cabinet.drawers[0].state, "known");
  assert.equal(budget.layerText(cabinet.drawers[0]), "0 元");
  assert.equal(cabinet.drawers[1].state, "unknown");
  assert.notEqual(budget.layerText(cabinet.drawers[1]), budget.layerText(cabinet.drawers[0]));
});

test("a project without a budget record latches all three, and an unbound cabinet shows no number", () => {
  const cabinet = budget.createCabinet();
  assert.deepEqual(cabinet.drawers.map((drawer) => drawer.state), ["unbound", "unbound", "unbound"]);
  assert.equal(budget.describe(cabinet), "核定 · 還沒選案卷");
  budget.bind(cabinet, null);
  assert.deepEqual(cabinet.drawers.map((drawer) => drawer.state), ["unknown", "unknown", "unknown"]);
  budget.bind(cabinet, undefined);
  budget.toggle(cabinet, 1);
  rest(cabinet, { calm: true });
  assert.equal(cabinet.drawers[1].at, budget.TRAVEL);
  assert.equal(budget.describe(cabinet), "決標 · 還沒選案卷");
  assert.equal(/\d/.test(budget.describe(cabinet)), false, "no number without a bound record");
});

test("stage yard keeps five stages separate and never invents one from another", () => {
  assert.deepEqual(
    yard.STAGES.map((stage) => stage.id),
    ["planned", "under_construction", "completed", "accepted", "in_use"],
  );
  assert.equal(yard.stageOfSummary("機關公告舉行開工動土，並列示目標完工月份。"), "under_construction");
  assert.equal(yard.stageOfSummary("工程頁列示完工日期，並以此日為100%工程進度基準。"), "completed");
  assert.equal(yard.stageOfSummary("工程頁記載準備後續驗收、點交與使用執照取得作業。"), null);
  assert.equal(yard.stageOfSummary("在建工程網頁更新日期；表列進度為77.25%，數字本身未另列基準日。"), "under_construction");
  assert.equal(yard.stageOfSummary("地政處發布府地用字第11501943171號公告。"), null);
});

test("peiying events light construction and completion only", () => {
  const project = governance.projects.find((row) => row.id === "taipei-peiying-housing");
  const slots = yard.stagesFromEvents(project.events);
  assert.equal(slots.under_construction?.date, "2020-02-25");
  assert.equal(slots.completed?.date, "2026-06-01");
  assert.equal(slots.accepted, null);
  assert.equal(slots.in_use, null);
  assert.equal(slots.planned, null);
  const model = yard.createYard(0);
  yard.bind(model, slots);
  assert.deepEqual(
    model.pegs.map((peg) => peg.state),
    ["unknown", "known", "known", "unknown", "unknown"],
  );
  yard.choose(model, 2);
  for (let time = 0; time < 5; time += FRAME) yard.advance(model, FRAME, true);
  assert.equal(yard.describe(model), "完工 · 2026-06-01 · 有來源事件");
  yard.choose(model, 3);
  for (let time = 0; time < 5; time += FRAME) yard.advance(model, FRAME, true);
  assert.equal(yard.describe(model), "驗收 · 本站沒有這階段的紀錄");
});

test("a progress percentage alone never lights a stage, and unbound shows no date", () => {
  const project = governance.projects.find((row) => row.id === "new-taipei-siyuan-footbridge");
  const slots = yard.stagesFromEvents(project.events);
  assert.equal(slots.under_construction?.date, "2026-10-12");
  assert.equal(slots.completed, null);
  const model = yard.createYard(0);
  assert.equal(yard.describe(model), "規劃 · 還沒選案卷");
  assert.equal(/\d{4}/.test(yard.describe(model)), false);
  yard.bind(model, slots);
  yard.choose(model, 1);
  for (let time = 0; time < 5; time += FRAME) yard.advance(model, FRAME, true);
  assert.equal(yard.describe(model), "施工 · 2026-10-12 · 有來源事件");
  assert.equal(yard.pegText(model.pegs[2]).includes("77"), false);
});

test("council desk binders stay separate and a strike invents no vote tally", () => {
  assert.deepEqual(council.BINDERS.map((binder) => binder.id), ["proposal", "review", "resolution"]);
  const desk = council.createDesk(0);
  assert.equal(council.describe(desk), "提案 · 只讀這一本，不推算另外兩本");
  council.choose(desk, 2);
  for (let time = 0; time < 5; time += FRAME) council.advance(desk, FRAME, true);
  assert.equal(desk.chosen, 2);
  assert.equal(desk.x, council.STOPS[2]);
  assert.equal(council.describe(desk), "決議 · 只讀這一本，不推算另外兩本");
  assert.equal(council.strike(desk), true);
  assert.equal(council.advance(desk, FRAME, true), false, "reduced motion cancels a strike without a result");
  assert.equal(desk.strike, "idle");
  assert.equal(desk.gavel.at, council.REST);
  assert.equal(/\d{2,}/.test(council.describe(desk)), false);
  assert.equal(council.strike(desk), true);
  assert.equal(council.strike(desk), false, "a second strike while one is under way is ignored");
  for (let time = 0; time < 5; time += FRAME) council.advance(desk, FRAME, false);
  assert.equal(desk.strike, "idle");
  assert.equal(desk.chosen, 2, "striking never promotes the binder");
  assert.equal(council.describe(desk), "決議 · 只讀這一本，不推算另外兩本");
});

test("empty bay never turns a missing record into zero or a fake plaque", () => {
  assert.deepEqual(emptyBay.STATES.map((state) => state.id), ["unbound", "missing", "present"]);
  const bay = emptyBay.createBay(1);
  assert.equal(emptyBay.describe(bay), "本站沒有紀錄 · 空格不是 0");
  assert.equal(bay.seated, emptyBay.OPEN);
  assert.equal(emptyBay.describe(bay).includes("0 元"), false);
  emptyBay.choose(bay, 2);
  for (let time = 0; time < 5; time += FRAME) emptyBay.advance(bay, FRAME, true);
  assert.equal(bay.seated, emptyBay.SEATED);
  assert.equal(emptyBay.describe(bay), "有來源紀錄 · 銘牌在架上");
  emptyBay.choose(bay, 0);
  for (let time = 0; time < 5; time += FRAME) emptyBay.advance(bay, FRAME, true);
  assert.equal(bay.seated, emptyBay.OPEN);
  assert.equal(emptyBay.describe(bay), "還沒選紀錄 · 空格先留著");
  assert.equal(/\d/.test(emptyBay.describe(bay)), false);
});

test("layer board keeps claim off the registration pin", () => {
  assert.deepEqual(layers.LAYERS.map((layer) => layer.id), ["boundary", "claim", "verified"]);
  const board = layers.createBoard(1);
  assert.equal(layers.LAYERS[board.chosen].id, "claim");
  assert.equal(board.pinGoal, 0);
  assert.equal(layers.describe(board).includes("主張不是核對"), true);
  for (let time = 0; time < 5; time += FRAME) layers.advance(board, FRAME, true);
  assert.equal(board.pin, 0);
  assert.equal(board.lift[1], layers.RAISED);
  layers.choose(board, 2);
  for (let time = 0; time < 5; time += FRAME) layers.advance(board, FRAME, true);
  assert.equal(board.pin, 1);
  assert.equal(layers.describe(board), "核對圖層 · 銷已卡住，可引用");
  layers.choose(board, 0);
  for (let time = 0; time < 5; time += FRAME) layers.advance(board, FRAME, true);
  assert.equal(board.pin, 0);
  assert.equal(layers.describe(board), "行政界線 · 界線不是案址");
});
