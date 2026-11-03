-- Rule changes from 2026-11-03:
--   * Challenges get a location, and a card reward can keep more than one card
--     ("draw 4 pick 2": reward_cards = 4, reward_keep = 2).
--   * Challenges can only be completed during Preparation (the board is hidden
--     in Elimination).
--   * Steal cards can be played in either phase (curses stay Elimination only).
--   * When a team is eliminated, every curse it played or suffers ends, and the
--     other team's speed shifts back, so no more time is transferred.
-- Run AFTER 0015. Run once in the Supabase dashboard: SQL Editor -> New query
-- -> paste -> Run.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.challenges
  add column location    text not null default '',
  add column reward_keep int  not null default 1 check (reward_keep between 1 and 10);

alter table public.curses drop constraint curses_cleared_by_check;
alter table public.curses add constraint curses_cleared_by_check
  check (cleared_by in ('target', 'admin', 'veto', 'eliminated'));

-- ---------------------------------------------------------------------------
-- Curses end when a team involved is eliminated
-- ---------------------------------------------------------------------------

-- End every active curse the team played or suffers, shifting both teams'
-- speeds back (as clearing does). Called once the team is already eliminated.
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
    perform public._shift_speed(k.attacker_team, 1, 'Curse ended (' || team_name || ' eliminated): ' || k.card_name);
    insert into public.activity_log (actor_user_id, team_id, event_type, details)
    values (auth.uid(), p_team, 'curse_ended',
            jsonb_build_object('name', team_name, 'card', k.card_name,
                               'attacker', (select name from public.teams where id = k.attacker_team),
                               'target', (select name from public.teams where id = k.target_team)));
  end loop;
end;
$$;

-- Same as migration 0004, plus ending the eliminated teams' curses (after the
-- loop, so the speed changes don't touch rows the loop is still reading).
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
  eliminated uuid[] := '{}';
  e uuid;
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
      eliminated := eliminated || r.id;
    end if;
  end loop;

  foreach e in array eliminated loop
    perform public._end_curses_for(e);
  end loop;

  return cardinality(eliminated);
end;
$$;

-- Same as migration 0004, plus ending the team's curses when the admin
-- eliminates it. (Bringing a team back does not restart them.)
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

  if new_status = 'eliminated' then
    perform public._end_curses_for(t.id);
  else
    perform public._sweep_eliminations();
  end if;
end;
$$;

-- Tidy up now: end curses that involve teams already eliminated.
do $$
declare
  e uuid;
begin
  for e in
    select distinct x.team
      from public.curses k
      cross join lateral (values (k.attacker_team), (k.target_team)) as x (team)
      join public.teams t on t.id = x.team
     where k.status = 'active' and t.status = 'eliminated'
  loop
    perform public._end_curses_for(e);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Challenges: Preparation only, location, "draw X pick Y" rewards
-- ---------------------------------------------------------------------------

-- Same as migration 0013, except claims are blocked in Elimination and the
-- draw keeps reward_keep cards.
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

  update public.challenges
     set status = 'claimed', claimed_by = t.id, claimed_at = now()
   where id = c.id;

  if c.reward_minutes > 0 then
    perform public._apply_delta(t.id, c.reward_minutes * 60000::bigint, 'challenge', c.title,
                                jsonb_build_object('challenge_id', c.id));
  end if;

  keep := least(c.reward_keep, greatest(c.reward_cards, 1));
  if c.reward_cards > 0 then
    insert into public.card_draws (team_id, size, keep, source, challenge_id)
    values (t.id, c.reward_cards, keep, c.title, c.id);
  end if;

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'challenge_claimed',
          jsonb_build_object('name', t.name, 'challenge', c.title,
                             'minutes', c.reward_minutes, 'cards', c.reward_cards, 'keep', keep));
  perform public._record_undo(t.id, 'claim', 'Claimed "' || c.title || '"', p_challenge => c.id);

  perform public._fill_board();
  perform public._sweep_eliminations();

  return jsonb_build_object('title', c.title, 'minutes', c.reward_minutes, 'cards', c.reward_cards, 'keep', keep);
end;
$$;

-- p_rows: [{"title": "...", "task": "...", "location": "...", "reward_cards": 4,
--           "reward_keep": 2, "reward_minutes": 15}, ...]
-- location and reward_keep are optional.
create or replace function public.admin_import_challenges(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;

  insert into public.challenges (title, task, location, reward_cards, reward_keep, reward_minutes)
  select btrim(r->>'title'), coalesce(btrim(r->>'task'), ''), coalesce(btrim(r->>'location'), ''),
         (r->>'reward_cards')::int, coalesce((r->>'reward_keep')::int, 1), (r->>'reward_minutes')::int
    from jsonb_array_elements(p_rows) as r;
  get diagnostics n = row_count;

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'challenges_imported', jsonb_build_object('count', n));

  perform public._fill_board();
  return n;
end;
$$;

drop function public.admin_update_challenge(uuid, text, text, int, int);
create function public.admin_update_challenge(
  p_challenge uuid, p_title text, p_task text, p_location text,
  p_reward_cards int, p_reward_keep int, p_reward_minutes int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;

  update public.challenges
     set title = btrim(p_title), task = btrim(p_task), location = btrim(p_location),
         reward_cards = p_reward_cards, reward_keep = p_reward_keep, reward_minutes = p_reward_minutes
   where id = p_challenge;
  if not found then
    raise exception 'Challenge not found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cards: steals in either phase, range wording
-- ---------------------------------------------------------------------------

-- Same as migration 0015, except steals are allowed in Preparation too.
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
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function public._end_curses_for(uuid) from public, anon, authenticated;
revoke execute on function public.admin_update_challenge(uuid, text, text, text, int, int, int) from public, anon;
grant  execute on function public.admin_update_challenge(uuid, text, text, text, int, int, int) to authenticated;
