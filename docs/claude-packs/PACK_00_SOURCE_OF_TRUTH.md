# Pack 00: reconcile the source of truth

## Goal

Before modifying application behaviour, make the permanent project instructions agree with the owner's October 3 decisions and preserve the Round 2 evidence.

This pack is documentation and repository hygiene. Do not change application logic in this pack.

## Read first

Read the files listed in `docs/claude-packs/README.md`.

Also inspect the current feature branch for any Round 2 scratchpad report or comparison that has not yet been committed.

## Required work

1. Preserve the full Round 2 report if it is still available in the Claude scratchpad.
   - Put it under `docs/reviews/` with a dated descriptive filename.
   - Preserve factual evidence, scenario results, permission tables and browser-test plans.
   - Do not rewrite evidence to make it match later owner decisions.
2. Preserve the final comparison between ChatGPT recommendations and the code/database review if it is still available.
3. Reconcile `docs/PROJECT_SPEC.md` with `docs/claude-packs/OWNER_DECISIONS_2026-10-03.md`.
   - Owner decisions override older assumptions.
   - Specifically correct the old full-offline assumption, organizer/team permission assumptions, paper fallback, test-data handling, Supabase plan decision and current pre-Rumble scope.
4. Create a concise root `CLAUDE.md` if none exists.
   - Keep permanent repository rules there, not the entire task backlog.
   - It should point to `docs/VISION.md`, `docs/PROJECT_SPEC.md` and this pack system.
   - Include the permanent invariants: database-authoritative sporting records, controlled critical mutations, privacy boundaries, historical correction rather than silent deletion, mobile-first event operation, evidence-based verification and no claims of deployment without proof.
5. Create or update `docs/claude-packs/STATUS.md`.
   - Mark Pack 00 complete only after the permanent docs agree.

## Important owner decisions to preserve exactly

- Supabase remains the backend.
- Stay on the Free plan for now.
- No full offline-first rebuild before the Rumble.
- No PowerSync migration before the Rumble.
- Finalization requires signal for the Rumble.
- Paper is the primary official fallback.
- Test accounts remain until after the Rumble.
- Narrow role permissions rather than deleting those accounts.
- Synthetic data may remain in production if clearly labelled and excluded from official aggregates.
- Expected Rumble scale is small enough that Broadcast/CDN architecture is deferred.
- Reliability work and feature work remain balanced, but security/data-integrity blockers win.

## Acceptance criteria

- No contradictory pre-Rumble offline requirement remains in the project spec.
- No project documentation still says ordinary event organizers should have platform-wide team merge/delete power.
- The paper fallback decision is explicit.
- The current Supabase Free decision is explicit.
- The owner-decision file remains intact.
- The full Round 2 artifacts are committed if recoverable.
- `CLAUDE.md` contains durable rules, not a giant temporary implementation checklist.
- No application code, schema or hosted data changes are made in this pack.

## Verification and handoff

Report:

- files changed
- evidence preserved
- contradictions corrected
- anything in the Round 2 scratchpad that could not be recovered
- commit SHA

Then update STATUS.md and continue to Pack 01.
