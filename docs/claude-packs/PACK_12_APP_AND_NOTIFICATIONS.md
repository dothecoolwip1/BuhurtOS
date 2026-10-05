# Pack 12: installable app, push notifications, product-wide polish (2026-10-06)

Read with `STATUS.md` (Pack 12 section), `docs/runbooks/PACK12_HOSTED_ROLLOUT.md` and `docs/runbooks/REAL_DEVICE_PUSH_CHECKLIST.md`.

## What the product does now
**Installable app.** Manifest (id, standalone, relative `start_url` / `scope` so GitHub Pages' `/BuhurtOS/` base path works, shortcuts, maskable icon, 180px Apple touch icon, Apple
meta tags) and the existing service worker (Pack 04: shell and public reads cached, updates wait for a safe moment). New: an Install card (browser dialog where there is one,
Share → Add to Home Screen steps on iPhone/iPad, nothing elsewhere), dismissible for 45 days, hidden once installed and on scoring / event-running screens.
An offline banner says when nothing can be saved or may be stale. Signing out removes this device's alerts (locally always, on the server when possible).

**Alerts (web push).** Account → Notifications: explain first, then one button asks the browser. Four groups (Fights, Team, Events, BuhurtOS), several devices per account, remove a device,
"Send me a test". Denied/blocked is respected with instructions; iPhone not installed is told to add to Home Screen first. The same text and tap destination appear in the bell.

**Fight alerts come from the real queue.** A deferred trigger on `matches.queue_state` / `matches.field` writes the notifications at COMMIT of the transaction that moved the match, so every way the queue
changes is covered (auto-advance after a result, start next, run sooner/later/skip, set_match_queue, send back, field change) with no second scheduler and no clock.
- moved up → **In the hole / On deck / You're up now** (once per transition)
- moved back while called → "Your fight moved back"; field change while called → "Your field changed"
- same state written again, realtime refreshes, reads: nothing (the trigger only fires on a real change; the same stage for the same match is not repeated within 2 minutes)
- a newer alert replaces the older one on the lock screen (same tag per match) and marks older unread ones read, so alerts never contradict
- becoming final retires the match's alerts
- recipients: a fighter entry → that fighter's account; a team entry → the accounts on the **recorded event roster** (never current members); only if no roster is recorded does the accepted registration
  stand in. This is the same rule as `my_event_entries` (My next fight); the gate compares them for every person and entry.
- test/synthetic events and teams never push (in-app only); withdrawn/disqualified entries notify nobody; a fighter without an account is skipped.
- A fight alert older than 10 minutes is dropped unsent. No "10 minutes until" claims exist anywhere (there is no trustworthy clock).
- Failure isolation: every producer swallows its own errors; pushing happens after commit through pg_net and an Edge Function. Proven: with a broken notification store a result is still accepted and the queue still advances.

**Other notices:** team join requests / answers (existing) plus "X joined your team" (captains, not the actor) and "You've been added to …"; registration decided / invited (existing) and event cancelled.
Organizer firehose (sign-ups, withdrawals, bug reports, claim requests, proposed teams) stays in the app only. There is no announcement feature in the repository, so none was invented.

**Home.** Signed in: "Your day": a called fight first and unmistakable (same queue columns as My next fight and the alerts, via `my_fight_now`), then the event on today or the next one the person is in, then
waiting join requests for captains; calm when nothing needs attention. My next fight shows IN THE HOLE / ON DECK / UP NOW as a big word.
**Navigation:** signed in, the phone bar is Home · Events · My events · Teams · More (Fighters, Calendar, Rankings, Formats, Rules, Alerts under More).
**Forms:** waiver placeholders ([EVENT NAME], [ORGANIZATION NAME], [VENUE NAME], [PROVINCE / STATE]) are kept in the editor and filled from the event on save (the saved version holds the finished words);
the registration form is pre-filled from the person's last registration, fighter profile and account (never declarations: medical fitness, waiver, fee, insurance) and **gender decides which categories apply**
(Male: men's + open, Female: women's + open, Other: all), enforced by the database too. The Fighters tab lists registered fighters (a volunteer who also fights is shown as both), so "Add fighter"
saying "already registered" now points at where they are.

## Security model (directly tested in `supabase/tests/pack12_gate.sql`, 122 checks)
- Subscriptions are secret: no client grant on `push_subscriptions`, preferences, deliveries or `private.push_config`; devices are managed only through functions that act on the caller's own rows and never return endpoint or keys.
- Dispatcher functions (`push_claim`, `push_report`, `push_dispatch_config`, `push_store_vapid`) are service-role only; the Edge Function additionally requires the shared secret.
- VAPID private key is generated server-side, never in the repo or bundle. The public half is served by `push_public_key`.
- Push payload carries title, one short sentence, route and tag. No health, contact, waiver, emergency or account data, no opponent names.
- A device that signs in as someone else moves to them (one owner at a time); the previous account no longer has it. Sign-out unsubscribes the browser.

## Evidence ladder
| Level | Status |
| --- | --- |
| Repository change | done |
| Unit tests (Vitest 856 + web-push crypto round-trip) | pass |
| Typecheck, production build | pass |
| Local database gates (run_all.sh incl. pack12_gate 122, pack12_commit real commits) | pass |
| Local browser (real Chromium, built app, mocked Supabase): pack12-app 74, pack07-ux 89, pack03 28, sw-update 28, entrants 54 | pass |
| Hosted migrations / Edge Function / cron / pg_net | applied and verified (see runbook) |
| CI on GitHub / production deploy / production browser | see STATUS.md (recorded after the release) |
| **Real phone receives a push** | **NOT PROVEN.** See the real-device checklist. |

What the sandbox does prove for push: (1) notification generation from the queue; (2) subscription persistence and ownership; (3) the dispatch request and its authorization (wrong secret 401, right secret 200 on hosted);
(4) the RFC 8291/8292 encryption (a spec-following subscriber decrypts it; VAPID signature verifies) and the service worker's push / tap handling (a push injected into the real worker shows a real notification, a newer one replaces it, a tap routes the open app).
Not proven: delivery through FCM / Mozilla / Apple push services to a real device, a tap with the app closed (headless Chromium refuses `openWindow` for a synthetic click), iOS behaviour.

## Known limits before the next live tournament
- Real-device receipt is untested. Do the checklist before relying on alerts; tell fighters alerts are a convenience and My next fight is the truth.
- iOS only supports web push for an installed Home Screen app (16.4+); Safari tabs cannot.
- A device that stays offline or is switched off misses time-sensitive fight alerts (they expire after 10 minutes by design).
- The female/male category rule is symmetric by design (the form already said gender "decides which categories apply"). If women should be allowed in men's categories, change the female branch in
  `private.registration_category_gender` and `genderAllows`.
- The Edge Function deploy is not part of CI; it is a manual (MCP) step recorded in the runbook.
