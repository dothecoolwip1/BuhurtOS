# Pack 26: full Rumble rehearsal, event-day hardening and product polish (2026-10-07)

Durable work log of Pack 26. Levels are kept apart on purpose: **repository**, **local database**, **build / tests**, **browser verification**, **hosted database**, **deployment**.

**Hosted Supabase and production were not touched by this pack: no migration applied, nothing deployed, no hosted row written. Everything below ran on a throwaway local stack.**

## 0. Branch, baseline, scope

| | |
| --- | --- |
| Branch | `ccr-ba2f7d4b-7bn1n5` (the session's designated branch; it is the Pack 26 branch) |
| Starting commit | `0c1fc9d` (`main` after PR #55, Pack 25.1) |
| Container | Linux, Node 22.22, Postgres 16.15 (local throwaway cluster at `/var/tmp/run:55432`), PostgREST 12.2.3 (downloaded binary), Chromium 1194 (Playwright) |
| Scope | the 48-part Pack 26 brief: a realistic synthetic rehearsal fixture; the full tournament lifecycle in the running app; fixes for reproduced problems within established decisions; the UI/UX audit by persona (`PACK_26_UIUX_MATRIX.md`); documentation accuracy |

### Baseline (before any change, 2026-10-07)

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 112 files passed, 6 skipped; **1404 tests passed**, 6 skipped |
| `npm run build` | clean (chunk-size warnings as before) |
| `supabase/tests/run_all.sh` | **DATABASE GATE PASSED**: security 709, captain 65, team_admin 69, activity 90, pack01 70, pack02 69, pack03 67, pack05 43, pack07 109, pack1 49, reconcile 54, pack08 122, synthetic_org 37, pack09a 107, pack09b 47, team_discipline 53, pack09c 136, pack09d 149, pack10 104, pack11 28, pack12 122, pack13 269, pack14 69, pack15 61, pack16 90, pack18 36, pack181 sessions 119 / roles 133 / broadcast 104, club 111 / 78 / 136, pack22 139 / 119 / 43 / 64 / 14, pack24a0 151, pack24 followups 28; vectors, fingerprint, simulation, league 68/68, four concurrency suites |

## 1. The rehearsal fixture

`scripts/e2e/fixtures/pack26.sql` (TEST DATA ONLY, local throwaway database, tagged synthetic through `sources.synthetic` + `record_sources`). It reuses the Pack 11 people (`rumble.sql`: 52 fighters with accounts, 10 teams, platform owner a1, organizer a2) and adds what the brief asks for. Details in section 1 of the work log below as the fixture is built.

## 2. Work log

| # | Item | State | Evidence |
| --- | --- | --- | --- |
| 1 | Baseline recorded | done | section 0 |
| 2 | Local real stack (Postgres, PostgREST, built app, Chromium) | done | `/var/tmp/run`, `/opt/postgrest` |
| 3 | Pack 26 fixture | in progress | `scripts/e2e/fixtures/pack26.sql` |
| 4 | Existing live suites re-run on the real stack | in progress | section 6 |
| 5 | Full rehearsal script `scripts/e2e/pack26-live.{sh,mjs}` | to do | |
| 6 | Problems reproduced and fixed | to do | section 3 |
| 7 | UI/UX matrix | to do | `PACK_26_UIUX_MATRIX.md` |
| 8 | Docs accuracy | to do | section 8 |

## 3. Problems reproduced, severity, root cause, fix

| # | Where | Severity | Reproduced how | Root cause | Fix | Files | Regression test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Register page after the close time | P1 | `pack26-live` check 21: the form rendered with "Registration closes October 7" in the past; a completed form was refused by the server | `RegisterPage` never looked at the registration window (only the event page's card did) | the page says "Registration is closed / not open yet" with the time and a way back; no form; a registered person still sees their registration, without Change | `src/registration/RegisterPage.tsx` | `pack26-live` 21–22 |
| 2 | Big screen and public Live on a team fight | P1 | check 122: after round 1 of the 5v5 the big screen showed `1 – 0` with no word for it; the Lyst's official totals for a team fight are rounds won | `arena.ts` shows the Lyst's confirmed totals for every match; for `counter_input = 'standing'` those totals are rounds | `ArenaFight.unit` (`points` / `rounds` from the competition's league); the big screen prints "rounds" under each number and "· rounds won" in the context line; the Live card prints "rounds won" under the score | `src/lib/arena.ts`, `src/pages/arena/ArenaPage.tsx`, `src/pages/event/LiveFields.tsx`, `src/pages/EventWorkspace.tsx`, `src/styles/arena.css`, `src/styles/app.css` | `pack26-live` 122–123; `broadcast.test.ts` fixtures |
| 3 | Field names everywhere | P2 | the audit (`PACK_26_RUMBLE_REHEARSAL.md` §9) and run 9: Live ops said "Fields" beside "Lyst Control · Field 1", the counter phone asked "Which Lyst?" and offered "Field 1", the header read "Lyst · Field 1", a push said "Report to Field 1", a typed "10" showed as "10", and the public Live page grouped `Field 1` and `field 1` apart and called a blank field "Field not set" | no display helper; the stored default "Field N" was printed raw in 20 places; two different `lystLabel` helpers (announcer, broadcast) | one `fieldLabel()` (stored "Field N", a bare "N" or "lyst N" → "Lyst N"; a custom name as written) used at every display point; routes, RPC arguments and keys keep the stored name; `buildNowAndNext` groups by the one key; the same rule in SQL for alert text (`private.field_label`) | `src/lib/eventDay.ts`, `commandCentre.ts`, `liveView.ts`, `arena.ts`, `devices.ts`, `announcer/viewModel.ts`, `broadcastView.ts`, `FieldBoardView`, `LiveOps`, `LiveFields`, `ArenaPage`, `FieldPage`, `LystScoring`, `ScoringScreen`, `CounterPage`, `DeviceSessions`, `MyNextFight`, `RunTab`, `MatchSchedule`, migration `20261021000100` | `eventDay.test.ts` (fieldLabel), `liveView.test.ts`, `commandCentre.test.ts`, `devices.test.ts`, `pack26_gate.sql` §2, `pack12_gate` / `pack15_gate` wording |
| 4 | Event settings | P2 | check 9b: no way to say how many Lysts the event runs except Quick Setup or the Build tournament stepper | `SetupForm` had no field count | "How many Lysts (fighting areas) run at once" (1–12) in Event settings, saved to `events.field_count` | `src/registration/setup.ts`, `src/pages/SetupTab.tsx` | `setup.test.ts`; `pack26-live` 9b |
| 5 | Stale Pack 25 wording | P2 | the terminology audit: "Counter Phone 1 to 4" in the device codes help, "Manage › People" on the desk refusal, "Fix in Run / Open in Run / Open in Run tools" attention labels, "This seat has run out", the database's "counter seat" messages on the phone, "Open Event day to decide" in the review alert | left over from the old model | wording replaced; the two database messages are mapped on the client (`friendlyError`); the alert text redefined in the migration | `DevicesPanel`, `CheckinDeskPage`, `eventDay.ts`, `FieldBoardView`, `lyst/counters.ts`, `friendlyError.ts`, migration `20261021000100` | `lyst.test.ts`, `eventDay.test.ts`, `pack15_gate` |
| 6 | Registrations review on a phone | P2 | run 6 evidence: 43 pending cards = 23.8 screens at 390; Accept made the card leave the Pending list with nothing on screen saying it happened | every card carried fee, insurance, four buttons and a folded contact block | a pending card leads with the decision (name, team, categories, what is outstanding, Accept / Decline); fee and insurance fold with the contact until the registration is accepted; a status line says "Accepted <name>." | `src/pages/control/RegistrationsTool.tsx` | `pack26-live` 27–29 |
| 7 | "Send me a test" with the BuhurtOS switch off | P2 | the notification audit; `pack26_gate` negative control on the old schema fails | `test_push` falls in the `system` category and `push_claim` filtered it out like any other | `push_claim` hands out a test push whatever the preferences say (migration, additive) | `supabase/migrations/20261021000100_pack26_test_push.sql` | `pack26_gate.sql` §1 (9 checks) |
| 8 | Notification settings | P3 | the audit: hints "2 away, up next, ready" / "Account news" did not cover schedule changes, armour inspection, discipline; the Account row said "Notification Settings" while the dialog said "Notifications" | – | hints rewritten; row renamed | `src/data/notifications.ts`, `NotificationSettings.tsx`, `Layout.tsx` | – |
| 9 | Live ops attention item for an idle Lyst | P3 | run 9: "Lyst 1 has no fight on → Call it in Live ops" linked to the page it was shown on | the item kept the old Command Centre's link to Event day | the item jumps to that Lyst's board on the same page ("Start it") | `src/lib/commandCentre.ts`, `FieldBoardView.tsx` | `commandCentre.test.ts` |
| 10 | Counter phone Lyst picker order | P3 | the naming audit: `collate "C"` order gives Lyst 1, Lyst 10, Lyst 2 | server ordering | natural order on the phone (client side; no migration) | `src/pages/lyst/CounterPage.tsx` | – |
| 11 | Event Overview: two Register buttons | P3 | run 11 screenshot `p26-05`: the header's call to action and the registration card both said Register | the card did not know the header already led there | the card hides its button when the header leads to the same place | `src/pages/EventWorkspace.tsx`, `RegistrationCard` | – |
| 12 | Build tournament said "Field" | P3 | run 11 `p26-19`: "Fields" stepper, "Field 1 / Field 2" chips and headings beside Lyst everywhere else | raw stored names | `fieldLabel` and "Lysts" in the stepper, chips, headings and totals | `src/pages/BuildTournamentTab.tsx` | `pack26-live` 59, 66 |
| 13 | Lyst Control queue page said "Field" | P3 | probe on run 13's database: "FIELD 1 · Matches for this field · Other fields: Field 2" | raw stored names | "Lyst 1", "Fights on this Lyst", "Other Lysts" (the route and key keep the stored name) | `src/pages/FieldPage.tsx` | `pack1-live` 13c accepts either; the queue page is in the run 14 screenshots |
| 14 | My events hides a test event the person is in | P2 | run 13 check 138: a fighter registered for the rehearsal event opened My events and saw "No events match … Test events show only with Show test data" | the test-data rule ran before the "mine" rule | an event the person takes part in is listed whatever the toggle says, labelled Test; browsing (Events) still hides test events without the toggle. Matters on hosted: real people rehearse on test events before the Rumble | `src/lib/eventFilters.ts`, `src/pages/MyEventsPage.tsx` | `eventFilters.test.ts` ("My events lists a test event the person takes part in"); `pack26-live` 138 |
| 15 | "Pools are finished, the bracket needs building" folded away | P2 | run 13 check 159: with the Longsword pools done and Lyst 1 idle, Live ops showed two "later" items (fees, a fighter not here) and "3 more"; the bracket item was behind the fold | the item was ranked `later` | it is a `soon` item: the Lyst stands still until the bracket exists | `src/lib/eventDay.ts` | `eventDay.test.ts` ("points at the next step when pools are finished") |
| 16 | Review list: the export in the way | P3 | run 11 `p26-10`: the CSV export sat above the first pending card | – | the export sits below the list | `src/pages/control/RegistrationsTool.tsx` | – |

## 4. Migrations

One, additive: `supabase/migrations/20261021000100_pack26_test_push.sql` — `push_claim` redefined (a test push is always delivered), `private.field_label(text)` (new, private), `private.notification_text` redefined (alert text says Lyst, "Open Live ops to decide"). No table, column, grant or policy changes; nothing in flight on hosted is affected (a pending test push becomes claimable; alerts created from now on carry the new words). `supabase/schema.fingerprint.txt` regenerated. **Not applied to hosted.**

## 5. Permissions affected

None. The new private function is revoked from `anon` and `authenticated` (tested); every other change is display-only.

## 6. Tests

(exact commands and results, filled as they run)

## 7. Browser verification, screenshots, viewports

Screenshots: `docs/reviews/assets/2026-10-07-pack26/`.

## 8. Documentation corrected

## 9. Known limitations, owner questions, deliberately deferred

### Owner questions (nothing changed; the current rule is stated)
1. **Who may take an injured fighter out on the day.** `withdraw_entry` is the organizer's (Pack 11). The head marshal and the medic are refused (run 13 check 79, now asserted as 79a). On the day that means the organizer, or an event admin device, does the withdrawal. If the head marshal should be able to, it is one permission line in `withdraw_entry` plus a gate check; not done without the owner.
2. **Camera Off on an event without a broadcast.** Pack 18.1 placed the red Camera Off control first on Live ops for everyone who may protect the stream. On a phone at an event with no camera it is the first screen (run 11 `p26-21`). Pack 26 tried showing it only once a broadcast is configured; that broke the deliberate Pack 18.1 behaviour (`cc181-live` 1.1, 2.10, 4.24) because a stream controller can be live without the configured flag, so the change was reverted. A smaller control, or one that hides when no controller has ever reported, is the owner's call.
3. **Changing the event's dates after registration holds every fight.** Registrations carry the days a person attends (`attend_dates`); moving the event (as the rehearsal did to make "today" the first day) leaves every attendance on the old days and every fight "held: not attending today". Real events rarely move; if one does, the organizer must re-date attendances (Set up › Registrations) or the hold rule should follow the event. Recorded, not changed.
4. **Review before build with one straggler.** With one registration still pending, Set up's single next step is "Review 1 registration"; Build tournament sits beside it (run 13 check 58 accepts both). Whether building should lead once most are reviewed is a product call.

### Deliberately deferred
- The database's `collate "C"` Lyst order (Lyst 1, Lyst 10, Lyst 2) is corrected on the counter phone only; `event_field_keys` / `counter_state` ordering on the server is untouched (no migration for a sort).
- The two first-time notification asks (install, push) share one "asked" key; acceptable.
- The registrations list is not live-refreshed while another organizer decides; a reload shows the change.
- `result_needs_review` pushes still route to the legacy `/manage?tab=eventday` address, which redirects to Event Control.
- Old real-stack suites that encode screens replaced by Pack 25 (`eventday-live.mjs` Pack 09A Event day, `finalize-live.mjs` Pack 09C Review tab) are superseded by `pack25-live` and `pack26-live`; they were not rewritten. Their stack runner (`eventday-live.sh`) is still the shared runner for every suite.

## 10. Final verification
