# Pack 25 hosted screenshots

Reserved for screenshots taken from the LIVE site (`https://dothecoolwip1.github.io/BuhurtOS/`) by the read-only production check
(`scripts/e2e/pack25-production-check.mjs`, Actions workflow "Pack 25 production check (read-only)", artifact `pack25-hosted-screenshots`).
Kept apart from the local Pack 25 screenshots in `../2026-10-07-pack25/`.

- the pre-rollout baseline (the pre-Pack-25 build, `build 158 · 7e69f8c`) was taken on 2026-10-07 by Actions run 37614327158; its 41 screenshots are in that run's artifact only (not downloadable from the session that ran it).
- `after-rollout/` – build 166 (`e483476`), run 37620682029, the first full run on the new build (41 files; the Live view is shot on its first paint, before the fields load).
- `live-fields/` – build 166, the live event only, with `event-live-fields-*` shot after the fields loaded.
- Each later run lands here under the label given to the workflow's `shots_label` input (see `docs/claude-packs/PACK_25_EVENT_CONTROL_AND_COUNTERS.md` §9.7).
