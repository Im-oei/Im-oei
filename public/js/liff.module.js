// liff.html — ES module (Firebase + LIFF logic)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { FIREBASE_CONFIG, LIFF_ID } from "../config.js";
import { initAppCheck } from "./appcheck.js";

const app = initializeApp(FIREBASE_CONFIG);
initAppCheck(app); // 🔐 App Check
const db = getFirestore(app);
const functions = getFunctions(app, 'asia-northeast1');
const ORDER_URL = "index.html";
let lineProfile = null;

// ============================================================
// ✅ ลำดับที่ถูกต้อง: init → เช็ค login → login ถ้าต้อง → getProfile
//    เหตุผล: liff.isLoggedIn() ต้อง call หลัง liff.init() เสมอ
// ============================================================
async function initLiff() {
  try {
    // STEP 1: init ก่อน (จำเป็น — ต้องทำก่อน isLoggedIn)
    await liff.init({ 
      liffId: LIFF_ID,
      withLoginOnExternalBrowser: true
    });

    // STEP 2: เช็ค login หลัง init
    if (!liff.isLoggedIn()) {
      // ✅ redirectUri = หน้าเดิม → หลัง login กลับมาโดยไม่ต้องวิ่งหน้าอื่น
      liff.login({ redirectUri: window.location.href });
      return; // ✅ return ทันที — browser จะ redirect ออก
    }

    // STEP 3: login แล้ว → ดึง profile
    lineProfile = await liff.getProfile();
    const { userId, displayName, pictureUrl } = lineProfile;

    // ตรวจสถานะ LINE binding ผ่าน callable function (ปลอดภัย — verify token ก่อน)
    const idTokenForCheck = await liff.getIDToken();
    const statusFn = httpsCallable(functions, 'getLineUserStatus');
    const statusRes = await statusFn({ lineUserId: userId, liffIdToken: idTokenForCheck });
    const status = statusRes.data;

    if (status.linked) {
      const phone = status.phone || "";

      // อัพเดทโปรไฟล์ (background, ไม่รอ)
      if (status.displayName !== displayName || status.pictureUrl !== pictureUrl) {
        updateDoc(doc(db, "lineUsers", userId), {
          displayName, pictureUrl: pictureUrl || null, updatedAt: Date.now()
        }).catch(() => {});
      }

      if (phone) saveUserSession(displayName, phone, userId, pictureUrl);

      document.getElementById("linked-name").textContent = displayName;
      document.getElementById("linked-phone").textContent = phone ? "📞 " + phone : "ยังไม่ผูกเบอร์";
      if (pictureUrl) {
        const img = document.getElementById("linked-avatar");
        img.src = pictureUrl; img.style.display = "block";
        document.getElementById("linked-avatar-placeholder").style.display = "none";
      }
      showState("linked");

    } else {
      if (pictureUrl) {
        document.getElementById("profile-avatar").src = pictureUrl;
        document.getElementById("profile-card").style.display = "flex";
      }
      document.getElementById("profile-name").textContent = displayName;
      document.getElementById("profile-id").textContent = "LINE ID: " + userId.slice(0, 12) + "...";
      showState("phone");
    }

  } catch (err) {
    console.error("LIFF Error:", err);
    showError("ไม่สามารถเชื่อมต่อ LIFF ได้", err.message || "กรุณาลองใหม่อีกครั้ง");
  }
}

function saveUserSession(name, phone, userId, pictureUrl) {
  const userData = { role: "customer", name, phone, lineUserId: userId, photoURL: pictureUrl || null, loginAt: Date.now() };
  sessionStorage.setItem("imkum_user", JSON.stringify(userData));
  localStorage.setItem("imkum_phone", phone);
  localStorage.setItem("imkum_name", name);
  localStorage.setItem("imkum_userId", userId);
  localStorage.setItem("imkum_lineDisplayName", name);
}

window.submitPhone = async function() {
  const phone = document.getElementById("phone-input").value.trim();
  if (!phone || phone.length < 9) { showToast("กรุณากรอกเบอร์มือถือให้ครบ"); return; }
  if (!/^0[6-9]\d{8}$/.test(phone)) { showToast("รูปแบบเบอร์ไม่ถูกต้อง (ต้องเริ่มด้วย 06-09)"); return; }
  if (!lineProfile) { showToast("เกิดข้อผิดพลาด กรุณาลองใหม่"); return; }

  showLoading(true);
  try {
    const { userId, displayName, pictureUrl } = lineProfile;
    const idToken = await liff.getIDToken();
    const bindFn = httpsCallable(functions, 'bindLineAccount');
    await bindFn({ lineUserId: userId, displayName, phone, liffIdToken: idToken });
    saveUserSession(displayName, phone, userId, pictureUrl);
    document.getElementById("success-phone").textContent = phone;
    showState("success");
  } catch (err) {
    console.error("submitPhone error:", err);
    showToast("บันทึกข้อมูลไม่สำเร็จ: " + (err.message || "ลองใหม่อีกครั้ง"));
  } finally {
    showLoading(false);
  }
};

window.skipLink = function() {
  if (lineProfile) { localStorage.setItem("imkum_userId", lineProfile.userId); localStorage.setItem("imkum_lineDisplayName", lineProfile.displayName); }
  goOrder();
};
window.changePhone = function() { document.getElementById("phone-input").value = ""; showState("phone"); };
window.goOrder = function() { if (liff.isInClient()) liff.closeWindow(); window.location.href = ORDER_URL; };

function showState(name) {
  ["loading","not-line","phone","linked","success","error"].forEach(s => {
    const el = document.getElementById("state-" + s);
    if (el) el.style.display = s === name ? "block" : "none";
  });
}
function showError(title, desc) { document.getElementById("error-title").textContent = title; document.getElementById("error-desc").textContent = desc; showState("error"); }
function showLoading(show) { document.getElementById("loading-overlay").classList.toggle("show", show); }
function showToast(msg, duration = 2500) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), duration); }

// ✅ รอ SDK โหลดเสร็จ (เพราะใช้ defer)
if (typeof liff !== "undefined") {
  initLiff();
} else {
  window.addEventListener('load', () => {
    typeof liff !== "undefined" ? initLiff() : showError("ไม่พบ LIFF SDK", "กรุณาเปิดหน้านี้ผ่านแอป LINE");
  });
}
