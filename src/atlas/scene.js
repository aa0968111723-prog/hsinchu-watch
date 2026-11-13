// 區域尺度的地圖場景（四地區總覽與單一地區）。同一份世界座標有兩種畫法：
//   plan：正北朝上、真實比例的行政區圖。
//   iso ：放在底座上的地形模型塊（anatomy kit 的軸測投影），明確標示為示意視角。
// 兩者的地面座標完全相同，圖釘永遠落在同一個經緯度。只組 SVG 字串，不碰 DOM，Node 也能跑。
import * as k from './kit/iso-kit.mjs';
import { bboxOfCoords, clipLineToRect, clipRingToRect, ringAreaLocal } from './geo.js';
import { fitCamera, makeCenteredFrame, makeFrame, pxPerUnit, rectPlan, unproject } from './camera.js';

// 模型塊各層的高度（世界單位）。厚度只為了立體感，不代表高程或任何數值。
export const LEVEL = { feet: -15, plinth: -12, deck: 0, sea: 6, land: 9, top: 14 };
// 現地沙盤：地面之上的插畫厚度。建物高度只取 OSM 樓層／公尺做示意，絕不是預算、進度或政績分數。
export const SITE_LEVEL = { feet: -12, plinth: -9, deck: 0, pad: 1.2, buildingMin: 2.2, buildingMax: 14 };
const FALLBACK_BBOX = [120.86, 24.42, 122.02, 25.3];
const RULER_STEPS_M = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

const polygonsOf = (geometry) => (!geometry ? [] : geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
const esc = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function snapRing(points, grid) {
  const out = [];
  for (const [x, y] of points) {
    const sx = Math.round(x / grid) * grid;
    const sy = Math.round(y / grid) * grid;
    const last = out[out.length - 1];
    if (last && last[0] === sx && last[1] === sy) continue;
    out.push([sx, sy]);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

function prepRing(ring, frame, grid) {
  const clipped = clipRingToRect(ring.map(frame.toWorld), frame.rect);
  if (clipped.length < 4) return null;
  clipped.pop();
  const snapped = snapRing(clipped, grid);
  return snapped.length >= 3 ? snapped : null;
}

// 經緯度多邊形 → 世界座標、裁到圖框、對齊到次像素格點（共用邊界會對到同一組點，不會出現縫）。
function prepPolygons(geometry, frame, grid, minArea) {
  const out = [];
  for (const rings of polygonsOf(geometry)) {
    const outer = prepRing(rings[0], frame, grid);
    if (!outer || Math.abs(ringAreaLocal(outer)) < minArea) continue;
    const holes = [];
    for (let index = 1; index < rings.length; index += 1) {
      const hole = prepRing(rings[index], frame, grid);
      if (hole && Math.abs(ringAreaLocal(hole)) >= minArea) holes.push(hole);
    }
    out.push({ outer, holes });
  }
  return out;
}

const topPath = (polys, z, P) => polys.map(({ outer, holes }) => k.onTop(outer, z, P, true) + holes.map((hole) => k.onTop(hole, z, P, true)).join('')).join('');

// 坑（多邊形的洞）面向觀看者的內壁；色階公式與 kit 的 extrude 相同。
function innerWalls(ring, z0, height, P) {
  const { sinA, cosA } = k.cameraOf(P);
  const [vx, vy] = k.towardViewer(P);
  const sign = ringAreaLocal(ring) > 0 ? 1 : -1;
  const shades = [[], [], [], []];
  let crease = '';
  let outline = '';
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * sign;
    const ny = (dx / length) * sign;
    if (nx * vx + ny * vy <= 1e-9) continue;
    const lit = (nx * -sinA + ny * cosA + 1) / 2;
    const shade = Math.min(k.SHADES - 1, Math.max(0, Math.floor(lit * k.SHADES)));
    const quad = [[a[0], a[1], z0 + height], [b[0], b[1], z0 + height], [b[0], b[1], z0], [a[0], a[1], z0]].map((point) => k.iso(point, P));
    shades[shade].push(k.pathOf(quad, true));
    crease += k.pathOf([quad[0], quad[1]]);
    outline += k.pathOf([quad[3], quad[2]]);
  }
  return { shades, crease, outline };
}

// 一組多邊形的側壁：外環用 kit 的 extrude，洞用 innerWalls。回傳側壁色塊與之後要疊在頂面上的邊線。
function wallsOf(polys, z0, height, P) {
  const shades = [[], [], [], []];
  let crease = '';
  let outline = '';
  for (const { outer, holes } of polys) {
    const body = k.extrude(outer, z0, height, P, { convex: false });
    body.shades.forEach((d, index) => { if (d) shades[index].push(d); });
    crease += body.crease;
    outline += body.outline;
    for (const hole of holes) {
      const inner = innerWalls(hole, z0, height, P);
      inner.shades.forEach((list, index) => shades[index].push(...list));
      crease += inner.crease;
      outline += inner.outline;
    }
  }
  return {
    walls: shades.map((list, index) => (list.length ? `<path class="iso-shade" data-shade="${index}" d="${list.join('')}"/>` : '')).join(''),
    crease,
    outline,
  };
}

function pickRulerStep(mpu) {
  for (const meters of RULER_STEPS_M) if (meters / mpu >= 3.2) return meters;
  return RULER_STEPS_M[RULER_STEPS_M.length - 1];
}
export const formatDistance = (meters) => (meters >= 1000 ? `${meters / 1000} 公里` : `${meters} 公尺`);

// 底座與桌面配件：腳墊、底座、溝槽、螺絲、真實比例尺規、銘牌、指北盤。全部在地圖塊以外的桌面上。
function furniture(frame, P, rulerStepM, levels = LEVEL) {
  const [x0, y0, x1, y1] = frame.rect;
  const PL = { x: x0 - 15, y: y0 - 15, w: x1 - x0 + 30, d: y1 - y0 + 15 + 44, r: 7 };
  const parts = [`<path class="iso-halo" d="${k.haloOf(PL, levels.feet, 3, P)}"/>`];
  const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  for (const [x, y] of byDepth(k.corners(PL, 22))) {
    parts.push(k.solidSvg(k.cylinder(x, y, 7, levels.feet, 1.5, P, 28), { tone: 'lo', className: 'atl-wood' }));
    parts.push(k.solidSvg(k.cylinder(x, y, 5.4, levels.feet + 1.5, 1.5, P, 28), { tone: 'mid', className: 'atl-wood' }));
  }
  parts.push(k.solidSvg(k.slabOf(PL, levels.plinth, levels.deck - levels.plinth, P, 8, 1.4), { tone: 'mid', className: 'atl-wood' }));
  parts.push(k.lineSvg(k.planOutline(k.insetPlan(PL, 4.5), levels.deck, P), { tone: 'lo' }));
  const screws = k.corners(PL, 9.5);
  parts.push(k.lineSvg(screws.map(([x, y]) => k.ring(x, y, 2.1, levels.deck, P, 16)).join(''), { tone: 'lo' }));
  parts.push(k.dotsSvg(k.pointsAt(screws.map(([x, y]) => [x, y, levels.deck]), P), { size: 0.55, tone: 'mid' }));

  // 尺規：刻度間距是真實地面距離（沿東西向），平面與立體視角共用同一比例。
  const strip = { x: x0, y: y1 + 9, w: x1 - x0, d: 6.4, r: 0.8 };
  parts.push(k.solidSvg(k.slabOf(strip, levels.deck, 0.6, P, 3), { tone: 'lo', crease: 'none', className: 'atl-brass' }));
  const stepU = rulerStepM / frame.mpu;
  const edge = strip.y + 0.6;
  const ticks = { zero: '', major: '', minor: '' };
  for (let index = 0, x = x0; x <= x1 + 1e-6; index += 1, x = x0 + index * stepU) {
    const big = index % 5 === 0;
    ticks[index === 0 ? 'zero' : big ? 'major' : 'minor'] += k.lineOnTop([x, edge], [x, edge + (big ? 3.4 : 1.8)], 0.6, P);
  }
  parts.push(k.lineSvg(ticks.minor, { tone: 'lo' }), k.lineSvg(ticks.major, { tone: 'mid' }), k.lineSvg(ticks.zero, { tone: 'hi' }));

  // 銘牌：三條刻線代表印刷文字，是唯一允許停在空白面上的線。
  const plate = { x: x0 + 2, y: y1 + 22, w: 50, d: 12, r: 1.4 };
  parts.push(k.solidSvg(k.slabOf(plate, levels.deck, 0.8, P, 4), { tone: 'lo', className: 'atl-brass' }));
  parts.push(k.lineSvg(k.planOutline(k.insetPlan(plate, 1.6), 0.8, P, 4), { tone: 'faint' }));
  parts.push(k.lineSvg([[30, 3.6], [22, 6], [26, 8.4]].map(([length, dy]) => k.lineOnTop([plate.x + 7, plate.y + dy], [plate.x + 7 + length, plate.y + dy], 0.8, P)).join(''), { tone: 'lo', free: true }));
  parts.push(k.dotsSvg(k.pointsAt([[plate.x + 3.4, plate.y + 6, 0.8], [plate.x + plate.w - 3.4, plate.y + 6, 0.8]], P), { size: 0.5, tone: 'mid' }));

  // 指北盤：指針朝世界座標的正北（−y）。
  const cx = x1 - 13;
  const cy = y1 + 28;
  const top = levels.deck + 1.4;
  parts.push(k.solidSvg(k.cylinder(cx, cy, 10, levels.deck, 1.4, P, 48, 0.5), { tone: 'hi', crease: 'lo', className: 'atl-brass' }));
  parts.push(k.lineSvg(k.ring(cx, cy, 8.2, top, P, 48), { tone: 'lo' }));
  const dial = k.radialTicks(cx, cy, 8, 16, 4, top, [1, 2.1], P);
  parts.push(k.lineSvg(dial.minor, { tone: 'lo' }), k.lineSvg(dial.major, { tone: 'mid' }));
  parts.push(k.lineSvg(k.lineOnTop([cx, cy], [cx, cy + 5], top + 0.05, P), { tone: 'mid' }));
  parts.push(k.lineSvg(k.lineOnTop([cx, cy], [cx, cy - 7], top + 0.05, P), { tone: 'lit', className: 'atl-needle' }));
  parts.push(k.lineSvg(k.ring(cx, cy, 1.1, top + 0.05, P, 16), { tone: 'hi' }));
  parts.push(k.faceTextSvg(k.topMatrix([cx - 1.5, cy - 11.4], levels.deck, P), 'N', { size: 3.6, tone: 'mid' }));
  return { markup: parts.join(''), plinth: PL };
}

function graticule(frame, P) {
  const [west, north] = frame.toLonLat([frame.rect[0], frame.rect[1]]);
  const [east, south] = frame.toLonLat([frame.rect[2], frame.rect[3]]);
  const span = Math.max(east - west, north - south);
  const step = [1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01].find((value) => span / value >= 4) ?? 0.01;
  let d = '';
  for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) d += k.onTop([frame.toWorld([lon, south]), frame.toWorld([lon, north])], 0, P);
  for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) d += k.onTop([frame.toWorld([west, lat]), frame.toWorld([east, lat])], 0, P);
  return { markup: `<path class="atl-graticule" d="${d}"/>`, step };
}

/**
 * @param {object} options
 * @param {object} options.data 圖層：regions、districts、scope、neighbors、land（FeatureCollection 或 null）
 * @param {string} options.sceneId 'overview' 或 'region:<id>'
 * @param {'plan'|'iso'} options.mode
 * @param {{width:number,height:number}} options.stage 畫面大小（CSS 像素）
 * @param {Array} options.projects 檢視模型的案卷（取 location.anchor 與線段）
 */
export function buildRegionScene({ data, sceneId, mode, stage, projects = [] }) {
  const flat = mode === 'plan';
  const focusId = sceneId.startsWith('region:') ? sceneId.slice(7) : null;
  const regionFeatures = data.regions?.features ?? [];
  const focus = focusId ? regionFeatures.find((feature) => feature.id === focusId) ?? null : null;
  const base = focus ? bboxOfCoords(focus.geometry.coordinates) : regionFeatures.length ? bboxOfCoords(regionFeatures.map((feature) => feature.geometry.coordinates)) : FALLBACK_BBOX;
  const limit = data.neighbors?.metadata?.clip_bbox ?? null;
  const frame = makeFrame(base, { margin: focus ? 0.07 : 0.04, units: 520, aspect: stage.width / stage.height, limit });
  const rect = rectPlan(frame.rect);
  const rulerStepM = pickRulerStep(frame.mpu);

  let plinth = null;
  let P;
  if (flat) {
    P = fitCamera(k.boxCorners(rect, 0, 0), mode, stage, { pad: 0 });
  } else {
    const [x0, y0, x1, y1] = frame.rect;
    plinth = { x: x0 - 15, y: y0 - 15, w: x1 - x0 + 30, d: y1 - y0 + 15 + 44, r: 7 };
    P = fitCamera([...k.boxCorners(plinth, LEVEL.feet, LEVEL.deck), ...k.boxCorners(rect, LEVEL.deck, LEVEL.top)], mode, stage, { pad: 14, headroom: 34 });
  }
  const px = pxPerUnit(P);
  const grid = 0.5 / px;
  const minArea = (1.3 / px) ** 2;
  const zLand = flat ? 0 : LEVEL.land;
  const zTop = flat ? 0 : LEVEL.top;
  const raised = (regionId) => !focusId || regionId === focusId;
  const zOf = (regionId) => (raised(regionId) ? zTop : zLand);

  const parts = [];
  let furnitureInfo = null;
  if (!flat) {
    furnitureInfo = furniture(frame, P, rulerStepM);
    parts.push(`<g class="atl-furniture">${furnitureInfo.markup}</g>`);
    parts.push(k.solidSvg(k.slabOf(rect, LEVEL.deck, LEVEL.sea - LEVEL.deck, P, 1, 0.5), { tone: 'mid', className: 'atl-sea' }));
  } else {
    parts.push(`<path class="atl-sea-flat" d="${k.planOutline(rect, 0, P, 1)}"/>`);
    parts.push(graticule(frame, P).markup);
  }

  // 陸地底層：圖框內所有陸地（四個地區與周邊縣市）。
  const landPolys = (data.land?.features ?? []).flatMap((feature) => prepPolygons(feature.geometry, frame, grid, minArea));
  const lines = [];
  if (landPolys.length) {
    if (!flat) {
      const land = wallsOf(landPolys, LEVEL.sea, LEVEL.land - LEVEL.sea, P);
      parts.push(`<g class="iso-solid atl-land">${land.walls}</g>`);
      lines.push(`<path class="iso-line iso-edge" data-tone="lo" d="${land.outline}"/>`);
    }
    parts.push(`<path class="atl-land-top" fill-rule="evenodd" d="${topPath(landPolys, zLand, P)}"/>`);
  }
  const labels = [];
  const inFrame = ([x, y]) => x > frame.rect[0] && x < frame.rect[2] && y > frame.rect[1] && y < frame.rect[3];
  const labelAt = (lonLat, z) => { const world = frame.toWorld(lonLat); return inFrame(world) ? k.iso([world[0], world[1], z], P) : null; };

  const neighborMarkup = [];
  for (const feature of data.neighbors?.features ?? []) {
    const polys = prepPolygons(feature.geometry, frame, grid, minArea);
    if (!polys.length) continue;
    neighborMarkup.push(`<path class="atl-neighbor" fill-rule="evenodd" data-name="${esc(feature.properties.name)}" d="${topPath(polys, zLand, P)}"/>`);
    const at = labelAt(feature.properties.label, zLand);
    if (at) labels.push({ kind: 'neighbor', id: feature.id, text: feature.properties.name, at, weight: 0 });
  }
  parts.push(`<g class="atl-neighbors">${neighborMarkup.join('')}</g>`);

  // 四個地區：總覽時全部墊高；單一地區時只墊高該區，其餘留在陸地底層（仍可點選切換）。
  const districtFeatures = data.districts?.features ?? [];
  const lowDistricts = [];
  const highDistricts = [];
  const districtIndex = [];
  const usingDistricts = districtFeatures.length > 0;
  const units = usingDistricts
    ? districtFeatures.map((feature) => ({ id: feature.id, name: feature.properties.name, regionId: feature.properties.region_id, label: feature.properties.label, weight: feature.properties.area_km2, geometry: feature.geometry, district: true }))
    : regionFeatures.map((feature) => ({ id: feature.id, name: feature.properties.display_name ?? feature.properties.name, regionId: feature.id, label: feature.properties.label, weight: feature.properties.area_km2, geometry: feature.geometry, district: false }));
  for (const unit of units) {
    const polys = prepPolygons(unit.geometry, frame, grid, minArea);
    if (!polys.length) continue;
    const high = raised(unit.regionId);
    const z = high ? zTop : zLand;
    (high ? highDistricts : lowDistricts).push(`<path class="atl-district atl-r-${unit.regionId}${high ? '' : ' is-low'}" fill-rule="evenodd" data-region="${unit.regionId}"${unit.district ? ` data-district="${unit.id}"` : ''} data-name="${esc(unit.name)}" d="${topPath(polys, z, P)}"/>`);
    const at = unit.label ? labelAt(unit.label, z) : null;
    if (unit.district) {
      districtIndex.push({ id: unit.id, name: unit.name, regionId: unit.regionId, at });
      if (at) labels.push({ kind: 'district', id: unit.id, regionId: unit.regionId, text: unit.name, at, weight: unit.weight ?? 0, low: !high });
    }
  }
  parts.push(`<g class="atl-districts atl-districts-low">${lowDistricts.join('')}</g>`);

  const plateauSource = focus ? [focus] : (data.scope?.features?.length ? data.scope.features : regionFeatures);
  const plateauPolys = plateauSource.flatMap((feature) => prepPolygons(feature.geometry, frame, grid, minArea));
  if (plateauPolys.length) {
    if (!flat) {
      const plateau = wallsOf(plateauPolys, LEVEL.land, LEVEL.top - LEVEL.land, P);
      parts.push(`<g class="iso-solid atl-plateau">${plateau.walls}</g>`);
      lines.push(`<path class="iso-line iso-crease" data-tone="faint" d="${plateau.crease}"/>`, `<path class="iso-line iso-edge atl-cliff" data-tone="mid" d="${plateau.outline}"/>`);
    }
    parts.push(`<path class="atl-plateau-top" fill-rule="evenodd" d="${topPath(plateauPolys, zTop, P)}"/>`);
  }
  parts.push(`<g class="atl-districts atl-districts-high">${highDistricts.join('')}</g>`);

  const edges = [];
  for (const feature of regionFeatures) {
    const polys = prepPolygons(feature.geometry, frame, grid, minArea);
    if (!polys.length) continue;
    const z = zOf(feature.id);
    edges.push(`<path class="atl-region-edge${raised(feature.id) ? '' : ' is-low'}" data-region="${feature.id}" d="${topPath(polys, z, P)}"/>`);
    const at = labelAt(feature.properties.label, z);
    if (at && feature.id !== focusId) labels.push({ kind: 'region', id: feature.id, regionId: feature.id, text: feature.properties.display_name ?? feature.properties.name, at, weight: feature.properties.area_km2 ?? 0, low: !raised(feature.id) });
  }
  parts.push(`<g class="atl-region-edges">${edges.join('')}</g>`, `<g class="atl-block-lines">${lines.join('')}</g>`);

  // 案卷：線段幾何畫在地面上；圖釘位置交給互動層（固定螢幕大小）。
  const routes = [];
  const pins = [];
  for (const project of projects) {
    const location = project.location;
    if (!location?.anchor) continue;
    const z = zOf(project.regionId);
    const world = frame.toWorld(location.anchor);
    if (!inFrame(world)) continue;
    pins.push({ projectId: project.id, regionId: project.regionId, at: k.iso([world[0], world[1], z], P) });
    if (location.geometry?.type === 'LineString') {
      const d = k.onTop(location.geometry.coordinates.map(frame.toWorld), z + 0.05, P);
      routes.push(`<path class="atl-route-casing" d="${d}"/><path class="atl-route" data-project="${project.id}" d="${d}"/>`);
    }
  }
  parts.push(`<g class="atl-routes">${routes.join('')}</g>`);

  const corners = flat ? k.boxCorners(rect, 0, 0) : [...k.boxCorners(plinth, LEVEL.feet, LEVEL.deck), ...k.boxCorners(rect, LEVEL.deck, LEVEL.top)];
  const flatPoints = corners.map((point) => k.iso(point, P));
  const bounds = [Math.min(...flatPoints.map((p) => p[0])), Math.min(...flatPoints.map((p) => p[1])), Math.max(...flatPoints.map((p) => p[0])), Math.max(...flatPoints.map((p) => p[1]))];
  const metersPerPx = frame.mpu / px;

  return {
    id: sceneId,
    kind: focusId ? 'region' : 'overview',
    focusId,
    mode,
    stage: { ...stage },
    frame,
    P,
    markup: parts.join(''),
    bounds,
    labels,
    pins,
    districts: districtIndex,
    metersPerPx,
    maxZoom: Math.max(2, Math.min(40, metersPerPx / 7)),
    ruler: flat ? null : { stepM: rulerStepM, majorM: rulerStepM * 5 },
    missing: { land: !landPolys.length, districts: !usingDistricts, regions: !regionFeatures.length },
    groundZ: zOf,
    toStage: (lonLat, z = zTop) => { const world = frame.toWorld(lonLat); return k.iso([world[0], world[1], z], P); },
    toLonLat: (point, z = zTop) => frame.toLonLat(unproject(point, P, z)),
  };
}

function lineStringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function prepLines(geometry, frame) {
  const out = [];
  for (const line of lineStringsOf(geometry)) {
    const world = line.map(frame.toWorld);
    for (const piece of clipLineToRect(world, frame.rect)) if (piece.length > 1) out.push(piece);
  }
  return out;
}

// OSM 樓層／高度只決定示意厚度；缺值用固定矮塊，避免把未知畫成零高度或假進度。
export function illustrativeBuildingHeight(props = {}) {
  if (typeof props.levels === 'number' && props.levels > 0) return Math.min(SITE_LEVEL.buildingMin + props.levels * 0.55, SITE_LEVEL.buildingMax);
  if (typeof props.height_m === 'number' && props.height_m > 0) return Math.min(SITE_LEVEL.buildingMin + props.height_m / 3.5, SITE_LEVEL.buildingMax);
  return SITE_LEVEL.buildingMin;
}

/**
 * 單一案卷的現地沙盤：OpenStreetMap 周邊地物 + 案卷圖釘／線段。
 * 真實現地圖資與插畫厚度分層；建物高度是示意，不是預算或政績。
 * @param {object} options
 * @param {object} options.site FeatureCollection（public/data/geo/sites/*.geojson）
 * @param {object} options.project 檢視模型案卷（含 location）
 * @param {'plan'|'iso'} options.mode
 * @param {{width:number,height:number}} options.stage
 */
export function buildSiteScene({ site, project, mode, stage }) {
  if (!site?.metadata?.frame || !project?.location?.anchor) throw new Error('現地沙盤缺少 frame 或案卷座標');
  const flat = mode === 'plan';
  const { center, half_m: halfM } = site.metadata.frame;
  const frame = makeCenteredFrame(center, halfM, { units: 480 });
  const rect = rectPlan(frame.rect);
  const rulerStepM = pickRulerStep(frame.mpu);
  const zGround = flat ? 0 : SITE_LEVEL.pad;

  let plinth = null;
  let P;
  if (flat) {
    P = fitCamera(k.boxCorners(rect, 0, 0), mode, stage, { pad: 8 });
  } else {
    plinth = { x: frame.rect[0] - 12, y: frame.rect[1] - 12, w: frame.rect[2] - frame.rect[0] + 24, d: frame.rect[3] - frame.rect[1] + 12 + 40, r: 6 };
    P = fitCamera([...k.boxCorners(plinth, SITE_LEVEL.feet, SITE_LEVEL.deck), ...k.boxCorners(rect, SITE_LEVEL.deck, SITE_LEVEL.buildingMax + 2)], mode, stage, { pad: 16, headroom: 28 });
  }
  const px = pxPerUnit(P);
  const grid = 0.45 / px;
  const minArea = (0.9 / px) ** 2;
  const parts = [];
  if (!flat) {
    parts.push(`<g class="atl-furniture">${furniture(frame, P, rulerStepM, SITE_LEVEL).markup}</g>`);
    parts.push(k.solidSvg(k.slabOf(rect, SITE_LEVEL.deck, SITE_LEVEL.pad - SITE_LEVEL.deck, P, 1, 0.4), { tone: 'lo', className: 'atl-site-pad' }));
  } else {
    parts.push(`<path class="atl-site-pad-flat" d="${k.planOutline(rect, 0, P, 1)}"/>`);
  }

  const byLayer = { field: [], green: [], water: [], waterline: [], road: [], planned_road: [], rail: [], building: [], construction: [], station: [] };
  for (const feature of site.features ?? []) {
    const layer = feature.properties?.layer;
    if (layer && byLayer[layer]) byLayer[layer].push(feature);
  }

  const paintFill = (features, className, { z = zGround, extrude = false, heightOf = null, lit = false } = {}) => {
    const tops = [];
    let crease = '';
    let outline = '';
    for (const feature of features) {
      const polys = prepPolygons(feature.geometry, frame, grid, minArea);
      if (!polys.length) continue;
      const height = extrude && !flat ? (heightOf ? heightOf(feature.properties) : 2.4) : 0;
      const topZ = z + height;
      tops.push(`<path class="${className}" fill-rule="evenodd"${feature.properties?.name ? ` data-name="${esc(feature.properties.name)}"` : ''}${feature.properties?.osm ? ` data-osm="${esc(feature.properties.osm)}"` : ''} d="${topPath(polys, topZ, P)}"/>`);
      if (height > 0) {
        const solid = wallsOf(polys, z, height, P);
        parts.push(`<g class="iso-solid ${className}-side${lit ? ' is-lit' : ''}">${solid.walls}</g>`);
        crease += solid.crease;
        outline += solid.outline;
      }
    }
    if (tops.length) parts.push(`<g class="atl-site-layer ${className}-top">${tops.join('')}</g>`);
    if (outline) parts.push(`<g class="atl-site-edges"><path class="iso-line iso-crease" data-tone="faint" d="${crease}"/><path class="iso-line iso-edge" data-tone="${lit ? 'lit' : 'lo'}" d="${outline}"/></g>`);
  };

  // 先鋪綠地／田／水，再建物，施工範圍最後（lit），路網畫在地面上不假裝高程。
  paintFill(byLayer.field, 'atl-site-field');
  paintFill(byLayer.green, 'atl-site-green');
  paintFill(byLayer.water, 'atl-site-water');
  paintFill(byLayer.building, 'atl-site-building', { extrude: true, heightOf: illustrativeBuildingHeight });
  paintFill(byLayer.construction, 'atl-site-construction', { extrude: true, heightOf: () => Math.min(SITE_LEVEL.buildingMin + 1.6, 6), lit: true });

  const strokeLayer = (features, className, tone = 'lo') => {
    let d = '';
    for (const feature of features) {
      for (const line of prepLines(feature.geometry, frame)) d += k.onTop(line, zGround + 0.04, P);
    }
    if (d) parts.push(`<g class="atl-site-layer ${className}">${k.lineSvg(d, { tone, className })}</g>`);
  };
  strokeLayer(byLayer.waterline, 'atl-site-waterline', 'mid');
  strokeLayer(byLayer.rail, 'atl-site-rail', 'mid');
  strokeLayer(byLayer.planned_road, 'atl-site-planned-road', 'faint');
  strokeLayer(byLayer.road, 'atl-site-road', 'lo');

  const labels = [];
  const inFrame = ([x, y]) => x > frame.rect[0] && x < frame.rect[2] && y > frame.rect[1] && y < frame.rect[3];
  for (const feature of byLayer.station) {
    if (feature.geometry?.type !== 'Point' || !feature.properties?.name) continue;
    const world = frame.toWorld(feature.geometry.coordinates);
    if (!inFrame(world)) continue;
    labels.push({ kind: 'district', id: feature.properties.osm ?? feature.properties.name, text: feature.properties.name, at: k.iso([world[0], world[1], zGround + 0.2], P), weight: 10 });
    parts.push(k.dotsSvg([k.iso([world[0], world[1], zGround + 0.2], P)], { size: 2.2, tone: 'hi' }));
  }
  for (const feature of byLayer.green) {
    if (!feature.properties?.name) continue;
    const box = bboxOfCoords(feature.geometry.coordinates);
    const world = frame.toWorld([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
    if (!inFrame(world)) continue;
    labels.push({ kind: 'neighbor', id: feature.properties.osm ?? feature.properties.name, text: feature.properties.name, at: k.iso([world[0], world[1], zGround], P), weight: 1 });
  }
  for (const feature of byLayer.construction) {
    if (!feature.properties?.name) continue;
    const box = bboxOfCoords(feature.geometry.coordinates);
    const world = frame.toWorld([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
    if (!inFrame(world)) continue;
    labels.push({ kind: 'region', id: feature.properties.osm ?? feature.properties.name, text: feature.properties.name, at: k.iso([world[0], world[1], zGround + 3], P), weight: 20 });
  }

  const routes = [];
  const pins = [];
  const location = project.location;
  const world = frame.toWorld(location.anchor);
  if (inFrame(world)) {
    pins.push({ projectId: project.id, regionId: project.regionId, at: k.iso([world[0], world[1], zGround + 0.1], P) });
    if (location.geometry?.type === 'LineString') {
      const pieces = prepLines(location.geometry, frame);
      for (const line of pieces) {
        const d = k.onTop(line, zGround + 0.08, P);
        routes.push(`<path class="atl-route-casing" d="${d}"/><path class="atl-route" data-project="${project.id}" d="${d}"/>`);
      }
    }
  }
  parts.push(`<g class="atl-routes">${routes.join('')}</g>`);

  const corners = flat ? k.boxCorners(rect, 0, 0) : [...k.boxCorners(plinth, SITE_LEVEL.feet, SITE_LEVEL.deck), ...k.boxCorners(rect, SITE_LEVEL.deck, SITE_LEVEL.buildingMax + 2)];
  const flatPoints = corners.map((point) => k.iso(point, P));
  const bounds = [Math.min(...flatPoints.map((p) => p[0])), Math.min(...flatPoints.map((p) => p[1])), Math.max(...flatPoints.map((p) => p[0])), Math.max(...flatPoints.map((p) => p[1]))];
  const metersPerPx = frame.mpu / px;
  const counts = site.metadata?.counts ?? {};
  const license = site.metadata?.license ?? null;

  return {
    id: `site:${project.id}`,
    kind: 'site',
    focusId: project.id,
    projectId: project.id,
    mode,
    stage: { ...stage },
    frame,
    P,
    markup: parts.join(''),
    bounds,
    labels,
    pins,
    districts: [],
    metersPerPx,
    maxZoom: Math.max(2, Math.min(48, metersPerPx / 2.5)),
    ruler: flat ? null : { stepM: rulerStepM, majorM: rulerStepM * 5 },
    missing: { land: false, districts: true, regions: true },
    siteMeta: {
      note: site.metadata?.note ?? '周邊地物來自 OpenStreetMap，只作現地脈絡，不是工程的官方範圍。',
      license,
      counts,
      retrievedAt: site.metadata?.source?.retrieved_at ?? null,
      buildingHeightNote: '立體示意裡的建物厚度依 OpenStreetMap 樓層或高度估算，缺值用固定矮塊；不是預算、進度或政績分數。',
    },
    groundZ: () => zGround,
    toStage: (lonLat, z = zGround) => { const at = frame.toWorld(lonLat); return k.iso([at[0], at[1], z], P); },
    toLonLat: (point, z = zGround) => frame.toLonLat(unproject(point, P, z)),
  };
}
