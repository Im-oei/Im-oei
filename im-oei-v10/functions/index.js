

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

// 🔧 FIX: static import แทน dynamic import ทุก call — ลด cold start + overhead
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

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

// ─── 1. onOrderCreate: stats + stamps (ปลอดภัย — Admin SDK bypass rules) ───
exports.onOrderCreate = functions.region("asia-northeast1").firestore
  .document("orders/{orderId}")
  .onCreate(async (snap) => {
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
  .runWith({ enforceAppCheck: true }) // 🔐 App Check — reject ถ้าไม่มี valid token
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
  const liffId = functions.config().line?.liff_id;

  // 🔐 FIX: throw ถ้า liffId ไม่ได้ set — ไม่ข้าม verify แบบเงียบๆ
  if (!liffId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "LINE LIFF ID ยังไม่ได้ตั้งค่าบน server — ติดต่อผู้ดูแลระบบ"
    );
  }

  {
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

// ─── 5. cleanupLineQueue: รัน ทุกคืน ─────────────────────────────────────
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
  .https.onCall(async (data, context) => {
    const { lineUserId, liffIdToken } = data;

    if (!lineUserId || !liffIdToken) {
      throw new functions.https.HttpsError("invalid-argument", "lineUserId and liffIdToken required.");
    }

    // verify token กับ LINE
    const liffId = functions.config().line?.liff_id;

    // 🔐 FIX: throw ถ้า liffId ไม่ได้ set
    if (!liffId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "LINE LIFF ID ยังไม่ได้ตั้งค่าบน server — ติดต่อผู้ดูแลระบบ"
      );
    }

    {
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

// ─── 7. issueAdminToken: ออก Firebase Custom Token ให้ LINE admin ──────────
// แทน: ตรวจ role ใน sessionStorage (bypass ได้ใน DevTools)
// ใหม่: Functions ตรวจ liffIdToken + lineUserId ใน admins collection
//        แล้วออก customToken พร้อม claims { role: "admin" }
//        client เอา token ไป signInWithCustomToken → Firestore rules ตรวจ claim ได้จริง
exports.issueAdminToken = functions
  .https.onCall(async (data, context) => {
    const { lineUserId, liffIdToken } = data;

    if (!lineUserId || !liffIdToken) {
      throw new functions.https.HttpsError("invalid-argument", "lineUserId and liffIdToken required.");
    }

    // ─── Verify LIFF id_token ────────────────────────────────────────────────
    const liffId = functions.config().line?.liff_id;

    if (!liffId) {
      throw new functions.https.HttpsError("failed-precondition", "LINE LIFF ID not configured.");
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    let verifyBody;
    try {
      const verifyRes = await fetch(
        `https://api.line.me/oauth2/v2.1/verify?id_token=${liffIdToken}&client_id=${liffId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: ctrl.signal,
        }
      );
      verifyBody = await verifyRes.json();
      if (!verifyRes.ok || verifyBody.sub !== lineUserId) {
        throw new functions.https.HttpsError("permission-denied", "LIFF token verification failed.");
      }
    } catch (err) {
      if (err.code === "permission-denied") throw err;
      if (err.name === "AbortError") throw new functions.https.HttpsError("deadline-exceeded", "LINE verify timeout");
      throw new functions.https.HttpsError("unavailable", "ไม่สามารถตรวจสอบ LIFF token ได้");
    } finally {
      clearTimeout(timer);
    }

    // ─── ตรวจ admins collection ───────────────────────────────────────────────
    const adminSnap = await db.collection("admins")
      .where("lineUserId", "==", lineUserId)
      .limit(1)
      .get();

    if (adminSnap.empty) {
      throw new functions.https.HttpsError("permission-denied", "ไม่พบสิทธิ์แอดมิน");
    }

    const adminData = adminSnap.docs[0].data();
    const role = adminData.role || "admin"; // "admin" | "owner"

    // ─── ออก Custom Token ─────────────────────────────────────────────────────
    const uid = `line_${lineUserId}`;
    const customToken = await admin.auth().createCustomToken(uid, { role });

    console.log(`issueAdminToken: issued token for lineUserId=${lineUserId} role=${role}`);
    return { customToken, role };
  });

// ─── 8. redeemReward: Callable — หักแต้มและบันทึก redemption แบบ atomic ──
// 🔐 FIX: ย้ายออกจาก client (client เคย updateDoc stamps โดยตรง = โกงได้)
// ใหม่: transaction บน server — อ่านแต้ม, ตรวจว่าพอ, หัก, บันทึก redemption พร้อมกัน
exports.redeemReward = functions.region("asia-northeast1")
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");
    }

    const { rewardId, phone } = data;

    if (!rewardId || typeof rewardId !== "string") {
      throw new functions.https.HttpsError("invalid-argument", "rewardId required.");
    }
    if (!phone || !phone.match(/^0[0-9]{9}$/)) {
      throw new functions.https.HttpsError("invalid-argument", "valid phone required.");
    }

    // Rate limit: กัน double-submit / spam
    await checkRateLimit(`redeem_${context.auth.uid}`, 5, 60_000);

    // ดึงข้อมูล reward
    const rewardDoc = await db.collection("rewards").doc(rewardId).get();
    if (!rewardDoc.exists) {
      throw new functions.https.HttpsError("not-found", "ไม่พบรางวัลนี้");
    }
    const reward = rewardDoc.data();
    if (reward.active === false) {
      throw new functions.https.HttpsError("failed-precondition", "รางวัลนี้ปิดใช้งานแล้ว");
    }
    const pointCost = reward.points || reward.pointCost || reward.cost || 0;
    if (!pointCost) {
      throw new functions.https.HttpsError("failed-precondition", "รางวัลนี้ไม่มีราคาแต้ม");
    }

    // ตรวจ maxQty (ถ้ามี)
    if (reward.maxQty > 0) {
      const usedSnap = await db.collection("rewardRedemptions")
        .where("rewardId", "==", rewardId)
        .where("status", "!=", "rejected")
        .get();
      if (usedSnap.size >= reward.maxQty) {
        throw new functions.https.HttpsError("resource-exhausted", "😢 รางวัลนี้หมดแล้ว");
      }
    }

    const stampRef = db.collection("stamps").doc(phone);
    const redemptionRef = db.collection("rewardRedemptions").doc();

    // 🔐 Atomic transaction — อ่าน + ตรวจ + หัก + บันทึก ในครั้งเดียว
    await db.runTransaction(async (tx) => {
      const stampSnap = await tx.get(stampRef);
      if (!stampSnap.exists) {
        throw new functions.https.HttpsError("not-found", "ไม่พบข้อมูลแต้มของคุณ");
      }
      const curPoints = stampSnap.data().points || 0;
      if (curPoints < pointCost) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `แต้มไม่เพียงพอ (มี ${curPoints} แต้ม ต้องการ ${pointCost} แต้ม)`
        );
      }

      // หักแต้ม
      tx.update(stampRef, {
        points: admin.firestore.FieldValue.increment(-pointCost),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // บันทึก redemption
      tx.set(redemptionRef, {
        rewardId,
        rewardName: reward.name || "",
        emoji: reward.emoji || "🎁",
        pointsUsed: pointCost,
        phone,
        uid: context.auth.uid,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    console.log(`redeemReward: ${phone} redeemed ${rewardId} (${pointCost} pts)`);
    return {
      success: true,
      redemptionId: redemptionRef.id,
      pointsUsed: pointCost,
      rewardName: reward.name || "",
    };
  });
