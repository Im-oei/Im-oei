const firebaseConfig = {
  apiKey: "AIzaSyBJjzTASSDoezaH2lPTUP1Fn9jS6RR-OUo",
  authDomain: "im-oei.firebaseapp.com",
  projectId: "im-oei",
  storageBucket: "im-oei.firebasestorage.app",
  messagingSenderId: "392812205535",
  appId: "1:392812205535:web:65f6ce114feb3ce035a06a",
  measurementId: "G-0LGSELSP0D"
};

// orders.html — ES module

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, onSnapshot, doc, getDoc, setDoc, addDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { FIREBASE_CONFIG, VAPID_PUBLIC_KEY } from "../config.js";

const sess = sessionStorage.getItem('imkum_user');
if(!sess){ window.location.href='login.html'; throw new Error('no auth'); }
const user = JSON.parse(sess);
// ตรวจ session expiry 8 ชั่วโมง
if(user.loginAt && (Date.now() - user.loginAt > 8*60*60*1000)){
  sessionStorage.clear(); window.location.href='login.html'; throw new Error('session expired');
}
if(user.role==='admin'||user.role==='owner'){ window.location.href='admin.html'; throw new Error('wrong role'); }

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

function showLoading(v){ document.getElementById('loading').classList.toggle('show',v); }
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }

document.getElementById('user-name-display').textContent = user.name||'ลูกค้า';

// ฟอร์แมตเบอร์โทร: 0812345678 → 081-234-5678
function formatPhone(p){
  if(!p) return '-';
  const d = p.replace(/\D/g,'');
  if(d.length===10) return d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6);
  return p;
}
(function(){
  const span = document.getElementById('phone-text');
  if(span) span.textContent = formatPhone(user.phone);
})();

// Role chip
(function(){
  const chip = document.getElementById('role-chip');
  const icon = document.getElementById('role-icon');
  const text = document.getElementById('role-text');
  if(!chip) return;
  const roleMap = {
    customer: { cls:'customer', icon:'👤', label:'ลูกค้า' },
    admin:    { cls:'admin',    icon:'🧑‍🍳', label:'แอดมิน' },
    owner:    { cls:'owner',    icon:'👑', label:'เจ้าของร้าน' },
  };
  const r = roleMap[user.role] || roleMap.customer;
  chip.className = 'profile-role-chip ' + r.cls;
  if(icon) icon.textContent = r.icon;
  if(text) text.textContent = r.label;
})();

// Set hero background ด้วย JS เพื่อให้ path ถูกต้องเสมอ
(function(){
  const hero = document.querySelector('.profile-hero');
  const img = new Image();
  const base = window.location.href.replace(/\/[^/]*$/, '/');
  img.onload = function(){
    hero.style.backgroundImage = `linear-gradient(135deg,rgba(62,32,0,0.82) 0%,rgba(123,63,0,0.75) 60%,rgba(255,140,0,0.7) 100%), url('${img.src}')`;
    hero.style.backgroundSize = 'auto, cover';
    hero.style.backgroundPosition = 'center, center';
  };
  img.src = base + 'hero.webp';
})();

// โหลดรูป profile — ลอง session ก่อน ถ้าไม่มีดึงจาก Firestore
function setAvatarImg(url) {
  if (!url) return;
  const wrap = document.getElementById('profile-avatar-wrap');
  const img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
  img.onerror = function(){ this.remove(); };
  wrap.innerHTML = '';
  wrap.appendChild(img);
}

// รองรับทุก field name ที่อาจบันทึกไว้
const picUrl = user.photoURL || user.picture || user.avatar
  || localStorage.getItem('imkum_line_picture') || '';

if (picUrl) {
  setAvatarImg(picUrl);
} else if (user.lineUserId || user.lineId) {
  // fallback: ดึงจาก Firestore customers collection
  (async () => {
    try {
      const uid = 'line_' + (user.lineUserId || user.lineId);
      const snap = await getDoc(doc(db, 'customers', uid));
      if (snap.exists()) {
        const d = snap.data();
        const url = d.picture || d.photoURL || d.pictureUrl || '';
        if (url) {
          setAvatarImg(url);
          localStorage.setItem('imkum_line_picture', url);
        }
      }
    } catch(e) { console.warn('avatar fetch:', e.message); }
  })();
}

window.doLogout = function(){
  showLogoutModal();
};

const statusMap={pending:'รอรับ',preparing:'กำลังทำ',ready:'พร้อมรับ',done:'รับแล้ว',cancelled:'ยกเลิก'};
const statusCls={pending:'status-pending',preparing:'status-preparing',ready:'status-ready',done:'status-done',cancelled:'status-cancelled'};
const statusIcon={pending:'🟡',preparing:'🔵',ready:'🟢',done:'✅',cancelled:'❌'};

const HISTORY_PREVIEW = 5;
let allHistoryDocs = [];
let historyExpanded = false;

function renderOrders(docs){
  if(!docs.length){
    document.getElementById('active-wrap').innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">ยังไม่มีออเดอร์</div><div class="empty-sub">สั่งอาหารครั้งแรกของคุณได้เลย!</div><a href="index.html" class="empty-btn">🛒 ดูเมนู</a></div>`;
    document.getElementById('history-wrap').innerHTML='';
    return;
  }

  const active = docs.filter(o => ['pending','preparing','ready'].includes(o.status));
  const history = docs.filter(o => ['done','cancelled'].includes(o.status));
  allHistoryDocs = history;

  // === ACTIVE ORDERS (full card) ===
  const activeWrap = document.getElementById('active-wrap');
  const activeCount = document.getElementById('active-count');
  if(active.length){
    activeCount.textContent = active.length; activeCount.style.display='inline';
    activeWrap.innerHTML = active.map(o => renderActiveCard(o)).join('');
  } else {
    activeCount.style.display='none';
    activeWrap.innerHTML = '<div class="sec-header-empty">ไม่มีออเดอร์ที่กำลังดำเนินการ</div>';
  }

  // === HISTORY (compact rows) ===
  const historyCount = document.getElementById('history-count');
  if(history.length){
    historyCount.textContent = history.length; historyCount.style.display='inline';
    renderHistoryRows(historyExpanded ? history : history.slice(0, HISTORY_PREVIEW));
    const btn = document.getElementById('show-more-btn');
    if(history.length > HISTORY_PREVIEW){
      btn.style.display='flex';
      document.getElementById('show-more-text').textContent = historyExpanded ? 'ย่อกลับ' : `ดูทั้งหมด ${history.length} รายการ`;
    } else { btn.style.display='none'; }
  } else {
    historyCount.style.display='none';
    document.getElementById('history-wrap').innerHTML='<div class="sec-header-empty">ยังไม่มีประวัติออเดอร์</div>';
  }

  // === HIGHLIGHT ออเดอร์ที่มาจาก success.html ===
  const highlightId = new URLSearchParams(location.search).get('highlight');
  if (highlightId) {
    setTimeout(() => {
      // หาจาก active cards ก่อน
      const cards = document.querySelectorAll('.order-card');
      for (const card of cards) {
        if (card.dataset.orderId === highlightId || card.innerHTML.includes(highlightId.slice(0,8).toUpperCase())) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.style.outline = '3px solid #FFC107';
          card.style.boxShadow = '0 0 0 6px rgba(255,193,7,0.25)';
          setTimeout(() => { card.style.outline = ''; card.style.boxShadow = ''; }, 3000);
          break;
        }
      }
    }, 600);
  }
}

function renderHistoryRows(list){
  const wrap = document.getElementById('history-wrap');
  wrap.innerHTML = list.map((o,idx) => {
    const dt = o.createdAt?.toDate ? o.createdAt.toDate() : new Date();
    const dateStr = dt.toLocaleDateString('th-TH',{day:'numeric',month:'short'});
    const timeStr = dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    const itemNames = (o.items||[]).map(i=>`${i.name}×${i.qty}`).join(', ');
    const itemsJson = JSON.stringify(o.items||[]).replace(/'/g,"&#39;").replace(/"/g,'&quot;');
    const dotCls = o.status==='done'?'done':'cancelled';
    const detailRows = (o.items||[]).map(i=>`<div class="order-item-row"><span class="order-item-name">${i.name} × ${i.qty}</span><span class="order-item-price">${i.subtotal} ฿</span></div>`).join('');
    // Rating badges
    const ratedItems = (o.items||[]).filter(i => _ratingsCache[`${o.id}_${i.id}`]);
    const allRated = ratedItems.length === (o.items||[]).filter(i=>i.id).length && ratedItems.length > 0;
    const avgStar = ratedItems.length ? (ratedItems.reduce((s,i)=>s+(_ratingsCache[`${o.id}_${i.id}`]?.star||0),0)/ratedItems.length).toFixed(1) : null;
    const starBadge = avgStar ? `<span class="star-badge">⭐ ${avgStar}</span>` : '';
    const rateBtn = o.status==='done' && !allRated ? `<button class="reorder-btn" style="background:linear-gradient(135deg,#FFF8E1,#FFE082);color:#5D3A00;box-shadow:none;border:1.5px solid #FFE082;" onclick="event.stopPropagation();openRatingPopup(${JSON.stringify(o).replace(/"/g,'&quot;')})">⭐ รีวิว</button>` : '';
    return `<div class="history-row" id="hrow-${idx}" onclick="toggleHistoryDetail(${idx})">
      <div class="history-dot ${dotCls}"></div>
      <div class="history-main">
        <div class="history-id">#${o.id.slice(0,8).toUpperCase()} · ${statusMap[o.status]||o.status}${starBadge}</div>
        <div class="history-items">${itemNames}</div>
        <div class="history-detail" id="hdetail-${idx}">
          <div style="padding:8px 0 4px">${detailRows}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;padding-bottom:8px">
            ${rateBtn}
            <button class="reorder-btn" onclick="event.stopPropagation();reorder(${itemsJson})">🔁 สั่งซ้ำ</button>
          </div>
        </div>
      </div>
      <div class="history-right">
        <div class="history-price">${o.total} ฿</div>
        <div class="history-date">${dateStr} ${timeStr}</div>
      </div>
    </div>`;
  }).join('');
}

window.toggleHistoryDetail = function(idx){
  const row = document.getElementById('hrow-'+idx);
  const detail = document.getElementById('hdetail-'+idx);
  const isOpen = detail.classList.contains('open');
  detail.classList.toggle('open', !isOpen);
  row.classList.toggle('expanded', !isOpen);
};

window.showAllHistory = function(){
  historyExpanded = !historyExpanded;
  renderHistoryRows(historyExpanded ? allHistoryDocs : allHistoryDocs.slice(0, HISTORY_PREVIEW));
  document.getElementById('show-more-text').textContent = historyExpanded ? 'ย่อกลับ' : `ดูทั้งหมด ${allHistoryDocs.length} รายการ`;
  const btn = document.getElementById('show-more-btn');
  btn.querySelector('svg').style.transform = historyExpanded ? 'rotate(180deg)' : '';
};

function renderActiveCard(o){
  const dt = o.createdAt?.toDate ? o.createdAt.toDate() : new Date();
  const dateStr = dt.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'});
  const timeStr = dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
  const items = (o.items||[]).map(i=>`<div class="order-item-row"><span class="order-item-name">${i.name} × ${i.qty}</span><span class="order-item-price">${i.subtotal} ฿</span></div>`).join('');
  const itemsJson = JSON.stringify(o.items||[]).replace(/'/g,"&#39;").replace(/"/g,'&quot;');
  const _isPreorder = o.isPreorder === true;
  const _preorderDate = o.preorderDate || '';
  return `<div class="order-card active-order" data-order-id="${o.id}" style="${_isPreorder ? 'border-left:4px solid #764ba2;' : ''}">
    <div class="order-card-head">
      <div>
        <div class="order-id">#${o.id.slice(0,8).toUpperCase()}</div>
        ${_isPreorder ? `<div style="display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;margin-bottom:4px;">📅 สั่งล่วงหน้า${_preorderDate ? ' · '+_preorderDate : ''}</div>` : ''}
        <div class="order-date">🕐 ${dateStr} ${timeStr}</div>
        <div class="order-pickup">⏰ รับ ${o.pickupTime||'07:30'} น.${o.pickupLocationName ? ` &nbsp;|&nbsp; 📍 ${o.pickupLocationName}` : ''}</div>
      </div>
      <span class="status-badge ${statusCls[o.status]||''}">${statusIcon[o.status]||''} ${statusMap[o.status]||o.status}</span>
    </div>
    <div class="order-divider"></div>
    <div class="order-items">${items}</div>
    <div class="order-footer">
      <div><div class="order-total-label">ยอดรวม</div><div class="order-total-val">${o.total} ฿</div></div>
      <button class="reorder-btn" onclick='reorder(${itemsJson})'>🔁 สั่งซ้ำ</button>
    </div>
  </div>`;
}

// ===== REALTIME ORDER LIST (onSnapshot แทน getDocs) =====
let _unsubOrders = null;

function startOrdersRealtime() {
  // รองรับ lineId (field เก่า) และ lineUserId (field ใหม่)
  const lineId = user.lineUserId || user.lineId || '';
  if (!user.phone && !lineId && !user.guestId) { loadOrders(); return; }

  const qField = lineId ? 'lineUserId' : (user.phone ? 'customerPhone' : 'guestId');
  const qValue = lineId || user.phone || user.guestId;
  const q = query(collection(db,'orders'), where(qField,'==', qValue));

  _unsubOrders = onSnapshot(q, async (snap) => {
    let docs = snap.docs.map(d=>({id:d.id,...d.data()}));
    // legacy: ถ้ามี phone ด้วย → merge
    if (user.lineUserId && user.phone) {
      try {
        const q2 = query(collection(db,'orders'), where('customerPhone','==', user.phone));
        const snap2 = await getDocs(q2);
        const extra = snap2.docs.map(d=>({id:d.id,...d.data()})).filter(o=>!docs.find(x=>x.id===o.id));
        docs = [...docs, ...extra];
      } catch(e) {}
    }
    docs.sort((a,b)=>(b.createdAt?.toDate?.()?.getTime?.()??0)-(a.createdAt?.toDate?.()?.getTime?.()??0));
    renderOrders(docs);
    showLoading(false);
  }, (e) => {
    console.warn('onSnapshot error, fallback:', e);
    loadOrders();
  });
}

async function loadOrders(){
  showLoading(true);
  const lineId = user.lineUserId || user.lineId || '';
  try {
    let docs = [];
    if (lineId) {
      const snap = await getDocs(query(collection(db,'orders'), where('lineUserId','==', lineId)));
      docs = snap.docs.map(d=>({id:d.id,...d.data()}));
    }
    if (user.phone) {
      const snap2 = await getDocs(query(collection(db,'orders'), where('customerPhone','==', user.phone)));
      const extra = snap2.docs.map(d=>({id:d.id,...d.data()})).filter(o=>!docs.find(x=>x.id===o.id));
      docs = [...docs, ...extra];
    }
    if (user.guestId && !docs.length) {
      const snap3 = await getDocs(query(collection(db,'orders'), where('guestId','==', user.guestId)));
      const extra = snap3.docs.map(d=>({id:d.id,...d.data()})).filter(o=>!docs.find(x=>x.id===o.id));
      docs = [...docs, ...extra];
    }
    if (!docs.length && !user.phone && !user.lineUserId && !user.guestId) {
      // ไม่มีข้อมูล user เลย
      renderOrders([]);
      showLoading(false);
      return;
    }
    docs.sort((a,b)=>(b.createdAt?.toDate?.()?.getTime?.()??0)-(a.createdAt?.toDate?.()?.getTime?.()??0));
    renderOrders(docs);
  } catch(e){
    console.warn('loadOrders failed:', e);
    const ow=document.getElementById('active-wrap')||document.getElementById('history-wrap');
    if(ow) ow.innerHTML='<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">โหลดไม่ได้</div><div class="empty-sub">กรุณาลองใหม่อีกครั้ง</div></div>';
  } finally { showLoading(false); }
}

window.reorder=function(items){
  if(!items||!items.length){showToast('ไม่พบรายการ');return;}
  let cart={};
  try{cart=JSON.parse(localStorage.getItem('imkum_cart')||'{}');}catch(e){cart={};}
  items.forEach(item=>{if(item.id)cart[item.id]=(cart[item.id]||0)+(item.qty||1);});
  localStorage.setItem('imkum_cart',JSON.stringify(cart));
  showToast('✅ เพิ่มลงตะกร้าแล้ว!');
  setTimeout(()=>{window.location.href='index.html';},1500);
};

let STAMP_GOAL = 10;
let STAMP_REWARD = 'ฟรี 1 เมนู';
let POINTS_PER_BAHT = 20; // 20 บาท = 1 แต้ม (โหลดจาก Firestore)

async function loadStampConfig() {
  try {
    const cfgDoc = await getDoc(doc(db, 'settings', 'stamps'));
    if (cfgDoc.exists()) {
      const s = cfgDoc.data();
      if (s.goal && s.goal > 0) STAMP_GOAL = s.goal;
      if (s.reward) STAMP_REWARD = s.reward;
      if (s.pointsPerBaht && s.pointsPerBaht > 0) POINTS_PER_BAHT = s.pointsPerBaht;
    }
  } catch(e) { console.warn('loadStampConfig:', e); }
}

function renderStampCard(points, lifetimePoints, tierCfg) {
  const grid = document.getElementById('stamps-grid');
  if (!grid) return;
  // แสดง dots ตาม STAMP_GOAL
  let dots = '';
  const sandwichSVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="10" width="20" height="3" rx="1.5" fill="#FFC107"/><rect x="3" y="13" width="18" height="4" rx="2" fill="#F5A623"/><path d="M4 10 Q6 6 12 6 Q18 6 20 10" stroke="#FF8C00" stroke-width="2" stroke-linecap="round" fill="none"/><rect x="5" y="17" width="14" height="2.5" rx="1.25" fill="#FFB300"/></svg>`;
  const emptySVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" opacity="0.35"><rect x="2" y="10" width="20" height="3" rx="1.5" fill="#fff"/><rect x="3" y="13" width="18" height="4" rx="2" fill="#fff"/></svg>`;
  const displayGoal = Math.min(STAMP_GOAL, 20);
  // แปลงแต้มเป็น dots progress ต่อ goal
  const progress = Math.min(points, displayGoal);
  for (let i = 0; i < displayGoal; i++) dots += `<div class="stamp${i < progress ? ' filled' : ''}">${i < progress ? sandwichSVG : emptySVG}</div>`;
  grid.innerHTML = dots;
  document.getElementById('stamp-count-badge').textContent = points + ' แต้ม';
  document.getElementById('stamp-progress').style.width = `${Math.min(100, (progress / displayGoal) * 100)}%`;

  // Tier badge
  if (tierCfg && lifetimePoints >= 0) {
    const tierEl = document.getElementById('tier-badge-top');
    let tier = null;
    if (lifetimePoints >= (tierCfg.platinum || 5000)) tier = { name: 'Platinum', emoji: '💎', color: '#7B1FA2', bg: 'rgba(123,31,162,0.9)' };
    else if (lifetimePoints >= (tierCfg.gold || 2000)) tier = { name: 'Gold', emoji: '🥇', color: '#F57F17', bg: 'rgba(245,127,23,0.9)' };
    else if (lifetimePoints >= (tierCfg.silver || 500)) tier = { name: 'Silver', emoji: '🥈', color: '#546E7A', bg: 'rgba(84,110,122,0.9)' };
    if (tier && tierEl) {
      tierEl.textContent = tier.emoji + ' ' + tier.name;
      tierEl.style.background = tier.bg;
      tierEl.style.color = '#fff';
      tierEl.style.display = 'inline-block';
    }
  }

  document.getElementById('stamp-msg').textContent = `แต้มคงเหลือ ${points} แต้ม · lifetime ${lifetimePoints || points} แต้ม`;

  // Tier Progress Bar
  if (tierCfg) {
    const tiers = [
      { name: 'Silver', emoji: '🥈', min: tierCfg.silver || 500 },
      { name: 'Gold',   emoji: '🥇', min: tierCfg.gold   || 2000 },
      { name: 'Platinum', emoji: '💎', min: tierCfg.platinum || 5000 },
    ];
    const lp = lifetimePoints || points;
    let nextTier = null, prevMin = 0;
    for (const t of tiers) {
      if (lp < t.min) { nextTier = t; break; }
      prevMin = t.min;
    }
    const wrap = document.getElementById('tier-progress-wrap');
    if (wrap) {
      if (nextTier) {
        wrap.style.display = 'block';
        const range = nextTier.min - prevMin;
        const done  = lp - prevMin;
        const pct   = Math.min(100, Math.round((done / range) * 100));
        document.getElementById('tier-progress-label').textContent = `ไปสู่ ${nextTier.name}`;
        document.getElementById('tier-progress-pts').textContent = `${lp.toLocaleString()} / ${nextTier.min.toLocaleString()}`;
        document.getElementById('tier-progress-bar').style.width = pct + '%';
        document.getElementById('tier-progress-need').textContent = (nextTier.min - lp).toLocaleString();
        document.getElementById('tier-progress-next').textContent = nextTier.emoji + ' ' + nextTier.name;
      } else {
        // ถึง Platinum แล้ว
        wrap.style.display = 'block';
        document.getElementById('tier-progress-label').textContent = '💎 Platinum — สูงสุดแล้ว!';
        document.getElementById('tier-progress-pts').textContent = lp.toLocaleString() + ' แต้ม';
        document.getElementById('tier-progress-bar').style.width = '100%';
        document.getElementById('tier-progress-sub').style.display = 'none';
      }
    }
  }

  // Show reward catalog button
  const rewardBtn = document.getElementById('reward-catalog-btn');
  if (rewardBtn) rewardBtn.style.display = 'block';
}


async function loadStamps(){
  await loadStampConfig(); // โหลด goal จาก Firestore ก่อนเสมอ
  if(!user.phone && !user.lineUserId){renderStampCard(0,0,null);return;}
  try{
    const [sd, tierSnap, cfgSnap2] = await Promise.all([
      getDoc(doc(db,'stamps',user.phone)),
      getDoc(doc(db,'settings','tiers')),
      getDoc(doc(db,'settings','stamps')),
    ]);
    const d = sd.exists() ? sd.data() : { points:0, lifetimePoints:0 };
    let points = d.points !== undefined ? d.points : (d.total || 0);
    const lifetimePoints = d.lifetimePoints || points;
    const tierCfg = tierSnap.exists() ? tierSnap.data() : { silver:500, gold:2000, platinum:5000 };
    const expiryDays = cfgSnap2.exists() ? (cfgSnap2.data().expiryDays || 0) : 0;

    // ตรวจแต้มหมดอายุ
    if (expiryDays > 0 && d.updatedAt) {
      const lastUpdate = d.updatedAt.toDate ? d.updatedAt.toDate() : new Date(d.updatedAt);
      const daysSince = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > expiryDays && points > 0) {
        // แต้มหมดอายุ — รีเซ็ตเงียบๆ
        try {
          await updateDoc(doc(db,'stamps',user.phone), { points: 0, expiredAt: serverTimestamp() });
          points = 0;
          showToast('⚠️ แต้มของคุณหมดอายุแล้ว (เกิน ' + expiryDays + ' วัน)');
        } catch(e) { console.warn('expiry reset failed:', e.message); }
      }
    }

    localStorage.setItem('imkum_stamps_' + user.phone, JSON.stringify({ points, lifetimePoints }));
    renderStampCard(points, lifetimePoints, tierCfg);
    window._userPoints = points;
    window._userTierCfg = tierCfg;
  }catch(e){
    try{
      const c = JSON.parse(localStorage.getItem('imkum_stamps_'+user.phone)||'{"points":0,"total":0}');
      renderStampCard(c.points || c.total || 0, c.lifetimePoints || c.points || 0, null);
    } catch { renderStampCard(0,0,null); }
  }
}

startOrdersRealtime();
loadStamps();

// ============================
// ====== CUSTOMER NOTIFICATIONS ======
// ============================

let custAudioCtx = null;
let watchedOrders = {}; // {orderId: lastStatus}
let custSoundEnabled = true;

async function initCustomerNotifications() {
  custSoundEnabled = localStorage.getItem('imkum_sound_cust') !== 'off';

  // Register SW
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch(e) { console.warn('SW reg:', e); }
  }

  // ขออนุญาต notification
  if ('Notification' in window && Notification.permission === 'default') {
    // แสดง banner แทนการขอทันที
    showNotifBanner();
  } else if (Notification.permission === 'granted') {
    // เคยให้สิทธิ์แล้ว → subscribe push ถ้ายังไม่ได้ทำ
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(subscribeToPush);
    }
  }

  // เริ่ม watch orders สำหรับ status change
  startWatchingOrders();
}

function showNotifBanner() {
  if (localStorage.getItem('imkum_notif_dismissed') === '1') return;
  const banner = document.getElementById('notif-request-banner');
  if (banner) banner.style.display = 'flex';
}

// ===== WEB PUSH CONFIG =====
// VAPID_PUBLIC_KEY imported from config.js

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function subscribeToPush(swReg) {
  try {
    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    // บันทึก subscription ลง Firestore ผูกกับ phone
    const subData = sub.toJSON();
    const { setDoc, doc: fsDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await setDoc(fsDoc(db, 'pushSubscriptions', user.phone), {
      phone: user.phone,
      name: user.name || '',
      subscription: subData,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log('✅ Push subscribed');
  } catch(e) {
    console.warn('Push subscribe failed:', e.name, e.message);
    // NotAllowedError = user denied / AbortError = browser ไม่รองรับ
    if (e.name === 'NotAllowedError') {
      showToast('⚠️ การแจ้งเตือนถูกบล็อก กรุณาเปิดในการตั้งค่าเบราว์เซอร์');
    } else if (e.name === 'AbortError') {
      showToast('⚠️ เบราว์เซอร์นี้ไม่รองรับ Web Push');
    }
    // กรณีอื่นๆ (network error ฯลฯ) silent — การแจ้งเตือนแบบปกติยังใช้ได้
  }
}

window.allowNotifications = async function() {
  const banner = document.getElementById('notif-request-banner');
  if (!('Notification' in window)) return;
  try {
    const perm = await Notification.requestPermission();
    if (banner) banner.style.display = 'none';
    if (perm === 'granted') {
      showToast('✅ เปิดการแจ้งเตือนแล้ว!');
      // Subscribe Web Push
      if ('serviceWorker' in navigator) {
        const swReg = await navigator.serviceWorker.ready;
        await subscribeToPush(swReg);
      }
    } else {
      showToast('⚠️ กรุณาอนุญาตการแจ้งเตือนในการตั้งค่าเบราว์เซอร์');
    }
  } catch(e) {
    console.warn('allowNotifications error:', e.message);
    showToast('⚠️ ไม่สามารถเปิดการแจ้งเตือนได้ กรุณาลองใหม่');
  }
};

window.dismissNotifBanner = function() {
  const banner = document.getElementById('notif-request-banner');
  if (banner) banner.style.display = 'none';
  localStorage.setItem('imkum_notif_dismissed', '1');
};

function playCustSound(type) {
  if (!custSoundEnabled) return;
  try {
    if (!custAudioCtx) custAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = custAudioCtx;
    const freqs = type === 'ready' ? [700, 900, 1100] : [500, 650];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.start(t); osc.stop(t + 0.3);
    });
  } catch(e) {} // ตั้งใจ silent — AudioContext อาจถูกบล็อกโดย browser policy; เสียงเป็น feature เสริมไม่ใช่ critical
}

function showCustBrowserNotif(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body, icon: '/logo.webp', badge: '/logo.webp', tag,
      vibrate: [200, 100, 200]
    });
  } catch(e) {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION', title, body, tag, url: '/orders.html'
      });
    }
  }
}

function startWatchingOrders() {
  if (!user.phone && !user.lineUserId) return;
  const qField = user.phone ? 'customerPhone' : 'lineUserId';
  const qValue = user.phone ? user.phone : user.lineUserId;
  const q = query(collection(db,'orders'), where(qField,'==', qValue));
  // real-time listener แทน polling
  onSnapshot(q, (snap) => {
    snap.docs.forEach(d => {
      const o = { id: d.id, ...d.data() };
      const prevStatus = watchedOrders[o.id];
      if (prevStatus && prevStatus !== o.status) {
        // status เปลี่ยน!
        handleStatusChange(o, prevStatus, o.status);
      }
      watchedOrders[o.id] = o.status;
    });
  }, (e) => { console.warn('onSnapshot error:', e); });
}

const statusTH = { pending:'รอรับ', preparing:'กำลังทำ', ready:'พร้อมรับ', done:'รับแล้ว', cancelled:'ยกเลิก' };

function handleStatusChange(order, oldStatus, newStatus) {
  const statusIcon = { pending:'🟡', preparing:'🔵', ready:'🟢', done:'✅', cancelled:'❌' };
  const icon = statusIcon[newStatus] || '📋';
  const statusName = statusTH[newStatus] || newStatus;
  let title = `${icon} ออเดอร์ #${order.id.slice(0,6).toUpperCase()}`;
  let body = `สถานะ: ${statusName}`;

  if (newStatus === 'ready') {
    title = '🟢 อาหารพร้อมแล้ว!';
    body = `มารับได้เลย ⏰ ${order.pickupTime || ''} น.`;
    playCustSound('ready');
  } else if (newStatus === 'preparing') {
    title = '🔵 ร้านกำลังทำอาหาร';
    body = 'ร้านรับออเดอร์แล้ว กำลังเตรียม!';
    playCustSound('update');
  } else if (newStatus === 'cancelled') {
    title = '❌ ออเดอร์ถูกยกเลิก';
    body = 'ออเดอร์ของคุณถูกยกเลิก';
    playCustSound('update');
  } else {
    playCustSound('update');
  }

  showCustBrowserNotif(title, body, 'order-' + order.id);
  showToast(`${icon} ${title}`);
  // onSnapshot จะอัพเดท list อัตโนมัติ — ไม่ต้อง loadOrders() อีก

  // ขึ้น rating popup เมื่อสถานะเป็น "รับแล้ว"
  if (newStatus === 'done') {
    setTimeout(() => openRatingPopup(order), 1200);
  }
}

// ===== RATING SYSTEM =====
let _ratingOrder = null;
let _ratingItemIdx = 0;
let _ratingItemList = []; // [{id, name, subtotal}]
let _selectedStar = 0;
let _ratingsCache = {}; // orderId_itemId → star

// โหลด ratings ที่เคยให้ไว้ (เพื่อแสดงดาวในประวัติ)
async function loadMyRatings() {
  if (!user.phone && !user.lineUserId) return;
  try {
    const field = user.phone ? 'phone' : 'lineUserId';
    const value = user.phone ? user.phone : user.lineUserId;
    const snap = await getDocs(query(collection(db,'ratings'), where(field,'==',value)));
    snap.docs.forEach(d => { _ratingsCache[d.id] = d.data(); });
    // re-render history rows ถ้ามีข้อมูลแล้ว
    if (allHistoryDocs && allHistoryDocs.length) renderHistoryRows(historyExpanded ? allHistoryDocs : allHistoryDocs.slice(0, HISTORY_PREVIEW));
  } catch(e) {
    console.warn('loadMyRatings: โหลดคะแนนรีวิวไม่ได้:', e.code || e.message);
    // _ratingsCache ว่าง → ประวัติยังแสดงได้ แค่ไม่มีดาว — ไม่ต้องแจ้ง user
  }
}

function openRatingPopup(order) {
  const items = (order.items || []).filter(i => i.id);
  if (!items.length) return;
  _ratingOrder = order;
  _ratingItemList = items;
  _ratingItemIdx = 0;
  _selectedStar = 0;
  showRatingItem();
  document.getElementById('rating-overlay').classList.add('show');
}

function showRatingItem() {
  const item = _ratingItemList[_ratingItemIdx];
  if (!item) { closeRatingPopup(); return; }
  const alreadyRated = _ratingsCache[`${_ratingOrder.id}_${item.id}`];

  document.getElementById('rating-item-name').textContent = `${item.name}`;
  document.getElementById('rating-progress').textContent = `${_ratingItemIdx + 1} / ${_ratingItemList.length}`;
  document.getElementById('rating-comment').value = '';
  // แสดงรูปอาหาร
  const imgWrap = document.getElementById('rating-food-img-wrap');
  if (imgWrap) {
    if (item.imgUrl || item.photoURL || item.imageUrl) {
      imgWrap.innerHTML = `<img class="rating-food-img" src="${item.imgUrl||item.photoURL||item.imageUrl}" alt="${item.name}" onerror="this.parentElement.innerHTML='<div class=\\'rating-food-emoji\\'>🍽️</div>'">`;
    } else {
      imgWrap.innerHTML = `<div class="rating-food-emoji">🍽️</div>`;
    }
  }
  _selectedStar = alreadyRated ? alreadyRated.star : 0;
  updateStars(_selectedStar);
  document.getElementById('rating-submit-btn').disabled = _selectedStar === 0;
}

function updateStars(n) {
  document.querySelectorAll('.star-btn').forEach((btn, i) => {
    btn.classList.toggle('lit', i < n);
  });
  _selectedStar = n;
  document.getElementById('rating-submit-btn').disabled = n === 0;
}

window.clickStar = function(n) { updateStars(n); };

window.submitRating = async function() {
  if (_selectedStar === 0) return;
  const item = _ratingItemList[_ratingItemIdx];
  const comment = document.getElementById('rating-comment').value.trim();
  const ratingKey = `${_ratingOrder.id}_${item.id}`;
  try {
    await setDoc(doc(db, 'ratings', ratingKey), {
      orderId: _ratingOrder.id,
      itemId: item.id,
      itemName: item.name,
      star: _selectedStar,
      comment,
      phone: user.phone || '',
      lineUserId: user.lineUserId || '',
      customerName: user.name || '',
      createdAt: serverTimestamp()
    });
    _ratingsCache[ratingKey] = { star: _selectedStar, comment, itemName: item.name };
    showToast(`⭐ ขอบคุณที่รีวิว "${item.name}"!`);
  } catch(e) { console.warn('submitRating:', e); showToast('❌ บันทึกรีวิวไม่ได้'); }

  // ไปรายการถัดไป
  _ratingItemIdx++;
  if (_ratingItemIdx < _ratingItemList.length) {
    _selectedStar = 0;
    showRatingItem();
  } else {
    closeRatingPopup();
    // refresh history badges
    if (allHistoryDocs && allHistoryDocs.length) renderHistoryRows(historyExpanded ? allHistoryDocs : allHistoryDocs.slice(0, HISTORY_PREVIEW));
  }
};

window.skipRating = function() {
  _ratingItemIdx++;
  if (_ratingItemIdx < _ratingItemList.length) { _selectedStar = 0; showRatingItem(); }
  else closeRatingPopup();
};

function closeRatingPopup() {
  document.getElementById('rating-overlay').classList.remove('show');
  _ratingOrder = null;
}
window.openRatingPopup = openRatingPopup;

// ====== REWARD CATALOG ======
window.openRewardCatalog = async function() {
  const overlay = document.getElementById('reward-sheet-overlay');
  const sheet = document.getElementById('reward-sheet');
  overlay.style.pointerEvents = 'all';
  overlay.style.opacity = '1';
  sheet.style.transform = 'translateY(0)';
  document.getElementById('sheet-points-display').textContent = window._userPoints || 0;
  await renderRewardCatalog();
};

window.closeRewardCatalog = function() {
  const overlay = document.getElementById('reward-sheet-overlay');
  const sheet = document.getElementById('reward-sheet');
  overlay.style.opacity = '0';
  sheet.style.transform = 'translateY(100%)';
  setTimeout(() => { overlay.style.pointerEvents = 'none'; }, 300);
};

// Close on overlay click
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('reward-sheet-overlay');
  if (overlay) overlay.addEventListener('click', e => {
    if (e.target === overlay) closeRewardCatalog();
  });
});

async function renderRewardCatalog() {
  const container = document.getElementById('reward-catalog-list');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:30px;color:#999">⏳ กำลังโหลด...</div>';
  try {
    const snap = await getDocs(collection(db, 'rewards'));
    const tierCfg = window._userTierCfg || { silver:500, gold:2000, platinum:5000 };
    const lifetimePts = (() => {
      try { const c = JSON.parse(localStorage.getItem('imkum_stamps_'+user.phone)||'{}'); return c.lifetimePoints||0; } catch { return 0; }
    })();
    const tierRank = lifetimePts >= (tierCfg.platinum||5000) ? 3 : lifetimePts >= (tierCfg.gold||2000) ? 2 : lifetimePts >= (tierCfg.silver||500) ? 1 : 0;
    const reqRank = { none:0, silver:1, gold:2, platinum:3 };
    const allActive = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.active !== false);
    try { localStorage.setItem('imkum_rewards_cache', JSON.stringify(allActive)); } catch(e) {} // ตั้งใจ silent — cache เป็น optional; Private mode อาจบล็อก localStorage
    const rewards = allActive
      .filter(r => tierRank >= (reqRank[r.requiredTier||'none'] || 0))
      .sort((a,b) => (a.pointCost||0) - (b.pointCost||0));
    if (!rewards.length) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;font-size:14px">ยังไม่มีรางวัลในระบบ</div>';
      return;
    }
    const userPoints = window._userPoints || 0;
    const typeLabel = { free_item: '🍽️ เมนูฟรี', discount_percent: '💰 ส่วนลด%', special: '🎁 พิเศษ' };
    container.innerHTML = rewards.map(r => {
      const canRedeem = userPoints >= (r.pointCost || 0);
      return `<div style="background:${canRedeem?'#fff':'#FAFAFA'};border-radius:18px;padding:16px;border:2px solid ${canRedeem?'#FFE082':'#F0F0F0'};transition:all .2s">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="font-size:36px;width:56px;height:56px;display:flex;align-items:center;justify-content:center;background:${canRedeem?'#FFF8E1':'#F5F5F5'};border-radius:14px;flex-shrink:0">${r.emoji||'🎁'}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:800;color:${canRedeem?'#2C2C2C':'#AAA'}">${r.name}</div>
            <div style="font-size:11px;color:#999;margin-top:2px">${typeLabel[r.type]||''}</div>
            ${r.desc ? '<div style="font-size:12px;color:#888;margin-top:3px">'+r.desc+'</div>' : ''}
            <div style="margin-top:6px;display:flex;align-items:center;gap:8px">
              <span style="font-size:14px;font-weight:800;color:${canRedeem?'#FF8C00':'#CCC'}">⭐ ${r.pointCost} แต้ม</span>
              ${!canRedeem ? '<span style="font-size:11px;color:#EF5350;font-weight:700">แต้มไม่พอ</span>' : ''}
            </div>
          </div>
        </div>
        ${canRedeem ? `<button onclick="redeemReward('${r.id}','${r.name.replace(/'/g,'')}',${r.pointCost},'${r.emoji||'🎁'}')"
          style="width:100%;margin-top:12px;padding:12px;border-radius:12px;border:none;background:linear-gradient(135deg,#FF8F00,#FFC107);color:#3E2000;font-family:'Sarabun',sans-serif;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 3px 10px rgba(255,143,0,0.3)">
          🎁 แลกเลย
        </button>` : ''}
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = '<div style="color:#C62828;padding:14px;font-size:13px">โหลดไม่ได้: ' + (e.code||e.message) + '</div>';
  }
}

let _isRedeeming = false; // guard กัน double-submit
window.redeemReward = async function(rewardId, rewardName, pointCost, emoji) {
  if (_isRedeeming) { showToast('กำลังดำเนินการ กรุณารอสักครู่...'); return; }
  const userPoints = window._userPoints || 0;
  if (userPoints < pointCost) { showToast('แต้มไม่เพียงพอ'); return; }

  // ตรวจสอบ maxQty ก่อนแลก
  try {
    const rewardDoc = await getDoc(doc(db, 'rewards', rewardId));
    if (rewardDoc.exists()) {
      const rData = rewardDoc.data();
      if (rData.maxQty > 0) {
        const usedSnap = await getDocs(query(collection(db,'rewardRedemptions'), where('rewardId','==',rewardId)));
        const usedCount = usedSnap.docs.filter(d => d.data().status !== 'rejected').length;
        if (usedCount >= rData.maxQty) { showToast('😢 รางวัลนี้หมดแล้ว'); return; }
      }
    }
  } catch(e) { console.warn('maxQty check:', e.message); }

  if (!confirm('ยืนยันแลก "' + rewardName + '" ใช้ ' + pointCost + ' แต้ม?')) return;
  _isRedeeming = true;
  showLoading(true);
  try {
    // หักแต้ม
    const stampRef = doc(db, 'stamps', user.phone);
    const stampSnap = await getDoc(stampRef);
    const curPoints = stampSnap.exists() ? (stampSnap.data().points || stampSnap.data().total || 0) : 0;
    const newPoints = Math.max(0, curPoints - pointCost);
    await updateDoc(stampRef, { points: newPoints, updatedAt: serverTimestamp() });

    // บันทึก redemption
    await addDoc(collection(db, 'rewardRedemptions'), {
      rewardId,
      rewardName,
      pointsUsed: pointCost,
      emoji,
      phone: user.phone,
      customerName: user.name || '',
      userId: user.userId || '',
      status: 'pending',
      createdAt: serverTimestamp(),
    });

    // Update local state
    window._userPoints = newPoints;
    localStorage.setItem('imkum_stamps_' + user.phone, JSON.stringify({
      points: newPoints,
      lifetimePoints: stampSnap.exists() ? (stampSnap.data().lifetimePoints || 0) : 0
    }));

    closeRewardCatalog();
    showToast('🎉 แลกรางวัลสำเร็จ! รอร้านยืนยัน');
    loadMyRedemptions();
    // Update badge display
    document.getElementById('stamp-count-badge').textContent = newPoints + ' แต้ม';
    document.getElementById('sheet-points-display').textContent = newPoints;
  } catch(e) {
    showToast('❌ แลกไม่สำเร็จ: ' + (e.code||e.message));
  } finally {
    _isRedeeming = false;
    showLoading(false);
  }
};


// ====== LOAD MY REDEMPTIONS ======
async function loadMyRedemptions() {
  const wrap = document.getElementById('redemption-wrap');
  const countEl = document.getElementById('redemption-count');
  if (!wrap) return;
  try {
    const q = query(
      collection(db, 'rewardRedemptions'),
      where('phone', '==', user.phone || '')
    );
    const snap = await getDocs(q);
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const tb = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return tb - ta;
      });
    if (!items.length) {
      wrap.innerHTML = '<div class="sec-header-empty">ยังไม่เคยแลกรางวัล</div>';
      return;
    }
    if (countEl) { countEl.textContent = items.length; countEl.style.display = 'inline-block'; }
    const statusConfig = {
      pending:  { label: '⏳ รอร้านยืนยัน', bg: '#FFF3E0', color: '#E65100' },
      approved: { label: '✅ ยืนยันแล้ว',   bg: '#E8F5E9', color: '#2E7D32' },
      rejected: { label: '❌ ไม่อนุมัติ',   bg: '#FFEBEE', color: '#B71C1C' },
    };
    wrap.innerHTML = items.map(item => {
      const cfg = statusConfig[item.status] || statusConfig.pending;
      const d = item.createdAt?.toDate ? item.createdAt.toDate() : new Date(item.createdAt || 0);
      const dateStr = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
      return `<div style="margin:0 12px 10px;background:#fff;border-radius:18px;padding:14px 16px;box-shadow:0 2px 10px rgba(0,0,0,0.06);border:1.5px solid #F0E8D8;display:flex;align-items:center;gap:12px">
        <div style="font-size:32px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;background:#FFF8E1;border-radius:14px;flex-shrink:0">${item.emoji || '🎁'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:800;color:#2C2C2C">${item.rewardName || 'รางวัล'}</div>
          <div style="font-size:12px;color:#FF8C00;font-weight:700;margin-top:3px">⭐ ${item.pointsUsed || 0} แต้ม</div>
          <div style="font-size:11px;color:#BBB;margin-top:3px">${dateStr}</div>
        </div>
        <span style="background:${cfg.bg};color:${cfg.color};font-size:11px;font-weight:800;padding:5px 10px;border-radius:10px;white-space:nowrap;flex-shrink:0">${cfg.label}</span>
      </div>`;
    }).join('');
  } catch(e) {
    console.warn('loadMyRedemptions:', e.message);
    wrap.innerHTML = '<div class="sec-header-empty">โหลดไม่ได้</div>';
  }
}

// เริ่มระบบ
initCustomerNotifications();
loadMyRatings();
loadMyRedemptions();

