// ─── XSS escape ─────────────────────────────────────────────────────────────
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// success.html — display order summary

const order = JSON.parse(localStorage.getItem('imkum_last_order') || '{}');
const now = new Date();
document.getElementById('s-id').textContent = order.orderId ? '#' + order.orderId.slice(0,8).toUpperCase() : '#??????';
document.getElementById('s-name').textContent = 'คุณ ' + (order.customerName || '-');
document.getElementById('s-time').textContent = (order.pickupTime || '07:30') + ' น.';

// แสดงรายการที่สั่ง
const items = order.items || [];
if (items.length > 0) {
  document.getElementById('s-items-wrap').style.display = 'block';
  document.getElementById('s-total-row').style.display = 'none';
  const listEl = document.getElementById('s-items-list');
  listEl.innerHTML = items.map(item => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px dashed #F5EDE0;">
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
        <span style="background:#FFF3E0;color:#FF8C00;font-size:11px;font-weight:800;padding:2px 8px;border-radius:8px;flex-shrink:0;">×${esc(String(item.qty||1))}</span>
        <span style="font-size:13px;font-weight:700;color:#2C2C2C;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item.name||'')}</span>
      </div>
      <span style="font-size:13px;font-weight:800;color:#E65100;flex-shrink:0;margin-left:8px;">${esc(String(item.subtotal||((item.price||0)*(item.qty||1))))} ฿</span>
    </div>
  `).join('');
  document.getElementById('s-total').textContent = (order.total || 0) + ' บาท';
} else {
  document.getElementById('s-total-row').style.display = '';
  document.getElementById('s-total-simple').textContent = (order.total || 0) + ' บาท';
}

// Pickup location
if (order.pickupLocationName) {
  document.getElementById('s-location-row').style.display = '';
  document.getElementById('s-location').textContent = order.pickupLocationName;
}

// Preorder
if (order.isPreorder) {
  const preBox = document.getElementById('preorder-notice');
  preBox.style.display = 'block';
  const pickupDate = order.preorderDate ? new Date(order.preorderDate) : (() => { const d = new Date(); d.setDate(d.getDate()+1); return d; })();
  const tStr = pickupDate.toLocaleDateString('th-TH',{weekday:'long',year:'numeric',day:'numeric',month:'long'});
  preBox.innerHTML = '📅 ออเดอร์สั่งล่วงหน้า<br><strong>รับได้วัน' + esc(tStr) + '</strong><br>เวลา ' + esc(order.pickupTime||'07:30') + ' น.';
  document.getElementById('s-date').textContent = 'วัน' + tStr;
} else {
  document.getElementById('s-date').textContent = now.toLocaleDateString('th-TH', {year:'numeric',month:'long',day:'numeric'}) + ' ' + now.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}) + ' น.';
}

// Link "ดูสถานะออเดอร์" → orders.html พร้อม orderId
if (order.orderId) {
  document.getElementById('btn-status').href = 'orders.html?highlight=' + order.orderId;
}

// Stamp
if (order.stampMsg) {
  const stampBox = document.getElementById('stamp-msg-box');
  stampBox.style.display = 'block';
  stampBox.textContent = order.stampMsg;
}
