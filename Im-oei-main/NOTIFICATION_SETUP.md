# 🔔 Setup แจ้งเตือนลูกค้า — im-oei v20

## ภาพรวม flow

```
Admin กด updateStatus
  → Firestore อัพเดท order
  → เขียน job ลง pushQueue / lineQueue
  → Cloud Function รับ job
  → ส่ง Web Push / LINE ให้ลูกค้า
```

---

## ขั้นตอน 1 — VAPID Key (Web Push)

1. ไป [Firebase Console](https://console.firebase.google.com) → project **im-oei**
2. ⚙️ Project Settings → แท็บ **Cloud Messaging**
3. เลื่อนลง **Web Push certificates** → กด **Generate key pair**
4. คัดลอก Key ที่ได้ (เริ่มด้วย `B...`)

**แทนที่ใน 2 ที่:**
- `orders.html` บรรทัด `const VAPID_PUBLIC_KEY = 'YOUR_VAPID_PUBLIC_KEY_HERE';`
- `functions/index.js` บรรทัด `const VAPID_PUBLIC_KEY = 'YOUR_VAPID_PUBLIC_KEY_HERE';`

---

## ขั้นตอน 2 — LINE Channel Access Token

1. ไป [LINE Developers Console](https://developers.line.biz)
2. สร้าง Provider → สร้าง **Messaging API** channel (ถ้ายังไม่มี)
3. ใน channel → แท็บ **Messaging API** → **Channel access token** → กด **Issue**
4. คัดลอก token

**แทนที่ใน:**
- `functions/index.js` ใช้ secrets: `firebase functions:secrets:set LINE_CHANNEL_TOKEN`

**เพิ่ม Webhook URL (ถ้าจะรับ LINE userId อัตโนมัติ):**
- Webhook URL: `https://us-central1-im-oei.cloudfunctions.net/lineWebhook`
- ✅ Use webhook: ON
- ✅ Allow bot to join group chats: OFF

---

## ขั้นตอน 3 — Deploy Cloud Functions

```bash
# ติดตั้ง Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# ไปที่ folder โปรเจกต์
cd /path/to/im-oei

# Init functions (ถ้ายังไม่เคยทำ)
firebase init functions
# เลือก: JavaScript, ESLint: No, Install now: Yes

# ใส่ secrets
firebase functions:secrets:set VAPID_PRIVATE_KEY
# (วาง VAPID Private Key แล้วกด Enter)

firebase functions:secrets:set LINE_CHANNEL_TOKEN
# (วาง LINE token แล้วกด Enter)

# Deploy
firebase deploy --only functions
```

---

## ขั้นตอน 4 — Firestore Rules (เพิ่ม collection ใหม่)

เพิ่มใน Firestore Security Rules:

```
match /pushSubscriptions/{phone} {
  allow read, write: if request.auth == null; // ลูกค้า write ได้ (ไม่มี auth)
}
match /pushQueue/{id} {
  allow write: if false; // เขียนได้แค่จาก Admin SDK
  allow read: if false;
}
match /lineQueue/{id} {
  allow write: if false;
  allow read: if false;
}
```

> ⚠️ pushSubscriptions ต้องให้ลูกค้า write ได้ เพราะ orders.html เขียน subscription โดยตรง

---

## ขั้นตอน 5 — เก็บ lineUserId ของลูกค้า

ลูกค้าต้อง add LINE Bot เป็นเพื่อนก่อน แล้วส่ง message ใดๆ มา Bot ถึงจะได้ `userId`

**วิธีเก็บ userId อัตโนมัติ** (ต้องทำ LIFF หรือ Webhook):
- เมื่อลูกค้า follow bot → webhook `follow` event → เก็บ userId ลง Firestore ผูกกับเบอร์
- ตอน login ด้วย LIFF → ได้ userId จาก `liff.getProfile()` → เก็บลง `localStorage.setItem('imkum_userId', userId)`
- cart.html จะเขียน `lineUserId` ลงออเดอร์อัตโนมัติ (เพิ่มใน v20 แล้ว)

---

## สรุปสิ่งที่ต้องแทนที่

| ไฟล์ | ค่าที่ต้องแทน |
|---|---|
| `orders.html` | `YOUR_VAPID_PUBLIC_KEY_HERE` |
| `functions/index.js` | `YOUR_VAPID_PUBLIC_KEY_HERE`, `your@email.com` |
| Firebase Secrets | `VAPID_PRIVATE_KEY`, `LINE_CHANNEL_TOKEN` |
