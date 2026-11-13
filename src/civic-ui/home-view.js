/** The home reading desk: what the site holds, by kind, and a first look at the
 *  chosen kind. Used by index.html and by the preview page, so both show the
 *  same thing. Every list here is a short look; the archive page has all of it.
 */
import { isPollBlackout } from "../lib/data.js";
import { sanitizeItem } from "../lib/live-update/sanitize.js";
import { ARCHIVE_SUMMARY } from "./archive-summary.mjs";
import { kindsOf, mountDesk } from "./desk.js";
import { dateLabel, escapeHtml, formatCount, originOf, rosterOrder, safeHref, summaryIsStale } from "./model.mjs";

const cache = new Map();
export function readJson(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path, { headers: { Accept: "application/json" } }).then((response) => {
      if (!response.ok) throw new Error(`${path} 沒有載入（HTTP ${response.status}）`);
      return response.json();
    }).catch((error) => { cache.delete(path); throw error; }));
  }
  return cache.get(path);
}

const tag = (origin, text) => `<span class="civic-tag civic-tone-${origin.tone}">${escapeHtml(text || origin.label)}</span>`;
const link = (url, text) => {
  const href = safeHref(url);
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>` : escapeHtml(text);
};
const newest = (rows, key) => [...rows].sort((a, b) => String(key(b) || "").localeCompare(String(key(a) || "")));
const item = (kind, record, title, meta, body = "") => `<li>
  <div class="civic-tags">${tag(originOf(kind, record))}</div>
  <p class="civic-row-title">${title}</p>
  <p class="civic-meta">${meta}</p>${body ? `<p class="civic-row-text">${body}</p>` : ""}</li>`;

/** How each kind's first look is fetched and worded. `heavy` kinds wait for a press. */
const LOOKS = {
  news: {
    path: "/data/latest.json",
    note: "最新收錄的報導與公開貼文。收錄不等於查核，內容以原文為準。",
    rows: (data) => newest(data.map(sanitizeItem).filter((row) => row?.title && (row.review_status ?? "ok") === "ok"), (row) => row.published_at)
      .slice(0, 4).map((row) => item("news", row, link(row.url, row.title),
        `${escapeHtml(row.source_name || "來源未標示")}・發布 ${dateLabel(row.published_at)}`)),
  },
  source: {
    path: "/observations/sources.json", heavy: "約 1.9 MB",
    note: "公開來源索引只記錄標題、網址與日期，不是內文查核。",
    rows: (data) => newest(data.entries || [], (row) => row.date).slice(0, 4).map((row) => item("source", row,
      link(row.url, row.title), `${escapeHtml(row.source || "來源未標示")}・索引日期 ${dateLabel(row.date)}`)),
  },
  policy: {
    path: "/data/policies.json", heavy: "約 1.3 MB",
    note: "政策條目是既有整理；成效數字未經本站獨立查核。",
    rows: (data) => newest(data, (row) => row.published_at).slice(0, 4).map((row) => item("policy", row,
      link(row.source_url || row.url, row.title),
      `${escapeHtml(row.source_name || "來源未標示")}・發布 ${dateLabel(row.published_at, row.date_precision)}`,
      escapeHtml(row.summary || ""))),
  },
  poll: {
    path: "/data/polls.json",
    note: "這裡只列調查機構與期間。支持度數字只在民調頁顯示，而且只顯示逐筆核對過的。",
    rows: (data) => newest(data, (row) => row.published_at).slice(0, 4).map((row) => item("poll", row,
      escapeHtml(`${row.org || "機構未標示"}・${row.race_label || "選區未標示"}`),
      `調查期間 ${escapeHtml(row.period || "未標示")}・${row.verified === true && !row.numbers_hidden ? "數字已逐筆核對" : "數字尚未核對，不顯示"}`)),
  },
  comment: {
    path: "/observations/comments.json",
    note: "匿名留言只保留整理後的觀點，不顯示帳號。留言不是民調，也不是查核。",
    rows: (data) => newest(data.entries || [], (row) => row.at).slice(0, 4).map((row) => item("comment", row,
      escapeHtml(row.summary || "未整理"),
      `${escapeHtml(data.threads?.[row.thread]?.platform || "平台未標示")}・留言時間 ${dateLabel(row.at)}`)),
  },
  stance: {
    path: "/data/issue_stances.json",
    note: "立場摘錄來自既有報導。沒有摘錄只代表本站還沒收錄，不代表沒有立場。",
    rows: (data) => [...(data.issues || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, 4).map((issue) => {
      const found = Object.values(issue.stances || {}).filter((stance) => stance.found).length;
      return item("stance", {}, escapeHtml(issue.name), `已收錄 ${found} 則立場摘錄`, escapeHtml(issue.blurb || ""));
    }),
  },
  official: {
    path: "/data/official.json",
    note: "本人或機關自己的發言，屬於主張，不是查核結果。",
    rows: (data) => newest(Object.values(data.by_person || {}).flatMap((person) => person.items || []).map(sanitizeItem), (row) => row.published_at)
      .slice(0, 4).map((row) => item("official", row, link(row.url, row.title),
        `${escapeHtml(row.display_label || row.source_name || "來源未標示")}・發布 ${dateLabel(row.published_at)}`)),
  },
  monitor: {
    path: "/data/news-monitor/manual.json",
    note: "新加入、還沒逐筆核對原文的來源。人物關聯只依標題文字，日期也待核對。",
    rows: (data) => newest(data.articles || [], (row) => row.reported_publication_time).slice(0, 4).map((row) => item("monitor", row,
      link(row.url, row.title), `${escapeHtml(row.publisher || "來源未標示")}・索引所載時間 ${escapeHtml(row.reported_publication_time || "未標示")}`)),
  },
  governance: {
    path: "/data/governance.json",
    note: "案卷依機關公開紀錄整理。機關發布不等於已獨立查核。",
    rows: (data) => (data.projects || []).map((row) => item("governance", row,
      `<a href="/governance.html#${escapeHtml(row.id)}">${escapeHtml(row.title)}</a>`,
      `${escapeHtml(row.agency || "機關未標示")}・${escapeHtml(row.phase_label || "階段未標示")}`)),
  },
};

export function mountHome(root, { fig = "圖 1", tour = false } = {}) {
  const blackout = isPollBlackout();
  const view = blackout ? ARCHIVE_SUMMARY.blackout : ARCHIVE_SUMMARY.open;
  const kinds = kindsOf(ARCHIVE_SUMMARY);
  const deskHost = root.querySelector("[data-desk]");
  const look = root.querySelector("[data-look]");
  const stale = root.querySelector("[data-stale]");
  const max = Math.max(...Object.values(ARCHIVE_SUMMARY.open.counts));

  async function show(row, { load = false } = {}) {
    const spec = LOOKS[row.id];
    const more = `<p><a class="civic-btn" href="/archive.html?kind=${encodeURIComponent(row.id)}">到完整資料看全部 ${formatCount(row.count)} 筆</a></p>`;
    const head = `<h3 class="civic-h3" tabindex="-1">${escapeHtml(row.label)}</h3><p class="civic-note">${escapeHtml(spec.note)}</p>`;
    if (row.id === "poll" && blackout) {
      look.innerHTML = `${head}<p class="civic-gapnote">封關期間不載入民調檔，也不顯示民調相關內容。</p>`;
      return;
    }
    if (spec.heavy && !load) {
      look.innerHTML = `${head}<p><button type="button" class="civic-btn" data-load="${escapeHtml(row.id)}">載入最新 4 筆（${spec.heavy}）</button></p>${more}`;
      return;
    }
    look.innerHTML = `${head}<p class="civic-meta" role="status">讀取中。</p>`;
    try {
      const rows = spec.rows(await readJson(spec.path));
      if (desk.chosen().id !== row.id) return;
      look.innerHTML = `${head}${rows.length ? `<ol class="civic-list">${rows.join("")}</ol>` : `<p class="civic-meta">這一種目前沒有可列出的紀錄。</p>`}${more}`;
    } catch (error) {
      if (desk.chosen().id !== row.id) return;
      look.innerHTML = `${head}<p class="civic-gapnote" role="alert">${escapeHtml(error.message)}。這是讀取缺口，不代表沒有資料。</p>${more}`;
    }
  }

  const desk = mountDesk(deskHost, {
    kinds,
    counts: view.counts,
    max,
    fig,
    tour,
    caption: `紙疊高度按筆數等比例畫，最高那一疊是 ${formatCount(max)} 筆；後牆每一格是它的一成。少到畫不出厚度的種類只放一張紙，數字看讀數或數字表。這是筆數，不是不重複文章數，也不代表重要性。`,
    note: `筆數統計自 ${dateLabel(ARCHIVE_SUMMARY.counted_at)} 的已發布資料，合計 ${formatCount(view.total)} 筆${blackout ? `；封關期間另有 ${formatCount(view.held)} 筆民調相關紀錄暫不顯示` : ""}。`,
    onChoose: (row) => { void show(row); },
  });
  look.addEventListener("click", (event) => {
    const button = event.target.closest("[data-load]");
    if (!button) return;
    void show(desk.chosen(), { load: true }).then(() => look.querySelector("h3")?.focus());
  });
  void show(desk.chosen());

  // The counts were taken from a named snapshot. Say so when the site has moved on.
  readJson("/data/manifest.json").then((manifest) => {
    if (stale && summaryIsStale(ARCHIVE_SUMMARY, manifest)) {
      stale.hidden = false;
      stale.textContent = "資料快照已經更新，上面的筆數是前一版統計，等待重新計算。最新筆數請看完整資料頁。";
    }
  }).catch(() => {
    if (stale) {
      stale.hidden = false;
      stale.textContent = "無法確認筆數是否對應目前的資料快照（快照目錄沒有載入）。";
    }
  });

  void fillDoors(root, view.total);
  return desk;
}

/** Real figures on the workspace doors. A failed read leaves the dash. */
async function fillDoors(root, total) {
  const set = (name, value) => {
    const node = root.querySelector(`[data-door="${name}"] b`);
    if (node) node.textContent = value;
  };
  set("archive", formatCount(total));
  readJson("/data/governance.json").then((data) => set("governance", formatCount(data.projects.length))).catch(() => {});
  readJson("/data/candidate-review.json").then((data) => {
    set("candidates", formatCount(data.candidates.length));
    const about = root.querySelector("[data-door-about=\"candidates\"]");
    if (!about) return;
    const order = rosterOrder(data);
    about.textContent = `${data.races.map((race) => `${race.name}：${order.filter((person) => person.race_id === race.id).map((person) => person.name).join("、")}`).join("；")}。依選委會號次排列。`;
  }).catch(() => {});
}
