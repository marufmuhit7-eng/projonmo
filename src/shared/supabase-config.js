/*
 * supabase-config.js — 👉 তোমার Supabase প্রজেক্টের দরজা 🚪
 *
 * মানগুলো এসেছে: Supabase Dashboard → Settings → API
 *   SUPABASE_URL       = Project URL
 *   SUPABASE_ANON_KEY  = anon / public key
 *
 * ⚠️ নিরাপত্তা-নোট:
 *   • anon key পাবলিক জাভাস্ক্রিপ্টে রাখা নিরাপদ — কে কী করতে পারবে তা
 *     ঠিক করে Postgres-এর RLS পলিসি (supabase/schema.sql)।
 *   • service_role key কখনোই এখানে (বা কোনো ক্লায়েন্ট কোডে) বসাবে না —
 *     ওটা সব RLS বাইপাস করে।
 *
 * SUPABASE_URL ফাঁকা ('') থাকলে সাইট fail-closed মোডে চলে:
 * পরীক্ষা সবসময় LOCKED, রেজিস্ট্রেশন সেভ হয় না।
 */
window.SUPABASE_CONFIG = {
  SUPABASE_URL: 'https://zlqwmpatcamochqmivxi.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpscXdtcGF0Y2Ftb2NocW1pdnhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NTE4NTYsImV4cCI6MjEwMzQyNzg1Nn0.lDSEYwfn-WzubO6Sx9ykYd2AzxQ8PJ4pLr79t-IsSN0'
};
