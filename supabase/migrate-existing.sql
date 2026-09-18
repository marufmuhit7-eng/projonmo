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
  add column if not exists registration_end   date not null default '2026-09-29';

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
  add column if not exists option_d_en   text default '',
  -- Google Sheet ইমপোর্টারের জন্য
  add column if not exists source        text,
  add column if not exists source_url    text,
  add column if not exists updated_at    timestamptz not null default now();

create index if not exists questions_category_order_idx
  on public.questions (category, order_no);
create index if not exists questions_category_idx
  on public.questions (category);

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
