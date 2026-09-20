// 仕様の主要ロジックに対するテスト（node --test test/run.js）
import assert from 'node:assert/strict';
import test from 'node:test';

import { addDays, isUuid, shuffle, toDateStr } from '../src/util.js';
import { anagramTokens, encodePair, hasUnescapedColon, parsePair } from '../src/format.js';
import { judgeScore, matchingScore, orderingScore } from '../src/scoring.js';
import { applyResult } from '../src/sm2.js';
import { cardToRow, parseCsv, parseImportCsv, toCsv } from '../src/csv.js';
import { buildQueue } from '../src/session.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { normalizeTheme, resolveTheme } from '../src/theme.js';

const S = { ...DEFAULT_SETTINGS };

test('util: 日付加算とUUID判定', () => {
  assert.equal(addDays('2026-02-27', 2), '2026-03-01'); // 2026年は平年
  assert.equal(addDays('2024-02-27', 2), '2024-02-29'); // 閏年
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(toDateStr(new Date(2026, 0, 5)), '2026-01-05');
  assert.ok(isUuid('123e4567-e89b-12d3-a456-426614174000'));
  assert.ok(!isUuid('not-a-uuid'));
});

test('util: シャッフルは元の並びと一致しない（仕様2.4）', () => {
  const src = [1, 2, 3, 4, 5];
  for (let i = 0; i < 200; i++) {
    const out = shuffle(src);
    assert.equal(out.length, 5);
    assert.deepEqual([...out].sort(), [...src].sort());
    assert.ok(!out.every((v, j) => v === src[j]), '元の並びと完全一致してはいけない');
  }
  assert.deepEqual(shuffle(['a']), ['a']); // 要素1件はそのまま
});

test('format: 組み合わせのエスケープ（仕様2.2）', () => {
  assert.deepEqual(parsePair('開始時刻\\:12\\:30:Start Time'), {
    left: '開始時刻:12:30',
    right: 'Start Time',
  });
  assert.deepEqual(parsePair('C\\\\Users:パス'), { left: 'C\\Users', right: 'パス' });
  // エスケープされていない最初のコロンのみが区切り
  assert.deepEqual(parsePair('A:B:C'), { left: 'A', right: 'B:C' });
  assert.equal(parsePair('区切りなし'), null);
  assert.ok(!hasUnescapedColon('区切りなし'));

  // エンコード → パースの往復
  const left = 'C:\\Users';
  const right = 'パス:名';
  const enc = encodePair(left, right);
  assert.equal(enc, 'C\\:\\\\Users:パス\\:名');
  assert.deepEqual(parsePair(enc), { left, right });
});

test('format: 並べ替えの表示トークン（仕様2.3）', () => {
  assert.deepEqual(anagramTokens({ choices: [], answer: '富士山' }), ['富', '士', '山']);
  assert.deepEqual(anagramTokens({ choices: ['ふ,じ,さ,ん'], answer: 'ふじさん' }), [
    'ふ', 'じ', 'さ', 'ん',
  ]);
});

test('scoring: 組み合わせ（仕様3.2）', () => {
  const correct = [0, 1, 2, 3, 4, 5];
  const score = matchingScore([0, 1, 2, 3, 5, 4], correct);
  assert.equal(score, 4 / 6);
  assert.equal(judgeScore(score, 0.5), 'partial');
  assert.equal(judgeScore(matchingScore(correct, correct), 0.5), 'correct');
  assert.equal(judgeScore(matchingScore([1, 0, 3, 2, 5, 4], correct), 0.5), 'incorrect');
});

test('scoring: 順番当て（仕様3.3）', () => {
  // 正解 ABCDEF に対する解答 BCDEFA
  const answer = [1, 2, 3, 4, 5, 0];
  assert.equal(orderingScore(answer, 'concordance'), 10 / 15);
  assert.equal(orderingScore(answer, 'position'), 0);
  assert.equal(orderingScore([0, 1, 2, 3, 4, 5], 'concordance'), 1);
  assert.equal(orderingScore([5, 4, 3, 2, 1, 0], 'concordance'), 0);
  assert.equal(orderingScore([0, 2, 1, 3], 'position'), 2 / 4);
});

test('scoring: 3値判定のしきい値（仕様3.1）', () => {
  assert.equal(judgeScore(1, 0.5), 'correct');
  assert.equal(judgeScore(0.5, 0.5), 'partial');
  assert.equal(judgeScore(0.49, 0.5), 'incorrect');
  assert.equal(judgeScore(0.9, 1.0), 'incorrect'); // しきい値1.0なら部分点なし
});

const baseState = () => ({
  cardId: 'c1', deckId: 'd1', repetition: 0, interval: 0, easiness: 2.5,
  dueDate: '2026-01-01', lastResult: 'unanswered', lastScore: null, lastAnsweredAt: null,
  totalCount: 0, correctCount: 0, partialCount: 0, checked: false, suspendedUntil: null,
});

test('sm2: correct の更新（仕様3.4）', () => {
  let st = applyResult(baseState(), 'correct', null, S, '2026-01-10');
  assert.equal(st.repetition, 1);
  assert.equal(st.interval, 1); // firstInterval
  assert.equal(st.dueDate, '2026-01-11');
  assert.equal(st.correctCount, 1);
  assert.equal(st.totalCount, 1);
  assert.ok(Math.abs(st.easiness - 2.6) < 1e-9);

  st = applyResult(st, 'correct', null, S, '2026-01-11');
  assert.equal(st.repetition, 2);
  assert.equal(st.interval, 6); // secondInterval
  assert.equal(st.dueDate, '2026-01-17');

  st = applyResult(st, 'correct', null, S, '2026-01-17');
  assert.equal(st.repetition, 3);
  assert.equal(st.interval, Math.round(6 * 2.7)); // interval * easiness = 16
  assert.equal(st.lastResult, 'correct');
});

test('sm2: partial は評価を下げない（仕様3.4）', () => {
  const prev = { ...baseState(), repetition: 3, interval: 10, easiness: 2.7 };
  const st = applyResult(prev, 'partial', 0.67, S, '2026-01-10');
  assert.equal(st.repetition, 3, 'repetitionは変更しない');
  assert.equal(st.easiness, 2.7, 'easinessは変更しない');
  assert.equal(st.interval, 10, 'partialIntervalFactor=1.0なら据え置き');
  assert.equal(st.dueDate, '2026-01-20');
  assert.equal(st.partialCount, 1);
  assert.equal(st.correctCount, 0);
  assert.equal(st.lastScore, 0.67);

  // interval=0（新規カード）の場合は firstInterval を基準にする
  const fresh = applyResult(baseState(), 'partial', 0.5, S, '2026-01-10');
  assert.equal(fresh.interval, 1);

  // 倍率1.2で緩やかに伸長
  const grow = applyResult(prev, 'partial', 0.8, { ...S, partialIntervalFactor: 1.2 }, '2026-01-10');
  assert.equal(grow.interval, 12);
});

test('sm2: incorrect の更新（仕様3.4）', () => {
  const prev = { ...baseState(), repetition: 4, interval: 20, easiness: 1.4, totalCount: 4 };
  const st = applyResult(prev, 'incorrect', null, S, '2026-01-10');
  assert.equal(st.repetition, 0);
  assert.equal(st.interval, 1);
  assert.equal(st.easiness, 1.3, 'efMinで下げ止まる');
  assert.equal(st.dueDate, '2026-01-11');
  assert.equal(st.totalCount, 5);
  assert.equal(st.correctCount, 0);
});

test('csv: RFC4180のパース（仕様7.1）', () => {
  const recs = parseCsv('\ufeffa,b\r\n"1,1","改行\n入り"\r\n"""q""",x\r\n');
  assert.deepEqual(recs[0].fields, ['a', 'b']);
  assert.deepEqual(recs[1].fields, ['1,1', '改行\n入り']);
  assert.deepEqual(recs[2].fields, ['"q"', 'x']);
  assert.equal(recs[2].line, 4, '引用符内の改行を含めた物理行番号');
});

test('csv: 検証エラー（仕様7.3）', () => {
  const cases = [
    ['id,question\nx,y\n', /必須列/],
    ['type,question\nunknown,Q\n', /type が不正/],
    ['type,question\nsingle,\n', /question が空/],
    ['type,question,answer\nsingle,Q,\n', /answer が空/],
    ['type,question,choice1,choice2,answerIndex\nchoice,Q,a,b,\n', /answerIndex が未指定/],
    ['type,question,choice1,choice2,answerIndex\nchoice,Q,a,b,3\n', /範囲外/],
    ['type,question,choice1,answerIndex\nchoice,Q,a,1\n', /2件未満/],
    ['type,question,choice1\nordering,Q,a\n', /2件未満/],
    ['type,question,choice1\nmatching,Q,コロンなし\n', /コロン/],
    ['type,question,answer,choice1,choice2\nanagram,Q,ans,a,b\n', /0件または1件/],
    ['id,type,question,answer\nzz,single,Q,A\n', /UUID形式/],
    ['type,question,answer,totalCount,correctCount,partialCount\nsingle,Q,A,1,1,1\n', /totalCount を超え/],
    ['type,question,answer,lastScore\nsingle,Q,A,1.5\n', /0\.0〜1\.0/],
    ['type,question,answer,repetition\nsingle,Q,A,-1\n', /範囲外/],
    ['type,question,answer,easiness\nsingle,Q,A,1.0\n', /範囲外/],
    ['type,question,answer,dueDate\nsingle,Q,A,2026-13-01\n', /YYYY-MM-DD/],
    ['type,question,answer,checked\nsingle,Q,A,yes\n', /true \/ false/],
    ['type,question,answer,lastResult\nsingle,Q,A,perfect\n', /lastResult が不正/],
  ];
  for (const [csv, re] of cases) {
    const { errors } = parseImportCsv(csv, S);
    assert.ok(errors.length > 0, `エラーになるべき: ${csv}`);
    assert.match(errors[0].message, re);
  }

  // 同一id重複（規則5）
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const dup = parseImportCsv(`id,type,question,answer\n${id},single,Q,A\n${id},single,Q2,A2\n`, S);
  assert.match(dup.errors[0].message, /重複/);
  assert.equal(dup.errors[0].line, 3);
});

test('csv: 正常系のインポート解析（仕様7.2 / 7.4）', () => {
  const csv = [
    'question,type,choice1,choice2,choice3,answerIndex,explanation,unknownCol',
    'Q1,choice,a,b,c,2,解説,無視される',
  ].join('\n');
  const { errors, rows } = parseImportCsv(csv, S);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].card.answerIndex, 1, 'CSVは1起点・内部は0起点');
  assert.deepEqual(rows[0].card.choices, ['a', 'b', 'c']);
  assert.equal(rows[0].id, null);
  assert.equal(rows[0].providedReview, false);
  assert.equal(rows[0].review.easiness, S.efInitial);
});

test('csv: エクスポートの往復', () => {
  const card = {
    cardId: '123e4567-e89b-12d3-a456-426614174000',
    deckId: null,
    type: 'matching',
    question: 'カンマ, と "引用符" と\n改行',
    choices: [encodePair('開始時刻:12:30', 'Start Time'), encodePair('A', 'B')],
    answerIndex: null,
    answer: '',
    explanation: '',
  };
  const rs = {
    checked: true, repetition: 2, interval: 6, easiness: 2.6, dueDate: '2026-03-01',
    lastResult: 'partial', lastScore: 0.5, lastAnsweredAt: '2026-02-24T00:00:00.000Z',
    totalCount: 3, correctCount: 1, partialCount: 1, suspendedUntil: null,
  };
  const csv = toCsv([cardToRow(card, rs)]);
  const { errors, rows } = parseImportCsv(csv, S);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].id, card.cardId);
  assert.equal(rows[0].card.question, card.question);
  assert.deepEqual(rows[0].card.choices, card.choices);
  assert.equal(rows[0].review.lastScore, 0.5);
  assert.equal(rows[0].review.checked, true);
  assert.equal(rows[0].review.partialCount, 1);
});

const entry = (id, created, due, lastResult, extra = {}) => ({
  card: { cardId: id, createdAt: created, question: id, type: 'single' },
  review: { cardId: id, dueDate: due, lastResult, suspendedUntil: null, ...extra },
});

test('session: 復習モードの抽出順（仕様5.1）', () => {
  const entries = [
    entry('new2', '2026-01-02T00:00:00Z', '2026-03-01', 'unanswered'),
    entry('rev2', '2026-01-05T00:00:00Z', '2026-02-28', 'correct'),
    entry('new1', '2026-01-01T00:00:00Z', '2026-03-01', 'unanswered'),
    entry('rev1', '2026-01-06T00:00:00Z', '2026-02-27', 'incorrect'),
    entry('future', '2026-01-07T00:00:00Z', '2026-03-05', 'correct'),
    entry('susp', '2026-01-08T00:00:00Z', '2026-02-27', 'correct', { suspendedUntil: '2026-03-02' }),
  ];
  const q = buildQueue(entries, { ...S, scope: 'review', setSize: null }, '2026-03-01');
  assert.deepEqual(q.map((e) => e.card.cardId), ['rev1', 'rev2', 'new1', 'new2']);

  const limited = buildQueue(entries, { ...S, scope: 'review', setSize: 2 }, '2026-03-01');
  assert.deepEqual(limited.map((e) => e.card.cardId), ['rev1', 'rev2']);
});

test('session: 全てモードの抽出（仕様5.1）', () => {
  const entries = [
    entry('c', '2026-01-03T00:00:00Z', '2030-01-01', 'correct'),
    entry('a', '2026-01-01T00:00:00Z', '2030-01-01', 'unanswered', { suspendedUntil: '2030-01-01' }),
    entry('b', '2026-01-02T00:00:00Z', '2030-01-01', 'correct'),
  ];
  const ordered = buildQueue(entries, { ...S, scope: 'all', shuffleAll: false, setSize: null }, '2026-03-01');
  assert.deepEqual(ordered.map((e) => e.card.cardId), ['a', 'b', 'c'], 'dueDate/suspendedUntilは考慮しない');
  const cut = buildQueue(entries, { ...S, scope: 'all', shuffleAll: false, setSize: 2 }, '2026-03-01');
  assert.equal(cut.length, 2);
  const shuffled = buildQueue(entries, { ...S, scope: 'all', shuffleAll: true, setSize: null }, '2026-03-01');
  assert.equal(shuffled.length, 3);
});

test('theme: 設定値の正規化と適用（仕様8.4）', () => {
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('system'), 'system');
  // 未知の値・未保存は「端末の設定に従う」に寄せる
  assert.equal(normalizeTheme(null), 'system');
  assert.equal(normalizeTheme('sepia'), 'system');

  // 端末の設定に従う場合だけ prefers-color-scheme を見る
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('sepia', true), 'dark');
});
