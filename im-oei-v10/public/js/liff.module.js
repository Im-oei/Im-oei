
// liff.html — ES module (Firebase + LIFF logic)
// ✅ ใช้ Firestore โดยตรง ไม่ต้องใช้ Firebase Functions

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { FIREBASE_CONFIG, LIFF_ID } from "../config.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const ORDER_URL = "index.html";
let lineProfile = null;

// ============================================================
// init LIFF → เช็ค login → ดึง profile → เช็ค Firestore
// ============================================================
async function initLiff() {
  try {
    await liff.init({ 
      liffId: LIFF_ID,
      withLoginOnExternalBrowser: true
    });

    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      return;
    }

    lineProfile = await liff.getProfile();
    const { userId, displayName, pictureUrl } = lineProfile;

    // ตรวจสถานะตรงจาก Firestore (ไม่ต้องผ่าน Functions)
    const userSnap = await getDoc(doc(db, "lineUsers", userId));

    if (userSnap.exists() && userSnap.data().phone) {
      const data = userSnap.data();
      const phone = data.phone;

      // อัปเดตโปรไฟล์ถ้าเปลี่ยน — เขียนตรง Firestore
      if (data.displayName !== displayName || data.pictureUrl !== pictureUrl) {
        setDoc(doc(db, "lineUsers", userId), {
          displayName,
          pictureUrl: pictureUrl || "",
          updatedAt: serverTimestamp(),
        }, { merge: true }).catch(() => {}); // best-effort profile refresh
      }

      saveUserSession(displayName, phone, userId, pictureUrl);

      document.getElementById("linked-name").textContent = displayName;
      document.getElementById("linked-phone").textContent = "📞 " + phone;
      if (pictureUrl) {
        const img = document.getElementById("linked-avatar");
        if (img) { img.src = pictureUrl; img.style.display = "block"; }
        const ph = document.getElementById("linked-avatar-placeholder");
        if (ph) ph.style.display = "none";
      }
      showState("linked");

    } else {
      // ยังไม่เคยผูกเบอร์
      if (pictureUrl) {
        const av = document.getElementById("profile-avatar");
        if (av) av.src = pictureUrl;
        const pc = document.getElementById("profile-card");
        if (pc) pc.style.display = "flex";
      }
      const pn = document.getElementById("profile-name");
      if (pn) pn.textContent = displayName;
      const pi = document.getElementById("profile-id");
      if (pi) pi.textContent = "LINE ID: " + userId.slice(0, 12) + "...";
      showState("phone");
    }

  } catch (err) {
    console.error("LIFF Error:", err);
    showError("ไม่สามารถเชื่อมต่อ LIFF ได้", err.message || "กรุณาลองใหม่อีกครั้ง");
  }
}

function saveUserSession(name, phone, userId, pictureUrl) {
  const userData = { role: "customer", name, phone, lineUserId: userId, photoURL: pictureUrl || null, loginAt: Date.now() };
  localStorage.setItem("imkum_user", JSON.stringify(userData));
  localStorage.setItem("imkum_phone", phone);
  localStorage.setItem("imkum_name", name);
  localStorage.setItem("imkum_userId", userId);
  localStorage.setItem("imkum_lineDisplayName", name);
  localStorage.setItem("imkum_line_linked", "true");
}

// กดยืนยันเบอร์มือถือ → บันทึกตรงลง Firestore
window.submitPhone = async function() {
  const phone = document.getElementById("phone-input").value.trim();
  const nickname = (document.getElementById("nickname-input")?.value || "").trim();
  if (!phone || phone.length < 9) { showToast("กรุณากรอกเบอร์มือถือให้ครบ"); return; }
  if (!/^0[6-9]\d{8}$/.test(phone)) { showToast("รูปแบบเบอร์ไม่ถูกต้อง (ต้องเริ่มด้วย 06-09)"); return; }
  if (!lineProfile) { showToast("เกิดข้อผิดพลาด กรุณาลองใหม่"); return; }

  showLoading(true);
  try {
    const { userId, displayName, pictureUrl } = lineProfile;
    const saveName = nickname || displayName || "";
    const now = serverTimestamp();

    await setDoc(doc(db, "lineUsers", userId), {
      userId,
      displayName: saveName,
      nickname: nickname || "",
      phone,
      pictureUrl: pictureUrl || "",
      linkedAt: now,
      updatedAt: now,
    }, { merge: true });

    await setDoc(doc(db, "linePhoneMap", phone), {
      userId,
      updatedAt: now,
    });

    saveUserSession(saveName, phone, userId, pictureUrl);

    const sp = document.getElementById("success-phone");
    if (sp) sp.textContent = phone;
    showState("success");

  } catch (err) {
    console.error("submitPhone error:", err);
    showToast("บันทึกไม่สำเร็จ: " + (err.code || err.message || JSON.stringify(err)));
  } finally {
    showLoading(false);
  }
};

window.skipLink = function() {
  if (lineProfile) {
    localStorage.setItem("imkum_userId", lineProfile.userId);
    localStorage.setItem("imkum_lineDisplayName", lineProfile.displayName);
  }
  goOrder();
};
window.changePhone = function() {
  const pi = document.getElementById("phone-input");
  if (pi) pi.value = "";
  showState("phone");
};
window.goOrder = function() {
  if (liff.isInClient()) liff.closeWindow();
  window.location.href = ORDER_URL;
};

function showState(name) {
  ["loading","not-line","phone","linked","success","error"].forEach(s => {
    const el = document.getElementById("state-" + s);
    if (el) el.style.display = s === name ? "block" : "none";
  });
}
function showError(title, desc) {
  const et = document.getElementById("error-title");
  const ed = document.getElementById("error-desc");
  if (et) et.textContent = title;
  if (ed) ed.textContent = desc;
  showState("error");
}
function showLoading(show) {
  const ol = document.getElementById("loading-overlay");
  if (ol) ol.classList.toggle("show", show);
}
function showToast(msg, duration = 2500) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

// รอ SDK โหลดเสร็จ
if (typeof liff !== "undefined") {
  initLiff();
} else {
  window.addEventListener('load', () => {
    typeof liff !== "undefined"
      ? initLiff()
      : showError("ไม่พบ LIFF SDK", "กรุณาเปิดหน้านี้ผ่านแอป LINE");
  });
}
