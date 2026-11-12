import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:4196', output] = process.argv.slice(2);
const stats = await fetch(base + '/data/stats.json').then(response => response.json());
const browser = await chromium.launch();
const routes = ['index', 'compare', 'polls', 'commentary', 'topics', 'manual', 'person'];
const previews = {
  polls: ['.poll-study', '全站-民調'],
  commentary: ['#watch-comments .timeline li', '全站-評論'],
  topics: ['#topicPicker button', '全站-議題'],
  manual: ['#copy-source-template', '全站-收錄'],
  person: ['#personSwitch a', '全站-人物'],
};
try {
  for (const width of [320, 390, 430, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const route of routes) {
      const path = '/' + route + '.html' + (route === 'person' ? '?id=chiu' : '');
      assert((await page.goto(base + path, { waitUntil: 'domcontentloaded' })).ok(), path);
      const nav = page.getByRole('navigation', { name: '主選單' });
      await nav.waitFor();
      assert.equal(await nav.getByRole('link').count(), 6);
      assert.equal(await page.locator('.top').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(252, 249, 242)');
      assert.equal(await page.locator('.top [aria-current="page"]').count(), route === 'person' ? 0 : 1);
      assert.equal(await page.locator('.skip-link').getAttribute('href'), '#' + await page.locator('main').getAttribute('id'));
      if (width <= 430) {
        assert(await nav.evaluate(element => element.scrollWidth <= element.clientWidth + 1), path + ' nav overflow');
        assert(await nav.evaluate(element => [...element.querySelectorAll('a')].every(link => {
          const rect = link.getBoundingClientRect();
          return rect.width >= 43.5 && rect.height >= 44;
        })), path + ' touch targets');
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path + ' page overflow at ' + width);
      if (output && width === 390 && previews[route]) {
        const [selector, filename] = previews[route];
        await page.locator(selector).first().waitFor();
        await page.screenshot({ path: resolve(output, filename + '.png') });
      }
    }
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    const plot = page.locator('#pulsePlot');
    const chart = plot.getByRole('img');
    await chart.waitFor();
    const tracked = ['wu', 'xu', 'zheng', 'chiu'].filter(id => stats.by_person[id]);
    const values = async period => {
      const actual = (await chart.locator('.pulse-value').allTextContents()).map(value => Number(value.replaceAll(',', '')));
      assert.deepEqual(actual, tracked.map(id => stats.by_person[id][period]));
      assert.equal(await chart.locator('.pulse-bar').count(), actual.filter(value => value > 0).length);
    };
    await values('last_7d');
    const scale = await chart.locator('.pulse-scale').allTextContents();
    await page.getByRole('button', { name: '24 小時', exact: true }).click();
    await values('last_24h');
    assert.deepEqual(await chart.locator('.pulse-scale').allTextContents(), scale);
    await page.getByRole('button', { name: '近 7 日', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '近 7 日', exact: true }).getAttribute('aria-pressed'), 'true');
    await values('last_7d');
    assert.deepEqual(await chart.locator('.pulse-scale').allTextContents(), scale);
    assert(await page.locator('#dashPeople img').count() === tracked.length);
    await page.waitForFunction(() => [...document.querySelectorAll('#dashPeople img')].every(img => img.complete && img.naturalWidth > 0));
    if (width === 390) {
      assert(await page.locator('#latestTop').evaluate(node => Boolean(node.compareDocumentPosition(document.querySelector('.pulse')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    }
    if (output && width === 390) {
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: resolve(output, '全站-總覽.png') });
    }
    await page.goto(base + '/compare.html', { waitUntil: 'domcontentloaded' });
    const race = page.getByRole('group', { name: '選區', exact: true });
    const cards = page.locator('#metricCards .cmp-card');
    await cards.first().waitFor();
    for (const [label, candidates] of [['新竹縣長', ['xu', 'zheng']], ['竹北市長', ['wu', 'chiu']]]) {
      const toggle = race.getByRole('button', { name: label, exact: true });
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await cards.evaluateAll(rows => rows.map(row => row.dataset.person).sort()), [...candidates].sort());
      for (const id of candidates) {
        const card = cards.and(page.locator(`[data-person="${id}"]`));
        for (const period of ['last_24h', 'last_7d']) {
          assert.equal(Number(await card.locator(`[data-coverage="${period}"]`).textContent()), stats.by_person[id][period]);
        }
      }
    }
    if (output && width === 390) {
      await page.locator('.cmp-bar-row').first().waitFor();
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: resolve(output, '全站-比較.png') });
    }
    assert.deepEqual(errors, [], width + ' browser errors');
    await page.close();
  }
  const keyboard = await browser.newPage({ viewport: { width: 320, height: 760 } });
  await keyboard.goto(base + '/manual.html');
  await keyboard.keyboard.press('Tab');
  assert.equal(await keyboard.evaluate(() => document.activeElement?.className), 'skip-link');
  await keyboard.keyboard.press('Enter');
  assert.equal(await keyboard.evaluate(() => document.activeElement?.tagName), 'MAIN');
  await keyboard.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
  await keyboard.getByRole('button', { name: '複製格式' }).click();
  await keyboard.locator('#copy-source-status').filter({ hasText: '已選取格式' }).waitFor();
  assert.equal(await keyboard.locator('#source-template').evaluate(field => field.selectionEnd - field.selectionStart === field.value.length), true);
  await keyboard.close();
  const blackout = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await blackout.clock.install({ time: new Date('2026-11-18T02:00:00+08:00') });
  const requests = [];
  blackout.on('request', request => { if (new URL(request.url()).pathname === '/data/polls.json') requests.push(request.url()); });
  await blackout.goto(base + '/polls.html');
  await blackout.locator('#pollTrend').getByText(/封關期間/u).waitFor();
  assert.equal(await blackout.locator('.poll-bar-row').count(), 0);
  assert.equal(requests.length, 0);
  await blackout.close();
  console.log(JSON.stringify({ routes: routes.length, widths: [320, 390, 430, 768, 1280], portraits: 'loaded', pulseValues: 'exact', sharedSnapshot: 'pass', blackout: 'pass' }));
} finally {
  await browser.close();
}
