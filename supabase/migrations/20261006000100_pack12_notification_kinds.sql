-- Pack 12 (2026-10-06), part 1 of 2: the notifications table learns what push needs. Additive.
--   * New kinds: fight_called / fight_moved (event-day queue), team_member_joined / team_member_added, event_cancelled, test_push.
--   * category: which of the four settings groups a notification belongs to (fights, team, events, system). Filled by a trigger in part 2.
--   * push / push_state: whether this notification is meant for a phone's lock screen and where delivery stands (none, pending, done).
--     Delivery is a convenience layer: nothing in the sporting system ever waits for it.
--   * route: the app page a tap should open (validated as an app-relative path), so the in-app list and the lock-screen tap agree.
--   * dedupe_key: optional unique key so a producer that is run twice cannot create the same notification twice.
-- The kind list is replaced in place (the same way every earlier pack extended it). Kept in its own file so the small constraint swap is easy to review.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('team_join_requested', 'team_join_decided', 'team_proposed', 'registration_submitted', 'registration_decided', 'bug_reported',
                  'event_invited', 'registration_withdrawn', 'fighter_claim_requested', 'fighter_claim_decided',
                  'fight_called', 'fight_moved', 'team_member_joined', 'team_member_added', 'event_cancelled', 'test_push'));

alter table public.notifications add column if not exists category text;
alter table public.notifications add column if not exists push boolean not null default false;
alter table public.notifications add column if not exists push_state text not null default 'none';
alter table public.notifications add column if not exists route text;
alter table public.notifications add column if not exists dedupe_key text;

alter table public.notifications drop constraint if exists notifications_category_check;
alter table public.notifications drop constraint if exists notifications_push_state_check;
alter table public.notifications drop constraint if exists notifications_route_check;
alter table public.notifications add constraint notifications_category_check check (category is null or category in ('fights', 'team', 'events', 'system'));
alter table public.notifications add constraint notifications_push_state_check check (push_state in ('none', 'pending', 'done'));
alter table public.notifications add constraint notifications_route_check
  check (route is null or (char_length(route) <= 200 and route ~ '^/[A-Za-z0-9/_-]*(\?[A-Za-z0-9=&_-]*)?(#[A-Za-z0-9_-]+)?$'));

create unique index if not exists notifications_dedupe_idx on public.notifications (dedupe_key) where dedupe_key is not null;
create index if not exists notifications_push_pending_idx on public.notifications (created_at) where push_state = 'pending';
