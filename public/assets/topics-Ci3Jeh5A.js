import"./mobile-nav-BjObXY1A.js";import{s as A,e as s,f as L,g as y,n as H,m as M}from"./data-DQRgr1ik.js";import{o as S}from"./panels-fuU6iHSB.js";import{b as I}from"./charts-BYhFNOlE.js";const p=document.getElementById("topicPicker"),h=document.getElementById("topicState"),j=document.getElementById("topicChart"),B=document.getElementById("topicDetail"),_=document.getElementById("topicSources"),k=document.getElementById("topicTable"),d=new Intl.NumberFormat("zh-TW");let i="",r=[],u=[],v=[],g=!1,b=1;function C(t){const a=s(t.title||"無標題"),c=y(t.source_url)||y(t.url),o=t.published_at?H(t.published_at):"發布時間未標";return`<li>
    <h4>${c?`<a href="${s(c)}" target="_blank" rel="noopener noreferrer">${a}</a>`:a}</h4>
    <div class="topic-source-meta"><span>${s(o)}</span>${M(t)}</div>
  </li>`}function T(){const t=r.find(o=>o.name===i);if(j.hidden=!t,!t){h.textContent="目前尚無可呈現的議題統計。";return}for(const o of p.querySelectorAll("button"))o.setAttribute("aria-pressed",String(o.dataset.topic===i));h.textContent=`共 ${r.length} 個議題 · 目前查看${t.name}`;const a=t.counts.map((o,m)=>{var n;const l=u[m],e=((n=I[l.id])==null?void 0:n.color)||"#5c564f";return`<li class="topic-bar">
      <span>${s(l.name)}</span>
      <span class="topic-track" aria-hidden="true"><span style="--topic-value:${o/b*100}%;--topic-color:${e}"></span></span>
      <b>${d.format(o)}</b>
    </li>`}).join("");B.innerHTML=`<div class="topic-detail-head">
    <div><p class="topic-eyebrow">議題收錄</p><h2 id="topicDetailTitle">${s(t.name)}</h2></div>
    <div class="topic-total"><strong>${d.format(t.total)}</strong><span>人次收錄</span></div>
  </div>
  <ul class="topic-bars" aria-label="各人物收錄篇數">${a}</ul>
  <p class="topic-state">各議題共用 0–${d.format(b)} 則刻度。同篇若分列多位人物，合計會分別計入。</p>`;const c=v.filter(o=>Array.isArray(o.topics)&&o.topics.includes(i));_.innerHTML=`<h3>近期相關來源</h3>
    <p class="topic-state">取自最新索引，最多列出 6 則，可點開原文查閱。</p>
    ${c.length?`<ul class="topic-articles">${c.slice(0,6).map(C).join("")}</ul>`:`<p class="topic-source-empty">${g?"最新索引目前沒有收錄這個議題的文章。":"目前無法讀取最新索引。"}</p>`}`}p.addEventListener("click",t=>{const a=t.target.closest("button[data-topic]");!a||a.dataset.topic===i||(i=a.dataset.topic,T())});A({onData({stats:t,items:a,itemsError:c}){var m,l;if(!t){h.textContent="目前無法讀取議題統計。";return}u=S(t),v=Array.isArray(a)?a:[],g=Array.isArray(a)&&!c,r=Object.entries(t.topic_compare||{}).map(([e,n])=>{const $=u.map(f=>Number(n==null?void 0:n[f.id])||0);return{name:e,counts:$,total:$.reduce((f,E)=>f+E,0)}}).sort((e,n)=>n.total-e.total),b=Math.max(1,...r.flatMap(e=>e.counts)),r.some(e=>e.name===i)||(i=((m=r[0])==null?void 0:m.name)||"");const o=p.contains(document.activeElement)?document.activeElement.dataset.topic:"";p.innerHTML=r.map(({name:e})=>`<button type="button" data-topic="${s(e)}" aria-controls="topicChart" aria-pressed="false">${s(e)}</button>`).join(""),o&&((l=Array.from(p.querySelectorAll("button")).find(e=>e.dataset.topic===o))==null||l.focus({preventScroll:!0})),T(),k.innerHTML=r.length?`<table>
      <thead><tr><th scope="col">議題</th>${u.map(e=>`<th scope="col">${s(e.name)}</th>`).join("")}<th scope="col">合計</th></tr></thead>
      <tbody>${r.map(e=>`<tr><th scope="row">${s(e.name)}</th>${e.counts.map(n=>`<td>${d.format(n)}</td>`).join("")}<td>${d.format(e.total)}</td></tr>`).join("")}</tbody>
    </table>`:'<p class="topic-state">目前尚無可呈現的議題統計。</p>',document.getElementById("footer").innerHTML=L(t)}});
