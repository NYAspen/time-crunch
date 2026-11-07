-- The database checks for teams out of time once a minute (2026-11-04), so a team
-- is eliminated even if every phone is locked. Until then, a curse on that team
-- would keep giving its attacker time. Phones still check sooner when one is open.
-- It does nothing outside Elimination.
--
-- Kept in its own file because it needs the pg_cron extension: if this file
-- fails, 0024 is unaffected.
--
-- Run AFTER 0024. Run this whole file once in the Supabase SQL Editor.
-- To see that it is running: select * from cron.job_run_details order by start_time desc limit 5;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

select cron.schedule('sweep-eliminations', '* * * * *', 'select public.sweep_eliminations()');
