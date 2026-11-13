// 資料測試：位置、階段、界線與圖資清單是否符合共用契約，且每個座標都有可查的依據。執行：node --test tests/map
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { distanceToRingM, haversine, lineLength, pointInGeometry } from '../../src/atlas/geo.js';
import { STAGE_IDS, latestDocumentedStage } from '../../src/atlas/model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const geo = join(root, 'public/data/geo');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const governance = readJson(join(root, 'public/data/governance.json'));
const registry = readJson(join(root, 'public/data/governance-registry.json'));
const locationsFile = readJson(join(geo, 'project-locations.json'));
const stagesFile = readJson(join(geo, 'project-stages.json'));
const manifest = readJson(join(geo, 'manifest.json'));
const districts = readJson(join(geo, 'boundaries/districts.geojson'));
const regions = readJson(join(geo, 'boundaries/regions.geojson'));
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isHttps = (value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const TAIWAN = [118, 21.5, 123, 26.5];
const inTaiwan = ([lon, lat]) => lon > TAIWAN[0] && lon < TAIWAN[2] && lat > TAIWAN[1] && lat < TAIWAN[3];
// 全國縣市底圖含東沙、南沙等離島，範圍比本島大。
const NATIONAL = [113, 9, 125, 27];
const inNational = ([lon, lat]) => lon > NATIONAL[0] && lon < NATIONAL[2] && lat > NATIONAL[1] && lat < NATIONAL[3];
const close = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message ?? ''} ${a} vs ${b}`);
const eachCoord = (coords, visit) => { if (typeof coords[0] === 'number') visit(coords); else coords.forEach((part) => eachCoord(part, visit)); };

test('位置：每個治理案卷都查核過，沒有多也沒有少', () => {
  const ids = governance.projects.map((project) => project.id).sort();
  assert.deepEqual(locationsFile.locations.map((item) => item.project_id).sort(), ids);
  assert.equal(locationsFile.summary.total, ids.length);
  assert.equal(locationsFile.summary.located + locationsFile.summary.pending, ids.length);
  assert.ok(isDate(locationsFile.reviewed_at));
});

test('位置：有座標的案卷符合契約（WGS84 [經度, 緯度]、精度、coordinate_source）', () => {
  const byId = new Map(governance.projects.map((project) => [project.id, project]));
  const sourceIds = new Set(locationsFile.sources.map((source) => source.id));
  const located = locationsFile.locations.filter((item) => item.geometry);
  assert.equal(located.length, 3);
  for (const item of located) {
    assert.equal(item.region_id, byId.get(item.project_id).region_id, item.project_id);
    assert.ok(['Point', 'LineString'].includes(item.geometry.type), item.project_id);
    eachCoord(item.geometry.coordinates, (point) => { assert.equal(point.length, 2); assert.ok(inTaiwan(point), `${item.project_id} 座標順序或範圍錯誤`); });
    assert.ok(inTaiwan(item.anchor));
    assert.ok(['site', 'street', 'area'].includes(item.location_precision), item.project_id);
    const source = item.coordinate_source;
    assert.ok(isHttps(source.url) && isDate(source.checked_at) && source.basis.length > 20, `${item.project_id} coordinate_source 不完整`);
    assert.ok(sourceIds.has(source.source_id) && sourceIds.has(item.location_text_source_id));
    assert.ok(item.location_text.length > 10, '要有位置原文');
    assert.equal(item.pending, null);
    assert.ok(item.caveats.length >= 1, '要寫明座標的限制');
    assert.ok(existsSync(join(geo, item.site_context)), `${item.project_id} 現地圖資不存在`);
  }
});

test('位置：座標真的落在所寫的行政區內，而且不是行政區或縣市的中心點', () => {
  for (const item of locationsFile.locations.filter((entry) => entry.anchor)) {
    const district = districts.features.find((feature) => pointInGeometry(item.anchor, feature.geometry));
    assert.ok(district, `${item.project_id} 不在四個地區內`);
    assert.equal(district.id, item.district.id);
    assert.equal(district.properties.name, item.district.name);
    assert.equal(district.properties.region_id, item.region_id);
    const region = regions.features.find((feature) => feature.id === item.region_id);
    assert.ok(haversine(item.anchor, district.properties.label) > 150, `${item.project_id} 座標與行政區標註點幾乎重合`);
    assert.ok(haversine(item.anchor, region.properties.label) > 150, `${item.project_id} 座標與縣市標註點幾乎重合`);
  }
});

test('位置：線段案卷的長度與原文相符，圖釘在線上', () => {
  const road = locationsFile.locations.find((item) => item.project_id === 'hsinchu-county-baozhong-road');
  const length = lineLength(road.geometry.coordinates);
  assert.equal(Math.round(length), road.coordinate_source.computed_length_m);
  assert.ok(Math.abs(length - 1360) / 1360 < 0.05, `線長 ${length}`);
  assert.ok(distanceToRingM(road.anchor, road.geometry.coordinates) < 1, '圖釘不在線段上');
  // 這段路接近直線，起點到圖釘的直線距離應該接近線長的一半。
  close(haversine(road.geometry.coordinates[0], road.anchor), length / 2, 60, '圖釘應在線段中點附近');
  const check = road.corroboration.find((entry) => entry.kind === 'length_check');
  assert.equal(check.official_length_m, 1360);
});

test('位置：交叉核對的數值如實記錄，不把不符寫成相符', () => {
  const peiying = locationsFile.locations.find((item) => item.project_id === 'taipei-peiying-housing');
  const polygon = peiying.corroboration.find((entry) => entry.kind === 'osm_site_polygon');
  assert.equal(polygon.marker_inside, false);
  assert.ok(polygon.marker_distance_m > 0 && polygon.marker_distance_m <= polygon.max_marker_distance_m);
  assert.ok(polygon.difference_pct < 0, 'OSM 範圍比原文基地面積小，要照實寫');
  assert.ok(peiying.caveats.some((text) => text.includes('不完全重合')));
  const village = peiying.corroboration.find((entry) => entry.kind === 'nlsc_village');
  assert.ok(village.result.includes('永安里') && isHttps(village.url) && isDate(village.checked_at));
  const siyuan = locationsFile.locations.find((item) => item.project_id === 'new-taipei-siyuan-footbridge');
  assert.equal(siyuan.location_precision, 'street', '路口不是基地點位');
  assert.ok(siyuan.coordinate_source.basis.includes('不是天橋落墩'));
});

test('待定位：沒有座標就是 null，並寫明原因與下一步', () => {
  const pending = locationsFile.locations.filter((item) => !item.geometry);
  assert.deepEqual(pending.map((item) => item.project_id), ['hsinchu-city-xiangshan-four']);
  for (const item of pending) {
    assert.equal(item.geometry, null);
    assert.equal(item.anchor, null);
    assert.equal(item.district, null);
    assert.equal(item.coordinate_source, null);
    assert.equal(item.location_precision, 'unknown');
    assert.equal(item.site_context, null);
    assert.ok(item.pending.reason.length > 20 && item.pending.next_step.length > 10);
    for (const clue of item.pending.clues) assert.ok(clue.text.includes('不是工程位置') && isHttps(clue.url));
  }
});

test('階段：七格齊全，有紀錄的格子都有日期精度、原文與來源', () => {
  const known = new Set([...registry.sources.map((source) => source.id), ...stagesFile.sources.map((source) => source.id)]);
  assert.deepEqual(stagesFile.stages.map((stage) => stage.id), STAGE_IDS);
  assert.deepEqual(stagesFile.projects.map((item) => item.project_id).sort(), governance.projects.map((project) => project.id).sort());
  for (const source of stagesFile.sources) assert.ok(isHttps(source.url) && isDate(source.checked_at));
  for (const item of stagesFile.projects) {
    assert.deepEqual(Object.keys(item.stages), STAGE_IDS, item.project_id);
    for (const id of STAGE_IDS) {
      const stage = item.stages[id];
      assert.ok(Object.hasOwn(stagesFile.status_legend, stage.status), `${item.project_id}.${id}`);
      if (stage.status === 'not_recorded') { assert.ok(!stage.date && !stage.source_id, `${item.project_id}.${id} 未收錄卻帶日期或來源`); continue; }
      assert.ok(known.has(stage.source_id) && stage.quote.length > 5, `${item.project_id}.${id} 缺原文或來源`);
      if (stage.status === 'stated_undated') assert.equal(stage.date, null);
      else {
        assert.ok(['day', 'month', 'year'].includes(stage.precision));
        assert.match(stage.date, stage.precision === 'day' ? /^\d{4}-\d{2}-\d{2}$/ : stage.precision === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}$/);
      }
    }
    assert.equal(item.latest_documented_stage, latestDocumentedStage(item.stages), item.project_id);
    for (const entry of [...item.other_records, ...item.figures, ...item.facts, ...item.relations]) assert.ok(known.has(entry.source_id) && entry.quote, `${item.project_id} 的附屬紀錄缺來源或原文`);
    for (const figure of item.figures) assert.ok(Number.isFinite(figure.value_twd) && figure.value_twd > 0 && figure.note);
    for (const relation of item.relations) assert.ok(['agency', 'person'].includes(relation.type) && relation.relation_label);
  }
});

test('階段：不從完工推到驗收或啟用，補辦土地公告不算任何工程階段', () => {
  const byId = new Map(stagesFile.projects.map((item) => [item.project_id, item]));
  const peiying = byId.get('taipei-peiying-housing');
  assert.equal(peiying.stages.completion.status, 'documented');
  assert.equal(peiying.stages.acceptance.status, 'in_preparation');
  assert.equal(peiying.stages.opening.status, 'not_recorded');
  assert.equal(peiying.stages.outcome.status, 'not_recorded');
  const xiangshan = byId.get('hsinchu-city-xiangshan-four');
  assert.ok(STAGE_IDS.every((id) => xiangshan.stages[id].status === 'not_recorded'));
  assert.equal(xiangshan.latest_documented_stage, null);
  assert.ok(xiangshan.other_records.length >= 1);
  const people = byId.get('hsinchu-county-baozhong-road').relations.filter((relation) => relation.type === 'person');
  assert.ok(people.length > 0 && people.every((relation) => relation.relation === 'attended_ceremony'), '人物只記來源寫的參與方式');
  assert.ok(byId.get('hsinchu-county-baozhong-road').relations_note.includes('不代表'));
});

test('階段與案卷一致：階段日期在案卷事件裡找得到，經費沒有被改寫', () => {
  const byId = new Map(governance.projects.map((project) => [project.id, project]));
  const overlay = new Map(stagesFile.projects.map((item) => [item.project_id, item]));
  const peiying = byId.get('taipei-peiying-housing');
  for (const id of ['construction', 'completion', 'acceptance']) assert.ok(peiying.events.some((event) => event.date === overlay.get(peiying.id).stages[id].date), id);
  assert.equal(overlay.get('hsinchu-county-baozhong-road').stages.construction.date, byId.get('hsinchu-county-baozhong-road').events[0].date);
  const figures = overlay.get('hsinchu-county-baozhong-road').figures;
  assert.equal(figures.reduce((sum, figure) => sum + figure.value_twd, 0), byId.get('hsinchu-county-baozhong-road').budget.approved_twd, '中央款加地方款應等於核定經費');
  assert.equal(byId.get('taipei-peiying-housing').budget, null, '培英案的金額用語不明，案卷經費維持 null');
});

test('界線：57 個鄉鎮市區、4 個地區，代碼不重複，附來源與授權', () => {
  assert.equal(districts.features.length, 57);
  assert.equal(new Set(districts.features.map((feature) => feature.id)).size, 57);
  assert.deepEqual(regions.features.map((feature) => feature.id), ['taipei', 'new-taipei', 'hsinchu-county', 'hsinchu-city']);
  const counts = {};
  for (const feature of districts.features) counts[feature.properties.region_id] = (counts[feature.properties.region_id] ?? 0) + 1;
  assert.deepEqual(counts, { taipei: 12, 'new-taipei': 29, 'hsinchu-county': 13, 'hsinchu-city': 3 });
  for (const file of readdirSync(join(geo, 'boundaries'))) {
    const collection = readJson(join(geo, 'boundaries', file));
    assert.equal(collection.type, 'FeatureCollection', file);
    assert.equal(collection.metadata.license.id, 'ogdl-tw-1.0', file);
    assert.ok(collection.metadata.source.publisher.includes('國土測繪中心') && isHttps(collection.metadata.source.dataset_url), file);
    for (const feature of collection.features) {
      assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry.type), file);
      const inside = file === 'taiwan-counties.geojson' ? inNational : inTaiwan;
      eachCoord(feature.geometry.coordinates, (point) => assert.ok(inside(point), `${file} 座標超出範圍 ${point}`));
      for (const rings of feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates) for (const ring of rings) assert.deepEqual(ring[0], ring[ring.length - 1], `${file} 有未閉合的環`);
    }
  }
  for (const feature of readJson(join(geo, 'boundaries/neighbors.geojson')).features) assert.equal(feature.properties.in_scope, false);
});

test('圖資清單：雜湊、位元組數與檔案一致，來源有下載時間', () => {
  const files = [...manifest.boundaries.files, ...manifest.site_context.files, manifest.project_locations];
  assert.ok(files.length >= 10);
  for (const file of files) {
    const raw = readFileSync(join(root, file.path));
    assert.equal(raw.length, file.bytes, file.path);
    assert.equal(createHash('sha256').update(raw).digest('hex'), file.sha256, file.path);
  }
  for (const source of Object.values(manifest.boundaries.sources)) {
    assert.match(source.raw_sha256, /^[0-9a-f]{64}$/);
    assert.ok(source.retrieved_at.startsWith('2026-') && isHttps(source.dataset_url) && source.license === 'ogdl-tw-1.0');
  }
  assert.ok(isHttps(manifest.licenses['ogdl-tw-1.0'].url) && isHttps(manifest.licenses['odbl-1.0'].url));
  assert.equal(manifest.site_context.source.license, 'odbl-1.0');
});

test('現地圖資：標明 OpenStreetMap 與 ODbL，不帶編輯者帳號，也沒有發布稽核禁止的欄位', () => {
  const forbidden = new Set(['author', 'username', 'user_name', 'screen_name', 'commenter_id', 'commenter_name', 'account', 'user_id', 'user', 'uid', 'changeset']);
  const walk = (value, path) => {
    if (Array.isArray(value)) value.forEach((child) => walk(child, path));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.has(key.toLowerCase()), `${path} 有欄位 ${key}`); walk(child, path); }
  };
  for (const file of readdirSync(join(geo, 'sites'))) {
    const collection = readJson(join(geo, 'sites', file));
    assert.equal(collection.metadata.license.id, 'odbl-1.0', file);
    assert.equal(collection.metadata.license.attribution, '© OpenStreetMap contributors', file);
    assert.ok(collection.features.length > 50 && collection.features.every((feature) => /^(node|way|relation)\/\d+$/.test(feature.properties.osm)), file);
    eachCoord(collection.features.map((feature) => feature.geometry.coordinates), (point) => assert.ok(inTaiwan(point)));
    walk(collection, file);
  }
  for (const file of ['project-locations.json', 'project-stages.json', 'manifest.json']) walk(readJson(join(geo, file)), file);
});
