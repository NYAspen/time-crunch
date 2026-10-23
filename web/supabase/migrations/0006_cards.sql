-- Stage 4: shared card deck, card draws ("draw N, keep 1") and private hands.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- card_types  = what a card says (name, type, text, range, clearance, effect).
-- cards       = individual physical copies. Each copy is in exactly one place:
--                 deck    - in the shared deck (drawn at random = shuffled)
--                 offered - shown to a team during a draw, not yet chosen
--                 hand    - in a team's private hand
--                 removed - a used/discarded duplicate (duplicates never enter the deck)
-- card_draws  = draws a team is owed: pending -> open (cards shown) -> done.
--
-- Lock order: game_state, then team row, then draw row, then card rows.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.card_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  -- Add new types later by changing this check.
  type        text not null check (type in ('curse', 'powerup')),
  description text not null default '',
  range_text  text not null default '',   -- e.g. "500 m" (shown on curses)
  clearance   text not null default '',   -- how a victim clears a curse
  -- null = manual (players apply it themselves). Add new automatic effects here.
  effect      text check (effect in ('duplicate')),
  created_at  timestamptz not null default now()
);

create table public.card_draws (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  size        int not null check (size between 1 and 10),
  source      text not null default '',   -- e.g. challenge title
  status      text not null default 'pending' check (status in ('pending', 'open', 'done')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index card_draws_team_idx on public.card_draws (team_id, status);
-- A team can only look at one draw at a time.
create unique index card_draws_one_open on public.card_draws (team_id) where status = 'open';

create table public.cards (
  id           uuid primary key default gen_random_uuid(),
  type_id      uuid not null references public.card_types (id) on delete cascade,
  status       text not null default 'deck' check (status in ('deck', 'offered', 'hand', 'removed')),
  holder_team  uuid references public.teams (id) on delete set null,
  draw_id      uuid references public.card_draws (id) on delete set null,
  is_duplicate boolean not null default false,
  updated_at   timestamptz not null default now(),
  check ((status in ('offered', 'hand')) = (holder_team is not null))
);
create index cards_status_idx on public.cards (status);
create index cards_holder_idx on public.cards (holder_team);

-- When a team is deleted, its cards go back to the deck.
create or replace function public._return_cards_of_deleted_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cards
     set status = case when is_duplicate then 'removed' else 'deck' end,
         holder_team = null, draw_id = null, updated_at = now()
   where holder_team = old.id;
  return old;
end;
$$;

create trigger teams_return_cards
  before delete on public.teams
  for each row execute function public._return_cards_of_deleted_team();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Put a card back into the deck (or remove it if it's a duplicate).
create or replace function public._card_to_deck(p_card uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.cards
     set status = case when is_duplicate then 'removed' else 'deck' end,
         holder_team = null, draw_id = null, updated_at = now()
   where id = p_card;
$$;

create or replace function public._card_name(p_card uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ct.name from public.cards c join public.card_types ct on ct.id = c.type_id where c.id = p_card;
$$;

-- The calling team, locked, after checking it may act.
create or replace function public._acting_team(allow_when_paused boolean)
returns public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.game_state;
  t public.teams;
begin
  select * into g from public.game_state where id = 1 for share;
  if g.is_paused and not allow_when_paused then
    raise exception 'The game is paused';
  end if;

  select * into t from public.teams where user_id = auth.uid() for update;
  if not found then
    raise exception 'Only a logged-in team can do this' using errcode = '42501';
  end if;
  if t.status <> 'active' then
    raise exception 'Your team has been eliminated';
  end if;
  return t;
end;
$$;

-- ---------------------------------------------------------------------------
-- Challenge claims now also give the team a card draw.
-- (Same as migration 0005, plus the card_draws insert.)
-- ---------------------------------------------------------------------------

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
    insert into public.card_draws (team_id, size, source) values (t.id, c.reward_cards, c.title);
  end if;

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'challenge_claimed',
          jsonb_build_object('name', t.name, 'challenge', c.title,
                             'minutes', c.reward_minutes, 'cards', c.reward_cards));

  perform public._fill_board();
  perform public._sweep_eliminations();

  return jsonb_build_object('title', c.title, 'minutes', c.reward_minutes, 'cards', c.reward_cards);
end;
$$;

-- Challenges claimed before cards existed still owe their draws.
insert into public.card_draws (team_id, size, source, created_at)
select claimed_by, reward_cards, title, claimed_at
  from public.challenges
 where status = 'claimed' and reward_cards > 0 and claimed_by is not null;

-- ---------------------------------------------------------------------------
-- Team actions
-- ---------------------------------------------------------------------------

-- Reveal the team's oldest waiting draw: take up to N random cards from the
-- deck. "skip locked" means two teams drawing at the same moment never get
-- the same copy.
create or replace function public.open_draw()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  d public.card_draws;
  n int;
begin
  t := public._acting_team(true);

  if exists (select 1 from public.card_draws where team_id = t.id and status = 'open') then
    return; -- already showing cards; pick one first
  end if;

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

  update public.card_draws set status = 'open' where id = d.id;
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'cards_drawn',
          jsonb_build_object('name', t.name, 'count', n, 'wanted', d.size, 'source', d.source));
end;
$$;

-- Keep one of the offered cards; the rest go back into the deck.
create or replace function public.choose_card(p_card uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  c public.cards;
  other record;
begin
  t := public._acting_team(true);

  select * into c from public.cards where id = p_card for update;
  if not found or c.status <> 'offered' or c.holder_team <> t.id then
    raise exception 'That card is not one of your current choices';
  end if;

  perform 1 from public.card_draws where id = c.draw_id for update;

  for other in
    select id from public.cards where draw_id = c.draw_id and id <> c.id for update
  loop
    perform public._card_to_deck(other.id);
  end loop;

  update public.cards set status = 'hand', draw_id = null, updated_at = now() where id = c.id;
  update public.card_draws set status = 'done', resolved_at = now() where id = c.draw_id;

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'card_kept', jsonb_build_object('name', t.name, 'card', public._card_name(c.id)));
  return public._card_name(c.id);
end;
$$;

-- Use a card from your hand. Most effects are carried out by the players
-- (manual for now); the card returns to the deck. "duplicate" effects are
-- automatic: p_target is another card in your hand to copy.
create or replace function public.use_card(p_card uuid, p_target uuid default null)
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
  message text;
begin
  t := public._acting_team(false);

  select * into c from public.cards where id = p_card for update;
  if not found or c.status <> 'hand' or c.holder_team <> t.id then
    raise exception 'That card is not in your hand';
  end if;
  select * into ct from public.card_types where id = c.type_id;

  if ct.effect = 'duplicate' then
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
  values (auth.uid(), t.id, 'card_used',
          jsonb_build_object('name', t.name, 'card', ct.name, 'type', ct.type,
                             'target_card', case when target.id is null then null else public._card_name(target.id) end));
  return message;
end;
$$;

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
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

-- p_rows: [{"name","type","copies","description","range_text","clearance","effect"}, ...]
create or replace function public.admin_import_cards(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  new_type uuid;
  total int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.card_types (name, type, description, range_text, clearance, effect)
    values (btrim(r->>'name'), r->>'type', coalesce(r->>'description', ''), coalesce(r->>'range_text', ''),
            coalesce(r->>'clearance', ''), nullif(r->>'effect', ''))
    returning id into new_type;

    insert into public.cards (type_id) select new_type from generate_series(1, (r->>'copies')::int);
    total := total + (r->>'copies')::int;
  end loop;

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'cards_imported', jsonb_build_object('types', jsonb_array_length(p_rows), 'copies', total));
  return total;
end;
$$;

create or replace function public.admin_update_card_type(
  p_type uuid, p_name text, p_description text, p_range text, p_clearance text
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
  update public.card_types
     set name = btrim(p_name), description = btrim(p_description),
         range_text = btrim(p_range), clearance = btrim(p_clearance)
   where id = p_type;
  if not found then
    raise exception 'Card type not found';
  end if;
end;
$$;

-- Add copies to the deck (positive) or remove copies that are in the deck (negative).
create or replace function public.admin_change_copies(p_type uuid, p_change int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed int;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;

  if p_change > 0 then
    insert into public.cards (type_id) select p_type from generate_series(1, p_change);
  elsif p_change < 0 then
    delete from public.cards
     where id in (select id from public.cards where type_id = p_type and status = 'deck'
                   limit -p_change for update skip locked);
    get diagnostics removed = row_count;
    if removed < -p_change then
      raise exception 'Only % cop(ies) were in the deck to remove; the rest are in play', removed;
    end if;
  end if;

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'card_copies_changed', jsonb_build_object('type', p_type, 'change', p_change));
end;
$$;

-- Move a card: to a team's hand (p_team set) or back to the deck (p_team null).
-- Used for stealing and fixing mistakes.
create or replace function public.admin_move_card(p_card uuid, p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cards;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;

  select * into c from public.cards where id = p_card for update;
  if not found or c.status = 'removed' then
    raise exception 'Card not found';
  end if;
  if c.status = 'offered' then
    raise exception 'That card is being chosen in a draw right now; try again in a moment';
  end if;

  if p_team is null then
    perform public._card_to_deck(c.id);
  else
    update public.cards
       set status = 'hand', holder_team = p_team, draw_id = null, updated_at = now()
     where id = c.id;
  end if;

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), p_team, 'card_moved_by_admin',
          jsonb_build_object('card', public._card_name(c.id), 'from_team', c.holder_team, 'to_team', p_team));
end;
$$;

create or replace function public.admin_grant_draw(p_team uuid, p_size int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  insert into public.card_draws (team_id, size, source) values (p_team, p_size, 'Given by admin');
  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), p_team, 'draw_granted', jsonb_build_object('size', p_size));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

alter table public.card_types enable row level security;
alter table public.cards      enable row level security;
alter table public.card_draws enable row level security;

-- Card texts are not secret; which team holds which copy is.
create policy "card texts are visible to players" on public.card_types
  for select to authenticated using (true);

create policy "own cards or admin" on public.cards
  for select to authenticated using (holder_team = public.my_team_id() or public.is_admin());

create policy "own draws or admin" on public.card_draws
  for select to authenticated using (team_id = public.my_team_id() or public.is_admin());

revoke insert, update, delete, truncate on public.card_types, public.cards, public.card_draws from anon, authenticated;

revoke execute on function public._return_cards_of_deleted_team() from public, anon, authenticated;
revoke execute on function public._card_to_deck(uuid)              from public, anon, authenticated;
revoke execute on function public._card_name(uuid)                 from public, anon, authenticated;
revoke execute on function public._acting_team(boolean)            from public, anon, authenticated;

revoke execute on function public.open_draw()                                        from public, anon;
revoke execute on function public.choose_card(uuid)                                  from public, anon;
revoke execute on function public.use_card(uuid, uuid)                               from public, anon;
revoke execute on function public.discard_card(uuid)                                 from public, anon;
revoke execute on function public.admin_import_cards(jsonb)                          from public, anon;
revoke execute on function public.admin_update_card_type(uuid, text, text, text, text) from public, anon;
revoke execute on function public.admin_change_copies(uuid, int)                     from public, anon;
revoke execute on function public.admin_move_card(uuid, uuid)                        from public, anon;
revoke execute on function public.admin_grant_draw(uuid, int)                        from public, anon;
grant  execute on function public.open_draw()                                        to authenticated;
grant  execute on function public.choose_card(uuid)                                  to authenticated;
grant  execute on function public.use_card(uuid, uuid)                               to authenticated;
grant  execute on function public.discard_card(uuid)                                 to authenticated;
grant  execute on function public.admin_import_cards(jsonb)                          to authenticated;
grant  execute on function public.admin_update_card_type(uuid, text, text, text, text) to authenticated;
grant  execute on function public.admin_change_copies(uuid, int)                     to authenticated;
grant  execute on function public.admin_move_card(uuid, uuid)                        to authenticated;
grant  execute on function public.admin_grant_draw(uuid, int)                        to authenticated;

alter publication supabase_realtime add table public.card_types, public.cards, public.card_draws;
