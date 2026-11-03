-- 1. Curses: a team can now have several curses on it and play several, as
--    long as they come from / go to DIFFERENT teams. For each pair of teams,
--    each side can have at most one active curse on the other (so A->B and
--    B->A can both be active, but not two A->B).
-- 2. Countdown speed: teams and the admin change speed with up/down arrows
--    (one step of 1x at a time) instead of picking 0x / 1x / 2x.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- ---------------------------------------------------------------------------
-- One active curse per attacker -> target pair
-- ---------------------------------------------------------------------------

drop index public.curses_one_active_per_target;
create unique index curses_one_active_per_pair on public.curses (attacker_team, target_team) where status = 'active';

-- Same as migration 0016, except the "already cursed" check is per pair of teams.
create or replace function public.use_card(
  p_card uuid,
  p_target uuid default null,        -- duplicate: the card in your hand to copy
  p_target_team uuid default null,   -- curse / steal: the other team
  p_in_range boolean default false   -- curse / steal: attacker confirms the range condition is met
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
  stolen public.cards;
  victim public.teams;
  message text;
  new_curse uuid;
  new_copy uuid;
  new_draw uuid;
  new_steal uuid;
  bonus int;
  m text[];
begin
  t := public._acting_team(false);
  perform public._require_hand_within_limit(t.id);

  select * into c from public.cards where id = p_card for update;
  if not found or c.status <> 'hand' or c.holder_team <> t.id then
    raise exception 'That card is not in your hand';
  end if;
  select * into ct from public.card_types where id = c.type_id;

  if ct.effect = 'veto' then
    raise exception 'Keep Veto in your hand. When you are cursed or a card is stolen from you, a Veto button appears';
  end if;

  -- Curses and steals target another team, with a range confirmation.
  -- Curses only during Elimination; steals in either phase.
  if ct.type = 'curse' or ct.effect = 'steal' then
    if ct.type = 'curse' and (select phase from public.game_state where id = 1) <> 'elimination' then
      raise exception 'Curses can only be played during Elimination';
    end if;
    if p_target_team is null then
      raise exception 'Choose a team';
    end if;
    if p_target_team = t.id then
      raise exception 'You cannot play this on your own team';
    end if;
    if not p_in_range then
      raise exception 'Confirm that the card''s range condition is met';
    end if;
    select * into victim from public.teams where id = p_target_team for update;
    if not found then
      raise exception 'Team not found';
    end if;
    if victim.status <> 'active' then
      raise exception '% has been eliminated', victim.name;
    end if;
  end if;

  if ct.type = 'curse' then
    if exists (select 1 from public.curses
                where attacker_team = t.id and target_team = victim.id and status = 'active') then
      raise exception 'You already have a curse on %. Wait until they clear it', victim.name;
    end if;

    insert into public.curses (attacker_team, target_team, card_name, range_text, clearance)
    values (t.id, victim.id, ct.name, ct.range_text, ct.clearance)
    returning id into new_curse;
    perform public._shift_speed(victim.id, 1, 'Cursed by ' || t.name || ': ' || ct.name);
    perform public._shift_speed(t.id, -1, 'Cursing ' || victim.name || ': ' || ct.name);
    message := 'You cursed ' || victim.name || '. Their countdown runs 1× faster and yours 1× slower until they clear it.';

  elsif ct.effect = 'steal' then
    select * into stolen from public.cards
     where holder_team = victim.id and status = 'hand'
     order by random()
     limit 1
       for update;
    if not found then
      raise exception '% has no cards to steal', victim.name;
    end if;
    update public.cards set holder_team = t.id, updated_at = now() where id = stolen.id;
    insert into public.steals (attacker_team, target_team, card_id, card_name, veto_until)
    values (t.id, victim.id, stolen.id, public._card_name(stolen.id), now() + interval '60 seconds')
    returning id into new_steal;
    message := 'You stole ' || public._card_name(stolen.id) || ' from ' || victim.name
      || '. They have 60 seconds to veto it.';

  elsif ct.effect = 'duplicate' then
    if p_target is null or p_target = c.id then
      raise exception 'Choose another card in your hand to duplicate';
    end if;
    select * into target from public.cards where id = p_target for update;
    if not found or target.status <> 'hand' or target.holder_team <> t.id then
      raise exception 'You can only duplicate a card in your own hand';
    end if;
    insert into public.cards (type_id, status, holder_team, is_duplicate)
    values (target.type_id, 'hand', t.id, true)
    returning id into new_copy;
    message := 'You now have a copy of ' || public._card_name(target.id) || '.';

  elsif ct.effect like 'draw %' then
    m := regexp_match(ct.effect, '^draw (\d+) pick (\d+)$');
    insert into public.card_draws (team_id, size, keep, source)
    values (t.id, m[1]::int, least(m[2]::int, m[1]::int), ct.name)
    returning id into new_draw;
    message := 'You get a new draw: ' || m[1] || ' cards, keep ' || least(m[2]::int, m[1]::int)
      || '. Tap Draw on the Cards tab.';

  elsif ct.effect like 'hand +%' then
    bonus := least(substring(ct.effect from 7)::int, 50 - t.hand_bonus);
    update public.teams set hand_bonus = hand_bonus + bonus where id = t.id;
    message := 'Your hand limit is now ' || public._hand_limit(t.id) || '.';

  else
    message := 'Played ' || ct.name || '. Carry out its effect now.';
  end if;

  perform public._card_to_deck(c.id);

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id,
          case when ct.type = 'curse' then 'curse_started'
               when ct.effect = 'steal' then 'card_stolen'
               else 'card_used' end,
          jsonb_strip_nulls(jsonb_build_object(
            'name', t.name, 'card', ct.name, 'type', ct.type,
            'target_team', victim.name,
            'target_card', case when target.id is null then null else public._card_name(target.id) end,
            'stolen_card', case when stolen.id is null then null else public._card_name(stolen.id) end)));
  perform public._record_undo(t.id, 'use',
                              'Played ' || ct.name || coalesce(' on ' || victim.name, ''),
                              p_card => c.id, p_curse => new_curse, p_copy => new_copy,
                              p_draw => new_draw, p_steal => new_steal, p_bonus => bonus);

  perform public._sweep_eliminations();
  return message;
end;
$$;

-- Same as migration 0014, except the "already cursed" check is per pair of teams.
create or replace function public._restart_curse(p_curse uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.curses;
begin
  select * into k from public.curses where id = p_curse for update;
  if not found then
    raise exception 'Curse not found';
  end if;
  if k.status = 'active' then
    raise exception 'That curse is already active';
  end if;
  if exists (select 1 from public.teams
              where id in (k.target_team, k.attacker_team) and status <> 'active') then
    raise exception 'One of the teams has been eliminated';
  end if;
  if exists (select 1 from public.curses
              where attacker_team = k.attacker_team and target_team = k.target_team and status = 'active') then
    raise exception 'The same team already has another curse on it';
  end if;

  perform public._mark_activity_undone(k.target_team, k.cleared_at, array['curse_cleared']);
  update public.team_undos set undone_at = now()
   where curse_id = k.id and kind = 'clear_curse' and undone_at is null;

  update public.curses set status = 'active', cleared_at = null, cleared_by = null where id = k.id;
  perform public._shift_speed(k.target_team, 1, p_reason || ': ' || k.card_name);
  perform public._shift_speed(k.attacker_team, -1, p_reason || ': ' || k.card_name);
  perform public._sweep_eliminations();
end;
$$;

-- ---------------------------------------------------------------------------
-- Speed arrows: move one step (+1x or -1x) at a time
-- ---------------------------------------------------------------------------

-- The team moves its own speed up or down by 1. Locks the team row, so two
-- quick taps make two steps rather than both landing on the same speed.
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
  if p_delta not in (-1, 1) then
    raise exception 'Speed can only move one step at a time';
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

-- The admin moves a team's speed up or down by 1.
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
  if p_delta not in (-1, 1) then
    raise exception 'Speed can only move one step at a time';
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

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function public.step_my_speed(int) from public, anon;
grant  execute on function public.step_my_speed(int) to authenticated;
revoke execute on function public.admin_step_speed(uuid, int) from public, anon;
grant  execute on function public.admin_step_speed(uuid, int) to authenticated;
