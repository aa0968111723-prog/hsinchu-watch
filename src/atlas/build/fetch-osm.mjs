#!/usr/bin/env node
// 讀取每個現地範圍的 OpenStreetMap 原始資料並快取。一個範圍只讀一次；要更新請加 --refresh。
// 用法：node src/atlas/build/fetch-osm.mjs [--refresh] [project_id ...]
// 遵守 OSM API 使用規範：逐一請求、間隔至少 min_interval_ms、標明 User-Agent；失敗就記錄並停止，不反覆重試。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache/osm');
mkdirSync(cache, { recursive: true });
const config = JSON.parse(readFileSync(join(here, 'site-areas.json'), 'utf8'));
const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const only = args.filter((arg) => !arg.startsWith('--'));
const UA = 'hsinchu-watch-atlas/0.1 (public-interest civic map; github.com/aa0968111723-prog/hsinchu-watch)';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const nowIso = () => {
  const d = new Date();
  const offset = -d.getTimezoneOffset();
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  return `${new Date(d.getTime() + offset * 60000).toISOString().slice(0, 19)}${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)}`;
};

let failed = 0;
let requested = 0;
async function ensure(name, url, extra = {}) {
  const file = join(cache, `${name}.json`);
  const metaFile = `${file}.meta.json`;
  if (!refresh && existsSync(file) && existsSync(metaFile)) {
    console.log(`快取 ${name}`);
    return;
  }
  if (requested) await sleep(config.min_interval_ms);
  requested += 1;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = JSON.parse(buffer.toString('utf8'));
    if (!Array.isArray(parsed.elements)) throw new Error('回應沒有 elements');
    writeFileSync(file, buffer);
    writeFileSync(metaFile, JSON.stringify({ url, ...extra, retrieved_at: nowIso(), bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), elements: parsed.elements.length, api_version: parsed.version ?? null, copyright: parsed.copyright ?? null, license: parsed.license ?? null }, null, 1));
    console.log(`下載 ${name}  ${parsed.elements.length} elements  ${buffer.length} bytes`);
  } catch (error) {
    failed += 1;
    console.error(`失敗 ${name}：${error.message}（保留既有快取，未重試）`);
  }
}
for (const site of config.sites) {
  if (only.length && !only.includes(site.project_id)) continue;
  await ensure(site.project_id, `${config.api}?bbox=${site.bbox.join(',')}`, { bbox: site.bbox });
  for (const id of site.relations_full ?? []) await ensure(`relation-${id}`, config.relation_api.replace('{id}', id), { relation: id });
}
process.exitCode = failed ? 1 : 0;
