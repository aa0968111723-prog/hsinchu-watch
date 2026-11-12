import {loadJSON,escapeHtml as esc} from './lib/data.js';
import {REVIEW_DIMENSIONS,REVIEW_TOPICS,reviewRows,reviewHref,responseLabel} from './lib/candidate-review-model.js';
import './candidate-review.css';

const root=document.getElementById('candidateReview');
let registryPromise,registry,rows=[],race='county_magistrate',asOf='',dimension='policy',topic='',origin='';
let revision=0;
const expanded=new Map();
function source(row){return `<a href="${esc(reviewHref(row))}" target="_blank" rel="noopener noreferrer">${esc(row.source_name||'查看原始來源')}</a>`;}
function excerpt(row){
  const provenance=row.claim_origin==='self_claimed'?'人物／機關主張':row.claim_origin==='independently_reported'?'既有報導整理':'說法來源待確認';
  return `<li><p class="review-meta">${esc(String(row.published_at||'日期未標明').slice(0,10))} · ${provenance}${row.uncorroborated?' · 待交叉佐證':''}</p><h4>${esc(row.title)}</h4>${dimension==='response'?`<p>${responseLabel(row)}</p>`:`<p>${esc(row.summary||'摘要尚未收錄，請閱讀原文。')}</p>`}${row.controversy?`<p class="review-caveat">質疑方：${esc(row.raised_by||'此條目未標示')}。此處記載質疑，未據此認定違法或不實。${dimension==='response'?'':responseLabel(row)}</p>`:''}${row.role_at_time?`<p class="review-meta">當時身分（既有欄位）：${esc(row.role_at_time)}</p>`:''}${row.note?`<p class="review-caveat">來源限制：${esc(row.note)}</p>`:''}<p class="review-meta">既有整理日期：${esc(row.checked_at||'未標示')}；本輪尚未逐筆複核摘要。</p>${source(row)}</li>`;
}
function renderCards(){
  const candidates=registry.candidates.filter(p=>p.race_id===race).sort((a,b)=>a.ballot_number-b.ballot_number);
  root.querySelector('#reviewQuestion').textContent=REVIEW_DIMENSIONS.find(x=>x.id===dimension).question;
  root.querySelector('#reviewScope').textContent=`${registry.races.find(r=>r.id===race).name}・正式名單 ${candidates.length} 人・依選委會號次排列`;
  root.querySelector('#reviewPeople').innerHTML=candidates.map(p=>`<a href="#review-person-${p.id}">${p.ballot_number} ${esc(p.name)}</a>`).join('');
  root.querySelector('#reviewCards').innerHTML=candidates.map(p=>{
    const list=reviewRows(rows,{personId:p.id,dimension,topic,origin,asOf}),limit=expanded.get(p.id)||2;
    return `<article class="review-card" id="review-person-${esc(p.id)}" data-candidate="${esc(p.id)}"><header><p class="review-meta">正式名單・${p.ballot_number} 號</p><h3>${esc(p.name)}</h3><a href="${esc(registry.sources.find(s=>s.id===p.roster_source_id).url)}" target="_blank" rel="noopener noreferrer">選委會名單</a></header><p class="review-availability">${list.length ? `此篩選下收錄 ${list.length} 個來源網址`:'本站尚未收錄此面向條目'}</p>${list.length?`<ul class="review-excerpts">${list.slice(0,limit).map(excerpt).join('')}</ul>`:'<p class="review-empty">資料不足，暫不形成評價。不代表沒有政見、成績、質疑或回應。</p>'}${list.length>limit?`<button type="button" data-review-more="${esc(p.id)}">多看兩筆${esc(p.name)}的來源</button>`:''}<a class="review-index" href="/archive.html?person=${encodeURIComponent(p.id)}">查閱${esc(p.name)}的全部收錄資料</a><a class="review-index" href="/compare.html?sourcePerson=${encodeURIComponent(p.id)}#watch-sources">查閱${esc(p.name)}的公開來源索引</a><p class="review-meta">索引包含尚未在本輪逐筆複核的報導。</p></article>`;
  }).join('');
}
function mount(){
  root.innerHTML=`<div class="review-heading"><p class="review-kicker">同一問題，分別看每位候選人</p><h2>候選人多面向閱讀</h2><p>用同一組問題交叉閱讀政策、成本、成效、質疑與回應。來源與資料缺口一併公開。</p></div><p id="reviewScope" class="review-meta"></p><nav id="reviewPeople" class="review-people" aria-label="本選區完整候選人"></nav><div class="review-dimensions" role="group" aria-label="閱讀面向">${REVIEW_DIMENSIONS.map(d=>`<button type="button" data-dimension="${d.id}" aria-pressed="${d.id===dimension}" aria-controls="reviewCards">${d.name}</button>`).join('')}</div><p id="reviewQuestion" class="review-question"></p><div class="review-filters"><label>共同議題<select id="reviewTopic"><option value="">全部議題</option>${REVIEW_TOPICS.map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label><label>說法來源<select id="reviewOrigin"><option value="">全部來源</option><option value="self">人物／機關主張</option><option value="reported">既有報導整理</option><option value="unknown">說法來源待確認</option></select></label></div><p class="review-meta">議題依既有標記或文字命中篩選；不是人工立場判定。資料截至 <span id="reviewAsOf"></span>；各人先列兩筆不同網址，按發布日排序，可再展開。</p><div id="reviewCards" class="review-cards"></div><details id="reviewMethod" class="review-method"><summary>閱讀標準、涵蓋範圍與資料缺口</summary><ul><li>目前完整列入的正式名單範圍是新竹縣長與竹北市長，共六人；尚未涵蓋全台候選人。名單來源查閱日：${esc(registry.checked_at)}。</li><li>按選委會號次排列；相同面向、共同篩選、相同首屏筆數，不按聲量或正負面排序，不製作總分或勝負排名。</li><li>人物／機關主張、媒體報導、意見、質疑與查核結論是不同資料型態。「報導整理」不代表獨立查核；「既有整理日期」不代表本輪重新查證。</li><li>聲量、政策條目與爭議條目數是資料收錄量，受來源與任期差異影響，不代表支持度、能力或廉潔程度。</li><li>某篇文章或本站沒有記載回應，不等於當事人沒有回應。質疑應與當事人說法、原始文件及最新查核／裁判結果一起讀。</li><li>政策內容與施政成效需分開；比較任期、職權、預算與成效時須使用可比基準。目前沒有據此建立績效評分。</li><li>朱定瑀、曾聖凱已列入相同比較框架；既有結構化政策資料不足，保留缺口，不填入示意內容。</li><li>陳見賢及其他歷史參選資料保留於<a href="/reference/person.html?id=chen">歷史人物資料</a>；評論者資料不當作本屆候選人。資格狀態以選委會最新公告為準。</li><li>發現摘要錯置、日期不符或漏載回應，可用<a href="/manual.html">手動收錄</a>提供原文供後續整理。此功能不會直接公開未核對內容。</li></ul></details>`;
  root.querySelector('#reviewTopic').value=topic;root.querySelector('#reviewOrigin').value=origin;
  root.querySelector('#reviewAsOf').textContent=asOf||'日期未標示';
  root.onclick=e=>{
    const tab=e.target.closest('[data-dimension]');
    if(tab){dimension=tab.dataset.dimension;expanded.clear();for(const button of root.querySelectorAll('[data-dimension]'))button.setAttribute('aria-pressed',String(button===tab));renderCards();return;}
    const button=e.target.closest('[data-review-more]');if(button){const id=button.dataset.reviewMore,old=expanded.get(id)||2;expanded.set(id,old+2);renderCards();root.querySelector(`[data-candidate="${id}"] .review-excerpts li:nth-child(${old+1}) a`)?.focus();}
  };
  for(const id of ['reviewTopic','reviewOrigin'])root.querySelector('#'+id).onchange=()=>{topic=root.querySelector('#reviewTopic').value;origin=root.querySelector('#reviewOrigin').value;expanded.clear();renderCards();};
  renderCards();if(location.hash==='#reviewMethod'){root.querySelector('#reviewMethod').open=true;root.querySelector('#reviewMethod').scrollIntoView();}
}
export async function updateCandidateReview(policies,selectedRace,snapshot){
  if(!root)return;const ticket=++revision;rows=policies;race=selectedRace;asOf=String(snapshot||'').slice(0,10)||'9999-12-31';
  try{registryPromise ||=loadJSON('/data/candidate-review.json');registry=await registryPromise;if(ticket!==revision)return;mount();}
  catch{registryPromise=null;root.innerHTML='<h2>候選人多面向閱讀</h2><p role="alert">名單暫時無法載入；<a href="https://web.cec.gov.tw/hccec/article/65398">請先查閱選委會正式名單</a>。暫不以不完整名單進行比較。</p>';}
}

window.addEventListener('hashchange',()=>{if(location.hash==='#reviewMethod'&&root?.querySelector('#reviewMethod'))root.querySelector('#reviewMethod').open=true;});
