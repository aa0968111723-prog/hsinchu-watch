import './lib/mobile-nav.js';
import {coverageTime} from './lib/coverage.js';
import {escapeHtml as esc,isPollBlackout,POLL_BLACKOUT_DEFAULTS} from './lib/data.js';
import {withVersionQuery} from './lib/live-update/manifest.js';
import {ARCHIVE_FILES,ARCHIVE_KINDS,buildArchive,buildPeople,filterArchive,archiveHref,archiveExport,csvValue} from './lib/archive-model.js';

const $=id=>document.getElementById(id);
const fields={person:'archivePerson',kind:'archiveKind',platform:'archivePlatform',query:'archiveQuery',from:'archiveFrom',to:'archiveTo',status:'archiveStatus'};
const statusLabels={archive:'封存參考・不計統計',pending:'待核對／排除分析',recorded:'既有紀錄・非查核認證'};
const docs={},failures=new Map();let manifest,people={},rows=[],matching=[],page=1,loading=false,blackout=isPollBlackout(),timer,initialized=false;
const requested=new URLSearchParams(location.search);
for(const [key,id]of Object.entries(fields))if(['query','from','to'].includes(key))$(id).value=requested.get(key)||'';
for(const [id,name]of Object.entries(ARCHIVE_KINDS))$('archiveKind').add(new Option(name,id));
if(Object.hasOwn(ARCHIVE_KINDS,requested.get('kind'))) $('archiveKind').value=requested.get('kind');
if(['archive','pending','recorded'].includes(requested.get('status'))) $('archiveStatus').value=requested.get('status');
function values(){return Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,$(id).value]));}
function updateURL(){const url=new URL(location.href);url.search='';for(const [key,value]of Object.entries(values()))if(value)url.searchParams.set(key,value);history.replaceState(null,'',url.pathname+url.search+url.hash);}
function updateCounts(){const counts={};for(const row of rows)counts[row.kind]=(counts[row.kind]||0)+1;$('archiveCounts').innerHTML=Object.entries(ARCHIVE_KINDS).map(([id,label])=>`<span>${label} <b>${(counts[id]||0).toLocaleString('zh-TW')}</b></span>`).join('');}
function metadata(){
 const known=new Set(docs.candidates?.candidates?.map(p=>p.id)||[]),person=initialized?$('archivePerson').value:requested.get('person');
 $('archivePerson').replaceChildren(new Option('全部人物與治理案卷',''));
 for(const [label,items]of [['本屆正式名單（目前兩選區）',Object.values(people).filter(p=>known.has(p.id))],['其他人物與歷史資料',Object.values(people).filter(p=>!known.has(p.id))]]){
  const group=document.createElement('optgroup');group.label=label;for(const p of items)group.append(new Option(p.name,p.id));$('archivePerson').append(group);
 }
 if(people[person])$('archivePerson').value=person;
 const platform=initialized?$('archivePlatform').value:requested.get('platform');$('archivePlatform').replaceChildren(new Option('全部平台',''));
 for(const value of [...new Set(rows.map(r=>r.platform).filter(Boolean))].sort())$('archivePlatform').add(new Option(value,value));
 if([...$('archivePlatform').options].some(o=>o.value===platform))$('archivePlatform').value=platform;
 if(['archivePlatform','archiveFrom','archiveTo','archiveStatus'].some(id=>$(id).value))document.querySelector('.archive-advanced').open=true;
 initialized=true;
}
function catalogue(){
 const files=Object.entries(manifest?.files||{}).map(([name,info])=>({name,path:'/data/'+name,bytes:info.bytes}));
 files.push({name:'observations/sources.json',path:ARCHIVE_FILES.sources},{name:'observations/comments.json',path:ARCHIVE_FILES.comments});
 const permitted=new Set(['governance.json','governance-registry.json','candidate-review.json','candidate_photos.json']);
 $('archiveFileList').innerHTML=files.map(f=>{
  const size=Number.isFinite(f.bytes)?`・${(f.bytes/1024).toFixed(1)} KB`:'';
  if(f.name==='polls.json')return `<li><a href="/polls.html">${esc(f.name)}・依民調顯示限制查閱</a>${size}</li>`;
  if(blackout&&!permitted.has(f.name))return `<li>${esc(f.name)}${size}・本頁於封關期間暫停原始檔下載入口</li>`;
  return `<li><a href="${esc(f.path)}" download>${esc(f.name)}</a>${size}</li>`;
 }).join('');
}
function rowHTML(row){
 const names=row.people.map(id=>`${people[id]?.name||id}（${people[id]?.group||'既有資料人物'}）`).join('、')||'未連結人物／地方治理';
 const afterSnapshot=Date.parse(row.record.published_at)>Date.parse(docs.stats?.generated_at);
 return `<li class="archive-row" data-archive-key="${esc(row.key)}"><p class="archive-meta">${esc(ARCHIVE_KINDS[row.kind])} · ${esc(row.date_basis)} ${esc(row.date||'未標示')} · ${esc(row.platform||'平台未標示')}</p><h3 tabindex="-1">${row.url?`<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(row.title)}</a>`:esc(row.title)}</h3><p class="archive-meta">${esc(names)}</p><span class="archive-status">${statusLabels[row.status]}</span>${afterSnapshot?'<p class="archive-meta">原記錄時間晚於統計快照時間，日期待核對。</p>':''}${row.summary&&row.summary!==row.title?`<p>${esc(row.summary)}</p>`:''}<p class="archive-meta">${esc(row.source||'來源名稱未標示')} · ${esc(row.file)}</p>${row.url?`<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">閱讀原文</a>`:'<p class="archive-meta">這筆紀錄沒有可用的原文連結，保留資料缺口。</p>'}<details><summary>完整既有紀錄與欄位</summary><p class="archive-note">既有摘要與自動欄位尚未全部在本輪複核，不作候選人評分。匿名留言省略帳號；民調僅保留可顯示欄位。</p><pre>${esc(JSON.stringify(archiveExport(row,people),null,2))}</pre></details></li>`;
}
function render({reset=false,focus=false}={}){
 if(!loading&&isPollBlackout()!==blackout){void load();return;}
 if(reset)page=1;
 const filters=values();matching=filterArchive(rows,filters,people);
 const size=Number($('archiveSize').value),pages=Math.ceil(matching.length/size);page=Math.min(Math.max(1,page),Math.max(1,pages));
 const offset=(page-1)*size,visible=matching.slice(offset,offset+size);
 const invalid=filters.from&&filters.to&&filters.from>filters.to;
 $('archiveResult').textContent=invalid?'日期範圍相反，請調整。':`符合 ${matching.length.toLocaleString('zh-TW')} 筆／已載入 ${rows.length.toLocaleString('zh-TW')} 筆${matching.length?`；顯示 ${offset+1}–${offset+visible.length}`:''}。可翻頁查閱全部符合資料。`;
 $('archiveList').innerHTML=visible.length&&!invalid?visible.map(rowHTML).join(''):'<li class="archive-empty">沒有符合條件的紀錄。可清除篩選，或查看目前尚未載入的檔案。</li>';
 $('archiveList').setAttribute('aria-busy',String(loading));$('archivePage').textContent=`第 ${pages?page:0} / ${pages} 頁`;
 $('archivePrev').disabled=page<=1||loading||invalid;$('archiveNext').disabled=page>=pages||loading||invalid;
 for(const id of ['archiveCSV','archiveJSON'])$(id).disabled=loading||failures.size>0||!matching.length||invalid;
 if(initialized)updateURL();if(focus){const heading=$('archiveList').querySelector('h3');heading?.focus();heading?.scrollIntoView({block:'start'});}
}
async function readFile(path){
 const expected=manifest?.files?.[path.replace(/^\/data\//,'')],hash=expected?.sha256||manifest?.release?.ui_sha256;
 const response=await fetch(withVersionQuery(path,hash),{headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);
 const bytes=await response.arrayBuffer();if(expected){
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==expected.bytes||!digest.startsWith(expected.sha256))throw new Error('檔案與快照校驗不符');
 }
 return JSON.parse(new TextDecoder().decode(bytes));
}
function shape(id,data){
 const arrays=['items','policies','polls'];if(arrays.includes(id)&&!Array.isArray(data))throw new Error('資料格式不符');
 if(['sources','comments'].includes(id)&&(!data.people||!Array.isArray(data.entries)))throw new Error('資料格式不符');
 if(['monitor','monitorHistory','monitorLatest'].includes(id)&&!Array.isArray(data.articles))throw new Error('資料格式不符');
 if(id==='official'&&!data.by_person||id==='stances'&&!Array.isArray(data.issues)||id==='governance'&&!Array.isArray(data.projects)||id==='governanceRegistry'&&!Array.isArray(data.sources)||id==='candidates'&&!Array.isArray(data.candidates)||id==='stats'&&!data.by_person)throw new Error('資料格式不符');return data;
}
async function load(){
 if(loading)return;loading=true;
 const changed=isPollBlackout()!==blackout;blackout=isPollBlackout();
 if(changed){rows=buildArchive(docs,{blackout}).rows;updateCounts();catalogue();}
 $('archiveRetry').hidden=true;$('archiveLoad').textContent='正在合併各類資料，並核對快照檔案。';render();
 try{
  const response=await fetch('/data/manifest.json',{headers:{Accept:'application/json'}});if(!response.ok)throw new Error('快照目錄無法載入');manifest=await response.json();
  failures.delete('manifest');
  const results=await Promise.allSettled(Object.entries(ARCHIVE_FILES).map(async([id,path])=>{
   if(id==='monitorLatest'&&(manifest.files?.['news-monitor/history.json']||!manifest.files?.['news-monitor/latest.json'])){delete docs.monitorLatest;failures.delete(id);return;}
   if(id==='monitorHistory'&&!manifest.files?.['news-monitor/history.json']){delete docs.monitorHistory;failures.delete(id);return;}
   if(id==='polls'&&blackout){delete docs.polls;failures.delete(id);return;}
   try{docs[id]=shape(id,await readFile(path));failures.delete(id);}catch(error){delete docs[id];failures.set(id,`${path}：${error.message}`);}
  }));
  for(const r of results)if(r.status==='rejected')throw r.reason;
 }catch(error){failures.set('manifest',error.message);}
 if(isPollBlackout()!==blackout){loading=false;void load();return;}
 const archive=buildArchive(docs,{blackout});rows=archive.rows;people=buildPeople(docs);metadata();catalogue();updateCounts();loading=false;
 $('archiveEdition').textContent=docs.stats?.generated_at?`統計快照 ${coverageTime(docs.stats)}（台北）`:'快照時間待確認';
 $('archiveLoad').textContent=failures.size?`部分資料尚未載入，現在顯示 ${rows.length.toLocaleString('zh-TW')} 筆；匯出暫停。`:`已整合 ${rows.length.toLocaleString('zh-TW')} 筆既有紀錄。各類分別計數，沒有把同網址的不同紀錄刪除。`;
 const notes=[...failures.values()];if(blackout)notes.push(`封關期間暫停載入民調檔，並暫不顯示其他類型中與民調相關的 ${archive.held} 筆紀錄；匯出也沿用此限制。`);
 $('archiveWarning').hidden=!notes.length;$('archiveWarning').textContent=notes.join('；');$('archiveRetry').hidden=!failures.size;render();
}
function download(format){
 if(loading||failures.size||!matching.length)return;
 // Recheck at export time too, including a tab kept open across the blackout boundary.
 if(isPollBlackout()!==blackout){void load();$('archiveExportNote').textContent='顯示期間已變更，正在重新套用民調限制，請稍後再匯出。';return;}
 const selected=matching.map(r=>archiveExport(r,people));
 let text,type;
 if(format==='json'){text=JSON.stringify({scope:'本站已收錄資料；非網路全部資訊',filters:values(),records:selected},null,2);type='application/json;charset=utf-8';}
 else{const columns=['type','people','title','date','date_basis','source','url','platform','status','summary','data_file','record'];text='\ufeff'+[columns,...selected.map(r=>columns.map(k=>typeof r[k]==='object'?JSON.stringify(r[k]):r[k]))].map(r=>r.map(csvValue).join(',')).join('\r\n');type='text/csv;charset=utf-8';}
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=`watch-archive.${format}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 $('archiveExportNote').textContent=`已匯出全部 ${selected.length.toLocaleString('zh-TW')} 筆符合資料，包含目前頁面以外的紀錄。`;
}
$('archiveFilters').onsubmit=e=>e.preventDefault();
$('archiveFilters').oninput=e=>{clearTimeout(timer);if(e.target.type==='search')timer=setTimeout(()=>render({reset:true}),160);else render({reset:true});};
$('archiveFilters').onreset=()=>{clearTimeout(timer);setTimeout(()=>render({reset:true}),0);};
$('archiveSize').onchange=()=>render({reset:true});$('archivePrev').onclick=()=>{page--;render({focus:true});};$('archiveNext').onclick=()=>{page++;render({focus:true});};
$('archiveCSV').onclick=()=>download('csv');$('archiveJSON').onclick=()=>download('json');$('archiveRetry').onclick=load;
$('archiveCopy').onclick=async()=>{updateURL();try{await navigator.clipboard.writeText(location.href);$('archiveExportNote').textContent='已複製目前篩選連結。';}catch{$('archiveExportNote').textContent='可直接複製瀏覽器網址列，網址已包含目前篩選。';}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isPollBlackout()!==blackout)void load();});
setInterval(()=>{if(!document.hidden&&isPollBlackout()!==blackout)void load();},30000);
void load();

function scheduleBoundary(){const now=Date.now(),next=[POLL_BLACKOUT_DEFAULTS.startMs,POLL_BLACKOUT_DEFAULTS.endMs].filter(t=>t>now).sort((a,b)=>a-b)[0];if(next)setTimeout(()=>{if(isPollBlackout()!==blackout)void load();scheduleBoundary();},Math.min(next-now,2147483000));}
scheduleBoundary();
