#!/usr/bin/env node
// 靜態替代圖：用和互動頁同一組場景模組，把總覽畫成獨立 SVG（內嵌樣式）。
// 給沒有 JavaScript、資料載入失敗與文件使用；圖上的圖釘同樣只畫有可核對座標的案卷。
// 用法：node src/atlas/build/render-static.mjs [--all]   （--all 另外輸出四個地區的立體圖到 .cache/figures/，不進版控）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISO_CSS } from '../kit/iso-kit.mjs';
import { LAYERS, buildModel } from '../model.js';
import { pinArt } from '../pins.js';
import { buildRegionScene, formatDistance } from '../scene.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const sceneCss = readFileSync(join(here, '../scene.css'), 'utf8');
const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const layers = {};
for (const layer of LAYERS) {
  try {
    layers[layer.id] = { ...layer, status: 'ok', data: JSON.parse(readFileSync(join(root, 'public', layer.path), 'utf8')), error: null };
  } catch (error) {
    layers[layer.id] = { ...layer, status: layer.optional ? 'absent' : 'failed', data: null, error: error.code ?? error.message };
  }
}
const model = buildModel(layers);
if (!model.ok) throw new Error('治理案卷讀不到，無法產生靜態圖');
const data = Object.fromEntries(['regions', 'districts', 'scope', 'neighbors', 'land'].map((id) => [id, layers[id].data]));

export function renderStatic({ sceneId, mode, width = 960, height = 640, districtLabels = false }) {
  const scene = buildRegionScene({ data, sceneId, mode, stage: { width, height }, projects: model.projects });
  const labels = scene.labels
    .filter((label) => label.kind !== 'district' || (districtLabels && !label.low))
    .map((label) => `<text class="atl-label" data-kind="${label.kind}"${label.low ? ' data-low=""' : ''} x="${label.at[0].toFixed(1)}" y="${label.at[1].toFixed(1)}">${esc(label.text)}</text>`)
    .join('');
  const byId = new Map(model.projects.map((project) => [project.id, project]));
  const pins = [...scene.pins]
    .sort((a, b) => a.at[1] - b.at[1])
    .map((pin) => {
      const project = byId.get(pin.projectId);
      return `<g transform="translate(${pin.at[0].toFixed(1)} ${pin.at[1].toFixed(1)})"><title>${esc(project.title)}</title>${pinArt({ stage: project.latestStage, precision: project.precision })}</g>`;
    })
    .join('');
  const located = model.projects.filter((project) => project.locationState === 'located').length;
  const pending = model.projects.filter((project) => project.locationState === 'pending').length;
  const view = mode === 'iso' ? `立體示意視角；尺規小格 ${formatDistance(scene.ruler.stepM)}、大格 ${formatDistance(scene.ruler.majorM)}。厚度不代表高程或數值。` : '平面視角，正北朝上。';
  const title = sceneId === 'overview' ? '台北、新北、新竹縣市政策與工程地圖總覽' : `${model.regions.find((region) => region.id === sceneId.slice(7))?.name ?? ''}政策與工程地圖`;
  const note = `${view}圖釘 ${located} 案有可核對座標，另有 ${pending} 案待定位未畫出。界線：內政部國土測繪中心（政府資料開放授權條款－第1版）。位置查核日 ${model.locationsReviewedAt}。`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso atl-svg" data-theme="light" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(`${title}。${note}`)}">`
    + `<title>${esc(title)}</title><desc>${esc(note)}</desc>`
    + `<style>${ISO_CSS}${sceneCss}.atl-static-note{font:500 11px/1.4 "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;fill:#5d6b75}</style>`
    + `<rect width="${width}" height="${height}" fill="#fbf8f1"/>${scene.markup}<g class="atl-labels">${labels}</g><g class="atl-pins">${pins}</g>`
    + `<text class="atl-static-note" x="14" y="${height - 12}">${esc(note)}</text></svg>\n`;
  return { svg, scene };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const all = process.argv.includes('--all');
  const jobs = [
    { file: 'public/img/atlas/overview-plan.svg', sceneId: 'overview', mode: 'plan', width: 900, height: 620 },
    { file: 'public/img/atlas/overview-iso.svg', sceneId: 'overview', mode: 'iso', width: 900, height: 620 },
  ];
  if (all) for (const region of model.regions) jobs.push({ file: `src/atlas/build/.cache/figures/region-${region.id}-iso.svg`, sceneId: `region:${region.id}`, mode: 'iso', width: 960, height: 640, districtLabels: true });
  for (const job of jobs) {
    const { svg, scene } = renderStatic(job);
    const target = join(root, job.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, svg);
    console.log(`${job.file}  ${Buffer.byteLength(svg)} bytes  pins ${scene.pins.length}  labels ${scene.labels.length}  ${Math.round(scene.metersPerPx)} m/px`);
  }
}
