const firebaseConfig = {
  apiKey: "AIzaSyBJjzTASSDoezaH2lPTUP1Fn9jS6RR-OUo",
  authDomain: "im-oei.firebaseapp.com",
  projectId: "im-oei",
  storageBucket: "im-oei.firebasestorage.app",
  messagingSenderId: "392812205535",
  appId: "1:392812205535:web:65f6ce114feb3ce035a06a",
  measurementId: "G-0LGSELSP0D"
};

// ─── App Check (shared helper) ─────────────────────────────────────────────
import { initializeAppCheck, ReCaptchaV3Provider } from
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";
import { RECAPTCHA_SITE_KEY } from "../config.js";

export function initAppCheck(app) {
  if (!RECAPTCHA_SITE_KEY) {
    // dev/localhost เท่านั้น — debug token จะ print ใน console
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    console.warn("[AppCheck] DEBUG MODE — ต้องใส่ RECAPTCHA_SITE_KEY ก่อน deploy");
    return;
  }

  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}
