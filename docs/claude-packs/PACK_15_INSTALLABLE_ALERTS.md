# Pack 15: installable app, push notifications and event-day alerts (2026-10-09)

Branch `pack15-installable-alerts` (from `main` at `ed9fb3b`, Pack 14 merged). Read with `STATUS.md` (Pack 15 section) and `docs/runbooks/PACK15_DEVICE_RUNBOOK.md`.
The Broadcast production fix (PR #35, branch `fix-broadcast-blank`: one realtime channel per subscriber, ErrorBoundary) is NOT part of this branch; this branch is reconciled with `main` once #35 merges.

## 1. Investigation: what already exists (Pack 12, reused as is)
Pack 12 already built most of the machinery this pack asks for. It is sound, tested (`pack12_gate.sql` 122 checks, `pack12_commit.sh`, `pack12-app.mjs` 74 browser checks) and deployed, so Pack 15 extends it and replaces nothing.

| Asked for | Already there (Pack 12) | Where |
| --- | --- | --- |
| Manifest: name, short name, icons (192/512/maskable/svg, 180 Apple), theme/background, standalone, relative `start_url`/`scope` for the GitHub Pages base path, shortcuts | yes | `public/manifest.webmanifest`, `index.html` |
| Service worker: offline shell, safe public-read cache, update waits for a safe moment (Pack 04), push + notificationclick + pushsubscriptionchange | yes | `public/sw.js`, `src/lib/swUpdate.ts` |
| Install UX: native dialog where offered, Share → Add to Home Screen on iPhone/iPad, hidden when installed, dismissed for 45 days, never on scoring screens | yes | `src/lib/install.ts`, `InstallCard.tsx` |
| Permission UX: explain first, button asks, "not now" remembered 30 days, blocked respected with instructions, iPhone-not-installed told to install first | yes | `PushAsk.tsx`, `NotificationSettings.tsx` |
| Subscriptions: secret table (no client grant), register / list (no endpoint or keys) / remove own devices, 10 per account, same browser signing in as someone else moves to them, sign-out unsubscribes, gone (404/410) revoked, 12 failures revoked, tombstones scrubbed | yes | `push_subscriptions`, `register_push_device`, `remove_push_device`, `push_report` |
| Delivery: notifications table → `push_claim` (service role) → Edge Function `send-push` (VAPID, RFC 8291) → `push_report`; pg_net kick after commit + 1-minute sweep; fight alerts expire after 10 minutes | yes | migration `20261006000200`, `supabase/functions/send-push` |
| Fight alerts from the REAL queue: deferred trigger on `matches.queue_state` / `field` at COMMIT; in the hole / on deck / up now, moved back, field changed; recipients = fighter account, or the recorded team roster; withdrawn entries and synthetic events never push | yes | `private.queue_notify`, `private.entry_recipient_users` |
| Preferences: four groups (fights, team, events, system), per account | yes | `notification_preferences`, `set_notification_settings` |
| Notification centre: the bell lists the same title, body and tap destination as the push | yes | `my_notification_feed`, `NotificationBell.tsx` |
| Team: join requested / decided, member joined (captains), member added | yes | Pack 12 triggers |
| Deep links: every notification carries a validated route; a tap routes the open app in place or opens the installed app on the route | yes | `notification_route`, `sw.js`, `PushWiring.tsx` |
| Offline banner, logout clears this device's subscription | yes | `OfflineBanner.tsx`, `AuthContext.tsx` |

Pack 13 is the source of truth for fight progression: the queue columns (`queue_state`, `field`) are moved by the existing paths (auto-advance after `lyst_finalize` / `submit_match_result`, start next, run sooner/later, send back). Pack 14 adds no progression state.

## 2. Gaps found (what Pack 15 adds)
1. **Wording does not say what a fighter needs.** "In the hole" never says how far away; "Get to the bullpen" is not where to go. → Alerts name the distance and the lyst: *You're 2 fights away* (the real count of fights ahead on that field at the moment of the change, never a guess), *You're up next · Report to Field 1 and be ready to fight*, *Your fight is ready · Report to Field 1 now*. The field name is the organizer's own (whatever they call their lysts).
2. **Lyst change only while called.** A field change of a fight that had already produced an alert but is back in the line is silent. → A field change notifies anyone who already had an alert for that fight (or whose fight is called).
3. **No schedule-change alert.** An organizer moving fight times (`matches.scheduled_at`) tells no one. → `schedule_changed`: only for a real move of 10+ minutes, only when the old or new time is within the next 24 hours, never for a final fight, coalesced to ONE alert per person per event per 10 minutes (a bulk reschedule of many fights is one message), body without false precision ("Check My next fight").
4. **Dedupe is time-window only.** The 2-minute "same stage" check is not race-safe across two concurrent transactions. → Every Pack 15 producer writes a `dedupe_key` (unique index, `on conflict do nothing`), see §4.
5. **No event announcements.** → `send_event_announcement` (organizer of THAT event only; published event; 3–140 characters, no links; 5 per hour and 20 per day per event; audience: everyone taking part, or fighters only), audited, with a history list for organizers. Recipients are computed only from that event's accepted registrations, entry accounts and staff.
6. **Staff alert backed by a real workflow.** A result conflict ("Needs review", Pack 03) waits silently for the head marshal. → `result_needs_review` to the event's organizers and head marshals, once per conflict. Organizer firehose (sign-ups, withdrawals) stays in-app (unchanged decision: noise).
7. **Signed-out tap lands nowhere.** A fight alert opens `/events/<slug>#my-next-fight`; signed out, the card renders nothing. → The card asks to sign in there, and the page stays on the same address so the destination is kept after sign-in.
8. **Permission revoked in the browser leaves a live server row.** → On start, a device whose permission is now "denied" removes its own server registration (by the id stored when it was registered), and a re-subscription with a new endpoint removes the old row.
9. **Settings do not show the two layers clearly.** → A status block: *Browser permission* (Allowed / Blocked / Not asked yet / Not available) and *BuhurtOS alerts on this device* (On / Off), plus what each group contains.

Not built (and why): a second queue or scheduler (forbidden; the queue is Pack 13's), "N minutes until" (no trustworthy clock), push for organizer sign-up firehose (noise), a marketing/mass-messaging tool (announcements are event-scoped and rate-limited), native apps, a large offline sync layer.

## 3. Notification architecture (unchanged pipeline)
`producer (trigger or function, inside the sporting transaction, errors swallowed)` → `public.notifications` row (`notifications_prepare` sets category, route, push decision; synthetic → in-app only) → `push_kick` after commit / 1-minute sweep → Edge Function `send-push` → `push_claim` (preferences, TTL, devices) → push service → `sw.js` shows it (tag per fight: a newer alert replaces an older one) → tap → route. The bell reads the same rows through `my_notification_feed`.

## 4. Deduplication strategy
- **Trigger level:** the queue trigger only fires on a real column change (`WHEN old is distinct from new`), at COMMIT (deferred), and a later change in the same transaction speaks for the match. Rereads, realtime refreshes, reconnects and app refreshes never write anything: alerts are produced by the database, never by a client.
- **Row level (durable, race-safe):** each Pack 15 producer writes `dedupe_key` and inserts with `on conflict (dedupe_key) do nothing` against the existing unique index:
  - fight alert: `fight:<match>:<user>:<kind>:<stage>:<field key>:<10-minute bucket>`; the same stage for the same fight cannot be issued twice in a window even by two concurrent transactions, and a genuine later repeat (moved back and called again) is still told.
  - schedule change: `schedule:<event>:<user>:<10-minute bucket>`.
  - announcement: `announce:<announcement>:<user>`. Result review: `review:<proposal>:<user>`.
- **Delivery level (Pack 12):** one `push_deliveries` row per (notification, device); a claimed pair is sent once; retries are bounded; the lock screen tag makes a newer alert for the same fight replace the older one, and older unread alerts for that fight are marked read.

## 5. Security
Unchanged boundaries: no client grant on subscriptions, preferences, deliveries or announcements; every new function is SECURITY DEFINER with an empty search_path, explicit revoke from public/anon and grant to authenticated only where a person calls it. Announcements: organizer of that event (platform owner per the existing platform rule), never a scorekeeper / marshal / fighter; recipients only from that event. Payloads carry no counter, seat, private reason, contact, health or account data. Tested in `supabase/tests/pack15_gate.sql`.

## 6. Evidence
See `STATUS.md` (Pack 15). In short: DATABASE GATE PASSED (pack15_gate 61, pack12_gate 122 with the new words); real-stack browser 42/42; regression suites green; Broadcast realtime 15/15 and Pack 13 rehearsal 88/88 on the merged branch.
Not proven here: delivery by a real push service to a physical phone, a tap on a real lock-screen notification with the app closed, iOS Home Screen behaviour (runbook `docs/runbooks/PACK15_DEVICE_RUNBOOK.md`).

## 7. Release notes (when the owner asks)
1. Apply `20261009000100_pack15_event_day_alerts.sql` to hosted Supabase (additive; no Edge Function or cron change: the Pack 12 dispatcher sends the new kinds as is).
2. Open the PR, let CI run, merge, let the main workflow deploy; then run the phone runbook.
