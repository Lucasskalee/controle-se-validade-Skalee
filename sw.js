const CACHE_NAME = "skalee-pwa-v145-sg-chunked-import";
const APP_SHELL = [
 "/",
 "/index.html",
 "/skalito-demo.html",
 "/auth.css",
 "/theme-layout.css",
 "/auth.js",
 "/admin-cadastros.css",
 "/admin-cadastros.js",
 "/components/tour/SkalitoTour.js",
 "/components/tour/skalitoTourSteps.js",
 "/components/tour/skalitoTour.css",
 "/components/skalito/SkalitoMascot.js",
 "/components/skalito/skalito.css",
 "/components/skalito/skalitoAnimations.css",
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

self.addEventListener("notificationclick", (event) => {
 event.notification.close();
 const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
 event.waitUntil(
  self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
   const existing = clients.find((client) => client.url.startsWith(self.location.origin));
   if (existing) return existing.focus();
   return self.clients.openWindow(targetUrl);
  })
 );
});
