# 🔐 Security Patch Notes — v6.1 (Audit + Fix)

## สรุปการแก้ไขทั้งหมด (Cumulative)

---

### 🔴 Critical Fixes — v6.1 (Audit รอบนี้)

| # | ไฟล์ | ปัญหาเดิม | การแก้ไข |
|---|------|-----------|----------|
| 1 | `liff.module.js` | `submitPhone()` เขียน `lineUsers`/`linePhoneMap`/`customers` ตรงจาก client — `lineUsers` rules `write: if false` → ล้มเหลวทุก write | เรียก `bindLineAccount` callable (verify LIFF token กับ LINE + Admin SDK write) |
| 2 | `liff.module.js` | `updateDoc(lineUsers)` profile refresh — ถูก rules บล็อก แต่ไม่มี error handling | เปลี่ยนเป็น best-effort call ผ่าน `bindLineAccount` |
| 3 | `orders.module.js` | `redeemReward()` เขียน `stamps` ตรง — rules `allow create,update: if false` → ฟีเจอร์แลกรางวัลพัง 100%; ไม่มี atomic (หักแต้มแล้ว redemption อาจ fail) | Cloud Function `redeemReward` ใหม่: atomic transaction + ownership check + server-side pointCost verify |
| 4 | `functions/index.js` | ยังไม่มี `redeemReward` callable | เพิ่ม callable ใหม่: atomic tx, App Check, rate limit, ownership, pointCost verify from server |
| 5 | `public/config.js` | ไฟล์มี real API keys ติดมาใน deploy package | ลบออกจาก zip — ต้องสร้างจาก `config.example.js` เอง (ดู DEPLOY_NOTES.md) |
| 6 | `public/config.public.js` | ไฟล์มี real API keys ติดมาเช่นกัน | ลบออก — ใช้ `config.public.example.js` แทน |

---

### 🔴 Critical Fixes — v12 (รอบก่อน)

| # | ไฟล์ | ปัญหาเดิม | การแก้ไข |
|---|------|-----------|----------|
| 1 | `functions/index.js` | `issueAdminCustomToken`: LINE verify ใช้ GET | เปลี่ยนเป็น POST + form-encoded |
| 2 | `functions/index.js` | `verifyAdminPassword`: rate limit key ใช้ `clientKey` จาก client | ใช้ uid หรือ `anon_global` แทน |
| 3 | `firestore.rules` | `rewardRedemptions` create: ไม่ตรวจ auth + ไม่ตรวจ ownership | `request.auth != null` + ตรวจ phone/lineUserId ตรง token |
| 4 | `firestore.rules` + `functions/index.js` | password hash อยู่ใน `settings/store` (public read) | แยกไปที่ `settings/auth` (admin-only read) |

---

### ✅ Cloud Functions ทั้งหมด

| Function | ประเภท | ทำอะไร | App Check |
|---|---|---|---|
| `validateAndCreateOrder` | Callable | ดึงราคาจาก server, สร้าง order | ❌ (anonymous allowed) |
| `onOrderCreate` | Firestore trigger | stats + stamps server-side | — |
| `sendLineMessage` | Callable | ส่ง LINE ผ่าน admin auth | ✅ |
| `processLineQueue` | Firestore trigger | ส่ง LINE API + retry | — |
| `bindLineAccount` | Callable | ผูก LINE + phone (verify LIFF token) | ✅ |
| `hashAndSavePassword` | Callable | bcrypt hash password, owner only | ✅ |
| `verifyAdminPassword` | Callable | bcrypt compare, rate limited | ✅ |
| `cleanupLineQueue` | Scheduled | ลบ lineQueue เก่า 7 วัน | — |
| `getLineUserStatus` | Callable | ดึงสถานะ LINE binding (verify LIFF) | ✅ |
| `issueAdminCustomToken` | Callable | ออก Firebase Custom Token สำหรับ admin LINE | ✅ |
| **`redeemReward`** (ใหม่) | Callable | หักแต้ม + บันทึก redemption (atomic) | ✅ |

---

### 📋 Security Checklist

- [x] Firestore rules: orders read ต้อง auth + เป็นเจ้าของ
- [x] Firestore rules: rewardRedemptions read ต้อง auth + เป็นเจ้าของ
- [x] Firestore rules: ratings create ต้อง auth
- [x] Firestore rules: pushSubscriptions write ต้อง auth
- [x] Firestore rules: lineQueue, linePhoneMap, lineUsers write = false
- [x] Firestore rules: stamps client write = false
- [x] Password: bcrypt hash server-side
- [x] Order total: server-validated (validateAndCreateOrder)
- [x] Stamp earn: คำนวณผ่าน onOrderCreate (Admin SDK)
- [x] **Stamp deduct: คำนวณผ่าน redeemReward callable (atomic)** ← ใหม่
- [x] LINE message: ส่งผ่าน sendLineMessage callable + admin auth
- [x] **bindLineAccount: liff.module.js ใช้ callable แทน direct write** ← ใหม่
- [x] Rate limiting: ทุก callable function
- [x] App Check: enforceAppCheck ทุก callable สำคัญ
- [x] **config.js / config.public.js ไม่อยู่ใน deploy package** ← ใหม่

### 🔲 ยังต้องทำ (Roadmap)

- [ ] Firebase Phone Auth เต็มรูปแบบ (แทน anonymous auth)
- [ ] Audit log: บันทึก admin actions ทุก action
- [ ] Dead-letter queue สำหรับ LINE send ที่ fail
- [ ] Monitoring/alerting เมื่อ rate limit hit
- [ ] Rotate Firebase API keys (เผื่อ config.js เคย commit ขึ้น Git มาก่อน)
