-- Pack 26: "Send me a test" always pushes.
-- The test push (kind test_push) falls into the "BuhurtOS" preference category, so a person who had switched that category off pressed "Send me a test",
-- was told it was on its way, and nothing arrived (the claim skipped it as "not wanted"). A test the person asked for a second ago is never unwanted:
-- the claim now hands out a test push whatever the preferences say. Everything else in push_claim is unchanged. Additive: one function redefined,
-- no table, grant or policy changes; nothing in flight on hosted is affected (a pending test push simply becomes claimable).
create or replace function public.push_claim(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_out jsonb;
begin
  update public.push_deliveries set state = 'failed', last_error = coalesce(last_error, 'no answer from the dispatcher'), updated_at = now()
  where state in ('sending', 'retry') and attempts >= 4 and claimed_at < now() - interval '2 minutes';
  update public.notifications set push_state = 'done' where push_state = 'pending' and created_at < now() - private.push_ttl(category);
  update public.notifications n set push_state = 'done'
  where n.push_state = 'pending' and exists (select 1 from public.push_deliveries d where d.notification_id = n.id)
    and not exists (select 1 from public.push_deliveries d where d.notification_id = n.id and d.state in ('sending', 'retry'));

  update public.notifications n set push_state = 'done'
  where n.push_state = 'pending'
    and not exists (
      select 1 from public.push_subscriptions s
      left join public.notification_preferences p on p.user_id = s.user_id
      where s.user_id = n.user_id and s.revoked_at is null
        and (n.kind = 'test_push' or coalesce(case n.category when 'fights' then p.fights when 'team' then p.team when 'events' then p.events else p.system end, true)));

  with pending as (
    select n.id, n.user_id, n.category, n.kind from public.notifications n
    where n.push_state = 'pending' order by n.created_at limit greatest(1, least(coalesce(p_limit, 100), 500)) for update skip locked),
  pairs as (
    select pe.id as nid, s.id as sid from pending pe
    join public.push_subscriptions s on s.user_id = pe.user_id and s.revoked_at is null
    left join public.notification_preferences p on p.user_id = pe.user_id
    where pe.kind = 'test_push' or coalesce(case pe.category when 'fights' then p.fights when 'team' then p.team when 'events' then p.events else p.system end, true)),
  claimed as (
    insert into public.push_deliveries as d (notification_id, subscription_id)
    select nid, sid from pairs
    on conflict (notification_id, subscription_id) do update
      set state = 'sending', attempts = d.attempts + 1, claimed_at = now(), updated_at = now()
      where d.attempts < 4 and (d.state = 'retry' or (d.state = 'sending' and d.claimed_at < now() - interval '2 minutes'))
    returning d.notification_id, d.subscription_id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'notification_id', c.notification_id, 'subscription_id', c.subscription_id,
    'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
    'title', t.title, 'body', t.body, 'route', coalesce(n.route, '/'), 'category', n.category,
    'tag', case when n.payload ? 'match_id' then 'fight-' || (n.payload ->> 'match_id') else 'n-' || n.id::text end,
    'urgent', n.category = 'fights', 'ttl', extract(epoch from private.push_ttl(n.category))::integer)), '[]'::jsonb)
  into v_out
  from claimed c join public.notifications n on n.id = c.notification_id join public.push_subscriptions s on s.id = c.subscription_id
  cross join lateral private.notification_text(n.kind, n.payload) t;
  return v_out;
end $$;
