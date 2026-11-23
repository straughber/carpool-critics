/* Carpool Critics — In-Car Prep service worker.
   Keeps the prep sheet usable when the car has no signal.

   Strategy (v3): navigations and data are network-first so a deploy is picked
   up on the next online visit; other assets are stale-while-revalidate so the
   app opens instantly and still works offline. */

const CACHE = 'ccprep-v6';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  '../assets/css/site-bar.css',
  './data/index.enc.json'
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

  // The shared brand bar is the one asset this app loads from outside /prep/.
  const isSiteBar = url.pathname === '/assets/css/site-bar.css';
  if (!url.pathname.includes('/prep/') && !isSiteBar) return;

  const isData = url.pathname.includes('/prep/data/');
  const isNavigation = request.mode === 'navigate' || url.pathname.endsWith('/prep/');
  const isSource = /\.(js|css)$/.test(url.pathname);

  if (isData || isNavigation || isSource) {
    // Network first: fresh HTML, JS, CSS and packs whenever there is signal.
    // A cache-busted data request (`…?t=…`) is deliberately *not* stored: it
    // exists to miss every cache, and keeping each one would grow this cache
    // without bound for a file the next visit will re-fetch anyway.
    const busted = url.searchParams.has('t');
    event.respondWith(
      fetch(request)
        .then((response) => (busted ? response : put(request, response)))
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
