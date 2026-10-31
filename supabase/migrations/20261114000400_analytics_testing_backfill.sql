-- Analytics leaves out testing, part 2: mark the visits already recorded (see 20261114000300_analytics_hide_testing.sql).
-- Marks only; deletes nothing. Safe to run twice (the second run marks nothing).
update public.activity_sessions set internal = true where not internal and private.analytics_internal_account(user_id);
update public.activity_sessions s set internal = true
 where not s.internal and s.visitor_id in (select x.visitor_id from public.activity_sessions x where x.internal and x.visitor_id is not null);
