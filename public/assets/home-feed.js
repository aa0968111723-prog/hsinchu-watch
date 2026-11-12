// Dynamic strings pass through esc() before innerHTML.
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
async function load(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(path);
  return res.json();
}
async function main() {
  const [latest, man] = await Promise.all([
    load("/data/latest.json"),
    load("/data/manifest.json"),
  ]);
  const rows = Array.isArray(latest) ? latest : [];
  const feed = document.getElementById("feed");
  if (feed) {
    feed.innerHTML = rows.slice(0, 24).map((r) => {
      const href = String(r.url || "");
      const link = href.startsWith("http")
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(r.person || "")}｜${esc(r.title || "")}</a>`
        : esc(r.title || "");
      const when = String(r.published_at || "").slice(0, 16).replace("T", " ");
      return `<li>${link}<div class="muted">${esc(when)} ${esc(r.source_name || "")} ${esc(r.sentiment_reason || "")}</div></li>`;
    }).join("") || "<li class=\"muted\">目前沒有最新列表</li>";
  }
  const note = document.getElementById("pendingNote");
  const n = man && man.counts ? man.counts.items_rows : "";
  if (note) note.textContent = `站上新聞 ${n} 筆。請開 https://hsinchu-watch.pages.dev ，網址結尾不要加點。`;
}
main().catch(() => {
  const feed = document.getElementById("feed");
  if (feed) feed.innerHTML = "<li class=\"muted\">最新列表沒載入，請重新整理</li>";
});
