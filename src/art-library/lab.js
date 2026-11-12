const state = { catalog: null, query: "", region: "", kind: "", use: "", license: "" };

const grid = document.querySelector("#grid");
const count = document.querySelector("#count");
const dialog = document.querySelector("#detail");
const form = document.querySelector("#filters");

const href = (path) => `/${String(path).replace(/^\/+/, "")}`;
const fileByRole = (asset, roles) => asset.files.find((file) => roles.includes(file.role));
const thumbOf = (asset) => fileByRole(asset, ["thumb", "preview", "web", "fallback", "original"]);
const fullOf = (asset) => fileByRole(asset, ["web", "fallback", "original", "preview"]);

function regionLabel(id) {
  return state.catalog.regions.find((region) => region.id === id)?.label || id;
}
function kindLabel(id) {
  return state.catalog.kinds.find((kind) => kind.id === id)?.label || id;
}

function matches(asset) {
  const blob = [asset.id, asset.title, asset.alt, asset.attribution, asset.creator, asset.license_name, ...(asset.uses || [])]
    .join(" ")
    .toLowerCase();
  if (state.query && !blob.includes(state.query)) return false;
  if (state.region && !(asset.region_ids || []).includes(state.region)) return false;
  if (state.kind && asset.kind !== state.kind) return false;
  if (state.use && !(asset.uses || []).includes(state.use)) return false;
  if (state.license && asset.license_name !== state.license) return false;
  return asset.review_status === "publication-ready";
}

function render() {
  const assets = state.catalog.assets.filter(matches);
  count.textContent = `顯示 ${assets.length} 筆，索引共 ${state.catalog.assets.length} 筆可公開素材`;
  grid.replaceChildren();
  if (!assets.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = "<p>沒有符合的素材。</p><p>放寬篩選即可回到已核對索引。缺圖不會用別人的照片補上。</p>";
    grid.append(empty);
    return;
  }
  for (const asset of assets) {
    grid.append(card(asset));
  }
}

function card(asset) {
  const article = document.createElement("article");
  article.className = "card";
  const thumb = thumbOf(asset);
  const picture = document.createElement("div");
  picture.className = "thumb";
  const image = document.createElement("img");
  image.src = href(thumb.path);
  image.alt = asset.alt;
  if (asset.focal_point) image.style.objectPosition = `${asset.focal_point.x * 100}% ${asset.focal_point.y * 100}%`;
  picture.append(image);
  const title = document.createElement("h3");
  title.textContent = asset.title;
  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(badge(kindLabel(asset.kind)), badge(asset.license_name, "clay"));
  const meta = document.createElement("p");
  meta.className = "meta";
  const regions = (asset.region_ids || []).map(regionLabel).join("、") || "不限定單一地點";
  meta.textContent = `${regions} · ${asset.dimensions.width}×${asset.dimensions.height}`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.textContent = "看來源與尺寸";
  button.addEventListener("click", () => openDetail(asset));
  article.append(picture, title, badges, meta, button);
  return article;
}

function badge(text, tone) {
  const span = document.createElement("span");
  span.className = tone ? `badge ${tone}` : "badge";
  span.textContent = text;
  return span;
}

function openDetail(asset) {
  const full = fullOf(asset);
  const host = dialog.querySelector("[data-preview]");
  host.replaceChildren();
  if (asset.kind === "component") {
    const frame = document.createElement("iframe");
    frame.src = href(fileByRole(asset, ["interactive"]).path);
    frame.title = asset.title;
    frame.style.width = "100%";
    frame.style.height = "520px";
    frame.style.border = "0";
    host.append(frame);
  } else {
    const image = document.createElement("img");
    image.src = href(full.path);
    image.alt = asset.alt;
    host.append(image);
  }
  dialog.querySelector("[data-title]").textContent = asset.title;
  const rows = [
    ["素材 ID", asset.id],
    ["種類", kindLabel(asset.kind)],
    ["授權", asset.license_name],
    ["授權條款", asset.license_url || "未另附條款網址"],
    ["作者", asset.creator],
    ["署名", asset.attribution],
    ["來源", asset.original_source_url || "原創，無外部來源頁"],
    ["取得時間", asset.retrieved_at],
    ["審核", asset.review_status],
    ["使用", asset.usage_status],
    ["尺寸", `${asset.dimensions.width}×${asset.dimensions.height} ${asset.dimensions.unit}`],
    ["替代文字", asset.alt],
    ["焦點", asset.focal_point ? `${asset.focal_point.x}, ${asset.focal_point.y}` : "未標定"],
    ["校驗", asset.checksum],
    ["建議用途", asset.suggested_use],
  ];
  const list = dialog.querySelector("[data-facts]");
  list.replaceChildren();
  for (const [name, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = name;
    const data = document.createElement("dd");
    if (name === "來源" && asset.original_source_url) {
      const link = document.createElement("a");
      link.href = asset.original_source_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = asset.original_source_url;
      data.append(link);
    } else if (name === "授權條款" && asset.license_url) {
      const link = document.createElement("a");
      link.href = asset.license_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = asset.license_url;
      data.append(link);
    } else {
      data.textContent = value == null ? "null" : String(value);
    }
    list.append(term, data);
  }
  const formats = dialog.querySelector("[data-formats]");
  formats.textContent = asset.files.map((file) => `${file.role} ${file.mime} ${file.width || "—"}×${file.height || "—"}`).join(" · ");
  const swatches = dialog.querySelector("[data-swatches]");
  swatches.replaceChildren();
  if (!asset.palette) {
    const item = document.createElement("li");
    item.textContent = "這張照片沒有指定色盤。";
    swatches.append(item);
  } else {
    for (const swatch of asset.palette) {
      const item = document.createElement("li");
      const chip = document.createElement("span");
      chip.className = "swatch";
      chip.style.background = swatch.hex;
      item.append(chip, document.createTextNode(`${swatch.name} ${swatch.hex}`));
      swatches.append(item);
    }
  }
  const copy = dialog.querySelector("[data-copy]");
  copy.textContent = "複製素材 ID";
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(asset.id);
    } catch {
      const area = document.createElement("textarea");
      area.value = asset.id;
      dialog.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    copy.textContent = "已複製";
  };
  if (!dialog.open) dialog.showModal();
}

function fillFilters() {
  const region = form.region;
  const kind = form.kind;
  const use = form.use;
  const license = form.license;
  for (const item of state.catalog.regions) addOption(region, item.id, item.label);
  for (const item of state.catalog.kinds) addOption(kind, item.id, item.label);
  const uses = [...new Set(state.catalog.assets.flatMap((asset) => asset.uses || []))].sort();
  for (const item of uses) addOption(use, item, item);
  const licenses = [...new Set(state.catalog.assets.map((asset) => asset.license_name))].sort();
  for (const item of licenses) addOption(license, item, item);
  const gaps = document.querySelector("#gaps");
  for (const gap of state.catalog.coverage_gaps) {
    const item = document.createElement("li");
    item.textContent = gap;
    gaps.append(item);
  }
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

form.addEventListener("input", () => {
  state.query = form.q.value.trim().toLowerCase();
  state.region = form.region.value;
  state.kind = form.kind.value;
  state.use = form.use.value;
  state.license = form.license.value;
  render();
});
dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());

const response = await fetch("/data/art-library.json");
if (!response.ok) throw new Error("art-library.json unavailable");
state.catalog = await response.json();
fillFilters();
render();
