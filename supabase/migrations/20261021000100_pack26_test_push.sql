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

-- ---------------------------------------------------------------- the word for a field in an alert is the word on the screens: Lyst
-- Every screen now shows the stored default "Field N" as "Lyst N" (src/lib/eventDay.ts fieldLabel; custom names kept as written). A lock-screen alert
-- said "Report to Field 1 now" while the app said Lyst 1. The same rule, in SQL, for the alert text only: nothing stored changes, keys stay "field 1".
create or replace function private.field_label(p_field text) returns text
language sql immutable set search_path = '' as $$
  select case when coalesce(nullif(btrim(p_field), ''), 'Field 1') ~* '^\s*(field|lyst)?\s*[0-9]{1,2}\s*$'
              then 'Lyst ' || (regexp_match(coalesce(nullif(btrim(p_field), ''), 'Field 1'), '([0-9]{1,2})'))[1]::integer
              else btrim(p_field) end
$$;
revoke execute on function private.field_label(text) from public, anon, authenticated;

create or replace function private.notification_text(p_kind text, p_payload jsonb) returns table (title text, body text)
language plpgsql immutable set search_path = '' as $$
declare
  v_team text := left(coalesce(nullif(p_payload ->> 'team_name', ''), 'a team'), 80);
  v_event text := left(coalesce(nullif(p_payload ->> 'event_name', ''), 'the event'), 80);
  v_field text := left(private.field_label(p_payload ->> 'field'), 40);
  v_comp text := left(coalesce(nullif(p_payload ->> 'competition_name', ''), ''), 60);
  v_who text := left(coalesce(nullif(p_payload ->> 'requester_name', ''), nullif(p_payload ->> 'fighter_name', ''), nullif(p_payload ->> 'person_name', ''), 'Someone'), 80);
  v_ahead integer := case when coalesce(p_payload ->> 'ahead', '') ~ '^[0-9]{1,3}$' then (p_payload ->> 'ahead')::integer end;
begin
  if p_kind = 'suspension_changed' then
    return query select (case p_payload ->> 'change' when 'lifted' then 'Suspension lifted' when 'changed' then 'Suspension changed' else 'You are suspended' end)::text,
      (case p_payload ->> 'change' when 'lifted' then 'A suspension on your record was lifted.' else left(coalesce(p_payload ->> 'label', 'A suspension was recorded'), 140) || '.' end
       || ' See your discipline record.')::text;
    return;
  elsif p_kind = 'review_decided' then
    return query select 'Appeal decided'::text, ('An appeal or review on your record was decided: ' || replace(coalesce(p_payload ->> 'outcome', ''), '_', ' ') || '.')::text;
    return;
  elsif p_kind = 'green_card_changed' then
    return query select (case p_payload ->> 'change' when 'removed' then 'Green card removed' else 'Green card' end)::text,
      (case p_payload ->> 'change' when 'removed' then 'Your green card at ' || v_event || ' was removed after the correction was validated.'
            else 'You received a green card (authenticity) at ' || v_event || '. Talk to the authenticity officer.' end)::text;
    return;
  end if;
  if p_kind = 'inspection_needs_correction' then
    if p_payload ->> 'result' = 'failed' then
      return query select 'Armour did not pass'::text,
        ('Inspection at ' || v_event || ' did not pass: ' || left(coalesce(nullif(p_payload ->> 'issues', ''), 'see the inspectors'), 80) || '. Talk to the inspectors before you fight.')::text;
    else
      return query select 'Armour needs a fix'::text,
        ('Inspectors at ' || v_event || ' asked you to fix: ' || left(coalesce(nullif(p_payload ->> 'issues', ''), 'see the inspectors'), 80) || '. Then go back for reinspection.')::text;
    end if;
  elsif p_kind = 'inspection_passed' then
    return query select 'Armour passed'::text, ('Your armour passed inspection at ' || v_event || '.')::text;
  elsif p_kind = 'fight_called' then
    if p_payload ->> 'stage' = 'in_the_hole' then
      return query select (case when v_ahead is null or v_ahead = 0 then 'Your fight is coming up' when v_ahead = 1 then 'You''re 1 fight away' else 'You''re ' || v_ahead || ' fights away' end)::text,
                          ('Start getting ready' || case when v_comp <> '' then ' for ' || v_comp else '' end || ' on ' || v_field || '.')::text;
    elsif p_payload ->> 'stage' = 'on_deck' then
      return query select 'You''re up next'::text, ('Report to ' || v_field || ' and be ready to fight.')::text;
    else
      return query select 'Your fight is ready'::text, ('Report to ' || v_field || ' now.')::text;
    end if;
  elsif p_kind = 'fight_moved' then
    if p_payload ->> 'stage' = 'field' then
      return query select 'Your fight changed Lyst'::text, ('It is now on ' || v_field || '. Report there.')::text;
    else
      return query select 'Your fight moved back'::text, 'You''re not next any more. Check BuhurtOS for your place in the line.'::text;
    end if;
  elsif p_kind = 'schedule_changed' then
    return query select 'Your schedule changed'::text, ('Fight times at ' || v_event || ' changed. Check My next fight for your place in the line.')::text;
  elsif p_kind = 'event_announcement' then
    return query select v_event, left(coalesce(nullif(p_payload ->> 'message', ''), 'New announcement.'), 160)::text;
  elsif p_kind = 'result_needs_review' then
    return query select 'Result needs review'::text, ('Two results disagree' || case when v_comp <> '' then ' in ' || v_comp else '' end || '. Open Live ops to decide.')::text;
  elsif p_kind = 'team_join_requested' then return query select 'Join request'::text, (v_who || ' asked to join ' || v_team || '.')::text;
  elsif p_kind = 'team_join_decided' then
    if p_payload ->> 'decision' = 'approved' then return query select 'You''re on the team'::text, ('You''re now on the roster of ' || v_team || '.')::text;
    else return query select 'Join request answered'::text, (v_team || ' declined your request to join.')::text; end if;
  elsif p_kind = 'team_member_joined' then return query select 'New teammate'::text, (v_who || ' joined ' || v_team || '.')::text;
  elsif p_kind = 'team_member_added' then return query select 'Added to a team'::text, ('You''ve been added to ' || v_team || '.')::text;
  elsif p_kind = 'team_proposed' then return query select 'Team waiting for review'::text, (v_team || ' was proposed and is waiting for review.')::text;
  elsif p_kind = 'registration_submitted' then return query select 'New sign-up'::text, (v_who || ' signed up for ' || v_event || '.')::text;
  elsif p_kind = 'registration_withdrawn' then return query select 'Sign-up withdrawn'::text, (v_who || ' withdrew from ' || v_event || '.')::text;
  elsif p_kind = 'registration_decided' then
    if p_payload ->> 'decision' = 'accepted' then return query select 'You''re in'::text, ('You''re accepted for ' || v_event || '.')::text;
    else return query select 'Registration update'::text, ('Your registration for ' || v_event || ' was declined.')::text; end if;
  elsif p_kind = 'event_invited' then return query select 'You''ve been added to an event'::text, ('The organizers added you to ' || v_event || '. Finish your registration.')::text;
  elsif p_kind = 'event_cancelled' then return query select 'Event cancelled'::text, (v_event || ' was cancelled.')::text;
  elsif p_kind = 'fighter_claim_requested' then return query select 'Profile claim'::text, 'Someone asked to claim a fighter profile.'::text;
  elsif p_kind = 'fighter_claim_decided' then
    if p_payload ->> 'decision' = 'approved' then return query select 'Profile claimed'::text, 'Your fighter profile is now yours, with its full history.'::text;
    else return query select 'Profile claim answered'::text, 'Your request to claim a fighter profile was not approved.'::text; end if;
  elsif p_kind = 'bug_reported' then return query select 'Bug report'::text, 'A new bug report was filed.'::text;
  elsif p_kind = 'test_push' then return query select 'BuhurtOS test'::text, 'Notifications are working on this device.'::text;
  else return query select 'BuhurtOS'::text, 'You have a new notification.'::text;
  end if;
end $$;
