const PREFIX = 'acv-shell:' + self.registration.scope + ':';
const CACHE = PREFIX + '2038405362720e0d';
const ASSETS = ["./assets/CodeEditor-C9THN3Ns.css","./assets/CodeEditor-ePYhRxpP.js","./assets/DiffEditor-ByncMy6t.js","./assets/codicon-Brq4_Ui5.ttf","./assets/editor-jjEx9u7D.css","./assets/editor.api-BIttNAso.js","./assets/editor.worker-DKXjC3Lf.js","./assets/index-BaNPicZY.js","./assets/index-Bx-MDGD1.css","./icon.svg","./index.html","./manifest.webmanifest"].map(p => new URL(p, self.registration.scope).href);
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); });
self.addEventListener('activate', event => { event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()); });
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const shell = new URL('./index.html', self.registration.scope).href;
  const key = request.mode === 'navigate' && url.origin === self.location.origin && url.pathname === new URL(self.registration.scope).pathname ? shell : url.href;
  if (!ASSETS.includes(key)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(key)).then(response => response || Response.error()));
});
