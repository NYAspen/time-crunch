-- Only two phases: preparation and elimination.
-- Lunch is handled with pause; there is no separate setup or ended phase.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.game_state drop constraint if exists game_state_phase_check;

update public.game_state
   set phase = 'preparation', phase_started_at = now(), updated_at = now()
 where phase not in ('preparation', 'elimination');

alter table public.game_state alter column phase set default 'preparation';

alter table public.game_state
  add constraint game_state_phase_check check (phase in ('preparation', 'elimination'));
