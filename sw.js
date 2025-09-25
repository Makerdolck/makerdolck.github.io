const CACHE = "calm-flow-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/goo_aura_react_web_gl_glow_blob_that_morphs_and_shifts_colors.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
});
self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
