

// login.html — ES module (Firebase Auth + LIFF)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signInWithCustomToken, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { FIREBASE_CONFIG, LIFF_ID } from "../config.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app, 'asia-northeast1');

function showLoading(v){ document.getElementById('loading').classList.toggle('show',v); }
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500); }
function showError(msg){ const b=document.getElementById('error-box'); document.getElementById('error-msg').textContent=msg; b.style.display='block'; setTimeout(()=>b.style.display='none',4000); }
function hideError(){ document.getElementById('error-box').style.display='none'; }

// ─── LIFF Init & LINE Login ───────────────────────────────────────────────

async function initLiff() {
  try {
    await liff.init({ liffId: LIFF_ID });
    window._liffInited = true;

    // Auto-login เฉพาะเมื่อ redirect กลับมาจาก LINE (มี liff.state ใน URL)
    // ไม่ auto-login ถ้าแค่เปิดหน้า login ปกติ เพื่อไม่ขัด guest login
    const params = new URLSearchParams(window.location.search);
    const cameFromLiff = params.has('liff.state') || params.has('code') || params.has('state');

    if (liff.isLoggedIn() && cameFromLiff) {
      await handleLiffLogin();
    }
  } catch (e) {
    console.warn('LIFF init error:', e.message);
  }
}

async function handleLiffLogin() {
  showLoading(true);
  try {
    const profile = await liff.getProfile();
    const idToken = liff.getIDToken();

    const lineUser = {
      uid: 'line_' + profile.userId,
      lineId: profile.userId,
      lineUserId: profile.userId,   // ← ใช้โดย orders.module.js, orders.html
      name: profile.displayName,
      picture: profile.pictureUrl,
      photoURL: profile.pictureUrl, // ← ใช้โดย avatar display
      idToken,
      role: 'customer',
      source: 'line',
      loginAt: Date.now(),
      lastLogin: new Date().toISOString(),
    };

    // บันทึก/อัปเดต customer ใน Firestore
    try {
      await setDoc(doc(db, 'customers', lineUser.uid), {
        lineId: lineUser.lineId,
        name: lineUser.name,
        picture: lineUser.picture,
        source: 'line',
        lastLogin: lineUser.lastLogin,
        updatedAt: lineUser.lastLogin,
      }, { merge: true });
    } catch (e) {
      console.warn('Firestore customer upsert:', e.message);
    }

    // ตรวจสอบ role จาก Firestore collection 'admins'
    let resolvedRole = 'customer';
    let redirectTarget = 'index.html';
    try {
      const adminSnap = await getDoc(doc(db, 'admins', lineUser.uid));
      if (adminSnap.exists()) {
        resolvedRole = adminSnap.data().role || 'admin';
        redirectTarget = 'admin.html';
      }
    } catch (e) {
      console.warn('admin role check:', e.message);
    }
    lineUser.role = resolvedRole;

    sessionStorage.setItem('imkum_user', JSON.stringify(lineUser));
    if (resolvedRole === 'admin' || resolvedRole === 'owner') {
      sessionStorage.setItem('imkum_admin_auth', '1');

      // 🔐 FIX: ออก Firebase Custom Token แล้ว signIn → Firestore rules ผ่าน
      // เดิม: LINE admin ไม่มี Firebase Auth → request.auth = null
      //       → isFirebaseAdmin() = false → อ่าน orders/customers ไม่ได้ → หน้าว่าง
      // ใหม่: signInWithCustomToken(uid=lineUserId) → request.auth != null
      //       → admins/{lineUserId} exists → isFirebaseAdmin() = true → ทุกอย่างทำงาน
      // ออก Firebase Custom Token → signIn → แล้วค่อย redirect
      // ต้อง await ให้เสร็จก่อน redirect ไม่งั้น admin.html จะไม่มี Firebase Auth session
      try {
        const issueAdminCustomToken = httpsCallable(functions, 'issueAdminCustomToken');
        const tokenResult = await issueAdminCustomToken({
          lineUserId: lineUser.lineUserId || lineUser.uid,
          liffToken: liff.getIDToken(),
        });
        // 🔐 FIX: ตั้ง LOCAL persistence ก่อน signIn
        // ทำให้ Firebase Auth session ถูกบันทึกลง IndexedDB
        // และยังอยู่เมื่อ admin.html โหลดขึ้นมา → onAuthStateChanged ได้ user ทันที
        await setPersistence(auth, browserLocalPersistence);
        await signInWithCustomToken(auth, tokenResult.data.customToken);
      } catch (tokenErr) {
        console.warn('Custom token failed (จะโหลดข้อมูลช้าลงหน่อย):', tokenErr.message);
      }
    }
    localStorage.setItem('imkum_name', lineUser.name);
    localStorage.setItem('imkum_line_picture', lineUser.picture || '');
    localStorage.removeItem('imkum_cart');
    localStorage.removeItem('imkum_cart_prices');

    const welcomeMsg = resolvedRole === 'owner' ? '👑 ยินดีต้อนรับ เจ้าของร้าน!' :
                       resolvedRole === 'admin'  ? '🧑‍🍳 ยินดีต้อนรับ แอดมิน!' :
                       '✅ ยินดีต้อนรับ ' + lineUser.name + '!';
    showToast(welcomeMsg);

    // ถ้าเป็น admin → redirect หลัง custom token เสร็จแล้ว (await ข้างบน)
    if (resolvedRole === 'admin' || resolvedRole === 'owner') {
      setTimeout(() => window.location.href = 'admin.html', 500);
      return;
    }

    // ตรวจว่าเคยผูกเบอร์ใน Firestore แล้วหรือยัง
    showLoading(false);
    let alreadyHasPhone = false;
    try {
      const uid = 'line_' + profile.userId;
      const custSnap = await getDoc(doc(db, 'customers', uid));
      if (custSnap.exists() && custSnap.data().phone) {
        lineUser.phone = custSnap.data().phone;
        lineUser.phoneVerified = true;
        sessionStorage.setItem('imkum_user', JSON.stringify(lineUser));
        alreadyHasPhone = true;
      }
    } catch(e) { console.warn('phone check:', e.message); }

    setTimeout(() => window.location.href = 'index.html', 800);
  } catch (e) {
    showError('เข้าสู่ระบบ LINE ไม่สำเร็จ: ' + e.message);
    showLoading(false);
  }
}

// ปุ่ม "เข้าสู่ระบบด้วย LINE" — กด แล้ว redirect ไป LINE จริง
window._mod_lineLogin = window.lineLogin = async function() {
  try {
    showLoading(true);
    showToast('🟢 กำลังเชื่อมต่อ LINE...');

    if (typeof liff === 'undefined') {
      showError('ไม่พบ LIFF SDK กรุณารีเฟรชหน้า');
      showLoading(false);
      return;
    }

    if (typeof liff.isInitialized === 'function' ? !liff.isInitialized() : !window._liffInited) {
      await liff.init({ liffId: LIFF_ID });
      window._liffInited = true;
    }

    if (liff.isLoggedIn()) {
      await handleLiffLogin();
    } else {
      // redirect ไป LINE login จริง
      liff.login({ redirectUri: window.location.href });
    }
  } catch (e) {
    showError('ไม่สามารถเชื่อมต่อ LINE ได้: ' + e.message);
    showLoading(false);
  }
};

// ─── Admin Login ──────────────────────────────────────────────────────────

window._mod_toggleAdminPwd = window.toggleAdminPwd = function(){
  const inp = document.getElementById('admin-password');
  const eye = document.getElementById('admin-eye');
  if(inp.type==='password'){
    inp.type='text';
    eye.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#BBB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  } else {
    inp.type='password';
    eye.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#BBB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  }
};

window._mod_adminLogin = window.adminLogin = async function(){
  const email = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  if(!email){ showError('กรุณากรอก Email'); return; }
  if(!password){ showError('กรุณากรอก Password'); return; }
  const btn = document.getElementById('admin-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="checking-ring"></span> กำลังเข้าสู่ระบบ…';
  showLoading(true);
  try {
    await setPersistence(auth, browserLocalPersistence);
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCred.user.uid;
    let role = 'admin';
    try {
      const adminSnap = await getDoc(doc(db, 'admins', uid));
      if(adminSnap.exists()) role = adminSnap.data().role || 'admin';
    } catch(e) { console.warn('admins read:', e.message); }
    sessionStorage.setItem('imkum_user', JSON.stringify({ role, name: userCred.user.displayName || email.split('@')[0], email, uid, loginAt: Date.now() }));
    sessionStorage.setItem('imkum_admin_auth','1');
    showToast(role==='owner' ? '👑 ยินดีต้อนรับ เจ้าของร้าน!' : '🧑‍🍳 ยินดีต้อนรับ แอดมิน!');
    setTimeout(()=>window.location.href='admin.html', 700);
  } catch(e) {
    let msg = 'เข้าสู่ระบบไม่สำเร็จ';
    if(e.code==='auth/wrong-password'||e.code==='auth/invalid-credential') msg='Email หรือ Password ไม่ถูกต้อง';
    else if(e.code==='auth/user-not-found') msg='ไม่พบบัญชีนี้ในระบบ';
    else if(e.code==='auth/invalid-email') msg='รูปแบบ Email ไม่ถูกต้อง';
    else if(e.code==='auth/too-many-requests') msg='ลองมากเกินไป กรุณารอสักครู่';
    else if(e.code==='auth/network-request-failed') msg='ไม่สามารถเชื่อมต่อได้';
    showError(msg);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> เข้าสู่ระบบแอดมิน';
    showLoading(false);
  }
};

// ─── Guest Login ──────────────────────────────────────────────────────────

window.toggleGuest = function() {
  const form = document.getElementById('guest-form');
  const chevron = document.getElementById('guest-chevron');
  const open = form.classList.toggle('open');
  chevron.classList.toggle('open', open);
};

window.toggleAdmin = function() {
  document.getElementById('admin-form').classList.toggle('open');
};

window._mod_customerLogin = window.customerLogin = async function(){
  const name = document.getElementById('cust-name-1').value.trim();
  if(!name){ showError('กรุณากรอกชื่อของคุณ'); return; }

  const btn = document.getElementById('guest-btn');
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="checking-ring"></span> กำลังเข้าสู่ระบบ…'; }
  showLoading(true);

  try {
    const guestId = localStorage.getItem('imkum_guest_id') || ('guest_' + Math.random().toString(36).slice(2,10));
    localStorage.setItem('imkum_guest_id', guestId);

    try {
      await setDoc(doc(db,'customers','guest_' + guestId), {
        name, guestId, source: 'guest',
        lastLogin: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch(e) { console.warn('guest customer upsert:', e.message); }

    sessionStorage.setItem('imkum_user', JSON.stringify({
      role: 'customer', name, guestId, loginAt: Date.now()
    }));
    localStorage.setItem('imkum_name', name);
    localStorage.removeItem('imkum_cart');
    localStorage.removeItem('imkum_cart_prices');

    showLoading(false);
    showToast('✅ ยินดีต้อนรับ ' + name + '!');
    setTimeout(() => window.location.href = 'index.html', 800);

  } catch(e){
    showError('เข้าสู่ระบบไม่สำเร็จ');
    console.error('customerLogin error:', e.message);
  } finally {
    if(btn){ btn.disabled=false; btn.innerHTML='<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> เริ่มสั่งอาหาร'; }
    showLoading(false);
  }
};


// ─── Session check + LIFF init ────────────────────────────────────────────

try {
  const sess = sessionStorage.getItem('imkum_user');
  if(sess){
    const user = JSON.parse(sess);
    if(Date.now()-(user.loginAt||0) < 8*60*60*1000){
      window.location.href = user.role==='customer' ? 'index.html' : 'admin.html';
    } else {
      sessionStorage.clear();
    }
  }
  const savedName = localStorage.getItem('imkum_name')||'';
  if(savedName) document.getElementById('cust-name-1').value=savedName;
} catch(e){ sessionStorage.clear(); }

// โหลด LIFF SDK แล้ว init
const liffScript = document.createElement('script');
liffScript.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
liffScript.onload = () => initLiff();
liffScript.onerror = () => console.warn('LIFF SDK load failed');
document.head.appendChild(liffScript);
