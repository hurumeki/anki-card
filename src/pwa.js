// PWA / 永続化まわり（仕様6.2 / 6.3）
import { h, toast } from './ui/dom.js';

const state = {
  persisted: false,
  estimate: null,
  waitingWorker: null,
  sessionActive: false,
  updateBannerShown: false,
};

export function getStorageState() {
  return state;
}

/** セット実施中フラグ。true の間はService Workerの更新を適用しない */
export function setSessionActive(active) {
  state.sessionActive = !!active;
  if (active) {
    // セット実施中は更新を適用させない（通知バナーも一旦引っ込める）
    const banner = document.querySelector('.update-banner');
    if (banner) {
      banner.remove();
      state.updateBannerShown = false;
    }
    return;
  }
  if (state.waitingWorker && !state.updateBannerShown) showUpdateBanner();
}

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export async function checkStorage() {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      state.persisted = await navigator.storage.persisted();
      if (!state.persisted && navigator.storage.persist) {
        // 未永続なら都度再要求する（仕様6.2-1）
        state.persisted = await navigator.storage.persist();
      }
    }
    if (navigator.storage && navigator.storage.estimate) {
      state.estimate = await navigator.storage.estimate();
    }
  } catch {
    /* 非対応ブラウザは無視 */
  }
  return state;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // 初回インストール時の clients.claim() では再読み込みしない
  const hadController = !!navigator.serviceWorker.controller;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (reg.waiting) onWaiting(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) onWaiting(sw);
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });
  } catch (e) {
    console.warn('Service Worker の登録に失敗しました', e);
  }
}

function onWaiting(worker) {
  state.waitingWorker = worker;
  if (state.sessionActive) return; // セット実施中は通知しない
  showUpdateBanner();
}

function showUpdateBanner() {
  if (state.updateBannerShown || !state.waitingWorker) return;
  state.updateBannerShown = true;
  const banner = h(
    'div',
    { class: 'update-banner' },
    h('span', {}, '新しいバージョンがあります'),
    h(
      'button',
      {
        class: 'btn primary small',
        onclick: () => {
          state.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
          banner.remove();
          toast('更新を適用しています…');
        },
      },
      '更新する'
    ),
    h(
      'button',
      {
        class: 'btn small',
        onclick: () => {
          banner.remove();
          state.updateBannerShown = false;
        },
      },
      'あとで'
    )
  );
  document.body.appendChild(banner);
}

/** インストール手順の案内文（未インストール時のみホームに表示） */
export function installGuide() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  return h(
    'div',
    { class: 'notice install-notice' },
    h('strong', {}, 'ホーム画面に追加してください'),
    h(
      'p',
      {},
      'ブラウザのままではデータが削除される場合があります。ホーム画面に追加するとオフラインでも動作し、学習データが保持されやすくなります。'
    ),
    h(
      'ul',
      {},
      ios
        ? h('li', {}, 'iOS Safari：共有ボタン → 「ホーム画面に追加」')
        : h('li', {}, 'Android Chrome：メニュー（︙）→ 「アプリをインストール」／「ホーム画面に追加」'),
      ios
        ? h('li', {}, 'Android Chrome：メニュー（︙）→ 「アプリをインストール」')
        : h('li', {}, 'iOS Safari：共有ボタン → 「ホーム画面に追加」')
    )
  );
}
