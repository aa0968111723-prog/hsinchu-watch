/**
 * Browser acceptance for the art library, run against a server that sends the
 * production headers (tests/art-library/serve.py).
 *
 *   node tests/art-library/verify-lab.mjs <origin> [screenshot-dir] [standalone|built]
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [origin = 'http://127.0.0.1:4173', shots = '', mode = 'standalone'] = process.argv.slice(2);
const WIDTHS = [320, 390, 430, 768, 1280];
const summary = { origin, mode, widths: {}, checks: [] };
if (shots) mkdirSync(shots, { recursive: true });
const shot = (page, name, options = {}) => (shots ? page.screenshot({ path: join(shots, name), ...options }) : null);

function watch(page, problems) {
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`failed: ${request.url()} ${request.failure()?.errorText}`));
}

async function openLab(context, problems, path = '/asset-lab.html') {
  const page = await context.newPage();
  watch(page, problems);
  await page.goto(origin + path);
  await page.locator('.al-card').first().waitFor();
  return page;
}

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const smallTargets = (page) => page.evaluate(() => [...document.querySelectorAll('main.art-lab button, main.art-lab input, main.art-lab select, .top nav a, .fig-controls button')]
  .filter((node) => node.offsetParent !== null)
  .map((node) => ({ text: (node.textContent || node.name || '').trim().slice(0, 20), height: Math.round(node.getBoundingClientRect().height) }))
  .filter((row) => row.height < 44));

const browser = await chromium.launch();
try {
  const catalog = await (await fetch(origin + '/data/art-library.json')).json();
  const portraits = catalog.assets.filter((asset) => asset.kind === 'portrait').length;
  const scene = catalog.assets.find((asset) => asset.id === 'scene-new-taipei-fire-hq-2016');
  const component = catalog.assets.find((asset) => asset.kind === 'component');
  assert(scene && component && portraits >= 4);

  for (const width of WIDTHS) {
    const problems = [];
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, hasTouch: width < 600, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await openLab(context, problems);
    const result = {};

    // The page shell the release assembler needs, and nothing framed.
    assert.equal(await page.locator('.top nav.nav').count(), 1);
    assert.equal(await page.locator('main.wrap.art-lab').count(), 1);
    assert.equal(await page.locator('iframe').count(), 0);
    if (mode === 'built') {
      assert.equal(await page.locator('html[data-ui-depth="v3"]').count(), 1);
      assert.equal(await page.locator('.release-directory').count(), 1);
    }

    assert(await noSideScroll(page), `sideways scroll at ${width}`);
    assert.deepEqual(await smallTargets(page), [], `targets under 44px at ${width}`);
    result.cards = await page.locator('.al-card').count();
    assert.equal(result.cards, catalog.assets.length);
    assert.equal(await page.locator('#alGaps .al-gap').count(), catalog.gaps.length);
    await shot(page, `lab-${width}.png`);

    // Every thumbnail really loaded, in a modern format where one exists.
    await page.evaluate(async () => {
      for (const image of document.querySelectorAll('.al-card img')) { image.loading = 'eager'; }
      await Promise.all([...document.querySelectorAll('.al-card img')].map((image) => image.decode().catch(() => null)));
    });
    const broken = await page.evaluate(() => [...document.querySelectorAll('.al-card img')].filter((image) => !image.naturalWidth).map((image) => image.src));
    assert.deepEqual(broken, []);
    const formats = await page.evaluate(() => [...document.querySelectorAll('.al-card picture img')].map((image) => image.currentSrc.split('.').pop()));
    assert(formats.length && formats.every((format) => format === 'avif' || format === 'webp'), `thumb formats ${formats}`);

    // Filters.
    await page.selectOption('select[name="kind"]', 'portrait');
    assert.equal(await page.locator('.al-card').count(), portraits);
    assert.equal(await page.locator('#alOriginals').isHidden(), true);
    await page.selectOption('select[name="kind"]', 'illustration');
    assert.equal(await page.locator('.al-card').count(), 0);
    await page.locator('#alEmpty').waitFor();
    assert(page.url().includes('kind=illustration'));
    await page.locator('#alEmpty [data-clear]').click();
    await page.locator('.al-card').nth(catalog.assets.length - 1).waitFor();
    await page.selectOption('select[name="review"]', 'gap');
    assert.equal(await page.locator('.al-card').count(), 0);
    assert.equal(await page.locator('#alGaps .al-gap').count(), catalog.gaps.length);
    await page.selectOption('select[name="review"]', 'publication-ready');
    assert.equal(await page.locator('#alGaps').isHidden(), true);
    await page.selectOption('select[name="review"]', '');
    await page.selectOption('select[name="region"]', 'central');
    const central = catalog.assets.filter((asset) => asset.region_ids.includes('central')).length;
    assert.equal(await page.locator('.al-card').count(), central);
    await page.selectOption('select[name="region"]', '');
    await page.selectOption('select[name="license"]', scene.license_name);
    assert.equal(await page.locator('.al-card').count(), catalog.assets.filter((asset) => asset.license_name === scene.license_name).length);
    await page.selectOption('select[name="license"]', '');
    await page.selectOption('select[name="use"]', 'council');
    assert.equal(await page.locator('.al-card').count(), catalog.assets.filter((asset) => asset.uses.includes('council')).length);
    await page.selectOption('select[name="use"]', '');
    await page.fill('input[name="q"]', '消防');
    assert.deepEqual(await page.locator('.al-card').evaluateAll((cards) => cards.map((card) => card.dataset.asset)), [scene.id]);

    // Copy from the card, then the detail of a real photo.
    await page.locator('.al-card button', { hasText: '複製 ID' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), scene.id);
    const opener = page.locator('.al-card button', { hasText: '看來源與尺寸' });
    await opener.click();
    const dialog = page.locator('#alDetail');
    await dialog.waitFor();
    assert.equal(await dialog.locator('[data-nature]').getAttribute('data-tone'), 'photo');
    assert.equal(await dialog.locator(`a[href="${scene.original_source_url}"]`).count(), 1);
    assert.equal(await dialog.locator(`a[href="${scene.license_url}"]`).count(), 1);
    assert((await dialog.locator('[data-preview] picture source').count()) >= 2);
    assert(await noSideScroll(page));
    assert(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), `detail overflows at ${width}`);
    await dialog.locator('[data-copy="credit"]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), scene.attribution);
    await dialog.locator('[data-copy="embed"]').click();
    const embed = await page.evaluate(() => navigator.clipboard.readText());
    assert(embed.includes('<picture>') && embed.includes('image/avif') && embed.includes(scene.attribution));
    if (width === 390 || width === 1280) await shot(page, `lab-${width}-detail-photo.png`);
    assert(page.url().includes(`asset=${scene.id}`));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await opener.evaluate((node) => node === document.activeElement), true, 'focus returns to the opener');

    // The original component runs inside the page, with no iframe and no inline script.
    await page.fill('input[name="q"]', '');
    await page.selectOption('select[name="kind"]', 'component');
    await page.locator('.al-card button', { hasText: '看來源與尺寸' }).first().click();
    await dialog.locator('[data-figure][data-state="live"]').waitFor();
    assert.equal(await dialog.locator('[data-nature]').getAttribute('data-tone'), 'original');
    assert.equal(await page.locator('iframe').count(), 0);
    const readout = dialog.locator('[data-readout]');
    await dialog.locator('.fig-controls [data-origin="2"]').click();
    await dialog.locator('.fig-controls [data-act="stamp"]').click();
    await page.waitForFunction(() => document.querySelector('#alDetail [data-readout]').textContent === '議事紀錄 · 已有佐證', null, { timeout: 8000 });
    assert.equal(await dialog.locator('.iso-stage').getAttribute('aria-valuetext'), '議事紀錄 · 已有佐證');
    await dialog.locator('.fig-controls [data-origin="3"]').click();
    await page.waitForFunction(() => document.querySelector('#alDetail [data-readout]').textContent === '公開貼文 · 未逐筆核對', null, { timeout: 8000 });
    assert.deepEqual(await smallTargets(page), []);
    assert(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    if (width === 390 || width === 1280) await shot(page, `lab-${width}-detail-component.png`);
    await dialog.locator('[data-close]').click();
    await dialog.waitFor({ state: 'hidden' });
    // The dialog's close event is queued, so the figure is removed a moment after it hides.
    await page.locator('#alDetail [data-figure]').waitFor({ state: 'detached' });
    assert.equal(await readout.count(), 0);

    assert.deepEqual(problems, [], `problems at ${width}`);
    summary.widths[width] = result;
    await context.close();
  }

  // The budget drawers read real project records. Expected amounts come from the same file the page reads.
  for (const width of [390, 1280]) {
    const problems = [];
    const governance = await (await fetch(origin + '/data/governance.json')).json();
    const withBudget = governance.projects.find((project) => project.budget && project.budget.approved_twd !== null && project.budget.spent_twd === null);
    const withoutBudget = governance.projects.find((project) => project.budget === null);
    assert(withBudget && withoutBudget, 'the pilot records include a project with a budget and one without');
    const amount = (value) => `${new Intl.NumberFormat('zh-Hant-TW').format(value)} 元`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 600 });
    const page = await openLab(context, problems, '/asset-lab.html?asset=component-budget-drawers');
    const dialog = page.locator('#alDetail');
    await dialog.locator('[data-figure="budget-drawers"][data-state="live"]').waitFor();
    const readout = () => dialog.locator('[data-readout]').textContent();
    assert.equal(await readout(), '核定 · 還沒選案卷');
    assert.equal(/\d/.test(await dialog.locator('.fig-facts').textContent()), false, 'no amount before a project is chosen');
    await page.waitForFunction(() => document.querySelectorAll('#alDetail [data-project] option').length > 1);
    await dialog.locator('[data-project]').selectOption(withBudget.id);
    await dialog.locator('[data-layer="0"]').click();
    await page.waitForFunction((text) => document.querySelector('#alDetail [data-readout]').textContent === text, `核定 · ${amount(withBudget.budget.approved_twd)}`, { timeout: 8000 });
    assert.equal(await dialog.locator('[data-value="1"]').textContent(), amount(withBudget.budget.contract_twd));
    assert.equal(await dialog.locator('[data-value="2"]').textContent(), '本站沒有紀錄，不是 0 元');
    await dialog.locator('[data-layer="2"]').click();
    await page.waitForFunction(() => document.querySelector('#alDetail [data-readout]').textContent === '實支 · 本站沒有紀錄，不是 0 元');
    assert.equal(await dialog.locator('[data-latch="2"][data-on]').count(), 1);
    assert.equal(await dialog.locator('[data-latch="0"][data-on]').count(), 0);
    assert.equal(await dialog.locator('[data-layer="2"]').getAttribute('aria-pressed'), 'false', 'a latched drawer does not open');
    assert((await dialog.locator('[data-source] a').getAttribute('href')).startsWith('https://'));
    assert(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    assert.deepEqual(await smallTargets(page), []);
    await shot(page, `lab-${width}-detail-budget.png`);
    await dialog.locator('[data-project]').selectOption(withoutBudget.id);
    await page.waitForFunction(() => document.querySelectorAll('#alDetail [data-latch][data-on]').length === 3);
    assert((await dialog.locator('[data-source]').textContent()).includes('不代表機關沒有公開'));
    assert.equal(/\d{4,}/.test(await dialog.locator('.fig-facts').textContent()), false, 'no amount for a project without a budget record');
    assert.deepEqual(problems, [], `budget figure problems at ${width}`);
    await context.close();
  }
  summary.checks.push('budget drawers bound to governance records');

  // Without the project records the cabinet still works and says why it shows no amounts.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.route('**/data/governance.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.goto(origin + '/art-library/figures/budget-drawers/index.html');
    await page.locator('[data-figure][data-state="live"]').waitFor();
    await page.locator('[data-project][disabled]').waitFor();
    assert((await page.locator('[data-source]').textContent()).includes('讀不到案卷資料'));
    await page.locator('[data-layer="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-readout]').textContent === '決標 · 還沒選案卷');
    summary.checks.push('budget drawers without records');
    await context.close();
  }

  // A deep link opens the same asset.
  {
    const problems = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await openLab(context, problems, `/asset-lab.html?kind=portrait&asset=portrait-chiu-hccg`);
    await page.locator('#alDetail[open]').waitFor();
    assert.equal(await page.locator('#alDetailTitle').textContent(), '邱臣遠官方肖像');
    assert.equal(await page.locator('.al-card').count(), portraits);
    assert.deepEqual(problems, []);
    summary.checks.push('deep link');
    await context.close();
  }

  // Keyboard only, with reduced motion: the stamp lands at once and nothing animates.
  {
    const problems = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    watch(page, problems);
    await page.goto(origin + '/art-library/figures/evidence-desk/index.html');
    await page.locator('[data-figure][data-state="live"]').waitFor();
    assert.equal(await page.locator('script:not([src])').count(), 0, 'no inline script');
    const stage = page.locator('.iso-stage');
    await stage.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => document.querySelector('[data-readout]').textContent === '新聞報導 · 已有佐證');
    assert.equal(await stage.getAttribute('aria-valuenow'), '1');
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('[data-readout]').textContent === '公開貼文 · 未逐筆核對');
    await page.locator('[data-act="reset"]').click();
    await stage.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[data-readout]').textContent === '新聞報導 · 未逐筆核對');
    assert(await noSideScroll(page));
    assert.deepEqual(problems, []);
    await shot(page, 'figure-evidence-desk-1280.png');
    summary.checks.push('figure keyboard + reduced motion');
    await context.close();
  }

  // When the index or a figure module fails, the page says so and keeps something to look at.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.route('**/data/art-library.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.goto(origin + '/asset-lab.html');
    await page.locator('#alAlert:not([hidden])').waitFor();
    assert((await page.locator('#alAlert').textContent()).includes('讀不到'));
    assert.equal(await page.locator('.al-card').count(), 0);
    assert.equal((await page.locator('#alCount').textContent()).includes('0 件'), false);
    await page.unroute('**/data/art-library.json');
    await page.locator('#alAlert button').click();
    await page.locator('.al-card').first().waitFor();
    await page.close();

    const still = await context.newPage();
    await still.route('**/evidence-desk/live.js', (route) => route.abort());
    await still.goto(origin + '/art-library/figures/evidence-desk/index.html');
    await still.locator('[data-figure][data-state="still"]').waitFor();
    assert(await still.locator('.iso-stage svg').isVisible(), 'the drawing stays when its module fails');
    await still.close();

    const fallback = await context.newPage();
    await fallback.route('**/evidence-desk/fragment.html', (route) => route.abort());
    await fallback.goto(origin + `/asset-lab.html?asset=${component.id}`);
    await fallback.locator('#alDetail [data-figure][data-state="still"] img.fig-fallback').waitFor();
    assert(await fallback.locator('#alDetail img.fig-fallback').evaluate((image) => image.complete && image.naturalWidth > 0));
    await fallback.close();
    summary.checks.push('failure states');
    await context.close();
  }

  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
}
