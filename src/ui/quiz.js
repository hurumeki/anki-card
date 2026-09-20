// カード画面（セット実施中）とリザルト画面（仕様4.7 / 4.9）
import * as db from '../db.js';
import { anagramTokens, parsePairs } from '../format.js';
import { matchingCorrectCount, matchingScore, judgeScore, orderingScore } from '../scoring.js';
import { startSession } from '../session.js';
import { shuffle } from '../util.js';
import { setSessionActive } from '../pwa.js';
import { actionBar, barRow, confirmDialog, h, navigate, syncBarHeight, toast, truncate } from './dom.js';

// 判定は文字ではなく、次回出題日の右の矢印と色で示す（↗ 上がった / → 変わらず / ↘ 下がった）
const RESULT_ARROW = {
  correct: '↗',
  partial: '→',
  incorrect: '↘',
  skipped: '→',
};
const ARROW_LABEL = {
  correct: '評価が上がりました',
  partial: '評価は変わりません',
  incorrect: '評価が下がりました',
  skipped: '評価は変わりません',
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
        actionBar(
          barRow(
            'main',
            h('a', { class: 'btn primary', href: `#/deck/${deckId}` }, 'カード一覧へ'),
            h('a', { class: 'btn', href: '#/settings' }, '設定')
          )
        )
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
  const drawnAt = Date.now();
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

  // 主操作のスロット。1画面ぶんの操作が同じ位置で入れ替わる
  const mainSlot = barRow('main');
  const prevRow = prevAnswerRow(session);
  const selfJudge = card.type === 'single' || card.type === 'anagram';
  const isLast = session.index + 1 >= session.length;

  const showJudgement = async (result, score, detail) => {
    await session.answer(result, score);
    // この問題の解答が出るので、前問の解答は役目を終える
    if (prevRow) prevRow.remove();
    renderJudgement(resultArea, card, result, score, detail, session, ctx);
    answerArea.classList.add('answered');
    // 二重回答を防ぐため回答UIを操作不可にする
    answerArea.querySelectorAll('button, select, input').forEach((el) => {
      el.disabled = true;
    });
    undoBtn.disabled = !session.canUndo();
    mainSlot.replaceChildren(nextButton(view, ctx, session, deckId));
    syncBarHeight();
  };

  // 自己採点は回答と同時に次の問題へ進む（最終問題のみ解答・解説を表示して留まる）
  const submitSelf = async (result) => {
    // 前の問題での連打が、開いたばかりの問題の回答にならないようにする
    if (Date.now() - drawnAt < 300) return;
    if (isLast) {
      await showJudgement(result, null, null);
      return;
    }
    await session.answer(result, null);
    session.next();
    drawCurrent(view, ctx, session, deckId);
  };

  buildAnswerUI(answerArea, card, settings, showJudgement);

  if (selfJudge) {
    // 左＝解答を表示 / 右＝わかる。表示後は 左＝あとでやる（不正解）/ 右＝おぼえた（正解）
    const reveal = h('button', { class: 'btn' }, '解答を表示');
    reveal.addEventListener('click', () => {
      // この問題の解答を出したら、前問の解答は役目を終える
      if (prevRow) prevRow.remove();
      resultArea.replaceChildren(...[answerBlock(card), explanationBlock(card)].filter(Boolean));
      const revealedAt = Date.now();
      // 「解答を表示」の連打で誤って自己採点されないよう、表示直後の操作は無視する
      const judge = (result) => () => {
        if (Date.now() - revealedAt < 300) return;
        submitSelf(result);
      };
      mainSlot.replaceChildren(
        h('button', { class: 'btn wrong', onclick: judge('incorrect') }, 'あとでやる'),
        h('button', { class: 'btn correct', onclick: judge('correct') }, 'おぼえた')
      );
      syncBarHeight();
    });
    mainSlot.replaceChildren(
      reveal,
      h('button', { class: 'btn correct', onclick: () => submitSelf('correct') }, 'わかる')
    );
  } else {
    // 選択式は回答時に自動判定されるため、主操作の位置を保つよう「次へ」を無効状態で置く
    mainSlot.appendChild(nextButton(view, ctx, session, deckId, true));
  }

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

  const skipBtn = h(
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
  );

  view.appendChild(
    actionBar(prevRow, barRow('tools quiz-tools', undoBtn, skipBtn, checkBtn), mainSlot)
  );

  // 回答済みの問題に戻ってきた場合は判定結果を復元表示する
  if (item.result !== 'pending' && item.result !== 'skipped') {
    answerArea.classList.add('answered');
    if (prevRow) prevRow.remove();
    renderJudgement(resultArea, card, item.result, item.score, null, session, ctx);
    mainSlot.replaceChildren(nextButton(view, ctx, session, deckId));
  }

  syncBarHeight();
}

/**
 * 直前の問題の解答（解説は出さない）。「わかる」で解答を見ずに進んだ場合の
 * 答え合わせに使う。誤りに気付いたら「やり直し」で戻れる。
 */
function prevAnswerRow(session) {
  const prev = session.previous;
  if (!prev) return null;
  return h(
    'div',
    { class: 'prev-answer' },
    h('span', { class: 'label' }, '前問の解答'),
    h('span', { class: 'text' }, answerText(prev.card))
  );
}

/** 次の問題（最終問題ではリザルト）へ進む主操作 */
function nextButton(view, ctx, session, deckId, disabled = false) {
  return h(
    'button',
    {
      class: 'btn primary',
      disabled,
      onclick: () => {
        session.next();
        drawCurrent(view, ctx, session, deckId);
      },
    },
    session.index + 1 >= session.length ? 'リザルトへ' : '次へ'
  );
}

/**
 * 形式ごとの回答UI（仕様4.7）。
 * 自己採点形式（single / anagram）の操作は操作バー側にあるため、ここでは本文だけを組む。
 */
function buildAnswerUI(area, card, settings, submit) {
  area.replaceChildren();
  if (card.type === 'single' || card.type === 'anagram') {
    if (card.type === 'anagram') {
      const tokens = shuffle(anagramTokens(card));
      area.appendChild(
        h('div', { class: 'tokens' }, tokens.map((t) => h('span', { class: 'token' }, t)))
      );
    }
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

/** 判定結果・解答・解説の表示（「次へ」は操作バー側） */
function renderJudgement(area, card, result, score, detail, session, ctx) {
  area.replaceChildren();
  if (score !== null && score !== undefined) {
    area.appendChild(h('p', { class: `score-line ${result}` }, scoreText(score, detail, ctx.settings)));
  }
  area.appendChild(answerBlock(card));
  const explanation = explanationBlock(card);
  if (explanation) area.appendChild(explanation);
  const item = session.currentItem;
  if (item && item.nextDueDate) {
    area.appendChild(
      h('p', { class: 'due-line' }, `次回出題日：${item.nextDueDate}`, resultArrow(result))
    );
  }
}

/** リザルトのサマリ（件数と矢印のみ） */
function summaryChip(result, count) {
  const label = `${ARROW_LABEL[result]}：${count}件`;
  return h(
    'span',
    { class: `sum ${result}`, title: label, 'aria-label': label },
    RESULT_ARROW[result],
    ` ${count}`
  );
}

/** 評価の推移を示す矢印（判定区分の文字の代わり） */
function resultArrow(result) {
  return h(
    'span',
    {
      class: `arrow ${result}`,
      role: 'img',
      'aria-label': ARROW_LABEL[result] || '',
      title: ARROW_LABEL[result] || '',
    },
    RESULT_ARROW[result] || ''
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

/** 解説（未入力なら null） */
function explanationBlock(card) {
  if (!card.explanation || card.explanation.trim() === '') return null;
  return h('div', { class: 'explanation' }, h('p', {}, card.explanation));
}

/** 解答の1行表現（前問の解答表示用） */
function answerText(card) {
  if (card.type === 'choice') return card.choices[card.answerIndex] ?? '';
  if (card.type === 'matching') {
    return parsePairs(card.choices)
      .map((p, i) => (p ? `${p.left} — ${p.right}` : card.choices[i]))
      .join(' / ');
  }
  if (card.type === 'ordering') return card.choices.join(' → ');
  return card.answer;
}

/** 正解内容の表示 */
function answerBlock(card) {
  const box = h('div', { class: 'answer-block' });
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
      summaryChip('correct', summary.correct),
      summaryChip('partial', summary.partial),
      summaryChip('incorrect', summary.incorrect),
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
            const exp = explanationBlock(card);
            if (exp) detail.appendChild(exp);
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
            item.result === 'skipped' ? h('span', { class: 'tag skipped' }, 'スキップ') : null,
            item.score === null || item.score === undefined
              ? null
              : h('span', { class: 'tag' }, `${Math.round(item.score * 100)}%`),
            h(
              'span',
              { class: `tag due ${item.result}` },
              item.nextDueDate ? `次回 ${item.nextDueDate}` : '次回 変更なし',
              resultArrow(item.result)
            )
          )
        ),
        h('div', { class: 'result-actions' }, h('label', { class: 'check' }, checkbox, 'チェック'), toggle),
        detail
      )
    );
  }
  view.appendChild(list);
  view.appendChild(
    actionBar(
      barRow(
        'sub',
        h('button', { class: 'btn', onclick: () => navigate('#/') }, 'ホームへ'),
        deckId
          ? h('button', { class: 'btn', onclick: () => navigate(`#/deck/${deckId}`) }, 'カード一覧へ')
          : null
      ),
      barRow(
        'main',
        // ホームの「暗記開始」と同じく、同じデッキで新しいセットを組み直す
        h('button', { class: 'btn primary', onclick: () => ctx.rerender() }, '続ける')
      )
    )
  );
  syncBarHeight();
}
