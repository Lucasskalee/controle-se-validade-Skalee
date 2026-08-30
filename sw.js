const CACHE_NAME = "skalee-pwa-v114-mascot-demo";
const APP_SHELL = [
 "/",
 "/index.html",
 "/skalito-demo.html",
 "/auth.css",
 "/auth.js",
 "/admin-cadastros.css",
 "/admin-cadastros.js",
 "/manifest.webmanifest",
 "/skalee-icon-64.png",
 "/skalee-icon-192.png",
 "/skalee-icon-512.png",
 "/skalee-icon-maskable-192.png",
 "/skalee-icon-maskable-512.png",
 "/skalee-symbol-enhanced.png",
 "/skalee-symbol-transparent.png",
 "/skalee-wordmark-login.png"
];

self.addEventListener("install", (event) => {
 event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
 self.skipWaiting();
});

self.addEventListener("activate", (event) => {
 event.waitUntil(
  caches.keys()
   .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
   .then(() => self.clients.claim())
 );
});

self.addEventListener("fetch", (event) => {
 const request = event.request;
 const url = new URL(request.url);
 if (request.method !== "GET" || url.origin !== self.location.origin) return;

 if (request.mode === "navigate") {
 event.respondWith(
   fetch(request)
    .then((response) => {
     const copy = response.clone();
     const cacheKey = url.pathname === "/" ? "/index.html" : request;
     caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
     return response;
    })
    .catch(() => caches.match(request).then((cached) => cached || caches.match("/index.html")))
  );
  return;
 }

 event.respondWith(
  fetch(request)
   .then((response) => {
    if (response.ok) {
     const copy = response.clone();
     caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
   })
   .catch(() => caches.match(request))
 );
});
