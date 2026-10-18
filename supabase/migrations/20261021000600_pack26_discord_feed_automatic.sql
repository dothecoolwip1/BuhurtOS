-- Pack 26: a published event gets its Discord feed by itself.
--
-- The Discord side (the event's board, calls, results and announcements channels, the scheduled event, fighter DMs) only starts once the event has a
-- discord_feeds row with enabled = true. Until now only discord_feed_set wrote that row, and nothing in the product called it for a new event: the
-- practice event of 2026-10-18 was published and no channel appeared. Now every real, published event gets the feed with the usual defaults the
-- moment it is published (insert or draft -> published); the feed's own trigger asks the bot for the channels as before. Fictional / test events and
-- archived events never get one by themselves. An organizer can still turn any part of the feed off with discord_feed_set.
-- Idempotent and additive; nothing that already has a feed row is touched. In flight on hosted (applied 2026-10-18 21:35 UTC): the practice event
-- and the Red Deer Rumble 2026 were backfilled and their channels were ready eight seconds later.
-- The Discord tables live in hosted-only migrations (pack26_discord_*); a database without them (the from-zero gate) skips this whole file.
do $outer$
begin
  if to_regclass('public.discord_feeds') is null or to_regprocedure('private.discord_bot_configured()') is null then
    raise notice 'pack26_discord_feed_automatic: no Discord tables here, skipped';
    return;
  end if;

  execute $fn$
  create or replace function private.discord_feed_auto(p_event uuid) returns void
  language plpgsql security definer set search_path = '' as $$
  declare e public.events;
  begin
    if p_event is null or not private.discord_bot_configured() then return; end if;
    select * into e from public.events where id = p_event;
    if not found or e.status <> 'published' or e.archived_at is not null then return; end if;
    if private.is_synthetic('event', e.id) then return; end if;
    if exists (select 1 from public.discord_feeds f where f.event_id = e.id) then return; end if;
    insert into public.discord_feeds (event_id, enabled) values (e.id, true) on conflict (event_id) do nothing;
    if found then perform private.audit(e.id, 'discord.feed_auto', e.id::text, jsonb_build_object('slug', e.slug)); end if;
  end $$
  $fn$;
  execute 'revoke execute on function private.discord_feed_auto(uuid) from public, anon, authenticated';

  execute $fn$
  create or replace function private.events_discord_feed_auto() returns trigger
  language plpgsql security definer set search_path = '' as $$
  begin
    begin
      if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then perform private.discord_feed_auto(new.id); end if;
    exception when others then
      raise warning 'discord feed auto failed for event %: %', new.id, sqlerrm;
    end;
    return null;
  end $$
  $fn$;
  execute 'revoke execute on function private.events_discord_feed_auto() from public, anon, authenticated';
  execute 'create or replace trigger events_discord_feed_auto after insert or update of status on public.events for each row execute function private.events_discord_feed_auto()';

  -- what is in flight: every real published event that has not ended
  perform private.discord_feed_auto(e.id) from public.events e
  where e.status = 'published' and e.archived_at is null and e.ends_on >= current_date and not private.is_synthetic('event', e.id);
end $outer$;
