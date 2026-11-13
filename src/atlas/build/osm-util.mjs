// OpenStreetMap 原始 JSON 的讀取與組環工具（建置用）。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const osmCache = join(here, '.cache/osm');

export function loadExtract(name) {
  const file = join(osmCache, `${name}.json`);
  if (!existsSync(file)) throw new Error(`缺少 OSM 快取 ${name}.json；先執行 node src/atlas/build/fetch-osm.mjs`);
  const meta = JSON.parse(readFileSync(`${file}.meta.json`, 'utf8'));
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();
  for (const element of JSON.parse(readFileSync(file, 'utf8')).elements) {
    (element.type === 'node' ? nodes : element.type === 'way' ? ways : relations).set(element.id, element);
  }
  return { name, meta, nodes, ways, relations };
}

export const coordOf = (node) => [node.lon, node.lat];

export function wayCoords(way, nodes) {
  const coords = [];
  for (const id of way.nodes) {
    const node = nodes.get(id);
    if (node) coords.push(coordOf(node));
  }
  return coords;
}

// 把成員 way 的節點序列接成閉合環；接不起來的留在 open。
export function stitchRings(nodeLists) {
  const remaining = nodeLists.map((list) => list.slice());
  const rings = [];
  const open = [];
  while (remaining.length) {
    let chain = remaining.pop();
    let progressed = true;
    while (chain[0] !== chain[chain.length - 1] && progressed) {
      progressed = false;
      for (let index = 0; index < remaining.length; index += 1) {
        const way = remaining[index];
        const tail = chain[chain.length - 1];
        if (way[0] === tail) chain = chain.concat(way.slice(1));
        else if (way[way.length - 1] === tail) chain = chain.concat(way.slice(0, -1).reverse());
        else if (way[way.length - 1] === chain[0]) chain = way.slice(0, -1).concat(chain);
        else if (way[0] === chain[0]) chain = way.slice(1).reverse().concat(chain);
        else continue;
        remaining.splice(index, 1);
        progressed = true;
        break;
      }
    }
    if (chain.length >= 4 && chain[0] === chain[chain.length - 1]) rings.push(chain);
    else open.push(chain);
  }
  return { rings, open };
}

// relation → { outers: [coords], inners: [coords], missing, open }；ways/nodes 可來自完整 relation 檔。
export function relationRings(relation, ways, nodes) {
  const lists = { outer: [], inner: [] };
  let missing = 0;
  for (const member of relation.members) {
    if (member.type !== 'way') continue;
    const way = ways.get(member.ref);
    if (!way) { missing += 1; continue; }
    lists[member.role === 'inner' ? 'inner' : 'outer'].push(way.nodes);
  }
  const outer = stitchRings(lists.outer);
  const inner = stitchRings(lists.inner);
  const toCoords = (ids) => ids.map((id) => nodes.get(id)).filter(Boolean).map(coordOf);
  return { outers: outer.rings.map(toCoords), inners: inner.rings.map(toCoords), missing, open: outer.open.length + inner.open.length };
}

// 依起訖節點把幾條 way 接成一條折線（節點 id 序列）。
export function chainWays(wayIds, ways, fromNode, toNode) {
  const remaining = wayIds.map((id) => {
    const way = ways.get(id);
    if (!way) throw new Error(`OSM 快取沒有 way ${id}`);
    return way.nodes.slice();
  });
  let chain = [fromNode];
  while (chain[chain.length - 1] !== toNode) {
    const tail = chain[chain.length - 1];
    const index = remaining.findIndex((list) => list[0] === tail || list[list.length - 1] === tail);
    if (index < 0) throw new Error(`way 鏈在節點 ${tail} 接不下去`);
    const [list] = remaining.splice(index, 1);
    const ordered = list[0] === tail ? list : list.slice().reverse();
    const stop = ordered.indexOf(toNode);
    chain = chain.concat(stop > 0 ? ordered.slice(1, stop + 1) : ordered.slice(1));
  }
  if (remaining.length) throw new Error(`way 鏈有 ${remaining.length} 條沒用到`);
  return chain;
}

export const osmRef = (element) => ({ ref: `${element.type}/${element.id}`, version: element.version ?? null, timestamp: element.timestamp ?? null });
