-- Hand (inventory) limit.
--   game_state.hand_limit: the most cards a team may hold (default 5; the
--   admin can set 1-50). Offered cards (a "keep one" choice) don't count.
--   A team can go over the limit (keeping a drawn card, the admin moving a card
--   to it, or the admin lowering the limit). While over, it can't draw or use
--   cards until it discards down to the limit. Claims still work; their draws
--   just wait.
-- Run AFTER 0011. Run once in the Supabase dashboard: SQL Editor -> New query
-- -> paste -> Run.

alter table public.game_state
  add column hand_limit int not null default 5 check (hand_limit between 1 and 50);

-- How many cards a team must discard to get back to the limit (0 if none).
create or replace function public._hand_excess(p_team uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select count(*) from public.cards where holder_team = p_team and status = 'hand')::int
      - (select hand_limit from public.game_state where id = 1),
    0);
$$;

create or replace function public._require_hand_within_limit(p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  excess int := public._hand_excess(p_team);
begin
  if excess > 0 then
    raise exception 'Your hand is over the limit. Discard % card% first', excess,
      case when excess = 1 then '' else 's' end;
  end if;
end;
$$;

-- Same as migration 0007, plus the hand-limit check and a reminder when the
-- automatically kept card takes the hand over the limit.
create or replace function public.open_draw()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  d public.card_draws;
  n int;
  only_card uuid;
begin
  t := public._acting_team(true);

  if exists (select 1 from public.card_draws where team_id = t.id and status = 'open') then
    return 'Pick one of the cards already showing first.';
  end if;
  perform public._require_hand_within_limit(t.id);

  select * into d from public.card_draws
   where team_id = t.id and status = 'pending'
   order by created_at
   limit 1
     for update;
  if not found then
    raise exception 'You have no card draws waiting';
  end if;

  update public.cards
     set status = 'offered', holder_team = t.id, draw_id = d.id, updated_at = now()
   where id in (
     select id from public.cards
      where status = 'deck'
      order by random()
      limit d.size
        for update skip locked
   );
  get diagnostics n = row_count;

  if n = 0 then
    raise exception 'The deck is empty right now. Try again later or ask the admin';
  end if;

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'cards_drawn',
          jsonb_build_object('name', t.name, 'count', n, 'wanted', d.size, 'source', d.source));

  if n = 1 then
    -- Nothing to choose between: keep it automatically.
    select id into only_card from public.cards where draw_id = d.id;
    update public.cards set status = 'hand', draw_id = null, updated_at = now() where id = only_card;
    update public.card_draws set status = 'done', resolved_at = now() where id = d.id;
    insert into public.activity_log (actor_user_id, team_id, event_type, details)
    values (auth.uid(), t.id, 'card_kept', jsonb_build_object('name', t.name, 'card', public._card_name(only_card)));
    return public._card_name(only_card) || ' added to your hand.'
      || case when public._hand_excess(t.id) > 0 then ' Your hand is over the limit: discard a card.' else '' end;
  end if;

  update public.card_draws set status = 'open' where id = d.id;
  return 'Pick one card to keep.';
end;
$$;

-- Same as migration 0011, plus the hand-limit check.
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
  perform public._require_hand_within_limit(t.id);

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

create or replace function public.admin_set_hand_limit(new_limit int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  if new_limit not between 1 and 50 then
    raise exception 'Hand limit must be between 1 and 50';
  end if;

  update public.game_state set hand_limit = new_limit, updated_at = now() where id = 1;
  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'hand_limit_changed', jsonb_build_object('limit', new_limit));
end;
$$;

revoke execute on function public._hand_excess(uuid)               from public, anon, authenticated;
revoke execute on function public._require_hand_within_limit(uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_hand_limit(int)        from public, anon;
grant  execute on function public.admin_set_hand_limit(int)        to authenticated;
