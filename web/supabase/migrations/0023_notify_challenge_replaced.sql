-- Teams get a pop-down when the admin replaces or removes a challenge on the
-- board (2026-11-04). Only during Preparation: the board is hidden in Elimination.
-- Challenges in the hidden pool are never mentioned, so teams can't see them
-- early. Log entries that teams should hear about carry "tell_teams".
--
-- Run AFTER 0022. Run this whole file once in the Supabase SQL Editor.

-- Same as migration 0005, plus saying what replaced the challenge and whether to
-- tell teams. The board is filled first, so the replacement is known.
create or replace function public.admin_set_challenge_status(p_challenge uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.challenges;
  phase text;
  replacement text;
  news jsonb := '{}'::jsonb;
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
  perform public._fill_board();

  select g.phase into phase from public.game_state g where g.id = 1;
  if c.status = 'active' and new_status = 'retired' and phase = 'preparation' then
    -- Everything one action does shares the same now().
    select title into replacement from public.challenges
     where status = 'active' and activated_at = now() limit 1;
    news := jsonb_strip_nulls(jsonb_build_object(
      'tell_teams', true,
      'new_challenge', replacement,
      'was_locked', case when c.locked_by is not null then true end));
  end if;

  insert into public.activity_log (actor_user_id, event_type, details)
  values (auth.uid(), case when new_status = 'retired' then 'challenge_retired' else 'challenge_restored' end,
          jsonb_build_object('challenge', c.title) || news);
end;
$$;

-- Same as migration 0021, plus those entries.
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
       or (a.event_type = 'challenge_retired' and a.details ? 'tell_teams')
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
