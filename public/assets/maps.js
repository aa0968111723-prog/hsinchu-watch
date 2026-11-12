// Dynamic strings pass through esc() before innerHTML. Markup templates are local.
const PEOPLE = [
  { id: "wu", name: "吳旭智", role: "竹北市長候選人", color: "#9A6212", soft: "#F3E6D0" },
  { id: "xu", name: "徐欣瑩", role: "新竹縣長候選人", color: "#7E3F82", soft: "#EBDCEC" },
  { id: "zheng", name: "鄭朝方", role: "新竹縣長候選人", color: "#374151", soft: "#DCE0E6" },
];
const ISSUES = [
  { id: "transport", name: "交通", color: "#2F6F8F" },
  { id: "industry", name: "科學園區／產業", color: "#6B5B95" },
  { id: "welfare", name: "長照／社福", color: "#A8483A" },
  { id: "education", name: "教育／托育", color: "#3B7D6B" },
  { id: "housing", name: "住宅／房價", color: "#C2A878" },
  { id: "safety", name: "治安", color: "#57534E" },
  { id: "environment", name: "環境／水資源", color: "#5C7A4A" },
  { id: "agriculture", name: "農業", color: "#8A9A4A" },
  { id: "fiscal", name: "財政", color: "#7A6A58" },
  { id: "hakka_indigenous", name: "原鄉／客家", color: "#8A7F98" },
];
const PLACES = [
  ["竹北市", ["竹北"]],
  ["湖口鄉", ["湖口"]],
  ["新豐鄉", ["新豐"]],
  ["竹東鎮", ["竹東"]],
  ["新埔鎮", ["新埔"]],
  ["關西鎮", ["關西"]],
  ["芎林鄉", ["芎林"]],
  ["寶山鄉", ["寶山"]],
  ["北埔鄉", ["北埔"]],
  ["峨眉鄉", ["峨眉"]],
  ["橫山鄉", ["橫山"]],
  ["尖石鄉", ["尖石"]],
  ["五峰鄉", ["五峰"]],
];
const SHAPES = [
  { name: "新豐鄉", keys: ["新豐"], pts: [[40,36],[168,24],[176,132],[46,146]] },
  { name: "湖口鄉", keys: ["湖口"], pts: [[176,24],[312,18],[320,126],[176,132]] },
  { name: "新埔鎮", keys: ["新埔"], pts: [[320,18],[452,22],[448,124],[320,126]] },
  { name: "關西鎮", keys: ["關西"], pts: [[452,22],[578,36],[562,136],[448,124]] },
  { name: "尖石鄉", keys: ["尖石"], pts: [[562,136],[720,78],[760,268],[574,292]] },
  { name: "竹北市", keys: ["竹北"], pts: [[32,156],[176,142],[184,304],[36,318]] },
  { name: "芎林鄉", keys: ["芎林"], pts: [[184,142],[328,132],[336,298],[184,304]] },
  { name: "竹東鎮", keys: ["竹東"], pts: [[168,318],[352,304],[360,462],[160,472]] },
  { name: "橫山鄉", keys: ["橫山"], pts: [[360,304],[574,292],[560,462],[360,462]] },
  { name: "五峰鄉", keys: ["五峰"], pts: [[360,472],[560,462],[590,656],[338,676]] },
  { name: "寶山鄉", keys: ["寶山"], pts: [[160,482],[338,472],[326,588],[148,578]] },
  { name: "北埔鄉", keys: ["北埔"], pts: [[148,588],[326,588],[300,708],[128,694]] },
  { name: "峨眉鄉", keys: ["峨眉"], pts: [[28,488],[148,482],[128,694],[22,660]] },
];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function clip(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}
async function load(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(path);
  return res.json();
}
function person(id) {
  return PEOPLE.find((p) => p.id === id);
}
function blob(row) {
  return `${row.title || ""} ${row.summary || ""} ${row.quote || ""}`;
}
function mentions(text, keys) {
  return keys.some((k) => text.includes(k));
}
function cell(p, hit) {
  const style = `border-color:${p.color};background:${hit ? p.soft : "#fff"}`;
  if (!hit) {
    return `<article class="map-cell is-empty" style="${style}" data-person="${p.id}">
      <strong>${esc(p.name)}</strong>
      <p>尚未找到公開表態</p>
    </article>`;
  }
  const href = hit.source_url || hit.url || "";
  const link = href.startsWith("http")
    ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(hit.source_name || "來源")}</a>`
    : "";
  return `<article class="map-cell" style="${style}" data-person="${p.id}">
    <strong>${esc(p.name)}</strong>
    <p>${esc(clip(hit.summary || hit.quote || hit.title, 42))}</p>
    <p>${esc(String(hit.published_at || "").slice(0, 10))} ${link}</p>
  </article>`;
}
function legend() {
  const people = PEOPLE.map((p) =>
    `<span><i class="map-swatch" style="background:${p.color}"></i>${esc(p.name)}</span>
     <span><i class="map-swatch is-empty" style="border-color:${p.color}"></i>${esc(p.name)}尚未找到</span>`
  ).join("");
  const issues = ISSUES.map((i) =>
    `<span><i class="map-swatch" style="background:${i.color}"></i>${esc(i.name)}</span>`
  ).join("");
  return `<div class="map-legend" aria-label="顏色對照">${people}${issues}</div>
    <p class="map-note">色塊與比較頁相同：吳赭、徐梅、鄭石墨。十個議題色在政績地圖與政見地圖用同一套。每一列都有三人的格子；沒有公開來源的格子仍留著，寫「尚未找到公開表態」，不留白、不推測。</p>`;
}
function issueRows(pick) {
  return ISSUES.map((issue) => {
    const cells = PEOPLE.map((p) => cell(p, pick(issue, p))).join("");
    return `<div class="map-row">
      <div class="map-issue"><i style="background:${issue.color}"></i>${esc(issue.name)}</div>
      <div class="map-cells">${cells}</div>
    </div>`;
  }).join("");
}
function placeCards(rows, kind) {
  return PLACES.map(([name, keys]) => {
    const blocks = PEOPLE.map((p) => {
      const hit = rows.find((r) =>
        r.person_id === p.id &&
        (kind === "any" || r.kind === kind) &&
        mentions(blob(r), keys)
      );
      return cell(p, hit || null);
    }).join("");
    return `<article class="place-card"><h3>${esc(name)}</h3><div class="map-cells">${blocks}</div></article>`;
  }).join("");
}
function centroid(pts) {
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [x, y];
}
function visualMap(rows, kind) {
  const sea = `<text x="18" y="250" class="sea" transform="rotate(-90 18 250)">台灣海峽</text>`;
  const hill = `<text x="700" y="40" class="hill">山區</text>`;
  const land = SHAPES.map((shape) => {
    const d = shape.pts.map((p) => p.join(",")).join(" ");
    const [cx, cy] = centroid(shape.pts);
    const strips = PEOPLE.map((p, i) => {
      const hit = (rows || []).find((r) =>
        r.person_id === p.id &&
        (kind === "any" || r.kind === kind) &&
        mentions(blob(r), shape.keys)
      );
      const x = cx - 27 + i * 18;
      const y = cy + 8;
      const fill = hit ? p.color : "#fff";
      const dash = hit ? "" : `stroke="${p.color}" stroke-width="1.6" stroke-dasharray="2 2"`;
      const label = hit ? `${p.name}有公開${kind === "record" ? "政績" : "政見"}` : `${p.name}尚未找到公開表態`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="16" height="10" rx="2" fill="${fill}" ${dash}><title>${esc(label)}</title></rect>`;
    }).join("");
    return `<g class="town">
      <polygon points="${d}"><title>${esc(shape.name)}</title></polygon>
      <text x="${cx.toFixed(1)}" y="${(cy - 6).toFixed(1)}">${esc(shape.name.replace(/[市鄉鎮]$/, ""))}</text>
      ${strips}
    </g>`;
  }).join("");
  return `<svg class="county" viewBox="0 0 790 730" role="img" aria-label="新竹縣十三鄉鎮示意地圖">
    <rect class="paper" x="0" y="0" width="790" height="730" rx="16"></rect>
    ${sea}${hill}${land}
  </svg>`;
}
function questions(rows) {
  return PEOPLE.map((p) => {
    const list = rows.filter((r) => r.person_id === p.id && blob(r).includes("質詢"));
    const items = list.length
      ? list.slice(0, 12).map((r) => {
          const href = r.source_url || r.url || "";
          const link = href.startsWith("http")
            ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(r.source_name || "來源")}</a>`
            : "";
          return `<li class="q-item" style="border-left-color:${p.color}">
            <strong>${esc(clip(r.title, 48))}</strong>
            <p>${esc(String(r.published_at || "").slice(0, 10))} ${link}</p>
          </li>`;
        }).join("")
      : `<li class="q-item is-empty" style="border-left-color:${p.color}"><p>尚未找到公開質詢紀錄</p></li>`;
    return `<section class="q-col"><h3><i class="map-swatch" style="background:${p.color}"></i>${esc(p.name)}</h3><ul class="q-list">${items}</ul></section>`;
  }).join("");
}

async function main() {
  const [stances, policies, items] = await Promise.all([
    load("/data/issue_stances.json"),
    load("/data/policies.json"),
    load("/data/items.json"),
  ]);
  const stanceOf = (issueId, pid) => {
    const issue = (stances.issues || []).find((x) => x.id === issueId);
    const hit = issue && issue.stances && issue.stances[pid];
    return hit && hit.found ? hit : null;
  };
  const recordOf = (issue, p) =>
    (policies || []).find((r) => r.person_id === p.id && r.kind === "record" && (r.issues || []).includes(issue.id)) || null;
  document.getElementById("legend").innerHTML = legend();
  document.getElementById("recordMap").innerHTML = issueRows(recordOf);
  document.getElementById("policyMap").innerHTML = issueRows((issue, p) => stanceOf(issue.id, p.id));
  document.getElementById("recordVisual").innerHTML = visualMap(policies || [], "record");
  document.getElementById("policyVisual").innerHTML = visualMap(policies || [], "policy");
  document.getElementById("recordPlaces").innerHTML = placeCards(policies || [], "record");
  document.getElementById("policyPlaces").innerHTML = placeCards(policies || [], "policy");
  const qrows = [...(policies || []), ...(items || [])];
  document.getElementById("questions").innerHTML = questions(qrows);
  const box = document.getElementById("statusBox");
  if (box) box.textContent = "色塊 3 人 × 10 議題，格子齊";
}
main().catch((err) => {
  const box = document.getElementById("statusBox");
  if (box) box.textContent = "地圖資料沒載入";
  console.error(err);
});
