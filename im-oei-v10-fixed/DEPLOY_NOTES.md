# Im-Oei v12 — Deploy Notes

## ⚡ สิ่งที่ต้องทำก่อน deploy ครั้งแรก

### 1. สร้างไฟล์ config.js
คัดลอก `config.example.js` แล้วตั้งชื่อใหม่เป็น `config.js` และกรอกค่าจริง:

```js
export const FIREBASE_CONFIG = {
  apiKey:      "...",          // Firebase Console → Project Settings → Web App
  authDomain:  "im-oei.firebaseapp.com",
  projectId:   "im-oei"
};

export const LINE_CHANNEL_TOKEN = "...";  // LINE Developers → Messaging API → Channel access token
export const LIFF_ID            = "...";  // LINE Developers → LIFF → LIFF ID
export const VAPID_PUBLIC_KEY   = "...";  // Firebase Console → Cloud Messaging → Web Push certificates
```

> ⚠️ อย่า commit `config.js` ขึ้น GitHub (เพิ่มใน `.gitignore`)

### 2. ตั้งค่า LINE Token ใน Firebase Functions
```bash
firebase functions:config:set line.token="YOUR_LINE_CHANNEL_ACCESS_TOKEN"
firebase deploy --only functions
```

### 3. ตั้งค่า GitHub Secret
ใน GitHub → Settings → Secrets → Actions ต้องมี:
- `FIREBASE_SERVICE_ACCOUNT` — Service Account JSON จาก Firebase Console
  - ต้องมี role: Firebase Admin, Cloud Functions Developer, Cloud Datastore User

---

## 🚀 Deploy

### deploy ทั้งหมด (Hosting + Functions + Rules)
```bash
firebase deploy
```

### deploy แยก
```bash
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

### GitHub Actions (auto-deploy เมื่อ push ไป main)
- **Hosting + Firestore Rules** — ผ่าน `action-hosting-deploy`
- **Cloud Functions** — ผ่าน `firebase deploy --only functions`

---

## 🔐 Security (v10 — แก้แล้ว)

| Collection | เดิม | ใหม่ |
|---|---|---|
| `menu` | ทุกคน write ได้ | admin เท่านั้น |
| `categories` | ทุกคน write ได้ | admin เท่านั้น |
| `banners` | ทุกคน write ได้ | admin เท่านั้น |
| `settings` | ทุกคน write ได้ | admin เท่านั้น |
| `pickupLocations` | ทุกคน write ได้ | admin เท่านั้น |
| `rewards` | ทุกคน write ได้ | admin เท่านั้น |
| `stamps` | validate แค่ phone field | validate phone + จำกัด +100 แต้ม/ครั้ง |
| `orders` | ทุกคน read ได้ (TODO) | validate phone + data fields |
| `ratings` | ทุกคน create ได้ | ต้องมี fields ครบ + stars 1–5 |
| `customers` | ทุกคน write ได้ | validate phone == docId |
| `lineQueue` | ทุกคน create ได้ | admin หรือ validate fields |

---

## ☁️ Cloud Functions (v10)

| Function | Trigger | ทำอะไร |
|---|---|---|
| `onOrderCreate` | Firestore `orders/{id}` onCreate | อัพเดท stats_daily + stats_menu |
| `processLineQueue` | Firestore `lineQueue/{docId}` onCreate | ส่ง LINE push message (retry 3 ครั้ง) |
| `cleanupLineQueue` | Scheduled — ทุกวัน เที่ยงคืน (Bangkok) | ลบ lineQueue docs ที่ sent/error เกิน 7 วัน |

### การเพิ่ม cleanupLineQueue ครั้งแรก
ต้อง enable Cloud Scheduler API ก่อน:
```
https://console.cloud.google.com/apis/library/cloudscheduler.googleapis.com?project=im-oei
```

---

## 🔐 v12 — Security Fixes

| # | จุดที่แก้ | ไฟล์ |
|---|---|---|
| 1 | `issueAdminCustomToken`: LINE verify เปลี่ยน GET→POST + เพิ่ม fetch import | `functions/index.js` |
| 2 | `verifyAdminPassword`: ลบ `data.clientKey` ออกจาก rate limit key | `functions/index.js` |
| 3 | `rewardRedemptions` create: บังคับ `request.auth != null` + ตรวจ ownership | `firestore.rules` |
| 4 | แยก `settings/auth` (hash-only, admin read) ออกจาก `settings/store` (public read) | `firestore.rules` + `functions/index.js` |

### ⚠️ Migration ที่ต้องทำหลัง deploy v12

**hash ใน Firestore ยังอยู่ที่ `settings/store`** (ถ้า deploy มาจาก v11)
→ ระบบจะ auto-migrate ให้เองเมื่อ owner login ครั้งแรก (verifyAdminPassword จะย้าย hash → settings/auth อัตโนมัติ)
→ หรือ owner เข้าหน้า admin → ตั้งค่า → บันทึกรหัสผ่านใหม่ → จะเขียนใน settings/auth ทันที

**settings/auth doc** จะถูกสร้างอัตโนมัติครั้งแรกที่เรียก `hashAndSavePassword` หรือ auto-migrate


- `listenLineQueue()` — onSnapshot realtime จาก Firestore `lineQueue/`
- Badge ใต้ปุ่ม "แจ้งลูกค้า" แสดง 3 สถานะ:
  - 📤 กำลังส่ง LINE... (pending)
  - ✅ LINE ส่งแล้ว · HH:MM (sent)
  - ❌ LINE ส่งไม่ได้: <error> (error)
- ปุ่มเปลี่ยนเป็น "🔄 ส่งอีกครั้ง" หลังส่งครั้งแรก
- กดซ้ำ = สร้าง doc ใหม่ใน lineQueue → Cloud Function trigger ใหม่
- retry อัตโนมัติ 3 ครั้ง ถ้า LINE API 5xx หรือ network error

---

## 🔴 แก้ CORS / FirebaseError: internal ตอนสั่งซื้อ

Error: `Access-Control-Allow-Origin` blocked + `FirebaseError: internal`

### สาเหตุ
`onCall` functions ไม่มี CORS ปัญหาถ้า App Check token ถูกต้อง
Error `internal` มักเกิดจาก App Check token invalid/missing

### วิธีแก้ (ต้องทำใน Firebase Console)

**Option A — ยังไม่พร้อมใช้ App Check (Development)**
1. ไปที่ Firebase Console → App Check → Apps
2. เลือก app → **Register** → เปิด **Debug token**
3. Copy debug token → ใส่ใน `config.js`:
   ```js
   // Development only — อย่า commit
   self.FIREBASE_APPCHECK_DEBUG_TOKEN = "your-debug-token-here";
   ```
   หรือใน browser console พิมพ์ token ที่ได้จาก console log แล้ว add ใน Firebase Console

**Option B — Production พร้อม deploy**
1. Firebase Console → App Check → Apps → Register reCAPTCHA v3
2. ได้ Site Key → ใส่ใน `config.js`:
   ```js
   export const RECAPTCHA_SITE_KEY = "6Lc...your-key";
   ```
3. Firebase Console → App Check → APIs → **Cloud Functions → Enforce**

**Option C — ปิด App Check ชั่วคราว (dev เท่านั้น)**
ใน `functions/index.js` เปลี่ยน `enforceAppCheck: true` → `enforceAppCheck: false`
แล้ว `firebase deploy --only functions`
