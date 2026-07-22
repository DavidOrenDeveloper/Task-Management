// firebase-config.js
//
// ⚠️ קובץ הגדרות — יש למלא לפי ההוראות בקובץ SETUP-CLOUD.md
// כל השדות כאן הם ציבוריים ובטוחים לחשיפה בצד הלקוח (כך עובד Firebase Web SDK תמיד —
// ההגנה על הנתונים היא לא בהסתרת הקובץ הזה, אלא בחוקי האבטחה של Firestore + התחברות אנונימית).
//
// כל עוד apiKey נשאר "YOUR_API_KEY", האפליקציה תמשיך לעבוד כרגיל אבל בלי תזכורות בענן —
// כלומר בדיוק כמו שהיא עובדת היום (תזכורות רק כשהאפליקציה פתוחה).

export const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// כל מכשיר/אתר שמשתמש באותו SITE_ID "רואה" את אותן תזכורות בענן.
// אפשר להשאיר את זה כמו שהוא, או לשנות למחרוזת ייחודית משלך (רק תוודא/י
// שאותה מחרוזת מוגדרת גם ב-GitHub Secrets תחת השם SITE_ID).
export const SITE_ID = "electrician-site-app-default";

// המפתח הציבורי של ה-VAPID (ראה SETUP-CLOUD.md — נוצר פעם אחת יחד עם המפתח הפרטי).
export const VAPID_PUBLIC_KEY = "YOUR_VAPID_PUBLIC_KEY";
