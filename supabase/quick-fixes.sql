-- =====================================================================
--  🔧 QUICK FIX — অ্যাডমিন প্যানেলে রেজিস্ট্রেশন দেখা + নিরাপত্তা গুছানো
--
--  লাইভ প্রোবে যা পাওয়া গেছে: fix-reg-and-category.sql চালানো হয়েছে ✅
--  (RPC কাজ করছে, কোড UHF000020+ বিলি হচ্ছে), কিন্তু —
--    ১) anon দিয়ে সরাসরি INSERT এখন 401 (পলিসি মিস হয়ে গেছে বলে)
--    ২) রেজিস্ট্রেশন তালিকা anon-এর কাছে ০ রো — ইচ্ছাকৃত (ফোন/ইমেইল
--       শুধু সাইন-ইন করা আয়োয়ক দেখবে) — অ্যাডমিনে দেখতে ☁️ সাইন-ইন করো
--    ৩) reg_counter টেবিল খোলা ছিল — এখন তালাবদ্ধ করা হলো
--
--  কোথায়: Supabase → SQL Editor → এই পুরোটা পেস্ট → Run (নিরাপদ, idempotent)
-- =====================================================================

-- ১) পাবলিক রেজিস্ট্রেশন ফর্মের সরাসরি-ইনসার্ট পথ ফিরিয়ে দাও
--    (RPC-পথ আগে থেকেই চলছে; এটা শুধু ফলব্যাকের জন্য)
alter table public.registrations enable row level security;
drop policy if exists "anyone may register" on public.registrations;
create policy "anyone may register" on public.registrations
  for insert to anon, authenticated
  with check (char_length(name) > 0);

-- ২) reg_counter তালাবদ্ধ — কাউন্টার ছোঁয় শুধু create_registration RPC
--    (RPC-টা security definer, তাই তালার বাইরে থেকেও কাজ করবে)
alter table public.reg_counter enable row level security;
revoke all on table public.reg_counter from anon, authenticated;

-- ৩) আয়োয়ক-পাঠ নিশ্চিত করো (সাইন-ইন করা অ্যাকাউন্ট সব রো দেখবে)
drop policy if exists "organisers read registrations" on public.registrations;
create policy "organisers read registrations" on public.registrations
  for select to authenticated using (true);
drop policy if exists "organisers update registrations" on public.registrations;
create policy "organisers update registrations" on public.registrations
  for update to authenticated using (true) with check (true);

-- =====================================================================
--  ⛔ ঐচ্ছিক: সত্যিই জনসাধারণের পাঠযোগ্য করতে চাইলে নিচের ৩ লাইন চালাও।
--  ⚠️ সতর্কতা: তখন anon key জানা থাকলেই যে কেউ সবার ফোন-নম্বর ও ইমেইল
--  (নাবালকদেরও) টেনে নিতে পারবে। সুপারিশ: না চালিয়ে ☁️ সাইন-ইন ব্যবহার করো।
--
--  drop policy if exists "Public read registrations" on public.registrations;
--  create policy "Public read registrations" on public.registrations
--    for select using (true);
-- =====================================================================

-- ৪) ক্যাটাগরি: কলামটা নিশ্চিত + পুরনো (RPC-পূর্ব) রোগুলোতে ডিফল্ট বসাও
--    (নতুন রেজিস্ট্রেশনগুলো RPC থেকে আগে থেকেই ক্যাটাগরি পায়)
alter table public.registrations
  add column if not exists category text default 'সাধারণ';

update public.registrations
   set category = 'সাধারণ'
 where category is null;

-- ⚠️ create_registration RPC বদলানোর দরকার নেই — চলছে এমন ভার্সনই
-- p_category নেয় ও সেভ করে (লাইভে যাচাইকৃত)। খসড়া ৬-প্যারাম সংস্করণে
-- বসালে p_cls (শ্রেণি) হারিয়ে যেত; তবু চাইলে JS দুই আকৃতিই সামলাবে।

-- 🧹 টেস্ট-রো পরিষ্কার: লাইভ-প্রোবে তৈরি হওয়া রোগুলো মুছে দাও —
delete from public.registrations
 where name in ('probeA','probeB','probe','cat-প্রোব (মুছে দাও)');
