/**
 * Palm ID — Service Worker
 * Caches the app shell for offline/fast loading.
 */

'use strict';

// Bump this version on every deploy that changes index.html — it forces the
// service worker to re-cache the app shell so installed users get the update.
const CACHE_NAME    = 'palmid-v8';
const CACHE_VERSION = 8;

// Files to cache on install (app shell)
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ─── Install: cache the app shell ───────────────────────────
self.addEventListener('install', event => {
  console.log('[Palm ID SW] Installing…');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[Palm ID SW] Caching app shell');
      // Use individual adds so one missing file doesn't block the rest
      return Promise.allSettled(
        APP_SHELL.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[Palm ID SW] Failed to cache ${url}:`, err)
          )
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: clean up old caches ──────────────────────────
self.addEventListener('activate', event => {
  console.log('[Palm ID SW] Activating…');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[Palm ID SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: Cache-first for app shell, network-only for API ─
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API calls to Anthropic — always go to network
  if (url.hostname === 'api.anthropic.com') {
    event.respondWith(fetch(request));
    return;
  }

  // For same-origin requests, use cache-first strategy
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) {
          // Serve from cache; revalidate in background
          const networkFetch = fetch(request).then(response => {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, response.clone());
              });
            }
            return response;
          }).catch(() => {/* offline, no-op */});

          return cached;
        }
        // Not in cache — try network
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => {
          // Offline and not cached — return a basic offline page for navigation
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
    );
    return;
  }

  // For cross-origin requests (CDN assets etc.), network with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
