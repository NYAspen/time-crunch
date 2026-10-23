-- Stage 2a: team time balances, countdown speed, balance history, eliminations.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- How the clock works:
--   Each team stores balance_ms and anchor_at (when the balance was last "settled").
--   While the clock is running (Elimination, not paused, team active):
--       remaining = balance_ms - speed * (now - anchor_at)
--   Before anything that changes the rate (speed change, pause, resume, phase
--   change, time adjustment) the balance is settled up to now and anchor_at is
--   reset to now. All times come from the database clock, never the browser.
--
-- Lock order (prevents deadlocks): game_state row first, then team rows by id.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Public: speed is visible to every team (honor system).
alter table public.teams
  add column speed smallint not null default 1 check (speed in (0, 1, 2)),
  add column eliminated_at timestamptz;

-- Private: only the team itself and admins can read its clock.
create table public.team_clocks (
  team_id    uuid primary key references public.teams (id) on delete cascade,
  balance_ms bigint not null default 0,
  anchor_at  timestamptz not null default now()
);

insert into public.team_clocks (team_id) select id from public.teams;

-- Every change to a team's time or speed.
create table public.time_ledger (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  team_id          uuid not null references public.teams (id) on delete cascade,
  kind             text not null,  -- adjust | reversal | speed | eliminated | revived
  delta_ms         bigint not null default 0,
  balance_after_ms bigint not null,
  reason           text,
  actor_user_id    uuid,
  details          jsonb not null default '{}'::jsonb,
  reversed_by      bigint references public.time_ledger (id)
);
create index time_ledger_team_idx on public.time_ledger (team_id, created_at desc);

-- New teams automatically get a clock.
create or replace function public._create_team_clock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.team_clocks (team_id) values (new.id);
  return new;
end;
$$;

create trigger teams_create_clock
  after insert on public.teams
  for each row execute function public._create_team_clock();

-- ---------------------------------------------------------------------------
-- Helpers (internal; not callable from browsers)
-- ---------------------------------------------------------------------------

create or replace function public.my_team_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.teams where user_id = auth.uid();
$$;

create or replace function public._clock_running()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select phase = 'elimination' and not is_paused from public.game_state where id = 1;
$$;

create or replace function public._ledger(
  p_team uuid, p_kind text, p_delta bigint, p_balance bigint, p_reason text, p_details jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id bigint;
begin
  insert into public.time_ledger (team_id, kind, delta_ms, balance_after_ms, reason, actor_user_id, details)
  values (p_team, p_kind, p_delta, p_balance, p_reason, auth.uid(), coalesce(p_details, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;

-- Bring one team's balance up to now and reset its anchor. Returns the new balance.
create or replace function public._settle_team(p_team uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  new_balance bigint;
begin
  select tc.balance_ms, tc.anchor_at, t.speed, t.status
    into c
    from public.team_clocks tc
    join public.teams t on t.id = tc.team_id
   where tc.team_id = p_team
     for update of tc;
  if not found then
    raise exception 'Team not found';
  end if;

  new_balance := c.balance_ms;
  if public._clock_running() and c.status = 'active' then
    new_balance := c.balance_ms
      - floor(c.speed * extract(epoch from (now() - c.anchor_at)) * 1000)::bigint;
  end if;
  new_balance := greatest(new_balance, 0);

  update public.team_clocks set balance_ms = new_balance, anchor_at = now() where team_id = p_team;
  return new_balance;
end;
$$;

create or replace function public._settle_all()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  for t in select id from public.teams order by id loop
    perform public._settle_team(t.id);
  end loop;
end;
$$;

-- Eliminate every active team whose time has run out (during Elimination only).
-- Each team is eliminated exactly once because only 'active' rows are considered.
create or replace function public._sweep_eliminations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.game_state;
  r record;
  remaining bigint;
  zero_at timestamptz;
  n int := 0;
begin
  select * into g from public.game_state where id = 1;
  if g.phase <> 'elimination' then
    return 0;
  end if;

  for r in
    select t.id, t.name, t.speed, tc.balance_ms, tc.anchor_at
      from public.teams t
      join public.team_clocks tc on tc.team_id = t.id
     where t.status = 'active'
     order by t.id
       for update of t, tc
  loop
    remaining := r.balance_ms;
    if not g.is_paused then
      remaining := r.balance_ms
        - floor(r.speed * extract(epoch from (now() - r.anchor_at)) * 1000)::bigint;
    end if;

    if remaining <= 0 then
      -- The exact moment the clock hit zero (may be slightly before this check ran).
      zero_at := now();
      if not g.is_paused and r.speed > 0 then
        zero_at := least(now(), r.anchor_at + make_interval(secs => r.balance_ms / 1000.0 / r.speed));
      end if;

      update public.team_clocks set balance_ms = 0, anchor_at = now() where team_id = r.id;
      update public.teams set status = 'eliminated', eliminated_at = zero_at where id = r.id;
      perform public._ledger(r.id, 'eliminated', 0, 0, 'Time ran out',
                             jsonb_build_object('zero_at', zero_at));
      insert into public.activity_log (actor_user_id, team_id, event_type, details)
      values (auth.uid(), r.id, 'team_eliminated', jsonb_build_object('name', r.name, 'at', zero_at));
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

-- Apply a time change to a settled team. Never lets the balance go below 0.
create or replace function public._apply_delta(
  p_team uuid, p_delta_ms bigint, p_kind text, p_reason text, p_details jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_balance bigint;
  new_balance bigint;
begin
  old_balance := public._settle_team(p_team);
  new_balance := greatest(old_balance + p_delta_ms, 0);
  update public.team_clocks set balance_ms = new_balance where team_id = p_team;
  return public._ledger(p_team, p_kind, new_balance - old_balance, new_balance, p_reason, p_details);
end;
$$;

-- ---------------------------------------------------------------------------
-- Callable functions
-- ---------------------------------------------------------------------------

-- Lets browsers measure the difference between their clock and the server's.
create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

-- Anyone logged in may ask the server to check for eliminations; the server
-- decides using its own clock, so this cannot be abused.
create or replace function public.sweep_eliminations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.game_state where id = 1 for share;
  return public._sweep_eliminations();
end;
$$;

-- A team changes its own countdown speed (honor system).
create or replace function public.set_my_speed(new_speed int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  balance bigint;
begin
  if new_speed not in (0, 1, 2) then
    raise exception 'Speed must be 0x, 1x or 2x';
  end if;

  perform 1 from public.game_state where id = 1 for share;

  select * into t from public.teams where user_id = auth.uid() for update;
  if not found then
    raise exception 'Only a logged-in team can change its speed' using errcode = '42501';
  end if;
  if t.status <> 'active' then
    raise exception 'Your team has been eliminated';
  end if;
  if t.speed = new_speed then
    return;
  end if;

  balance := public._settle_team(t.id);
  update public.teams set speed = new_speed where id = t.id;
  perform public._ledger(t.id, 'speed', 0, balance, null,
                         jsonb_build_object('from', t.speed, 'to', new_speed));
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'speed_changed',
          jsonb_build_object('name', t.name, 'from', t.speed, 'to', new_speed));
  perform public._sweep_eliminations();
end;
$$;

create or replace function public.admin_set_speed(p_team uuid, new_speed int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  balance bigint;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  if new_speed not in (0, 1, 2) then
    raise exception 'Speed must be 0x, 1x or 2x';
  end if;

  perform 1 from public.game_state where id = 1 for share;
  select * into t from public.teams where id = p_team for update;
  if not found then
    raise exception 'Team not found';
  end if;
  if t.speed = new_speed then
    return;
  end if;

  balance := public._settle_team(t.id);
  update public.teams set speed = new_speed where id = t.id;
  perform public._ledger(t.id, 'speed', 0, balance, 'Set by admin',
                         jsonb_build_object('from', t.speed, 'to', new_speed));
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'speed_set_by_admin',
          jsonb_build_object('name', t.name, 'from', t.speed, 'to', new_speed));
  perform public._sweep_eliminations();
end;
$$;

create or replace function public.admin_adjust_time(p_team uuid, delta_seconds int, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  team_name text;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  if delta_seconds = 0 then
    raise exception 'Enter a non-zero amount of time';
  end if;
  if coalesce(btrim(reason), '') = '' then
    raise exception 'Please give a reason';
  end if;

  perform 1 from public.game_state where id = 1 for share;
  select name into team_name from public.teams where id = p_team for update;
  if not found then
    raise exception 'Team not found';
  end if;

  perform public._apply_delta(p_team, delta_seconds * 1000::bigint, 'adjust', btrim(reason), '{}'::jsonb);
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), p_team, 'time_adjusted',
          jsonb_build_object('name', team_name, 'seconds', delta_seconds, 'reason', btrim(reason)));
  perform public._sweep_eliminations();
end;
$$;

-- Undo a time change by applying the opposite amount.
create or replace function public.admin_reverse_entry(entry_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.time_ledger;
  reversal_id bigint;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;

  perform 1 from public.game_state where id = 1 for share;
  select * into e from public.time_ledger where id = entry_id for update;
  if not found then
    raise exception 'History entry not found';
  end if;
  if e.delta_ms = 0 then
    raise exception 'This entry did not change the time, so there is nothing to undo';
  end if;
  if e.kind = 'reversal' then
    raise exception 'This entry is already an undo';
  end if;
  if e.reversed_by is not null then
    raise exception 'This entry has already been undone';
  end if;

  perform 1 from public.teams where id = e.team_id for update;
  reversal_id := public._apply_delta(e.team_id, -e.delta_ms, 'reversal',
                                     'Undo of entry #' || e.id, jsonb_build_object('reverses', e.id));
  update public.time_ledger set reversed_by = reversal_id where id = e.id;
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), e.team_id, 'time_entry_undone', jsonb_build_object('entry', e.id));
  perform public._sweep_eliminations();
end;
$$;

-- Fix a mistaken elimination (or eliminate a team by hand).
create or replace function public.admin_set_team_status(p_team uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  balance bigint;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  if new_status not in ('active', 'eliminated') then
    raise exception 'Unknown status';
  end if;

  perform 1 from public.game_state where id = 1 for share;
  select * into t from public.teams where id = p_team for update;
  if not found then
    raise exception 'Team not found';
  end if;
  if t.status = new_status then
    raise exception 'Team is already %', new_status;
  end if;

  balance := public._settle_team(t.id);
  update public.teams
     set status = new_status,
         eliminated_at = case when new_status = 'eliminated' then now() else null end
   where id = t.id;
  perform public._ledger(t.id, case when new_status = 'active' then 'revived' else 'eliminated' end,
                         0, balance, 'Set by admin', '{}'::jsonb);
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, case when new_status = 'active' then 'team_revived' else 'team_eliminated' end,
          jsonb_build_object('name', t.name, 'by', 'admin'));

  if new_status = 'active' then
    perform public._sweep_eliminations();
  end if;
end;
$$;

-- Replace the Stage 1 versions so every phase change and pause settles all clocks first.
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

  perform public._settle_all();

  update public.game_state
     set phase = new_phase, phase_started_at = now(), updated_at = now()
   where id = 1
  returning * into new_state;

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'phase_changed', jsonb_build_object('from', old_state.phase, 'to', new_phase));

  -- Teams with no time at the start of Elimination are out immediately.
  perform public._sweep_eliminations();
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

  perform public._settle_all();

  update public.game_state
     set is_paused = paused,
         paused_at = case when paused then now() else null end,
         updated_at = now()
   where id = 1
  returning * into new_state;

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), case when paused then 'game_paused' else 'game_resumed' end, '{}'::jsonb);

  perform public._sweep_eliminations();
  return new_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

alter table public.team_clocks enable row level security;
alter table public.time_ledger enable row level security;

create policy "own clock or admin" on public.team_clocks
  for select to authenticated using (team_id = public.my_team_id() or public.is_admin());

create policy "own history or admin" on public.time_ledger
  for select to authenticated using (team_id = public.my_team_id() or public.is_admin());

revoke insert, update, delete, truncate on public.team_clocks, public.time_ledger from anon, authenticated;

-- Internal helpers: nobody calls these directly.
revoke execute on function public._create_team_clock()                           from public, anon, authenticated;
revoke execute on function public._clock_running()                               from public, anon, authenticated;
revoke execute on function public._ledger(uuid, text, bigint, bigint, text, jsonb) from public, anon, authenticated;
revoke execute on function public._settle_team(uuid)                             from public, anon, authenticated;
revoke execute on function public._settle_all()                                  from public, anon, authenticated;
revoke execute on function public._sweep_eliminations()                          from public, anon, authenticated;
revoke execute on function public._apply_delta(uuid, bigint, text, text, jsonb)  from public, anon, authenticated;

-- Logged-in callers only (each function checks who is calling).
revoke execute on function public.sweep_eliminations()                     from public, anon;
revoke execute on function public.set_my_speed(int)                        from public, anon;
revoke execute on function public.admin_set_speed(uuid, int)               from public, anon;
revoke execute on function public.admin_adjust_time(uuid, int, text)       from public, anon;
revoke execute on function public.admin_reverse_entry(bigint)              from public, anon;
revoke execute on function public.admin_set_team_status(uuid, text)        from public, anon;
grant  execute on function public.sweep_eliminations()                     to authenticated;
grant  execute on function public.set_my_speed(int)                        to authenticated;
grant  execute on function public.admin_set_speed(uuid, int)               to authenticated;
grant  execute on function public.admin_adjust_time(uuid, int, text)       to authenticated;
grant  execute on function public.admin_reverse_entry(bigint)              to authenticated;
grant  execute on function public.admin_set_team_status(uuid, text)        to authenticated;
grant  execute on function public.server_now()                             to anon, authenticated;

alter publication supabase_realtime add table public.team_clocks, public.time_ledger;
