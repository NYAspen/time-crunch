-- Stage 5: curses (played from a card, cleared by the victim), game reset,
-- and "delete all" for challenges and cards.
-- (Bulk statements say "where true" because Supabase blocks UPDATE/DELETE without a WHERE.)
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Curse time effects stay manual (D13): the app shows each team one-tap
-- buttons to set its own countdown speed; it never changes speeds by itself.

-- ---------------------------------------------------------------------------
-- Curses
-- ---------------------------------------------------------------------------

create table public.curses (
  id            uuid primary key default gen_random_uuid(),
  attacker_team uuid not null references public.teams (id) on delete cascade,
  target_team   uuid not null references public.teams (id) on delete cascade,
  -- Copied from the card, so the curse still reads correctly if the card text changes.
  card_name     text not null,
  range_text    text not null default '',
  clearance     text not null default '',
  status        text not null default 'active' check (status in ('active', 'cleared')),
  started_at    timestamptz not null default now(),
  cleared_at    timestamptz,
  cleared_by    text check (cleared_by in ('target', 'admin'))
);
-- D10: a team can have at most one active curse on it.
create unique index curses_one_active_per_target on public.curses (target_team) where status = 'active';

-- use_card gains a target team and a range confirmation (for curses).
drop function public.use_card(uuid, uuid);

create function public.use_card(
  p_card uuid,
  p_target uuid default null,        -- duplicate: the card in your hand to copy
  p_target_team uuid default null,   -- curse: the team to curse
  p_in_range boolean default false   -- curse: attacker confirms they are within range
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
    message := 'You cursed ' || victim.name || '. Set your countdown to 0× until they clear it.';

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
  return message;
end;
$$;

-- The cursed team records that it completed the clearance task.
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
  return 'Curse cleared. Set your countdown back to 1×.';
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
  select * into k from public.curses where id = p_curse for update;
  if not found or k.status <> 'active' then
    raise exception 'That curse is not active';
  end if;
  update public.curses set status = 'cleared', cleared_at = now(), cleared_by = 'admin' where id = k.id;
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), k.target_team, 'curse_cleared', jsonb_build_object('card', k.card_name, 'by', 'admin'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Delete all content
-- ---------------------------------------------------------------------------

create or replace function public.admin_delete_all_challenges()
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
  delete from public.challenges where true;
  get diagnostics n = row_count;
  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'all_challenges_deleted', jsonb_build_object('count', n));
  return n;
end;
$$;

create or replace function public.admin_delete_all_cards()
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
  select count(*) into n from public.cards where status <> 'removed';
  delete from public.card_types where true;  -- also deletes every copy
  -- Draws that were showing cards go back to waiting.
  update public.card_draws set status = 'pending' where status = 'open';
  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'all_cards_deleted', jsonb_build_object('count', n));
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reset game: keep teams (unless deleted separately) and content; clear play.
-- ---------------------------------------------------------------------------

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

  delete from public.curses where true;
  delete from public.card_draws where true;
  delete from public.time_ledger where true;
  delete from public.activity_log where true;

  delete from public.cards where is_duplicate;
  update public.cards set status = 'deck', holder_team = null, draw_id = null, updated_at = now() where true;

  update public.challenges
     set status = 'pool', activated_at = null, claimed_by = null, claimed_at = null
   where status in ('active', 'claimed');

  update public.teams set status = 'active', speed = 1, eliminated_at = null where true;
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

alter table public.curses enable row level security;

-- Each team sees the curses it played or that are on it; admins see all.
create policy "own curses or admin" on public.curses
  for select to authenticated
  using (attacker_team = public.my_team_id() or target_team = public.my_team_id() or public.is_admin());

revoke insert, update, delete, truncate on public.curses from anon, authenticated;

revoke execute on function public.use_card(uuid, uuid, uuid, boolean) from public, anon;
revoke execute on function public.clear_curse(uuid)                    from public, anon;
revoke execute on function public.admin_clear_curse(uuid)              from public, anon;
revoke execute on function public.admin_delete_all_challenges()        from public, anon;
revoke execute on function public.admin_delete_all_cards()             from public, anon;
revoke execute on function public.admin_reset_game()                   from public, anon;
grant  execute on function public.use_card(uuid, uuid, uuid, boolean) to authenticated;
grant  execute on function public.clear_curse(uuid)                    to authenticated;
grant  execute on function public.admin_clear_curse(uuid)              to authenticated;
grant  execute on function public.admin_delete_all_challenges()        to authenticated;
grant  execute on function public.admin_delete_all_cards()             to authenticated;
grant  execute on function public.admin_reset_game()                   to authenticated;

alter publication supabase_realtime add table public.curses;
