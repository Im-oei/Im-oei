
const db = firebase.firestore();
db.collection("orders").onSnapshot(snapshot=>{
 let revenue=0,orders=0,customers=new Set();
 snapshot.forEach(doc=>{
   const d=doc.data();
   orders++;
   revenue+=d.total||0;
   customers.add(d.userId);
 });
 document.getElementById("revenue").innerText="฿"+revenue;
 document.getElementById("orders").innerText=orders;
 document.getElementById("customers").innerText=customers.size;
});
