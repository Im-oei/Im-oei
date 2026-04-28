# 🔐 วิธีตั้งค่า Security (Firestore Rules + Admin Token)

## ขั้นตอนที่ 1: Deploy Firestore Rules

ไปที่ Firebase Console → Firestore → Rules แล้ว copy เนื้อหาจากไฟล์ `firestore.rules` ไปวาง แล้ว Publish

## ขั้นตอนที่ 2: ตั้งค่า Admin Token (สำคัญมาก!)

ระบบใช้ **Admin Token** เป็น secret key สำหรับให้ admin เขียน Firestore ได้

### วิธีสร้าง Token

1. ไปที่ Firebase Console → Firestore → Data
2. เปิด collection `settings` → document `auth`
3. เพิ่ม field ใหม่:
   - **Field name:** `adminToken`
   - **Type:** string
   - **Value:** สร้าง random string ยาวๆ เช่น `a7f3k9x2m5p8q1w4e6r0t`
     (แนะนำ: ใช้ https://generate-secret.vercel.app/32 หรือ random 32 chars)

### ตัวอย่างโครงสร้าง settings/auth:
```
settings/
  auth/
    adminHash: "..."      ← hash รหัสผ่านแอดมิน (มีอยู่แล้ว)
    ownerHash: "..."      ← hash รหัสผ่านเจ้าของร้าน (มีอยู่แล้ว)
    adminToken: "a7f3k9x2m5p8q1w4e6r0t"   ← เพิ่มใหม่
```

## ขั้นตอนที่ 3: ทดสอบ

1. Login เข้า admin panel
2. ลองแก้ไขเมนู — ถ้าสำเร็จ = setup ถูกต้อง
3. ถ้า error "Missing or insufficient permissions" = adminToken ไม่ถูกต้อง

## หมายเหตุ

- `_adminToken` จะถูกบันทึกลงใน Firestore documents ของ admin (menu, settings ฯลฯ)  
  ซึ่งเป็นที่ยอมรับได้เพราะ client อ่านข้อมูลเหล่านั้นอยู่แล้ว
- Token จะถูก expire อัตโนมัติเมื่อ session หมด (8 ชั่วโมง)
- ถ้าต้องการความปลอดภัยสูงสุด แนะนำให้ migrate ไปใช้ Firebase Authentication

## สิ่งที่ Rules ป้องกัน

| การกระทำ | ลูกค้าทั่วไป | Admin |
|---------|------------|-------|
| อ่านเมนู/แบนเนอร์ | ✅ | ✅ |
| แก้ไขเมนู | ❌ | ✅ |
| ลบออเดอร์ | ❌ | ❌ (ใช้ Console แทน) |
| แก้ไข settings | ❌ | ✅ |
| สร้างออเดอร์ | ✅ (validate แล้ว) | ✅ |
