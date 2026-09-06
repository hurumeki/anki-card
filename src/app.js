// アプリ本体（ルーティングと起動処理）
import * as db from './db.js';
import { checkStorage, registerServiceWorker, setSessionActive } from './pwa.js';
import { clear, h } from './ui/dom.js';
import { renderHome } from './ui/home.js';
import { renderCardList } from './ui/cards.js';
import { renderCardEdit } from './ui/cardEdit.js';
import { renderImport } from './ui/importCsv.js';
import { renderSettings } from './ui/settings.js';
import { renderQuiz } from './ui/quiz.js';

const ctx = {
  settings: null,
  rerender: () => route(),
};

const root = document.getElementById('app');
let currentRoute = '';

async function route() {
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/').filter((p) => p !== '');
  const key = parts.join('/');
  // セット実施中に別画面へ移動した場合はセットを破棄する（仕様5.3）
  if (!key.startsWith('session') && currentRoute.startsWith('session')) setSessionActive(false);
  currentRoute = key;
  ctx.settings = await db.loadSettings();
  clear(root);
  window.scrollTo(0, 0);

  try {
    switch (parts[0]) {
      case undefined:
        await renderHome(root, ctx);
        break;
      case 'deck':
        await renderCardList(root, ctx, parts[1]);
        break;
      case 'unassigned':
        await renderCardList(root, ctx, null);
        break;
      case 'card':
        if (parts[1] === 'new') {
          await renderCardEdit(root, ctx, null, parts[2] === 'none' ? null : parts[2]);
        } else {
          await renderCardEdit(root, ctx, parts[1], null);
        }
        break;
      case 'import':
        await renderImport(root, ctx, parts[1] || null);
        break;
      case 'settings':
        await renderSettings(root, ctx);
        break;
      case 'session':
        await renderQuiz(root, ctx, parts[1]);
        break;
      default:
        location.hash = '#/';
    }
  } catch (e) {
    console.error(e);
    clear(root);
    root.appendChild(
      h(
        'div',
        { class: 'screen' },
        h('div', { class: 'notice error' },
          h('strong', {}, 'エラーが発生しました'),
          h('p', {}, String(e && e.message ? e.message : e)),
          h('a', { class: 'btn', href: '#/' }, 'ホームへ'))
      )
    );
  }
}

window.addEventListener('hashchange', route);

// セット実施中の離脱を確認する
window.addEventListener('beforeunload', (e) => {
  if (currentRoute.startsWith('session')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

(async function boot() {
  await db.openDb();
  ctx.settings = await db.loadSettings();
  await db.saveSettings(ctx.settings); // 初回起動時に既定値を保存
  checkStorage();
  registerServiceWorker();
  await route();
})();
