-- Curses now set countdown speeds automatically:
--   playing a curse  -> target 2x, attacker 0x
--   clearing a curse -> target 1x; attacker 1x unless it still has another
--                       active curse on some other team
-- Teams (and the admin) can still change speeds by hand afterwards.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- Change a team's speed: settle its clock at the old speed first, then log it.
create or replace function public._set_speed(p_team uuid, new_speed int, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_speed int;
  balance bigint;
begin
  select speed into old_speed from public.teams where id = p_team for update;
  if not found or old_speed = new_speed then
    return;
  end if;
  update public.teams set speed = new_speed where id = p_team;
  balance := public._settle_team(p_team);
  perform public._ledger(p_team, 'speed', 0, balance, p_reason,
                         jsonb_build_object('from', old_speed, 'to', new_speed));
end;
$$;

-- After a curse ends: put both teams back to normal speed.
create or replace function public._end_curse_speeds(k public.curses)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._set_speed(k.target_team, 1, 'Curse cleared: ' || k.card_name);
  if not exists (
    select 1 from public.curses where attacker_team = k.attacker_team and status = 'active' and id <> k.id
  ) then
    perform public._set_speed(k.attacker_team, 1, 'Curse cleared: ' || k.card_name);
  end if;
  perform public._sweep_eliminations();
end;
$$;

-- Same as migration 0008, except a curse now sets both teams' speeds.
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
    perform public._set_speed(victim.id, 2, 'Cursed by ' || t.name || ': ' || ct.name);
    perform public._set_speed(t.id, 0, 'Cursing ' || victim.name || ': ' || ct.name);
    message := 'You cursed ' || victim.name || '. Their countdown is now 2× and yours is stopped (0×) until they clear it.';

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
  return 'Curse cleared. Your countdown is back to 1×.';
end;
$$;

create or replace function public.admin_clear_curse(p_curse uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.curses;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  perform 1 from public.game_state where id = 1 for share;

  select * into k from public.curses where id = p_curse for update;
  if not found or k.status <> 'active' then
    raise exception 'That curse is not active';
  end if;
  update public.curses set status = 'cleared', cleared_at = now(), cleared_by = 'admin' where id = k.id;
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), k.target_team, 'curse_cleared', jsonb_build_object('card', k.card_name, 'by', 'admin'));

  perform public._end_curse_speeds(k);
end;
$$;

revoke execute on function public._set_speed(uuid, int, text)         from public, anon, authenticated;
revoke execute on function public._end_curse_speeds(public.curses)    from public, anon, authenticated;
