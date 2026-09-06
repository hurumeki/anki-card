// ホーム／デッキ一覧画面（仕様4.1 / 4.2）
import * as db from '../db.js';
import { BACKUP_WARN_DAYS } from '../settings.js';
import { daysBetween } from '../util.js';
import { confirmDialog, dialog, h, navigate, promptDialog, toast, truncate } from './dom.js';
import { installGuide, isStandalone } from '../pwa.js';

export async function renderHome(root, ctx) {
  const settings = ctx.settings;
  const [decks, { stats, unassigned }] = await Promise.all([db.listDecks(), db.deckStats()]);

  const view = h('div', { class: 'screen' });

  view.appendChild(
    h(
      'header',
      { class: 'app-header' },
      h('h1', {}, '暗記アプリ'),
      h(
        'div',
        { class: 'header-actions' },
        h('a', { class: 'btn small', href: '#/settings' }, '設定')
      )
    )
  );

  if (!isStandalone()) view.appendChild(installGuide());

  const warnDays =
    settings.lastExportedAt === null ? Infinity : daysBetween(settings.lastExportedAt);
  if (warnDays >= BACKUP_WARN_DAYS) {
    view.appendChild(
      h(
        'div',
        { class: 'notice warn' },
        h('strong', {}, 'バックアップをおすすめします'),
        h(
          'p',
          {},
          settings.lastExportedAt === null
            ? 'まだ一度もCSVエクスポートしていません。カード一覧画面からエクスポートできます。'
            : `最終エクスポートから${warnDays}日経過しています。カード一覧画面からエクスポートできます。`
        )
      )
    );
  }

  const list = h('ul', { class: 'deck-list' });
  if (decks.length === 0) {
    list.appendChild(h('li', { class: 'empty' }, 'デッキがありません。新規作成してください。'));
  }
  for (const deck of decks) {
    const st = stats.get(deck.deckId) || { count: 0, due: 0 };
    list.appendChild(
      h(
        'li',
        { class: 'deck-item' },
        h(
          'a',
          { class: 'deck-main', href: `#/deck/${deck.deckId}` },
          h('span', { class: 'deck-name' }, truncate(deck.name, 30)),
          h(
            'span',
            { class: 'deck-meta' },
            `${st.count} 枚`,
            st.due > 0 ? h('span', { class: 'badge due' }, `本日 ${st.due}`) : null
          )
        ),
        h(
          'div',
          { class: 'deck-actions' },
          h(
            'button',
            { class: 'btn primary small', onclick: () => navigate(`#/session/${deck.deckId}`) },
            '暗記開始'
          ),
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => deckMenu(deck, ctx),
              'aria-label': 'デッキ操作',
            },
            '⋯'
          )
        )
      )
    );
  }
  view.appendChild(list);

  view.appendChild(
    h(
      'div',
      { class: 'row gap' },
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            const name = await promptDialog('デッキを作成', { label: 'デッキ名' });
            if (!name) return;
            const deck = await db.createDeck(name);
            toast('デッキを作成しました');
            navigate(`#/deck/${deck.deckId}`);
          },
        },
        '＋ 新規デッキ'
      ),
      h('a', { class: 'btn', href: '#/import' }, 'CSVインポート')
    )
  );

  view.appendChild(
    h(
      'div',
      { class: 'links' },
      h('a', { href: '#/unassigned' }, `デッキ未所属カード（${unassigned}）`)
    )
  );

  root.appendChild(view);
}

async function deckMenu(deck, ctx) {
  const choice = await dialog(
    truncate(deck.name, 24),
    h('p', {}, '操作を選択してください。'),
    [
      { label: '閉じる', value: null, class: 'btn' },
      { label: '名称変更', value: 'rename', class: 'btn' },
      { label: '削除', value: 'delete', class: 'btn danger' },
    ]
  );
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

export async function deleteDeckFlow(deck, ctx) {
  const answer = await dialog(
    'デッキの削除',
    h('p', {}, 'このデッキのカードも削除しますか？'),
    [
      { label: 'キャンセル', value: null, class: 'btn' },
      { label: 'カードを残す', value: 'keep', class: 'btn' },
      { label: 'カードも削除', value: 'cards', class: 'btn danger' },
    ]
  );
  if (!answer) return false;
  if (answer === 'cards') {
    const ok = await confirmDialog(
      '確認',
      'デッキとカードを完全に削除します。取り消せません。よろしいですか？',
      '削除する',
      'btn danger'
    );
    if (!ok) return false;
  }
  await db.deleteDeck(deck.deckId, answer === 'cards');
  toast(answer === 'cards' ? 'デッキとカードを削除しました' : 'デッキを削除しました');
  if (ctx) navigate('#/');
  return true;
}
