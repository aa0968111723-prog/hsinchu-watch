import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const [origin = 'http://127.0.0.1:4199'] = process.argv.slice(2);
async function get(path) {
  const response = await fetch(origin + path);
  assert(response.ok, path);
  return response;
}
const manifest = await (await get('/data/manifest.json')).json();
const items = await (await get('/data/items.json')).json();
assert.equal(items.length, manifest.counts.items_rows);
for (const [path, expected] of Object.entries(manifest.files)) {
  const bytes = Buffer.from(await (await get('/data/' + path)).arrayBuffer());
  assert.equal(bytes.length, expected.bytes, path);
  assert(createHash('sha256').update(bytes).digest('hex').startsWith(expected.sha256), path);
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const entries = {
    '/index.html': '#pulsePlot svg',
    '/governance.html': '.gov-project',
    '/archive.html': '.archive-row',
    '/compare.html': '#metricCards .cmp-card',
    '/topics.html': '#topicPicker button',
    '/polls.html': '#pollTrend:not([aria-busy="true"])',
    '/commentary.html': '#watch-comments li',
    '/person.html?id=chiu': '#personSwitch a',
    '/manual.html': '#source-template',
    '/maps.html': '#recordMapWrap',
    '/records.html': '#recBoard',
    '/compare-panels.html': '#metricCards',
    '/reference/index.html#socialSection': '#socialSection .social-block',
    '/reference/topics.html#stances': '#stanceBoard > *',
    '/reference/compare.html#compareBoard': '#compareBoard > *',
    '/person.html?id=chen': '#openPersonNews li',
    '/reference/manual.html': 'main .panel',
  };
  for (const [path, selector] of Object.entries(entries)) {
    assert((await page.goto(origin + path, { waitUntil: 'domcontentloaded' })).ok(), path);
    await page.locator(selector).first().waitFor({ timeout: 12000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path + ' overflow');
  }
  await page.goto(origin + '/index.html');
  await page.getByText('更多資料', { exact: true }).click();
  assert(await page.getByRole('link', { name: '議題地圖', exact: true }).isVisible());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ routes: Object.keys(entries).length, articles: items.length, manifestFiles: Object.keys(manifest.files).length }));
} finally {
  await browser.close();
}
