// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDBJnRVHlOkHhWNWT0DEDCQHyxuga8tUrs",
  authDomain: "hackathon-judging-46411.firebaseapp.com",
  projectId: "hackathon-judging-46411",
  storageBucket: "hackathon-judging-46411.firebasestorage.app",
  messagingSenderId: "719256140338",
  appId: "1:719256140338:web:59167583c96504ed409a2b",
  measurementId: "G-9ET5LYWM3J"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);