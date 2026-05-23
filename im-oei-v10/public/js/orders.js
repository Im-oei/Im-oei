// orders.html — plain scripts

function showLogoutModal(){ document.getElementById('logout-modal').classList.add('open'); }
function closeLogoutModal(){ document.getElementById('logout-modal').classList.remove('open'); }
function confirmLogout(){
  // ล้าง session
  localStorage.removeItem('imkum_user');
  localStorage.removeItem('imkum_admin_auth');
  // ล้างตะกร้าและข้อมูลผู้ใช้ทั้งหมด — ไม่จำ session เมื่อ logout
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
