# 🔐 Security Patch Notes — Im-oei v10 → v10-secure

## สรุปการแก้ไข (จาก audit)

### 🔴 Critical Fixes

| # | ไฟล์ | ปัญหาเดิม | การแก้ไข |
|---|------|-----------|----------|
| 1 | `firestore.rules` | `orders` อ่านได้ทุกคนถ้ามี phone format ถูก | ต้อง login + `phone_number` claim ตรง |
| 2 | `firestore.rules` | `lineQueue` ใครก็ create ได้ = spam LINE | ปิด public write ทั้งหมด |
| 3 | `firestore.rules` | `linePhoneMap` ใครก็ hijack binding ได้ | `allow write: if false` ทั้งหมด |
| 4 | `firestore.rules` | `lineUsers` public read = ชื่อ/phone leak | ต้อง login + เป็นเจ้าของ |
| 5 | `firestore.rules` | `stamps` public read + client เขียนได้ = ปั๊มแต้ม | read ต้อง auth, write = false |
| 6 | `public/config.js` | `LINE_CHANNEL_TOKEN` อยู่ใน browser = token leak | ถอดออกจาก client ทั้งหมด |
| 7 | `public/cart.html` | เขียน stamps ตรงจาก client | ย้ายไป `onOrderCreate` function |
| 8 | `public/admin.html` | เขียน lineQueue ตรง = ใครก็ยิง LINE | เรียก `sendLineMessage` callable แทน |
| 9 | `public/liff.html` | เขียน lineUsers/linePhoneMap ตรง = hijack | เรียก `bindLineAccount` callable แทน |

---

### ✅ Cloud Functions ใหม่/แก้ไข

#### `onOrderCreate` (แก้ไข)
- **เพิ่ม**: เขียน stamps อัตโนมัติผ่าน Admin SDK
- อ่าน `settings/stamps.bahtPerPoint` เพื่อคำนวณแต้ม
- ลูกค้า manipulate ค่าไม่ได้

#### `sendLineMessage` (ใหม่ — Callable)
- ตรวจ auth + admin ก่อนทุกครั้ง
- validate message (length ≤ 500)
- rate limit 30 ครั้ง/นาที/admin
- เขียน lineQueue ผ่าน Admin SDK

#### `bindLineAccount` (ใหม่ — Callable)
- verify LIFF `id_token` กับ LINE API ก่อน
- ป้องกัน bind userId ปลอม
- เขียน lineUsers + linePhoneMap ผ่าน Admin SDK

#### `checkRateLimit` (helper ใหม่)
- ใช้ Firestore transaction
- sliding window per-user per-action

---

### 🔧 ขั้นตอนหลัง Deploy

1. **ตั้ง Firebase Functions config:**
```bash
firebase functions:config:set \
  line.token="YOUR_LINE_CHANNEL_TOKEN" \
  line.liff_id="YOUR_LIFF_ID"
```

2. **Revoke LINE token เดิม** (เพราะ expose ใน config.js มาแล้ว):
   - ไปที่ LINE Developers Console
   - Issue token ใหม่
   - อัปเดต `firebase functions:config:set line.token="NEW_TOKEN"`

3. **Deploy:**
```bash
firebase deploy --only firestore:rules,functions,hosting
```

4. **Test security rules:**
```bash
firebase emulators:start
# รัน test suite ตรวจ rules
```

---

### ⚠️ สิ่งที่ยังต้องทำต่อ (Roadmap)

- [ ] เพิ่ม Firebase Authentication (phone auth) เพื่อให้ `orders` read ทำงานได้เต็มประสิทธิภาพ
- [ ] validate order total ใน `createOrder` function (ป้องกัน price manipulation)
- [ ] เพิ่ม dead-letter queue สำหรับ LINE send ที่ fail
- [ ] เพิ่ม monitoring / alerting สำหรับ rate limit hit
- [ ] audit log สำหรับ admin actions
