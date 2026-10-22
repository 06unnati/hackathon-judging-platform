// Firebase setup shared by both pages.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, onSnapshot, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const configured = !String(firebaseConfig.apiKey).startsWith("PASTE");
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

export {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot, writeBatch,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
};

export function errMsg(err) {
  const code = err && err.code;
  if (code === "permission-denied") return "Not allowed. Your access may have expired; sign in again.";
  if (code === "unavailable") return "Can't reach the server. Check your connection and try again.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found")
    return "Wrong email or password.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a minute and try again.";
  return (err && err.message) || "Something went wrong. Try again.";
}

let toastT;
export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), 2800);
}