// Dynamic strings pass through esc() before innerHTML.
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
const ORDER = [
  ["wu", "吳旭智"],
  ["chiu", "邱臣遠"],
  ["chen", "陳見賢"],
  ["xu", "徐欣瑩"],
  ["zheng", "鄭朝方"],
];
async function load(path) {
  const res = await fetch(path + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error(path);
  return res.json();
}
function paint(stats, latest) {
  const box = document.getElementById("liveRefresh");
  if (!box) return;
  const by = (stats && stats.by_person) || {};
  const cards = ORDER.map(([id, name]) => {
    const row = by[id] || {};
    return `<a class="extra-card" href="/person.html?id=${id}"><strong>${esc(name)}</strong><span>近 24 小時 ${Number(row.last_24h) || 0} 筆</span><em>近 7 日 ${Number(row.last_7d) || 0} 筆</em></a>`;
  }).join("");
  const rows = (Array.isArray(latest) ? latest : []).slice(0, 8).map((row) => {
    const href = String(row.url || "");
    const title = esc(row.title || "");
    const link = href.startsWith("http")
      ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(row.person || "")}｜${title}</a>`
      : esc(row.person || "");
    return `<li>${link}<div class="muted">${esc(String(row.published_at || "").slice(0, 16).replace("T", " "))} ${esc(row.source_name || "")}</div></li>`;
  }).join("");
  const when = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  box.innerHTML = `<p class="muted">五人數字每分鐘重讀。新資料約每 10 分鐘補上。這次讀取 ${esc(when)}。</p><div class="extra-people">${cards}</div><ul class="timeline">${rows}</ul>`;
}
async function tick() {
  try {
    const [stats, latest] = await Promise.all([load("/data/stats.json"), load("/data/latest.json")]);
    paint(stats, latest);
  } catch (err) {
    const box = document.getElementById("liveRefresh");
    if (box) box.innerHTML = `<p class="muted">這次沒讀到新數字，下一分鐘再試。</p>`;
  }
}
tick();
setInterval(tick, 60000);
