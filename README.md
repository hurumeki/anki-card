# 暗記アプリ（PWA）

`暗記アプリ仕様書_v3.md` を実装した、オフラインで動作する間隔反復（SM-2）暗記アプリです。
バックエンドなし・ビルド不要の静的サイトで、GitHub Pages にそのまま配信できます。

- データ保存：IndexedDB（`decks` / `cards` / `reviewStates` / `settings`）
- 判定：1問1答・多肢選択・並べ替えは2値、組み合わせ・順番当ては**部分点あり（3値）**
- PWA：Service Worker によるアプリシェルキャッシュ（Cache First）＋インストール可能

## 使い方

```bash
npm start          # http://127.0.0.1:8080 で配信（任意の静的サーバでも可）
npm test           # ロジックのテスト（node --test）
```

Service Worker を有効にするため、`file://` ではなく HTTP(S) で開いてください。

### GitHub Pages への配信

リポジトリの Settings → Pages で「Deploy from a branch」を選び、対象ブランチのルート（`/`）を指定します。
ビルド手順は不要です（`.nojekyll` を配置済み）。

## 画面構成

| 画面 | ルート | 仕様 |
|---|---|---|
| ホーム／デッキ一覧 | `#/` | 4.1 / 4.2 |
| カード一覧 | `#/deck/<deckId>` | 4.4 |
| デッキ未所属カード | `#/unassigned` | 4.8 |
| カード作成／編集 | `#/card/new/<deckId\|none>` / `#/card/<cardId>` | 4.5 |
| CSVインポート | `#/import` / `#/import/<deckId>` | 4.3 / 7章 |
| 設定 | `#/settings` | 4.6 |
| カード画面・リザルト | `#/session/<deckId>` | 4.7 / 4.9 |

## ソース構成

```
index.html          エントリポイント
manifest.json       PWAマニフェスト
sw.js               Service Worker（キャッシュ名にビルドバージョンを含む）
css/style.css       スタイル
assets/             アイコン（SVG / PNG 192・512・maskable）
sample-cards.csv    全形式を含むインポート用サンプル
src/
  app.js            ルーティングと起動処理
  db.js             IndexedDB アクセス層（Card と ReviewState は同一トランザクション）
  settings.js       グローバル設定と既定値（1.5）
  format.js         形式ごとのデータ構造・組み合わせのエスケープ（2章）
  scoring.js        一致率の算出と3値判定（3.1〜3.3）
  sm2.js            SM-2 更新式（3.4）
  session.js        出題対象の抽出とセット進行（5章）
  csv.js            CSV入出力・バリデーション（7章）
  pwa.js            永続化要求・インストール案内・SW更新（6.2 / 6.3）
  ui/               各画面
test/run.js         仕様の主要ロジックのテスト
```

## 実装上の補足

- **CSVの `answerIndex`** は列上は1起点、内部では0起点で保持します（仕様7.2）。
- **インポートは全件検証してから適用**します。1行でもエラーがあれば行番号付きで一覧表示し、
  何も書き込みません（仕様4.3 / 7.3）。
- **エクスポート**は絞り込み中なら表示中のカードのみを出力し、`lastExportedAt` を更新します。
  出力は BOM 無し UTF-8 / CRLF 区切りです。
- **やり直し**は、回答直後の問題を表示中ならその回答を取り消し、未回答の問題を表示中なら
  1問前に戻って取り消します。いずれも `prevReviewState` を書き戻し、`checked` は復元しません（仕様5.5）。
- **IndexedDBのキー制約**：キーに `null` / boolean を使えないため、`deckId = null`（未所属）や
  `checked` を含む抽出はインデックスとメモリ上のフィルタを併用しています。
- **Service Worker の更新**はアプリ内バナーからの操作で `skipWaiting()` → `clients.claim()` → リロード。
  セット実施中はバナーを表示せず、更新を適用しません（仕様6.3）。
- 仕様8章の残課題（検索ハイライト、一覧のソート順選択、学習統計、ダークモード、解答時間計測、
  部分正解が続くカードへの対応）は未実装です。
