# Start here: Claude implementation runner

Read `docs/claude-packs/README.md` first, then execute the BuhurtOS Rumble packs in order on the current feature branch.

## Instructions

1. Begin with Pack 00.
2. Inspect before editing. Treat the review findings as leads to verify against the current repository and hosted database.
3. The October 3 owner decisions override older assumptions.
4. Complete each pack's implementation, verification and handoff requirements.
5. Commit each completed pack separately.
6. Update `docs/claude-packs/STATUS.md` after each pack.
7. Continue automatically to the next implementation pack unless there is a genuine blocker that requires an owner decision.
8. Do not ask the owner to repeatedly approve ordinary work that is already authorized by these packs.
9. Do not expand into deferred projects such as PowerSync, a full offline-first rewrite, Broadcast/CDN architecture, a new ranking engine, a Supabase migration, another frontend rewrite, cryptographic audit chaining or world-scale infrastructure.
10. Pack 06 is roadmap/documentation only. Do not implement its deferred architecture items.
11. Preserve existing completed work and make minimal necessary changes.
12. When UI behaviour changes, verify the running product in a browser.
13. When database, auth, RLS, bracket, scoring or offline behaviour changes, directly test the failure cases specified in the pack.
14. Never report something as deployed or verified unless you actually proved that state.
15. If a pack exposes a real security, data-loss or sporting-integrity blocker, prioritize that blocker before cosmetic/new-feature work.

## Final handoff

After Packs 00 through 05 and the Pack 06 roadmap are complete, provide one evidence-based final report separating:

- repository changes
- commit SHAs
- migrations
- hosted database state
- CI state
- branch protection/deployment controls
- browser verification
- real-phone verification
- production deployment state
- remaining pre-Rumble risks
- deferred post-Rumble work

The goal is not architectural perfection. The goal is a reliable, understandable BuhurtOS that can support the Red Deer Rumble while preserving the long-term connected-sport vision.
