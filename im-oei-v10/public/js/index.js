
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
    const u = JSON.parse(localStorage.getItem('imkum_user')||'null');
    if (u && u.loginAt && (Date.now() - u.loginAt > 8*60*60*1000)) {
      localStorage.removeItem("imkum_user"); return null; // หมดอายุ
    }
    return u;
  } catch(e){ return null; }
}
// ====== ADMIN STORE BAR ======
function initAdminBar() {
  try {
    var u = JSON.parse(localStorage.getItem('imkum_user') || 'null');
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
  if(!u){ window.location.href='login.html'; return; }
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
  if(!getUser()){ window.location.href='login.html'; return; }
  cart[id]=(cart[id]||0)+1; saveCart(); render();
  showToast('เพิ่ม '+item.name+' ลงตะกร้า 🛒');
  // ── Fly-to-cart animation ──
  var btn = document.querySelector('[onclick="add(\''+id+'\')"]') ||
            document.querySelector('button.plus[onclick*="'+id+'"]') ||
            document.querySelector('button.fc-add[onclick*="'+id+'"]');
  flyToCart(item, btn);
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
  if(item.imageUrl) return '<img src="'+item.imageUrl+'" alt="'+item.name+'" loading="lazy" onclick="viewImg(\''+item.imageUrl+'\',\''+item.name+'\')" style="cursor:zoom-in" onerror="this.style.display=\'none\'">';
  return '<span style="font-size:32px">'+(item.emoji||'🍽️')+'</span>';
}

// Light box ดูรูปเมนู
function viewImg(url, name){
  var ov = document.getElementById('img-lightbox');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'img-lightbox';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;cursor:zoom-out';
    ov.innerHTML = '<img id="img-lightbox-img" style="max-width:100%;max-height:80vh;border-radius:16px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,0.5)">'
      + '<div id="img-lightbox-name" style="color:#fff;font-family:Prompt,sans-serif;font-size:16px;font-weight:700;margin-top:14px;text-align:center"></div>'
      + '<div style="color:rgba(255,255,255,0.5);font-size:12px;margin-top:6px">แตะเพื่อปิด</div>';
    ov.addEventListener('click', function(){ ov.style.display='none'; });
    document.body.appendChild(ov);
  }
  document.getElementById('img-lightbox-img').src = url;
  document.getElementById('img-lightbox-name').textContent = name;
  ov.style.display = 'flex';
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
// ====== FEATURED CAROUSEL (Phase 4: auto-scroll + swipe) ======
var _featTimer = null;
var _featIdx   = 0;

function buildFeatured(){
  var wrap = document.getElementById('featured-row');
  if (!wrap) return;

  var items = FEATURED_IDS.map(function(fid){
    return ALL_ITEMS.filter(function(i){ return i.id===fid; })[0];
  }).filter(function(i){ return i && !i.hidden; });

  if (!items.length) { wrap.innerHTML=''; return; }

  // สร้าง cards
  var cards = items.map(function(item){
    return '<div class="featured-card">'+
      '<div class="badge">BEST</div>'+
      '<div class="fc-img">'+foodImg(item)+'</div>'+
      '<div class="fc-info">'+
        '<div class="fc-name">'+item.name+'</div>'+
        '<div class="fc-price">'+item.price+' บาท</div>'+
      '</div>'+
      '<button class="fc-add" onclick="add(\''+item.id+'\')">+</button>'+
    '</div>';
  }).join('');

  // dots
  var dots = items.map(function(_,i){
    return '<div class="fc-dot'+(i===0?' active':'')+'"></div>';
  }).join('');

  wrap.innerHTML =
    '<div class="fc-track" id="fc-track">'+cards+'</div>'+
    (items.length > 1 ? '<div class="fc-dots" id="fc-dots">'+dots+'</div>' : '');

  if (items.length <= 1) return;

  var track   = document.getElementById('fc-track');
  var dotsEl  = document.getElementById('fc-dots');
  _featIdx = 0;

  function goTo(n) {
    _featIdx = (n + items.length) % items.length;
    // scroll to card
    var card = track.children[_featIdx];
    if (card) {
      track.scrollTo({ left: card.offsetLeft - 16, behavior: 'smooth' });
    }
    // update dots
    var dotEls = dotsEl.children;
    for (var i=0; i<dotEls.length; i++) {
      dotEls[i].classList.toggle('active', i === _featIdx);
    }
  }

  // auto-scroll ทุก 3.5 วิ
  if (_featTimer) clearInterval(_featTimer);
  _featTimer = setInterval(function(){ goTo(_featIdx + 1); }, 3500);

  // swipe touch
  var _sx = 0, _sy = 0;
  track.addEventListener('touchstart', function(e){
    _sx = e.touches[0].clientX;
    _sy = e.touches[0].clientY;
  }, { passive: true });
  track.addEventListener('touchend', function(e){
    var dx = e.changedTouches[0].clientX - _sx;
    var dy = e.changedTouches[0].clientY - _sy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      clearInterval(_featTimer);
      goTo(dx < 0 ? _featIdx + 1 : _featIdx - 1);
      _featTimer = setInterval(function(){ goTo(_featIdx + 1); }, 3500);
    }
  }, { passive: true });

  // swipe mouse (desktop)
  var _mx = 0, _dragging = false;
  track.addEventListener('mousedown', function(e){ _mx = e.clientX; _dragging = true; });
  track.addEventListener('mouseup', function(e){
    if (!_dragging) return; _dragging = false;
    var dx = e.clientX - _mx;
    if (Math.abs(dx) > 40) {
      clearInterval(_featTimer);
      goTo(dx < 0 ? _featIdx + 1 : _featIdx - 1);
      _featTimer = setInterval(function(){ goTo(_featIdx + 1); }, 3500);
    }
  });
  track.addEventListener('mouseleave', function(){ _dragging = false; });

  // dot click
  Array.prototype.forEach.call(dotsEl.children, function(d, i){
    d.addEventListener('click', function(){
      clearInterval(_featTimer);
      goTo(i);
      _featTimer = setInterval(function(){ goTo(_featIdx + 1); }, 3500);
    });
  });

  // pause on hover
  track.addEventListener('mouseenter', function(){ clearInterval(_featTimer); });
  track.addEventListener('mouseleave', function(){
    _featTimer = setInterval(function(){ goTo(_featIdx + 1); }, 3500);
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




// ── FLY TO CART ──────────────────────────────────────────────────────────────
function flyToCart(item, triggerEl) {
  // หา target: ไอคอนตะกร้าใน nav
  var cartEl = document.getElementById('cart-count') || document.querySelector('.nav-cart');
  if (!cartEl) return;

  // สร้าง flying element
  var fly = document.createElement('div');
  fly.className = 'fly-item';

  // ใส่รูปหรือ emoji
  if (item.imageUrl) {
    var img = document.createElement('img');
    img.src = item.imageUrl;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
    fly.appendChild(img);
  } else {
    fly.textContent = item.emoji || '🍽️';
    fly.style.fontSize = '28px';
    fly.style.display = 'flex';
    fly.style.alignItems = 'center';
    fly.style.justifyContent = 'center';
  }

  // หา start position: จากปุ่มที่กด หรือตำแหน่ง trigger
  var startRect;
  if (triggerEl) {
    startRect = triggerEl.getBoundingClientRect();
  } else {
    // fallback: กลางหน้าจอ
    startRect = { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
  }
  var endRect = cartEl.getBoundingClientRect();

  var startX = startRect.left + startRect.width / 2;
  var startY = startRect.top + startRect.height / 2;
  var endX   = endRect.left + endRect.width / 2;
  var endY   = endRect.top  + endRect.height / 2;

  fly.style.left = startX + 'px';
  fly.style.top  = startY + 'px';
  document.body.appendChild(fly);

  // Force reflow
  fly.getBoundingClientRect();

  // Animate
  var dx = endX - startX;
  var dy = endY - startY;
  // Arc control point (ลอยขึ้นก่อนแล้วค่อยวิ่งลงหาตะกร้า)
  var duration = 620;
  var startTime = null;

  function easeInOutCubic(t){ return t<0.5?4*t*t*t:(t-1)*(2*t-2)*(2*t-2)+1; }
  function easeIn(t){ return t*t*t; }

  function step(ts) {
    if (!startTime) startTime = ts;
    var elapsed = ts - startTime;
    var progress = Math.min(elapsed / duration, 1);
    var ease = easeInOutCubic(progress);

    // Quadratic bezier arc: P0→P1(arc peak)→P2(cart)
    var arcPeakX = startX + dx * 0.3;
    var arcPeakY = startY - Math.abs(dy) * 0.5 - 80;
    var cx = (1-ease)*(1-ease)*startX + 2*(1-ease)*ease*arcPeakX + ease*ease*endX;
    var cy = (1-ease)*(1-ease)*startY + 2*(1-ease)*ease*arcPeakY + ease*ease*endY;

    var scale = 1 - easeIn(progress) * 0.7; // หดจาก 1 → 0.3
    fly.style.transform = 'translate(-50%,-50%) scale('+scale+')';
    fly.style.left = cx + 'px';
    fly.style.top  = cy + 'px';
    fly.style.opacity = progress > 0.8 ? (1 - (progress-0.8)/0.2) : 1;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      fly.remove();
      // Bounce cart icon
      cartEl.classList.add('cart-bounce');
      setTimeout(function(){ cartEl.classList.remove('cart-bounce'); }, 400);
    }
  }
  requestAnimationFrame(step);
}

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
