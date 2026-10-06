# BuhurtOS unfinished-work audit (2026-10-06)

Investigation and reconciliation only. Nothing was merged, deployed, migrated, configured or deleted during this audit.
Every hosted-database observation below came from read-only catalog / `select` queries or the Supabase advisors.

Excluded and not modified: **Pack 22** (rules system, BI rules ingestion and archive) and **Pack 18.1** (hosted device /
session rollout). Their branches were only read to find dependencies and collisions.

Evidence sources used, in order of trust:

1. Git: `origin/main` (`56b1d8a`, 180 commits since the 2026-10-03 history reset), all 43 remote branches, ahead/behind counts.
2. GitHub: every PR (#1 to #42), recent Actions runs (CI and Deploy, the manual Reavers production smoke, the one-shot proof workflows).
3. Hosted Supabase `mvbxlebznlgroptwwdsm`: migration ledger, object existence, row counts, cron jobs, storage buckets, Edge Functions, security advisors.
4. Cloudflare: the deployed `buhurtos-eventai` Worker source.
5. Claude Code sessions list and the transcripts of idle sessions that left no pushed branch.
6. Repository docs: `docs/claude-packs/STATUS.md`, pack docs, runbooks, owner decisions, reviews.
7. Other repos of the owner that hold BuhurtOS-related work: `BuhurtOS-old`, `Red-deer-reavers`, `Reavers-Site` (read-only clones).

---

## 1. Executive summary

* **Packs 09A to 18 and the Reavers membership work are merged, migrated to hosted, and deployed.** `STATUS.md` on `main` is
  stale for Packs 15, 16, 18 and Reavers: it still says "not merged, not deployed" for all four. Git, PRs #34 to #41, the
  hosted ledger and CI run #123 all contradict it. The docs commits that would correct it are stranded on an unmerged branch
  (`ccr-3bd35daf-l3kwz6`).
* **What is still missing on almost every pack is the same thing: production browser checks and physical-device checks.**
  Each release session was blocked from `github.io` and `supabase.co` by its network policy. Every real-device checklist in
  `docs/runbooks/` has **0 boxes ticked**.
* **There is now a proven way to close that gap without a person.** The manual GitHub workflow
  `reavers-production-smoke.yml` drove the live sites from GitHub Actions and passed (run 37416249903). The same pattern can
  produce production evidence for Broadcast, Command Centre, check-in, sign-in and the notification popup.
* **The most important unfinished work was not in the brief.** Packs **23R / 24A0 / 24A1** were built today (2026-10-06) on
  `claude/focus-layout-tablet-safety-b40tc4` and are idle, not active:
  * The 23R rehearsal found that `build_schedule('replace')` **deletes an active fight and its live score events**, and that
    organizers can DELETE/PATCH `matches` through the table API **without audit**.
  * Pack 24A0 fixes both: 128-check gate, 41/41 browser checks.
  * It is **not merged and not applied to hosted**, so the hazard is live in production. This is the top P0.
* **Migration version collision.** Three branches each add a migration numbered `20261015000100`: Pack 18.1
  (`pack181_event_sessions`), Pack 22 (`pack22_rules_library`) and Pack 24A0 (`pack24a0_match_safety_guards`). Pack 22's
  `20261015000200` also collides with Pack 18.1's.
* **Two published "test" events in production are not marked as test data.** `test-stuff-test` and `test-new-test` are
  real-flagged, published events. This conflicts with the owner decision that test data must be identifiable.
* **Event AI is half-done.**
  * The protected Worker is deployed. Its live code is byte-for-byte the code on branch `claude/buhurtos-eventai-deploy-2ksymo`.
  * The Worker source is **not on `main`** (PR #29 is still open), and **no "Create with AI" UI exists**.
  * An authenticated `draft_event` call was never recorded as proven.
  * Its draft schema predates Pack 09D Quick Setup, so it no longer matches how events are created.
* **The BI team directory (≈347 teams) and the `/preview/claude` / `/preview/chatgpt` mock-ups live only in the separate repo
  `BuhurtOS-old`.** That repo uses a different Supabase project (`tapfpboszgoftbwcwsmn`). Current hosted BuhurtOS has 20 teams.
  * The owner chose a **full reset** on 2026-10-01, which is why this work stayed behind.
  * The Claude visual shell **was carried over**: `src/styles/app.css` uses the preview's exact design tokens.
  * BI enrichment is superseded / not active.
  * The old repo still runs a **daily scheduled BI scrape** that commits to it.
* **Two Reavers websites exist** and need one canonical choice:
  * `Red-deer-reavers`: members area, dues and AGM, wired to BuhurtOS auth.
  * `Reavers-Site`: the medieval redesign, which pulls BuhurtOS events.

## 2. Current state of BuhurtOS

| Layer | State (verified 2026-10-06) |
| --- | --- |
| `main` | `56b1d8a` (merge of PR #41). Contains Packs 00–16, 18, the broadcast blank-screen fix, the notification popup, Reavers parts 1–2 and the production smoke workflow |
| CI on `main` | `CI and Deploy` #123 on `56b1d8a`: typecheck/unit/build, database gate, browser suites, release policy, Deploy GitHub Pages: **success** |
| Production hosting | GitHub Pages (`https://dothecoolwip1.github.io/BuhurtOS/`; Site URL confirmed by the owner per the stranded Pack 18 STATUS). `vercel.json` exists for PR previews only |
| Hosted ledger | 59 rows, through `pack18_command_centre`, `club_membership_dues_voting`, `club_fee_waiver_and_agm`, plus four `pack181_*` rows (Pack 18.1 rollout, excluded) |
| Hosted objects outside the ledger | Packs 02 (remainder), 03, 04, 05, 07, 1, 07/1 reconcile and 08 were applied through the SQL Editor. Spot-checked present: `record_tie_decision`, `result_revisions`, `enter_official_result`, `result_proposals`, `command_schema_ok`, `fighter_identity_reviews`, `result_rows_all`, `add_my_gallery_photo`, `add_waiver_version`, `create_competition`, `my_event_relations`, `add_entrant`, `create_unclaimed_fighter`; `private.is_any_organizer` is gone (the Pack 01 drop happened) |
| Edge Functions | `send-push` v6 (active), `device-session` v6 (Pack 18.1, excluded) |
| Cron | `purge-medical-notes`, `purge-activity`, `push-sweep` |
| Data | 19 events, of which 3 are flagged real: `red-deer-rumble-2026`, `test-stuff-test`, `test-new-test` (all published). 124 fighters (4 real), 20 teams, 13 auth users |
| Real usage signals | 3 push subscriptions, 3 notification preferences, 7 push deliveries in state `sent` (latest 2026-10-06 02:10 UTC), 1 inspection, 1 sponsor, 1 announcement, 4 club memberships, 1 officer |
| Security advisors | No ERROR. WARN: `auth_leaked_password_protection` (accepted plan limit), `extension_in_public` (`pg_net`), `function_search_path_mutable` on **`private.result_revisions_append_only`** (Pack 02 trigger function; new finding, small fix), `anon_security_definer_function_executable` (9 intended public reads: `fighter_profile`, `team_roster`, `pool_standings`, `push_public_key`, `report_bug`, `track_*`, `fighter_claim_states`, `list_active_organizations`), `authenticated_security_definer_function_executable` (accepted class). INFO: 32 tables with RLS and no policy (server-only by design) |
| Calendar | Registration opens **Nov 1**, Red Deer Rumble **Nov 14–15, 2026** (owner decisions, export runbook) |

## 3. Active work excluded from this audit

| Workstream | Branches | State observed (read-only) | Session |
| --- | --- | --- | --- |
| Pack 22 rules system | `pack22-bi-sources` (10 ahead), `ccr-321cc545-1coq4p` (16 ahead), `ccr-992bd40c-esloid` (3 ahead) | Migrations `20261015000100_pack22_rules_library`, `20261015000200_pack22_bi_document_inventory`; one-shot BI PDF fetch workflows ran (success) | "BuhurtOS Pack 22 rules system" RUNNING |
| Pack 18.1 hosted rollout | `pack18-1-event-ops` = `ccr-eccb0a09-qway7a` (30 ahead), PR #42 open; plan branch `ccr-ef74f1c4-1ks28z` (docs) | Four `pack181_*` migrations already on hosted; `device-session` deployed; PR #42 CI #128 green | "Pack 18.1 hosted rollout" RUNNING |

Dependencies these two create for everything else are listed in section 10 (blocked items) and the backlog.

## 4. Completed work verified during this audit

"Verified" here means the repository, merge state, CI, hosted DB and Pages deploy agree. Production browser behaviour is
called out separately because it was almost never checked.

| Item | PR / merge | Hosted DB | Deploy | Production browser / device |
| --- | --- | --- | --- | --- |
| Packs 01–08 + Pack 1 (security, integrity, scoring, runtime, identity, UX, entrants) | on `main` | Present (SQL Editor, outside ledger); `is_any_organizer` dropped | yes | not driven in a browser |
| Pack 09A–09D, team discipline totals | on `main` | ledger rows present | CI #80–#90 | not checked (network block) |
| Pack 10 career profiles | on `main` (`0659661`) | `pack10_career_profiles` | CI #92 | not checked |
| Pack 11 dress rehearsal + withdrawal progression | PR #30 merged | `pack11_*` (2 rows) | yes | The full rehearsal proof passed in GitHub Actions: workflow "Pack 11 Withdrawal Fix Proof" run #8 (37343717442, success), so STATUS's "sections 15–19 pending" is stale. Real phones: no |
| Pack 12 installable app + push | PR #31 merged | 3 rows, `send-push`, `push-sweep` cron | yes | push sends recorded on hosted (7 `sent`); receipt/tap on a phone not recorded |
| Pack 13 Lyst Control | PR #33 merged | 4 rows | yes | checklist 0/29 |
| **Pack 14 Broadcast** | **PR #34 merged** (`ed9fb3b`) | `pack14_broadcast`; tables, bucket `sponsor-logos`, policies present | CI #105 deploy success | **not verified**; the OBS checklist is 0/8. One sponsor row exists on hosted, which suggests someone used Manage › Broadcast after the fix |
| Broadcast blank-screen fix | **PR #35 merged** (`8d71688`) | n/a | CI #107 | owner's phone was "the real check"; no record |
| **Pack 15 installable alerts** | **PR #36 merged** (`6d9f137`) | `pack15_event_day_alerts` | CI #109 | device runbook not performed |
| Notification popup (compact settings + first sign-in prompt, kept off event-day screens) | **PR #39 merged** (`532fbab`) | n/a | CI #117 | not recorded |
| **Pack 16 readiness** | **PR #37 merged** (`90ff429`) | `pack16_readiness`, `pack16_inspection_alerts` | CI #111 | not verified; QR camera untested |
| **Pack 18 sign-in + Command Centre + live-update fix** | **PR #38 merged** (`e880e09`) | `pack18_command_centre`; checked read-only on the stranded branch | CI #113 | runbook §3 owner check outstanding |
| Reavers membership, dues, voting, fee waiver, AGM data | PRs #40, #41 merged; `Red-deer-reavers` PR #1 merged | both club migrations | CI #120, #123 | **verified in production** by "Reavers production smoke (manual)" run #2 (success, after #1 failed at a checkbox click that #41 fixed) |
| Claude visual shell | carried into `src/styles/app.css` (identical `--ground`, `--ink`, `--brass`, `--live` … tokens to `BuhurtOS-old/ideas/testing/index.html`) | n/a | yes | n/a |

## 5. Unfinished work

Each item below is expanded in the backlog (section 11). Classification key: COMPLETE BUT UNVERIFIED, LOCAL/BRANCH COMPLETE,
HOSTED WORK MISSING, PARTIALLY IMPLEMENTED, PLANNED ONLY, OBSOLETE, BLOCKED.

| # | Item | Classification |
| --- | --- | --- |
| U1 | Pack 24A0 match safety guards (+ Pack 23R report) | LOCAL/BRANCH COMPLETE (hazard live on hosted) |
| U2 | Pack 24A1 focus layout / tablet safety | LOCAL/BRANCH COMPLETE (stacked on 24A0) |
| U3 | Production browser verification for Packs 14, 15, 16, 18 and the popup | COMPLETE BUT UNVERIFIED |
| U4 | Physical-device checklists (push, Lyst, OBS, QR, iPhone Home Screen) | COMPLETE BUT UNVERIFIED |
| U5 | `STATUS.md` on `main` stale; correcting commits stranded | PARTIALLY IMPLEMENTED (docs) |
| U6 | Published real-flagged test events on hosted | data-integrity defect |
| U7 | `create_unclaimed_fighter` on a synthetic event creates a non-synthetic fighter | PARTIALLY IMPLEMENTED (known since 2026-10-04, unfixed; no leaked rows on hosted today) |
| U8 | `private.result_revisions_append_only` mutable search_path | HOSTED WORK MISSING (small additive migration) |
| U9 | Migration version collisions across Pack 18.1 / 22 / 24A0 | BLOCKED on merge order of active packs |
| U10 | Event AI: Worker source not on `main`, no UI, auth flow unproven, schema predates Quick Setup | PARTIALLY IMPLEMENTED |
| U11 | Pack 24 programme beyond 24A0/24A1 (24A3 running order, 24A2 secretary verbs, 24A4 tablet controller, 24B2 paper, 24B1 Live, 24C, 24D, Format Pack) | PLANNED ONLY; BLOCKED on 4 owner decisions |
| U12 | Production export before the Rumble (owner decision) | PLANNED ONLY / owner action |
| U13 | Branch protection on `main`, `PRODUCTION_FROZEN` before the Rumble | owner action, unverified |
| U14 | Public Now-and-next order bug (`liveView.ts:88`, In the hole before On deck) | fixed on the 24A0 branch only |
| U15 | `README.md` still says "preview build on sample data, Supabase not connected" | stale doc |
| U16 | UX items from earlier audits (section 8) | mixed |
| U17 | Daily BI scrape still running in `BuhurtOS-old` | OBSOLETE but active |
| U18 | Two Reavers websites | needs owner decision |
| U19 | Reavers: President / Secretary officer accounts not assigned | owner action |
| U20 | Account hub "private medical autofill" (old PR #14) | OBSOLETE as code; idea only (P4) |

## 6. Stranded branches / PRs

Main history was reset on 2026-10-03. The nine `claude/*` and `ccr-c5958883` / `ccr-8133f718` branches share **no merge
base** with `main`. Their content was carried into `main`'s first migrations (`20261001*`), which match the hosted ledger.

| Branch / PR | Ahead of `main` | What it holds | Equivalent on `main`? | Recommendation |
| --- | --- | --- | --- | --- |
| `claude/focus-layout-tablet-safety-b40tc4` (contains `ccr-1138edea-jygf5t`) | 4 | Pack 23R report + rehearsal, **24A0 migration `20261015000100_pack24a0_match_safety_guards`**, 24A1 FocusLayout | No | **Merge after re-numbering the migration** and rebasing past Pack 18.1/22 (overlaps: `STATUS.md`, `App.tsx`, `FieldPage.tsx`, `LystScoring.tsx`, `app.css`, `schema.fingerprint.txt`, `run_all.sh`, `security_gate.sql`, `pack09a/09d` gates). Apply 24A0 to hosted. No PR exists yet |
| `ccr-3bd35daf-l3kwz6` | 5 (docs) | Pack 14 / Pack 18 STATUS release rows, Pack 18 hosted checks, owner-confirmed Auth URLs, leaked-password decision | No | **Cherry-pick the docs** (`3958062`, `3848add`, `be8be5f`, plus `d0a75c7` if not superseded) into a STATUS-reconciliation PR |
| `ccr-1febaccf-u52yvh` | 1 (docs) | Records that the owner ran the 2026-10-04 SQL Editor rollout, fingerprint identical, and the unclaimed-fighter finding | No | Cherry-pick into the same STATUS PR |
| PR #29 `feature/cloudflare-ai-event-assistant` (open) + `claude/buhurtos-eventai-deploy-2ksymo` | 10 / 12, 108 behind | Worker source, lockfile, `src/lib/aiEventAssistant.ts`, `docs/runbooks/CLOUDFLARE_AI.md`, CLAUDE.md additions | No | Use the **deploy branch** (it has the pinned lockfile). Rebase onto `main` without the CLAUDE.md edits, or close #29 and open a fresh PR. Do not merge until the UI decision is made (section 11, P2) |
| `pack11-proof` | 2 | Temporary proof workflow (both runs failed; the later `pack11-withdrawal-fix` proof passed) | Superseded | Abandon (keep the branch; nothing to merge) |
| PR #14 `claude/account-profile` (open) | pre-reset | Account hub, private medical/emergency autofill, photos | Partly: photos (`fighter_avatar`), profile editor (`ProfileEditPage`). Its migrations reuse version numbers `20261001002500–2900` that `main` uses for different files | **Close as superseded**. Record "private medical autofill" as a P4 idea |
| PR #11 `claude/test-tournament` (open) | pre-reset | Test tournament seed, cleanup, simulation | Yes (`supabase/seed/test_tournament*.sql`, `supabase/tests/simulate_tournament.sql`) | **Close as superseded** |
| `claude/nacl-test-league`, `team-manager`, `inspiring-*`, `team-page-admin-perms-uj82pe`, `ccr-c5958883-092ttu`, `ccr-8133f718-vqcw9z` | pre-reset | Merged before the reset (PRs #1–#28) | Yes (carried in the reset) | Leave; no action |
| `pack14-broadcast`, `fix-broadcast-blank`, `pack15-installable-alerts`, `pack16-readiness`, `pack18-command-centre`, `ccr-7236f25c-0u60ip`, `ccr-f3ffa4b5-htzvr1`, `pack09*`, `ccr-2b377afe`, `ccr-bb795d78`, `ccr-b436c25f`, `ccr-1c6a5a85`, `pack11-withdrawal-fix`, `fix-team-rankings-categories`, `ccr-a435c5f7`, `ccr-c43bcea7`, `ccr-3b8f5e2b` | 0 | Fully merged | Yes | Leave (owner may delete later; not done here) |
| Session "Pack 24 UI/UX review" (branch `ccr-f91d13b0-nc9m9t` was **never pushed**) | n/a | The whole Pack 24 decision record exists only in that chat: one-lyst model, secretary runs the day on a tablet, fight numbers that stay with the fight, fun fights / lunch as running-order rows, TV board, paper printout, best-of-three | Partly: 23R's report covers most of it | Write the decided points into `docs/claude-packs/` before starting 24A3 so they are not lost |
| `BuhurtOS-old` repo | n/a | BI team directory (≈347 records, provenance, geocoding), `/preview/claude` + `/preview/chatgpt`, the old app on Supabase `tapfpboszgoftbwcwsmn` | Visual tokens yes; BI data no | Treat as archive. Disable its daily `sync-bi-teams.yml` schedule (owner) |

## 7. Hosted / deployment gaps

| Gap | Evidence | Action |
| --- | --- | --- |
| **24A0 not on hosted**: organizer table-API DELETE/PATCH on `matches` and `build_schedule('replace')` can destroy an active fight | 24A0 STATUS row: hosted `matches` has pre-migration grants, no `hold_manual` column | Merge, then apply via `apply_migration` (additive) |
| No production browser evidence for Packs 09A–18 | Every release note says "blocked by network policy" | Extend the manual production-smoke workflow (it reaches production) |
| No physical-device evidence | 0 ticked boxes in `REAL_DEVICE_PUSH_CHECKLIST.md` (0/21), `PACK13_REAL_DEVICE_CHECKLIST.md` (0/29), `PACK14_OBS_SETUP.md` (0/8); `PACK15_DEVICE_RUNBOOK.md` and `REAL_PHONE_REHEARSAL.md` have no recorded results | Owner, with phones and a tablet; one session before Nov 1 |
| `result_revisions_append_only` search_path | Security advisor WARN today | Tiny additive migration (`alter function … set search_path = ''`), same pattern as Pack 18.1's camera-log fix |
| `pg_net` in `public` | Advisor WARN since Pack 12 | Accept and document (moving it risks `send-push`); P4 |
| Test events flagged real | `test-stuff-test`, `test-new-test` published, `is_synthetic('event') = false` | Owner: mark synthetic, archive, or `delete_event` if still a disposable draft |
| Auth settings not all recorded | Stranded Pack 18 row: Site URL / redirects confirmed. Confirm email, Secure password change, min length and SMTP "not reported" | Owner checks the dashboard (runbook §1) |
| Production export not taken | `PRODUCTION_EXPORT_AND_RESTORE.md`: "the real production export has not been taken" | Owner, close to Nov 14, stored in two places |
| Event AI Worker | Deployed code = branch code; health and 401 work by design; authenticated `draft_event` never recorded | One authenticated call (owner or CI secret) |

## 8. UX / product gaps

Checked against the current code on `main` (`56b1d8a`). The source wording comes from
`docs/reviews/2026-10-03-full-site-mobile-desktop-audit.md`; `REVIEW_FINDINGS_2026-10-03.md` covers only backend items.

| Area | Verdict | Evidence / what remains |
| --- | --- | --- |
| Loading / error / retry | **PARTIAL** | `useAsync` keeps the last good data and exposes `reload` / `refreshError` (Pack 18). `ErrorBoundary` wraps the app and the outlet. Retry buttons exist on Team manager, Account, Your Day, the join inbox and the field / scoring screens. **No retry** on Events, Teams, Fighters, Fighter, Team, Rankings or Organization pages, which show a bare `role="alert"` paragraph. There is no shared error/empty component. **Bug:** the signed-out Home (`HomePage.tsx` LiveHome) ignores `live.error`, so a failed load reads "No upcoming events yet" |
| Captain inbox visibility | **PARTIAL** | The inbox lives at `/team-manager` (`JoinRequestInbox`), with a Home card "N join requests are waiting", an Account row and bell notifications. **Missing:** no badge on the nav or bottom bar, and nothing on the team page |
| Roster route prominence | **OPEN** | The "Roster" button goes to the public `/teams/<slug>#roster`. No roster-management route exists; the only captain tool is a collapsed "Manage the public roster" (show/hide) on the public team page |
| Pending member counts | **FIXED** (on team-manager surfaces) | `{waiting} pending` chip, Account and Home counts; still absent from the team page and nav |
| Edit Team visibility | **FIXED** | A primary "Edit team" button on `TeamPage` when `fetchTeamEditRights` allows it; also in `CaptainPanel` |
| Team emblem save/cancel | **OPEN** (by design, still wordy) | The emblem still saves immediately ("Saves immediately … Discard changes cannot undo it"), unlike the shield and form. Save still navigates back with no success message |
| New-team form progressive disclosure | **FIXED** | Three optional collapsed `<details>` sections; error sections reopen and focus the first error |
| Historical "Captain" vs authority | **PARTIAL** | Fighter page fixed ("Captain · team history" + note). **Team page roster** still shows the plain "Captain" chip for both real authority (`is_captain` from `team_roles`) and a membership role of `captain` without authority (`TeamPage.tsx:200-201`) |
| Mobile: scoring screen under site chrome / bottom bar | **OPEN on `main`**, fixed on branch | FieldPage is still inside `<Layout>`. `FocusLayout` exists only on the 24A1 branch (P0-1) |
| Mobile: other 10-03 items | mixed | Tables scroll (addressed). Tab strips have fade/snap (addressed). Tap targets are 40–44 px except "← Back" links. **Open:** bottom-nav label contrast (11 px `#8A93A3`); brass/test chip contrast; `h1 { overflow-wrap:anywhere }` still breaks words mid-word; the `/marshal` demo page is still public (`App.tsx:96`); the stale check-in copy "The signed waiver is not recorded in registration data yet…" (`CheckinPanel.tsx:94`). Not re-checked: the 8k px public event page and the long Run tab (later packs changed them) |
| Homepage | **PARTIAL** (deferred by the owner) | Signed out: hero, next-event CTA, Coming up and league cards. Signed in: `YourDay` strip + Coming up. **Missing:** a newcomer-first explanation (the "list" jargon is unchanged), a real featured-event card, and use of the empty desktop right half. Treat as P4 unless the error-as-empty bug (P3) is fixed with it |
| Notification popup / first sign-in prompt | **FIXED** | `NotificationDialog` (first: Not now / Enable Notifications; settings: Cancel / Save / Manage devices). `NotificationOnboarding` appears only on calm pages. Mounted in `Layout`. Production behaviour not recorded (P1-1) |
| Create with AI | **NONE** | Nothing in `src` (P2-3) |
| Access codes / `/ops` / first admin / zero events | **No access-code or `/ops` system exists on `main`.** That work belonged to the pre-reset app and was not carried over; it is OBSOLETE unless re-requested | Platform owner is a manual `platform_roles` row by design (foundation migration; one owner on hosted). No organizer-approval request flow: `NewEventPage` says "ask the BuhurtOS owner", and Account shows "Create an event" to everyone (audit #17). Zero-event states are plain empty messages. **Recommendation:** P3, a "Request organizer access" action and hiding "Create an event" from non-organizers |
| Code markers | clean | No TODO/FIXME/XXX/HACK in `src` or `supabase`. Only the stale check-in waiver copy, and `eventDay.ts:175` noting that a "complete" competition state is a later pack |

P3 UX backlog items derived from this table (Sonnet, small each, no Pack 22/18.1 overlap except FieldPage, which 24A1 already
touches):
- the Home error-as-empty bug
- shared error-with-retry for the public directory pages
- the team-page Captain chip ambiguity
- a nav badge for join requests
- the stale check-in waiver copy
- the public `/marshal` demo route
- "Create an event" shown to non-organizers
- the request-organizer-access action
- bottom-nav and brass-chip contrast
- the h1 word-break rule
- the emblem save message
- a captain roster route (larger; it needs a product decision on captain roster editing, which `TEST_PLAN.md` says is "not offered")

## 9. Obsolete / superseded work

| Item | Why it is obsolete | Do not revive because |
| --- | --- | --- |
| `BuhurtOS-old` app and `/preview/chatgpt` | Owner chose a full reset on 2026-10-01. The current app is the rebuild | Different Supabase project; hash routing; superseded UI |
| `/preview/claude` mock-up | Its design tokens are already the production stylesheet | Nothing left to port |
| BI team enrichment (≈347 BI teams, geocoding, daily scrape) | Lives only in the old repo and project; the current product never imported it; Pack 22 handles BI *rules*, not teams | Re-importing is a new owner decision, not unfinished work. Public BI rosters must stay separate from BuhurtOS memberships if it ever returns |
| Old PRs #11, #14 | Content carried into `main` or replaced by later designs; #14's migration versions clash with `main` | Close |
| `pack11-proof` branch | Superseded by the passing `pack11-withdrawal-fix` proof | Abandon |
| Pack 24A1 as a separate pack | 23R recommends folding it into 24A4 (secretary tablet controller) | Still worth merging as-is: it fixes the bottom bar covering Start round at 390/768 px |
| Access codes, expiry/usage/revocation, protected `/ops` (pre-reset app) | Not present on `main` or hosted; the reset replaced them with Supabase Auth + platform/event roles (Pack 01 scoping, Pack 18 passwords) | Superseded by the role model. The remaining gap is an organizer-access request flow (section 8, P3), not the old codes |
| Earlier "first admin / zero-event bootstrap" concerns | The platform owner is a deliberate manual `platform_roles` row; one owner exists on hosted; test logins and Quick Setup exist | Re-open only with a reproduced failure |

## 10. Blocked items

| Item | Blocked on |
| --- | --- |
| Pack 24A3 running-order foundation (and therefore 24A2, 24A4, 24B2, 24B1) | **Owner decision 1**: authored running order or live planner. **Decision 2**: who the "secretary" is in authority terms (scorekeeper, head marshal or a new role) |
| Format Pack (best of three, two-entrant medals, exhibitions) | **Owner decisions 3–4** (Pack 23R §11). The Pack 24 chat recorded partial answers (flexible best-of-three, long axe = round robin for now, byes instead of wild cards); they need writing down |
| Merging 24A0 cleanly | Merge order with Pack 18.1 (PR #42) and Pack 22: migration numbers collide and eight files overlap. Renumber 24A0 (e.g. `20261017000100`) when rebasing |
| Physical-device verification | Hardware and a person (owner) |
| Production export | Production DB password (owner only) |
| Event AI end-to-end | A signed-in user token (owner) and a product decision on the UI (section 11) |
| Reavers officers | President (Kedrixx) and Secretary (Carm) have no accounts yet |
| Device notifications for event devices | Pack 18.1 (excluded) |

## 11. Prioritized backlog

Model guidance: **Opus** for anything that changes sporting data rules, permissions, migrations on shared tables or merge
reconciliation; **Sonnet** for docs, tests, single-screen UI and scripted verification.

### P0 — release / security / data integrity

**P0-1. Land Pack 24A0 match safety guards (with 24A1)**
- Pack / branch: 23R, 24A0, 24A1; `claude/focus-layout-tablet-safety-b40tc4`
- State: LOCAL/BRANCH COMPLETE; the hazard is live on hosted.
- Evidence: 24A0 STATUS rows; `pack24a0_gate.sql` 128 checks (68/125 fail on the old schema); `pack24a0-live` 41/41; `pack24a1-live` 83/83; Vitest 1045. Hosted `matches` still has the old grants.
- Already complete:
  - `build_schedule` refuses protected history and validates bracket shape.
  - Organizer raw INSERT/DELETE/structural UPDATE on `matches` is revoked; the remaining columns are audited.
  - `set_match_queue` is narrowed and audited.
  - Durable holds.
  - Public Now-and-next order fixed.
  - FocusLayout for field and check-in screens.
- Remains:
  1. Rebase onto `main` after or alongside Pack 18.1.
  2. **Renumber the migration** away from `20261015000100`.
  3. Regenerate `schema.fingerprint.txt` and re-run the full gate and the browser suites.
  4. Open the PR, then merge after the owner's OK.
  5. `apply_migration` on hosted plus read-only grant checks and advisors.
  6. Production check of a blocked rebuild.
- Remaining risks (from its own report):
  - Event day still saves its plan on open.
  - No hold UI exists.
  - `delete_event` ignores match history.
- Dependencies: merge order with Pack 18.1 / 22 (files overlap, no logic overlap found).
- Effort: medium. Model: **Opus**.
- Manual / Supabase step: hosted migration through the MCP; owner approves the merge.
- Avoids Pack 22 / 18.1: yes in code. Merge ordering must be coordinated, and nothing is changed on their branches.

**P0-2. Mark or remove the two real-flagged test events**
- Related: owner decision "Synthetic and test data"; hosted data.
- State: data-integrity defect. `test-stuff-test` and `test-new-test` are published, flagged real and appear publicly as real events. Any result entered on them would count toward official rankings.
- Remains: the owner decides (a) mark synthetic through the existing synthetic-flag path, (b) `archive_event` / `exclude_event_from_stats`, or (c) `delete_event` if still a disposable draft. Then run a read-only check.
- Effort: tiny. Model: Sonnet.
- Manual: yes (owner choice; an audited RPC as the platform owner).
- Avoids 22 / 18.1: yes.

**P0-3. Fix `create_unclaimed_fighter` on synthetic events**
- Related: Pack 08; finding recorded 2026-10-04 on stranded branch `ccr-1febaccf`.
- State: PARTIALLY IMPLEMENTED.
  - `supabase/migrations/20261004000300_pack08_entrants_and_claims.sql` inserts the fighter without a synthetic tag.
  - A live test on a fictional event would put an unlabelled fighter into the public directory and the claim search.
  - Hosted today: 0 real-flagged fighters whose only entries are in synthetic events, so nothing has leaked yet.
- Remains:
  - Additive migration: tag the new fighter synthetic when the event is synthetic.
  - Gate checks.
  - Hosted apply.
- Effort: small. Model: **Opus** (synthetic isolation rules).
- Manual: hosted apply. Avoids 22 / 18.1: yes.

**P0-4. Production export before the Rumble**
- Related: owner decision; `PRODUCTION_EXPORT_AND_RESTORE.md`.
- State: PLANNED ONLY. It has been rehearsed locally; the real export has never been taken.
- Remains: the owner runs the export close to Nov 14 and stores it in two places. An optional first export now adds safety.
- Effort: small. Model: n/a.
- Manual: yes (DB password). Avoids 22 / 18.1: yes.

### P1 — nearly done; one or two steps to be properly live

**P1-1. Production smoke for Packs 14 / 15 / 16 / 18 and the notification popup**
- Related: PRs #34–#39; the existing `.github/workflows/reavers-production-smoke.yml` + `scripts/e2e/reavers-production-smoke.mjs`.
- State: COMPLETE BUT UNVERIFIED. Deployed, migrated and CI-green, but no production browser evidence.
- Evidence: every release note says production hosts were blocked; the Reavers workflow proves GitHub Actions can reach production (run 37416249903 success).
- Remains: a manual `workflow_dispatch` workflow that, against production, read-only, opens:
  - Home and Sign in (email + password).
  - A published event page, and the livestream block if one is set.
  - `/broadcast/<slug>/<field>` read-only.
  - Manage › Broadcast as an organizer test account (no writes, or writes on a synthetic event only).
  - `/events/<slug>/command` as organizer, and refused as a fighter.
  - The check-in desk refusal for strangers.
  - The first-sign-in notification popup.
  - Screenshots and STATUS evidence.
- Use the existing `@buhurtos.ca` test accounts on a **synthetic** event only.
- Effort: small–medium. Model: Sonnet (Opus if it must write to production).
- Manual: test-account secrets in GitHub (already used by the Reavers smoke), and an owner-triggered run.
- Avoids 22 / 18.1: yes.

**P1-2. STATUS reconciliation PR**
- Related: `ccr-3bd35daf-l3kwz6`, `ccr-1febaccf-u52yvh`; `STATUS.md` on `main`.
- State: PARTIALLY IMPLEMENTED (docs).
  - Section headings still read "IMPLEMENTED ON BRANCH, NOT MERGED" for 15, 16, 18 and Reavers.
  - The top table still says Packs 01–07 hosted "NOT APPLIED".
  - Pack 11's "sections 15–19 pending" ignores the passing proof run.
- Remains:
  - Cherry-pick the stranded docs commits.
  - Correct the top table and headings from this audit's evidence.
  - Add a short "release ledger" table (pack → PR → merge SHA → hosted ledger version → CI run → production evidence).
- Docs-only. Coordinate with Pack 18.1 and Pack 22, which also edit `STATUS.md`: keep it to the sections they don't touch, or land it right after they merge.
- Effort: small. Model: Sonnet.
- Manual: none. Avoids 22 / 18.1: yes, with care on the shared file.

**P1-3. `result_revisions_append_only` search_path**
- Related: Pack 02; security advisor.
- State: HOSTED WORK MISSING.
- Remains: an additive `alter function private.result_revisions_append_only() set search_path = ''`, a gate check, the fingerprint and a hosted apply. Bundle with P0-3.
- Effort: tiny. Model: Sonnet. Manual: hosted apply. Avoids: yes.

**P1-4. Owner real-device session**
- Related: Packs 12 / 13 / 14 / 15 / 16; runbooks.
- State: COMPLETE BUT UNVERIFIED.
- Remains: one sitting with a phone, an iPhone and a tablet:
  - Install, push receipt, tap with the app closed.
  - Lyst Control on two tablets.
  - QR check-in camera.
  - The OBS browser source.
  - Tick the boxes in the runbooks.
- Do this after P0-1 lands, so the tablet screens tested are the final ones.
- Effort: medium (owner time). Manual: yes. Avoids: yes.

**P1-5. Auth dashboard settings record**
- Related: Pack 18 runbook §1.
- State: partly confirmed (Site URL, redirects); confirm email, secure password change, min length and SMTP are unrecorded.
- Remains: the owner reads the dashboard and the values go into STATUS.
- Effort: tiny. Manual: yes. Avoids: yes.

**P1-6. Release-freeze hygiene**
- Related: Pack 04; `EVENT_RELEASE_POLICY.md`.
- State: unverified.
- Remains:
  - The owner confirms branch protection on `main` and plans `PRODUCTION_FROZEN=true` for the Rumble window.
  - Remove `vercel.json` confusion only if the owner no longer wants Vercel previews.
- Effort: tiny. Manual: yes. Avoids: yes.

### P2 — important incomplete product functionality

**P2-1. Pack 24A3 → 24A2 → 24A4 → 24B2 (running order, secretary authority, tablet controller, paper running order)**
- Related: Pack 23R §10–12; the "Pack 24 UI/UX review" session.
- State: PLANNED ONLY; BLOCKED on owner decisions 1–2.
- Evidence: 23R found:
  - no day boundary
  - no stable fight number
  - holds erased by re-plan
  - filled bracket fights sent to the end
  - scorers able to call any fight while nobody can move one
- Already complete: 24A0's server guards and durable hold column (branch).
- Remains: all four packs. 23R calls them "must be built before the Rumble".
- Effort: large. Model: **Opus**.
- Manual: owner decisions, hosted migrations.
- Avoids 22 / 18.1: yes, but 24A4 will reuse Pack 18.1's device sessions for the secretary tablet, so it should start after 18.1 merges.

**P2-2. Format Pack (best of three, two-entrant medals, exhibition flag, withdrawn semifinalist, placeholder labels)**
- Related: 23R §10; Pack 24 chat.
- State: PLANNED ONLY; BLOCKED on decisions 3–4.
- Note: today an Exhibition-tier competition leaks into records (23R). This is a sporting-integrity item even if the rest waits.
- Effort: medium–large. Model: **Opus**. Manual: decisions, hosted migration. Avoids: yes.

**P2-3. Event AI "Create with AI"**
- Related: PR #29; `claude/buhurtos-eventai-deploy-2ksymo`; Worker `buhurtos-eventai`.
- State: PARTIALLY IMPLEMENTED.
- Evidence: the deployed Worker equals the branch source (auth through `/auth/v1/user`, Llama 3.3 70B, `draft_event` + `polish_description`, 12k input cap). There is no UI on `main`, no `VITE_AI_WORKER_URL` on `main`, and no recorded authenticated test.
- Already complete: Worker, client helper, runbook.
- Remains:
  - Decide whether this matters before the Rumble (recommended: no).
  - Re-map the draft schema to Quick Setup's model (categories, divisions, fields, organization/season).
  - One authenticated E2E call.
  - Add "Create normally / Create with AI" on `/events/new`; review-before-save only.
  - Commit the Worker under `workers/`.
  - Also consider per-user rate limiting and dropping `detail` from the 502 body.
- Effort: medium. Model: Sonnet for the UI, Opus for the schema mapping.
- Manual: a signed-in token for the E2E check; Cloudflare deploy if the Worker changes.
- Avoids: yes.

**P2-4. Write the Pack 24 decisions into the repo**
- Related: idle "Pack 24 UI/UX review" session.
- State: decisions exist only in chat.
- Remains: a docs file capturing:
  - one lyst
  - the secretary on a tablet runs the day
  - full category names with a stable fight number
  - lunch and fun fights as non-sporting running-order rows (with optional fun-fight winners, never counted)
  - team highlighting
  - lateness wording
  - flexible best-of-three handling
  - the cut line (TV board first to cut)
- Effort: tiny. Model: Sonnet. Manual: owner review. Avoids: yes.

### P3 — polish, cleanup, deferred improvements

**P3-1. UX items from earlier audits that are still open** (section 8). Effort: small each. Model: Sonnet. Avoids: yes.

**P3-2. `README.md` rewrite**
- It still describes a sample-data preview with no Supabase.
- Point it to `CLAUDE.md`, `START_HERE.md`, the commands and GitHub Pages.
- Effort: tiny. Model: Sonnet.

**P3-3. Close stale PRs #11 and #14 with a one-line reason**
- Effort: tiny. Manual: owner or an allowed session.

**P3-4. Disable the `BuhurtOS-old` daily BI scrape**
- `sync-bi-teams.yml`, cron `17 8 * * *`, still committing (last 2026-10-05).
- Archive the repo if the owner agrees.
- Effort: tiny. Manual: owner.

**P3-5. Pre-existing `arena-live` check failure**
- "a result on Field 2 leaves Field 1 alone": expected `active/on_deck`, got `on_deck/in_the_hole`.
- Recorded under Pack 13 and not in CI.
- Investigate whether it is a test or a product issue; it may be moot after 24A3.
- Effort: small. Model: Opus.

**P3-6. Pack 24A1 leftovers**
- Duplicated queue title and sync wording under the focus header.
- Tall readiness strip on phones.
- The desk filter row scrolls sideways on phones.
- Effort: small. Model: Sonnet.

### P4 — ideas, not worth implementing now

- **BI team directory re-import into current BuhurtOS.** Superseded; needs an owner decision and would have to keep BI rosters
  separate from memberships.
- **Private medical / emergency autofill from old PR #14.** It would add health data to accounts. CLAUDE.md requires that data
  never be public; the decision belongs to the owner.
- **Homepage storytelling redesign** beyond what exists (section 8). Deferred by the owner.
- **Reavers member-dashboard extras.** The core works: dues, eligibility, AGM tools on the club site. Wait for real AGM use (Oct 18).
- **Post-Rumble roadmap items** (`docs/ROADMAP_POST_RUMBLE.md`: offline sync engine, Broadcast + CDN snapshots, open results
  format, tamper-evident audit). The owner deferred these explicitly.
- **Move `pg_net` out of `public`.** Accept and document instead.
- **TV board, event-page section navigator, navigation/typography cleanup (24B3, 24C2, 24D).** These are first to cut per the
  Pack 24 discussion. The only exception is the one-line Now-and-next order fix, already in 24A0.

## 12. Recommended next 3 tasks (while Pack 22 and Pack 18.1 continue)

1. **Land Pack 24A0 + 24A1 safely (P0-1).** It is the only known path that silently destroys live sporting data, and it is
   live in production today.
   * It is already built and tested; what remains is reconciliation:
     * renumber the migration
     * rebase after or around Pack 18.1
     * re-run gates and browser suites
     * open a PR
     * after the owner's merge, apply the migration to hosted and check it read-only
   * Fold in P0-3 (unclaimed-fighter synthetic tag) and P1-3 (search_path), or ship them as a small separate migration right
     after. Both are tiny, additive and in the same area.
2. **Production smoke workflow for Packs 14–18 + STATUS reconciliation (P1-1 + P1-2).** This turns "deployed but never seen"
   into recorded production evidence using a mechanism already proven by the Reavers smoke. It also fixes the status ledger
   that every future session reads first, so nobody re-does merged work.
3. **Owner decision batch + docs (P0-2, P2-4, Pack 23R §11).** One short owner sitting:
   * mark or remove the two test events
   * answer the four 23R blocking decisions (authored order vs planner; who the secretary is; best of three; exhibitions)
   * a Sonnet session then writes the decisions file
   This unblocks the Pack 24A3 work that 23R says must exist before the Rumble, without starting it prematurely.

Deliberately **not** next: the Event AI UI, homepage storytelling, BI team re-import and the TV board. Each is a new feature
while P0/P1 items remain.

## 13. Suggested Claude model for each next task

| Task | Model | Why |
| --- | --- | --- |
| 1. Land 24A0/24A1 (+ unclaimed-fighter fix, search_path) | **Opus** | Merge reconciliation across three active migration streams, permission grants on `matches`, hosted apply and verification |
| 2. Production smoke + STATUS reconciliation | **Sonnet** (Opus only if the smoke must write to production) | Scripted browser checks modelled on an existing workflow; docs |
| 3. Owner decision batch + Pack 24 decisions file | **Sonnet** for the write-up; the owner decides | Capture and structure, no code |

## 14. Owner / manual actions that may eventually be required

1. Approve the merge of the 24A0/24A1 PR once it exists; confirm the merge order relative to PR #42 (Pack 18.1) and Pack 22.
2. Decide the fate of `test-stuff-test` and `test-new-test` (mark synthetic / archive / delete draft).
3. Answer Pack 23R §11 decisions 1–4.
4. Take the production export (DB password) and store it in two places before Nov 14.
5. Run the real-device checklists (phone, iPhone Home Screen, tablet, QR camera, OBS) and tick them.
6. Confirm the Auth dashboard values (confirm email, secure password change, min length, SMTP).
7. Confirm branch protection on `main`; set `PRODUCTION_FROZEN=true` for the Rumble window.
8. Trigger the new production smoke workflow (`workflow_dispatch`) once it exists.
9. Create accounts for the Reavers President and Secretary, then assign offices through `assign_team_officer`.
10. Choose the canonical Reavers website (`Red-deer-reavers` members/AGM vs `Reavers-Site` redesign), or decide how they combine.
11. Disable the daily BI scrape in `BuhurtOS-old` and archive that repo if it is no longer needed.
12. Close PRs #11 and #14 (superseded); decide whether PR #29 (Event AI) stays open until a UI decision.
13. Event AI: provide one signed-in test for `draft_event`, and decide whether "Create with AI" is pre- or post-Rumble.
