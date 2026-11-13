// 介面片段：列表、來源卡、階段、經費、時間軸、待定位與資料缺口。只產生 HTML 字串，事件由 main.js 委派。
// 所有來自資料的文字都經過 esc；外部連結只接受 https。
import { PRECISION_LABEL, STAGE_GLYPH, STAGE_IDS, STATUS_LABEL, artImage, formatDate, formatTwd, formatYi, timelineItems, timelineRange } from './model.js';

export const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

const link = (url, label) => {
  const href = safeUrl(url);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : `<span class="atl-muted">${esc(label)}（網址無效）</span>`;
};

export function sourceLink(model, sourceId, label) {
  const source = model.sources.get(sourceId);
  if (!source) return '<span class="atl-muted">來源未收錄</span>';
  return link(source.url, label ?? source.name);
}

const SHORT_STAGE = { planning: '規劃', approval: '核定', construction: '施工', completion: '完工', acceptance: '驗收', opening: '啟用', outcome: '成效' };
const stageLabel = (model, id) => model.stages.find((stage) => stage.id === id)?.label ?? SHORT_STAGE[id] ?? id;

export function precisionBadge(project) {
  if (project.locationState === 'located') return `<span class="atl-badge" data-precision="${esc(project.precision)}">${esc(PRECISION_LABEL[project.precision] ?? project.precision)}</span>`;
  if (project.locationState === 'pending') return '<span class="atl-badge" data-precision="unknown">待定位</span>';
  return '<span class="atl-badge" data-precision="unavailable">位置資料未載入</span>';
}

export function stageChip(model, project) {
  if (!project.stages) return '<span class="atl-chip" data-stage="unavailable">階段對照未載入</span>';
  if (!project.latestStage) return '<span class="atl-chip" data-stage="none"><b aria-hidden="true">·</b>七階段未收錄</span>';
  return `<span class="atl-chip" data-stage="${project.latestStage}"><b aria-hidden="true">${STAGE_GLYPH[project.latestStage]}</b>${esc(stageLabel(model, project.latestStage))}有紀錄</span>`;
}

// ---- 篩選 ----

export function stageBar(model, filters, stats) {
  const item = (id, label, count, glyph) => `<button type="button" class="atl-stage-chip" data-stage-filter="${id}" data-stage="${id || 'all'}" aria-pressed="${filters.stage === id}">${glyph ? `<b aria-hidden="true">${glyph}</b>` : ''}<span>${esc(label)}</span><small>${count}</small></button>`;
  const total = stats.total;
  const chips = [item('', '全部階段', total, '')];
  for (const id of STAGE_IDS) chips.push(item(id, stageLabel(model, id), stats.counts[id], STAGE_GLYPH[id]));
  chips.push(item('none', '七階段未收錄', stats.counts.none, '·'));
  const note = stats.unknown ? `<p class="atl-note" role="status">階段對照沒有載入，${stats.unknown} 案無法依階段篩選。</p>` : '';
  return `${chips.join('')}${note}`;
}

// ---- 列表 ----

export function listHtml(model, projects, { selectedId, favorites }) {
  if (!projects.length) return '<li class="atl-empty">沒有符合條件的案卷。可以重設篩選，或取消「只看收藏」。</li>';
  return projects.map((project) => {
    const place = [project.regionName, project.location?.district?.name].filter(Boolean).join('・');
    const fav = favorites.has(project.id);
    return `<li class="atl-item" data-project="${esc(project.id)}"${project.id === selectedId ? ' data-selected=""' : ''}>
      <button type="button" class="atl-item-main" data-select="${esc(project.id)}" aria-pressed="${project.id === selectedId}">
        <span class="atl-item-place">${esc(place)}｜${esc(project.topicName)}</span>
        <strong class="atl-item-title">${esc(project.title)}</strong>
        <span class="atl-item-meta">${stageChip(model, project)}${precisionBadge(project)}</span>
      </button>
      <button type="button" class="atl-fav" data-favorite="${esc(project.id)}" aria-pressed="${fav}" aria-label="${fav ? '取消收藏' : '收藏'}${esc(project.title)}"><span aria-hidden="true">${fav ? '★' : '☆'}</span></button>
    </li>`;
  }).join('');
}

// ---- 階段 ----

function railHtml(model, project) {
  if (!project.stages) return '<p class="atl-note">階段對照沒有載入，這裡只顯示案卷本身的階段紀錄。</p>';
  const marks = STAGE_IDS.map((id) => {
    const entry = project.stages[id] ?? { status: 'not_recorded' };
    return `<li class="atl-rail-step" data-status="${esc(entry.status)}" data-stage="${id}"><span class="atl-rail-mark" aria-hidden="true">${STAGE_GLYPH[id]}</span><span class="atl-rail-name">${esc(SHORT_STAGE[id])}</span><span class="atl-visually-hidden">：${esc(STATUS_LABEL[entry.status] ?? entry.status)}</span></li>`;
  }).join('');
  const recorded = STAGE_IDS.filter((id) => project.stages[id] && project.stages[id].status !== 'not_recorded').map((id) => {
    const entry = project.stages[id];
    const when = entry.status === 'stated_undated' ? '來源沒有寫日期' : formatDate(entry.date, entry.precision);
    return `<li data-status="${esc(entry.status)}"><div class="atl-record-head"><b>${esc(stageLabel(model, id))}</b><span>${esc(entry.label ?? '')}</span><time>${esc(when)}</time><em>${esc(STATUS_LABEL[entry.status] ?? '')}</em></div>${entry.quote ? `<blockquote>${esc(entry.quote)}</blockquote>` : ''}${entry.note ? `<p class="atl-note">${esc(entry.note)}</p>` : ''}<p class="atl-src">${sourceLink(model, entry.source_id, '查看原文')}</p></li>`;
  }).join('');
  const notes = STAGE_IDS.filter((id) => project.stages[id]?.status === 'not_recorded' && project.stages[id].note).map((id) => `<li><b>${esc(stageLabel(model, id))}</b>：${esc(project.stages[id].note)}</li>`).join('');
  return `<ol class="atl-rail" aria-label="七個階段各自有沒有紀錄">${marks}</ol>
    ${project.stageNote ? `<p class="atl-note">${esc(project.stageNote)}</p>` : ''}
    ${recorded ? `<ul class="atl-records">${recorded}</ul>` : ''}
    <p class="atl-note">沒有標色的階段是本站尚未收錄，不代表沒有發生；完工也不等於驗收、啟用或成效。</p>
    ${notes ? `<details class="atl-more"><summary>未收錄階段的說明</summary><ul class="atl-plain">${notes}</ul></details>` : ''}`;
}

// ---- 經費（共同刻度）----

function barRow(label, value, max, note, kind = 'budget') {
  if (value === null || value === undefined) {
    return `<div class="atl-bar-row" data-unknown=""><span class="atl-bar-name">${esc(label)}</span><span class="atl-bar-track"><span class="atl-bar-none">尚未收錄</span></span><span class="atl-bar-value atl-muted">—</span></div>`;
  }
  const share = max ? Math.max(0.5, Math.min(100, (value / max) * 100)) : 0;
  return `<div class="atl-bar-row" data-kind="${kind}"><span class="atl-bar-name">${esc(label)}</span><span class="atl-bar-track"><span class="atl-bar-fill" style="width:${share.toFixed(2)}%"></span></span><span class="atl-bar-value">${esc(formatTwd(value))}<small>${esc(formatYi(value))}</small></span>${note ? `<p class="atl-bar-note">${esc(note)}</p>` : ''}</div>`;
}

function budgetHtml(model, project, scaleMax) {
  const budget = project.budget;
  const rows = [
    barRow('核定經費', budget?.approved_twd ?? null, scaleMax),
    barRow('決標金額', budget?.contract_twd ?? null, scaleMax),
    barRow('實際支用', budget?.spent_twd ?? null, scaleMax),
  ].join('');
  const figures = project.figures.map((figure) => barRow(`${figure.label}（原文數字）`, figure.value_twd, scaleMax, figure.note, 'figure')).join('');
  const scale = scaleMax ? `<p class="atl-note">橫條用同一個刻度：0 到 ${esc(formatYi(scaleMax))}（所有案卷已知金額中最大的一筆）。沒有數字的欄位不畫橫條，不當成 0。</p>` : '<p class="atl-note">目前沒有任何案卷收錄金額。</p>';
  const source = budget?.source_id ? `<p class="atl-src">${sourceLink(model, budget.source_id, '經費來源原文')}・單位：新台幣元</p>` : '';
  return `<div class="atl-budget" role="group" aria-label="經費：核定、決標與實支分開">${rows}${figures ? `<div class="atl-figures">${figures}</div>` : ''}</div>${scale}${source}`;
}

function progressHtml(model, project) {
  if (!project.progress) return '<p class="atl-note">機關公布的工程百分比尚未收錄；不從階段推算。</p>';
  const { value, as_of: asOf, source_id: sourceId } = project.progress;
  return `<figure class="atl-progress"><figcaption><span>機關公布工程進度</span><strong>${esc(value)}%</strong></figcaption><progress max="100" value="${esc(value)}" aria-label="${esc(project.title)}機關公布工程進度">${esc(value)}%</progress><p class="atl-note">數字基準日：${esc(formatDate(asOf))}${asOf ? '' : '（來源沒有標示，不能當作目前進度）'}。這是機關公布的工程進度，不是驗收、啟用或成效。</p><p class="atl-src">${sourceLink(model, sourceId, '進度來源原文')}</p></figure>`;
}

// ---- 位置 ----

function corroborationHtml(item) {
  const sourceUrl = item.url ?? item.osm?.url ?? null;
  const more = sourceUrl ? `　${link(sourceUrl, '查核依據')}` : '';
  if (item.kind === 'nlsc_village') return `<li>國土測繪中心點位查詢：<b>${esc(item.result)}</b>；對照${esc(item.agrees_with)}。${more}</li>`;
  if (item.kind === 'osm_site_polygon') return `<li>OpenStreetMap 所畫施工範圍約 <b>${esc(item.osm_area_m2.toLocaleString('zh-TW'))} 平方公尺</b>，${esc(item.compares_with)}（差 ${esc(item.difference_pct)}%）；標記點${item.marker_inside ? '在範圍內' : `在範圍邊緣外 <b>${esc(item.marker_distance_m)} 公尺</b>`}。${esc(item.note ?? '')}${more}</li>`;
  if (item.kind === 'osm_feature_distance') return `<li>距 OpenStreetMap 上的「${esc(item.label)}」<b>${esc(item.distance_m)} 公尺</b>；對照${esc(item.compares_with)}。${more}</li>`;
  if (item.kind === 'length_check') return `<li>線段長 <b>${esc(item.computed_length_m.toLocaleString('zh-TW'))} 公尺</b>，${esc(item.compares_with)}（差 ${esc(item.difference_pct)}%）。</li>`;
  return '';
}

function locationHtml(model, project) {
  const location = project.location;
  if (project.locationState === 'unavailable') return '<p class="atl-note" role="status">位置資料檔沒有載入，無法顯示這個案卷的位置或待定位原因。</p>';
  if (project.locationState === 'unchecked') return '<p class="atl-note">這個案卷還沒有做位置查核，所以沒有畫在地圖上。</p>';
  const quote = `<blockquote class="atl-quote">${esc(location.location_text)}</blockquote><p class="atl-src">位置原文：${sourceLink(model, location.location_text_source_id)}</p>`;
  if (project.locationState === 'pending') {
    const clues = (location.pending.clues ?? []).map((clue) => `<li>${esc(clue.text)}${clue.url ? `　${link(clue.url, '查核依據')}` : ''}</li>`).join('');
    return `${quote}<div class="atl-pending-box"><h4>為什麼還沒定位</h4><p>${esc(location.pending.reason)}</p>${clues ? `<h4>目前的線索</h4><ul class="atl-plain">${clues}</ul>` : ''}<h4>下一步</h4><p>${esc(location.pending.next_step)}</p></div>`;
  }
  const source = location.coordinate_source;
  const [lon, lat] = location.anchor;
  const checks = location.corroboration.map(corroborationHtml).join('');
  const caveats = location.caveats.map((text) => `<li>${esc(text)}</li>`).join('');
  const lineNote = location.geometry.type === 'LineString' ? `線段，圖釘放在中點；線長 ${esc(source.computed_length_m?.toLocaleString('zh-TW') ?? '')} 公尺` : '單一點位';
  return `${quote}
    <dl class="atl-facts">
      <div><dt>行政區</dt><dd>${esc(project.regionName)}${esc(location.district?.name ?? '')}</dd></div>
      <div><dt>地點精度</dt><dd>${esc(PRECISION_LABEL[location.location_precision])}<small>${esc(model.precisionLegend?.[location.location_precision] ?? '')}</small></dd></div>
      <div><dt>座標（經度, 緯度）</dt><dd class="atl-num">${lon.toFixed(5)}, ${lat.toFixed(5)}<small>${lineNote}</small></dd></div>
      <div><dt>座標查閱日</dt><dd>${esc(formatDate(source.checked_at))}</dd></div>
    </dl>
    <p class="atl-basis"><b>座標依據</b>　${esc(source.basis)}　${link(source.url, '查看座標來源')}</p>
    ${checks ? `<details class="atl-more" open><summary>交叉核對（${location.corroboration.length} 項）</summary><ul class="atl-plain">${checks}</ul></details>` : ''}
    ${caveats ? `<ul class="atl-caveats">${caveats}</ul>` : ''}`;
}

// ---- 來源卡 ----

function eventsHtml(model, project) {
  const items = timelineItems(project);
  if (!items.length) return '<p class="atl-note">沒有可排上時間軸的紀錄。</p>';
  return `<ol class="atl-events">${[...items].reverse().map((item) => `<li data-kind="${item.kind}"><time datetime="${esc(item.date)}">${esc(formatDate(item.date, item.precision))}</time><span class="atl-event-kind">${item.kind === 'target' ? '機關目標（尚未發生）' : item.kind === 'record' ? '其他程序紀錄' : '案卷紀錄'}</span><p>${esc(item.label)}</p>${item.quote ? `<blockquote>${esc(item.quote)}</blockquote>` : ''}${item.sourceId ? `<p class="atl-src">${sourceLink(model, item.sourceId, '查看原文')}</p>` : ''}</li>`).join('')}</ol>`;
}

function relationsHtml(model, project) {
  if (!project.relations.length) return '';
  const agencies = project.relations.filter((item) => item.type === 'agency');
  const people = project.relations.filter((item) => item.type === 'person');
  const row = (item) => `<li><b>${esc(item.name)}</b>${item.office ? `<span class="atl-office">${esc(item.office)}</span>` : ''}<span class="atl-relation">${esc(item.relation_label)}</span><blockquote>${esc(item.quote)}</blockquote><p class="atl-src">${sourceLink(model, item.source_id, '查看原文')}</p></li>`;
  return `<section class="atl-block"><h3>機關與人物</h3>
    ${agencies.length ? `<ul class="atl-relations">${agencies.map(row).join('')}</ul>` : ''}
    ${people.length ? `<h4>來源提到的人物</h4><ul class="atl-relations">${people.map(row).join('')}</ul>` : ''}
    <p class="atl-note">${esc(project.relationsNote ?? '只列來源明寫的關係。新聞或公告提到某人，不代表工程由他決定，也不據此歸功或歸咎。')}</p></section>`;
}

function sourcesHtml(model, project) {
  const ids = new Set();
  for (const event of project.events) ids.add(event.source_id);
  if (project.progress?.source_id) ids.add(project.progress.source_id);
  if (project.budget?.source_id) ids.add(project.budget.source_id);
  for (const id of STAGE_IDS) if (project.stages?.[id]?.source_id) ids.add(project.stages[id].source_id);
  for (const item of [...project.otherRecords, ...project.figures, ...project.facts, ...project.relations]) if (item.source_id) ids.add(item.source_id);
  if (project.location?.location_text_source_id) ids.add(project.location.location_text_source_id);
  if (project.location?.coordinate_source?.source_id) ids.add(project.location.coordinate_source.source_id);
  for (const item of project.location?.corroboration ?? []) if (item.source_id) ids.add(item.source_id);
  const rows = [...ids].filter((id) => model.sources.has(id)).map((id) => {
    const source = model.sources.get(id);
    return `<li>${link(source.url, source.name)}<small>${esc(source.agency ?? source.publisher ?? '')}${source.source_updated_at ? `・來源更新日 ${esc(formatDate(source.source_updated_at))}` : ''}・本站查閱 ${esc(formatDate(source.checked_at))}</small></li>`;
  }).join('');
  return `<ul class="atl-sourcelist">${rows}</ul>`;
}

function artHtml(assets) {
  if (!assets.length) return '';
  return `<section class="atl-block"><h3>實景照片</h3><ul class="atl-art">${assets.map((asset) => {
    const image = artImage(asset);
    return `<li><a href="${esc(image.full)}" target="_blank" rel="noopener"><img src="${esc(image.thumb)}" alt="${esc(asset.alt ?? asset.title)}" loading="lazy"${image.width ? ` width="${image.width}" height="${image.height}"` : ''}></a><p>${esc(asset.title)}<small>${esc(asset.attribution ?? '')}${asset.license_name ? `・${esc(asset.license_name)}` : ''}・素材 ${esc(asset.id)}</small></p></li>`;
  }).join('')}</ul><p class="atl-note">照片是拍攝當時的外觀，只作地方脈絡，不是工程進度或成果的證明。</p></section>`;
}

export function detailHtml(model, project, { favorites, scaleMax, art = [], hasSite = false, sceneKind = 'overview' }) {
  const fav = favorites.has(project.id);
  const located = project.locationState === 'located';
  return `<header class="atl-detail-head">
      <p class="atl-eyebrow">${esc(project.regionName)}／${esc(project.topicName)}</p>
      <h2 id="atlasDetailTitle" tabindex="-1">${esc(project.title)}</h2>
      <p class="atl-agency">${esc(project.agency)}</p>
      <div class="atl-detail-tools">
        <button type="button" class="atl-fav atl-fav-wide" data-favorite="${esc(project.id)}" aria-pressed="${fav}"><span aria-hidden="true">${fav ? '★' : '☆'}</span>${fav ? '已收藏' : '收藏'}</button>
        <button type="button" data-share="${esc(project.id)}">分享這個位置</button>
        ${located ? `<button type="button" data-locate="${esc(project.id)}">在地圖上置中</button>` : ''}
        ${hasSite ? `<button type="button" data-site="${esc(project.id)}" aria-pressed="${sceneKind === 'site'}">${sceneKind === 'site' ? '回到地區圖' : '看現地沙盤'}</button>` : ''}
      </div>
      <p class="atl-share-out" data-share-out role="status" aria-live="polite"></p>
    </header>
    <p class="atl-summary">${esc(project.summary)}</p>
    <section class="atl-block"><h3>位置 ${precisionBadge(project)}</h3>${locationHtml(model, project)}</section>
    <section class="atl-block"><h3>走到哪個階段</h3>
      <p class="atl-phase"><b>${esc(project.phase.label)}</b><small>案卷階段紀錄日期：${esc(formatDate(project.phase.asOf))}</small></p>
      ${railHtml(model, project)}
    </section>
    <section class="atl-block"><h3>工程進度</h3>${progressHtml(model, project)}${project.target ? `<p class="atl-note">${esc(project.target.label)}。這是來源所列期程，不是完工紀錄。</p>` : ''}</section>
    <section class="atl-block"><h3>經費</h3>${budgetHtml(model, project, scaleMax)}</section>
    ${project.facts.length ? `<section class="atl-block"><h3>來源記載的規模</h3><dl class="atl-facts">${project.facts.map((fact) => `<div><dt>${esc(fact.label)}</dt><dd>${esc(fact.text)}<small>${sourceLink(model, fact.source_id, '原文')}</small></dd></div>`).join('')}</dl></section>` : ''}
    <section class="atl-block"><h3>紀錄時間</h3>${eventsHtml(model, project)}</section>
    ${relationsHtml(model, project)}
    ${artHtml(art)}
    <section class="atl-block"><h3>本站還缺的證據</h3><ul class="atl-plain">${project.missingEvidence.map((text) => `<li>${esc(text)}</li>`).join('')}</ul><p class="atl-note">待補表示本站尚未收錄，不代表機關沒有公開。</p></section>
    <section class="atl-block"><h3>這張卡引用的來源</h3>${sourcesHtml(model, project)}<p class="atl-note">本站案卷查閱日 ${esc(formatDate(model.reviewedAt))}；位置查核日 ${esc(formatDate(model.locationsReviewedAt))}。這些是查閱日期，不是工程或資料的更新日期。</p></section>`;
}

export const detailEmptyHtml = (model, counts) => `<div class="atl-detail-empty"><h2 id="atlasDetailTitle">點一支圖釘，或從列表選一個案卷</h2><p>來源卡會列出位置依據、七個階段各自的紀錄、經費與原文連結。</p><dl class="atl-facts"><div><dt>已定位</dt><dd class="atl-num">${counts.located} 案</dd></div><div><dt>待定位</dt><dd class="atl-num">${counts.pending} 案</dd></div></dl><p class="atl-note">${esc(model.locationScopeNote ?? model.scopeNote ?? '')}</p></div>`;

// ---- 時間軸 ----

export function timelineHtml(model, projects, selectedId) {
  const range = timelineRange(projects);
  if (!range) return '<p class="atl-note">目前篩選結果沒有可排上時間軸的紀錄。</p>';
  const span = range.end - range.start;
  const at = (ms) => ((ms - range.start) / span) * 100;
  const years = range.years.map((year) => `<span class="atl-tl-year" style="left:${at(Date.UTC(year, 0, 1)).toFixed(3)}%">${year}</span>`).join('');
  const reviewed = model.locationsReviewedAt ?? model.reviewedAt;
  const reviewedMs = reviewed ? Date.parse(`${reviewed}T00:00:00Z`) : NaN;
  const rows = projects.map((project) => {
    const items = timelineItems(project).map((item) => {
      const left = at(item.start);
      const width = at(item.end) - left;
      const kind = item.kind === 'target' ? '機關目標，尚未發生' : item.kind === 'record' ? '其他程序紀錄' : '案卷紀錄';
      return `<button type="button" class="atl-tl-item" data-kind="${item.kind}" data-precision="${esc(item.precision)}" data-select="${esc(project.id)}" style="left:${left.toFixed(3)}%;--span:${width.toFixed(3)}%" aria-label="${esc(`${formatDate(item.date, item.precision)}　${project.title}　${kind}：${item.label}`)}" title="${esc(`${formatDate(item.date, item.precision)}｜${item.label}`)}"><i aria-hidden="true"></i></button>`;
    }).join('');
    return `<div class="atl-tl-row"${project.id === selectedId ? ' data-selected=""' : ''}><p class="atl-tl-name">${esc(project.title)}</p><div class="atl-tl-track">${items}</div></div>`;
  }).join('');
  const marker = Number.isFinite(reviewedMs) && reviewedMs >= range.start && reviewedMs <= range.end ? `<span class="atl-tl-now" style="left:${at(reviewedMs).toFixed(3)}%"><em>本站查閱日 ${esc(formatDate(reviewed))}</em></span>` : '';
  return `<div class="atl-tl-scroll" tabindex="0" role="group" aria-label="時間軸，可左右捲動"><div class="atl-tl" style="--years:${range.years.length}"><div class="atl-tl-axis" aria-hidden="true">${years}${marker}</div>${rows}</div></div>
    <ul class="atl-tl-legend"><li><i data-kind="event" data-precision="day"></i>案卷紀錄（有日期）</li><li><i data-kind="event" data-precision="month"></i>只到月份的紀錄</li><li><i data-kind="record" data-precision="day"></i>其他程序紀錄</li><li><i data-kind="target" data-precision="month"></i>機關目標，尚未發生</li></ul>`;
}

// ---- 待定位 ----

export function pendingHtml(model, projects) {
  if (model.layers.locations.status !== 'ok') return '<p class="atl-note" role="status">位置資料檔沒有載入，無法列出待定位清單。這不代表所有案卷都已定位。</p>';
  const pending = projects.filter((project) => project.locationState === 'pending' || project.locationState === 'unchecked');
  if (!pending.length) return '<p class="atl-note">目前的案卷都有可核對座標。</p>';
  return `<ul class="atl-pending">${pending.map((project) => {
    const location = project.location;
    return `<li><p class="atl-eyebrow">${esc(project.regionName)}／${esc(project.topicName)}</p><h3>${esc(project.title)}</h3>
      ${location ? `<blockquote class="atl-quote">${esc(location.location_text)}</blockquote><p><b>沒有畫在地圖上的原因</b>　${esc(location.pending.reason)}</p><p><b>下一步</b>　${esc(location.pending.next_step)}</p>` : '<p>還沒有做位置查核。</p>'}
      <button type="button" data-select="${esc(project.id)}">看這個案卷的來源卡</button></li>`;
  }).join('')}</ul>`;
}

// ---- 資料缺口與來源 ----

export function gapsHtml(model) {
  const parts = [];
  if (model.gaps.length) {
    const fatal = model.gaps.some((gap) => gap.required);
    parts.push(`<h2>有 ${model.gaps.length} 個資料檔沒有載入</h2><ul>${model.gaps.map((gap) => `<li><b>${esc(gap.label)}</b>（${esc(gap.path)}）：${esc(gap.message)}。${gapEffect(gap.layer)}</li>`).join('')}</ul><p>${fatal ? '必要的資料沒有載入，下面沒有任何案卷內容。' : '下面顯示的是部分資料，不是完整結果。'}</p><button type="button" data-retry>重新讀取</button>`);
  }
  for (const text of model.stale ?? []) parts.push(`<p>${esc(text)}</p>`);
  return parts.join('');
}

function gapEffect(layer) {
  return {
    locations: '所有案卷的位置與待定位清單都無法顯示',
    stages: '七階段對照、階段篩選與圖釘上的階段字無法顯示',
    regions: '縣市外框無法顯示',
    districts: '鄉鎮市區界線無法顯示，地圖只剩縣市外框',
    scope: '立體視角的側壁可能不完整',
    neighbors: '周邊縣市底圖無法顯示',
    land: '陸地底層無法顯示',
    governance: '案卷內容無法顯示',
    registry: '來源目錄無法顯示',
  }[layer] ?? '相關內容無法顯示';
}

export function coordinateSourcesHtml(model) {
  const file = model.layers.locations.data;
  if (!file) return '<li class="atl-note">位置資料檔沒有載入。</li>';
  return file.sources.map((source) => `<li>${link(source.url, source.name)}<small>${esc(source.publisher)}・本站查閱 ${esc(formatDate(source.checked_at))}</small></li>`).join('');
}

export function regionArtHtml(assets) {
  if (!assets.length) return '';
  return `<h3>地區實景（美術庫）</h3><ul class="atl-art">${assets.map((asset) => {
    const image = artImage(asset);
    return `<li><a href="${esc(image.full)}" target="_blank" rel="noopener"><img src="${esc(image.thumb)}" alt="${esc(asset.alt ?? asset.title)}" loading="lazy"${image.width ? ` width="${image.width}" height="${image.height}"` : ''}></a><p>${esc(asset.title)}<small>${esc(asset.attribution ?? '')}・素材 ${esc(asset.id)}</small></p></li>`;
  }).join('')}</ul><p class="atl-note">實景照片只作地方脈絡，不是任何工程的進度證明。</p>`;
}
