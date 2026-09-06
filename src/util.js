// 汎用ユーティリティ（DOM非依存）

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (typeof crypto !== 'undefined' ? crypto : { getRandomValues: fillMath }).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h
    .slice(8, 10)
    .join('')}-${h.slice(10, 16).join('')}`;
}

function fillMath(arr) {
  for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

export function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

/** Date → 'YYYY-MM-DD'（ローカル時刻基準） */
export function toDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function today() {
  return toDateStr(new Date());
}

/** 'YYYY-MM-DD' に days 日加算した日付文字列 */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateStr(dt);
}

export function daysBetween(fromIso, toDate = new Date()) {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return Infinity;
  return Math.floor((toDate.getTime() - from.getTime()) / 86400000);
}

export function nowIso() {
  return new Date().toISOString();
}

export function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function isIsoDateTime(s) {
  return typeof s === 'string' && s !== '' && !Number.isNaN(new Date(s).getTime());
}

/**
 * Fisher-Yates シャッフル。
 * 仕様2.4：結果が元の並びと完全一致した場合は再シャッフルする（要素数1以下は不要）。
 */
export function shuffle(arr) {
  if (arr.length <= 1) return arr.slice();
  let out;
  let guard = 0;
  do {
    out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    guard++;
  } while (guard < 100 && out.every((v, i) => v === arr[i]));
  return out;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
