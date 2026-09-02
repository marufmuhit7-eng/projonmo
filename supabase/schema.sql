-- =====================================================================
--  উত্তরবঙ্গ হেরিটেজ ফেস্ট — Supabase schema (একবার চালাও, সব তৈরি)
--  কোথায়: Supabase Dashboard → SQL Editor → New query → এই পুরো ফাইল
--  পেস্ট করো → Run। আবার চালালেও কিছু নষ্ট হবে না (idempotent)।
--
--  নিরাপত্তা-মডেল (RLS = Postgres-এ বাস্তবায়িত, ব্রাউজার-কোড নয়):
--    • সবাই পড়তে পারে:  settings, questions, leaderboard
--    • সবাই পারে:        নতুন registration INSERT,
--                        নিজের আইডি দিয়ে রেকর্ড খোঁজা (get_registration RPC),
--                        পরীক্ষার স্কোর জমা (save_exam_result RPC)
--    • শুধু সাইন-ইন করা আয়োজক পারে: settings/questions লেখা,
--                        পুরো registrations তালিকা দেখা/বদলানো
--
--  ⚠️ তোমার খসড়ায় "update settings using (true)" — অর্থাৎ দুনিয়ার যে
--  কেউ anon key দিয়ে পরীক্ষা আনলক করে দিতে পারত। সেই কারণে settings/
--  questions-এর লেখা শুধু authenticated (আয়োজক) রাখা হয়েছে। সত্যিই
--  খোলা টেস্ট দরকার হলে ফাইলের একদম নিচের কমেন্ট-ব্লকটা দেখো।
-- =====================================================================

-- ---------------------------------------------------------------- 1. settings
create table if not exists public.settings (
  id                  text        primary key default 'exam',
  is_unlocked         boolean     not null default false,   -- 🔒 default LOCKED
  exam_date           timestamptz not null default '2026-09-25T00:00:00+06',
  registration_start  date        not null default '2026-08-25',
  registration_end    date        not null default '2026-09-20',
  updated_at          timestamptz not null default now(),
  constraint settings_single_row check (id = 'exam')
);

insert into public.settings (id, is_unlocked, exam_date, registration_start, registration_end)
values ('exam', false, '2026-09-25T00:00:00+06', '2026-08-25', '2026-09-20')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- 2. questions
--  category: 'primary' | 'junior' | 'senior' (শ্রেণিভিত্তিক প্রশ্ন-সেট)
--  বাংলা কলামগুলো আসল; _en গুলো ঐচ্ছিক (খালি থাকলে বাংলাই দেখায়)।
create table if not exists public.questions (
  id            uuid    primary key default gen_random_uuid(),
  category      text    not null default 'primary',
  question      text    not null,
  question_en   text    default '',
  option_a      text    not null,
  option_b      text    not null,
  option_c      text    not null,
  option_d      text    not null,
  option_a_en   text    default '',
  option_b_en   text    default '',
  option_c_en   text    default '',
  option_d_en   text    default '',
  correct_answer text   not null default 'A'
                     check (correct_answer in ('A','B','C','D')),
  order_no      int     not null default 0,
  source        text,                            -- e.g. 'google_sheet'
  source_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists questions_category_order_idx
  on public.questions (category, order_no);
create index if not exists questions_category_idx
  on public.questions (category);

-- ------------------------------------------------------------- 3. registrations
create table if not exists public.registrations (
  id             uuid    primary key default gen_random_uuid(),
  pid            text    unique not null,          -- অংশগ্রহণকারীর UHF-XXXXXX আইডি
  name           text    not null,
  email          text    default '',
  phone          text    not null default '',
  institute      text    default '',               -- স্কুল
  district       text    default '',               -- জেলা/এলাকা
  cls            text    default '',               -- শ্রেণি (ক্যাটাগরি বের করতে)
  category       text,                             -- primary/junior/senior
  exam_taken     boolean not null default false,
  score          int     not null default 0,
  max_score      int     not null default 0,
  time_taken_sec int     not null default 0,
  submitted_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists registrations_created_idx
  on public.registrations (created_at desc);

-- --------------------------------------------------------------- 4. leaderboard
--  পাবলিক স্কোর-তালিকা — ইচ্ছা করেই ফোন/ইমেইল রাখা হয়নি।
create table if not exists public.leaderboard (
  pid            text    primary key,
  name           text    not null,
  institute      text    default '',
  district       text    default '',
  score          int     not null default 0,
  max_score      int     not null default 0,
  time_taken_sec int     not null default 0,
  created_at     timestamptz not null default now()
);

-- =====================================================================
--  5. RLS + policies
-- =====================================================================
alter table public.settings       enable row level security;
alter table public.questions      enable row level security;
alter table public.registrations  enable row level security;
alter table public.leaderboard    enable row level security;

-- ---- settings: সবাই পড়ে; লেখে শুধু আয়োজক -------------------------------
drop policy if exists "settings readable by everyone" on public.settings;
create policy "settings readable by everyone" on public.settings
  for select to anon, authenticated using (true);

drop policy if exists "organisers write settings" on public.settings;
create policy "organisers write settings" on public.settings
  for insert to authenticated with check (id = 'exam');
drop policy if exists "organisers update settings" on public.settings;
create policy "organisers update settings" on public.settings
  for update to authenticated using (true) with check (true);

-- ---- questions: সবাই পড়ে; লেখে শুধু আয়োয়ক -------------------------------
-- (মুছে ফেলা ও আপডেট এক পলিসিতেই — for all to authenticated)
drop policy if exists "questions readable by everyone" on public.questions;
create policy "questions readable by everyone" on public.questions
  for select to anon, authenticated using (true);

drop policy if exists "organisers manage questions" on public.questions;
create policy "organisers manage questions" on public.questions
  for all to authenticated using (true) with check (true);

-- ---- registrations -----------------------------------------------------
drop policy if exists "anyone may register" on public.registrations;
create policy "anyone may register" on public.registrations
  for insert to anon, authenticated
  with check (char_length(pid) > 0 and char_length(name) > 0);

-- পুরো তালিকা (ফোন-নম্বরসহ) শুধু আয়োজক দেখে; সাধারণ ভিজিটর নিজের আইডি
-- দিয়ে get_registration RPC দিয়ে ঠিক নিজের রোটাই আনতে পারে।
drop policy if exists "organisers read registrations" on public.registrations;
create policy "organisers read registrations" on public.registrations
  for select to authenticated using (true);

-- স্কোর বসায় শুধু save_exam_result RPC (নিচে) — সরাসরি UPDATE বন্ধ।
drop policy if exists "organisers update registrations" on public.registrations;
create policy "organisers update registrations" on public.registrations
  for update to authenticated using (true) with check (true);

-- ---- leaderboard: সবাই পড়ে; লেখে শুধু RPC -------------------------------
drop policy if exists "leaderboard readable by everyone" on public.leaderboard;
create policy "leaderboard readable by everyone" on public.leaderboard
  for select to anon, authenticated using (true);

-- =====================================================================
--  6. RPC ফাংশন (security definer — নির্দিষ্ট কাজ ছাড়া কিছু করতে পারে না)
-- =====================================================================

-- নিজের registration আইডি দিয়ে আনা (পরীক্ষায় ঢোকার দরজা)
create or replace function public.get_registration(p_pid text)
returns json
language sql security definer set search_path = public
as $$
  select to_json(r) from public.registrations r where r.pid = upper(p_pid);
$$;

-- পরীক্ষার স্কোর জমা: registrations আপডেট + leaderboard-এ পাবলিক রো
create or replace function public.save_exam_result(
  p_pid text, p_score int, p_max int, p_time int, p_cat text
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  update public.registrations
     set exam_taken     = true,
         score          = p_score,
         max_score      = p_max,
         time_taken_sec = p_time,
         category       = p_cat,
         submitted_at   = now()
   where pid = upper(p_pid) and exam_taken = false;
  if not found then
    return false;                       -- আইডি নেই, বা আগেই পরীক্ষা দিয়েছে
  end if;
  insert into public.leaderboard (pid, name, institute, district, score, max_score, time_taken_sec)
  select pid, name, institute, district, p_score, p_max, p_time
    from public.registrations where pid = upper(p_pid)
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
--  7. Realtime — অ্যাডমিন সুইচ ঘোরালে খোলা ব্রাউজারগুলো নিজে আপডেট হয়
-- =====================================================================
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.questions;

-- =====================================================================
--  ✅ শেষ। এখন Authentication → Users → Add user দিয়ে একটাই আয়োজক
--  অ্যাকাউন্ট বানাও (Email/Password) — ওটা দিয়েই /admin-এর ☁️ সাইন-ইন।
--
--  ⚠️ শুধু-টেস্টের-খোলা সংস্করণ (চূড়ান্ত ইভেন্টে কখনোই নয়):
--  settings/questions-এ দুনিয়ার সবাই লিখতে পারুক চাইলে নিচের দুই লাইন
--  চালাও — মনে রেখো, তখন যে কেউ পরীক্ষা আনলক/প্রশ্ন বদল করতে পারবে:
--
--  drop policy "organisers write settings"  on public.settings;
--  create policy "open write settings" on public.settings for all to anon, authenticated using (true) with check (true);
-- =====================================================================
