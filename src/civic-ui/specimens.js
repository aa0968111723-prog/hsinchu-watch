/** Token specimens. Colours are read from the live stylesheet and the contrast
 *  ratios are computed in the page, so this sheet cannot drift from the CSS.
 */
import { ORIGINS, escapeHtml } from "./model.mjs";

/** [label, text token, background token]. Every pair is body-size text. */
export const PAIRS = [
  ["內文", "--civic-ink", "--civic-paper"],
  ["內文在紙卡上", "--civic-ink", "--civic-sheet"],
  ["次要文字", "--civic-ink-2", "--civic-sheet"],
  ["說明小字", "--civic-ink-3", "--civic-sheet"],
  ["說明小字在頁面上", "--civic-ink-3", "--civic-paper"],
  ["說明小字在凹槽上", "--civic-ink-3", "--civic-sunk"],
  ["連結", "--civic-link", "--civic-paper"],
  ["連結在紙卡上", "--civic-link", "--civic-sheet"],
  ["小標", "--civic-clay", "--civic-paper"],
  ["選中的項目", "--civic-sage-ink", "--civic-sage-soft"],
  ["缺口提醒", "--civic-wheat-ink", "--civic-wheat-soft"],
  ...["sage", "sky", "clay", "wheat", "plum", "stone"].map((tone) => [`${tone} 標籤`, `--civic-${tone}-ink`, `--civic-${tone}-soft`]),
];

export function contrastOf(text, background) {
  const channel = (value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const [a, b] = [luminance(text), luminance(background)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

function resolve(token) {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  document.body.append(probe);
  const rgb = getComputedStyle(probe).color.match(/[\d.]+/g).slice(0, 3).map(Number);
  probe.remove();
  return rgb;
}

export function measurePairs() {
  return PAIRS.map(([label, text, background]) => ({ label, text, background, ratio: contrastOf(resolve(text), resolve(background)) }));
}

export function mountSpecimens(host) {
  const paint = () => {
    const pairs = measurePairs();
    host.innerHTML = `
      <h3 class="civic-h3">文字與底色的對比</h3>
      <p class="civic-note">每一格是實際會出現的文字和底色。數字是瀏覽器當場算的對比，內文的標準是 4.5 以上。</p>
      <ul class="civic-swatches">${pairs.map((pair) => `<li class="civic-swatch" style="background:var(${pair.background});color:var(${pair.text})" data-ratio="${pair.ratio.toFixed(2)}">
        <b>${escapeHtml(pair.label)}</b><span>${pair.ratio.toFixed(1)}：1${pair.ratio >= 4.5 ? "" : "　不足"}</span></li>`).join("")}</ul>
      <h3 class="civic-h3">紀錄性質的標籤</h3>
      <p class="civic-note">標籤說的是「這是誰說的、哪一種紀錄」，不是真假。顏色只是輔助，一定帶字。</p>
      <ul class="civic-tags">${Object.values(ORIGINS).map((origin) => `<li class="civic-tag civic-tone-${origin.tone}">${escapeHtml(origin.label)}</li>`).join("")}</ul>
      <h3 class="civic-h3">量條</h3>
      <dl class="civic-facts">
        <div><dt>有數字（77.25%）</dt><dd><span class="civic-meter civic-meter--tall civic-tone-clay" role="img" aria-label="77.25%"><span style="--p:77.25"></span></span></dd></div>
        <div><dt>沒有數字：畫成未知，不畫成零</dt><dd><span class="civic-meter civic-meter--tall is-unknown" role="img" aria-label="尚未收錄"></span></dd></div>
      </dl>
      <h3 class="civic-h3">字級</h3>
      <p class="civic-title">標題用襯線體，一行不超過二十字</p>
      <p class="civic-lede">內文 16px、行高 1.75。數字用等寬數字：18,422 筆、77.25%、9.75 億元。</p>
      <p class="civic-note">說明小字 14px，用在來源、日期與限制。</p>`;
  };
  paint();
  document.addEventListener("civic:theme", paint);
}
