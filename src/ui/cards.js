// カード一覧画面 / デッキ未所属カード画面（仕様4.4 / 4.8）
import * as db from '../db.js';
import { cardToRow, toCsv } from '../csv.js';
import { TYPE_LABEL } from '../format.js';
import { downloadText, h, header, navigate, promptDialog, toast, truncate } from './dom.js';
import { deleteDeckFlow } from './home.js';
import { nowIso, today } from '../util.js';

const filterState = { q: '', checkedOnly: false };

/**
 * @param {string|null} deckId null の場合はデッキ未所属カード画面
 */
export async function renderCardList(root, ctx, deckId) {
  const unassigned = deckId === null;
  const deck = unassigned ? null : await db.getDeck(deckId);
  if (!unassigned && !deck) {
    navigate('#/');
    return;
  }
  const entries = await db.listCards(deckId);
  const view = h('div', { class: 'screen' });

  const actions = [];
  if (!unassigned) {
    actions.push(
      h(
        'button',
        { class: 'btn small', onclick: () => deckSettingsMenu(deck, ctx) },
        'デッキ操作'
      )
    );
  }
  view.appendChild(
    header(unassigned ? 'デッキ未所属カード' : truncate(deck.name, 20), {
      back: '#/',
      actions,
    })
  );

  if (!unassigned) {
    view.appendChild(
      h(
        'div',
        { class: 'row gap' },
        h(
          'button',
          { class: 'btn primary', onclick: () => navigate(`#/session/${deckId}`) },
          '暗記開始'
        ),
        h('a', { class: 'btn', href: `#/card/new/${deckId}` }, '＋ カード作成'),
        h('a', { class: 'btn', href: `#/import/${deckId}` }, 'CSVインポート')
      )
    );
  } else {
    view.appendChild(
      h(
        'div',
        { class: 'row gap' },
        h('a', { class: 'btn', href: '#/card/new/none' }, '＋ カード作成'),
        h('p', { class: 'hint' }, '未所属カードは暗記セットの出題対象外です')
      )
    );
  }

  const search = h('input', {
    type: 'search',
    class: 'input',
    placeholder: '問題文・選択肢・解答・解説を検索',
    value: filterState.q,
  });
  const checkedOnly = h('input', { type: 'checkbox', checked: filterState.checkedOnly });
  const listEl = h('ul', { class: 'card-list' });
  const countEl = h('span', { class: 'hint' });

  const exportBtn = h('button', { class: 'btn small' }, 'CSVエクスポート');

  view.appendChild(
    h(
      'div',
      { class: 'filters' },
      search,
      h(
        'div',
        { class: 'row space' },
        h('label', { class: 'check' }, checkedOnly, 'チェック付きのみ'),
        h('div', { class: 'row gap' }, countEl, exportBtn)
      )
    )
  );
  view.appendChild(listEl);
  root.appendChild(view);

  const matches = () => {
    const q = filterState.q.trim().toLowerCase();
    return entries.filter(({ card, review }) => {
      if (filterState.checkedOnly && !(review && review.checked)) return false;
      if (q === '') return true;
      const hay = [card.question, card.answer, card.explanation, ...(card.choices || [])]
        .join('\n')
        .toLowerCase();
      return hay.includes(q);
    });
  };

  const draw = () => {
    const rows = matches().sort((a, b) => a.card.createdAt.localeCompare(b.card.createdAt));
    listEl.replaceChildren();
    countEl.textContent = `${rows.length} / ${entries.length} 件`;
    if (rows.length === 0) {
      listEl.appendChild(h('li', { class: 'empty' }, '該当するカードがありません'));
      return;
    }
    for (const { card, review } of rows) {
      listEl.appendChild(
        h(
          'li',
          { class: 'card-item' },
          h(
            'a',
            { href: `#/card/${card.cardId}` },
            h(
              'div',
              { class: 'card-item-main' },
              h('span', { class: 'q' }, truncate(card.question, 48) || '（問題文なし）'),
              h(
                'span',
                { class: 'card-meta' },
                h('span', { class: 'tag' }, TYPE_LABEL[card.type] || card.type),
                review && review.checked ? h('span', { class: 'tag check' }, '✓ チェック') : null,
                h(
                  'span',
                  { class: `tag due${review && review.dueDate <= today() ? ' hot' : ''}` },
                  review ? `次回 ${review.dueDate}` : '次回 -'
                )
              )
            )
          )
        )
      );
    }
  };

  search.addEventListener('input', () => {
    filterState.q = search.value;
    draw();
  });
  checkedOnly.addEventListener('change', () => {
    filterState.checkedOnly = checkedOnly.checked;
    draw();
  });
  exportBtn.addEventListener('click', async () => {
    const rows = matches().map(({ card, review }) => cardToRow(card, review));
    if (rows.length === 0) {
      toast('エクスポート対象がありません');
      return;
    }
    const base = unassigned ? '未所属カード' : deck.name;
    const safe = base.replace(/[\\/:*?"<>|]/g, '_');
    downloadText(`${safe}_${today()}.csv`, toCsv(rows));
    ctx.settings = await db.patchSettings({ lastExportedAt: nowIso() });
    toast(`${rows.length} 件をエクスポートしました`);
  });

  draw();
}

async function deckSettingsMenu(deck, ctx) {
  const { dialog } = await import('./dom.js');
  const choice = await dialog(truncate(deck.name, 24), h('p', {}, '操作を選択してください。'), [
    { label: '閉じる', value: null, class: 'btn' },
    { label: '名称変更', value: 'rename', class: 'btn' },
    { label: '削除', value: 'delete', class: 'btn danger' },
  ]);
  if (choice === 'rename') {
    const name = await promptDialog('デッキ名の変更', { value: deck.name, label: 'デッキ名' });
    if (name) {
      await db.renameDeck(deck.deckId, name);
      toast('デッキ名を変更しました');
      ctx.rerender();
    }
  } else if (choice === 'delete') {
    await deleteDeckFlow(deck, ctx);
  }
}
