import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const [origin='http://127.0.0.1:4173', screenshots='artifacts/screens'] = process.argv.slice(2);
const browser=await chromium.launch();
const errors=[];
try {
  for (const width of [320,390,430,768,1280]) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/governance.html');
    await page.locator('.gov-project').nth(3).waitFor();
    assert.equal(await page.locator('.top .nav a').count(),5);
    assert(await page.evaluate(()=>[...document.body.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).every(n=>!n.textContent.trim())), 'No stray body text');
    assert.equal(await page.locator('progress').count(),2);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} overflow`);
    for(const locator of [page.locator('#export'),page.locator('[data-watch]').first(),page.locator('#region')]) assert((await locator.boundingBox()).height>=44);
    const card=page.locator('#new-taipei-siyuan-footbridge');
    assert((await card.innerText()).includes('未標示（不能當作目前進度）'));
    assert.equal(await card.locator('progress').getAttribute('value'),'77.25');
    await page.locator('#region').selectOption('hsinchu-county');
    assert.equal(await page.locator('.gov-project').count(),1);
    assert.equal(await page.locator('progress').count(),0);
    assert((await page.locator('.gov-project').innerText()).includes('NT$ 975,210,000'));
    assert((await page.locator('.gov-budget').innerText()).includes('尚未收錄'));
    await page.locator('[data-watch]').click();
    await page.reload();await page.locator('.gov-project').nth(3).waitFor();
    await page.locator('#watched').check();
    assert.equal(await page.locator('.gov-project').count(),1);
    assert.equal(await page.locator('[data-watch]').getAttribute('aria-pressed'),'true');
    await page.locator('#query').fill('不存在的工程');
    assert.equal(await page.locator('.gov-project').count(),0);
    assert(await page.locator('#export').isDisabled());
    await page.locator('#reset').click();
    await page.locator('.gov-project').nth(3).waitFor();
    await page.locator('#topic').selectOption('housing');
    assert.equal(await page.locator('.gov-project').count(),1);
    await page.locator('details.gov-evidence summary').click();
    assert(await page.getByText('2026/09（月份紀錄）',{exact:true}).isVisible());
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#export').click();
    const download=await downloadPromise;
    const bytes=await readFile(await download.path());
    assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);
    const text=bytes.toString('utf8');assert(text.includes('中山區培英公共住宅'));assert(!text.includes('褒忠路'));assert(text.includes('https://heo.gov.taipei/'));
    if([390,1280].includes(width)) { await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);}); await page.screenshot({path:`${screenshots}/governance-${width}.png`,fullPage:true}); } 
    await page.close();
  }
  const denied=await browser.newContext();
  await denied.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Denied','SecurityError');}});});
  const page=await denied.newPage();await page.goto(origin+'/governance.html');await page.locator('.gov-project').nth(3).waitFor();
  await page.locator('[data-watch]').first().click();assert((await page.locator('#storageNote').innerText()).includes('僅保留至本頁關閉'));await page.locator('#watched').check();assert.equal(await page.locator('.gov-project').count(),1);await denied.close();
  const failure=await browser.newPage();await failure.route('**/data/governance.json',route=>route.fulfill({status:503,body:'Unavailable'}));await failure.goto(origin+'/governance.html');await failure.locator('[role=alert]').waitFor();assert(await failure.locator('#export').isDisabled());await failure.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({governance:'passed',widths:5,cases:4,filters:true,watchPersistence:true,storageDenied:true,csv:true,loadFailure:true}));
}finally{await browser.close();}
