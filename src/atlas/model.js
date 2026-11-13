// 地圖資料模型：把治理案卷、位置查核、階段對照與界線讀成同一份檢視資料。
// 純函式、不碰 DOM；列表、來源卡、時間軸、地圖與匯出都讀這一份，缺值一律保留 null。

export const STAGE_IDS = ['planning', 'approval', 'construction', 'completion', 'acceptance', 'opening', 'outcome'];
export const STAGE_GLYPH = { planning: '規', approval: '核', construction: '施', completion: '完', acceptance: '驗', opening: '啟', outcome: '效' };
export const PRECISION_LABEL = { site: '基地點位', street: '路段或路口', area: '行政區範圍', unknown: '待定位' };
export const STATUS_LABEL = { documented: '有紀錄', stated_undated: '有紀錄・未載日期', in_preparation: '準備中', not_recorded: '未收錄' };

// 必要圖層讀不到就無法呈現案卷；其餘圖層失敗時頁面照常運作，但要把缺口列出來。
export const LAYERS = [
  { id: 'governance', label: '治理案卷', path: '/data/governance.json', required: true },
  { id: 'registry', label: '來源目錄', path: '/data/governance-registry.json', required: true },
  { id: 'locations', label: '案卷位置', path: '/data/geo/project-locations.json', required: false },
  { id: 'stages', label: '階段對照', path: '/data/geo/project-stages.json', required: false },
  { id: 'regions', label: '縣市界線', path: '/data/geo/boundaries/regions.geojson', required: false },
  { id: 'districts', label: '鄉鎮市區界線', path: '/data/geo/boundaries/districts.geojson', required: false },
  { id: 'scope', label: '四地區外框', path: '/data/geo/boundaries/scope-outline.geojson', required: false },
  { id: 'neighbors', label: '相鄰縣市底圖', path: '/data/geo/boundaries/neighbors.geojson', required: false },
  { id: 'land', label: '陸地外框', path: '/data/geo/boundaries/land-outline.geojson', required: false },
  // 美術庫由 05-art 提供；整合前不存在是正常情況，所以缺檔不算資料缺口。
  { id: 'art', label: '美術庫索引', path: '/data/art-library.json', required: false, optional: true },
];

export async function fetchJson(path, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(path, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? '逾時' : error?.message || '讀取失敗');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 每個圖層各自成敗，回傳 { id: { status: 'ok' | 'failed' | 'absent', data, error, path, label } }。
export async function loadLayers(options = {}) {
  const results = await Promise.allSettled(LAYERS.map((layer) => fetchJson(layer.path, options)));
  const out = {};
  LAYERS.forEach((layer, index) => {
    const result = results[index];
    out[layer.id] = result.status === 'fulfilled'
      ? { ...layer, status: 'ok', data: result.value, error: null }
      : { ...layer, status: layer.optional ? 'absent' : 'failed', data: null, error: result.reason?.message ?? '讀取失敗' };
  });
  return out;
}

const byId = (list = []) => new Map(list.map((item) => [item.id, item]));

export function latestDocumentedStage(stages) {
  if (!stages) return null;
  let latest = null;
  for (const id of STAGE_IDS) {
    const status = stages[id]?.status;
    if (status === 'documented' || status === 'stated_undated') latest = id;
  }
  return latest;
}

export function buildModel(layers) {
  const gaps = [];
  for (const layer of Object.values(layers)) {
    if (layer.status === 'failed') gaps.push({ layer: layer.id, label: layer.label, path: layer.path, message: layer.error, required: Boolean(layer.required) });
  }
  const governance = layers.governance?.data;
  const registry = layers.registry?.data;
  if (!governance || !registry) return { ok: false, gaps, projects: [], regions: [], topics: [], stages: [], sources: new Map(), layers };

  const locationFile = layers.locations?.data ?? null;
  const stageFile = layers.stages?.data ?? null;
  const sources = new Map();
  for (const source of registry.sources ?? []) sources.set(source.id, { ...source, origin: 'registry' });
  for (const source of stageFile?.sources ?? []) if (!sources.has(source.id)) sources.set(source.id, { ...source, origin: 'stages' });
  for (const source of locationFile?.sources ?? []) if (!sources.has(source.id)) sources.set(source.id, { ...source, agency: source.publisher, origin: 'locations' });

  const regions = byId(registry.regions);
  const topics = byId(registry.topics);
  const locations = new Map((locationFile?.locations ?? []).map((item) => [item.project_id, item]));
  const overlays = new Map((stageFile?.projects ?? []).map((item) => [item.project_id, item]));
  const stageDefs = stageFile?.stages ?? [];

  const projects = (governance.projects ?? []).map((project) => {
    const location = locations.get(project.id) ?? null;
    const overlay = overlays.get(project.id) ?? null;
    // 位置三態：located（有可核對座標）、pending（查核過但沒有座標）、unavailable（位置檔沒讀到或尚未查核）。
    const locationState = !locationFile ? 'unavailable' : !location ? 'unchecked' : location.geometry ? 'located' : 'pending';
    return {
      id: project.id,
      title: project.title,
      regionId: project.region_id,
      regionName: regions.get(project.region_id)?.name ?? project.region_id,
      topicId: project.topic_id,
      topicName: topics.get(project.topic_id)?.name ?? project.topic_id,
      agency: project.agency,
      summary: project.summary,
      phase: { id: project.phase, label: project.phase_label, asOf: project.phase_as_of ?? null },
      progress: project.progress ?? null,
      target: project.target ?? null,
      budget: project.budget ?? null,
      missingEvidence: project.missing_evidence ?? [],
      events: project.events ?? [],
      locationState,
      precision: location?.location_precision ?? null,
      location,
      hasSite: Boolean(location?.site_context),
      sitePath: location?.site_context ? `/data/geo/${location.site_context}` : null,
      stages: overlay?.stages ?? null,
      latestStage: overlay ? latestDocumentedStage(overlay.stages) : null,
      stageNote: overlay?.stage_note ?? null,
      otherRecords: overlay?.other_records ?? [],
      figures: overlay?.figures ?? [],
      facts: overlay?.facts ?? [],
      relations: overlay?.relations ?? [],
      relationsNote: overlay?.relations_note ?? null,
      hasOverlay: Boolean(overlay),
    };
  });

  const governanceReviewed = governance.reviewed_at ?? null;
  const overlayBasis = stageFile?.based_on?.governance_reviewed_at ?? null;
  const locationBasis = locationFile?.based_on?.governance_reviewed_at ?? null;
  const stale = [];
  if (stageFile && overlayBasis && governanceReviewed && governanceReviewed > overlayBasis) stale.push('階段對照是依較早版本的案卷整理，尚未依新版重新核對。');
  if (locationFile && locationBasis && governanceReviewed && governanceReviewed > locationBasis) stale.push('位置查核是依較早版本的案卷整理，尚未依新版重新核對。');

  return {
    ok: true,
    layers,
    gaps,
    stale,
    reviewedAt: governanceReviewed,
    locationsReviewedAt: locationFile?.reviewed_at ?? null,
    stagesReviewedAt: stageFile?.reviewed_at ?? null,
    scopeNote: registry.scope_note ?? null,
    locationScopeNote: locationFile?.scope_note ?? null,
    precisionLegend: locationFile?.precision_legend ?? null,
    statusLegend: stageFile?.status_legend ?? null,
    regions: registry.regions ?? [],
    topics: registry.topics ?? [],
    stages: stageDefs,
    sources,
    projects,
  };
}

// ---- 篩選 ----

export const EMPTY_FILTERS = { region: '', topic: '', stage: '', query: '', favorites: false };

// stage：七階段之一表示「有這個階段的紀錄（含準備中）」；'none' 表示七個階段都還沒有紀錄。
export function matchesFilters(project, filters, favorites = new Set()) {
  if (filters.region && project.regionId !== filters.region) return false;
  if (filters.topic && project.topicId !== filters.topic) return false;
  if (filters.favorites && !favorites.has(project.id)) return false;
  if (filters.stage) {
    if (!project.stages) return false;
    if (filters.stage === 'none') {
      if (STAGE_IDS.some((id) => project.stages[id] && project.stages[id].status !== 'not_recorded')) return false;
    } else {
      const status = project.stages[filters.stage]?.status;
      if (!status || status === 'not_recorded') return false;
    }
  }
  const query = (filters.query ?? '').trim().toLocaleLowerCase();
  if (query && !`${project.title} ${project.agency} ${project.summary} ${project.regionName} ${project.topicName} ${project.location?.district?.name ?? ''}`.toLocaleLowerCase().includes(query)) return false;
  return true;
}

export const filterProjects = (projects, filters, favorites) => projects.filter((project) => matchesFilters(project, filters, favorites));

export function stageCounts(projects) {
  const counts = Object.fromEntries([...STAGE_IDS, 'none'].map((id) => [id, 0]));
  let unknown = 0;
  for (const project of projects) {
    if (!project.stages) { unknown += 1; continue; }
    let any = false;
    for (const id of STAGE_IDS) {
      const status = project.stages[id]?.status;
      if (status && status !== 'not_recorded') { counts[id] += 1; any = true; }
    }
    if (!any) counts.none += 1;
  }
  return { counts, unknown };
}

// ---- 日期與金額 ----

export function formatDate(value, precision) {
  if (!value) return '未標示';
  const text = String(value).replaceAll('-', '/');
  const kind = precision ?? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? 'day' : /^\d{4}-\d{2}$/.test(value) ? 'month' : /^\d{4}$/.test(value) ? 'year' : null);
  if (kind === 'month') return `${text}（只到月份）`;
  if (kind === 'year') return `${text}（只到年份）`;
  return text;
}

// 回傳日期涵蓋的時間區間（毫秒，UTC）；月份或年份精度就是一段，不硬塞成某一天。
export function dateSpan(value) {
  if (!value) return null;
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) - 1 : null;
  const day = match[3] ? Number(match[3]) : null;
  if (month === null) return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1), precision: 'year' };
  if (day === null) return { start: Date.UTC(year, month, 1), end: Date.UTC(year, month + 1, 1), precision: 'month' };
  return { start: Date.UTC(year, month, day), end: Date.UTC(year, month, day + 1), precision: 'day' };
}

export function formatTwd(value) {
  if (value === null || value === undefined) return '尚未收錄';
  return `NT$ ${Number(value).toLocaleString('zh-TW')}`;
}

export function formatYi(value) {
  if (value === null || value === undefined) return null;
  const yi = value / 1e8;
  return `${yi >= 10 ? yi.toFixed(1) : yi.toFixed(2)} 億元`;
}

// 經費圖的共同刻度：所有案卷已知金額（核定、決標、實支與原文數字）的最大值。沒有任何金額時回傳 null。
export function budgetScaleMax(projects) {
  let max = 0;
  for (const project of projects) {
    for (const key of ['approved_twd', 'contract_twd', 'spent_twd']) if (typeof project.budget?.[key] === 'number') max = Math.max(max, project.budget[key]);
    for (const figure of project.figures) if (typeof figure.value_twd === 'number') max = Math.max(max, figure.value_twd);
  }
  return max > 0 ? max : null;
}

// ---- 時間軸 ----

// 案卷的時間軸項目：治理案卷事件、階段對照的其他程序紀錄，以及機關目標（目標另外標示，不是已發生的事）。
export function timelineItems(project) {
  const items = [];
  for (const event of project.events) {
    const span = dateSpan(event.date);
    if (span) items.push({ projectId: project.id, kind: 'event', date: event.date, precision: event.precision ?? span.precision, label: event.summary, sourceId: event.source_id, recordKind: event.kind ?? null, ...span });
  }
  for (const record of project.otherRecords) {
    const span = dateSpan(record.date);
    if (span) items.push({ projectId: project.id, kind: 'record', date: record.date, precision: record.precision ?? span.precision, label: record.label, sourceId: record.source_id, quote: record.quote ?? null, recordKind: record.kind ?? null, ...span });
  }
  if (project.target?.value) {
    const span = dateSpan(project.target.value);
    if (span) items.push({ projectId: project.id, kind: 'target', date: project.target.value, precision: project.target.precision ?? span.precision, label: project.target.label, sourceId: null, ...span });
  }
  return items.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
}

export function timelineRange(projects) {
  let start = Infinity;
  let end = -Infinity;
  for (const project of projects) for (const item of timelineItems(project)) { start = Math.min(start, item.start); end = Math.max(end, item.end); }
  if (!Number.isFinite(start)) return null;
  const first = new Date(start).getUTCFullYear();
  const last = new Date(end - 1).getUTCFullYear();
  return { start: Date.UTC(first, 0, 1), end: Date.UTC(last + 1, 0, 1), years: Array.from({ length: last - first + 1 }, (_, index) => first + index) };
}

// ---- 匯出 ----

export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportRows(projects, model) {
  const header = ['案卷ID', '案卷', '地區', '鄉鎮市區', '議題', '主管機關', '案卷階段紀錄', '階段紀錄日期', '七階段最新紀錄', '位置精度', '經度', '緯度', '座標依據', '座標來源網址', '座標查閱日', '位置原文', '待定位原因', '機關公布進度百分比', '進度基準日', '核定經費TWD', '決標金額TWD', '實際支用TWD', '本站案卷查閱日', '位置查核日'];
  const stageLabel = new Map(model.stages.map((stage) => [stage.id, stage.label]));
  const blank = (value, fallback) => (value === null || value === undefined ? fallback : value);
  const rows = projects.map((project) => {
    const location = project.location;
    return [
      project.id, project.title, project.regionName, blank(location?.district?.name, ''), project.topicName, project.agency,
      project.phase.label, blank(project.phase.asOf, '未標示'),
      project.stages ? (project.latestStage ? stageLabel.get(project.latestStage) ?? project.latestStage : '七階段皆未收錄') : '階段對照未載入',
      project.locationState === 'located' ? PRECISION_LABEL[project.precision] ?? project.precision : project.locationState === 'pending' ? '待定位' : '位置資料未載入',
      blank(location?.anchor?.[0], ''), blank(location?.anchor?.[1], ''),
      blank(location?.coordinate_source?.basis, ''), blank(location?.coordinate_source?.url, ''), blank(location?.coordinate_source?.checked_at, ''),
      blank(location?.location_text, ''), blank(location?.pending?.reason, ''),
      blank(project.progress?.value, '尚未收錄'), blank(project.progress?.as_of, '未標示'),
      blank(project.budget?.approved_twd, '尚未收錄'), blank(project.budget?.contract_twd, '尚未收錄'), blank(project.budget?.spent_twd, '尚未收錄'),
      blank(model.reviewedAt, ''), blank(model.locationsReviewedAt, ''),
    ];
  });
  return [header, ...rows];
}

export const toCsv = (rows) => `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;

// ---- 美術庫（05-art）：依素材 ID 契約選用，只取已核對、可使用的素材 ----
// 索引格式見 public/data/art-library.json（schema_version 2）：
// review_status=publication-ready，usage_status=available 或 in-use；缺口（gap）沒有檔案，不會被選到。

const usableArt = (artIndex) => (Array.isArray(artIndex?.assets) ? artIndex.assets : [])
  .filter((asset) => asset.review_status === 'publication-ready' && ['available', 'in-use'].includes(asset.usage_status) && Array.isArray(asset.files) && asset.files.length);

export const artForProject = (artIndex, projectId) => usableArt(artIndex).filter((asset) => Array.isArray(asset.project_refs) && asset.project_refs.includes(projectId));

// 地區實景：美術庫的地區代碼與本站相同（第一版索引曾用 tw- 前綴，兩種都接受）。
// 實景照片只作地方脈絡，不是工程進度證明。
export const artForRegion = (artIndex, regionId) => usableArt(artIndex).filter((asset) => asset.kind === 'scene' && Array.isArray(asset.region_ids)
  && (asset.region_ids.includes(regionId) || asset.region_ids.includes(`tw-${regionId}`)));

// 縮圖取最窄的 WebP，點開用 fallback（JPEG）。
export function artImage(asset) {
  const byWidth = [...asset.files].sort((a, b) => (a.width ?? Infinity) - (b.width ?? Infinity));
  const thumb = byWidth.find((file) => file.mime === 'image/webp') ?? byWidth[0];
  const full = asset.files.find((file) => file.role === 'fallback') ?? byWidth[byWidth.length - 1];
  return { thumb: `/${thumb.path}`, full: `/${full.path}`, width: thumb.width ?? null, height: thumb.height ?? null };
}
