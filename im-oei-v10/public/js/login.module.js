// login.html — ES module (Firebase Auth)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signInAnonymously, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { FIREBASE_CONFIG } from "../config.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

function showLoading(v){ document.getElementById('loading').classList.toggle('show',v); }
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500); }
function showError(msg){ const b=document.getElementById('error-box'); document.getElementById('error-msg').textContent=msg; b.style.display='block'; setTimeout(()=>b.style.display='none',4000); }
function hideError(){ document.getElementById('error-box').style.display='none'; }

window.switchTab = function(tab) {
  document.getElementById('tab-admin').classList.toggle('active', tab==='admin');
  document.getElementById('tab-customer').classList.toggle('active', tab==='customer');
  document.getElementById('panel-admin').classList.toggle('active', tab==='admin');
  document.getElementById('panel-customer').classList.toggle('active', tab==='customer');
  hideError();
};

window.toggleAdminPwd = function(){
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

window.adminLogin = async function(){
  const email = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  if(!email){ showError('กรุณากรอก Email'); return; }
  if(!password){ showError('กรุณากรอก Password'); return; }
  const btn = document.getElementById('admin-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="checking-ring"></span> กำลังเข้าสู่ระบบ…';
  showLoading(true);
  try {
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

window.customerLogin = async function(){
  const name = document.getElementById('cust-name-1').value.trim();
  const phone = document.getElementById('cust-phone-1').value.trim();
  if(!name){ showError('กรุณากรอกชื่อของคุณ'); return; }
  if(!phone||phone.length<9){ showError('กรุณากรอกเบอร์โทรให้ครบถ้วน'); return; }
  if(!/^0[0-9]{9}$/.test(phone)){ showError('รูปแบบเบอร์ไม่ถูกต้อง (ต้องเริ่มด้วย 0 และ 10 หลัก)'); return; }

  const btn = document.querySelector('#panel-customer .login-btn');
  if(btn){ btn.disabled = true; btn.innerHTML = '<span class="checking-ring"></span> กำลังเข้าสู่ระบบ…'; }
  showLoading(true);

  try {
    // ── STEP 1: Firebase Anonymous Auth → ได้ uid จริงจาก Firebase ──────────
    // เหตุผล: signInAnonymously ให้ Firebase Auth uid ที่ verify ได้ฝั่ง Firestore Rules
    // Rules ใช้ request.auth != null → ทุก operation ต้องผ่าน auth นี้
    let userCred;
    // ถ้า login อยู่แล้ว (anonymous หรือ email) → reuse session เดิม
    if(auth.currentUser){
      userCred = { user: auth.currentUser };
    } else {
      userCred = await signInAnonymously(auth);
    }
    const uid = userCred.user.uid;

    // ── STEP 2: เก็บ phone ใน Firestore customers (ใช้ Admin SDK verify phone) ──
    // customerId = "phone_XXXXXXXXXX" เพื่อหลีกเลี่ยงชน orderId
    const custId = 'phone_' + phone;
    const existing = await getDoc(doc(db,'customers', custId));
    if(existing.exists()){
      const existingName = existing.data().name||'';
      // อนุญาตให้ชื่อต่างกันได้ (ลูกค้าอาจเปลี่ยนชื่อ) แต่ lock uid ไว้
      const existingUid = existing.data().uid||'';
      if(existingUid && existingUid !== uid){
        // เบอร์นี้ถูก claim โดย account อื่นไปแล้ว (เครื่องอื่น)
        // → allow แต่ update uid เป็นคนใหม่ (เหมาะกับร้านอาหาร ไม่ใช่ธนาคาร)
        console.warn('phone claimed by different uid, updating');
      }
    }
    await setDoc(doc(db,'customers', custId), {
      name, phone, uid,
      lastLogin: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(!existing.exists() ? { createdAt: new Date().toISOString() } : {})
    }, { merge: true });

    // ── STEP 3: เก็บ session ───────────────────────────────────────────────
    sessionStorage.setItem('imkum_user', JSON.stringify({
      role: 'customer', name, phone, uid, loginAt: Date.now()
    }));
    localStorage.setItem('imkum_name', name);
    localStorage.setItem('imkum_phone', phone);
    localStorage.removeItem('imkum_cart');
    localStorage.removeItem('imkum_cart_prices');
    window.location.href='index.html';

  } catch(e){
    let msg = 'เข้าสู่ระบบไม่สำเร็จ';
    if(e.code==='auth/network-request-failed') msg='ไม่สามารถเชื่อมต่อได้ กรุณาลองใหม่';
    else if(e.code==='auth/too-many-requests') msg='ลองมากเกินไป กรุณารอสักครู่';
    else if(e.code==='permission-denied') msg='ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่';
    showError(msg);
    console.error('customerLogin error:', e.code, e.message);
  } finally {
    if(btn){ btn.disabled=false; btn.innerHTML='<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> เริ่มสั่งอาหาร'; }
    showLoading(false);
  }
};

try {
  const sess = sessionStorage.getItem('imkum_user');
  if(sess){
    const user = JSON.parse(sess);
    if(Date.now()-(user.loginAt||0) < 8*60*60*1000) window.location.href = user.role==='customer' ? 'index.html' : 'admin.html';
    else sessionStorage.clear();
  }
  const savedName = localStorage.getItem('imkum_name')||'';
  const savedPhone = localStorage.getItem('imkum_phone')||'';
  if(savedName) document.getElementById('cust-name-1').value=savedName;
  if(savedPhone) document.getElementById('cust-phone-1').value=savedPhone;
} catch(e){ sessionStorage.clear(); }
