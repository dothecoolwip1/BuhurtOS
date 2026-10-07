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
| 17 | A second Lyst tablet after another device finished the fight | P1 | run 14 check 112 (`p26-41-lyst-second-tablet-after-finish-768.png`): the head marshal's tablet, opened on the running fight, still showed the clock, "Start round 4" and "Finish match" after the scorer's tablet had saved the result; the server refused anything it sent, the screen did not say | the Lyst page kept the fight as it was when opened; the scoring board never looked at the fresh match row | when the fresh row says final and this device did not finish it, the board is replaced by "This fight is final" with the official result, the next fight and a way back | `src/pages/FieldPage.tsx` | `pack26-live` 112 |
| 18 | "Pools, then a bracket" with every pool fight scored read as "All matches scored" | P2 | run 13 check 165 / run 14 check 159: Set up offered "Review wins & losses" for Men Longsword while the bracket did not exist; the database refused ("Pool play is done but the bracket has not been built"); no attention item said what to do | `competitionProgress` returned all-scored before looking for a missing bracket, because the client did not know the competition's structure | the live competition carries `structure`; pools-then-bracket with all pool fights final and no bracket is "Pools complete, bracket needs building" (soon item, Build the bracket) | `src/data/api.ts`, `src/lib/eventDay.ts` | `eventDay.test.ts` (pools owed a bracket); `pack26-live` 159–160 |
| 16 | Review list: the export in the way | P3 | run 11 `p26-10`: the CSV export sat above the first pending card | – | the export sits below the list | `src/pages/control/RegistrationsTool.tsx` | – |

## 4. Migrations

One, additive: `supabase/migrations/20261021000100_pack26_test_push.sql` — `push_claim` redefined (a test push is always delivered), `private.field_label(text)` (new, private), `private.notification_text` redefined (alert text says Lyst, "Open Live ops to decide"). No table, column, grant or policy changes; nothing in flight on hosted is affected (a pending test push becomes claimable; alerts created from now on carry the new words). `supabase/schema.fingerprint.txt` regenerated. **Not applied to hosted.**

## 5. Permissions affected

None. The new private function is revoked from `anon` and `authenticated` (tested); every other change is display-only.

## 6. Tests

All on the local throwaway stack (Postgres 16 from every migration, PostgREST 12.2.3, the local API front with the real device-session handler, the built app in Chromium 1194). Nothing touched hosted.

### Unit, types, build (final state of the branch)

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npx vitest run` | see §10 (final numbers) |
| `npm run build` | see §10 |
| `supabase/tests/run_all.sh` (15:10–15:25, beside the browser runs) | **DATABASE GATE PASSED**, 50 ok lines: every gate as in the baseline (security 709 … pack24 followups 28) plus **pack26_gate 18 checks**; pack12_gate 122 and pack15_gate 61 with the Lyst wording; vectors agree; fingerprint matches (2891 objects); simulation; league verifier; the six concurrency suites (build, pack09a queue, pack09c finalize, pack12 push, lyst control, pack13 commit) |

### The rehearsal (`scripts/e2e/pack26-live.sh`, 15 phases, 178 checks + 2 run-level checks)

| Run | Result | What it found |
| --- | --- | --- |
| 9–12 (building the script) | reached Live ops; partial phases | the register-after-close P1, the team-fight score P1, the field-naming P2 (§3 1–3) |
| 13 | 161 / 174 | the organizer-only withdrawal rule (script assumption), pool ties never decided before the bracket (script), My events hiding the person's own test event (§3 14), the bracket attention item folded away (§3 15), the big-screen check reading the unit as part of the number (script), the stale second tablet (§3 17) |
| 14 | 173 / 178 | the stale tablet after the finish (§3 17, fixed), "all scored" before the bracket exists (§3 18, fixed), the review sheet checked before it had loaded (script), "Reopen the event…" matched two buttons (script) |
| 15 | 176 / 179 | one check misread a fighter's surname (Cedar) as a counter's name; the tie-decision count; the `results` column name (all script) |
| 16 | 187 / 192 | the device phase's first real run: the credential expiry column, the bad-code message, a marshal device landing on a closed event (all script); the stale-tablet fix verified by hand with a probe (§3 17) |
| 17 | stopped at 76 | the running-order step picked a called slot's row by one name (script) |
| 18 | **213 / 217**, the first run through every phase including the permission matrix and the viewport sweep (208 PASS) | the matrix checks stated the rule wrongly for a fighter's own rows and for the marshal (a scoring role); the bad training code is checked when the trainee starts (all script) |
| 19 | aborted at 50 | the local stack's background process reached its time limit mid-run; restarted with the longest allowed lifetime |
| 20 | **216 / 217** through every phase (viewport sweep 208 PASS: 108 screen-size pairs, all fit, nothing covered, no errors) | the training-code check matched the side button case-sensitively (script) |
| 21 | see below | the branch's own build with the "2 fights away" hint; `origin/main` (Pack 25.2 sides and colours, Pack 25.3 attention list) was merged into the branch while it ran |
| 22 | see §10 | the final run, on the merged tree (new stack, merged migrations, rebuilt app) |

### The other real-stack suites, re-run on the branch (`/var/tmp/p26/side`, side ports, one at a time)

| Suite | Result | Notes |
| --- | --- | --- |
| `pack181-live` | 176 / 176 PASSED | |
| `pack10-live` | 135 / 135 | |
| `pack22-live` / `pack22-history-live` / `pack22-discipline-live` | 71 / 71, 32 / 32, 56 / 56 | |
| `pack13-live`, `pack25-live` | 89 / 89, 81 / 81 (before the Lyst wording change; the two suites' "Field 1" button lookups then updated to accept "Lyst 1") | re-run in §10 |
| `pack24a0-live` | 11 / 11, then an exception on the old `section[aria-label="Event day"]` | selector updated to the Pack 25 `Fields` section; re-run: **22 / 22**, then stops waiting for the Pack 24A0 public "Now and next" block that Pack 25's Live view replaced (per-Lyst NOW / ON DECK / IN THE HOLE, covered by `pack26-live` 139–146); not rewritten |
| `pack24a1-live` | 73 / 82 | the 9 failures were the suite's old words ("Lyst · Field 1") and Exit landing on `/live`; expectations updated; re-run in §10 |
| `device-live` | 55 / 56 | the counter phone's "Field 1" button is "Lyst 1"; updated; re-run in §10 |
| `cc181-live` | 104 / 113 | Camera Off hidden without a configured broadcast (Pack 26 change) broke the Pack 18.1 behaviour: reverted (§9 owner question 2); re-run in §10 |
| `announcer-live` | 180 / 181 | check 9 expects `counter_state` to answer `seat, server_now` only; since Pack 25 it also answers `kind: training`; the suite's expectation, not the product (left as is, recorded) |
| `pack14-live` | 62 / 63 | the broadcast setup link moved to Set up › Broadcast in Pack 25; check updated; re-run in §10 |
| `pack15-live` | 14 / 21 | the alert wording is now "Lyst" (this pack's migration) and the Announcements section folds; expectations updated; re-run in §10 |
| `pack16-live` | 30 / 33 | the captain's team panel and the check-in code are on the Overview view; the suite opens the bare event address, which is the Live view on the day: not rewritten (recorded) |
| `arena-live` | 4 / 7 → **50 / 51** after the Lyst words and the Pack 25 section and link names | the last step drives the Pack 09B classic scoreboard ("Head or torso +2"), which the Lyst board replaced as the default; covered by `pack26-live`'s duel phase; not rewritten |
| `represented-team-live` | 0 / 1 | waits for a "Team discipline leaders" heading that no longer exists (the team discipline table lives under Rankings › Teams › Disciplines since Pack 22); the suite, not the product; not rewritten (recorded) |
| `broadcast-realtime` | 14 / 15 | check 14 looked for "Field 1" on the Lyst screen; accepts "Lyst 1" now; re-run in §10 |
| `device-reliability-live` | see §10 | |
| `live-stability` (Pack 18: live updates keep the view) | 42 / 45 after the root was moved to the Pack 25 `Fields` section | two real findings, not fixed in this pack: on a desktop Live ops a live change moved the reading position by about 220 px (the attention list above re-flowed), and on the phone's public event page an offline/online reconnect moved it by about 100 px (the block above the standings re-flowed). Both are the Pack 18 guarantee ("the view is kept") on screens Pack 25 rebuilt; recorded as P2 for a follow-up (§9). The third failure is the suite's own Pack 18 screen list |
| `finalize-live`, `pack09d-live`, `rumble-live`, `eventday-live` | stopped on Pack 09A–09D / 18 screens that Pack 25 replaced (`?tab=finalize`, `?tab=home`, `section.eventday`) | the obvious addresses were updated where one line did it; these suites are superseded by `pack25-live` and `pack26-live` for those screens and are recorded as such (§9) |

## 7. Browser verification, screenshots, viewports

Screenshots from the final run (`docs/reviews/assets/2026-10-07-pack26/`, `p26-NN-<what>-<width>.png`; the width is the viewport: 390 phone, 768 tablet, 1280 laptop, 1920 TV). What each one shows:

| Phase | Screenshots |
| --- | --- |
| Set up | 01 a fresh draft's one next step · 02 draft ready to publish · 03 registration open · 04 Event settings with the Lyst count · 05 the public Overview for a fighter (one Register) |
| Register | 06 the form's errors · 07 registered, what happens next · 08 "your registration" on the event page · 09 the closed window (no form) |
| Review | 10 pending cards leading with the decision · 11 the whole list at 390 · 12 a very long name · 13 a volunteer's card |
| Check-in | 14–15 the desk with a fighter not ready · 16 a failed inspection at 768 · 17 the head marshal's override · 18 the desk scrolled |
| Build | 19 the plan at 1280 (two Lysts, formats, fight counts) · 20 the already-built state |
| Live ops | 21–22 before the start (attention, idle Lysts, Start it) · 23 running (NOW / ON DECK / IN THE HOLE behind the Lyst picker) · 24 a second tablet following · 25 the head marshal's view · 26 the Counter QR |
| Lyst Control and counters | 27 the queue · 28 the duel ready · 29 a counter bound and waiting · 30 the training QR · 31 the training counter · 32 counting · 33 the handoff · 34 offline counting · 35 end of round with each counter's tally beside the marshal's entry · 36 the second tablet on the same fight · 37–38 the Lyst offline, the marshal's call pending · 39 the public Live view with the official score · 40 the official result · 41 the second tablet after the finish ("This fight is final") · 42 the counter on the next fight |
| Team fight | 43 the 5v5 board (fighters standing) · 44 the counter phone on a team fight · 45 the big screen: 1 round vs 0 rounds, "rounds won" · 46 the counter waiting for the next fight |
| Public | 47–49 My next fight: scheduled, on deck, up now · 50 My events for a fighter (the test event listed) · 51–52 the public Live view · 53–54 the big screen for a duel at 1920 and 390 · 55 the announcer · 56 the broadcast overlay |
| Conflict and close | 57 two scorers disagree, Live ops asks · 58 the bracket built from pools (ties decided) · 59 Review wins & losses · 60 Results mode · 61 the event closed · 62–63 the public Results with podiums · 64 the big screen: Event complete |
| Devices, matrix, states | 65+ staff device landings, the permission matrix run, 404 / draft arena / empty Live ops / bad training code / the notification onboarding and settings, and the viewport sweep (`viewport-sweep.json`: every route at 360×800, 390×844, 768×1024, 1024×768, 1280×900 and 844×390) |

## 8. Documentation corrected

| Document | Was | Now |
| --- | --- | --- |
| `README.md` | an early-scaffold README: "Supabase is not connected", mock data, no mention of the gates or the real-stack suites | the real product and stack (Supabase is the backend and is in use on hosted), how to run it, the database gate and the browser suites, where things are, how it deploys, the known gaps |
| `docs/TEST_PLAN.md` | the Pack 04-era manual plan, presented as current | a superseded-in-part notice at the top pointing to the automated gates, the real-stack suites and this pack's rehearsal; the manual phone and iOS checks it still owns are left |
| `docs/claude-packs/STATUS.md` | header said branch `ccr-a435c5f7-pmrfxr`, last updated 2026-10-04 | header on this branch and date; a Pack 26 entry at the end (status, hosted untouched, tests, verification, fixed, owner questions, not verified) |
| `docs/claude-packs/PACK_26_UIUX_MATRIX.md` | – | new: 31 personas, every route with problems → outcomes and viewport columns, interaction cost, what was reviewed and left |
| `docs/claude-packs/PACK_26_RUMBLE_REHEARSAL.md` | – | new: this work log |
| Old real-stack suites (`eventday-live`, `finalize-live`, `pack09d-live`, `rumble-live`, `live-stability`, `represented-team-live`, the tail of `pack24a0-live`) | presented as runnable | recorded here (§6, §9) as superseded by `pack25-live` / `pack26-live` for the screens Pack 25 replaced; their one-line address fixes applied; not rewritten |

## 9. Known limitations, owner questions, deliberately deferred

### Owner questions (nothing changed; the current rule is stated)
1. **Who may take an injured fighter out on the day.** `withdraw_entry` is the organizer's (Pack 11). The head marshal and the medic are refused (run 13 check 79, now asserted as 79a). On the day that means the organizer, or an event admin device, does the withdrawal. If the head marshal should be able to, it is one permission line in `withdraw_entry` plus a gate check; not done without the owner.
2. **Camera Off on an event without a broadcast.** Pack 18.1 placed the red Camera Off control first on Live ops for everyone who may protect the stream. On a phone at an event with no camera it is the first screen (run 11 `p26-21`). Pack 26 tried showing it only once a broadcast is configured; that broke the deliberate Pack 18.1 behaviour (`cc181-live` 1.1, 2.10, 4.24) because a stream controller can be live without the configured flag, so the change was reverted. A smaller control, or one that hides when no controller has ever reported, is the owner's call.
3. **Changing the event's dates after registration holds every fight.** Registrations carry the days a person attends (`attend_dates`); moving the event (as the rehearsal did to make "today" the first day) leaves every attendance on the old days and every fight "held: not attending today". Real events rarely move; if one does, the organizer must re-date attendances (Set up › Registrations) or the hold rule should follow the event. Recorded, not changed.
4. **Review before build with one straggler.** With one registration still pending, Set up's single next step is "Review 1 registration"; Build tournament sits beside it (run 13 check 58 accepts both). Whether building should lead once most are reviewed is a product call.

### Found, not fixed (follow-up)
- **Live refresh moves the reading position** on two rebuilt screens (`live-stability` re-run, §6): desktop Live ops after a live change (about 220 px, the attention list above re-flows) and the phone's public event page after a reconnect (about 100 px). The Pack 18 rule (`useAsync` refresh keeps data on screen; `.fade-in` fill backwards) holds for the data; the layout above the anchor changes height. The fix is to reserve the attention list's height or anchor the scroll (CSS `overflow-anchor` is already relied on); not done in Pack 26 because it was found in the last hour and a layout change needs its own browser verification.
- The database's `collate "C"` Lyst order (Lyst 1, Lyst 10, Lyst 2) is corrected on the counter phone only; `event_field_keys` / `counter_state` ordering on the server is untouched (no migration for a sort).
- The two first-time notification asks (install, push) share one "asked" key; acceptable.
- The registrations list is not live-refreshed while another organizer decides; a reload shows the change.
- `result_needs_review` pushes still route to the legacy `/manage?tab=eventday` address, which redirects to Event Control.
- Old real-stack suites that encode screens replaced by Pack 25 (`eventday-live.mjs` Pack 09A Event day, `finalize-live.mjs` Pack 09C Review tab) are superseded by `pack25-live` and `pack26-live`; they were not rewritten. Their stack runner (`eventday-live.sh`) is still the shared runner for every suite.

## 10. Final verification

Levels kept apart. **Hosted database: not touched. Deployment: none.**

| Level | Result |
| --- | --- |
| Repository | branch `ccr-ba2f7d4b-7bn1n5`, every change committed and pushed; one additive migration (`20261021000100_pack26_test_push.sql`), 18 problems fixed (§3), the rehearsal fixture and script, the UI/UX matrix, this log, the README and TEST_PLAN corrections, suite updates |
| Types, unit tests, build | `npm run typecheck` clean · `npx vitest run` **112 files, 1407 tests passed, 6 skipped** (one run on the loaded machine showed a single failure that two re-runs did not reproduce; recorded as a flake) · `npm run build` clean (the two chunk-size warnings as before) |
| Local database gate | `supabase/tests/run_all.sh` **DATABASE GATE PASSED** (50 ok; `pack26_gate` 18 checks; details §6) |
| The rehearsal in the running app | `pack26-live` run 20: **216 / 217** through all 15 phases; run 18: 213 / 217 with the first complete viewport sweep; every miss in runs 13–20 was either fixed in the product (§3 14, 15, 17, 18) or was the script's assumption (§6); the final run 21 is recorded below when it finishes |
| Permission matrix (run 20, `permission-matrix.json`) | 15 personas × 14 probes: a stranger is refused or sees nothing everywhere; a fighter and a volunteer see only their own registration row and taps; the desk, inspector, medic and announcer cannot write a result or move the queue; no day-staff role lists conflicts, grants roles or sees device codes or sessions; the head marshal lists conflicts and shows the Counter QR but cannot grant roles or see codes; the scorekeeper and marshal may score; the other event's organizer is refused everything; anonymous reads only the public Lyst state (official columns), the public event and fighter rows carry no account id, e-mail, phone or health column; no public page shows an operator name, e-mail, phone, medical or insurance detail |
| Viewport sweep (run 20, `viewport-sweep.json`) | 22 screens × 6 sizes = 108 pairs (+ the big screen at 1920): all fit, no covered control, no undefined / NaN text, no page errors |
| The other real-stack suites (final state) | `pack181` 176/176 · `pack10` 135/135 · `pack22` 71/71 · `pack22-history` 32/32 · `pack22-discipline` 56/56 · `pack22-review` 13/13 · `pack24a1` 83/83 · `pack24a0` 22/22 (then the superseded public block) · `device` 82/82 · `cc181` 148/148 · `pack14` 63/63 · `pack25` 81/81 · `pack13` 89/89 · `broadcast-realtime` 15/15 · `pack15` 41/42 (check 34 wanted "2 fights away" in the hint: the hint now says it; re-run pending the rebuilt app) · `arena` 50/51 (the superseded classic-scoreboard tail) · `announcer` 180/181 (its own `counter_state` expectation) · `pack16` 30/33, `live-stability` 42/45 (two follow-up findings, §9), `finalize`, `pack09d`, `rumble`, `eventday`, `represented-team`: superseded screens (§6, §9) |
| Browser evidence | `docs/reviews/assets/2026-10-07-pack26/`: 64 phase screenshots, the device and matrix screenshots, the phone-width sweep screenshots, `evidence.json`, `permission-matrix.json`, `viewport-sweep.json` (run 20; 256-colour PNGs) |
| Hosted | inspected read-only earlier in the pack (`notification_text` body compared); nothing written; the migration is **not applied**; nothing deployed |
