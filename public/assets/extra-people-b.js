// Dynamic strings pass through esc() before innerHTML.
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
const PEOPLE = [
  { id: "wu", name: "吳旭智", role: "竹北市長候選人" },
  { id: "chiu", name: "邱臣遠", role: "公開報導收錄" },
  { id: "chen", name: "陳見賢", role: "公開報導收錄" },
];
const OPEN = new Set(["chiu", "chen", "wu_zijia"]);
function personId() {
  return new URLSearchParams(location.search).get("id") || "";
}
async function load(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
function card(person, rows) {
  const top = rows[0];
  const title = top ? esc(top.title || "") : "尚無已核對新聞";
  const when = top ? esc(String(top.published_at || "").slice(0, 10)) : "";
  return `<a class="extra-card" href="/person.html?id=${esc(person.id)}">
    <strong>${esc(person.name)}</strong>
    <span>${esc(person.role)} · ${rows.length} 筆</span>
    <em>${when} ${title}</em>
  </a>`;
}
async function paintHome() {
  const box = document.getElementById("extraPeople");
  if (!box) return;
  const packs = await Promise.all(PEOPLE.map(async (person) => [person, await load(`/data/items_${person.id}.json`)]));
  box.innerHTML = packs.map(([person, rows]) => card(person, rows)).join("");
}
function itemLi(row) {
  const href = String(row.url || "");
  const title = esc(row.title || "(無標題)");
  const link = href.startsWith("http")
    ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : title;
  const when = esc(String(row.published_at || "").slice(0, 16).replace("T", " "));
  return `<li>${link}<div class="muted">${when} ${esc(row.source_name || "")} ${esc(row.sentiment_reason || "")}</div></li>`;
}
function stripClosed() {
  document.querySelectorAll("main .warn, main p").forEach((node) => {
    if (node.textContent && node.textContent.includes("此頁不開放")) node.remove();
  });
}
async function paintPerson() {
  const id = personId();
  if (!OPEN.has(id)) return;
  const person = PEOPLE.find((row) => row.id === id) || { id, name: id, role: "公開報導收錄" };
  const rows = await load(`/data/items_${id}.json`);
  const name = document.getElementById("personName");
  const role = document.getElementById("personRole");
  if (name) name.textContent = person.name;
  if (role) role.textContent = `${person.role} · ${rows.length} 筆`;
  document.title = `${person.name}｜新竹觀察`;
  stripClosed();
  const main = document.querySelector("main");
  if (!main) return;
  let box = document.getElementById("openPersonNews");
  if (!box) {
    box = document.createElement("section");
    box.id = "openPersonNews";
    box.className = "panel";
    main.prepend(box);
  }
  const items = rows.slice(0, 40).map(itemLi).join("") || `<li class="muted">這個人物頁還沒有已核對新聞</li>`;
  box.innerHTML = `<h3>已核對新聞 ${rows.length} 筆</h3><ul class="timeline">${items}</ul>`;
}
function watchPerson() {
  if (!OPEN.has(personId())) return;
  const main = document.querySelector("main");
  if (!main) return;
  const obs = new MutationObserver(() => {
    if (main.textContent && main.textContent.includes("此頁不開放")) paintPerson();
  });
  obs.observe(main, { childList: true, subtree: true });
}
paintHome();
paintPerson();
watchPerson();
[0, 200, 800].forEach((ms) => setTimeout(paintPerson, ms));
