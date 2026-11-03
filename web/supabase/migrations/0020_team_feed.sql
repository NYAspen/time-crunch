-- Pop-down notifications for teams (2026-11-03).
--
-- Teams can't read the activity log (it shows every team's cards and moves),
-- so this function hands each team only the entries meant for it:
--   * news for everyone: Elimination starting, a team eliminated / back in
--   * other teams' board changes: a challenge completed, replaced or locked
--   * moves against this team: cursed, stolen from, its curse cleared / vetoed,
--     its steal vetoed
--   * admin corrections to this team
-- The team's own actions are left out: the phone already shows their result.
-- Only the last 30 minutes, newest first. The phone remembers the newest entry
-- it has shown, so each one pops down once.
--
-- Run this whole file once in the Supabase SQL Editor.

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
                or (a.event_type in ('curse_cleared', 'curse_vetoed', 'steal_vetoed')
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

revoke execute on function public.team_feed() from public, anon;
grant  execute on function public.team_feed() to authenticated;
