# Pack 12 hosted rollout (2026-10-06): record and operations

Project `mvbxlebznlgroptwwdsm`. All steps were done through the Supabase MCP tools (no SQL pasted by the owner).

## What was applied, in order
1. Migration `pack12_notification_kinds` (= `20261006000100`): notification kinds, category / push / push_state / route / dedupe_key columns and checks.
2. Migration `pack12_push_notifications` (= `20261006000200`): `push_subscriptions`, `notification_preferences`, `push_deliveries`, `private.push_config`, the producers
   (fight queue trigger, team join, event cancelled), device/settings/feed/test functions, `my_fight_now`, the dispatcher's service-role functions.
3. Migration `pack12_registration_gender` (= `20261006000300`): male registrations cannot enter women's categories, female cannot enter men's; other and open are unrestricted.
4. `create extension if not exists pg_net;`
5. Edge Function `send-push` (verify_jwt **off**; it checks a shared secret itself). Source: `supabase/functions/send-push/`.
6. `private.push_config` key `function_url` = `https://mvbxlebznlgroptwwdsm.supabase.co/functions/v1/send-push`.
7. The first authorised call created the VAPID key pair inside the database (`vapid_public`, `vapid_private`). The private key was never in the repository, a chat or a browser.
8. `cron.schedule('push-sweep', '* * * * *', 'select private.push_sweep()')`: once a minute, calls the dispatcher only when something is waiting.

## How a push happens
queue change in `matches` → deferred trigger writes `notifications` rows (push_state pending) at COMMIT → `notifications_kick` asks pg_net to call `send-push` after commit
→ `send-push` calls `push_claim`, sends Web Push (RFC 8291/8292) to each device, calls `push_report`. A failure at any point leaves the queue, results and registrations untouched.
The one-minute sweep retries anything left. A fight alert older than 10 minutes is dropped unsent (other kinds: 24 hours).

## Operations
- Dispatcher unreachable or paused: nothing sporting is affected. Notifications still appear in the bell.
- See recent calls: `select * from net._http_response order by id desc limit 20;` (pg_net keeps them briefly).
- Pending / stuck: `select push_state, count(*) from notifications group by 1;` and `select state, count(*) from push_deliveries group by 1;`.
- Turn pushing off entirely: `delete from private.push_config where key = 'function_url';` (the kick then does nothing; the bell keeps working) and `select cron.unschedule('push-sweep');`.
- Rotate the dispatch secret: `update private.push_config set value = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') where key = 'dispatch_secret';`.
- Do NOT replace the VAPID keys while people have devices registered: every existing subscription would stop receiving until each person turns alerts on again.
  (If it must be done: remove the two `vapid_*` rows, call the function once, tell people to turn alerts on again. The app re-subscribes automatically on next open for anyone who had alerts on.)

## Verified on hosted (read-only checks and one authorised call)
RLS on for the three new tables; no grants to anon/authenticated/PUBLIC on them or on `private.push_config`; function privileges as designed (dispatcher functions service_role only);
the six triggers exist; a call with a wrong secret answered 401, with the right secret 200 and created the key pair; the public key is served.
