// 網址狀態（分享位置用）與收藏。純函式為主，storage 可注入以便測試。
import { EMPTY_FILTERS, STAGE_IDS } from './model.js';

// 與治理頁共用同一份關注清單，兩頁的收藏互通；只存在這個瀏覽器。
export const WATCH_KEY = 'governance-watch-v1';
export const VIEWS = ['plan', 'iso'];
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const sceneOk = (value) => value === 'overview' || /^(region|site):[a-z0-9][a-z0-9-]{0,80}$/.test(value);

export const DEFAULT_STATE = Object.freeze({ scene: 'overview', view: 'plan', project: null, filters: { ...EMPTY_FILTERS }, center: null, zoom: null });

export function parseState(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const state = { ...DEFAULT_STATE, filters: { ...EMPTY_FILTERS } };
  const scene = params.get('s');
  if (scene && sceneOk(scene)) state.scene = scene;
  const view = params.get('v');
  if (VIEWS.includes(view)) state.view = view;
  const project = params.get('p');
  if (project && ID.test(project)) state.project = project;
  const region = params.get('r');
  if (region && ID.test(region)) state.filters.region = region;
  const topic = params.get('t');
  if (topic && ID.test(topic)) state.filters.topic = topic;
  const stage = params.get('g');
  if (stage && (STAGE_IDS.includes(stage) || stage === 'none')) state.filters.stage = stage;
  if (params.get('w') === '1') state.filters.favorites = true;
  const query = params.get('q');
  if (query) state.filters.query = query.slice(0, 60);
  const center = (params.get('c') ?? '').split(',').map(Number);
  if (center.length === 2 && center.every(Number.isFinite) && center[0] > 118 && center[0] < 124 && center[1] > 21 && center[1] < 27) state.center = center;
  const zoom = Number(params.get('z'));
  if (params.has('z') && Number.isFinite(zoom) && zoom >= 1 && zoom <= 64) state.zoom = zoom;
  return state;
}

export function serializeState(state) {
  const params = new URLSearchParams();
  if (state.scene && state.scene !== 'overview') params.set('s', state.scene);
  if (state.view && state.view !== DEFAULT_STATE.view) params.set('v', state.view);
  if (state.project) params.set('p', state.project);
  const filters = state.filters ?? EMPTY_FILTERS;
  if (filters.region && state.scene !== `region:${filters.region}`) params.set('r', filters.region);
  if (filters.topic) params.set('t', filters.topic);
  if (filters.stage) params.set('g', filters.stage);
  if (filters.favorites) params.set('w', '1');
  if (filters.query?.trim()) params.set('q', filters.query.trim().slice(0, 60));
  if (state.center && state.zoom && state.zoom > 1.01) {
    params.set('c', state.center.map((value) => value.toFixed(5)).join(','));
    params.set('z', String(Math.round(state.zoom * 100) / 100));
  }
  // 逗號與冒號在網址片段裡是合法字元，還原成原樣讓分享的連結好讀。
  const text = params.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':');
  return text ? `#${text}` : '';
}

export function createFavorites(storage) {
  let store = storage;
  if (store === undefined) {
    try { store = globalThis.localStorage ?? null; } catch { store = null; }
  }
  let persistent = Boolean(store);
  let ids = new Set();
  const listeners = new Set();
  const read = () => {
    try {
      const saved = JSON.parse(store.getItem(WATCH_KEY) || '[]');
      ids = new Set(Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : []);
    } catch { persistent = false; }
  };
  if (store) read();
  const write = () => {
    if (!store) return;
    try { store.setItem(WATCH_KEY, JSON.stringify([...ids])); persistent = true; } catch { persistent = false; }
  };
  return {
    has: (id) => ids.has(id),
    list: () => [...ids],
    get size() { return ids.size; },
    get persistent() { return persistent; },
    toggle(id) {
      if (ids.has(id)) ids.delete(id); else ids.add(id);
      write();
      listeners.forEach((listener) => listener(id, ids.has(id)));
      return ids.has(id);
    },
    reload() { if (store) read(); listeners.forEach((listener) => listener(null, null)); },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
