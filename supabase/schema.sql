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
  exam_date           timestamptz not null default '2026-09-30T00:00:00+06',
  registration_start  date        not null default '2026-08-25',
  registration_end    date        not null default '2026-09-29',
  updated_at          timestamptz not null default now(),
  constraint settings_single_row check (id = 'exam')
);

insert into public.settings (id, is_unlocked, exam_date, registration_start, registration_end)
values ('exam', false, '2026-09-30T00:00:00+06', '2026-08-25', '2026-09-29')
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
  reg_code       text    unique,                   -- সিরিয়াল কোড: UHF000001…
  serial_no      int     unique,                   -- 1, 2, 3…
  pid            text    unique,                   -- (লেগেসি) পুরনো আইডি
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


-- ------------------------------------------------- ৬) 🖼️ টিম-ফটো স্টোরেজ
-- পাবলিক `team-photos` বাল্টি: সবাই পড়তে পারবে (ছবি সাইটে দেখাতে),
-- কিন্তু আপলোড/বদল শুধু ☁️ সাইন-ইন করা আয়োয়ক পারবে।
-- ⚠️ খসড়ার "Public Insert/Update" বসানো হয়নি — তাহলে anon key জানা মাত্র
-- যে কেউ বাল্টিতে ইচ্ছেমতো ফাইল ভরতে পারত।
insert into storage.buckets (id, name, public)
values ('team-photos', 'team-photos', true)
on conflict (id) do nothing;

drop policy if exists "Public Read team-photos" on storage.objects;
create policy "Public Read team-photos" on storage.objects
  for select using (bucket_id = 'team-photos');

drop policy if exists "Organiser Insert team-photos" on storage.objects;
create policy "Organiser Insert team-photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'team-photos');

drop policy if exists "Organiser Update team-photos" on storage.objects;
create policy "Organiser Update team-photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'team-photos') with check (bucket_id = 'team-photos');

drop policy if exists "Organiser Delete team-photos" on storage.objects;
create policy "Organiser Delete team-photos" on storage.objects
  for delete to authenticated using (bucket_id = 'team-photos');

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

-- ---- সিরিয়াল রেজিস্ট্রেশন কোড: UHF000001, UHF000002, … -------------------
-- ফরম্যাট: ^UHF\d{6}$ — UHF + ঠিক ৬ ডিজিৎ, শূন্য-প্যাডেড, শুরু ১ থেকে।

-- ১) কাউন্টার টেবিল (এক রো, অ্যাটমিক UPDATE..RETURNING দিয়ে বাড়ে)
create table if not exists public.reg_counter (
  id          int primary key check (id = 1),
  next_serial int not null
);

-- ২) registrations-এ reg_code + serial_no কলাম
alter table public.registrations
  add column if not exists reg_code  text,
  add column if not exists serial_no int;

-- ৩) পুরনো রো ব্যাকফিল: পুরনো তারিখ-ক্রমে serial_no, তারপর reg_code
with numbered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.registrations
  where serial_no is null
)
update public.registrations r
   set serial_no = n.rn
  from numbered n
 where r.id = n.id;

update public.registrations
   set reg_code = pid
 where reg_code is null and pid ~ '^UHF\d{6}$';

update public.registrations
   set reg_code = 'UHF' || lpad(serial_no::text, 6, '0')
 where reg_code is null and serial_no is not null
   and not exists (
     select 1 from public.registrations r2
      where r2.reg_code = 'UHF' || lpad(public.registrations.serial_no::text, 6, '0')
   );

-- ৪) কাউন্টার সিড: এখন পর্যন্ত ব্যবহৃত সর্বোচ্চ serial-এর পরের সংখ্যা
insert into public.reg_counter (id, next_serial)
values (1, coalesce((select max(serial_no) from public.registrations), 0) + 1)
on conflict (id) do update
  set next_serial = greatest(public.reg_counter.next_serial, excluded.next_serial);

-- ৫) UNIQUE সীমা (ব্যাকফিলের পরে, নিরাপদে)
do $cons$
begin
  if not exists (select 1 from pg_constraint where conname = 'registrations_reg_code_key') then
    alter table public.registrations add constraint registrations_reg_code_key unique (reg_code);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'registrations_serial_no_key') then
    alter table public.registrations add constraint registrations_serial_no_key unique (serial_no);
  end if;
end $cons$;

-- ৬) নতুন রেজিস্ট্রেশন: অ্যাটমিক কাউন্টার -> UHFxxxxxx
create or replace function public.create_registration(
  p_name text, p_phone text, p_email text default '',
  p_institute text default '', p_district text default '',
  p_cls text default '', p_category text default null
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_serial int;
  v_code   text;
  v_try    int := 0;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'নাম আবশ্যক / name is required';
  end if;
  loop
    update public.reg_counter set next_serial = next_serial + 1
     where id = 1
    returning next_serial - 1 into v_serial;

    if v_serial is null then
      -- কাউন্টার রো হারিয়ে গিয়ে থাকলে: আবার বীজ বুনে নাও
      insert into public.reg_counter (id, next_serial)
      values (1, coalesce((select max(serial_no) from public.registrations), 0) + 2)
      on conflict (id) do update set next_serial = public.reg_counter.next_serial + 1
      returning next_serial - 1 into v_serial;
    end if;

    v_code := 'UHF' || lpad(v_serial::text, 6, '0');
    begin
      insert into public.registrations
        (reg_code, serial_no, name, phone, email, institute, district, cls, category)
      values
        (v_code, v_serial, trim(p_name), coalesce(p_phone, ''), coalesce(p_email, ''),
         coalesce(p_institute, ''), coalesce(p_district, ''), coalesce(p_cls, ''), p_category)
      returning reg_code into v_code;
      return v_code;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try >= 5 then raise; end if;   -- বিরল সংঘর্ষে আবার চেষ্টা
    end;
  end loop;
end $$;

revoke all on function public.create_registration(text, text, text, text, text, text, text) from public;
grant execute on function public.create_registration(text, text, text, text, text, text, text) to anon, authenticated;

-- ৭) পুরনো RPC-গুলোও reg_code চেনে (pid/uuid পথ পুরনো রোর জন্য রয়ে গেল)
create or replace function public.get_registration(p_pid text)
returns json
language sql security definer set search_path = public
as $$
  select to_json(r) from public.registrations r
   where r.reg_code = upper(p_pid)
      or r.pid = upper(p_pid)
      or r.id::text = p_pid;
$$;

create or replace function public.save_exam_result(
  p_pid text, p_score int, p_max int, p_time int, p_cat text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
begin
  update public.registrations
     set exam_taken = true, score = p_score, max_score = p_max,
         time_taken_sec = p_time, category = p_cat, submitted_at = now()
   where (reg_code = upper(p_pid) or pid = upper(p_pid) or id::text = p_pid)
     and exam_taken = false
  returning coalesce(reg_code, pid, id::text) into v_code;
  if v_code is null then return false; end if;
  insert into public.leaderboard (pid, name, institute, district, score, max_score, time_taken_sec)
  select v_code, name, institute, district, p_score, p_max, p_time
    from public.registrations
   where reg_code = v_code or pid = v_code or id::text = v_code
  on conflict (pid) do update
    set score = excluded.score, max_score = excluded.max_score,
        time_taken_sec = excluded.time_taken_sec;
  return true;
end $$;

revoke all on function public.get_registration(text) from public;
revoke all on function public.save_exam_result(text, int, int, int, text) from public;
grant execute on function public.get_registration(text) to anon, authenticated;
grant execute on function public.save_exam_result(text, int, int, int, text) to anon, authenticated;

-- পুরনো বছর-ওয়ালা সিকোয়েন্স আর লাগবে না
drop sequence if exists public.reg_seq;
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
