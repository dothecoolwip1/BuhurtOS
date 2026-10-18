-- Pack 26: the Buhurt International tournament link.
--
-- Many tournaments are announced on Buhurt International (BI) too: fighters make their BI profile there, and the BI page carries the
-- official announcement, its categories and later its results. The organizer pastes that page's address once; the event page shows it
-- to everyone next to the description, and the club sites that read BuhurtOS events can show it as well.
--
-- Additive: one nullable column on events, its check, the organizer's right to set it (the existing events_organizer_update policy
-- decides who), and the Red Deer Rumble 2026 link already in flight on hosted. No function, view or policy changes.
alter table public.events add column if not exists bi_tournament_url text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_bi_tournament_url_shape' and conrelid = 'public.events'::regclass) then
    -- Only a page on buhurtinternational.com (any subdomain), over https, up to 500 characters.
    alter table public.events add constraint events_bi_tournament_url_shape
      check (bi_tournament_url is null or (char_length(bi_tournament_url) <= 500 and bi_tournament_url ~* '^https://([a-z0-9-]+\.)*buhurtinternational\.com(/|$)'));
  end if;
end $$;
grant update (bi_tournament_url) on public.events to authenticated;
comment on column public.events.bi_tournament_url is 'The tournament''s page on buhurtinternational.com, as the organizer pasted it. Shown publicly on the event page; null when the event is not announced on BI.';

-- Backfill what is in flight: the Red Deer Rumble 2026 is announced on BI already.
update public.events set bi_tournament_url = 'https://www.buhurtinternational.com/tournament/red-deer-rumble'
where slug = 'red-deer-rumble-2026' and bi_tournament_url is null;
