import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
const workerSource = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const offlineHtml = await readFile(new URL('../offline.html', import.meta.url), 'utf8');
const storefrontHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.equal(manifest.id, '/');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.lang, 'es-CO');
assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
assert.ok(manifest.icons.every(icon => icon.type === 'image/png' && icon.purpose === 'any'));

for (const icon of manifest.icons) {
  const size = Number(icon.sizes.split('x')[0]);
  const image = await readFile(new URL(`..${icon.src}`, import.meta.url));
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), size);
  assert.equal(image.readUInt32BE(20), size);
}

assert.match(storefrontHtml, /<meta name="theme-color" content="#e7193f">/);
assert.match(storefrontHtml, /<link rel="manifest" href="\/manifest\.webmanifest">/);
assert.match(storefrontHtml, /navigator\.serviceWorker\.register\('\/sw\.js', \{ scope: '\/' \}\)/);
assert.match(offlineHtml, /Estás sin conexión/);
assert.match(offlineHtml, /No mostramos inventario, precios ni tarifas guardados como si fueran actuales/);
assert.doesNotMatch(offlineHtml, /(?:\$\s?\d|COP\s?\d|DEMO-\d{3})/);
assert.doesNotMatch(workerSource, /(?:cache|caches)\.put\s*\(/i);

const handlers = {};
const openedCaches = [];
const deletedCaches = [];
const matchedRequests = [];
let precached = [];
let networkFailures = false;
let networkFetches = 0;
let skippedWaiting = false;
let claimedClients = false;

const cache = {
  async addAll(urls) { precached = [...urls]; },
};

const sandbox = {
  URL,
  Promise,
  Set,
  Response: { error: () => 'network-error' },
  fetch: async request => {
    networkFetches += 1;
    if (networkFailures) throw new Error('offline');
    return { status: 200, url: typeof request === 'string' ? request : request.url };
  },
  caches: {
    async open(name) { openedCaches.push(name); return cache; },
    async keys() { return ['unrelated-cache', 'sirevya-shell-v0', 'sirevya-shell-v1']; },
    async delete(name) { deletedCaches.push(name); return true; },
    async match(request) {
      matchedRequests.push(request);
      if (request === '/offline.html') return 'offline-shell';
      if (typeof request === 'object' && request.url.endsWith('/assets/pwa/icon-192.png')) return 'cached-icon';
      return null;
    },
  },
  self: {
    location: { origin: 'https://sirevya.test' },
    addEventListener(name, callback) { handlers[name] = callback; },
    async skipWaiting() { skippedWaiting = true; },
    clients: { async claim() { claimedClients = true; } },
  },
};

vm.runInNewContext(workerSource, sandbox, { filename: 'sw.js' });
assert.equal(typeof handlers.install, 'function');
assert.equal(typeof handlers.activate, 'function');
assert.equal(typeof handlers.fetch, 'function');

let installWork;
handlers.install({ waitUntil(promise) { installWork = promise; } });
await installWork;
assert.deepEqual(precached, ['/offline.html', '/manifest.webmanifest', '/assets/pwa/icon-192.png', '/assets/pwa/icon-512.png']);
assert.deepEqual(openedCaches, ['sirevya-shell-v1']);
assert.equal(skippedWaiting, true);

let activateWork;
handlers.activate({ waitUntil(promise) { activateWork = promise; } });
await activateWork;
assert.deepEqual(deletedCaches, ['sirevya-shell-v0']);
assert.equal(claimedClients, true);

async function dispatchFetch(request) {
  let responsePromise;
  handlers.fetch({ request, respondWith(promise) { responsePromise = promise; } });
  return responsePromise;
}

const cachedIcon = await dispatchFetch({
  method: 'GET', mode: 'cors', url: 'https://sirevya.test/assets/pwa/icon-192.png',
});
assert.equal(cachedIcon, 'cached-icon');
assert.equal(networkFetches, 0);

for (const url of [
  'https://sirevya.test/rest/v1/products',
  'https://sirevya.test/__preview_api/rest/v1/rpc/get_public_catalog',
  'https://supabase.invalid/rest/v1/products',
]) {
  assert.equal(await dispatchFetch({ method: 'GET', mode: 'cors', url }), undefined, `${url} must not be intercepted.`);
}
for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
  assert.equal(await dispatchFetch({ method, mode: 'cors', url: 'https://sirevya.test/' }), undefined, `${method} must not be intercepted or cached.`);
}
assert.equal(networkFetches, 0, 'Los métodos distintos de GET no deben llegar al fetch del service worker.');

const freshPage = await dispatchFetch({
  method: 'GET', mode: 'navigate', url: 'https://sirevya.test/storefront?availability=available',
});
assert.equal(freshPage.status, 200);
assert.equal(networkFetches, 1);
assert.ok(!matchedRequests.some(request => typeof request === 'object' && request.url.includes('/storefront')));

networkFailures = true;
const offlinePage = await dispatchFetch({
  method: 'GET', mode: 'navigate', url: 'https://sirevya.test/index.html',
});
assert.equal(offlinePage, 'offline-shell');
assert.ok(matchedRequests.includes('/offline.html'));

console.log('pwa_shell_regression: OK (iconos cuadrados; solo shell estático en caché; navegación viva network-first; catálogo, APIs y mutaciones sin caché)');
