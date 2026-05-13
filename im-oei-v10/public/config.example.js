// ──────────────────────────────────────────────────────────────────────────────
// config.example.js — template สำหรับ local dev
// คัดลอกไฟล์นี้เป็น config.js แล้วใส่ค่าจริง
// ห้าม commit config.js (อยู่ใน .gitignore แล้ว)
// ──────────────────────────────────────────────────────────────────────────────

export const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "im-oei.firebaseapp.com",
  projectId:         "im-oei",
  storageBucket:     "im-oei.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// LINE Developers → LIFF → LIFF ID
export const LIFF_ID = "YOUR_LIFF_ID";

// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
export const VAPID_PUBLIC_KEY = "YOUR_VAPID_PUBLIC_KEY";

// หมายเหตุ: LINE_CHANNEL_TOKEN ถูกย้ายไปอยู่ใน Firebase Functions config แล้ว
// firebase functions:config:set line.token="YOUR_TOKEN" line.liff_id="YOUR_LIFF_ID"

// Google reCAPTCHA v3 Site Key — ใช้สำหรับ Firebase App Check
// https://www.google.com/recaptcha/admin → Im oei → reCAPTCHA keys → SITE KEY
export const RECAPTCHA_SITE_KEY = "6LfBotcsAAAAACxl8p6XtLXisjPH-XacxIXX-ZiC";
