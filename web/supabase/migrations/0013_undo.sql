-- Undo.
-- Teams: for 60 seconds after claiming a challenge, using a card, discarding a
-- card or clearing a curse, the team can undo it (team_undos + undo_action).
-- Admin:
--   admin_undo_claim    - challenge back on the board, time bonus reversed,
--                         its draw cancelled if not yet drawn
--   admin_cancel_draw   - remove a waiting (or showing) draw
--   admin_restart_curse - make a cleared curse active again
--   (giving a card from the deck uses the existing admin_move_card)
-- Run AFTER 0012. Run once in the Supabase dashboard: SQL Editor -> New query
-- -> paste -> Run.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Which challenge a draw came from, so undoing the claim can cancel it.
alter table public.card_draws
  add column challenge_id uuid references public.challenges (id) on delete set null;

-- Team actions that can still be undone (for a short window).
create table public.team_undos (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  kind         text not null check (kind in ('claim', 'use', 'discard', 'clear_curse')),
  label        text not null,
  challenge_id uuid references public.challenges (id) on delete cascade,
  card_id      uuid references public.cards (id) on delete cascade,
  curse_id     uuid references public.curses (id) on delete set null,
  copy_id      uuid references public.cards (id) on delete set null, -- copy made by a duplicate effect
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  undone_at    timestamptz
);
create index team_undos_team_idx on public.team_undos (team_id, expires_at);

alter table public.team_undos enable row level security;
create policy "own undos or admin" on public.team_undos
  for select to authenticated using (team_id = public.my_team_id() or public.is_admin());
revoke insert, update, delete, truncate on public.team_undos from anon, authenticated;

create trigger sync_team_undos after insert or update or delete on public.team_undos
  for each statement execute function public._broadcast_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public._record_undo(
  p_team uuid, p_kind text, p_label text,
  p_challenge uuid default null, p_card uuid default null,
  p_curse uuid default null, p_copy uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.team_undos (team_id, kind, label, challenge_id, card_id, curse_id, copy_id, expires_at)
  values (p_team, p_kind, p_label, p_challenge, p_card, p_curse, p_copy, now() + interval '60 seconds');
$$;

-- Remove a draw that hasn't been kept from yet; cards on show go back to the deck.
create or replace function public._cancel_draw(p_draw uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  other record;
begin
  for other in
    select id from public.cards where draw_id = p_draw and status = 'offered' for update
  loop
    perform public._card_to_deck(other.id);
  end loop;
  delete from public.card_draws where id = p_draw;
end;
$$;

-- Put a claimed challenge back on the board, reverse its time bonus and cancel
-- its draw. A team may only do this before it has drawn from the claim; the
-- admin may always, and is told if a kept card needs moving back by hand.
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
  note text := '';
begin
  select * into c from public.challenges where id = p_challenge for update;
  if not found or c.status <> 'claimed' then
    raise exception 'That challenge is not claimed';
  end if;

  -- Its draw (older draws have no challenge_id, so fall back to the title).
  select * into d from public.card_draws
   where challenge_id = c.id
      or (challenge_id is null and team_id = c.claimed_by and source = c.title)
   order by (challenge_id is not null) desc, created_at desc
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

  -- Keeps its original activated_at, so if the board is now over size the
  -- replacement that was added after the claim goes back to the pool.
  update public.challenges
     set status = 'active', claimed_by = null, claimed_at = null,
         activated_at = coalesce(activated_at, now())
   where id = c.id;
  perform public._fill_board();
  perform public._sweep_eliminations();
  return note;
end;
$$;

-- Make a cleared curse active again and shift speeds as if it was just played.
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
  if exists (select 1 from public.curses where target_team = k.target_team and status = 'active') then
    raise exception 'That team already has another curse on it';
  end if;

  update public.curses set status = 'active', cleared_at = null, cleared_by = null where id = k.id;
  perform public._shift_speed(k.target_team, 1, p_reason || ': ' || k.card_name);
  perform public._shift_speed(k.attacker_team, -1, p_reason || ': ' || k.card_name);
  perform public._sweep_eliminations();
end;
$$;

-- Put a used or discarded card back in a team's hand, if nobody has drawn it since.
create or replace function public._card_back_to_hand(p_card uuid, p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cards;
begin
  select * into c from public.cards where id = p_card for update;
  -- Used or discarded copies go to the deck; duplicate copies are removed.
  if not found
     or (c.is_duplicate and c.status <> 'removed')
     or (not c.is_duplicate and c.status <> 'deck') then
    raise exception 'That card has already been drawn by another team, so this can''t be undone. Ask the admin';
  end if;
  update public.cards set status = 'hand', holder_team = p_team, draw_id = null, updated_at = now()
   where id = c.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Team actions, now recording an undo
-- ---------------------------------------------------------------------------

-- Same as migration 0006, plus the draw's challenge_id and an undo record.
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
begin
  select * into g from public.game_state where id = 1 for share;
  if g.is_paused then
    raise exception 'The game is paused, so challenges cannot be claimed right now';
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

  if c.reward_cards > 0 then
    insert into public.card_draws (team_id, size, source, challenge_id)
    values (t.id, c.reward_cards, c.title, c.id);
  end if;

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'challenge_claimed',
          jsonb_build_object('name', t.name, 'challenge', c.title,
                             'minutes', c.reward_minutes, 'cards', c.reward_cards));
  perform public._record_undo(t.id, 'claim', 'Claimed "' || c.title || '"', p_challenge => c.id);

  perform public._fill_board();
  perform public._sweep_eliminations();

  return jsonb_build_object('title', c.title, 'minutes', c.reward_minutes, 'cards', c.reward_cards);
end;
$$;

-- Same as migration 0006, plus an undo record.
create or replace function public.discard_card(p_card uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  c public.cards;
begin
  t := public._acting_team(true);

  select * into c from public.cards where id = p_card for update;
  if not found or c.status <> 'hand' or c.holder_team <> t.id then
    raise exception 'That card is not in your hand';
  end if;

  perform public._card_to_deck(c.id);
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'card_discarded', jsonb_build_object('name', t.name, 'card', public._card_name(c.id)));
  perform public._record_undo(t.id, 'discard', 'Discarded ' || public._card_name(c.id), p_card => c.id);
end;
$$;

-- Same as migration 0012, plus an undo record.
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
  new_curse uuid;
  new_copy uuid;
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
    values (t.id, victim.id, ct.name, ct.range_text, ct.clearance)
    returning id into new_curse;
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
    values (target.type_id, 'hand', t.id, true)
    returning id into new_copy;
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
  perform public._record_undo(t.id, 'use',
                              'Played ' || ct.name || coalesce(' on ' || victim.name, ''),
                              p_card => c.id, p_curse => new_curse, p_copy => new_copy);

  perform public._sweep_eliminations();
  return message;
end;
$$;

-- Same as migration 0011, plus an undo record.
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
  perform public._record_undo(t.id, 'clear_curse', 'Cleared the curse ' || k.card_name, p_curse => k.id);

  perform public._end_curse_speeds(k);
  return 'Curse cleared. Your countdown is 1× slower again.';
end;
$$;

-- A team undoes one of its own recent actions.
create or replace function public.undo_action(p_undo uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  u public.team_undos;
  k public.curses;
  cp public.cards;
  message text;
begin
  t := public._acting_team(true);

  select * into u from public.team_undos where id = p_undo for update;
  if not found or u.team_id <> t.id then
    raise exception 'Nothing to undo';
  end if;
  if u.undone_at is not null then
    raise exception 'That has already been undone';
  end if;
  if u.expires_at < now() then
    raise exception 'Too late to undo (you have 60 seconds). Ask the admin';
  end if;

  if u.kind = 'claim' then
    if not exists (select 1 from public.challenges
                    where id = u.challenge_id and status = 'claimed' and claimed_by = t.id) then
      raise exception 'That claim has already been undone';
    end if;
    perform public._undo_claim(u.challenge_id, true);
    message := 'Claim undone. The challenge is back on the board.';

  elsif u.kind = 'discard' then
    perform public._card_back_to_hand(u.card_id, t.id);
    message := 'The card is back in your hand.';

  elsif u.kind = 'use' then
    if u.copy_id is not null then
      select * into cp from public.cards where id = u.copy_id for update;
      if found and (cp.status <> 'hand' or cp.holder_team <> t.id) then
        raise exception 'The copy has already been used, so this can''t be undone. Ask the admin';
      end if;
      if found then
        update public.cards set status = 'removed', holder_team = null, updated_at = now() where id = cp.id;
      end if;
    end if;
    perform public._card_back_to_hand(u.card_id, t.id);
    if u.curse_id is not null then
      select * into k from public.curses where id = u.curse_id for update;
      if found and k.status = 'active' then
        delete from public.curses where id = k.id;
        perform public._shift_speed(k.target_team, -1, 'Curse undone: ' || k.card_name);
        perform public._shift_speed(k.attacker_team, 1, 'Curse undone: ' || k.card_name);
      end if;
    end if;
    message := 'Undone. The card is back in your hand.';

  elsif u.kind = 'clear_curse' then
    perform public._restart_curse(u.curse_id, 'Curse clear undone');
    message := 'Undone. The curse is back on.';
  end if;

  update public.team_undos set undone_at = now() where id = u.id;
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'action_undone', jsonb_build_object('name', t.name, 'action', u.label));
  perform public._sweep_eliminations();
  return message;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

create or replace function public.admin_undo_claim(p_challenge uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.challenges;
  team_name text;
  note text;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  perform 1 from public.game_state where id = 1 for share;

  select * into c from public.challenges where id = p_challenge;
  select name into team_name from public.teams where id = c.claimed_by;
  note := public._undo_claim(p_challenge, false);

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), c.claimed_by, 'claim_undone',
          jsonb_build_object('challenge', c.title, 'name', team_name, 'by', 'admin'));
  return 'Claim undone: "' || c.title || '" is back on the board.' || note;
end;
$$;

create or replace function public.admin_cancel_draw(p_draw uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.card_draws;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;

  select * into d from public.card_draws where id = p_draw for update;
  if not found or d.status = 'done' then
    raise exception 'That draw has already been used';
  end if;
  perform public._cancel_draw(d.id);
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), d.team_id, 'draw_cancelled', jsonb_build_object('source', d.source, 'size', d.size));
end;
$$;

create or replace function public.admin_restart_curse(p_curse uuid)
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

  perform public._restart_curse(p_curse, 'Curse restarted by admin');
  select * into k from public.curses where id = p_curse;
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), k.target_team, 'curse_restarted', jsonb_build_object('card', k.card_name, 'by', 'admin'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function public._record_undo(uuid, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._cancel_draw(uuid)                from public, anon, authenticated;
revoke execute on function public._undo_claim(uuid, boolean)        from public, anon, authenticated;
revoke execute on function public._restart_curse(uuid, text)        from public, anon, authenticated;
revoke execute on function public._card_back_to_hand(uuid, uuid)    from public, anon, authenticated;
revoke execute on function public.undo_action(uuid)                 from public, anon;
revoke execute on function public.admin_undo_claim(uuid)            from public, anon;
revoke execute on function public.admin_cancel_draw(uuid)           from public, anon;
revoke execute on function public.admin_restart_curse(uuid)         from public, anon;
grant  execute on function public.undo_action(uuid)                 to authenticated;
grant  execute on function public.admin_undo_claim(uuid)            to authenticated;
grant  execute on function public.admin_cancel_draw(uuid)           to authenticated;
grant  execute on function public.admin_restart_curse(uuid)         to authenticated;
