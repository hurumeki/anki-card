// 書式チェック（外部依存なし。node tools/format-check.js）
// 整形ツールは入れず、差分を読みづらくする体裁の崩れだけを機械的に弾く。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** 中身を見ないファイル（バイナリ） */
const BINARY = /\.(png|jpg|jpeg|gif|ico|webp|woff2?|ttf|eot|pdf|zip)$/i;
/** 行長を見ないファイル（文章とデータ。表や長文をむりに折らない） */
const NO_LINE_LIMIT = /\.(md|csv)$/i;
const MAX_LINE = 120;

function listFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((f) => !BINARY.test(f));
}

/** @returns {string[]} 見つかった問題（`path:line: 内容`） */
function checkFile(path) {
  const problems = [];
  const raw = readFileSync(path, 'utf8');
  if (raw === '') return problems; // 空ファイル（.nojekyll など）は対象外

  if (raw.charCodeAt(0) === 0xfeff) problems.push(`${path}:1: BOMが付いています`);
  const limited = !NO_LINE_LIMIT.test(path);
  const lines = raw.split('\n');

  lines.forEach((line, i) => {
    const at = `${path}:${i + 1}`;
    if (line.endsWith('\r')) problems.push(`${at}: 改行コードがCRLFです（LFにしてください）`);
    const text = line.replace(/\r$/, '');
    if (/[ \t]$/.test(text)) problems.push(`${at}: 行末に空白があります`);
    if (/^\t/.test(text)) problems.push(`${at}: インデントにタブが使われています`);
    // 全角文字は1文字として数える（コードポイント単位）
    const width = [...text].length;
    if (limited && width > MAX_LINE) problems.push(`${at}: ${width}文字（上限${MAX_LINE}文字）`);
  });

  if (!raw.endsWith('\n')) problems.push(`${path}:${lines.length}: ファイル末尾に改行がありません`);
  else if (raw.endsWith('\n\n')) problems.push(`${path}:${lines.length - 1}: ファイル末尾に空行があります`);

  return problems;
}

const files = listFiles();
const problems = files.flatMap(checkFile);
for (const p of problems) console.error(p);
console.log(
  problems.length === 0
    ? `${files.length}ファイルを確認しました。問題はありません。`
    : `${files.length}ファイルを確認し、${problems.length}件の問題が見つかりました。`
);
process.exit(problems.length === 0 ? 0 : 1);
