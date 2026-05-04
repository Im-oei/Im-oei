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
