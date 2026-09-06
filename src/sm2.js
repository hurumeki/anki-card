// SM-2 更新（仕様3.4）
import { addDays, nowIso } from './util.js';

/**
 * 回答結果をReviewStateへ適用した新しいReviewStateを返す（引数は変更しない）。
 * @param {object} state ReviewState
 * @param {'correct'|'partial'|'incorrect'} result
 * @param {number|null} score 組み合わせ・順番当てのみ。他形式はnull
 * @param {object} s GlobalSettings
 * @param {string} answerDate 回答日 'YYYY-MM-DD'
 */
export function applyResult(state, result, score, s, answerDate) {
  const st = { ...state };
  st.totalCount = (st.totalCount || 0) + 1;

  if (result === 'correct') {
    st.repetition = (st.repetition || 0) + 1;
    let base;
    if (st.repetition === 1) base = s.firstInterval;
    else if (st.repetition === 2) base = s.secondInterval;
    else base = st.interval * st.easiness;
    st.interval = Math.max(1, Math.round(base * s.intervalFactor));
    st.easiness = st.easiness + s.efGainOnCorrect;
    st.correctCount = (st.correctCount || 0) + 1;
  } else if (result === 'partial') {
    // repetition / easiness は変更しない
    const base =
      st.interval > 0 ? st.interval : Math.max(1, Math.round(s.firstInterval * s.intervalFactor));
    st.interval = Math.max(1, Math.round(base * s.partialIntervalFactor));
    st.partialCount = (st.partialCount || 0) + 1;
  } else {
    st.repetition = 0;
    st.interval = Math.max(1, Math.round(s.firstInterval * s.intervalFactor));
    st.easiness = Math.max(st.easiness - s.efLossOnIncorrect, s.efMin);
  }

  st.dueDate = addDays(answerDate, st.interval);
  st.lastResult = result;
  st.lastScore = score === null || score === undefined ? null : score;
  st.lastAnsweredAt = nowIso();
  return st;
}
