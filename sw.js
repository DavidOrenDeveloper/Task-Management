// sw.js — קאשינג לשימוש אופליין + זיהוי גרסה חדשה.
// חשוב: בכל פעם שמעדכנים את האפליקציה, יש להעלות את מספר CACHE_VERSION למטה.
// זה מה שגורם לטלפונים להוריד את הגרסה החדשה בפתיחה הבאה.

const CACHE_VERSION = "v2.0.1";
const CACHE_NAME = `elec-site-app-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./style.css",
  "./app.js",
  "./storage.js",
  "./firebase-config.js",
  "./firebase-sync.js",
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

// ---------- Web Push: real OS notifications, even when the app is fully closed ----------
// Triggered by the GitHub Action (see send-reminders.js) via the browser's push service.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { title: "⏰ תזכורת", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "⏰ תזכורת";
  const options = {
    body: data.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: data.tag || "reminder",
    vibrate: [200, 100, 200],
    data: { url: data.url || "./" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
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
