# BuhurtOS Rumble implementation packs

These packs convert the October 3 architecture and code review into implementation work for the Red Deer Rumble.

## Branch and source of truth

Work on branch `ccr-a435c5f7-pmrfxr` unless the owner explicitly changes that.

Before changing code, read:

1. `docs/VISION.md`
2. `docs/PROJECT_SPEC.md`
3. `docs/CHATGPT_QUESTION_BANK.md`
4. `docs/reviews/2026-10-03-interrogation-part1.md`
5. `docs/reviews/2026-10-03-interrogation-part2.md`
6. `docs/claude-packs/OWNER_DECISIONS_2026-10-03.md`
7. `docs/claude-packs/REVIEW_FINDINGS_2026-10-03.md`

The owner decisions file overrides older assumptions where they conflict. Pack 00 explicitly reconciles the permanent project documentation.

## Execution order

Run the packs in this order:

1. `PACK_00_SOURCE_OF_TRUTH.md`
2. `PACK_01_SECURITY_AND_DATA_SAFETY.md`
3. `PACK_02_TOURNAMENT_INTEGRITY.md`
4. `PACK_03_SCORING_RESILIENCE.md`
5. `PACK_04_EVENT_RUNTIME_SAFETY.md`
6. `PACK_05_IDENTITY_PUBLIC_DATA_AND_STATS.md`
7. `PACK_06_POST_RUMBLE_ROADMAP.md`

Pack 06 is documentation and backlog work only unless the owner later promotes an item.

## Permanent execution rules

For every implementation pack:

- Inspect the current repository and hosted database before editing. Do not assume the review is still current.
- Preserve working behaviour unless the pack explicitly changes it.
- Prefer the smallest change that closes the proven failure.
- Keep the database authoritative for permanent sporting records.
- Critical mutations must be validated server-side through controlled RPCs or command handlers rather than arbitrary client row edits.
- Use additive migrations. Do not rewrite migration history.
- Test permission boundaries directly using the affected roles.
- For scoring, bracket, registration, auth, RLS, service-worker or realtime changes, test the failure path as well as the happy path.
- For UI changes, verify the running product in a browser. Mobile behaviour matters.
- Do not treat a successful build as proof of correct behaviour.
- Distinguish repository changes, local tests, hosted database state, deployment state and actual live verification in the handoff.
- Commit each completed pack separately with a meaningful commit message.
- Update `docs/claude-packs/STATUS.md` after every pack with evidence, commit SHA, migrations applied, tests run, deployment state, remaining risks and anything not verified.
- Do not expand a pack into unrelated cleanup or architecture work.
- If a pack exposes a genuine safety or data-integrity blocker, fix the blocker before continuing. Otherwise continue to the next pack without inventing extra work.

## Owner direction that materially changes the earlier plan

- BuhurtOS stays on Supabase. There is no Supabase exit project.
- Production stays on the Supabase Free plan for now.
- Do not build a full offline-first application before the Rumble.
- Do not migrate to PowerSync or another sync engine before the Rumble.
- Events are expected to have connectivity most of the time.
- Brief connectivity loss during scoring must not lose entered work.
- Match finalization requires signal for the Rumble.
- Paper score sheets are the primary official fallback. BuhurtOS is the fast digital path and mirrors the official result.
- Test accounts remain until after the Rumble, but permission fixes must remove inappropriate platform-wide powers from event organizers.
- Synthetic data may remain in production, but it must be unmistakably labelled and excluded from official rankings, records and aggregates.
- Reliability and new product work may continue in parallel, but security and sporting-integrity blockers take priority.
- Expected Rumble scale is modest: roughly 100 people on site and perhaps 30 remote live viewers. Do not engineer world-championship infrastructure now.

## Things explicitly deferred before November 14

Do not start these unless a proven blocker forces reconsideration:

- PowerSync or another full sync-engine migration
- a new universal ranking engine
- another major frontend rewrite
- cryptographic hash-chained auditing
- a complete federation-management buildout
- a Supabase portability or migration project
- 20,000-viewer infrastructure
- Broadcast plus CDN snapshot architecture

## How the owner can invoke the work

The owner should be able to say simply:

`Read docs/claude-packs/README.md and complete Pack 00. Then continue through the packs in order, updating STATUS.md and committing each completed pack separately. Do not start Pack 06 implementation work; it is roadmap only.`

If working one pack at a time, the owner can say:

`Complete Pack 03 from docs/claude-packs and follow its verification requirements.`
