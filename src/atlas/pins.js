// 圖釘圖樣（SVG 字串）。互動頁的按鈕與靜態替代圖共用。座標原點 (0,0) 是釘尖，也就是核對過的座標。
import { STAGE_GLYPH } from './model.js';

export const PIN_BOX = { width: 48, height: 68, tipX: 24, tipY: 58 };

const STAR = 'M0 -5.2 1.5 -1.7 5.2 -1.5 2.3 0.9 3.2 4.5 0 2.5 -3.2 4.5 -2.3 0.9 -5.2 -1.5 -1.5 -1.7Z';

// stage：七階段中最新有紀錄的一格（null 表示七格都沒有紀錄或階段對照未載入）。
export function pinArt({ stage = null, precision = 'site', favorite = false } = {}) {
  const glyph = stage ? STAGE_GLYPH[stage] ?? '·' : '·';
  return `<g class="atl-pin-art" data-stage="${stage ?? 'none'}" data-precision="${precision}">`
    + '<ellipse class="atl-pin-shadow" cx="5" cy="1.5" rx="9" ry="3.4"/>'
    + '<ellipse class="atl-pin-ground" cx="0" cy="0" rx="7" ry="3.2"/>'
    + '<circle class="atl-pin-hole" cx="0" cy="0" r="1.5"/>'
    + '<path class="atl-pin-stem" d="M0 0V-26"/>'
    + '<circle class="atl-pin-select" cx="0" cy="-38" r="17.5"/>'
    + '<circle class="atl-pin-head" cx="0" cy="-38" r="13"/>'
    + '<path class="atl-pin-rim" d="M-9.2 -41.8A10 10 0 0 1 -1 -47.8"/>'
    + `<text class="atl-pin-glyph" x="0" y="-37.5">${glyph}</text>`
    + (favorite ? `<path class="atl-pin-star" transform="translate(11 -49)" d="${STAR}"/>` : '')
    + '</g>';
}

export const pinSvg = (options) => `<svg class="atl-pin-svg" viewBox="${-PIN_BOX.tipX} ${-PIN_BOX.tipY} ${PIN_BOX.width} ${PIN_BOX.height}" width="${PIN_BOX.width}" height="${PIN_BOX.height}" aria-hidden="true" focusable="false">${pinArt(options)}</svg>`;
