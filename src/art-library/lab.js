/**
 * Art library browser. Reads /data/art-library.json, filters it, shows where
 * every picture came from, and copies an asset ID or ready-to-paste markup.
 * No inline script and no iframe: the production site forbids both.
 */
import { startFigure } from "./figures/boot.js";

const $ = (selector, root = document) => root.querySelector(selector);
const site = (path) => `/${String(path).replace(/^\/+/, "")}`;
const FIELDS = ["q", "region", "kind", "use", "license", "review"];
const ROLE_LABELS = {
  original: "原檔", fallback: "相容用", responsive: "響應式", preview: "靜態預覽",
  fragment: "嵌入片段", page: "獨立頁", module: "模組", shared: "共用",
};

const form = $("#alFilters");
const count = $("#alCount");
const alertBox = $("#alAlert");
const dialog = $("#alDetail");
const sections = { photo: $("#alPhotos"), original: $("#alOriginals"), gap: $("#alGaps"), empty: $("#alEmpty") };
const grids = { photo: $('[data-grid="photo"]'), original: $('[data-grid="original"]'), gap: $('[data-grid="gap"]') };

let catalog = null;
let label = {};
let figure = null;
let shown = null;

/** Small DOM builder. Text always goes in as text, never as markup. */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

const link = (href, text) => el("a", { href, target: "_blank", rel: "noopener noreferrer", text });
const natureOf = (asset) => label.nature[asset.kind];
const isPhoto = (asset) => natureOf(asset) === "real-photo";
const regionText = (ids) => (ids.length === catalog.regions.length ? "不限地區" : ids.map((id) => label.region[id] || id).join("、"));
const bytesText = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} kB`);

function indexLabels() {
  const by = (rows) => Object.fromEntries(rows.map((row) => [row.id, row.label]));
  label = {
    region: by(catalog.regions),
    kind: by(catalog.kinds),
    nature: Object.fromEntries(catalog.kinds.map((kind) => [kind.id, kind.nature])),
    use: by(catalog.uses),
    review: by(catalog.review_statuses),
    usage: by(catalog.usage_statuses),
  };
}

function fillSelect(name, rows) {
  const select = form.elements[name];
  for (const row of rows) select.append(el("option", { value: row.id, text: row.label }));
}

function readFilters() {
  const values = Object.fromEntries(FIELDS.map((name) => [name, form.elements[name].value.trim()]));
  values.tokens = values.q.toLowerCase().split(/\s+/).filter(Boolean);
  return values;
}

function textOf(asset) {
  return [
    asset.id, asset.title, asset.alt, asset.creator, asset.attribution, asset.license_name, label.kind[asset.kind],
    ...(asset.region_ids || []).map((id) => label.region[id]),
    ...(asset.uses || []).map((id) => label.use[id]),
  ].join(" ").toLowerCase();
}

function matchesAsset(asset, filters) {
  if (filters.review && filters.review !== asset.review_status) return false;
  if (filters.region && !asset.region_ids.includes(filters.region)) return false;
  if (filters.kind && asset.kind !== filters.kind) return false;
  if (filters.use && !asset.uses.includes(filters.use)) return false;
  if (filters.license && asset.license_name !== filters.license) return false;
  const text = textOf(asset);
  return filters.tokens.every((token) => text.includes(token));
}

function matchesGap(gap, filters) {
  if (filters.review && filters.review !== gap.review_status) return false;
  if (filters.use || filters.license) return false;
  if (filters.region && !gap.region_ids.includes(filters.region)) return false;
  if (filters.kind && gap.kind !== filters.kind) return false;
  const text = [gap.id, gap.title, gap.reason, label.kind[gap.kind]].join(" ").toLowerCase();
  return filters.tokens.every((token) => text.includes(token));
}

/** <picture> with AVIF and WebP sources and a JPEG fallback, or a plain image for vector previews. */
function pictureOf(asset, { sizes, limit = Infinity, eager = false }) {
  const responsive = asset.files.filter((file) => file.role === "responsive" && file.width <= limit);
  const fallback = asset.files.find((file) => file.role === "fallback") || asset.files.find((file) => file.role === "preview") || asset.files[0];
  const image = el("img", {
    src: site(fallback.path), alt: asset.alt, width: fallback.width, height: fallback.height,
    loading: eager ? "eager" : "lazy", decoding: "async",
  });
  if (asset.focal_point) image.style.objectPosition = `${asset.focal_point.x * 100}% ${asset.focal_point.y * 100}%`;
  if (!responsive.length) return image;
  const sources = ["avif", "webp"].map((format) => {
    const set = responsive.filter((file) => file.format === format).sort((a, b) => a.width - b.width);
    if (!set.length) return null;
    return el("source", { type: set[0].mime, srcset: set.map((file) => `${site(file.path)} ${file.width}w`).join(", "), sizes });
  });
  return el("picture", {}, [...sources, image]);
}

function card(asset) {
  const photo = isPhoto(asset);
  const copy = el("button", { type: "button", class: "al-btn", text: "複製 ID", "aria-label": `複製素材 ID ${asset.id}` });
  copy.addEventListener("click", async () => {
    await copyText(asset.id);
    copy.textContent = "已複製";
    setTimeout(() => { copy.textContent = "複製 ID"; }, 1600);
  });
  return el("article", { class: "al-card", dataset: { asset: asset.id } }, [
    el("span", { class: "al-media", dataset: { fit: asset.kind === "scene" ? "cover" : "contain" } },
      pictureOf(asset, { sizes: "(min-width: 1100px) 260px, (min-width: 900px) 30vw, (min-width: 560px) 46vw, 92vw", limit: 800 })),
    el("h3", { text: asset.title }),
    el("div", { class: "al-badges" }, [
      el("span", { class: "al-badge", dataset: { tone: photo ? "photo" : "original" }, text: photo ? `${label.kind[asset.kind]} · 真實照片` : `${label.kind[asset.kind]} · 原創示意` }),
      el("span", { class: "al-badge", text: asset.license_name }),
    ]),
    el("p", { class: "al-meta", text: `${regionText(asset.region_ids)} · ${asset.dimensions.width}×${asset.dimensions.height}` }),
    el("code", { class: "al-id", text: asset.id }),
    el("div", { class: "al-card-actions" }, [
      el("button", { type: "button", class: "al-btn al-btn-primary", text: "看來源與尺寸", onclick: () => openDetail(asset) }),
      copy,
    ]),
  ]);
}

function gapItem(gap) {
  return el("li", { class: "al-gap", dataset: { gap: gap.id } }, [
    el("strong", { text: `${gap.title}（${label.kind[gap.kind]}）` }),
    el("p", { text: gap.reason }),
    el("p", { text: `需要：${gap.needed}` }),
  ]);
}

function render() {
  const filters = readFilters();
  const assets = catalog.assets.filter((asset) => matchesAsset(asset, filters));
  const gaps = catalog.gaps.filter((gap) => matchesGap(gap, filters));
  const photos = assets.filter(isPhoto);
  const originals = assets.filter((asset) => !isPhoto(asset));
  grids.photo.replaceChildren(...photos.map(card));
  grids.original.replaceChildren(...originals.map(card));
  grids.gap.replaceChildren(...gaps.map(gapItem));
  sections.photo.hidden = !photos.length;
  sections.original.hidden = !originals.length;
  sections.gap.hidden = !gaps.length;
  sections.empty.hidden = Boolean(assets.length || gaps.length);
  count.textContent = `符合 ${assets.length} 件（照片 ${photos.length}、示意 ${originals.length}），缺口 ${gaps.length} 項。索引共 ${catalog.assets.length} 件已核對素材。`;
  syncUrl();
}

/** Keeps the filters and the open asset in the address, so a view can be shared. */
function syncUrl() {
  const filters = readFilters();
  const params = new URLSearchParams();
  for (const name of FIELDS) if (filters[name]) params.set(name, filters[name]);
  if (shown) params.set("asset", shown.id);
  const query = params.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

function coverage() {
  const table = $("#alCoverage");
  const head = el("thead", {}, el("tr", {}, [el("th", { scope: "col", text: "地區" }), ...catalog.kinds.map((kind) => el("th", { scope: "col", class: "al-num", text: kind.label }))]));
  const body = el("tbody", {}, catalog.regions.map((region) => el("tr", {}, [
    el("th", { scope: "row", text: region.label }),
    ...catalog.kinds.map((kind) => {
      const cell = catalog.coverage.find((row) => row.region_id === region.id && row.kind === kind.id);
      return el("td", { class: "al-num", "data-zero": cell.count === 0, text: String(cell.count) });
    }),
  ])));
  table.append(head, body);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = el("textarea", { class: "al-sr", "aria-hidden": "true" });
    area.value = text;
    (dialog.open ? dialog : document.body).append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function embedCode(asset) {
  if (!isPhoto(asset)) {
    return [
      `<link rel="stylesheet" href="${site(asset.embed.stylesheet)}">`,
      `<div data-figure="${asset.embed.figure}" data-alt="${asset.alt}"></div>`,
      `<script type="module" src="${site(asset.embed.script)}"></script>`,
    ].join("\n");
  }
  const fallback = asset.files.find((file) => file.role === "fallback");
  const lines = ["<picture>"];
  for (const format of ["avif", "webp"]) {
    const set = asset.files.filter((file) => file.role === "responsive" && file.format === format).sort((a, b) => a.width - b.width);
    if (set.length) lines.push(`  <source type="${set[0].mime}" srcset="${set.map((file) => `${site(file.path)} ${file.width}w`).join(", ")}" sizes="(min-width: 800px) 800px, 100vw">`);
  }
  lines.push(`  <img src="${site(fallback.path)}" width="${fallback.width}" height="${fallback.height}" alt="${asset.alt}" loading="lazy" decoding="async">`);
  lines.push("</picture>");
  lines.push(`<p class="photo-credit">照片：${asset.attribution}</p>`);
  return lines.join("\n");
}

function facts(asset) {
  const rows = [];
  const add = (name, value) => { if (value !== null && value !== undefined && value !== "") rows.push([name, value]); };
  add("素材 ID", el("code", { class: "al-id", text: asset.id }));
  add("種類", `${label.kind[asset.kind]}（${isPhoto(asset) ? "真實照片" : "原創示意"}）`);
  add("地區", regionText(asset.region_ids));
  add("用途", asset.uses.map((use) => label.use[use] || use).join("、"));
  add("授權", asset.license_url ? link(asset.license_url, asset.license_name) : `${asset.license_name}${isPhoto(asset) ? "（檔案頁沒有附條款網址）" : ""}`);
  add("作者", asset.creator);
  add("署名文字", asset.attribution);
  add("來源頁", asset.original_source_url ? link(asset.original_source_url, asset.source.file_title) : "原創，沒有外部來源");
  if (asset.source) {
    add("原檔", el("span", {}, [`${asset.source.original_width}×${asset.source.original_height}，`, link(asset.source.original_file_url, "開啟原檔")]));
    add("拍攝日期", asset.source.date_taken);
    add("來源說明", asset.source.described_as);
  }
  add("取得時間", asset.retrieved_at || "不適用（原創）");
  add("審核狀態", label.review[asset.review_status]);
  add("使用狀態", label.usage[asset.usage_status]);
  if (asset.identity) add("身份核對", `${asset.identity.basis}${asset.identity.site_file_check}`);
  add("改動", asset.changes);
  add("概念", asset.concept);
  add("建議用途", asset.suggested_use);
  add("替代文字", asset.alt);
  add("焦點", asset.focal_point ? `橫 ${asset.focal_point.x}、縱 ${asset.focal_point.y}` : "沒有標定");
  add("校驗", el("span", {}, [el("code", { class: "al-id", text: `sha256 ${asset.checksum}` }), `（${asset.checksum_of}）`]));
  for (const item of asset.third_party || []) add("使用的工具", el("span", {}, [`${item.name}，${item.license}。`, link(site(item.notice), "授權全文")]));
  return rows.flatMap(([name, value]) => [el("dt", { text: name }), el("dd", {}, typeof value === "string" ? document.createTextNode(value) : value)]);
}

function openDetail(asset) {
  closeFigure();
  shown = asset;
  const photo = isPhoto(asset);
  $("#alDetailTitle").textContent = asset.title;
  const nature = $("[data-nature]", dialog);
  nature.dataset.tone = photo ? "photo" : "original";
  nature.textContent = photo
    ? "真實照片。這是拍攝當天的樣子，不是工程進度或現況的證明。"
    : "原創示意。本站自己畫的元件，不代表任何真實工程，也不帶政策數字。";
  const preview = $("[data-preview]", dialog);
  preview.dataset.kind = asset.kind;
  if (photo) {
    preview.replaceChildren(pictureOf(asset, { sizes: "(min-width: 800px) 720px, 96vw", eager: true }));
  } else {
    const host = el("div", { dataset: { figure: asset.embed.figure, alt: asset.alt } });
    preview.replaceChildren(host);
    startFigure(host).then((handle) => {
      if (shown === asset) figure = handle;
      else if (handle) handle.destroy();
    });
  }
  $("[data-facts]", dialog).replaceChildren(...facts(asset));
  $("[data-files]", dialog).replaceChildren(
    el("thead", {}, el("tr", {}, ["用途", "格式", "尺寸", "大小"].map((text, index) => el("th", { scope: "col", class: index > 1 ? "al-num" : null, text })))),
    el("tbody", {}, asset.files.map((file) => el("tr", {}, [
      el("td", { text: ROLE_LABELS[file.role] || file.role }),
      el("td", {}, link(site(file.path), file.format.toUpperCase())),
      el("td", { class: "al-num", text: file.width ? `${file.width}×${file.height}` : "—" }),
      el("td", { class: "al-num", text: bytesText(file.bytes) }),
    ]))),
  );
  $("[data-swatches]", dialog).replaceChildren(...(asset.palette || []).map((swatch) => {
    const chip = el("span", { class: "al-swatch" });
    chip.style.background = swatch.hex;
    const share = swatch.share ? ` ${Math.round(swatch.share * 100)}%` : "";
    return el("li", {}, [chip, `${swatch.name ? `${swatch.name} ` : ""}${swatch.hex}${share}`]);
  }));
  $("[data-copied]", dialog).textContent = "";
  if (!dialog.open) dialog.showModal();
  document.documentElement.classList.add("al-modal");
  dialog.scrollTop = 0;
  syncUrl();
}

function closeFigure() {
  if (figure) figure.destroy();
  figure = null;
}

dialog.addEventListener("close", () => {
  closeFigure();
  $("[data-preview]", dialog).replaceChildren();
  shown = null;
  document.documentElement.classList.remove("al-modal");
  syncUrl();
});
dialog.addEventListener("click", (event) => {
  if (event.target.closest("[data-close]")) {
    dialog.close();
    return;
  }
  // A click on the backdrop lands on the dialog element itself, outside its box.
  const box = dialog.getBoundingClientRect();
  const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  if (event.target === dialog && outside) dialog.close();
});
for (const button of dialog.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    if (!shown) return;
    const kind = button.dataset.copy;
    const text = kind === "id" ? shown.id : kind === "credit" ? shown.attribution : embedCode(shown);
    await copyText(text);
    $("[data-copied]", dialog).textContent = kind === "id" ? `已複製素材 ID：${shown.id}` : kind === "credit" ? `已複製署名：${shown.attribution}` : "已複製嵌入碼";
  });
}

form.addEventListener("input", render);
form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("reset", () => setTimeout(render));
$("[data-clear]").addEventListener("click", () => form.reset());

async function load() {
  alertBox.hidden = true;
  count.textContent = "讀取素材索引…";
  try {
    const response = await fetch("/data/art-library.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalog = await response.json();
  } catch (error) {
    count.textContent = "素材索引沒有載入。";
    alertBox.replaceChildren(
      el("p", { text: `讀不到 /data/art-library.json（${error.message}）。這不代表沒有素材。` }),
      el("button", { type: "button", class: "al-btn", text: "重試", onclick: load }),
    );
    alertBox.hidden = false;
    return;
  }
  indexLabels();
  fillSelect("region", catalog.regions);
  fillSelect("kind", catalog.kinds);
  fillSelect("use", catalog.uses);
  fillSelect("license", [...new Set(catalog.assets.map((asset) => asset.license_name))].sort().map((name) => ({ id: name, label: name })));
  fillSelect("review", catalog.review_statuses);
  const params = new URLSearchParams(location.search);
  for (const name of FIELDS) if (params.has(name)) form.elements[name].value = params.get(name);
  coverage();
  render();
  const wanted = params.get("asset") && catalog.assets.find((asset) => asset.id === params.get("asset"));
  if (wanted) openDetail(wanted);
}

load();
