// 座標框與視角：經緯度 → 世界單位（x 向東、y 向南、z 向上）→ 畫面。平面視角是正北朝上的真實比例，
// 立體視角是同一份地面座標的軸測投影（示意視角），兩者共用同一個世界座標。
import { cameraOf, fitProjection, iso } from './kit/iso-kit.mjs';
import { localProjector } from './geo.js';

export const CAMERA = {
  plan: { azimuth: 90, elevation: 90, label: '平面（正北朝上）' },
  iso: { azimuth: 72, elevation: 42, label: '立體示意' },
};

// bbox = [西, 南, 東, 北]；units 是長邊對應的世界單位數。
// aspect（寬/高）會把圖框補到與畫面同比例；limit 是底圖資料的範圍，圖框不會超出，以免露出資料被裁掉的假海岸。
export function makeFrame(bbox, { margin = 0.05, units = 520, aspect = null, limit = null } = {}) {
  const [west, south, east, north] = bbox;
  const origin = [(west + east) / 2, (south + north) / 2];
  const projector = localProjector(origin);
  const [x0, y0] = projector.toLocal([west, south]);
  const [x1, y1] = projector.toLocal([east, north]);
  const half = [(x1 - x0) / 2, (y1 - y0) / 2];
  const pad = Math.max(half[0], half[1]) * 2 * margin;
  half[0] += pad;
  half[1] += pad;
  if (aspect) {
    if (half[0] / half[1] < aspect) half[0] = half[1] * aspect; else half[1] = half[0] / aspect;
  }
  if (limit) {
    const [lx0, ly0] = projector.toLocal([limit[0], limit[1]]);
    const [lx1, ly1] = projector.toLocal([limit[2], limit[3]]);
    half[0] = Math.min(half[0], Math.max(1, Math.min(-lx0, lx1)));
    half[1] = Math.min(half[1], Math.max(1, Math.min(-ly0, ly1)));
  }
  return frameFrom(origin, half, units);
}

// 以中心點與東西、南北半寬（公尺）定框，現地沙盤用。
export const makeCenteredFrame = (center, halfM, { units = 520 } = {}) => frameFrom(center, [halfM[0], halfM[1]], units);

function frameFrom(origin, half, units) {
  const projector = localProjector(origin);
  const mpu = (Math.max(half[0], half[1]) * 2) / units;
  return {
    origin,
    mpu,
    widthM: half[0] * 2,
    heightM: half[1] * 2,
    rect: [-half[0] / mpu, -half[1] / mpu, half[0] / mpu, half[1] / mpu],
    toWorld: (lonLat) => { const [x, y] = projector.toLocal(lonLat); return [x / mpu, -y / mpu]; },
    toLonLat: ([x, y]) => projector.toLonLat([x * mpu, -y * mpu]),
  };
}

export const rectPlan = ([x0, y0, x1, y1], grow = 0, r = 0) => ({ x: x0 - grow, y: y0 - grow, w: x1 - x0 + grow * 2, d: y1 - y0 + grow * 2, r });

export function fitCamera(points, mode, stage, { pad = 22, headroom = 0 } = {}) {
  const { azimuth, elevation } = CAMERA[mode];
  return fitProjection(points, stage.width, stage.height, { pad, headroom, azimuth, elevation });
}

// 畫面上每個世界單位是幾個像素（未受透視壓縮的方向）。
export const pxPerUnit = (P) => cameraOf(P).k;

// 畫面點 → 世界地面點（給定高度 z）。平面與立體視角都適用。
export function unproject([sx, sy], P, z = 0) {
  const { sinA, cosA, sinE, cosE, k } = cameraOf(P);
  const u = (sx - P.origin[0]) / k;
  const v = (sy - P.origin[1] + z * cosE * k) / (k * sinE);
  return [u * sinA + v * cosA, -u * cosA + v * sinA];
}

export const project = (point, P) => iso(point, P);

// ---- 縮放與平移（view = { k, x, y }：畫面 = 場景座標 × k + [x, y]）----

export const IDENTITY = Object.freeze({ k: 1, x: 0, y: 0 });

// 把視角限制在內容範圍內。
//   strict（平面視角）：畫面不會露出圖框以外的空白。
//   非 strict（立體視角，內容四周本來就有留白）：只要求可見範圍的中心不離開內容。
// insetBottom 是畫面下方被遮住的高度（手機的底部面板），可見範圍因此變矮，圖釘才不會被面板蓋住。
export function clampView(view, stage, bounds, maxK, { strict = false, insetBottom = 0 } = {}) {
  const k = Math.max(1, Math.min(maxK, view.k));
  const visible = Math.max(40, stage.height - insetBottom);
  const [bx0, by0, bx1, by1] = bounds;
  if (strict) {
    const width = (bx1 - bx0) * k;
    const height = (by1 - by0) * k;
    const x = width <= stage.width ? (stage.width - width) / 2 - bx0 * k : Math.min(-bx0 * k, Math.max(stage.width - bx1 * k, view.x));
    const y = height <= visible ? (visible - height) / 2 - by0 * k : Math.min(-by0 * k, Math.max(visible - by1 * k, view.y));
    return { k, x: x + 0, y: y + 0 }; // + 0 把 -0 正規化成 0
  }
  if (k === 1 && !insetBottom) return { k: 1, x: 0, y: 0 };
  const cx = Math.max(bx0, Math.min(bx1, (stage.width / 2 - view.x) / k));
  const cy = Math.max(by0, Math.min(by1, (visible / 2 - view.y) / k));
  return { k, x: stage.width / 2 - cx * k, y: visible / 2 - cy * k };
}

export function zoomAbout(view, factor, [px, py]) {
  const k = view.k * factor;
  return { k, x: px - (px - view.x) * (k / view.k), y: py - (py - view.y) * (k / view.k) };
}

export const panBy = (view, dx, dy) => ({ k: view.k, x: view.x + dx, y: view.y + dy });

// stage 傳可見範圍（寬、扣掉下方遮蔽後的高）。
export const centerOn = (view, [sx, sy], stage, k = view.k) => ({ k, x: stage.width / 2 - sx * k, y: stage.height / 2 - sy * k });

export const viewCenter = (view, stage) => [(stage.width / 2 - view.x) / view.k, (stage.height / 2 - view.y) / view.k];

export const applyView = (view, [sx, sy]) => [sx * view.k + view.x, sy * view.k + view.y];

// 比例尺：挑一個好讀的整數距離，使其在畫面上接近 targetPx。回傳 { meters, px, label }。
export function scaleBar(metersPerPx, targetPx = 96) {
  const raw = metersPerPx * targetPx;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).reduce((best, value) => (Math.abs(value - raw) < Math.abs(best - raw) ? value : best));
  return { meters: step, px: step / metersPerPx, label: step >= 1000 ? `${step / 1000} 公里` : `${step} 公尺` };
}
