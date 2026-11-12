import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const [origin='http://127.0.0.1:4173',screens='artifacts/screens']=process.argv.slice(2);
const browser=await chromium.launch();
const errors=[];
try{
  for(const width of [320,390,430,768,1280]){
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/compare.html');
    await page.locator('.review-card').nth(2).waitFor();
    assert.deepEqual(await page.locator('.review-card h3').allTextContents(),['鄭朝方','徐欣瑩','朱定瑀']);
    assert.equal(await page.locator('#candidateReview [data-dimension]').count(),5);
    for(const card of await page.locator('.review-card').all())assert(await card.locator('.review-excerpts li').count()<=2);
    assert((await page.locator('[data-candidate=zhu]').innerText()).includes('資料不足'));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} county overflow`);
    await page.getByRole('button',{name:'質疑與監督',exact:true}).click();
    const text=await page.locator('#reviewCards').innerText();
    assert(text.includes('此處記載質疑，未據此認定違法或不實'));
    await page.getByRole('button',{name:'回應與佐證',exact:true}).click();
    assert((await page.locator('#reviewCards').innerText()).includes('不能推論當事人未回應'));
    await page.locator('#reviewTopic').selectOption('housing');
    assert.equal(await page.locator('.review-card').count(),3);
    await page.locator('#reviewTopic').selectOption('');
    await page.getByRole('group',{name:'選區',exact:true}).getByRole('button',{name:'竹北市長',exact:true}).click();
    await page.locator('[data-candidate=tseng]').waitFor();
    assert.deepEqual(await page.locator('.review-card h3').allTextContents(),['吳旭智','曾聖凱','邱臣遠']);
    assert.equal(await page.locator('[data-dimension=response]').getAttribute('aria-pressed'),'true');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} city overflow`);
    for(const target of [page.locator('#reviewTopic'),page.locator('[data-dimension]').first()])assert((await target.boundingBox()).height>=44);
    if([390,1280].includes(width)){
      await page.getByRole('button',{name:'政策與取捨',exact:true}).click();
      await page.locator('#candidateReview').scrollIntoViewIfNeeded();
      await page.screenshot({path:`${screens}/candidate-review-${width}.png`});
    }
    await page.goto(origin+'/index.html');await page.locator('#pSent .tone-review').waitFor();
    await page.locator('#platformSection .plat-col').nth(5).waitFor();
    assert.deepEqual(await page.locator('#platformSection .plat-col').evaluateAll(nodes=>nodes.map(n=>n.dataset.person)),['zheng','xu','zhu','wu','tseng','chiu']);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} home overflow`);
    assert.equal(await page.locator('#pSent details').getAttribute('open'),null);
    await page.locator('#pSent summary').focus();await page.keyboard.press('Enter');assert(await page.locator('#pSent details').evaluate(n=>n.open));
    await page.close();
  }
  const page=await browser.newPage();
  await page.goto(origin+'/compare.html?sourcePerson=zhu#watch-sources');
  await page.locator('#watch-sources .filters select').waitFor({state:'visible'});
  assert.equal(await page.locator('#watch-sources .filters select').inputValue(),'zhu');
  assert.equal(await page.locator('#watch-sources .timeline li').count(),4);
  await page.goto(origin+'/compare.html#reviewMethod');await page.locator('#reviewMethod').waitFor();
  assert(await page.locator('#reviewMethod').evaluate(n=>n.open));
  await page.close();
  // Recorded responses remain a source-level status, not an accusation about a person.
  const fixture=await browser.newPage();
  await fixture.route('**/data/policies.json',route=>route.fulfill({json:[{person_id:'xu',kind:'record',controversy:true,responded:false,published_at:'2026-11-10',title:'待核對質疑',summary:'質疑方說法',source_url:'https://example.com/source',source_name:'測試來源',claim_origin:'self_claimed'}]}));
  await fixture.goto(origin+'/compare.html');await fixture.locator('.review-card').nth(2).waitFor();
  assert((await fixture.locator('#policyCompare').innerText()).includes('本筆未載 1'));
  assert(!(await fixture.locator('#policyCompare tbody').innerText()).includes('未回應'));
  await fixture.getByRole('button',{name:'回應與佐證',exact:true}).click();
  assert((await fixture.locator('[data-candidate=xu]').innerText()).includes('不能推論當事人未回應'));
  await fixture.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({candidateReview:'passed',candidates:6,dimensions:5,widths:5,missingData:true,sourcePerson:true,responseAttribution:true,toneOptIn:true}));
}finally{await browser.close();}
