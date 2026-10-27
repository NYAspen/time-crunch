-- Undo from the activity log.
-- The admin page's Time history section is gone; the activity log is the one
-- place to see what happened and undo it (admin_undo_activity). An entry is
-- matched to what it changed by its team and timestamp: everything one action
-- writes shares the same now().
-- Undoable: challenge claims, card uses (incl. curses), discards, curse clears,
-- time adjustments, speed changes and eliminations.
-- Run AFTER 0013. Run once in the Supabase dashboard: SQL Editor -> New query
-- -> paste -> Run.

alter table public.activity_log add column undone_at timestamptz;

-- Mark the activity entries an action wrote as undone.
create or replace function public._mark_activity_undone(p_team uuid, p_at timestamptz, p_events text[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.activity_log set undone_at = now()
   where team_id = p_team and created_at = p_at and event_type = any (p_events) and undone_at is null;
$$;

-- Same as migration 0013, plus marking the claim undone in the log and in team_undos.
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

  perform public._mark_activity_undone(c.claimed_by, c.claimed_at, array['challenge_claimed']);
  update public.team_undos set undone_at = now()
   where challenge_id = c.id and kind = 'claim' and undone_at is null;

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

-- Same as migration 0013, plus marking the clear undone in the log and in team_undos.
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

  perform public._mark_activity_undone(k.target_team, k.cleared_at, array['curse_cleared']);
  update public.team_undos set undone_at = now()
   where curse_id = k.id and kind = 'clear_curse' and undone_at is null;

  update public.curses set status = 'active', cleared_at = null, cleared_by = null where id = k.id;
  perform public._shift_speed(k.target_team, 1, p_reason || ': ' || k.card_name);
  perform public._shift_speed(k.attacker_team, -1, p_reason || ': ' || k.card_name);
  perform public._sweep_eliminations();
end;
$$;

-- Carry out a recorded team action's undo (shared by the team's Undo bar and
-- the admin's activity log). Returns the team-facing message.
create or replace function public._apply_undo(u public.team_undos, p_by_team boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.curses;
  cp public.cards;
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
    perform public._card_back_to_hand(u.card_id, u.team_id);
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
  perform public._mark_activity_undone(u.team_id, u.created_at,
    array['challenge_claimed', 'card_used', 'curse_started', 'card_discarded', 'curse_cleared']);
  return message;
end;
$$;

-- Same as migration 0013, now using _apply_undo.
create or replace function public.undo_action(p_undo uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  u public.team_undos;
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

  message := public._apply_undo(u, true);
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'action_undone', jsonb_build_object('name', t.name, 'action', u.label));
  perform public._sweep_eliminations();
  return message;
end;
$$;

-- The admin undoes an activity log entry.
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

  elsif a.event_type in ('card_used', 'curse_started', 'card_discarded') then
    select * into u from public.team_undos
     where team_id = a.team_id and created_at = a.created_at and kind in ('use', 'discard')
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

revoke execute on function public._mark_activity_undone(uuid, timestamptz, text[]) from public, anon, authenticated;
revoke execute on function public._apply_undo(public.team_undos, boolean)          from public, anon, authenticated;
revoke execute on function public._undo_claim(uuid, boolean)                       from public, anon, authenticated;
revoke execute on function public._restart_curse(uuid, text)                       from public, anon, authenticated;
revoke execute on function public.admin_undo_activity(bigint)                      from public, anon;
grant  execute on function public.admin_undo_activity(bigint)                      to authenticated;
