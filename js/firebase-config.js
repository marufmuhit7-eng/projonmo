/*
 * firebase-config.js — 👉 এখানেই তোমার Firebase কনফিগ বসাও 👈
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  কোথা থেকে পাবে:
 *    1. https://console.firebase.google.com → তোমার প্রজেক্ট
 *    2. ⚙️ Project settings → General → "Your apps" → Web app (</>) → Config
 *    3. নিচের ৬টা মান কপি-পেস্ট করো (apiKey, authDomain, projectId,
 *       storageBucket, messagingSenderId, appId)
 *    4) তারপর রান করো:  npm run build
 *
 *  নিরাপত্তা: এই মানগুলো পাবলিক জাভাস্ক্রিপ্টে রাখা নিরাপদ — এগুলো শুধু
 *  প্রজেক্ট চেনায়, কোনো অনুমতি দেয় না। কে কী করতে পারবে তা ঠিক করে
 *  Firebase Console-এ পাবলিশ করা firestore.rules (firebase/ ফোল্ডারে খসড়া আছে)।
 *
 *  ⚠️ apiKey ফাঁকা ('') থাকলে সাইট "স্থানীয় মোড"-এ চলে: পরীক্ষা সবসময়
 *  LOCKED থাকে, রেজিস্ট্রেশন সেভ হয় না। অর্থাৎ fail-closed।
 * ─────────────────────────────────────────────────────────────────────────
 */
window.FIREBASE_CONFIG = {
  apiKey: '',            // ← যেমন: 'AIzaSy…'
  authDomain: '',        // ← যেমন: 'your-project.firebaseapp.com'
  projectId: '',         // ← যেমন: 'your-project'
  storageBucket: '',     // ← যেমন: 'your-project.appspot.com'
  messagingSenderId: '', // ← যেমন: '123456789012'
  appId: ''              // ← যেমন: '1:123456789012:web:abcdef123456'
};
