// 純幾何工具：瀏覽器與 Node 建置腳本共用，不碰 DOM。座標一律 [經度, 緯度]。

export const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLength(coords) {
  let total = 0;
  for (let index = 1; index < coords.length; index += 1) total += haversine(coords[index - 1], coords[index]);
  return total;
}

// 沿線在 share（0–1）處的點；用來放線段案卷的圖釘，不是工程中心的推測。
export function pointAlong(coords, share = 0.5) {
  const target = lineLength(coords) * Math.max(0, Math.min(1, share));
  let walked = 0;
  for (let index = 1; index < coords.length; index += 1) {
    const step = haversine(coords[index - 1], coords[index]);
    if (walked + step >= target && step > 0) {
      const t = (target - walked) / step;
      return [coords[index - 1][0] + (coords[index][0] - coords[index - 1][0]) * t, coords[index - 1][1] + (coords[index][1] - coords[index - 1][1]) * t];
    }
    walked += step;
  }
  return coords[coords.length - 1];
}

// 以 origin 為中心的等距圓柱投影（公尺）：x 向東、y 向北。小範圍內誤差遠小於界線簡化誤差。
export function localProjector(origin) {
  const kx = Math.cos(origin[1] * RAD) * EARTH_RADIUS_M * RAD;
  const ky = EARTH_RADIUS_M * RAD;
  return {
    origin,
    toLocal: ([lon, lat]) => [(lon - origin[0]) * kx, (lat - origin[1]) * ky],
    toLonLat: ([x, y]) => [origin[0] + x / kx, origin[1] + y / ky],
  };
}

export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point, rings) {
  if (!rings.length || !pointInRing(point, rings[0])) return false;
  for (let index = 1; index < rings.length; index += 1) if (pointInRing(point, rings[index])) return false;
  return true;
}

export function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((rings) => pointInPolygon(point, rings));
  return false;
}

// 點到環邊界的最短距離（公尺）；點在環內時仍回傳到邊界的距離，內外另用 pointInRing 判斷。
export function distanceToRingM(point, ring) {
  const { toLocal } = localProjector(point);
  const local = ring.map(toLocal);
  let best = Infinity;
  for (let i = 0, j = local.length - 1; i < local.length; j = i, i += 1) {
    const [ax, ay] = local[j];
    const [bx, by] = local[i];
    const dx = bx - ax;
    const dy = by - ay;
    const span = dx * dx + dy * dy;
    const t = span ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / span)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
  }
  return best;
}

export function ringAreaLocal(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return area / 2;
}

export function bboxOfCoords(coords, box = [Infinity, Infinity, -Infinity, -Infinity]) {
  if (typeof coords[0] === 'number') {
    box[0] = Math.min(box[0], coords[0]); box[1] = Math.min(box[1], coords[1]);
    box[2] = Math.max(box[2], coords[0]); box[3] = Math.max(box[3], coords[1]);
  } else for (const part of coords) bboxOfCoords(part, box);
  return box;
}

// 多邊形面積（平方公尺），以自身中心做局部投影；只適合縣市以下的範圍。
export function polygonAreaM2(geometry) {
  if (!geometry) return 0;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  if (!polygons.length) return 0;
  const box = bboxOfCoords(geometry.coordinates);
  const { toLocal } = localProjector([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
  let total = 0;
  for (const rings of polygons) rings.forEach((ring, index) => { const area = Math.abs(ringAreaLocal(ring.map(toLocal))); total += index === 0 ? area : -area; });
  return total;
}

// Sutherland–Hodgman：把環裁到矩形 [minX, minY, maxX, maxY]。凹多邊形可能在邊界上留下重合邊，只用於填色。
export function clipRingToRect(ring, [minX, minY, maxX, maxY]) {
  const edges = [
    [(p) => p[0] >= minX, (a, b) => [minX, a[1] + ((b[1] - a[1]) * (minX - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= maxX, (a, b) => [maxX, a[1] + ((b[1] - a[1]) * (maxX - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= minY, (a, b) => [a[0] + ((b[0] - a[0]) * (minY - a[1])) / (b[1] - a[1]), minY]],
    [(p) => p[1] <= maxY, (a, b) => [a[0] + ((b[0] - a[0]) * (maxY - a[1])) / (b[1] - a[1]), maxY]],
  ];
  let output = ring[0] && ring[ring.length - 1] && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  for (const [inside, cross] of edges) {
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const previous = input[(index + input.length - 1) % input.length];
      if (inside(current)) {
        if (!inside(previous)) output.push(cross(previous, current));
        output.push(current);
      } else if (inside(previous)) output.push(cross(previous, current));
    }
    if (!output.length) return [];
  }
  if (output.length < 3) return [];
  output.push(output[0]);
  return output;
}

// Liang–Barsky：把折線裁到矩形，回傳多段。
export function clipLineToRect(coords, [minX, minY, maxX, maxY]) {
  const pieces = [];
  let piece = [];
  const flush = () => { if (piece.length > 1) pieces.push(piece); piece = []; };
  for (let index = 1; index < coords.length; index += 1) {
    const [x0, y0] = coords[index - 1];
    const [x1, y1] = coords[index];
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    let visible = true;
    for (const [p, q] of [[-dx, x0 - minX], [dx, maxX - x0], [-dy, y0 - minY], [dy, maxY - y0]]) {
      if (p === 0) { if (q < 0) { visible = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { visible = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { visible = false; break; } if (r < t1) t1 = r; }
    }
    if (!visible) { flush(); continue; }
    const a = [x0 + dx * t0, y0 + dy * t0];
    const b = [x0 + dx * t1, y0 + dy * t1];
    if (t0 > 0) flush();
    if (!piece.length) piece.push(a);
    piece.push(b);
    if (t1 < 1) flush();
  }
  flush();
  return pieces;
}
