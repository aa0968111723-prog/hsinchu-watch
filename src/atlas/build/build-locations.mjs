#!/usr/bin/env node
// 案卷位置：依 location-evidence.json 的查核紀錄推導幾何、做交叉核對，寫出契約格式的 project-locations.json。
// 任何核對不過（行政區不符、線長超出容許、標記不在工地範圍內）都會讓建置失敗，不會默默寫入。
// 用法：node src/atlas/build/build-locations.mjs
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceToRingM, haversine, lineLength, pointAlong, pointInGeometry, polygonAreaM2 } from '../geo.js';
import { chainWays, coordOf, loadExtract, osmRef, relationRings } from './osm-util.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = join(root, 'public/data/geo');
const evidence = JSON.parse(readFileSync(join(here, 'location-evidence.json'), 'utf8'));
const frames = new Map(JSON.parse(readFileSync(join(here, 'site-areas.json'), 'utf8')).sites.map((site) => [site.project_id, site]));
const districts = JSON.parse(readFileSync(join(out, 'boundaries/districts.geojson'), 'utf8')).features;
const governance = JSON.parse(readFileSync(join(root, 'public/data/governance.json'), 'utf8'));
const projects = new Map(governance.projects.map((project) => [project.id, project]));
const sourceIds = new Set(evidence.sources.map((source) => source.id));

const round6 = (value) => Math.round(value * 1e6) / 1e6;
const point6 = (point) => point.map(round6);
const pct = (a, b) => Math.round(((a - b) / b) * 1000) / 10;
const nowIso = () => {
  const d = new Date();
  const offset = -d.getTimezoneOffset();
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  return `${new Date(d.getTime() + offset * 60000).toISOString().slice(0, 19)}${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)}`;
};
const extracts = new Map();
const extractOf = (name) => { if (!extracts.has(name)) extracts.set(name, loadExtract(name)); return extracts.get(name); };
const withUrl = (ref) => ({ ...ref, url: `https://www.openstreetmap.org/${ref.ref}` });
const fail = (id, message) => { throw new Error(`${id}：${message}`); };

function derive(location) {
  const rule = location.derive;
  if (!rule) return { geometry: null, anchor: null, elements: [], notes: {} };
  if (rule.kind === 'fixed') return { geometry: { type: 'Point', coordinates: point6(rule.coordinates) }, anchor: point6(rule.coordinates), elements: [], notes: { published_as: rule.published_as } };
  const extract = extractOf(rule.extract);
  if (rule.kind === 'osm_nodes_centroid') {
    const nodes = rule.nodes.map((id) => extract.nodes.get(id) ?? fail(location.project_id, `OSM 快取沒有節點 ${id}`));
    const centroid = point6([nodes.reduce((sum, node) => sum + node.lon, 0) / nodes.length, nodes.reduce((sum, node) => sum + node.lat, 0) / nodes.length]);
    const spread = Math.max(...nodes.map((node) => haversine(centroid, coordOf(node))));
    return { geometry: { type: 'Point', coordinates: centroid }, anchor: centroid, elements: nodes.map((node) => withUrl(osmRef(node))), notes: { selection: rule.selection, node_spread_m: Math.round(spread * 10) / 10 } };
  }
  if (rule.kind === 'osm_way_chain') {
    const chain = chainWays(rule.ways, extract.ways, rule.from_node, rule.to_node);
    const coordinates = chain.map((id) => point6(coordOf(extract.nodes.get(id) ?? fail(location.project_id, `OSM 快取沒有節點 ${id}`))));
    const length = lineLength(coordinates);
    const difference = pct(length, rule.official_length_m);
    if (Math.abs(length - rule.official_length_m) / rule.official_length_m > rule.tolerance) fail(location.project_id, `線長 ${Math.round(length)} m 與原文 ${rule.official_length_m} m 相差 ${difference}%，超出容許`);
    return { geometry: { type: 'LineString', coordinates }, anchor: point6(pointAlong(coordinates, 0.5)), elements: rule.ways.map((id) => withUrl(osmRef(extract.ways.get(id)))), notes: { selection: rule.selection, computed_length_m: Math.round(length), official_length_m: rule.official_length_m, difference_pct: difference } };
  }
  return fail(location.project_id, `不認得的推導方式 ${rule.kind}`);
}

function corroborate(location, item, anchor, notes) {
  if (item.kind === 'osm_site_polygon') {
    const extract = extractOf(item.extract);
    const relation = extract.relations.get(item.relation) ?? fail(location.project_id, `OSM 快取沒有 relation ${item.relation}`);
    const rings = relationRings(relation, extract.ways, extract.nodes);
    if (rings.missing || rings.open || !rings.outers.length) fail(location.project_id, `relation ${item.relation} 未閉合`);
    const geometry = { type: 'Polygon', coordinates: [rings.outers[0], ...rings.inners] };
    const area = polygonAreaM2(geometry);
    const inside = pointInGeometry(anchor, geometry);
    const distance = inside ? 0 : Math.round(distanceToRingM(anchor, rings.outers[0]) * 10) / 10;
    if (distance > item.max_marker_distance_m) fail(location.project_id, `機關標記點距 OSM 工地範圍 ${distance} m，超出 ${item.max_marker_distance_m} m`);
    return { ...item, osm: withUrl(osmRef(relation)), osm_name: relation.tags?.name ?? null, osm_area_m2: Math.round(area), difference_pct: pct(area, item.official_area_m2), marker_inside: inside, marker_distance_m: distance };
  }
  if (item.kind === 'osm_feature_distance') {
    const extract = extractOf(item.extract);
    if (item.node) {
      const node = extract.nodes.get(item.node) ?? fail(location.project_id, `OSM 快取沒有節點 ${item.node}`);
      return { ...item, osm: withUrl(osmRef(node)), osm_name: node.tags?.name ?? null, osm_ref: node.tags?.ref ?? null, distance_m: Math.round(haversine(anchor, coordOf(node))) };
    }
    const relation = extract.relations.get(item.relation) ?? fail(location.project_id, `OSM 快取沒有 relation ${item.relation}`);
    const rings = relationRings(relation, extract.ways, extract.nodes);
    if (!rings.outers.length) fail(location.project_id, `relation ${item.relation} 未閉合`);
    const inside = rings.outers.some((ring) => pointInGeometry(anchor, { type: 'Polygon', coordinates: [ring] }));
    return { ...item, osm: withUrl(osmRef(relation)), osm_name: relation.tags?.name ?? null, distance_m: inside ? 0 : Math.round(Math.min(...rings.outers.map((ring) => distanceToRingM(anchor, ring)))) };
  }
  if (item.kind === 'length_check') return { ...item, computed_length_m: notes.computed_length_m, difference_pct: notes.difference_pct };
  return item;
}

const locations = evidence.locations.map((location) => {
  const project = projects.get(location.project_id) ?? fail(location.project_id, '治理案卷裡沒有這個 ID');
  if (project.region_id !== location.region_id) fail(location.project_id, `地區與案卷不符（${project.region_id}）`);
  if (!sourceIds.has(location.location_text_source_id)) fail(location.project_id, '原文來源未列在 sources');
  const { geometry, anchor, elements, notes } = derive(location);
  let district = null;
  if (anchor) {
    const feature = districts.find((item) => pointInGeometry(anchor, item.geometry)) ?? fail(location.project_id, '座標不在四個地區的任何鄉鎮市區內');
    if (feature.properties.region_id !== location.region_id) fail(location.project_id, `座標落在 ${feature.properties.county_name}${feature.properties.name}，與案卷地區不符`);
    if (location.expected_district && feature.properties.name !== location.expected_district) fail(location.project_id, `座標落在 ${feature.properties.name}，原文是 ${location.expected_district}`);
    district = { id: feature.properties.id, name: feature.properties.name, basis: '座標對 districts.geojson 做點在多邊形內判斷，並與原文行政區相符' };
    if (!location.coordinate_source?.url || !location.coordinate_source.checked_at || !location.coordinate_source.basis) fail(location.project_id, '有座標但 coordinate_source 不完整');
    if (!['site', 'street', 'area'].includes(location.location_precision)) fail(location.project_id, '有座標但精度不是 site／street／area');
  } else {
    if (location.location_precision !== 'unknown' || location.coordinate_source !== null || !location.pending?.reason) fail(location.project_id, '沒有座標的案卷必須是 unknown、coordinate_source=null，並寫明待定位原因');
  }
  const frame = location.site_frame ? frames.get(location.site_frame) : null;
  return {
    project_id: location.project_id,
    region_id: location.region_id,
    district,
    location_text: location.location_text,
    location_text_source_id: location.location_text_source_id,
    geometry,
    anchor,
    location_precision: location.location_precision,
    coordinate_source: location.coordinate_source ? { ...location.coordinate_source, ...(elements.length ? { elements } : {}), ...notes } : null,
    corroboration: (location.corroboration ?? []).map((item) => corroborate(location, item, anchor, notes)),
    caveats: location.caveats ?? [],
    pending: location.pending ?? null,
    site_context: frame ? `sites/${location.site_frame}.geojson` : null,
    site_frame: frame ? { center: frame.focus, half_m: frame.half_m } : null,
  };
});

const missing = governance.projects.filter((project) => !locations.some((location) => location.project_id === project.id)).map((project) => project.id);
if (missing.length) throw new Error(`治理案卷尚未查核位置：${missing.join('、')}`);
const byPrecision = {};
for (const location of locations) byPrecision[location.location_precision] = (byPrecision[location.location_precision] ?? 0) + 1;
const body = {
  schema_version: 1,
  generated_at: nowIso(),
  reviewed_at: evidence.reviewed_at,
  based_on: evidence.based_on,
  scope_note: evidence.scope_note,
  crs: 'GeoJSON WGS84，座標順序 [經度, 緯度]',
  precision_legend: evidence.precision_legend,
  summary: { total: locations.length, located: locations.filter((l) => l.geometry).length, pending: locations.filter((l) => !l.geometry).length, by_precision: byPrecision },
  sources: evidence.sources,
  locations,
};
const text = `${JSON.stringify(body, null, 2)}\n`;
writeFileSync(join(out, 'project-locations.json'), text);

const manifestFile = join(out, 'manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { schema_version: 1 };
manifest.project_locations = { path: 'public/data/geo/project-locations.json', bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), reviewed_at: evidence.reviewed_at, ...body.summary };
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

for (const location of locations) {
  const extra = location.coordinate_source?.computed_length_m ? `  線長 ${location.coordinate_source.computed_length_m} m（原文 ${location.coordinate_source.official_length_m} m，${location.coordinate_source.difference_pct}%）` : '';
  const checks = location.corroboration.map((item) => item.osm_area_m2 ? `OSM 工地範圍 ${item.osm_area_m2} m²（原文 ${item.official_area_m2}，${item.difference_pct}%），標記點${item.marker_inside ? '在範圍內' : `距邊緣 ${item.marker_distance_m} m`}` : item.distance_m !== undefined ? `距 ${item.osm_ref ?? ''}${item.osm_name ?? ''} ${item.distance_m} m` : '').filter(Boolean).join('；');
  console.log(`${location.project_id}  ${location.location_precision}  ${location.anchor ? location.anchor.join(',') : '待定位'}  ${location.district?.name ?? '-'}${extra}${checks ? `  ${checks}` : ''}`);
}
