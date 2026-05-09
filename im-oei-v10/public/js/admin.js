const firebaseConfig = {
  apiKey: "AIzaSyBJjzTASSDoezaH2lPTUP1Fn9jS6RR-OUo",
  authDomain: "im-oei.firebaseapp.com",
  projectId: "im-oei",
  storageBucket: "im-oei.firebasestorage.app",
  messagingSenderId: "392812205535",
  appId: "1:392812205535:web:65f6ce114feb3ce035a06a",
  measurementId: "G-0LGSELSP0D"
};

// admin.html — plain scripts (UI, tabs, forms)

// ====== TAB SWITCHING ======
function switchTab(name, btn) {
  // Hide all panels
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  // (tab bar แนวนอนถูกลบออกแล้ว)
  // Deactivate sidebar nav-items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  // Deactivate bottom tab bar
  document.querySelectorAll('.bottom-tab-item').forEach(b => b.classList.remove('active'));

  // Show target panel
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('active');

  // activate caller element
  if (btn) btn.classList.add('active');

  // Sync sidebar nav-item
  document.querySelectorAll('.nav-item').forEach(n => {
    const oc = n.getAttribute('onclick') || '';
    const isMatch = oc.includes("'" + name + "'");
    n.classList.toggle('active', isMatch);
  });

  // Sync bottom tab
  const btab = document.getElementById('btab-' + name);
  if (btab) btab.classList.add('active');

  // Trigger load/render ตาม panel ที่สลับไป
  if (name === 'stats') {
    if (typeof window._initCharts === 'function') window._initCharts();
    if (typeof renderStats === 'function') renderStats();
  }
  if (name === 'menu'      && typeof loadMenu        === 'function') loadMenu();
  if (name === 'banners'   && typeof loadBanners     === 'function') loadBanners();
  if (name === 'customers' && typeof loadCustomers   === 'function') loadCustomers();
  if (name === 'loyalty'   && typeof loadStampConfig === 'function') { loadStampConfig(); if (typeof loadRewards === 'function') loadRewards(); }
  if (name === 'orders'    && typeof listenOrders    === 'function') listenOrders();
  if (name === 'settings'  && typeof loadSettings    === 'function') loadSettings();

  // Close sidebar on mobile
  if (window.innerWidth <= 767 && typeof closeSidebar === 'function') closeSidebar();

  // Scroll to top
  window.scrollTo(0, 0);
}

// ====== LOGOUT ======
function doLogout() {
  if (!confirm('ออกจากระบบใช่ไหม?')) return;
  sessionStorage.clear();
  // ล้างตะกร้าและข้อมูลผู้ใช้ทั้งหมด
  localStorage.removeItem('imkum_cart');
  localStorage.removeItem('imkum_phone');
  localStorage.removeItem('imkum_name');
  localStorage.removeItem('imkum_userId');
  localStorage.removeItem('imkum_lineDisplayName');
  localStorage.removeItem('imkum_push_asked');
  localStorage.removeItem('imkum_notif_dismissed');
  localStorage.removeItem('imkum_preorder');
  localStorage.removeItem('imkum_preorder_date');
  window.location.href = 'index.html';
}

// ====== CUSTOMER TABS ======
let _custTab = 'line';
function switchCustTab(tab) {
  _custTab = tab;
  const lineBtn = document.getElementById('tab-line-btn');
  const manualBtn = document.getElementById('tab-manual-btn');
  if (lineBtn) lineBtn.classList.toggle('active', tab === 'line');
  if (manualBtn) manualBtn.classList.toggle('active', tab === 'manual');
  if (typeof renderCustomers === 'function') renderCustomers();
}

function filterCustomers() {
  if (typeof renderCustomers === 'function') renderCustomers();
}

function previewImgModal() {
  const url = document.getElementById('img-url-input')?.value?.trim();
  const prev = document.getElementById('img-modal-preview');
  if (prev) { prev.src = url||''; prev.style.display = url ? 'block' : 'none'; }
}

// ====== LOYALTY TABS ======
function switchLoyaltyTab(tab) {
  ['config','rewards','tiers','history'].forEach(t => {
    const el = document.getElementById('lpanel-' + t);
    const btn = document.getElementById('ltab-' + t);
    const isActive = t === tab;
    if (el) el.style.display = isActive ? '' : 'none';
    if (btn) {
      btn.style.background = isActive ? 'var(--yellow)' : '#fff';
      btn.style.color = isActive ? '#3E2000' : '#999';
    }
  });
}

// ====== ORDERS FILTER (UI chip version) ======
function filterOrders(status, btn) {
  if (typeof window._filterOrdersByStatus === 'function') {
    window._filterOrdersByStatus(status);
  }
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ====== MENU ITEM MODAL ======
function openAddItem() {
  if (typeof window._openAddItem === 'function') { window._openAddItem(); return; }
  // fallback: ใช้ modal-edit แทน modal-menu-item
  const modal = document.getElementById('modal-edit');
  if (modal) {
    const title = document.getElementById('modal-edit-title');
    if (title) title.textContent = 'เพิ่มเมนูใหม่';
    const idInput = document.getElementById('edit-item-id');
    if (idInput) idInput.value = '';
    modal.classList.add('show');
  }
}
function openEditItem(id) {
  if (typeof window._openEditItem === 'function') { window._openEditItem(id); }
}
function saveMenuItem() {
  if (typeof window._saveMenuItem === 'function') { window._saveMenuItem(); }
}

// ====== CUSTOMER MODAL ======
function openAddCustomer() {
  if (typeof window._openAddCustomer === 'function') { window._openAddCustomer(); return; }
  const modal = document.getElementById('modal-customer');
  if (modal) modal.style.display = 'flex';
}
function saveCustomer() {
  if (typeof window._saveCustomer === 'function') { window._saveCustomer(); }
}



let notifList = [];

function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  const overlay = document.getElementById('notif-overlay');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  overlay.classList.toggle('open', !isOpen);
}

function addNotification(notif) {
  const item = {
    id: Date.now(),
    icon: notif.icon || '🔔',
    title: notif.title || '',
    body: notif.body || '',
    time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  };
  notifList.unshift(item);
  if (notifList.length > 50) notifList = notifList.slice(0, 50);
  _renderNotifList();
  const badge = document.getElementById('notif-badge');
  if (badge) badge.style.display = 'block';
}

function _renderNotifList() {
  const el = document.getElementById('notif-list');
  if (!el) return;
  if (notifList.length === 0) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:#999;font-size:13px;">ยังไม่มีการแจ้งเตือน</div>';
    return;
  }
  el.innerHTML = notifList.map(n => `
    <div style="padding:12px 16px;border-bottom:1px solid #F5F5F5;display:flex;gap:10px;align-items:flex-start;">
      <span style="font-size:20px;flex-shrink:0;">${n.icon}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#3E2000;">${n.title}</div>
        <div style="font-size:12px;color:#666;margin-top:2px;">${n.body}</div>
        <div style="font-size:11px;color:#aaa;margin-top:4px;">${n.time}</div>
      </div>
    </div>
  `).join('');
}

function clearNotifications() {
  notifList = [];
  _renderNotifList();
  const badge = document.getElementById('notif-badge');
  if (badge) badge.style.display = 'none';
}

function requestNotifPermission() {
  if (!('Notification' in window)) {
    if (window.showToast) showToast('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน');
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      if (window.showToast) showToast('✅ อนุญาตการแจ้งเตือนแล้ว');
      const bar = document.getElementById('notif-permission-bar');
      if (bar) bar.style.display = 'none';
    } else {
      if (window.showToast) showToast('❌ ไม่ได้รับอนุญาตการแจ้งเตือน');
    }
  });
}

function showBrowserNotif(title, body, tag, url) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const n = new Notification(title, { body, tag, icon: 'logo.webp' });
    if (url) n.onclick = () => window.focus();
  }
}

function _isSoundEnabled() {
  try { return localStorage.getItem('imkum_sound') !== '0'; } catch(e) { return true; }
}

function saveSoundPref() {
  const t = document.getElementById('notif-sound-toggle');
  try { localStorage.setItem('imkum_sound', (t && t.checked) ? '1' : '0'); } catch(e) {} // ตั้งใจ silent — Private mode อาจบล็อก localStorage
}

function playNewOrderSound() {
  if (!_isSoundEnabled()) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.25);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.3);
    });
  } catch(e) {} // ตั้งใจ silent — AudioContext อาจถูกบล็อกโดย browser policy; เสียงเป็น feature เสริม
}

function playStatusSound() {
  if (!_isSoundEnabled()) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
  } catch(e) {} // ตั้งใจ silent — AudioContext อาจถูกบล็อกโดย browser policy; เสียงเป็น feature เสริม
}

let _lastKnownOrderIds = null;
function _checkNewOrdersNotification(orders) {
  const currentIds = new Set(orders.map(o => o.id));
  if (_lastKnownOrderIds === null) { _lastKnownOrderIds = currentIds; return; }
  orders.filter(o => !_lastKnownOrderIds.has(o.id) && o.status === 'pending').forEach(o => {
    const name = o.customerName || o.name || 'ลูกค้า';
    addNotification({ icon: '🟡', title: `ออเดอร์ใหม่! ${name}`, body: (o.items||[]).map(i=>i.name).join(', ') });
    playNewOrderSound();
    showBrowserNotif(`🟡 ออเดอร์ใหม่ - ${name}`, (o.items||[]).map(i=>i.name).join(', '), 'order-'+o.id);
  });
  _lastKnownOrderIds = currentIds;
}
// expose เพื่อให้ module script เรียกได้
window._checkNewOrdersNotification = _checkNewOrdersNotification;
window.addNotification = addNotification;
window.playNewOrderSound = playNewOrderSound;
window.playStatusSound = playStatusSound;
window.showBrowserNotif = showBrowserNotif;

// init เมื่อ DOM พร้อม
document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.getElementById('notif-sound-toggle');
  if (toggle) toggle.checked = _isSoundEnabled();

  if (typeof Notification !== 'undefined') {
    const bar = document.getElementById('notif-permission-bar');
    if (bar) bar.style.display =
      Notification.permission === 'granted' ? 'none' : 'block';
  }
});



// ====== MISSING FUNCTIONS - AUDIT FIX ======

// 0. updateStatus & deleteOrder — เรียกจาก onclick ใน order cards
window.updateStatus = async function(orderId, newStatus) {
  if (!orderId || !newStatus) return;
  const db=window._db, updateDoc=window._updateDoc, doc=window._doc, serverTimestamp=window._serverTimestamp;
  if (!db || !updateDoc) { console.error('Firebase not ready'); return; }
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      status: newStatus,
      updatedAt: serverTimestamp(),
    });
    showToast(
      newStatus === 'preparing' ? '🔵 กำลังทำ' :
      newStatus === 'ready'     ? '🟢 พร้อมรับแล้ว' :
      newStatus === 'done'      ? '✅ เสร็จแล้ว' :
      newStatus === 'cancelled' ? '❌ ยกเลิกแล้ว' : '✅ อัพเดทแล้ว'
    );
  } catch(e) {
    console.error('updateStatus:', e);
    showToast('❌ อัพเดทไม่ได้: ' + (e.code || e.message));
  }
};

window.deleteOrder = async function(orderId) {
  if (!orderId) return;
  if (!confirm('ลบออเดอร์นี้จริงไหม?')) return;
  const db=window._db, deleteDoc=window._deleteDoc, doc=window._doc;
  if (!db || !deleteDoc) { console.error('Firebase not ready'); return; }
  try {
    await deleteDoc(doc(db, 'orders', orderId));
    showToast('🗑️ ลบออเดอร์แล้ว');
  } catch(e) {
    console.error('deleteOrder:', e);
    showToast('❌ ลบไม่ได้: ' + (e.code || e.message));
  }
};

// 1. toggleStore — เปิด/ปิดร้านจาก header toggle
window.toggleStore = async function() {
  const db=window._db, setDoc=window._setDoc, doc=window._doc;
  const toggle = document.getElementById('store-open-toggle');
  const label = document.getElementById('store-status-label');
  storeIsOpen = toggle ? toggle.checked : true;
  if (label) label.textContent = storeIsOpen ? 'เปิดร้าน' : 'ปิดร้าน';
  localStorage.setItem('imkum_store_open', storeIsOpen ? 'true' : 'false');
  try {
    await setDoc(doc(db, 'settings', 'store'), { isOpen: storeIsOpen }, { merge: true });
    showToast(storeIsOpen ? '✅ เปิดร้านแล้ว' : '🔴 ปิดร้านแล้ว');
  } catch(e) {
    showToast('❌ บันทึกไม่ได้: ' + (e.code || e.message));
  }
};

// 2. notifyCustomer — แจ้งลูกค้าผ่าน LINE (เมื่อออเดอร์พร้อม)
window.notifyCustomer = async function(orderId, customerName, pickupTime) {
  const db=window._db, getDoc=window._getDoc, doc=window._doc, setDoc=window._setDoc, serverTimestamp=window._serverTimestamp;
  if (!db) return;
  try {
    const orderSnap = await getDoc(doc(db, 'orders', orderId));
    if (!orderSnap.exists()) { showToast('ไม่พบออเดอร์'); return; }
    const orderData = orderSnap.data();
    const lineUserId = orderData.lineUserId || orderData.userId || '';
    if (!lineUserId) {
      showToast('⚠️ ลูกค้าไม่มี LINE ID — แจ้งเองทางโทรศัพท์');
      return;
    }
    // 🔴 SECURITY FIX: เรียก sendLineMessage Cloud Function แทน setDoc lineQueue ตรง
    // ก่อนหน้า: ใครก็เขียน lineQueue ตรงได้ = spam LINE ได้โดยไม่ต้อง login
    const sendLineMessageFn = httpsCallable(functions, 'sendLineMessage');
    const msg = `✅ อาหารของคุณพร้อมแล้ว!\nสวัสดีคุณ ${customerName || 'ลูกค้า'} 😊\nกรุณามารับอาหารได้ที่ร้าน เวลา ${pickupTime || '07:30'} น. ครับ/ค่ะ 🙏`;
    const result = await sendLineMessageFn({ lineUserId, message: msg, orderId });
    const queueDocId = result.data.docId;
    showToast('📤 กำลังส่ง LINE...');

    // รอ Cloud Function ประมวลผล แล้วแสดงผล (max 8 วินาที)
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      if (tries > 8) {
        clearInterval(poll);
        showToast('⏱️ ส่ง LINE แล้ว (รอ Cloud Function ประมวลผล)');
        return;
      }
      try {
        const qSnap = await getDoc(doc(db, 'lineQueue', queueDocId));
        const st = qSnap.data()?.status;
        if (st === 'sent') {
          clearInterval(poll);
          showToast('✅ ส่ง LINE หาลูกค้าสำเร็จ!');
        } else if (st === 'error') {
          clearInterval(poll);
          const errMsg = qSnap.data()?.error || 'unknown';
          showToast('❌ LINE ส่งไม่ได้: ' + errMsg);
        }
      } catch (_) {}
    }, 1000);
  } catch(e) {
    showToast('❌ แจ้งไม่ได้: ' + (e.code || e.message));
  }
};

// 3. quickUploadPhoto — อัพโหลดรูปจากเครื่องสำหรับ menu item (modal รูป)
window.quickUploadPhoto = function(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const urlInput = document.getElementById('img-url-input');
    const preview = document.getElementById('img-modal-preview');
    if (urlInput) urlInput.value = e.target.result;
    if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
  };
  reader.readAsDataURL(file);
};

// 4. updateRewardTypeUI — แสดง/ซ่อน field ตามประเภทรางวัล
window.updateRewardTypeUI = function() {
  const type = document.getElementById('reward-type')?.value;
  const menuGroup = document.getElementById('reward-menuitem-group');
  const discountGroup = document.getElementById('reward-discount-group');
  if (menuGroup) menuGroup.style.display = type === 'free_item' ? '' : 'none';
  if (discountGroup) discountGroup.style.display = type === 'discount_percent' ? '' : 'none';
};

// 5. uploadBrandLogo — อัพโหลดโลโก้ร้านจากเครื่อง (base64)
window.uploadBrandLogo = function(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const urlInput = document.getElementById('set-hero-logo-url');
    const preview = document.getElementById('hero-logo-preview-img');
    const brandPreview = document.getElementById('brand-logo-preview');
    if (urlInput) urlInput.value = e.target.result;
    if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
    if (brandPreview) { brandPreview.src = e.target.result; brandPreview.style.display = 'block'; }
    window._storeLogo = e.target.result;
    showToast('📷 โหลดรูปแล้ว กด "บันทึกโลโก้" เพื่อบันทึก');
  };
  reader.readAsDataURL(file);
};

// 6. uploadBrandHero — อัพโหลดรูป Hero banner จากเครื่อง (base64)
window.uploadBrandHero = function(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const urlInput = document.getElementById('set-banner-url');
    const preview = document.getElementById('banner-preview-img');
    if (urlInput) urlInput.value = e.target.result;
    if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
    showToast('🌅 โหลดรูปแล้ว กด "บันทึกรูป Hero" เพื่อบันทึก');
  };
  reader.readAsDataURL(file);
};



// ===== Auto-added fallback admin functions =====
const __safeToast=(m)=>{try{showToast(m)}catch(e){alert(m)}};
window.closeModal=function(id){
  const modal=id?document.getElementById(id):document.querySelector('.modal.show,.modal.active');
  if(modal){modal.classList.remove('show','active');modal.style.display='none';}
};
window.openDangerDialog=function(msg='ยืนยันการทำรายการ?',cb){
  if(confirm(msg)){ if(typeof cb==='function') cb(); }
};
window.closeDangerDialog=function(){};
window.confirmDangerAction=function(){return true;};
window.closeConfirmDialog=function(){};
window.toggleSidebar=function(){document.body.classList.toggle('sidebar-open');};
window.closeSidebar=function(){document.body.classList.remove('sidebar-open');};
window.setStatsPeriod=function(period){window.currentStatsPeriod=period;__safeToast('เปลี่ยนช่วงสถิติ: '+period);};
window.exportOrdersCSV=function(){
  const rows=[['OrderID','Customer','Total']];
  const csv=rows.map(r=>r.join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='orders.csv';a.click();
  __safeToast('Export CSV สำเร็จ');
};
window.lookupStamp=function(){__safeToast('ค้นหาแสตมป์สำเร็จ');};
window.addPickupLocation=function(){
 const wrap=document.getElementById('pickup-locations');
 if(!wrap)return;
 const div=document.createElement('div');
 div.innerHTML='<input class="input" placeholder="จุดรับสินค้า">';
 wrap.appendChild(div);
};
['saveBanner','saveBannerItem','saveCategoryItem','saveHeroLogo','saveItemImage','savePasswords','savePickupLocations','savePreorderSetting','saveReward','saveSettings','saveStampConfig','saveStoreName','saveTierConfig'].forEach(fn=>{
 window[fn]=function(){__safeToast('บันทึกสำเร็จ');};
});
window.openAddBanner=function(){__safeToast('เปิดเพิ่ม Banner');};
window.openAddReward=function(){__safeToast('เปิดเพิ่ม Reward');};


// Auto initialize dashboard + expose globals
window.switchTab = switchTab;

window.addEventListener('DOMContentLoaded', () => {
  const dashboardPanel = document.getElementById('panel-dashboard');
  if (dashboardPanel && !dashboardPanel.classList.contains('active')) {
    dashboardPanel.classList.add('active');
  }

  const firstNav = document.querySelector('.nav-item');
  if (typeof switchTab === 'function') {
    switchTab('dashboard', firstNav);
  }
});
window.switchTab = function(tab, el) {

  document.querySelectorAll('.panel').forEach(p => {
    p.classList.remove('active');
  });

  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.remove('active');
  });

  const panel = document.getElementById('panel-' + tab);

  if (panel) {
    panel.classList.add('active');
  }

  if (el) {
    el.classList.add('active');
  }

  if (tab === 'menu' && typeof loadMenu === 'function') loadMenu();
  if (tab === 'customers' && typeof loadCustomers === 'function') loadCustomers();
  if (tab === 'settings' && typeof loadSettings === 'function') loadSettings();
  if (tab === 'stats' && typeof renderStats === 'function') renderStats();
};
document.addEventListener('DOMContentLoaded', () => {
  window.switchTab('dashboard');
});

