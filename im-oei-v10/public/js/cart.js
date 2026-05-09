// cart.html — plain scripts

// ===== AUTH CHECK =====
(function(){
  var sess = sessionStorage.getItem('imkum_user');
  if(!sess){ window.location.href = 'login.html'; return; }
  try {
    var user = JSON.parse(sess);
    // ตรวจ session expiry 8 ชั่วโมง
    if(user.loginAt && (Date.now() - user.loginAt > 8*60*60*1000)){
      sessionStorage.clear(); window.location.href = 'login.html'; return;
    }
    if(user.role === 'admin' || user.role === 'owner'){
      window.location.href = 'admin.html'; return;
    }
    if(user.name) localStorage.setItem('imkum_name', user.name);
    if(user.phone) localStorage.setItem('imkum_phone', user.phone);
  } catch(e) { sessionStorage.clear(); window.location.href = 'login.html'; }
})();

// ===== PREORDER =====
var isPreorder = localStorage.getItem('imkum_preorder') === '1';
var preorderDate = localStorage.getItem('imkum_preorder_date') || '';
if (isPreorder) {
  var ind = document.getElementById('preorder-indicator');
  ind.classList.add('show');
  document.getElementById('preorder-date-text').textContent = '📅 สั่งล่วงหน้า: '+preorderDate;
}
function cancelPreorder() {
  if(!confirm('ยกเลิกโหมดสั่งล่วงหน้า?')) return;
  localStorage.removeItem('imkum_preorder');
  localStorage.removeItem('imkum_preorder_date');
  isPreorder = false;
  document.getElementById('preorder-indicator').classList.remove('show');
  renderCart();
  showToast('กลับสู่การสั่งปกติ');
}

// ===== PICKUP LOCATIONS =====
// จุดรับอาหาร — โหลดจาก Firestore (fallback hardcode ถ้าไม่มีข้อมูล)
var PICKUP_LOCATIONS = [
  { id:'main', name:'ร้านอิ่มเอ๋ย (หลัก)', desc:'หน้าร้านชั้น 1', icon:'🏪', mapUrl:'' }
];
var selectedLocation = localStorage.getItem('imkum_location') || '';

function loadPickupLocations(db) {
  // Use getDocs via module - stored in window after module loads
  window._pickupDb = db;
  // Will be called from module after it loads
}
function _execLoadPickup(db, getDocs, collection) {
  getDocs(collection(db, 'pickupLocations')).then((snap) => {
    if (!snap.empty) {
      PICKUP_LOCATIONS = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      if (!PICKUP_LOCATIONS.find(l => l.id === selectedLocation)) {
        selectedLocation = PICKUP_LOCATIONS[0]?.id || '';
        localStorage.setItem('imkum_location', selectedLocation);
      }
    }
    if (document.getElementById('cart-body')) renderCart();
  }).catch(e => {
    // ตั้งใจ silent — ถ้าโหลด pickupLocations ไม่ได้ ใช้ค่า default PICKUP_LOCATIONS แทน
    console.warn('loadPickupLocations: ใช้จุดรับอาหาร default:', e.code || e.message);
  });
}
function selectLocation(id) {
  selectedLocation = id;
  localStorage.setItem('imkum_location', id);
  document.querySelectorAll('.location-card').forEach(function(el) {
    el.classList.toggle('selected', el.dataset.locId === id);
  });
}

var MENU = [
  { category:"🥪 แซนวิช", catKey:"sandwich", items:[
    { id:"tuna",name:"ปูอัดทูน่า",desc:"ปูอัด, ทูน่า, ผักสลัด",emoji:"🥪",price:20},
    { id:"pork_salad",name:"หมูหยองสลัด",desc:"หมูหยอง, สลัด, มายองเนส",emoji:"🥙",price:20},
    { id:"egg_sausage",name:"ไข่ดาวไส้กรอก",desc:"ไข่ดาว, ไส้กรอก, ซอส",emoji:"🍳",price:20},
    { id:"shrimp",name:"ไข่กุ้งสาหร่าย",desc:"ไข่กุ้ง, สาหร่าย, มายองเนส",emoji:"🍤",price:20},
  ]},
  { category:"🍚 ข้าว", catKey:"rice", items:[
    { id:"chicken_rice",name:"ข้าวไก่อบ",desc:"ไก่อบ, ไข่ต้ม, ผัก",emoji:"🍗",price:50},
    { id:"chicken_lime",name:"ข้าวไก่อบมะนาว",desc:"ไก่มะนาว, ข้าว, ผัก",emoji:"🍋",price:50},
  ]},
  { category:"🍜 หมี่", catKey:"noodle", items:[
    { id:"chicken_noodle",name:"หมี่ไก่ฉีก",desc:"หมี่เหลือง, ไก่ฉีก, น้ำซุป",emoji:"🍜",price:50},
    { id:"pork_noodle",name:"หมี่หมูแดง",desc:"หมี่, หมูแดง, ไข่ต้ม",emoji:"🥢",price:50},
  ]}
];
var ALL_ITEMS = [].concat.apply([], MENU.map(function(c){ return c.items; }));
var STORE_SETTINGS = { pickupStart:'07:00', pickupEnd:'08:00' };
var STAMP_GOAL = 10;
var POINTS_PER_BAHT = 20; // 20 บาท = 1 แต้ม (โหลดจาก Firestore)

var cart = JSON.parse(localStorage.getItem('imkum_cart') || '{}');
// Cache ราคา กรณี ALL_ITEMS ยังไม่ sync จาก Firestore
var cartPriceCache = JSON.parse(localStorage.getItem('imkum_cart_prices') || '{}');
function saveCart(){
  localStorage.setItem('imkum_cart', JSON.stringify(cart));
  ALL_ITEMS.forEach(function(i){ cartPriceCache[i.id] = i.price; });
  localStorage.setItem('imkum_cart_prices', JSON.stringify(cartPriceCache));
}
function showToast(msg){ var t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(function(){ t.classList.remove('show'); },2200); }
function showLoading(v){ document.getElementById('loading').classList.toggle('show',v); }

function foodImg(item){
  if(item.imageUrl) return '<img src="'+item.imageUrl+'" alt="'+item.name+'" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">';
  return item.emoji||'🍽️';
}

function getItemPrice(id){
  var item=ALL_ITEMS.filter(function(i){ return i.id===id; })[0];
  if(item) return item.price;
  return cartPriceCache[id] || 0;
}

function getTotal(){
  var sum=0;
  Object.keys(cart).forEach(function(id){
    sum += getItemPrice(id) * cart[id];
  });
  return sum;
}

function generateTimeSlots(start, end, nextDay) {
  var slots=[], parts=start.split(':'), sh=+parts[0], sm=+parts[1];
  var ep=end.split(':'), eh=+ep[0], em=+ep[1];
  var prefix = nextDay ? '(พรุ่งนี้) ' : '';
  while(sh*60+sm <= eh*60+em){
    var label = prefix+(sh<10?'0':'')+sh+':'+(sm<10?'0':'')+sm;
    var val = (nextDay?'next:':'')+(sh<10?'0':'')+sh+':'+(sm<10?'0':'')+sm;
    slots.push({label,val});
    sm+=15; if(sm>=60){ sm-=60; sh++; }
  }
  return slots;
}

// Stamp card info
function getStampInfo() {
  var u; try { u = JSON.parse(sessionStorage.getItem('imkum_user')||'null'); } catch { u = null; }
  if (!u || !u.phone) return null;
  var key = 'imkum_stamps_' + u.phone;
  try { var s = JSON.parse(localStorage.getItem(key) || '{"count":0,"total":0}'); return s; } catch { return null; }
}

function renderCart(){
  var body=document.getElementById('cart-body');
  var entries=Object.keys(cart).filter(function(id){ return cart[id]>0; });
  if(!entries.length){
    body.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:12px;color:#999"><div style="font-size:60px;opacity:.4">🛒</div><div style="font-size:15px">ยังไม่มีรายการ</div><a href="index.html" style="margin-top:8px;background:var(--yellow);color:#3E2000;font-weight:800;padding:12px 28px;border-radius:14px;text-decoration:none;font-size:15px">เลือกเมนู</a></div>';
    return;
  }

  var slots = generateTimeSlots(
    STORE_SETTINGS.pickupStart||'07:00',
    STORE_SETTINGS.pickupEnd||'08:00',
    isPreorder
  );
  var timeHTML = slots.map(function(s){ return '<option value="'+s.val+'">'+s.label+' น.</option>'; }).join('');
  var savedName = (function(){ try { var u=JSON.parse(sessionStorage.getItem('imkum_user')||'null'); return (u&&u.name)||localStorage.getItem('imkum_name')||''; } catch(e){ return localStorage.getItem('imkum_name')||''; } })();

  // Points earn notice (20 บาท = 1 แต้ม)
  var stampInfo = getStampInfo();
  var stampHTML = '';
  var currentTotal = getTotal();
  var earnThisOrder = Math.floor(currentTotal / POINTS_PER_BAHT);
  if (stampInfo !== null) {
    var currentPoints = stampInfo.points !== undefined ? stampInfo.points : (stampInfo.total || 0);
    var afterPoints = currentPoints + earnThisOrder;
    // ดึง cached rewards เพื่อหาว่าเกือบแลกได้อะไร
    var nearReward = '';
    try {
      var cachedRewards = JSON.parse(localStorage.getItem('imkum_rewards_cache') || '[]');
      var reachable = cachedRewards.filter(function(r){ return r.active !== false && afterPoints >= r.pointCost; });
      var almost   = cachedRewards.filter(function(r){ return r.active !== false && afterPoints < r.pointCost && r.pointCost <= afterPoints + 200; });
      if (reachable.length) {
        nearReward = '<div style="margin-top:6px;font-size:12px;color:#2E7D32;font-weight:700">🎁 แลกได้แล้ว: ' + reachable.map(function(r){return (r.emoji||'🎁')+' '+r.name;}).join(', ') + '</div>';
      } else if (almost.length) {
        var r = almost[0];
        nearReward = '<div style="margin-top:6px;font-size:12px;color:#F57F17;font-weight:700">✨ อีก '+(r.pointCost - afterPoints)+' แต้มแลก '+(r.emoji||'🎁')+' '+r.name+'!</div>';
      }
    } catch(e) { console.warn('rewards cache parse failed:', e.message); /* ใช้ค่า default nearReward = '' */ }
    stampHTML = '<div class="stamp-earn-box"><span class="icon">⭐</span><div class="text">'+
      'แต้มของคุณ: <b>'+currentPoints+'</b> แต้ม' +
      (earnThisOrder > 0 ? ' &nbsp;+&nbsp; <b>'+earnThisOrder+'</b> แต้มจากออเดอร์นี้' : '') +
      (earnThisOrder > 0 ? ' <span style="color:rgba(255,255,255,0.7)">(รวม '+afterPoints+')</span>' : '') +
      nearReward +
    '</div></div>';
  }

  var html='';
  MENU.forEach(function(cat){
    var catItems=cat.items.filter(function(i){ return cart[i.id]>0; });
    if(!catItems.length) return;
    html+='<div class="cart-section-title">'+cat.category+'</div>';
    catItems.forEach(function(item){
      var qty=cart[item.id];
      var price=getItemPrice(item.id);
      html+='<div class="cart-item">'+
        '<div class="food-img">'+foodImg(item)+'</div>'+
        '<div class="item-info"><div class="item-name">'+item.name+'</div><div class="item-unit-price">'+price+' บาท</div></div>'+
        '<div class="qty">'+
          '<button class="btn" onclick="cartRemove(\''+item.id+'\')">−</button>'+
          '<span class="qty-num" id="cqty-'+item.id+'">'+qty+'</span>'+
          '<button class="btn plus" onclick="cartAdd(\''+item.id+'\')">+</button>'+
        '</div>'+
        '<div class="item-subtotal" id="csub-'+item.id+'">'+price*qty+' บาท</div>'+
      '</div>';
    });
  });

  var pickupLabel = isPreorder ? '📅 เวลารับอาหาร (พรุ่งนี้)' : '🕐 เวลารับอาหาร';

  html += stampHTML +
    '<div class="note-section" style="padding-top:14px"><label>ชื่อผู้สั่ง</label><input type="text" class="name-input" id="name-input" placeholder="กรอกชื่อของคุณ" value="'+savedName+'"></div>'+
    '<div class="pickup-row" style="flex-direction:column;align-items:flex-start;gap:8px;padding:14px 16px">'+
      '<div style="display:flex;align-items:center;gap:8px"><span class="clock">🕐</span><span style="font-size:14px;font-weight:700">'+pickupLabel+'</span></div>'+
      '<select class="pickup-select" id="pickup-select">'+timeHTML+'</select>'+
    '</div>'+
    buildLocationSection()+
    '<div class="note-section"><label>หมายเหตุ (ถ้ามี)</label><textarea id="note-input" rows="3" maxlength="200" placeholder="เช่น ไม่ใส่พริก, เพิ่มผัก"></textarea></div>'+
    '<div class="total-row"><span class="total-label">รวมทั้งหมด</span><span><span class="total-amount" id="cart-total">'+getTotal()+'</span><span class="total-unit">บาท</span></span></div>'+
    '<div class="confirm-btn-wrap"><button class="confirm-btn" onclick="checkout()">ยืนยันการสั่งซื้อ</button></div>';

  body.innerHTML=html;
}

function buildLocationSection() {
  var html = '<div class="location-section"><div class="location-label">📍 เลือกจุดรับอาหาร</div><div class="location-cards">';
  PICKUP_LOCATIONS.forEach(function(loc) {
    var sel = selectedLocation === loc.id ? ' selected' : '';
    html += '<div class="location-card'+sel+'" data-loc-id="'+loc.id+'" onclick="selectLocation(\''+loc.id+'\')">'+
      '<div class="loc-icon">'+loc.icon+'</div>'+
      '<div class="loc-info">'+
        '<div class="loc-name">'+loc.name+'</div>'+
        '<div class="loc-desc">'+loc.desc+'</div>'+
        '<a class="loc-map" href="'+loc.mapUrl+'" target="_blank" onclick="event.stopPropagation()">🗺️ ดูแผนที่</a>'+
      '</div>'+
      '<div class="loc-radio"></div>'+
    '</div>';
  });
  html += '</div></div>';
  return html;
}

function cartAdd(id){
  var price=getItemPrice(id);
  if(!price) return;
  cart[id]=(cart[id]||0)+1; saveCart();
  document.getElementById('cqty-'+id).textContent=cart[id];
  document.getElementById('csub-'+id).textContent=price*cart[id]+' บาท';
  document.getElementById('cart-total').textContent=getTotal();
}
function cartRemove(id){
  if(!cart[id]) return;
  var price=getItemPrice(id);
  cart[id]--;
  if(!cart[id]){ delete cart[id]; saveCart(); renderCart(); return; }
  saveCart();
  document.getElementById('cqty-'+id).textContent=cart[id];
  document.getElementById('csub-'+id).textContent=price*cart[id]+' บาท';
  document.getElementById('cart-total').textContent=getTotal();
}
function clearCart(){
  if(!confirm('ล้างตะกร้าทั้งหมดใช่ไหม?')) return;
  cart={}; saveCart(); renderCart();
}

// Stub: module script โหลดช้ากว่า inline onclick
// window.checkout จะถูก override โดย <script type="module"> ด้านล่าง
window.checkout = function() {
  showToast('กำลังโหลด กรุณารอสักครู่...');
};
window.placeOrder = window.checkout;

renderCart();



function showCartLoginPrompt(){
  document.getElementById('cart-login-modal').classList.add('open');
  var saved = localStorage.getItem('imkum_name') || '';
  var savedPhone = localStorage.getItem('imkum_phone') || '';
  if(saved) document.getElementById('cl-name').value = saved;
  if(savedPhone) document.getElementById('cl-phone').value = savedPhone;
  setTimeout(function(){ document.getElementById('cl-name').focus(); }, 300);
}
function closeCartLogin(){
  document.getElementById('cart-login-modal').classList.remove('open');
  document.getElementById('cl-error').style.display='none';
}
function submitCartLogin(){
  var name = document.getElementById('cl-name').value.trim();
  var phone = document.getElementById('cl-phone').value.trim();
  var err = document.getElementById('cl-error');
  if(!name){ err.textContent='กรุณากรอกชื่อ'; err.style.display='block'; return; }
  if(!phone || phone.length < 9){ err.textContent='กรุณากรอกเบอร์โทรให้ครบ'; err.style.display='block'; return; }
  err.style.display='none';
  // ตรวจสอบเบอร์ซ้ำจาก localStorage
  var savedPhone = localStorage.getItem('imkum_phone');
  var savedName = localStorage.getItem('imkum_name');
  if (savedPhone && savedPhone === phone && savedName && savedName !== name) {
    err.textContent = 'เบอร์ ' + phone + ' ถูกใช้โดย "' + savedName + '" แล้ว กรุณาตรวจสอบชื่อ';
    err.style.display='block'; return;
  }
  sessionStorage.setItem('imkum_user', JSON.stringify({ role:'customer', name, phone, loginAt: Date.now() }));
  localStorage.setItem('imkum_name', name);
  localStorage.setItem('imkum_phone', phone);
  closeCartLogin();
  showToast('ยินดีต้อนรับ '+name+' 👋');
  // Try place order again
  setTimeout(function(){ window.placeOrder && window.placeOrder(); }, 800);
}
