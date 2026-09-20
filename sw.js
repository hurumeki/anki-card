// Service Worker（仕様6.3）
// キャッシュ名にビルドバージョンを含め、activate時に旧キャッシュを削除する。
const VERSION = 'v1.2.0';
const CACHE_NAME = `memoapp-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './src/app.js',
  './src/db.js',
  './src/csv.js',
  './src/format.js',
  './src/pwa.js',
  './src/scoring.js',
  './src/session.js',
  './src/settings.js',
  './src/sm2.js',
  './src/util.js',
  './src/ui/dom.js',
  './src/ui/home.js',
  './src/ui/cards.js',
  './src/ui/cardEdit.js',
  './src/ui/importCsv.js',
  './src/ui/quiz.js',
  './src/ui/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('memoapp-') && n !== CACHE_NAME).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

// アプリシェルは Cache First。ナビゲーションはオフライン時に index.html を返す。
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await caches.match('./index.html');
        if (cached) return cached;
        try {
          return await fetch(req);
        } catch {
          return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return new Response('', { status: 504 });
      }
    })()
  );
});

// アプリ内の「更新する」操作で待機中のSWを有効化する
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
