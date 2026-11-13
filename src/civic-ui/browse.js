/** Browse the whole archive from the bench: load every file, filter by person,
 *  words and status, and read the chosen kind row by row. The bench re-measures
 *  on the full archive's scale, so a filter makes the stacks shrink.
 *
 *  A file that fails to load stays on screen as a gap: its kind is drawn as
 *  "not loaded", never as an empty tray, and the total says it is partial.
 */
import { ARCHIVE_FILES, buildArchive, buildPeople, filterArchive } from "../lib/archive-model.js";
import { isPollBlackout } from "../lib/data.js";
import { ARCHIVE_SUMMARY } from "./archive-summary.mjs";
import { kindsOf, mountDesk } from "./desk.js";
import { escapeHtml, formatCount, originOf, safeHref } from "./model.mjs";

const PAGE = 20;
const STATUS = { archive: "封存參考・不計統計", pending: "待核對・排除分析", recorded: "既有紀錄・非查核認證" };
/** Which input file feeds which kind. A failed file makes its kind unknown. */
const FEEDS = {
  monitor: ["monitor", "monitorHistory", "monitorLatest"], news: ["items"], policy: ["policies"], poll: ["polls"],
  comment: ["comments"], source: ["sources"], official: ["official"], stance: ["stances"], governance: ["governance", "governanceRegistry"],
};

export function mountBrowse(host, { fig = "圖 2" } = {}) {
  const kinds = kindsOf(ARCHIVE_SUMMARY);
  const docs = {};
  const failures = new Map();
  const state = { person: "", query: "", status: "", page: 1 };
  let rows = [];
  let people = {};
  let matching = [];
  let desk = null;
  let blackout = isPollBlackout();
  let fullMax = 0;

  host.innerHTML = `
    <div class="civic-sheet" data-loadbox>
      <p>完整資料上次統計是 ${formatCount(ARCHIVE_SUMMARY.open.total)} 筆，全部載入約 12 MB。載入後可以篩選，並逐筆翻閱。</p>
      <p><button type="button" class="civic-btn civic-btn--primary" data-load>載入完整資料</button></p>
      <p class="civic-meta" role="status" aria-live="polite" data-progress></p>
      <div class="civic-gapnote" role="alert" data-gaps hidden></div>
    </div>
    <div class="civic-stack" data-work hidden>
      <div data-desk></div>
      <form class="civic-filters" data-filters>
        <label class="civic-field">人物<select class="civic-select" data-person><option value="">全部人物與治理案卷</option></select></label>
        <label class="civic-field">資料狀態<select class="civic-select" data-status>
          <option value="">全部狀態</option>${Object.entries(STATUS).map(([id, text]) => `<option value="${id}">${text}</option>`).join("")}
        </select></label>
        <label class="civic-field">搜尋標題、摘要或來源<input class="civic-input" type="search" data-query autocomplete="off" placeholder="輸入人物、政策或關鍵字"></label>
        <div class="civic-chips"><button type="button" class="civic-btn civic-btn--quiet" data-reset>清除篩選</button></div>
      </form>
      <div class="civic-toolbar">
        <p role="status" aria-live="polite" data-result></p>
        <a class="civic-btn" data-archive-link href="/archive.html">到完整資料頁匯出</a>
      </div>
      <ol class="civic-list" data-rows></ol>
      <nav class="civic-pager" aria-label="分頁">
        <button type="button" class="civic-btn" data-prev>上一頁</button>
        <span data-page></span>
        <button type="button" class="civic-btn" data-next>下一頁</button>
      </nav>
    </div>`;
  const $ = (name) => host.querySelector(`[data-${name}]`);

  async function loadFiles() {
    const button = $("load");
    button.disabled = true;
    blackout = isPollBlackout();
    const get = async (path) => {
      const response = await fetch(path, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };
    // The snapshot directory says which optional monitor file exists, as archive.html does.
    let listed = {};
    try {
      listed = (await get("/data/manifest.json")).files || {};
      failures.delete("manifest");
    } catch (error) {
      failures.set("manifest", `/data/manifest.json（${error.message}）`);
    }
    const history = Boolean(listed["news-monitor/history.json"]);
    const wanted = Object.entries(ARCHIVE_FILES).filter(([id]) => !docs[id]
      && !(id === "polls" && blackout)
      && !(id === "monitorHistory" && !history)
      && !(id === "monitorLatest" && (history || !listed["news-monitor/latest.json"])));
    let done = 0;
    $("progress").textContent = `讀取中：0 / ${wanted.length} 個檔案。`;
    await Promise.all(wanted.map(async ([id, path]) => {
      try {
        docs[id] = await get(path);
        failures.delete(id);
      } catch (error) {
        failures.set(id, `${path}（${error.message}）`);
      }
      done += 1;
      $("progress").textContent = `讀取中：${done} / ${wanted.length} 個檔案。`;
    }));
    const archive = buildArchive(docs, { blackout });
    rows = archive.rows;
    people = buildPeople(docs);
    const notes = [...failures.values()].map((text) => `沒有載入：${text}`);
    if (blackout) notes.push(`封關期間不載入民調檔，另有 ${formatCount(archive.held)} 筆民調相關紀錄暫不顯示。`);
    $("gaps").hidden = notes.length === 0;
    $("gaps").innerHTML = notes.length
      ? `${notes.map(escapeHtml).join("<br>")}${failures.size ? `<br>下面的筆數只算已載入的檔案，不是完整資料。` : ""}`
      : "";
    $("progress").textContent = failures.size
      ? `部分載入：${formatCount(rows.length)} 筆，還有 ${failures.size} 個檔案沒有載入。`
      : `已載入 ${formatCount(rows.length)} 筆紀錄。`;
    button.disabled = false;
    button.textContent = failures.size ? "重試沒有載入的檔案" : "重新載入";
    button.hidden = failures.size === 0;
    $("work").hidden = false;
    fillPeople();
    render({ rescale: true });
  }

  function fillPeople() {
    const select = $("person");
    const keep = select.value;
    const known = new Set((docs.candidates?.candidates || []).map((person) => person.id));
    select.replaceChildren(new Option("全部人物與治理案卷", ""));
    for (const [label, list] of [
      ["本屆正式名單（目前兩選區）", Object.values(people).filter((person) => known.has(person.id))],
      ["其他人物與歷史資料", Object.values(people).filter((person) => !known.has(person.id))],
    ]) {
      if (!list.length) continue;
      const group = document.createElement("optgroup");
      group.label = label;
      for (const person of list) group.append(new Option(person.name, person.id));
      select.append(group);
    }
    if ([...select.options].some((option) => option.value === keep)) select.value = keep;
  }

  const unknownKinds = () => new Set(Object.entries(FEEDS)
    .filter(([, feeds]) => feeds.some((feed) => failures.has(feed)))
    .map(([kind]) => kind));

  function tally(list) {
    const missing = unknownKinds();
    const counts = Object.fromEntries(kinds.map((kind) => [kind.id, missing.has(kind.id) ? null : 0]));
    for (const row of list) if (counts[row.kind] !== null) counts[row.kind] += 1;
    return counts;
  }

  function rowHtml(row) {
    const origin = originOf(row.kind, row.record);
    const names = row.people.map((id) => people[id]?.name || id).join("、") || "未連結人物";
    const href = safeHref(row.url);
    return `<li>
      <div class="civic-tags"><span class="civic-tag civic-tone-${origin.tone}">${escapeHtml(origin.label)}</span><span class="civic-tag">${STATUS[row.status]}</span></div>
      <p class="civic-row-title">${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.title)}</a>` : escapeHtml(row.title)}</p>
      <p class="civic-meta">${escapeHtml(names)}・${escapeHtml(row.date_basis)} ${escapeHtml(row.date || "未標示")}・${escapeHtml(row.source || "來源未標示")}</p>
      ${row.summary && row.summary !== row.title ? `<p class="civic-row-text">${escapeHtml(row.summary)}</p>` : ""}
      ${href ? "" : `<p class="civic-meta">這筆沒有可用的原文連結，保留為資料缺口。</p>`}
    </li>`;
  }

  function render({ rescale = false, focus = false } = {}) {
    matching = filterArchive(rows, state, people);
    const counts = tally(matching);
    if (rescale) fullMax = Math.max(0, ...Object.values(tally(rows)).filter((value) => value !== null));
    if (!desk) {
      desk = mountDesk($("desk"), {
        kinds,
        counts,
        max: fullMax,
        fig,
        title: "符合條件的筆數",
        tour: false,
        caption: "這張圖量的是目前篩選後的筆數，用的仍是全部資料的那把尺，所以條件越窄紙疊越矮。虛線框是沒有載入的檔案，不是零。",
        onChoose: () => { state.page = 1; paintList({ focus: true }); },
      });
    } else {
      desk.setCounts(counts, { max: fullMax });
    }
    paintList({ focus });
  }

  function paintList({ focus = false } = {}) {
    const chosen = desk.chosen();
    const list = matching.filter((row) => row.kind === chosen.id);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * PAGE;
    const shown = list.slice(start, start + PAGE);
    $("rows").innerHTML = chosen.count === null
      ? `<li><p class="civic-gapnote">「${escapeHtml(chosen.label)}」的檔案沒有載入，這裡無法列出。這是讀取缺口，不代表沒有紀錄。</p></li>`
      : shown.length ? shown.map(rowHtml).join("") : `<li><p class="civic-meta">這個條件下，「${escapeHtml(chosen.label)}」沒有符合的紀錄。</p></li>`;
    $("rows").setAttribute("start", String(start + 1));
    $("result").textContent = chosen.count === null
      ? `「${chosen.label}」尚未載入。`
      : `「${chosen.label}」符合 ${formatCount(list.length)} 筆${shown.length ? `，顯示第 ${start + 1}–${start + shown.length} 筆` : ""}；全部種類符合 ${formatCount(matching.length)} 筆${failures.size ? "（部分載入）" : ""}。`;
    $("page").textContent = `第 ${list.length ? state.page : 0} / ${list.length ? pages : 0} 頁`;
    $("prev").disabled = state.page <= 1;
    $("next").disabled = state.page >= pages;
    const params = new URLSearchParams({ kind: chosen.id });
    for (const key of ["person", "query", "status"]) if (state[key]) params.set(key, state[key]);
    $("archive-link").href = `/archive.html?${params}`;
    if (focus) $("rows").querySelector("a, p")?.scrollIntoView({ block: "nearest" });
  }

  $("load").addEventListener("click", () => { void loadFiles(); });
  let timer = 0;
  host.addEventListener("input", (event) => {
    if (event.target.matches("[data-query]")) {
      clearTimeout(timer);
      timer = setTimeout(() => { state.query = event.target.value; state.page = 1; render(); }, 180);
    }
  });
  host.addEventListener("change", (event) => {
    if (event.target.matches("[data-person]")) state.person = event.target.value;
    else if (event.target.matches("[data-status]")) state.status = event.target.value;
    else return;
    state.page = 1;
    render();
  });
  host.addEventListener("click", (event) => {
    if (event.target.closest("[data-reset]")) {
      Object.assign(state, { person: "", query: "", status: "", page: 1 });
      $("person").value = "";
      $("status").value = "";
      $("query").value = "";
      render();
    } else if (event.target.closest("[data-prev]")) {
      state.page -= 1;
      paintList({ focus: true });
    } else if (event.target.closest("[data-next]")) {
      state.page += 1;
      paintList({ focus: true });
    }
  });
  $("filters").addEventListener("submit", (event) => event.preventDefault());
  return { load: loadFiles, state, failures };
}
