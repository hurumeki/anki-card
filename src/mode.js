// 表示モード（こども向け / おとな向け）
// テーマ（theme.js）と同じく端末ごとの見た目の設定なので、IndexedDBではなく
// localStorageに保存する。初回描画前に適用する必要があるため、index.html の
// インラインスクリプトが同じキーを読んで <html data-mode> を設定している
// （キー名を変える場合は両方直すこと）。

export const MODE_KEY = 'memoapp:mode';

/** 選択肢（設定画面のセレクトで使う） */
export const MODE_OPTIONS = [
  ['adult', 'おとな（すべての機能）'],
  ['kid', 'こども（暗記だけ）'],
];

export const DEFAULT_MODE = 'adult';

/**
 * こどもモードで開かせない画面（ルートの先頭要素）。
 * 編集・インポート・エクスポート・設定にあたる画面をまとめて塞ぐ。
 */
export const KID_BLOCKED_ROUTES = ['deck', 'card', 'import', 'settings', 'unassigned'];

/** 未知の値・保存なしは既定（おとな）として扱う */
export function normalizeMode(value) {
  return MODE_OPTIONS.some(([v]) => v === value) ? value : DEFAULT_MODE;
}

/**
 * こどもモードで入れない画面か。
 * ボタンを隠すだけでは履歴やブックマークから入れてしまうため、
 * ルーティングでも同じ判定を使う（app.js）。
 */
export function isBlockedInKidMode(routeKey) {
  return KID_BLOCKED_ROUTES.includes(routeKey);
}

export function loadMode() {
  try {
    return normalizeMode(localStorage.getItem(MODE_KEY));
  } catch {
    return DEFAULT_MODE; // プライベートモード等でlocalStorageが使えない場合
  }
}

export function isKidMode() {
  return loadMode() === 'kid';
}

function saveMode(mode) {
  try {
    if (mode === DEFAULT_MODE) localStorage.removeItem(MODE_KEY);
    else localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* 保存できなくても今回のセッションには適用する */
  }
}

/** <html data-mode> を現在の設定に合わせる */
function applyMode(mode) {
  const m = normalizeMode(mode);
  const root = document.documentElement;
  if (m === DEFAULT_MODE) delete root.dataset.mode;
  else root.dataset.mode = m;
}

/** 設定を変更して保存する */
export function setMode(mode) {
  const m = normalizeMode(mode);
  saveMode(m);
  applyMode(m);
  return m;
}

/** 起動時に1度だけ呼ぶ */
export function initMode() {
  applyMode(loadMode());
}
