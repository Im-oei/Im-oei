# 🍜 อิ่มเอ๋ย Im-Oei — Food Ordering Web App

ระบบสั่งอาหารออนไลน์ เชื่อมต่อ LINE LIFF + Firebase

## โครงสร้างโปรเจค

```
im-oei/
├── public/               ← ไฟล์ที่ deploy ขึ้น Firebase Hosting
│   ├── index.html        ← หน้าเมนู/สั่งอาหาร (หน้าหลัก)
│   ├── cart.html         ← ตะกร้าสินค้า + ชำระเงิน
│   ├── liff.html         ← LINE Login (LIFF)
│   ├── login.html        ← Admin login
│   ├── admin.html        ← หน้าแอดมิน
│   ├── orders.html       ← ประวัติออเดอร์
│   ├── success.html      ← สั่งซื้อสำเร็จ
│   ├── style.css         ← Global styles
│   ├── sw.js             ← Service Worker (Push Notification)
│   ├── manifest.json     ← PWA manifest
│   └── config.example.js ← Template สำหรับ config.js
├── functions/            ← Firebase Cloud Functions
│   ├── index.js
│   └── package.json
├── .github/workflows/    ← CI/CD Auto-deploy
│   └── firebase-deploy.yml
├── firestore.rules       ← Firestore Security Rules
├── firebase.json         ← Firebase config
├── .gitignore
└── README.md
```

## วิธีติดตั้ง

### 1. ตั้งค่า config.js
```bash
cp public/config.example.js public/config.js
# แก้ไขค่าใน config.js ด้วย keys จริงของคุณ
```

### 2. Deploy ขึ้น Firebase
```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

### 3. Deploy เฉพาะ Rules
```bash
firebase deploy --only firestore:rules
```

## ⚠️ สำคัญ
- **ห้าม push `public/config.js` ขึ้น GitHub** (มี API keys)
- ดู `SECURITY_SETUP.md` สำหรับการตั้งค่า Admin Token
