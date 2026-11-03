-- Power-ups with automatic effects (card_types.effect):
--   draw X pick Y - the team gets a draw: X cards shown, keep Y ("draw 4 pick 2")
--   hand +N       - the team's hand limit goes up by N for the rest of the game ("hand +1")
--   steal         - take a random card from another team's hand. Like curses:
--                   Elimination only, with a range confirmation.
--   veto          - not played from the hand. Cancels a curse on your team (any
--                   time while it is active), or takes back a card stolen from
--                   you in the last 60 seconds (veto_curse / veto_steal).
-- Challenge draws stay "keep 1".
-- Run AFTER 0014. Run once in the Supabase dashboard: SQL Editor -> New query
-- -> paste -> Run.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.card_types drop constraint card_types_effect_check;
alter table public.card_types add constraint card_types_effect_check check (
  effect in ('duplicate', 'steal', 'veto')
  or effect ~ '^draw ([1-9]|10) pick ([1-9]|10)$'
  or effect ~ '^hand \+[1-9]$'
);

-- How many cards a draw lets the team keep, and how many it has kept so far.
alter table public.card_draws
  add column keep int not null default 1,
  add column kept int not null default 0,
  add constraint card_draws_keep_check check (keep between 1 and size);

-- Extra hand-limit slots from "hand +N" cards (public, like speed).
alter table public.teams
  add column hand_bonus int not null default 0 check (hand_bonus between 0 and 50);

-- A vetoed curse is cleared by 'veto'.
alter table public.curses drop constraint curses_cleared_by_check;
alter table public.curses add constraint curses_cleared_by_check
  check (cleared_by in ('target', 'admin', 'veto'));

-- One row per steal, so the victim can veto it for 60 seconds.
create table public.steals (
  id            uuid primary key default gen_random_uuid(),
  attacker_team uuid not null references public.teams (id) on delete cascade,
  target_team   uuid not null references public.teams (id) on delete cascade,
  card_id       uuid references public.cards (id) on delete set null,
  card_name     text not null,
  created_at    timestamptz not null default now(),
  veto_until    timestamptz not null,
  vetoed_at     timestamptz
);
create index steals_target_idx on public.steals (target_team, created_at);

alter table public.steals enable row level security;
-- Each team sees steals it made or suffered; admins see all.
create policy "own steals or admin" on public.steals
  for select to authenticated
  using (attacker_team = public.my_team_id() or target_team = public.my_team_id() or public.is_admin());
revoke insert, update, delete, truncate on public.steals from anon, authenticated;

create trigger sync_steals after insert or update or delete on public.steals
  for each statement execute function public._broadcast_change();

-- Undo records for the new effects.
alter table public.team_undos drop constraint team_undos_kind_check;
alter table public.team_undos add constraint team_undos_kind_check
  check (kind in ('claim', 'use', 'discard', 'clear_curse', 'veto'));
alter table public.team_undos
  add column draw_id  uuid references public.card_draws (id) on delete set null, -- draw made by "draw X pick Y"
  add column steal_id uuid references public.steals (id) on delete set null,     -- steal, or the steal a veto took back
  add column bonus    int;                                                       -- slots added by "hand +N"

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

drop function public._record_undo(uuid, text, text, uuid, uuid, uuid, uuid);
create function public._record_undo(
  p_team uuid, p_kind text, p_label text,
  p_challenge uuid default null, p_card uuid default null,
  p_curse uuid default null, p_copy uuid default null,
  p_draw uuid default null, p_steal uuid default null, p_bonus int default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.team_undos (team_id, kind, label, challenge_id, card_id, curse_id, copy_id,
                                 draw_id, steal_id, bonus, expires_at)
  values (p_team, p_kind, p_label, p_challenge, p_card, p_curse, p_copy,
          p_draw, p_steal, p_bonus, now() + interval '60 seconds');
$$;

-- The game's hand limit plus the team's bonus slots.
create or replace function public._hand_limit(p_team uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select g.hand_limit + coalesce((select hand_bonus from public.teams where id = p_team), 0)
    from public.game_state g
   where g.id = 1;
$$;

-- Same as migration 0012, now using the team's own limit.
create or replace function public._hand_excess(p_team uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select count(*) from public.cards where holder_team = p_team and status = 'hand')::int
      - public._hand_limit(p_team),
    0);
$$;

-- A Veto card in the team's hand, locked (duplicate copies first, as they
-- disappear anyway).
create or replace function public._veto_card(p_team uuid)
returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cards;
begin
  select c.* into v
    from public.cards c join public.card_types ct on ct.id = c.type_id
   where c.holder_team = p_team and c.status = 'hand' and ct.effect = 'veto'
   order by c.is_duplicate desc
   limit 1
     for update of c;
  if not found then
    raise exception 'You have no Veto card in your hand';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Draws: keep Y of X
-- ---------------------------------------------------------------------------

-- Same as migration 0012, except a draw showing no more cards than it lets
-- the team keep goes straight into the hand.
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
  kept_card record;
  names text;
begin
  t := public._acting_team(true);

  if exists (select 1 from public.card_draws where team_id = t.id and status = 'open') then
    return 'Pick from the cards already showing first.';
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

  if n <= d.keep then
    -- Nothing to choose between: keep them all automatically.
    for kept_card in select id from public.cards where draw_id = d.id loop
      update public.cards set status = 'hand', draw_id = null, updated_at = now() where id = kept_card.id;
      insert into public.activity_log (actor_user_id, team_id, event_type, details)
      values (auth.uid(), t.id, 'card_kept', jsonb_build_object('name', t.name, 'card', public._card_name(kept_card.id)));
      names := concat_ws(', ', names, public._card_name(kept_card.id));
    end loop;
    update public.card_draws set status = 'done', kept = n, resolved_at = now() where id = d.id;
    return names || ' added to your hand.'
      || case when public._hand_excess(t.id) > 0 then ' Your hand is over the limit: discard a card.' else '' end;
  end if;

  update public.card_draws set status = 'open' where id = d.id;
  return case when d.keep = 1 then 'Pick one card to keep.' else 'Pick ' || d.keep || ' cards to keep.' end;
end;
$$;

-- Same as migration 0006, except a draw stays open until the team has kept
-- as many cards as it allows. Returns the message to show.
create or replace function public.choose_card(p_card uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  c public.cards;
  d public.card_draws;
  other record;
  message text;
begin
  t := public._acting_team(true);

  select * into c from public.cards where id = p_card for update;
  if not found or c.status <> 'offered' or c.holder_team <> t.id then
    raise exception 'That card is not one of your current choices';
  end if;

  select * into d from public.card_draws where id = c.draw_id for update;

  update public.cards set status = 'hand', draw_id = null, updated_at = now() where id = c.id;
  update public.card_draws set kept = kept + 1 where id = d.id returning * into d;

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'card_kept', jsonb_build_object('name', t.name, 'card', public._card_name(c.id)));
  message := public._card_name(c.id) || ' added to your hand.';

  if d.kept < d.keep and exists (select 1 from public.cards where draw_id = d.id and status = 'offered') then
    return message || ' Pick ' || (d.keep - d.kept) || ' more.';
  end if;

  for other in
    select id from public.cards where draw_id = d.id and status = 'offered' for update
  loop
    perform public._card_to_deck(other.id);
  end loop;
  update public.card_draws set status = 'done', resolved_at = now() where id = d.id;

  return message
    || case when public._hand_excess(t.id) > 0 then ' Your hand is over the limit: discard a card.' else '' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Using cards
-- ---------------------------------------------------------------------------

-- Same as migration 0013, plus steal, "draw X pick Y" and "hand +N"; Veto
-- can't be played from the hand.
create or replace function public.use_card(
  p_card uuid,
  p_target uuid default null,        -- duplicate: the card in your hand to copy
  p_target_team uuid default null,   -- curse / steal: the other team
  p_in_range boolean default false   -- curse / steal: attacker confirms they are within range
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

  -- Curses and steals target another team in range, during Elimination.
  if ct.type = 'curse' or ct.effect = 'steal' then
    if (select phase from public.game_state where id = 1) <> 'elimination' then
      raise exception '% can only be played during Elimination',
        case when ct.type = 'curse' then 'Curses' else 'Steal cards' end;
    end if;
    if p_target_team is null then
      raise exception 'Choose a team';
    end if;
    if p_target_team = t.id then
      raise exception 'You cannot play this on your own team';
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
  end if;

  if ct.type = 'curse' then
    if exists (select 1 from public.curses where target_team = victim.id and status = 'active') then
      raise exception '% is already cursed. A team can only have one curse at a time', victim.name;
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

-- ---------------------------------------------------------------------------
-- Veto
-- ---------------------------------------------------------------------------

-- The cursed team ends a curse on it with a Veto card. Speeds shift back as
-- if it were cleared. Allowed while paused, like clearing.
create or replace function public.veto_curse(p_curse uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  v public.cards;
  k public.curses;
  attacker_name text;
begin
  t := public._acting_team(true);
  v := public._veto_card(t.id);

  select * into k from public.curses where id = p_curse for update;
  if not found or k.target_team <> t.id then
    raise exception 'That curse is not on your team';
  end if;
  if k.status <> 'active' then
    raise exception 'That curse has already been cleared';
  end if;

  update public.curses set status = 'cleared', cleared_at = now(), cleared_by = 'veto' where id = k.id;
  perform public._card_to_deck(v.id);

  select name into attacker_name from public.teams where id = k.attacker_team;
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'curse_vetoed',
          jsonb_build_object('name', t.name, 'card', k.card_name, 'attacker', attacker_name));
  perform public._record_undo(t.id, 'veto', 'Vetoed the curse ' || k.card_name, p_card => v.id, p_curse => k.id);

  perform public._end_curse_speeds(k);
  return 'Curse vetoed. Your countdown is 1× slower again.';
end;
$$;

-- The robbed team takes a stolen card back with a Veto card, within 60 seconds
-- and only while the card is still in the thief's hand.
create or replace function public.veto_steal(p_steal uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  v public.cards;
  s public.steals;
  sc public.cards;
  attacker_name text;
begin
  t := public._acting_team(true);

  select * into s from public.steals where id = p_steal for update;
  if not found or s.target_team <> t.id then
    raise exception 'That card was not stolen from your team';
  end if;
  if s.vetoed_at is not null then
    raise exception 'You already vetoed that steal';
  end if;
  if s.veto_until < now() then
    raise exception 'Too late: a steal can only be vetoed within 60 seconds';
  end if;

  v := public._veto_card(t.id);
  select name into attacker_name from public.teams where id = s.attacker_team;

  select * into sc from public.cards where id = s.card_id for update;
  if not found or sc.status <> 'hand' or sc.holder_team <> s.attacker_team then
    raise exception 'Too late: % has already used that card', attacker_name;
  end if;

  update public.cards set holder_team = t.id, updated_at = now() where id = sc.id;
  update public.steals set vetoed_at = now() where id = s.id;
  perform public._card_to_deck(v.id);

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'steal_vetoed',
          jsonb_build_object('name', t.name, 'card', s.card_name, 'attacker', attacker_name));
  perform public._record_undo(t.id, 'veto', 'Vetoed the steal of ' || s.card_name, p_card => v.id, p_steal => s.id);
  return 'Steal vetoed. ' || s.card_name || ' is back in your hand.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Undo
-- ---------------------------------------------------------------------------

-- Same as migration 0014, plus undoing steals, "draw X pick Y", "hand +N" and vetoes.
create or replace function public._apply_undo(u public.team_undos, p_by_team boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.curses;
  cp public.cards;
  d public.card_draws;
  s public.steals;
  sc public.cards;
  message text;
begin
  if u.kind = 'claim' then
    if not exists (select 1 from public.challenges
                    where id = u.challenge_id and status = 'claimed' and claimed_by = u.team_id) then
      raise exception 'That claim has already been undone';
    end if;
    message := 'Claim undone. The challenge is back on the board.' || public._undo_claim(u.challenge_id, p_by_team);

  elsif u.kind = 'discard' then
    perform public._card_back_to_hand(u.card_id, u.team_id);
    message := 'The card is back in your hand.';

  elsif u.kind = 'use' then
    if u.copy_id is not null then
      select * into cp from public.cards where id = u.copy_id for update;
      if found and (cp.status <> 'hand' or cp.holder_team <> u.team_id) then
        raise exception 'The copy has already been used, so this can''t be undone. Ask the admin';
      end if;
      if found then
        update public.cards set status = 'removed', holder_team = null, updated_at = now() where id = cp.id;
      end if;
    end if;
    if u.draw_id is not null then
      select * into d from public.card_draws where id = u.draw_id for update;
      if found then
        if d.status = 'done' or d.kept > 0 then
          raise exception 'Cards were already kept from that draw, so this can''t be undone. Ask the admin';
        end if;
        perform public._cancel_draw(d.id);
      end if;
    end if;
    if u.steal_id is not null then
      select * into s from public.steals where id = u.steal_id for update;
      if found then
        if s.vetoed_at is not null then
          raise exception 'That steal was vetoed, so it can''t be undone';
        end if;
        select * into sc from public.cards where id = s.card_id for update;
        if not found or sc.status <> 'hand' or sc.holder_team <> u.team_id then
          raise exception 'The stolen card has already left your hand, so this can''t be undone. Ask the admin';
        end if;
        update public.cards set holder_team = s.target_team, updated_at = now() where id = sc.id;
        delete from public.steals where id = s.id;
      end if;
    end if;
    if u.bonus > 0 then
      update public.teams set hand_bonus = greatest(hand_bonus - u.bonus, 0) where id = u.team_id;
    end if;
    perform public._card_back_to_hand(u.card_id, u.team_id);
    if u.curse_id is not null then
      select * into k from public.curses where id = u.curse_id for update;
      if found and k.status = 'active' then
        delete from public.curses where id = k.id;
        perform public._shift_speed(k.target_team, -1, 'Curse undone: ' || k.card_name);
        perform public._shift_speed(k.attacker_team, 1, 'Curse undone: ' || k.card_name);
      elsif found and k.cleared_by = 'veto' then
        raise exception 'That curse was vetoed, so it can''t be undone';
      end if;
    end if;
    message := 'Undone. The card is back in your hand.';

  elsif u.kind = 'clear_curse' then
    perform public._restart_curse(u.curse_id, 'Curse clear undone');
    message := 'Undone. The curse is back on.';

  elsif u.kind = 'veto' then
    if u.curse_id is not null then
      perform public._restart_curse(u.curse_id, 'Veto undone');
    else
      select * into s from public.steals where id = u.steal_id for update;
      if not found then
        raise exception 'That steal no longer exists, so this can''t be undone. Ask the admin';
      end if;
      select * into sc from public.cards where id = s.card_id for update;
      if not found or sc.status <> 'hand' or sc.holder_team <> u.team_id then
        raise exception 'The card has already left your hand, so this can''t be undone. Ask the admin';
      end if;
      update public.cards set holder_team = s.attacker_team, updated_at = now() where id = sc.id;
      update public.steals set vetoed_at = null where id = s.id;
    end if;
    perform public._card_back_to_hand(u.card_id, u.team_id);
    message := 'Veto undone. Your Veto card is back in your hand.';
  end if;

  update public.team_undos set undone_at = now() where id = u.id;
  perform public._mark_activity_undone(u.team_id, u.created_at,
    array['challenge_claimed', 'card_used', 'curse_started', 'card_discarded', 'curse_cleared',
          'card_stolen', 'curse_vetoed', 'steal_vetoed']);
  return message;
end;
$$;

-- Same as migration 0014, plus steals and vetoes.
create or replace function public.admin_undo_activity(p_entry bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.activity_log;
  u public.team_undos;
  c public.challenges;
  k public.curses;
  e public.time_ledger;
  team_name text;
  reversal_id bigint;
  message text;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  perform 1 from public.game_state where id = 1 for share;

  select * into a from public.activity_log where id = p_entry for update;
  if not found then
    raise exception 'Entry not found';
  end if;
  if a.undone_at is not null then
    raise exception 'That has already been undone';
  end if;
  select name into team_name from public.teams where id = a.team_id;

  if a.event_type = 'challenge_claimed' then
    select * into c from public.challenges
     where claimed_by = a.team_id and claimed_at = a.created_at and status = 'claimed';
    if not found then
      raise exception 'That challenge is no longer claimed by this team';
    end if;
    message := 'Claim undone: "' || c.title || '" is back on the board.' || public._undo_claim(c.id, false);

  elsif a.event_type in ('card_used', 'curse_started', 'card_discarded', 'card_stolen', 'curse_vetoed', 'steal_vetoed') then
    select * into u from public.team_undos
     where team_id = a.team_id and created_at = a.created_at and kind in ('use', 'discard', 'veto')
       for update;
    if not found then
      raise exception 'This one can''t be undone automatically. Use Move in the Cards section';
    end if;
    if u.undone_at is not null then
      raise exception 'That has already been undone';
    end if;
    perform public._apply_undo(u, false);
    message := 'Undone: ' || u.label || '.';

  elsif a.event_type = 'curse_cleared' then
    select * into k from public.curses where target_team = a.team_id and cleared_at = a.created_at;
    if not found then
      raise exception 'That curse is no longer cleared';
    end if;
    perform public._restart_curse(k.id, 'Curse restarted by admin');
    message := 'The curse ' || k.card_name || ' is back on.';

  elsif a.event_type = 'time_adjusted' then
    select * into e from public.time_ledger
     where team_id = a.team_id and created_at = a.created_at and kind = 'adjust'
       for update;
    if not found or e.reversed_by is not null then
      raise exception 'That time change has already been undone';
    end if;
    perform 1 from public.teams where id = e.team_id for update;
    reversal_id := public._apply_delta(e.team_id, -e.delta_ms, 'reversal',
                                       'Undo: ' || coalesce(e.reason, 'time change'),
                                       jsonb_build_object('reverses', e.id));
    update public.time_ledger set reversed_by = reversal_id where id = e.id;
    message := 'Time change undone.';

  elsif a.event_type in ('speed_changed', 'speed_set_by_admin') then
    -- Shift back rather than set, so curses started since still count.
    perform public._shift_speed(a.team_id, (a.details->>'from')::int - (a.details->>'to')::int,
                                'Speed change undone by admin');
    message := 'Speed change undone.';

  elsif a.event_type = 'team_eliminated' then
    perform public.admin_set_team_status(a.team_id, 'active');
    message := team_name || ' is back in the game. If it has no time left it is eliminated again, so add time first.';

  else
    raise exception 'This kind of entry can''t be undone';
  end if;

  update public.activity_log set undone_at = now() where id = a.id;
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), a.team_id, 'action_undone',
          jsonb_build_object('name', team_name, 'action', message, 'by', 'admin'));
  perform public._sweep_eliminations();
  return message;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reset game
-- ---------------------------------------------------------------------------

-- Same as migration 0008, plus steals, undo records and hand bonuses.
create or replace function public.admin_reset_game()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;

  perform 1 from public.game_state where id = 1 for update;

  delete from public.team_undos where true;
  delete from public.steals where true;
  delete from public.curses where true;
  delete from public.card_draws where true;
  delete from public.time_ledger where true;
  delete from public.activity_log where true;

  delete from public.cards where is_duplicate;
  update public.cards set status = 'deck', holder_team = null, draw_id = null, updated_at = now() where true;

  update public.challenges
     set status = 'pool', activated_at = null, claimed_by = null, claimed_at = null
   where status in ('active', 'claimed');

  update public.teams set status = 'active', speed = 1, eliminated_at = null, hand_bonus = 0 where true;
  update public.team_clocks set balance_ms = 0, anchor_at = now(), speed = 1, running = false where true;

  update public.game_state
     set phase = 'preparation', is_paused = false, paused_at = null,
         phase_started_at = now(), updated_at = now()
   where id = 1;

  perform public._fill_board();

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'game_reset', '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function public._record_undo(uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, int)
  from public, anon, authenticated;
revoke execute on function public._hand_limit(uuid) from public, anon, authenticated;
revoke execute on function public._veto_card(uuid)  from public, anon, authenticated;
revoke execute on function public.veto_curse(uuid)  from public, anon;
revoke execute on function public.veto_steal(uuid)  from public, anon;
grant  execute on function public.veto_curse(uuid)  to authenticated;
grant  execute on function public.veto_steal(uuid)  to authenticated;
