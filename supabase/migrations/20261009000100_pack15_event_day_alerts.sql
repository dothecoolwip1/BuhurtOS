-- Pack 15 (2026-10-09): event-day alerts that say what a fighter needs, schedule-change alerts, event announcements and a staff alert for
-- result conflicts. Additive. Builds on the Pack 12 pipeline (notifications -> push_claim -> send-push) and replaces none of it.
--
--   * Fight alerts keep coming ONLY from real changes of matches.queue_state / matches.field (Pack 12 trigger, Pack 13 moves the queue).
--     New wording: "You're 2 fights away" (the real count of fights ahead on that field when the change happened), "You're up next ·
--     Report to <field>", "Your fight is ready · Report to <field> now". A field change also reaches people who had already been alerted about
--     that fight while it is back in the line.
--   * schedule_changed: an organizer moved a fight's time by 10+ minutes, close to now. One alert per person per event per 10 minutes.
--   * event_announcement: an organizer of THAT event writes a short message to the people taking part. Rate-limited, audited, no links.
--   * result_needs_review: a result conflict (Pack 03 "Needs review") reaches the event's organizers and head marshals once.
--   * Durable dedupe: every producer here writes notifications.dedupe_key (unique) and inserts with ON CONFLICT DO NOTHING.
-- Nothing here touches a score, the clock, the queue or a sporting record.

-- ---------------------------------------------------------------- 1. kinds, groups, push, routes, words
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('team_join_requested', 'team_join_decided', 'team_proposed', 'registration_submitted', 'registration_decided', 'bug_reported',
                  'event_invited', 'registration_withdrawn', 'fighter_claim_requested', 'fighter_claim_decided',
                  'fight_called', 'fight_moved', 'team_member_joined', 'team_member_added', 'event_cancelled', 'test_push',
                  'schedule_changed', 'event_announcement', 'result_needs_review'));

create or replace function private.notification_category(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('fight_called', 'fight_moved', 'schedule_changed') then 'fights'
    when p_kind in ('team_join_requested', 'team_join_decided', 'team_proposed', 'team_member_joined', 'team_member_added') then 'team'
    when p_kind in ('registration_submitted', 'registration_decided', 'registration_withdrawn', 'event_invited', 'event_cancelled',
                    'event_announcement', 'result_needs_review') then 'events'
    else 'system' end $$;

create or replace function private.notification_pushable(p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select p_kind in ('fight_called', 'fight_moved', 'team_join_requested', 'team_join_decided', 'team_member_joined', 'team_member_added',
                    'registration_decided', 'event_invited', 'event_cancelled', 'fighter_claim_decided', 'test_push',
                    'schedule_changed', 'event_announcement', 'result_needs_review') $$;

create or replace function private.notification_route(p_kind text, p_payload jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('fight_called', 'fight_moved', 'schedule_changed') and coalesce(p_payload ->> 'event_slug', '') ~ '^[a-z0-9-]+$' then '/events/' || (p_payload ->> 'event_slug') || '#my-next-fight'
    when p_kind in ('registration_decided', 'event_invited', 'event_cancelled', 'event_announcement') and coalesce(p_payload ->> 'event_slug', '') ~ '^[a-z0-9-]+$' then '/events/' || (p_payload ->> 'event_slug')
    when p_kind = 'result_needs_review' and coalesce(p_payload ->> 'event_slug', '') ~ '^[a-z0-9-]+$' then '/events/' || (p_payload ->> 'event_slug') || '/manage?tab=eventday'
    when p_kind = 'registration_submitted' and coalesce(p_payload ->> 'event_slug', '') ~ '^[a-z0-9-]+$' then '/events/' || (p_payload ->> 'event_slug') || '/manage'
    when p_kind = 'registration_withdrawn' and coalesce(p_payload ->> 'event_slug', '') ~ '^[a-z0-9-]+$' then '/events/' || (p_payload ->> 'event_slug') || '/manage?tab=fighters'
    when p_kind in ('team_member_joined', 'team_member_added') and coalesce(p_payload ->> 'team_slug', '') ~ '^[a-z0-9-]+$' then '/teams/' || (p_payload ->> 'team_slug')
    when p_kind = 'team_join_decided' and p_payload ->> 'decision' = 'approved' and coalesce(p_payload ->> 'team_slug', '') ~ '^[a-z0-9-]+$' then '/teams/' || (p_payload ->> 'team_slug')
    when p_kind in ('team_join_requested', 'team_join_decided', 'team_proposed') then '/team-manager'
    when p_kind = 'fighter_claim_requested' then '/platform/fighters'
    when p_kind = 'fighter_claim_decided' then case when p_payload ->> 'decision' = 'approved' and coalesce(p_payload ->> 'fighter_id', '') ~ '^[0-9a-f-]{36}$' then '/fighters/' || (p_payload ->> 'fighter_id') else '/claim-profile' end
    when p_kind = 'bug_reported' then '/platform/bugs'
    when p_kind = 'test_push' then '/account'
    else '/account' end $$;

-- Short, lock-screen sized text. Fight alerts say how far away and where to report; nothing claims a clock time (there is no trustworthy clock).
create or replace function private.notification_text(p_kind text, p_payload jsonb) returns table (title text, body text)
language plpgsql immutable set search_path = '' as $$
declare
  v_team text := left(coalesce(nullif(p_payload ->> 'team_name', ''), 'a team'), 80);
  v_event text := left(coalesce(nullif(p_payload ->> 'event_name', ''), 'the event'), 80);
  v_field text := left(coalesce(nullif(p_payload ->> 'field', ''), 'Field 1'), 40);
  v_comp text := left(coalesce(nullif(p_payload ->> 'competition_name', ''), ''), 60);
  v_who text := left(coalesce(nullif(p_payload ->> 'requester_name', ''), nullif(p_payload ->> 'fighter_name', ''), nullif(p_payload ->> 'person_name', ''), 'Someone'), 80);
  v_ahead integer := case when coalesce(p_payload ->> 'ahead', '') ~ '^[0-9]{1,3}$' then (p_payload ->> 'ahead')::integer end;
begin
  if p_kind = 'fight_called' then
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
      return query select 'Your fight changed field'::text, ('It is now on ' || v_field || '. Report there.')::text;
    else
      return query select 'Your fight moved back'::text, 'You''re not next any more. Check BuhurtOS for your place in the line.'::text;
    end if;
  elsif p_kind = 'schedule_changed' then
    return query select 'Your schedule changed'::text, ('Fight times at ' || v_event || ' changed. Check My next fight for your place in the line.')::text;
  elsif p_kind = 'event_announcement' then
    return query select v_event, left(coalesce(nullif(p_payload ->> 'message', ''), 'New announcement.'), 160)::text;
  elsif p_kind = 'result_needs_review' then
    return query select 'Result needs review'::text, ('Two results disagree' || case when v_comp <> '' then ' in ' || v_comp else '' end || '. Open Event day to decide.')::text;
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
revoke execute on function private.notification_category(text), private.notification_pushable(text), private.notification_route(text, jsonb),
  private.notification_text(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. fight alerts from real queue transitions (Pack 12 trigger, new body)
-- Same trigger, same moments. Changes: the "in the hole" alert carries how many fights are ahead on that field; a field change also reaches
-- people already alerted about this fight while it is back in the line; every alert has a durable dedupe key: the person's alert number for this
-- fight (count of their earlier alerts for it), so a retried or concurrent producer of the SAME transition cannot write it twice, while a later
-- genuine transition (moved back, called again) gets the next number and is told.
create or replace function private.queue_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cur public.matches; v_ev public.events; v_comp text; v_old integer; v_new integer; v_stage text; v_kind text; v_field text; v_payload jsonb; v_u uuid;
  v_ahead integer; v_seq integer;
begin
  begin
    select * into v_cur from public.matches where id = new.id;
    if not found or v_cur.queue_state is distinct from new.queue_state then return null; end if;      -- a later change in this transaction speaks for the match

    if new.queue_state = 'final' then
      update public.notifications set read_at = coalesce(read_at, now()) where kind in ('fight_called', 'fight_moved') and read_at is null and payload ->> 'match_id' = new.id::text;
      return null;
    end if;
    if old.queue_state = 'final' then return null; end if;

    v_old := case old.queue_state when 'in_the_hole' then 1 when 'on_deck' then 2 when 'active' then 3 else 0 end;
    v_new := case new.queue_state when 'in_the_hole' then 1 when 'on_deck' then 2 when 'active' then 3 else 0 end;
    if v_new > v_old then v_kind := 'fight_called'; v_stage := new.queue_state;
    elsif v_new < v_old then v_kind := 'fight_moved'; v_stage := 'back';
    elsif private.field_key(old.field) is distinct from private.field_key(new.field) then v_kind := 'fight_moved'; v_stage := 'field';
    else return null; end if;

    select e.* into v_ev from public.events e join public.competitions k on k.event_id = e.id where k.id = new.competition_id;
    select k.name into v_comp from public.competitions k where k.id = new.competition_id;
    v_field := coalesce(nullif(btrim(new.field), ''), 'Field 1');
    if v_stage = 'in_the_hole' then
      -- fights still ahead of this one on the same field of the same event: the called ones in front of it in the line
      select count(*) into v_ahead from public.matches m join public.competitions k on k.id = m.competition_id
      where k.event_id = v_ev.id and m.id <> new.id and private.field_key(m.field) is not distinct from private.field_key(new.field)
        and m.queue_state in ('active', 'on_deck');
    end if;
    v_payload := jsonb_build_object('match_id', new.id, 'stage', v_stage, 'field', v_field, 'competition_name', v_comp, 'event_name', v_ev.name, 'event_slug', v_ev.slug)
                 || case when v_ahead is not null then jsonb_build_object('ahead', v_ahead) else '{}'::jsonb end;

    for v_u in select x from private.entry_recipient_users(new.entry_a) x union select y from private.entry_recipient_users(new.entry_b) y loop
      -- a fight that is back in the line moving field is only news for someone who has already been alerted about it
      if v_stage = 'field' and v_new = 0 and not exists (
        select 1 from public.notifications n where n.user_id = v_u and n.kind in ('fight_called', 'fight_moved') and n.payload ->> 'match_id' = new.id::text
          and n.created_at > now() - interval '12 hours') then continue; end if;
      if exists (select 1 from public.notifications n where n.user_id = v_u and n.kind = v_kind and n.payload ->> 'match_id' = new.id::text
                 and n.payload ->> 'stage' = v_stage and n.payload ->> 'field' = v_field and n.created_at > now() - interval '2 minutes') then continue; end if;
      select count(*) into v_seq from public.notifications n where n.user_id = v_u and n.kind in ('fight_called', 'fight_moved') and n.payload ->> 'match_id' = new.id::text;
      update public.notifications set read_at = coalesce(read_at, now())
      where user_id = v_u and kind in ('fight_called', 'fight_moved') and read_at is null and payload ->> 'match_id' = new.id::text;
      insert into public.notifications (user_id, kind, payload, dedupe_key)
      values (v_u, v_kind, v_payload, 'fight:' || new.id::text || ':' || v_u::text || ':' || v_seq || ':' || v_kind || ':' || v_stage)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end loop;
  exception when others then
    raise warning 'fight notification failed for match %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function private.queue_notify() from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. schedule changes
-- An organizer moved a fight's time. Worth telling only when it is a real move (10 minutes or more), close to now (the old or the new time within
-- the next 24 hours), for a fight not yet final, in a published event. A bulk re-plan that moves many of a person's fights is ONE alert per person
-- per event per 10 minutes. The words name no time (times are estimates; the line decides): "check My next fight".
create or replace function private.schedule_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_now public.matches; v_ev public.events; v_u uuid; v_bucket text; v_payload jsonb;
begin
  begin
    select * into v_now from public.matches where id = new.id;
    if not found or v_now.scheduled_at is distinct from new.scheduled_at then return null; end if;   -- a later change in this transaction speaks for the match
    if new.queue_state = 'final' or old.scheduled_at is null or new.scheduled_at is null then return null; end if;
    if abs(extract(epoch from (new.scheduled_at - old.scheduled_at))) < 600 then return null; end if;
    if least(old.scheduled_at, new.scheduled_at) > now() + interval '24 hours' or greatest(old.scheduled_at, new.scheduled_at) < now() - interval '2 hours' then return null; end if;
    select e.* into v_ev from public.events e join public.competitions k on k.event_id = e.id where k.id = new.competition_id;
    if not found or v_ev.status <> 'published' then return null; end if;
    v_bucket := floor(extract(epoch from now()) / 600)::bigint::text;
    v_payload := jsonb_build_object('event_name', v_ev.name, 'event_slug', v_ev.slug);
    for v_u in select x from private.entry_recipient_users(new.entry_a) x union select y from private.entry_recipient_users(new.entry_b) y loop
      insert into public.notifications (user_id, kind, payload, dedupe_key)
      values (v_u, 'schedule_changed', v_payload, 'schedule:' || v_ev.id::text || ':' || v_u::text || ':' || v_bucket)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end loop;
  exception when others then
    raise warning 'schedule notification failed for match %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function private.schedule_notify() from public, anon, authenticated;
do $do$
begin
  if not exists (select 1 from pg_trigger where tgname = 'matches_notify_schedule' and tgrelid = 'public.matches'::regclass) then
    create constraint trigger matches_notify_schedule after update of scheduled_at on public.matches
      deferrable initially deferred for each row
      when (old.scheduled_at is distinct from new.scheduled_at)
      execute function private.schedule_notify();
  end if;
end $do$;

-- ---------------------------------------------------------------- 4. result conflicts reach the people who decide them
create or replace function private.review_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ev public.events; v_comp text;
begin
  begin
    select * into v_ev from public.events where id = new.event_id;
    if not found then return null; end if;
    select k.name into v_comp from public.matches m join public.competitions k on k.id = m.competition_id where m.id = new.match_id;
    insert into public.notifications (user_id, kind, payload, dedupe_key)
    select distinct s.user_id, 'result_needs_review',
           jsonb_build_object('event_name', v_ev.name, 'event_slug', v_ev.slug, 'competition_name', v_comp, 'proposal_id', new.id),
           'review:' || new.id::text || ':' || s.user_id::text
    from public.event_staff s where s.event_id = new.event_id and s.role in ('organizer', 'head_marshal') and s.user_id is not null
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  exception when others then
    raise warning 'result review notification failed: %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function private.review_notify() from public, anon, authenticated;
do $do$
begin
  if not exists (select 1 from pg_trigger where tgname = 'result_proposals_notify_review' and tgrelid = 'public.result_proposals'::regclass) then
    create trigger result_proposals_notify_review after insert on public.result_proposals for each row
      when (new.status = 'conflict') execute function private.review_notify();
  end if;
end $do$;

-- ---------------------------------------------------------------- 5. event announcements
create table if not exists public.event_announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  message text not null check (char_length(message) between 3 and 140),
  audience text not null check (audience in ('everyone', 'fighters')),
  recipients integer not null default 0,
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now()
);
create index if not exists event_announcements_event_idx on public.event_announcements (event_id, sent_at desc);
alter table public.event_announcements enable row level security;
revoke all on public.event_announcements from public, anon, authenticated;
comment on table public.event_announcements is 'Pack 15: short event-day messages from an organizer to the people taking part in THAT event. Read and written only through functions.';

-- Who takes part in an event: accepted registrations (fighters; with ''everyone'' also volunteers and staff) and the accounts behind its live entries.
create or replace function private.event_audience(p_event uuid, p_audience text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select r.user_id from public.registrations r
  where r.event_id = p_event and r.status = 'accepted' and r.user_id is not null and (p_audience = 'everyone' or not r.is_volunteer)
  union
  select u from public.entries en join public.competitions k on k.id = en.competition_id cross join lateral private.entry_recipient_users(en.id) u
  where k.event_id = p_event and en.status in ('registered', 'checked_in')
  union
  select s.user_id from public.event_staff s where s.event_id = p_event and p_audience = 'everyone' and s.user_id is not null
$$;
revoke execute on function private.event_audience(uuid, text) from public, anon, authenticated;

create or replace function public.send_event_announcement(p_event uuid, p_message text, p_audience text default 'everyone') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_ev public.events; v_msg text; v_id uuid; v_n integer;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can send announcements' using errcode = '42501'; end if;
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.status <> 'published' then raise exception 'announcements can only be sent for a published event' using errcode = '22023'; end if;
  if p_audience is null or p_audience not in ('everyone', 'fighters') then raise exception 'send it to everyone or to fighters' using errcode = '22023'; end if;
  v_msg := btrim(regexp_replace(regexp_replace(coalesce(p_message, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
  if char_length(v_msg) < 3 or char_length(v_msg) > 140 then raise exception 'an announcement is 3 to 140 characters' using errcode = '22023'; end if;
  if v_msg ~* '(https?://|www\.|[a-z0-9-]+\.(com|ca|net|org|io|app|co|ly|me)(/|\s|$))' then
    raise exception 'links are not allowed in announcements; say where to look in BuhurtOS instead' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bos:announce:' || p_event::text, 0));
  if (select count(*) from public.event_announcements where event_id = p_event and sent_at > clock_timestamp() - interval '1 hour') >= 5 then
    raise exception 'this event has sent 5 announcements in the last hour; wait a little' using errcode = '22023'; end if;
  if (select count(*) from public.event_announcements where event_id = p_event and sent_at > clock_timestamp() - interval '24 hours') >= 20 then
    raise exception 'this event has sent 20 announcements today' using errcode = '22023'; end if;

  insert into public.event_announcements (event_id, message, audience, sent_by, sent_at) values (p_event, v_msg, p_audience, v_uid, clock_timestamp()) returning id into v_id;
  insert into public.notifications (user_id, kind, payload, dedupe_key)
  select a, 'event_announcement', jsonb_build_object('event_name', v_ev.name, 'event_slug', v_ev.slug, 'message', v_msg, 'announcement_id', v_id),
         'announce:' || v_id::text || ':' || a::text
  from (select distinct a from private.event_audience(p_event, p_audience) a where a is distinct from v_uid) x
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  update public.event_announcements set recipients = v_n where id = v_id;
  perform private.audit(p_event, 'event.announcement', v_id::text, jsonb_build_object('message', v_msg, 'audience', p_audience, 'recipients', v_n));
  return jsonb_build_object('id', v_id, 'recipients', v_n);
end $$;

create or replace function public.list_event_announcements(p_event uuid)
returns table (id uuid, message text, audience text, recipients integer, sent_at timestamptz, sent_by_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can see its announcements' using errcode = '42501'; end if;
  return query select a.id, a.message, a.audience, a.recipients, a.sent_at, coalesce(private.person_name(a.sent_by), 'An organizer')
  from public.event_announcements a where a.event_id = p_event order by a.sent_at desc limit 50;
end $$;

revoke execute on function public.send_event_announcement(uuid, text, text), public.list_event_announcements(uuid) from public, anon;
grant execute on function public.send_event_announcement(uuid, text, text), public.list_event_announcements(uuid) to authenticated;
