const CACHE_VERSION = "skalee-v4.3.3-upcoming-checklist";
const CACHE_NAME = CACHE_VERSION;

const APP_SHELL = [
  "/",
  "/index.html",
  "/local-store.js",
  "/product-image-service.js",
  "/product-detail.js",
  "/product-gallery.js",
  "/product-detail.css",
  "/local-query.js",
  "/skalito-demo.html",
  "/auth.css",
  "/theme-layout.css",
  "/auth.js",
  "/audit-report-generator.js",
  "/audit-access.js",
  "/admin-cadastros.css",
  "/notification-center.css",
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

const EXTERNAL_CDN_HOSTS = new Set([
  "esm.sh",
  "unpkg.com",
  "cdnjs.cloudflare.com"
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn("[SW] Erro parcial ao cachear App Shell:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => {
          console.debug("[SW] Removendo cache antigo:", key);
          return caches.delete(key);
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Development / Localhost bypass: Network-first to prevent stale cache during evaluation
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // 1. Navigation requests (App Shell)
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.ok) {
                const copy = networkResponse.clone();
                const cacheKey = url.pathname === "/" ? "/index.html" : request;
                caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
              }
              return networkResponse;
            })
            .catch(() => cachedResponse || caches.match("/index.html"));

          // If we have a cached response, return it immediately for instant load, while revalidating
          return cachedResponse || fetchPromise;
        })
    );
    return;
  }

  // 2. Local Same-Origin Assets (CSS, JS, Images, Manifest)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              const copy = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 3. External CDN Assets (zxing, html5-qrcode, supabase-js from esm.sh)
  if (EXTERNAL_CDN_HOSTS.has(url.hostname)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              const copy = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
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
