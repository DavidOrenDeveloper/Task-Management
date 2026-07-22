// firebase-sync.js
// שכבת סנכרון קלילה לענן — משמשת אך ורק כדי לאפשר תזכורות אמיתיות בטלפון גם כשהאפליקציה סגורה.
// כל שאר הנתונים (משימות, הזמנות, בניינים, הערות...) נשארים מקומיים בלבד ולא נשלחים לשום מקום.
// נטען כמודול ES רגיל בדפדפן (בלי npm/בנייה) ישירות מ-CDN הרשמי של Firebase.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { FIREBASE_CONFIG, SITE_ID, VAPID_PUBLIC_KEY } from "./firebase-config.js";

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CloudSync = {
  enabled: false,
  ready: false,
  db: null,
  _queue: [],

  init() {
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") {
      console.warn("[cloud] Firebase לא מוגדר עדיין — תזכורות ימשיכו לפעול רק כשהאפליקציה פתוחה. ראה SETUP-CLOUD.md");
      window.dispatchEvent(new CustomEvent("cloud-unconfigured"));
      return;
    }
    try {
      const app = initializeApp(FIREBASE_CONFIG);
      this.db = getFirestore(app);
      this.enabled = true;
      const auth = getAuth(app);
      signInAnonymously(auth).catch((e) => console.error("[cloud] auth failed", e));
      onAuthStateChanged(auth, (user) => {
        if (user) {
          this.ready = true;
          this._queue.forEach((fn) => fn());
          this._queue = [];
          window.dispatchEvent(new CustomEvent("cloud-ready"));
        }
      });
    } catch (e) {
      console.error("[cloud] init failed", e);
    }
  },

  _whenReady(fn) {
    if (this.ready) fn();
    else this._queue.push(fn);
  },

  _reminderDoc(taskId) {
    return doc(this.db, "sites", SITE_ID, "reminders", taskId);
  },
  _subDoc(hash) {
    return doc(this.db, "sites", SITE_ID, "subscriptions", hash);
  },

  // task: { id, title, dueAt, reminder:{enabled, repeatMinutes, lastFiredAt}, status, hold, locationLabel }
  upsertReminder(task) {
    if (!this.enabled) return;
    this._whenReady(async () => {
      try {
        const isActive = task.dueAt && task.reminder && task.reminder.enabled && task.status !== "done" && !task.hold;
        if (!isActive) {
          await deleteDoc(this._reminderDoc(task.id)).catch(() => {});
          return;
        }
        await setDoc(this._reminderDoc(task.id), {
          title: task.title,
          locationLabel: task.locationLabel || "",
          dueAt: task.dueAt,
          repeatMinutes: task.reminder.repeatMinutes || null,
          lastFiredAt: task.reminder.lastFiredAt || null,
          updatedAt: Date.now(),
        });
      } catch (e) {
        console.error("[cloud] upsertReminder failed", e);
      }
    });
  },

  removeReminder(taskId) {
    if (!this.enabled) return;
    this._whenReady(() => {
      deleteDoc(this._reminderDoc(taskId)).catch((e) => console.error("[cloud] removeReminder failed", e));
    });
  },

  saveSubscription(sub) {
    if (!this.enabled) return Promise.resolve();
    return new Promise((resolve) => {
      this._whenReady(async () => {
        try {
          const json = sub.toJSON ? sub.toJSON() : sub;
          const hash = await sha256Hex(json.endpoint);
          await setDoc(this._subDoc(hash), { subscription: json, createdAt: Date.now() });
        } catch (e) {
          console.error("[cloud] saveSubscription failed", e);
        }
        resolve();
      });
    });
  },
};

window.CloudSync = CloudSync;
window.CLOUD_VAPID_PUBLIC_KEY = VAPID_PUBLIC_KEY;
CloudSync.init();
