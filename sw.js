const PREFIX = 'acv-shell:' + self.registration.scope + ':';
const CACHE = PREFIX + 'a272ed71e6b333b0';
const ASSETS = ["./assets/CodeEditor-C9THN3Ns.css","./assets/CodeEditor-CE7_ubFw.js","./assets/DiffEditor-BWeguoMH.js","./assets/codicon-Brq4_Ui5.ttf","./assets/editor-jjEx9u7D.css","./assets/editor.api-BGoUsxnX.js","./assets/editor.worker-DKXjC3Lf.js","./assets/index-Bx-MDGD1.css","./assets/index-D8UFJtQT.js","./icon.svg","./index.html","./manifest.webmanifest"].map(p => new URL(p, self.registration.scope).href);
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
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    if (cached) return cached;
    // A miss used to answer Response.error(), which is a dead end: the worker keeps answering, so
    // every reload fails the same way and the app is unreachable until someone knows to unregister
    // it by hand. A miss is not exotic — the browser evicts CacheStorage under pressure, and an
    // install interrupted midway leaves entries absent. Going to the origin the app was served
    // from is what the browser would do with no worker at all, and it refills the shell so the
    // next load is offline again. Still same-origin only: nothing outside ASSETS reaches here.
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    } catch {
      return Response.error();
    }
  })());
});
