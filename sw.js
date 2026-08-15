// Offline support for the shopping list, without freezing the app on old code.
//
// Cache-first looks right for a store aisle with no signal, but it also means a
// deployed fix may never reach the phone: the cache answers first, forever.
// So the network wins whenever it answers, and the cache is the fallback —
// which is exactly what "works in the store" actually requires.

const CACHE = "kitchen-v4";

const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./lib/dom.js",
  "./lib/state.js",
  "./lib/store.js",
  "./lib/model.js",
  "./lib/recipes.js",
  "./lib/planning.js",
  "./lib/github.js",
  "./lib/sync.js",
  "./lib/receipt.js",
  "./lib/vault.js",
  "./screens/list.js",
  "./screens/stock.js",
  "./screens/item.js",
  "./screens/scan.js",
  "./screens/audit.js",
  "./screens/recipes.js",
  "./screens/recipe.js",
  "./screens/cook.js",
  "./screens/menu.js",
  "./screens/stores.js",
  "./screens/tracking.js",
  "./screens/receipts.js",
  "./screens/settings.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // reload skips the HTTP cache, so a fresh install never seeds itself stale.
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit ?? caches.match("./index.html"))
      )
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
