import{e as o,c as i,n as l,p as d,o as u}from"./data-BhtQD82b.js";const p=Object.freeze(["facebook","instagram","threads","youtube"]),c=Object.freeze({facebook:"Facebook",instagram:"Instagram",threads:"Threads",youtube:"YouTube"});function f(e){return!e||typeof e!="object"?!1:e.source_type==="social_inbox"||e.type==="social_inbox"?!0:p.includes(e.platform)&&(e.inbox_added_at||e.display_label==="社群貼文")}function m(e,{personId:a,limit:s=24}={}){const r=(e||[]).filter(f).filter(n=>!a||n.person_id===a).filter(n=>l(n.url)&&String(n.source_name||"").trim());return r.sort((n,t)=>String(t.inbox_added_at||t.collected_at||"").localeCompare(String(n.inbox_added_at||n.collected_at||""))),r.slice(0,s)}function b(e){const a=u(e);if(a)return`<img class="sc-ext-img" src="${o(a)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;const s=o(String(e.person_id||"")),r=o(String(e.person||"?").slice(0,1));return`<span class="thumb-initial" data-p="${s}" style="width:100%;height:100%;border-radius:0;font-size:1.4rem">${r}</span>`}function g(e){const a=l(e.url);if(!a)return"";const s=String(e.platform||""),r={wu:"#9A6212",xu:"#7E3F82",zheng:"#374151"}[e.person_id]||"#7A6A58",n={wu:"#F3E6D0",xu:"#EBDCEC",zheng:"#DCE0E6"}[e.person_id]||"#EFE9DF",t=e.person?` · ${o(e.person)}`:"";return`<li class="social-card" style="--pc:${r};--ps:${n}" data-platform="${o(s)}">
  <div class="sc-thumb" data-p="${o(String(e.person_id||""))}">${b(e)}</div>
  <div class="sc-body">
    <div class="sc-plat">${d(s)} ${o(c[s]||s)}</div>
    <div class="sc-title">${o(e.title||c[s]||"社群貼文")}</div>
    <div class="sc-meta">${o(e.source_name||"")}${t}</div>
    <a class="sc-link" href="${o(a)}" target="_blank" rel="noopener noreferrer">看原文 ${i("arrow")}</a>
  </div>
</li>`}function _(e,a={}){const s=a.heading||"社群貼文",r=m(e,a),n=r.length?`<p class="muted fine">來自匯入匣的 FB／IG／Threads／YouTube 連結（${r.length} 則）。Meta 平台不自動抓取正文；YouTube 標題／縮圖來自公開 oEmbed。</p>`:'<p class="muted fine">尚無匯入的社群貼文。請把連結丟進匯入匣（見 <code>README_inbox.md</code>）或用 <code>scripts/add_social_link.py</code>。</p>',t=r.length?`<ul class="social-grid">${r.map(g).join("")}</ul>`:"";return`<section class="social-block panel" aria-label="${o(s)}">
  <header class="social-head"><h2>${i("mic")} ${o(s)}</h2></header>
  ${n}${t}
</section>`}export{_ as r};
