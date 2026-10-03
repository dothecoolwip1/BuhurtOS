# BuhurtOS Rumble pack status

Branch: `ccr-a435c5f7-pmrfxr`

Last updated: 2026-10-03

## Pack status

| Pack | Status | Commit | Hosted DB | Deployment | Verification notes |
| --- | --- | --- | --- | --- | --- |
| 00 Source of truth | COMPLETE | (see git log) | none (docs only) | none | Docs only. PROJECT_SPEC reconciled, CLAUDE.md added. Round 2 scratchpad was empty in this container: only the committed Part 1/Part 2 reviews exist; the ChatGPT comparison was not recoverable. |
| 01 Security and data safety | REPO COMPLETE, HOSTED MIGRATION NOT APPLIED | (see git log) | NOT APPLIED: `apply_migration` for `20261003000100_pack01_permissions_synthetic.sql` was cancelled when attempted; hosted DB unchanged | none; not deployed | Local gates pass (see Pack 01 notes). Hosted permission holes are STILL OPEN until the migration is applied. |
| 02 Tournament integrity | NOT STARTED |  |  |  |  |
| 03 Scoring resilience | NOT STARTED |  |  |  |  |
| 04 Event runtime safety | NOT STARTED |  |  |  |  |
| 05 Identity/public data/stats | NOT STARTED |  |  |  |  |
| 06 Post-Rumble roadmap | NOT STARTED |  |  |  | Documentation only |

## Current known constraints

- Supabase Free plan remains in use.
- Paper is the primary official fallback for the Rumble.
- Full offline-first operation is not a pre-Rumble requirement.
- Finalization requires signal for the Rumble.
- No sync-engine migration before the Rumble.
- No Broadcast/CDN migration before the Rumble.
- Test accounts remain until after the Rumble.
- Synthetic data may remain visible when clearly labelled and excluded from official aggregates.

## Pack completion template

For each completed pack, record:

- status
- commit SHA
- migrations added/applied
- hosted database verification
- automated tests run
- browser verification
- real-phone verification where relevant
- deployment state
- unresolved risks
- explicit deferred work


## Pack 00 notes
- Files: `docs/PROJECT_SPEC.md` (reconciled), `CLAUDE.md` (new), this file. No code, schema or data changed.
- Contradictions corrected: organizer team approve/merge authority, full-offline scoring requirement, added a 2026-10-03 override section (Supabase Free, no sync engine, paper fallback, finalization needs signal, test data, history, identity).
- Not recoverable: the Round 2 scratchpad report and the ChatGPT-vs-code comparison were not present in this container; only the already committed `docs/reviews/2026-10-03-interrogation-part1.md`, `part2.md` and `REVIEW_FINDINGS_2026-10-03.md` exist.

## Pack 01 notes
Inspected hosted DB (read-only, project `mvbxlebznlgroptwwdsm`): `approve_team`, `merge_teams`, `new_team_request_details`, `team_roster` and three read policies used `private.is_any_organizer()` (any event organizer); `can_assign_captain`, `can_manage_team`, `team_requests_inbox`, team notifications used `is_platform_organizer()` (owner or approved event creator). Platform roles: one owner (garrettrobson95@gmail.com). `organizer@buhurtos.ca` is organizer and `scorekeeper@buhurtos.ca` scorekeeper of `red-deer-rumble-test` only.

Repository changes: migration `supabase/migrations/20261003000100_pack01_permissions_synthetic.sql`; `private.can_admin_team` (owner or admin of the team's organization) now governs approve/merge/request details/roster of pending teams/captain assignment/team editing; `is_any_organizer` dropped; event_staff roles count only until 7 days after the event's last day (rows kept); `sources.synthetic` flag set on the NACL source; `result_rows`, `match_sides`, `played_events` exclude synthetic events (so rankings, career/season/team stats ignore them); history views gain a `synthetic` flag; `synthetic_records` view; Test-data badges on event, team, fighter lists and pages; seeds/generator set the flag; export and restore scripts plus `docs/runbooks/PRODUCTION_EXPORT_AND_RESTORE.md`.

Local verification (throwaway Postgres 16, schema rebuilt from all migrations): security_gate 699, captain_gate 65, team_admin_gate 69, activity_gate 90, new pack01_gate 70 checks pass; NACL league verifier 68/68 (with the flag cleared in the scratch DB only); `tsc` clean; vitest 474 pass; `vite build` ok. pack01_gate fails against a database built without the new migration (negative control). Existing gate assertions that encoded the old organizer powers were changed to the new rules.
Export/restore: scripts rehearsed against a local database only (checksums verified, row counts matched). **No production export has been taken.**
Not verified: hosted behaviour, browser rendering of the Test badges, any deployment.
