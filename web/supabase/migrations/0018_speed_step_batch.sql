-- Speed arrows send quick taps together: the phone waits for a short pause,
-- then sends the total (e.g. three taps up = +3) as ONE change, so the screen
-- keeps up and the log gets one line ("1x -> 4x") instead of three.
-- Same as migration 0017, except p_delta can be any non-zero step that keeps
-- the speed between -20x and 20x.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run
-- (after 0017).

create or replace function public.step_my_speed(p_delta int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  new_speed int;
  balance bigint;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'No speed change';
  end if;

  perform 1 from public.game_state where id = 1 for share;

  select * into t from public.teams where user_id = auth.uid() for update;
  if not found then
    raise exception 'Only a logged-in team can change its speed' using errcode = '42501';
  end if;
  if t.status <> 'active' then
    raise exception 'Your team has been eliminated';
  end if;
  new_speed := t.speed + p_delta;
  if new_speed not between -20 and 20 then
    raise exception 'Speed must stay between -20x and 20x';
  end if;

  update public.teams set speed = new_speed where id = t.id;
  balance := public._settle_team(t.id);
  perform public._ledger(t.id, 'speed', 0, balance, null,
                         jsonb_build_object('from', t.speed, 'to', new_speed));
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'speed_changed',
          jsonb_build_object('name', t.name, 'from', t.speed, 'to', new_speed));
  perform public._sweep_eliminations();
  return new_speed;
end;
$$;

create or replace function public.admin_step_speed(p_team uuid, p_delta int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  new_speed int;
  balance bigint;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'No speed change';
  end if;

  perform 1 from public.game_state where id = 1 for share;
  select * into t from public.teams where id = p_team for update;
  if not found then
    raise exception 'Team not found';
  end if;
  new_speed := t.speed + p_delta;
  if new_speed not between -20 and 20 then
    raise exception 'Speed must stay between -20x and 20x';
  end if;

  update public.teams set speed = new_speed where id = t.id;
  balance := public._settle_team(t.id);
  perform public._ledger(t.id, 'speed', 0, balance, 'Set by admin',
                         jsonb_build_object('from', t.speed, 'to', new_speed));
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'speed_set_by_admin',
          jsonb_build_object('name', t.name, 'from', t.speed, 'to', new_speed));
  perform public._sweep_eliminations();
  return new_speed;
end;
$$;
