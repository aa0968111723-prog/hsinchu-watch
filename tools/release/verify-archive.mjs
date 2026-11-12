import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {buildArchive} from '../../src/lib/archive-model.js';
const [origin='http://127.0.0.1:4173',screens='artifacts/screens']=process.argv.slice(2);
const browser=await chromium.launch();const errors=[];
try{
 for(const width of [320,390,430,768,1280]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/archive.html?person=zhu');await page.locator('#archiveLoad').filter({hasText:'已整合'}).waitFor();
  assert.equal(await page.locator('#archivePerson').inputValue(),'zhu');assert.equal(await page.locator('.archive-row').count(),4);
  assert((await page.locator('#archiveResult').innerText()).includes('符合 4 筆'));
  assert.equal(await page.locator('#archiveFiles a[download]').count(),20); // 19 manifest files minus raw polls, plus two observation files.
  await page.getByRole('button',{name:'清除篩選',exact:true}).click();await page.locator('#archiveNext:not([disabled])').waitFor();
  assert.equal(await page.locator('.archive-row').count(),50);const first=await page.locator('.archive-row').first().getAttribute('data-archive-key');
  await page.locator('#archiveNext').click();assert.notEqual(await page.locator('.archive-row').first().getAttribute('data-archive-key'),first);
  await page.locator('#archiveKind').selectOption('news');await page.locator('#archivePerson').selectOption('wu');
  assert((await page.locator('#archiveResult').innerText()).includes('1,275'));
  await page.locator('.archive-advanced summary').click();await page.locator('#archiveStatus').selectOption('archive');assert(await page.locator('.archive-row').count()>0);
  assert((await page.locator('.archive-row').first().innerText()).includes('封存參考'));
  await page.locator('#archiveKind').selectOption('source');await page.locator('#archivePerson').selectOption('zhu');await page.locator('#archiveStatus').selectOption('');
  await page.locator('.archive-row').first().locator('summary').click();assert(await page.locator('.archive-row pre').first().isVisible());
  const pending=page.waitForEvent('download');await page.locator('#archiveJSON').click();const download=await pending;
  const payload=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(payload.records.length,4);assert(payload.records.every(r=>r.person_ids.includes('zhu')));
  if(width===390){const pendingCSV=page.waitForEvent('download');await page.locator('#archiveCSV').click();const csvDownload=await pendingCSV;const bytes=await readFile(await csvDownload.path());assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);assert(bytes.toString('utf8').includes('date_basis'));}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} archive overflow`);
  for(const target of [page.locator('#archivePerson'),page.locator('#archiveJSON')])assert((await target.boundingBox()).height>=44);
  if([390,1280].includes(width)){await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.screenshot({path:`${screens}/archive-${width}.png`});}
  await page.close();
 }
 // Export includes every matching page, not only visible records.
 const all=await browser.newPage();await all.goto(origin+'/archive.html?kind=news&person=wu');await all.locator('#archiveLoad').filter({hasText:'已整合'}).waitFor();
 const next=all.waitForEvent('download');await all.locator('#archiveJSON').click();const download=await next;assert.equal(JSON.parse(await readFile(await download.path(),'utf8')).records.length,1275);await all.close();
 // Partial load remains visibly incomplete and is retryable.
 const partial=await browser.newPage();await partial.route('**/data/items.json*',route=>route.fulfill({status:503,body:'offline'}));
 await partial.goto(origin+'/archive.html');await partial.getByText(/部分資料尚未載入/).waitFor();assert(await partial.locator('#archiveJSON').isDisabled());assert(await partial.locator('#archiveRetry').isVisible());
 await partial.unroute('**/data/items.json*');await partial.locator('#archiveRetry').click();await partial.locator('#archiveLoad').filter({hasText:'已整合'}).waitFor();assert(await partial.locator('#archiveJSON').isEnabled());await partial.close();
  const corrupt=await browser.newPage();await corrupt.route('**/data/items.json*',route=>route.fulfill({json:[]}));await corrupt.goto(origin+'/archive.html');await corrupt.locator('#archiveWarning').filter({hasText:'校驗不符'}).waitFor();assert(await corrupt.locator('#archiveJSON').isDisabled());await corrupt.close();
 // Blackout covers fetches, rows, details, exports and raw file entry points.
 const blackout=await browser.newPage();await blackout.clock.install({time:new Date('2026-11-18T00:01:00+08:00')});let polls=0;blackout.on('request',r=>{if(r.url().includes('/data/polls.json'))polls++;});
 await blackout.goto(origin+'/archive.html?kind=poll');await blackout.locator('#archiveLoad').filter({hasText:'已整合'}).waitFor();assert.equal(polls,0);assert.equal(await blackout.locator('.archive-row').count(),0);assert(await blackout.locator('#archiveJSON').isDisabled());assert.equal(await blackout.locator('#archiveFileList a[href="/data/items.json"]').count(),0);await blackout.close();
  const boundary=await browser.newPage();await boundary.clock.install({time:new Date('2026-11-17T23:59:00+08:00')});let boundaryPolls=0;boundary.on('request',r=>{if(r.url().includes('/data/polls.json'))boundaryPolls++;});await boundary.goto(origin+'/archive.html?kind=poll');await boundary.locator('#archiveLoad').filter({hasText:'已整合'}).waitFor();assert(await boundary.locator('.archive-row').count()>0);await boundary.clock.fastForward(61000);await boundary.locator('#archiveWarning').filter({hasText:'封關期間'}).waitFor();assert.equal(await boundary.locator('.archive-row').count(),0);assert.equal(boundaryPolls,1);await boundary.close();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({archive:'passed',widths:5,fullExport:1275,pagination:true,archiveRows:true,partialRetry:true,blackout:true}));
}finally{await browser.close();}
