// IndexedDB アクセス層（仕様6.1）
import { DEFAULT_SETTINGS, withDefaults } from './settings.js';
import { nowIso, today, uuid } from './util.js';

const DB_NAME = 'memoapp';
const DB_VERSION = 1;
const SETTINGS_KEY = 'global';

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('decks')) {
        db.createObjectStore('decks', { keyPath: 'deckId' });
      }
      if (!db.objectStoreNames.contains('cards')) {
        const s = db.createObjectStore('cards', { keyPath: 'cardId' });
        s.createIndex('deckId', 'deckId', { unique: false });
      }
      if (!db.objectStoreNames.contains('reviewStates')) {
        const s = db.createObjectStore('reviewStates', { keyPath: 'cardId' });
        // 注：IndexedDBのキーには null / boolean を使えないため、
        // deckId=null や checked を含む抽出はメモリ上でのフィルタと併用する。
        s.createIndex('deckId_dueDate', ['deckId', 'dueDate'], { unique: false });
        s.createIndex('deckId_checked', ['deckId', 'checked'], { unique: false });
        s.createIndex('deckId', 'deckId', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** トランザクションを張って fn(stores) を実行し、完了を待つ */
export async function tx(storeNames, mode, fn) {
  const db = await openDb();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    const stores = {};
    names.forEach((n) => (stores[n] = t.objectStore(n)));
    let result;
    let failed = null;
    Promise.resolve()
      .then(() => fn(stores, t))
      .then((r) => {
        result = r;
      })
      .catch((e) => {
        failed = e;
        try { t.abort(); } catch { /* already finished */ }
      });
    t.oncomplete = () => (failed ? reject(failed) : resolve(result));
    t.onerror = () => reject(failed || t.error);
    t.onabort = () => reject(failed || t.error || new Error('transaction aborted'));
  });
}

const get = (store, key) => reqAsPromise(store.get(key));
const getAll = (store, query) => reqAsPromise(store.getAll(query));

// ---------- 設定 ----------

export async function loadSettings() {
  const rec = await tx('settings', 'readonly', (s) => get(s.settings, SETTINGS_KEY));
  return withDefaults(rec ? rec.value : null);
}

export async function saveSettings(settings) {
  const value = withDefaults(settings);
  await tx('settings', 'readwrite', (s) =>
    reqAsPromise(s.settings.put({ key: SETTINGS_KEY, value }))
  );
  return value;
}

export async function patchSettings(patch) {
  const cur = await loadSettings();
  return saveSettings({ ...cur, ...patch });
}

export { DEFAULT_SETTINGS };

// ---------- デッキ ----------

export async function listDecks() {
  const decks = await tx('decks', 'readonly', (s) => getAll(s.decks));
  return decks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getDeck(deckId) {
  return tx('decks', 'readonly', (s) => get(s.decks, deckId));
}

export async function createDeck(name) {
  const deck = {
    deckId: uuid(),
    name,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await tx('decks', 'readwrite', (s) => reqAsPromise(s.decks.put(deck)));
  return deck;
}

export async function renameDeck(deckId, name) {
  return tx('decks', 'readwrite', async (s) => {
    const deck = await get(s.decks, deckId);
    if (!deck) throw new Error('デッキが見つかりません');
    deck.name = name;
    deck.updatedAt = nowIso();
    await reqAsPromise(s.decks.put(deck));
    return deck;
  });
}

/**
 * デッキ削除（仕様4.2）。
 * @param {boolean} deleteCards true=カードも物理削除 / false=カードを未所属化
 */
export async function deleteDeck(deckId, deleteCards) {
  return tx(['decks', 'cards', 'reviewStates'], 'readwrite', async (s) => {
    const cards = await reqAsPromise(s.cards.index('deckId').getAll(deckId));
    for (const card of cards) {
      if (deleteCards) {
        await reqAsPromise(s.cards.delete(card.cardId));
        await reqAsPromise(s.reviewStates.delete(card.cardId));
      } else {
        card.deckId = null;
        card.updatedAt = nowIso();
        await reqAsPromise(s.cards.put(card));
        const rs = await get(s.reviewStates, card.cardId);
        if (rs) {
          rs.deckId = null;
          await reqAsPromise(s.reviewStates.put(rs));
        }
      }
    }
    await reqAsPromise(s.decks.delete(deckId));
    return cards.length;
  });
}

// ---------- カード ----------

export function newReviewState(cardId, deckId, settings) {
  return {
    cardId,
    deckId: deckId ?? null,
    repetition: 0,
    interval: 0,
    easiness: settings.efInitial,
    dueDate: today(),
    lastResult: 'unanswered',
    lastScore: null,
    lastAnsweredAt: null,
    totalCount: 0,
    correctCount: 0,
    partialCount: 0,
    checked: false,
    suspendedUntil: null,
  };
}

export function newCard(deckId, data = {}) {
  return {
    cardId: uuid(),
    deckId: deckId ?? null,
    type: data.type || 'single',
    question: data.question || '',
    choices: data.choices || [],
    answerIndex: data.answerIndex ?? null,
    answer: data.answer || '',
    explanation: data.explanation || '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

/** Card と ReviewState を同一トランザクションで作成（仕様6.1） */
export async function createCard(card, settings) {
  return tx(['cards', 'reviewStates'], 'readwrite', async (s) => {
    await reqAsPromise(s.cards.put(card));
    await reqAsPromise(
      s.reviewStates.put(newReviewState(card.cardId, card.deckId, settings))
    );
    return card;
  });
}

export async function updateCard(card) {
  card.updatedAt = nowIso();
  return tx(['cards', 'reviewStates'], 'readwrite', async (s) => {
    await reqAsPromise(s.cards.put(card));
    const rs = await get(s.reviewStates, card.cardId);
    if (rs && rs.deckId !== card.deckId) {
      rs.deckId = card.deckId;
      await reqAsPromise(s.reviewStates.put(rs));
    }
    return card;
  });
}

export async function deleteCard(cardId) {
  return tx(['cards', 'reviewStates'], 'readwrite', async (s) => {
    await reqAsPromise(s.cards.delete(cardId));
    await reqAsPromise(s.reviewStates.delete(cardId));
  });
}

/** カードの所属デッキ変更（Card / ReviewState を同一トランザクションで更新） */
export async function moveCard(cardId, deckId) {
  return tx(['cards', 'reviewStates'], 'readwrite', async (s) => {
    const card = await get(s.cards, cardId);
    if (!card) throw new Error('カードが見つかりません');
    card.deckId = deckId ?? null;
    card.updatedAt = nowIso();
    await reqAsPromise(s.cards.put(card));
    const rs = await get(s.reviewStates, cardId);
    if (rs) {
      rs.deckId = card.deckId;
      await reqAsPromise(s.reviewStates.put(rs));
    }
    return card;
  });
}

export async function getCard(cardId) {
  return tx('cards', 'readonly', (s) => get(s.cards, cardId));
}

/**
 * デッキのカードとReviewStateを取得。
 * deckId に null を渡すとデッキ未所属カード、undefined で全件。
 */
export async function listCards(deckId) {
  return tx(['cards', 'reviewStates'], 'readonly', async (s) => {
    let cards = await getAll(s.cards);
    if (deckId !== undefined) {
      cards = cards.filter((c) => (c.deckId ?? null) === (deckId ?? null));
    }
    const states = await getAll(s.reviewStates);
    const map = new Map(states.map((r) => [r.cardId, r]));
    return cards.map((card) => ({ card, review: map.get(card.cardId) || null }));
  });
}

export async function getReviewState(cardId) {
  return tx('reviewStates', 'readonly', (s) => get(s.reviewStates, cardId));
}

export async function putReviewState(state) {
  return tx('reviewStates', 'readwrite', (s) => reqAsPromise(s.reviewStates.put(state)));
}

export async function setChecked(cardId, checked) {
  return tx('reviewStates', 'readwrite', async (s) => {
    const rs = await get(s.reviewStates, cardId);
    if (!rs) return null;
    rs.checked = !!checked;
    await reqAsPromise(s.reviewStates.put(rs));
    return rs;
  });
}

/** デッキごとの枚数と本日の要復習数（仕様4.1） */
export async function deckStats() {
  const t = today();
  return tx(['cards', 'reviewStates'], 'readonly', async (s) => {
    const cards = await getAll(s.cards);
    const states = await getAll(s.reviewStates);
    const map = new Map(states.map((r) => [r.cardId, r]));
    const stats = new Map();
    let unassigned = 0;
    for (const card of cards) {
      const key = card.deckId ?? null;
      if (key === null) {
        unassigned++;
        continue;
      }
      const cur = stats.get(key) || { count: 0, due: 0 };
      cur.count++;
      const rs = map.get(card.cardId);
      if (rs && rs.dueDate <= t && (!rs.suspendedUntil || rs.suspendedUntil <= t)) cur.due++;
      stats.set(key, cur);
    }
    return { stats, unassigned };
  });
}

/**
 * CSVインポートの一括適用（仕様4.3 / 7.4）。全件を1トランザクションで適用する。
 * @param {object[]} rows parseImportCsv の rows
 * @param {string|null} deckId インポート先デッキ
 * @param {{updateCardData:boolean, importReview:boolean}} opts
 */
export async function applyImport(rows, deckId, opts, settings) {
  return tx(['cards', 'reviewStates'], 'readwrite', async (s) => {
    const result = { added: 0, updated: 0, skipped: 0 };
    for (const row of rows) {
      const existing = row.id ? await get(s.cards, row.id) : null;
      if (existing) {
        // 既存カードと一致：更新オプションに従う（所属デッキは維持）
        let touched = false;
        if (opts.updateCardData) {
          Object.assign(existing, row.card);
          existing.updatedAt = nowIso();
          await reqAsPromise(s.cards.put(existing));
          touched = true;
        }
        if (opts.importReview) {
          const rs = (await get(s.reviewStates, existing.cardId)) ||
            newReviewState(existing.cardId, existing.deckId, settings);
          Object.assign(rs, row.review);
          rs.deckId = existing.deckId ?? null;
          await reqAsPromise(s.reviewStates.put(rs));
          touched = true;
        }
        if (touched) result.updated++;
        else result.skipped++;
        continue;
      }
      // 新規追加（id指定ありで既存に無い場合は指定idをそのまま採用）
      const cardId = row.id || uuid();
      const card = {
        cardId,
        deckId: deckId ?? null,
        ...row.card,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await reqAsPromise(s.cards.put(card));
      const rs = newReviewState(cardId, card.deckId, settings);
      if (row.providedReview) Object.assign(rs, row.review);
      rs.cardId = cardId;
      rs.deckId = card.deckId ?? null;
      await reqAsPromise(s.reviewStates.put(rs));
      result.added++;
    }
    return result;
  });
}
