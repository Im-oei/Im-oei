// ─── Firebase Config ───────────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBJjzTASSDoezaH2lPTUP1Fn9jS6RR-OUo",
  authDomain:        "im-oei.firebaseapp.com",
  projectId:         "im-oei",
  storageBucket:     "im-oei.firebasestorage.app",
  messagingSenderId: "392812205535",
  appId:             "1:392812205535:web:65f6ce114feb3ce035a06a",
  measurementId:     "G-0LGSELSP0D"
};

// 🔴 SECURITY: LINE_CHANNEL_TOKEN ถูกถอดออกจาก client แล้ว
// ย้ายไปใช้ firebase functions:config:set line.token=YOUR_TOKEN แทน
//
// วิธี set:
//   firebase functions:config:set line.token="YOUR_TOKEN" line.liff_id="YOUR_LIFF_ID"

export const LIFF_ID = "2009910221-ySbGklzJ";

export const VAPID_PUBLIC_KEY = "BGZbGcsIuEzA5enjkAmik_kuZwvAsNGpsuEUj_p3TpJVaRSq0KnkxUlcthSnCT_rpZC4tg7eTQPq1v1FrArd3j0";

// ─── App Check ─────────────────────────────────────────────────────────────
// 🔴 ต้องใส่ reCAPTCHA v3 Site Key จาก:
//    Firebase Console → App Check → Apps → Register → reCAPTCHA v3
//    แล้ว copy Site Key มาใส่ที่นี่
// 🟡 ระหว่างรอ Key ให้ใส่ null → App Check จะทำงานใน debug mode (dev only)
export const RECAPTCHA_SITE_KEY = "6LfBotcsAAAAACxl8p6XtLXisjPH-XacxIXX-ZiC";
