# Phone simplicity and public UI fixes

Codex and the owner's existing local Claude bridge implemented and reviewed the 14 findings from the October 20 UI audit. Claude changed the Formats and Rules presentation, then reviewed the combined implementation in three rounds. The final source review found no remaining high or medium issues and ran `node tests/ui-simplicity.mjs` (typecheck and 30 focused tests).

## Changes and verification

| # | Finding | Resolution and evidence |
|---|---|---|
| 1 | Setup traps the wrong account | Account remains accessible during setup; Welcome links to account switching/sign-out. Browser rehearsal signed an unfinished fixture account out without saving its profile. |
| 2 | Past event still says Now fighting / Live | Shared public presentation distinguishes explicit closure from scheduled dates ending. Live, Arena and Announcer label retained state Last recorded; connection health says Connected. Browser checked the existing Practice test tomorrow queue and 2–5 score, without a running clock. No fights, clocks or queues are changed by date. |
| 3 | Empty season gives impossible advice | No-season state offers See all-time rankings; independent errors have Retry controls. Browser followed the recovery to Keston Piche's recorded competitions. |
| 4 | Upcoming results imply fighting and repeat empty cards | Not started and one expandable list of competitions awaiting draws. Browser checked Red Deer Rumble's 17 competitions. |
| 5 | Tier table disagrees with calculator | One source selection drives both; each disputed tier displays the alternative sourced value. Browser checked base 11 produces Regional 13.75 or 16.5 for the respective sources. Official ranking mathematics is unchanged. |
| 6 | Formats exposes obsolete ingestion notes | Replaced with links to the current official Rules library. |
| 7 | Upcoming test appearances lack badges | Added the existing Test data badge to fighter and team upcoming appearances. Browser checked Garrett Robson's fictional upcoming event; team rendering reviewed in source. |
| 8 | Home mistakes failed loading for no events | Error state, Retry and Browse events. Stopped the disposable local API, observed the error without a false empty state, restored the API and successfully retried. |
| 9 | Secretary description promises organizer powers | Correct role description and explicit link to the scoring screen; organizer owns fight order. Browser verified secretary-only tools and organizer-only controls separately. |
| 10 | Roster summary excludes unspecified gender | Compact summary counts the whole public roster; detailed groups remain. Browser checked seven fighters and the three unspecified entries. |
| 11 | Fees and requirements buried | Cost and registration deadline precede the main action; fees/volunteering are early; full organizer description remains expandable. Verified at phone width. |
| 12 | Rules search buries summaries | Five initial official matches, Show all/Show fewer, direct summary jump with keyboard focus. Browser checked grounded: 59 official matches and seven summaries. |
| 13 | Directories mix test clutter and duplicate locations | Test data off by default, explicit switch, canonical location choices and clear controls. Fighters filter on the server before count/range and discard stale results when filters change. Browser checked 14 untagged fighters versus 226 including test data, search/reset, teams, and one Alberta event option. Untagged records are not guessed to be fictional. |
| 14 | Card Studio missing from navigation | Mobile/desktop More links to the existing production Card Studio alias with a new-tab notice. No Card Studio assets, drafts or photos changed. |

## Organizer control and scoring rehearsal

Used an isolated worktree and disposable local PostgreSQL 17 database built from migrations. The real app, PostgREST, SQL permissions/RPCs and device-session handler were used. Organizer moved a fight with phone buttons, saved and reloaded its order; staff, announcements, broadcast, devices and check-in remained available. Secretary saw the focused current/next/in-hole desk. A counter device bound through its QR code submitted three points; the secretary ended the round, used the submitted tally, awarded 3–1 and saved the fictional match. The UI confirmed the result official on the server and offered the next fight.

Authentication in this rehearsal was an explicit loopback-only fixture, **not hosted Supabase Auth**. Storage was a test double and Realtime used the existing polling fallback. These checks do not establish hosted Google/email sign-in or physical-phone performance. Hosted sporting records were not used for mutation tests.

## Database and checks

The hosted database already contained the 13-column `public.fighter_directory` view. The additive migration preserves that definition, column order, public fields, `security_invoker` and anonymous/authenticated SELECT access. The client reuses its synthetic flag before pagination. It creates no parallel data system and changes no sporting rows. Hosted ledger: `20261020212759_public_fighter_discovery` (repository migration `20261020210104_public_fighter_discovery.sql`). Hosted sporting row counts after application: 948 matches and 660 results. Supabase security advisors: five findings before and after, none added.

The new rollback-only SQL gate checks 1,500 fictional and 30 untagged fighters, filtering before pagination, the second page, the public column list and invoker security, and read-only anonymous/authenticated access. The fingerprint runner now normalizes PostgreSQL's Windows CRLF output before comparing the same object hashes.

Final local unit suite: 1,435 passed, six existing skips. Typecheck and production build passed. Phone checks cover 390px and the Formats notice at 320px; the source notice's overflow was found and fixed during browser testing. Full database gate and GitHub release status are recorded with the release after completion.
