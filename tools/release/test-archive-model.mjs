import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ARCHIVE_FILES,buildArchive,buildPeople,filterArchive,archiveExport,csvValue} from '../../src/lib/archive-model.js';
const docs={};for(const [id,path]of Object.entries(ARCHIVE_FILES)){try{docs[id]=JSON.parse(await readFile(new URL('../../public'+path,import.meta.url),'utf8'));}catch(error){if(!['monitorHistory','monitorLatest'].includes(id))throw error;}}
const {rows}=buildArchive(docs),people=buildPeople(docs);
for(const [kind,input]of [['monitor',[...docs.monitor.articles,...(docs.monitorHistory?.articles||docs.monitorLatest?.articles||[])]],['news',docs.items],['policy',docs.policies],['poll',docs.polls],['comment',docs.comments.entries],['source',docs.sources.entries],['governance',docs.governance.projects]])assert.equal(rows.filter(r=>r.kind===kind).length,input.length,kind);
assert.equal(rows.filter(r=>r.kind==='official').length,Object.values(docs.official.by_person).reduce((n,p)=>n+p.items.length,0));
assert.equal(rows.filter(r=>r.kind==='stance').length,docs.stances.issues.reduce((n,p)=>n+Object.values(p.stances).filter(s=>s.found).length,0));
assert.equal(rows.filter(r=>r.kind==='news'&&r.status==='archive').length,docs.items.filter(r=>r.counts_in_stats===false).length);
assert.equal(filterArchive(rows,{person:'zhu'},people).filter(r=>r.kind==='source').length,docs.sources.entries.filter(r=>r.personIds.includes('zhu')).length);
assert(filterArchive(rows,{person:'wu_zijia'},people).length>0);
const own=rows.filter(r=>r.people.includes('wu'));assert.equal(filterArchive(rows,{person:'wu'},people).length,own.length);
const fixture={items:[{person_id:'a',title:'民調99.9%',url:'https://example.com/a',counts_in_stats:false,username:'secret',published_at:'2026-11-12'},{person_id:'a',title:'交通資料',url:'https://example.com/b',review_status:'pending',summary:'另一筆',author:'secret'}],polls:[{title:'民調99.9%',url:'https://example.com/p',verified:false,support:{a:99.9},note:'支持率99.9%',person_ids:['a']}]};
const all=buildArchive(fixture).rows;
assert.equal(all.length,3);assert.equal(all.filter(r=>r.status==='pending').length,1);assert(!JSON.stringify(all).includes('secret'));
const poll=all.find(r=>r.kind==='poll');assert(!JSON.stringify(poll.record).includes('99.9'));assert(!('support'in poll.record));
assert.equal(buildArchive(fixture,{blackout:true}).rows.length,1);
assert.equal(filterArchive(all,{from:'2026-11-01'}).length,1); // Unknown publication dates are not invented.
assert.equal(archiveExport(all[0],{}).record.username,undefined);
assert(csvValue('=FORMULA()').startsWith('"\''));
assert.equal(buildPeople(docs).wu.group,'本屆正式名單（目前兩選區）');
assert.equal(buildPeople(docs).wu_zijia.group,'評論人物');
console.log(JSON.stringify({archiveModel:'passed',allRows:rows.length,news:docs.items.length,policies:docs.policies.length,sources:docs.sources.entries.length,archiveOnly:rows.filter(r=>r.status==='archive').length,privacy:true,blackout:true}));
