// firebase-sync.js
// שכבת סנכרון לענן. שני תפקידים:
//  1. תזכורות אמיתיות בטלפון גם כשהאפליקציה סגורה (נתוני תזכורות בלבד, תחת sites/SITE_ID).
//  2. גיבוי מלא של כל הנתונים לחשבון ה-Google של המשתמש (תחת users/UID/backups) —
//     כך שמחיקת "נתוני אתר" בדפדפן כבר לא מאבדת כלום. ההתחברות ב-Google היא מה שמאפשר
//     למצוא את הגיבוי גם אחרי שכל הנתונים המקומיים נמחקו (משתמש אנונימי נעלם יחד איתם).
// נטען כמודול ES רגיל בדפדפן (בלי npm/בנייה) ישירות מ-CDN הרשמי של Firebase.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, collection } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { FIREBASE_CONFIG, SITE_ID, VAPID_PUBLIC_KEY } from "./firebase-config.js";

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}


// דחיסת טקסט (gzip → base64) כדי להישאר הרבה מתחת למגבלת 1MB של מסמך Firestore.
async function packText(str) {
  if (typeof CompressionStream === "undefined") return { enc: "json", payload: str };
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { enc: "gzip-b64", payload: btoa(bin) };
}
async function unpackText(enc, payload) {
  if (enc !== "gzip-b64") return payload;
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
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
      this.auth = auth;
      // חשוב: מחכים שהדפדפן יטען את המשתמש השמור לפני שמנסים התחברות אנונימית —
      // אחרת signInAnonymously היה דורס משתמש Google שכבר מחובר.
      const authLoaded = auth.authStateReady
        ? auth.authStateReady()
        : new Promise((res) => { const un = onAuthStateChanged(auth, () => { un(); res(); }); });
      authLoaded.then(() => {
        if (auth.currentUser) return;
        signInAnonymously(auth).catch((e) => {
          // סיבות נפוצות: "התחברות אנונימית" לא הופעלה בקונסולת Firebase (Authentication →
          // Sign-in method → Anonymous → Enable), או שהערכים ב-firebase-config.js לא מדויקים.
          this.status = "error";
          this.errorMessage = (e && e.code) || (e && e.message) || String(e);
          console.error("[cloud] auth failed:", this.errorMessage, e);
          window.dispatchEvent(new CustomEvent("cloud-status"));
        });
      });
      onAuthStateChanged(auth, (user) => {
        this.user = user || null;
        this.isGoogle = !!(user && !user.isAnonymous);
        if (user) {
          this.ready = true;
          this.status = "connected";
          this._queue.forEach((fn) => fn());
          this._queue = [];
          window.dispatchEvent(new CustomEvent("cloud-status"));
          window.dispatchEvent(new CustomEvent("cloud-ready"));
        }
        window.dispatchEvent(new CustomEvent("backup-auth"));
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


  // ================= גיבוי מלא לחשבון Google =================
  _backupDoc(id) {
    return doc(this.db, "users", this.user.uid, "backups", id);
  },

  async signInGoogle() {
    if (!this.enabled || !this.auth) throw new Error("Firebase לא מוגדר");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(this.auth, provider);
  },

  async signOutGoogle() {
    if (!this.auth) return;
    await signOut(this.auth);
    // חוזרים למשתמש אנונימי כדי שתזכורות בענן ימשיכו לעבוד
    try { await signInAnonymously(this.auth); } catch (e) { /* ignore */ }
  },

  // ids: "latest", "day-YYYY-MM-DD", "pre-restore"
  async putBackup(id, json, counts) {
    if (!this.isGoogle) throw new Error("not-signed-in");
    const packed = await packText(json);
    if (packed.payload.length > 950000) throw new Error("הנתונים גדולים מדי לגיבוי בודד (מעל ~1MB מכווץ)");
    await setDoc(this._backupDoc(id), {
      enc: packed.enc,
      payload: packed.payload,
      savedAt: Date.now(),
      counts: counts || {},
    });
  },

  async getBackup(id) {
    if (!this.isGoogle) throw new Error("not-signed-in");
    const snap = await getDoc(this._backupDoc(id));
    if (!snap.exists()) return null;
    const d = snap.data();
    return { id, json: await unpackText(d.enc, d.payload), savedAt: d.savedAt || 0, counts: d.counts || {} };
  },

  // רשימת גיבויים (בלי תוכן) — לחלון השחזור
  async listBackups() {
    if (!this.isGoogle) throw new Error("not-signed-in");
    const snap = await getDocs(collection(this.db, "users", this.user.uid, "backups"));
    return snap.docs.map((d) => ({ id: d.id, savedAt: d.data().savedAt || 0, counts: d.data().counts || {} }))
      .sort((a, b) => b.savedAt - a.savedAt);
  },

  async deleteBackup(id) {
    await deleteDoc(this._backupDoc(id));
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
