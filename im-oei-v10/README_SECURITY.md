# Security Notes — อิ่มเอ๋ย Im-Oei

## การแก้ไขความปลอดภัย (Patch Log)

### 🔴 Critical Fixes

#### 1. Firestore Rules — ปิด write ทุก collection
**ก่อน:** เกือบทุก collection มี `allow write: if true` ใครก็ลบ/แก้เมนู แก้สถานะออเดอร์ หรือปั๊มแต้มตัวเองได้  
**หลัง:** ต้องมี Firebase Auth token พร้อม role claim ถูกต้อง (`isAnyAdmin()`) จึงจะเขียนได้

Collections ที่เปลี่ยน:
- `menu`, `categories`, `banners`, `settings`, `rewards`, `pickupLocations` → require `isAnyAdmin()`
- `orders/update` → require `isAnyAdmin()` (ป้องกัน client เปลี่ยนสถานะเอง)
- `stamps` → require `isAnyAdmin()` (ป้องกันโกงแต้ม)
- `ratings/update,delete` → require `isAnyAdmin()`
- `pushQueue`, `lineQueue` → `allow write: if false` (Functions เขียนผ่าน Admin SDK)
- `stats_daily`, `stats_menu` → `allow write: if false`
- `lineUsers`, `linePhoneMap` → require admin หรือเจ้าของ record
- `admins` → `allow read: if isFirebaseAdmin()` (ปิดไม่ให้ client อ่าน list admin)

#### 2. Admin Auth — เพิ่ม Firebase Custom Token
**ก่อน:** `admin.module.js` ตรวจ role จาก `sessionStorage` แก้ใน DevTools ได้  
**หลัง:** เพิ่ม Cloud Function `issueAdminToken` ที่:
1. Verify LIFF `id_token` กับ LINE API
2. ตรวจ `lineUserId` ใน `admins` collection
3. ออก Firebase Custom Token พร้อม custom claim `{ role }`
4. Client เรียก `signInWithCustomToken()` → Firestore rules ตรวจ claim จริง

วิธีใช้ใน `admin.module.js`:
```js
const { customToken } = await httpsCallable(functions, 'issueAdminToken')({ lineUserId, liffIdToken });
await signInWithCustomToken(auth, customToken);
```

#### 3. Content-Security-Policy
**ก่อน:** ไม่มี CSP header เลย  
**หลัง:** เพิ่ม CSP ใน `firebase.json` จำกัด script/style/connect sources

### 🟠 XSS Fixes

#### 4. sanitize innerHTML ใน admin.module.js
**ก่อน:** `innerHTML = cfg.desc.replace(/\n/g,'<br>')` — ถ้ามี `<script>` ใน Firestore จะ execute  
**หลัง:** ผ่าน `esc()` function ก่อนทุกครั้ง: `innerHTML = esc(cfg.desc).replace(/\n/g,'<br>')`

### 🟡 HTML Fixes

#### 5. index.html — ลบ `<link rel="manifest">` ซ้ำ
#### 6. index.html — ลบ stray `>` บรรทัด 177
#### 7. cart.html — แก้ duplicate `onclick` attribute บน submit button

---

## สิ่งที่ยังต้องทำเพิ่ม

1. **อัพเดท `admin.module.js`** ให้เรียก `issueAdminToken` และ `signInWithCustomToken` แทน sessionStorage check
2. **เพิ่ม `lineUserId` field** ใน `admins` collection สำหรับ LINE admin แต่ละคน
3. **เพิ่ม `PERMISSIONS_POLICY` header** ถ้าใช้ geolocation/camera
4. **ตั้ง Firebase App Check** ให้ production mode (ปัจจุบันอาจยัง debug)
5. **Audit `orders.html`, `index.html` JS** — ตรวจ innerHTML ที่รับข้อมูลจาก Firestore เพิ่มเติม

