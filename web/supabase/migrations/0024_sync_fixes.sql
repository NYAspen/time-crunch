-- Fixes for phones playing from many places at once (2026-11-04).
--
--   * Simultaneous actions could block each other. Each action locks its own team,
--     then the elimination check locked every team, so two teams acting at the
--     same moment could wait on each other until the database cancelled one
--     ("deadlock detected"). The check now skips teams another action has locked:
--     that action runs its own check before it finishes.
--   * A team's news now reaches back 12 hours, not 30 minutes, and up to 30 entries,
--     so a phone that was offline for a long time still catches up.
--
-- Run AFTER 0023. Run this whole file once in the Supabase SQL Editor.

-- Same as migration 0016, plus "skip locked".
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
       for update of t, tc skip locked
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

-- Same as migration 0023, except for how far back it reaches.
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
   where a.created_at > now() - interval '12 hours'
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
   limit 30;
end;
$$;
