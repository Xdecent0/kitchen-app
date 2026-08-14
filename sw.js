// Cache-first shell so the shopping list survives a dead signal in the store.

const CACHE = "kitchen-v2";
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
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          if (res.ok && new URL(e.request.url).origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
