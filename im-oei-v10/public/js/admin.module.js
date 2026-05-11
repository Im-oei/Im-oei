// admin.html — ES module (Firebase)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, onSnapshot, query,
  doc, updateDoc, deleteDoc, setDoc, getDoc, addDoc,
  serverTimestamp, getDocs, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { FIREBASE_CONFIG } from '../config.js'
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app, 'asia-northeast1');


// ====== AUTH & ROLE ======
const ADMIN_KEY = 'imkum_admin_auth';
const SESSION_MAX = 8 * 60 * 60 * 1000; // 8 ชั่วโมง
// ====== XSS ESCAPE UTILITY ======
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function checkAuth() {
  if (!sessionStorage.getItem(ADMIN_KEY)) {
    window.location.href = 'index.html'; return false;
  }
  try {
    const u = JSON.parse(sessionStorage.getItem('imkum_user') || 'null');
    if (!u) { sessionStorage.clear(); window.location.href = 'index.html'; return false; }
    if (u.loginAt && (Date.now() - u.loginAt > SESSION_MAX)) {
      sessionStorage.clear();
      window.location.href = 'index.html'; return false;
    }
    // ตรวจ admin role — ต้องเป็น admin หรือ owner เท่านั้น
    if (u.role !== 'admin' && u.role !== 'owner') {
      sessionStorage.clear();
      window.location.href = 'index.html'; return false;
    }
  } catch(e) { sessionStorage.clear(); window.location.href = 'index.html'; return false; }
  return true;
}
function getUser(){ try{ return JSON.parse(sessionStorage.getItem('imkum_user')||'null'); }catch(e){ return null; } }
function getCurrentRole(){ const u=getUser(); return u?u.role:'admin'; }

// ซ่อน/แสดง UI ตาม role
function applyRoleUI() {
  const role = getCurrentRole();
  const isOwner = role === 'owner';
  // แสดงชื่อ role ใน header
  const subEl = document.getElementById('admin-brand-sub');
  if(subEl) subEl.textContent = isOwner ? '👑 เจ้าของร้าน' : '🧑‍🍳 แอดมิน';
  // owner เห็นทุกแท็บ, admin ไม่เห็นแท็บตั้งค่าบางส่วน
  document.querySelectorAll('.owner-only').forEach(el => {
    el.style.display = isOwner ? '' : 'none';
  });
}

// ====== STATE ======
let allOrders = [];
let _lineQueueCache = {}; // { orderId: { status, sentAt, error } }
let allMenuItems = [];
let allBanners = [];
let allCategories = [];
let currentFilter = 'all';
// Expose filter function to global scope for onclick handlers
window._filterOrdersByStatus = function(status) {
  currentFilter = status;
  renderOrders();
};
let storeIsOpen = true;
let unsubOrders = null;
let _unsubLineQueue = null;
let currentFeaturedIds = [];

// ====== INIT ======
if (checkAuth()) {
  applyRoleUI();

  // โหลดชื่อ admin จาก session
  (function() {
    try {
      const u = JSON.parse(sessionStorage.getItem('imkum_user') || '{}');
      const name = u.name || u.email || 'Admin';
      const role = u.role || 'admin';
      const label = role === 'owner' ? '👑 ' + name : name;
      const el = document.getElementById('admin-display-name');
      const el2 = document.getElementById('user-dropdown-name');
      if (el) el.textContent = label;
      if (el2) el2.textContent = label + ' (' + role + ')';
    } catch(e) {}
  })();

  let _adminInitDone = false;
  function _runAdminInit() {
    if (_adminInitDone) return;
    _adminInitDone = true;
    loadSettings();
    loadMenu();
    loadBanners();
    loadCategories();
    loadStampConfig();
    loadPreorderSetting();
    listenOrders();
    listenLineQueue();
    loadCustomers();
    loadRewards();
  }

  // รอ Firebase Auth restore ก่อน (custom token จาก login.module.js)
  // onAuthStateChanged fire ครั้งแรกเสมอ (user หรือ null) — ใช้เป็น signal ว่า SDK พร้อมแล้ว
  let _authResolved = false;
  onAuthStateChanged(auth, (user) => {
    if (!_authResolved) {
      _authResolved = true;
      // user != null  → มี Firebase Auth session (LINE custom token หรือ email login)
      // user == null  → ไม่มี session แต่ SDK ตอบแล้ว (เช่น email admin ที่ session หมดอายุ)
      //                 → โหลดข้อมูลได้แต่ Firestore rules อาจบล็อก collections ที่ต้อง auth
      _runAdminInit();
    }
  });

  // Safety fallback: ถ้า onAuthStateChanged ไม่ fire ภายใน 3 วิ (เช่น Firebase SDK โหลดช้า)
  setTimeout(() => { if (!_adminInitDone) _runAdminInit(); }, 3000);

  // initAdminNotifications - handled by second script tag
}

// ====== REALTIME ORDERS ======
function listenOrders() {
  if (unsubOrders) { unsubOrders(); unsubOrders = null; } // cleanup ก่อน re-subscribe
  const q = collection(db, 'orders');
  unsubOrders = onSnapshot(q,
    snap => {
      allOrders = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
          const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
          return tb - ta;
        });
      updateSummary();
      renderOrders();
      if (document.getElementById('panel-stats').classList.contains('active')) renderStats();
      // ตรวจออเดอร์ใหม่ → แจ้งเตือน
      if (typeof window._checkNewOrdersNotification === 'function') {
        window._checkNewOrdersNotification(allOrders);
      }
      const dot = document.getElementById('realtime-dot');
      const st = document.getElementById('realtime-status');
      if (dot) dot.style.background = 'var(--green)';
      if (st) st.textContent = 'อัพเดทอัตโนมัติ (real-time)';
    },
    err => {
      console.error('onSnapshot error:', err.code, err.message);
      const dot = document.getElementById('realtime-dot');
      const st = document.getElementById('realtime-status');
      if (dot) { dot.style.background = 'var(--red)'; dot.style.animation = 'none'; }
      if (st) st.textContent = '⚠️ real-time ล้มเหลว: ' + (err.code || err.message) + ' — กำลัง fallback...';
      const container = document.getElementById('orders-list');
      container.innerHTML = `<div style="margin:16px;background:#FFEBEE;border-radius:12px;padding:14px;font-size:13px;color:#B71C1C">
        ⚠️ real-time ล้มเหลว: <b>${err.code || err.message}</b><br>
        <span style="font-size:12px;color:#666;margin-top:6px;display:block">กำลังลองโหลดแบบปกติ...</span>
      </div>`;
      fallbackLoadOrders();
    }
  );
}

// ====== REALTIME LINE QUEUE STATUS ======
function listenLineQueue() {
  if (_unsubLineQueue) _unsubLineQueue();
  _unsubLineQueue = onSnapshot(collection(db, 'lineQueue'), snap => {
    _lineQueueCache = {};
    snap.docs.forEach(d => {
      const data = d.data();
      // docId format: orderId_notify  → extract orderId
      const orderId = d.id.replace(/_notify(_\d+)?$/, '');
      // keep latest (ถ้ามีหลาย doc ต่อ order ให้เอาอันล่าสุด)
      const prev = _lineQueueCache[orderId];
      const thisTime = data.sentAt?.toMillis?.() || data.createdAt?.toMillis?.() || 0;
      const prevTime = prev?.sentAt?.toMillis?.() || prev?.createdAt?.toMillis?.() || 0;
      if (!prev || thisTime >= prevTime) {
        _lineQueueCache[orderId] = { status: data.status, sentAt: data.sentAt, error: data.error };
      }
    });
    // re-render order cards to reflect updated badges
    renderOrders();
  }, err => {
    console.warn('listenLineQueue error:', err.code);
  });
}

window.fallbackLoadOrders = async function fallbackLoadOrders() {
  try {
    const snap = await getDocs(collection(db, 'orders'));
    allOrders = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt||0);
        const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt||0);
        return tb - ta;
      });
    updateSummary();
    renderOrders();
    showToast('โหลดออเดอร์แล้ว');
  } catch(e) {
    console.error('fallback error:', e);
    const container = document.getElementById('orders-list');
    container.innerHTML = `<div style="margin:16px;background:#FFEBEE;border-radius:12px;padding:16px;font-size:13px;color:#B71C1C">
      ❌ โหลดออเดอร์ไม่ได้: <b>${e.code || e.message}</b><br>
      <button onclick="fallbackLoadOrders()" style="margin-top:10px;padding:8px 16px;background:#FFC107;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit">🔄 ลองอีกครั้ง</button>
    </div>`;
    // แสดงข้อมูลว่างแต่ยังใช้งานได้
    allOrders = [];
    updateSummary();
  }
}

function updateSummary() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayOrders = allOrders.filter(o => {
    if (!o.createdAt) return false;
    const d = o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
    return d >= today;
  });
  const totalOrdersEl = document.getElementById('sum-total-orders');
  const revenueEl = document.getElementById('sum-revenue');
  const pendingEl = document.getElementById('sum-pending');
  const doneEl = document.getElementById('sum-done');
  const customersEl = document.getElementById('sum-customers');

  if (totalOrdersEl) totalOrdersEl.textContent = todayOrders.length;
  const revenue = todayOrders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+o.total,0);
  if (revenueEl) revenueEl.textContent = revenue.toLocaleString('th-TH') + '฿';
  const pendingCount = todayOrders.filter(o=>o.status==='pending'||o.status==='preparing').length;
  if (pendingEl) pendingEl.textContent = pendingCount;
  // sync bottom tab badge
  const btabBadge = document.getElementById('btab-orders-badge');
  if (btabBadge) {
    btabBadge.textContent = pendingCount || '';
    btabBadge.style.display = pendingCount > 0 ? 'block' : 'none';
  }
  const navBadge = document.getElementById('nav-orders-badge');
  if (navBadge) navBadge.textContent = pendingCount;
  // sync horizontal tab bar badge
  const tabOrdersBadge = document.getElementById('tab-orders-badge');
  if (tabOrdersBadge) {
    tabOrdersBadge.textContent = pendingCount || '';
    tabOrdersBadge.style.display = pendingCount > 0 ? 'inline' : 'none';
  }
  if (doneEl) doneEl.textContent = todayOrders.filter(o=>o.status==='done').length;
  if (customersEl) customersEl.textContent = allOrders.map(o=>o.userId||o.lineUserId).filter((v,i,a)=>v&&a.indexOf(v)===i).length;

  // --- Recent Orders (dashboard card) ---
  const recentEl = document.getElementById('dashboard-recent-orders');
  if (recentEl) {
    const recent = [...allOrders].sort((a,b)=>{
      const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt||0);
      const db = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt||0);
      return db - da;
    }).slice(0,4);
    if (!recent.length) {
      recentEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-sub);font-size:13px;">ยังไม่มีออเดอร์</div>`;
    } else {
      const statusLabel = { pending:'รอรับ', preparing:'กำลังทำ', ready:'พร้อมรับ', done:'เสร็จแล้ว', cancelled:'ยกเลิก' };
      const statusBadgeClass = { pending:'inprogress', preparing:'inprogress', ready:'inprogress', done:'done', cancelled:'cancel' };
      const channelIcon = { delivery:'🛵', pickup:'🏠', checkmee:'📱' };
      recentEl.innerHTML = recent.map(o => {
        const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt||0);
        const dateStr = d.toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
        const itemCount = (o.items||[]).reduce((s,i)=>s+(i.qty||i.quantity||1),0);
        const shortId = (o.id||'').toUpperCase().slice(0,8);
        const icon = channelIcon[o.channel||o.orderType] || '🏠';
        const badge = statusLabel[o.status] || o.status;
        const cls = statusBadgeClass[o.status] || 'inprogress';
        return `<div class="order-item">
          <div class="channel-icon">${icon}</div>
          <div class="order-id">#${shortId}<div class="sub">${dateStr} • ${itemCount} รายการ</div></div>
          <div style="text-align:right">
            <div style="font-size:13px;font-weight:700;">${(o.total||0).toLocaleString('th-TH')} ฿</div>
            <div class="status-badge ${cls}">${badge}</div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // --- Notifications (dynamic from live data) ---
  const notifEl = document.getElementById('dashboard-notifications');
  if (notifEl) {
    const notifs = [];
    const stuckOrders = todayOrders.filter(o=>{
      if (o.status!=='preparing'&&o.status!=='pending') return false;
      const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt||0);
      return (Date.now()-d.getTime()) > 30*60*1000;
    });
    if (stuckOrders.length) notifs.push({ dot:'red', icon:'🔔', title:'ออเดอร์ค้างนาน', sub:`มี ${stuckOrders.length} ออเดอร์ที่ค้างเกิน 30 นาที`, time:'ตอนนี้' });
    if (todayOrders.length) notifs.push({ dot:'green', icon:'📈', title:'ยอดขายวันนี้', sub:`รวม ${revenue.toLocaleString('th-TH')} บาท จาก ${todayOrders.length} ออเดอร์`, time:'อัปเดตล่าสุด' });
    const newToday = todayOrders.map(o=>o.userId||o.lineUserId).filter((v,i,a)=>v&&a.indexOf(v)===i).length;
    if (newToday) notifs.push({ dot:'blue', icon:'👤', title:'ลูกค้าวันนี้', sub:`มีลูกค้า ${newToday} คนสั่งออเดอร์วันนี้`, time:'วันนี้' });
    if (!notifs.length) notifs.push({ dot:'green', icon:'✅', title:'ทุกอย่างเรียบร้อย', sub:'ไม่มีการแจ้งเตือนใหม่', time:'' });
    notifEl.innerHTML = notifs.map(n=>`<div class="notif-item">
      <div class="notif-dot ${n.dot}">${n.icon}</div>
      <div class="notif-body"><div class="ntitle">${n.title}</div><div class="nsub">${n.sub}</div></div>
      <div class="notif-time">${n.time}</div>
    </div>`).join('');
  }

  // --- Donut Chart (channel breakdown) ---
  const donutTotalEl = document.getElementById('donut-total-num');
  const donutListEl = document.getElementById('donut-channel-list');
  if (donutTotalEl) donutTotalEl.textContent = todayOrders.length;
  const channelMap = { delivery:'เดลิเวอรี่', pickup:'รับที่ร้าน', checkmee:'เช็คเมตี' };
  const channelColors = { pickup:'#f97316', delivery:'#10b981', checkmee:'#f59e0b' };
  const channelKeys = ['pickup','delivery','checkmee'];
  const channelCounts = channelKeys.map(k=>todayOrders.filter(o=>(o.channel||o.orderType)===k).length);
  const total = channelCounts.reduce((a,b)=>a+b,0)||1;
  if (window.donutChart) {
    window.donutChart.data.datasets[0].data = channelCounts;
    window.donutChart.update();
  }
  if (donutListEl) {
    donutListEl.innerHTML = channelKeys.map((k,i)=>`<div class="channel-row">
      <div class="channel-color" style="background:${channelColors[k]}"></div>
      <div class="channel-name">${channelMap[k]}</div>
      <div class="channel-pct">${Math.round(channelCounts[i]/total*100)}%</div>
    </div>`).join('');
  }

  // --- Sales Line Chart (7 days) ---
  if (window.salesChart) {
    const days = [];
    const revenuePerDay = [];
    const ordersPerDay = [];
    for (let i=6;i>=0;i--) {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-i);
      const next = new Date(d); next.setDate(next.getDate()+1);
      days.push(d.toLocaleDateString('th-TH',{day:'numeric',month:'short'}));
      const dayOrders = allOrders.filter(o=>{
        const od = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt||0);
        return od>=d && od<next;
      });
      revenuePerDay.push(dayOrders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+o.total,0));
      ordersPerDay.push(dayOrders.length);
    }
    window.salesChart.data.labels = days;
    window.salesChart.data.datasets[0].data = revenuePerDay;
    window.salesChart.data.datasets[1].data = ordersPerDay;
    window.salesChart.update();
  }

  // --- New Customers (7 days) ---
  const newCustCountEl = document.getElementById('new-customers-count');
  const newCustChangeEl = document.getElementById('new-customers-change');
  const newCustAvatarEl = document.getElementById('new-customers-avatars');
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate()-7); sevenDaysAgo.setHours(0,0,0,0);
  const fourteenDaysAgo = new Date(); fourteenDaysAgo.setDate(fourteenDaysAgo.getDate()-14); fourteenDaysAgo.setHours(0,0,0,0);
  const week1Orders = allOrders.filter(o=>{ const d=o.createdAt?.toDate?o.createdAt.toDate():new Date(o.createdAt||0); return d>=sevenDaysAgo; });
  const week2Orders = allOrders.filter(o=>{ const d=o.createdAt?.toDate?o.createdAt.toDate():new Date(o.createdAt||0); return d>=fourteenDaysAgo && d<sevenDaysAgo; });
  const uniqWeek1 = [...new Set(week1Orders.map(o=>o.userId||o.lineUserId).filter(Boolean))];
  const uniqWeek2 = [...new Set(week2Orders.map(o=>o.userId||o.lineUserId).filter(Boolean))];
  const newCustCount = uniqWeek1.length;
  if (newCustCountEl) newCustCountEl.textContent = '+' + newCustCount + ' คน';
  if (newCustChangeEl) {
    if (uniqWeek2.length && newCustCount) {
      const pct = Math.round((newCustCount-uniqWeek2.length)/Math.max(uniqWeek2.length,1)*100);
      newCustChangeEl.textContent = (pct>=0?'↑ ':'↓ ') + Math.abs(pct) + '% จากสัปดาห์ก่อน';
      newCustChangeEl.style.color = pct>=0 ? 'var(--green)' : 'var(--red,#ef4444)';
    } else {
      newCustChangeEl.textContent = 'ข้อมูลไม่เพียงพอ';
      newCustChangeEl.style.color = 'var(--text-sub)';
    }
  }
  if (newCustAvatarEl) {
    const avColors = ['linear-gradient(135deg,#f97316,#fb923c)','linear-gradient(135deg,#3b82f6,#60a5fa)','linear-gradient(135deg,#10b981,#34d399)','linear-gradient(135deg,#8b5cf6,#a78bfa)'];
    const show = Math.min(newCustCount, 4);
    const more = newCustCount - show;
    let html = '';
    for (let i=0;i<show;i++) html += `<div class="av" style="background:${avColors[i%avColors.length]}">👤</div>`;
    if (more>0) html += `<div class="av av-more">+${more}</div>`;
    newCustAvatarEl.innerHTML = html;
  }

  // --- Top Menus (from today's orders) ---
  const topMenusEl = document.getElementById('dashboard-top-menus');
  if (topMenusEl) {
    const menuCount = {};
    const menuRevenue = {};
    todayOrders.filter(o=>o.status!=='cancelled').forEach(o=>{
      (o.items||[]).forEach(it=>{
        const name = it.name||it.itemName||'ไม่ระบุ';
        const qty = it.qty||it.quantity||1;
        menuCount[name] = (menuCount[name]||0) + qty;
        menuRevenue[name] = (menuRevenue[name]||0) + (it.price||0)*qty;
      });
    });
    const sorted = Object.entries(menuCount).sort((a,b)=>b[1]-a[1]).slice(0,3);
    if (!sorted.length) {
      topMenusEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-sub);font-size:13px;">ยังไม่มีออเดอร์วันนี้</div>`;
    } else {
      const rankClass = ['r1','r2','r3'];
      topMenusEl.innerHTML = sorted.map(([name,qty],i)=>`<div class="menu-item">
        <div class="menu-rank ${rankClass[i]}">${i+1}</div>
        <div class="menu-img">🍞</div>
        <div class="menu-info"><div class="mname">${name}</div><div class="msub">ขาย ${qty} ชิ้น</div></div>
        <div class="menu-price">${(menuRevenue[name]||0).toLocaleString('th-TH')} ฿</div>
      </div>`).join('');
    }
  }

  // --- Latest Review ---
  const reviewEl = document.getElementById('dashboard-latest-review');
  if (reviewEl) {
    const withReview = [...allOrders].filter(o=>o.review||o.rating).sort((a,b)=>{
      const da=a.createdAt?.toDate?a.createdAt.toDate():new Date(a.createdAt||0);
      const db=b.createdAt?.toDate?b.createdAt.toDate():new Date(b.createdAt||0);
      return db-da;
    });
    if (!withReview.length) {
      reviewEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-sub);font-size:13px;">ยังไม่มีรีวิว</div>`;
    } else {
      const r = withReview[0];
      const d = r.createdAt?.toDate?r.createdAt.toDate():new Date(r.createdAt||0);
      const dateStr = d.toLocaleDateString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      const stars = '★'.repeat(r.rating||5) + '☆'.repeat(5-(r.rating||5));
      const name = r.customerName||r.displayName||'ลูกค้า';
      reviewEl.innerHTML = `<div class="review-item">
        <div class="review-header">
          <div class="review-av">👤</div>
          <div><div class="review-name">${name}</div><div class="review-stars">${stars}</div></div>
          <div class="review-date">${dateStr}</div>
        </div>
        <div class="review-text">${r.review||'ดีมากค่ะ 👍'}</div>
      </div>`;
    }
  }
}

function renderOrders() {
  const container = document.getElementById('orders-list');
  let filtered = currentFilter === 'all' ? allOrders : allOrders.filter(o => o.status === currentFilter);
  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>ไม่มีออเดอร์</p></div>`;
    return;
  }
  container.innerHTML = filtered.map(o => renderOrderCard(o)).join('');
}

function renderOrderCard(o) {
  const statusMap = { pending:'รอรับ', preparing:'กำลังทำ', ready:'พร้อมรับ', done:'รับแล้ว', cancelled:'ยกเลิก' };
  const statusClass = { pending:'status-pending', preparing:'status-preparing', ready:'status-ready', done:'status-done', cancelled:'status-cancelled' };
  const createdAt = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : new Date());
  const timeStr = createdAt.toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit'});
  const dateStr = createdAt.toLocaleDateString('th-TH', {day:'numeric',month:'short'});
  const isPreorder = o.isPreorder === true;
  const preorderDate = o.preorderDate || '';

  const itemsHTML = (o.items||[]).map(i =>
    `<div class="order-item-row">
      <span>${esc(i.name)} × ${Number(i.qty)||0}</span>
      <span style="font-weight:700">${Number(i.subtotal)||0} บาท</span>
    </div>`
  ).join('');

  // LINE queue status badge
  const lineInfo = _lineQueueCache[o.id];
  let lineBadge = '';
  let notifyBtnLabel = '💬 แจ้งลูกค้า';
  if (lineInfo) {
    if (lineInfo.status === 'sent') {
      const sentTime = lineInfo.sentAt?.toDate ? lineInfo.sentAt.toDate().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}) : '';
      lineBadge = `<div class="line-status-badge line-status-sent">✅ LINE ส่งแล้ว${sentTime ? ' · '+sentTime : ''}</div>`;
      notifyBtnLabel = '🔄 ส่งอีกครั้ง';
    } else if (lineInfo.status === 'pending') {
      lineBadge = `<div class="line-status-badge line-status-pending">📤 กำลังส่ง LINE...</div>`;
      notifyBtnLabel = '⏳ กำลังส่ง...';
    } else if (lineInfo.status === 'error') {
      const errShort = (lineInfo.error || '').slice(0, 40);
      lineBadge = `<div class="line-status-badge line-status-error">❌ LINE ส่งไม่ได้${errShort ? ': '+errShort : ''}</div>`;
      notifyBtnLabel = '🔄 ลองส่งใหม่';
    }
  }

  const actionBtns = {
    pending: `<button class="action-btn btn-preparing" onclick="updateStatus('${o.id}','preparing')">🔵 กำลังทำ</button>
               <button class="action-btn btn-cancel" onclick="updateStatus('${o.id}','cancelled')">❌ ยกเลิก</button>`,
    preparing: `<button class="action-btn btn-ready" onclick="updateStatus('${o.id}','ready')">🟢 พร้อมรับ</button>
                 <button class="action-btn btn-cancel" onclick="updateStatus('${o.id}','cancelled')">❌ ยกเลิก</button>`,
    ready: `<button class="action-btn btn-done" onclick="updateStatus('${o.id}','done')">✅ รับแล้ว</button>
               <button class="action-btn" style="background:#E8F5E9;color:#2E7D32" onclick="notifyCustomer('${o.id}','${esc(o.customerName||'').replace(/'/g,'')}','${o.pickupTime||'07:30'}')">${notifyBtnLabel}</button>
               ${lineBadge}`,
    done: `${lineBadge}`, cancelled: ``
  }[o.status] || '';

  // Logo: ใช้ logo ที่โหลดมาแล้ว หรือ fallback เป็น emoji
  const logoHtml = window._storeLogo
    ? `<img src="${window._storeLogo}" style="width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0;" alt="logo">`
    : `<span style="font-size:24px;flex-shrink:0;">🍱</span>`;

  return `
    <div class="order-card" id="order-${o.id}" style="${isPreorder ? 'border-left:4px solid #764ba2;' : ''}">
      <div class="order-head">
        <div style="display:flex;align-items:flex-start;gap:10px;flex:1;min-width:0;">
          ${logoHtml}
          <div style="flex:1;min-width:0;">
            <div class="order-id">#${o.id.slice(0,8).toUpperCase()}</div>
            <div class="order-name">👤 ${esc(o.customerName) || 'ไม่ระบุชื่อ'}</div>
            ${isPreorder ? `<div style="display:inline-flex;align-items:center;gap:5px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;margin-bottom:4px;">📅 สั่งล่วงหน้า${preorderDate ? ' · '+preorderDate : ''}</div>` : ''}
            <div class="order-meta">${dateStr} เวลา ${timeStr} &nbsp;|&nbsp; <span class="pickup-time-tag">🕐 ${esc(o.pickupTime) || '07:30'} น.</span></div>
            ${o.pickupLocationName ? `<div class="order-location-tag">📍 ${esc(o.pickupLocationName)}</div>` : ''}
          </div>
        </div>
        <span class="status-badge ${statusClass[o.status]}">${statusMap[o.status]||o.status}</span>
      </div>
      <div class="order-items-list">${itemsHTML}</div>
      ${o.note ? `<div class="order-note">📝 หมายเหตุ: ${esc(o.note)}</div>` : ''}
      <div class="order-total-row">
        <span class="total-label">รวม</span>
        <span class="total-val">${o.total} บาท</span>
      </div>
      <div class="order-actions">
        ${actionBtns}
        <button class="action-btn btn-delete" onclick="deleteOrder('${o.id}')">🗑️</button>
      </div>
    </div>`;
}

// ====== DELETE ORDER ======
window.deleteOrder = async function(id) {
  const ok = await showConfirmDialog({
    icon: '🗑️', iconBg: '#FFEBEE', iconBorder: '#FFCDD2',
    title: 'ลบออเดอร์นี้?',
    desc: 'ออเดอร์จะถูกลบถาวร ไม่สามารถย้อนกลับได้',
    confirmText: 'ลบเลย', confirmColor: 'linear-gradient(135deg,#E53935,#B71C1C)', confirmTextColor: '#fff',
  });
  if (!ok) return;
  try {
    showLoading(true);
    await deleteDoc(doc(db, 'orders', id));
    showToast('🗑️ ลบออเดอร์แล้ว');
  } catch(e) {
    showToast('❌ ลบไม่ได้: ' + e.message);
  } finally {
    showLoading(false);
  }
};

// ====== LOAD MENU ======
async function loadMenu() {
  try {
    const snap = await getDocs(collection(db, 'menu'));
allMenuItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // ถ้าไม่มีเมนูใน Firestore ใช้ default แบบ local (ไม่ write ลง Firestore)
    if (!allMenuItems.length) loadDefaultMenu();
  } catch(e) {
    console.warn('loadMenu error:', e.message);
    loadDefaultMenu();
  }
  renderMenuAdmin();
}

function loadDefaultMenu() {
  allMenuItems = [
    { id:'tuna',          name:'ปูอัดทูน่า',     desc:'ปูอัด, ทูน่า, ผักสลัด',        emoji:'🥪', price:20, catKey:'sandwich', category:'🥪 แซนวิช', sortOrder:1 },
    { id:'pork_salad',    name:'หมูหยองสลัด',    desc:'หมูหยอง, สลัด, มายองเนส',      emoji:'🥙', price:20, catKey:'sandwich', category:'🥪 แซนวิช', sortOrder:1 },
    { id:'egg_sausage',   name:'ไข่ดาวไส้กรอก',  desc:'ไข่ดาว, ไส้กรอก, ซอส',         emoji:'🍳', price:20, catKey:'sandwich', category:'🥪 แซนวิช', sortOrder:1 },
    { id:'shrimp',        name:'ไข่กุ้งสาหร่าย', desc:'ไข่กุ้ง, สาหร่าย, มายองเนส',  emoji:'🍤', price:20, catKey:'sandwich', category:'🥪 แซนวิช', sortOrder:1 },
    { id:'chicken_rice',  name:'ข้าวไก่อบ',      desc:'ไก่อบ, ไข่ต้ม, ผัก',           emoji:'🍗', price:50, catKey:'rice',     category:'🍚 ข้าว',   sortOrder:2 },
    { id:'chicken_lime',  name:'ข้าวไก่อบมะนาว', desc:'ไก่มะนาว, ข้าว, ผัก',          emoji:'🍋', price:50, catKey:'rice',     category:'🍚 ข้าว',   sortOrder:2 },
    { id:'chicken_noodle',name:'หมี่ไก่ฉีก',    desc:'หมี่เหลือง, ไก่ฉีก, น้ำซุป',   emoji:'🍜', price:50, catKey:'noodle',   category:'🍜 หมี่',   sortOrder:3 },
    { id:'pork_noodle',   name:'หมี่หมูแดง',     desc:'หมี่, หมูแดง, ไข่ต้ม',          emoji:'🥢', price:50, catKey:'noodle',   category:'🍜 หมี่',   sortOrder:3 },
  ];
}

async function seedMenu() {
  const defaults = [
    { id:'tuna',          name:'ปูอัดทูน่า',     desc:'ปูอัด, ทูน่า, ผักสลัด',        emoji:'🥪', price:20, catKey:'sandwich', category:'🥪 แซนวิช', sortOrder:1 },
    { id:'pork_salad',    name:'หมูหยองสลัด',    desc:'หมูหยอง, สลัด, มายองเนส',      emoji:'🥙', price:20, catKey:'sandwich', category:'🥪 แซนวิช', sortOrder:1 },
    { id:'egg_sausage',   name:'ไข่ดาวไส้กรอก',  desc:'ไข่ดาว, ไส้กรอก, ซอส',         emoji:'🍳', price:20, catKey:'sandwich', category:'🥪 แซนวิช', sortOrder:1 },
    { id:'shrimp',        name:'ไข่กุ้งสาหร่าย', desc:'ไข่กุ้ง, สาหร่าย, มายองเนส',  emoji:'🍤', price:20, catKey:'sandwich', category:'🥪 แซนวิช', sortOrder:1 },
    { id:'chicken_rice',  name:'ข้าวไก่อบ',      desc:'ไก่อบ, ไข่ต้ม, ผัก',           emoji:'🍗', price:50, catKey:'rice',     category:'🍚 ข้าว',   sortOrder:2 },
    { id:'chicken_lime',  name:'ข้าวไก่อบมะนาว', desc:'ไก่มะนาว, ข้าว, ผัก',          emoji:'🍋', price:50, catKey:'rice',     category:'🍚 ข้าว',   sortOrder:2 },
    { id:'chicken_noodle',name:'หมี่ไก่ฉีก',    desc:'หมี่เหลือง, ไก่ฉีก, น้ำซุป',   emoji:'🍜', price:50, catKey:'noodle',   category:'🍜 หมี่',   sortOrder:3 },
    { id:'pork_noodle',   name:'หมี่หมูแดง',     desc:'หมี่, หมูแดง, ไข่ต้ม',          emoji:'🥢', price:50, catKey:'noodle',   category:'🍜 หมี่',   sortOrder:3 },
  ];
  for (const item of defaults) {
    await setDoc(doc(db, 'menu', item.id), item);
  }
  allMenuItems = defaults;
}

function renderMenuAdmin() {
  const container = document.getElementById('menu-admin-list');

  if (!container) {
    console.error('menu-admin-list not found');
    return;
  }
  const grouped = {};
  allMenuItems.forEach(item => {
    const k = item.catKey || 'other';
    if (!grouped[k]) grouped[k] = { label: item.category || k, items: [] };
    grouped[k].items.push(item);
  });
  let html = '';
  Object.entries(grouped).forEach(([k, g]) => {
    html += `<div class="cat-header-admin" style="font-size:15px;font-weight:800;padding:10px 0 6px;color:var(--text)">${esc(g.label)}</div>`;
    g.items.forEach(item => {
      html += `
        <div class="menu-item-admin" style="${item.hidden?'opacity:0.5':''}">
          <div class="food-emoji">${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="">` : (item.emoji||'🍽️')}</div>
          <div class="info">
            <div class="name">${esc(item.name)} ${item.hidden?'<span class="hidden-badge">ซ่อน</span>':''}</div>
            <div class="price">${item.price} บาท</div>
          </div>
          <div class="actions">
            <button class="icon-btn btn-edit" onclick="openEditItem('${item.id}')" title="แก้ไข">✏️</button>
            <button class="icon-btn btn-img" onclick="openImageModal('${item.id}')" title="รูปภาพ">🖼️</button>
            <button class="icon-btn btn-hide" onclick="toggleHide('${item.id}','${!item.hidden}')" title="${item.hidden?'แสดง':'ซ่อน'}">${item.hidden?'👁️':'🙈'}</button>
            <div class="soldout-toggle-wrap" title="สลับ หมด / มีอยู่">
              <span class="soldout-label" style="color:${item.soldOut?'#E53935':'#4CAF50'}">${item.soldOut?'หมด':'มี'}</span>
              <label class="soldout-switch">
                <input type="checkbox" ${item.soldOut?'checked':''} onchange="toggleSoldOut('${item.id}',this.checked)">
                <span class="sl"></span>
              </label>
            </div>
            <button class="icon-btn" style="background:#FFEBEE" onclick="deleteMenuItem('${item.id}')" title="ลบ">🗑️</button>
          </div>
        </div>`;
    });
  });
  container.innerHTML = html;
  renderCategoryAdmin();
  // Update featured checkboxes if settings tab is open
  if (document.getElementById('featured-checkboxes')) renderFeaturedCheckboxes();
}

function renderCategoryAdmin() {
  const container = document.getElementById('cat-admin-list');
  if (!container) return;
  if (!allCategories.length) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-sub);padding:8px 0">ยังไม่มีหมวดหมู่ (ใช้ค่า default)</p>';
    return;
  }
  container.innerHTML = allCategories.map(c => `
    <div class="cat-admin-card">
      <div class="cat-emoji">${c.emoji||'🍽️'}</div>
      <div class="info">
        <div class="c-name">${esc(c.name)}</div>
        <div class="c-key">key: ${esc(c.key)} | ลำดับ: ${c.sortOrder||0}</div>
      </div>
      <button class="icon-btn btn-edit" onclick="openEditCategory('${esc(c.key)}')" title="แก้ไข">✏️</button>
      <button class="icon-btn" style="background:#FFEBEE" onclick="deleteCategoryItem('${esc(c.key)}')" title="ลบ">🗑️</button>
    </div>`).join('');
}

// ====== DELETE MENU ITEM ======
window.deleteMenuItem = async function(id) {
  showLoading(true);
  var ok = await showConfirmDialog({ icon:'🗑️', iconBg:'#FFF3E0', iconBorder:'#FFE0B2', title:'ลบเมนูนี้?', desc:'เมนูจะถูกลบออกจากระบบถาวร\nไม่สามารถย้อนกลับได้', confirmText:'ลบเมนู', confirmColor:'linear-gradient(135deg,#E53935,#B71C1C)', confirmTextColor:'#fff' });
  if (!ok) return;
  // ลบจาก local state ก่อนเสมอ
  allMenuItems = allMenuItems.filter(i => i.id !== id);
  renderMenuAdmin();
  // พยายามลบจาก Firestore (อาจ fail ถ้า rules บล็อค)
  deleteDoc(doc(db, 'menu', id)).then(()=>showToast('ลบเมนูแล้ว 🗑️')).catch(e=>{
    console.warn('delete menu firestore:', e.code);
    showToast('ลบออกจากหน้าจอแล้ว (Firestore rules บล็อค write)');
  });
};

// ====== BANNERS ======
async function loadBanners() {
  try {
    const snap = await getDocs(collection(db, 'banners'));
    allBanners = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b)=>(a.order||0)-(b.order||0));
    renderBannersAdmin();
  } catch(e) { console.warn('banners load:', e.message); }
}

function renderBannersAdmin() {
  const container = document.getElementById('banners-list');
  if (!container) return;
  if (!allBanners.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">🖼️</div><p>ยังไม่มีแบนเนอร์<br><span style="font-size:13px;color:#aaa">กด "+ เพิ่มแบนเนอร์" เพื่อเริ่มต้น</span></p></div>';
    return;
  }
  const typeLabel = { slider:'🖼️ Slider', promo:'🎉 โปรโมชัน', gradient:'🌅 Gradient', announcement:'📢 ประกาศ', sale:'🔥 Flash Sale' };
  const typeColor = { slider:'#E3F2FD', promo:'#F3E5F5', gradient:'#FFF3E0', announcement:'#E8F5E9', sale:'#FFEBEE' };
  const typeTextColor = { slider:'#1565C0', promo:'#6A1B9A', gradient:'#E65100', announcement:'#2E7D32', sale:'#B71C1C' };
  const typePlaceholderBg = { slider:'linear-gradient(135deg,#E3F2FD,#90CAF9)', promo:'linear-gradient(135deg,#9C27B0,#E91E63)', gradient:'linear-gradient(135deg,#FF8C00,#FFC107)', announcement:'linear-gradient(135deg,#4CAF50,#81C784)', sale:'linear-gradient(135deg,#E53935,#FF8A65)' };
  container.innerHTML = allBanners.map(b => {
    const t = b.type || 'slider';
    const tc = typeColor[t]||'#F5F5F5';
    const ttc = typeTextColor[t]||'#333';
    const ph = typePlaceholderBg[t]||'linear-gradient(135deg,#EEE,#DDD)';
    return `
    <div class="banner-card" style="border-left:4px solid ${ttc}">
      ${b.imageUrl ? `<img class="banner-card-img" src="${b.imageUrl}" alt="${b.title||''}">` : `<div class="banner-card-img-placeholder" style="background:${ph};color:#fff;font-size:36px">🖼️</div>`}
      <div class="banner-card-body">
        <div class="info">
          <div class="b-title">${b.title||'(ไม่มีชื่อ)'}</div>
          <div class="b-order" style="margin-top:4px">
            <span class="banner-type-tag" style="background:${tc};color:${ttc}">${typeLabel[t]||t}</span>
            ลำดับ: ${b.order||1} &nbsp;|&nbsp; ${b.active!==false?'✅ เปิดใช้':'❌ ปิด'}
            ${b.subtitle ? `<div style="margin-top:2px;font-size:11px;color:#888">${b.subtitle}</div>` : ''}
          </div>
        </div>
        <button class="icon-btn btn-edit" onclick="openEditBanner('${b.id}')" title="แก้ไข">✏️</button>
        <button class="icon-btn" style="background:#FFEBEE" onclick="deleteBannerItem('${b.id}')" title="ลบ">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

window.openAddBanner = function() {
  document.getElementById('banner-edit-id').value = '';
  document.getElementById('modal-banner-title').textContent = 'เพิ่มแบนเนอร์';
  ['banner-title','banner-subtitle','banner-img-url'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('banner-order').value = (allBanners.length + 1);
  document.getElementById('banner-active').checked = true;
  document.getElementById('banner-modal-preview').style.display = 'none';
  const typeEl = document.getElementById('banner-type');
  if (typeEl) typeEl.value = 'slider';
  const sizeEl = document.getElementById('banner-size');
  if (sizeEl) sizeEl.value = 'medium';
  const posEl = document.getElementById('banner-position');
  if (posEl) posEl.value = 'hero';
  previewBannerModal();
  document.getElementById('modal-banner').classList.add('show');
};

window.openEditBanner = function(id) {
  const b = allBanners.find(x => x.id === id);
  if (!b) return;
  document.getElementById('banner-edit-id').value = id;
  document.getElementById('modal-banner-title').textContent = 'แก้ไขแบนเนอร์';
  document.getElementById('banner-title').value = b.title || '';
  document.getElementById('banner-subtitle').value = b.subtitle || '';
  document.getElementById('banner-order').value = b.order || 1;
  document.getElementById('banner-img-url').value = b.imageUrl || '';
  document.getElementById('banner-active').checked = b.active !== false;
  const typeEl = document.getElementById('banner-type');
  if (typeEl) typeEl.value = b.type || 'slider';
  const sizeEl2 = document.getElementById('banner-size');
  if (sizeEl2) sizeEl2.value = b.size || 'medium';
  const posEl2 = document.getElementById('banner-position');
  if (posEl2) posEl2.value = b.position || 'hero';
  previewBannerModal();
  document.getElementById('modal-banner').classList.add('show');
};

window.previewBannerModal = function() {
  const url = document.getElementById('banner-img-url').value;
  const img = document.getElementById('banner-modal-preview');
  const placeholder = document.getElementById('banner-preview-placeholder');
  const box = document.getElementById('banner-preview-box');
  const bg = document.getElementById('banner-preview-bg');
  const badge = document.getElementById('banner-preview-badge');
  const info = document.getElementById('banner-preview-info');

  // รูปภาพ
  if (url) { img.src = url; img.style.display = 'block'; if(placeholder) placeholder.style.display='none'; }
  else { img.style.display = 'none'; if(placeholder) placeholder.style.display='flex'; }

  // ขนาด
  const sizeMap = { small:120, medium:180, large:240, full:300 };
  const size = document.getElementById('banner-size') ? document.getElementById('banner-size').value : 'medium';
  if (box) box.style.height = (sizeMap[size] || 180) + 'px';

  // ประเภท - สีพื้นหลัง
  const typeColors = {
    slider: 'transparent',
    promo: 'linear-gradient(135deg,#9C27B0,#E91E63)',
    gradient: 'linear-gradient(135deg,#FF8C00,#FFC107)',
    announcement: 'linear-gradient(135deg,#2E7D32,#66BB6A)',
    sale: 'linear-gradient(135deg,#C62828,#EF5350)'
  };
  const typeBadge = { slider:'Slider', promo:'🎉 โปรโมชัน', gradient:'🌅 Gradient', announcement:'📢 ประกาศ', sale:'🔥 Flash Sale' };
  const typeBadgeColor = { slider:'rgba(255,193,7,0.9)', promo:'rgba(156,39,176,0.9)', gradient:'rgba(255,140,0,0.9)', announcement:'rgba(46,125,50,0.9)', sale:'rgba(198,40,40,0.9)' };
  const type = document.getElementById('banner-type') ? document.getElementById('banner-type').value : 'slider';
  if (bg) bg.style.background = (!url && typeColors[type] !== 'transparent') ? typeColors[type] : 'transparent';
  if (badge) { badge.textContent = typeBadge[type]||type; badge.style.background = typeBadgeColor[type]||'rgba(255,193,7,0.9)'; badge.style.color = type==='slider'?'#3E2000':'#fff'; }

  // ข้อความ preview
  const title = document.getElementById('banner-title') ? document.getElementById('banner-title').value : '';
  const sub = document.getElementById('banner-subtitle') ? document.getElementById('banner-subtitle').value : '';
  const pt = document.getElementById('banner-preview-title');
  const ps = document.getElementById('banner-preview-sub');
  if (pt) pt.textContent = title;
  if (ps) ps.textContent = sub;

  // ตำแหน่ง info
  const posLabel = { hero:'📍 Hero (บนสุดหน้าแรก)', mid:'📢 กลางหน้า (ระหว่างเมนูแนะนำ)', bottom:'⬇️ ล่างสุด (ก่อน footer)' };
  const sizeLabel = { small:'เล็ก 120px', medium:'กลาง 180px', large:'ใหญ่ 240px', full:'เต็มจอ 300px' };
  const pos = document.getElementById('banner-position') ? document.getElementById('banner-position').value : 'hero';
  if (info) info.textContent = (posLabel[pos]||pos) + ' · ' + (sizeLabel[size]||size);
};

window.uploadBannerModal = function(input) {
  if (input.files[0] && input.files[0].size > 5 * 1024 * 1024) {
    showToast('❌ ไฟล์ใหญ่เกินไป (สูงสุด 5MB)'); input.value = ''; return;
  }
  const file = input.files[0]; if (!file) return;
  showLoading(true);
  // compress ลงให้เล็กที่สุด (max 400px wide) เพื่อให้ Firestore รับได้
  compressImageToBase64(file, 400, compressed => {
    const kb = Math.round(compressed.length / 1024);
    if (compressed.length > 700000) {
      showToast('❌ รูปยังใหญ่เกิน (' + kb + ' KB) กรุณาใช้รูปขนาดเล็กกว่านี้');
      showLoading(false); return;
    }
    document.getElementById('banner-img-url').value = compressed;
    previewBannerModal();
    showToast('โหลดรูปสำเร็จ (' + kb + ' KB)');
    showLoading(false);
  });
};

window.saveBannerItem = async function() {
  const id = document.getElementById('banner-edit-id').value;
  const imgVal2 = document.getElementById('banner-img-url').value;
  if (imgVal2 && imgVal2.startsWith('data:') && imgVal2.length > 700000) {
    showToast('❌ รูปภาพใหญ่เกินไป กรุณาเลือกรูปใหม่'); return;
  }
  const data = {
    title: document.getElementById('banner-title').value.trim(),
    subtitle: document.getElementById('banner-subtitle').value.trim(),
    imageUrl: document.getElementById('banner-img-url').value.trim(),
    order: parseInt(document.getElementById('banner-order').value) || 1,
    active: document.getElementById('banner-active').checked,
    type: (document.getElementById('banner-type') ? document.getElementById('banner-type').value : 'slider'),
    size: (document.getElementById('banner-size') ? document.getElementById('banner-size').value : 'medium'),
    position: (document.getElementById('banner-position') ? document.getElementById('banner-position').value : 'hero'),
    midBanner: (document.getElementById('banner-position') ? document.getElementById('banner-position').value === 'mid' : false),
  };
  showLoading(true);
  try {
    if (id) {
      await updateDoc(doc(db, 'banners', id), data);
      const idx = allBanners.findIndex(b => b.id === id);
      if (idx >= 0) allBanners[idx] = { ...allBanners[idx], ...data };
    } else {
      const ref = await addDoc(collection(db, 'banners'), data);
      allBanners.push({ id: ref.id, ...data });
    }
    allBanners.sort((a,b)=>(a.order||0)-(b.order||0));
    renderBannersAdmin();
    closeModal('modal-banner');
    showToast('บันทึกแบนเนอร์แล้ว ✓');
  } catch(e) { console.error(e); showToast('❌ ' + (e.code||e.message||'เกิดข้อผิดพลาด')); }
  finally { showLoading(false); }
};

window.deleteBannerItem = async function(id) {
  showLoading(true);
  var ok = await showConfirmDialog({ icon:'🖼️', iconBg:'#FFF3E0', iconBorder:'#FFE0B2', title:'ลบแบนเนอร์?', desc:'แบนเนอร์นี้จะถูกลบออกถาวร', confirmText:'ลบแบนเนอร์', confirmColor:'linear-gradient(135deg,#E53935,#B71C1C)', confirmTextColor:'#fff' });
  if (!ok) return;
  // Optimistic local remove first
  allBanners = allBanners.filter(b => b.id !== id);
  renderBannersAdmin();
  showToast('ลบแบนเนอร์แล้ว');
  deleteDoc(doc(db, 'banners', id)).catch(e => {
    console.warn('deleteBanner Firestore:', e.code, e.message);
  });
};

// ====== CATEGORIES ======
async function loadCategories() {
  try {
    const snap = await getDocs(collection(db, 'categories'));
    allCategories = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    renderCategoryAdmin();
    // Update category select in menu modal
    updateCatSelect();
  } catch(e) { console.warn('categories load:', e.message); }
}

function updateCatSelect() {
  const sel = document.getElementById('edit-catkey');
  if (!sel || !allCategories.length) return;
  sel.innerHTML = allCategories.map(c => `<option value="${c.key}">${c.emoji||''} ${c.name}</option>`).join('');
}

window.openAddCategory = function() {
  document.getElementById('cat-edit-key').value = '';
  document.getElementById('modal-cat-title').textContent = 'เพิ่มหมวดหมู่';
  ['cat-key','cat-name','cat-emoji'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('cat-sort').value = (allCategories.length + 1) * 10;
  document.getElementById('cat-key').readOnly = false;
  document.getElementById('modal-category').classList.add('show');
};

window.openEditCategory = function(key) {
  const c = allCategories.find(x => x.key === key);
  if (!c) return;
  document.getElementById('cat-edit-key').value = key;
  document.getElementById('modal-cat-title').textContent = 'แก้ไขหมวดหมู่';
  document.getElementById('cat-key').value = c.key;
  document.getElementById('cat-key').readOnly = false; // allow editing
  document.getElementById('cat-name').value = c.name || '';
  document.getElementById('cat-emoji').value = c.emoji || '';
  document.getElementById('cat-sort').value = c.sortOrder || 10;
  document.getElementById('modal-category').classList.add('show');
};

window.saveCategoryItem = async function() {
  const editKey = document.getElementById('cat-edit-key').value;
  const key = document.getElementById('cat-key').value.trim().toLowerCase().replace(/\s+/g,'_');
  const name = document.getElementById('cat-name').value.trim();
  const emoji = document.getElementById('cat-emoji').value.trim();
  const sortOrder = parseInt(document.getElementById('cat-sort').value) || 10;
  if (!key || !name) { showToast('กรุณากรอก Key และชื่อหมวดหมู่'); return; }
  const data = { key, name, emoji, sortOrder, category: `${emoji} ${name}` };
  // Optimistic update local state first
  if (editKey && editKey !== key) {
    allCategories = allCategories.filter(c => c.key !== editKey);
  }
  const idx = allCategories.findIndex(c => c.key === key);
  if (idx >= 0) allCategories[idx] = { id: key, ...data };
  else allCategories.push({ id: key, ...data });
  allCategories.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
  renderCategoryAdmin();
  updateCatSelect();
  closeModal('modal-category');
  showLoading(true);
  try {
    await setDoc(doc(db, 'categories', key), data);
    if (editKey && editKey !== key) {
      await deleteDoc(doc(db, 'categories', editKey)).catch(()=>{});
    }
    showToast('บันทึกหมวดหมู่แล้ว ✓');
  } catch(e) {
    console.warn('saveCat Firestore:', e.code, e.message);
    showToast('บันทึกในหน้าจอแล้ว (Firestore: ' + (e.code||e.message) + ')');
  }
  finally { showLoading(false); }
};

window.deleteCategoryItem = async function(key) {
  showLoading(true);
  const inUse = allMenuItems.some(i => i.catKey === key);
  var desc = inUse
    ? 'หมวดหมู่นี้ยังมีเมนูอยู่\nเมนูจะถูกย้ายไปหมวด "other" โดยอัตโนมัติ'
    : 'หมวดหมู่จะถูกลบออกถาวร';
  var ok = await showConfirmDialog({ icon:'📂', iconBg:'#FFF3E0', iconBorder:'#FFE0B2', title:'ลบหมวดหมู่?', desc, confirmText:'ลบหมวดหมู่', confirmColor:'linear-gradient(135deg,#E53935,#B71C1C)', confirmTextColor:'#fff' });
  if (!ok) return;
  // Optimistic local delete first
  allCategories = allCategories.filter(c => c.key !== key);
  renderCategoryAdmin();
  updateCatSelect();
  showToast('ลบหมวดหมู่แล้ว');
  // Then try Firestore
  deleteDoc(doc(db, 'categories', key)).catch(e => {
    console.warn('deleteCat Firestore:', e.code, e.message);
    // Already removed from UI, just log
  });
};



async function loadSettings() {
  try {
  const timeout = new Promise((_,rej) => setTimeout(()=>rej(new Error('timeout')), 5000));
  const d = await Promise.race([getDoc(doc(db, 'settings', 'store')), timeout]);
  if (d.exists()) {
    const s = d.data();
    if (s.orderCutoff) { const el_cutoff = document.getElementById('set-cutoff'); if (el_cutoff) el_cutoff.value = s.orderCutoff; }
    if (s.pickupStart) { const el_ps = document.getElementById('set-pickup-start'); if (el_ps) el_ps.value = s.pickupStart; }
    if (s.pickupEnd) { const el_pe = document.getElementById('set-pickup-end'); if (el_pe) el_pe.value = s.pickupEnd; }
    if (s.bannerUrl) {
      const el_bu = document.getElementById('set-banner-url'); if (el_bu) el_bu.value = s.bannerUrl;
      const img = document.getElementById('banner-preview-img');
      img.src = s.bannerUrl; img.style.display = 'block';
    }
    if (s.storeName) {
      const nameEl = document.getElementById('admin-brand-name');
      if (nameEl) nameEl.textContent = s.storeName;
      const inp = document.getElementById('set-store-name');
      if (inp) inp.value = s.storeName;
    }
    if (s.storeTagline) {
      const inp = document.getElementById('set-store-tagline');
      if (inp) inp.value = s.storeTagline;
    }
    if (s.siteTitle) {
      document.title = s.siteTitle;
      const inp = document.getElementById('set-site-title');
      if (inp) inp.value = s.siteTitle;
    }
    if (s.heroLogoUrl) {
      const el_hl = document.getElementById('set-hero-logo-url'); if (el_hl) el_hl.value = s.heroLogoUrl;
      const logoImg = document.getElementById('hero-logo-preview-img');
      logoImg.src = s.heroLogoUrl; logoImg.style.display = 'block';
      window._storeLogo = s.heroLogoUrl;
      const brandLogoPreview = document.getElementById('brand-logo-preview');
      if (brandLogoPreview) { brandLogoPreview.src = s.heroLogoUrl; brandLogoPreview.style.display = 'block'; }
      const logoWrap = document.getElementById('admin-logo-wrap');
      if (logoWrap) { logoWrap.innerHTML = `<img src="${s.heroLogoUrl}" alt="logo" style="width:44px;height:44px;object-fit:cover;border-radius:50%;">`; }
      const nameEl = document.getElementById('admin-brand-name');
      if (nameEl && s.storeName) nameEl.textContent = s.storeName;
    }
    if (s.featuredIds) currentFeaturedIds = s.featuredIds;
    storeIsOpen = s.isOpen !== false;
    const togEl = document.getElementById('store-open-toggle');
    const lblEl = document.getElementById('store-status-label');
    if (togEl) togEl.checked = storeIsOpen;
    if (lblEl) lblEl.textContent = storeIsOpen ? 'เปิดร้าน' : 'ปิดร้าน';
  }
  } catch(e) {
    console.warn('loadSettings error (ใช้ค่า default):', e.message);
    const savedOpen = localStorage.getItem('imkum_store_open');
    storeIsOpen = savedOpen !== 'false';
    const tog = document.getElementById('store-open-toggle');
    const lbl = document.getElementById('store-status-label');
    if (!tog || !lbl) return;
    if(tog) tog.checked = storeIsOpen;
    if(lbl) lbl.textContent = storeIsOpen ? 'เปิดร้าน' : 'ปิดร้าน';
  }
}

async function loadStampConfig() {
  try {
    const d = await getDoc(doc(db, 'settings', 'stamps'));
    if (d.exists()) {
      const s = d.data();
      if (document.getElementById('stamp-goal')) document.getElementById('stamp-goal').value = s.goal || 10;
      if (document.getElementById('points-per-baht')) document.getElementById('points-per-baht').value = s.pointsPerBaht || 20;
      if (document.getElementById('points-expiry-days')) document.getElementById('points-expiry-days').value = s.expiryDays || 0;
    }
  } catch(e) { console.warn('loadStampConfig: โหลด config แต้มไม่ได้ (ใช้ค่า default):', e.code || e.message); }
}

async function loadPreorderSetting() {
  try {
    const d = await getDoc(doc(db, 'settings', 'store'));
    if (d.exists()) {
      const s = d.data();
      const el = document.getElementById('preorder-enabled');
      if (el) el.checked = s.preorderEnabled !== false;
    }
  } catch(e) { console.warn('loadPreorderSetting: โหลด setting สั่งล่วงหน้าไม่ได้ (ใช้ค่า default):', e.code || e.message); }
}

// ====== STATS / DASHBOARD ======

let _statsPeriod = 'today'; // today | week | month | year

window.setStatsPeriod = function(p) {
  _statsPeriod = p;
  ['today','week','month','year'].forEach(id => {
    const btn = document.getElementById('period-' + id);
    if (!btn) return;
    const active = id === p;
    btn.style.background = active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.15)';
    btn.style.color = active ? '#1A237E' : 'rgba(255,255,255,0.7)';
  });
  const yearSel = document.getElementById('revenue-year-select');
  if (yearSel) yearSel.style.display = p === 'year' ? 'block' : 'none';
  renderStats();
};

function getPeriodRange(p) {
  const now = new Date();
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (p === 'today') {
    const s = startOf(now);
    return { start: s, end: now, prevStart: new Date(s - 86400000), prevEnd: s, label: 'รายชั่วโมง', buckets: 'hour' };
  }
  if (p === 'week') {
    const s = new Date(now - 6 * 86400000); s.setHours(0,0,0,0);
    const ps = new Date(s - 7 * 86400000);
    return { start: s, end: now, prevStart: ps, prevEnd: s, label: '7 วันล่าสุด', buckets: 'day' };
  }
  if (p === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    const ps = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const pe = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: s, end: now, prevStart: ps, prevEnd: pe, label: 'เดือนนี้', buckets: 'day' };
  }
  // year
  const selYear = parseInt(document.getElementById('revenue-year-select')?.value) || now.getFullYear();
  const s = new Date(selYear, 0, 1);
  const e = selYear === now.getFullYear() ? now : new Date(selYear, 11, 31, 23, 59, 59);
  const ps = new Date(selYear - 1, 0, 1);
  const pe = new Date(selYear - 1, 11, 31, 23, 59, 59);
  return { start: s, end: e, prevStart: ps, prevEnd: pe, label: 'ปี ' + selYear, buckets: 'month' };
}

function filterOrders(start, end) {
  return allOrders.filter(o => {
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
    return d && d >= start && d <= end;
  });
}

function vsArrow(cur, prev) {
  if (!prev) return '';
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return '<span style="color:#999">เท่าเดิม</span>';
  const up = pct > 0;
  return `<span style="color:${up?'#4CAF50':'#EF5350'}">${up?'▲':'▼'} ${Math.abs(pct)}% vs ช่วงก่อน</span>`;
}

function renderKPIs(orders, prevOrders) {
  const revenue = orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.total||0),0);
  const prevRevenue = prevOrders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+(o.total||0),0);
  const count = orders.filter(o=>o.status!=='cancelled').length;
  const prevCount = prevOrders.filter(o=>o.status!=='cancelled').length;
  const avg = count ? Math.round(revenue / count) : 0;
  const customers = new Set(orders.filter(o=>o.status!=='cancelled').map(o=>o.customerPhone||o.userId)).size;

  document.getElementById('kpi-revenue').textContent = revenue.toLocaleString() + '฿';
  document.getElementById('kpi-revenue-vs').innerHTML = vsArrow(revenue, prevRevenue);
  document.getElementById('kpi-orders').textContent = count + ' ออเดอร์';
  document.getElementById('kpi-orders-vs').innerHTML = vsArrow(count, prevCount);
  document.getElementById('kpi-avg').textContent = avg.toLocaleString() + '฿';
  document.getElementById('kpi-avg-sub').textContent = 'บาทต่อออเดอร์';
  document.getElementById('kpi-customers').textContent = customers + ' คน';
  document.getElementById('kpi-customers-sub').textContent = 'คนที่สั่งในช่วงนี้';
}

function renderTrendChart(orders, range) {
  const el = document.getElementById('monthly-revenue-chart');
  if (!el) return;
  const MONTH_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const DAY_TH   = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];

  let buckets = [];
  const completed = orders.filter(o=>o.status!=='cancelled');

  if (range.buckets === 'hour') {
    // Today: 0–23
    buckets = Array.from({length:24}, (_,i) => ({ label: i+'น.', revenue:0, orders:0 }));
    completed.forEach(o => {
      const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
      buckets[d.getHours()].revenue += o.total||0;
      buckets[d.getHours()].orders += 1;
    });
    // Only show 6am–current hour
    const now = new Date();
    const curH = now.getHours();
    buckets = buckets.slice(6, Math.max(curH+1, 12));
  } else if (range.buckets === 'day') {
    // Build day buckets from range.start
    const days = Math.ceil((range.end - range.start) / 86400000) + 1;
    buckets = Array.from({length: Math.min(days,31)}, (_,i) => {
      const d = new Date(range.start); d.setDate(d.getDate() + i);
      return { label: `${d.getDate()}/${d.getMonth()+1}`, revenue:0, orders:0, dateKey: d.toDateString() };
    });
    completed.forEach(o => {
      const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
      const b = buckets.find(x => x.dateKey === d.toDateString());
      if (b) { b.revenue += o.total||0; b.orders += 1; }
    });
  } else {
    // month buckets for year
    buckets = Array.from({length:12}, (_,i) => ({ label: MONTH_TH[i], revenue:0, orders:0, month:i }));
    completed.forEach(o => {
      const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
      buckets[d.getMonth()].revenue += o.total||0;
      buckets[d.getMonth()].orders += 1;
    });
  }

  const maxRev = Math.max(...buckets.map(b=>b.revenue), 1);
  const now = new Date();

  el.innerHTML = `<div style="overflow-x:auto;padding-bottom:4px">` +
    buckets.map((b) => {
      const pct = Math.round(b.revenue / maxRev * 100);
      const isToday = range.buckets === 'day' && b.dateKey === now.toDateString();
      const isNowH  = range.buckets === 'hour' && parseInt(b.label) === now.getHours();
      const highlight = isToday || isNowH;
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
        <div style="font-size:10px;font-weight:700;width:38px;color:${highlight?'var(--orange)':'var(--text-sub)'};flex-shrink:0;text-align:right">${b.label}</div>
        <div style="flex:1;background:#F0E8D8;border-radius:6px;height:22px;overflow:hidden;position:relative;min-width:120px">
          <div style="width:${pct}%;height:100%;background:${highlight?'linear-gradient(90deg,#FF8C00,#FFC107)':'linear-gradient(90deg,#FFC107,#FFD54F)'};border-radius:6px;transition:width 0.5s ease;display:flex;align-items:center;padding-left:6px;min-width:${b.revenue>0?'36px':'0'}">
            ${b.revenue > 0 ? `<span style="font-size:10px;font-weight:700;color:#3E2000;white-space:nowrap">${b.revenue.toLocaleString()}฿</span>` : ''}
          </div>
          ${b.revenue===0?'<span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:10px;color:#ccc">-</span>':''}
        </div>
        <div style="font-size:10px;color:var(--text-sub);width:28px;text-align:right;flex-shrink:0">${b.orders>0?b.orders+'x':''}</div>
      </div>`;
    }).join('') + '</div>';

  const sub = document.getElementById('trend-subtitle');
  if (sub) sub.textContent = range.label;
}

function renderStatusBreakdown(orders) {
  const el = document.getElementById('stats-status-breakdown');
  if (!el) return;
  const cfg = {
    pending:   { label:'รอรับ',    emoji:'🟡', bg:'#FFF8E1', color:'#F57F17' },
    preparing: { label:'กำลังทำ', emoji:'🔵', bg:'#E3F2FD', color:'#1565C0' },
    ready:     { label:'พร้อมรับ', emoji:'🟢', bg:'#E8F5E9', color:'#2E7D32' },
    done:      { label:'สำเร็จ',   emoji:'✅', bg:'#F3E5F5', color:'#6A1B9A' },
    cancelled: { label:'ยกเลิก',  emoji:'❌', bg:'#FFEBEE', color:'#B71C1C' },
  };
  const counts = {};
  orders.forEach(o => { counts[o.status||'pending'] = (counts[o.status||'pending']||0) + 1; });
  el.innerHTML = Object.entries(cfg).map(([s,c]) =>
    `<div style="background:${c.bg};border-radius:16px;padding:12px;text-align:center">
      <div style="font-size:20px">${c.emoji}</div>
      <div style="font-size:18px;font-weight:800;color:${c.color};margin-top:4px">${counts[s]||0}</div>
      <div style="font-size:10px;font-weight:700;color:${c.color};opacity:0.7;margin-top:2px">${c.label}</div>
    </div>`
  ).join('');
}

function renderTopMenu(orders) {
  const el = document.getElementById('stats-chart');
  if (!el) return;
  const itemCount = {};
  orders.filter(o=>o.status!=='cancelled').forEach(o => {
    (o.items||[]).forEach(i => { itemCount[i.name] = (itemCount[i.name]||0) + (i.qty||1); });
  });
  const sorted = Object.entries(itemCount).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxVal = sorted[0]?.[1] || 1;
  el.innerHTML = sorted.map(([name,count],i) => {
    const colors = ['#FF8C00','#FFC107','#4CAF50','#2196F3','#9C27B0','#FF5722'];
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <div style="font-size:11px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%">${name}</div>
        <div style="font-size:11px;font-weight:800;color:${colors[i]}">${count}x</div>
      </div>
      <div style="background:#F0E8D8;border-radius:6px;height:8px;overflow:hidden">
        <div style="width:${Math.round(count/maxVal*100)}%;height:100%;background:${colors[i]};border-radius:6px;transition:width 0.5s ease"></div>
      </div>
    </div>`;
  }).join('') || '<p style="color:var(--text-sub);font-size:12px">ยังไม่มีข้อมูล</p>';
}

function renderPeakHours(orders) {
  const el = document.getElementById('stats-time');
  if (!el) return;
  const hourCount = Array(24).fill(0);
  orders.filter(o=>o.status!=='cancelled').forEach(o => {
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
    if (d) hourCount[d.getHours()]++;
  });
  // Show hours with orders only, or 6am-9pm
  const relevant = hourCount.map((c,h)=>({h,c})).filter(x => x.c > 0 || (x.h >= 6 && x.h <= 21));
  const maxC = Math.max(...relevant.map(x=>x.c), 1);
  el.innerHTML = relevant.map(({h,c}) => {
    const pct = Math.round(c / maxC * 100);
    const label = h + ':00';
    return `<div style="margin-bottom:7px">
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <div style="font-size:10px;font-weight:700;color:var(--text-sub)">${label}</div>
        <div style="font-size:10px;font-weight:700;color:var(--orange)">${c > 0 ? c+'x' : ''}</div>
      </div>
      <div style="background:#F0E8D8;border-radius:4px;height:7px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#FF8C00,#FFC107);border-radius:4px;transition:width 0.5s ease"></div>
      </div>
    </div>`;
  }).join('') || '<p style="color:var(--text-sub);font-size:12px">ยังไม่มีข้อมูล</p>';
}

function renderRatings() {
  const el = document.getElementById('stats-ratings');
  if (!el) return;
  // Use cached allRatings if available
  const ratings = window.allRatings || [];
  if (!ratings.length) {
    el.innerHTML = '<p style="color:var(--text-sub);font-size:12px">ยังไม่มีรีวิว</p>';
    return;
  }
  const rMap = {};
  ratings.forEach(r => {
    if (!rMap[r.itemName]) rMap[r.itemName] = { sum:0, count:0 };
    rMap[r.itemName].sum += r.rating||0;
    rMap[r.itemName].count++;
  });
  const sorted = Object.entries(rMap).map(([name,d]) => ({ name, avg: d.sum/d.count, count: d.count }))
    .sort((a,b) => b.avg - a.avg).slice(0,8);
  const stars = (n) => '⭐'.repeat(Math.round(n));
  el.innerHTML = sorted.map(({name,avg,count}) =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px;background:#FAFAF8;border-radius:12px">
      <div style="flex:1;font-size:12px;font-weight:700">${name}</div>
      <div style="font-size:11px;color:#F57F17;font-weight:800">${avg.toFixed(1)} ★</div>
      <div style="font-size:10px;color:#bbb">(${count})</div>
    </div>`
  ).join('');
}

function initRevenueYearSelect() {
  const sel = document.getElementById('revenue-year-select');
  if (!sel) return;
  const thisYear = new Date().getFullYear();
  const years = new Set([thisYear]);
  allOrders.forEach(o => {
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
    if (d) years.add(d.getFullYear());
  });
  sel.innerHTML = [...years].sort((a,b)=>b-a).map(y=>
    `<option value="${y}"${y===thisYear?' selected':''}>${y}</option>`
  ).join('');
}

function renderStats() {
  initRevenueYearSelect();
  const range = getPeriodRange(_statsPeriod);
  const orders = filterOrders(range.start, range.end);
  const prevOrders = filterOrders(range.prevStart, range.prevEnd);
  renderKPIs(orders, prevOrders);
  renderTrendChart(orders, range);
  renderTopMenu(orders);
  renderPeakHours(orders);
  renderStatusBreakdown(orders);
  renderRatings();
}

// ====== EXPORT CSV ======
window.exportOrdersCSV = function() {
  const range = getPeriodRange(_statsPeriod);
  const orders = filterOrders(range.start, range.end);
  if (!orders.length) { showToast('ไม่มีข้อมูลในช่วงนี้'); return; }
  const rows = [['วันที่','เบอร์ลูกค้า','ชื่อ','รายการ','ยอดรวม','สถานะ']];
  orders.forEach(o => {
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt||0);
    const dateStr = d.toLocaleDateString('th-TH') + ' ' + d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    const items = (o.items||[]).map(i=>`${i.name}x${i.qty||1}`).join(', ');
    rows.push([dateStr, o.customerPhone||o.userId||'-', o.customerName||'-', items, o.total||0, o.status||'-']);
  });
  downloadCSV(rows, 'orders_export.csv');
  showToast('📥 Export ออเดอร์แล้ว (' + orders.length + ' รายการ)');
};

window.exportRevenueCSV = function() {
  const MONTH_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const thisYear = new Date().getFullYear();
  const months = Array.from({length:12}, (_,i)=>({ month: MONTH_TH[i], revenue:0, orders:0 }));
  allOrders.filter(o=>o.status!=='cancelled').forEach(o => {
    const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt||0);
    if (d.getFullYear()!==thisYear) return;
    months[d.getMonth()].revenue += o.total||0;
    months[d.getMonth()].orders++;
  });
  const rows = [['เดือน','รายได้ (บาท)','จำนวนออเดอร์','เฉลี่ย/ออเดอร์']];
  months.forEach(m => {
    const avg = m.orders ? Math.round(m.revenue/m.orders) : 0;
    rows.push([m.month, m.revenue, m.orders, avg]);
  });
  downloadCSV(rows, 'revenue_' + thisYear + '.csv');
  showToast('📥 Export รายได้รายเดือนแล้ว');
};

function downloadCSV(rows, filename) {
  const bom = '\uFEFF'; // UTF-8 BOM for Excel Thai
  const csv = bom + rows.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ====== FEATURED ITEMS PIN ======

function renderFeaturedCheckboxes() {
  const wrap = document.getElementById('featured-checkboxes');
  if (!wrap || !allMenuItems.length) return;
  wrap.innerHTML = allMenuItems.filter(i => !i.hidden).map(item => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px;background:#fff;border-radius:10px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
      <input type="checkbox" value="${item.id}" style="width:18px;height:18px;accent-color:var(--yellow)"
        ${currentFeaturedIds.includes(item.id) ? 'checked' : ''}>
      <span style="font-size:14px">${item.emoji||'🍽️'} ${item.name}</span>
      <span style="margin-left:auto;font-size:12px;color:var(--text-sub)">${item.price} บาท</span>
    </label>`).join('');
}

window.saveFeaturedItems = async function() {
  const checks = document.querySelectorAll('#featured-checkboxes input[type=checkbox]:checked');
  const ids = Array.from(checks).map(c => c.value);
  if (ids.length > 5) { showToast('เลือกได้สูงสุด 5 เมนู'); return; }
  showLoading(true);
  try {
    await setDoc(doc(db, 'settings', 'store'), { featuredIds: ids }, { merge: true });
    currentFeaturedIds = ids;
    showToast('บันทึกเมนูแนะนำแล้ว ✓ ('+ids.length+' เมนู)');
  } catch(e) { console.error(e); showToast('❌ ' + (e.code||e.message||'เกิดข้อผิดพลาด')); }
  finally { showLoading(false); }
};

// ====== PREORDER SETTING ======
window.savePreorderSetting = async function() {
  const enabled = document.getElementById('preorder-enabled').checked;
  showLoading(true);
  try {
    await setDoc(doc(db, 'settings', 'store'), { preorderEnabled: enabled }, { merge: true });
    showToast(enabled ? '📅 เปิด Pre-order แล้ว' : '❌ ปิด Pre-order แล้ว');
  } catch(e) { console.error(e); showToast('❌ ' + (e.code||e.message||'เกิดข้อผิดพลาด')); }
  finally { showLoading(false); }
};

window.closeModal = function(id) {
  document.getElementById(id).classList.remove('show');
};
// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });
});

// ====== MENU ITEM CRUD ======
window._openAddItem = function() {
  document.getElementById('modal-edit-title').textContent = 'เพิ่มเมนูใหม่';
  document.getElementById('edit-item-id').value = '';
  document.getElementById('edit-name').value = '';
  document.getElementById('edit-desc').value = '';
  document.getElementById('edit-price').value = '';
  document.getElementById('edit-emoji').value = '';
  document.getElementById('edit-image-url').value = '';
  const prev = document.getElementById('edit-img-preview');
  if (prev) prev.style.display = 'none';
  document.getElementById('modal-edit').classList.add('show');
};

window._openEditItem = function(id) {
  const item = allMenuItems.find(i => i.id === id);
  if (!item) return;
  document.getElementById('modal-edit-title').textContent = 'แก้ไขเมนู';
  document.getElementById('edit-item-id').value = item.id;
  document.getElementById('edit-name').value = item.name || '';
  document.getElementById('edit-desc').value = item.desc || '';
  document.getElementById('edit-price').value = item.price || '';
  document.getElementById('edit-emoji').value = item.emoji || '';
  document.getElementById('edit-image-url').value = item.imageUrl || '';
  const catSel = document.getElementById('edit-catkey');
  if (catSel) catSel.value = item.catKey || 'other';
  const prev = document.getElementById('edit-img-preview');
  if (prev) { prev.src = item.imageUrl || ''; prev.style.display = item.imageUrl ? 'block' : 'none'; }
  document.getElementById('modal-edit').classList.add('show');
};

window._saveMenuItem = async function() {
  const id = document.getElementById('edit-item-id').value.trim();
  const name = document.getElementById('edit-name').value.trim();
  const price = parseFloat(document.getElementById('edit-price').value) || 0;
  const catKey = document.getElementById('edit-catkey')?.value || 'other';
  if (!name) { showToast('❌ กรุณาใส่ชื่อเมนู'); return; }
  const catMap = { sandwich:'🥪 แซนวิช', rice:'🍚 ข้าว', noodle:'🍜 หมี่', drink:'🥤 เครื่องดื่ม', other:'🍽️ อื่นๆ' };
  const allCats = allCategories.length ? allCategories : [];
  const catObj = allCats.find(c => c.key === catKey);
  const data = {
    name, price,
    desc: document.getElementById('edit-desc').value.trim(),
    emoji: document.getElementById('edit-emoji').value.trim() || '🍽️',
    imageUrl: document.getElementById('edit-image-url').value.trim() || '',
    catKey,
    category: catObj ? (catObj.emoji||'') + ' ' + catObj.name : (catMap[catKey] || catKey),
    sortOrder: catObj?.sortOrder || 0,
  };
  showLoading(true);
  try {
    const docId = id || name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'') + '_' + Date.now();
    await setDoc(doc(db, 'menu', docId), data, { merge: true });
    showToast(id ? '✅ แก้ไขเมนูแล้ว' : '✅ เพิ่มเมนูแล้ว');
    document.getElementById('modal-edit').classList.remove('show');
    await loadMenu();
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

window.previewEditImg = function() {
  const url = document.getElementById('edit-image-url').value.trim();
  const prev = document.getElementById('edit-img-preview');
  if (prev) { prev.src = url; prev.style.display = url ? 'block' : 'none'; }
};

window.uploadItemPhoto = async function(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('edit-image-url').value = e.target.result;
    window.previewEditImg();
  };
  reader.readAsDataURL(file);
};

window.openImageModal = function(id) {
  const item = allMenuItems.find(i => i.id === id);
  if (!item) return;
  document.getElementById('img-item-id').value = id;
  const prev = document.getElementById('img-modal-preview');
  if (prev) { prev.src = item.imageUrl || ''; prev.style.display = item.imageUrl ? 'block' : 'none'; }
  document.getElementById('modal-image').classList.add('show');
};

window.saveItemImage = async function() {
  const id = document.getElementById('img-item-id')?.value;
  const url = document.getElementById('img-url-input')?.value?.trim();
  if (!id) return;
  showLoading(true);
  try {
    await setDoc(doc(db, 'menu', id), { imageUrl: url || '' }, { merge: true });
    showToast('✅ บันทึกรูปแล้ว');
    document.getElementById('modal-image').classList.remove('show');
    await loadMenu();
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

window.toggleHide = async function(id, hidden) {
  const hide = hidden === 'true' || hidden === true;
  try {
    await setDoc(doc(db, 'menu', id), { hidden: hide }, { merge: true });
    const item = allMenuItems.find(i => i.id === id);
    if (item) item.hidden = hide;
    renderMenuAdmin();
    showToast(hide ? '🙈 ซ่อนเมนูแล้ว' : '👁️ แสดงเมนูแล้ว');
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
};

window.toggleSoldOut = async function(id, soldOut) {
  try {
    await setDoc(doc(db, 'menu', id), { soldOut: !!soldOut }, { merge: true });
    const item = allMenuItems.find(i => i.id === id);
    if (item) item.soldOut = !!soldOut;
    renderMenuAdmin();
    showToast(soldOut ? '⛔ ทำเครื่องหมายว่าหมด' : '✅ มีสินค้าแล้ว');
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
};

// ====== CUSTOMER CRUD ======
let _allCustomers = [];

async function loadCustomers() {
  try {
    // ดึง 3 collections พร้อมกัน — stamps อยู่แยก collection (key = phone)
    const [custSnap, lineSnap, stampsSnap] = await Promise.all([
      getDocs(collection(db, 'customers')),
      getDocs(collection(db, 'lineUsers')),
      getDocs(collection(db, 'stamps')),
    ]);

    // สร้าง map: phone → points จาก stamps collection
    const stampsMap = {};
    stampsSnap.docs.forEach(d => {
      const data = d.data();
      const phone = d.id; // stamps/{phone}
      stampsMap[phone] = data.points || 0;
    });

    const custList = custSnap.docs.map(d => {
      const data = d.data();
      const phone = data.phone || '';
      return {
        id: d.id, _col: 'customers', ...data,
        // join points จาก stamps collection (ไม่ใช่จาก customers doc)
        points: stampsMap[phone] ?? data.points ?? 0,
      };
    });

    const lineList = lineSnap.docs.map(d => {
      const data = d.data();
      const phone = data.phone || '';
      return {
        id: d.id, _col: 'lineUsers', source: 'line',
        userId: data.userId || d.id,
        name: data.displayName || data.name || '-',
        phone,
        photoUrl: data.pictureUrl || data.photoUrl || '',
        // join points จาก stamps collection
        points: stampsMap[phone] ?? data.points ?? 0,
        lastOrderAt: data.updatedAt || null,
        ...data,
        // override points ด้วยค่าจาก stampsMap (สำคัญ: ต้องหลัง ...data)
        points: stampsMap[phone] ?? data.points ?? 0,
      };
    });

    const phoneSet = new Set(custList.map(c => c.phone).filter(Boolean));
    const filteredLine = lineList.filter(l => !l.phone || !phoneSet.has(l.phone));
    _allCustomers = [...custList, ...filteredLine];
    renderCustomers();
  } catch(e) { console.warn('loadCustomers:', e.message); }
}

function renderCustomers() {
  const container = document.getElementById('customers-list');
  if (!container) return;
  const tab = (typeof _custTab !== 'undefined') ? _custTab : 'line';
  const searchVal = (document.getElementById('cust-search')?.value||'').toLowerCase();
  let list = tab === 'line'
    ? _allCustomers.filter(c => c.source === 'line' || c.userId)
    : _allCustomers;
  if (searchVal) list = list.filter(c => (c.name||'').toLowerCase().includes(searchVal) || (c.phone||'').includes(searchVal) || (c.userId||'').toLowerCase().includes(searchVal));
  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">👥</div><p>${tab==='line'?'ยังไม่มีลูกค้า LINE':'ยังไม่มีลูกค้าในระบบ'}</p></div>`;
    return;
  }
  container.innerHTML = list.map(c => `
    <div class="customer-card">
      <div class="customer-avatar">${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="">` : (c.name||'?')[0].toUpperCase()}</div>
      <div class="customer-info">
        <div class="customer-name">${esc(c.name||'-')}</div>
        <div class="customer-meta">📞 ${esc(c.phone||'-')}</div>
        ${c.address ? `<div class="customer-address">📍 ${esc(c.address)}</div>` : ''}
      </div>
      <div class="customer-points"><span class="pts-val">${c.points||0}</span><span class="pts-label">แต้ม</span></div>
      <div class="customer-actions">
        <button class="icon-btn btn-edit" onclick="editCustomer('${esc(c.id)}')">✏️</button>
        <button class="icon-btn" style="background:#FFEBEE" onclick="deleteCustomer('${esc(c.id)}')">🗑️</button>
      </div>
    </div>`).join('');
}

window._openAddCustomer = function() {
  document.getElementById('modal-customer-title').textContent = 'เพิ่มลูกค้า';
  document.getElementById('cust-edit-id').value = '';
  document.getElementById('cust-name').value = '';
  document.getElementById('cust-userid').value = '';
  document.getElementById('cust-phone').value = '';
  document.getElementById('cust-address').value = '';
  document.getElementById('cust-points').value = '0';
  document.getElementById('cust-note').value = '';
  document.getElementById('modal-customer').classList.add('show');
};

window.editCustomer = function(id) {
  const c = _allCustomers.find(x => x.id === id);
  if (!c) return;
  document.getElementById('modal-customer-title').textContent = 'แก้ไขลูกค้า';
  document.getElementById('cust-edit-id').value = c.id;
  document.getElementById('cust-name').value = c.name || '';
  document.getElementById('cust-userid').value = c.userId || '';
  document.getElementById('cust-phone').value = c.phone || '';
  document.getElementById('cust-address').value = c.address || '';
  document.getElementById('cust-points').value = c.points || 0;
  document.getElementById('cust-note').value = c.note || '';
  document.getElementById('modal-customer').classList.add('show');
};

window.deleteCustomer = async function(id) {
  const ok = await showConfirmDialog({ icon:'🗑️', iconBg:'#FFEBEE', iconBorder:'#FFCDD2', title:'ลบลูกค้านี้?', desc:'ข้อมูลลูกค้าจะถูกลบถาวร', confirmText:'ลบ', confirmColor:'linear-gradient(135deg,#E53935,#B71C1C)', confirmTextColor:'#fff' });
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'customers', id));
    _allCustomers = _allCustomers.filter(c => c.id !== id);
    renderCustomers();
    showToast('🗑️ ลบลูกค้าแล้ว');
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
};

window._saveCustomer = async function() {
  const id = document.getElementById('cust-edit-id').value.trim();
  const name = document.getElementById('cust-name').value.trim();
  const phone = document.getElementById('cust-phone').value.trim();
  if (!name) { showToast('❌ กรุณาใส่ชื่อลูกค้า'); return; }

  // ===== ตรวจ duplicate (เฉพาะ add ใหม่ หรือ edit แต่ไม่ใช่ตัวเอง) =====
  const others = _allCustomers.filter(c => c.id !== id);

  // ตรวจชื่อซ้ำ (case-insensitive)
  const dupName = others.find(c => (c.name||'').trim().toLowerCase() === name.toLowerCase());
  if (dupName) {
    showToast('❌ มีลูกค้าชื่อ "' + dupName.name + '" อยู่แล้ว');
    return;
  }

  // ตรวจเบอร์ซ้ำ (ถ้ากรอกเบอร์)
  if (phone) {
    const dupPhone = others.find(c => (c.phone||'').replace(/\D/g,'') === phone.replace(/\D/g,''));
    if (dupPhone) {
      showToast('❌ เบอร์ ' + phone + ' ใช้แล้ว (ลูกค้า: ' + dupPhone.name + ')');
      return;
    }
  }

  const data = {
    name,
    userId: document.getElementById('cust-userid').value.trim(),
    phone,
    address: document.getElementById('cust-address').value.trim(),
    points: parseInt(document.getElementById('cust-points').value)||0,
    note: document.getElementById('cust-note').value.trim(),
    source: id ? (_allCustomers.find(c=>c.id===id)?.source || 'manual') : 'manual',
    updatedAt: serverTimestamp(),
  };
  showLoading(true);
  try {
    const docId = id || 'cust_' + Date.now();
    await setDoc(doc(db, 'customers', docId), data, { merge: true });
    showToast(id ? '✅ แก้ไขข้อมูลลูกค้าแล้ว' : '✅ เพิ่มลูกค้าแล้ว');
    document.getElementById('modal-customer').classList.remove('show');
    await loadCustomers();
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

// ====== SETTINGS SAVES ======
window.saveSettings = async function() {
  showLoading(true);
  try {
    const data = {};
    const cutoff = document.getElementById('set-cutoff')?.value;
    const pickupStart = document.getElementById('set-pickup-start')?.value;
    const pickupEnd = document.getElementById('set-pickup-end')?.value;
    if (cutoff) data.orderCutoff = cutoff;
    if (pickupStart) data.pickupStart = pickupStart;
    if (pickupEnd) data.pickupEnd = pickupEnd;
    await setDoc(doc(db, 'settings', 'store'), data, { merge: true });
    showToast('✅ บันทึกการตั้งค่าแล้ว');
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

window.saveStoreName = async function() {
  const name = document.getElementById('set-store-name')?.value?.trim();
  const tagline = document.getElementById('set-store-tagline')?.value?.trim();
  const siteTitle = document.getElementById('set-site-title')?.value?.trim();
  showLoading(true);
  try {
    const data = {};
    if (name) data.storeName = name;
    if (tagline !== undefined) data.storeTagline = tagline;
    if (siteTitle) { data.siteTitle = siteTitle; document.title = siteTitle; }
    await setDoc(doc(db, 'settings', 'store'), data, { merge: true });
    const nameEl = document.getElementById('admin-brand-name');
    if (nameEl && name) nameEl.textContent = name;
    showToast('✅ บันทึกชื่อร้านแล้ว');
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

window.saveHeroLogo = async function() {
  const url = document.getElementById('set-hero-logo-url')?.value?.trim();
  showLoading(true);
  try {
    await setDoc(doc(db, 'settings', 'store'), { heroLogoUrl: url }, { merge: true });
    window._storeLogo = url;
    const logoImg = document.getElementById('hero-logo-preview-img');
    if (logoImg) { logoImg.src = url; logoImg.style.display = url ? 'block' : 'none'; }
    showToast('✅ บันทึกโลโก้แล้ว');
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

window.saveBanner = async function() {
  const url = document.getElementById('set-banner-url')?.value?.trim();
  showLoading(true);
  try {
    await setDoc(doc(db, 'settings', 'store'), { bannerUrl: url }, { merge: true });
    const img = document.getElementById('banner-preview-img');
    if (img) { img.src = url; img.style.display = url ? 'block' : 'none'; }
    showToast('✅ บันทึกรูป Hero แล้ว');
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

window.savePasswords = async function() {
  const adminPass = document.getElementById('set-admin-password')?.value?.trim();
  const ownerPass = document.getElementById('set-owner-password')?.value?.trim();
  if (!adminPass && !ownerPass) { showToast('❌ กรุณาใส่รหัสผ่าน'); return; }
  if (adminPass && adminPass.length < 6) { showToast('❌ รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
  if (ownerPass && ownerPass.length < 6) { showToast('❌ รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
  showLoading(true);
  try {
    // 🔐 FIX: เรียก Cloud Function แทนการเขียน plaintext ตรง
    // เดิม: setDoc(settings/store, { adminPassword: 'plaintext' }) — อันตราย
    // ใหม่: hashAndSavePassword callable → hash ด้วย bcrypt server-side
    const hashAndSavePassword = httpsCallable(functions, 'hashAndSavePassword');
    const payload = {};
    if (adminPass) payload.adminPassword = adminPass;
    if (ownerPass) payload.ownerPassword = ownerPass;
    await hashAndSavePassword(payload);
    showToast('✅ บันทึกรหัสผ่านแล้ว (เข้ารหัส bcrypt)');
    if(document.getElementById('set-admin-password')) document.getElementById('set-admin-password').value='';
    if(document.getElementById('set-owner-password')) document.getElementById('set-owner-password').value='';
  } catch(e) {
    const msg = e?.details?.message || e?.message || 'เกิดข้อผิดพลาด';
    showToast('❌ ' + msg);
  }
  finally { showLoading(false); }
};

// Preview helpers for settings inputs
window.previewHeroLogo = function() {
  const url = document.getElementById('set-hero-logo-url')?.value?.trim();
  const img = document.getElementById('hero-logo-preview-img');
  if (img) { img.src = url||''; img.style.display = url ? 'block' : 'none'; }
};

window.previewBanner = function() {
  const url = document.getElementById('set-banner-url')?.value?.trim();
  const img = document.getElementById('banner-preview-img');
  if (img) { img.src = url||''; img.style.display = url ? 'block' : 'none'; }
};

// ====== STAMP / LOYALTY ======
window.saveStampConfig = async function() {
  const goal = parseInt(document.getElementById('stamp-goal')?.value)||10;
  const pointsPerBaht = parseInt(document.getElementById('points-per-baht')?.value)||20;
  const expiryDays = parseInt(document.getElementById('points-expiry-days')?.value)||0;
  showLoading(true);
  try {
    await setDoc(doc(db, 'settings', 'stamps'), { goal, pointsPerBaht, expiryDays }, { merge: true });
    showToast('✅ บันทึกการตั้งค่าแต้มแล้ว');
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

window.lookupStamp = async function() {
  const phone = document.getElementById('stamp-phone-input')?.value?.trim();
  if (!phone) { showToast('❌ กรุณาใส่เบอร์โทร'); return; }
  showLoading(true);
  try {
    const d = await getDoc(doc(db, 'stamps', phone));
    const el = document.getElementById('stamp-result');
    if (el) el.textContent = d.exists() ? `แต้ม: ${d.data().points||0} | สะสม: ${d.data().totalSpent||0} บาท` : 'ไม่พบข้อมูล';
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

let _allRewards = [];
async function loadRewards() {
  try {
    const snap = await getDocs(collection(db, 'rewards'));
    _allRewards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRewardsAdmin();
  } catch(e) { console.warn('loadRewards:', e.message); }
}

function renderRewardsAdmin() {
  const el = document.getElementById('rewards-list');
  if (!el) return;
  if (!_allRewards.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:13px">ยังไม่มีรางวัล</div>'; return; }
  el.innerHTML = _allRewards.map(r => `
    <div class="customer-card" style="margin-bottom:10px">
      <div style="font-size:28px;flex-shrink:0">${esc(r.emoji||'🎁')}</div>
      <div class="customer-info">
        <div class="customer-name">${esc(r.name||'-')}</div>
        <div class="customer-meta">🏅 ${r.points||r.cost||0} แต้ม ${r.active===false?'❌ ปิด':'✅ เปิด'}</div>
      </div>
      <div class="customer-actions">
        <button class="icon-btn btn-edit" onclick="openEditReward('${esc(r.id)}')">✏️</button>
        <button class="icon-btn" style="background:#FFEBEE" onclick="deleteReward('${esc(r.id)}')">🗑️</button>
      </div>
    </div>`).join('');
}

window.openAddReward = function() {
  document.getElementById('modal-reward-title').textContent = 'เพิ่มรางวัล';
  document.getElementById('reward-edit-id').value = '';
  ['reward-name','reward-emoji','reward-desc','reward-cost'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = id==='reward-cost'?'100':'';
  });
  const actEl = document.getElementById('reward-active'); if(actEl) actEl.checked = true;
  document.getElementById('modal-reward').classList.add('show');
};

window.openEditReward = function(id) {
  const r = _allRewards.find(x => x.id === id);
  if (!r) return;
  document.getElementById('modal-reward-title').textContent = 'แก้ไขรางวัล';
  document.getElementById('reward-edit-id').value = r.id;
  const set = (eid, val) => { const el = document.getElementById(eid); if(el) el.value = val||''; };
  set('reward-name', r.name); set('reward-emoji', r.emoji); set('reward-desc', r.desc); set('reward-cost', r.points||r.cost||100);
  const actEl = document.getElementById('reward-active'); if(actEl) actEl.checked = r.active !== false;
  document.getElementById('modal-reward').classList.add('show');
};

window.saveReward = async function() {
  const id = document.getElementById('reward-edit-id').value.trim();
  const name = document.getElementById('reward-name')?.value?.trim();
  if (!name) { showToast('❌ กรุณาใส่ชื่อรางวัล'); return; }
  const data = {
    name,
    emoji: document.getElementById('reward-emoji')?.value?.trim() || '🎁',
    desc: document.getElementById('reward-desc')?.value?.trim() || '',
    points: parseInt(document.getElementById('reward-cost')?.value)||100,
    cost: parseInt(document.getElementById('reward-cost')?.value)||100,
    active: document.getElementById('reward-active')?.checked !== false,
  };
  showLoading(true);
  try {
    const docId = id || 'reward_' + Date.now();
    await setDoc(doc(db, 'rewards', docId), data, { merge: true });
    showToast(id ? '✅ แก้ไขรางวัลแล้ว' : '✅ เพิ่มรางวัลแล้ว');
    document.getElementById('modal-reward').classList.remove('show');
    await loadRewards();
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

window.deleteReward = async function(id) {
  const ok = await showConfirmDialog({ icon:'🗑️', iconBg:'#FFEBEE', iconBorder:'#FFCDD2', title:'ลบรางวัลนี้?', desc:'รางวัลจะถูกลบถาวร', confirmText:'ลบ', confirmColor:'linear-gradient(135deg,#E53935,#B71C1C)', confirmTextColor:'#fff' });
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'rewards', id));
    _allRewards = _allRewards.filter(r => r.id !== id);
    renderRewardsAdmin();
    showToast('🗑️ ลบรางวัลแล้ว');
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
};

window.saveTierConfig = async function() {
  const els = document.querySelectorAll('[id^="tier-"][id$="-min"]');
  const tiers = [];
  els.forEach(el => {
    const key = el.id.replace('-min','').replace('tier-','');
    const nameEl = document.getElementById(`tier-${key}-name`);
    const minEl = document.getElementById(`tier-${key}-min`);
    const maxEl = document.getElementById(`tier-${key}-max`);
    if (nameEl && minEl) tiers.push({ key, name: nameEl.value, min: parseInt(minEl.value)||0, max: parseInt(maxEl?.value)||9999999 });
  });
  showLoading(true);
  try {
    await setDoc(doc(db, 'settings', 'tiers'), { tiers }, { merge: true });
    showToast('✅ บันทึก Tier Config แล้ว');
  } catch(e) { showToast('❌ ' + (e.code||e.message)); }
  finally { showLoading(false); }
};

// ====== LOAD CUSTOMERS ON PANEL SWITCH ======
// loadCustomers/loadRewards are called in the init sequence above
// loadPickupLocations is defined in a later plain <script> — defer to let it load
setTimeout(() => { if (typeof window.loadPickupLocations === 'function') window.loadPickupLocations(); }, 0);
// (no extra loadAll needed)

function showLoading(v) {
  const el = document.getElementById('loading');
  el.classList.toggle('show', v);
  // Safety: auto-hide after 10s to prevent stuck overlay
  if (v) {
    clearTimeout(window._loadingTimer);
    window._loadingTimer = setTimeout(() => el.classList.remove('show'), 10000);
  } else {
    clearTimeout(window._loadingTimer);
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
window.showToast = showToast;
window.renderCustomers = renderCustomers;

// ====== DANGER ZONE FUNCTIONS ======
// ====== GENERAL CONFIRM DIALOG ======
var _confirmDialogResolve = null;
window._confirmDialogResolve = function(val) {
  closeConfirmDialog();
  if (_confirmDialogResolve) _confirmDialogResolve(val);
};
window.closeConfirmDialog = function() {
  document.getElementById('confirm-dialog-overlay').classList.remove('show');
};
function showConfirmDialog(opts) {
  return new Promise(function(resolve) {
    _confirmDialogResolve = resolve;
    var iconWrap = document.getElementById('cd-icon-wrap');
    iconWrap.style.background = opts.iconBg || '#FFF3E0';
    iconWrap.style.border = '2px solid ' + (opts.iconBorder || '#FFE0B2');
    document.getElementById('cd-icon').textContent = opts.icon || '❓';
    document.getElementById('cd-title').textContent = opts.title || 'ยืนยัน';
    document.getElementById('cd-desc').innerHTML = (opts.desc || '').replace(/\n/g,'<br>');
    var btn = document.getElementById('cd-confirm-btn');
    btn.style.background = opts.confirmColor || 'linear-gradient(135deg,#E53935,#B71C1C)';
    btn.style.color = opts.confirmTextColor || '#fff';
    btn.textContent = opts.confirmText || 'ยืนยัน';
    document.getElementById('confirm-dialog-overlay').classList.add('show');
  });
}

// ====== DANGER DIALOG SYSTEM ======
var _dangerAction = null;
var _dangerKeyword = null;

var DANGER_CONFIG = {
  rating: {
    icon: '⭐', iconBg: '#FFF8E1', iconBorder: '#FFE082',
    title: 'ล้าง Rating ทั้งหมด',
    desc: 'คะแนนรีวิวเมนูทุกรายการจะถูกลบถาวร',
    confirmColor: 'linear-gradient(135deg,#F9A825,#F57F17)',
    confirmText: 'ล้างคะแนน', confirmTextColor: '#1A0A00', requireTyping: false
  },
  completed: {
    icon: '🧹', iconBg: '#FFF3CD', iconBorder: '#FFE082',
    title: 'ลบออเดอร์ที่เสร็จแล้ว',
    desc: 'สถานะ "รับแล้ว" และ "ยกเลิก" จะถูกลบออกจากระบบ\nการกระทำนี้<strong>ไม่สามารถย้อนกลับได้</strong>',
    confirmColor: 'linear-gradient(135deg,#F9A825,#F57F17)',
    confirmText: 'ลบออเดอร์เก่า',
    confirmTextColor: '#1A0A00',
    requireTyping: false
  },
  all: {
    icon: '🔥', iconBg: '#FFEBEE', iconBorder: '#FFCDD2',
    title: 'ลบออเดอร์ทั้งหมด',
    desc: 'ออเดอร์ทุกรายการในระบบจะถูกลบถาวร\nพิมพ์ <strong>"ลบทั้งหมด"</strong> เพื่อยืนยัน',
    confirmColor: 'linear-gradient(135deg,#E53935,#B71C1C)',
    confirmText: 'ลบทั้งหมด',
    confirmTextColor: '#fff',
    requireTyping: true,
    keyword: 'ลบทั้งหมด',
    inputLabel: 'พิมพ์ "ลบทั้งหมด" เพื่อยืนยัน',
    placeholder: 'ลบทั้งหมด'
  },
  reset: {
    icon: '💣', iconBg: '#F3E5F5', iconBorder: '#E1BEE7',
    title: 'รีเซ็ตข้อมูลทั้งระบบ',
    desc: 'ออเดอร์ + แต้มสะสมทุกรายการจะถูกลบถาวร\nพิมพ์ <strong>"รีเซ็ตระบบ"</strong> เพื่อยืนยัน',
    confirmColor: 'linear-gradient(135deg,#7B1FA2,#4A148C)',
    confirmText: 'รีเซ็ตระบบ',
    confirmTextColor: '#fff',
    requireTyping: true,
    keyword: 'รีเซ็ตระบบ',
    inputLabel: 'พิมพ์ "รีเซ็ตระบบ" เพื่อยืนยัน',
    placeholder: 'รีเซ็ตระบบ'
  }
};

window.openDangerDialog = function(type) {
  var cfg = DANGER_CONFIG[type];
  if (!cfg) return;
  _dangerAction = type;
  _dangerKeyword = cfg.keyword || null;

  var iconWrap = document.getElementById('dd-icon-wrap');
  iconWrap.style.background = cfg.iconBg;
  iconWrap.style.border = '2px solid ' + cfg.iconBorder;
  document.getElementById('dd-icon').textContent = cfg.icon;
  document.getElementById('dd-title').textContent = cfg.title;
  document.getElementById('dd-desc').innerHTML = cfg.desc.replace(/\n/g,'<br>');

  var confirmBtn = document.getElementById('dd-confirm-btn');
  confirmBtn.style.background = cfg.confirmColor;
  confirmBtn.style.color = cfg.confirmTextColor;
  confirmBtn.textContent = cfg.confirmText;

  var inputWrap = document.getElementById('dd-input-wrap');
  var inputEl = document.getElementById('dd-input');
  if (cfg.requireTyping) {
    inputWrap.style.display = 'block';
    document.getElementById('dd-input-label').textContent = cfg.inputLabel;
    inputEl.placeholder = cfg.placeholder;
    inputEl.value = '';
    inputEl.className = 'dd-input';
    confirmBtn.disabled = true;
    inputEl.oninput = function() {
      var matched = inputEl.value === _dangerKeyword;
      confirmBtn.disabled = !matched;
      inputEl.className = 'dd-input' + (inputEl.value.length > 0 ? (matched ? ' matched' : '') : '');
    };
  } else {
    inputWrap.style.display = 'none';
    confirmBtn.disabled = false;
  }

  document.getElementById('danger-dialog-overlay').classList.add('show');
  if (cfg.requireTyping) setTimeout(function(){ inputEl.focus(); }, 350);
};

window.closeDangerDialog = function() {
  document.getElementById('danger-dialog-overlay').classList.remove('show');
  _dangerAction = null;
};

window.confirmDangerAction = async function() {
  var action = _dangerAction;
  closeDangerDialog();
  if (action === 'rating') await resetAllRatings();
  else if (action === 'completed') await deleteCompletedOrders();
  else if (action === 'all') await deleteAllOrders();
  else if (action === 'reset') await resetAllData();
};

window.deleteCompletedOrders = async function() {
  showLoading(true);
  try {
    const snap = await getDocs(collection(db,'orders'));
    const toDelete = snap.docs.filter(d=>['done','cancelled'].includes(d.data().status));
    if(toDelete.length===0){ showLoading(false); showToast('ไม่มีออเดอร์ที่เสร็จแล้ว'); return; }
    const batch = [];
    for(const d of toDelete){ batch.push(deleteDoc(doc(db,'orders',d.id))); }
    await Promise.all(batch);
    showToast(`🗑️ ลบแล้ว ${toDelete.length} ออเดอร์`);
    setTimeout(()=>location.reload(), 1500);
  } catch(e) {
    console.error(e);
    showToast('❌ เกิดข้อผิดพลาด: '+e.message);
  } finally { showLoading(false); }
};

window.deleteAllOrders = async function() {
  showLoading(true);
  try {
    const snap = await getDocs(collection(db,'orders'));
    if(snap.empty){ showLoading(false); showToast('ไม่มีออเดอร์ในระบบ'); return; }
    const batch = snap.docs.map(d=>deleteDoc(doc(db,'orders',d.id)));
    await Promise.all(batch);
    showToast(`🔥 ลบออเดอร์ทั้งหมด ${snap.size} รายการแล้ว`);
    setTimeout(()=>location.reload(), 1500);
  } catch(e) {
    console.error(e);
    showToast('❌ เกิดข้อผิดพลาด: '+e.message);
  } finally { showLoading(false); }
};

// ====== PICKUP LOCATIONS ======
let _pickupLocations = [];

window.loadPickupLocations = async function() {
  const db=window._db, getDoc=window._getDoc, doc=window._doc;
  if (!db) { console.warn('loadPickupLocations: Firebase not ready'); return; }
  try {
    const snap = await getDoc(doc(db,'settings','pickupLocations'));
    _pickupLocations = snap.exists() ? (snap.data().list || []) : [];
    renderPickupLocations();
  } catch(e) { console.warn('loadPickupLocations:', e.message); }
};

function renderPickupLocations() {
  const list = document.getElementById('pickup-locations-list');
  if (!list) return;
  if (!_pickupLocations.length) {
    list.innerHTML = '<div style="font-size:13px;color:#bbb;text-align:center;padding:12px 0;">ยังไม่มีจุดรับ — เพิ่มด้านล่างได้เลย</div>';
    return;
  }
  list.innerHTML = _pickupLocations.map((loc, i) => `
    <div style="display:flex;align-items:center;gap:8px;background:#F9F6F0;border-radius:10px;padding:8px 12px;border:1.5px solid #EEE;">
      <span>📍</span>
      <input type="text" value="${esc(loc.name)}" onchange="_pickupLocations[${i}].name=this.value"
        style="flex:1;border:none;background:transparent;font-family:'Sarabun',sans-serif;font-size:14px;font-weight:700;color:#2C2C2C;outline:none;">
      <button onclick="removePickupLocation(${i})" style="background:#FFEBEE;border:none;border-radius:8px;padding:5px 10px;color:#C62828;font-weight:800;cursor:pointer;">✕</button>
    </div>`).join('');
}

window.addPickupLocation = function() {
  const inp = document.getElementById('new-pickup-name');
  const name = inp.value.trim();
  if (!name) { showToast('กรุณากรอกชื่อจุดรับ'); return; }
  _pickupLocations.push({ name, id: 'loc_' + Date.now() });
  inp.value = '';
  renderPickupLocations();
  showToast('เพิ่ม "' + name + '" แล้ว');
};

window.removePickupLocation = function(idx) {
  _pickupLocations.splice(idx, 1);
  renderPickupLocations();
};

window.savePickupLocations = async function() {
  const db=window._db, setDoc=window._setDoc, doc=window._doc;
  if (!db) return;
  try {
    await setDoc(doc(db,'settings','pickupLocations'), { list: _pickupLocations }, { merge: true });
    showToast('💾 บันทึกจุดรับอาหารแล้ว ✅');
  } catch(e) { showToast('❌ บันทึกไม่สำเร็จ: ' + e.message); }
};

window.resetAllRatings = async function() {
  showLoading(true);
  try {
    const snap = await getDocs(collection(db,'ratings'));
    if(snap.empty){ showLoading(false); showToast('ไม่มีข้อมูล Rating'); return; }
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db,'ratings',d.id))));
    showToast(`⭐ ล้าง Rating แล้ว ${snap.size} รายการ`);
    setTimeout(()=>location.reload(),1500);
  } catch(e){ showToast('❌ ล้าง Rating ไม่สำเร็จ: '+e.message); }
  finally { showLoading(false); }
};

window.resetAllData = async function() {
  showLoading(true);
  try {
    const ordersSnap = await getDocs(collection(db,'orders'));
    const orderBatch = ordersSnap.docs.map(d=>deleteDoc(doc(db,'orders',d.id)));
    const stampsSnap = await getDocs(collection(db,'stamps'));
    const stampBatch = stampsSnap.docs.map(d=>deleteDoc(doc(db,'stamps',d.id)));
    await Promise.all([...orderBatch, ...stampBatch]);
    showToast(`✅ รีเซ็ตแล้ว: ${ordersSnap.size} ออเดอร์, ${stampsSnap.size} แต้ม`);
    setTimeout(()=>location.reload(), 2000);
  } catch(e) {
    console.error(e);
    showToast('❌ เกิดข้อผิดพลาด: '+e.message);
  } finally { showLoading(false); }
};

// ====== EXPOSE FIREBASE TO GLOBAL SCOPE ======
// Required so plain <script> blocks (updateStatus, deleteOrder, loadPickupLocations, etc.) can access Firestore
window._db = db;
window._updateDoc = updateDoc;
window._deleteDoc = deleteDoc;
window._doc = doc;
window._serverTimestamp = serverTimestamp;
window._getDoc = getDoc;
window._setDoc = setDoc;
window._getDocs = getDocs;
window._collection = collection;
window._addDoc = addDoc;
window._deleteField = deleteField;


// ==== MERGED ADDON (analytics + export) ====
window.exportCSV = function(){
  let rows = "id,total,status\n";
  (window.__ordersCache||[]).forEach(o=>{
    rows += `${o.id},${o.total},${o.status}\n`;
  });
  const blob = new Blob([rows]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = "orders.csv";
  a.click();
};

// ====== EXPOSE PANEL LOAD FUNCTIONS TO GLOBAL SCOPE ======
window.loadMenu        = loadMenu;
window.loadBanners     = loadBanners;
window.loadCustomers   = loadCustomers;
window.loadStampConfig = loadStampConfig;
window.loadRewards     = loadRewards;
window.loadSettings    = loadSettings;
window.listenOrders    = listenOrders;
window.listenLineQueue = listenLineQueue;
window.renderStats     = renderStats;
window.loadCategories  = loadCategories;
window.loadPreorderSetting = loadPreorderSetting;
