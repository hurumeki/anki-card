// カード画面（セット実施中）とリザルト画面（仕様4.7 / 4.9）
import * as db from '../db.js';
import { anagramTokens, parsePairs } from '../format.js';
import { matchingCorrectCount, matchingScore, judgeScore, orderingScore } from '../scoring.js';
import { startSession } from '../session.js';
import { shuffle } from '../util.js';
import { setSessionActive } from '../pwa.js';
import { confirmDialog, h, navigate, toast, truncate } from './dom.js';

const RESULT_LABEL = {
  correct: '完答',
  partial: '部分正解',
  incorrect: '不正解',
  skipped: 'スキップ',
};

let active = null; // { session, deckId }

export function hasActiveSession() {
  return active !== null;
}

export async function renderQuiz(root, ctx, deckId) {
  const session = await startSession(deckId, ctx.settings);
  if (session.length === 0) {
    setSessionActive(false);
    root.appendChild(
      h(
        'div',
        { class: 'screen' },
        h('header', { class: 'app-header' }, h('a', { class: 'back', href: '#/' }, '←'), h('h1', {}, '暗記')),
        h(
          'div',
          { class: 'notice' },
          h('strong', {}, '出題対象のカードがありません'),
          h('p', {}, ctx.settings.scope === 'review'
            ? '本日復習するカードはありません。設定の出題範囲を「全て」にすると、期日に関係なく出題できます。'
            : 'このデッキにはカードがありません。')
        ),
        h('div', { class: 'row gap' },
          h('a', { class: 'btn', href: `#/deck/${deckId}` }, 'カード一覧へ'),
          h('a', { class: 'btn', href: '#/settings' }, '設定'))
      )
    );
    return;
  }
  active = { session, deckId };
  setSessionActive(true);
  const view = h('div', { class: 'screen quiz' });
  root.appendChild(view);
  drawCurrent(view, ctx, session, deckId);
}

function finish(view, ctx, session, deckId) {
  setSessionActive(false);
  active = null;
  renderResult(view, ctx, session, deckId);
}

function drawCurrent(view, ctx, session, deckId) {
  if (session.isFinished) {
    finish(view, ctx, session, deckId);
    return;
  }
  const card = session.current;
  const item = session.currentItem;
  view.replaceChildren();

  view.appendChild(
    h(
      'div',
      { class: 'quiz-top' },
      h('span', { class: 'progress' }, `${session.index + 1} / ${session.length}`),
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            const ok = await confirmDialog(
              'セットの中断',
              'ここまでの回答でリザルトを表示します。よろしいですか？',
              '中断する'
            );
            if (ok) finish(view, ctx, session, deckId);
          },
        },
        '中断する'
      )
    )
  );

  const body = h('div', { class: 'quiz-body' });
  body.appendChild(h('p', { class: 'question' }, card.question));
  const answerArea = h('div', { class: 'answer-area' });
  const resultArea = h('div', { class: 'result-area' });
  body.appendChild(answerArea);
  body.appendChild(resultArea);
  view.appendChild(body);

  const settings = ctx.settings;

  const undoBtn = h(
    'button',
    {
      class: 'btn small',
      disabled: !session.canUndo(),
      onclick: async () => {
        const moved = await session.undo();
        if (!moved) {
          toast('これ以上戻れません');
          return;
        }
        drawCurrent(view, ctx, session, deckId);
      },
    },
    'やり直し'
  );

  const showJudgement = async (result, score, detail) => {
    await session.answer(result, score);
    renderJudgement(resultArea, card, result, score, detail, session, view, ctx, deckId);
    answerArea.classList.add('answered');
    // 二重回答を防ぐため回答UIを操作不可にする
    answerArea.querySelectorAll('button, select, input').forEach((el) => {
      el.disabled = true;
    });
    undoBtn.disabled = !session.canUndo();
  };

  buildAnswerUI(answerArea, card, settings, showJudgement);

  // 画面内機能
  const checkBtn = h('button', { class: 'btn small' }, 'チェック');
  db.getReviewState(card.cardId).then((rs) => {
    if (rs && rs.checked) checkBtn.classList.add('on');
  });
  checkBtn.addEventListener('click', async () => {
    const rs = await db.getReviewState(card.cardId);
    const next = await db.setChecked(card.cardId, !(rs && rs.checked));
    checkBtn.classList.toggle('on', !!(next && next.checked));
    toast(next && next.checked ? 'チェックを付けました' : 'チェックを外しました');
  });

  view.appendChild(
    h(
      'div',
      { class: 'quiz-tools' },
      undoBtn,
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            await session.skip();
            session.next();
            drawCurrent(view, ctx, session, deckId);
          },
        },
        'スキップ'
      ),
      checkBtn
    )
  );

  // 回答済みの問題に戻ってきた場合は判定結果を復元表示する
  if (item.result !== 'pending' && item.result !== 'skipped') {
    answerArea.classList.add('answered');
    renderJudgement(resultArea, card, item.result, item.score, null, session, view, ctx, deckId);
  }
}

/** 形式ごとの回答UI（仕様4.7） */
function buildAnswerUI(area, card, settings, submit) {
  area.replaceChildren();
  if (card.type === 'single' || card.type === 'anagram') {
    if (card.type === 'anagram') {
      const tokens = shuffle(anagramTokens(card));
      area.appendChild(
        h('div', { class: 'tokens' }, tokens.map((t) => h('span', { class: 'token' }, t)))
      );
    }
    const selfArea = h('div', { class: 'self-judge' });
    const reveal = h(
      'button',
      { class: 'btn primary' },
      '解答を表示'
    );
    reveal.addEventListener('click', () => {
      reveal.remove();
      selfArea.appendChild(h('p', { class: 'shown-answer' }, card.answer));
      selfArea.appendChild(
        h(
          'div',
          { class: 'row gap' },
          h('button', {
            class: 'btn correct',
            onclick: (e) => {
              e.currentTarget.classList.add('chosen');
              submit('correct', null);
            },
          }, '○ 正解'),
          h('button', {
            class: 'btn wrong',
            onclick: (e) => {
              e.currentTarget.classList.add('chosen');
              submit('incorrect', null);
            },
          }, '× 不正解')
        )
      );
    });
    area.appendChild(reveal);
    area.appendChild(selfArea);
    return;
  }

  if (card.type === 'choice') {
    const order = shuffle(card.choices.map((_, i) => i));
    const list = h('ul', { class: 'choices' });
    order.forEach((originalIndex) => {
      const btn = h(
        'button',
        {
          class: 'choice-btn',
          onclick: () => {
            list.querySelectorAll('button').forEach((b) => (b.disabled = true));
            btn.classList.add(originalIndex === card.answerIndex ? 'correct' : 'wrong');
            const correctBtn = list.querySelector(`[data-index="${card.answerIndex}"]`);
            if (correctBtn) correctBtn.classList.add('correct');
            submit(originalIndex === card.answerIndex ? 'correct' : 'incorrect', null);
          },
          dataset: { index: String(originalIndex) },
        },
        card.choices[originalIndex]
      );
      list.appendChild(h('li', {}, btn));
    });
    area.appendChild(list);
    return;
  }

  if (card.type === 'matching') {
    const pairs = parsePairs(card.choices).map((p, i) => p || { left: card.choices[i], right: '' });
    const leftOrder = shuffle(pairs.map((_, i) => i));
    const rightOrder = shuffle(pairs.map((_, i) => i));
    const answers = new Array(pairs.length).fill(null);
    const rows = h('ul', { class: 'matching' });
    const selects = [];
    leftOrder.forEach((li) => {
      const sel = h(
        'select',
        { class: 'input' },
        h('option', { value: '', selected: true }, '選択…'),
        rightOrder.map((ri) => h('option', { value: String(ri) }, pairs[ri].right))
      );
      selects.push({ sel, li });
      sel.addEventListener('change', () => {
        answers[li] = sel.value === '' ? null : Number(sel.value);
        if (answers.every((a) => a !== null)) {
          selects.forEach((s) => (s.sel.disabled = true));
          const score = matchingScore(answers, pairs.map((_, i) => i));
          const result = judgeScore(score, settings.partialThreshold);
          // 誤ったペアをハイライト
          selects.forEach((s) => {
            const row = s.sel.closest('li');
            row.classList.add(answers[s.li] === s.li ? 'ok' : 'ng');
            if (answers[s.li] !== s.li) {
              row.appendChild(h('span', { class: 'correction' }, `正：${pairs[s.li].right}`));
            }
          });
          submit(result, score, {
            kind: 'matching',
            correct: matchingCorrectCount(answers, pairs.map((_, i) => i)),
            total: pairs.length,
          });
        }
      });
      rows.appendChild(
        h('li', { class: 'matching-row' }, h('span', { class: 'left' }, pairs[li].left), sel)
      );
    });
    area.appendChild(rows);
    return;
  }

  if (card.type === 'ordering') {
    const order = shuffle(card.choices.map((_, i) => i));
    const picked = [];
    const pool = h('ul', { class: 'ordering-pool' });
    const seq = h('ol', { class: 'ordering-seq' });

    const redraw = () => {
      pool.replaceChildren();
      seq.replaceChildren();
      order.forEach((oi) => {
        if (picked.includes(oi)) return;
        pool.appendChild(
          h(
            'li',
            {},
            h(
              'button',
              {
                class: 'choice-btn',
                onclick: () => {
                  picked.push(oi);
                  if (picked.length === card.choices.length) judge();
                  else redraw();
                },
              },
              card.choices[oi]
            )
          )
        );
      });
      picked.forEach((oi, pos) => {
        seq.appendChild(
          h(
            'li',
            {},
            h(
              'button',
              {
                class: 'choice-btn picked',
                onclick: () => {
                  picked.splice(pos, 1);
                  redraw();
                },
              },
              card.choices[oi]
            )
          )
        );
      });
      if (picked.length > 0 && picked.length < card.choices.length) {
        seq.appendChild(h('li', { class: 'hint' }, '（タップで取り消し）'));
      }
    };

    const judge = () => {
      const score = orderingScore(picked, settings.orderingScoreMethod);
      const result = judgeScore(score, settings.partialThreshold);
      pool.replaceChildren();
      seq.replaceChildren();
      picked.forEach((oi, pos) => {
        seq.appendChild(
          h(
            'li',
            { class: oi === pos ? 'ok' : 'ng' },
            h('span', { class: 'choice-btn static' }, card.choices[oi]),
            oi === pos ? null : h('span', { class: 'correction' }, `正：${card.choices[pos]}`)
          )
        );
      });
      const n = picked.length;
      submit(result, score, {
        kind: 'ordering',
        method: settings.orderingScoreMethod,
        correct:
          settings.orderingScoreMethod === 'position'
            ? picked.filter((oi, pos) => oi === pos).length
            : Math.round(score * ((n * (n - 1)) / 2)),
        total: settings.orderingScoreMethod === 'position' ? n : (n * (n - 1)) / 2,
      });
    };

    area.appendChild(h('p', { class: 'hint' }, '正しい順にタップしてください'));
    area.appendChild(seq);
    area.appendChild(pool);
    redraw();
    return;
  }
}

/** 判定結果・解答・解説の表示 */
function renderJudgement(area, card, result, score, detail, session, view, ctx, deckId) {
  area.replaceChildren();
  area.appendChild(
    h(
      'div',
      { class: `judgement ${result}` },
      h('span', { class: 'label' }, RESULT_LABEL[result]),
      score === null || score === undefined
        ? null
        : h('span', { class: 'score' }, scoreText(score, detail, ctx.settings))
    )
  );
  area.appendChild(answerBlock(card));
  if (card.explanation && card.explanation.trim() !== '') {
    area.appendChild(h('div', { class: 'explanation' }, h('h3', {}, '解説'), h('p', {}, card.explanation)));
  }
  const item = session.currentItem;
  if (item && item.nextDueDate) {
    area.appendChild(h('p', { class: 'hint' }, `次回出題日：${item.nextDueDate}`));
  }
  area.appendChild(
    h(
      'div',
      { class: 'row gap' },
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            session.next();
            drawCurrent(view, ctx, session, deckId);
          },
        },
        session.index + 1 >= session.length ? 'リザルトへ' : '次へ'
      )
    )
  );
}

export function scoreText(score, detail, settings) {
  const pct = Math.round(score * 100);
  if (detail && detail.kind === 'matching') {
    return `${detail.correct}/${detail.total} 正解（${pct}%）`;
  }
  if (detail && detail.kind === 'ordering') {
    const name = detail.method === 'position' ? '位置一致率' : '順序一致率';
    return `${name} ${pct}%（${detail.correct}/${detail.total}）`;
  }
  return `一致率 ${pct}%`;
}

/** 正解内容の表示 */
function answerBlock(card) {
  const box = h('div', { class: 'answer-block' }, h('h3', {}, '解答'));
  if (card.type === 'choice') {
    box.appendChild(h('p', {}, card.choices[card.answerIndex] ?? ''));
  } else if (card.type === 'matching') {
    const pairs = parsePairs(card.choices);
    box.appendChild(
      h(
        'ul',
        { class: 'answer-pairs' },
        pairs.map((p, i) =>
          h('li', {}, `${p ? p.left : card.choices[i]} — ${p ? p.right : ''}`)
        )
      )
    );
  } else if (card.type === 'ordering') {
    box.appendChild(h('ol', { class: 'answer-order' }, card.choices.map((c) => h('li', {}, c))));
  } else {
    box.appendChild(h('p', {}, card.answer));
  }
  return box;
}

/** リザルト画面（仕様4.9） */
export function renderResult(view, ctx, session, deckId) {
  view.replaceChildren();
  view.className = 'screen result';
  const summary = session.summary();
  view.appendChild(
    h(
      'header',
      { class: 'app-header' },
      h('a', { class: 'back', href: '#/' }, '←'),
      h('h1', {}, 'リザルト')
    )
  );
  view.appendChild(
    h(
      'div',
      { class: 'summary' },
      h('span', { class: 'sum correct' }, `完答 ${summary.correct}`),
      h('span', { class: 'sum partial' }, `部分正解 ${summary.partial}`),
      h('span', { class: 'sum incorrect' }, `不正解 ${summary.incorrect}`),
      h('span', { class: 'sum skipped' }, `スキップ ${summary.skipped}`)
    )
  );

  const list = h('ul', { class: 'result-list' });
  const items = session.answeredItems();
  if (items.length === 0) {
    list.appendChild(h('li', { class: 'empty' }, '回答した問題はありません'));
  }
  for (const item of items) {
    const card = session.cardFor(item.cardId);
    const detail = h('div', { class: 'result-detail', hidden: true });
    let loaded = false;
    const toggle = h(
      'button',
      {
        class: 'btn tiny',
        onclick: () => {
          detail.hidden = !detail.hidden;
          if (!loaded) {
            loaded = true;
            detail.appendChild(answerBlock(card));
            if (card.explanation && card.explanation.trim() !== '') {
              detail.appendChild(
                h('div', { class: 'explanation' }, h('h3', {}, '解説'), h('p', {}, card.explanation))
              );
            }
          }
        },
      },
      '詳細'
    );
    const checkbox = h('input', { type: 'checkbox' });
    db.getReviewState(item.cardId).then((rs) => {
      if (rs) checkbox.checked = !!rs.checked;
    });
    checkbox.addEventListener('change', async () => {
      await db.setChecked(item.cardId, checkbox.checked);
      toast(checkbox.checked ? 'チェックを付けました' : 'チェックを外しました');
    });

    list.appendChild(
      h(
        'li',
        { class: `result-item ${item.result}` },
        h(
          'div',
          { class: 'result-main' },
          h('span', { class: 'q' }, truncate(card.question, 40)),
          h(
            'span',
            { class: 'result-meta' },
            h(
              'span',
              { class: `tag ${item.result}` },
              item.score === null || item.score === undefined
                ? RESULT_LABEL[item.result]
                : `${RESULT_LABEL[item.result]}（${Math.round(item.score * 100)}%）`
            ),
            h('span', { class: 'tag' }, item.nextDueDate ? `次回 ${item.nextDueDate}` : '次回 変更なし')
          )
        ),
        h('div', { class: 'result-actions' }, h('label', { class: 'check' }, checkbox, 'チェック'), toggle),
        detail
      )
    );
  }
  view.appendChild(list);
  view.appendChild(
    h(
      'div',
      { class: 'row gap' },
      h('button', { class: 'btn primary', onclick: () => navigate('#/') }, 'ホームへ'),
      deckId
        ? h('button', { class: 'btn', onclick: () => navigate(`#/deck/${deckId}`) }, 'カード一覧へ')
        : null
    )
  );
}
