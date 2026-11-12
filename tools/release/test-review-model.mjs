import assert from 'node:assert/strict';
import {reviewRows,responseLabel,reviewHref} from '../../src/lib/candidate-review-model.js';
const base={person_id:'a',kind:'policy',title:'交通方案',summary:'交通方案成本待核對',source_url:'https://example.com/a',published_at:'2026-11-10',claim_origin:'self_claimed'};
const options={personId:'a',asOf:'2026-11-12'};
const rows=[base,{...base,source_url:'https://example.com/a?utm_source=test'},
  {...base,source_url:'https://example.com/future',published_at:'2026-11-13'},
  {...base,source_url:'https://example.com/pending',review_status:'pending'},
  {...base,source_url:'https://example.com/excluded',counts_in_stats:false},
  {...base,person_id:'b',source_url:'https://example.com/other'},
  {...base,source_url:'javascript:alert(1)'},
  {...base,source_url:'https://user:pass@example.com/private'},
  {...base,source_url:'https://example.com/criticism',controversy:true,responded:false}];
assert.equal(reviewRows(rows,options).length,1);
assert.equal(reviewRows(rows,{...options,dimension:'oversight'}).length,1);
assert.equal(reviewRows(rows,{...options,dimension:'response'})[0].responded,false);
assert(responseLabel({responded:false}).includes('不能推論當事人未回應'));
assert(responseLabel({}).includes('不能推論當事人未回應'));
assert(responseLabel({responded:true}).includes('核對原文'));
assert.equal(reviewHref({url:'https://user:pass@example.com/a'}),null);
assert.equal(reviewRows(rows,{...options,origin:'reported'}).length,0);
const positive={...base,title:'乙方案',source_url:'https://example.com/positive',sentiment:'pos'};
const negative={...base,title:'甲方案',source_url:'https://example.com/negative',sentiment:'neg'};
assert.deepEqual(reviewRows([positive,negative],options).map(r=>r.title),reviewRows([{...positive,sentiment:'neg'},{...negative,sentiment:'pos'}],options).map(r=>r.title));
assert.equal(reviewRows([base],{...options,topic:'housing'}).length,0);
console.log('Candidate review selection: attribution, unknown response, archive exclusions and tone-independent ordering passed.');

const {renderPlatformSectionHTML}=await import('../../src/lib/platform-section.js');
const roster=[{id:'a',name:'甲',role:'測試選區候選人'},{id:'b',name:'乙',role:'測試選區候選人'}];
const html=renderPlatformSectionHTML([{...base,person_id:'a',controversy:true,responded:false,source_name:'來源',claim_origin:'self_claimed'}],{roster});
assert.equal((html.match(/class="plat-col"/g)||[]).length,2);
assert(html.includes('此條目未記載，不能推論當事人未回應'));
assert(!html.includes('尚無公開回應'));
assert(html.includes('資料不足不代表沒有相關內容'));
assert(html.includes('人物／機關主張'));
