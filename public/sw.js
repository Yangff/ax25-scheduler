/// <reference lib="webworker" />

const CACHE_NAME = 'pwa-cache-v1';
const BASE = self.location.pathname.replace(/sw\.js$/, '');

// Install: fetch version.json and pre-cache all files individually
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(BASE + 'version.json', { cache: 'no-store' });
        const data = await res.json();
        const urls = Object.keys(data.files).map((f) => BASE + f);
        urls.push(BASE + 'version.json');
        // Cache files individually so one failure doesn't block others
        await Promise.allSettled(
          urls.map(async (url) => {
            try {
              const r = await fetch(url, { cache: 'no-store' });
              if (r.ok) await cache.put(url, r);
            } catch (_e) { /* skip */ }
          })
        );
        // Also cache the root URL (navigating to BASE itself)
        try {
          const indexRes = await fetch(BASE, { cache: 'no-store' });
          if (indexRes.ok) await cache.put(BASE, indexRes);
        } catch (_e) { /* skip */ }
      } catch (_e) {
        // Offline during install — nothing to cache yet
      }
      self.skipWaiting();
    })()
  );
});

// Activate: claim clients and clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      // Clean old cache versions
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })()
  );
});

// Fetch: cache-first, fallback to network, catch network errors
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  const pathname = url.pathname;
  // Hashed assets (e.g. /assets/index-CUn2WNqI.js) have content hash in filename
  // so they're safe to cache-first — the hash changes when content changes.
  const isHashedAsset = pathname.includes('/assets/');

  if (isHashedAsset) {
    // Cache-first for hashed static assets
    event.respondWith(
      (async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        try {
          const res = await fetch(event.request);
          if (res.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, res.clone());
          }
          return res;
        } catch (_e) {
          return new Response('Offline — resource not cached', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
      })()
    );
    return;
  }

  // Network-first for everything else (HTML, JSON data, icons, sw.js)
  // Always try to get the latest, fall back to cache when offline
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(event.request);
        if (res.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, res.clone());
        }
        return res;
      } catch (_e) {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        // SPA fallback for navigation
        if (event.request.mode === 'navigate') {
          const idx = await caches.match(BASE + 'index.html');
          if (idx) return idx;
        }
        return new Response('Offline — resource not cached', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })()
  );
});

// Listen for update-check messages from the app
self.addEventListener('message', (event) => {
  if (event.data === 'check-update') {
    checkForUpdates();
  }
});

async function checkForUpdates() {
  try {
    const networkRes = await fetch(BASE + 'version.json', { cache: 'no-store' });
    if (!networkRes.ok) return;
    const newVersion = await networkRes.json();

    const cache = await caches.open(CACHE_NAME);
    const cachedRes = await cache.match(BASE + 'version.json');
    const oldVersion = cachedRes ? await cachedRes.json() : { files: {} };

    let hasChanges = false;

    // Download changed or new files, but skip if already cached by network-first
    for (const [file, hash] of Object.entries(newVersion.files)) {
      if (oldVersion.files[file] !== hash) {
        hasChanges = true;
        const existing = await cache.match(BASE + file);
        if (!existing) {
          try {
            const fileRes = await fetch(BASE + file, { cache: 'no-store' });
            if (fileRes.ok) {
              await cache.put(new Request(BASE + file), fileRes);
            }
          } catch (_e) {
            // skip individual file errors
          }
        }
      }
    }

    // Remove files that no longer exist in version.json
    for (const file of Object.keys(oldVersion.files)) {
      if (!(file in newVersion.files)) {
        hasChanges = true;
        await cache.delete(new Request(BASE + file));
      }
    }

    // Clean up any cached URLs not present in the new version.json
    // This catches stale hashed assets (e.g. old index-OLDHASH.js)
    const validUrls = new Set(
      Object.keys(newVersion.files).map((f) => BASE + f)
    );
    validUrls.add(BASE + 'version.json');
    validUrls.add(BASE); // root navigation
    const cachedRequests = await cache.keys();
    for (const req of cachedRequests) {
      const cachedPath = new URL(req.url).pathname;
      if (!validUrls.has(cachedPath)) {
        await cache.delete(req);
      }
    }

    // Always update cached version.json to keep hashes in sync
    await cache.put(
      new Request(BASE + 'version.json'),
      new Response(JSON.stringify(newVersion), {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    if (hasChanges) {
      const clients = await self.clients.matchAll();
      for (const client of clients) {
        client.postMessage({ type: 'update-available' });
      }
    }
  } catch (_e) {
    // Network error — skip update check
  }
}
