-- =====================================================================
--  🔧 ONE-FILE FIX — রেজিস্ট্রেশন কোড (UHF000001…) + প্রশ্নের ক্যাটাগরি
--
--  তোমার লাইভ ডাটাবেসে এখনো এগুলোর কোনোটাই নেই (যাচাই করা হয়েছে):
--  create_registration RPC, reg_code/serial_no কলাম, questions.category,
--  reg_counter টেবিল। এই একটা ফাইল চালালেই সব বসে যাবে — আগের যেকোনো
--  অবস্থা থেকেই নিরাপদ (idempotent)।
--
--  ⚠️ তোমার খসড়া SQL-এর টাইপো (generate_generate_reg_code) এখানে
--  সংশোধন করা হয়েছে; ভাঙা ৫-প্যারামিটার ওভারলোডও আগে বাদ পড়ে।
--
--  কোথায়: Supabase Dashboard → SQL Editor → New query → পুরোটা পেস্ট → Run
-- =====================================================================

-- ---------------------------------------------------------------- 0) পরিষ্কার
-- ভাঙা/পুরনো ওভারলোডগুলো বাদ দাও (না থাকলে কিছুই হবে না)
drop function if exists public.create_registration(text, text, text, text, text);
drop function if exists public.generate_reg_code();

-- ------------------------------------------------- 1) registrations কলাম
alter table public.registrations
  add column if not exists reg_code       text,
  add column if not exists serial_no      int,
  add column if not exists pid            text,          -- লেগেসি আইডি
  add column if not exists cls            text default '',
  add column if not exists category       text,
  add column if not exists exam_taken     boolean not null default false,
  add column if not exists score          int    not null default 0,
  add column if not exists max_score      int    not null default 0,
  add column if not exists time_taken_sec int    not null default 0,
  add column if not exists submitted_at   timestamptz;

-- ------------------------------------------------- 2) পুরনো রো ব্যাকফিল
update public.registrations set pid = id::text where pid is null;

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

do $cons$
begin
  if not exists (select 1 from pg_constraint where conname = 'registrations_reg_code_key') then
    alter table public.registrations add constraint registrations_reg_code_key unique (reg_code);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'registrations_serial_no_key') then
    alter table public.registrations add constraint registrations_serial_no_key unique (serial_no);
  end if;
end $cons$;

-- ------------------------------------------------- 3) reg_counter (self-healing)
-- যেকোনো আগের আকৃতি (text-id/next_no, int-id/next_serial, বা নেই-ই) থেকে
-- ক্যানোনিকাল এক-রো কাউন্টার বানায়, সর্বোচ্চ ব্যবহৃত সিরিয়ালের পরে বীজ দেয়।
do $counter$
declare
  v_next int := 1;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'reg_counter' and column_name = 'next_no') then
    select greatest(coalesce(max(next_no), 1), coalesce((select max(serial_no) + 1 from public.registrations), 1))
      into v_next from public.reg_counter;
  elsif exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'reg_counter' and column_name = 'next_serial') then
    select greatest(coalesce(max(next_serial), 1), coalesce((select max(serial_no) + 1 from public.registrations), 1))
      into v_next from public.reg_counter;
  else
    select coalesce(max(serial_no), 0) + 1 into v_next from public.registrations;
  end if;

  drop table if exists public.reg_counter;
  create table public.reg_counter (
    id          int primary key check (id = 1),
    next_serial int not null
  );
  insert into public.reg_counter (id, next_serial) values (1, v_next);
end $counter$;

-- ------------------------------------------------- 4) generate_reg_code (সংশোধিত)
create or replace function public.generate_reg_code()
returns table(serial_no int, reg_code text)
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  update public.reg_counter set next_serial = next_serial + 1
   where id = 1
  returning next_serial - 1 into n;

  if n is null then
    -- কাউন্টার রো হারিয়ে গেলে আবার বীজ দাও
    insert into public.reg_counter (id, next_serial)
    values (1, coalesce((select max(serial_no) from public.registrations), 0) + 2)
    on conflict (id) do update set next_serial = public.reg_counter.next_serial + 1
    returning next_serial - 1 into n;
  end if;

  serial_no := n;
  reg_code  := 'UHF' || lpad(n::text, 6, '0');
  return next;
end $$;

-- ------------------------------------------------- 5) create_registration (RPC)
-- ৭টি প্যারামিটার, শেষ দুটির ডিফল্ট আছে — তাই ৫-আর্গ কলও একই ফাংশনে মেলে।
-- রিটার্ন করে শুধু reg_code টেক্সট (UHF000001)।
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
         coalesce(p_institute, ''), coalesce(p_district, ''),
         coalesce(p_cls, ''), p_category)
      returning reg_code into v_code;
      return v_code;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try >= 5 then raise; end if;   -- বিরল সংঘর্ষে আবার
    end;
  end loop;
end $$;

revoke all on function public.create_registration(text, text, text, text, text, text, text) from public;
grant execute on function public.create_registration(text, text, text, text, text, text, text) to anon, authenticated;
revoke all on function public.generate_reg_code() from public;
grant execute on function public.generate_reg_code() to anon, authenticated;

-- ------------------------------------------------- 6) পরীক্ষা-সংক্রান্ত RPC
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

-- ------------------------------------------------- 7) questions: ক্যাটাগরি
alter table public.questions
  add column if not exists category      text not null default 'সাধারণ',
  add column if not exists question_en   text default '',
  add column if not exists option_a_en   text default '',
  add column if not exists option_b_en   text default '',
  add column if not exists option_c_en   text default '',
  add column if not exists option_d_en   text default '',
  add column if not exists source        text,
  add column if not exists source_url    text,
  add column if not exists updated_at    timestamptz not null default now();

create index if not exists questions_category_order_idx on public.questions (category, order_no);
create index if not exists questions_category_idx       on public.questions (category);

-- ------------------------------------------------- 8) leaderboard টেবিল
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

-- ------------------------------------------------- 9) RLS: আসল তালা
-- তোমার বর্তমান খোলা পলিসিতে যে কেউ anon key দিয়ে settings লিখতে পারে
-- (পরীক্ষা আনলক করে দিতে পারে!) আর সবার ফোন-নম্বর টানতে পারে।
-- নিচে সেগুলো বদলে যাচ্ছে: লেখে শুধু ☁️ সাইন-ইন করা আয়োয়ক।
drop policy if exists "read settings"     on public.settings;
drop policy if exists "update settings"   on public.settings;
drop policy if exists "insert settings"   on public.settings;
drop policy if exists "settings readable by everyone" on public.settings;
drop policy if exists "organisers insert settings"    on public.settings;
drop policy if exists "organisers update settings"    on public.settings;
create policy "settings readable by everyone" on public.settings
  for select to anon, authenticated using (true);
create policy "organisers insert settings" on public.settings
  for insert to authenticated with check (id = 'exam');
create policy "organisers update settings" on public.settings
  for update to authenticated using (true) with check (true);

drop policy if exists "read questions"        on public.questions;
drop policy if exists "write questions"       on public.questions;
drop policy if exists "questions readable by everyone" on public.questions;
drop policy if exists "organisers manage questions"   on public.questions;
create policy "questions readable by everyone" on public.questions
  for select to anon, authenticated using (true);
create policy "organisers manage questions" on public.questions
  for all to authenticated using (true) with check (true);

drop policy if exists "insert registrations"     on public.registrations;
drop policy if exists "read registrations"       on public.registrations;
drop policy if exists "anyone may register"      on public.registrations;
drop policy if exists "organisers read registrations"  on public.registrations;
drop policy if exists "organisers update registrations" on public.registrations;
create policy "anyone may register" on public.registrations
  for insert to anon, authenticated
  with check (char_length(name) > 0);
create policy "organisers read registrations" on public.registrations
  for select to authenticated using (true);
create policy "organisers update registrations" on public.registrations
  for update to authenticated using (true) with check (true);

-- ------------------------------------------------- 10) Realtime
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.questions;

-- =====================================================================
--  ✅ শেষ। এখন:
--  ১) Authentication → Users → Add user — একটাই আয়োয়ক অ্যাকাউন্ট
--     (☁️ সাইন-ইন ছাড়া আর কেউ settings/questions লিখতে পারবে না)
--  ২) টেবিল এডিটরে "স্কিমা-প্রোব (মুছে দাও)" রোটা মুছে দাও (পুরনো টেস্ট রো)
-- =====================================================================
