// Offline copy for the installed app (and any visit): network first, so an online visit always gets the
// current files; the copy saved on the last visit answers only when the network fails. Same-origin GET
// requests inside this folder only. Byte-range requests (the help videos) always go to the network.
const CACHE = 'catan-lens-v2';
// Everything the board page needs to start, plus the help page. A unit test checks this list against the
// modules app.js imports, so a new module cannot be forgotten here.
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'board.js', 'geometry.js', 'score.js', 'lookahead.js', 'drill.js', 'theme.js', 'picture.js', 'imageread.js',
  'how-it-works.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  // One missing file must not stop the rest from being saved. 'reload' skips the browser's HTTP cache, so the saved
  // copy is the current deploy.
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(SHELL.map(file => cache.add(new Request(file, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('catan-lens-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope) || request.headers.has('range')) return;
  // Board links carry their state in the query string and every file is the same for every board, so one copy is
  // kept per file, without the query, and each visit replaces it with the newest.
  const key = url.origin + url.pathname;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic' && response.status === 200) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, copy)));
    }
    return response;
  }).catch(async () => {
    const hit = await caches.match(key);
    if (hit) return hit;
    if (request.mode === 'navigate') return (await caches.match(new URL('index.html', self.registration.scope).href)) || Response.error();
    return Response.error();
  }));
});
