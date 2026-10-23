-- A draw that reveals only one card (a "draw 1" reward, or an almost empty
-- deck) now puts that card straight into the hand instead of asking the team
-- to "keep" it. open_draw now returns a message, so it is dropped and recreated.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

drop function public.open_draw();

create function public.open_draw()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  d public.card_draws;
  n int;
  only_card uuid;
begin
  t := public._acting_team(true);

  if exists (select 1 from public.card_draws where team_id = t.id and status = 'open') then
    return 'Pick one of the cards already showing first.';
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

  insert into public.activity_log (actor_user_id, team_id, event_type, details)
  values (auth.uid(), t.id, 'cards_drawn',
          jsonb_build_object('name', t.name, 'count', n, 'wanted', d.size, 'source', d.source));

  if n = 1 then
    -- Nothing to choose between: keep it automatically.
    select id into only_card from public.cards where draw_id = d.id;
    update public.cards set status = 'hand', draw_id = null, updated_at = now() where id = only_card;
    update public.card_draws set status = 'done', resolved_at = now() where id = d.id;
    insert into public.activity_log (actor_user_id, team_id, event_type, details)
    values (auth.uid(), t.id, 'card_kept', jsonb_build_object('name', t.name, 'card', public._card_name(only_card)));
    return public._card_name(only_card) || ' added to your hand.';
  end if;

  update public.card_draws set status = 'open' where id = d.id;
  return 'Pick one card to keep.';
end;
$$;

revoke execute on function public.open_draw() from public, anon;
grant  execute on function public.open_draw() to authenticated;
