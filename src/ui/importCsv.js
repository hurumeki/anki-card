// CSVインポート画面（仕様4.3 / 7章）
import * as db from '../db.js';
import { parseImportCsv } from '../csv.js';
import { actionBar, barRow, h, header, navigate, toast } from './dom.js';

export async function renderImport(root, ctx, presetDeckId) {
  const decks = await db.listDecks();
  const view = h('div', { class: 'screen' });
  view.appendChild(
    header('CSVインポート', { back: presetDeckId ? `#/deck/${presetDeckId}` : '#/' })
  );

  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', class: 'input' });
  const destNew = h('input', {
    type: 'radio',
    name: 'dest',
    checked: !presetDeckId || decks.length === 0,
  });
  const destExisting = h('input', {
    type: 'radio',
    name: 'dest',
    checked: !!presetDeckId && decks.length > 0,
    disabled: decks.length === 0,
  });
  const newName = h('input', { class: 'input', type: 'text', placeholder: 'デッキ名' });
  const deckSel = h(
    'select',
    { class: 'input', disabled: decks.length === 0 },
    decks.map((d) =>
      h('option', { value: d.deckId, selected: d.deckId === presetDeckId }, d.name)
    )
  );
  const optUpdateCard = h('input', { type: 'checkbox' });
  const optImportReview = h('input', { type: 'checkbox' });
  const resultArea = h('div', { class: 'import-result' });
  const runBtn = h('button', { class: 'btn primary', disabled: true }, 'インポート実行');

  let parsed = null;

  view.appendChild(
    h(
      'div',
      { class: 'form' },
      h('div', { class: 'field' }, h('label', {}, 'CSVファイル'), fileInput),
      h(
        'div',
        { class: 'field' },
        h('label', {}, 'インポート先'),
        h('label', { class: 'check' }, destNew, '新規デッキ'),
        newName,
        h('label', { class: 'check' }, destExisting, '既存デッキ'),
        deckSel
      ),
      h(
        'div',
        { class: 'field' },
        h('label', {}, '既存IDが含まれる場合の更新オプション'),
        h('label', { class: 'check' }, optUpdateCard, '問題データを更新する'),
        h('label', { class: 'check' }, optImportReview, '回答状況を取り込む'),
        h('p', { class: 'hint' }, '両方OFFの場合、既存IDの行はスキップされます')
      ),
      resultArea
    )
  );
  view.appendChild(actionBar(barRow('main', runBtn)));

  fileInput.addEventListener('change', async () => {
    resultArea.replaceChildren();
    parsed = null;
    runBtn.disabled = true;
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const text = await file.text();
    const res = parseImportCsv(text, ctx.settings);
    if (res.errors.length > 0) {
      resultArea.appendChild(
        h(
          'div',
          { class: 'notice error' },
          h('strong', {}, `エラー ${res.errors.length} 件のためインポートを中止します`),
          h(
            'ul',
            { class: 'error-list' },
            res.errors.slice(0, 200).map((e) => h('li', {}, `${e.line} 行目：${e.message}`)),
            res.errors.length > 200 ? h('li', {}, `…他 ${res.errors.length - 200} 件`) : null
          )
        )
      );
      return;
    }
    parsed = res.rows;
    const withId = parsed.filter((r) => r.id).length;
    resultArea.appendChild(
      h(
        'div',
        { class: 'notice ok' },
        h('strong', {}, `検証OK：${parsed.length} 行`),
        h('p', {}, `id指定あり ${withId} 行 / id空欄 ${parsed.length - withId} 行`)
      )
    );
    runBtn.disabled = parsed.length === 0;
  });

  runBtn.addEventListener('click', async () => {
    if (!parsed) return;
    let deckId;
    if (destNew.checked) {
      const name = newName.value.trim();
      if (name === '') {
        toast('デッキ名を入力してください');
        return;
      }
      const deck = await db.createDeck(name);
      deckId = deck.deckId;
    } else {
      deckId = deckSel.value || null;
      if (!deckId) {
        toast('インポート先のデッキを選択してください');
        return;
      }
    }
    runBtn.disabled = true;
    try {
      const res = await db.applyImport(
        parsed,
        deckId,
        { updateCardData: optUpdateCard.checked, importReview: optImportReview.checked },
        ctx.settings
      );
      toast(`追加 ${res.added} / 更新 ${res.updated} / スキップ ${res.skipped}`);
      navigate(`#/deck/${deckId}`);
    } catch (e) {
      runBtn.disabled = false;
      resultArea.appendChild(
        h('div', { class: 'notice error' }, `インポートに失敗しました：${e.message}`)
      );
    }
  });

  root.appendChild(view);
}
