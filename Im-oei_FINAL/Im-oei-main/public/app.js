
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({apiKey:"YOUR_KEY",projectId:"YOUR_PROJECT"});
const db = getFirestore(app);

let cart=[];

window.addItem=(n,p)=>{cart.push({name:n,price:p});render();}

function render(){
 const ul=document.getElementById("cart"); ul.innerHTML="";
 cart.forEach(i=>{ul.innerHTML+=`<li>${i.name} ${i.price}</li>`});
}

window.checkout=async()=>{
 const total=cart.reduce((s,i)=>s+i.price,0);

 await addDoc(collection(db,"orders"),{items:cart,total});

 localStorage.setItem("lastOrder",JSON.stringify({items:cart,total}));
 location.href="/receipt.html";
};

function genQR(phone,amount){
 return `https://promptpay.io/${phone}/${amount}`;
}

document.getElementById("qr").src=genQR("0812345678",100);
