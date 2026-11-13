#!/usr/bin/env node
// 現地圖資：把 OpenStreetMap 原始資料整理成每案一個 GeoJSON（道路、水系、綠地、建物、軌道、工地範圍），
// 裁到以案卷位置為中心的方框。只留地物幾何與必要標籤；不帶編輯者帳號、店家或住戶資訊。
// 用法：node src/atlas/build/build-site-context.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bboxOfCoords, clipLineToRect, clipRingToRect, localProjector } from '../geo.js';
import { coordOf, loadExtract, relationRings, wayCoords } from './osm-util.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = join(root, 'public/data/geo');
mkdirSync(join(out, 'sites'), { recursive: true });
const config = JSON.parse(readFileSync(join(here, 'site-areas.json'), 'utf8'));
const sources = JSON.parse(readFileSync(join(here, 'geo-sources.json'), 'utf8'));
const license = sources.licenses['odbl-1.0'];

const ROAD = {
  motorway: 'major', trunk: 'major', primary: 'major', secondary: 'major',
  motorway_link: 'major', trunk_link: 'major', primary_link: 'major', secondary_link: 'major',
  tertiary: 'minor', tertiary_link: 'minor', unclassified: 'minor', residential: 'minor', living_street: 'minor',
  service: 'service', track: 'service',
  footway: 'path', path: 'path', cycleway: 'path', steps: 'path', pedestrian: 'path',
};
const RAIL = new Set(['rail', 'subway', 'light_rail', 'monorail', 'narrow_gauge']);
const WATERLINE = new Set(['river', 'stream', 'canal', 'drain', 'ditch']);
const GREEN_LEISURE = new Set(['park', 'garden', 'playground', 'pitch']);
const GREEN_LANDUSE = new Set(['grass', 'forest', 'meadow', 'recreation_ground', 'village_green', 'orchard']);
const GREEN_NATURAL = new Set(['wood', 'scrub', 'grassland']);
const ORDER = ['field', 'green', 'water', 'waterline', 'construction', 'road', 'planned_road', 'rail', 'building', 'station'];

const round6 = (value) => Math.round(value * 1e6) / 1e6;
const intOrNull = (value) => { const number = Number.parseFloat(value); return Number.isFinite(number) ? number : null; };
const flag = (value) => Boolean(value) && value !== 'no';

function classify(tags) {
  if (!tags) return null;
  if (tags.building && tags.building !== 'no') return { layer: 'building', kind: tags.building === 'construction' ? 'construction' : 'building', levels: intOrNull(tags['building:levels']), height_m: intOrNull(tags.height) };
  if (tags.landuse === 'construction') return { layer: 'construction', kind: tags.construction ?? 'construction', name: tags.name ?? null };
  if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir' || tags.landuse === 'basin') return { layer: 'water', kind: tags.water ?? 'water', name: tags.name ?? null };
  if (GREEN_LEISURE.has(tags.leisure)) return { layer: 'green', kind: tags.leisure, name: tags.name ?? null };
  if (GREEN_LANDUSE.has(tags.landuse)) return { layer: 'green', kind: tags.landuse, name: tags.name ?? null };
  if (GREEN_NATURAL.has(tags.natural)) return { layer: 'green', kind: tags.natural, name: null };
  if (tags.landuse === 'farmland') return { layer: 'field', kind: 'farmland', name: null };
  return null;
}
function classifyLine(tags) {
  if (!tags) return null;
  const level = intOrNull(tags.layer) ?? 0;
  if (tags.highway === 'proposed' || tags.highway === 'construction') return { layer: 'planned_road', kind: tags.highway, name: tags.name ?? null, ref: tags.ref ?? null, bridge: flag(tags.bridge), level };
  if (ROAD[tags.highway]) return { layer: 'road', kind: ROAD[tags.highway], highway: tags.highway, name: tags.name ?? null, ref: tags.ref ?? null, bridge: flag(tags.bridge), tunnel: flag(tags.tunnel), level };
  if (RAIL.has(tags.railway)) return { layer: 'rail', kind: tags.railway, name: tags.name ?? null, bridge: flag(tags.bridge), tunnel: flag(tags.tunnel), level };
  if (tags.railway === 'construction') return { layer: 'rail', kind: 'construction', name: tags.name ?? null, bridge: flag(tags.bridge), tunnel: flag(tags.tunnel), level };
  if (WATERLINE.has(tags.waterway)) return { layer: 'waterline', kind: tags.waterway, name: tags.name ?? null };
  return null;
}

const manifestFiles = [];
for (const site of config.sites) {
  const extract = loadExtract(site.project_id);
  const { toLocal, toLonLat } = localProjector(site.focus);
  const [hx, hy] = site.half_m;
  const rect = [-hx, -hy, hx, hy];
  const back = (points) => points.map((point) => toLonLat(point).map(round6));
  const features = [];
  const skipped = { incomplete_relations: [] };
  const push = (layer, properties, geometry, element) => features.push({ type: 'Feature', properties: { ...properties, osm: `${element.type}/${element.id}` }, geometry, _layer: layer, _id: element.id });

  const addPolygon = (props, outers, inners, element) => {
    const polygons = [];
    for (const outer of outers) {
      const ring = clipRingToRect(outer.map(toLocal), rect);
      if (ring.length < 4) continue;
      const rings = [back(ring)];
      for (const inner of inners) {
        const hole = clipRingToRect(inner.map(toLocal), rect);
        if (hole.length >= 4) rings.push(back(hole));
      }
      polygons.push(rings);
    }
    if (!polygons.length) return;
    push(props.layer, props, polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons }, element);
  };
  const addLine = (props, coords, element) => {
    const pieces = clipLineToRect(coords.map(toLocal), rect).map(back);
    if (!pieces.length) return;
    push(props.layer, props, pieces.length === 1 ? { type: 'LineString', coordinates: pieces[0] } : { type: 'MultiLineString', coordinates: pieces }, element);
  };

  const inRelation = new Set();
  const full = new Map((site.relations_full ?? []).map((id) => [id, loadExtract(`relation-${id}`)]));
  for (const relation of extract.relations.values()) {
    if (relation.tags?.type !== 'multipolygon') continue;
    const props = classify(relation.tags);
    if (!props) continue;
    const source = full.get(relation.id) ?? extract;
    const rings = relationRings(source.relations.get(relation.id) ?? relation, source.ways, source.nodes);
    for (const member of relation.members) if (member.type === 'way' && member.role !== 'inner') inRelation.add(member.ref);
    if (rings.missing || rings.open) { skipped.incomplete_relations.push({ osm: `relation/${relation.id}`, layer: props.layer, name: relation.tags.name ?? null, missing_members: rings.missing, open_rings: rings.open }); if (!rings.outers.length) continue; }
    addPolygon(props, rings.outers, rings.inners, relation);
  }
  for (const way of extract.ways.values()) {
    const tags = way.tags;
    if (!tags) continue;
    const closed = way.nodes.length >= 4 && way.nodes[0] === way.nodes[way.nodes.length - 1];
    const line = classifyLine(tags);
    if (line && !(closed && tags.area === 'yes')) { addLine(line, wayCoords(way, extract.nodes), way); continue; }
    if (!closed) continue;
    const props = classify(tags);
    if (!props) continue;
    if (inRelation.has(way.id) && !tags.building) continue;
    addPolygon(props, [wayCoords(way, extract.nodes)], [], way);
  }
  for (const node of extract.nodes.values()) {
    if (node.tags?.railway !== 'station' || !node.tags.name) continue;
    const [x, y] = toLocal(coordOf(node));
    if (x < rect[0] || x > rect[2] || y < rect[1] || y > rect[3]) continue;
    push('station', { layer: 'station', kind: node.tags.station ?? 'station', name: node.tags.name, ref: node.tags.ref ?? null, network: node.tags.network ?? null }, { type: 'Point', coordinates: coordOf(node).map(round6) }, node);
  }

  features.sort((a, b) => ORDER.indexOf(a._layer) - ORDER.indexOf(b._layer) || a._id - b._id);
  const counts = {};
  for (const feature of features) { counts[feature._layer] = (counts[feature._layer] ?? 0) + 1; delete feature._layer; delete feature._id; }
  const corners = [[-hx, -hy], [hx, hy]].map((point) => toLonLat(point).map(round6));
  const metadata = {
    project_id: site.project_id,
    source: {
      name: 'OpenStreetMap',
      api_url: extract.meta.url,
      retrieved_at: extract.meta.retrieved_at,
      raw_sha256: extract.meta.sha256,
      extra_relations: [...full.values()].map((item) => ({ url: item.meta.url, retrieved_at: item.meta.retrieved_at, raw_sha256: item.meta.sha256 })),
    },
    license: { id: 'odbl-1.0', name: license.name, url: license.url, attribution: license.attribution },
    frame: { center: site.focus, half_m: site.half_m, bbox: [corners[0][0], corners[0][1], corners[1][0], corners[1][1]] },
    counts,
    skipped,
    note: '周邊地物來自 OpenStreetMap 志願者製圖，僅作現地脈絡，不是工程或政策的官方範圍。建物樓層為 null 表示來源未標示。',
  };
  const text = `${JSON.stringify({ type: 'FeatureCollection', name: `site-${site.project_id}`, metadata, bbox: bboxOfCoords(features.map((f) => f.geometry.coordinates)).map(round6) }).slice(0, -1)},"features":[\n${features.map((feature) => JSON.stringify(feature)).join(',\n')}\n]}\n`;
  const path = `public/data/geo/sites/${site.project_id}.geojson`;
  writeFileSync(join(root, path), text);
  manifestFiles.push({ path, project_id: site.project_id, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), features: features.length, counts, source_retrieved_at: extract.meta.retrieved_at });
  console.log(`${path}  ${features.length} features  ${Buffer.byteLength(text)} bytes  ${JSON.stringify(counts)}${skipped.incomplete_relations.length ? `  未閉合 relation ${skipped.incomplete_relations.length}` : ''}`);
}

const manifestFile = join(out, 'manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { schema_version: 1 };
manifest.site_context = {
  source: { name: 'OpenStreetMap', api: config.api, license: 'odbl-1.0', attribution: license.attribution, copyright_url: 'https://www.openstreetmap.org/copyright' },
  note: '每個已定位案卷一個現地方框；衍生資料依 ODbL 1.0 釋出。',
  files: manifestFiles,
};
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
