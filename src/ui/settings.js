// 設定画面（仕様4.6 / 6.2-4）
import * as db from '../db.js';
import { DEFAULT_SETTINGS, SETTING_FIELDS } from '../settings.js';
import { checkStorage, getStorageState } from '../pwa.js';
import { MODE_OPTIONS, loadMode, setMode } from '../mode.js';
import { DEFAULT_THEME, THEME_OPTIONS, loadThemePref, setTheme } from '../theme.js';
import { h, header, navigate, toast } from './dom.js';

export async function renderSettings(root, ctx) {
  const view = h('div', { class: 'screen' });
  view.appendChild(header('設定', { back: '#/' }));

  // 表示（テーマは端末ごとの設定なのでlocalStorageに保存する）
  view.appendChild(h('h2', { class: 'section' }, '表示'));
  view.appendChild(h('div', { class: 'form' }, buildModeField(), buildThemeField()));

  view.appendChild(h('h2', { class: 'section' }, '出題と採点'));
  const current = { ...ctx.settings };
  const form = h('div', { class: 'form' });

  const save = async (patch) => {
    Object.assign(current, patch);
    ctx.settings = await db.patchSettings(patch);
  };

  for (const field of SETTING_FIELDS) {
    const control = buildControl(field, current, save);
    form.appendChild(
      h(
        'div',
        { class: 'field' },
        h('label', {}, field.label),
        control.el,
        field.hint ? h('p', { class: 'hint' }, field.hint) : null,
        h(
          'button',
          {
            class: 'btn tiny',
            onclick: async () => {
              await save({ [field.key]: DEFAULT_SETTINGS[field.key] });
              control.set(DEFAULT_SETTINGS[field.key]);
              toast('既定値に戻しました');
            },
          },
          `既定値に戻す（${formatDefault(field)}）`
        )
      )
    );
  }

  view.appendChild(form);

  // ストレージ状態
  const storageBox = h('div', { class: 'notice' }, '確認中…');
  view.appendChild(h('h2', { class: 'section' }, 'データ保存状態'));
  view.appendChild(storageBox);
  view.appendChild(
    h(
      'p',
      { class: 'hint' },
      `最終エクスポート：${ctx.settings.lastExportedAt ? new Date(ctx.settings.lastExportedAt).toLocaleString() : '未エクスポート'}`
    )
  );
  root.appendChild(view);

  await checkStorage();
  const st = getStorageState();
  storageBox.replaceChildren();
  storageBox.classList.toggle('warn', !st.persisted);
  storageBox.appendChild(
    h('p', {}, st.persisted
      ? 'ストレージは永続化されています。'
      : 'ストレージが永続化されていません。ホーム画面に追加し、定期的にCSVエクスポートでバックアップしてください。')
  );
  if (st.estimate && st.estimate.usage !== undefined) {
    storageBox.appendChild(
      h(
        'p',
        { class: 'hint' },
        `使用量 ${(st.estimate.usage / 1024).toFixed(1)} KB / 割当 ${
          st.estimate.quota ? `${(st.estimate.quota / 1048576).toFixed(0)} MB` : '不明'
        }`
      )
    );
  }
}

function buildModeField() {
  const pref = loadMode();
  const sel = h(
    'select',
    {
      class: 'input',
      onchange: () => {
        if (setMode(sel.value) !== 'kid') return;
        // こどもモードではこの設定画面を開けないのでホームへ戻す
        toast('こどもモードにしました');
        navigate('#/');
      },
    },
    MODE_OPTIONS.map(([v, label]) => h('option', { value: v, selected: v === pref }, label))
  );
  return h(
    'div',
    { class: 'field' },
    h('label', {}, '表示モード'),
    sel,
    h(
      'p',
      { class: 'hint' },
      'こどもにすると、デッキを選んで暗記を始めるだけの画面になります。' +
        'カードの編集・CSV・この設定画面は開けません。'
    ),
    h('p', { class: 'hint' }, 'ホーム画面のタイトルを長押しすると、おとなに戻せます'),
    h('p', { class: 'hint' }, 'この端末のこのブラウザだけに保存されます')
  );
}

function buildThemeField() {
  const pref = loadThemePref();
  const sel = h(
    'select',
    { class: 'input', onchange: () => setTheme(sel.value) },
    THEME_OPTIONS.map(([v, label]) => h('option', { value: v, selected: v === pref }, label))
  );
  const defaultLabel = THEME_OPTIONS.find(([v]) => v === DEFAULT_THEME)[1];
  return h(
    'div',
    { class: 'field' },
    h('label', {}, 'テーマ'),
    sel,
    h('p', { class: 'hint' }, 'この端末のこのブラウザだけに保存されます'),
    h(
      'button',
      {
        class: 'btn tiny',
        onclick: () => {
          sel.value = setTheme(DEFAULT_THEME);
          toast('既定値に戻しました');
        },
      },
      `既定値に戻す（${defaultLabel}）`
    )
  );
}

function formatDefault(field) {
  const v = DEFAULT_SETTINGS[field.key];
  if (field.type === 'bool') return v ? 'ON' : 'OFF';
  if (field.type === 'enum') {
    const opt = field.options.find((o) => o[0] === v);
    return opt ? opt[1] : String(v);
  }
  return v === null ? '設定なし' : String(v);
}

function buildControl(field, current, save) {
  const value = current[field.key];
  if (field.type === 'bool') {
    const input = h('input', {
      type: 'checkbox',
      checked: !!value,
      onchange: () => save({ [field.key]: input.checked }),
    });
    return { el: h('label', { class: 'check' }, input, 'ON'), set: (v) => (input.checked = !!v) };
  }
  if (field.type === 'enum') {
    const sel = h(
      'select',
      { class: 'input', onchange: () => save({ [field.key]: sel.value }) },
      field.options.map(([v, label]) => h('option', { value: v, selected: v === value }, label))
    );
    return { el: sel, set: (v) => (sel.value = v) };
  }

  const step = field.type === 'int' ? '1' : '0.1';
  const input = h('input', {
    class: 'input',
    type: 'number',
    step,
    min: field.min,
    max: field.max,
    value: value === null ? '' : value,
    disabled: field.nullable && value === null,
  });
  const commit = () => {
    if (input.value === '') return;
    let n = field.type === 'int' ? parseInt(input.value, 10) : parseFloat(input.value);
    if (Number.isNaN(n)) {
      input.value = current[field.key];
      return;
    }
    if (field.min !== undefined) n = Math.max(field.min, n);
    if (field.max !== undefined) n = Math.min(field.max, n);
    input.value = n;
    save({ [field.key]: n });
  };
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);

  if (!field.nullable) return { el: input, set: (v) => (input.value = v) };

  const none = h('input', {
    type: 'checkbox',
    checked: value === null,
    onchange: () => {
      if (none.checked) {
        input.disabled = true;
        save({ [field.key]: null });
      } else {
        input.disabled = false;
        const v = input.value === '' ? DEFAULT_SETTINGS[field.key] : Number(input.value);
        input.value = v;
        save({ [field.key]: v });
      }
    },
  });
  return {
    el: h('div', { class: 'row gap' }, input, h('label', { class: 'check' }, none, '設定なし')),
    set: (v) => {
      none.checked = v === null;
      input.disabled = v === null;
      input.value = v === null ? '' : v;
    },
  };
}
