// 正誤判定・スコア算出（仕様3.1〜3.3）

/**
 * 組み合わせのスコア（仕様3.2）
 * @param {number[]} answerRightIndexes 左要素ごとに選んだ右要素のインデックス
 * @param {number[]} correctRightIndexes 左要素ごとの正しい右要素のインデックス
 */
export function matchingScore(answerRightIndexes, correctRightIndexes) {
  const total = correctRightIndexes.length;
  if (total === 0) return 1;
  let ok = 0;
  for (let i = 0; i < total; i++) {
    if (answerRightIndexes[i] === correctRightIndexes[i]) ok++;
  }
  return ok / total;
}

/** 組み合わせの正解ペア数 */
export function matchingCorrectCount(answerRightIndexes, correctRightIndexes) {
  let ok = 0;
  for (let i = 0; i < correctRightIndexes.length; i++) {
    if (answerRightIndexes[i] === correctRightIndexes[i]) ok++;
  }
  return ok;
}

/**
 * 順番当てのスコア（仕様3.3）
 * @param {number[]} answerOrder ユーザーが並べた順の「正解配列インデックス」列
 * @param {'concordance'|'position'} method
 */
export function orderingScore(answerOrder, method = 'concordance') {
  const n = answerOrder.length;
  if (n === 0) return 1;
  if (method === 'position') {
    let ok = 0;
    for (let i = 0; i < n; i++) if (answerOrder[i] === i) ok++;
    return ok / n;
  }
  if (n < 2) return 1;
  let concordant = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs++;
      if (answerOrder[i] < answerOrder[j]) concordant++;
    }
  }
  return concordant / pairs;
}

/** 一致率 → 3値判定（仕様3.1） */
export function judgeScore(score, partialThreshold) {
  if (score >= 1) return 'correct';
  if (score >= partialThreshold) return 'partial';
  return 'incorrect';
}
