// 出題対象の抽出とセット進行（仕様4.7 / 5章）
import { addDays, shuffle, today } from './util.js';
import { applyResult } from './sm2.js';
import * as db from './db.js';

/**
 * 出題対象の抽出（仕様5.1）。純粋関数。
 * @param {{card:object, review:object}[]} entries 対象デッキのカード
 * @param {object} settings
 * @param {string} todayStr
 */
export function buildQueue(entries, settings, todayStr = today()) {
  const items = entries.filter((e) => e.review);
  let picked;
  if (settings.scope === 'all') {
    picked = items.slice();
    if (settings.shuffleAll) picked = shuffle(picked);
    else picked.sort((a, b) => a.card.createdAt.localeCompare(b.card.createdAt));
  } else {
    const target = items.filter(
      (e) =>
        e.review.dueDate <= todayStr &&
        (!e.review.suspendedUntil || e.review.suspendedUntil <= todayStr)
    );
    const reviewCards = target
      .filter((e) => e.review.lastResult !== 'unanswered')
      .sort(
        (a, b) =>
          a.review.dueDate.localeCompare(b.review.dueDate) ||
          a.card.createdAt.localeCompare(b.card.createdAt)
      );
    const newCards = target
      .filter((e) => e.review.lastResult === 'unanswered')
      .sort((a, b) => a.card.createdAt.localeCompare(b.card.createdAt));
    picked = reviewCards.concat(newCards);
  }
  const size = settings.setSize;
  return size === null || size === undefined ? picked : picked.slice(0, size);
}

/** セット実施中の状態（非永続。仕様1.4 / 5.3） */
export class Session {
  constructor(entries, settings) {
    this.settings = settings;
    this.cards = entries.map((e) => e.card);
    this.items = entries.map((e) => ({
      cardId: e.card.cardId,
      result: 'pending',
      score: null,
      nextDueDate: null,
      prevReviewState: null,
    }));
    this.index = 0;
  }

  get length() {
    return this.items.length;
  }

  get current() {
    return this.cards[this.index] || null;
  }

  get currentItem() {
    return this.items[this.index] || null;
  }

  get isFinished() {
    return this.index >= this.items.length;
  }

  /** 直前の問題（前問の解答表示用）。セット先頭では null */
  get previous() {
    if (this.index === 0) return null;
    return { card: this.cards[this.index - 1], item: this.items[this.index - 1] };
  }

  itemFor(cardId) {
    return this.items.find((i) => i.cardId === cardId) || null;
  }

  cardFor(cardId) {
    return this.cards.find((c) => c.cardId === cardId) || null;
  }

  /** 回答済み／スキップ済みの問題（リザルト表示用） */
  answeredItems() {
    return this.items.filter((i) => i.result !== 'pending');
  }

  summary() {
    const s = { correct: 0, partial: 0, incorrect: 0, skipped: 0 };
    for (const i of this.items) {
      if (i.result in s) s[i.result]++;
    }
    return s;
  }

  /**
   * 回答を確定してReviewStateへ即時保存する（仕様5.2）。
   * @param {'correct'|'partial'|'incorrect'} result
   * @param {number|null} score
   */
  async answer(result, score) {
    const item = this.currentItem;
    if (!item) return null;
    const prev = await db.getReviewState(item.cardId);
    item.prevReviewState = prev ? JSON.parse(JSON.stringify(prev)) : null;
    const next = applyResult(prev, result, score ?? null, this.settings, today());
    await db.putReviewState(next);
    item.result = result;
    item.score = score ?? null;
    item.nextDueDate = next.dueDate;
    return next;
  }

  /**
   * スキップ（仕様5.4）。
   * 回答済みの場合は先にReviewStateを復元してから実行する。
   */
  async skip() {
    const item = this.currentItem;
    if (!item) return;
    if (item.result !== 'pending' && item.prevReviewState) {
      await db.putReviewState(item.prevReviewState);
    }
    const prev = await db.getReviewState(item.cardId);
    item.prevReviewState = prev ? JSON.parse(JSON.stringify(prev)) : null;
    if (this.settings.scope === 'review' && prev) {
      // repetition / interval / easiness / dueDate は変更しない
      const next = { ...prev, suspendedUntil: addDays(today(), 1) };
      await db.putReviewState(next);
    }
    item.result = 'skipped';
    item.score = null;
    item.nextDueDate = prev ? prev.dueDate : null;
  }

  next() {
    this.index++;
  }

  /**
   * やり直し（仕様5.5）。回答済みの問題を表示中ならその回答を取り消し、
   * 未回答表示中なら1問前に戻って取り消す。セット先頭まで繰り返し遡れる。
   * checked は復元対象外。
   */
  async undo() {
    if (this.currentItem && this.currentItem.result !== 'pending') {
      await this.revert(this.index);
      return true;
    }
    if (this.index === 0) return false;
    this.index--;
    await this.revert(this.index);
    return true;
  }

  canUndo() {
    return this.index > 0 || (this.currentItem && this.currentItem.result !== 'pending');
  }

  /** 指定位置の回答を取り消してReviewStateを書き戻す */
  async revert(i) {
    const item = this.items[i];
    if (!item) return;
    if (item.prevReviewState) {
      const cur = await db.getReviewState(item.cardId);
      const restored = { ...item.prevReviewState };
      if (cur) restored.checked = cur.checked; // checked は復元しない
      await db.putReviewState(restored);
    }
    item.result = 'pending';
    item.score = null;
    item.nextDueDate = null;
    item.prevReviewState = null;
  }
}

/** デッキから新しいセットを構築する */
export async function startSession(deckId, settings) {
  const entries = await db.listCards(deckId);
  const queue = buildQueue(entries, settings);
  return new Session(queue, settings);
}
