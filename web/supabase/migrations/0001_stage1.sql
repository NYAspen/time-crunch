-- Stage 1: shared game state, teams, admins, activity log.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Security model: browsers may only READ what the policies below allow.
-- Every write goes through either a security-definer function that checks
-- permissions (admin_set_phase, admin_set_paused) or a Next.js server action
-- using the secret key.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Exactly one row (id = 1) holding the global game state.
create table public.game_state (
  id               int primary key default 1 check (id = 1),
  phase            text not null default 'setup'
                   check (phase in ('setup', 'preparation', 'lunch', 'elimination', 'ended')),
  is_paused        boolean not null default false,
  phase_started_at timestamptz not null default now(),
  paused_at        timestamptz,
  updated_at       timestamptz not null default now()
);
insert into public.game_state (id) values (1);

-- Public team info only. Private data (time, cards) goes in separate tables later.
create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(btrim(name)) between 1 and 40),
  user_id    uuid unique references auth.users (id) on delete set null,
  status     text not null default 'active' check (status in ('active', 'eliminated')),
  created_at timestamptz not null default now()
);

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.activity_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  actor_user_id uuid,
  team_id       uuid references public.teams (id) on delete set null,
  event_type    text not null,
  details       jsonb not null default '{}'::jsonb
);
create index activity_log_created_at_idx on public.activity_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.game_state   enable row level security;
alter table public.teams        enable row level security;
alter table public.admins       enable row level security;
alter table public.activity_log enable row level security;

create policy "game state is public" on public.game_state
  for select to anon, authenticated using (true);

create policy "team list is public" on public.teams
  for select to anon, authenticated using (true);

create policy "users can see their own admin row" on public.admins
  for select to authenticated using (user_id = auth.uid());

create policy "admins can read the log" on public.activity_log
  for select to authenticated using (public.is_admin());

-- Belt and braces: browsers get no direct write privileges at all.
revoke insert, update, delete, truncate
  on public.game_state, public.teams, public.admins, public.activity_log
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin actions (atomic; time comes from the database clock)
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_phase(new_phase text)
returns public.game_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_state public.game_state;
  new_state public.game_state;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can change the phase' using errcode = '42501';
  end if;

  select * into old_state from public.game_state where id = 1 for update;

  if old_state.phase = new_phase then
    raise exception 'The game is already in the % phase', new_phase;
  end if;

  update public.game_state
     set phase = new_phase,
         phase_started_at = now(),
         updated_at = now()
   where id = 1
  returning * into new_state;

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'phase_changed',
          jsonb_build_object('from', old_state.phase, 'to', new_phase));

  return new_state;
end;
$$;

create or replace function public.admin_set_paused(paused boolean)
returns public.game_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_state public.game_state;
  new_state public.game_state;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can pause or resume' using errcode = '42501';
  end if;

  select * into old_state from public.game_state where id = 1 for update;

  if old_state.is_paused = paused then
    raise exception 'The game is already %', case when paused then 'paused' else 'running' end;
  end if;

  update public.game_state
     set is_paused = paused,
         paused_at = case when paused then now() else null end,
         updated_at = now()
   where id = 1
  returning * into new_state;

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), case when paused then 'game_paused' else 'game_resumed' end, '{}'::jsonb);

  return new_state;
end;
$$;

revoke execute on function public.admin_set_phase(text)     from public, anon;
revoke execute on function public.admin_set_paused(boolean) from public, anon;
grant  execute on function public.admin_set_phase(text)     to authenticated;
grant  execute on function public.admin_set_paused(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: push changes to open browsers
-- ---------------------------------------------------------------------------

-- Realtime respects RLS, so only admins receive activity_log changes.
alter publication supabase_realtime add table public.game_state, public.teams, public.activity_log;
