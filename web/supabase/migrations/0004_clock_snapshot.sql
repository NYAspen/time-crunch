-- Fix: countdowns jumped when speed changed, paused or resumed.
-- Cause: the screen combined the NEW speed (teams table) with the OLD clock
-- anchor (team_clocks table) for a moment, because they arrive separately.
-- Fix: each clock row now stores everything the screen needs (speed and whether
-- it is running), so one row update is always self-consistent.
--
-- New rule: _settle_team charges time using the values STORED on the clock
-- row, then copies the current speed/running state onto it. So every action
-- changes state FIRST and settles AFTER.
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- Bring every clock up to date using the old logic before switching over.
select public._settle_all();

alter table public.team_clocks
  add column speed   smallint not null default 1,
  add column running boolean  not null default false;

update public.team_clocks tc
   set speed = t.speed,
       running = (public._clock_running() and t.status = 'active')
  from public.teams t
 where t.id = tc.team_id;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

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
  select tc.balance_ms, tc.anchor_at, tc.speed as clock_speed, tc.running,
         t.speed as team_speed, t.status
    into c
    from public.team_clocks tc
    join public.teams t on t.id = tc.team_id
   where tc.team_id = p_team
     for update of tc;
  if not found then
    raise exception 'Team not found';
  end if;

  -- Charge time since the last settle at the rate that was in effect.
  new_balance := c.balance_ms;
  if c.running then
    new_balance := c.balance_ms
      - floor(c.clock_speed * extract(epoch from (now() - c.anchor_at)) * 1000)::bigint;
  end if;
  new_balance := greatest(new_balance, 0);

  -- Start a new period using the current state.
  update public.team_clocks
     set balance_ms = new_balance,
         anchor_at = now(),
         speed = c.team_speed,
         running = (public._clock_running() and c.status = 'active')
   where team_id = p_team;
  return new_balance;
end;
$$;

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
    select t.id, t.name, tc.speed, tc.running, tc.balance_ms, tc.anchor_at
      from public.teams t
      join public.team_clocks tc on tc.team_id = t.id
     where t.status = 'active'
     order by t.id
       for update of t, tc
  loop
    remaining := r.balance_ms;
    if r.running then
      remaining := r.balance_ms
        - floor(r.speed * extract(epoch from (now() - r.anchor_at)) * 1000)::bigint;
    end if;

    if remaining <= 0 then
      zero_at := now();
      if r.running and r.speed > 0 then
        zero_at := least(now(), r.anchor_at + make_interval(secs => r.balance_ms / 1000.0 / r.speed));
      end if;

      update public.teams set status = 'eliminated', eliminated_at = zero_at where id = r.id;
      update public.team_clocks set balance_ms = 0, anchor_at = now(), running = false where team_id = r.id;
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

-- ---------------------------------------------------------------------------
-- Actions: change state first, then settle.
-- ---------------------------------------------------------------------------

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

  update public.teams set speed = new_speed where id = t.id;
  balance := public._settle_team(t.id);
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

  update public.teams set speed = new_speed where id = t.id;
  balance := public._settle_team(t.id);
  perform public._ledger(t.id, 'speed', 0, balance, 'Set by admin',
                         jsonb_build_object('from', t.speed, 'to', new_speed));
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'speed_set_by_admin',
          jsonb_build_object('name', t.name, 'from', t.speed, 'to', new_speed));
  perform public._sweep_eliminations();
end;
$$;

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

  update public.teams
     set status = new_status,
         eliminated_at = case when new_status = 'eliminated' then now() else null end
   where id = t.id;
  balance := public._settle_team(t.id);
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
     set phase = new_phase, phase_started_at = now(), updated_at = now()
   where id = 1
  returning * into new_state;

  perform public._settle_all();

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

  update public.game_state
     set is_paused = paused,
         paused_at = case when paused then now() else null end,
         updated_at = now()
   where id = 1
  returning * into new_state;

  perform public._settle_all();

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), case when paused then 'game_paused' else 'game_resumed' end, '{}'::jsonb);

  perform public._sweep_eliminations();
  return new_state;
end;
$$;
