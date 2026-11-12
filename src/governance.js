import './lib/mobile-nav.js';
import { escapeHtml as esc } from './lib/data.js';

const $ = id => document.getElementById(id);
const KEY = 'governance-watch-v1';
const date = value => value ? esc(value.replaceAll('-', '/')) : '未標示';
const money = value => value === null || value === undefined ? '尚未收錄' : `NT$ ${value.toLocaleString('zh-TW')}`;
let projects = [], registry, sources, watch = new Set();
function storageNote() { $('storageNote').textContent = '瀏覽器未允許儲存，關注清單僅保留至本頁關閉。'; }
try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) watch = new Set(saved.filter(x => typeof x === 'string')); } catch { storageNote(); }
function save() { try { localStorage.setItem(KEY, JSON.stringify([...watch])); } catch { storageNote(); } }
function sourceLink(id, label = '查看官方原文') {
  const source = sources.get(id);
  if (!source) return '來源未收錄';
  const url = new URL(source.url);
  return url.protocol === 'https:' ? `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '來源網址無效';
}
function visible() {
  const query = $('query').value.trim().toLocaleLowerCase();
  return projects.filter(p => (!$('region').value || p.region_id === $('region').value) && (!$('topic').value || p.topic_id === $('topic').value) && (!$('watched').checked || watch.has(p.id)) && (!query || `${p.title} ${p.agency} ${p.summary}`.toLocaleLowerCase().includes(query)));
}
function card(p) {
  const region = registry.regions.find(r => r.id === p.region_id).name;
  const topic = registry.topics.find(t => t.id === p.topic_id).name;
  const progress = p.progress === null ? '<p class="gov-unknown">工程百分比尚未收錄；不以流程階段推算。</p>' : `<figure class="gov-progress"><figcaption><span>機關公布工程進度</span><strong>${p.progress.value}%</strong></figcaption><progress max="100" value="${p.progress.value}" aria-label="${esc(p.title)}機關公布工程進度">${p.progress.value}%</progress><p>數字基準日：${date(p.progress.as_of)}${!p.progress.as_of ? '（不能當作目前進度）' : ''}<br>${sourceLink(p.progress.source_id)}</p></figure>`;
  const budget = p.budget ? `<dl class="gov-budget">${[['核定經費','approved_twd'],['決標金額','contract_twd'],['實際支用','spent_twd']].map(([label,key]) => `<div><dt>${label}</dt><dd>${money(p.budget[key])}</dd></div>`).join('')}</dl><p class="gov-unknown">${sourceLink(p.budget.source_id,'經費來源原文')}・金額單位：新台幣元</p>` : '<p class="gov-unknown">經費資料尚未收錄。</p>';
  return `<article class="gov-project" id="${esc(p.id)}"><div class="gov-card-top"><p>${esc(region)} / ${esc(topic)}</p><button type="button" data-watch="${esc(p.id)}" aria-label="關注${esc(p.title)}" aria-pressed="${watch.has(p.id)}">${watch.has(p.id)?'已關注':'關注'}</button></div><h3>${esc(p.title)}</h3><p class="gov-agency">${esc(p.agency)}</p><p class="gov-summary">${esc(p.summary)}</p><div class="gov-phase"><strong>${esc(p.phase_label)}</strong><small>階段紀錄日期：${date(p.phase_as_of)}</small></div>${progress}${p.target?`<p class="gov-unknown">${esc(p.target.label)}<br>此為來源所列期程，尚未以實際完工資料確認。</p>`:''}${budget}<details class="gov-evidence"><summary>紀錄與待補證據 · ${p.events.length} 筆</summary><ol class="gov-events">${[...p.events].reverse().map(e=>`<li><time datetime="${esc(e.date)}">${date(e.date)}${e.precision==='month'?'（月份紀錄）':''}</time><p>${esc(e.summary)}</p>${sourceLink(e.source_id)}</li>`).join('')}</ol><div class="gov-missing"><h4>本站待補證據</h4><ul>${p.missing_evidence.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></details></article>`;
}
function render() {
  const rows = visible();
  $('resultCount').textContent = `${rows.length} / ${projects.length} 案・已關注 ${projects.filter(p=>watch.has(p.id)).length} 案`;
  $('projectList').innerHTML = rows.length ? rows.map(card).join('') : '<p class="gov-empty">沒有符合條件的案卷。可重設篩選，或取消「只看我的關注」。</p>';
  $('export').disabled = !rows.length;
}
export function csvCell(value) { let text = String(value ?? ''); if (/^[\s]*[=+@-]/u.test(text)) text = "'" + text; return '"' + text.replaceAll('"','""') + '"'; }
function download() {
  const header = ['案卷','地區','議題','機關','階段紀錄','階段日期','工程進度百分比','進度基準日','核定經費TWD','決標金額TWD','實際支用TWD','目標期程','證據日期與網址','本站查閱日'];
  const rows = visible().map(p=>[p.title,registry.regions.find(r=>r.id===p.region_id).name,registry.topics.find(t=>t.id===p.topic_id).name,p.agency,p.phase_label,p.phase_as_of??'未標示',p.progress?.value??'尚未收錄',p.progress?.as_of??'未標示',p.budget?.approved_twd??'尚未收錄',p.budget?.contract_twd??'尚未收錄',p.budget?.spent_twd??'尚未收錄',p.target?.value??'尚未收錄',p.events.map(e=>`${e.date} ${sources.get(e.source_id).url}`).join('\n'),registry.reviewed_at]);
  const blob = new Blob(['\ufeff'+[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href=url; anchor.download=`governance-${registry.reviewed_at}.csv`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function init() {
  const load = async path => { const response=await fetch(path); if(!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); };
  const [data, directory] = await Promise.all([load('/data/governance.json'),load('/data/governance-registry.json')]);
  projects=data.projects; registry=directory; sources=new Map(registry.sources.map(s=>[s.id,s]));
  for(const [id,values] of [['region',registry.regions],['topic',registry.topics]]) for(const value of values) $(''+id).add(new Option(value.name,value.id));
  $('coverage').textContent=`${registry.scope_note} 本站查閱日：${date(data.reviewed_at)}。`;
  const cited = new Set(projects.flatMap(p=>p.events.map(e=>e.source_id)));
  $('sourceList').innerHTML=registry.sources.map(s=>`<li>${sourceLink(s.id,s.name)}<small>${cited.has(s.id)?'案卷引用來源':'查詢目錄・尚未整批匯入'} / ${esc(s.agency)}</small><small>來源更新日：${date(s.source_updated_at)}・本站查閱：${date(s.checked_at)}</small></li>`).join('');
  $('filters').addEventListener('submit',e=>e.preventDefault());
  $('filters').addEventListener('input',render);
  $('filters').addEventListener('reset',()=>setTimeout(render,0));
  $('projectList').addEventListener('click',e=>{const button=e.target.closest('[data-watch]');if(!button)return; const id=button.dataset.watch; watch.has(id)?watch.delete(id):watch.add(id);save();render();($('projectList').querySelector(`[data-watch="${id}"]`) || $('watched')).focus();});
  $('export').addEventListener('click',download);
  $('projectList').setAttribute('aria-busy','false');render();
}
init().catch(()=>{ $('projectList').setAttribute('aria-busy','false');$('projectList').innerHTML='<p class="gov-empty" role="alert">案卷暫時無法載入，請重新整理。也可直接查閱下方官方來源：<a href="https://data.taipei/">臺北市資料大平臺</a>、<a href="https://www.publicwork.ntpc.gov.tw/">新北市工務局</a>。</p>'; $('coverage').textContent='資料載入失敗；尚未顯示任何進度。'; });
