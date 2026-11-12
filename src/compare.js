/**
 * 三人並列比較頁：時段聲量、官網／X、政績政見、已核對民調、主題對照。
 * 等權重；只讀公開 JSON；民調僅 verified 且非 numbers_hidden。
 */
import { loadJSON, escapeHtml, safeHref, isPollBlackout, POLL_NUMBERS_ENABLED, startLiveReload, footerHTML } from './lib/data.js';
import './lib/mobile-nav.js'
import {updateCandidateReview} from './candidate-review.js';
import { PERSON_ORDER, PERSON_META, PERSON_STYLE, avatarHTML, installImageFallback } from './lib/charts.js';
import { coverageCount, coverageTime } from './lib/coverage.js';

const ORDER = PERSON_ORDER;
const META = PERSON_META;

const $ = (id) => document.getElementById(id);
const WINDOW_LABELS = { h24: '近 24 小時', d7: '近 7 日', d30: '近 30 日' };
let selectedWindow = 'h24';
let selectedRace = 'county_magistrate';
let current;
const raceNames = { county_magistrate: '新竹縣長', zhubei_mayor: '竹北市長' };
const activePeople = () => ORDER.filter(id => META[id].role.startsWith(raceNames[selectedRace]));

function ageSec(iso, nowMs) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (nowMs - t) / 1000;
}

function inWindow(iso, nowMs, sec) {
  const a = ageSec(iso, nowMs);
  return a != null && a >= 0 && a <= sec;
}

function countByPlatform(items, plat) {
  return items.filter((i) => String(i.platform || '') === plat).length;
}

function newsLike(i) {
  const p = String(i.platform || '');
  return p === 'news' || p === 'commentary' || p === 'ptt' || p === 'gov' || p === 'party' || p === 'council';
}

function buildPersonWindow(items, officialItems, nowMs) {
  const windows = {
    h24: 86400,
    d7: 7 * 86400,
    d30: 30 * 86400,
  };
  const out = {};
  for (const [key, sec] of Object.entries(windows)) {
    const sub = items.filter((i) => inWindow(i.published_at || i.collected_at, nowMs, sec));
    const off = officialItems.filter((i) => inWindow(i.published_at || i.collected_at, nowMs, sec));
    out[key] = {
      news: sub.filter(newsLike).length,
      official: off.length || sub.filter((i) => i.is_own_speech || i.platform === 'website').length,
      x: countByPlatform(sub, 'x') + countByPlatform(sub, 'twitter'),
    };
  }
  return out;
}

function barGroup(label, values, max) {
  const rows = activePeople().map((id) => {
    const v = values[id] || 0;
    const pct = (v / max) * 100;
    return `<li class="cmp-bar-row">
      <span>${escapeHtml(META[id].name)}</span>
      <span class="cmp-meter" aria-hidden="true"><i style="--bar:${PERSON_STYLE[id].color};--value:${pct}%"></i></span>
      <b>${v}</b>
    </li>`;
  }).join('');
  return `<div class="cmp-bar-group"><h4>${label}</h4><ul>${rows}</ul></div>`;
}

function renderWindowBars(bundle, windowKey) {
  const el = $('windowBars');
  if (!el) return;
  if (!$('cmpBars')) {
    const tabs = Object.entries(WINDOW_LABELS).map(([key, label]) =>
      `<button type="button" data-win="${key}" aria-pressed="false" aria-controls="cmpBars">${label}</button>`
    ).join('');
    el.innerHTML = `<h2>來源分類</h2>
      <div class="cmp-window-tabs" role="group" aria-label="聲量統計期間">${tabs}</div>
      <p id="cmpScale" class="cmp-scale fine muted" role="status"></p>
      <div id="cmpBars" class="cmp-bars"></div>`;
  }
  const groups = [['新聞、評論與論壇等', 'news'], ['官網發言', 'official'], ['X 提及', 'x']].map(([label, key]) =>
    [label, Object.fromEntries(activePeople().map(id => [id, bundle[id]?.[windowKey]?.[key] || 0]))]
  );
  const max = Math.max(1, ...groups.flatMap(([, values]) => Object.values(values)));
  $('cmpScale').textContent = `${WINDOW_LABELS[windowKey]} · 共用 0–${max} 件刻度。各類依來源檔案分列，可能重疊。`;
  $('cmpBars').innerHTML = groups.map(([label, values]) => barGroup(label, values, max)).join('');
  el.querySelectorAll('[data-win]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.win === windowKey));
    button.onclick = () => {
      selectedWindow = button.dataset.win;
      renderWindowBars(bundle, selectedWindow);
    };
  });
}

function policyStats(policies, pid) {
  const list = (policies || []).filter((p) => p.person_id === pid);
  const record = list.filter((p) => p.kind === 'record' || p.type === 'record' || p.kind === '政績').length;
  const policy = list.filter((p) => !(p.kind === 'record' || p.type === 'record' || p.kind === '政績')).length;
  const cont = list.filter((p) => p.controversy);
  const responded = cont.filter((p) => p.responded === true).length;
  const noResp = cont.filter((p) => p.responded === false).length;
  const unk = cont.length - responded - noResp;
  return { total: list.length, record, policy, controversy: cont.length, responded, noResp, unk };
}

function renderMetricCards(stats, policies) {
  const el = $('metricCards');
  if (!el) return;
  el.innerHTML = `<div class="cmp-section-head"><h2>${raceNames[selectedRace]} · 既有統計涵蓋人物</h2><a href="#policyCompare">查看政見明細</a></div>
    <div class="cmp-grid3">${activePeople().map((id) => {
      const st = PERSON_STYLE[id];
      const m = META[id];
      const ps = policyStats(policies, id);
      return `<article class="cmp-card" data-person="${id}" style="--pc:${st.color};--ps:${st.soft}">
        <a class="cmp-person-link" href="/person.html?id=${encodeURIComponent(id)}">${avatarHTML({ id, name: m.name }, 'md')}<h3>${escapeHtml(m.name)}</h3></a>
        <p class="role">${escapeHtml(m.role)}<span>${escapeHtml(m.party)}</span></p>
        <div class="cmp-metrics">
          <div class="cmp-metric"><b data-coverage="last_24h">${coverageCount(stats, id, 'last_24h') ?? '—'}</b><span>24 小時</span></div>
          <div class="cmp-metric"><b data-coverage="last_7d">${coverageCount(stats, id, 'last_7d') ?? '—'}</b><span>近 7 日</span></div>
        </div>
        <p class="cmp-records">政績與政見收錄 ${ps.total} 則</p>
      </article>`;
    }).join('')}</div>
    <p class="fine muted">此區只列既有統計快照涵蓋的人物，並非完整候選人名單；完整六人名單請看上方多面向閱讀。同篇內容可能涉及多人，件數不代表支持度或優劣。</p>`;
}

function renderPolicyCompare(policies) {
  const el = $('policyCompare');
  if (!el) return;
  const rows = activePeople().map((id) => {
    const st = PERSON_STYLE[id];
    const ps = policyStats(policies, id);
    return `<tr>
      <th scope="row"><span class="cmp-swatch" style="background:${st.color}" aria-hidden="true"></span> ${escapeHtml(META[id].name)}</th>
      <td>${ps.record}</td><td>${ps.policy}</td><td>${ps.total}</td>
      <td>${ps.controversy}（來源欄位有載回應 ${ps.responded}／本筆未載 ${ps.noResp}${ps.unk ? `／未標示 ${ps.unk}` : ''}）</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<h2>收錄明細</h2>
    <table class="cmp-table"><thead><tr><th scope="col">候選人</th><th scope="col">施政紀錄條目</th><th scope="col">政策主張條目</th><th scope="col">合計</th><th scope="col">質疑條目（非案件數）</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="fine muted">條數僅描述本站收錄量，不代表施政成效、案件數或優劣。來源未載回應不等於當事人未回應；「施政紀錄」未據此認定為已證實政績。</p>`;
}

function canShowPollNumbers(p) {
  return POLL_NUMBERS_ENABLED && !isPollBlackout() && p.verified === true && !p.numbers_hidden;
}

function renderPolls(polls) {
  const el = $('pollCompare');
  if (!el) return;
  const list = (Array.isArray(polls) ? polls : []).filter(p =>
    (p.race === selectedRace || p.race_label === raceNames[selectedRace]) && canShowPollNumbers(p))
    .sort((a, b) => String(b.field_end || b.published_at || '').localeCompare(String(a.field_end || a.published_at || '')));
  if (!list.length) {
    el.innerHTML = `<h2>已核對民調</h2><p class="cmp-empty">目前沒有可顯示數字的已核對民調。<a href="/polls.html">查看民調頁</a></p>`;
    return;
  }
  function card(p) {
    const support = p.support || {};
    const rows = ORDER.flatMap((id) => {
      const raw = support[id];
      const value = typeof raw === 'string' && raw.trim() ? Number(raw) : raw;
      if (!Number.isFinite(value) || value < 0 || value > 100) return [];
      return `<li class="cmp-bar-row">
        <span>${escapeHtml(META[id].name)}</span>
        <span class="cmp-meter" aria-hidden="true"><i style="--bar:${PERSON_STYLE[id].color};--value:${value}%"></i></span>
        <b>${value}%</b>
      </li>`;
    }).join('');
    const reports = Array.isArray(p.reports) ? p.reports : [];
    const href = safeHref(p.url) || reports.map(report => safeHref(report?.url)).find(Boolean) || safeHref(p.news_url);
    const metadata = [p.period, p.sample_size ? `樣本 ${p.sample_size}` : '', p.moe != null ? `誤差 ±${p.moe}%` : ''].filter(Boolean);
    return `<article class="cmp-poll">
      <h4>${escapeHtml(p.org || '民調機構未標')}</h4>
      ${p.scenario ? `<p class="cmp-poll-scenario">${escapeHtml(p.scenario)}</p>` : ''}
      <p class="meta">${escapeHtml(metadata.join(' · '))}</p>
      ${rows ? `<ul class="cmp-poll-values">${rows}</ul>` : '<p class="muted">無追蹤人物數字</p>'}
      ${href ? `<a class="cmp-source" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">查看民調原文</a>` : ''}
    </article>`;
  }
  const groups = new Map();
  for (const poll of list) {
    const race = poll.race_label || poll.population || '其他選區';
    if (!groups.has(race)) groups.set(race, []);
    groups.get(race).push(poll);
  }
  const expanded = new Set([...el.querySelectorAll('details[open]')].map(detail => detail.dataset.race));
  el.innerHTML = `<div class="cmp-section-head"><h2>已核對民調</h2><a href="/polls.html">查看完整民調</a></div>
    <p class="fine muted">長條共用 0–100% 刻度。先列各選區調查日期最近的一份。</p>
    <div class="cmp-poll-grid">${[...groups].map(([race, rows]) => `<section class="cmp-poll-group">
      <h3>${escapeHtml(race)}</h3>
      ${card(rows[0])}
      ${rows.length > 1 ? `<details class="cmp-fold" data-race="${escapeHtml(race)}"${expanded.has(race) ? ' open' : ''}>
        <summary>較早民調（${rows.length - 1} 份）</summary>
        ${rows.slice(1).map(card).join('')}
      </details>` : ''}
    </section>`).join('')}</div>`;
}

/** 從政見摘要抽主題關鍵字，做三人並列（有來源才列） */
const TOPIC_KEYS = [
  ['交通', /交通|道路|公車|鐵路|高鐵|捷運|停車/],
  ['教育', /教育|學校|幼教|課後|青年/],
  ['住宅', /住宅|住房|社宅|都更|房價/],
  ['產業', /產業|科學園區|竹科|就業|經濟|招商/],
  ['醫療', /醫療|長照|醫院|衛生/],
  ['農業', /農業|客家|農村|休閒農業/],
  ['治安', /治安|警察|防詐|消防/],
  ['環境', /環境|空汙|水利|淹水|環保/],
];

function pickStance(policies, pid, re) {
  const list = (policies || []).filter((p) => p.person_id === pid && (re.test(p.title || '') || re.test(p.summary || '')));
  if (!list.length) return null;
  const pref = list.find((p) => p.kind === 'policy' || p.type === 'policy' || p.kind === '政見') || list[0];
  return pref;
}

function renderTopicStance(policies) {
  const el = $('topicStance');
  if (!el) return;
  const topics = el.querySelectorAll('details');
  const expanded = new Set([...topics].filter(topic => topic.open).map(topic => topic.dataset.topic));
  const blocks = [];
  for (const [topic, re] of TOPIC_KEYS) {
    const cells = activePeople().map((id) => {
      const st = PERSON_STYLE[id];
      const hit = pickStance(policies, id, re);
      if (!hit) {
        return `<div class="cmp-stance-cell" style="--pc:${st.color};--ps:${st.soft}"><div class="nm">${escapeHtml(META[id].name)}</div><span class="cmp-empty">尚無已收錄條目</span></div>`;
      }
      const href = safeHref(hit.source_url) || safeHref(hit.url);
      const sum = String(hit.summary || hit.title || '');
      return `<div class="cmp-stance-cell" style="--pc:${st.color};--ps:${st.soft}">
        <div class="nm">${escapeHtml(META[id].name)}</div>
        <div>${escapeHtml(sum)}</div>
        ${href ? `<a class="cmp-source" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hit.source_name || '查看來源')}</a>` : ''}
      </div>`;
    });
    if (cells.every((c) => c.includes('尚無已收錄'))) continue;
    const open = expanded.has(topic) || (!topics.length && !blocks.length);
    blocks.push(`<details class="cmp-topic cmp-fold" data-topic="${topic}"${open ? ' open' : ''}>
      <summary>${topic}</summary><div class="cmp-stance">${cells.join('')}</div>
    </details>`);
  }
  el.innerHTML = `<h2>政見主題對照</h2>
    ${blocks.length ? `<div class="cmp-topic-grid">${blocks.join('')}</div>` : '<p class="cmp-empty">尚無足夠政見可對照。</p>'}
    <p class="fine muted">同一主題並列已收錄摘要與來源；空白表示本站尚未收錄，不代表沒有政見。</p>`;
}

async function loadPersonItems(id) {
  try {
    const rows = await loadJSON(`/data/items_${id}.json`);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function loadOfficial() {
  try {
    const doc = await loadJSON('/data/official.json');
    return doc?.by_person || {};
  } catch {
    return {};
  }
}

function renderRace() {
  if (!current) return;
  const { stats, bundle, policies, polls } = current;
  void updateCandidateReview(policies, selectedRace, stats.generated_at);
  renderMetricCards(stats, policies);
  renderWindowBars(bundle, selectedWindow);
  renderPolicyCompare(policies);
  renderPolls(polls);
  renderTopicStance(policies);
}

document.querySelector('.cmp-race').addEventListener('click', event => {
  const button = event.target.closest('button[data-race]');
  if (!button || selectedRace === button.dataset.race) return;
  selectedRace = button.dataset.race;
  for (const option of button.parentElement.querySelectorAll('button')) {
    option.setAttribute('aria-pressed', String(option === button));
  }
  renderRace();
});

async function refresh(stats) {
  const cutoff = Date.parse(stats?.generated_at);
  const status = $('statusBox');
  try {
    const [policies, polls, official, ...items] = await Promise.all([
      loadJSON('/data/policies.json').catch(() => []),
      isPollBlackout() ? Promise.resolve([]) : loadJSON('/data/polls.json').catch(() => []),
      loadOfficial(),
      ...ORDER.map(loadPersonItems),
    ]);
    const bundle = Object.fromEntries(ORDER.map((id, index) =>
      [id, buildPersonWindow(items[index], Array.isArray(official[id]?.items) ? official[id].items : [], cutoff)]));
    current = { stats, bundle, policies: Array.isArray(policies) ? policies : [], polls };
    renderRace();
    const gen = stats?.generated_at;
    const edition = coverageTime(stats);
    if (edition) $('cmpEdition').textContent = `統計至 ${edition}（台北），與總覽採用同一份快照。`;
    if (status && !gen) status.textContent = '比較頁已載入';
    const warn = $('delayWarn');
    if (warn && gen) {
      const age = (Date.now() - Date.parse(gen)) / 3600000;
      warn.classList.toggle('hidden', !(age > 1));
    }
    installImageFallback(document);
  } catch (err) {
    if (status) status.textContent = '載入失敗';
    console.error(err);
  }
}

startLiveReload({
  onData({ stats }) {
    if (!stats) return;
    refresh(stats).then(() => {
      const foot = $('footer');
      if (foot && stats) foot.innerHTML = footerHTML(stats);
    });
  },
});
