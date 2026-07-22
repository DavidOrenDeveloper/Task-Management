// send-reminders.js
//
// רץ בתוך GitHub Actions (לא בטלפון ולא בדפדפן) כל כמה דקות, לפי הלו"ז
// שבקובץ .github/workflows/send-reminders.yml.
// קורא מ-Firestore אילו תזכורות הגיע זמנן, ושולח התראת Web Push אמיתית
// לכל המכשירים הרשומים — זה מה שמאפשר להתראה להגיע גם כשהאפליקציה סגורה לגמרי.
//
// כל הערכים הרגישים (מפתח שירות של Firebase, מפתחות VAPID) מגיעים ממשתני
// סביבה שמוגדרים כ-GitHub Secrets, ולא נשמרים בקוד בשום מקום.

const admin = require("firebase-admin");
const webpush = require("web-push");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`חסר secret נדרש: ${name}. יש להגדיר אותו תחת Settings → Secrets and variables → Actions.`);
    process.exit(1);
  }
  return v;
}

const serviceAccountRaw = requireEnv("FIREBASE_SERVICE_ACCOUNT");
const SITE_ID = requireEnv("SITE_ID");
const VAPID_PUBLIC_KEY = requireEnv("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = requireEnv("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:example@example.com";

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountRaw);
} catch (e) {
  console.error("FIREBASE_SERVICE_ACCOUNT אינו JSON תקין. יש להדביק את כל תוכן הקובץ שהורדת מ-Firebase כמו שהוא.");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

async function main() {
  const now = Date.now();
  const siteRef = db.collection("sites").doc(SITE_ID);
  const remindersRef = siteRef.collection("reminders");
  const subsRef = siteRef.collection("subscriptions");

  const [remindersSnap, subsSnap] = await Promise.all([remindersRef.get(), subsRef.get()]);

  if (subsSnap.empty) {
    console.log("אין עדיין אף מכשיר רשום לתזכורות בענן (הפעל/י 'תזכורות בענן' באפליקציה, בעמוד 'עוד').");
    return;
  }

  const due = [];
  remindersSnap.forEach((snap) => {
    const r = snap.data();
    if (!r.dueAt || r.dueAt > now) return;
    const last = r.lastFiredAt || 0;
    const repeatMs = r.repeatMinutes ? r.repeatMinutes * 60000 : Infinity;
    const shouldFire = !r.lastFiredAt || now - last >= repeatMs;
    if (shouldFire) due.push({ id: snap.id, ...r });
  });

  if (!due.length) {
    console.log("אין כרגע תזכורות שהגיע זמנן.");
    return;
  }
  console.log(`נמצאו ${due.length} תזכורות שהגיע זמנן.`);

  const subs = [];
  subsSnap.forEach((snap) => subs.push({ id: snap.id, ...snap.data() }));

  for (const reminder of due) {
    const payload = JSON.stringify({
      title: "⏰ תזכורת: " + reminder.title,
      body: reminder.locationLabel || "",
      tag: "task-" + reminder.id,
      url: "./",
    });

    for (const s of subs) {
      try {
        await webpush.sendNotification(s.subscription, payload);
        console.log(`נשלח בהצלחה: "${reminder.title}" -> מכשיר ${s.id.slice(0, 8)}…`);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          console.log(`המכשיר ${s.id.slice(0, 8)}… כבר לא רשום — מוחק את המנוי.`);
          await subsRef.doc(s.id).delete();
        } else {
          console.error(`שליחה נכשלה עבור מכשיר ${s.id.slice(0, 8)}…`, err.statusCode, err.body || err.message);
        }
      }
    }

    await remindersRef.doc(reminder.id).update({ lastFiredAt: now });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("שגיאה כללית בהרצת השעון המעורר:", e);
    process.exit(1);
  });
