import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:4194', screenshotDir] = process.argv.slice(2);
async function get(path) {
  const response = await fetch(base + path);
  assert(response.ok, path);
  return response;
}
const [comments, sources, manifest] = await Promise.all([
  get('/observations/comments.json').then(r => r.json()),
  get('/observations/sources.json').then(r => r.json()),
  get('/data/manifest.json').then(r => r.json()),
]);
for (const [filename, expected] of Object.entries(manifest.files)) {
  const bytes = Buffer.from(await (await get('/data/' + filename)).arrayBuffer());
  assert.equal(bytes.length, expected.bytes, filename);
  assert(createHash('sha256').update(bytes).digest('hex').startsWith(expected.sha256), filename);
}
assert.equal(new Set(sources.entries.map(row => row.url)).size, sources.entries.length);
assert(sources.entries.every(row =>
  /^https:\/\//u.test(row.url) &&
  row.personIds.every(id => sources.people[id]) &&
  Object.keys(row).sort().join(',') === 'date,personIds,source,title,url'));
assert(comments.entries.every(row =>
  comments.people[row.personId] && comments.threads[row.thread] &&
  Object.keys(row).every(key => ['commentId', 'personId', 'thread', 'kind', 'at', 'locator', 'summary'].includes(key))));
const commentCount = new Set(comments.entries.map(row => row.commentId)).size;
assert(commentCount < comments.entries.length, 'one comment may cover several people');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 915 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const screenshot = async (panel, filename) => {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile overflow');
    if (!screenshotDir) return;
    await panel.evaluate(element => {
      document.activeElement?.blur();
      element.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    await page.screenshot({ path: resolve(screenshotDir, filename) });
  };
  await page.goto(base + '/commentary.html#watch-comments');
  const replies = page.locator('#watch-comments');
  await replies.getByText('符合 ' + commentCount + ' 則留言', { exact: false }).waitFor();
  const more = replies.getByRole('button', { name: '顯示更多留言' });
  while (await more.isVisible()) await more.click();
  assert.equal(await replies.locator('li').count(), comments.entries.length);
  await replies.getByLabel('人物').selectOption('wu');
  await replies.getByLabel('方向').selectOption('neg');
  await replies.getByLabel('來源').selectOption('Dcard');
  assert.equal(await replies.locator('li').count(), 1);
  assert.match(await replies.getByRole('link', { name: '開啟原留言' }).getAttribute('href'), /\/b\/5$/u);
  await replies.getByLabel('人物').selectOption('');
  await replies.getByLabel('方向').selectOption('');
  await replies.getByLabel('來源').selectOption('');
  await screenshot(replies, 'Grok留言-手機.png');

  await page.goto(base + '/compare.html');
  const index = page.locator('#watch-sources');
  assert.equal(await index.getAttribute('open'), null);
  await page.locator('a[href="#watch-sources"]').click();
  await index.getByText('索引共 ' + sources.entries.length + ' 筆', { exact: false }).waitFor();
  await index.getByLabel('人物').selectOption('chen');
  assert(await index.locator('li').count() > 0, 'historical primary candidate sources');
  await index.getByLabel('人物').selectOption('');
  await index.getByLabel('找文章或來源').fill('新竹縣選舉委員會');
  assert(await index.getByRole('link', { name: /號次抽籤結果/u }).count() > 0);
  await index.getByLabel('找文章或來源').fill('土地改革');
  await index.getByLabel('人物').selectOption('zhu');
  assert(await index.getByRole('link', { name: /朱定瑀/u }).count() > 0);
  await index.getByLabel('人物').selectOption('');
  await index.getByLabel('找文章或來源').fill('');
  await screenshot(index, 'Grok來源-手機.png');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
console.log(JSON.stringify({ commentCount, assessments: comments.entries.length, sources: sources.entries.length, manifestFiles: Object.keys(manifest.files).length }));
