// CSV入出力（仕様7章）
import { CARD_TYPES, hasUnescapedColon } from './format.js';
import { isUuid, isDateStr, isIsoDateTime, today, uuid } from './util.js';

export const CSV_COLUMNS = [
  'id', 'type', 'question',
  'choice1', 'choice2', 'choice3', 'choice4', 'choice5', 'choice6',
  'answerIndex', 'answer', 'explanation',
  'checked', 'repetition', 'interval', 'easiness', 'dueDate',
  'lastResult', 'lastScore', 'lastAnsweredAt',
  'totalCount', 'correctCount', 'partialCount', 'suspendedUntil',
];

const RESULTS = ['correct', 'partial', 'incorrect', 'unanswered'];

/**
 * RFC4180準拠のCSVパース。BOMは除去する。
 * @returns {{fields:string[], line:number}[]} 各レコード（開始行番号付き）
 */
export function parseCsv(text) {
  let src = String(text);
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const pushField = () => {
    fields.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    records.push({ fields, line: recordLine });
    fields = [];
    started = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!started && !inQuotes) {
      recordLine = line;
      started = true;
    }
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\r') {
      // CRLF/CR いずれも改行として扱う
      if (src[i + 1] === '\n') i++;
      line++;
      pushRecord();
    } else if (c === '\n') {
      line++;
      pushRecord();
    } else {
      field += c;
    }
  }
  if (started || field !== '' || fields.length > 0) pushRecord();
  // 末尾の空行を除去
  while (
    records.length > 0 &&
    records[records.length - 1].fields.length === 1 &&
    records[records.length - 1].fields[0] === ''
  ) {
    records.pop();
  }
  return records;
}

export function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns = CSV_COLUMNS) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  }
  return lines.join('\r\n');
}

/** Card + ReviewState → CSV行オブジェクト */
export function cardToRow(card, rs) {
  const row = {
    id: card.cardId,
    type: card.type,
    question: card.question,
    answerIndex: card.answerIndex === null || card.answerIndex === undefined
      ? ''
      : card.answerIndex + 1, // 出力は1起点
    answer: card.answer || '',
    explanation: card.explanation || '',
  };
  for (let i = 0; i < 6; i++) row[`choice${i + 1}`] = (card.choices || [])[i] ?? '';
  const s = rs || {};
  row.checked = s.checked ? 'true' : 'false';
  row.repetition = s.repetition ?? 0;
  row.interval = s.interval ?? 0;
  row.easiness = s.easiness ?? '';
  row.dueDate = s.dueDate ?? '';
  row.lastResult = s.lastResult ?? 'unanswered';
  row.lastScore = s.lastScore === null || s.lastScore === undefined ? '' : s.lastScore;
  row.lastAnsweredAt = s.lastAnsweredAt ?? '';
  row.totalCount = s.totalCount ?? 0;
  row.correctCount = s.correctCount ?? 0;
  row.partialCount = s.partialCount ?? 0;
  row.suspendedUntil = s.suspendedUntil ?? '';
  return row;
}

const isIntStr = (v) => /^-?\d+$/.test(v);
const isNumStr = (v) => /^-?\d+(\.\d+)?$/.test(v);

/**
 * CSVテキストを解析・検証する（仕様7.3）。
 * エラーが1件でもあれば呼び出し側はインポート全体を中止する。
 * @returns {{errors:{line:number,message:string}[], rows:object[]}}
 */
export function parseImportCsv(text, settings) {
  const errors = [];
  const records = parseCsv(text);
  if (records.length === 0) {
    return { errors: [{ line: 1, message: 'CSVが空です（ヘッダ行が必要です）' }], rows: [] };
  }
  const header = records[0].fields.map((h) => h.trim());
  const index = {};
  header.forEach((h, i) => {
    if (h !== '' && !(h in index)) index[h] = i;
  });
  // 規則1：必須列
  if (!('type' in index) || !('question' in index)) {
    return {
      errors: [{ line: records[0].line, message: 'ヘッダ行に必須列（type / question）がありません' }],
      rows: [],
    };
  }

  const rows = [];
  const seenIds = new Map();

  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    const line = rec.line;
    const get = (name) => {
      const i = index[name];
      return i === undefined ? '' : (rec.fields[i] ?? '').trim();
    };
    const getRaw = (name) => {
      const i = index[name];
      return i === undefined ? '' : (rec.fields[i] ?? '');
    };
    const err = (message) => errors.push({ line, message });

    // 完全な空行はスキップ
    if (rec.fields.every((f) => f.trim() === '')) continue;

    const id = get('id');
    const type = get('type');
    const question = getRaw('question');

    // 規則11：id形式
    if (id !== '' && !isUuid(id)) err(`id がUUID形式ではありません: ${id}`);
    // 規則5：CSV内id重複
    if (id !== '') {
      if (seenIds.has(id)) err(`id が重複しています（${seenIds.get(id)}行目と重複）: ${id}`);
      else seenIds.set(id, line);
    }
    // 規則2：type
    if (!CARD_TYPES.includes(type)) err(`type が不正です: ${type || '(空)'}`);
    // 規則3：question
    if (question.trim() === '') err('question が空です');

    // choices
    const choicesRaw = [];
    for (let i = 1; i <= 6; i++) choicesRaw.push(getRaw(`choice${i}`));
    // 規則4：7件以上（choice7以降のヘッダが存在し値がある場合）
    for (const h of header) {
      const m = /^choice(\d+)$/.exec(h);
      if (m && Number(m[1]) > 6 && getRaw(h).trim() !== '') {
        err('choice が7件以上あります');
        break;
      }
    }
    const choices = choicesRaw.map((c) => c.trim()).filter((c) => c !== '');

    // 規則6,7,8,9,10：type別
    const answer = getRaw('answer');
    const answerIndexStr = get('answerIndex');
    let answerIndex = null;
    if (type === 'choice') {
      if (choices.length < 2) err('type=choice の choice が2件未満です');
      if (answerIndexStr === '') {
        err('type=choice の answerIndex が未指定です');
      } else if (!isIntStr(answerIndexStr)) {
        err(`answerIndex が数値ではありません: ${answerIndexStr}`);
      } else {
        const n = Number(answerIndexStr);
        if (n < 1 || n > choices.length) {
          err(`answerIndex が範囲外です（1〜${choices.length}）: ${n}`);
        } else {
          answerIndex = n - 1; // 内部は0起点
        }
      }
    } else if (answerIndexStr !== '' && !isIntStr(answerIndexStr)) {
      err(`answerIndex が数値ではありません: ${answerIndexStr}`);
    }
    if (type === 'ordering' && choices.length < 2) err('type=ordering の choice が2件未満です');
    if (type === 'matching') {
      if (choices.length < 1) {
        err('type=matching の choice が1件未満です');
      } else {
        choices.forEach((c, i) => {
          if (!hasUnescapedColon(c)) {
            err(`type=matching の choice${i + 1} に区切りのコロンがありません: ${c}`);
          }
        });
      }
    }
    if ((type === 'single' || type === 'anagram') && answer.trim() === '') {
      err(`type=${type} の answer が空です`);
    }
    if (type === 'anagram' && choices.length >= 2) {
      err('type=anagram の choice は0件または1件のみ許可されます');
    }

    // 回答状況列（規則12〜15）
    const review = {};
    let providedReview = false;
    const num = (name, { int = false, min = null, max = null, def = 0 }) => {
      const v = get(name);
      if (v === '') return def;
      providedReview = true;
      if (int ? !isIntStr(v) : !isNumStr(v)) {
        err(`${name} が数値形式ではありません: ${v}`);
        return def;
      }
      const n = Number(v);
      if (min !== null && n < min) err(`${name} が範囲外です（${min}以上）: ${n}`);
      if (max !== null && n > max) err(`${name} が範囲外です（${max}以下）: ${n}`);
      return n;
    };

    const checkedStr = get('checked');
    if (checkedStr !== '') {
      providedReview = true;
      const lower = checkedStr.toLowerCase();
      if (lower !== 'true' && lower !== 'false') {
        err(`checked が true / false ではありません: ${checkedStr}`);
      }
      review.checked = lower === 'true';
    } else {
      review.checked = false;
    }

    review.repetition = num('repetition', { int: true, min: 0, def: 0 });
    review.interval = num('interval', { int: true, min: 0, def: 0 });
    review.easiness = num('easiness', { min: settings.efMin, def: settings.efInitial });
    review.totalCount = num('totalCount', { int: true, min: 0, def: 0 });
    review.correctCount = num('correctCount', { int: true, min: 0, def: 0 });
    review.partialCount = num('partialCount', { int: true, min: 0, def: 0 });

    const lastScoreStr = get('lastScore');
    if (lastScoreStr === '') {
      review.lastScore = null;
    } else {
      providedReview = true;
      if (!isNumStr(lastScoreStr)) {
        err(`lastScore が数値形式ではありません: ${lastScoreStr}`);
        review.lastScore = null;
      } else {
        const n = Number(lastScoreStr);
        if (n < 0 || n > 1) err(`lastScore が0.0〜1.0の範囲外です: ${n}`);
        review.lastScore = n;
      }
    }

    const dueDate = get('dueDate');
    if (dueDate === '') {
      review.dueDate = today();
    } else {
      providedReview = true;
      if (!isDateStr(dueDate)) err(`dueDate が YYYY-MM-DD 形式ではありません: ${dueDate}`);
      review.dueDate = dueDate;
    }

    const suspendedUntil = get('suspendedUntil');
    if (suspendedUntil === '') {
      review.suspendedUntil = null;
    } else {
      providedReview = true;
      if (!isDateStr(suspendedUntil)) {
        err(`suspendedUntil が YYYY-MM-DD 形式ではありません: ${suspendedUntil}`);
      }
      review.suspendedUntil = suspendedUntil;
    }

    const lastResult = get('lastResult');
    if (lastResult === '') {
      review.lastResult = 'unanswered';
    } else {
      providedReview = true;
      if (!RESULTS.includes(lastResult)) err(`lastResult が不正です: ${lastResult}`);
      review.lastResult = lastResult;
    }

    const lastAnsweredAt = get('lastAnsweredAt');
    if (lastAnsweredAt === '') {
      review.lastAnsweredAt = null;
    } else {
      providedReview = true;
      if (!isIsoDateTime(lastAnsweredAt)) {
        err(`lastAnsweredAt がISO8601形式ではありません: ${lastAnsweredAt}`);
      }
      review.lastAnsweredAt = lastAnsweredAt;
    }

    // 規則14
    if (review.correctCount + review.partialCount > review.totalCount) {
      err(
        `correctCount + partialCount が totalCount を超えています` +
          `（${review.correctCount} + ${review.partialCount} > ${review.totalCount}）`
      );
    }

    rows.push({
      line,
      id: id === '' ? null : id,
      card: {
        type,
        question,
        choices,
        answerIndex: type === 'choice' ? answerIndex : null,
        answer,
        explanation: getRaw('explanation'),
      },
      review,
      providedReview,
    });
  }

  return { errors, rows };
}

export function newCardIdIfNeeded(id) {
  return id || uuid();
}
