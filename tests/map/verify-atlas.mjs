// 政策與工程地圖的瀏覽器驗收。用法與 tools/release/verify-*.mjs 相同：
//   node tests/map/verify-atlas.mjs [origin] [截圖資料夾]
// origin 可以是 vite 開發伺服器，也可以是 dist 的靜態伺服器。涵蓋五種寬度、滑鼠、鍵盤、觸控、
// reduced-motion、沒有 WebGL、沒有 JavaScript，以及各種資料載入失敗。
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const [origin = 'http://127.0.0.1:5183', screenshots = 'artifacts/screens'] = process.argv.slice(2);
mkdirSync(screenshots, { recursive: true });
const url = (hash = '') => `${origin}/atlas.html${hash}`;
const WIDTHS = [320, 390, 430, 768, 1280];
const IDS = { peiying: 'taipei-peiying-housing', siyuan: 'new-taipei-siyuan-footbridge', baozhong: 'hsinchu-county-baozhong-road', xiangshan: 'hsinchu-city-xiangshan-four' };
const errors = [];
const summary = {};

async function until(check, message, timeout = 6000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try { last = await check(); if (last) return last; } catch (error) { last = error; }
    await new Promise((done) => setTimeout(done, 60));
  }
  throw new Error(`等不到：${message}（最後結果 ${last instanceof Error ? last.message : JSON.stringify(last)}）`);
}

// 腳本錯誤與 CSP 違規都算失敗（origin 送出正式站標頭時，行內腳本或外部連線會在這裡被抓到）。
// 「Failed to load resource」是測試故意讓資料檔失敗時瀏覽器印的，不算。
function watch(page, label) {
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(`${label}: ${message.text()}`); });
  return page.addInitScript(() => document.addEventListener('securitypolicyviolation', (event) => console.error(`CSP 違規 ${event.violatedDirective} ${event.blockedURI}`)));
}
const ready = (page, state = 'ready') => until(() => page.evaluate((expected) => document.getElementById('atlasApp').dataset.state === expected, state), `頁面狀態 ${state}`, 15000);
const hud = async (page) => {
  const text = await page.locator('#atlasCenter').innerText();
  const match = /([\d.]+)°E ([\d.]+)°N・放大 ([\d.]+) 倍/.exec(text);
  assert(match, `讀不到畫面中心：${text}`);
  return { lon: Number(match[1]), lat: Number(match[2]), zoom: Number(match[3]) };
};
const pinCount = (page) => page.locator('.atl-pin:not([hidden])').count();
const pin = (page, id) => page.locator(`.atl-pin[data-project="${id}"]`);
const noOverflow = async (page, label) => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} 有水平捲動`);
// 把地圖捲到視窗中央再回傳位置，之後的滑鼠與觸控座標才會落在視窗內。
const canvasBox = async (page) => {
  await page.evaluate(() => document.querySelector('.atl-canvas-wrap').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(80);
  return page.locator('#atlasCanvas').boundingBox();
};
const settled = (page) => page.waitForTimeout(520);

const browser = await chromium.launch();
try {
  // ---- 1. 五種寬度：載入、不溢出、觸控目標、平面與立體都畫得出來 ----
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 780 : 900 }, locale: 'zh-TW' });
    const page = await context.newPage();
    await watch(page, `w${width}`);
    await page.goto(url());
    await ready(page);
    assert.equal(await page.locator('.top .nav a').count(), 6);
    assert.equal(await pinCount(page), 3, `${width} 圖釘數`);
    assert.equal(await page.locator('#atlasList .atl-item').count(), 4);
    assert.equal(await page.locator('#atlasPendingBody .atl-pending li').count(), 1);
    assert((await page.locator('#atlasStatus').innerText()).includes('已定位 3・待定位 1'));
    assert(await page.locator('#atlasCanvas svg.atl-svg .atl-district').count() >= 57, '行政區沒有畫出來');
    await noOverflow(page, `${width} 平面`);
    for (const selector of ['#atlasZoomIn', '#atlasZoomOut', '#atlasZoomReset', '#atlasView-plan', '#atlasView-iso', '#atlasShare', '.atl-stage-chip', '.atl-item-main', '.atl-fav', '.atl-pin', '#atlasExport']) {
      const box = await page.locator(selector).first().boundingBox();
      assert(box && box.height >= 44 && box.width >= 44, `${width} ${selector} 觸控範圍 ${box?.width}×${box?.height}`);
    }
    const canvasBox = await page.locator('#atlasCanvas').boundingBox();
    assert(canvasBox.width >= width - 40 || width >= 960, `${width} 地圖寬度`);
    assert(canvasBox.height >= 300, `${width} 地圖高度`);
    await page.locator('#atlasCanvas').scrollIntoViewIfNeeded();
    await page.locator('.atl-canvas-wrap').screenshot({ path: `${screenshots}/atlas-${width}-plan.png` });
    await page.locator('#atlasView-iso').click();
    await until(() => page.evaluate(() => document.querySelector('#atlasCanvas svg').dataset.view === 'iso'), '切到立體示意');
    assert(await page.locator('#atlasCanvas .atl-furniture').count() === 1, '立體視角應有底座與尺規');
    assert((await page.locator('#atlasViewNote').innerText()).includes('立體示意視角'), '示意視角要有文字標示');
    assert.equal(await pinCount(page), 3);
    await noOverflow(page, `${width} 立體`);
    await settled(page);
    await page.locator('.atl-canvas-wrap').screenshot({ path: `${screenshots}/atlas-${width}-iso.png` });
    if ([390, 1280].includes(width)) await page.screenshot({ path: `${screenshots}/atlas-${width}-page.png`, fullPage: true });
    await context.close();
  }
  summary.widths = WIDTHS.length;

  // ---- 2. 桌面：滑鼠與鍵盤完整操作 ----
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW', acceptDownloads: true });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const page = await context.newPage();
    await watch(page, 'desktop');
    await page.goto(url());
    await ready(page);

    // 縮放、平移、重設
    const home = await hud(page);
    assert.equal(home.zoom, 1);
    assert(await page.locator('#atlasZoomReset').isDisabled());
    await page.locator('#atlasZoomIn').click();
    await until(async () => (await hud(page)).zoom > 1.4, '放大');
    await settled(page);
    const box = await canvasBox(page);
    assert(box.y >= 0 && box.y + box.height <= 900, '地圖應能完整捲進視窗');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5 - 120, box.y + box.height * 0.5 - 40, { steps: 6 });
    await page.mouse.up();
    const dragged = await hud(page);
    assert(dragged.lon > home.lon + 0.01, `往左拖曳後中心應往東：${home.lon} → ${dragged.lon}`);
    assert.equal(await page.locator('#atlasDetail').getAttribute('data-empty'), '', '拖曳不應選到案卷');
    await page.locator('#atlasZoomReset').click();
    await until(async () => (await hud(page)).zoom === 1, '重設視角');
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -400);
    await page.keyboard.up('Control');
    await until(async () => (await hud(page)).zoom > 1.5, 'Ctrl＋滾輪放大');
    await page.mouse.wheel(0, 300);
    await until(() => page.locator('.atl-wheel-hint').isVisible(), '單純滾輪只提示，不搶頁面捲動');
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('#atlasZoomReset').click();
    await until(async () => (await hud(page)).zoom === 1, '重設視角');

    // 點圖釘 → 來源卡、列表、時間軸、網址同步
    await pin(page, IDS.baozhong).click();
    await until(() => page.locator('#atlasDetailTitle').innerText().then((text) => text === '新埔褒忠路道路拓寬'), '來源卡標題');
    assert.equal(await pin(page, IDS.baozhong).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator(`.atl-item[data-project="${IDS.baozhong}"]`).getAttribute('data-selected'), '');
    assert.equal(await page.locator('.atl-tl-row[data-selected]').count(), 1);
    await until(() => page.evaluate((id) => location.hash.includes(`p=${id}`), IDS.baozhong), '網址帶案卷');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'atlasDetailTitle', '選取後焦點移到來源卡標題');
    const card = await page.locator('#atlasDetail').innerText();
    for (const text of ['路段或路口', '新竹縣新埔鎮', '全長1360公尺', '線段長 1,375 公尺', 'NT$ 975,210,000', 'NT$ 752,800,000', '尚未收錄', '來源沒有寫日期', '出席開工動土典禮', '不代表個人對核定', '座標查閱日']) assert(card.includes(text), `褒忠路來源卡缺「${text}」`);
    assert.equal(await page.locator('#atlasDetail .atl-bar-row[data-unknown]').count(), 1, '實際支用未知要畫成未收錄，不是 0');
    assert.equal(await page.locator('#atlasDetail .atl-bar-row[data-unknown] .atl-bar-fill').count(), 0);
    assert.deepEqual(await page.locator('#atlasDetail .atl-rail-step').evaluateAll((nodes) => nodes.map((node) => node.dataset.status)), ['not_recorded', 'stated_undated', 'documented', 'not_recorded', 'not_recorded', 'not_recorded', 'not_recorded']);
    for (const href of await page.locator('#atlasDetail a[target="_blank"]').evaluateAll((nodes) => nodes.map((node) => node.href))) assert(href.startsWith('https://'), `來源連結不是 https：${href}`);
    await settled(page);
    await until(() => page.locator('.atl-wheel-hint').isHidden(), '滾輪提示自己消失');
    const edges = await page.evaluate(() => {
      const canvas = document.getElementById('atlasCanvas').getBoundingClientRect();
      const sea = document.querySelector('#atlasCanvas .atl-sea-flat').getBoundingClientRect();
      return { left: sea.left - canvas.left, top: sea.top - canvas.top, right: canvas.right - sea.right, bottom: canvas.bottom - sea.bottom };
    });
    for (const [side, gap] of Object.entries(edges)) assert(gap <= 1, `平面視角放大後 ${side} 邊露出圖框外的空白 ${gap}px`);
    await page.locator('.atl-workspace').screenshot({ path: `${screenshots}/atlas-1280-detail.png` });

    // 列表 → 地圖同步；上下鍵在列表移動
    await page.locator(`[data-select="${IDS.peiying}"]`).first().click();
    await until(() => pin(page, IDS.peiying).getAttribute('aria-pressed').then((value) => value === 'true'), '列表選取後圖釘同步');
    const peiying = await page.locator('#atlasDetail').innerText();
    for (const text of ['基地點位', '中山區', '121.54844, 25.07997', '永安里', '5.2 公尺', '100%', '不是驗收、啟用或成效', '準備中', '工程金額（原文數字）', '地下3層、地上14層']) assert(peiying.includes(text), `培英來源卡缺「${text}」`);
    assert.equal(await page.locator('#atlasDetail .atl-bar-row[data-unknown]').count(), 3, '培英案三欄經費都未收錄');
    assert.equal(await page.locator(`#atlasDetail [data-site="${IDS.peiying}"]`).count(), 1, '培英案應有現地沙盤按鈕');
    await page.locator(`#atlasDetail [data-site="${IDS.peiying}"]`).click();
    await until(() => page.evaluate((id) => location.hash.includes(`s=site:${id}`) && document.querySelector('#atlasCanvas svg')?.dataset.scene === 'site', IDS.peiying), '進入現地沙盤');
    assert(await page.locator('#atlasCanvas .atl-site-building, #atlasCanvas .atl-site-construction, #atlasCanvas .atl-site-road').count() >= 1, '現地沙盤應畫出 OSM 地物');
    assert((await page.locator('#atlasViewNote').innerText()).includes('現地沙盤'), '現地視角要有文字標示');
    assert((await page.locator('#atlasViewNote').innerText()).includes('不是預算') || (await page.locator('#atlasViewNote').innerText()).includes('OpenStreetMap'), '現地說明要分開真實與示意');
    await page.locator('#atlasView-iso').click();
    await until(() => page.evaluate(() => document.querySelector('#atlasCanvas svg').dataset.view === 'iso' && document.querySelector('#atlasCanvas svg').dataset.scene === 'site'), '現地立體示意');
    assert(await page.locator('#atlasCanvas .atl-furniture').count() === 1, '現地立體應有底座');
    await settled(page);
    await page.locator('.atl-canvas-wrap').screenshot({ path: `${screenshots}/atlas-1280-site-iso.png` });
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => document.querySelector('#atlasCanvas svg')?.dataset.scene === 'region'), 'Esc 離開現地沙盤回地區圖');
    await page.locator(`#atlasDetail [data-site="${IDS.peiying}"]`).click();
    await until(() => page.evaluate(() => document.querySelector('#atlasCanvas svg')?.dataset.scene === 'site'), '再次進入現地');
    await page.locator(`#atlasDetail [data-site="${IDS.peiying}"]`).click();
    await until(() => page.evaluate(() => document.querySelector('#atlasCanvas svg')?.dataset.scene === 'region'), '按鈕切回地區圖');

    // 現地離開後仍在台北地區篩選；先回全部地區，列表才有上下鄰居可測方向鍵。
    await page.locator('#atlasRegion').selectOption('');
    await until(() => page.evaluate(() => document.querySelector('#atlasCanvas svg')?.dataset.scene === 'overview'), '地區選全部後回總覽');
    await page.locator(`[data-select="${IDS.peiying}"]`).first().click();
    await until(() => pin(page, IDS.peiying).getAttribute('aria-pressed').then((value) => value === 'true'), '總覽下再選培英');
    await page.locator(`.atl-item[data-project="${IDS.peiying}"] .atl-item-main`).focus();
    await page.keyboard.press('ArrowUp');
    const moved = await page.evaluate(() => document.activeElement.closest('.atl-item')?.dataset.project);
    assert(moved && moved !== IDS.peiying, '方向鍵應移到上一個案卷');
    assert.equal(await page.locator(`.atl-pin[data-project="${moved}"][data-hover]`).count(), 1, '列表聚焦時對應圖釘要亮起');

    // Esc 關閉並把焦點還給圖釘
    await pin(page, IDS.siyuan).click();
    await until(() => page.locator('#atlasDetailTitle').innerText().then((text) => text.includes('思源路')), '思源路來源卡');
    const siyuan = await page.locator('#atlasDetail').innerText();
    for (const text of ['77.25%', '來源沒有標示，不能當作目前進度', '不是天橋落墩', '88 公尺']) assert(siyuan.includes(text), `思源路來源卡缺「${text}」`);
    await page.keyboard.press('Escape');
    await until(() => page.locator('#atlasDetail').getAttribute('data-empty').then((value) => value === ''), 'Esc 關閉來源卡');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.project), IDS.siyuan, '關閉後焦點回到圖釘');

    // 純鍵盤：地圖平移縮放、Tab 到圖釘、Enter 開卡
    await page.locator('#atlasCanvas').focus();
    await page.keyboard.press('+');
    await until(async () => (await hud(page)).zoom > 1.3, '鍵盤放大');
    const beforePan = await hud(page);
    await page.keyboard.press('ArrowRight');
    await until(async () => (await hud(page)).lon > beforePan.lon, '鍵盤向右平移');
    await page.keyboard.press('0');
    await until(async () => (await hud(page)).zoom === 1, '鍵盤重設');
    await page.keyboard.press('Tab');
    const focusedPin = await page.evaluate(() => document.activeElement.classList.contains('atl-pin') && document.activeElement.dataset.project);
    assert(focusedPin, 'Tab 應從地圖移到第一支圖釘');
    assert((await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)) !== 'none', '圖釘聚焦要看得到外框');
    assert((await page.evaluate(() => document.activeElement.getAttribute('aria-label'))).includes('地點精度'));
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => document.activeElement.id === 'atlasDetailTitle'), 'Enter 開來源卡');
    await page.locator('[data-close-detail]').click();

    // 視角切換：同一個中心經緯度
    await page.locator('#atlasZoomIn').click();
    await until(async () => (await hud(page)).zoom > 1.4, '放大');
    const planView = await hud(page);
    await page.locator('#atlasView-iso').click();
    await until(() => page.evaluate(() => document.querySelector('#atlasCanvas svg').dataset.view === 'iso'), '立體示意');
    const isoView = await hud(page);
    assert(Math.abs(isoView.lon - planView.lon) < 0.002 && Math.abs(isoView.lat - planView.lat) < 0.002, `切換視角後中心應不變：${JSON.stringify(planView)} → ${JSON.stringify(isoView)}`);
    assert(await page.locator('#atlasScale').isHidden(), '立體視角不顯示平面比例尺');
    await page.locator('#atlasView-plan').click();
    await until(() => page.locator('#atlasScale').isVisible(), '平面比例尺');
    assert(/^\d+(\.\d+)? (公里|公尺)$/.test(await page.locator('#atlasScale').innerText()));
    await page.locator('#atlasZoomReset').click();

    // 地區、議題、階段、關鍵字篩選
    await page.locator('#atlasRegion').selectOption('hsinchu-county');
    await until(() => page.locator('#atlasCrumbs').innerText().then((text) => text.includes('新竹縣')), '地區層級');
    assert.equal(await page.locator('#atlasList .atl-item').count(), 1);
    assert.equal(await pinCount(page), 1);
    assert.equal(await page.evaluate(() => document.querySelector('#atlasCanvas svg').dataset.scene), 'region');
    await page.locator('#atlasCrumbs [data-scene="overview"]').click();
    await until(() => page.locator('#atlasList .atl-item').count().then((count) => count === 4), '回到總覽');
    assert.equal(await page.locator('#atlasRegion').inputValue(), '');
    await page.locator('[data-stage-filter="completion"]').click();
    assert.equal(await page.locator('#atlasList .atl-item').count(), 1);
    assert.equal(await pinCount(page), 1);
    assert.equal(await page.locator('.atl-tl-row').count(), 1, '時間軸跟著篩選');
    await page.locator('[data-stage-filter="none"]').click();
    assert.equal(await page.locator('#atlasList .atl-item').count(), 1);
    assert.equal(await pinCount(page), 0, '七階段未收錄的那一案沒有座標，不該有圖釘');
    assert((await page.locator('#atlasList').innerText()).includes('待定位'));
    await page.locator('[data-stage-filter=""]').click();
    await page.locator('#atlasTopic').selectOption('housing');
    assert.equal(await page.locator('#atlasList .atl-item').count(), 1);
    await page.locator('#atlasQuery').fill('不存在的工程');
    assert.equal(await page.locator('#atlasList .atl-item').count(), 0);
    assert(await page.locator('#atlasExport').isDisabled());
    assert((await page.locator('#atlasList').innerText()).includes('沒有符合條件'));
    await page.locator('#atlasFilters button[type="reset"]').click();
    await until(() => page.locator('#atlasList .atl-item').count().then((count) => count === 4), '重設篩選');

    // 點行政區：總覽進入地區，地區內標示行政區
    await canvasBox(page);
    const point = await page.evaluate(() => { const node = document.querySelector('.atl-district[data-name="尖石鄉"]'); const box = node.getBoundingClientRect(); return [box.x + box.width / 2, box.y + box.height / 2]; });
    await page.mouse.click(point[0], point[1]);
    await until(() => page.locator('#atlasCrumbs').innerText().then((text) => text.includes('新竹縣')), '點行政區進入地區');
    await page.locator('#atlasCanvas').focus();
    await page.keyboard.press('Escape');
    await until(() => page.locator('#atlasCrumbs').innerText().then((text) => !text.includes('新竹縣')), 'Esc 回總覽');

    // 收藏：與治理頁共用同一個鍵，重新整理後仍在
    await page.locator(`.atl-item[data-project="${IDS.baozhong}"] .atl-fav`).click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('governance-watch-v1'))), [IDS.baozhong]);
    await page.reload();
    await ready(page);
    assert.equal(await page.locator(`.atl-item[data-project="${IDS.baozhong}"] .atl-fav`).getAttribute('aria-pressed'), 'true');
    await page.locator('#atlasFavOnly').check();
    assert.equal(await page.locator('#atlasList .atl-item').count(), 1);
    assert.equal(await pinCount(page), 1);
    await page.locator('#atlasFavOnly').uncheck();

    // 分享：連結包含案卷與地圖位置，貼回去會還原
    await pin(page, IDS.peiying).click();
    await until(() => page.locator('#atlasDetailTitle').innerText().then((text) => text.includes('培英')), '培英來源卡');
    await settled(page);
    await page.locator('#atlasDetail [data-share]').click();
    await until(() => page.locator('#atlasDetail [data-share-out]').innerText().then((text) => text.includes('已複製')), '分享訊息');
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    assert(shared.includes(`p=${IDS.peiying}`) && /c=121\.\d+,25\.\d+/.test(shared) && /z=\d/.test(shared), `分享網址不完整：${shared}`);
    const sharedView = await hud(page);
    const second = await context.newPage();
    await watch(second, 'shared');
    await second.goto(shared);
    await ready(second);
    await until(() => second.locator('#atlasDetailTitle').innerText().then((text) => text.includes('培英')), '分享連結還原案卷');
    const restored = await hud(second);
    assert(Math.abs(restored.lon - sharedView.lon) < 0.003 && Math.abs(restored.lat - sharedView.lat) < 0.003 && Math.abs(restored.zoom - sharedView.zoom) < 0.05, `分享連結應還原位置：${JSON.stringify(sharedView)} → ${JSON.stringify(restored)}`);
    await second.close();

    // 匯出 CSV：含 BOM、待定位列沒有座標
    await page.locator('[data-close-detail]').click();
    const downloading = page.waitForEvent('download');
    await page.locator('#atlasExport').click();
    const bytes = await readFile(await (await downloading).path());
    assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
    const csv = bytes.toString('utf8');
    assert(csv.includes('"香山四號道路補辦土地程序"') && csv.includes('"待定位"') && csv.includes('121.548438') && csv.includes('"尚未收錄"'));
    assert.equal(csv.split('\r\n').length, 5, 'CSV 應有表頭加四案');

    // 深層連結：地區＋立體＋案卷
    await page.goto(url(`#s=region:taipei&v=iso&p=${IDS.peiying}`));
    await page.reload();
    await ready(page);
    assert.equal(await page.evaluate(() => document.querySelector('#atlasCanvas svg').dataset.view), 'iso');
    assert((await page.locator('#atlasCrumbs').innerText()).includes('台北市'));
    assert((await page.locator('#atlasDetailTitle').innerText()).includes('培英'));
    assert.equal(await page.locator('#atlasRegion').inputValue(), 'taipei');
    await context.close();
    summary.desktop = 'mouse, keyboard, filters, favorites, share, csv, deep link';
  }

  // ---- 3. 手機觸控：點圖釘開底部面板、單指拖曳、雙指縮放 ----
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, locale: 'zh-TW' });
    const page = await context.newPage();
    await watch(page, 'touch');
    await page.goto(url());
    await ready(page);
    assert.equal(await page.locator('#atlasFilterBox').evaluate((node) => node.open), false, '手機預設收合篩選，先看到地圖');
    const top = (await page.locator('#atlasCanvas').boundingBox()).y;
    assert(top < 780 * 0.75, `手機第一個畫面要看得到地圖（地圖頂端在 ${top}px）`);
    await pin(page, IDS.peiying).tap();
    await until(() => page.locator('#atlasDetail').getAttribute('data-sheet').then((value) => value === 'half'), '底部面板打開');
    await settled(page);
    const sheet = await page.locator('#atlasDetail').evaluate((node) => { const box = node.getBoundingClientRect(); return { position: getComputedStyle(node).position, top: box.top, bottom: box.bottom, height: box.height }; });
    assert.equal(sheet.position, 'fixed');
    assert(Math.abs(sheet.bottom - 780) < 2 && sheet.height > 300 && sheet.height < 780 * 0.6, `底部面板位置不對：${JSON.stringify(sheet)}`);
    const pinBox = await pin(page, IDS.peiying).boundingBox();
    assert(pinBox.y + pinBox.height < sheet.top + 4 && pinBox.y > 80, `選取的圖釘應留在面板上方看得到的地方：圖釘 ${pinBox.y}–${pinBox.y + pinBox.height}，面板頂 ${sheet.top}`);
    await page.screenshot({ path: `${screenshots}/atlas-390-sheet.png` });
    await page.locator('#atlasSheetHandle').tap();
    await until(() => page.locator('#atlasDetail').getAttribute('data-sheet').then((value) => value === 'full'), '面板展開');
    assert.equal(await page.locator('#atlasSheetHandle').getAttribute('aria-expanded'), 'true');
    await settled(page);
    assert((await page.locator('#atlasDetail').boundingBox()).height > 780 * 0.8);
    await noOverflow(page, '手機面板展開');
    await page.locator('#atlasDetail [data-locate]').tap();
    await until(() => page.locator('#atlasDetail').getAttribute('data-sheet').then((value) => value === 'peek'), '置中後面板縮成一列');
    await page.locator('[data-close-detail]').tap();
    await until(() => page.locator('#atlasDetail').isHidden(), '面板關閉');

    // 真實觸控事件（CDP）：單指拖曳平移、雙指張開放大
    if (await page.locator('#atlasZoomReset').isEnabled()) await page.locator('#atlasZoomReset').tap();
    await settled(page);
    const box = await canvasBox(page);
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id })) });
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const before = await hud(page);
    await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]);
    for (const spread of [50, 80, 110]) await touch('touchMove', [[cx - spread, cy], [cx + spread, cy]]);
    await touch('touchEnd', []);
    const pinched = await until(async () => { const now = await hud(page); return now.zoom > before.zoom * 2 ? now : null; }, '雙指張開放大');
    const scrollBefore = await page.evaluate(() => scrollY);
    await touch('touchStart', [[cx, cy]]);
    for (const dx of [20, 50, 90]) await touch('touchMove', [[cx - dx, cy + dx / 3]]);
    await touch('touchEnd', []);
    const panned = await until(async () => { const now = await hud(page); return now.lon > pinched.lon + 0.005 ? now : null; }, '單指拖曳平移');
    assert(Math.abs(panned.zoom - pinched.zoom) < 0.01);
    assert.equal(await page.evaluate(() => scrollY), scrollBefore, '在地圖上拖曳不應捲動頁面');
    await context.close();
    summary.touch = 'tap, bottom sheet, pinch, drag';
  }

  // ---- 4. reduced-motion：沒有動畫，功能一樣 ----
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', locale: 'zh-TW' });
    const page = await context.newPage();
    await watch(page, 'reduced-motion');
    await page.goto(url());
    await ready(page);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.atl-zoom')).animationName), 'none', '減少動態時場景不淡入');
    await page.locator('#atlasZoomIn').click();
    assert((await hud(page)).zoom > 1.4, '減少動態時縮放一步到位');
    await pin(page, IDS.baozhong).click();
    const first = await hud(page);
    await page.waitForTimeout(450);
    assert.deepEqual(await hud(page), first, '減少動態時選取後視角不再滑動');
    assert((await page.locator('#atlasDetailTitle').innerText()).includes('褒忠路'));
    await page.locator('#atlasView-iso').click();
    assert(await pin(page, IDS.baozhong).isVisible(), '切換視角後選取的圖釘仍在畫面內');
    await page.locator('#atlasZoomReset').click();
    assert.equal((await hud(page)).zoom, 1, '減少動態時重設一步到位');
    await until(() => pinCount(page).then((count) => count === 3), '重設後三支圖釘都回到畫面內（圖釘位置在下一個畫格更新）');
    await context.close();
    summary.reducedMotion = true;
  }

  // ---- 5. 沒有 WebGL：地圖不依賴 WebGL 或 canvas ----
  {
    const plain = await chromium.launch({ args: ['--disable-3d-apis', '--disable-gpu'] });
    try {
      const context = await plain.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
      await context.addInitScript(() => {
        window.__contextCalls = [];
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) { window.__contextCalls.push(type); return original.call(this, type, ...rest); };
      });
      const page = await context.newPage();
      await watch(page, 'no-webgl');
      await page.goto(url('#v=iso'));
      await ready(page);
      assert.equal(await page.evaluate(() => ['webgl2', 'webgl', 'experimental-webgl'].every((type) => document.createElement('canvas').getContext(type) === null)), true, '這個瀏覽器應該沒有 WebGL');
      await page.evaluate(() => { window.__contextCalls.length = 0; });
      assert.equal(await pinCount(page), 3);
      assert.equal(await page.locator('#atlasCanvas .atl-furniture').count(), 1);
      await page.locator('#atlasZoomIn').click();
      await pin(page, IDS.peiying).click();
      await until(() => page.locator('#atlasDetailTitle').innerText().then((text) => text.includes('培英')), '沒有 WebGL 仍可選取');
      await page.locator('#atlasView-plan').click();
      await page.locator('#atlasRegion').selectOption('taipei');
      await until(() => page.locator('#atlasCrumbs').innerText().then((text) => text.includes('台北市')), '沒有 WebGL 仍可切換地區');
      assert.equal(await page.locator('#atlasApp canvas').count(), 0, '地圖不使用 canvas');
      assert.deepEqual(await page.evaluate(() => window.__contextCalls), [], '地圖不應要求任何繪圖 context');
      await page.locator('.atl-canvas-wrap').screenshot({ path: `${screenshots}/atlas-no-webgl.png` });
      await context.close();
    } finally {
      await plain.close();
    }
    summary.noWebgl = true;
  }

  // ---- 6. 資料載入失敗：每種缺口都看得到，部分載入不當成完整 ----
  {
    const fail = async (patterns, status, label) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
      const page = await context.newPage();
      await watch(page, label);
      for (const pattern of patterns) await page.route(pattern, (route) => route.fulfill({ status, body: 'Unavailable' }));
      await page.goto(url());
      return { context, page };
    };

    // 6a. 治理案卷讀不到：不顯示任何進度，提供靜態圖與重試
    let { context, page } = await fail(['**/data/governance.json'], 503, 'fail-governance');
    await ready(page, 'failed');
    assert((await page.locator('#atlasGaps').innerText()).includes('治理案卷'));
    assert.equal(await page.locator('#atlasGaps').getAttribute('role'), 'alert');
    assert.equal(await pinCount(page), 0);
    assert(await page.locator('#atlasCanvas .atl-fallback img').isVisible(), '失敗時要有靜態替代圖');
    assert(await page.locator('#atlasExport').isDisabled());
    assert((await page.locator('#atlasList').innerText()).includes('案卷暫時無法載入'));
    assert((await page.locator('#atlasPendingBody').innerText()).includes('無法列出待定位清單'));
    assert.equal(await page.locator('#atlasList a[href^="https://"]').count(), 4, '失敗時仍提供官方來源連結');
    await page.screenshot({ path: `${screenshots}/atlas-fail-governance.png` });
    await page.unroute('**/data/governance.json');
    await page.locator('[data-retry]').click();
    await ready(page, 'ready');
    assert.equal(await pinCount(page), 3, '重試成功後恢復');
    assert(await page.locator('#atlasGaps').isHidden());
    await context.close();

    // 6b. 位置檔讀不到：案卷照列，但位置是「未載入」，不是「待定位」，也沒有圖釘
    ({ context, page } = await fail(['**/data/geo/project-locations.json'], 404, 'fail-locations'));
    await ready(page, 'partial');
    const gapText = await page.locator('#atlasGaps').innerText();
    assert(gapText.includes('案卷位置') && gapText.includes('HTTP 404') && gapText.includes('不是完整結果'));
    assert.equal(await page.locator('#atlasList .atl-item').count(), 4);
    assert.equal(await page.locator('#atlasList .atl-badge[data-precision="unavailable"]').count(), 4);
    assert.equal(await pinCount(page), 0);
    assert((await page.locator('#atlasStatus').innerText()).includes('位置資料未載入'));
    assert((await page.locator('#atlasPendingBody').innerText()).includes('不代表所有案卷都已定位'));
    await page.locator(`[data-select="${IDS.peiying}"]`).first().click();
    assert((await page.locator('#atlasDetail').innerText()).includes('位置資料檔沒有載入'));
    await page.screenshot({ path: `${screenshots}/atlas-fail-locations.png` });
    await context.close();

    // 6c. 階段對照讀不到：圖釘仍在，但不顯示任何階段字，也不能依階段篩選
    ({ context, page } = await fail(['**/data/geo/project-stages.json'], 500, 'fail-stages'));
    await ready(page, 'partial');
    assert((await page.locator('#atlasGaps').innerText()).includes('階段對照'));
    assert.equal(await pinCount(page), 3);
    assert.deepEqual(await page.locator('.atl-pin .atl-pin-art').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.stage))]), ['none']);
    assert((await page.locator('#atlasStageBar').innerText()).includes('階段對照沒有載入'));
    await pin(page, IDS.peiying).click();
    const noStage = await page.locator('#atlasDetail').innerText();
    assert(noStage.includes('階段對照沒有載入') && noStage.includes('驗收與點交準備記錄'), '仍顯示案卷本身的階段紀錄');
    await context.close();

    // 6d. 所有界線都讀不到：明講底圖缺漏，圖釘與列表照常
    ({ context, page } = await fail(['**/data/geo/boundaries/**'], 503, 'fail-boundaries'));
    await ready(page, 'partial');
    assert.equal((await page.locator('#atlasGaps li').count()), 5);
    assert.equal(await page.locator('#atlasCanvas').getAttribute('data-nobase'), '');
    assert.equal(await pinCount(page), 3);
    assert.equal(await page.locator('#atlasList .atl-item').count(), 4);
    await page.locator('.atl-canvas-wrap').screenshot({ path: `${screenshots}/atlas-fail-boundaries.png` });
    await context.close();

    // 6e. 只有鄉鎮市區界線讀不到：退回縣市外框
    ({ context, page } = await fail(['**/data/geo/boundaries/districts.geojson'], 404, 'fail-districts'));
    await ready(page, 'partial');
    assert((await page.locator('#atlasGaps').innerText()).includes('鄉鎮市區界線'));
    assert.equal(await page.locator('#atlasCanvas .atl-district').count(), 4, '退回四個縣市外框');
    assert.equal(await page.locator('#atlasCanvas').getAttribute('data-nobase'), null);
    await context.close();

    // 6f. 回應不是 JSON：同樣當成失敗
    {
      const broken = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
      page = await broken.newPage();
      await watch(page, 'fail-html');
      await page.route('**/data/geo/project-stages.json', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Not found</title>' }));
      await page.goto(url());
      await ready(page, 'partial');
      assert((await page.locator('#atlasGaps').innerText()).includes('階段對照'));
      await broken.close();
    }
    // 6g. 先部分載入、再整個失敗、再恢復：互動層重建後拖曳距離仍然正確（沒有殘留重複的事件處理器）
    {
      const flaky = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
      page = await flaky.newPage();
      await watch(page, 'fail-then-recover');
      await page.route('**/data/geo/project-stages.json', (route) => route.fulfill({ status: 500, body: 'Unavailable' }));
      await page.goto(url());
      await ready(page, 'partial');
      await page.route('**/data/governance.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
      await page.locator('[data-retry]').click();
      await ready(page, 'failed');
      assert.equal(await pinCount(page), 0);
      assert((await page.locator('#atlasCoverage').innerText()).includes('資料載入失敗'));
      await page.unroute('**/data/governance.json');
      await page.unroute('**/data/geo/project-stages.json');
      await page.locator('[data-retry]').click();
      await ready(page, 'ready');
      assert.equal(await pinCount(page), 3);
      await page.locator('#atlasZoomIn').click();
      await settled(page);
      const box = await canvasBox(page);
      const scale = await page.locator('#atlasScale').evaluate((node) => ({ px: node.getBoundingClientRect().width, text: node.textContent }));
      const meters = Number.parseFloat(scale.text) * (scale.text.includes('公里') ? 1000 : 1);
      const before = await hud(page);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      const after = await hud(page);
      const expected = (100 * (meters / scale.px)) / (111195 * Math.cos((before.lat * Math.PI) / 180));
      assert(Math.abs((after.lon - before.lon) - expected) < expected * 0.2, `拖曳 100px 應移動約 ${expected.toFixed(4)} 度，實際 ${(after.lon - before.lon).toFixed(4)} 度`);
      await flaky.close();
    }
    summary.loadFailures = 7;
  }

  // ---- 7. 收藏無法儲存、沒有 JavaScript ----
  {
    const denied = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
    await denied.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } }); });
    let page = await denied.newPage();
    await watch(page, 'storage-denied');
    await page.goto(url());
    await ready(page);
    await page.locator('.atl-fav').first().click();
    assert((await page.locator('#atlasStorageNote').innerText()).includes('只保留到本頁關閉'));
    await page.locator('#atlasFavOnly').check();
    assert.equal(await page.locator('#atlasList .atl-item').count(), 1);
    await denied.close();

    const noScript = await browser.newContext({ viewport: { width: 390, height: 780 }, javaScriptEnabled: false, locale: 'zh-TW' });
    page = await noScript.newPage();
    await page.goto(url());
    assert(await page.locator('#atlasCanvas .atl-fallback img').isVisible(), '沒有 JavaScript 時顯示靜態總覽圖');
    assert(await page.evaluate(() => { const image = document.querySelector('#atlasCanvas .atl-fallback img'); return image.complete && image.naturalWidth > 0; }), '靜態總覽圖要載得到');
    assert((await page.locator('noscript').innerText()).includes('案卷位置 JSON'));
    assert.equal(await page.locator('a[href="/data/geo/project-locations.json"]').count() >= 1, true);
    await page.screenshot({ path: `${screenshots}/atlas-no-js.png` });
    await noScript.close();
    summary.storageDenied = true;
    summary.noJavaScript = true;
  }

  assert.deepEqual(errors, [], '頁面不應有腳本錯誤');
  console.log(JSON.stringify({ atlas: 'passed', origin, ...summary }));
} finally {
  await browser.close();
}
