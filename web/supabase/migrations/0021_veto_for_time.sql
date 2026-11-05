-- Vetoes are for curses only, and a team can pay for one with time (2026-11-04).
--
--   * veto_curse_for_time: the cursed team ends a curse without a Veto card. It
--     pays 30 minutes and the team that played the curse gains 30 minutes.
--     Refused if the team has less than 30 minutes left. Allowed while paused,
--     like clearing a curse and the Veto card. Exactly 30 minutes is allowed, and
--     takes the team to 0 (eliminated).
--   * Veto cards no longer take back stolen cards: veto_steal is gone. The
--     steals table keeps its veto columns so old log entries can still be undone.
--
-- Undo (the team's 60 seconds, the admin's activity log, the admin's Restart)
-- restarts the curse and moves the time back, because curses.veto_paid_ms records
-- what was paid.
--
-- Run AFTER 0020. Run this whole file once in the Supabase SQL Editor.

alter table public.curses add column veto_paid_ms bigint;

drop function public.veto_steal(uuid);

-- The sample deck's Veto text mentioned stolen cards. Text the admin has changed is left alone.
update public.card_types
   set description = 'Cancel a curse on your team.'
 where effect = 'veto'
   and description = 'Cancel a curse on your team or take back a card stolen from you within 60 seconds.';

-- ---------------------------------------------------------------------------
-- Paying for a veto
-- ---------------------------------------------------------------------------

create function public.veto_curse_for_time(p_curse uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cost_ms constant bigint := 30 * 60 * 1000;
  t public.teams;
  k public.curses;
  attacker_name text;
begin
  t := public._acting_team(true);

  select * into k from public.curses where id = p_curse for update;
  if not found or k.target_team <> t.id then
    raise exception 'That curse is not on your team';
  end if;
  if k.status <> 'active' then
    raise exception 'That curse has already been cleared';
  end if;

  -- Settling gives the exact time left right now.
  if public._settle_team(t.id) < cost_ms then
    raise exception 'You need at least 30 minutes left to pay for a veto';
  end if;

  select name into attacker_name from public.teams where id = k.attacker_team;

  update public.curses
     set status = 'cleared', cleared_at = now(), cleared_by = 'veto', veto_paid_ms = cost_ms
   where id = k.id;

  perform public._apply_delta(t.id, -cost_ms, 'curse_veto', 'Paid to veto the curse ' || k.card_name,
                              jsonb_build_object('curse', k.id));
  perform public._apply_delta(k.attacker_team, cost_ms, 'curse_veto',
                              t.name || ' paid to veto your curse ' || k.card_name,
                              jsonb_build_object('curse', k.id));

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'curse_vetoed',
          jsonb_build_object('name', t.name, 'card', k.card_name, 'attacker', attacker_name, 'minutes', 30));
  perform public._record_undo(t.id, 'veto', 'Paid 30 minutes to veto the curse ' || k.card_name, p_curse => k.id);

  perform public._end_curse_speeds(k);
  return 'Curse vetoed. You paid 30 minutes and ' || attacker_name || ' gained 30 minutes.';
end;
$$;

-- Same as migration 0019, plus giving back a veto's time. The attacker must still
-- have that time, so undoing can't knock them out of the game. Also marks a veto
-- as undone, as well as a clear.
create or replace function public._restart_curse(p_curse uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.curses;
  attacker_name text;
  target_name text;
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

  perform public._mark_activity_undone(k.target_team, k.cleared_at, array['curse_cleared', 'curse_vetoed']);
  update public.team_undos set undone_at = now()
   where curse_id = k.id and kind in ('clear_curse', 'veto') and undone_at is null;

  if k.veto_paid_ms is not null then
    select name into attacker_name from public.teams where id = k.attacker_team;
    select name into target_name from public.teams where id = k.target_team;
    if public._settle_team(k.attacker_team) < k.veto_paid_ms then
      raise exception '% has already used that time, so the veto can''t be undone. The admin can add time to them first', attacker_name;
    end if;
    perform public._apply_delta(k.target_team, k.veto_paid_ms, 'curse_veto', 'Veto undone: ' || k.card_name,
                                jsonb_build_object('curse', k.id));
    perform public._apply_delta(k.attacker_team, -k.veto_paid_ms, 'curse_veto', 'Veto undone: ' || k.card_name,
                                jsonb_build_object('curse', k.id));
    insert into public.activity_log (actor_user_id, team_id, event_type, details)
    values (auth.uid(), k.target_team, 'curse_veto_undone',
            jsonb_build_object('name', target_name, 'card', k.card_name, 'attacker', attacker_name,
                               'minutes', k.veto_paid_ms / 60000));
  end if;

  update public.curses set status = 'active', cleared_at = null, cleared_by = null, veto_paid_ms = null where id = k.id;
  perform public._shift_speed(k.target_team, 1, p_reason || ': ' || k.card_name);
  perform public._shift_speed(k.attacker_team, -k.attacker_gain, p_reason || ': ' || k.card_name);
  perform public._sweep_eliminations();
end;
$$;

-- ---------------------------------------------------------------------------
-- Same as migration 0019, except a veto paid for with time has no card to give back.
-- ---------------------------------------------------------------------------

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
  orig public.challenges;
  repl public.challenges;
  mult int;
  x uuid;
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

    -- reward xN: take it back off, unless a challenge already used it.
    if u.multiplier is not null then
      select reward_multiplier into mult from public.teams where id = u.team_id for update;
      if mult <> u.multiplier then
        raise exception 'The bonus was already used on a challenge, so this can''t be undone. Ask the admin';
      end if;
      update public.teams set reward_multiplier = 1 where id = u.team_id;
    end if;

    -- discard X draw Y: the discarded cards come back (the draw was cancelled above).
    if u.card_ids is not null then
      foreach x in array u.card_ids loop
        perform public._card_back_to_hand(x, u.team_id);
      end loop;
    end if;

    -- replace challenge: the original goes back on the board, the replacement back to the pool.
    if u.challenge2_id is not null then
      select * into orig from public.challenges where id = u.challenge_id for update;
      select * into repl from public.challenges where id = u.challenge2_id for update;
      if orig.status is distinct from 'pool' or repl.status is distinct from 'active' then
        raise exception 'The board has changed since, so this can''t be undone. Ask the admin';
      end if;
      update public.challenges set status = 'pool', activated_at = null where id = repl.id;
      update public.challenges set status = 'active', activated_at = repl.activated_at where id = orig.id;
    -- lock challenge: unlock it.
    elsif u.challenge_id is not null then
      update public.challenges set locked_by = null, locked_at = null
       where id = u.challenge_id and locked_by = u.team_id;
    end if;

    perform public._card_back_to_hand(u.card_id, u.team_id);

    if u.curse_id is not null then
      select * into k from public.curses where id = u.curse_id for update;
      if u.gain_from is not null then
        -- curse xN: back to the gain it had before.
        if found then
          if k.status = 'active' then
            perform public._shift_speed(k.attacker_team, k.attacker_gain - u.gain_from,
                                        'Curse boost undone: ' || k.card_name);
          end if;
          update public.curses set attacker_gain = u.gain_from where id = k.id;
        end if;
      elsif found and k.status = 'active' then
        delete from public.curses where id = k.id;
        perform public._shift_speed(k.target_team, -1, 'Curse undone: ' || k.card_name);
        perform public._shift_speed(k.attacker_team, k.attacker_gain, 'Curse undone: ' || k.card_name);
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
    -- A veto paid for with time has no card; _restart_curse gave the time back.
    if u.card_id is not null then
      perform public._card_back_to_hand(u.card_id, u.team_id);
      message := 'Veto undone. Your Veto card is back in your hand.';
    else
      message := 'Veto undone. The curse is back on and you have your time back.';
    end if;
  end if;

  update public.team_undos set undone_at = now() where id = u.id;
  perform public._mark_activity_undone(u.team_id, u.created_at,
    array['challenge_claimed', 'card_used', 'curse_started', 'card_discarded', 'curse_cleared',
          'card_stolen', 'curse_vetoed', 'steal_vetoed']);
  return message;
end;
$$;

-- ---------------------------------------------------------------------------
-- Same as migration 0019, except the Veto and steal messages no longer offer to
-- veto a steal.
-- ---------------------------------------------------------------------------

create or replace function public.use_card(
  p_card uuid,
  p_target uuid default null,        -- duplicate: the card in your hand to copy
  p_target_team uuid default null,   -- curse / steal / curse copy: the other team
  p_in_range boolean default false,  -- curse / steal / curse copy: attacker confirms the range condition is met
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

  -- Curses, steals and curse copies target another team, with a range confirmation.
  if ct.type = 'curse' or ct.effect in ('steal', 'curse copy') then
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

-- ---------------------------------------------------------------------------
-- Same as migration 0020, except steals can't be vetoed any more, and the attacker
-- hears when a paid veto is undone (their time goes back down).
-- ---------------------------------------------------------------------------

create or replace function public.team_feed()
returns table (id bigint, created_at timestamptz, team_id uuid, event_type text, details jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := public.my_team_id();
  my_name text;
begin
  if me is null then
    return;
  end if;
  select t.name into my_name from public.teams t where t.id = me;

  return query
  select a.id, a.created_at, a.team_id, a.event_type, a.details
    from public.activity_log a
   where a.created_at > now() - interval '30 minutes'
     and a.undone_at is null
     and (
       a.event_type in ('phase_changed', 'team_eliminated', 'team_revived')
       or (a.team_id is distinct from me
           and (a.event_type = 'challenge_claimed'
                or (a.event_type = 'card_used' and a.details ? 'challenge')
                or (a.event_type in ('curse_started', 'card_stolen') and a.details->>'target_team' = my_name)
                or (a.event_type in ('curse_cleared', 'curse_vetoed', 'curse_veto_undone')
                    and a.details->>'attacker' = my_name)))
       or (a.team_id = me
           and (a.details->>'by' = 'admin'
                or a.event_type in ('time_adjusted', 'draw_granted', 'draw_cancelled', 'speed_set_by_admin',
                                    'card_moved_by_admin')))
       -- the admin moved a card out of this team's hand (to the deck or another team)
       or (a.event_type = 'card_moved_by_admin' and a.details->>'from_team' = me::text)
     )
   order by a.id desc
   limit 20;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function public.veto_curse_for_time(uuid) from public, anon;
grant  execute on function public.veto_curse_for_time(uuid) to authenticated;
