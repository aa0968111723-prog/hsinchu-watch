import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const [origin = 'http://127.0.0.1:4223', output] = process.argv.slice(2);
const stats = await (await fetch(origin + '/data/stats.json')).json();
const browser = await chromium.launch();
const errors = [];
try {
  if (output) await mkdir(output, { recursive: true });
  for (const width of [320, 390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/index.html');
    await page.locator('#pulsePlot svg').waitFor();
    const toggle = page.locator('#pulseView');
    assert.equal(await toggle.textContent(), '查看數字表');
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.locator('#pulseNumbers').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#pulsePlot svg').isVisible(), false);
    const rows = await page.locator('#pulseNumbers tbody tr').allTextContents();
    const people = ['wu', 'xu', 'zheng', 'chiu'].filter(id => stats.by_person[id]);
    assert.equal(rows.length, people.length);
    for (let index = 0; index < people.length; index++) {
      const cells = await page.locator('#pulseNumbers tbody tr').nth(index).locator('td').allTextContents();
      assert.deepEqual(cells.map(value => Number(value.replaceAll(',', ''))),
        ['last_24h', 'last_7d'].map(period => stats.by_person[people[index]][period]));
    }
    await page.getByRole('button', { name: '近 7 日', exact: true }).click();
    assert.equal(await page.locator('#pulseNumbers').isVisible(), true);
    await page.getByRole('button', { name: '返回立體圖', exact: true }).click();
    assert.equal(await page.locator('#pulsePlot svg').isVisible(), true);
    assert.equal(await page.locator('#pulseNumbers').isVisible(), false);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (output && [390, 1280].includes(width)) {
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({ path: resolve(output, `總覽-${width}.png`) });
      await page.locator('.pulse').screenshot({ path: resolve(output, `立體圖-${width}.png`) });
      await page.goto(origin + '/compare.html');
      await page.locator('#metricCards .cmp-card').first().waitFor();
      await page.screenshot({ path: resolve(output, `比較-${width}.png`) });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.top nav a').first().evaluate(element => getComputedStyle(element).transitionDuration), '0s');
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ widths: [320, 390, 768, 1280], tableValues: 'exact', keyboard: 'pass', viewPersistence: 'pass', reducedMotion: 'pass' }));
} finally {
  await browser.close();
}
