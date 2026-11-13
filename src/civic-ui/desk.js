/** The reading desk: the measuring bench, a chip for every kind and the number
 *  table. All three read the same rows from scaleOf(), so they cannot disagree.
 */
import { escapeHtml, formatCount, formatShare, scaleOf } from "./model.mjs";
import { mountGauge } from "./gauge-live.js";

export function mountDesk(host, {
  kinds,            // [{ id, label }] in tray order, fixed for the life of the desk
  counts,           // { id: number | null }; null = that kind is not loaded
  max,              // pins the scale; omit to use the tallest stack
  fig,
  title = "各類紀錄筆數",
  caption,
  note,
  tour = false,
  onChoose,
}) {
  let scale = scaleOf(kinds.map((kind) => ({ ...kind, count: counts[kind.id] ?? null })), { max });
  host.classList.add("civic-desk");
  host.innerHTML = `
    <div data-stage></div>
    <div class="civic-chips" role="group" aria-label="選一種資料">
      ${scale.rows.map((row) => `<button type="button" class="civic-chip" data-kind="${escapeHtml(row.id)}" aria-pressed="false"><span>${escapeHtml(row.short)}</span><b data-count></b></button>`).join("")}
    </div>
    <p class="civic-sr" role="status" aria-live="polite" data-say></p>
    <details class="civic-fold" data-numbers>
      <summary>數字表</summary>
      <div class="civic-table-wrap">
        <table class="civic-table">
          <caption data-caption></caption>
          <thead><tr><th scope="col">種類</th><th scope="col" class="civic-num">筆數</th><th scope="col" class="civic-num">刻度</th><th scope="col"><span class="civic-sr">橫條</span></th></tr></thead>
          <tbody>${scale.rows.map((row) => `<tr data-row="${escapeHtml(row.id)}"><th scope="row">${escapeHtml(row.label)}</th><td class="civic-num" data-count></td><td class="civic-num" data-share></td><td><span class="civic-meter" data-meter><span></span></span></td></tr>`).join("")}</tbody>
        </table>
      </div>
    </details>
    ${note ? `<p class="civic-note">${note}</p>` : ""}`;
  const chips = [...host.querySelectorAll("[data-kind]")];
  const tableRows = [...host.querySelectorAll("[data-row]")];
  const say = host.querySelector("[data-say]");

  function paintNumbers() {
    scale.rows.forEach((row, index) => {
      chips[index].querySelector("[data-count]").textContent = row.count === null ? "未載入" : formatCount(row.count);
      const cells = tableRows[index];
      cells.querySelector("[data-count]").textContent = row.count === null ? "尚未載入" : formatCount(row.count);
      cells.querySelector("[data-share]").textContent = row.share === null ? "未知" : formatShare(row.share);
      const meter = cells.querySelector("[data-meter]");
      meter.classList.toggle("is-unknown", row.share === null);
      meter.style.setProperty("--p", row.share === null ? "0" : String(row.share * 100));
    });
    host.querySelector("[data-caption]").textContent = scale.max > 0
      ? `與圖同一把尺：${formatCount(scale.max)} 筆是 100%。${scale.complete ? `合計 ${formatCount(scale.total)} 筆。` : `已載入的合計 ${formatCount(scale.total)} 筆，還有種類沒載入。`}`
      : "還沒有可以量的資料。";
  }

  function mark(index) {
    chips.forEach((chip, at) => chip.setAttribute("aria-pressed", at === index ? "true" : "false"));
    tableRows.forEach((row, at) => row.classList.toggle("is-chosen", at === index));
  }

  const gauge = mountGauge(host.querySelector("[data-stage]"), {
    rows: scale.rows,
    fig,
    title,
    hint: "點紙匣，或按左右鍵",
    keys: [
      { mark: "raised", label: "紙匣、後牆刻度與量高規" },
      { mark: "lit", label: "正在量的那一疊" },
      { mark: "dotted", label: "尚未載入" },
    ],
    caption,
    label: "量紙檯。每個紙匣放一種紀錄，紙疊高度按筆數等比例畫。用左右鍵換一疊。",
    tour,
    onShow: (_row, index) => mark(index),
    onChoose: (row) => {
      say.textContent = row.share === null
        ? `${row.label}，尚未載入。`
        : `${row.label}，${formatCount(row.count)} 筆，是最高那一疊的 ${formatShare(row.share)}。`;
      onChoose?.(row);
    },
  });
  chips.forEach((chip, index) => chip.addEventListener("click", () => gauge.choose(index)));
  paintNumbers();
  mark(gauge.target());

  return {
    rows: () => scale.rows,
    chosen: () => scale.rows[gauge.target()],
    choose: (id, options) => {
      const index = scale.rows.findIndex((row) => row.id === id);
      if (index >= 0) gauge.choose(index, options);
    },
    /** Same trays, new counts. Pass `max` to keep or move the scale. */
    setCounts(nextCounts, options = {}) {
      scale = scaleOf(kinds.map((kind) => ({ ...kind, count: nextCounts[kind.id] ?? null })), { max: options.max ?? max });
      paintNumbers();
      gauge.update(scale.rows);
    },
    destroy: () => gauge.destroy(),
  };
}

/** Tray order: tallest at the far end, so a short stack is never hidden. Fixed
 *  from the published snapshot, so filtering does not shuffle the trays. */
export function kindsOf(summary) {
  return Object.entries(summary.labels)
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => (summary.open.counts[b.id] - summary.open.counts[a.id]) || a.id.localeCompare(b.id));
}
