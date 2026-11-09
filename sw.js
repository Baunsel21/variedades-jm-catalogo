'use strict';

const CACHE_NAME = 'sirevya-shell-v1';
const CACHE_PREFIX = 'sirevya-shell-';
const SHELL_URLS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/assets/pwa/icon-192.png',
  '/assets/pwa/icon-512.png',
];
const SHELL_PATHS = new Set(SHELL_URLS);
const STOREFRONT_NAVIGATION_PATHS = new Set(['/', '/index.html', '/storefront']);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names
        .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map(name => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (SHELL_PATHS.has(url.pathname) && !url.search) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request)),
    );
    return;
  }

  if (request.mode !== 'navigate' || !STOREFRONT_NAVIGATION_PATHS.has(url.pathname)) return;

  event.respondWith(
    fetch(request).catch(async () => (await caches.match('/offline.html')) || Response.error()),
  );
});
