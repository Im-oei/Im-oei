// ===== DEFAULT MENU DATA (fallback / first-time seed) =====
const DEFAULT_MENU = [
  {
    category: "🥪 แซนวิช", catKey: "sandwich", price: 20,
    items: [
      { id: "tuna",        name: "ปูอัดทูน่า",     desc: "ปูอัด, ทูน่า, ผักสลัด",        emoji: "🥪", price: 20 },
      { id: "pork_salad",  name: "หมูหยองสลัด",    desc: "หมูหยอง, สลัด, มายองเนส",      emoji: "🥙", price: 20 },
      { id: "egg_sausage", name: "ไข่ดาวไส้กรอก",  desc: "ไข่ดาว, ไส้กรอก, ซอส",         emoji: "🍳", price: 20 },
      { id: "shrimp",      name: "ไข่กุ้งสาหร่าย", desc: "ไข่กุ้ง, สาหร่าย, มายองเนส",  emoji: "🍤", price: 20 },
    ]
  },
  {
    category: "🍚 ข้าว", catKey: "rice", price: 50,
    items: [
      { id: "chicken_rice", name: "ข้าวไก่อบ",      desc: "ไก่อบ, ไข่ต้ม, ผัก",          emoji: "🍗", price: 50 },
      { id: "chicken_lime", name: "ข้าวไก่อบมะนาว", desc: "ไก่มะนาว, ข้าว, ผัก",         emoji: "🍋", price: 50 },
    ]
  },
  {
    category: "🍜 หมี่", catKey: "noodle", price: 50,
    items: [
      { id: "chicken_noodle", name: "หมี่ไก่ฉีก", desc: "หมี่เหลือง, ไก่ฉีก, น้ำซุป",  emoji: "🍜", price: 50 },
      { id: "pork_noodle",    name: "หมี่หมูแดง", desc: "หมี่, หมูแดง, ไข่ต้ม",         emoji: "🥢", price: 50 },
    ]
  }
];

// Will be populated from Firestore or fallback to default
let MENU = [];
let ALL_ITEMS = [];
let FEATURED_IDS = ["tuna", "chicken_noodle", "egg_sausage"];
let BANNER_URL = "";
let STORE_SETTINGS = { orderCutoff: "06:30", pickupStart: "07:00", pickupEnd: "08:00", isOpen: true };

// ===== CART STATE =====
let cart = JSON.parse(localStorage.getItem('imkum_cart') || '{}');

function saveCart() { localStorage.setItem('imkum_cart', JSON.stringify(cart)); }

function add(id) {
  const item = ALL_ITEMS.find(i => i.id === id);
  if (!item || item.hidden) return;
  cart[id] = (cart[id] || 0) + 1;
  saveCart(); render();
  showToast('เพิ่มลงตะกร้าแล้ว 🛒');
}

function remove(id) {
  if ((cart[id] || 0) > 0) {
    cart[id]--;
    if (!cart[id]) delete cart[id];
    saveCart(); render();
  }
}

function getTotal() {
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const item = ALL_ITEMS.find(i => i.id === id);
    return sum + (item ? item.price * qty : 0);
  }, 0);
}

function getCount() { return Object.values(cart).reduce((s, v) => s + v, 0); }

function render() {
  ALL_ITEMS.forEach(item => {
    const el = document.getElementById('qty-' + item.id);
    if (el) el.textContent = cart[item.id] || 0;
  });
  const total = getTotal(), count = getCount();
  const totalEl = document.getElementById('home-total');
  const countEl = document.getElementById('cart-count');
  const btn = document.getElementById('order-btn');
  if (totalEl) totalEl.textContent = total + ' บาท';
  if (countEl) countEl.textContent = count;
  if (btn) btn.disabled = count === 0;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// Helper: render image or emoji
function renderFoodImg(item) {
  if (item.imageUrl) {
    return `<img src="${item.imageUrl}" alt="${item.name}" loading="lazy">`;
  }
  return item.emoji || '🍽️';
}
