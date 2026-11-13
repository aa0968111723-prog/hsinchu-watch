#!/usr/bin/env node
// 行政界線建置：下載（或讀快取）→ 解壓 → mapshaper 過濾與拓樸簡化 → 正規化屬性 → 寫 GeoJSON。
// 用法：node src/atlas/build/build-boundaries.mjs [--refresh]
// 原始壓縮檔留在 .cache/（不進版控）；網址、下載時間與 sha256 寫進 public/data/geo/manifest.json。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const cache = join(here, '.cache');
const raw = join(cache, 'raw');
const shp = join(cache, 'shp');
const tmp = join(cache, 'tmp');
const out = join(root, 'public/data/geo');
const config = JSON.parse(readFileSync(join(here, 'geo-sources.json'), 'utf8'));
const refresh = process.argv.includes('--refresh');
const UA = 'hsinchu-watch-atlas/0.1 (public-interest civic map; github.com/aa0968111723-prog/hsinchu-watch)';
for (const dir of [raw, shp, tmp, join(out, 'boundaries')]) mkdirSync(dir, { recursive: true });

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const nowIso = () => {
  const d = new Date();
  const offset = -d.getTimezoneOffset();
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + offset * 60000).toISOString().slice(0, 19);
  return `${local}${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)}`;
};

async function ensureRaw(source) {
  const file = join(raw, source.cache_name);
  const metaFile = `${file}.meta.json`;
  if (!refresh && existsSync(file) && existsSync(metaFile)) {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    const buffer = readFileSync(file);
    if (sha256(buffer) !== meta.sha256) throw new Error(`快取雜湊不符：${source.cache_name}`);
    return { buffer, meta };
  }
  const response = await fetch(encodeURI(source.download_url), { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`下載失敗 ${response.status}：${source.download_url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const meta = {
    url: source.download_url,
    retrieved_at: nowIso(),
    bytes: buffer.length,
    sha256: sha256(buffer),
    http_last_modified: response.headers.get('last-modified'),
  };
  writeFileSync(file, buffer);
  writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  return { buffer, meta };
}

// 最小 ZIP 讀取：只取檔名為 ASCII 的 shapefile 組件。
function unzip(buffer, wanted) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('不是有效的 ZIP');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('ZIP 目錄損毀');
    const method = buffer.readUInt16LE(at + 10);
    const packed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('latin1');
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const body = buffer.subarray(start, start + packed);
    if (method !== 0 && method !== 8) throw new Error(`不支援的壓縮方式 ${method}：${name}`);
    files.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
  }
  return files;
}

function mapshaper(args) {
  const npxCli = join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');
  const spec = `mapshaper@${config.tool.version}`;
  const result = existsSync(npxCli)
    ? spawnSync(process.execPath, [npxCli, '-y', spec, ...args], { cwd: cache, stdio: 'inherit' })
    : spawnSync('npx', ['-y', spec, ...args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`)], { cwd: cache, stdio: 'inherit', shell: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`mapshaper 結束碼 ${result.status}`);
}

const round5 = (value) => Math.round(value * 1e5) / 1e5;
function bboxOf(features) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      w = Math.min(w, coords[0]); e = Math.max(e, coords[0]);
      s = Math.min(s, coords[1]); n = Math.max(n, coords[1]);
    } else coords.forEach(visit);
  };
  features.forEach((feature) => visit(feature.geometry.coordinates));
  return [w, s, e, n].map(round5);
}
const countVertices = (features) => {
  let total = 0;
  const visit = (coords) => { if (typeof coords[0] === 'number') total += 1; else coords.forEach(visit); };
  features.forEach((feature) => visit(feature.geometry.coordinates));
  return total;
};
function writeCollection(name, metadata, features) {
  const head = JSON.stringify({ type: 'FeatureCollection', name, metadata, bbox: bboxOf(features) }).slice(0, -1);
  const text = `${head},"features":[\n${features.map((feature) => JSON.stringify(feature)).join(',\n')}\n]}\n`;
  const file = join(out, 'boundaries', `${name}.geojson`);
  writeFileSync(file, text);
  return { path: `public/data/geo/boundaries/${name}.geojson`, bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text)), features: features.length, vertices: countVertices(features), bbox: bboxOf(features) };
}

const regions = new Map(config.regions.map((region) => [region.county_code, region]));
const { simplify } = config;
const sources = {};
for (const [key, source] of Object.entries(config.boundaries)) {
  const { buffer, meta } = await ensureRaw(source);
  const parts = unzip(buffer, (name) => name.startsWith(`${source.layer}.`) && /\.(shp|shx|dbf|prj|cpg)$/i.test(name));
  if (!parts.has(`${source.layer}.shp`)) throw new Error(`壓縮檔缺少 ${source.layer}.shp`);
  for (const [name, body] of parts) writeFileSync(join(shp, name), body);
  sources[key] = { ...source, retrieved_at: meta.retrieved_at, raw_bytes: meta.bytes, raw_sha256: meta.sha256, http_last_modified: meta.http_last_modified, prj: parts.get(`${source.layer}.prj`)?.toString('utf8').trim() ?? null };
}

const codes = JSON.stringify([...regions.keys()]);
const everyCode = JSON.stringify([...regions.keys(), ...config.neighbors.county_codes]);
const label = 'label_lon = Math.round(this.innerX * 1e5) / 1e5, label_lat = Math.round(this.innerY * 1e5) / 1e5';
const precision = `precision=${simplify.precision_deg}`;
// 四個地區與相鄰縣市放在同一個拓樸裡一起簡化，共用邊界才會完全重合。
mapshaper([
  '-i', `shp/${config.boundaries.town.layer}.shp`, 'encoding=utf8', 'name=all',
  '-filter', `${everyCode}.indexOf(COUNTYCODE) > -1`,
  '-each', 'area_km2 = Math.round(this.area / 1e4) / 100',
  '-clip', `bbox=${config.neighbors.clip_bbox.join(',')}`,
  '-simplify', `interval=${simplify.districts_interval_m}`, 'keep-shapes',
  '-clean',
  '-filter', `${codes}.indexOf(COUNTYCODE) > -1`, '+', 'name=districts',
  '-each', label, 'target=districts',
  '-o', 'target=districts', precision, 'tmp/districts.geojson', 'force',
  '-dissolve', 'COUNTYCODE', 'copy-fields=COUNTYNAME', 'sum-fields=area_km2', 'target=districts', '+', 'name=regions',
  '-each', label, 'target=regions',
  '-o', 'target=regions', precision, 'tmp/regions.geojson', 'force',
  '-dissolve', 'target=districts', '+', 'name=scope',
  '-o', 'target=scope', precision, 'tmp/scope-outline.geojson', 'force',
  '-filter', `${codes}.indexOf(COUNTYCODE) === -1`, 'target=all', '+', 'name=neighbortowns',
  '-dissolve', 'COUNTYCODE', 'copy-fields=COUNTYNAME', 'target=neighbortowns', '+', 'name=neighbors',
  '-each', label, 'target=neighbors',
  '-o', 'target=neighbors', precision, 'tmp/neighbors.geojson', 'force',
  '-dissolve', 'target=all', '+', 'name=land',
  '-o', 'target=land', precision, 'tmp/land-outline.geojson', 'force',
]);
mapshaper([
  '-i', `shp/${config.boundaries.county.layer}.shp`, 'encoding=utf8',
  '-each', 'area_km2 = Math.round(this.area / 1e4) / 100',
  '-simplify', `interval=${simplify.taiwan_interval_m}`, 'keep-shapes',
  '-filter-islands', `min-area=${simplify.taiwan_min_island_km2}km2`,
  '-clean',
  '-each', label,
  '-o', 'precision=0.0001', 'tmp/taiwan-counties.geojson', 'force',
]);

// 沒有屬性的圖層，mapshaper 會輸出 GeometryCollection；兩種都讀成 feature 陣列。
const read = (name) => {
  const parsed = JSON.parse(readFileSync(join(tmp, name), 'utf8'));
  if (parsed.type === 'FeatureCollection') return parsed.features;
  if (parsed.type === 'GeometryCollection') return parsed.geometries.map((geometry) => ({ type: 'Feature', properties: {}, geometry }));
  throw new Error(`${name} 不是 FeatureCollection 或 GeometryCollection`);
};
const crsNote = '來源坐標系統為 TWD97[2020] 經緯度（GRS80）。與 WGS84 的差距在公尺級以內，小於本檔簡化容許誤差，未另做基準轉換；座標順序為 [經度, 緯度]。';
const metaOf = (key, extra) => {
  const source = sources[key];
  const license = config.licenses[source.license];
  return {
    source: { publisher: source.publisher, dataset_title: source.dataset_title, dataset_url: source.dataset_url, download_url: source.download_url, data_version: source.data_version, retrieved_at: source.retrieved_at },
    license: { id: source.license, name: license.name, url: license.url, attribution: license.attribution },
    crs_note: crsNote,
    ...extra,
  };
};

const districts = read('districts.geojson')
  .map((feature) => {
    const p = feature.properties;
    const region = regions.get(p.COUNTYCODE);
    return {
      type: 'Feature',
      id: p.TOWNCODE,
      properties: { id: p.TOWNCODE, name: p.TOWNNAME, name_en: p.TOWNENG, region_id: region.id, county_code: p.COUNTYCODE, county_name: p.COUNTYNAME, area_km2: p.area_km2, label: [p.label_lon, p.label_lat] },
      geometry: feature.geometry,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
const regionFeatures = read('regions.geojson')
  .map((feature) => {
    const p = feature.properties;
    const region = regions.get(p.COUNTYCODE);
    return {
      type: 'Feature',
      id: region.id,
      properties: { id: region.id, name: region.name, display_name: region.display_name, county_code: p.COUNTYCODE, area_km2: Math.round(p.area_km2 * 100) / 100, district_count: districts.filter((d) => d.properties.region_id === region.id).length, label: [p.label_lon, p.label_lat] },
      geometry: feature.geometry,
    };
  })
  .sort((a, b) => config.regions.findIndex((r) => r.id === a.id) - config.regions.findIndex((r) => r.id === b.id));
const taiwan = read('taiwan-counties.geojson')
  .map((feature) => {
    const p = feature.properties;
    return {
      type: 'Feature',
      id: p.COUNTYCODE,
      properties: { id: p.COUNTYCODE, name: p.COUNTYNAME, name_en: p.COUNTYENG, region_id: regions.get(p.COUNTYCODE)?.id ?? null, area_km2: p.area_km2, label: [p.label_lon, p.label_lat] },
      geometry: feature.geometry,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

if (regionFeatures.length !== config.regions.length) throw new Error(`地區數不符：${regionFeatures.length}`);
const clipNote = `裁到經緯度範圍 [${config.neighbors.clip_bbox.join(', ')}]，範圍外的部分不在檔案內。`;
const neighbors = read('neighbors.geojson')
  .map((feature) => {
    const p = feature.properties;
    return { type: 'Feature', id: p.COUNTYCODE, properties: { id: p.COUNTYCODE, name: p.COUNTYNAME, in_scope: false, clipped: true, label: [p.label_lon, p.label_lat] }, geometry: feature.geometry };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
const outline = (file, id, name) => read(file).map((feature) => ({ type: 'Feature', id, properties: { id, name }, geometry: feature.geometry }));
const scope = outline('scope-outline.geojson', 'scope', '臺北市、新北市、新竹縣、新竹市合併外框');
const land = outline('land-outline.geojson', 'land', '四個地區與相鄰縣市合併的陸地外框');
if (scope.length !== 1 || land.length !== 1) throw new Error('合併外框應各為一個圖徵');
const processing = (interval) => `mapshaper ${config.tool.version}：weighted Visvalingam 拓樸簡化 interval=${interval}m、keep-shapes、clean；面積由簡化前的來源幾何計算（球面面積）。`;
const fine = processing(simplify.districts_interval_m);
const files = [
  writeCollection('districts', metaOf('town', { processing: fine, scope: '臺北市、新北市、新竹縣、新竹市的鄉鎮市區' }), districts),
  writeCollection('regions', metaOf('town', { processing: `${fine} 再依縣市代碼合併鄉鎮市區，確保與 districts 邊界一致。`, scope: '臺北市、新北市、新竹縣、新竹市' }), regionFeatures),
  writeCollection('scope-outline', metaOf('town', { processing: `${fine} 四個地區合併成一個外框，立體視角畫側壁用。`, scope: '臺北市、新北市、新竹縣、新竹市' }), scope),
  writeCollection('neighbors', metaOf('town', { processing: `${fine} 與四個地區同一拓樸簡化後依縣市合併。${clipNote}`, scope: `周邊縣市（${neighbors.map((item) => item.properties.name).join('、')}）在圖框內的部分；只作周邊底圖，不在案卷涵蓋範圍`, clip_bbox: config.neighbors.clip_bbox }), neighbors),
  writeCollection('land-outline', metaOf('town', { processing: `${fine} 四個地區與相鄰縣市合併成陸地外框。${clipNote}`, scope: '圖框內陸地外框' }), land),
  writeCollection('taiwan-counties', metaOf('county', { processing: `${processing(simplify.taiwan_interval_m)} 面積小於 ${simplify.taiwan_min_island_km2} km² 的島嶼在此底圖略去。`, scope: '全國直轄市、縣市（位置示意與後續擴充用）' }), taiwan),
];

const manifestFile = join(out, 'manifest.json');
const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
const manifest = {
  ...previous,
  schema_version: 1,
  generated_at: nowIso(),
  licenses: config.licenses,
  crs_note: crsNote,
  boundaries: {
    tool: config.tool,
    simplify,
    sources: Object.fromEntries(Object.entries(sources).map(([key, s]) => [key, { publisher: s.publisher, dataset_id: s.dataset_id, dataset_title: s.dataset_title, dataset_url: s.dataset_url, download_url: s.download_url, license: s.license, data_version: s.data_version, data_version_note: s.data_version_note, retrieved_at: s.retrieved_at, http_last_modified: s.http_last_modified, raw_bytes: s.raw_bytes, raw_sha256: s.raw_sha256, source_prj: s.prj }])),
    files,
  },
};
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
for (const file of files) console.log(`${file.path}  ${file.features} features  ${file.vertices} vertices  ${file.bytes} bytes`);
for (const region of regionFeatures) console.log(`${region.properties.name}  ${region.properties.area_km2} km²  ${region.properties.district_count} 區`);
