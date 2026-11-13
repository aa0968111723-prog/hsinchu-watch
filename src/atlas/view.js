// 地圖互動層：把場景字串放進 SVG，處理縮放、平移、鍵盤、圖釘與地名的螢幕位置。
// 圖釘是真正的 <button>（44px 以上的觸控範圍、可用 Tab 聚焦）；場景圖本身對輔助科技隱藏，由列表提供等價內容。
import { IDENTITY, applyView, centerOn, clampView, panBy, scaleBar, viewCenter, zoomAbout } from './camera.js';
import { PIN_BOX, pinSvg } from './pins.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createMapView(host, handlers = {}) {
  host.textContent = '';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'iso-svg iso atl-svg');
  svg.setAttribute('data-theme', 'light');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const zoomGroup = document.createElementNS(SVG_NS, 'g');
  zoomGroup.setAttribute('class', 'atl-zoom');
  const labelGroup = document.createElementNS(SVG_NS, 'g');
  labelGroup.setAttribute('class', 'atl-labels');
  svg.append(zoomGroup, labelGroup);
  const pinLayer = document.createElement('div');
  pinLayer.className = 'atl-pin-layer';
  const hint = document.createElement('p');
  hint.className = 'atl-wheel-hint';
  hint.hidden = true;
  hint.textContent = '按住 Ctrl 再滾動滑鼠滾輪可以縮放地圖';
  host.append(svg, pinLayer, hint);

  let scene = null;
  let view = { ...IDENTITY };
  let labels = [];
  let pins = [];
  let frame = 0;
  let animation = 0;
  let hintTimer = 0;
  let activeDistrict = null;
  let insetBottom = 0;

  const stage = () => ({ width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) });
  // 可見範圍：畫面扣掉下方被底部面板遮住的高度。
  const visible = () => ({ width: scene.stage.width, height: Math.max(40, scene.stage.height - insetBottom) });
  const limit = (next) => clampView(next, scene.stage, scene.bounds, scene.maxZoom, { strict: scene.mode === 'plan', insetBottom });

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; layout(); });
  }

  function commit(next, notify = true) {
    if (!scene) return;
    view = limit(next);
    zoomGroup.setAttribute('transform', `translate(${view.x.toFixed(2)} ${view.y.toFixed(2)}) scale(${view.k.toFixed(4)})`);
    schedule();
    if (notify) handlers.onView?.(snapshot());
  }

  function stopAnimation() {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
  }

  function setView(next, { animate = false } = {}) {
    stopAnimation();
    if (!scene) return;
    const target = limit(next);
    if (!animate || reducedMotion()) { commit(target); return; }
    const from = { ...view };
    const started = performance.now();
    const duration = 380;
    const step = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const e = 1 - (1 - t) ** 3;
      commit({ k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e }, t === 1);
      animation = t < 1 ? requestAnimationFrame(step) : 0;
    };
    animation = requestAnimationFrame(step);
  }

  // ---- 地名與圖釘的螢幕位置 ----
  function layout() {
    if (!scene) return;
    const { width, height } = scene.stage;
    const taken = [];
    const hit = (box) => taken.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]);
    const ordered = [...pins].sort((a, b) => a.screenY - b.screenY);
    for (const pin of pins) {
      const [x, y] = applyView(view, pin.at);
      pin.screenY = y;
      const visible = x > -20 && x < width + 20 && y > -10 && y < height + PIN_BOX.height;
      pin.node.hidden = !visible;
      if (!visible) continue;
      pin.node.style.transform = `translate(${(x - PIN_BOX.tipX).toFixed(1)}px, ${(y - PIN_BOX.tipY).toFixed(1)}px)`;
      taken.push([x - 16, y - 54, x + 16, y + 6]);
    }
    ordered.forEach((pin, index) => { pin.node.style.zIndex = String(pin.selected ? 500 : 10 + index); });
    for (const label of labels) {
      const [x, y] = applyView(view, label.at);
      const size = label.kind === 'region' ? 15 : label.kind === 'neighbor' ? 11 : 12;
      const half = (label.text.length * (size + 1.5)) / 2 + 3;
      let show = x > half && x < width - half && y > 10 && y < height - 10;
      if (show && label.kind === 'district') show = label.low ? view.k >= 2.6 : scene.kind === 'region' || view.k >= 2.2;
      if (show && label.kind === 'region' && scene.kind === 'overview' && view.k >= 3.2) show = false;
      let placedY = y;
      if (show) {
        let box = [x - half, y - size / 2 - 2, x + half, y + size / 2 + 2];
        if (hit(box) && label.kind === 'region') {
          placedY = y + 26;
          box = [x - half, placedY - size / 2 - 2, x + half, placedY + size / 2 + 2];
        }
        if (hit(box)) show = false; else taken.push(box);
      }
      label.node.style.display = show ? '' : 'none';
      if (show) { label.node.setAttribute('x', x.toFixed(1)); label.node.setAttribute('y', placedY.toFixed(1)); }
    }
  }

  function setScene(next, { restore = null } = {}) {
    stopAnimation();
    scene = next;
    svg.setAttribute('viewBox', `0 0 ${scene.stage.width} ${scene.stage.height}`);
    svg.setAttribute('width', scene.stage.width);
    svg.setAttribute('height', scene.stage.height);
    zoomGroup.innerHTML = scene.markup;
    svg.dataset.view = scene.mode;
    svg.dataset.scene = scene.kind;
    labelGroup.textContent = '';
    const priority = { region: 0, district: 1, neighbor: 2 };
    labels = [...scene.labels]
      .sort((a, b) => priority[a.kind] - priority[b.kind] || Number(Boolean(a.low)) - Number(Boolean(b.low)) || b.weight - a.weight)
      .map((label) => {
        const node = document.createElementNS(SVG_NS, 'text');
        node.setAttribute('class', 'atl-label');
        node.dataset.kind = label.kind;
        if (label.low) node.dataset.low = '';
        node.textContent = label.text;
        labelGroup.append(node);
        return { ...label, node };
      });
    activeDistrict = null;
    view = { ...IDENTITY };
    commit(restore ?? IDENTITY, false);
  }

  // pinModels：[{ projectId, at, title, stage, precision, favorite, selected, dim, describe }]
  function setPins(models) {
    pinLayer.textContent = '';
    pins = models.map((model) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'atl-pin';
      node.dataset.project = model.projectId;
      node.innerHTML = `${pinSvg(model)}<span class="atl-pin-name">${escapeHtml(model.title)}</span>`;
      node.setAttribute('aria-label', model.describe);
      node.setAttribute('aria-pressed', String(Boolean(model.selected)));
      if (model.selected) node.dataset.selected = '';
      if (model.dim) node.dataset.dim = '';
      node.addEventListener('click', () => handlers.onPin?.(model.projectId));
      node.addEventListener('pointerenter', () => handlers.onPinHover?.(model.projectId, true));
      node.addEventListener('pointerleave', () => handlers.onPinHover?.(model.projectId, false));
      node.addEventListener('focus', () => handlers.onPinHover?.(model.projectId, true));
      node.addEventListener('blur', () => handlers.onPinHover?.(model.projectId, false));
      pinLayer.append(node);
      return { ...model, node, screenY: 0 };
    });
    schedule();
  }

  function markPin(projectId, name, on) {
    const pin = pins.find((item) => item.projectId === projectId);
    if (!pin) return;
    if (on) pin.node.dataset[name] = ''; else delete pin.node.dataset[name];
  }

  function setActiveDistrict(id) {
    if (activeDistrict) zoomGroup.querySelector(`[data-district="${activeDistrict}"]`)?.removeAttribute('data-active');
    activeDistrict = id;
    if (id) zoomGroup.querySelector(`[data-district="${id}"]`)?.setAttribute('data-active', '');
  }

  // 所有掛在 host 上的事件都經過這裡，destroy() 時一次拿掉，重建互動層不會留下重複的處理器。
  const lifetime = new AbortController();
  const listen = (type, handler, options = {}) => host.addEventListener(type, handler, { ...options, signal: lifetime.signal });

  // ---- 指標：拖曳平移、雙指縮放、點選行政區 ----
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  const local = (event) => { const box = host.getBoundingClientRect(); return [event.clientX - box.left, event.clientY - box.top]; };

  listen('pointerdown', (event) => {
    if (event.target.closest('.atl-pin') || (event.pointerType === 'mouse' && event.button !== 0)) return;
    stopAnimation();
    const point = local(event);
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) drag = { start: point, view: { ...view }, moved: false, target: event.target };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, view: { ...view }, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      if (drag) drag.moved = true;
    }
    try { host.setPointerCapture(event.pointerId); } catch { /* 部分瀏覽器不支援，拖曳仍可用 */ }
  });
  listen('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse') hoverAt(event.target);
      return;
    }
    const point = local(event);
    pointers.set(event.pointerId, point);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const zoomed = zoomAbout(pinch.view, distance / pinch.distance, pinch.mid);
      commit(panBy(zoomed, mid[0] - pinch.mid[0], mid[1] - pinch.mid[1]));
      return;
    }
    if (!drag) return;
    const dx = point[0] - drag.start[0];
    const dy = point[1] - drag.start[1];
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    host.dataset.dragging = '';
    commit(panBy(drag.view, dx, dy));
  });
  const release = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      delete host.dataset.dragging;
      if (drag && !drag.moved && event.type === 'pointerup') tap(drag.target);
      drag = null;
    } else if (pointers.size === 1) {
      drag = { start: [...pointers.values()][0], view: { ...view }, moved: true, target: null };
    }
  };
  listen('pointerup', release);
  listen('pointercancel', release);
  listen('pointerleave', (event) => { if (event.pointerType === 'mouse') handlers.onHover?.(null); });

  function hoverAt(target) {
    const node = target?.closest?.('[data-name]');
    handlers.onHover?.(node ? { name: node.dataset.name, regionId: node.dataset.region ?? null, district: node.dataset.district ?? null } : null);
  }
  function tap(target) {
    const node = target?.closest?.('.atl-district');
    if (!node) { handlers.onBackground?.(); return; }
    handlers.onDistrict?.({ id: node.dataset.district ?? null, regionId: node.dataset.region, name: node.dataset.name });
  }

  listen('wheel', (event) => {
    if (!scene) return;
    if (!event.ctrlKey && !event.metaKey) {
      hint.hidden = false;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { hint.hidden = true; }, 1600);
      return;
    }
    event.preventDefault();
    stopAnimation();
    commit(zoomAbout(view, Math.exp(-event.deltaY * 0.0022), local(event)));
  }, { passive: false });
  listen('dblclick', (event) => {
    if (event.target.closest('.atl-pin')) return;
    setView(zoomAbout(view, event.shiftKey ? 1 / 1.7 : 1.7, local(event)), { animate: true });
  });

  listen('keydown', (event) => {
    if (event.target !== host || !scene || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 180 : 60;
    const centre = [visible().width / 2, visible().height / 2];
    const actions = {
      ArrowLeft: () => setView(panBy(view, step, 0)),
      ArrowRight: () => setView(panBy(view, -step, 0)),
      ArrowUp: () => setView(panBy(view, 0, step)),
      ArrowDown: () => setView(panBy(view, 0, -step)),
      '+': () => setView(zoomAbout(view, 1.4, centre), { animate: true }),
      '=': () => setView(zoomAbout(view, 1.4, centre), { animate: true }),
      '-': () => setView(zoomAbout(view, 1 / 1.4, centre), { animate: true }),
      _: () => setView(zoomAbout(view, 1 / 1.4, centre), { animate: true }),
      0: () => setView(IDENTITY, { animate: true }),
      Home: () => setView(IDENTITY, { animate: true }),
      Escape: () => handlers.onEscape?.(),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  });

  function snapshot() {
    if (!scene) return null;
    const centre = viewCenter(view, visible());
    const metersPerPx = scene.metersPerPx / view.k;
    const home = limit(IDENTITY);
    return { k: view.k, x: view.x, y: view.y, center: scene.toLonLat(centre), metersPerPx, bar: scaleBar(metersPerPx), atHome: view.k === 1 && Math.abs(view.x - home.x) < 0.5 && Math.abs(view.y - home.y) < 0.5 };
  }

  return {
    stage,
    setScene,
    setPins,
    markPin,
    setActiveDistrict,
    setView,
    snapshot,
    get scene() { return scene; },
    get view() { return { ...view }; },
    zoomBy(factor) { if (scene) setView(zoomAbout(view, factor, [visible().width / 2, visible().height / 2]), { animate: true }); },
    reset() { setView(IDENTITY, { animate: true }); },
    // 把某個場景座標移到可見範圍中央；minK 讓太遠的視角順便拉近。
    focus(point, minK = 1) { if (scene) setView(centerOn(view, point, visible(), Math.max(view.k, minK)), { animate: true }); },
    restore(center, zoom) {
      if (!scene || !center) return;
      setView(centerOn(view, scene.toStage(center), visible(), zoom ?? 1));
    },
    // 畫面下方被遮住的像素（手機底部面板）。遮住時可見範圍變矮，置中與邊界都以可見範圍為準。
    setInset(pixels) {
      const next = Math.max(0, Math.round(pixels));
      if (next === insetBottom) return;
      insetBottom = next;
      if (scene) setView(view);
    },
    refresh: schedule,
    destroy() {
      lifetime.abort();
      stopAnimation();
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(hintTimer);
      scene = null;
    },
  };
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
