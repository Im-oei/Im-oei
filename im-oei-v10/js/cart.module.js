const LINE_OA_TOKEN = 'MIfafKd1RxoUErArTPMtN7Bnp3X5cM6iqkYczR+8ltyIJbtKHzklDZgYOwoEex1MFHetb4WqCDnjgVd6q63tey73o6MHCbz50gx24P0LA6VQIbgQURj0hJB8RySu2VO9kY4GX2fCNLa029xgMkp23wdB04t89/1O/w1cDnyilFU=';

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
      STORE_SETTINGS.isOpen = s.isOpen !== false; // default open ถ้าไม่มีค่า
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
    const userSess = localStorage.getItem('imkum_user');
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
async function notifyLineOA(order) {
  try {
    const orderId = '#' + order.orderId.slice(0,8).toUpperCase();
    const customerLine = (order.customerName || 'ไม่ระบุ') + (order.customerPhone ? '  📞 ' + order.customerPhone : '');
    const itemsBody = (order.items || []).map(i => ({
      type: 'box', layout: 'horizontal', margin: 'sm',
      contents: [
        { type: 'text', text: i.name + ' ×' + i.qty, size: 'sm', color: '#555555', flex: 4, wrap: true },
        { type: 'text', text: i.subtotal + ' ฿', size: 'sm', color: '#FF8C00', flex: 2, align: 'end', weight: 'bold' }
      ]
    }));

    const flexMsg = {
      type: 'flex', altText: '🛎️ ออเดอร์ใหม่ ' + orderId,
      contents: {
        type: 'bubble',
        hero: order.firstImageUrl ? {
          type: 'image', url: order.firstImageUrl,
          size: 'full', aspectRatio: '20:13', aspectMode: 'cover'
        } : undefined,
        header: {
          type: 'box', layout: 'vertical',
          backgroundColor: '#FF8C00', paddingAll: '16px',
          contents: [
            { type: 'text', text: '🛎️ ออเดอร์ใหม่!', color: '#ffffff', size: 'xl', weight: 'bold' },
            { type: 'text', text: orderId, color: '#ffe0b2', size: 'sm', margin: 'xs' }
          ]
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
          contents: [
            { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
              { type: 'icon', url: 'https://scdn.line-apps.com/n/channel_devcenter/img/fx/review_gold_star_28.png', size: 'xs' },
              { type: 'text', text: customerLine, size: 'sm', color: '#333', flex: 5, wrap: true }
            ]},
            { type: 'separator', margin: 'md' },
            { type: 'box', layout: 'horizontal', margin: 'md', contents: [
              { type: 'text', text: '⏰', size: 'sm', flex: 1 },
              { type: 'text', text: 'รับ ' + (order.pickupTime || '07:30') + ' น.', size: 'sm', color: '#333', flex: 5 }
            ]},
            { type: 'box', layout: 'horizontal', contents: [
              { type: 'text', text: '📍', size: 'sm', flex: 1 },
              { type: 'text', text: order.pickupLocationName || '-', size: 'sm', color: '#333', flex: 5, wrap: true }
            ]},
            { type: 'separator', margin: 'md' },
            ...itemsBody,
            { type: 'separator', margin: 'md' },
            { type: 'box', layout: 'horizontal', margin: 'md', contents: [
              { type: 'text', text: 'รวมทั้งหมด', size: 'sm', color: '#333', weight: 'bold', flex: 3 },
              { type: 'text', text: order.total + ' บาท', size: 'lg', color: '#FF8C00', weight: 'bold', flex: 3, align: 'end' }
            ]}
          ]
        },
        footer: {
          type: 'box', layout: 'vertical', paddingAll: '12px',
          contents: [{
            type: 'button', style: 'primary', color: '#FF8C00',
            action: { type: 'uri', label: '📋 ดูออเดอร์ในระบบ', uri: 'https://im-oei.web.app/admin.html' }
          }]
        }
      }
    };

    await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_OA_TOKEN },
      body: JSON.stringify({ messages: [flexMsg] })
    });
  } catch(e) { console.warn('LINE OA notify:', e.message); }
}

window.checkout = async function() {
  if (_isCheckingOut) { showToast('กำลังดำเนินการ กรุณารอสักครู่...'); return; }
  // ── Rate limit: ไม่เกิน 3 orders ใน 10 นาที ──
  const now = Date.now();
  const rlKey = 'imkum_order_times';
  const orderTimes = JSON.parse(localStorage.getItem(rlKey) || '[]')
    .filter(t => now - t < 10 * 60 * 1000); // เก็บแค่ 10 นาทีล่าสุด
  if (orderTimes.length >= 3) {
    const waitMs = 10 * 60 * 1000 - (now - orderTimes[0]);
    const waitMin = Math.ceil(waitMs / 60000);
    showToast(`⚠️ สั่งซื้อบ่อยเกินไป กรุณารอ ${waitMin} นาที`);
    return;
  }


  if (!navigator.onLine) { showToast('❌ ไม่มีอินเทอร์เน็ต กรุณาตรวจสอบการเชื่อมต่อ'); return; }

  // ── ตรวจว่าร้านเปิดรับออเดอร์อยู่ไหม ──
  if (STORE_SETTINGS.isOpen === false) {
    showToast('🔴 ร้านปิดรับออเดอร์แล้ว กรุณามาใหม่วันพรุ่งนี้');
    return;
  }

  var total = getTotal();
  if (!total) { showToast('ไม่มีสินค้าในตะกร้า'); return; }

  const userSess = localStorage.getItem('imkum_user');
  const userObj = userSess ? JSON.parse(userSess) : null;

  // ─── ดึงเบอร์ที่เคยบันทึกไว้กลับมา ───
  if (userObj && !userObj.phone) {
    const savedPhone = localStorage.getItem('imkum_saved_phone');
    if (savedPhone) { userObj.phone = savedPhone; userObj.phoneVerified = true; localStorage.setItem('imkum_user', JSON.stringify(userObj)); }
  }

  // ต้องมี identity อย่างใดอย่างหนึ่ง: phone, lineUserId, หรือ guestId
  // ถ้าไม่มี session ให้สร้าง guest session อัตโนมัติ (ไม่ต้อง login)
  if (!userObj || (!userObj.phone && !userObj.lineUserId && !userObj.guestId)) {
    const guestId = 'guest_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    const guest = { role: 'guest', name: '', guestId, loginAt: Date.now() };
    localStorage.setItem('imkum_user', JSON.stringify(guest));
    // reload userObj
    var userObjNew = guest;
    Object.assign(userObj || {}, userObjNew);
    if (!userObj) { localStorage.setItem('imkum_return_to','cart.html'); window.location.href = 'login.html'; return; }
  }

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
    localStorage.setItem('imkum_user', JSON.stringify(userObj));
    localStorage.setItem('imkum_saved_phone', phone); // บันทึกถาวร
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
    // หักส่วนลดคูปอง
    const couponDiscount = window.getCouponDiscount ? window.getCouponDiscount() : 0;
    const finalTotal = Math.max(0, total - couponDiscount);
    if (couponDiscount > 0) total = finalTotal;

    // ── เขียน order ลง Firestore ตรงๆ (ไม่ต้องใช้ Cloud Functions / Blaze) ──
    // บันทึกเวลาสั่งเพื่อ rate limit
    const rlKey2 = 'imkum_order_times';
    const times2 = JSON.parse(localStorage.getItem(rlKey2) || '[]');
    times2.push(Date.now());
    localStorage.setItem(rlKey2, JSON.stringify(times2.slice(-10)));

    const orderRef = await addDoc(collection(db, 'orders'), {
      items: verifiedItems,
      total,
      couponCode: _appliedCoupon?.code || null,
      couponDiscount: couponDiscount || 0,
      referralCode: localStorage.getItem('imkum_referral') || null,
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
      const u = (() => { try { return JSON.parse(localStorage.getItem('imkum_user')||'null'); } catch(e){ return null; } })();
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
    // แจ้ง LINE OA เมื่อมีออเดอร์ใหม่
    const firstItem = verifiedItems[0];
    const firstMenuObj = firstItem ? ALL_ITEMS.find(m => m.id === firstItem.id) : null;
    notifyLineOA({
      orderId: orderRef.id,
      customerName,
      customerPhone: phone,
      pickupTime,
      pickupLocationName: (PICKUP_LOCATIONS.find(l => l.id === selectedLocation) || {}).name || selectedLocation || '',
      items: verifiedItems,
      total,
      couponCode: _appliedCoupon?.code || null,
      couponDiscount: couponDiscount || 0,
      referralCode: localStorage.getItem('imkum_referral') || null,
      firstImageUrl: firstMenuObj?.imageUrl || null,
    }).catch(() => {});
    window.location.href = 'success.html';
  } catch(e) {
    console.error('checkout error:', e);
    var msg = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
    if (e.code === 'permission-denied') {
      msg = '❌ ไม่มีสิทธิ์สั่งซื้อ กรุณาเข้าสู่ระบบใหม่';
      setTimeout(function(){ localStorage.setItem('imkum_return_to','cart.html'); window.location.href = 'login.html'; }, 1500);
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

// ===== COUPON SYSTEM =====
let _appliedCoupon = null;

window.applyCoupon = async function() {
  const input = document.getElementById('coupon-input');
  const code = (input?.value || '').trim().toUpperCase();
  if (!code) { showToast('กรุณากรอกรหัสคูปอง'); return; }

  try {
    showToast('🔍 กำลังตรวจสอบคูปอง...');
    const couponDoc = await getDoc(doc(db, 'coupons', code));
    if (!couponDoc.exists()) { showToast('❌ ไม่พบรหัสคูปองนี้'); return; }

    const c = couponDoc.data();
    const now = new Date();

    // ตรวจสอบ
    if (c.disabled) { showToast('❌ คูปองนี้ถูกปิดใช้งานแล้ว'); return; }
    if (c.expiresAt && c.expiresAt.toDate() < now) { showToast('❌ คูปองหมดอายุแล้ว'); return; }
    if (c.startsAt && c.startsAt.toDate() > now) { showToast('❌ คูปองยังไม่ถึงวันใช้งาน'); return; }
    if (c.usedCount >= c.maxUses) { showToast('❌ คูปองถูกใช้งานครบแล้ว'); return; }

    const total = getTotal();
    if (c.minOrder && total < c.minOrder) {
      showToast(`❌ ต้องสั่งขั้นต่ำ ${c.minOrder} บาท`); return;
    }

    _appliedCoupon = { code, ...c };
    renderCouponResult(c, total);
    showToast(`✅ ใช้คูปอง "${code}" สำเร็จ!`);
  } catch(e) {
    showToast('❌ ตรวจสอบคูปองไม่ได้: ' + e.message);
  }
};

function renderCouponResult(c, total) {
  const el = document.getElementById('coupon-result');
  if (!el) return;
  const discount = calcDiscount(c, total);
  el.style.display = 'block';
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:10px 14px;">
      <div>
        <div style="font-size:13px;font-weight:700;color:#166534;">✅ ${c.name || _appliedCoupon.code}</div>
        <div style="font-size:12px;color:#16a34a;">ลด ${discount} บาท</div>
      </div>
      <button onclick="removeCoupon()" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:18px;">×</button>
    </div>`;
  renderTotal();
}

function calcDiscount(c, total) {
  if (!c) return 0;
  if (c.type === 'percent') return Math.min(Math.round(total * c.value / 100), c.maxDiscount || 99999);
  if (c.type === 'fixed') return Math.min(c.value, total);
  return 0;
}

window.removeCoupon = function() {
  _appliedCoupon = null;
  const el = document.getElementById('coupon-result');
  if (el) el.style.display = 'none';
  const inp = document.getElementById('coupon-input');
  if (inp) inp.value = '';
  renderTotal();
  showToast('ลบคูปองแล้ว');
};

window.getCouponDiscount = function() {
  if (!_appliedCoupon) return 0;
  return calcDiscount(_appliedCoupon, getTotal());
};
