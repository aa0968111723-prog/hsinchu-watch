/**
 * Rules of the figures' models, without a browser.
 *   node --test tests/art-library/
 */
import assert from "node:assert/strict";
import { test } from "node:test";
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
