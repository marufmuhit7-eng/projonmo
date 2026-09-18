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


-- ------------------------------------------------- ৫) টিম ম্যানেজমেন্ট
create table if not exists public.team_members (
  id                 uuid    primary key default gen_random_uuid(),
  name               text    not null,
  role               text    not null default '',
  category           text    not null default 'core',   -- title_sponsor / co_organizer / organizer / volunteer / sponsor
  image_url          text    default '',
  district_institute text    default '',
  facebook_url       text    default '',
  order_no           int     not null default 0,
  created_at         timestamptz not null default now()
);

alter table public.team_members enable row level security;
drop policy if exists "Public read team_members" on public.team_members;
create policy "Public read team_members" on public.team_members
  for select to anon, authenticated using (true);
-- ⚠️ খসড়ার "Public write ... using (true)" বসানো হয়নি — তাহলে anon key জানা
-- মাত্র যে কেউ টিম পাতা মুছে/বদলে দিতে পারত। লেখা শুধু সাইন-ইন করা আয়োয়ক:
drop policy if exists "Public write team_members" on public.team_members;
drop policy if exists "organisers manage team_members" on public.team_members;
create policy "organisers manage team_members" on public.team_members
  for all to authenticated using (true) with check (true);

-- একবারই বীজ: এখনকার হার্ডকোডেড টিমটাই ডেটাবেসে তোলো (টেবিল খালি থাকলে)
insert into public.team_members (name, role, category, image_url, district_institute, facebook_url, order_no)
select * from (values
  ('প্রজন্ম ফাউন্ডেশন', 'টাইটেল স্পন্সর', 'title_sponsor', '/images/projonmo-logo.jpg', '', '', 1),
  ('The Normative', 'সহ-আয়োজক', 'co_organizer', '/images/normative-logo.jpg', '', '', 1),
  ('মুদাব্বির মারুফ মুহিত', 'আহ্বায়ক', 'organizer', '/images/muhit.jpg', '', '', 1),
  ('শেখ ইমরোজ ওয়াতান', 'যুগ্ম আহ্বায়ক', 'organizer', '/images/watan.jpg', '', '', 2),
  ('রংপুর সিটি কর্পোরেশন', 'পৃষ্ঠপোষক', 'sponsor', '/images/rcc.jpg', '', '', 1),
  ('মাদকদ্রব্য নিয়ন্ত্রণ অধিদপ্তর', 'পৃষ্ঠপোষক', 'sponsor', '/images/dnc.jpg', '', '', 2),
  ('রয়্যালটি মেগা মল', 'পৃষ্ঠপোষক', 'sponsor', '/images/royalty.jpg', '', '', 3)
) as seed(name, role, category, image_url, district_institute, facebook_url, order_no)
where not exists (select 1 from public.team_members);

-- ৫খ) 📅 নতুন অফিসিয়াল তারিখ: পরীক্ষা ৩০ সেপ্টেম্বর, রেজিস্ট্রেশন ২৯ সেপ্টেম্বর পর্যন্ত
-- কলামগুলো না থাকলে আগে যোগ হবে, তারপর লাইভ রো-টা নতুন তারিখে চলে যাবে।
alter table public.settings
  add column if not exists registration_start date not null default '2026-08-25',
  add column if not exists registration_end   date not null default '2026-09-29';

update public.settings
   set exam_date          = '2026-09-30T00:00:00+06',
       registration_start = '2026-08-25',
       registration_end   = '2026-09-29',
       updated_at         = now()
 where id = 'exam';

-- 🧹 টেস্ট-রো পরিষ্কার: লাইভ-প্রোবে তৈরি হওয়া রোগুলো মুছে দাও —
delete from public.registrations
 where name in ('probeA','probeB','probe','cat-প্রোব (মুছে দাও)');
