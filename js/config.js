/*
 * config.js — the ONE place you configure the shared backend.
 *
 * Leave SUPABASE_URL empty and everything keeps working on localStorage
 * (single-browser only). Fill it in and both the public site and the admin
 * panel switch to the shared database automatically — no other file changes.
 *
 * This file is copied into BOTH public-site/ and admin-panel/, so fill it in
 * once in src/shared/config.js and run:  npm run build
 *
 * ── Is it safe to put these two values in public JavaScript? ──
 * Yes, and it is the intended design. The "publishable" (anon) key only lets a
 * browser attempt requests; what it is ALLOWED to do is decided server-side by
 * Row Level Security. Our policies (see supabase/schema.sql) permit anyone to
 * READ the exam settings and only a signed-in organiser to WRITE them.
 * Never put the service_role / secret key here — that one bypasses RLS.
 */
window.APP_CONFIG = {
  /* ── Firebase Firestore ────────────────────────────────────────────────
   * The exam lock lives at collection `settings`, document `examControl`:
   *     { isUnlocked: false, targetDate: '2026-09-25T00:00:00' }
   *
   * Fill these six values from Firebase Console → Project settings → General
   * → "Your apps" → SDK setup and configuration → Config. Then: npm run build
   *
   * Leave FIREBASE.projectId empty to stay on whatever else is configured.
   * These values are safe in public JavaScript — they identify the project,
   * they do not authorise anything. What a browser may DO is decided by the
   * Firestore security rules (see firestore.rules): the world may read
   * examControl, only a signed-in organiser may write it.
   */
  FIREBASE: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  },

  // e.g. 'https://abcdefghijklm.supabase.co'  — leave '' to stay on localStorage
  SUPABASE_URL: '',

  // the "anon" / "publishable" key from Project Settings → API
  SUPABASE_ANON_KEY: '',

  // Bangladesh Standard Time. BST is a fixed +06:00 offset with no daylight
  // saving, which is why a plain constant is correct here instead of a TZ database.
  TZ_OFFSET: '+06:00',

  // How often to re-check settings when realtime is unavailable (ms).
  POLL_INTERVAL_MS: 60000
};
