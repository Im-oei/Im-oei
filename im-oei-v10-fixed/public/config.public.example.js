// config.public.example.js — คัดลอก → config.public.js แล้วกรอกค่าจริง
// ⚠️ อย่า commit config.public.js ขึ้น Git เด็ดขาด (อยู่ใน .gitignore แล้ว)
const firebaseConfig = {
  apiKey:            "YOUR_FIREBASE_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

firebase.initializeApp(firebaseConfig);
