// DOM生成ヘルパ（テキストは常にtextContent経由で挿入しXSSを避ける）

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k in el && k !== 'list') {
      el[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  appendChildren(f, children);
  return f;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** ヘッダ（戻るリンク付き） */
export function header(title, { back = null, actions = [] } = {}) {
  return h(
    'header',
    { class: 'app-header' },
    back ? h('a', { class: 'back', href: back, 'aria-label': '戻る' }, '←') : null,
    h('h1', {}, title),
    h('div', { class: 'header-actions' }, actions)
  );
}

/**
 * 画面下部の操作バー。スマホ・タブレットでは画面下端に固定表示される。
 * 子要素には barRow() で作った行を渡す。
 */
export function actionBar(...rows) {
  return h('div', { class: 'action-bar' }, rows);
}

/**
 * 操作バー内の1行。kind は 'main'（主操作）/ 'sub'（副操作）/ 'tools'（補助操作）。
 */
export function barRow(kind, ...children) {
  return h('div', { class: `bar-row ${kind}` }, children);
}

/** 操作バーの高さを --bar-h に反映する（トースト・更新バナーの重なり防止） */
export function syncBarHeight() {
  const bar = document.querySelector('.action-bar');
  const px = bar ? Math.ceil(bar.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--bar-h', `${px}px`);
}

let dialogHost = null;
function host() {
  if (!dialogHost) {
    dialogHost = h('div', { class: 'dialog-host' });
    document.body.appendChild(dialogHost);
  }
  return dialogHost;
}

/**
 * モーダルダイアログ。buttons は [{label, value, class}]。
 * @returns {Promise<any>} 選択されたvalue（背景クリック/キャンセルは null）
 */
export function dialog(title, body, buttons = [{ label: 'OK', value: true }]) {
  return new Promise((resolve) => {
    const close = (v) => {
      overlay.remove();
      resolve(v);
    };
    const overlay = h(
      'div',
      {
        class: 'overlay',
        onclick: (e) => {
          if (e.target === overlay) close(null);
        },
      },
      h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, title),
        h('div', { class: 'modal-body' }, body),
        h(
          'div',
          { class: 'modal-actions' },
          buttons.map((b) =>
            h('button', { class: b.class || 'btn', onclick: () => close(b.value) }, b.label)
          )
        )
      )
    );
    host().appendChild(overlay);
    const first = overlay.querySelector('input, textarea, select, button');
    if (first) first.focus();
  });
}

export function confirmDialog(title, message, okLabel = 'OK', okClass = 'btn primary') {
  return dialog(title, h('p', {}, message), [
    { label: 'キャンセル', value: false, class: 'btn' },
    { label: okLabel, value: true, class: okClass },
  ]).then((v) => v === true);
}

export async function promptDialog(title, { value = '', placeholder = '', label = '' } = {}) {
  const input = h('input', { type: 'text', value, placeholder, class: 'input' });
  const body = h('div', {}, label ? h('label', {}, label) : null, input);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const btn = input.closest('.modal').querySelector('.modal-actions .primary');
      btn.click();
    }
  });
  const ok = await dialog(title, body, [
    { label: 'キャンセル', value: false, class: 'btn' },
    { label: 'OK', value: true, class: 'btn primary' },
  ]);
  return ok ? input.value.trim() : null;
}

let toastTimer = null;
export function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast' });
    document.body.appendChild(el);
  }
  el.textContent = message;
  syncBarHeight();
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function navigate(hash) {
  location.hash = hash;
}

/** テキストファイルをダウンロードさせる */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function truncate(s, n = 40) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
