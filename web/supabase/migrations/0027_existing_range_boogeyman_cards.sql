-- Turns on the automatic effects for card types that were imported with a blank
-- effect (2026-11-07). An effect belongs to the card type, so every copy changes at
-- once, including copies already in teams' hands. Nothing else about them changes:
-- who holds them, their text, or anyone's time.
--
-- Run AFTER 0026 (it fails with a "check constraint" error otherwise, changing nothing).
-- Run this whole file once in the Supabase SQL Editor. The table it shows at the end
-- should have one row per card, each with its effect filled in.

update public.card_types
   set effect = case lower(btrim(name))
                  when 'range extension' then 'range x2'
                  when 'infinity' then 'range infinite'
                  when 'the boogeyman' then 'boogeyman'
                end
 where lower(btrim(name)) in ('range extension', 'infinity', 'the boogeyman');

select ct.name, ct.type, ct.effect,
       count(c.id) filter (where c.status = 'hand') as copies_in_hands,
       count(c.id) filter (where c.status = 'deck') as copies_in_deck
  from public.card_types ct
  left join public.cards c on c.type_id = ct.id
 where lower(btrim(ct.name)) in ('range extension', 'infinity', 'the boogeyman')
 group by ct.id, ct.name, ct.type, ct.effect
 order by ct.name;
