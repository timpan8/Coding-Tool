import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name !== 'sw.js') files.push(path);
  }
  return files;
}
const files = (await walk('dist')).sort();
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(file));
const revision = hash.digest('hex').slice(0, 16);
const paths = files.map(file => './' + file.replaceAll('\\', '/').slice('dist/'.length));
// Only app-shell assets are cached. User code and values never enter CacheStorage.
const worker = `const PREFIX = 'acv-shell:' + self.registration.scope + ':';
const CACHE = PREFIX + '${revision}';
const ASSETS = ${JSON.stringify(paths)}.map(p => new URL(p, self.registration.scope).href);
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
`;
await writeFile('dist/sw.js', worker);
await writeFile('dist/.nojekyll', '');
console.log(`Offline shell: ${paths.length} local assets, revision ${revision}`);
