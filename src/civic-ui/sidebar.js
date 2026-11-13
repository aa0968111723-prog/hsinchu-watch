/** The panel that sits beside a map (line 3's atlas). It lists what can be put
 *  on the map and, apart from it, what cannot yet: an item with no sourced
 *  coordinates goes to "to locate" and is never given a made-up position.
 *
 *  Contract with the map:
 *    host "civic:place-select" → detail { id, item, located }   (reader picked an item)
 *    api.select(id)            ← the map picked a feature
 *    api.setItems(items)       ← new data; items follow CONTRACTS.md Geography
 */
import { PRECISION, escapeHtml, formatCount, safeHref, splitByLocation, dateLabel } from "./model.mjs";

export function mountSidebar(host, { items, registry, detailHref = (item) => `#dossier-${item.id}` }) {
  const state = { region: "", topic: "", selected: "" };
  let all = items;
  const chips = (name, legend, list) => `<fieldset><legend>${legend}</legend><div class="civic-chips" data-facet="${name}">
    <button type="button" class="civic-chip" data-value="" aria-pressed="true"><span>全部</span><b></b></button>
    ${list.map((entry) => `<button type="button" class="civic-chip" data-value="${escapeHtml(entry.id)}" aria-pressed="false"><span>${escapeHtml(entry.name)}</span><b></b></button>`).join("")}
  </div></fieldset>`;
  host.classList.add("civic-side");
  host.innerHTML = `
    <form class="civic-filters" data-filters>
      ${chips("region", "地區", registry.regions || [])}
      ${chips("topic", "議題", registry.topics || [])}
    </form>
    <p class="civic-meta" role="status" aria-live="polite" data-count></p>
    <div class="civic-side-group"><h4>可以標在地圖上</h4><ul class="civic-places" data-located></ul></div>
    <div class="civic-side-group"><h4>待定位（還沒有座標來源）</h4><ul class="civic-places" data-pending></ul></div>
    <div class="civic-sheet" data-detail hidden></div>`;
  const $ = (name) => host.querySelector(`[data-${name}]`);
  const match = (item, skip) => (skip === "region" || !state.region || item.region_id === state.region)
    && (skip === "topic" || !state.topic || item.topic_id === state.topic);
  const nameOf = (list, id) => (list || []).find((entry) => entry.id === id)?.name || "未標示";

  function place(item) {
    return `<li><button type="button" class="civic-place" data-place="${escapeHtml(item.id)}" aria-pressed="${state.selected === item.id}">
      <b>${escapeHtml(item.title)}</b>
      <small>${escapeHtml(nameOf(registry.regions, item.region_id))}・${escapeHtml(item.status || "階段未標示")}・定位：${escapeHtml(PRECISION[item.location_precision] || PRECISION.unknown)}</small>
    </button></li>`;
  }

  function paintDetail() {
    const item = all.find((entry) => entry.id === state.selected);
    const box = $("detail");
    box.hidden = !item;
    if (!item) return;
    const { located } = splitByLocation([item]);
    const source = item.coordinate_source;
    const href = safeHref(source?.url);
    box.innerHTML = `<h4 class="civic-h3" tabindex="-1">${escapeHtml(item.title)}</h4>
      <p class="civic-meta">${escapeHtml(nameOf(registry.regions, item.region_id))}・${escapeHtml(nameOf(registry.topics, item.topic_id))}・${escapeHtml(item.status || "階段未標示")}</p>
      ${located.length
        ? `<p>定位精度：${escapeHtml(PRECISION[item.location_precision] || PRECISION.unknown)}。</p>
           <p class="civic-source">座標來源：${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.basis || "來源")}</a>` : "網址無效"}・查閱日 ${dateLabel(source?.checked_at)}</p>`
        : `<p>這件案卷不在地圖上，因為還沒有座標來源。</p>
           <p class="civic-note">要標上去，需要座標、來源網址、查閱日期和判斷依據。本站不用縣市中心代替實際位置。</p>`}
      <p><a class="civic-btn" href="${escapeHtml(detailHref(item))}">看這件案卷</a></p>`;
  }

  function paint() {
    for (const name of ["region", "topic"]) {
      const key = name === "region" ? "region_id" : "topic_id";
      const others = all.filter((item) => match(item, name));
      for (const chip of host.querySelectorAll(`[data-facet="${name}"] .civic-chip`)) {
        const value = chip.dataset.value;
        chip.setAttribute("aria-pressed", state[name] === value ? "true" : "false");
        chip.querySelector("b").textContent = formatCount(value ? others.filter((item) => item[key] === value).length : others.length);
      }
    }
    const shown = all.filter((item) => match(item));
    const { located, pending } = splitByLocation(shown);
    $("located").innerHTML = located.length ? located.map(place).join("") : `<li class="civic-meta">目前沒有。有座標來源的案卷才會列在這裡。</li>`;
    $("pending").innerHTML = pending.length ? pending.map(place).join("") : `<li class="civic-meta">這個條件下沒有待定位的案卷。</li>`;
    $("count").textContent = `${formatCount(shown.length)} 件：可標示 ${formatCount(located.length)} 件，待定位 ${formatCount(pending.length)} 件。`;
    if (state.selected && !shown.some((item) => item.id === state.selected)) state.selected = "";
    paintDetail();
  }

  function select(id, { announce = true, focus = false } = {}) {
    const item = all.find((entry) => entry.id === id);
    state.selected = item ? (state.selected === id && announce ? "" : id) : "";
    paint();
    if (focus) (host.querySelector(`[data-place="${CSS.escape(id)}"]`) || host).focus();
    if (announce) {
      const picked = all.find((entry) => entry.id === state.selected) || null;
      host.dispatchEvent(new CustomEvent("civic:place-select", {
        bubbles: true,
        detail: { id: picked?.id ?? null, item: picked, located: picked ? splitByLocation([picked]).located.length === 1 : false },
      }));
    }
  }

  host.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-facet] .civic-chip");
    if (chip) {
      state[chip.closest("[data-facet]").dataset.facet] = chip.dataset.value;
      paint();
      return;
    }
    const button = event.target.closest("[data-place]");
    if (button) select(button.dataset.place, { focus: true });
  });
  $("filters").addEventListener("submit", (event) => event.preventDefault());
  paint();
  return {
    select: (id) => select(id, { announce: false }),
    setItems(next) { all = next; paint(); },
    state,
  };
}
