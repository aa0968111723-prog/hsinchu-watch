// 單元測試：幾何、資料模型、網址狀態、視角與場景。執行：node --test tests/map
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CAMERA, IDENTITY, applyView, centerOn, clampView, fitCamera, makeFrame, project, scaleBar, unproject, viewCenter, zoomAbout } from '../../src/atlas/camera.js';
import { clipLineToRect, clipRingToRect, distanceToRingM, haversine, lineLength, localProjector, pointAlong, pointInGeometry, polygonAreaM2 } from '../../src/atlas/geo.js';
import { EMPTY_FILTERS, LAYERS, artForProject, artForRegion, artImage, budgetScaleMax, buildModel, csvCell, dateSpan, exportRows, filterProjects, formatDate, formatTwd, latestDocumentedStage, stageCounts, timelineItems, timelineRange, toCsv } from '../../src/atlas/model.js';
import { pinArt } from '../../src/atlas/pins.js';
import { buildRegionScene, buildSiteScene, illustrativeBuildingHeight } from '../../src/atlas/scene.js';
import { WATCH_KEY, createFavorites, parseState, serializeState } from '../../src/atlas/state.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const realLayers = (skip = []) => Object.fromEntries(LAYERS.map((layer) => {
  if (skip.includes(layer.id) || layer.optional) return [layer.id, { ...layer, status: layer.optional ? 'absent' : 'failed', data: null, error: 'HTTP 404' }];
  return [layer.id, { ...layer, status: 'ok', data: readJson(`public${layer.path}`), error: null }];
}));
const geoOf = (layers) => Object.fromEntries(['regions', 'districts', 'scope', 'neighbors', 'land'].map((id) => [id, layers[id].data]));
const close = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message ?? ''} ${a} vs ${b}`);

// ---- 幾何 ----

test('haversine 與線長：緯度 1 度約 111.2 公里', () => {
  close(haversine([121, 24], [121, 25]), 111195, 20);
  close(lineLength([[121, 24], [121, 24.5], [121, 25]]), 111195, 20);
});

test('pointAlong 取線段中點，不超出端點', () => {
  const line = [[121, 24], [121, 25]];
  close(pointAlong(line, 0.5)[1], 24.5, 1e-9);
  assert.deepEqual(pointAlong(line, 2), [121, 25]);
});

test('點在多邊形內判斷會扣掉洞', () => {
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.equal(pointInGeometry([2, 2], geometry), true);
  assert.equal(pointInGeometry([5, 5], geometry), false);
  assert.equal(pointInGeometry([11, 5], geometry), false);
  assert.equal(pointInGeometry([2, 2], null), false);
});

test('面積與點到邊界距離以公尺計', () => {
  const { toLonLat } = localProjector([121.5, 25]);
  const square = [[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]].map(toLonLat);
  close(polygonAreaM2({ type: 'Polygon', coordinates: [square] }), 1e6, 50);
  close(distanceToRingM(toLonLat([-30, 500]), square), 30, 0.1);
});

test('裁切：多邊形與折線都裁到矩形內', () => {
  const ring = clipRingToRect([[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]], [0, 0, 10, 10]);
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  for (const [x, y] of ring) assert.ok(x >= 0 && x <= 10 && y >= 0 && y <= 10);
  assert.deepEqual(clipRingToRect([[20, 20], [30, 20], [30, 30], [20, 20]], [0, 0, 10, 10]), []);
  const pieces = clipLineToRect([[-5, 5], [5, 5], [15, 5], [5, 5]], [0, 0, 10, 10]);
  assert.equal(pieces.length, 2);
  assert.deepEqual(pieces[0], [[0, 5], [5, 5], [10, 5]]);
});

// ---- 資料模型 ----

test('模型：四案讀入，三案已定位、一案待定位，待定位不帶座標', () => {
  const model = buildModel(realLayers());
  assert.equal(model.ok, true);
  assert.equal(model.gaps.length, 0);
  assert.equal(model.projects.length, 4);
  const states = Object.fromEntries(model.projects.map((p) => [p.id, p.locationState]));
  assert.deepEqual(states, { 'hsinchu-county-baozhong-road': 'located', 'hsinchu-city-xiangshan-four': 'pending', 'new-taipei-siyuan-footbridge': 'located', 'taipei-peiying-housing': 'located' });
  const pending = model.projects.find((p) => p.locationState === 'pending');
  assert.equal(pending.location.geometry, null);
  assert.equal(pending.location.anchor, null);
  assert.equal(pending.precision, 'unknown');
});

test('模型：位置檔沒載入時是「未載入」而不是「待定位」，並留下資料缺口', () => {
  const model = buildModel(realLayers(['locations']));
  assert.equal(model.ok, true);
  assert.ok(model.projects.every((p) => p.locationState === 'unavailable' && p.location === null));
  assert.deepEqual(model.gaps.map((gap) => gap.layer), ['locations']);
});

test('模型：階段對照沒載入時不推算階段', () => {
  const model = buildModel(realLayers(['stages']));
  assert.ok(model.projects.every((p) => p.stages === null && p.latestStage === null));
  assert.equal(stageCounts(model.projects).unknown, 4);
  assert.equal(filterProjects(model.projects, { ...EMPTY_FILTERS, stage: 'construction' }).length, 0);
});

test('模型：必要圖層失敗就不回傳任何案卷', () => {
  const model = buildModel(realLayers(['governance']));
  assert.equal(model.ok, false);
  assert.equal(model.projects.length, 0);
  assert.ok(model.gaps.some((gap) => gap.layer === 'governance' && gap.required));
});

test('階段：只把有紀錄的格子算進去，完工不代表驗收', () => {
  const model = buildModel(realLayers());
  const peiying = model.projects.find((p) => p.id === 'taipei-peiying-housing');
  assert.equal(peiying.latestStage, 'completion');
  assert.equal(peiying.stages.acceptance.status, 'in_preparation');
  assert.equal(peiying.stages.opening.status, 'not_recorded');
  assert.equal(latestDocumentedStage({ construction: { status: 'documented' }, acceptance: { status: 'in_preparation' } }), 'construction');
  assert.equal(latestDocumentedStage(null), null);
  const xiangshan = model.projects.find((p) => p.id === 'hsinchu-city-xiangshan-four');
  assert.equal(xiangshan.latestStage, null);
  const { counts } = stageCounts(model.projects);
  assert.deepEqual(counts, { planning: 0, approval: 1, construction: 3, completion: 1, acceptance: 1, opening: 0, outcome: 0, none: 1 });
});

test('篩選：地區、議題、階段、關鍵字與收藏', () => {
  const { projects } = buildModel(realLayers());
  const ids = (filters, favorites) => filterProjects(projects, { ...EMPTY_FILTERS, ...filters }, favorites).map((p) => p.id).sort();
  assert.deepEqual(ids({ region: 'taipei' }), ['taipei-peiying-housing']);
  assert.deepEqual(ids({ topic: 'housing' }), ['taipei-peiying-housing']);
  assert.deepEqual(ids({ stage: 'completion' }), ['taipei-peiying-housing']);
  assert.deepEqual(ids({ stage: 'none' }), ['hsinchu-city-xiangshan-four']);
  assert.deepEqual(ids({ query: '新埔' }), ['hsinchu-county-baozhong-road']);
  assert.deepEqual(ids({ favorites: true }, new Set(['new-taipei-siyuan-footbridge'])), ['new-taipei-siyuan-footbridge']);
  assert.equal(ids({ query: '不存在的工程' }).length, 0);
});

test('日期與金額：未知不是 0，月份精度照實標示', () => {
  assert.equal(formatDate(null), '未標示');
  assert.equal(formatDate('2026-09'), '2026/09（只到月份）');
  assert.equal(formatDate('2026-11-12'), '2026/11/12');
  assert.equal(formatTwd(null), '尚未收錄');
  assert.equal(formatTwd(975210000), 'NT$ 975,210,000');
  assert.equal(dateSpan('2026-09').precision, 'month');
  assert.equal(dateSpan('2026-09').end - dateSpan('2026-09').start, 30 * 86400000);
  assert.equal(dateSpan('不是日期'), null);
  const { projects } = buildModel(realLayers());
  assert.equal(budgetScaleMax(projects), 975210000);
  assert.equal(budgetScaleMax(projects.filter((p) => !p.budget && !p.figures.length)), null);
});

test('時間軸：目標另外標示，項目依時間排序', () => {
  const { projects } = buildModel(realLayers());
  const baozhong = timelineItems(projects.find((p) => p.id === 'hsinchu-county-baozhong-road'));
  assert.deepEqual(baozhong.map((item) => item.kind), ['event', 'target']);
  assert.equal(baozhong[1].precision, 'month');
  const all = projects.flatMap(timelineItems);
  assert.ok(all.every((item) => item.kind !== 'event' || item.sourceId));
  const range = timelineRange(projects);
  assert.deepEqual([range.years[0], range.years.at(-1)], [2019, 2028]);
  assert.equal(timelineRange([]), null);
});

test('匯出：公式開頭字元會被中和，缺值寫成文字而不是 0', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(null), '""');
  const model = buildModel(realLayers());
  const rows = exportRows(model.projects, model);
  assert.equal(rows.length, 5);
  const header = rows[0];
  const row = (id) => Object.fromEntries(rows.find((r) => r[0] === id).map((value, index) => [header[index], value]));
  assert.equal(row('hsinchu-county-baozhong-road')['實際支用TWD'], '尚未收錄');
  assert.equal(row('hsinchu-county-baozhong-road')['核定經費TWD'], 975210000);
  assert.equal(row('hsinchu-city-xiangshan-four')['位置精度'], '待定位');
  assert.equal(row('hsinchu-city-xiangshan-four')['經度'], '');
  assert.equal(row('new-taipei-siyuan-footbridge')['進度基準日'], '未標示');
  assert.ok(toCsv(rows).startsWith('\ufeff'));
});

test('美術庫：只取已核對可用且指到案卷或地區的素材', () => {
  const files = [
    { path: 'art-library/a-1280.jpg', mime: 'image/jpeg', role: 'fallback', width: 1280, height: 720 },
    { path: 'art-library/a-480.avif', mime: 'image/avif', role: 'responsive', width: 480, height: 270 },
    { path: 'art-library/a-480.webp', mime: 'image/webp', role: 'responsive', width: 480, height: 270 },
    { path: 'art-library/a-800.webp', mime: 'image/webp', role: 'responsive', width: 800, height: 450 },
  ];
  const index = { schema_version: 2, assets: [
    { id: 'a', kind: 'scene', review_status: 'publication-ready', usage_status: 'available', region_ids: ['taipei'], project_refs: ['taipei-peiying-housing'], files },
    { id: 'b', kind: 'scene', review_status: 'gap', usage_status: 'available', region_ids: ['taipei'], project_refs: ['taipei-peiying-housing'], files },
    { id: 'c', kind: 'portrait', review_status: 'publication-ready', usage_status: 'in-use', region_ids: ['taipei'], project_refs: null, files },
    { id: 'd', kind: 'scene', review_status: 'publication-ready', usage_status: 'in-use', region_ids: ['tw-taipei'], project_refs: null, files },
    { id: 'e', kind: 'scene', review_status: 'publication-ready', usage_status: 'available', region_ids: ['taipei'], project_refs: null, files: [] },
  ] };
  assert.deepEqual(artForProject(index, 'taipei-peiying-housing').map((a) => a.id), ['a']);
  assert.deepEqual(artForRegion(index, 'taipei').map((a) => a.id), ['a', 'd'], '地區代碼新舊兩種寫法都接受，人物照與沒有檔案的不算');
  assert.deepEqual(artForRegion(index, 'new-taipei'), []);
  assert.deepEqual(artForProject(null, 'x'), []);
  assert.deepEqual(artImage(index.assets[0]), { thumb: '/art-library/a-480.webp', full: '/art-library/a-1280.jpg', width: 480, height: 270 });
});

// ---- 網址狀態與收藏 ----

test('網址狀態：來回一致，壞值被丟掉', () => {
  const state = { scene: 'region:taipei', view: 'iso', project: 'taipei-peiying-housing', filters: { ...EMPTY_FILTERS, region: 'taipei', stage: 'completion', favorites: true, query: '住宅' }, center: [121.5484, 25.08], zoom: 3.25 };
  const hash = serializeState(state);
  assert.ok(!hash.includes('r='), '地區與場景一致時不重複寫');
  const parsed = parseState(hash);
  assert.equal(parsed.scene, 'region:taipei');
  assert.equal(parsed.view, 'iso');
  assert.equal(parsed.project, 'taipei-peiying-housing');
  assert.equal(parsed.filters.stage, 'completion');
  assert.equal(parsed.filters.favorites, true);
  assert.equal(parsed.filters.query, '住宅');
  assert.deepEqual(parsed.center, [121.5484, 25.08]);
  assert.equal(parsed.zoom, 3.25);
  const bad = parseState('#s=<script>&v=3d&p=../../etc&g=finished&c=999,999&z=-4');
  assert.equal(bad.scene, 'overview');
  assert.equal(bad.view, 'plan');
  assert.equal(bad.project, null);
  assert.equal(bad.filters.stage, '');
  assert.equal(bad.center, null);
  assert.equal(bad.zoom, null);
  assert.equal(serializeState(parseState('')), '');
});

test('收藏：和治理頁共用同一個鍵；不能儲存時仍可在本頁使用', () => {
  assert.equal(WATCH_KEY, 'governance-watch-v1');
  const data = new Map([[WATCH_KEY, JSON.stringify(['taipei-peiying-housing', 42])]]);
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const favorites = createFavorites(storage);
  assert.deepEqual(favorites.list(), ['taipei-peiying-housing']);
  favorites.toggle('hsinchu-county-baozhong-road');
  assert.deepEqual(JSON.parse(data.get(WATCH_KEY)), ['taipei-peiying-housing', 'hsinchu-county-baozhong-road']);
  assert.equal(favorites.persistent, true);
  const denied = createFavorites({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
  assert.equal(denied.persistent, false);
  assert.equal(denied.toggle('x'), true);
  assert.equal(denied.has('x'), true);
  const none = createFavorites(null);
  assert.equal(none.persistent, false);
  none.toggle('y');
  assert.equal(none.size, 1);
});

// ---- 視角 ----

test('圖框：經緯度來回換算一致，平面視角正北朝上', () => {
  const frame = makeFrame([120.86, 24.42, 122.02, 25.3], { units: 520, aspect: 1.4 });
  const point = [121.5484, 25.08];
  const back = frame.toLonLat(frame.toWorld(point));
  close(back[0], point[0], 1e-9);
  close(back[1], point[1], 1e-9);
  const stage = { width: 900, height: 620 };
  const P = fitCamera([[frame.rect[0], frame.rect[1], 0], [frame.rect[2], frame.rect[3], 0]], 'plan', stage, { pad: 0 });
  const at = (lonLat) => project([...frame.toWorld(lonLat), 0], P);
  assert.ok(at([121.5, 25.2])[1] < at([121.5, 24.6])[1], '北邊在畫面上方');
  assert.ok(at([121.9, 24.9])[0] > at([121.1, 24.9])[0], '東邊在畫面右方');
  close(at([121.5, 25.2])[0], at([121.5, 24.6])[0], 1e-6, '同一條經線在平面視角是垂直線');
});

test('視角：畫面座標可以反推回地面座標（平面與立體）', () => {
  const frame = makeFrame([121.45, 24.96, 121.67, 25.21]);
  const stage = { width: 800, height: 600 };
  for (const mode of Object.keys(CAMERA)) {
    const P = fitCamera([[frame.rect[0], frame.rect[1], 0], [frame.rect[2], frame.rect[3], 14]], mode, stage);
    for (const z of [0, 14]) {
      const world = frame.toWorld([121.5484, 25.08]);
      const back = unproject(project([world[0], world[1], z], P), P, z);
      close(back[0], world[0], 1e-6, mode);
      close(back[1], world[1], 1e-6, mode);
    }
  }
});

test('縮放與平移：縮放不動游標下的點，視窗中心不離開內容，比例尺取整數', () => {
  const stage = { width: 800, height: 600 };
  const zoomed = zoomAbout(IDENTITY, 2, [200, 150]);
  assert.deepEqual(applyView(zoomed, [200, 150]), [200, 150]);
  const clamped = clampView({ k: 3, x: -99999, y: 99999 }, stage, [0, 0, 800, 600], 8);
  const [cx, cy] = viewCenter(clamped, stage);
  assert.ok(cx <= 800 && cy >= 0);
  assert.deepEqual(clampView({ k: 0.2, x: 50, y: 50 }, stage, [0, 0, 800, 600], 8), { k: 1, x: 0, y: 0 });
  assert.equal(clampView({ k: 99, x: 0, y: 0 }, stage, [0, 0, 800, 600], 8).k, 8);
  // 平面視角（strict）：不露出圖框外的空白
  const strict = (view, extra) => clampView(view, stage, [0, 0, 800, 600], 8, { strict: true, ...extra });
  assert.deepEqual(strict({ k: 2, x: 500, y: 500 }), { k: 2, x: 0, y: 0 });
  assert.deepEqual(strict({ k: 2, x: -5000, y: -5000 }), { k: 2, x: -800, y: -600 });
  assert.deepEqual(strict({ k: 1, x: -40, y: 70 }), { k: 1, x: 0, y: 0 });
  // 下方被面板遮住 200px：可以把地圖往上推 200px，讓下緣露出來，但不能更多
  assert.deepEqual(strict({ k: 1, x: 0, y: -999 }, { insetBottom: 200 }), { k: 1, x: 0, y: -200 });
  assert.deepEqual(strict({ k: 1, x: 0, y: 50 }, { insetBottom: 200 }), { k: 1, x: 0, y: 0 });
  const centred = clampView(centerOn(IDENTITY, [400, 500], { width: 800, height: 400 }, 1), stage, [0, 0, 800, 600], 8, { strict: true, insetBottom: 200 });
  assert.deepEqual(applyView(centred, [400, 500]), [400, 300], '圖釘靠近下緣時，仍會落在面板上方看得到的地方');
  assert.deepEqual(viewCenter(centerOn(IDENTITY, [100, 100], stage, 2), stage), [100, 100]);
  const bar = scaleBar(171);
  assert.equal(bar.meters, 20000);
  assert.equal(bar.label, '20 公里');
  assert.equal(scaleBar(1.3).label, '100 公尺');
});

// ---- 場景 ----

test('場景：只有已定位的案卷有圖釘，平面與立體落在同一個經緯度', () => {
  const layers = realLayers();
  const model = buildModel(layers);
  const stage = { width: 900, height: 620 };
  const scenes = Object.fromEntries(['plan', 'iso'].map((mode) => [mode, buildRegionScene({ data: geoOf(layers), sceneId: 'overview', mode, stage, projects: model.projects })]));
  for (const scene of Object.values(scenes)) {
    assert.deepEqual(scene.pins.map((pin) => pin.projectId).sort(), ['hsinchu-county-baozhong-road', 'new-taipei-siyuan-footbridge', 'taipei-peiying-housing']);
    assert.ok(!/NaN|undefined|Infinity/.test(scene.markup), `${scene.mode} 的路徑有無效數值`);
    assert.equal(scene.districts.length, 57);
    for (const pin of scene.pins) {
      const anchor = model.projects.find((p) => p.id === pin.projectId).location.anchor;
      const back = scene.toLonLat(pin.at);
      close(back[0], anchor[0], 2e-4, `${scene.mode} 經度`);
      close(back[1], anchor[1], 2e-4, `${scene.mode} 緯度`);
    }
  }
  assert.equal(scenes.plan.ruler, null);
  assert.ok(scenes.iso.ruler.stepM > 0 && scenes.iso.ruler.majorM === scenes.iso.ruler.stepM * 5);
  assert.ok(scenes.iso.markup.includes('atl-furniture'));
  assert.ok(!scenes.plan.markup.includes('atl-furniture'), '平面視角沒有插畫配件');
  assert.ok(scenes.plan.markup.includes('atl-route'), '褒忠路線段有畫出');
});

test('場景：單一地區只墊高該地區，周邊留在底層', () => {
  const layers = realLayers();
  const model = buildModel(layers);
  const scene = buildRegionScene({ data: geoOf(layers), sceneId: 'region:hsinchu-county', mode: 'iso', stage: { width: 900, height: 620 }, projects: model.projects });
  assert.equal(scene.kind, 'region');
  assert.equal(scene.focusId, 'hsinchu-county');
  assert.ok(scene.groundZ('hsinchu-county') > scene.groundZ('hsinchu-city'));
  assert.ok(scene.labels.some((label) => label.kind === 'district' && label.text === '新埔鎮' && !label.low));
  assert.ok(scene.labels.every((label) => label.kind !== 'region' || label.id !== 'hsinchu-county'), '聚焦的地區不重複標縣名');
  assert.ok(scene.maxZoom > 2);
});

test('場景：界線沒載入時仍回傳場景並標明缺口，圖釘照畫', () => {
  const layers = realLayers(['regions', 'districts', 'scope', 'neighbors', 'land']);
  const model = buildModel(layers);
  const scene = buildRegionScene({ data: geoOf(layers), sceneId: 'overview', mode: 'plan', stage: { width: 600, height: 500 }, projects: model.projects });
  assert.deepEqual(scene.missing, { land: true, districts: true, regions: true });
  assert.equal(scene.pins.length, 3);
});

test('圖釘：沒有階段紀錄時釘頭是中性點，不借用其他階段的字', () => {
  assert.ok(pinArt({ stage: null }).includes('data-stage="none"'));
  assert.ok(pinArt({ stage: null }).includes('>·</text>'));
  assert.ok(pinArt({ stage: 'completion', precision: 'site' }).includes('>完</text>'));
  assert.ok(pinArt({ stage: 'construction', precision: 'street' }).includes('data-precision="street"'));
});

test('示意建物高度：樓層與缺值有上限，不當成政績分數', () => {
  assert.equal(illustrativeBuildingHeight({}), 2.2);
  assert.ok(illustrativeBuildingHeight({ levels: 14 }) > illustrativeBuildingHeight({ levels: 3 }));
  assert.equal(illustrativeBuildingHeight({ levels: 99 }), 14);
  assert.ok(illustrativeBuildingHeight({ height_m: 40 }) <= 14);
});

test('現地沙盤：培英案有施工範圍與圖釘，平面與立體共座標', () => {
  const layers = realLayers();
  const model = buildModel(layers);
  const project = model.projects.find((item) => item.id === 'taipei-peiying-housing');
  assert.equal(project.hasSite, true);
  const site = readJson('public/data/geo/sites/taipei-peiying-housing.geojson');
  const stage = { width: 900, height: 620 };
  const plan = buildSiteScene({ site, project, mode: 'plan', stage });
  const iso = buildSiteScene({ site, project, mode: 'iso', stage });
  assert.equal(plan.kind, 'site');
  assert.equal(plan.projectId, 'taipei-peiying-housing');
  assert.equal(plan.pins.length, 1);
  assert.ok(plan.markup.includes('atl-site-construction') || plan.markup.includes('atl-site-building'));
  assert.ok(iso.markup.includes('atl-furniture'));
  assert.ok(!plan.markup.includes('atl-furniture'));
  assert.ok(!/NaN|undefined|Infinity/.test(plan.markup + iso.markup));
  const back = plan.toLonLat(plan.pins[0].at);
  close(back[0], project.location.anchor[0], 3e-4, '現地平面經度');
  close(back[1], project.location.anchor[1], 3e-4, '現地平面緯度');
  assert.match(iso.siteMeta.buildingHeightNote, /不是預算/);
  assert.ok(iso.siteMeta.license?.id === 'odbl-1.0');
});

test('網址狀態：site 場景可序列化與還原', () => {
  const hash = serializeState({ scene: 'site:taipei-peiying-housing', view: 'iso', project: 'taipei-peiying-housing', filters: { ...EMPTY_FILTERS, region: 'taipei' }, center: [121.54844, 25.07997], zoom: 2.5 });
  assert.match(hash, /s=site:taipei-peiying-housing/);
  const state = parseState(hash);
  assert.equal(state.scene, 'site:taipei-peiying-housing');
  assert.equal(state.view, 'iso');
  assert.equal(state.project, 'taipei-peiying-housing');
});
