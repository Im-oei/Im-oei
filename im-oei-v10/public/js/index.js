// index.html — plain scripts (UI logic)

// ====== PREORDER STATE ======
var isPreorderMode = false;
var preorderDate = null;

function togglePreorder() {
  isPreorderMode = document.getElementById('preorder-toggle').checked;
  var topbar = document.getElementById('preorder-topbar');
  var label = document.getElementById('preorder-label');
  var sub = document.getElementById('preorder-sub');

  if (isPreorderMode) {
    var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
    preorderDate = tomorrow.toLocaleDateString('th-TH',{weekday:'short',day:'numeric',month:'short'});
    topbar.classList.add('active-preorder');
    label.textContent = '📅 ' + preorderDate;
    sub.textContent = '✅ โหมดสั่งล่วงหน้า';
    localStorage.setItem('imkum_preorder','1');
    localStorage.setItem('imkum_preorder_date', preorderDate);
    showToast('📅 สั่งล่วงหน้าวันพรุ่งนี้: '+preorderDate);
  } else {
    topbar.classList.remove('active-preorder');
    label.textContent = '📅 พรุ่งนี้';
    sub.textContent = 'อร่อยง่ายๆ ใกล้บ้านคุณ';
    localStorage.removeItem('imkum_preorder');
    localStorage.removeItem('imkum_preorder_date');
    showToast('กลับสู่การสั่งปกติ');
  }
}

// Restore preorder state
if (localStorage.getItem('imkum_preorder') === '1') {
  isPreorderMode = true;
  preorderDate = localStorage.getItem('imkum_preorder_date') || '';
  document.getElementById('preorder-toggle').checked = true;
  document.getElementById('preorder-topbar').classList.add('active-preorder');
  document.getElementById('preorder-label').textContent = '📅 ' + preorderDate;
  document.getElementById('preorder-sub').textContent = '✅ โหมดสั่งล่วงหน้า';
}

// ====== USER ======
function getUser(){
  try {
    const u = JSON.parse(sessionStorage.getItem('imkum_user')||'null');
    if (u && u.loginAt && (Date.now() - u.loginAt > 8*60*60*1000)) {
      sessionStorage.clear(); return null; // หมดอายุ
    }
    return u;
  } catch(e){ return null; }
}
// ====== ADMIN STORE BAR ======
function initAdminBar() {
  try {
    var u = JSON.parse(sessionStorage.getItem('imkum_user') || 'null');
    if (!u || (u.role !== 'admin' && u.role !== 'owner')) return;
    var bar = document.getElementById('admin-store-bar');
    if (bar) bar.style.display = 'flex';
    setTimeout(function() {
      var banner = document.getElementById('closed-banner');
      var isClosed = banner && banner.style.display !== 'none';
      var toggle = document.getElementById('idx-store-toggle');
      if (toggle) toggle.checked = !isClosed;
      var label = document.getElementById('idx-store-status');
      if (label) { label.textContent = isClosed ? 'ปิดรับออเดอร์' : 'เปิดรับออเดอร์'; label.className = 'store-status' + (isClosed ? ' closed' : ''); }
    }, 1500);
  } catch(e) {}
}
window.toggleStoreFromIndex = async function() {
  var toggle = document.getElementById('idx-store-toggle');
  var isOpen = toggle ? toggle.checked : true;
  var label = document.getElementById('idx-store-status');
  if (label) { label.textContent = isOpen ? 'เปิดรับออเดอร์' : 'ปิดรับออเดอร์'; label.className = 'store-status' + (isOpen ? '' : ' closed'); }
  var banner = document.getElementById('closed-banner');
  if (banner) {
    if (!isOpen) { banner.style.display = 'block'; banner.innerHTML = '<div class="closed-overlay">🔴 ร้านปิดรับออเดอร์แล้ว กรุณามาใหม่วันพรุ่งนี้</div>'; }
    else { banner.style.display = 'none'; banner.innerHTML = ''; }
  }
  try { if (window._idxSaveStore) await window._idxSaveStore(isOpen); } catch(e) {}
};
function goProfile(){
  var u=getUser();
  if(!u){ showLoginModal(function(){ goProfile(); }); return; }
  if(u.role==='admin'||u.role==='owner'){ window.location.href='admin.html'; return; }
  window.location.href='orders.html';
}
function updateUserBadge(){
  var u=getUser();
  var btn=document.getElementById('user-badge');
  var av=document.getElementById('user-avatar');
  if(!u){
    btn.style.background='linear-gradient(135deg,#FFF8E1,#FFE082)';
    av.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b8860b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
    return;
  }
  if(u.role==='owner'){
    btn.style.background='linear-gradient(135deg,#FFD700,#FFA500)';
    av.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="#3E2000" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    return;
  }
  if(u.role==='admin'){
    btn.style.background='linear-gradient(135deg,#E3F2FD,#BBDEFB)';
    av.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1565C0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M6 20c0-3 2.7-5 6-5s6 2 6 5"/></svg>';
    return;
  }
  // Customer: show LINE photo or SVG
  // รองรับ field ชื่อต่างกัน: avatar / picture / photoURL + localStorage fallback
  var picUrl = u.avatar || u.picture || u.photoURL || localStorage.getItem('imkum_line_picture') || '';
  if(picUrl){
    btn.style.background='none';
    btn.style.border='2.5px solid #FFC107';
    btn.style.padding='0';
    btn.style.overflow='hidden';
    av.innerHTML='<img src="'+picUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display=\'none\'">';
  } else {
    btn.style.background='linear-gradient(135deg,#FFF8E1,#FFE082)';
    var initials = u.name ? u.name.charAt(0) : '';
    if(initials){
      av.innerHTML='<span style="font-size:16px;font-weight:800;color:#3E2000;font-family:Sarabun,sans-serif;">'+initials+'</span>';
    } else {
      av.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b8860b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
    }
  }
}
updateUserBadge();


// ====== MENU DATA ======
var MENU=[
  {category:"🥪 แซนวิช",catKey:"sandwich",items:[
    {id:"tuna",name:"ปูอัดทูน่า",desc:"ปูอัด, ทูน่า, ผักสลัด",emoji:"🥪",price:20},
    {id:"pork_salad",name:"หมูหยองสลัด",desc:"หมูหยอง, สลัด, มายองเนส",emoji:"🥙",price:20},
    {id:"egg_sausage",name:"ไข่ดาวไส้กรอก",desc:"ไข่ดาว, ไส้กรอก, ซอส",emoji:"🍳",price:20},
    {id:"shrimp",name:"ไข่กุ้งสาหร่าย",desc:"ไข่กุ้ง, สาหร่าย, มายองเนส",emoji:"🍤",price:20},
  ]},
  {category:"🍚 ข้าว",catKey:"rice",items:[
    {id:"chicken_rice",name:"ข้าวไก่อบ",desc:"ไก่อบ, ไข่ต้ม, ผัก",emoji:"🍗",price:50},
    {id:"chicken_lime",name:"ข้าวไก่อบมะนาว",desc:"ไก่มะนาว, ข้าว, ผัก",emoji:"🍋",price:50},
  ]},
  {category:"🍜 หมี่",catKey:"noodle",items:[
    {id:"chicken_noodle",name:"หมี่ไก่ฉีก",desc:"หมี่เหลือง, ไก่ฉีก, น้ำซุป",emoji:"🍜",price:50},
    {id:"pork_noodle",name:"หมี่หมูแดง",desc:"หมี่, หมูแดง, ไข่ต้ม",emoji:"🥢",price:50},
  ]}
];
var ALL_ITEMS=[].concat.apply([],MENU.map(function(c){return c.items;}));
var FEATURED_IDS=["tuna","chicken_noodle","egg_sausage"];
var currentCat='all'; var currentSearch='';

// ====== VIEW SWITCHER (card / grid / list) ======
var viewMode = localStorage.getItem('imkum_view') || 'grid';
function applyViewMode(){
  document.body.classList.remove('view-card','view-grid','view-list');
  document.body.classList.add('view-'+viewMode);
  ['card','grid','list'].forEach(function(m){
    var btn = document.getElementById('view-btn-'+m);
    if(btn) btn.classList.toggle('active', m === viewMode);
  });
}
function setView(mode){
  viewMode = mode;
  localStorage.setItem('imkum_view', viewMode);
  applyViewMode();
  buildMenuList();
  render();
}
applyViewMode();

// ถ้าไม่ได้ login → clear cart ทิ้ง (ไม่ให้ค้างข้ามเซสชัน)
(function() {
  var u = getUser();
  if (!u) {
    localStorage.removeItem('imkum_cart');
    localStorage.removeItem('imkum_cart_prices');
  }
})();

var cart=JSON.parse(localStorage.getItem('imkum_cart')||'{}');
function saveCart(){localStorage.setItem('imkum_cart',JSON.stringify(cart));}
function add(id){
  var item=ALL_ITEMS.filter(function(i){return i.id===id;})[0];
  if(!item) return;
  if(item.soldOut){ showToast('❌ '+item.name+' หมดแล้ว'); return; }
  if(!getUser()){ showLoginModal(function(){ add(id); }); return; }
  cart[id]=(cart[id]||0)+1; saveCart(); render();
  showToast('เพิ่ม '+item.name+' ลงตะกร้า 🛒');
}
function remove(id){
  if((cart[id]||0)>0){cart[id]--;if(!cart[id])delete cart[id];saveCart();render();}
}
function getTotal(){
  var sum=0;
  Object.keys(cart).forEach(function(id){
    var item=ALL_ITEMS.filter(function(i){return i.id===id;})[0];
    if(item) sum+=item.price*cart[id];
  });
  return sum;
}
function getCount(){var s=0;Object.values(cart).forEach(function(v){s+=v;});return s;}
function render(){
  ALL_ITEMS.forEach(function(item){
    var el=document.getElementById('qty-'+item.id);
    var v=cart[item.id]||0;
    if(el) el.textContent=v;
  });
  var t=getTotal(),c=getCount();
  var te=document.getElementById('home-total');
  var ce=document.getElementById('cart-count');
  if(te) te.textContent=t+' บาท';
  if(ce) ce.textContent=c;
}
function showToast(msg){
  var t=document.getElementById('toast');
  if(!t) return;
  t.textContent=msg; t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2200);
}
function foodImg(item){
  if(item.imageUrl) return '<img src="'+item.imageUrl+'" alt="'+item.name+'" loading="lazy">';
  return '<span style="font-size:32px">'+(item.emoji||'🍽️')+'</span>';
}
function buildTabs(){
  var wrap=document.getElementById('cat-tabs');
  wrap.innerHTML='<div class="cat-tab active" onclick="filterCat(\'all\',this)">🍽️ ทั้งหมด</div>';
  MENU.forEach(function(cat){
    var vis=cat.items.filter(function(i){return !i.hidden;});
    if(!vis.length) return;
    wrap.innerHTML+='<div class="cat-tab" onclick="filterCat(\''+cat.catKey+'\',this)">'+cat.category+'</div>';
  });
}
function filterCat(key,el){
  currentCat=key;
  document.querySelectorAll('.cat-tab').forEach(function(t){t.classList.remove('active');});
  if(el) el.classList.add('active');
  buildMenuList();
}
function onSearch(val){currentSearch=val.toLowerCase().trim();buildMenuList();}
function buildFeatured(){
  var row=document.getElementById('featured-row');
  row.innerHTML='';
  FEATURED_IDS.forEach(function(fid){
    var item=ALL_ITEMS.filter(function(i){return i.id===fid;})[0];
    if(!item||item.hidden) return;
    row.innerHTML+=
      '<div class="featured-card">'+
        '<div class="badge">BEST</div>'+
        '<div class="fc-img">'+foodImg(item)+'</div>'+
        '<div class="fc-info">'+
          '<div class="fc-name">'+item.name+'</div>'+
          '<div class="fc-price">'+item.price+' บาท</div>'+
        '</div>'+
        '<button class="fc-add" onclick="add(\''+item.id+'\')">+</button>'+
      '</div>';
  });
}
function buildMenuList(){
  var list=document.getElementById('menu-list');
  var html=''; var hasAny=false;
  MENU.forEach(function(cat){
    if(currentCat!=='all'&&currentCat!==cat.catKey) return;
    var vis=cat.items.filter(function(i){
      if(i.hidden) return false;
      if(currentSearch) return i.name.toLowerCase().includes(currentSearch)||(i.desc||'').toLowerCase().includes(currentSearch);
      return true;
    });
    if(!vis.length) return;
    hasAny=true;
    html+='<div class="cat-section"><div class="cat-header"><span class="cat-name">'+cat.category+'</span><div class="cat-line"></div></div><div class="menu-grid">';
    vis.forEach(function(item){
      var isSoldOut = item.soldOut === true;
      var topBadge = '';
      if (isSoldOut) {
        topBadge = '<span class="sold-badge">หมด</span>';
      } else if (item.avgRating && item.ratingCount > 0) {
        topBadge = '<span class="rating-badge">⭐ '+item.avgRating.toFixed(1)+'</span>';
      }
      // qty ID เดียวทุก mode — ไม่ซ้ำใน DOM
      var qtyBtns = isSoldOut
        ? '<span style="font-size:11px;font-weight:700;color:#B71C1C;">หมดแล้ว</span>'
        : '<button class="btn" onclick="remove(\''+item.id+'\')">−</button>' +
          '<span class="qty-num" id="qty-'+item.id+'">0</span>' +
          '<button class="btn plus" onclick="add(\''+item.id+'\')">+</button>';

      if (viewMode === 'card') {
        // CARD MODE: รูปซ้าย, ข้อความ+qty ขวา
        html +=
          '<div class="card">' +
            '<div class="food-img">' + foodImg(item) + topBadge + '</div>' +
            '<div class="card-left">' +
              '<div class="name">' + item.name + '</div>' +
              '<div class="desc">' + (item.desc || '') + '</div>' +
              '<div class="price-tag card-price">' + item.price + ' <span class="price-unit">บาท</span></div>' +
              '<div class="qty card-qty">' + qtyBtns + '</div>' +
            '</div>' +
          '</div>';

      } else if (viewMode === 'list') {
        // LIST MODE: รูปซ้าย, ข้อความซ้าย, qty ขวา
        html +=
          '<div class="card">' +
            '<div class="food-img">' + foodImg(item) + topBadge + '</div>' +
            '<div class="list-left">' +
              '<div class="name">' + item.name + '</div>' +
              '<div class="desc">' + (item.desc || '') + '</div>' +
              '<div class="price-tag list-price">' + item.price + ' <span class="price-unit">บาท</span></div>' +
              '<div class="qty list-qty">' + qtyBtns + '</div>' +
            '</div>' +
          '</div>';

      } else {
        // GRID MODE (default): รูปบน, ชื่อ+ราคา+qty ใต้รูป
        html +=
          '<div class="card">' +
            '<div class="food-img">' + foodImg(item) + topBadge + '</div>' +
            '<div class="grid-footer">' +
              '<div class="grid-name">' + item.name + '</div>' +
              '<div class="grid-footer-row">' +
                '<div class="price-tag">' + item.price + ' <span class="price-unit">บาท</span></div>' +
                '<div class="qty">' + qtyBtns + '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      }
    });
    html+='</div></div>';
  });
  list.innerHTML = hasAny ? html : '<div class="no-results">😔 ไม่พบเมนูที่ค้นหา</div>';
}

// ====== PUSH NOTIFICATION SUBSCRIBE ======
async function requestPushPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission === 'granted') return;
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast('🔔 เปิดรับการแจ้งเตือนแล้ว!');
    // Store subscription flag
    localStorage.setItem('imkum_push_enabled','1');
  }
}

// Auto-ask for push permission after login
var u = getUser();
if (u && u.role === 'customer' && !localStorage.getItem('imkum_push_asked')) {
  localStorage.setItem('imkum_push_asked','1');
  setTimeout(requestPushPermission, 2000);
}

buildTabs(); buildFeatured(); buildMenuList(); render();

window.openAdminLogin=function(){window.location.href='login.html';};
window.closeAdminModal=function(){};
window.doAdminLogin=function(){window.location.href='login.html';};



(function() {
  let _deferredPrompt = null;
  const bar = document.getElementById('pwa-install-bar');
  const installBtn = document.getElementById('pwa-install-btn');
  const dismissBtn = document.getElementById('pwa-dismiss-btn');

  // ไม่แสดงถ้าเคย dismiss ไปแล้ว
  if (localStorage.getItem('imkum_pwa_dismissed') === '1') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredPrompt = e;
    bar.style.display = 'flex';
  });

  installBtn && installBtn.addEventListener('click', async () => {
    if (!_deferredPrompt) return;
    bar.style.display = 'none';
    _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      localStorage.setItem('imkum_pwa_dismissed', '1');
    }
    _deferredPrompt = null;
  });

  dismissBtn && dismissBtn.addEventListener('click', () => {
    bar.style.display = 'none';
    localStorage.setItem('imkum_pwa_dismissed', '1');
  });

  // ซ่อนถ้า install สำเร็จแล้ว
  window.addEventListener('appinstalled', () => {
    bar.style.display = 'none';
    _deferredPrompt = null;
    localStorage.setItem('imkum_pwa_dismissed', '1');
  });
})();



function showLoginModal(callback) {
  window._loginModalCb = callback || null;
  var m = document.getElementById('login-modal');
  m.classList.add('open');
  // Lock body scroll while modal is open
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  var u = getUser();
  if (u && u.name) document.getElementById('modal-name').value = u.name;
  setTimeout(function(){
    var box = document.getElementById('login-modal-box');
    if (box) box.scrollTop = 0;
    var inp = document.getElementById('modal-name');
    if (inp) inp.focus();
  }, 350);
}
function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('open');
  document.getElementById('modal-error').style.display = 'none';
  // Restore body scroll
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
}
async function submitLoginModal() {
  var name = document.getElementById('modal-name').value.trim();
  var err = document.getElementById('modal-error');
  if (!name) { err.textContent='กรุณากรอกชื่อของคุณ'; err.style.display='block'; return; }
  err.style.display = 'none';
  // Guest login — ใช้ชื่อ + guestId (random) เป็น ID
  var guestId = localStorage.getItem('imkum_guest_id') || ('guest_' + Math.random().toString(36).slice(2,10));
  localStorage.setItem('imkum_guest_id', guestId);
  sessionStorage.setItem('imkum_user', JSON.stringify({ role:'customer', name, guestId, loginAt: Date.now() }));
  localStorage.setItem('imkum_name', name);
  closeLoginModal();
  updateUserBadge();
  showToast('ยินดีต้อนรับ ' + name + ' 👋');
  if (window._loginModalCb) window._loginModalCb();
}

// ============================================================
// LINE LIFF Login — inline (Firestore-direct, no AppCheck required)
// ============================================================
(function() {
  const LIFF_ID_LOCAL = "2009910221-ySbGklzJ";

  // ─── ฟังก์ชัน init LIFF ครั้งเดียว ────────────────────────────────────
  async function ensureLiff() {
    if (!window.liff) throw new Error('LIFF SDK not loaded');
    if (!window._liffInited) {
      await liff.init({ liffId: LIFF_ID_LOCAL, withLoginOnExternalBrowser: true });
      window._liffInited = true;
    }
  }

  // ─── หลัง redirect กลับมา: ตรวจ LIFF login + บันทึก lineUser ──────────────
  async function handleLiffReturn() {
    try {
      await ensureLiff();
      if (!liff.isLoggedIn()) return;

      const profile = await liff.getProfile();
      const { userId, displayName, pictureUrl } = profile;

      // โหลด Firebase
      const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const { getFirestore, doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const { FIREBASE_CONFIG } = await import('../config.js');

      const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
      const db = getFirestore(app);

      // บันทึก lineUsers โดยใช้ userId เป็น key (ไม่ต้องการเบอร์)
      try {
        await setDoc(doc(db, 'lineUsers', userId), {
          userId, displayName,
          pictureUrl: pictureUrl || null,
          lastLogin: Date.now(),
          updatedAt: Date.now()
        }, { merge: true });
      } catch(e) {
        console.warn('lineUsers write error:', e.message);
      }

      // บันทึก customers โดยใช้ line_userId เป็น ID
      try {
        await setDoc(doc(db, 'customers', 'line_' + userId), {
          name: displayName, lineUserId: userId,
          pictureUrl: pictureUrl || null,
          lastLogin: Date.now(), updatedAt: Date.now()
        }, { merge: true });
      } catch(e) {
        console.warn('customers write error:', e.message);
      }

      // save session → login สำเร็จเลย ไม่ต้องกรอกเบอร์
      _saveLiffSession(displayName, userId, pictureUrl);
      closeLoginModal();
      if (typeof updateUserBadge === 'function') updateUserBadge();
      if (typeof showToast === 'function') showToast('ยินดีต้อนรับ ' + displayName + ' 👋');
    } catch(e) {
      console.error('LIFF handleLiffReturn error:', e);
    }
  }

  // เรียกตอนโหลดหน้า (กรณีกลับมาจาก liff.login redirect)
  window.addEventListener('DOMContentLoaded', () => {
    if (location.search.includes('liff.state') || location.search.includes('code=') || location.hash.includes('access_token')) {
      handleLiffReturn();
    }
  });

  // ─── ปุ่ม "เข้าสู่ระบบด้วย LINE" กด ──────────────────────────────────
  window.loginWithLine = async function() {
    const btn = document.querySelector('.im-line-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }
    try {
      await ensureLiff();
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: window.location.href });
        return;
      }
      await handleLiffReturn();
    } catch(e) {
      console.error('loginWithLine error:', e);
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
  };

  // ─── (ไม่ใช้แล้ว — ยกเลิก phone binding) ───────────────────────────
  function _showPhoneBindModal(displayName, pictureUrl) {
    // deprecated: ใช้ LINE userId แทนเบอร์แล้ว
  }
  window.submitLiffPhone = async function() {
    // deprecated
  };

  function _saveLiffSession(name, userId, pictureUrl) {
    sessionStorage.setItem('imkum_user', JSON.stringify({
      role: 'customer', name, lineUserId: userId,
      photoURL: pictureUrl || null, loginAt: Date.now()
    }));
    localStorage.setItem('imkum_name', name);
    localStorage.setItem('imkum_userId', userId);
    localStorage.setItem('imkum_line_linked', 'true');
  }

})();



function openLightbox(src, name) {
  const lb = document.getElementById('img-lightbox');
  document.getElementById('img-lightbox-img').src = src;
  document.getElementById('img-lightbox-name').textContent = name || '';
  lb.style.display = 'flex';
}
function closeLightbox() {
  document.getElementById('img-lightbox').style.display = 'none';
}
document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeLightbox(); });
