# BuhurtOS: repository rules

BuhurtOS is the connected operating system for buhurt (vision: `docs/VISION.md`; decisions and scope: `docs/PROJECT_SPEC.md`).
Stack: React/TypeScript/Vite SPA talking to Supabase (Postgres, Auth, Realtime, Storage). Supabase stays the backend.

Work is organised in packs: start at `docs/claude-packs/START_HERE.md` and `README.md`. Owner decisions in
`docs/claude-packs/OWNER_DECISIONS_2026-10-03.md` override older assumptions. Progress is recorded in `docs/claude-packs/STATUS.md`.

## Permanent invariants
- The database is authoritative for permanent sporting records. Critical mutations go through controlled RPCs, not arbitrary client row edits.
- Privacy boundaries hold: public tables never carry account ids; health, emergency and contact data is never public.
- History is corrected, voided or superseded with an audit trail, never silently deleted or rewritten.
- Event roles are scoped to their event; event organizers have no platform-wide powers.
- Synthetic data must be labelled and excluded from official rankings, records and aggregates.
- Mobile-first: event-day screens must work one-handed on a phone with flaky signal; paper is the official fallback.
- Use additive migrations; never rewrite migration history. Test permission boundaries and failure paths directly.
- Evidence-based verification: a green build is not proof of behaviour. Never claim something is deployed, working, secure or verified without proving it, and separate repo changes, local tests, hosted DB state, deployment and live verification.
- Do not expand into deferred projects (sync engines, Broadcast/CDN, new ranking engine, rewrites, Supabase migration).
