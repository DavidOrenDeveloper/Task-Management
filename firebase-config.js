// firebase-config.js
//
// ⚠️ קובץ הגדרות — יש למלא לפי ההוראות בקובץ SETUP-CLOUD.md
// כל השדות כאן הם ציבוריים ובטוחים לחשיפה בצד הלקוח (כך עובד Firebase Web SDK תמיד —
// ההגנה על הנתונים היא לא בהסתרת הקובץ הזה, אלא בחוקי האבטחה של Firestore + התחברות אנונימית).
//
// כל עוד apiKey נשאר "YOUR_API_KEY", האפליקציה תמשיך לעבוד כרגיל אבל בלי תזכורות בענן —
// כלומר בדיוק כמו שהיא עובדת היום (תזכורות רק כשהאפליקציה פתוחה).

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBGGi6gbwsOzmyhmzgx7ihoSATVYEPgA4k",
  authDomain: "task-manager-24802.firebaseapp.com",
  projectId: "task-manager-24802",
  storageBucket: "task-manager-24802.firebasestorage.app",
  messagingSenderId: "74331600099",
  appId: "1:74331600099:web:fadcfba0ae49863df301d6",
};

// כל מכשיר/אתר שמשתמש באותו SITE_ID "רואה" את אותן תזכורות בענן.
// אפשר להשאיר את זה כמו שהוא, או לשנות למחרוזת ייחודית משלך (רק תוודא/י
// שאותה מחרוזת מוגדרת גם ב-GitHub Secrets תחת השם SITE_ID).

export const SITE_ID = "electrician-site-app-default";

// המפתח הציבורי של ה-VAPID (ראה SETUP-CLOUD.md — נוצר פעם אחת יחד עם המפתח הפרטי).
export const VAPID_PUBLIC_KEY = "BBXF7PvlWgU44COZ_or03Zo4smtU0ho8M1qIoQanQeZ0YOjKtXvW719cCTnoHdZSziNo8JwM5s06PC0s7NE_F5o";
