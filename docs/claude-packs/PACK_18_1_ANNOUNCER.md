# Pack 18.1: the Announcer view (what is built, how it was verified)

Route `/events/<slug>/announcer`. Chrome-less (no site header, menus or footer), `ErrorBoundary fullPage`, dark high-contrast palette whatever the site theme, tablet-first; phone and desktop work.
Plan: `PACK_18_1_PLAN.md` section 14. Interface it relies on: `PACK_18_1_CONTRACTS.md` (`announcer_readiness`, Camera Off, device sessions).

## 1. Who may open it
- A **permanent account** holding the `announcer` event role (also organizer, head marshal, marshal, scorekeeper: the same people `announcer_readiness` serves).
- An **Announcer device** (temporary event session, `bos_event_device`): device sign-in as Announcer lands here (see Contracts section 6).
- Everyone else can open the URL: the board itself is public sporting data (the same reads as the Arena). They get **no readiness chips and no Camera Off button**, because those two things are database-gated (verified, section 5).
- A draft event is not publicly readable: the screen says "This event is not public yet" (staff) / "This event is not available" and tells the reader to ask the organizer to publish it. A cancelled event says so.

## 2. What is on screen
One card per Lyst that still has something to fight, in the event's own order (Lyst 1, 2, 3; "Field N" is shown as "Lyst N", other names are kept). The order never changes because a fight started or ended.
- **Now fighting**: competition and round, red and blue fighter (name, team, crest or photo, public record, labelled "Test" for synthetic data), the **official score** (marshal-confirmed rounds, deductions applied; never a counter's tally, never the classic board's running snapshot), the round and the **ticking clock** (derived from the server clock, so a wrong tablet clock still shows the right time), warnings / cards / deductions / disqualification exactly as the overlay words them (the marshal's reason is never read).
- **Up next** (on deck): the two fighters and one **Ready / Not yet ready** per fighter (from `announcer_readiness`: booleans only, no reasons).
- **Coming up**: the next few fights on that Lyst (at most 5; "+ n more after these" when there are more). The bracket is not shown.
- **Recent results**: the last 8 finished fights of the event, newest first: names, winner, official score, basis (on score / by disqualification / technical result / walkover), competition, Lyst.
- **Fighter / team card** on tap: name, team, corner, competition, career record, record at this event, every earlier fight today (all of that fighter's entries across competitions, own side's score first). It keeps updating while it is open.
- **Focus Lyst N**: puts that Lyst first and shrinks the others. Local only (`localStorage`, `bos-announcer-focus:<slug>`); it writes nothing.
- **CAMERA OFF** (the shared `CameraOffControl`): the only thing on the page that does anything to the event. One tap opens the reasons, a second tap on a reason does it. While the cameras are off the page shows the CAMERAS OFF banner (reason, who, when) and the button is gone; an announcer cannot turn them back on (head marshal / event admin / organizer only).
- No input, textarea, select or form exists on the page.

Never shown: e-mail, phone, account ids, inspection notes, weigh-in, medical, emergency contact, admin notes, counter data, readiness reasons, the marshal's discipline reason or name.

## 3. Live updates do not reset the view
Every source refreshes in place (`useAsync refreshDeps`, `useArenaData`, `useLystPublic`, the readiness read): nothing remounts, nothing flashes "Loading", a failed read keeps the last good data. Scroll position, the focused Lyst and an open fighter card all stay (verified on a scrolled phone page, section 5). The page sits in a stale-aware shell: after 20 s without any good answer it adds "Not updating, last good HH:MM:SS" and keeps everything it had; it removes the note by itself when answers come back. No animation keeps a transform on a page-level element (that would switch off scroll anchoring).

## 4. Files
`src/pages/AnnouncerPage.tsx`, `src/lib/announcer/{viewModel,info,focus,stale}.ts` (pure, unit tested: `announcer.test.ts`), `src/data/announcer.ts` (reads only), `src/styles/announcer.css`, the route in `src/App.tsx`.
The view-model is a **whitelist projection**: every output field is copied by name, so a private field in an input cannot come out (the unit tests feed it dirty objects).

## 5. Verification (local, real stack; nothing deployed, hosted Supabase untouched)
`scripts/e2e/announcer-live.sh` (fixture `scripts/e2e/fixtures/announcer.sql`, scenario `scripts/e2e/announcer-live.mjs`): Postgres built from every migration, PostgREST, the real `device-session` handler, the real built app in Chromium. LOCAL EVIDENCE ONLY, not CI.
The day: three Lysts, five competitions, two simultaneous LIVE fights built with the real Pack 13 functions as authorized users (`lyst_open`, `lyst_timer_command`, `lyst_end_round`, `lyst_confirm_round`, `lyst_record_discipline`, `lyst_finalize`, `advance_field_queue`), Pack 16 check-in / inspection / weigh-in through the desk and inspector, five finished fights (one by disqualification), a card, a warning, a deduction, teams with crests.
- Layout at 390x844, 820x1180 and 1280x900: every section above, no sideways scroll, targets of 44 px or more, no clipped text, no text under 12 px, read-only (only Camera Off, Focus chips and fighter cards are buttons). Screenshots were looked at and the layout bugs found were fixed (section 6).
- Focus Lyst: 25 tables (queue, timer, rounds, discipline, counter tables, broadcast control, camera, announcements, audit, results ...) snapshotted before and after and diffed: no change; the page sent no write.
- Live changes on a scrolled phone page with Lyst 2 focused and a fighter card open: a round confirmed, a fight finished, the next fight started, a card given. Same root and card DOM nodes, no "Loading", scroll position unchanged, focus kept, the open card gained the new fight.
- Offline then reconnect: stale note appears, last good data stays, the note goes away on reconnect and the page catches up in place.
- Draft event, anonymous viewer, signed-in stranger.
- Camera Off: opened from the button (nothing happens until a reason is tapped); activated through the function as a marshal: banner appears, button disappears, release refused for the announcer; head marshal releases, button returns; the announcer's own tap works end to end and is recorded as role `announcer`.
- Privacy: every REST/RPC response the browsers received was captured and searched for e-mail addresses, every `auth.users` id (including the viewer's own), the inspection note, the weigh-in, the discipline reasons and a list of private column names: none found. `announcer_readiness` returns only `match_id`, `side`, `ready`. The only non-GET call the page makes besides read functions is `camera_off_activate`.
- Device token (minted HS256 `bos_event_device` JWT, `sub` = session id, from a credential + session created through the real functions): `announcer_readiness` and `camera_state` work (not for another event); `lyst_state`, `record_score_event`, `lyst_timer_command`, `set_match_queue`, `send_event_announcement`, `create_lyst_join_code`, `correct_result`, `lyst_open/confirm_round/finalize/record_discipline`, `advance_field_queue`, `camera_off_release`, broadcast control, command snapshot, desk functions, staff and credential lists, `device_open_session` and 26 tables (counters, join codes, discipline reasons, registrations, staff, audit, ...) are refused (4xx) or empty; direct writes to `matches`, `lyst_timer`, `results`, `event_staff`, `lyst_rounds` are refused; the database is byte-identical afterwards; Camera Off activation by the device works and is attributed to the device in the audit trail; a revoked session stops working at once.
  `counter_state()` is the one function that answers a device with HTTP 200: it is a counter's lookup of its OWN seat and returns `{seat: null}` for an announcer (no data).

## 6. Bugs found and fixed while verifying
1. **The fighter card ignored the fighter's other competitions.** Earlier fights and "At this event" were matched on the one entry shown, so a fighter entered in two competitions showed "No fights finished yet" next to a career line that already counted them. The card now takes every entry of that fighter / team (`fetchEntryCareer` returns `entryIds`; `earlierFights` accepts a set). Unit test added.
2. **Desktop: the two live Lysts could not sit side by side** (the results column left 848 px, the cards need 856) and, once they could, their corner layout followed the *viewport* width. Cards are now container-query sized (`.an-lyst`), the results column is narrower.
3. **Phone: the sticky top bar was 100+ px tall** (title, status and button on three lines) and 270 px with the CAMERAS OFF banner. It is now a compact two-row grid; the banner and the "not updating" note take their own compact row.
4. "1 events" in the card: singular / plural.
5. **The Camera Off reasons sheet was cut off at the right edge on a phone** (the shared `Dialog` drawer's grid track grew to the longest unbroken reason button). Fixed for this page only in `announcer.css` (`body:has(.ann) .dlg-bg ...`), because the dialog is portalled outside `.ann` and the shared stylesheet is not part of this pack. The same latent problem may exist wherever that sheet is used with long single-line buttons; not touched.
6. The top bar's status line was 11 px (below the 12 px floor the scenario enforces): 12 px.

Result of the last run: `scripts/e2e/announcer-live.sh` 181/181 checks; `npx tsc -b` clean; `npx vitest run` 88 files / 1020 tests (42 in `src/lib/announcer/announcer.test.ts`).

## 7. Not verified
Hosted Supabase and a deployed build (nothing deployed); real Realtime sockets (the local stack has none: the polling fallback was what ran); a physical tablet and a real venue network; the device-sign-in redirect to this route (it belongs to the device pages, not this pack's files).
