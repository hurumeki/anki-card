// 問題形式ごとのデータ構造ヘルパ（仕様2章）

export const CARD_TYPES = ['single', 'choice', 'matching', 'ordering', 'anagram'];

export const TYPE_LABEL = {
  single: '1問1答',
  choice: '多肢選択',
  matching: '組み合わせ',
  ordering: '順番当て',
  anagram: '並べ替え',
};

/**
 * 組み合わせ用 `左:右` のパース（仕様2.2）。
 * `\` の次の1文字はエスケープ済みとして区切り判定から除外し、
 * エスケープされていない最初のコロンのみを区切りとする。
 * 区切りが無い場合は null を返す（＝バリデーションエラー）。
 */
export function parsePair(s) {
  let left = '';
  let i = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      const next = s[i + 1];
      if (next === undefined) {
        left += '\\';
        i++;
        continue;
      }
      left += next;
      i++;
      continue;
    }
    if (c === ':') {
      return { left, right: unescapePart(s.slice(i + 1)) };
    }
    left += c;
  }
  return null;
}

/** 右側の値に含まれるエスケープを解除する（2つ目以降のコロンは値の一部） */
function unescapePart(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      out += s[i + 1];
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

/** 左右の値から `左:右` 形式を生成（仕様2.2 エンコード規則。`\` を先に置換） */
export function encodePair(left, right) {
  const esc = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  return `${esc(left)}:${esc(right)}`;
}

/** エスケープされていないコロンを含むか */
export function hasUnescapedColon(s) {
  return parsePair(s) !== null;
}

/** カードのchoicesを組み合わせペア配列へ。不正要素は null 要素になる */
export function parsePairs(choices) {
  return (choices || []).map((c) => parsePair(c));
}

/**
 * 並べ替え（anagram）の表示トークン（仕様2.3）。
 * choicesが空 → answerを1文字ずつ分解。
 * choicesにカンマ区切り1件 → カンマで分割。
 */
export function anagramTokens(card) {
  const choices = card.choices || [];
  if (choices.length >= 1 && String(choices[0]).trim() !== '') {
    return String(choices[0])
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '');
  }
  return [...String(card.answer || '')].filter((ch) => ch.trim() !== '');
}
