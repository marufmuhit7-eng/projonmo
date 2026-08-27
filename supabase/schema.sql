-- =====================================================================
--  Uttarbanga Heritage Fest — exam timer settings
--  Run this once in Supabase → SQL Editor → New query → Run.
-- =====================================================================

-- 1. The table. One row, id = 1, holds every timer setting.
create table if not exists public.settings (
  id                integer      primary key default 1,
  timer_enabled     boolean      not null default false,  -- false = exam OPEN
  exam_start_date   timestamptz  not null default '2026-09-25T00:00:00+06:00',
  off_behavior      text         not null default 'live',
  custom_message    text         not null default '',
  custom_message_en text         not null default '',
  updated_at        timestamptz  not null default now(),

  -- Refuse anything the frontend does not understand.
  constraint settings_single_row  check (id = 1),
  constraint settings_off_behavior_valid check (off_behavior in ('live', 'message'))
);

-- 2. Seed the single row. Defaults leave the exam OPEN; lock it from the
--    admin panel by switching the countdown on.
insert into public.settings (id) values (1)
on conflict (id) do nothing;

-- 3. Row Level Security. This is the part that actually protects you:
--    the anon key in your JavaScript can only do what these policies allow.
alter table public.settings enable row level security;

-- Everyone (including logged-out visitors) may READ the settings.
drop policy if exists "settings are readable by everyone" on public.settings;
create policy "settings are readable by everyone"
  on public.settings
  for select
  to anon, authenticated
  using (true);

-- Only a signed-in organiser may CHANGE them. An anonymous visitor holding the
-- same anon key cannot, because they have no authenticated JWT.
drop policy if exists "only signed-in organisers may update settings" on public.settings;
create policy "only signed-in organisers may update settings"
  on public.settings
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "only signed-in organisers may insert settings" on public.settings;
create policy "only signed-in organisers may insert settings"
  on public.settings
  for insert
  to authenticated
  with check (id = 1);

-- 4. Least-privilege grants, applied after RLS is on.
grant select on public.settings to anon;
grant select, insert, update on public.settings to authenticated;

-- 5. Realtime. Without this the public page still works, it just falls back to
--    polling every 60s instead of updating instantly.
alter publication supabase_realtime add table public.settings;

-- =====================================================================
--  AFTER RUNNING THIS
--
--  a) Authentication → Users → "Add user" → create ONE organiser account
--     with a real email and a strong password. That account, not a constant
--     in JavaScript, is what guards the settings.
--
--  b) Authentication → Providers → disable "Enable email signups" so the
--     public cannot create their own accounts and grant themselves write
--     access. This step is not optional.
--
--  c) Project Settings → API → copy the Project URL and the anon /
--     publishable key into src/shared/config.js, then: npm run build
--
--  Verify the policies do what you think, from a terminal:
--
--    # read as an anonymous visitor -> should return the row
--    curl -s "$SUPABASE_URL/rest/v1/settings?select=*" \
--         -H "apikey: $ANON_KEY"
--
--    # write as an anonymous visitor -> MUST be rejected
--    curl -s -X PATCH "$SUPABASE_URL/rest/v1/settings?id=eq.1" \
--         -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
--         -d '{"timer_enabled": false}'
--
--  If that second command succeeds, your RLS is wrong — stop and fix it
--  before the event.
-- =====================================================================

-- =====================================================================
--  PART 2 — Shared registrations & questions (storage_kv)
--  storage.js switches to this table automatically once SUPABASE_URL is
--  set in src/shared/config.js. Keys used by the site:
--     participant:UHF-XXXXXX  one row per registration (+ score after exam)
--     questions:<category>    the question sets the admin edits
-- =====================================================================

-- 6. The table.
create table if not exists public.storage_kv (
  key         text        primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now()
);

-- 7. Row Level Security.
alter table public.storage_kv enable row level security;

-- Everyone may READ: participants open the exam with their ID, the public
-- leaderboard lists scores, and the admin panel reads all registrations.
drop policy if exists "kv readable by everyone" on public.storage_kv;
create policy "kv readable by everyone"
  on public.storage_kv
  for select
  to anon, authenticated
  using (true);

-- Visitors REGISTER anonymously and later save their exam score under their
-- own 'participant:UHF-…' key. IDs are random (36^6 combinations) and shown
-- only to the registrant, which is the access boundary for exam continuation.
drop policy if exists "anyone may register" on public.storage_kv;
create policy "anyone may register"
  on public.storage_kv
  for insert
  to anon
  with check (key like 'participant:%');

drop policy if exists "participants may save their exam result" on public.storage_kv;
create policy "participants may save their exam result"
  on public.storage_kv
  for update
  to anon
  using (key like 'participant:%')
  with check (key like 'participant:%');

-- Everything else (questions:…) is writable only by a signed-in organiser:
-- create that ONE account in Authentication → Users → Add user.
drop policy if exists "organisers may insert kv" on public.storage_kv;
create policy "organisers may insert kv"
  on public.storage_kv
  for insert
  to authenticated
  with check (true);

drop policy if exists "organisers may update kv" on public.storage_kv;
create policy "organisers may update kv"
  on public.storage_kv
  for update
  to authenticated
  using (true)
  with check (true);

-- 8. Least-privilege grants, applied after RLS is on.
grant select on public.storage_kv to anon, authenticated;
grant insert, update on public.storage_kv to anon, authenticated;

-- 9. Realtime: the leaderboard and the admin list refresh the moment a
--    registration or a score lands.
alter publication supabase_realtime add table public.storage_kv;
