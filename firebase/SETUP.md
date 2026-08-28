# 🔥 Firebase সেটআপ গাইড — উত্তরবঙ্গ হেরিটেজ ফেস্ট

এই গাইড শেষ করলে পুরো সাইট (পরীক্ষার লক, প্রশ্ন, রেজিস্ট্রেশন, লিডারবোর্ড)
Firebase Firestore থেকে চলবে — যেকোনো ডিভাইস, যেকোনো ব্রাউজারে।

---

## কোড কীভাবে সাজানো আছে

| ফাইল | কাজ |
|---|---|
| `src/shared/firebase-config.js` | 👉 **একমাত্র ফাইল যেখানে তোমার কনফিগ বসাতে হবে** |
| `src/shared/firebase-db.js` | Firestore-এর সব কথাবার্তা (এক জায়গায়) |
| `src/shared/settings.js` | পরীক্ষার লক/তারিখ + বাংলা তারিখ হেল্পার |
| `firebase/firestore.rules` | সিকিউরিটি রুলস (নিচে ধাপ ৪-এ পাবলিশ করবে) |

localStorage এখন শুধু **ক্যাশ** — কোনো গ্লোবাল সিদ্ধান্ত সেখান থেকে আসে না।
Firebase কনফিগ না থাকলে বা নেট কাটলে পরীক্ষা **সবসময় LOCKED** থাকে (fail-closed)।

## ধাপ ১ — প্রজেক্ট + Web App (২ মিনিট)

1. **console.firebase.google.com** → Create project (নাম যেমন `uttarbanga-heritage-fest`)
2. Overview পেজে **`</>`** (Web) → nickname: `heritage-fest-web` → Register app
3. `firebaseConfig` ব্লক থেকে ৬টা মান কপি করো

## ধাপ ২ — কনফিগ বসাও (১ মিনিট)

`src/shared/firebase-config.js` ফাইলে ৬টা মান বসাও:

```js
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSy…তোমার মান…',
  authDomain: 'uttarbanga-heritage-fest.firebaseapp.com',
  projectId: 'uttarbanga-heritage-fest',
  storageBucket: '…',
  messagingSenderId: '…',
  appId: '…'
};
```

তারপর: `npm run build` → ডিপ্লয়। এই মানগুলো পাবলিক JS-এ রাখা নিরাপদ —
অনুমতি ঠিক করে রুলস, কনফিগ নয়।

## ধাপ ৩ — Firestore Database (৩ মিনিট)

1. Build → **Firestore Database** → Create database
   → location: `asia-south1` → **Start in production mode** → Enable
2. **Start collection** → Collection ID: `settings` → Next
   → Document ID: **হাতে লিখো** `examControl` → ফিল্ড:

| ফিল্ড | টাইপ | মান |
|---|---|---|
| `isUnlocked` | boolean | `false` |
| `examDate` | string | `2026-09-25T00:00:00+06:00` |
| `registrationStart` | string | `2026-08-25` |
| `registrationEnd` | string | `2026-09-20` |

> এই ডকুমেন্টটা না বানালেও সাইট চলবে (ডিফল্ট = লকড, উপরের তারিখই) —
> তবে বানিয়ে রাখলে অ্যাডমিন প্যানেল প্রথমবারেই সঠিক মান দেখায়।

`registrations`, `questions`, `leaderboard` কালেকশন **হাতে বানাতে হবে না** —
সাইট প্রথম রেজিস্ট্রেশন/প্রশ্ন সেভ করার সময় নিজেই বানিয়ে নেবে।

## ধাপ ৪ — সিকিউরিটি রুলস পাবলিশ (১ মিনিট)

Firestore → **Rules** ট্যাব → পাশের ফাইল **`firebase/firestore.rules`**-এর
পুরো কনটেন্ট পেস্ট → **Publish**।

## ধাপ ৫ — আয়োজক অ্যাকাউন্ট (২ মিনিট)

1. Build → **Authentication** → Get started
2. **Email/Password** → Enable → Save *(অন্য কিছু চালু কোরো না)*
3. **Users** → Add user → ইমেইল + শক্ত পাসওয়ার্ড

এই অ্যাকাউন্ট দিয়েই `/admin`-এর **☁️ আয়োজক সাইন-ইন** বক্সে ঢুকে তারপর
মাস্টার সুইচ/প্রশ্ন বদলাতে হবে। (অ্যাডমিন লগইন muhit123 আগের মতোই আলাদা।)

## ধাপ ৬ — টেস্ট চেকলিস্ট ✅

| # | পরীক্ষা | প্রত্যাশিত |
|---|---|---|
| 1 | অ্যাডমিনে মাস্টার সুইচ OFF রেখে অন্য ব্রাউজারে সাইট খোলো | কাউন্টডাউন (দিন/ঘণ্টা/মিনিট/সেকেন্ড) দেখায় |
| 2 | অ্যাডমিনে সুইচ ON করো | অন্য ব্রাউজার **রিফ্রেশ ছাড়াই** পরীক্ষা খুলে যায় (onSnapshot) |
| 3 | ফোন থেকে রেজিস্ট্রেশন করো | অ্যাডমিন → রেজিস্ট্রেশন তালিকায় সঙ্গে সঙ্গে দেখা যায় (Refresh) |
| 4 | প্রশ্ন যোগ/সম্পাদনা/মুছো | পরীক্ষার পাতায় নতুন প্রশ্নই আসে |
| 5 | Firebase কনফিগ মুছে বিল্ড করো / নেট বন্ধ করো | পরীক্ষা LOCKED — কখনোই নিজে থেকে খোলে না |
| 6 | Rules Playground: `write /settings/examControl` unauthenticated | DENY হতে হবে |

## নিরাপত্তা — সৎ সীমাবদ্ধতা

- অ্যাডমিন লগইন (`muhit123`) ব্রাউজারে-চলা চেক — আসল তালা হলো রুলস +
  ☁️ সাইন-ইন। পাসওয়ার্ড বদলানোর ঘরটা অ্যাডমিনের ব্রাউজারেই সেভ থাকে।
- স্কোর পাবলিক ক্লায়েন্ট থেকে লেখা হয় — রুলস ফিল্ড-সীমা টানলেও ১০০%
  নিরাপদ করতে ভবিষ্যতে অংশগ্রহণকারীদের Auth লাগবে।
- একটাই আয়োজক অ্যাকাউন্ট রাখো; কনফিগ ফাইলে কখনো সার্ভিস-অ্যাকাউন্ট key নয়।

## সমস্যা নির্ণয় (রেজিস্ট্রেশন কাজ না করলে)

ব্রাউজার কনসোলে `[registration] failed:` লাইনটা দেখো — err.code বলে দেবে কারণ:

| কনসোলে যা দেখাবে | মানে | করণীয় |
|---|---|---|
| `unavailable` / `failed-precondition` / `not-found` | **ডাটাবেস তৈরিই হয়নি** | উপরের ধাপ ৩ করো |
| `permission-denied` | **রুলস পাবলিশ হয়নি** | উপরের ধাপ ৪ করো |
| নেটওয়ার্ক এরর | ভিজিটরের ইন্টারনেট / gstatic ব্লক | অন্য নেটওয়ার্কে চেষ্টা করো |
