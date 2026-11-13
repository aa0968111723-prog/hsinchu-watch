/** Acceptance for the bright civic layer.
 *
 *  node src/civic-ui/checks/verify-lab.mjs
 *
 *  Serves a production build of ui-lab.html and index.html over public/, then
 *  checks overflow, the shared reading, keyboard, reduced motion, touch size,
 *  contrast, and that filters, saving and the archive pager change the view.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, WIDTHS, launch, previewServer } from "./harness.mjs";

const shots = join(ROOT, "docs", "design", "evidence");
mkdirSync(shots, { recursive: true });
const server = await previewServer();
const browser = await launch();
const failures = [];

function overflowOf(page) {
  return page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${server.origin}/ui-lab.html`, { waitUntil: "networkidle" });
  await page.locator("#labHome [data-readout]").filter({ hasText: "9,164" }).waitFor({ timeout: 8000 });
  assert.match(await page.locator("#labHome [data-look]").innerText(), /新聞與討論/);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const over = await overflowOf(page);
    assert.ok(over.page <= 1 && over.body <= 1, `${width}px lab overflows by ${JSON.stringify(over)}`);
    if (width <= 430) {
      const short = await page.locator(".civic-chip, .civic-btn, .civic-place").evaluateAll((nodes) =>
        nodes.filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.height < 43.5;
        }).map((node) => node.textContent.trim().slice(0, 24)));
      assert.deepEqual(short, [], `${width}px controls under 44px: ${short.join(", ")}`);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#labHome [data-kind='policy']").click();
  await page.locator("#labHome [data-readout]").filter({ hasText: "1,879" }).waitFor();
  assert.match(await page.locator("#labHome [data-look] h3").innerText(), /政策與施政紀錄/);
  const policyShare = await page.locator("#labHome [data-row='policy'] [data-share]").textContent();
  assert.equal(policyShare, "20.5%");
  await page.screenshot({ path: join(shots, "lab-390-policy.png"), fullPage: false });

  const stage = page.locator("#labHome .civic-stage");
  await stage.focus();
  const before = await stage.getAttribute("aria-valuenow");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction((value) => document.querySelector("#labHome .civic-stage").getAttribute("aria-valuenow") !== value, before);
  assert.match(await page.locator("#labHome [data-say]").textContent(), /筆/);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#labHome [data-kind='governance']").click();
  await page.locator("#labHome [data-readout]").filter({ hasText: "地方治理案卷" }).waitFor({ timeout: 3000 });
  assert.equal(await page.locator("#labHome .civic-door[href='/governance.html']").innerText().then((text) => text.includes("4")), true);

  await page.locator("#governance").scrollIntoViewIfNeeded();
  await page.locator("#labGovernance [data-cards] article").first().waitFor();
  assert.equal(await page.locator("#labGovernance [data-cards] article").count(), 4);
  await page.locator("#labGovernance [data-facet='region'] [data-value='taipei']").click();
  await page.locator("#labGovernance [data-count]").filter({ hasText: "顯示 1 件" }).waitFor();
  const dossier = page.locator("#labGovernance article").first();
  assert.match(await dossier.innerText(), /尚未收錄/);
  assert.match(await dossier.innerText(), /不是驗收|工程進度/);
  await dossier.locator("summary").first().click();
  assert.match(await dossier.innerText(), /機關發布|查閱日/);
  await page.locator("#labGovernance [data-compare-toggle]").click();
  await page.locator("#dossier-compare").waitFor({ state: "visible" });
  assert.match(await page.locator("#dossier-compare").innerText(), /尚未收錄/);

  await page.locator("#atlas").scrollIntoViewIfNeeded();
  assert.match(await page.locator("#labSide [data-count]").innerText(), /待定位 4 件/);
  await page.locator("#labSide [data-place]").first().click();
  assert.match(await page.locator("#labMapLog").innerText(), /"located":false/);
  await page.locator("#labMapPick").click();
  assert.match(await page.locator("#labMapLog").innerText(), /api\.select/);

  await page.locator("#style").scrollIntoViewIfNeeded();
  const weak = await page.locator("#labStyle [data-ratio]").evaluateAll((nodes) =>
    nodes.map((node) => ({ name: node.querySelector("b").textContent, ratio: Number(node.dataset.ratio) })).filter((item) => item.ratio < 4.5));
  assert.deepEqual(weak, [], `contrast below 4.5: ${JSON.stringify(weak)}`);
  await page.locator("[data-civic-theme-toggle]").click();
  await page.waitForFunction(() => document.documentElement.dataset.civicTheme === "dark");
  const weakDark = await page.locator("#labStyle [data-ratio]").evaluateAll((nodes) =>
    nodes.map((node) => ({ name: node.querySelector("b").textContent, ratio: Number(node.dataset.ratio) })).filter((item) => item.ratio < 4.5));
  assert.deepEqual(weakDark, [], `dark contrast below 4.5: ${JSON.stringify(weakDark)}`);
  await page.screenshot({ path: join(shots, "lab-390-dark.png"), fullPage: false });
  await page.locator("[data-civic-theme-toggle]").click();

  await page.locator("#archive").scrollIntoViewIfNeeded();
  const archiveStatus = page.locator("#labArchive .civic-toolbar p");
  await page.locator("#labArchive [data-load]").evaluate((button) => button.click());
  try {
    await archiveStatus.filter({ hasText: "18,422" }).waitFor({ timeout: 8000 });
  } catch (error) {
    console.error("LOADBOX", await page.locator("#labArchive [data-loadbox]").textContent());
    console.error("TOOLBAR", await page.locator("#labArchive .civic-toolbar").textContent());
    console.error("WORK HIDDEN", await page.locator("#labArchive [data-work]").getAttribute("hidden"));
    console.error(errors);
    throw error;
  }
  await page.locator("#labArchive [data-query]").fill("褒忠");
  await archiveStatus.filter({ hasNotText: "18,422" }).waitFor();
  assert.doesNotMatch(await page.locator("#labArchive [data-readout]").innerText(), /9,164/);
  await page.locator("#labArchive [data-reset]").click();
  await page.locator("#labArchive [data-kind='governance']").click();
  await page.locator("#labArchive [data-rows]").filter({ hasText: "褒忠" }).waitFor();
  assert.ok((await overflowOf(page)).page <= 1, "archive view overflows at 390");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(shots, "lab-1280.png"), fullPage: false });
  assert.deepEqual(errors, []);
  await context.close();

  const home = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const homePage = await home.newPage();
  const homeErrors = [];
  homePage.on("pageerror", (error) => homeErrors.push(error.message));
  await homePage.goto(`${server.origin}/index.html`, { waitUntil: "networkidle" });
  await homePage.locator("#civicHome [data-readout]").filter({ hasText: "9,164" }).waitFor();
  await homePage.locator("#pulsePlot svg").waitFor();
  for (const width of WIDTHS) {
    await homePage.setViewportSize({ width, height: 900 });
    const over = await overflowOf(homePage);
    assert.ok(over.page <= 1, `${width}px home overflows by ${JSON.stringify(over)}`);
  }
  await homePage.setViewportSize({ width: 390, height: 844 });
  await homePage.screenshot({ path: join(shots, "home-390.png"), fullPage: false });
  assert.equal(await homePage.locator("#latestTop").evaluate((node) =>
    Boolean(node.compareDocumentPosition(document.querySelector(".pulse")) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  assert.deepEqual(homeErrors, []);
  await home.close();
  console.log(JSON.stringify({ origin: server.origin, widths: WIDTHS, lab: "pass", home: "pass", archive: "18422", contrast: "pass", keyboard: "pass", reducedMotion: "pass" }));
} catch (error) {
  failures.push(error);
  console.error(error);
} finally {
  await browser.close();
  await server.close();
}
if (failures.length) process.exit(1);
