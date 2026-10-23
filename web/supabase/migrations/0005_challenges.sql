-- Stage 3: shared challenge board.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Challenge lifecycle:  pool -> active (on the board) -> claimed
--                       pool/active -> retired (removed by admin) -> pool (restored)
-- The board is kept at game_state.board_size active challenges, refilled at
-- random from the pool. Teams only ever see active and claimed challenges.

alter table public.game_state
  add column board_size int not null default 10 check (board_size between 1 and 50);

create table public.challenges (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(btrim(title)) between 1 and 100),
  task           text not null default '',
  reward_cards   int not null default 1 check (reward_cards between 0 and 10),
  reward_minutes int not null default 0 check (reward_minutes between 0 and 600),
  status         text not null default 'pool' check (status in ('pool', 'active', 'claimed', 'retired')),
  activated_at   timestamptz,
  claimed_by     uuid references public.teams (id) on delete set null,
  claimed_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index challenges_status_idx on public.challenges (status);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Top the board up (or trim it) to board_size. An advisory lock makes
-- concurrent claims refill one at a time, so the board never overfills.
create or replace function public._fill_board()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted int;
  active_count int;
begin
  perform pg_advisory_xact_lock(hashtext('fill_board'));

  select board_size into wanted from public.game_state where id = 1;
  select count(*) into active_count from public.challenges where status = 'active';

  if active_count < wanted then
    update public.challenges
       set status = 'active', activated_at = now()
     where id in (
       select id from public.challenges
        where status = 'pool'
        order by random()
        limit wanted - active_count
          for update skip locked
     );
  elsif active_count > wanted then
    -- Board was made smaller: return the most recently added ones to the pool.
    update public.challenges
       set status = 'pool', activated_at = null
     where id in (
       select id from public.challenges
        where status = 'active'
        order by activated_at desc
        limit active_count - wanted
          for update skip locked
     );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Team action
-- ---------------------------------------------------------------------------

-- First valid claim wins. The row lock on the challenge means two teams
-- claiming at the same moment are handled one after the other, and the
-- second sees that it is already claimed.
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

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'challenge_claimed',
          jsonb_build_object('name', t.name, 'challenge', c.title,
                             'minutes', c.reward_minutes, 'cards', c.reward_cards));

  perform public._fill_board();
  perform public._sweep_eliminations();

  return jsonb_build_object('title', c.title, 'minutes', c.reward_minutes, 'cards', c.reward_cards);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

-- p_rows: [{"title": "...", "task": "...", "reward_cards": 2, "reward_minutes": 15}, ...]
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

  insert into public.challenges (title, task, reward_cards, reward_minutes)
  select btrim(r->>'title'), coalesce(btrim(r->>'task'), ''),
         (r->>'reward_cards')::int, (r->>'reward_minutes')::int
    from jsonb_array_elements(p_rows) as r;
  get diagnostics n = row_count;

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'challenges_imported', jsonb_build_object('count', n));

  perform public._fill_board();
  return n;
end;
$$;

create or replace function public.admin_update_challenge(
  p_challenge uuid, p_title text, p_task text, p_reward_cards int, p_reward_minutes int
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
     set title = btrim(p_title), task = btrim(p_task),
         reward_cards = p_reward_cards, reward_minutes = p_reward_minutes
   where id = p_challenge;
  if not found then
    raise exception 'Challenge not found';
  end if;
end;
$$;

-- Retire (take off the board / out of the pool) or restore (back into the pool).
create or replace function public.admin_set_challenge_status(p_challenge uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.challenges;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  if new_status not in ('retired', 'pool') then
    raise exception 'A challenge can only be retired or restored to the pool';
  end if;

  select * into c from public.challenges where id = p_challenge for update;
  if not found then
    raise exception 'Challenge not found';
  end if;
  if c.status = 'claimed' then
    raise exception 'Claimed challenges cannot be changed';
  end if;

  update public.challenges set status = new_status, activated_at = null where id = c.id;
  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), case when new_status = 'retired' then 'challenge_retired' else 'challenge_restored' end,
          jsonb_build_object('challenge', c.title));

  perform public._fill_board();
end;
$$;

create or replace function public.admin_set_board_size(new_size int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can do this' using errcode = '42501';
  end if;
  if new_size not between 1 and 50 then
    raise exception 'Board size must be between 1 and 50';
  end if;

  update public.game_state set board_size = new_size, updated_at = now() where id = 1;
  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), 'board_size_changed', jsonb_build_object('size', new_size));

  perform public._fill_board();
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

alter table public.challenges enable row level security;

-- Teams see the board and claimed challenges, never the hidden pool.
create policy "board is visible to players; everything to admins" on public.challenges
  for select to authenticated using (status in ('active', 'claimed') or public.is_admin());

revoke insert, update, delete, truncate on public.challenges from anon, authenticated;

revoke execute on function public._fill_board() from public, anon, authenticated;

revoke execute on function public.claim_challenge(uuid)                              from public, anon;
revoke execute on function public.admin_import_challenges(jsonb)                     from public, anon;
revoke execute on function public.admin_update_challenge(uuid, text, text, int, int) from public, anon;
revoke execute on function public.admin_set_challenge_status(uuid, text)             from public, anon;
revoke execute on function public.admin_set_board_size(int)                          from public, anon;
grant  execute on function public.claim_challenge(uuid)                              to authenticated;
grant  execute on function public.admin_import_challenges(jsonb)                     to authenticated;
grant  execute on function public.admin_update_challenge(uuid, text, text, int, int) to authenticated;
grant  execute on function public.admin_set_challenge_status(uuid, text)             to authenticated;
grant  execute on function public.admin_set_board_size(int)                          to authenticated;

alter publication supabase_realtime add table public.challenges;
