
// index.html — ES module (Firebase + Firestore sync)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { FIREBASE_CONFIG } from "../config.js";

// ====== PROMO SLIDER ======
let sliderTimer = null;
function buildPromoSlider(banners) {
  const wrap = document.getElementById('promo-slider-wrap');
  if (!banners || !banners.length) { wrap.innerHTML = ''; return; }
  let idx = 0;
  const slides = banners.map((b) => {
    const imgTag = b.imageUrl ? `<img src="${b.imageUrl}" alt="${b.title||''}">` : '';
    const hasText = b.title || b.subtitle;
    return `<div class="promo-slide">${imgTag}${hasText ? `<div class="promo-text-overlay"><div class="promo-title">${b.title||''}</div><div class="promo-sub">${b.subtitle||''}</div></div>` : ''}</div>`;
  }).join('');
  const dots = banners.map((_,i) => `<div class="promo-dot${i===0?' active':''}" id="pdot-${i}"></div>`).join('');
  wrap.innerHTML = `<div class="promo-slider"><div class="promo-slides" id="promo-slides">${slides}</div><div class="promo-dots">${dots}</div></div>`;
  function goTo(n) {
    idx = (n + banners.length) % banners.length;
    document.getElementById('promo-slides').style.transform = `translateX(-${idx*100}%)`;
    wrap.querySelectorAll('.promo-dot').forEach((d,i) => d.classList.toggle('active', i===idx));
  }
  if (banners.length > 1) {
    if (sliderTimer) clearInterval(sliderTimer);
    sliderTimer = setInterval(() => goTo(idx + 1), 3500);

    // swipe gesture
    const slidesEl = document.getElementById('promo-slides');
    let _sx = 0;
    slidesEl.addEventListener('touchstart', e => { _sx = e.touches[0].clientX; }, { passive: true });
    slidesEl.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - _sx;
      if (Math.abs(dx) > 40) {
        clearInterval(sliderTimer);
        goTo(dx < 0 ? idx + 1 : idx - 1);
        sliderTimer = setInterval(() => goTo(idx + 1), 3500);
      }
    }, { passive: true });

    // กด dot หยุด auto แล้วเริ่มใหม่
    wrap.querySelectorAll('.promo-dot').forEach((d, i) => {
      d.addEventListener('click', () => {
        clearInterval(sliderTimer);
        goTo(i);
        sliderTimer = setInterval(() => goTo(idx + 1), 3500);
      });
    });
  }
}

async function syncFirestore(){
  try {
    const app=initializeApp(FIREBASE_CONFIG);
    const db=getFirestore(app);
    const sDoc=await getDoc(doc(db,'settings','store'));
    if(sDoc.exists()){
      const s=sDoc.data();
      if(s.orderCutoff) document.getElementById('cutoff-text').textContent='รับออเดอร์ถึง '+s.orderCutoff+' น.';
      if(s.pickupStart&&s.pickupEnd) document.getElementById('pickup-text').textContent='รับอาหาร '+s.pickupStart+' - '+s.pickupEnd+' น.';
      if(s.bannerUrl) document.getElementById('banner-section').innerHTML='<div class="banner-img-wrap"><img src="'+s.bannerUrl+'" alt="banner"></div>';
      if(s.isOpen===false){
        document.getElementById('closed-banner').style.display='block';
        document.getElementById('closed-banner').innerHTML='<div class="closed-overlay">🔴 ร้านปิดรับออเดอร์แล้ว กรุณามาใหม่วันพรุ่งนี้</div>';
      }
      if(s.featuredIds){ FEATURED_IDS=s.featuredIds; buildFeatured(); }
      // Preorder config
      if(s.preorderEnabled===false){
        document.getElementById('preorder-chip').style.display='none';
      }
    }
    window._idxSaveStore = async function(isOpen) {
      const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      await setDoc(doc(db,'settings','store'), { isOpen }, { merge: true });
    };
    initAdminBar();
    // Load promo banners
    const bannersSnap=await getDocs(collection(db,'banners'));
    if(!bannersSnap.empty){
      const allBannersRaw=bannersSnap.docs.map(d=>({id:d.id,...d.data()}));
      // กรองเฉพาะที่ active และมีรูป (imageUrl ไม่ว่าง)
      const banners=allBannersRaw
        .filter(b=>b.active!==false && b.imageUrl && b.imageUrl.trim()!=='')
        .sort((a,b)=>(a.order||0)-(b.order||0));
      console.warn('[Banner] total:', allBannersRaw.length, 'with image:', banners.length);
      if(banners.length) buildPromoSlider(banners);
      // Promotion banner between featured & menu list
      const midBanner = banners.find(b=>b.midBanner) || (banners.length > 1 ? banners[1] : null);
      if (midBanner && midBanner.imageUrl) {
        const midWrap = document.getElementById('promo-mid-wrap');
        if (midWrap) {
          midWrap.innerHTML = `<div class="promo-mid"><img src="${midBanner.imageUrl}" alt="${midBanner.title||'โปรโมชัน'}"><div class="promo-mid-overlay"><div class="promo-mid-title">${midBanner.title||'โปรโมชันพิเศษ'}</div>${midBanner.subtitle?`<div class="promo-mid-sub">${midBanner.subtitle}</div>`:''}</div><div class="promo-mid-badge">📢 โปรโมชัน</div></div>`;
        }
      }
    }
    // โหลด categories จาก Firestore ก่อน เพื่อให้ชื่อหมวดตรงกับที่แอดมินแก้ไว้
    let catLookup = {}; // catKey → { label, sortOrder }
    try {
      const catSnap = await getDocs(collection(db,'categories'));
      catSnap.forEach(d => {
        const c = d.data();
        if (c.key) catLookup[c.key] = { label: `${c.emoji||''} ${c.name}`.trim(), sortOrder: c.sortOrder||99 };
      });
    } catch(ce) { console.warn('categories load skipped:', ce.message); }

    // ── Menu Cache: ใช้ cache ถ้าไม่เกิน 5 นาที ──
    const MENU_CACHE_KEY = 'imkum_menu_cache';
    const MENU_CACHE_TTL = 5 * 60 * 1000;
    let usedCache = false;
    try {
      const cached = JSON.parse(localStorage.getItem(MENU_CACHE_KEY) || 'null');
      if (cached && cached.ts && (Date.now() - cached.ts < MENU_CACHE_TTL) && cached.menu?.length) {
        MENU = cached.menu;
        ALL_ITEMS = [].concat(...MENU.map(c => c.items));
        buildTabs(); buildFeatured(); buildMenuList(); render();
        usedCache = true;
        console.log('[Menu] loaded from cache');
      }
    } catch(ce) {}

    const mSnap=await getDocs(collection(db,'menu'));
    if(!mSnap.empty){
      const catMap={};
      mSnap.forEach(d=>{
        const data=Object.assign({id:d.id},d.data());
        if(data.hidden) return;
        const k=data.catKey||'other';
        // ใช้ชื่อหมวดจาก Firestore categories ถ้ามี, fallback → data.category → k
        const catInfo = catLookup[k];
        const catLabel = catInfo ? catInfo.label : (data.category||k);
        const catSort = catInfo ? catInfo.sortOrder : (data.sortOrder||99);
        if(!catMap[k]) catMap[k]={category:catLabel,catKey:k,items:[],sortOrder:catSort};
        catMap[k].items.push(data);
      });
      MENU=Object.values(catMap).sort((a,b)=>(a.sortOrder||99)-(b.sortOrder||99));
      ALL_ITEMS=[].concat(...MENU.map(c=>c.items));
      // บันทึก cache
      try { localStorage.setItem(MENU_CACHE_KEY, JSON.stringify({ ts: Date.now(), menu: MENU })); } catch(e) {}
      buildTabs(); buildFeatured(); buildMenuList(); render();
    }

    // โหลด ratings รวม (avg per item) เพื่อแสดงดาวข้างชื่อเมนู
    try {
      const rSnap = await getDocs(collection(db,'ratings'));
      const ratingMap = {}; // itemId → {sum, count}
      rSnap.forEach(d => {
        const r = d.data();
        if (!r.itemId || !r.star) return;
        if (!ratingMap[r.itemId]) ratingMap[r.itemId] = { sum: 0, count: 0 };
        ratingMap[r.itemId].sum += r.star;
        ratingMap[r.itemId].count += 1;
      });
      // ใส่ avgRating ลงใน ALL_ITEMS
      ALL_ITEMS.forEach(item => {
        const rd = ratingMap[item.id];
        item.avgRating = rd ? (rd.sum / rd.count) : null;
        item.ratingCount = rd ? rd.count : 0;
      });
      window._ratingMap = ratingMap;
      buildMenuList(); // re-render พร้อมดาว
    } catch(re) { console.warn('ratings load skipped:', re.message); }

  }catch(e){console.warn('Firebase sync skipped:',e.message);}
}
syncFirestore();

// Register SW
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}

// ===== REFERRAL SYSTEM =====
(async function initReferral() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem('imkum_referral', ref);
    // บันทึก referral click ใน Firestore
    try {
      const { getFirestore, doc, setDoc, increment } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const db2 = getFirestore();
      await setDoc(doc(db2, 'referrals', ref), {
        clicks: increment(1),
        lastClickAt: new Date(),
      }, { merge: true });
    } catch(e) {}
  }
})();
