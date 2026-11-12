import"./mobile-nav-D0ukQkk_.js";import{s as j,f as A,l as v,b as T,i as M,c as $,e as p,d as w,g as L}from"./data-BhtQD82b.js";import{P,r as E,a as R,b as h,c as x}from"./charts-7gzzYDaY.js";const m=P,f=R,u=n=>document.getElementById(n);function H(n,t){if(!n)return null;const e=Date.parse(n);return Number.isFinite(e)?(t-e)/1e3:null}function b(n,t,e){const r=H(n,t);return r!=null&&r>=0&&r<=e}function g(n,t){return n.filter(e=>String(e.platform||"")===t).length}function C(n){const t=String(n.platform||"");return t==="news"||t==="commentary"||t==="ptt"||t==="gov"||t==="party"||t==="council"}function O(n,t,e){const r={h24:86400,d7:604800,d30:2592e3},l={};for(const[a,o]of Object.entries(r)){const c=n.filter(s=>b(s.published_at||s.collected_at,e,o)),i=t.filter(s=>b(s.published_at||s.collected_at,e,o));l[a]={news:c.filter(C).length,official:i.length||c.filter(s=>s.is_own_speech||s.platform==="website").length,x:g(c,"x")+g(c,"twitter"),total:c.length}}return l}function _(){return`<div class="cmp-legend">${m.map(n=>{const t=h[n],e=f[n];return`<span><i class="cmp-swatch" style="background:${t.color}"></i>${p(e.name)}</span>`}).join("")}<span class="muted">依公開可抓來源</span></div>`}function y(n,t){const e=Math.max(1,...m.map(c=>t[c]||0)),r=m.map(c=>{const i=t[c]||0,s=Math.round(i/e*100),d=h[c];return`<i class="cmp-seg" title="${p(f[c].name)} ${i}" style="width:${s}%;background:${d.color}"></i>`}).join(""),l=m.map(c=>{const i=t[c]||0,s=h[c],d=p(s.short||f[c].name.slice(0,1));return`<span class="cmp-num-chip" data-p="${c}" style="--pc:${s.color};--ps:${s.soft}"><span class="cmp-ch" aria-hidden="true">${d}</span>${i}</span>`}).join(""),a=m.map(c=>t[c]||0).join(" / "),o=m.map(c=>f[c].name.slice(0,1)).join("／");return`<div class="cmp-row"><span class="lab">${p(n)}</span><div class="cmp-track-wrap"><div class="cmp-track">${r}</div><div class="cmp-num-chips" aria-label="${p(o)}">${l}</div><span class="num">${p(a)}</span></div></div>`}function k(n,t){const e=u("windowBars");if(!e)return;const r={h24:"近 24 小時",d7:"近 7 日",d30:"近 30 日"},l=["h24","d7","d30"].map(s=>`<button type="button" data-win="${s}" class="${s===t?"active":""}">${r[s]}</button>`).join(""),a={},o={},c={};for(const s of m){const d=n[s]&&n[s][t]||{news:0,official:0,x:0};a[s]=d.news,o[s]=d.official,c[s]=d.x}e.innerHTML=`<div class="panel-head"><h3>${$("layers")} 時段聲量比較</h3></div>
    ${_()}
    <div class="cmp-window-tabs" id="winTabs">${l}</div>
    <div class="cmp-bars">
      ${y("新聞／評論",a)}
      ${y("官網發言",o)}
      ${y("X 提及",c)}
    </div>
    <p class="fine muted">長條為相對比例（同軸）；色芯片為各候選人則數。舊資料可做對照，最新新聞仍以首頁為準。</p>`;const i=u("winTabs");i&&i.querySelectorAll("button").forEach(s=>{s.addEventListener("click",()=>k(n,s.getAttribute("data-win")||"h24"))})}function S(n,t){const e=(n||[]).filter(s=>s.person_id===t),r=e.filter(s=>s.kind==="record"||s.type==="record"||s.kind==="政績").length,l=e.filter(s=>!(s.kind==="record"||s.type==="record"||s.kind==="政績")).length,a=e.filter(s=>s.controversy),o=a.filter(s=>s.responded===!0).length,c=a.filter(s=>s.responded===!1).length,i=a.length-o-c;return{total:e.length,record:r,policy:l,controversy:a.length,responded:o,noResp:c,unk:i}}function D(n,t){const e=u("metricCards");e&&(e.innerHTML=`<div class="panel-head"><h3>${$("layers")} 指標色塊（等權重）</h3></div>
    <div class="cmp-grid3">${m.map(r=>{const l=h[r],a=f[r],o=n[r]||{},c=S(t,r);return`<article class="cmp-card" style="--pc:${l.color};--ps:${l.soft}">
        <h2>${x({id:r,name:a.name},"md")}<a href="/person.html?id=${encodeURIComponent(r)}">${p(a.name)}</a></h2>
        <div class="role">${p(a.role)} · ${p(a.party)}</div>
        <div class="cmp-metrics">
          <div class="cmp-metric"><b>${o.h24?o.h24.total:0}</b><span>近24h 則數</span></div>
          <div class="cmp-metric"><b>${o.d7?o.d7.total:0}</b><span>近7日 則數</span></div>
          <div class="cmp-metric"><b>${o.d30?o.d30.total:0}</b><span>近30日 則數</span></div>
          <div class="cmp-metric"><b>${c.total}</b><span>政績／政見</span></div>
          <div class="cmp-metric"><b>${c.record}</b><span>政績</span></div>
          <div class="cmp-metric"><b>${c.policy}</b><span>政見</span></div>
          <div class="cmp-metric"><b>${c.controversy}</b><span>爭議則數</span></div>
          <div class="cmp-metric"><b>${c.responded}/${c.noResp}</b><span>有回應／未回應</span></div>
        </div>
      </article>`}).join("")}</div>
    <p class="fine muted">政績政見來自已發布 policies；爭議「有回應／未回應」依公開報導標示，缺資料不臆測。</p>`)}function B(n){const t=u("policyCompare");if(!t)return;const e=m.map(r=>{const l=h[r],a=S(n,r);return`<tr>
      <td><span class="cmp-swatch" style="background:${l.color}"></span> ${p(f[r].name)}</td>
      <td>${a.record}</td><td>${a.policy}</td><td>${a.total}</td>
      <td>${a.controversy}（有回應 ${a.responded}／未 ${a.noResp}${a.unk?`／未標 ${a.unk}`:""}）</td>
    </tr>`}).join("");t.innerHTML=`<div class="panel-head"><h3>${$("doc")} 政績／政見／爭議對照</h3></div>
    <table class="cmp-table"><thead><tr><th>候選人</th><th>政績</th><th>政見</th><th>合計</th><th>爭議</th></tr></thead>
    <tbody>${e}</tbody></table>
    <p class="fine muted">條數依可抓公開來源；各人收錄量未必相同，不代表優劣。</p>`}function N(n){return!L()&&n.verified===!0&&!n.numbers_hidden}function I(n){const t=u("pollCompare");if(!t)return;const e=(Array.isArray(n)?n:[]).filter(N);if(!e.length){t.innerHTML=`<div class="panel-head"><h3>${$("poll")} 已核對民調</h3></div>
      <p class="cmp-empty">目前沒有可顯示數字的已核對民調（含機構「待驗證」者不列數字）。請看 <a href="/polls.html">民調頁</a>。</p>`;return}const r=e.slice(0,12).map(l=>{const a=l.support||{},o=m.filter(i=>a[i]!=null).map(i=>{const s=h[i];return`<span style="--pc:${s.color};--ps:${s.soft}">${p(f[i].name)} ${p(String(a[i]))}%</span>`}).join(""),c=w(l.url||"");return`<article class="cmp-poll">
      <h4>${`<a href="${p(c)}" target="_blank" rel="noopener noreferrer">${p(l.title||"民調")}</a>`}</h4>
      <div class="meta">${p(l.org||"機構未標")} · ${p(l.period||"")}${l.sample_size?` · n=${p(String(l.sample_size))}`:""}${l.moe!=null?` · 誤差±${p(String(l.moe))}`:""}</div>
      <div class="cmp-support">${o||'<span class="muted">無追蹤人物數字</span>'}</div>
    </article>`}).join("");t.innerHTML=`<div class="panel-head"><h3>${$("poll")} 已核對民調（只顯示數字）</h3></div>
    ${_()}${r}
    <p class="fine muted">機構待釐清（例：精確 vs 美麗島 DOC_228684）維持「待驗證」，不在此顯示數字。</p>`}const W=[["交通",/交通|道路|公車|鐵路|高鐵|捷運|停車/],["教育",/教育|學校|幼教|課後|青年/],["住宅",/住宅|住房|社宅|都更|房價/],["產業",/產業|科學園區|竹科|就業|經濟|招商/],["醫療",/醫療|長照|醫院|衛生/],["農業",/農業|客家|農村|休閒農業/],["治安",/治安|警察|防詐|消防/],["環境",/環境|空汙|水利|淹水|環保/]];function z(n,t,e){const r=(n||[]).filter(a=>a.person_id===t&&(e.test(a.title||"")||e.test(a.summary||"")));return r.length?r.find(a=>a.kind==="policy"||a.type==="policy"||a.kind==="政見")||r[0]:null}function F(n){const t=u("topicStance");if(!t)return;const e=[];for(const[r,l]of W){const a=m.map(o=>{const c=h[o],i=z(n,o,l);if(!i)return`<div class="cmp-stance-cell" style="--pc:${c.color};--ps:${c.soft}"><div class="nm">${p(f[o].name)}</div><span class="cmp-empty">尚無已收錄條目</span></div>`;const s=w(i.source_url||i.url||""),d=String(i.summary||i.title||"").slice(0,48);return`<div class="cmp-stance-cell" style="--pc:${c.color};--ps:${c.soft}">
        <div class="nm">${p(f[o].name)}</div>
        <div>${p(d)}${d.length>=48?"…":""}</div>
        ${`<a href="${p(s)}" target="_blank" rel="noopener noreferrer">${p(i.source_name||"來源")}</a>`}
      </div>`});a.every(o=>o.includes("尚無已收錄"))||e.push(`<div class="cmp-topic"><h4>${p(r)}</h4><div class="cmp-stance">${a.join("")}</div></div>`)}t.innerHTML=`<div class="panel-head"><h3>${$("news")} 政見主題對照</h3></div>
    ${e.length?`<div class="cmp-topic-grid">${e.join("")}</div>`:'<p class="cmp-empty">尚無足夠政見可對照。</p>'}
    <p class="fine muted">同一主題並列已收錄摘要與來源；空白表示本站尚未收錄，不代表沒有政見。</p>`}async function U(n){try{const t=await v(`/data/items_${n}.json`);return Array.isArray(t)?t:[]}catch{return[]}}async function Y(n){try{const t=await v("/data/official.json"),e=t&&t.by_person&&t.by_person[n]||{};return Array.isArray(e.items)?e.items:[]}catch{return[]}}async function q(){const n=Date.now(),t=u("statusBox");try{const[e,r,l]=await Promise.all([v("/data/stats.json").catch(()=>({})),v("/data/policies.json").catch(()=>[]),v("/data/polls.json").catch(()=>[])]),a={};await Promise.all(m.map(async i=>{const s=await U(i),d=await Y(i);a[i]=O(s,d,n)})),E(e.persons),k(a,"h24"),D(a,Array.isArray(r)?r:[]),B(Array.isArray(r)?r:[]),I(Array.isArray(l)?l:[]),F(Array.isArray(r)?r:[]);const o=e.finalized_at||e.generated_at;t&&(t.textContent=o?`資料 ${T(o)}`:"比較頁已載入");const c=u("delayWarn");if(c&&o){const i=(Date.now()-Date.parse(o))/36e5;c.classList.toggle("hidden",!(i>1))}M(document)}catch(e){t&&(t.textContent="載入失敗"),console.error(e)}}j({onData({stats:n}){q().then(()=>{const t=u("footer");t&&n&&(t.innerHTML=A(n))})}});
