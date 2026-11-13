/** Governance dossiers: filter by region and topic, save, open the sources and
 *  the timeline, and put up to three side by side. Every figure is what the
 *  source gave; a missing one is said in words and drawn as unknown, not zero.
 */
import {
  budgetReadout, compareRows, createStore, dateKey, dateLabel, escapeHtml, eventLabel,
  filterProjects, formatCount, formatTwd, formatTwdShort, progressReadout, safeHref,
} from "./model.mjs";

const MAX_COMPARE = 3;
const monthOnly = (value) => (/^\d{4}-\d{2}$/.test(String(value || "")) ? "month" : "day");

function sourceLine(source) {
  if (!source) return `<p class="civic-source">這筆紀錄沒有連到來源目錄，保留為資料缺口。</p>`;
  const href = safeHref(source.url);
  const name = href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a>`
    : `${escapeHtml(source.name)}（網址無效）`;
  return `<p class="civic-source">${name}・${escapeHtml(source.agency || "機關未標示")}<br>來源更新日 ${dateLabel(source.source_updated_at)}・本站查閱日 ${dateLabel(source.checked_at)}</p>`;
}

function progressBlock(project) {
  const reading = progressReadout(project.progress);
  if (!reading.known) {
    return `<span class="civic-meter civic-meter--tall is-unknown" role="img" aria-label="${escapeHtml(reading.text)}"></span>
      <p><strong>尚未收錄</strong></p><p class="civic-note">${escapeHtml(reading.note)}不以流程階段推算百分比。</p>`;
  }
  return `<span class="civic-meter civic-meter--tall civic-tone-clay" role="img" aria-label="${escapeHtml(reading.text)}"><span style="--p:${reading.value}"></span></span>
    <div class="civic-scale" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
    <p><strong>${escapeHtml(reading.text.replace("工程進度 ", ""))}</strong>・數字基準日 ${dateLabel(reading.asOf)}</p>
    ${reading.note ? `<p class="civic-note">${escapeHtml(reading.note)}</p>` : ""}`;
}

function budgetBlock(project) {
  const reading = budgetReadout(project.budget);
  if (!reading.known) return `<p><strong>尚未收錄</strong></p><p class="civic-note">沒有經費資料，不推估支出。</p>`;
  return `<ul class="civic-budget">${reading.lines.map((line) => `<li>
      <span>${line.label}</span>
      ${line.share === null
        ? `<span class="civic-meter is-unknown" role="img" aria-label="${line.label}尚未收錄"></span><small>尚未收錄</small>`
        : `<span class="civic-meter civic-tone-sky" role="img" aria-label="${line.label} ${formatTwd(line.value)}"><span style="--p:${line.share * 100}"></span></span><small>${formatTwdShort(line.value)}（${formatTwd(line.value)}）</small>`}
    </li>`).join("")}</ul>
    <p class="civic-note">三條橫條共用同一把尺，最長的是 ${formatTwdShort(reading.max)}。</p>`;
}

function card(project, registry, sources, { saved, comparing, compareFull }) {
  const region = registry.regions.find((item) => item.id === project.region_id)?.name || "地區未標示";
  const topic = registry.topics.find((item) => item.id === project.topic_id)?.name || "議題未標示";
  const events = [...(project.events || [])].sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)));
  const missing = project.missing_evidence || [];
  return `<article class="civic-sheet civic-dossier" id="dossier-${escapeHtml(project.id)}" data-id="${escapeHtml(project.id)}">
    <div class="civic-dossier-head"><div>
      <ul class="civic-tags"><li class="civic-tag civic-tone-sky">${escapeHtml(region)}</li><li class="civic-tag civic-tone-wheat">${escapeHtml(topic)}</li></ul>
      <h3 class="civic-h3">${escapeHtml(project.title)}</h3>
      <p class="civic-meta">${escapeHtml(project.agency || "機關未標示")}</p>
    </div></div>
    <p class="civic-dossier-summary">${escapeHtml(project.summary || "")}</p>
    <dl class="civic-facts">
      <div><dt>目前階段</dt><dd><strong>${escapeHtml(project.phase_label || "未標示")}</strong>・階段紀錄日期 ${dateLabel(project.phase_as_of, monthOnly(project.phase_as_of))}</dd></div>
      <div><dt>工程進度（機關公布）</dt><dd>${progressBlock(project)}</dd></div>
      <div><dt>來源所列目標</dt><dd>${project.target ? `${escapeHtml(project.target.label)}<p class="civic-note">這是來源列的期程，還沒有實際完工資料可以對照。</p>` : "<strong>尚未收錄</strong>"}</dd></div>
      <div><dt>經費（新台幣）</dt><dd>${budgetBlock(project)}</dd></div>
    </dl>
    <details class="civic-fold"><summary>事件與來源・${events.length} 筆</summary>
      <ol class="civic-timeline">${events.map((event) => `<li data-precision="${escapeHtml(event.precision || "day")}">
        <time datetime="${escapeHtml(event.date)}">${dateLabel(event.date, event.precision)}${event.precision === "month" ? "（來源只標到月份）" : ""}</time>
        <div class="civic-tags"><span class="civic-tag civic-tone-sky">${escapeHtml(eventLabel(event.kind))}</span></div>
        <p>${escapeHtml(event.summary)}</p>${sourceLine(sources.get(event.source_id))}</li>`).join("")}</ol>
    </details>
    <details class="civic-fold"><summary>待補證據・${missing.length} 項</summary>
      ${missing.length ? `<ul class="civic-missing">${missing.map((text) => `<li>${escapeHtml(text)}</li>`).join("")}</ul>` : `<p class="civic-meta">目前沒有列出待補項目。</p>`}
    </details>
    <div class="civic-dossier-actions">
      <button type="button" class="civic-btn" data-save aria-pressed="${saved}" aria-label="收藏${escapeHtml(project.title)}">${saved ? "已收藏" : "收藏"}</button>
      <button type="button" class="civic-btn" data-compare-toggle aria-pressed="${comparing}" aria-label="把${escapeHtml(project.title)}加入比較"${!comparing && compareFull ? " disabled" : ""}>${comparing ? "比較中" : "加入比較"}</button>
    </div>
  </article>`;
}

export function mountDossiers(host, { data, registry, store = createStore("governance-watch-v1") }) {
  const projects = data.projects || [];
  const sources = new Map((registry.sources || []).map((source) => [source.id, source]));
  const state = { region: "", topic: "", query: "", savedOnly: false, compare: [] };
  const facet = (name, legend, list) => `<fieldset><legend>${legend}</legend><div class="civic-chips" data-facet="${name}">
    <button type="button" class="civic-chip" data-value="" aria-pressed="true"><span>全部</span><b></b></button>
    ${list.map((entry) => `<button type="button" class="civic-chip" data-value="${escapeHtml(entry.id)}" aria-pressed="false"><span>${escapeHtml(entry.name)}</span><b></b></button>`).join("")}
  </div></fieldset>`;

  host.innerHTML = `
    <form class="civic-filters" data-filters>
      ${facet("region", "地區", registry.regions || [])}
      ${facet("topic", "議題", registry.topics || [])}
      <label class="civic-field">找案卷、機關或階段<input class="civic-input" type="search" data-query autocomplete="off" placeholder="例如：住宅、道路、驗收"></label>
      <div class="civic-chips">
        <button type="button" class="civic-chip" data-saved-only aria-pressed="false"><span>只看收藏</span><b></b></button>
        <button type="button" class="civic-btn civic-btn--quiet" data-reset>清除篩選</button>
      </div>
    </form>
    <div class="civic-toolbar">
      <p role="status" aria-live="polite" data-count></p>
      <a class="civic-btn" href="#dossier-compare" data-compare-jump hidden></a>
    </div>
    <p class="civic-note">${escapeHtml(registry.scope_note || "")} 本站查閱日 ${dateLabel(registry.reviewed_at)}。收藏只存在這個瀏覽器。</p>
    <div class="civic-dossiers" data-cards></div>
    <section class="civic-sheet civic-compare" id="dossier-compare" data-compare hidden>
      <h3 class="civic-h3" tabindex="-1">並排比較</h3>
      <p class="civic-note">同一列是同一個問題。「尚未收錄」是資料缺口，不能當成零或落後。</p>
      <div class="civic-table-wrap" tabindex="0" role="region" aria-label="案卷比較表，可左右捲動"><table class="civic-table" data-compare-table></table></div>
      <p><button type="button" class="civic-btn civic-btn--quiet" data-compare-clear>清除比較</button></p>
    </section>`;
  const ref = {
    cards: host.querySelector("[data-cards]"),
    count: host.querySelector("[data-count]"),
    query: host.querySelector("[data-query]"),
    savedOnly: host.querySelector("[data-saved-only]"),
    jump: host.querySelector("[data-compare-jump]"),
    compare: host.querySelector("[data-compare]"),
    table: host.querySelector("[data-compare-table]"),
  };
  const visible = () => filterProjects(projects, { ...state, saved: store.all() });

  function paintFacets() {
    const saved = store.all();
    for (const name of ["region", "topic"]) {
      const key = name === "region" ? "region_id" : "topic_id";
      const others = filterProjects(projects, { ...state, [name]: "", saved });
      for (const chip of host.querySelectorAll(`[data-facet="${name}"] .civic-chip`)) {
        const value = chip.dataset.value;
        chip.setAttribute("aria-pressed", state[name] === value ? "true" : "false");
        chip.querySelector("b").textContent = formatCount(value ? others.filter((project) => project[key] === value).length : others.length);
      }
    }
    ref.savedOnly.setAttribute("aria-pressed", state.savedOnly ? "true" : "false");
    ref.savedOnly.querySelector("b").textContent = formatCount(projects.filter((project) => saved.includes(project.id)).length);
  }

  function paintCompare() {
    const chosen = state.compare.map((id) => projects.find((project) => project.id === id)).filter(Boolean);
    ref.compare.hidden = chosen.length === 0;
    ref.jump.hidden = chosen.length === 0;
    ref.jump.textContent = `看比較表（${chosen.length} 件）`;
    if (!chosen.length) return;
    ref.table.innerHTML = `<thead><tr><th scope="col"><span class="civic-sr">項目</span></th>${chosen.map((project) => `<th scope="col">${escapeHtml(project.title)}</th>`).join("")}</tr></thead>
      <tbody>${compareRows(chosen, registry).map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th>${row.cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  }

  // A re-render must not fold away what the reader opened.
  const foldKey = (fold) => `${fold.closest("[data-id]").dataset.id}:${[...fold.parentElement.querySelectorAll(":scope > details")].indexOf(fold)}`;

  function paintCards() {
    const saved = store.all();
    const list = visible();
    const open = new Set([...ref.cards.querySelectorAll("details[open]")].map(foldKey));
    ref.cards.innerHTML = list.length
      ? list.map((project) => card(project, registry, sources, {
        saved: saved.includes(project.id),
        comparing: state.compare.includes(project.id),
        compareFull: state.compare.length >= MAX_COMPARE,
      })).join("")
      : `<p class="civic-sheet">沒有符合的案卷。可以清除篩選，或取消「只看收藏」。</p>`;
    for (const fold of ref.cards.querySelectorAll("details")) fold.open = open.has(foldKey(fold));
    ref.count.textContent = `顯示 ${formatCount(list.length)} 件，共 ${formatCount(projects.length)} 件案卷。`;
  }

  function paint() {
    paintFacets();
    paintCards();
    paintCompare();
  }

  host.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-facet] .civic-chip");
    if (chip) {
      state[chip.closest("[data-facet]").dataset.facet] = chip.dataset.value;
      paint();
      return;
    }
    if (event.target.closest("[data-saved-only]")) {
      state.savedOnly = !state.savedOnly;
      paint();
      return;
    }
    if (event.target.closest("[data-reset]")) {
      Object.assign(state, { region: "", topic: "", query: "", savedOnly: false });
      ref.query.value = "";
      paint();
      return;
    }
    if (event.target.closest("[data-compare-clear]")) {
      state.compare = [];
      paint();
      ref.count.textContent = "已清除比較。";
      ref.cards.querySelector("[data-compare-toggle]")?.focus();
      return;
    }
    const article = event.target.closest("[data-id]");
    if (!article) return;
    const id = article.dataset.id;
    const refocus = (selector) => (ref.cards.querySelector(`[data-id="${CSS.escape(id)}"] ${selector}`) || ref.savedOnly).focus();
    if (event.target.closest("[data-save]")) {
      store.toggle(id);
      paint();
      refocus("[data-save]");
    } else if (event.target.closest("[data-compare-toggle]")) {
      state.compare = state.compare.includes(id)
        ? state.compare.filter((item) => item !== id)
        : [...state.compare, id].slice(0, MAX_COMPARE);
      paint();
      ref.count.textContent = state.compare.length ? `比較表裡有 ${state.compare.length} 件，最多 ${MAX_COMPARE} 件。` : "比較表已清空。";
      refocus("[data-compare-toggle]");
    }
  });
  ref.jump.addEventListener("click", () => setTimeout(() => ref.compare.querySelector("h3").focus({ preventScroll: true }), 0));
  let timer = 0;
  ref.query.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = ref.query.value; paint(); }, 140);
  });
  host.querySelector("[data-filters]").addEventListener("submit", (event) => event.preventDefault());
  paint();
  return { state, visible };
}
