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
function params() {
  return new URLSearchParams(location.search);
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
  const why = esc(row.sentiment_reason || "");
  return `<li>${link}<div class="muted">${when} ${esc(row.source_name || "")} ${why}</div></li>`;
}
async function paintPerson() {
  const id = params().get("id") || "";
  const person = PEOPLE.find((row) => row.id === id);
  if (!person || id === "wu") return;
  const rows = await load(`/data/items_${id}.json`);
  const name = document.getElementById("personName");
  const role = document.getElementById("personRole");
  const list = document.getElementById("list");
  const count = document.getElementById("count");
  if (name) name.textContent = person.name;
  if (role) role.textContent = person.role;
  document.title = `${person.name}｜新竹觀察`;
  if (count) count.textContent = `${rows.length} 筆`;
  if (list) {
    list.innerHTML = rows.slice(0, 40).map(itemLi).join("") || `<li class="muted">這個人物頁還沒有已核對新聞</li>`;
  }
  const sw = document.getElementById("personSwitch");
  if (sw && !sw.querySelector("[data-extra-people]")) {
    sw.insertAdjacentHTML("beforeend", PEOPLE.map((row) => `<a data-extra-people="1" href="/person.html?id=${row.id}">${esc(row.name)}</a>`).join(" "));
  }
}
paintHome();
paintPerson();
