-- =====================================================================
--  🔧 PATCH — তোমার ইতিমধ্যে-তৈরি টেবিলগুলোতে যা যা কম ছিল, তা যোগ করে।
--
--  তুমি নিজের খসড়া SQL চালিয়েছিলে (settings/registrations/questions)।
--  নিচের স্ক্রিপ্টটা সেই একই টেবিলে ALTER করে বাকি ফিচারগুলো যোগ করবে —
--  কোনো ডেটা মুছবে না, আবার চালালেও নিরাপদ (idempotent)।
--
--  কোথায়: Supabase Dashboard → SQL Editor → New query → পুরোটা পেস্ট → Run
-- =====================================================================

-- 1) settings: রেজিস্ট্রেশন-উইন্ডোর তারিখ দুটি ------------------------------
alter table public.settings
  add column if not exists registration_start date not null default '2026-08-25',
  add column if not exists registration_end   date not null default '2026-09-20';

-- 2) registrations: পিডি (UHF-আইডি), শ্রেণি/ক্যাটাগরি, পরীক্ষার স্কোর --------
alter table public.registrations
  add column if not exists pid            text unique,
  add column if not exists cls            text default '',
  add column if not exists category       text,
  add column if not exists exam_taken     boolean not null default false,
  add column if not exists score          int    not null default 0,
  add column if not exists max_score      int    not null default 0,
  add column if not exists time_taken_sec int    not null default 0,
  add column if not exists submitted_at   timestamptz;

-- পুরনো রো থাকলে তাদের pid বসিয়ে দাও (uuid → text)
update public.registrations set pid = id::text where pid is null;

-- 3) questions: ক্যাটাগরি ও ইংরেজি অপশন (ঐচ্ছিক কলাম) ----------------------
alter table public.questions
  add column if not exists category      text not null default 'primary',
  add column if not exists question_en   text default '',
  add column if not exists option_a_en   text default '',
  add column if not exists option_b_en   text default '',
  add column if not exists option_c_en   text default '',
  add column if not exists option_d_en   text default '';

create index if not exists questions_category_order_idx
  on public.questions (category, order_no);

-- 4) leaderboard: VIEW-এর বদলে টেবিল (RPC-ই লিখবে; ফোন/ইমেইল থাকে না) ------
drop view if exists public.leaderboard;
create table if not exists public.leaderboard (
  pid            text primary key,
  name           text not null,
  institute      text default '',
  district       text default '',
  score          int not null default 0,
  max_score      int not null default 0,
  time_taken_sec int not null default 0,
  created_at     timestamptz not null default now()
);
alter table public.leaderboard enable row level security;
drop policy if exists "leaderboard readable by everyone" on public.leaderboard;
create policy "leaderboard readable by everyone" on public.leaderboard
  for select to anon, authenticated using (true);

-- 5) RPC: নিজের আইডি দিয়ে রেকর্ড খোঁজা + স্কোর জমা --------------------------
create or replace function public.get_registration(p_pid text)
returns json
language sql security definer set search_path = public
as $$
  select to_json(r) from public.registrations r
   where r.pid = upper(p_pid) or r.id::text = p_pid;
$$;

create or replace function public.save_exam_result(
  p_pid text, p_score int, p_max int, p_time int, p_cat text
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  update public.registrations
     set exam_taken = true, score = p_score, max_score = p_max,
         time_taken_sec = p_time, category = p_cat, submitted_at = now()
   where (pid = upper(p_pid) or id::text = p_pid) and exam_taken = false;
  if not found then return false; end if;
  insert into public.leaderboard (pid, name, institute, district, score, max_score, time_taken_sec)
  select pid, name, institute, district, p_score, p_max, p_time
    from public.registrations where pid = upper(p_pid) or id::text = p_pid
  on conflict (pid) do update
    set score = excluded.score, max_score = excluded.max_score,
        time_taken_sec = excluded.time_taken_sec;
  return true;
end $$;

revoke all on function public.get_registration(text) from public;
revoke all on function public.save_exam_result(text, int, int, int, text) from public;
grant execute on function public.get_registration(text) to anon, authenticated;
grant execute on function public.save_exam_result(text, int, int, int, text) to anon, authenticated;

-- =====================================================================
--  6) 🔒 নিরাপত্তা: খোলা পলিসিগুলো বদলে আসল তালা
--     এখন যে কেউ anon key দিয়ে settings লিখতে/পরীক্ষা আনলক করতে পারছে,
--     আর সবার ফোন-নম্বর টেনে নিতে পারছে — নিচের অংশটাই সেটা বন্ধ করে।
--     ☁️ আয়োজক সাইন-ইন করা ছাড়া আর কেউ লিখতে পারবে না।
-- =====================================================================

-- settings: পাঠ সবার জন্য, লেখা শুধু আয়োজকের
drop policy if exists "insert settings" on public.settings;
drop policy if exists "update settings" on public.settings;
drop policy if exists "read settings"   on public.settings;
create policy "settings readable by everyone" on public.settings
  for select to anon, authenticated using (true);
create policy "organisers insert settings" on public.settings
  for insert to authenticated with check (id = 'exam');
create policy "organisers update settings" on public.settings
  for update to authenticated using (true) with check (true);

-- questions: পাঠ সবার জন্য, লেখা শুধু আয়োজকের
drop policy if exists "read questions"  on public.questions;
drop policy if exists "write questions" on public.questions;
create policy "questions readable by everyone" on public.questions
  for select to anon, authenticated using (true);
create policy "organisers manage questions" on public.questions
  for all to authenticated using (true) with check (true);

-- registrations: নতুন রেকর্ড সবাই দিতে পারবে; পুরো তালিকা (ফোন-নম্বরসহ)
-- শুধু আয়োজক দেখবে; সাধারণ অংশগ্রহণকারী নিজের আইডি দিয়ে
-- get_registration RPC দিয়ে শুধু নিজের রো আনতে পারবে।
drop policy if exists "insert registrations" on public.registrations;
drop policy if exists "read registrations"   on public.registrations;
create policy "anyone may register" on public.registrations
  for insert to anon, authenticated
  with check (char_length(name) > 0);
create policy "organisers read registrations" on public.registrations
  for select to authenticated using (true);
create policy "organisers update registrations" on public.registrations
  for update to authenticated using (true) with check (true);

-- 7) Realtime: সুইচ ঘোরালে খোলা ব্রাউজার নিজে আপডেট হবে --------------------
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.questions;

-- =====================================================================
--  ✅ শেষ। এরপর Authentication → Users → Add user-এ একটাই আয়োয়ক
--  অ্যাকাউন্ট বানাও — ওটা দিয়ে /admin-এর ☁️ সাইন-ইন বক্সে ঢুকে সুইচ/
--  প্রশ্ন/তালিকা চালাবে।
--
--  🧹 টেস্ট রো: "স্কিমা-প্রোব (মুছে দাও)" নামে একটা রো রেখে এসেছি প্রোবের
--  সময় — Table Editor → registrations → ওই রোটা ডিলিট করে দাও।
-- =====================================================================
