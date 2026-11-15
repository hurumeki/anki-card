// 問題データCSVの検証（node tools/validate-cards.js <file.csv> [...]）
// アプリのインポートと同じ検証（仕様7.3）に、出題品質の警告を加える。
// エラーが1件でもあれば終了コード1。警告だけなら0。
import { readFileSync } from 'node:fs';
import { parseImportCsv } from '../src/csv.js';
import { parsePairs } from '../src/format.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';

/** 取り込めるが出題として問題のある箇所を拾う */
function qualityWarnings(rows) {
  const warnings = [];
  const seenQuestions = new Map();
  for (const { line, card } of rows) {
    const warn = (message) => warnings.push({ line, message });
    const q = card.question.trim();
    if (seenQuestions.has(q)) warn(`問題文が${seenQuestions.get(q)}行目と同じです`);
    else seenQuestions.set(q, line);

    const dup = (values) => values.length !== new Set(values).size;
    if ((card.type === 'choice' || card.type === 'ordering') && dup(card.choices)) {
      warn('同じ選択肢が複数あります');
    }
    if (card.type === 'matching') {
      const pairs = parsePairs(card.choices).filter(Boolean);
      if (dup(pairs.map((p) => p.left))) warn('組み合わせの左側に同じ値があります');
      if (dup(pairs.map((p) => p.right))) warn('組み合わせの右側に同じ値があります');
      if (pairs.length < 2) warn('組み合わせが1組しかありません（2組以上を推奨）');
    }
    if (card.type === 'anagram' && card.choices.length === 1) {
      const joined = card.choices[0].split(',').map((t) => t.trim()).join('');
      if (joined !== card.answer.trim()) warn('choice1 のトークンを連結しても answer になりません');
    }
    if (card.type === 'single' && card.choices.length > 0) warn('type=single の choice は使われません');
  }
  return warnings;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('使い方: node tools/validate-cards.js <file.csv> [...]');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const { errors, rows } = parseImportCsv(readFileSync(file, 'utf8'), DEFAULT_SETTINGS);
  const warnings = errors.length === 0 ? qualityWarnings(rows) : [];
  for (const e of errors) console.log(`${file}:${e.line}: エラー: ${e.message}`);
  for (const w of warnings) console.log(`${file}:${w.line}: 警告: ${w.message}`);
  const counts = {};
  for (const { card } of rows) counts[card.type] = (counts[card.type] || 0) + 1;
  const summary = Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(' / ');
  if (errors.length > 0) {
    failed = true;
    console.log(`${file}: NG（エラー ${errors.length}件）`);
  } else {
    console.log(`${file}: OK ${rows.length}問（${summary}）${warnings.length ? ` 警告 ${warnings.length}件` : ''}`);
  }
}
process.exit(failed ? 1 : 0);
