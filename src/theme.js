// 配色テーマ（仕様8.4 ダークモード対応）
// 設定値は端末ごとの見た目の設定なのでIndexedDBではなくlocalStorageに保存する。
// 初回描画前に適用する必要があるため、index.html のインラインスクリプトが
// 同じキーを読んで <html data-theme> を設定している（キー名を変える場合は両方直す）。

export const THEME_KEY = 'memoapp:theme';

/** 選択肢（設定画面のセレクトで使う） */
export const THEME_OPTIONS = [
  ['system', '端末の設定に従う'],
  ['light', 'ライト'],
  ['dark', 'ダーク'],
];

export const DEFAULT_THEME = 'system';

/** 実際の配色ごとのテーマカラー（アドレスバー・タスクスイッチャーの色） */
const THEME_COLORS = { light: '#2f6fed', dark: '#12151a' };

/** 未知の値・保存なしは既定（端末の設定に従う）として扱う */
export function normalizeTheme(value) {
  return THEME_OPTIONS.some(([v]) => v === value) ? value : DEFAULT_THEME;
}

/** 設定値と端末の状態から、実際に適用する配色を決める */
export function resolveTheme(pref, prefersDark) {
  const p = normalizeTheme(pref);
  if (p === 'system') return prefersDark ? 'dark' : 'light';
  return p;
}

export function loadThemePref() {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME; // プライベートモード等でlocalStorageが使えない場合
  }
}

function saveThemePref(pref) {
  try {
    if (pref === DEFAULT_THEME) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* 保存できなくても今回のセッションには適用する */
  }
}

function prefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** <html data-theme> と meta[name=theme-color] を現在の設定に合わせる */
function applyTheme(pref) {
  const p = normalizeTheme(pref);
  const root = document.documentElement;
  if (p === 'system') delete root.dataset.theme;
  else root.dataset.theme = p;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[resolveTheme(p, prefersDark())]);
}

/** 設定を変更して保存する */
export function setTheme(pref) {
  const p = normalizeTheme(pref);
  saveThemePref(p);
  applyTheme(p);
  return p;
}

/** 起動時に1度だけ呼ぶ。端末の設定変更にも追従する */
export function initTheme() {
  applyTheme(loadThemePref());
  const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (!mq) return;
  const onChange = () => applyTheme(loadThemePref());
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange); // 旧Safari
}
