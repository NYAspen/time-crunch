-- Curses now ADD to and SUBTRACT from countdown speeds instead of setting them,
-- so a team can be cursing another team and be cursed itself at the same time:
--   playing a curse  -> target +1x, attacker -1x
--   clearing a curse -> target -1x, attacker +1x
-- Examples (starting from 1x):
--   cursed                         -> 2x
--   cursing one team               -> 0x
--   cursed AND cursing one team    -> 1x
--   cursing two teams              -> -1x (the clock counts UP: it gains time)
-- Curses can only be played during Elimination (not Preparation).
-- Manual speed changes (0x/1x/2x buttons) still work for fixing mistakes, and
-- a "match curses" action sets a team to 1 + curses on it - curses it played.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- Speed can now go below 0 or above 2.
alter table public.teams drop constraint teams_speed_check;
alter table public.teams add constraint teams_speed_check check (speed between -20 and 20);

-- Move a team's speed up or down by p_delta (settles and logs via _set_speed).
create or replace function public._shift_speed(p_team uuid, p_delta int, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_speed int;
begin
  select speed into old_speed from public.teams where id = p_team for update;
  if not found then
    return;
  end if;
  perform public._set_speed(p_team, old_speed + p_delta, p_reason);
end;
$$;

-- The speed a team's active curses add up to: 1 + curses on it - curses it played.
create or replace function public._curse_speed(p_team uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select 1
    + (select count(*) from public.curses where target_team = p_team and status = 'active')::int
    - (select count(*) from public.curses where attacker_team = p_team and status = 'active')::int;
$$;

-- After a curse ends: undo exactly what playing it did.
create or replace function public._end_curse_speeds(k public.curses)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._shift_speed(k.target_team, -1, 'Curse cleared: ' || k.card_name);
  perform public._shift_speed(k.attacker_team, 1, 'Curse cleared: ' || k.card_name);
  perform public._sweep_eliminations();
end;
$$;

-- Same as migration 0009, except a curse now shifts speeds by 1 instead of
-- setting them, and curses can only be played during Elimination.
create or replace function public.use_card(
  p_card uuid,
  p_target uuid default null,
  p_target_team uuid default null,
  p_in_range boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  c public.cards;
  ct public.card_types;
  target public.cards;
  victim public.teams;
  message text;
begin
  t := public._acting_team(false);

  select * into c from public.cards where id = p_card for update;
  if not found or c.status <> 'hand' or c.holder_team <> t.id then
    raise exception 'That card is not in your hand';
  end if;
  select * into ct from public.card_types where id = c.type_id;

  if ct.type = 'curse' then
    if (select phase from public.game_state where id = 1) <> 'elimination' then
      raise exception 'Curses can only be played during Elimination';
    end if;
    if p_target_team is null then
      raise exception 'Choose which team to curse';
    end if;
    if p_target_team = t.id then
      raise exception 'You cannot curse your own team';
    end if;
    if not p_in_range then
      raise exception 'Confirm that you are within range of the target';
    end if;
    select * into victim from public.teams where id = p_target_team for update;
    if not found then
      raise exception 'Team not found';
    end if;
    if victim.status <> 'active' then
      raise exception '% has been eliminated', victim.name;
    end if;
    if exists (select 1 from public.curses where target_team = victim.id and status = 'active') then
      raise exception '% is already cursed. A team can only have one curse at a time', victim.name;
    end if;

    insert into public.curses (attacker_team, target_team, card_name, range_text, clearance)
    values (t.id, victim.id, ct.name, ct.range_text, ct.clearance);
    perform public._shift_speed(victim.id, 1, 'Cursed by ' || t.name || ': ' || ct.name);
    perform public._shift_speed(t.id, -1, 'Cursing ' || victim.name || ': ' || ct.name);
    message := 'You cursed ' || victim.name || '. Their countdown runs 1× faster and yours 1× slower until they clear it.';

  elsif ct.effect = 'duplicate' then
    if p_target is null or p_target = c.id then
      raise exception 'Choose another card in your hand to duplicate';
    end if;
    select * into target from public.cards where id = p_target for update;
    if not found or target.status <> 'hand' or target.holder_team <> t.id then
      raise exception 'You can only duplicate a card in your own hand';
    end if;
    insert into public.cards (type_id, status, holder_team, is_duplicate)
    values (target.type_id, 'hand', t.id, true);
    message := 'You now have a copy of ' || public._card_name(target.id) || '.';

  else
    message := 'Played ' || ct.name || '. Carry out its effect now.';
  end if;

  perform public._card_to_deck(c.id);

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, case when ct.type = 'curse' then 'curse_started' else 'card_used' end,
          jsonb_strip_nulls(jsonb_build_object(
            'name', t.name, 'card', ct.name, 'type', ct.type,
            'target_team', victim.name,
            'target_card', case when target.id is null then null else public._card_name(target.id) end)));

  perform public._sweep_eliminations();
  return message;
end;
$$;

-- Same as migration 0009, with a message that fits stacked curses.
create or replace function public.clear_curse(p_curse uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  k public.curses;
  attacker_name text;
begin
  perform 1 from public.game_state where id = 1 for share;

  select * into t from public.teams where user_id = auth.uid();
  if not found then
    raise exception 'Only a logged-in team can do this' using errcode = '42501';
  end if;

  select * into k from public.curses where id = p_curse for update;
  if not found or k.target_team <> t.id then
    raise exception 'That curse is not on your team';
  end if;
  if k.status <> 'active' then
    raise exception 'That curse has already been cleared';
  end if;

  update public.curses set status = 'cleared', cleared_at = now(), cleared_by = 'target' where id = k.id;
  select name into attacker_name from public.teams where id = k.attacker_team;
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'curse_cleared',
          jsonb_build_object('name', t.name, 'card', k.card_name, 'attacker', attacker_name));

  perform public._end_curse_speeds(k);
  return 'Curse cleared. Your countdown is 1× slower again.';
end;
$$;

-- A team puts its own speed back to what its curses add up to.
create or replace function public.sync_my_speed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  new_speed int;
begin
  perform 1 from public.game_state where id = 1 for share;

  select * into t from public.teams where user_id = auth.uid() for update;
  if not found then
    raise exception 'Only a logged-in team can change its speed' using errcode = '42501';
  end if;
  if t.status <> 'active' then
    raise exception 'Your team has been eliminated';
  end if;

  new_speed := public._curse_speed(t.id);
  if t.speed = new_speed then
    return;
  end if;
  perform public._set_speed(t.id, new_speed, 'Matched to active curses');
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'speed_changed',
          jsonb_build_object('name', t.name, 'from', t.speed, 'to', new_speed));
  perform public._sweep_eliminations();
end;
$$;

-- The admin puts a team's speed back to what its curses add up to.
create or replace function public.admin_sync_speed(p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  new_speed int;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  perform 1 from public.game_state where id = 1 for share;

  select * into t from public.teams where id = p_team for update;
  if not found then
    raise exception 'Team not found';
  end if;

  new_speed := public._curse_speed(t.id);
  if t.speed = new_speed then
    return;
  end if;
  perform public._set_speed(t.id, new_speed, 'Matched to active curses (admin)');
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'speed_set_by_admin',
          jsonb_build_object('name', t.name, 'from', t.speed, 'to', new_speed));
  perform public._sweep_eliminations();
end;
$$;

revoke execute on function public._shift_speed(uuid, int, text) from public, anon, authenticated;
revoke execute on function public._curse_speed(uuid)            from public, anon, authenticated;
revoke execute on function public.sync_my_speed()               from public, anon;
revoke execute on function public.admin_sync_speed(uuid)        from public, anon;
grant  execute on function public.sync_my_speed()               to authenticated;
grant  execute on function public.admin_sync_speed(uuid)        to authenticated;
