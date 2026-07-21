// sw.js — קאשינג לשימוש אופליין + זיהוי גרסה חדשה.
// חשוב: בכל פעם שמעדכנים את האפליקציה, יש להעלות את מספר CACHE_VERSION למטה.
// זה מה שגורם לטלפונים להוריד את הגרסה החדשה בפתיחה הבאה.

const CACHE_VERSION = "v1.0.0";
const CACHE_NAME = `elec-site-app-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./style.css",
  "./app.js",
  "./storage.js",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // מתקין את הגרסה החדשה ברקע, אבל לא מפעיל אותה עדיין —
  // ממתין לאישור המשתמש דרך הכפתור "עדכן עכשיו".
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Cache-first לקבצי המעטפת (עובד גם ללא אינטרנט באתר הבנייה),
// עם נפילה לרשת אם משהו חסר בקאש.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
