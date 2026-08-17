// Offline support.
//
// The app shell is small and changes often, so it is fetched fresh when the
// network allows. The data files are large, immutable and the whole point of
// the app, so once a shard has been read it is kept forever.

const SHELL = 'concord-shell-v1';
const DATA = 'concord-data-v1';

const SHELL_FILES = [
  './', './index.html', './css/app.css',
  './js/app.js', './js/data.js', './js/refs.js', './js/search.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Data: cache first. A verse does not change.
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      caches.open(DATA).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // Shell: network first, falling back to cache when offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
  );
});
