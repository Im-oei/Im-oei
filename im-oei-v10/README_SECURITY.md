# 🔐 Security Patch Notes — v22 (เพิ่มเติมจาก v21)

## สรุปการแก้ไขใหม่ v22

### 🔴 Critical Fixes (v22)

| # | ไฟล์ | ปัญหาเดิม | การแก้ไข |
|---|------|-----------|----------|
| 1 | `firestore.rules` | `orders` read: `resource.data.lineUserId != null` = ใครรู้ orderId อ่านได้ทันที | ต้อง auth + เป็นเจ้าของ (uid หรือ phone) |
| 2 | `firestore.rules` | `rewardRedemptions` read: `resource.data.lineUserId != null` = leak เช่นกัน | ต้อง auth + เป็นเจ้าของเท่านั้น |
| 3 | `admin.module.js` | `savePasswords()` เขียน plaintext ลง Firestore ตรง | เรียก `hashAndSavePassword` callable → bcrypt(12) server-side |
| 4 | `cart.module.js` | `addDoc(orders)` ส่ง `price` + `total` จาก client = price manipulation | เรียก `validateAndCreateOrder` callable → server ดึงราคาจาก menu |
| 5 | `firestore.rules` | `ratings` create ไม่ตรวจ auth = ใครก็ spam rating ได้ | เพิ่ม `request.auth != null` |
| 6 | `firestore.rules` | `pushSubscriptions` create/update: `if true` = ใครก็เขียน | ต้อง auth + มี endpoint field |

---

### ✅ Cloud Functions ใหม่ (v22)

#### `validateAndCreateOrder` (ใหม่ — Callable, asia-northeast1)
- **รับ**: `{ items: [{id, qty}], note, customerName, phone/lineUserId/guestId, ... }`
- **ทำ**: ดึงราคา + ชื่อจาก `menu/{id}` (server-side)
- ตรวจ hidden/soldOut
- คำนวณ total ใหม่ (ไม่เชื่อ client เลย)
- rate limit: 10 orders / 5 นาที / user
- เขียน order ผ่าน Admin SDK
- **ป้องกัน**: price manipulation, phantom items, ราคา 0 บาท

#### `hashAndSavePassword` (ใหม่ — Callable)
- owner เท่านั้น (ตรวจ role จาก admins collection)
- bcrypt(12) server-side
- rate limit: 5 ครั้ง / ชั่วโมง
- ลบ plaintext field ออกอัตโนมัติหลัง hash

#### `verifyAdminPassword` (ใหม่ — Callable)
- ใช้ตรวจสอบ password LINE admin login
- bcrypt.compare() server-side
- rate limit: 10 ครั้ง / 5 นาที (brute-force protection)
- auto-migrate plaintext → hash ครั้งแรก

---

### ⚠️ Migration ที่ต้องทำ

1. **Deploy functions ก่อน** (เพราะ cart ต้องการ validateAndCreateOrder):
```bash
firebase deploy --only functions
```

2. **ติดตั้ง bcrypt**:
```bash
cd functions && npm install
```

3. **Migrate password เก่า** — หลัง deploy ให้ owner เข้าไปตั้งรหัสผ่านใหม่ใน admin panel
   (verifyAdminPassword จะ auto-migrate plaintext → hash อัตโนมัติเมื่อ login ครั้งแรก)

4. **Deploy ทุกอย่าง**:
```bash
firebase deploy --only firestore:rules,functions,hosting
```

5. **ตั้ง config** (ถ้ายังไม่ได้ทำ):
```bash
firebase functions:config:set \
  line.token="YOUR_LINE_CHANNEL_TOKEN" \
  line.liff_id="YOUR_LIFF_ID"
```

---

### 📋 Security Checklist ครบแล้ว

- [x] Firestore rules: orders read ต้อง auth
- [x] Firestore rules: rewardRedemptions read ต้อง auth
- [x] Firestore rules: ratings create ต้อง auth
- [x] Firestore rules: pushSubscriptions write ต้อง auth
- [x] Firestore rules: lineQueue write = false (v21)
- [x] Firestore rules: linePhoneMap write = false (v21)
- [x] Firestore rules: stamps client write = false (v21)
- [x] Password: bcrypt hash server-side (v22)
- [x] Order total: server-validated ไม่เชื่อ client (v22)
- [x] Stamp: คำนวณผ่าน Cloud Function (v21)
- [x] LINE message: ส่งผ่าน callable + auth check (v21)
- [x] bindLineAccount: verify LIFF token กับ LINE (v21)
- [x] Rate limiting: ทุก callable function (v21+v22)
- [x] App Check: enforceAppCheck ทุก callable สำคัญ

### 🔲 ยังต้องทำ (Roadmap)

- [ ] Firebase Phone Auth เต็มรูปแบบ (แทน anonymous auth)
- [ ] Audit log: บันทึก admin actions ทุก action
- [ ] Dead-letter queue สำหรับ LINE send ที่ fail
- [ ] Monitoring/alerting เมื่อ rate limit hit
- [ ] validate order total ใน Firestore rules (cross-collection check ยังไม่รองรับ)
