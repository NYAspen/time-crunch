-- Three changes (2026-11-04):
--
--   * A team's speed is private: only the team itself and the admin can see it.
--     Teams and the admin read it from team_clocks, which already has that rule.
--     Column access is now listed by name, so a NEW column on teams needs adding
--     to this grant before browsers can read it.
--   * The admin can see each team's code. Login passwords are stored scrambled and
--     can't be read back, so codes are now also saved in team_codes (admin only),
--     written by the server when a team is created or its code is set. Teams
--     created before this have no saved code until the admin sets it again.
--   * Steals have no range: no range confirmation, and existing steal cards lose
--     their range text.
--
-- Run AFTER 0021. Run this whole file once in the Supabase SQL Editor.
-- The site must be running the matching code: older code asks for teams.speed
-- and shows an error once this has run.

-- ---------------------------------------------------------------------------
-- Private speeds
-- ---------------------------------------------------------------------------

revoke select on public.teams from anon, authenticated;
grant select (id, name, user_id, status, created_at, eliminated_at, hand_bonus, reward_multiplier)
  on public.teams to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Team codes
-- ---------------------------------------------------------------------------

create table public.team_codes (
  team_id    uuid primary key references public.teams (id) on delete cascade,
  code       text not null,
  updated_at timestamptz not null default now()
);
alter table public.team_codes enable row level security;
create policy "admins can read team codes" on public.team_codes
  for select to authenticated using (public.is_admin());
revoke insert, update, delete, truncate on public.team_codes from anon, authenticated;
grant select on public.team_codes to authenticated;
grant select, insert, update, delete on public.team_codes to service_role;

create trigger sync_team_codes after insert or update or delete on public.team_codes
  for each statement execute function public._broadcast_change();

-- ---------------------------------------------------------------------------
-- Steals have no range
-- ---------------------------------------------------------------------------

update public.card_types set range_text = '' where effect = 'steal';

-- Same as migration 0021, except steals don't need a range confirmation.
create or replace function public.use_card(
  p_card uuid,
  p_target uuid default null,        -- duplicate: the card in your hand to copy
  p_target_team uuid default null,   -- curse / steal / curse copy: the other team
  p_in_range boolean default false,  -- curse / curse copy: attacker confirms the range condition is met
  p_curse uuid default null,
  p_challenge uuid default null,
  p_cards uuid[] default null
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
  src public.curses;
  ch public.challenges;
  replacement public.challenges;
  dc public.cards;
  phase text;
  message text;
  new_curse uuid;
  new_copy uuid;
  new_draw uuid;
  new_steal uuid;
  bonus int;
  gain_from int;
  factor int;
  n int;
  x uuid;
  discarded text;
  m text[];
begin
  t := public._acting_team(false);
  perform public._require_hand_within_limit(t.id);

  select * into c from public.cards where id = p_card for update;
  if not found or c.status <> 'hand' or c.holder_team <> t.id then
    raise exception 'That card is not in your hand';
  end if;
  select * into ct from public.card_types where id = c.type_id;
  select g.phase into phase from public.game_state g where g.id = 1;

  if ct.effect = 'veto' then
    raise exception 'Keep Veto in your hand. When you are cursed, a Veto button appears on the curse';
  end if;

  -- Curses (and power-ups that work on curses) only during Elimination;
  -- power-ups that work on the challenge board only during Preparation.
  if (ct.type = 'curse' or ct.effect = 'curse copy' or ct.effect like 'curse x%') and phase <> 'elimination' then
    raise exception '% can only be played during Elimination',
      case when ct.type = 'curse' then 'Curses' else ct.name end;
  end if;
  if (ct.effect like 'reward x%' or ct.effect in ('replace challenge', 'lock challenge')) and phase <> 'preparation' then
    raise exception '% can only be played during Preparation, while challenges are on the board', ct.name;
  end if;

  -- One of the team's own active curses.
  if ct.effect = 'curse copy' or ct.effect like 'curse x%' then
    if p_curse is null then
      raise exception 'Choose one of your curses';
    end if;
    select * into src from public.curses where id = p_curse for update;
    if not found or src.attacker_team <> t.id or src.status <> 'active' then
      raise exception 'Choose one of your active curses';
    end if;
  end if;

  -- Curses, steals and curse copies target another team. Curses and curse copies
  -- also need a range confirmation; steals have no range.
  if ct.type = 'curse' or ct.effect in ('steal', 'curse copy') then
    if p_target_team is null then
      raise exception 'Choose a team';
    end if;
    if p_target_team = t.id then
      raise exception 'You cannot play this on your own team';
    end if;
    if ct.effect is distinct from 'steal' and not p_in_range then
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

  -- A challenge on the board.
  if ct.effect in ('replace challenge', 'lock challenge') then
    if p_challenge is null then
      raise exception 'Choose a challenge';
    end if;
    select * into ch from public.challenges where id = p_challenge for update;
    if not found or ch.status <> 'active' then
      raise exception 'That challenge is no longer on the board';
    end if;
  end if;

  if ct.type = 'curse' or ct.effect = 'curse copy' then
    if exists (select 1 from public.curses
                where attacker_team = t.id and target_team = victim.id and status = 'active') then
      raise exception 'You already have a curse on %. Wait until they clear it', victim.name;
    end if;

    if ct.type = 'curse' then
      insert into public.curses (attacker_team, target_team, card_name, range_text, clearance)
      values (t.id, victim.id, ct.name, ct.range_text, ct.clearance)
      returning id into new_curse;
    else
      insert into public.curses (attacker_team, target_team, card_name, range_text, clearance)
      values (t.id, victim.id, src.card_name, src.range_text, src.clearance)
      returning id into new_curse;
    end if;
    perform public._shift_speed(victim.id, 1, 'Cursed by ' || t.name || ': ' || coalesce(src.card_name, ct.name));
    perform public._shift_speed(t.id, -1, 'Cursing ' || victim.name || ': ' || coalesce(src.card_name, ct.name));
    message := 'You cursed ' || victim.name
      || case when src.id is null then '' else ' with ' || src.card_name || ' too' end
      || '. Their countdown runs 1× faster and yours 1× slower until they clear it.';

  elsif ct.effect like 'curse x%' then
    factor := substring(ct.effect from 8)::int;
    gain_from := src.attacker_gain;
    if gain_from > 1 then
      raise exception 'That curse is already boosted (you gain %× from it). Boosts don''t stack', gain_from;
    end if;
    select * into victim from public.teams where id = src.target_team;
    update public.curses set attacker_gain = gain_from * factor where id = src.id;
    perform public._shift_speed(t.id, -(gain_from * factor - gain_from),
                                'Boosted curse on ' || victim.name || ': ' || src.card_name || ' ×' || factor);
    new_curse := src.id;
    message := 'You now gain ' || (gain_from * factor) || '× from ' || src.card_name || ' on ' || victim.name
      || ' until they clear it.';

  elsif ct.effect like 'reward x%' then
    factor := substring(ct.effect from 9)::int;
    if t.reward_multiplier > 1 then
      raise exception 'Your next challenge is already worth ×%. Complete a challenge first: reward bonuses don''t stack',
        t.reward_multiplier;
    end if;
    update public.teams set reward_multiplier = factor where id = t.id;
    message := 'Your next completed challenge gives ×' || factor
      || ': the time bonus and the card draws.';

  elsif ct.effect = 'replace challenge' then
    if ch.locked_by is not null and ch.locked_by <> t.id then
      raise exception 'That challenge is locked by another team, so it can''t be replaced';
    end if;
    if not exists (select 1 from public.challenges where status = 'pool') then
      raise exception 'There are no other challenges left to swap in';
    end if;
    -- Off the board while the board refills, so it can't pick the same one;
    -- then back into the pool.
    update public.challenges set status = 'retired', activated_at = null where id = ch.id;
    perform public._fill_board();
    select * into replacement from public.challenges
     where status = 'active' and activated_at = now() and id <> ch.id
     limit 1;
    update public.challenges set status = 'pool' where id = ch.id;
    message := '"' || ch.title || '" went back to the pool'
      || case when replacement.id is null then '.' else '. New on the board: "' || replacement.title || '".' end;

  elsif ct.effect = 'lock challenge' then
    if ch.locked_by = t.id then
      raise exception 'Your team has already locked that challenge';
    end if;
    if ch.locked_by is not null then
      raise exception 'Another team has already locked that challenge';
    end if;
    if exists (select 1 from public.challenges where locked_by = t.id) then
      raise exception 'Your team already has a locked challenge. Complete it first';
    end if;
    update public.challenges set locked_by = t.id, locked_at = now() where id = ch.id;
    message := '"' || ch.title || '" is locked: only your team can complete it.';

  elsif ct.effect like 'discard %' then
    m := regexp_match(ct.effect, '^discard (\d+) draw (\d+)$');
    n := m[1]::int;
    if p_cards is null or cardinality(p_cards) <> n
       or (select count(distinct v) from unnest(p_cards) as v) <> n then
      raise exception 'Choose % other card% to discard', n, case when n = 1 then '' else 's' end;
    end if;
    if c.id = any (p_cards) then
      raise exception 'Choose other cards to discard, not this one';
    end if;
    foreach x in array p_cards loop
      select * into dc from public.cards where id = x for update;
      if not found or dc.status <> 'hand' or dc.holder_team <> t.id then
        raise exception 'You can only discard cards in your own hand';
      end if;
      discarded := concat_ws(', ', discarded, public._card_name(dc.id));
      perform public._card_to_deck(dc.id);
    end loop;
    insert into public.card_draws (team_id, size, keep, source)
    values (t.id, m[2]::int, m[2]::int, ct.name)
    returning id into new_draw;
    message := 'Discarded ' || discarded || '. Tap Draw on the Cards tab to get ' || m[2] || ' new card'
      || case when m[2]::int = 1 then '' else 's' end || '.';

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
    message := 'You stole ' || public._card_name(stolen.id) || ' from ' || victim.name || '.';

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
          case when ct.type = 'curse' or ct.effect = 'curse copy' then 'curse_started'
               when ct.effect = 'steal' then 'card_stolen'
               else 'card_used' end,
          jsonb_strip_nulls(jsonb_build_object(
            'name', t.name, 'card', ct.name, 'type', ct.type,
            'target_team', victim.name,
            'curse', src.card_name,
            'challenge', ch.title,
            'new_challenge', replacement.title,
            'discarded', discarded,
            'target_card', case when target.id is null then null else public._card_name(target.id) end,
            'stolen_card', case when stolen.id is null then null else public._card_name(stolen.id) end)));
  perform public._record_undo(t.id, 'use',
                              'Played ' || ct.name || coalesce(' on ' || victim.name, '')
                                || coalesce(' on "' || ch.title || '"', ''),
                              p_challenge => ch.id, p_card => c.id, p_curse => new_curse, p_copy => new_copy,
                              p_draw => new_draw, p_steal => new_steal, p_bonus => bonus,
                              p_card_ids => case when discarded is null then null else p_cards end,
                              p_gain_from => gain_from, p_challenge2 => replacement.id,
                              p_multiplier => case when ct.effect like 'reward x%' then factor end);

  perform public._sweep_eliminations();
  return message;
end;
$$;
