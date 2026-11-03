-- Six more power-up effects (card_types.effect):
--   reward xN          - your team's NEXT completed challenge gives N times the
--                        time bonus and N draws ("reward x2"). Preparation only.
--                        They don't stack: only one can be waiting at a time.
--   curse xN           - play on one of your active curses: you gain N times as
--                        much from it (your speed -N× instead of -1×). The victim
--                        still drains +1×. Lasts until that curse ends. Elimination only.
--                        They don't stack: each curse can only be boosted once.
--   curse copy         - play on one of your active curses and pick another team
--                        (range confirmation): that team gets the same curse too,
--                        with its own clearance. One curse per pair still applies.
--                        Elimination only.
--   discard X draw Y   - discard X other cards from your hand, then get a draw of
--                        Y cards that all go into your hand ("discard 2 draw 3").
--   replace challenge  - send one board challenge back to the pool; a random one
--                        from the pool takes its place. Preparation only.
--   lock challenge     - lock one board challenge so only your team can complete
--                        it, until you complete it. One lock per team.
--                        Preparation only.
-- Run AFTER 0018. Run once in the Supabase dashboard: SQL Editor -> New query
-- -> paste -> Run.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.card_types drop constraint card_types_effect_check;
alter table public.card_types add constraint card_types_effect_check check (
  effect in ('duplicate', 'steal', 'veto', 'curse copy', 'replace challenge', 'lock challenge')
  or effect ~ '^draw ([1-9]|10) pick ([1-9]|10)$'
  or effect ~ '^hand \+[1-9]$'
  or effect ~ '^reward x[2-9]$'
  or effect ~ '^curse x[2-9]$'
  or effect ~ '^discard [1-9] draw ([1-9]|10)$'
);

-- "reward xN" waiting for the team's next completed challenge (public, like speed).
alter table public.teams
  add column reward_multiplier int not null default 1 check (reward_multiplier between 1 and 9);

-- The multiplier a claim used (so undoing the claim gives it back), and locks.
alter table public.challenges
  add column claim_multiplier int not null default 1 check (claim_multiplier between 1 and 9),
  add column locked_by uuid references public.teams (id) on delete set null,
  add column locked_at timestamptz;
-- One lock per team at a time.
create unique index challenges_one_lock_per_team on public.challenges (locked_by) where locked_by is not null;

-- A lock only lasts while the challenge is on the board: claiming it, the
-- admin removing it, a replace or a reset all unlock it.
create function public._challenge_unlock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    new.locked_by := null;
    new.locked_at := null;
  end if;
  return new;
end;
$$;
create trigger challenges_unlock before update on public.challenges
  for each row execute function public._challenge_unlock();

-- How much the attacker gains from a curse: its speed shifts by -attacker_gain
-- (1 normally, more after "curse xN"). The victim always shifts by +1.
alter table public.curses
  add column attacker_gain int not null default 1 check (attacker_gain between 1 and 9);

-- Undo records for the new effects.
alter table public.team_undos
  add column card_ids      uuid[],                                                  -- cards discarded by "discard X draw Y"
  add column gain_from     int,                                                     -- "curse xN": the curse's gain before
  add column challenge2_id uuid references public.challenges (id) on delete set null, -- "replace challenge": the replacement
  add column multiplier    int;                                                     -- "reward xN": the factor added

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

drop function public._record_undo(uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, int);
create function public._record_undo(
  p_team uuid, p_kind text, p_label text,
  p_challenge uuid default null, p_card uuid default null,
  p_curse uuid default null, p_copy uuid default null,
  p_draw uuid default null, p_steal uuid default null, p_bonus int default null,
  p_card_ids uuid[] default null, p_gain_from int default null,
  p_challenge2 uuid default null, p_multiplier int default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.team_undos (team_id, kind, label, challenge_id, card_id, curse_id, copy_id,
                                 draw_id, steal_id, bonus, card_ids, gain_from, challenge2_id,
                                 multiplier, expires_at)
  values (p_team, p_kind, p_label, p_challenge, p_card, p_curse, p_copy,
          p_draw, p_steal, p_bonus, p_card_ids, p_gain_from, p_challenge2,
          p_multiplier, now() + interval '60 seconds');
$$;

-- Same as migration 0011, except a curse takes attacker_gain off the attacker.
create or replace function public._curse_speed(p_team uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select 1
    + (select count(*) from public.curses where target_team = p_team and status = 'active')::int
    - (select coalesce(sum(attacker_gain), 0) from public.curses where attacker_team = p_team and status = 'active')::int;
$$;

-- Same as migration 0011, except the attacker shifts back by attacker_gain.
create or replace function public._end_curse_speeds(k public.curses)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._shift_speed(k.target_team, -1, 'Curse cleared: ' || k.card_name);
  perform public._shift_speed(k.attacker_team, k.attacker_gain, 'Curse cleared: ' || k.card_name);
  perform public._sweep_eliminations();
end;
$$;

-- Same as migration 0016, except the attacker shifts back by attacker_gain.
create or replace function public._end_curses_for(p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.curses;
  team_name text;
begin
  select name into team_name from public.teams where id = p_team;
  for k in
    select * from public.curses
     where status = 'active' and (attacker_team = p_team or target_team = p_team)
     order by started_at
       for update
  loop
    update public.curses set status = 'cleared', cleared_at = now(), cleared_by = 'eliminated' where id = k.id;
    perform public._shift_speed(k.target_team, -1, 'Curse ended (' || team_name || ' eliminated): ' || k.card_name);
    perform public._shift_speed(k.attacker_team, k.attacker_gain, 'Curse ended (' || team_name || ' eliminated): ' || k.card_name);
    insert into public.activity_log (actor_user_id, team_id, event_type, details)
    values (auth.uid(), p_team, 'curse_ended',
            jsonb_build_object('name', team_name, 'card', k.card_name,
                               'attacker', (select name from public.teams where id = k.attacker_team),
                               'target', (select name from public.teams where id = k.target_team)));
  end loop;
end;
$$;

-- Same as migration 0017, except the attacker shifts by attacker_gain.
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
  perform public._shift_speed(k.attacker_team, -k.attacker_gain, p_reason || ': ' || k.card_name);
  perform public._sweep_eliminations();
end;
$$;

-- ---------------------------------------------------------------------------
-- Challenges: locks and reward multipliers
-- ---------------------------------------------------------------------------

-- Same as migration 0016, plus: a challenge locked by another team can't be
-- claimed, and a waiting "reward xN" multiplies the time bonus and the draws
-- (then resets to 1).
create or replace function public.claim_challenge(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.game_state;
  t public.teams;
  c public.challenges;
  keep int;
  mult int;
  i int;
begin
  select * into g from public.game_state where id = 1 for share;
  if g.is_paused then
    raise exception 'The game is paused, so challenges cannot be claimed right now';
  end if;
  if g.phase <> 'preparation' then
    raise exception 'Challenges can only be completed during Preparation';
  end if;

  select * into t from public.teams where user_id = auth.uid() for update;
  if not found then
    raise exception 'Only a logged-in team can claim challenges' using errcode = '42501';
  end if;
  if t.status <> 'active' then
    raise exception 'Your team has been eliminated';
  end if;

  select * into c from public.challenges where id = p_challenge for update;
  if not found then
    raise exception 'Challenge not found';
  end if;
  if c.status = 'claimed' then
    if c.claimed_by = t.id then
      raise exception 'Your team already claimed this challenge';
    end if;
    raise exception 'Too late: another team already claimed this challenge';
  end if;
  if c.status <> 'active' then
    raise exception 'This challenge is no longer on the board';
  end if;
  if c.locked_by is not null and c.locked_by <> t.id then
    raise exception 'This challenge is locked by %, so only they can complete it',
      (select name from public.teams where id = c.locked_by);
  end if;

  mult := t.reward_multiplier;
  update public.challenges
     set status = 'claimed', claimed_by = t.id, claimed_at = now(), claim_multiplier = mult
   where id = c.id;
  if mult > 1 then
    update public.teams set reward_multiplier = 1 where id = t.id;
  end if;

  if c.reward_minutes > 0 then
    perform public._apply_delta(t.id, c.reward_minutes * mult * 60000::bigint, 'challenge',
                                c.title || case when mult > 1 then ' (×' || mult || ')' else '' end,
                                jsonb_build_object('challenge_id', c.id));
  end if;

  keep := least(c.reward_keep, greatest(c.reward_cards, 1));
  if c.reward_cards > 0 then
    for i in 1 .. mult loop
      insert into public.card_draws (team_id, size, keep, source, challenge_id)
      values (t.id, c.reward_cards, keep, c.title, c.id);
    end loop;
  end if;

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'challenge_claimed',
          jsonb_build_object('name', t.name, 'challenge', c.title,
                             'minutes', c.reward_minutes * mult, 'cards', c.reward_cards, 'keep', keep,
                             'multiplier', mult));
  perform public._record_undo(t.id, 'claim', 'Claimed "' || c.title || '"', p_challenge => c.id);

  perform public._fill_board();
  perform public._sweep_eliminations();

  return jsonb_build_object('title', c.title, 'minutes', c.reward_minutes * mult, 'cards', c.reward_cards,
                            'keep', keep, 'draws', case when c.reward_cards > 0 then mult else 0 end,
                            'multiplier', mult);
end;
$$;

-- Same as migration 0014, except it cancels every draw from the claim (a
-- "reward xN" claim makes several) and gives back the multiplier it used.
create or replace function public._undo_claim(p_challenge uuid, p_by_team boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.challenges;
  d public.card_draws;
  e public.time_ledger;
  reversal_id bigint;
  any_draw boolean := false;
  note text := '';
begin
  select * into c from public.challenges where id = p_challenge for update;
  if not found or c.status <> 'claimed' then
    raise exception 'That challenge is not claimed';
  end if;

  for d in
    select * from public.card_draws where challenge_id = c.id order by created_at for update
  loop
    any_draw := true;
    if d.status = 'done' or d.kept > 0 then
      if p_by_team then
        raise exception 'You already kept a card from this challenge, so the claim can''t be undone. Ask the admin';
      end if;
      note := ' A card kept from it is still in the team''s hand: use Move to take it back.';
    else
      perform public._cancel_draw(d.id);
    end if;
  end loop;

  -- Older draws have no challenge_id, so fall back to the title.
  if not any_draw then
    select * into d from public.card_draws
     where challenge_id is null and team_id = c.claimed_by and source = c.title
     order by created_at desc
     limit 1
       for update;
    if found then
      if d.status = 'done' then
        if p_by_team then
          raise exception 'You already kept a card from this challenge, so the claim can''t be undone. Ask the admin';
        end if;
        note := ' A card kept from it is still in the team''s hand: use Move to take it back.';
      else
        perform public._cancel_draw(d.id);
      end if;
    end if;
  end if;

  select * into e from public.time_ledger
   where team_id = c.claimed_by and kind = 'challenge' and details->>'challenge_id' = c.id::text
     and reversed_by is null
   order by id desc
   limit 1
     for update;
  if found and e.delta_ms <> 0 then
    reversal_id := public._apply_delta(e.team_id, -e.delta_ms, 'reversal', 'Claim undone: ' || c.title,
                                       jsonb_build_object('reverses', e.id));
    update public.time_ledger set reversed_by = reversal_id where id = e.id;
  end if;

  -- The "reward xN" it used is waiting again for the next challenge (they
  -- don't stack, so the bigger one wins if another was played since).
  if c.claim_multiplier > 1 then
    update public.teams set reward_multiplier = greatest(reward_multiplier, c.claim_multiplier)
     where id = c.claimed_by;
  end if;

  perform public._mark_activity_undone(c.claimed_by, c.claimed_at, array['challenge_claimed']);
  update public.team_undos set undone_at = now()
   where challenge_id = c.id and kind = 'claim' and undone_at is null;

  -- Keeps its original activated_at, so if the board is now over size the
  -- replacement that was added after the claim goes back to the pool.
  update public.challenges
     set status = 'active', claimed_by = null, claimed_at = null, claim_multiplier = 1,
         activated_at = coalesce(activated_at, now())
   where id = c.id;
  perform public._fill_board();
  perform public._sweep_eliminations();
  return note;
end;
$$;

-- ---------------------------------------------------------------------------
-- Using cards
-- ---------------------------------------------------------------------------

-- Same as migration 0017, plus the six new effects. New arguments:
--   p_curse     - curse xN / curse copy: one of your active curses
--   p_challenge - replace / lock challenge: a challenge on the board
--   p_cards     - discard X draw Y: the X cards to discard
drop function public.use_card(uuid, uuid, uuid, boolean);
create function public.use_card(
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
    raise exception 'Keep Veto in your hand. When you are cursed or a card is stolen from you, a Veto button appears';
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
-- Undo
-- ---------------------------------------------------------------------------

-- Same as migration 0015, plus undoing the six new effects, and a curse's
-- attacker shifting back by attacker_gain.
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

-- ---------------------------------------------------------------------------
-- Reset game
-- ---------------------------------------------------------------------------

-- Same as migration 0015, plus clearing reward multipliers (locks clear
-- themselves when challenges go back to the pool).
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
     set status = 'pool', activated_at = null, claimed_by = null, claimed_at = null, claim_multiplier = 1
   where status in ('active', 'claimed');

  update public.teams
     set status = 'active', speed = 1, eliminated_at = null, hand_bonus = 0, reward_multiplier = 1
   where true;
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

revoke execute on function public._record_undo(uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, int,
                                               uuid[], int, uuid, int)
  from public, anon, authenticated;
revoke execute on function public._challenge_unlock() from public, anon, authenticated;
revoke execute on function public.use_card(uuid, uuid, uuid, boolean, uuid, uuid, uuid[]) from public, anon;
grant  execute on function public.use_card(uuid, uuid, uuid, boolean, uuid, uuid, uuid[]) to authenticated;
