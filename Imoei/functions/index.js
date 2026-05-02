
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

exports.onOrderCreate = functions.firestore
.document("orders/{id}")
.onCreate(async (snap)=>{
  const data = snap.data();
  const date = new Date().toISOString().slice(0,10);

  await admin.firestore().collection("stats_daily").doc(date).set({
    totalSales: admin.firestore.FieldValue.increment(data.total),
    totalOrders: admin.firestore.FieldValue.increment(1)
  },{merge:true});
});
