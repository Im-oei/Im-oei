
// cart.html — ES module (Firebase)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, onSnapshot, addDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { FIREBASE_CONFIG } from "../config.js";
window._onSnapshot = onSnapshot;
window._collection = collection;

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
// NOTE: Cloud Functions (Blaze plan) ยังไม่ได้ใช้งาน — checkout เขียน Firestore ตรงๆ

loadPickupLocations(db);
_execLoadPickup(db, getDoc, doc);

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
    const lineUserId = userObj && userObj.lineUserId;
    const stampDocId = lineUserId || phone; // ต้องตรงกับที่บันทึก
    if (stampDocId) {
      const stampRef = doc(db, 'stamps', stampDocId);
      const snap = await getDoc(stampRef).catch(() => null);
      if (snap && snap.exists()) {
        const d = snap.data();
        const key = 'imkum_stamps_' + stampDocId;
        localStorage.setItem(key, JSON.stringify({ points: d.points || 0, lifetimePoints: d.lifetimePoints || 0 }));
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
  // ใช้เบอร์จาก input ก่อน ถ้าไม่มีใช้จาก session
  var phoneInputEl = document.getElementById('phone-cart-input');
  const phone = (phoneInputEl ? phoneInputEl.value.trim() : '') || userObj.phone || '';
  if (phone && !/^0[0-9]{9}$/.test(phone.replace(/[-\s]/g,''))) {
    showToast('⚠️ เบอร์โทรศัพท์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย 0 และมี 10 หลัก)');
    if(phoneInputEl) phoneInputEl.focus();
    return;
  }
  // บันทึกเบอร์ลง session ถ้ากรอกใหม่
  if (phone && phone !== userObj.phone) {
    userObj.phone = phone;
    sessionStorage.setItem('imkum_user', JSON.stringify(userObj));
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

    // ── ดึงราคาล่าสุดจาก Firestore ก่อน checkout (ป้องกัน stale cache) ──
    // ราคามาจาก Firestore menu collection ที่ syncMenu() โหลดไว้ใน ALL_ITEMS
    // ไม่รับราคาจาก client — คำนวณใหม่จาก ALL_ITEMS ทุกครั้ง
    let calculatedTotal = 0;
    const verifiedItems = [];
    for (const id of Object.keys(cart)) {
      const qty = cart[id];
      if (!qty || qty < 1) continue;
      const item = ALL_ITEMS.find(i => i.id === id);
      if (!item) { showToast(`⚠️ ไม่พบเมนู "${id}" กรุณารีเฟรชหน้า`); showLoading(false); _isCheckingOut = false; return; }
      if (item.hidden) { showToast(`⚠️ เมนู "${item.name}" ถูกซ่อนแล้ว`); showLoading(false); _isCheckingOut = false; return; }
      if (item.soldOut) { showToast(`⚠️ เมนู "${item.name}" หมดแล้ว`); showLoading(false); _isCheckingOut = false; return; }
      const subtotal = item.price * qty;
      calculatedTotal += subtotal;
      verifiedItems.push({ id, name: item.name, qty, price: item.price, subtotal });
    }
    if (calculatedTotal <= 0 || verifiedItems.length === 0) { showToast('ไม่มีสินค้าในตะกร้า'); showLoading(false); _isCheckingOut = false; return; }
    total = calculatedTotal;

    // ── เขียน order ลง Firestore ตรงๆ (ไม่ต้องใช้ Cloud Functions / Blaze) ──
    const orderRef = await addDoc(collection(db, 'orders'), {
      items: verifiedItems,
      total,
      note: note || '',
      customerName: customerName || '',
      ...(phone      ? { customerPhone: phone }   : {}),
      ...(lineUserId ? { lineUserId }              : {}),
      ...(guestId    ? { guestId }                 : {}),
      pickupTime: pickupTime || '07:30',
      pickupLocation: selectedLocation || '',
      pickupLocationName: (PICKUP_LOCATIONS.find(l => l.id === selectedLocation) || {}).name || selectedLocation || '',
      status: 'pending',
      isPreorder: isNextDay || false,
      preorderDate: isNextDay ? (localStorage.getItem('imkum_preorder_date') || '') : null,
      createdAt: serverTimestamp(),
    });

    // ── upsert ข้อมูลลูกค้า ──
    try {
      const u = (() => { try { return JSON.parse(sessionStorage.getItem('imkum_user')||'null'); } catch(e){ return null; } })();
      const custId = lineUserId ? ('line_' + lineUserId) : (phone ? 'phone_' + phone : 'guest_' + guestId);
      await setDoc(doc(db, 'customers', custId), {
        name: customerName,
        ...(phone      ? { phone }      : {}),
        ...(lineUserId ? { lineUserId } : {}),
        ...(guestId    ? { guestId }    : {}),
        source: lineUserId ? 'line' : (phone ? 'phone' : 'guest'),
        photoUrl: u?.photoURL || '',
        lastOrderAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch(e) { console.warn('customer upsert:', e.message); }

    // ── เขียน stamps ลง Firestore (client-side จนกว่าจะ upgrade Blaze) ──
    let stampMsg = null;
    try {
      const stSettings = await getDoc(doc(db, 'settings', 'stamps')).catch(() => null);
      const pointsPerBaht = stSettings?.exists() ? (stSettings.data().pointsPerBaht || 100) : 100;
      const earnedPoints = Math.floor(total / pointsPerBaht);
      const stampDocId = lineUserId || phone;
      if (earnedPoints > 0 && stampDocId) {
        const stampRef = doc(db, 'stamps', stampDocId);
        const stampSnap = await getDoc(stampRef).catch(() => null);
        const existing = stampSnap?.exists() ? stampSnap.data() : { points: 0, lifetimePoints: 0 };
        const newPoints = (existing.points || 0) + earnedPoints;
        const newLifetime = (existing.lifetimePoints || 0) + earnedPoints;
        await setDoc(stampRef, {
          points: newPoints,
          lifetimePoints: newLifetime,
          ...(phone ? { phone } : {}),
          ...(lineUserId ? { lineUserId } : {}),
          updatedAt: serverTimestamp(),
        }, { merge: true }).catch(e => console.warn('stamp write:', e.message));
        const cacheKey = 'imkum_stamps_' + stampDocId;
        localStorage.setItem(cacheKey, JSON.stringify({ points: newPoints, lifetimePoints: newLifetime }));
      }
      stampMsg = earnedPoints > 0 ? `⭐ ได้รับ ${earnedPoints} แต้มจากออเดอร์นี้` : null;
    } catch(e) { console.warn('stamp error:', e.message); }

    localStorage.setItem('imkum_last_order', JSON.stringify({
      orderId: orderRef.id, total, pickupTime, customerName, isPreorder: isNextDay,
      items: verifiedItems,
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
    if (e.code === 'permission-denied') {
      msg = '❌ ไม่มีสิทธิ์สั่งซื้อ กรุณาเข้าสู่ระบบใหม่';
      setTimeout(function(){ window.location.href = 'login.html'; }, 1500);
    } else if (e.code === 'unavailable' || !navigator.onLine) {
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
