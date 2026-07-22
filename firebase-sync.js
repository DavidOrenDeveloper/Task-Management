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
  status: "idle", // "idle" | "unconfigured" | "connecting" | "error" | "connected"
  errorMessage: "",
  _queue: [],

  init() {
    const apiKey = (FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey || "").trim();
    if (!apiKey || apiKey === "YOUR_API_KEY") {
      this.status = "unconfigured";
      console.warn("[cloud] Firebase לא מוגדר עדיין — תזכורות ימשיכו לפעול רק כשהאפליקציה פתוחה. ראה SETUP-CLOUD.md");
      window.dispatchEvent(new CustomEvent("cloud-status"));
      return;
    }
    this.status = "connecting";
    window.dispatchEvent(new CustomEvent("cloud-status"));
    try {
      const app = initializeApp(FIREBASE_CONFIG);
      this.db = getFirestore(app);
      this.enabled = true;
      const auth = getAuth(app);
      signInAnonymously(auth).catch((e) => {
        // סיבות נפוצות: "התחברות אנונימית" לא הופעלה בקונסולת Firebase (Authentication →
        // Sign-in method → Anonymous → Enable), או שהערכים ב-firebase-config.js לא מדויקים.
        this.status = "error";
        this.errorMessage = (e && e.code) || (e && e.message) || String(e);
        console.error("[cloud] auth failed:", this.errorMessage, e);
        window.dispatchEvent(new CustomEvent("cloud-status"));
      });
      onAuthStateChanged(auth, (user) => {
        if (user) {
          this.ready = true;
          this.status = "connected";
          this._queue.forEach((fn) => fn());
          this._queue = [];
          window.dispatchEvent(new CustomEvent("cloud-status"));
          window.dispatchEvent(new CustomEvent("cloud-ready"));
        }
      });
    } catch (e) {
      this.status = "error";
      this.errorMessage = (e && e.message) || String(e);
      console.error("[cloud] init failed:", this.errorMessage, e);
      window.dispatchEvent(new CustomEvent("cloud-status"));
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
        this._reportWriteError(e, "upsertReminder");
      }
    });
  },

  removeReminder(taskId) {
    if (!this.enabled) return;
    this._whenReady(() => {
      deleteDoc(this._reminderDoc(taskId)).catch((e) => this._reportWriteError(e, "removeReminder"));
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
          this._reportWriteError(e, "saveSubscription");
        }
        resolve();
      });
    });
  },

  _reportWriteError(e, where) {
    // סיבה נפוצה: חוקי Firestore (Rules) לא הודבקו/לא פורסמו, ולכן הכתיבה נחסמת
    // (permission-denied) — יש לוודא בקונסולת Firebase → Firestore → Rules → Publish.
    const msg = (e && e.code) || (e && e.message) || String(e);
    console.error(`[cloud] ${where} failed:`, msg, e);
    if (msg && String(msg).includes("permission-denied")) {
      this.status = "error";
      this.errorMessage = "permission-denied — יש לבדוק שחוקי ה-Firestore הודבקו ופורסמו (Publish)";
      window.dispatchEvent(new CustomEvent("cloud-status"));
    }
  },
};

window.CloudSync = CloudSync;
window.CLOUD_VAPID_PUBLIC_KEY = VAPID_PUBLIC_KEY;
CloudSync.init();
