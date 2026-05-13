
// cart.html — ES module (Firebase)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, onSnapshot, addDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { FIREBASE_CONFIG } from "../config.js";
window._onSnapshot = onSnapshot;
window._collection = collection;

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app, 'asia-northeast1');

loadPickupLocations(db);
_execLoadPickup(db, getDocs, collection);

async function syncMenu() {
  try {
    const sDoc = await getDoc(doc(db, 'settings', 'store'));
    if (sDoc.exists()) {
      const s = sDoc.data();
      if (s.pickupStart) STORE_SETTINGS.pickupStart = s.pickupStart;
      if (s.pickupEnd) STORE_SETTINGS.pickupEnd = s.pickupEnd;
    }
    // โหลด stamp goal จาก settings
    try {
      const stSnap = await getDoc(doc(db, 'settings', 'stamps'));
      if (stSnap.exists()) { 
        STAMP_GOAL = stSnap.data().goal || 10;
        if (stSnap.data().pointsPerBaht) POINTS_PER_BAHT = stSnap.data().pointsPerBaht;
      }
    } catch(e) { console.warn('stamp settings load failed (ใช้ค่า default):', e.code || e.message); }

    const mSnap = await getDocs(collection(db, 'menu'));
    if (!mSnap.empty) {
      const catMap = {};
      mSnap.forEach(d => {
        const data = Object.assign({ id: d.id }, d.data());
        if (data.hidden) return;
        const k = data.catKey || 'other';
        if (!catMap[k]) catMap[k] = { category: data.category || k, catKey: k, items: [] };
        catMap[k].items.push(data);
      });
      MENU = Object.values(catMap);
      ALL_ITEMS = [].concat(...MENU.map(c => c.items));
      ALL_ITEMS.forEach(i => { cartPriceCache[i.id] = i.price; });
      localStorage.setItem('imkum_cart_prices', JSON.stringify(cartPriceCache));
      renderCart();
    }
  } catch(e) { console.warn('Cart sync skipped:', e.message); }

  // Sync stamp จาก Firestore เมื่อ login
  try {
    const userSess = sessionStorage.getItem('imkum_user');
    const userObj = userSess ? JSON.parse(userSess) : null;
    const phone = userObj && userObj.phone;
    if (phone) {
      // ต้อง ensure auth ก่อนอ่าน stamps (Rules ตรวจ uid ใน customers doc)
      await ensureAuth();
      const stampRef = doc(db, 'stamps', phone);
      const snap = await getDoc(stampRef);
      if (snap.exists()) {
        const key = 'imkum_stamps_' + phone;
        const d = snap.data();
        localStorage.setItem(key, JSON.stringify({ total: d.total || 0 }));
        renderCart();
      }
    }
  } catch(e) { console.warn('Stamp sync skipped:', e.message); }
}

// ====== ENSURE FIREBASE AUTH (Anonymous) ======
// ทุก checkout ต้องมี Firebase Auth token → Firestore Rules ตรวจ request.auth != null
async function ensureAuth() {
  if (auth.currentUser) return auth.currentUser;
  // ไม่มี session → signInAnonymously (ใช้ session เดิมจาก login.module.js ถ้ามี)
  const cred = await signInAnonymously(auth);
  return cred.user;
}

// ====== CHECKOUT via Firestore ตรงๆ (ไม่ใช้ Cloud Function) ======
let _isCheckingOut = false; // guard กัน double-submit
window.checkout = async function() {
  if (_isCheckingOut) { showToast('กำลังดำเนินการ กรุณารอสักครู่...'); return; }
  if (!navigator.onLine) { showToast('❌ ไม่มีอินเทอร์เน็ต กรุณาตรวจสอบการเชื่อมต่อ'); return; }
  var total = getTotal();
  if (!total) { showToast('ไม่มีสินค้าในตะกร้า'); return; }

  const userSess = sessionStorage.getItem('imkum_user');
  const userObj = userSess ? JSON.parse(userSess) : null;
  // ต้องมี identity อย่างใดอย่างหนึ่ง: phone, lineUserId, หรือ guestId
  const hasIdentity = userObj && (userObj.phone || userObj.lineUserId || userObj.guestId);
  if (!hasIdentity) { window.location.href = 'login.html'; return; }

  var nameEl = document.getElementById('name-input');
  var customerName = (nameEl ? nameEl.value : '').trim();
  if (!customerName) { showToast('กรุณากรอกชื่อของคุณ'); if(nameEl) nameEl.focus(); return; }
  if (!selectedLocation) { showToast('กรุณาเลือกจุดรับอาหาร'); return; }
  localStorage.setItem('imkum_name', customerName);

  var note = (document.getElementById('note-input') ? document.getElementById('note-input').value : '').trim().slice(0, 200);
  var pickupRaw = document.getElementById('pickup-select') ? document.getElementById('pickup-select').value : '07:30';
  var isNextDay = pickupRaw.startsWith('next:');
  var pickupTime = pickupRaw.replace('next:', '');
  const phone = userObj.phone || '';
  if (phone && !/^0[0-9]{9}$/.test(phone.replace(/[-\s]/g,''))) {
    showToast('⚠️ เบอร์โทรศัพท์ไม่ถูกต้อง กรุณาแก้ไขในโปรไฟล์');
    return;
  }
  const lineUserId = userObj.lineUserId || '';
  const guestId = userObj.guestId || '';

  var orderItems = [];
  Object.keys(cart).forEach(function(id) {
    var qty = cart[id];
    var item = ALL_ITEMS.filter(function(i){ return i.id===id; })[0];
    if (item) orderItems.push({ id, name: item.name, qty, price: item.price, subtotal: item.price * qty });
  });

  _isCheckingOut = true;
  showLoading(true);
  try {
    // ── ensure Firebase Auth ก่อน addDoc → Rules require request.auth != null ──
    await ensureAuth();

    // 🔐 FIX: เรียก validateAndCreateOrder Cloud Function แทน addDoc ตรง
    // เดิม: client ส่ง price + total เอง = แก้ราคาได้ (price manipulation)
    // ใหม่: server ดึงราคาจาก menu collection แล้ว recalculate total
    const validateAndCreateOrder = httpsCallable(functions, 'validateAndCreateOrder');
    const orderResult = await validateAndCreateOrder({
      items: Object.keys(cart).map(id => ({ id, qty: cart[id] })), // ส่งแค่ id + qty
      note,
      customerName,
      ...(phone ? { customerPhone: phone } : {}),
      ...(lineUserId ? { lineUserId } : {}),
      ...(guestId ? { guestId } : {}),
      pickupTime,
      pickupLocation: selectedLocation,
      pickupLocationName: (PICKUP_LOCATIONS.find(l => l.id === selectedLocation) || {}).name || selectedLocation,
      isPreorder: isNextDay || false,
      preorderDate: isNextDay ? (localStorage.getItem('imkum_preorder_date') || '') : null,
    });
    const { orderId, total: confirmedTotal } = orderResult.data;
    // ใช้ total จาก server (ที่ validate แล้ว) แทน client-calculated
    total = confirmedTotal;
    const orderRef = { id: orderId };

    // อัพเดทแต้ม (20 บาท = 1 แต้ม, คำนวณจากยอดออเดอร์)
    // upsert ข้อมูลลูกค้าลง customers collection ทุกครั้งที่สั่ง
    try {
      const u = (() => { try { return JSON.parse(sessionStorage.getItem('imkum_user')||'null'); } catch(e){ return null; } })();
      const custId = lineUserId ? ('line_' + lineUserId) : (phone ? 'phone_' + phone : 'guest_' + guestId);
      await setDoc(doc(db, 'customers', custId), {
        name: customerName,
        ...(phone ? { phone } : {}),
        ...(lineUserId ? { lineUserId } : {}),
        ...(guestId ? { guestId } : {}),
        source: lineUserId ? 'line' : (phone ? 'phone' : 'guest'),
        photoUrl: u?.photoURL || '',
        lastOrderAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch(e) { console.warn('customer upsert:', e.message); }

    // 🔴 SECURITY FIX: ถอด stamp write ออกจาก client แล้ว
    // ก่อนหน้า: client เขียน stamps ตรง = ปั๊มแต้มได้ (points += 100 ทุก request)
    // ใหม่: onOrderCreate Cloud Function คำนวณและเขียน stamps ผ่าน Admin SDK
    // แต้มจะอัปเดตอัตโนมัติหลัง order สร้างสำเร็จ (~1-2 วินาที)
    let stampMsg = null;
    try {
      // อ่านแต้มเก่าจาก localStorage เพื่อแสดง UI (ไม่ได้เขียน Firestore)
      const stampKey = lineUserId || phone || guestId;
      const cachedStamps = localStorage.getItem('imkum_stamps_' + stampKey);
      const cached = cachedStamps ? JSON.parse(cachedStamps) : { points: 0 };
      const stSnap = await fetch ? null : null; // placeholder
      const stSettings = await getDoc(doc(db, 'settings', 'stamps')).catch(() => null);
      const bahtPerPoint = stSettings?.exists() ? (stSettings.data().bahtPerPoint || 25) : 25;
      const earnedPoints = Math.floor(total / bahtPerPoint);
      stampMsg = earnedPoints > 0
        ? `⭐ จะได้รับ ${earnedPoints} แต้ม (Cloud Function กำลังบันทึก...)`
        : null;
    } catch(e) { console.warn('stamp preview failed:', e.message); }

    localStorage.setItem('imkum_last_order', JSON.stringify({
      orderId: orderRef.id, total, pickupTime, customerName, isPreorder: isNextDay,
      items: orderItems,
      preorderDate: isNextDay ? (localStorage.getItem('imkum_preorder_date') || '') : null,
      pickupLocation: selectedLocation,
      pickupLocationName: (PICKUP_LOCATIONS.find(l => l.id === selectedLocation) || {}).name || '',
      stampMsg
    }));
    cart = {}; saveCart();
    if (isNextDay) {
      localStorage.removeItem('imkum_preorder');
      localStorage.removeItem('imkum_preorder_date');
    }
    window.location.href = 'success.html';
  } catch(e) {
    console.error('checkout error:', e);
    var msg = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
    if (e.code === 'functions/internal') {
      msg = '❌ ระบบขัดข้องชั่วคราว กรุณาลองใหม่ใน 1 นาที';
    } else if (e.code === 'functions/unauthenticated') {
      msg = '❌ กรุณาเข้าสู่ระบบก่อนสั่งอาหาร';
      setTimeout(function(){ window.location.href = 'login.html'; }, 1500);
    } else if (e.code === 'functions/unavailable' || !navigator.onLine) {
      msg = '❌ ไม่มีอินเทอร์เน็ต กรุณาตรวจสอบการเชื่อมต่อ';
    } else if (e.message) {
      msg = '❌ ' + e.message;
    }
    showToast(msg);
  } finally {
    _isCheckingOut = false;
    showLoading(false);
  }
};

// compat alias (ป้องกัน submitCartLogin เรียก placeOrder เก่า)
window.placeOrder = window.checkout;

syncMenu();
