import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.argv[2] || 'http://127.0.0.1:4173';
const browser = await chromium.launch();
try {
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(origin + '/compare.html');
    await page.locator('#metricCards .cmp-card').first().waitFor();
    const link = page.getByRole('link', { name: '回到頁首 ↑', exact: true });
    assert.equal(await link.isVisible(), false);
    await page.locator('a[href="#watch-sources"]').first().click();
    await page.locator('#watch-sources .timeline li').first().waitFor();
    await page.evaluate(() => window.scrollTo(0, 1200));
    await link.waitFor({ state: 'visible' });
    assert(await link.evaluate(node => node.getBoundingClientRect().height >= 44));
    await link.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => scrollY === 0);
    await link.waitFor({ state: 'hidden' });
    assert.equal(await link.isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'page-top');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.close();
  }
  console.log(JSON.stringify({ widths: [320, 390, 1280], backToTop: 'pass', keyboardFocus: 'pass' }));
} finally { await browser.close(); }
