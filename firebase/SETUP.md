# ☁️ Firebase Firestore সেটআপ — গ্লোবাল এক্সাম লক

এই গাইড শেষ করলে অ্যাডমিন প্যানেলের মাস্টার সুইচ **সব ভিজিটরের ব্রাউজারে রিয়েল-টাইমে** কাজ করবে —
যেকোনো ডিভাইস, যেকোনো ব্রাউজার থেকে।

English summary is at the bottom.

---

## কী কী আগে থেকেই তৈরি আছে (কোডে)

- পাবলিক সাইট ও অ্যাডমিন প্যানেল দুটোই `settings` কালেকশনের `examControl` ডকুমেন্ট পড়ে/লেখে:
  `{ isUnlocked: false, targetDate: "2026-09-25T00:00:00" }`
- ভিজিটরদের পাতা `onSnapshot()` দিয়ে শোনে — অ্যাডমিন সুইচ ঘোরালে **রিফ্রেশ ছাড়াই** ১ সেকেন্ডের মধ্যে সব ব্রাউজার আপডেট হয়।
- ডিফল্ট অবস্থা **LOCKED**। ডেটাবেস স্পষ্টভাবে `isUnlocked: true` না বললে, অফলাইন/এরর হলেও — কোনো অবস্থায় প্রশ্ন দেখায় না।
- অ্যাডমিন প্যানেলে (পরীক্ষা নিয়ন্ত্রণ বক্সে) **☁️ ক্লাউড সাইন-ইন** বক্স আছে — Firestore-এ লেখার জন্য এটি লাগবেই।

---

## ধাপ ১ — Firebase প্রজেক্ট খোলো

1. যাও: **https://console.firebase.google.com**
2. **Add project** → নাম দাও (যেমন `uttarbanga-heritage-fest`) → Create.
3. Google Analytics চাইলে বাদ দিতে পারো (Disable) → Continue.

## ধাপ ২ — Web App বানাও ও কনফিগ নাও

1. প্রজেক্ট Overview পেজে **</>** (Web) আইকনে ক্লিক করো।
2. App nickname: `heritage-fest-web` → **Register app** (Hosting লাগবে না)।
3. যে `firebaseConfig` ব্লকটা দেখাবে, সেখান থেকে ৬টা মান কপি করো:
   `apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId`
4. রিপোতে **`src/shared/config.js`** ফাইলের `FIREBASE` অংশে বসাও:
   ```js
   FIREBASE: {
     apiKey: 'AIzaSy...',            // ← তোমার আসল মান
     authDomain: 'your-project.firebaseapp.com',
     projectId: 'your-project',
     storageBucket: 'your-project.appspot.com',
     messagingSenderId: '000000000000',
     appId: '1:000000000000:web:abcdef123456'
   },
   ```
5. রান করো: `npm run build` → ডিপ্লয়/পুশ। এরপরই অ্যাডমিন প্যানেলে ☁️ ক্লাউড সাইন-ইন বক্স দেখা যাবে।

> এই মানগুলো পাবলিক জাভাস্ক্রিপ্টে রাখা **নিরাপদ** — এগুলো শুধু প্রজেক্ট চেনায়, কোনো অনুমতি দেয় না।
> কে কী করতে পারবে তা ঠিক করে নিচের সিকিউরিটি রুলস।

## ধাপ ৩ — Firestore ডেটাবেস চালু করো

1. বাম মেনু → **Build → Firestore Database** → **Create database**।
2. লোকেশন: `asia-south1` (Mumbai — বাংলাদেশের সবচেয়ে কাছে) → Next।
3. **Start in production mode** → Enable. (ট্রায়াল/বিলিং ছাড়াই ফ্রি কোটায় চলবে।)
4. **Start collection**: Collection ID — `settings` → Next।
5. Document ID — `examControl` লিখে ফিল্ডগুলো দাও:
   | ফিল্ড | টাইপ | মান |
   |---|---|---|
   | `isUnlocked` | boolean | `false` |
   | `targetDate` | string | `2026-09-25T00:00:00` |
6. **Save**।

## ধাপ ৪ — সিকিউরিটি রুলস পাবলিশ করো

1. Firestore → **Rules** ট্যাব।
2. এই ফাইলের পাশেই থাকা **`firestore.rules`**-এর পুরো কনটেন্ট পেস্ট করো → **Publish**।

রুলসের মানে: যে কেউ **পড়তে** পারবে (ভিজিটরদের দরকার), কিন্তু **লিখতে** পারবে শুধু
সাইন-ইন করা একজন — এবং ঠিক সেভাবেই নির্ধারিত ফিল্ডগুলো নিয়ে।

## ধাপ ৫ — আয়োজক অ্যাকাউন্ট বানাও (Email/Password)

1. বাম মেনু → **Build → Authentication** → **Get started**।
2. **Sign-in method** ট্যাব → **Email/Password** → **Enable** → Save।
   ⚠️ **Email link (passwordless)** চালু করো না।
3. **Users** ট্যাব → **Add user**:
   - Email: তোমার পছন্দের একটা (যেমন `organiser@projonmo.foundation` — ভেরিফিকেশন লাগে না, যেকোনো ঠিকানা চলবে)
   - Password: শক্ত পাসওয়ার্ড
   → **Add user**।
4. ⚠️ **একটাই অ্যাকাউন্ট রাখো আর পাবলিক সাইন-আপ এমনিতেই বন্ধ** — Email/Password মেথডে
   "Sign-up" পেজ নেই, শুধু Console থেকে ইউজার যোগ করা যায়, তাই কেউ নিজে নিজে অ্যাকাউন্ট বানাতে পারবে না।

## ধাপ ৬ — চালাও

1. সাইট ডিপ্লয় করো (Vercel/GitHub)।
2. `/admin` → অ্যাডমিন লগইন (আগের মতো) → **পরীক্ষা নিয়ন্ত্রণ** বক্স।
3. **☁️ ক্লাউড সাইন-ইন** বক্সে ধাপ ৫-এর ইমেইল/পাসওয়ার্ড দিয়ে সাইন-ইন করো (একবারই লাগবে)।
4. মাস্টার সুইচ ঘোরাও → অন্য ফোন/ব্রাউজারে সাইট খুলে রাখা থাকলে **সঙ্গে সঙ্গে** আনলক দেখবে। ✅

---

## ঝুঁকি-তালিকা (চেক করে নাও)

- [ ] Rules পাবলিশ করেছি, আর রুলসে `allow write: if request.auth != null` আছে।
- [ ] Authentication-এ Email/Password ছাড়া অন্য কিছু (Google, Phone…) চালু করিনি।
- [ ] কনফিগে `service_account` বা admin key নেই — শুধু ৬টা ওয়েব কনফিগ মান।
- [ ] `examControl` ডকুমেন্টে `isUnlocked: false` দিয়ে শুরু করেছি।

ব্যর্থ হলে: অ্যাডমিন প্যানেলের মেসেজ দেখো — permission-denied মানে সাইন-ইন/রুলস সমস্যা;
`config.js` ফাঁকা থাকলে ব্যানারে ⚠️ localStorage ওয়ার্নিং দেখাবে।

---

## English summary

1. Create a Firebase project → add a **Web app** → copy the six `firebaseConfig`
   values into `src/shared/config.js` (`FIREBASE` block) → `npm run build`.
2. Firestore → Create database (`asia-south1`, **production mode**) → collection
   `settings`, document `examControl`: `{ isUnlocked: false, targetDate: "2026-09-25T00:00:00" }`.
3. Publish `firebase/firestore.rules` in the Firestore **Rules** tab.
4. Authentication → enable **Email/Password** (nothing else) → **Users → Add user**
   (one organiser account; public sign-up stays impossible).
5. In `/admin`, sign in once via the **☁️ Cloud sign-in** box, then flip the master
   switch — every visitor's browser updates instantly via `onSnapshot`. The exam
   stays LOCKED by default unless Firestore explicitly says `isUnlocked: true`.
