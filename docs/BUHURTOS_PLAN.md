# BuhurtOS delivery plan

Updated: 2026-09-24. This roadmap governs the new twelve-pack sequence. Earlier commits named “Pack 1” or “mega pack” are historical work, not evidence that these acceptance gates pass. Preserve `ORIGINAL_SCOPE.md`; this plan divides that scope into reviewable milestones.

## Delivery rules

Work on the existing application. Reproduce failures, preserve user changes, commit coherent milestones, and update STATUS and HANDOFF every pack. Keep local, CI, preview, and production evidence separate. Never replace migrations already applied to a deployed database. Recover divergent branch work selectively with regression tests. A visible control is not complete until its persistence, authorization, error path, and reload behavior are verified.

| Pack | Scope | Acceptance criteria |
| --- | --- | --- |
| 1 | Recover and stabilize | Inspect history, branches, configuration, migrations and CI; reproduce and repair baseline failures; deterministic clean install, typecheck, tests and build pass; main screens load in a browser; preserve unfinished work; save evidence and a bounded backlog. Record environment blockers explicitly. |
| 2 | Authentication and authorization | Confirm the intended Supabase project; document environment and redirect configuration; verify sign-in, magic link, account setup, password recovery, sign-out, session expiry and role loading. Test anonymous, fighter, captain, marshal, organizer and tenant isolation. No user can inherit another user's queued work. |
| 3 | Organizations, seasons and governance | Complete governing-body, organization, club, season and event relationships; scoped administration, invitations and role changes persist; archive/history and cross-organization denial tests pass. Support multiple governing bodies without hardcoding BI. |
| 4 | Fighter identity and profiles | Connect public/private profile UI to canonical identities, ownership, privacy settings and media storage. Verify profile changes after reload; temporary fighter claims and duplicate merges preserve records and audit history. |
| 5 | Teams and captain workflows | Persist team profiles, memberships, invitation acceptance, transfers and event lineups; captain permissions cannot edit fighter-owned identity. Wire directory search/filter controls and verify empty/error states. |
| 6 | Rulesets, formats and eligibility | Verify versioning, inheritance, event snapshots, divisions, equipment/medical/age eligibility and effective dates. Existing results retain their original rules. Client scoring and database validation agree across supported formats. |
| 7 | Event setup and registration | Complete event lifecycle, registration, review, withdrawal, roster admission and waiver handling. Supply missing backend functions or remove unsupported promises. Fees remain optional; any payment integration requires verified configuration and idempotent callbacks. Test closed registration, duplicates and failed uploads. |
| 8 | Competition planning | Verify pools, seeding, single/double elimination, byes, anti-fratricide constraints and qualification. Add scheduling/list assignment and collision handling. Recover useful competition branch work only against current migrations and result semantics. |
| 9 | Field operations and scoring | Verify check-in and safety gates, match state transitions, field queues, result submission, forfeits, discipline and private notes. Concurrent operators cannot overwrite or double-submit results. Corrections preserve an audit trail and repair downstream progression. |
| 10 | Rankings, history and reporting | Connect public rankings and fighter/team records to finalized, eligible results; documented tie-breaks and versioned calculations; corrections recompute affected records. Export/report totals agree with source data. |
| 11 | Spectator experience and offline reliability | Connect public arena, schedules and livestreams to safe live data. Verify reconnect, durable snapshots, app installation/update, background sync, queue recovery, account isolation and conflict resolution on Android/iOS. Never cache private API responses in the public shell. |
| 12 | Release verification and operations | Full authenticated end-to-end event rehearsal, accessibility/mobile review, performance checks, migration upgrade rehearsal, backup/restore, monitoring, deployment rollback and cost documentation. Publish only with explicit evidence for the exact release commit and clearly recorded remaining limitations. |

## Evidence-backed backlog and dependencies

| Finding / source | Owner pack | Next proof required |
| --- | --- | --- |
| `src/lib/auth.ts`, `LoginPage.tsx`: password/magic-link only; recovery/account setup exist on the divergent foundation branch | 2 | Test callback routing under HashRouter and `/BuhurtOS/`, session expiry, membership-load errors and recovery without leaking tokens. |
| `AppState.tsx`: auth callback launches membership requests; authentication and event loading have separate lifecycles | 2 | Reproduce sign-in/sign-out transitions with real accounts and ensure stale data/roles cannot survive identity changes. |
| `offlineQueue.ts`: mutations lack account ownership and interrupted `syncing` recovery | 2, 11 | Cross-account replay denial and crash/reload/retry tests before live field use. |
| `Layout.tsx`: mobile bottom navigation exposes only core routes; utility discovery requires mobile review | 3, 12 | Authorized setup/admin/sync actions remain discoverable on narrow screens. |
| `SetupPage.tsx`, `identityAdmin.ts`, timestamped identity migration | 3 | Multi-tenant CRUD/archive and permission matrix against real signed-in users. |
| `MyProfilePage.tsx`: save only toggles editing; media buttons have no persistence | 4 | Owned profile edits and media/privacy changes survive reload and are visible only to allowed viewers. |
| `FightersPage.tsx`, `TeamHQPage.tsx`: static filters and invitation UI; showcase fixtures | 5 | Search/filter interaction and real invitation acceptance/rejection, with persisted membership. |
| `rulesetAdmin.ts`, `RulesetsPage.tsx`, ruleset tests | 6 | Expand actual database tests to cover immutable versions, inherited overrides and event binding. |
| `registration.ts`: invokes absent `upload-waiver` and `create-registration-checkout` functions | 7 | Deployed function implementations, storage authorization and failure/retry recovery. Preserve successful registration if upload fails. |
| `RegistrationPage.tsx`: event load failures display indefinite loading | 7 | Explicit missing/denied/offline event states and retry. |
| `bracket.ts` and core regression test | 8 | Multi-size fixtures and lifecycle tests through all rounds; validate client/server parity. |
| `AppState.tsx`: optimistic reorder lacks rollback on RPC error; field scoring path | 9 | Failed reorder recovery and concurrent score/status writes against database. |
| `ShowcaseRankingsPage.tsx`, profile and team pages use showcase fixtures | 10 | Rankings generated from approved results; correction/season regression fixtures. |
| `PublicPage.tsx`: section anchors use `#fields` etc. inside HashRouter | 11 | Clicking public section navigation scrolls within the event rather than changing the application route. |
| `AppState.tsx` snapshot not persisted; queue sync lifecycle and realtime behavior | 11 | Cold offline launch, two-device conflicts, reconnect and update rehearsal. |
| GitHub Pages workflow provides no Supabase environment values | 12 | Keep demo build distinct; configure and verify a live deployment intentionally. |

## Preserved recovery sources

No wholesale branch merge is safe. Both branches diverge in schema history and replace newer mainline code.

- `origin/mega-pack-1-foundation` at `686c7efb03f0a179a07d6bc732592ea554fbee20`: 69 commits unique versus main at audit time (some changes were independently applied to main). Contains account setup/recovery, invitation function, actor-owned offline queues, snapshots, validation and alternative foundation administration. Main has ten commits absent from that branch. Candidate recovery: Packs 2, 3, 6 and 11.
- `origin/completion/production-platform` at `da020c62f4bae1a15ac1ae4b1842032fec0e6ccf`: 76 commits unique versus main, with 67 main commits absent there. Contains competition, schedule, check-in, corrections, rankings and analytics implementations. Candidate recovery: Packs 7 through 10.
- Main uses twelve timestamped migrations. The divergent branches rename early migrations to numeric filenames and introduce incompatible later schemas. Never copy their migration directories over main. Compare behavior, port compatible code, and create forward migrations only after identifying deployed history.

## Next milestone

Pack 2 starts by confirming the backend project and obtaining reproducible authenticated test accounts/environment configuration. Before feature work, add tests reproducing callback routing, role-load failure and account switching. Recover only the compatible auth and queue-isolation pieces from the foundation branch.
