// カード作成／編集画面（仕様4.5）
import * as db from '../db.js';
import { CARD_TYPES, TYPE_LABEL, encodePair, parsePair } from '../format.js';
import { actionBar, barRow, confirmDialog, h, header, navigate, toast } from './dom.js';

const NEEDS = {
  single: ['answer'],
  choice: ['choices', 'answerIndex'],
  matching: ['choices'],
  ordering: ['choices'],
  anagram: ['answer', 'choices'],
};

export async function renderCardEdit(root, ctx, cardId, newDeckId) {
  const isNew = cardId === null;
  const decks = await db.listDecks();
  let card;
  let review = null;
  if (isNew) {
    card = db.newCard(newDeckId, { type: 'single' });
  } else {
    card = await db.getCard(cardId);
    if (!card) {
      navigate('#/');
      return;
    }
    review = await db.getReviewState(cardId);
  }

  // 編集用の作業状態
  const model = {
    type: card.type,
    question: card.question,
    choices: (card.choices || []).slice(),
    answerIndex: card.answerIndex,
    answer: card.answer || '',
    explanation: card.explanation || '',
    deckId: card.deckId ?? null,
    checked: review ? !!review.checked : false,
  };

  const view = h('div', { class: 'screen' });
  const backHref = model.deckId ? `#/deck/${model.deckId}` : '#/unassigned';
  view.appendChild(header(isNew ? 'カード作成' : 'カード編集', { back: backHref }));

  const typeSel = h(
    'select',
    { class: 'input' },
    CARD_TYPES.map((t) =>
      h('option', { value: t, selected: t === model.type }, TYPE_LABEL[t])
    )
  );
  const question = h('textarea', { class: 'input', rows: 3, value: model.question });
  const answer = h('input', { class: 'input', type: 'text', value: model.answer });
  const explanation = h('textarea', { class: 'input', rows: 3, value: model.explanation });
  const checked = h('input', { type: 'checkbox', checked: model.checked });
  const deckSel = h(
    'select',
    { class: 'input' },
    h('option', { value: '', selected: model.deckId === null }, '（デッキ未所属）'),
    decks.map((d) =>
      h('option', { value: d.deckId, selected: d.deckId === model.deckId }, d.name)
    )
  );

  const choiceArea = h('div', { class: 'choice-area' });
  const answerField = h('div', { class: 'field' }, h('label', {}, '解答'), answer);
  const anagramHint = h('p', { class: 'hint' }, '');

  function syncModelFromInputs() {
    model.question = question.value;
    model.answer = answer.value;
    model.explanation = explanation.value;
    model.checked = checked.checked;
    model.deckId = deckSel.value === '' ? null : deckSel.value;
  }

  function renderChoices() {
    choiceArea.replaceChildren();
    const t = model.type;
    if (t === 'single') {
      anagramHint.textContent = '';
      return;
    }
    if (t === 'anagram') {
      anagramHint.textContent =
        '空欄の場合は解答を1文字ずつ分解して表示します。カンマ区切りで指定すると、その単位で表示します（例：ふ,じ,さ,ん）。';
      const input = h('input', {
        class: 'input',
        type: 'text',
        value: model.choices[0] || '',
        placeholder: 'ふ,じ,さ,ん（任意）',
        oninput: (e) => {
          const v = e.target.value.trim();
          model.choices = v === '' ? [] : [v];
        },
      });
      choiceArea.appendChild(
        h('div', { class: 'field' }, h('label', {}, '表示トークン（カンマ区切り・任意）'), input)
      );
      return;
    }
    anagramHint.textContent = '';

    const label =
      t === 'choice' ? '選択肢（正解を選択）' : t === 'matching' ? '組み合わせ（左 / 右）' : '選択肢（登録順＝正解順）';
    const list = h('ul', { class: 'choice-list' });

    model.choices.forEach((choiceStr, i) => {
      let inputs;
      if (t === 'matching') {
        const pair = parsePair(choiceStr) || { left: choiceStr, right: '' };
        const left = h('input', {
          class: 'input',
          type: 'text',
          value: pair.left,
          placeholder: '左',
        });
        const right = h('input', {
          class: 'input',
          type: 'text',
          value: pair.right,
          placeholder: '右',
        });
        const update = () => {
          model.choices[i] = encodePair(left.value, right.value);
        };
        left.addEventListener('input', update);
        right.addEventListener('input', update);
        inputs = h('div', { class: 'pair' }, left, h('span', { class: 'sep' }, ':'), right);
      } else {
        const input = h('input', {
          class: 'input',
          type: 'text',
          value: choiceStr,
          placeholder: `選択肢${i + 1}`,
          oninput: (e) => {
            model.choices[i] = e.target.value;
          },
        });
        inputs = input;
      }

      const controls = h(
        'div',
        { class: 'choice-controls' },
        t === 'choice'
          ? h('label', { class: 'check' },
              h('input', {
                type: 'radio',
                name: 'answerIndex',
                checked: model.answerIndex === i,
                onchange: () => {
                  model.answerIndex = i;
                },
              }),
              '正解'
            )
          : null,
        h('button', {
          class: 'btn tiny', title: '上へ', disabled: i === 0,
          onclick: () => {
            [model.choices[i - 1], model.choices[i]] = [model.choices[i], model.choices[i - 1]];
            if (model.answerIndex === i) model.answerIndex = i - 1;
            else if (model.answerIndex === i - 1) model.answerIndex = i;
            renderChoices();
          },
        }, '↑'),
        h('button', {
          class: 'btn tiny', title: '下へ', disabled: i === model.choices.length - 1,
          onclick: () => {
            [model.choices[i + 1], model.choices[i]] = [model.choices[i], model.choices[i + 1]];
            if (model.answerIndex === i) model.answerIndex = i + 1;
            else if (model.answerIndex === i + 1) model.answerIndex = i;
            renderChoices();
          },
        }, '↓'),
        h('button', {
          class: 'btn tiny danger', title: '削除',
          onclick: () => {
            model.choices.splice(i, 1);
            if (model.answerIndex === i) model.answerIndex = null;
            else if (model.answerIndex !== null && model.answerIndex > i) model.answerIndex--;
            renderChoices();
          },
        }, '×')
      );
      list.appendChild(h('li', { class: 'choice-row' }, inputs, controls));
    });

    choiceArea.appendChild(
      h(
        'div',
        { class: 'field' },
        h('label', {}, label),
        list,
        model.choices.length < 6
          ? h(
              'button',
              {
                class: 'btn small',
                onclick: () => {
                  model.choices.push('');
                  renderChoices();
                },
              },
              '＋ 選択肢を追加'
            )
          : h('p', { class: 'hint' }, '選択肢は最大6件です'),
        t === 'matching'
          ? h('p', { class: 'hint' }, '「:」「\\」はそのまま入力できます（保存時に自動エスケープ）')
          : null
      )
    );
  }

  function updateVisibility() {
    const t = model.type;
    answerField.style.display = t === 'single' || t === 'anagram' ? '' : 'none';
    renderChoices();
  }

  typeSel.addEventListener('change', async () => {
    const nextType = typeSel.value;
    syncModelFromInputs();
    const lost = losingFields(model, nextType);
    if (lost.length > 0) {
      const ok = await confirmDialog(
        '形式の変更',
        `形式を変更すると次の入力内容は使用されなくなります：${lost.join(' / ')}`,
        '変更する'
      );
      if (!ok) {
        typeSel.value = model.type;
        return;
      }
    }
    model.type = nextType;
    if (nextType !== 'choice') model.answerIndex = null;
    if (nextType === 'anagram' && model.choices.length > 1) model.choices = [];
    if (nextType === 'single') model.choices = [];
    updateVisibility();
  });

  view.appendChild(
    h(
      'div',
      { class: 'form' },
      h('div', { class: 'field' }, h('label', {}, '形式'), typeSel),
      h('div', { class: 'field' }, h('label', {}, '問題文'), question),
      choiceArea,
      answerField,
      anagramHint,
      h('div', { class: 'field' }, h('label', {}, '解説'), explanation),
      h('div', { class: 'field' }, h('label', {}, 'デッキ'), deckSel),
      h('div', { class: 'field' }, h('label', { class: 'check' }, checked, 'チェックを付ける')),
      review
        ? h(
            'div',
            { class: 'field review-info' },
            h('label', {}, '回答状況'),
            h(
              'p',
              { class: 'hint' },
              `次回 ${review.dueDate} / 連続正解 ${review.repetition} / 間隔 ${review.interval}日 / ` +
                `EF ${review.easiness.toFixed(2)} / 回答 ${review.totalCount}` +
                `（完答 ${review.correctCount} ・ 部分 ${review.partialCount}）`
            )
          )
        : null
    )
  );

  const saveBtn = h('button', { class: 'btn primary' }, '保存');
  view.appendChild(
    actionBar(
      barRow(
        'main',
        !isNew
          ? h(
              'button',
              {
                class: 'btn danger',
                onclick: async () => {
                  const ok = await confirmDialog(
                    'カードの削除',
                    'このカードと回答状況を削除します。取り消せません。',
                    '削除する',
                    'btn danger'
                  );
                  if (!ok) return;
                  await db.deleteCard(card.cardId);
                  toast('カードを削除しました');
                  navigate(backHref);
                },
              },
              '削除'
            )
          : null,
        saveBtn
      )
    )
  );

  saveBtn.addEventListener('click', async () => {
    syncModelFromInputs();
    const errors = validate(model);
    if (errors.length > 0) {
      toast(errors[0]);
      return;
    }
    const cleaned = model.choices.map((c) => c.trim()).filter((c) => c !== '');
    const payload = {
      type: model.type,
      question: model.question.trim(),
      choices: model.type === 'single' ? [] : cleaned,
      answerIndex: model.type === 'choice' ? model.answerIndex : null,
      answer: model.type === 'single' || model.type === 'anagram' ? model.answer.trim() : '',
      explanation: model.explanation,
    };
    if (isNew) {
      const created = db.newCard(model.deckId, payload);
      await db.createCard(created, ctx.settings);
      if (model.checked) await db.setChecked(created.cardId, true);
      toast('カードを作成しました');
      navigate(model.deckId ? `#/deck/${model.deckId}` : '#/unassigned');
    } else {
      Object.assign(card, payload, { deckId: model.deckId });
      await db.updateCard(card);
      await db.setChecked(card.cardId, model.checked);
      toast('保存しました');
      navigate(model.deckId ? `#/deck/${model.deckId}` : '#/unassigned');
    }
  });

  updateVisibility();
  root.appendChild(view);
}

/** 形式変更で使われなくなる入力項目 */
function losingFields(model, nextType) {
  const next = NEEDS[nextType] || [];
  const lost = [];
  const filled = model.choices.some((c) => c.trim() !== '');
  if (filled && !next.includes('choices')) lost.push('選択肢');
  if (filled && nextType === 'anagram' && model.choices.length > 1) lost.push('選択肢（2件目以降）');
  if (model.answer.trim() !== '' && !next.includes('answer')) lost.push('解答');
  if (model.answerIndex !== null && !next.includes('answerIndex')) lost.push('正解の指定');
  return [...new Set(lost)];
}

/** 保存時のバリデーション（CSVの規則7.3に準拠） */
export function validate(model) {
  const errors = [];
  const choices = model.choices.map((c) => c.trim()).filter((c) => c !== '');
  if (model.question.trim() === '') errors.push('問題文を入力してください');
  if (choices.length > 6) errors.push('選択肢は最大6件です');
  if (model.type === 'choice') {
    if (choices.length < 2) errors.push('多肢選択の選択肢は2件以上必要です');
    if (model.answerIndex === null || model.answerIndex >= choices.length) {
      errors.push('正解の選択肢を指定してください');
    }
  }
  if (model.type === 'ordering' && choices.length < 2) {
    errors.push('順番当ての選択肢は2件以上必要です');
  }
  if (model.type === 'matching') {
    if (choices.length < 1) errors.push('組み合わせは1件以上必要です');
    for (const c of choices) {
      const pair = parsePair(c);
      if (!pair || pair.left === '' || pair.right === '') {
        errors.push('組み合わせの左右を入力してください');
        break;
      }
    }
  }
  if ((model.type === 'single' || model.type === 'anagram') && model.answer.trim() === '') {
    errors.push('解答を入力してください');
  }
  if (model.type === 'anagram' && choices.length > 1) {
    errors.push('並べ替えのトークン指定は1件までです');
  }
  return errors;
}
