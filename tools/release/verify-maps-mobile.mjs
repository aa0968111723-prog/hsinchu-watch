import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const [origin = 'http://127.0.0.1:4201', output] = process.argv.slice(2);
const browser = await chromium.launch();
try {
  for (const width of [320, 390, 430, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/maps.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#policyMap .map-row').first().waitFor();
    for (const section of ['recordMap', 'policyMap']) {
      const rows = page.locator('#' + section + ' .map-row');
      assert.equal(await rows.count(), 10);
      assert.equal(await rows.locator('.map-cell').count(), 30);
      const last = rows.last();
      await last.locator('summary').click();
      const names = await last.locator('.map-person strong').allTextContents();
      assert.deepEqual(names, ['吳旭智', '徐欣瑩', '鄭朝方']);
      if (width <= 430) {
        assert(await last.locator('.map-cell').evaluateAll(cards =>
          cards.every(card => card.getBoundingClientRect().width >= innerWidth - 64)));
        assert(await last.locator('.map-person strong').evaluateAll(labels =>
          labels.every(label => label.getBoundingClientRect().height < 30)));
        assert(await last.locator('.map-cell .map-excerpt').evaluateAll(paragraphs =>
          paragraphs.every(paragraph => Number.parseFloat(getComputedStyle(paragraph).fontSize) >= 16)));
      }
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + ' overflow');
    const links = page.locator('#policyMap a');
    assert(await links.count() > 0);
    assert.match(await links.first().getAttribute('href'), /^https?:\/\//u);
    await page.getByRole('link', { name: '政見地圖', exact: true }).click();
    if (output && width === 390) {
      const target = page.locator('#policyMap .map-row').last();
      await target.evaluate(node => {
        document.activeElement?.blur();
        const height = document.querySelector('header.top').getBoundingClientRect().height;
        scrollTo({ top: scrollY + node.getBoundingClientRect().top - height - 12, behavior: 'instant' });
      });
      await page.screenshot({ path: resolve(output, '地圖頁-手機議題卡片.png') });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: resolve(output, '地圖頁-手機頁首.png') });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(JSON.stringify({ widths: [320, 390, 430, 768, 1280], issues: 20, candidateCards: 60, sourceLinks: 'pass', layout: 'pass' }));
} finally {
  await browser.close();
}
