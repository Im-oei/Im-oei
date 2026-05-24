# 🚀 Phase 4 Release Notes — Im-Oei v10 (v28)

**วันที่:** 2026-05-24  
**Version:** sw v22 | admin.module patch | orders.module phase4 | functions processPushJobs

---

## สรุป Gap ที่แก้ใน Phase 4

| # | Gap | ไฟล์ที่เปลี่ยน | สถานะ |
|---|-----|---------------|-------|
| 1 | Push Notification อัตโนมัติเมื่อ admin เปลี่ยน status | admin.module.js, functions/index.js, firestore.rules | ✅ Done |
| 2 | รีวิวค้าง — popup ขึ้นเมื่อกลับมาเปิดหน้าทีหลัง | orders.module.js | ✅ Done |
| 3 | History filter/search (ทั้งหมด / รับแล้ว / ยกเลิก + ค้นหา) | orders.html, orders.module.js | ✅ Done |
| 4 | Export ประวัติออเดอร์เป็น CSV | orders.module.js | ✅ Done |
| 5 | CSS animation สำหรับ order card + history row + rating sheet | css/orders.css | ✅ Done |
| 6 | SW รับ ORDER_STATUS_UPDATE — toast เมื่อหน้าเปิด, notification เมื่อหน้าปิด | sw.js, orders.module.js | ✅ Done |
| 7 | Firestore rule สำหรับ pushJobs collection | firestore.rules | ✅ Done |

---

## รายละเอียดการเปลี่ยนแปลง

### 1. `admin.module.js` — Auto Web Push เมื่อ updateStatus()

**ก่อน:** admin ต้องกดปุ่ม "แจ้งลูกค้า LINE" เองทุกครั้ง  
**หลัง:** `updateStatus()` เขียน `pushJobs` document อัตโนมัติ → Cloud Function ส่ง Web Push ให้ลูกค้าทันที

```
updateStatus(id, status)
  → updateDoc(orders/id, {status})        // เหมือนเดิม
  → addDoc(pushJobs, {orderId, status,    // ใหม่ Phase 4
      title, body, url, done:false})
```

### 2. `functions/index.js` — Cloud Function `processPushJobs`

- trigger: `onDocumentCreated('pushJobs/{jobId}')`
- อ่าน order → หา pushSubscription → ส่ง Web Push ผ่าน `web-push`
- handle expired endpoint (410/404) → auto-delete subscription
- mark `done:true` เสมอ ไม่ว่าจะส่งสำเร็จหรือไม่

**Deploy ต้องทำก่อน:**
```bash
cd functions
npm install           # ติดตั้ง web-push
firebase functions:config:set \
  vapid.public="YOUR_VAPID_PUBLIC_KEY" \
  vapid.private="YOUR_VAPID_PRIVATE_KEY" \
  vapid.subject="mailto:admin@im-oei.com"
firebase deploy --only functions:processPushJobs
```

### 3. `orders.module.js` — รีวิวค้าง (Pending Reviews)

- `loadMyRatings()` เรียก `checkPendingReviews()` หลังโหลด cache
- `checkPendingReviews()` หา order `status:done` ที่มี item ยังไม่ได้รีวิว
- เปิด `openRatingPopup()` อัตโนมัติ (หน่วง 1.8 วิ ให้ UI โหลดก่อน)
- เรียงตามออเดอร์ใหม่สุดก่อน

### 4. `orders.module.js` — History Filter / Search / Export

- `setHistoryFilter(status)` — กรองตาม chip: ทั้งหมด / รับแล้ว / ยกเลิก
- `filterHistory()` — ค้นหาจาก input: ชื่อเมนู, #OrderID, ชื่อลูกค้า
- `exportHistoryCSV()` — ดาวน์โหลด CSV (UTF-8 BOM สำหรับ Excel ภาษาไทย)
- Filter bar แสดงเฉพาะเมื่อมีประวัติ (`display:none` → `display:flex`)

### 5. `orders.html` — Filter Bar UI

เพิ่มใน `#history-section`:
- Search input พร้อม icon
- Chip buttons: ทั้งหมด / ✅ รับแล้ว / ❌ ยกเลิก
- ปุ่ม "ดาวน์โหลด CSV"

### 6. `sw.js` (v22) — SW Message Handling

**ใหม่:**
- รับ `PAGE_VISIBLE` ping → set flag ว่าหน้าเปิดอยู่
- รับ `ORDER_STATUS_UPDATE` → ถ้ามี page เปิดอยู่: forward message ไป page (toast+sound) | ถ้าไม่มี: showNotification

**orders.module.js:**
- รับ `ORDER_STATUS_UPDATE` จาก SW → toast + sound (ไม่ซ้ำกับ onSnapshot)
- ping `PAGE_VISIBLE` ทุก 20 วิ เพื่อบอก SW ว่าหน้ายังเปิดอยู่

### 7. `css/orders.css` — Phase 4 CSS

- `.hf-chip` — filter chip style พร้อม active state (gradient orange)
- `@keyframes orderCardIn` — slide-in animation สำหรับ active card
- `@keyframes histRowIn` — slide-in animation สำหรับ history row
- `@keyframes sheetUp` — rating sheet entrance animation

### 8. `firestore.rules` — pushJobs Rule

```
match /pushJobs/{jobId} {
  allow create: if request.auth != null
    && request.resource.data.keys().hasAll([...])
    && request.resource.data.done == false;
  allow read, update: if isFirebaseAdmin();
  allow delete: if isFirebaseAdmin();
}
```

---

## Deploy Checklist

- [ ] `cd functions && npm install` (ติดตั้ง web-push)
- [ ] Set VAPID config ใน Firebase Functions
- [ ] `firebase deploy --only functions` (deploy processPushJobs)
- [ ] `firebase deploy --only firestore:rules` (deploy rules ใหม่)
- [ ] `firebase deploy --only hosting` (deploy frontend)
- [ ] ทดสอบ: เปลี่ยน status order → ตรวจว่า pushJobs สร้าง + Web Push ส่ง
- [ ] ทดสอบ: สั่งออเดอร์ → รับแล้ว → ปิดหน้า → เปิดใหม่ → rating popup ขึ้น
- [ ] ทดสอบ: History filter chip + search + export CSV

---

## Files Changed

```
public/
  js/admin.module.js      — updateStatus() เขียน pushJobs อัตโนมัติ
  js/orders.module.js     — pending reviews + filter/search/export + SW listener
  orders.html             — History filter bar UI
  css/orders.css          — Phase 4 chip + animation CSS
  sw.js                   — v22: ORDER_STATUS_UPDATE + PAGE_VISIBLE
functions/
  index.js                — processPushJobs Cloud Function (appended)
  package.json            — เพิ่ม web-push dependency
firestore.rules           — pushJobs collection rule
PHASE4_RELEASE_NOTES.md  — this file
```
