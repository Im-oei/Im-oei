// admin.js — plain script (UI helpers only, NO Firebase, NO switchTab override)
// admin.module.js (ES module) handles: Firebase, switchTab, renderOrders, renderMenuAdmin, etc.
// This file handles: UI-only helpers that don't need Firebase imports

// ====== DO NOT redefine switchTab here — admin.module.js owns it ======

// ====== LOGOUT ======
function doLogout() {
  if (!confirm('ออกจากระบบใช่ไหม?')) return;
  sessionStorage.clear();
  localStorage.removeItem('imkum_cart');
  localStorage.removeItem('imkum_phone');
  localStorage.removeItem('imkum_name');
  localStorage.removeItem('imkum_userId');
  localStorage.removeItem('imkum_lineDisplayName');
  localStorage.removeItem('imkum_push_asked');
  localStorage.removeItem('imkum_notif_dismissed');
  localStorage.removeItem('imkum_preorder');
  localStorage.removeItem('imkum_preorder_date');
  localStorage.removeItem('imkum_return_to');
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
  if (typeof window.renderCustomers === 'function') window.renderCustomers();
}

function filterCustomers() {
  if (typeof window.renderCustomers === 'function') window.renderCustomers();
}

function previewImgModal() {
  const url = document.getElementById('img-url-input')?.value?.trim();
  const prev = document.getElementById('img-modal-preview');
  if (prev) { prev.src = url || ''; prev.style.display = url ? 'block' : 'none'; }
}

// ====== LOYALTY TABS ======
function switchLoyaltyTab(tab) {
  ['config', 'rewards', 'tiers', 'history'].forEach(t => {
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

// ====== ORDERS FILTER ======
function filterOrders(status, btn) {
  if (typeof window._filterOrdersByStatus === 'function') {
    window._filterOrdersByStatus(status);
  }
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ====== MENU ITEM MODAL (delegates to module) ======
function openAddItem() {
  if (typeof window._openAddItem === 'function') window._openAddItem();
}
function openEditItem(id) {
  if (typeof window._openEditItem === 'function') window._openEditItem(id);
}
function saveMenuItem() {
  if (typeof window._saveMenuItem === 'function') window._saveMenuItem();
}

// ====== CUSTOMER MODAL (delegates to module) ======
function openAddCustomer() {
  if (typeof window._openAddCustomer === 'function') window._openAddCustomer();
}
function saveCustomer() {
  if (typeof window._saveCustomer === 'function') window._saveCustomer();
}

// ====== NOTIFICATIONS ======
let notifList = [];

function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  const overlay = document.getElementById('notif-overlay');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  if (overlay) overlay.classList.toggle('open', !isOpen);
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
  if (!notifList.length) {
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
    if (window.showToast) window.showToast('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน');
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      if (window.showToast) window.showToast('✅ อนุญาตการแจ้งเตือนแล้ว');
      const bar = document.getElementById('notif-permission-bar');
      if (bar) bar.style.display = 'none';
    } else {
      if (window.showToast) window.showToast('❌ ไม่ได้รับอนุญาตการแจ้งเตือน');
    }
  });
}

function showBrowserNotif(title, body, tag) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const n = new Notification(title, { body, tag, icon: 'logo.webp' });
    n.onclick = () => window.focus();
  }
}

function _isSoundEnabled() {
  try { return localStorage.getItem('imkum_sound') !== '0'; } catch (e) { return true; }
}

function saveSoundPref() {
  const t = document.getElementById('notif-sound-toggle');
  try { localStorage.setItem('imkum_sound', (t && t.checked) ? '1' : '0'); } catch (e) {}
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
  } catch (e) {}
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
  } catch (e) {}
}

let _lastKnownOrderIds = null;
function _checkNewOrdersNotification(orders) {
  const currentIds = new Set(orders.map(o => o.id));
  if (_lastKnownOrderIds === null) { _lastKnownOrderIds = currentIds; return; }
  orders.filter(o => !_lastKnownOrderIds.has(o.id) && o.status === 'pending').forEach(o => {
    const name = o.customerName || o.name || 'ลูกค้า';
    addNotification({ icon: '🟡', title: `ออเดอร์ใหม่! ${name}`, body: (o.items || []).map(i => i.name).join(', ') });
    playNewOrderSound();
    showBrowserNotif(`🟡 ออเดอร์ใหม่ - ${name}`, (o.items || []).map(i => i.name).join(', '), 'order-' + o.id);
  });
  _lastKnownOrderIds = currentIds;
}

// ====== USER MENU DROPDOWN ======
function toggleUserMenu() {
  const dd = document.getElementById('user-dropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!e.target.closest('.user-chip')) dd.style.display = 'none';
        document.removeEventListener('click', closeMenu);
      });
    }, 10);
  }
}

async function adminLogout() {
  // ล้าง auth ทุกจุด
  localStorage.removeItem('imkum_admin_auth');
  localStorage.removeItem('imkum_user');
  localStorage.removeItem('imkum_name');
  sessionStorage.removeItem('imkum_user');
  sessionStorage.removeItem('imkum_admin_auth');
  try {
    const { getAuth, signOut } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    await signOut(getAuth());
  } catch (e) {}
  window.location.replace('login.html');
}

// ====== SIDEBAR ======
function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebarOverlay')?.classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('show');
}

// ====== PICKUP LOCATION (UI only) ======
function addPickupLocationUI() {
  if (typeof window.addPickupLocation === 'function') {
    window.addPickupLocation();
  }
}

// ====== GLOBAL SEARCH ======
function globalSearch(q) {
  const query = (q || '').trim().toLowerCase();
  // set _searchQuery ใน admin.module scope ผ่าน window
  window._setSearchQuery(query);
}

// ====== DOMContentLoaded ======
document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.getElementById('notif-sound-toggle');
  if (toggle) toggle.checked = _isSoundEnabled();

  if (typeof Notification !== 'undefined') {
    const bar = document.getElementById('notif-permission-bar');
    if (bar) bar.style.display = Notification.permission === 'granted' ? 'none' : 'block';
  }
});

// ====== EXPOSE TO GLOBAL SCOPE ======
Object.assign(window, {
  doLogout,
  switchCustTab,
  filterCustomers,
  previewImgModal,
  switchLoyaltyTab,
  filterOrders,
  openAddItem,
  openEditItem,
  saveMenuItem,
  openAddCustomer,
  saveCustomer,
  toggleNotifications,
  clearNotifications,
  requestNotifPermission,
  saveSoundPref,
  playNewOrderSound,
  playStatusSound,
  showBrowserNotif,
  toggleUserMenu,
  adminLogout,
  toggleSidebar,
  closeSidebar,
  globalSearch,
  addPickupLocationUI,
  _checkNewOrdersNotification,
  addNotification,
});
