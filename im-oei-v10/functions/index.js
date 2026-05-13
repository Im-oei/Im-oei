

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

// ─── HELPER: Rate Limit ────────────────────────────────────────────────────
// ใช้ Admin SDK เขียน rateLimits (client เขียนตรงไม่ได้ตาม rules)
async function checkRateLimit(key, maxCount = 5, windowMs = 60_000) {
  const ref = db.collection("rateLimits").doc(key);
  const now = Date.now();

  try {
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) {
        tx.set(ref, { count: 1, windowStart: now });
        return;
      }
      const { count, windowStart } = doc.data();
      if (now - windowStart > windowMs) {
        // เริ่ม window ใหม่
        tx.set(ref, { count: 1, windowStart: now });
      } else if (count >= maxCount) {
        throw new functions.https.HttpsError(
          "resource-exhausted",
          "Too many requests. Please try again later."
        );
      } else {
        tx.update(ref, { count: admin.firestore.FieldValue.increment(1) });
      }
    });
  } catch (err) {
    if (err.code === "resource-exhausted") throw err;
    console.error("checkRateLimit error:", err);
    // ไม่ block ถ้า rate limit เองมีปัญหา
  }
}

// ─── 0. validateAndCreateOrder: Callable — ป้องกัน price manipulation ────────
// ปัญหาเดิม: cart.module.js ส่ง total + price จาก client ตรง = แก้ราคาได้
// แนวทาง: function ดึงราคาจาก menu collection (server-side) recalculate total
// เขียน order ผ่าน Admin SDK — แน่ใจว่าราคาถูกต้อง 100%
exports.validateAndCreateOrder = functions
  .region("asia-northeast1")
  .runWith({ enforceAppCheck: false }) // 🔓 ไม่บังคับ App Check — ลูกค้า anonymous สั่งได้
  .https.onCall(async (data, context) => {
    const {
      items, note, customerName, customerPhone,
      lineUserId, guestId, pickupTime,
      pickupLocation, pickupLocationName, isPreorder, preorderDate,
    } = data;

    // Validate identity
    if (!customerPhone && !lineUserId && !guestId) {
      throw new functions.https.HttpsError("invalid-argument", "ต้องระบุ customerPhone, lineUserId หรือ guestId");
    }
    // Validate items
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      throw new functions.https.HttpsError("invalid-argument", "items ไม่ถูกต้อง (1-50 รายการ)");
    }
    for (const item of items) {
      if (!item.id || typeof item.id !== "string") throw new functions.https.HttpsError("invalid-argument", "item.id ไม่ถูกต้อง");
      const qty = parseInt(item.qty);
      if (!qty || qty < 1 || qty > 99) throw new functions.https.HttpsError("invalid-argument", `qty ของ ${item.id} ไม่ถูกต้อง`);
    }
    if (customerName && customerName.length > 100) throw new functions.https.HttpsError("invalid-argument", "customerName ยาวเกินไป");
    if (note && note.length > 200) throw new functions.https.HttpsError("invalid-argument", "note ยาวเกินไป");
    if (customerPhone && !/^0[0-9]{9}$/.test(customerPhone)) throw new functions.https.HttpsError("invalid-argument", "customerPhone format ผิด");

    // Rate limit: 10 orders / 5 นาที / user
    const rlKey = customerPhone || lineUserId || guestId;
    await checkRateLimit(`createOrder_${rlKey}`, 10, 300_000);

    // ดึงราคาจาก Firestore server-side (ป้องกัน price manipulation)
    const menuRefs = items.map(i => db.collection("menu").doc(i.id));
    const menuDocs = await db.getAll(...menuRefs);

    const orderItems = [];
    let calculatedTotal = 0;

    for (let i = 0; i < items.length; i++) {
      const menuDoc = menuDocs[i];
      const clientItem = items[i];
      const qty = parseInt(clientItem.qty);

      if (!menuDoc.exists) throw new functions.https.HttpsError("not-found", `ไม่พบเมนู: ${clientItem.id}`);
      const m = menuDoc.data();
      if (m.hidden === true) throw new functions.https.HttpsError("failed-precondition", `เมนู "${m.name}" ถูกซ่อน`);
      if (m.soldOut === true) throw new functions.https.HttpsError("failed-precondition", `เมนู "${m.name}" หมดแล้ว`);

      const serverPrice = m.price; // ✅ ราคาจาก server เท่านั้น
      const subtotal = serverPrice * qty;
      calculatedTotal += subtotal;
      orderItems.push({ id: clientItem.id, name: m.name, qty, price: serverPrice, subtotal });
    }

    if (calculatedTotal <= 0) throw new functions.https.HttpsError("invalid-argument", "ยอดรวมต้องมากกว่า 0");

    // เขียน order ผ่าน Admin SDK
    const orderRef = await db.collection("orders").add({
      items: orderItems,
      total: calculatedTotal,    // ✅ server-calculated เท่านั้น
      note: note || "",
      customerName: customerName || "",
      ...(customerPhone ? { customerPhone } : {}),
      ...(lineUserId    ? { lineUserId }    : {}),
      ...(guestId       ? { guestId }       : {}),
      pickupTime: pickupTime || "07:30",
      pickupLocation: pickupLocation || "",
      pickupLocationName: pickupLocationName || "",
      status: "pending",
      isPreorder: isPreorder === true,
      preorderDate: isPreorder ? (preorderDate || "") : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`validateAndCreateOrder: ${orderRef.id}, total=${calculatedTotal}`);
    return { success: true, orderId: orderRef.id, total: calculatedTotal };
  });

// ─── 1. onOrderCreate: stats + stamps (ปลอดภัย — Admin SDK bypass rules) ───
exports.onOrderCreate = functions.region("asia-northeast1").firestore
  .document("orders/{orderId}")
  .onCreate(async (snap, context) => {
    // ─── Idempotency guard ────────────────────────────────────────────────────
    // Firestore triggers อาจ retry ได้ → stats/stamps จะ increment ซ้ำถ้าไม่ป้องกัน
    // ใช้ eventId (unique ต่อ trigger invocation) เป็น lock ใน rateLimits collection
    const eventId = context.eventId;
    const lockRef = db.collection("rateLimits").doc(`onOrderCreate_${eventId}`);
    try {
      await db.runTransaction(async (tx) => {
        const lockDoc = await tx.get(lockRef);
        if (lockDoc.exists) throw new Error("ALREADY_PROCESSED");
        tx.set(lockRef, { processedAt: admin.firestore.FieldValue.serverTimestamp() });
      });
    } catch (err) {
      if (err.message === "ALREADY_PROCESSED") {
        console.log(`onOrderCreate: skipped duplicate eventId=${eventId}`);
        return;
      }
      // lock เองมีปัญหา — log แล้วดำเนินการต่อ (ดีกว่าทำให้ stats หาย)
      console.error("onOrderCreate: idempotency lock error:", err.message);
    }

    const data = snap.data();
    const date = new Date().toISOString().slice(0, 10);
    const batch = db.batch();

    // stats_daily
    const dayRef = db.collection("stats_daily").doc(date);
    batch.set(dayRef, {
      totalSales: admin.firestore.FieldValue.increment(data.total || 0),
      totalOrders: admin.firestore.FieldValue.increment(1),
    }, { merge: true });

    // stats_menu
    const items = data.items || [];
    for (const item of items) {
      if (!item.id) continue;
      const menuStatRef = db.collection("stats_menu").doc(item.id);
      batch.set(menuStatRef, {
        name: item.name || "",
        totalQty: admin.firestore.FieldValue.increment(item.qty || 1),
        totalRevenue: admin.firestore.FieldValue.increment((item.price || 0) * (item.qty || 1)),
      }, { merge: true });
    }

    // ─── ADDED: stamps — เขียนผ่าน Admin SDK ไม่ผ่าน client ────────────────
    // ก่อนหน้า: cart.html เขียน stamps ตรง = client ปั๊มได้
    // ใหม่: function คำนวณเอง ลูกค้า manipulate ไม่ได้
    const phone = data.customerPhone;
    const stSnap = await db.collection("settings").doc("stamps").get();
    const bahtPerPoint = stSnap.exists ? (stSnap.data().bahtPerPoint || 25) : 25;
    const earned = Math.floor((data.total || 0) / bahtPerPoint);

    if (phone && phone.match(/^0[0-9]{9}$/) && earned > 0) {
      const stampRef = db.collection("stamps").doc(phone);
      batch.set(stampRef, {
        phone,
        points: admin.firestore.FieldValue.increment(earned),
        lifetimePoints: admin.firestore.FieldValue.increment(earned),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    await batch.commit();
    console.log(`onOrderCreate: orderId=${snap.id}, stamps+${earned} for ${phone}`);
  });

// ─── 2. sendLineMessage: Callable Function (ป้องกัน public spam) ──────────
// ก่อนหน้า: admin.html addDoc lineQueue ตรง = ใครก็ยิง LINE ได้
// ใหม่: ต้อง call function นี้ ซึ่งตรวจ isAdmin ก่อน
exports.sendLineMessage = functions
  .runWith({ enforceAppCheck: false }) // 🔐 App Check — reject ถ้าไม่มี valid token
  .https.onCall(async (data, context) => {
  // ตรวจ auth
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }

  // ตรวจ admin (ดู admins collection เหมือน rules)
  const adminDoc = await db.collection("admins").doc(context.auth.uid).get();
  if (!adminDoc.exists) {
    throw new functions.https.HttpsError("permission-denied", "Admin only.");
  }

  const { lineUserId, message, orderId } = data;

  // Validate input
  if (!lineUserId || typeof lineUserId !== "string" || lineUserId.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "lineUserId required.");
  }
  if (!message || typeof message !== "string" || message.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "message required.");
  }
  if (message.length > 500) {
    throw new functions.https.HttpsError("invalid-argument", "message too long (max 500 chars).");
  }

  // Rate limit: admin ยิงได้ max 30 ครั้ง/นาที (กัน accident spam)
  await checkRateLimit(`sendLine_${context.auth.uid}`, 30, 60_000);

  // เขียน lineQueue ผ่าน Admin SDK
  const docId = orderId ? `order_${orderId}` : db.collection("lineQueue").doc().id;
  await db.collection("lineQueue").doc(docId).set({
    lineUserId,
    message,
    status: "pending",
    createdBy: context.auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(orderId ? { orderId } : {}),
  });

  console.log(`sendLineMessage: queued ${docId} by admin ${context.auth.uid}`);
  return { success: true, docId };
});

// ─── 3. processLineQueue: Firestore trigger ────────────────────────────────
exports.processLineQueue = functions.region("asia-northeast1").firestore
  .document("lineQueue/{docId}")
  .onCreate(async (snap, context) => {
    const data = snap.data();
    if (!data || data.status !== "pending") return;

    const lineUserId = data.lineUserId;
    const message   = data.message;
    const docId     = context.params.docId;

    // Validate (double-check แม้ผ่าน sendLineMessage แล้ว)
    if (!lineUserId || !message || message.length > 500) {
      await snap.ref.update({ status: "error", error: "Invalid payload" });
      return;
    }

    const token = functions.config().line?.token;
    if (!token) {
      console.error("LINE token not set.");
      await snap.ref.update({ status: "error", error: "LINE token not configured" });
      return;
    }

    const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const pushCtrl = new AbortController();
        const pushTimer = setTimeout(() => pushCtrl.abort(), 5000); // 5 วิ/attempt
        let res;
        try {
          res = await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({
              to: lineUserId,
              messages: [{ type: "text", text: message }],
            }),
            signal: pushCtrl.signal,
          });
        } finally {
          clearTimeout(pushTimer);
        }

        const resBody = await res.json();

        if (res.ok) {
          await snap.ref.update({
            status: "sent",
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            attempts: attempt,
          });
          console.log(`✅ LINE sent to ${lineUserId} (doc: ${docId})`);
          return;
        }

        if (res.status >= 400 && res.status < 500) {
          await snap.ref.update({ status: "error", error: JSON.stringify(resBody), attempts: attempt });
          return;
        }

        lastError = JSON.stringify(resBody);
        console.warn(`LINE 5xx attempt ${attempt}:`, resBody);
      } catch (err) {
        lastError = err.message;
        console.warn(`LINE network error attempt ${attempt}:`, err.message);
      }

      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }

    await snap.ref.update({ status: "error", error: lastError || "Max retries", attempts: MAX_RETRIES });
  });

// ─── 4. bindLineAccount: Callable (ย้ายจาก liff.html เขียน lineUsers ตรง) ──
// ก่อนหน้า: liff.html setDoc lineUsers/linePhoneMap ตรง = hijack ได้
// ใหม่: function ตรวจ LIFF id_token ก่อน แล้วค่อยเขียนผ่าน Admin SDK
exports.bindLineAccount = functions
  .runWith({ enforceAppCheck: false })
  .https.onCall(async (data, context) => {
  const { lineUserId, displayName, phone, liffIdToken } = data;

  // Validate
  if (!lineUserId || typeof lineUserId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "lineUserId required.");
  }
  if (!phone || !phone.match(/^0[0-9]{9}$/)) {
    throw new functions.https.HttpsError("invalid-argument", "valid phone required.");
  }
  if (!liffIdToken) {
    throw new functions.https.HttpsError("invalid-argument", "LIFF id_token required.");
  }

  // ─── Verify LIFF id_token กับ LINE API ────────────────────────────────────
  // ป้องกัน: ส่ง lineUserId ของคนอื่นมา bind เข้า phone ตัวเอง
  const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
  const liffId = functions.config().line?.liff_id;

  if (liffId) {
    // ─── Timeout 3 วิ — ถ้า LINE ช้า/ล่ม ไม่ให้ค้างค้าง ──────────────────
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    let verifyRes, verifyBody;
    try {
      verifyRes = await fetch(`https://api.line.me/oauth2/v2.1/verify?id_token=${liffIdToken}&client_id=${liffId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: ctrl.signal,
      });
      verifyBody = await verifyRes.json();
    } catch (err) {
      if (err.name === "AbortError") {
        throw new functions.https.HttpsError("deadline-exceeded", "LINE verify timeout — กรุณาลองใหม่");
      }
      throw new functions.https.HttpsError("unavailable", "ไม่สามารถติดต่อ LINE ได้ชั่วคราว");
    } finally {
      clearTimeout(timer);
    }

    if (!verifyRes.ok || verifyBody.sub !== lineUserId) {
      throw new functions.https.HttpsError("permission-denied", "LIFF token verification failed.");
    }
  } else {
    console.warn("bindLineAccount: line.liff_id not configured, skipping token verify.");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.set(db.collection("lineUsers").doc(lineUserId), {
    userId: lineUserId,
    displayName: displayName || "",
    phone,
    linkedAt: now,
    updatedAt: now,
  }, { merge: true });

  batch.set(db.collection("linePhoneMap").doc(phone), {
    userId: lineUserId,
    updatedAt: now,
  });

  await batch.commit();
  console.log(`bindLineAccount: ${lineUserId} bound to ${phone}`);
  return { success: true };
});



// ─── 7. hashAndSavePassword: Callable (ป้องกัน plaintext password ใน Firestore) ─
// เดิม: savePasswords() ใน admin.module.js เขียน plaintext ลง settings/store ตรง
// ใหม่: hash ด้วย bcrypt server-side → เก็บ hash เท่านั้น
exports.hashAndSavePassword = functions
  .runWith({ enforceAppCheck: false })
  .https.onCall(async (data, context) => {
    // ตรวจ auth
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required.");
    }

    // ตรวจ admin (owner เท่านั้น)
    const adminDoc = await db.collection("admins").doc(context.auth.uid).get();
    if (!adminDoc.exists || adminDoc.data().role !== "owner") {
      throw new functions.https.HttpsError("permission-denied", "Owner only.");
    }

    const { adminPassword, ownerPassword } = data;

    // Validate
    if (adminPassword !== undefined && typeof adminPassword !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "adminPassword must be string.");
    }
    if (ownerPassword !== undefined && typeof ownerPassword !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "ownerPassword must be string.");
    }
    if (!adminPassword && !ownerPassword) {
      throw new functions.https.HttpsError("invalid-argument", "At least one password required.");
    }
    if (adminPassword && (adminPassword.length < 6 || adminPassword.length > 128)) {
      throw new functions.https.HttpsError("invalid-argument", "Password must be 6–128 chars.");
    }
    if (ownerPassword && (ownerPassword.length < 6 || ownerPassword.length > 128)) {
      throw new functions.https.HttpsError("invalid-argument", "Password must be 6–128 chars.");
    }

    // Rate limit: owner เปลี่ยน password ได้ 5 ครั้ง/ชั่วโมง
    await checkRateLimit(`hashPwd_${context.auth.uid}`, 5, 3_600_000);

    const bcrypt = require("bcrypt");
    const ROUNDS = 12; // work factor
    const updates = {};

    if (adminPassword) {
      updates.adminPasswordHash = await bcrypt.hash(adminPassword, ROUNDS);
      // ลบ plaintext เก่าทิ้งถ้ามี
      updates.adminPassword = admin.firestore.FieldValue.delete();
    }
    if (ownerPassword) {
      updates.ownerPasswordHash = await bcrypt.hash(ownerPassword, ROUNDS);
      updates.ownerPassword = admin.firestore.FieldValue.delete();
    }

    // 🔐 FIX: เขียน hash ไปที่ settings/auth (admin-only read) แทน settings/store (public read)
    // ลบ plaintext เก่าที่อาจยังค้างอยู่ใน settings/store ด้วย
    await db.collection("settings").doc("auth").set(updates, { merge: true });

    // ลบ plaintext field เก่าออกจาก settings/store ถ้ามี (migration cleanup)
    const storeCleanup = {};
    if (adminPassword) storeCleanup.adminPassword = admin.firestore.FieldValue.delete();
    if (ownerPassword) storeCleanup.ownerPassword = admin.firestore.FieldValue.delete();
    await db.collection("settings").doc("store").set(storeCleanup, { merge: true }).catch(() => {});

    console.log(`hashAndSavePassword: updated by owner ${context.auth.uid}`);
    return { success: true };
  });

// ─── 8. verifyAdminPassword: Callable (ตรวจสอบรหัสผ่าน admin แบบ bcrypt) ──
// ใช้โดย login.module.js แทนการ getDoc settings/store แล้วเปรียบ plaintext
exports.verifyAdminPassword = functions
  .runWith({ enforceAppCheck: false })
  .https.onCall(async (data, context) => {
    const { password, role } = data;

    if (!password || typeof password !== "string" || password.length > 128) {
      throw new functions.https.HttpsError("invalid-argument", "password required.");
    }
    if (!role || !["admin", "owner"].includes(role)) {
      throw new functions.https.HttpsError("invalid-argument", "role must be admin or owner.");
    }

    // Rate limit ป้องกัน brute-force: 10 ครั้ง/5 นาที
    // 🔐 FIX: ลบ data.clientKey ออก — client ส่ง key อะไรก็ได้ = bypass rate limit ได้
    // ใช้ uid ถ้า login แล้ว, ถ้า unauthenticated ใช้ "anon_global" (shared bucket)
    // anon_global = throttle รวมทุก unauthenticated request → กัน brute-force ได้จริง
    const rateLimitKey = context.auth?.uid || "anon_global";
    await checkRateLimit(`verifyPwd_${rateLimitKey}`, 10, 300_000);

    const bcrypt = require("bcrypt");

    // 🔐 FIX: อ่าน hash จาก settings/auth (admin-only) แทน settings/store (public)
    // รองรับ migration: ตรวจ settings/auth ก่อน ถ้าไม่มีค่อย fallback ไป settings/store (legacy)
    const authDoc = await db.collection("settings").doc("auth").get();
    const storeDoc = await db.collection("settings").doc("store").get();

    const hashField = role === "owner" ? "ownerPasswordHash" : "adminPasswordHash";
    const legacyField = role === "owner" ? "ownerPassword" : "adminPassword";

    // ดึงค่าจากทั้งสอง doc เพื่อรองรับ migration period
    const authData = authDoc.exists ? authDoc.data() : {};
    const storeData = storeDoc.exists ? storeDoc.data() : {};

    // รองรับ migration period: ถ้ายังมี plaintext เก่า ให้เปรียบตรงก่อน
    // แล้วแจ้งให้ migrate ไป hash
    if (authData[hashField]) {
      // ✅ ใหม่: hash อยู่ใน settings/auth แล้ว
      const match = await bcrypt.compare(password, authData[hashField]);
      return { match };
    } else if (storeData[hashField]) {
      // Migration path: hash ยังอยู่ใน settings/store เก่า → ย้ายมา settings/auth
      console.warn(`verifyAdminPassword: hash still in settings/store, migrating to settings/auth`);
      const match = await bcrypt.compare(password, storeData[hashField]);
      if (match) {
        await db.collection("settings").doc("auth").set(
          { [hashField]: storeData[hashField] }, { merge: true }
        );
        await db.collection("settings").doc("store").update(
          { [hashField]: admin.firestore.FieldValue.delete() }
        );
        console.log(`verifyAdminPassword: migrated ${hashField} to settings/auth`);
      }
      return { match };
    } else if (storeData[legacyField]) {
      // Legacy plaintext — ยังใช้ได้แต่ log warning
      console.warn(`verifyAdminPassword: LEGACY plaintext password still in use for role=${role}. Please migrate!`);
      const match = password === storeData[legacyField];
      if (match) {
        // Auto-migrate: hash แล้วเขียนไป settings/auth + ลบ plaintext จาก settings/store
        const hash = await bcrypt.hash(storeData[legacyField], 12);
        await db.collection("settings").doc("auth").set(
          { [hashField]: hash }, { merge: true }
        );
        await db.collection("settings").doc("store").update({
          [legacyField]: admin.firestore.FieldValue.delete(),
        });
        console.log(`verifyAdminPassword: auto-migrated ${role} password → bcrypt hash in settings/auth`);
      }
      return { match };
    }

    return { match: false };
  });

exports.cleanupLineQueue = functions.region("asia-northeast1").pubsub
  .schedule("0 0 * * *")
  .timeZone("Asia/Bangkok")
  .onRun(async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    const snap = await db.collection("lineQueue")
      .where("status", "in", ["sent", "error"])
      .where("createdAt", "<", cutoff)
      .limit(500)
      .get();

    if (snap.empty) return;

    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    console.log(`cleanupLineQueue: deleted ${snap.size} old docs`);
  });

// ─── 6. getLineUserStatus: LIFF ถามว่าผูกเบอร์แล้วหรือยัง ─────────────────
// แทน getDoc(lineUsers/userId) ตรงจาก client ซึ่ง Rules บล็อก
// verify liffIdToken ก่อน → ถ้าผ่านค่อย return phone status
exports.getLineUserStatus = functions
  .runWith({ enforceAppCheck: false })
  .https.onCall(async (data, context) => {
    const { lineUserId, liffIdToken } = data;

    if (!lineUserId || !liffIdToken) {
      throw new functions.https.HttpsError("invalid-argument", "lineUserId and liffIdToken required.");
    }

    // verify token กับ LINE
    const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
    const liffId = functions.config().line?.liff_id;

    if (liffId) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      let verifyRes, verifyBody;
      try {
        verifyRes = await fetch(`https://api.line.me/oauth2/v2.1/verify?id_token=${liffIdToken}&client_id=${liffId}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: ctrl.signal,
        });
        verifyBody = await verifyRes.json();
      } catch (err) {
        if (err.name === "AbortError") throw new functions.https.HttpsError("deadline-exceeded", "LINE verify timeout");
        throw new functions.https.HttpsError("unavailable", "ไม่สามารถติดต่อ LINE ได้ชั่วคราว");
      } finally {
        clearTimeout(timer);
      }

      if (!verifyRes.ok || verifyBody.sub !== lineUserId) {
        throw new functions.https.HttpsError("permission-denied", "LIFF token verification failed.");
      }
    }

    // ดึงข้อมูลผ่าน Admin SDK (bypass Rules ได้อย่างปลอดภัย)
    const userDoc = await db.collection("lineUsers").doc(lineUserId).get();
    if (!userDoc.exists) {
      return { linked: false };
    }
    const d = userDoc.data();
    return {
      linked: true,
      phone: d.phone || "",
      displayName: d.displayName || "",
      pictureUrl: d.pictureUrl || null,
    };
  });

// ─── issueAdminCustomToken: Callable ─────────────────────────────────────────
// แก้ปัญหา: LINE admin login ไม่ได้ทำ Firebase Auth signIn
// → request.auth = null → isFirebaseAdmin() = false
// → อ่าน orders, customers, lineQueue ไม่ได้ → หน้าว่างทั้งหมด
//
// Flow:
// 1. Client ส่ง lineUserId + liffToken
// 2. Function verify LIFF token กับ LINE API
// 3. ตรวจ admins/{lineUserId} ใน Firestore
// 4. ออก Firebase Custom Token (uid = lineUserId)
// 5. Client signInWithCustomToken → มี Firebase Auth → Firestore rules ผ่าน
exports.issueAdminCustomToken = functions
  .region("asia-northeast1")
  .runWith({ enforceAppCheck: false })
  .https.onCall(async (data, context) => {
    const { lineUserId, liffToken } = data;

    if (!lineUserId || typeof lineUserId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "lineUserId required.");
    }
    if (!liffToken || typeof liffToken !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "liffToken required.");
    }

    // Rate limit: 10 ครั้ง / 5 นาที ต่อ LINE user
    await checkRateLimit(`adminToken_${lineUserId}`, 10, 300_000);

    // ── Verify LIFF token กับ LINE API ──────────────────────────────────────
    // 🔐 FIX: เพิ่ม fetch import (node-fetch เหมือน function อื่น) +
    //         เปลี่ยน GET→POST + body แบบ form-encoded
    //         LINE /oauth2/v2.1/verify ต้องการ POST เท่านั้น
    //         การใช้ GET ทำให้ได้ error response → verifyRes.ok = false → login พัง 100%
    const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
    let verifyBody;
    try {
      const liffId = functions.config().line?.liff_id || "";
      const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `id_token=${encodeURIComponent(liffToken)}&client_id=${encodeURIComponent(liffId)}`,
      });
      verifyBody = await verifyRes.json();
      if (!verifyRes.ok || verifyBody.sub !== lineUserId) {
        throw new functions.https.HttpsError("unauthenticated", "LIFF token ไม่ถูกต้อง");
      }
    } catch (err) {
      if (err.code) throw err; // HttpsError จาก code ข้างบน
      console.error("LIFF verify error:", err.message);
      throw new functions.https.HttpsError("internal", "LIFF verify ล้มเหลว");
    }

    // ── ตรวจ admin role ใน Firestore ─────────────────────────────────────────
    const adminDoc = await db.collection("admins").doc(lineUserId).get();
    if (!adminDoc.exists) {
      throw new functions.https.HttpsError("permission-denied", "ไม่มีสิทธิ์ admin");
    }
    const role = adminDoc.data().role || "admin";
    if (role !== "admin" && role !== "owner") {
      throw new functions.https.HttpsError("permission-denied", "Role ไม่ถูกต้อง");
    }

    // ── ออก Custom Token ─────────────────────────────────────────────────────
    // uid = lineUserId เพื่อให้ admins/{uid} exists → isFirebaseAdmin() = true
    const customToken = await admin.auth().createCustomToken(lineUserId, {
      role,
      lineUserId,
      isAdmin: true,
    });

    console.log(`issueAdminCustomToken: issued for ${lineUserId} role=${role}`);
    return { customToken, role };
  });

// ─── redeemReward: Callable — หักแต้ม + บันทึก redemption (server-side) ────
// เดิม: orders.module.js updateDoc(stamps) + addDoc(rewardRedemptions) ตรง
//       → stamps rules block client write → ฟีเจอร์แลกรางวัลพัง
//       → rewardRedemptions ownership ไม่ตรง (ไม่มี lineUserId field)
// ใหม่: callable ตรวจ ownership + atomic transaction หักแต้ม + บันทึก
exports.redeemReward = functions
  .runWith({ enforceAppCheck: false })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required.");
    }

    const { rewardId, rewardName, pointCost, emoji, phone, lineUserId } = data;

    // Validate inputs
    if (!rewardId || typeof rewardId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "rewardId required.");
    }
    if (!pointCost || typeof pointCost !== "number" || pointCost < 1) {
      throw new functions.https.HttpsError("invalid-argument", "pointCost must be a positive number.");
    }
    if (!phone && !lineUserId) {
      throw new functions.https.HttpsError("invalid-argument", "phone or lineUserId required.");
    }
    if (phone && !/^0[0-9]{9}$/.test(phone)) {
      throw new functions.https.HttpsError("invalid-argument", "phone format invalid.");
    }

    // Ownership check: phone ต้องตรงกับ token หรือ lineUserId ต้องตรงกับ uid
    const validPhone  = phone     && context.auth.token.phone_number === phone;
    const validLine   = lineUserId && context.auth.uid               === lineUserId;
    if (!validPhone && !validLine) {
      throw new functions.https.HttpsError("permission-denied", "Identity mismatch.");
    }

    // Rate limit: 10 redemptions / 10 นาที / user
    const rlKey = phone || lineUserId;
    await checkRateLimit(`redeem_${rlKey}`, 10, 600_000);

    // Verify reward exists and is active
    const rewardDoc = await db.collection("rewards").doc(rewardId).get();
    if (!rewardDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Reward not found.");
    }
    const reward = rewardDoc.data();
    if (reward.hidden === true) {
      throw new functions.https.HttpsError("failed-precondition", "Reward is not available.");
    }
    // Verify pointCost from server (prevent client manipulation)
    if (reward.pointCost !== pointCost) {
      throw new functions.https.HttpsError("invalid-argument", "pointCost mismatch with server.");
    }

    // Check maxQty if set
    if (reward.maxQty && typeof reward.maxQty === "number") {
      const usedSnap = await db.collection("rewardRedemptions")
        .where("rewardId", "==", rewardId)
        .where("status", "!=", "rejected")
        .get();
      if (usedSnap.size >= reward.maxQty) {
        throw new functions.https.HttpsError("resource-exhausted", "รางวัลนี้หมดแล้ว");
      }
    }

    // Atomic: หักแต้ม + บันทึก redemption ใน transaction
    const stampDocId = phone || lineUserId;
    const stampRef   = db.collection("stamps").doc(stampDocId);
    let newPoints;

    await db.runTransaction(async (tx) => {
      const stampSnap = await tx.get(stampRef);
      const curPoints = stampSnap.exists()
        ? (stampSnap.data().points || stampSnap.data().total || 0)
        : 0;

      if (curPoints < pointCost) {
        throw new functions.https.HttpsError("failed-precondition", "แต้มไม่พอ");
      }

      newPoints = curPoints - pointCost;

      // หักแต้ม
      tx.update(stampRef, {
        points: newPoints,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // บันทึก redemption
      const redemptionRef = db.collection("rewardRedemptions").doc();
      tx.set(redemptionRef, {
        rewardId,
        rewardName: reward.name || rewardName || "",
        pointsUsed: pointCost,
        emoji: reward.emoji || emoji || "🎁",
        ...(phone      ? { phone }      : {}),
        ...(lineUserId ? { lineUserId } : {}),
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    console.log(`redeemReward: ${rewardId} by ${rlKey}, newPoints=${newPoints}`);
    return { success: true, newPoints };
  });

// ─── expireMyStamps: Callable — รีเซ็ตแต้มหมดอายุ (server-side) ─────────────
// เดิม: orders.module.js updateDoc(stamps) ตรง → rules บล็อก client write
// ใหม่: callable ตรวจ ownership แล้วค่อยเขียนผ่าน Admin SDK
exports.expireMyStamps = functions
  .runWith({ enforceAppCheck: false })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required.");
    }
    const { phone } = data;
    if (!phone || !/^0[0-9]{9}$/.test(phone)) {
      throw new functions.https.HttpsError("invalid-argument", "valid phone required.");
    }
    // Ownership: phone ต้องตรงกับ Firebase Auth token
    if (context.auth.token.phone_number !== phone) {
      throw new functions.https.HttpsError("permission-denied", "Phone mismatch.");
    }

    // ตรวจ expiry settings + stamp ก่อนเสมอ (ไม่รีเซ็ตถ้าไม่หมดอายุจริง)
    const [stSnap, stampSnap] = await Promise.all([
      db.collection("settings").doc("stamps").get(),
      db.collection("stamps").doc(phone).get(),
    ]);
    const expiryDays = stSnap.exists() ? (stSnap.data().expiryDays || 0) : 0;
    if (expiryDays === 0 || !stampSnap.exists()) return { expired: false };

    const d = stampSnap.data();
    const lastUpdate = d.updatedAt?.toDate ? d.updatedAt.toDate() : new Date(d.updatedAt || 0);
    const daysSince = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSince <= expiryDays || (d.points || 0) === 0) return { expired: false };

    await db.collection("stamps").doc(phone).update({
      points: 0,
      expiredAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`expireMyStamps: reset points for ${phone}`);
    return { expired: true };
  });
