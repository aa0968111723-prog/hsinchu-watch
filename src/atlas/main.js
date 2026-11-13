// 政策與工程地圖：把資料模型、場景、互動層與介面片段接起來。
import '../lib/mobile-nav.js';
import { CAMERA } from './camera.js';
import { EMPTY_FILTERS, PRECISION_LABEL, artForProject, artForRegion, budgetScaleMax, buildModel, exportRows, filterProjects, formatDate, loadLayers, stageCounts, toCsv } from './model.js';
import { buildRegionScene, formatDistance } from './scene.js';
import { WATCH_KEY, createFavorites, parseState, serializeState } from './state.js';
import { coordinateSourcesHtml, detailEmptyHtml, detailHtml, esc, gapsHtml, listHtml, pendingHtml, regionArtHtml, stageBar, timelineHtml } from './ui.js';
import { createMapView } from './view.js';

const $ = (id) => document.getElementById(id);
const root = $('atlasApp');
const canvas = $('atlasCanvas');
const detail = $('atlasDetail');
const desktop = () => matchMedia('(min-width: 960px)').matches;
const debounce = (fn, ms) => { let timer = 0; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; };

const app = {
  layers: null,
  model: null,
  favorites: createFavorites(),
  state: parseState(location.hash),
  map: null,
  scenes: new Map(),
  scaleMax: null,
  returnFocus: null,
  hover: null,
};

const projectById = (id) => app.model?.projects.find((project) => project.id === id) ?? null;
const visibleProjects = () => filterProjects(app.model.projects, app.state.filters, app.favorites);
const regionName = (id) => app.model.regions.find((region) => region.id === id)?.name ?? id;
const geoData = () => Object.fromEntries(['regions', 'districts', 'scope', 'neighbors', 'land'].map((id) => [id, app.layers[id]?.data ?? null]));

// ---- 啟動 ----

async function boot() {
  root.dataset.state = 'loading';
  $('atlasStatus').textContent = '讀取資料中';
  app.layers = await loadLayers();
  app.model = buildModel(app.layers);
  renderGaps();
  if (!app.model.ok) { renderFatal(); return; }
  app.scaleMax = budgetScaleMax(app.model.projects);
  normalizeState();
  fillFilters();
  if (!app.map) app.map = createMapView(canvas, mapHandlers);
  root.dataset.state = app.model.gaps.length ? 'partial' : 'ready';
  renderAll();
  const { center, zoom } = app.state;
  if (center && zoom) app.map.restore(center, zoom);
  if (app.state.project) openSheet('half');
}

function normalizeState() {
  const { state, model } = app;
  if (state.project && !projectById(state.project)) state.project = null;
  if (state.filters.region && !model.regions.some((region) => region.id === state.filters.region)) state.filters.region = '';
  if (state.filters.topic && !model.topics.some((topic) => topic.id === state.filters.topic)) state.filters.topic = '';
  if (state.scene.startsWith('region:') && !model.regions.some((region) => region.id === state.scene.slice(7))) state.scene = 'overview';
  if (state.scene.startsWith('site:')) state.scene = 'overview';
  // 看某個地區就是只看那個地區的案卷：場景與地區篩選永遠一致。
  if (state.scene.startsWith('region:')) state.filters.region = state.scene.slice(7);
  else if (state.filters.region) state.scene = `region:${state.filters.region}`;
}

function renderFatal() {
  root.dataset.state = 'failed';
  $('atlasStatus').textContent = '資料載入失敗';
  app.map?.destroy();
  app.map = null;
  $('atlasCoverage').textContent = '資料載入失敗，沒有顯示案卷內容。';
  canvas.innerHTML = '<figure class="atl-fallback"><img src="/img/atlas/overview-plan.svg" alt="台北、新北、新竹縣市政策與工程地圖的靜態總覽圖"><figcaption>案卷讀不到，這裡改放預先產生的靜態總覽圖，不能操作。圖釘是圖內所標查核日當時的位置，可能不是最新。</figcaption></figure>';
  const message = '<p class="atl-empty" role="alert">案卷暫時無法載入，所以沒有列表、來源卡與進度。可以按上方「重新讀取」，或直接查閱官方來源：<a href="https://heo.gov.taipei/cp.aspx?n=DEDCC5E8E17CD3FB" target="_blank" rel="noopener noreferrer">臺北市水利工程處</a>、<a href="https://www.publicwork.ntpc.gov.tw/home.jsp?id=512cdd6f20d79814" target="_blank" rel="noopener noreferrer">新北市工務局在建工程</a>、<a href="https://www.hsinchu.gov.tw/" target="_blank" rel="noopener noreferrer">新竹縣政府</a>、<a href="https://land.hccg.gov.tw/" target="_blank" rel="noopener noreferrer">新竹市地政處</a>。</p>';
  $('atlasList').innerHTML = `<li>${message}</li>`;
  detail.querySelector('[data-detail-body]').innerHTML = message;
  $('atlasTimelineBody').innerHTML = '<p class="atl-note">資料載入失敗，沒有時間軸。</p>';
  $('atlasPendingBody').innerHTML = '<p class="atl-note">資料載入失敗，無法列出待定位清單。</p>';
  $('atlasCount').textContent = '';
}

// ---- 繪製 ----

function renderGaps() {
  const box = $('atlasGaps');
  const html = gapsHtml(app.model);
  box.hidden = !html;
  box.innerHTML = html;
}

function fillFilters() {
  const fill = (id, items, all) => {
    const select = $(id);
    select.textContent = '';
    select.add(new Option(all, ''));
    for (const item of items) select.add(new Option(item.name, item.id));
  };
  fill('atlasRegion', app.model.regions, '全部地區');
  fill('atlasTopic', app.model.topics, '全部議題');
  syncFilterInputs();
  // 手機先看到地圖：沒有套用篩選時，篩選表單預設收合。
  const { filters } = app.state;
  if (!desktop() && !app.filterBoxSet) $('atlasFilterBox').open = Boolean(filters.topic || filters.query || filters.favorites);
  app.filterBoxSet = true;
  $('atlasCoordSources').innerHTML = coordinateSourcesHtml(app.model);
}

function syncFilterInputs() {
  const { filters } = app.state;
  $('atlasRegion').value = filters.region;
  $('atlasTopic').value = filters.topic;
  $('atlasQuery').value = filters.query;
  $('atlasFavOnly').checked = filters.favorites;
}

function renderAll() {
  renderFiltersState();
  renderList();
  renderDetail();
  renderTimeline();
  $('atlasPendingBody').innerHTML = pendingHtml(app.model, app.model.projects);
  renderScene();
  renderStatus();
  syncUrl();
}

function renderStatus() {
  const { projects } = app.model;
  const located = projects.filter((project) => project.locationState === 'located').length;
  const pending = projects.filter((project) => project.locationState === 'pending').length;
  const unavailable = projects.length - located - pending;
  $('atlasStatus').textContent = unavailable ? `位置資料未載入・${projects.length} 案` : `已定位 ${located}・待定位 ${pending}｜位置查核 ${formatDate(app.model.locationsReviewedAt)}`;
  $('atlasCoverage').textContent = `${app.model.locationScopeNote ?? app.model.scopeNote ?? ''}　本站案卷查閱日 ${formatDate(app.model.reviewedAt)}。`;
  $('atlasStorageNote').textContent = app.favorites.persistent ? '收藏只存在這個瀏覽器，和「地方治理」頁的關注清單共用，沒有同步帳號。' : '瀏覽器未允許儲存，收藏只保留到本頁關閉。';
}

function renderFiltersState() {
  const base = filterProjects(app.model.projects, { ...app.state.filters, stage: '' }, app.favorites);
  const stats = stageCounts(base);
  $('atlasStageBar').innerHTML = stageBar(app.model, app.state.filters, { ...stats, total: base.length });
}

function renderList() {
  const rows = visibleProjects();
  $('atlasList').innerHTML = listHtml(app.model, rows, { selectedId: app.state.project, favorites: app.favorites });
  const all = app.model.projects.length;
  $('atlasCount').textContent = `顯示 ${rows.length} / ${all} 案・已收藏 ${app.model.projects.filter((project) => app.favorites.has(project.id)).length} 案`;
  $('atlasExport').disabled = !rows.length;
}

function renderDetail() {
  const body = detail.querySelector('[data-detail-body]');
  const project = projectById(app.state.project);
  if (!project) {
    const counts = { located: app.model.projects.filter((item) => item.locationState === 'located').length, pending: app.model.projects.filter((item) => item.locationState === 'pending').length };
    body.innerHTML = detailEmptyHtml(app.model, counts);
    detail.dataset.empty = '';
    openSheet('closed');
    return;
  }
  delete detail.dataset.empty;
  body.innerHTML = detailHtml(app.model, project, { favorites: app.favorites, scaleMax: app.scaleMax, art: artForProject(app.layers.art?.data, project.id), hasSite: false, sceneKind: app.map?.scene?.kind });
  body.scrollTop = 0;
}

function renderTimeline() {
  $('atlasTimelineBody').innerHTML = timelineHtml(app.model, visibleProjects(), app.state.project);
}

// ---- 場景 ----

function sceneFor(id, mode) {
  const stage = app.map.stage();
  const key = `${id}|${mode}|${stage.width}x${stage.height}`;
  if (!app.scenes.has(key)) {
    if (app.scenes.size > 5) app.scenes.delete(app.scenes.keys().next().value);
    app.scenes.set(key, buildRegionScene({ data: geoData(), sceneId: id, mode, stage, projects: app.model.projects }));
  }
  return app.scenes.get(key);
}

function renderScene({ keep = false } = {}) {
  const before = keep ? app.map.snapshot() : null;
  let scene;
  try {
    scene = sceneFor(app.state.scene, app.state.view);
  } catch (error) {
    console.error('地圖場景繪製失敗', error);
    canvas.dataset.broken = '';
    $('atlasViewNote').textContent = '地圖繪製失敗，下方列表與來源卡仍可使用。';
    return;
  }
  delete canvas.dataset.broken;
  app.map.setScene(scene);
  // 界線全都沒載入時，地圖只剩圖釘；明講底圖缺漏，不讓空白看起來像完整地圖。
  if (scene.missing.regions && scene.missing.districts && scene.missing.land) canvas.dataset.nobase = ''; else delete canvas.dataset.nobase;
  renderPins();
  if (before && !before.atHome) app.map.restore(before.center, before.k);
  renderChrome();
}

function renderPins() {
  const scene = app.map.scene;
  if (!scene) return;
  const visible = new Set(visibleProjects().map((project) => project.id));
  const models = scene.pins.filter((pin) => visible.has(pin.projectId)).map((pin) => {
    const project = projectById(pin.projectId);
    const stage = project.latestStage ? `七階段最新紀錄：${app.model.stages.find((item) => item.id === project.latestStage)?.label ?? project.latestStage}` : project.stages ? '七階段尚未收錄' : '階段對照未載入';
    return {
      projectId: project.id,
      at: pin.at,
      title: project.title,
      stage: project.latestStage,
      precision: project.precision,
      favorite: app.favorites.has(project.id),
      selected: project.id === app.state.project,
      describe: `${project.title}，${project.regionName}${project.location?.district?.name ?? ''}，地點精度：${PRECISION_LABEL[project.precision]}，${stage}。按 Enter 看來源卡`,
    };
  });
  app.map.setPins(models);
}

function renderChrome() {
  const scene = app.map.scene;
  const { state } = app;
  const focusId = state.scene.startsWith('region:') ? state.scene.slice(7) : null;
  $('atlasCrumbs').innerHTML = focusId
    ? `<button type="button" data-scene="overview">四地區總覽</button><span aria-hidden="true">›</span><span aria-current="true">${esc(regionName(focusId))}</span>`
    : '<span aria-current="true">四地區總覽</span>';
  for (const mode of ['plan', 'iso']) $(`atlasView-${mode}`).setAttribute('aria-pressed', String(state.view === mode));
  canvas.setAttribute('aria-label', `${focusId ? regionName(focusId) : '台北、新北、新竹縣市'}政策與工程地圖，${CAMERA[state.view].label}。圖釘可用 Tab 鍵逐一選取。`);
  $('atlasViewNote').textContent = state.view === 'iso'
    ? `立體示意視角：地面位置與平面圖相同，厚度只為立體感，不代表高程或任何數值。桌面尺規小格 ${formatDistance(scene.ruler.stepM)}、大格 ${formatDistance(scene.ruler.majorM)}。`
    : '平面視角：正北朝上，比例尺隨縮放更新。';
  const art = focusId ? artForRegion(app.layers.art?.data, focusId) : [];
  const artBox = $('atlasRegionArt');
  artBox.hidden = !art.length;
  artBox.innerHTML = regionArtHtml(art);
  updateHud(app.map.snapshot());
}

function updateHud(snapshot) {
  if (!snapshot) return;
  const bar = $('atlasScale');
  if (app.state.view === 'plan') {
    bar.hidden = false;
    bar.style.width = `${snapshot.bar.px.toFixed(1)}px`;
    bar.textContent = snapshot.bar.label;
  } else {
    bar.hidden = true;
  }
  const [lon, lat] = snapshot.center;
  $('atlasCenter').textContent = `畫面中心 ${lon.toFixed(4)}°E ${lat.toFixed(4)}°N・放大 ${snapshot.k.toFixed(1)} 倍`;
  $('atlasZoomReset').disabled = snapshot.atHome;
  $('atlasZoomOut').disabled = snapshot.atHome;
  $('atlasZoomIn').disabled = snapshot.k >= app.map.scene.maxZoom - 0.01;
}

// 選取、篩選、切換場景這類離散變化立刻寫進網址；拖曳與縮放連續發生，延後一點再寫。
function syncUrl() {
  const snapshot = app.map?.snapshot();
  const next = serializeState({ ...app.state, center: snapshot?.center ?? null, zoom: snapshot?.k ?? null });
  if (next !== location.hash) history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
}
const syncUrlSoon = debounce(syncUrl, 250);

// ---- 動作 ----

function setScene(sceneId, { keep = false } = {}) {
  if (app.state.scene === sceneId) return;
  app.state.scene = sceneId;
  app.state.filters.region = sceneId.startsWith('region:') ? sceneId.slice(7) : '';
  syncFilterInputs();
  renderFiltersState();
  renderList();
  renderTimeline();
  renderScene({ keep });
  syncUrl();
}

function selectProject(id, { fly = true, focusDetail = true, from = null } = {}) {
  const project = projectById(id);
  if (!project) return;
  app.returnFocus = from ?? document.activeElement;
  app.state.project = id;
  if (project.locationState === 'located' && app.state.scene.startsWith('region:') && app.state.scene !== `region:${project.regionId}`) {
    app.state.scene = `region:${project.regionId}`;
    app.state.filters.region = project.regionId;
    syncFilterInputs();
    renderFiltersState();
    renderScene();
  }
  if (!visibleProjects().some((item) => item.id === id)) {
    app.state.filters = { ...EMPTY_FILTERS, region: app.state.filters.region };
    syncFilterInputs();
    renderFiltersState();
  }
  renderList();
  renderDetail();
  renderTimeline();
  renderPins();
  openSheet('half');
  if (focusDetail) $('atlasDetailTitle')?.focus({ preventScroll: !desktop() });
  if (fly && project.locationState === 'located') {
    const pin = app.map.scene.pins.find((item) => item.projectId === id);
    if (pin) revealPin(pin, app.map.scene.kind === 'overview' ? 1.8 : 1.4);
  }
  syncUrl();
}

// 把圖釘移到看得到的地方。手機的底部面板會蓋住地圖下半部，所以先把地圖捲到頁首下方，
// 告訴互動層下方被遮住多少，再把圖釘放到面板上方的可見範圍中央。
function revealPin(pin, minK) {
  if (!desktop()) {
    canvas.parentElement.scrollIntoView({ block: 'start' });
    syncInset();
  }
  app.map.focus(pin.at, minK);
}

// 底部面板各狀態的高度，與 atlas.css 的 [data-sheet] 規則一致。
const SHEET_HEIGHT = { closed: () => 0, peek: () => 115, half: () => Math.min(innerHeight * 0.5, 448), full: () => Math.min(innerHeight * 0.5, 448) };
function syncInset() {
  if (!app.map) return;
  if (desktop()) { app.map.setInset(0); return; }
  const sheetTop = innerHeight - (SHEET_HEIGHT[detail.dataset.sheet] ?? SHEET_HEIGHT.closed)();
  const box = canvas.getBoundingClientRect();
  app.map.setInset(Math.max(0, Math.min(box.height - 90, box.bottom - sheetTop)));
}

function clearSelection({ restoreFocus = true } = {}) {
  if (!app.state.project) return;
  const previous = app.state.project;
  app.state.project = null;
  renderList();
  renderDetail();
  renderTimeline();
  renderPins();
  syncUrl();
  if (restoreFocus) {
    const target = canvas.querySelector(`.atl-pin[data-project="${previous}"]`) ?? $('atlasList').querySelector(`[data-select="${previous}"]`) ?? canvas;
    target.focus({ preventScroll: true });
  }
}

function openSheet(state) {
  detail.dataset.sheet = app.state.project ? state : 'closed';
  $('atlasSheetHandle').setAttribute('aria-expanded', String(detail.dataset.sheet === 'full'));
  $('atlasSheetHandle').querySelector('span').textContent = detail.dataset.sheet === 'full' ? '收合來源卡' : '展開來源卡';
  syncInset();
}

function toggleFavorite(id) {
  app.favorites.toggle(id);
  renderList();
  if (app.state.project) renderDetail();
  if (app.state.filters.favorites) renderTimeline();
  renderPins();
  renderStatus();
}

async function share(projectId) {
  const snapshot = app.map.snapshot();
  const hash = serializeState({ ...app.state, project: projectId ?? app.state.project, center: snapshot.center, zoom: snapshot.k });
  const url = `${location.origin}${location.pathname}${hash}`;
  const out = (projectId && detail.querySelector('[data-share-out]')) || $('atlasShareOut');
  const title = projectId ? `${projectById(projectId).title}｜政策與工程地圖` : '政策與工程地圖';
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title, url }); out.textContent = '已開啟分享。'; return; }
    await navigator.clipboard.writeText(url);
    out.textContent = '已複製連結，包含目前的地圖位置與選取的案卷。';
  } catch (error) {
    if (error?.name === 'AbortError') return;
    out.innerHTML = `無法自動複製，請手動複製這個網址：<input type="text" readonly value="${esc(url)}" aria-label="分享網址">`;
    out.querySelector('input')?.select();
  }
}

function downloadCsv() {
  const rows = visibleProjects();
  if (!rows.length) return;
  const blob = new Blob([toCsv(exportRows(rows, app.model))], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `atlas-${app.model.locationsReviewedAt ?? app.model.reviewedAt ?? 'export'}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- 事件 ----

const mapHandlers = {
  onPin: (id) => selectProject(id, { fly: true, from: canvas.querySelector(`.atl-pin[data-project="${id}"]`) }),
  onPinHover: (id, on) => { const item = $('atlasList').querySelector(`.atl-item[data-project="${id}"]`); if (item) { if (on) item.dataset.hover = ''; else delete item.dataset.hover; } },
  onDistrict: ({ id, regionId, name }) => {
    if (app.state.scene !== `region:${regionId}`) { setScene(`region:${regionId}`); return; }
    app.map.setActiveDistrict(id);
    const count = app.model.projects.filter((project) => project.location?.district?.id === id).length;
    $('atlasHover').textContent = `${regionName(regionId)}${name}：已定位案卷 ${count} 案`;
  },
  onBackground: () => { app.map.setActiveDistrict(null); },
  onHover: (info) => { $('atlasHover').textContent = info ? `${info.regionId ? regionName(info.regionId) : ''}${info.name}${info.regionId ? '' : '（周邊縣市，不在案卷範圍）'}` : ''; },
  onView: (snapshot) => { updateHud(snapshot); syncUrlSoon(); },
  onEscape: () => { if (app.state.project) clearSelection(); else if (app.state.scene !== 'overview') setScene('overview'); },
};

root.addEventListener('click', (event) => {
  const target = event.target.closest('[data-select],[data-favorite],[data-share],[data-locate],[data-scene],[data-stage-filter],[data-retry],[data-close-detail]');
  if (!target) return;
  if (target.dataset.retry !== undefined) { app.scenes.clear(); boot().catch(bootFailed); return; }
  if (!app.model?.ok) return;
  if (target.dataset.select) selectProject(target.dataset.select, { from: target });
  else if (target.dataset.favorite) toggleFavorite(target.dataset.favorite);
  else if (target.dataset.share !== undefined) share(target.dataset.share || null);
  else if (target.dataset.locate) {
    const pin = app.map.scene.pins.find((item) => item.projectId === target.dataset.locate);
    if (!pin) return;
    // 手機：面板縮成一列，讓出地圖。
    if (!desktop()) openSheet('peek');
    revealPin(pin, 2.4);
  }
  else if (target.dataset.scene) setScene(target.dataset.scene);
  else if (target.dataset.stageFilter !== undefined) {
    app.state.filters.stage = app.state.filters.stage === target.dataset.stageFilter ? '' : target.dataset.stageFilter;
    renderFiltersState(); renderList(); renderTimeline(); renderPins(); syncUrl();
    $('atlasStageBar').querySelector(`[data-stage-filter="${app.state.filters.stage}"]`)?.focus();
  } else if (target.dataset.closeDetail !== undefined) clearSelection();
});

$('atlasFilters').addEventListener('submit', (event) => event.preventDefault());
$('atlasFilters').addEventListener('input', (event) => {
  if (!app.model?.ok) return;
  const { filters } = app.state;
  if (event.target.id === 'atlasRegion') { setScene(event.target.value ? `region:${event.target.value}` : 'overview'); return; }
  filters.topic = $('atlasTopic').value;
  filters.query = $('atlasQuery').value;
  filters.favorites = $('atlasFavOnly').checked;
  renderFiltersState(); renderList(); renderTimeline(); renderPins(); syncUrl();
});
$('atlasFilters').addEventListener('reset', () => setTimeout(() => {
  if (!app.model?.ok) return;
  app.state.filters = { ...EMPTY_FILTERS };
  app.state.scene = 'overview';
  syncFilterInputs();
  renderFiltersState(); renderList(); renderTimeline(); renderScene(); syncUrl();
}, 0));

$('atlasList').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const buttons = [...$('atlasList').querySelectorAll('.atl-item-main')];
  const index = buttons.indexOf(event.target.closest('.atl-item-main'));
  if (index < 0) return;
  event.preventDefault();
  buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
});
for (const [type, on] of [['pointerover', true], ['pointerout', false], ['focusin', true], ['focusout', false]]) {
  $('atlasList').addEventListener(type, (event) => { const item = event.target.closest('.atl-item'); if (item && app.map) app.map.markPin(item.dataset.project, 'hover', on); });
}

for (const mode of ['plan', 'iso']) {
  $(`atlasView-${mode}`).addEventListener('click', () => {
    if (!app.model?.ok || app.state.view === mode) return;
    app.state.view = mode;
    renderScene({ keep: true });
    syncUrl();
  });
}
$('atlasZoomIn').addEventListener('click', () => app.map?.zoomBy(1.5));
$('atlasZoomOut').addEventListener('click', () => app.map?.zoomBy(1 / 1.5));
$('atlasZoomReset').addEventListener('click', () => app.map?.reset());
$('atlasShare').addEventListener('click', () => { if (app.model?.ok) share(null); });
$('atlasExport').addEventListener('click', downloadCsv);
$('atlasSheetHandle').addEventListener('click', () => openSheet(detail.dataset.sheet === 'full' ? 'half' : 'full'));

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !app.model?.ok || event.target === canvas) return;
  if (app.state.project && (detail.contains(event.target) || event.target.closest('.atl-pin'))) { event.preventDefault(); clearSelection(); }
});

window.addEventListener('hashchange', () => {
  if (!app.model?.ok) return;
  const next = parseState(location.hash);
  const current = serializeState({ ...app.state, center: null, zoom: null });
  if (serializeState({ ...next, center: null, zoom: null }) === current) return;
  app.state = next;
  normalizeState();
  syncFilterInputs();
  renderAll();
  if (next.center && next.zoom) app.map.restore(next.center, next.zoom);
  if (app.state.project) openSheet('half');
});

let lastStage = '';
new ResizeObserver(debounce(() => {
  if (!app.model?.ok || !app.map) return;
  const { width, height } = app.map.stage();
  const key = `${width}x${height}`;
  if (key === lastStage) return;
  lastStage = key;
  renderScene({ keep: true });
}, 160)).observe(canvas);

window.addEventListener('pagehide', () => { if (app.model?.ok && app.map?.scene) syncUrl(); });

// 另一個分頁（例如地方治理頁）改了關注清單時，這裡跟著更新。
window.addEventListener('storage', (event) => {
  if (event.key !== null && event.key !== WATCH_KEY) return;
  app.favorites.reload();
  if (!app.model?.ok) return;
  renderList();
  renderPins();
  if (app.state.project) renderDetail();
});

function bootFailed(error) {
  console.error('地圖啟動失敗', error);
  root.dataset.state = 'failed';
  $('atlasStatus').textContent = '地圖啟動失敗';
  const box = $('atlasGaps');
  box.hidden = false;
  box.innerHTML = '<h2>地圖沒有順利啟動</h2><p>頁面下方的來源與資料檔連結仍然可用。</p><button type="button" data-retry>重新讀取</button>';
}

boot().catch(bootFailed);
