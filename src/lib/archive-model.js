import {sanitizeItem} from './live-update/sanitize.js';
export const ARCHIVE_KINDS=Object.freeze({news:'新聞與討論',policy:'政策與施政紀錄',poll:'民調紀錄',comment:'匿名留言觀點',source:'公開來源索引',official:'本人／機關發言',stance:'議題立場摘錄',governance:'地方治理案卷'});
export const ARCHIVE_FILES=Object.freeze({items:'/data/items.json',policies:'/data/policies.json',polls:'/data/polls.json',comments:'/observations/comments.json',sources:'/observations/sources.json',official:'/data/official.json',stances:'/data/issue_stances.json',governance:'/data/governance.json',governanceRegistry:'/data/governance-registry.json',candidates:'/data/candidate-review.json',stats:'/data/stats.json'});
const POLL_TEXT=/民調|支持度|支持率|看好度|街訪|街頭調查|勝選率/;
export function archiveHref(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function archiveStatus(raw){return raw.review_status&&raw.review_status!=='ok'?'pending':raw.counts_in_stats===false?'archive':'recorded';}
export function buildPeople(docs){
 const people={};
 for(const [id,p] of Object.entries(docs.stats?.by_person||{}))people[id]={id,name:p.name||id,group:id==='wu_zijia'?'評論人物':'其他人物／歷史資料'};
 for(const payload of [docs.sources,docs.comments])for(const [id,p]of Object.entries(payload?.people||{}))people[id]={...people[id],id,name:p.name||id,group:people[id]?.group||'其他人物／歷史資料'};
 for(const p of docs.candidates?.candidates||[])people[p.id]={...p,group:'本屆正式名單（目前兩選區）'};
 return people;
}
function pollRecord(raw){
 const verified=raw.verified===true&&!raw.numbers_hidden;
 const out={title:verified?raw.title:String(raw.title||'民調紀錄').replace(/\d+(?:\.\d+)?\s*[%％]/g,'〔數字未核對〕'),org:raw.org,source_name:raw.source_name,url:raw.url||raw.news_url,published_at:raw.published_at,field_start:raw.field_start,field_end:raw.field_end,period:raw.period,race:raw.race,race_label:raw.race_label,person_ids:raw.person_ids,verified:raw.verified,numbers_hidden:raw.numbers_hidden,note:verified?raw.note:String(raw.note||'').replace(/\d+(?:\.\d+)?\s*[%％]/g,'〔數字未核對〕'),reports:(raw.reports||[]).map(r=>({source_name:r.source_name,url:r.url,published_at:r.published_at}))};
 if(verified){out.sample_size=raw.sample_size;out.moe=raw.moe;out.scenario=raw.scenario;out.support=Object.fromEntries(Object.entries(raw.support||{}).filter(([,v])=>v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=100));}
 else out.display_note='未核對民調僅列來源與日期，未提供支持度數字。';
 return out;
}
export function buildArchive(docs,{blackout=false}={}){
 const rows=[];let held=0;
 function add(kind,file,raw,extra={}){
  const record=sanitizeItem(raw);
  if(blackout&&(kind==='poll'||record.platform==='poll'||record.type==='poll'||record.source_type==='poll'||POLL_TEXT.test(JSON.stringify(record)))){held++;return;}
  const row={kind,file,record,people:extra.people||[record.person_id||record.personId].filter(Boolean),title:extra.title||record.title||record.summary||'未標題紀錄',summary:extra.summary??record.summary??'',date:String(extra.date??record.published_at??record.date??record.at??'').slice(0,10),url:archiveHref(extra.url||record.source_url||record.url),source:extra.source||record.source_name||'',platform:extra.platform||record.platform||record.source_type||'',status:archiveStatus(record)};
  row.date_basis=kind==='governance'?'治理事件日期':kind==='comment'?'留言時間':kind==='source'?'來源索引日期':'來源發布日';
  row.key=`${kind}:${rows.length}`;row.search=JSON.stringify([row.title,row.summary,row.source,row.people,record]).normalize('NFKC').toLocaleLowerCase();rows.push(row);
 }
 for(const x of docs.items||[])add('news',ARCHIVE_FILES.items,x);
 for(const x of docs.policies||[])add('policy',ARCHIVE_FILES.policies,x);
 for(const x of docs.polls||[])add('poll',ARCHIVE_FILES.polls,pollRecord(x),{people:x.person_ids||Object.keys(x.support||{}),platform:'民調資料',summary:'既有民調紀錄；數字與核對狀態以民調頁及原文為準。'});
 for(const x of docs.comments?.entries||[]){const thread=docs.comments.threads?.[x.thread]||{};add('comment',ARCHIVE_FILES.comments,x,{url:thread.url,source:thread.platform,platform:thread.platform,title:'匿名留言觀點',summary:x.summary});}
 for(const x of docs.sources?.entries||[])add('source',ARCHIVE_FILES.sources,x,{people:x.personIds,source:x.source,platform:'來源索引'});
 for(const [pid,p] of Object.entries(docs.official?.by_person||{}))for(const x of p.items||[])add('official',ARCHIVE_FILES.official,x,{people:[pid],platform:'本人／機關發言'});
 for(const issue of docs.stances?.issues||[])for(const [pid,x]of Object.entries(issue.stances||{}))if(x.found)add('stance',ARCHIVE_FILES.stances,{...x,issue_id:issue.id,issue_name:issue.name},{people:[pid],title:`${issue.name}・既有立場摘錄`,platform:'議題整理'});
 const sources=new Map((docs.governanceRegistry?.sources||[]).map(s=>[s.id,s]));
 for(const x of docs.governance?.projects||[]){const event=x.events?.at(-1);const src=sources.get(event?.source_id);add('governance',ARCHIVE_FILES.governance,x,{people:[],date:event?.date||'',url:src?.url,source:src?.agency||x.agency,platform:'治理案卷'});}
 rows.sort((a,b)=>b.date.localeCompare(a.date)||a.kind.localeCompare(b.kind)||a.key.localeCompare(b.key,undefined,{numeric:true}));
 return {rows,held};
}
export function filterArchive(rows,{person='',kind='',platform='',query='',from='',to='',status=''}={},people={}){
 const q=query.trim().normalize('NFKC').toLocaleLowerCase();
 return rows.filter(r=>(!person||r.people.includes(person))&&(!kind||r.kind===kind)&&(!platform||r.platform===platform)&&(!status||r.status===status)&&(!from||/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.date>=from)&&(!to||/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.date<=to)&&(!q||r.search.includes(q)||r.people.some(id=>(people[id]?.name||'').includes(q))));
}
export function archiveExport(row,people){return {type:ARCHIVE_KINDS[row.kind],person_ids:row.people,people:row.people.map(id=>people[id]?.name||id),title:row.title,date:row.date||null,date_basis:row.date_basis,source:row.source,url:row.url,platform:row.platform,status:row.status,summary:row.summary,data_file:row.file,record:row.record};}
export function csvValue(value){let s=String(value??'');if(/^\s*[=+@-]/u.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
