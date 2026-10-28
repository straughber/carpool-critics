/* Carpool Critics — In-Car Prep service worker.
   Keeps the prep sheet usable when the car has no signal.

   Strategy (v2): navigations and data are network-first so a deploy is picked
   up on the next online visit; other assets are stale-while-revalidate so the
   app opens instantly and still works offline. */

const CACHE = 'ccprep-v2';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './data/index.enc.json',
  './data/leaderboard.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' }))))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(request, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes('/prep/')) return;

  const isData = url.pathname.includes('/prep/data/');
  const isNavigation = request.mode === 'navigate' || url.pathname.endsWith('/prep/');
  const isSource = /\.(js|css)$/.test(url.pathname);

  if (isData || isNavigation || isSource) {
    // Network first: fresh HTML, JS, CSS and packs whenever there is signal.
    event.respondWith(
      fetch(request)
        .then((response) => put(request, response))
        .catch(() => caches.match(request, { ignoreSearch: true })
          .then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      const network = fetch(request).then((response) => put(request, response)).catch(() => null);
      return hit || network || Response.error();
    })
  );
});
