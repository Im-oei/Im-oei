const order = JSON.parse(localStorage.getItem('imkum_last_order') || '{}');
const now = new Date();

document.getElementById('s-id').textContent = order.orderId ? '#' + order.orderId.slice(0,8).toUpperCase() : '#??????';
document.getElementById('s-name').textContent = 'คุณ ' + (order.customerName || '-');
document.getElementById('s-time').textContent = (order.pickupTime || '07:30') + ' น.';

// location
if (order.pickupLocationName) {
  document.getElementById('s-location-row').style.display = '';
  document.getElementById('s-location').textContent = order.pickupLocationName;
}

// items
const items = order.items || [];
if (items.length > 0) {
  document.getElementById('s-items-card').style.display = 'block';
  document.getElementById('s-items-list').innerHTML = items.map(item => `
    <div class="item-row">
      <span class="item-qty">×${item.qty||1}</span>
      <span class="item-name">${item.name||''}</span>
      <span class="item-price">${item.subtotal||((item.price||0)*(item.qty||1))} ฿</span>
    </div>
  `).join('');
  document.getElementById('s-total').textContent = (order.total || 0) + ' บาท';
}

// date
if (order.isPreorder) {
  const preCard = document.getElementById('preorder-card');
  preCard.style.display = 'block';
  const pd = order.preorderDate ? new Date(order.preorderDate) : (() => { const d = new Date(); d.setDate(d.getDate()+1); return d; })();
  const tStr = pd.toLocaleDateString('th-TH',{weekday:'long',year:'numeric',day:'numeric',month:'long'});
  document.getElementById('preorder-text').innerHTML = '📅 ออเดอร์สั่งล่วงหน้า<br><strong>รับได้วัน'+tStr+'</strong><br>เวลา '+(order.pickupTime||'07:30')+' น.';
  document.getElementById('s-date').textContent = 'วัน'+tStr;
} else {
  document.getElementById('s-date').textContent = now.toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'})+' '+now.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})+' น.';
}

// stamp
if (order.stampMsg) {
  const stampCard = document.getElementById('stamp-card');
  stampCard.style.display = 'block';
  // แยก "ได้รับ X แต้ม" กับ "รวม Y แต้ม"
  const msg = order.stampMsg;
  const match = msg.match(/(\d+)\s*แต้ม/g);
  if (match && match.length >= 2) {
    document.getElementById('stamp-text').textContent = '🌟 ได้รับ ' + match[0];
    document.getElementById('stamp-sub').textContent = 'แต้มสะสมทั้งหมด: ' + match[1];
  } else {
    document.getElementById('stamp-text').textContent = msg;
  }
}

// link
if (order.orderId) {
  document.getElementById('btn-status').href = 'orders.html?highlight=' + order.orderId;
}
