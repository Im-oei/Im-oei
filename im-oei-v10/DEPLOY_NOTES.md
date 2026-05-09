# Im-Oei v10 — Deploy Notes

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

## 🟡 v10 — Admin เห็นสถานะ LINE ใน Order Card

- `listenLineQueue()` — onSnapshot realtime จาก Firestore `lineQueue/`
- Badge ใต้ปุ่ม "แจ้งลูกค้า" แสดง 3 สถานะ:
  - 📤 กำลังส่ง LINE... (pending)
  - ✅ LINE ส่งแล้ว · HH:MM (sent)
  - ❌ LINE ส่งไม่ได้: <error> (error)
- ปุ่มเปลี่ยนเป็น "🔄 ส่งอีกครั้ง" หลังส่งครั้งแรก
- กดซ้ำ = สร้าง doc ใหม่ใน lineQueue → Cloud Function trigger ใหม่
- retry อัตโนมัติ 3 ครั้ง ถ้า LINE API 5xx หรือ network error
