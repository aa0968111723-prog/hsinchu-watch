import{i as c,e as r,p}from"./latest-top-CFMKF4sl.js";const f=Object.freeze(["wu","xu","zheng"]),l=Object.freeze({wu:{id:"wu",name:"吳旭智",role:"竹北市長候選人"},xu:{id:"xu",name:"徐欣瑩",role:"新竹縣長候選人"},zheng:{id:"zheng",name:"鄭朝方",role:"新竹縣長候選人"}}),h=Object.freeze({transport:"交通",industry:"科學園區／產業",welfare:"長照／社福",education:"教育／托育",housing:"住宅／房價",safety:"治安",environment:"環境／水資源",agriculture:"農業",fiscal:"財政",hakka_indigenous:"原鄉／客家"}),o=Object.freeze({self_claimed:"當事人自述",independently_reported:"公開紀錄／報導"});function u(e){const s=p(e);if(s==null)return String(e||"");try{return new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(s))}catch{return String(e).slice(0,10)}}function _(e){return h[e]||e}function g(e){const s=e.source_url||e.url;if(!c(s))return"";const a=[];e.controversy?a.push('<span class="rec-badge controversy">爭議</span>'):a.push(`<span class="rec-badge">${e.kind==="policy"?"政見":"政績"}</span>`),e.claim_origin&&o[e.claim_origin]&&a.push(`<span class="rec-badge ${e.claim_origin==="self_claimed"?"self":"indep"}">${o[e.claim_origin]}</span>`),e.uncorroborated&&a.push('<span class="rec-badge warn">未獨立查核</span>');for(const i of e.issues||[])a.push(`<span class="rec-badge">${r(_(i))}</span>`);const t=u(e.published_at),n=e.role_at_time?`<span>${r(e.role_at_time)}</span><span aria-hidden="true">·</span>`:"";return`<article class="rec-card${e.controversy?" rec-controversy":""}" id="${r(e.id)}" data-id="${r(e.id)}" data-person="${r(e.person_id)}">
  <div class="rec-badges">${a.join("")}</div>
  <h3><a href="${r(s)}" target="_blank" rel="noopener noreferrer">${r(e.title)}</a></h3>
  ${e.summary?`<p class="rec-summary">${r(e.summary)}</p>`:""}
  <p class="rec-meta">${n}<time datetime="${r(String(e.published_at||""))}">${r(t)}</time>
    <span aria-hidden="true">·</span>
    <a href="${r(s)}" target="_blank" rel="noopener noreferrer">${r(e.source_name)}</a>
  </p>
</article>`}function S(e,s){const a=l[e],t=s.filter(i=>i.kind==="record"),n=t.length?t.map(g).join(""):'<p class="rec-empty">目前沒有已核可、且帶來源的政績條目。</p>';return`<section class="rec-col" id="${r(e)}" data-person="${r(e)}">
  <h2>${r(a.name)} <span class="rec-count">${t.length} 則政績</span></h2>
  <p class="rec-role">${r(a.role)}</p>
  <div class="rec-list">${n}</div>
</section>`}function b(e,s,a="尚未找到公開表態"){const t=l[e];if(!s||!s.found)return`<article class="st-col" data-person="${r(e)}">
  <h3>${r(t.name)}</h3>
  <p class="st-missing">${r(a)}</p>
</article>`;const n=s.source_url,i=c(n),d=u(s.published_at),m=s.role_at_time?`${r(s.role_at_time)} · `:"",$=i?`<a href="${r(n)}" target="_blank" rel="noopener noreferrer">${r(s.source_name)}</a>`:r(s.source_name||"");return`<article class="st-col" data-person="${r(e)}">
  <h3>${r(t.name)}</h3>
  ${s.quote?`<p class="st-quote">「${r(s.quote)}」</p>`:""}
  <p class="st-summary">${r(s.summary||"")}</p>
  <p class="st-meta">${m}<time datetime="${r(String(s.published_at||""))}">${r(d)}</time>
    <span aria-hidden="true">·</span>${$}</p>
</article>`}function v(e,s="尚未找到公開表態"){const a=f.map(t=>b(t,(e.stances||{})[t],s)).join("");return`<section class="st-issue" id="${r(e.id)}" data-issue="${r(e.id)}">
  <h2>${r(e.name)}</h2>
  ${e.blurb?`<p class="st-blurb">${r(e.blurb)}</p>`:""}
  <div class="st-cols">${a}</div>
</section>`}export{h as I,f as P,S as a,l as b,v as i,g as r};
