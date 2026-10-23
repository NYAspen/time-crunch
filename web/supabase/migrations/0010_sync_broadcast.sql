-- Faster live updates.
-- Before: every section of every page subscribed to "postgres changes" on each
-- table. Supabase checks privacy rules for every change x every subscription,
-- one at a time, so with several phones open updates arrived seconds late.
-- Now: after any change to a game table, the database broadcasts one tiny
-- message ("table X changed", no data) on the public topic "game-sync". Each
-- browser keeps ONE connection, and when a message arrives it reloads just the
-- sections showing that table (normal privacy rules still decide what it sees).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create or replace function public._broadcast_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Contains only the table name, never any row data.
  perform realtime.send(jsonb_build_object('table', tg_table_name), 'changed', 'game-sync', false);
  return null;
end;
$$;

revoke execute on function public._broadcast_change() from public, anon, authenticated;

-- One message per statement (not per row), so a big change is still one message.
create trigger sync_game_state   after insert or update or delete on public.game_state   for each statement execute function public._broadcast_change();
create trigger sync_teams        after insert or update or delete on public.teams        for each statement execute function public._broadcast_change();
create trigger sync_team_clocks  after insert or update or delete on public.team_clocks  for each statement execute function public._broadcast_change();
create trigger sync_time_ledger  after insert or update or delete on public.time_ledger  for each statement execute function public._broadcast_change();
create trigger sync_challenges   after insert or update or delete on public.challenges   for each statement execute function public._broadcast_change();
create trigger sync_card_types   after insert or update or delete on public.card_types   for each statement execute function public._broadcast_change();
create trigger sync_cards        after insert or update or delete on public.cards        for each statement execute function public._broadcast_change();
create trigger sync_card_draws   after insert or update or delete on public.card_draws   for each statement execute function public._broadcast_change();
create trigger sync_curses       after insert or update or delete on public.curses       for each statement execute function public._broadcast_change();
create trigger sync_activity_log after insert or update or delete on public.activity_log for each statement execute function public._broadcast_change();

-- Nothing subscribes to "postgres changes" any more, so stop feeding them.
alter publication supabase_realtime drop table
  public.game_state, public.teams, public.team_clocks, public.time_ledger, public.challenges,
  public.card_types, public.cards, public.card_draws, public.curses, public.activity_log;
