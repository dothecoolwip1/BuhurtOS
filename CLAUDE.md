# BuhurtOS

BuhurtOS manages buhurt fighters, teams, organizations, events, competitions, scoring, rankings and permanent sporting history.

Stack: React + TypeScript + Vite + Supabase/PostgreSQL/Auth/Realtime/Storage.
Supabase remains the backend.

## Commands

- Dev: `npm run dev`
- Typecheck: `npm run typecheck`
- Unit tests: `npm test`
- Production build: `npm run build`

## Core architecture

- The database is authoritative for permanent sporting records.
- A fighter is a sporting identity, not an account. Fighters may exist without BuhurtOS accounts; account ownership is a separate relationship.
- Critical sporting and identity mutations use controlled database functions or RPCs rather than arbitrary client writes.
- Sporting history is corrected, voided or superseded with an audit trail. Never silently delete or rewrite it.
- Public data never contains auth account IDs, health data, emergency-contact data or private contact data.
- Event roles are scoped to their event unless an explicit broader permission exists.
- Synthetic/test records remain identifiable and are excluded from official rankings, records and aggregates.
- Use additive migrations. Never rewrite migration history.
- Do not replace Supabase or add a second backend without an explicit owner decision.

## Product

- BuhurtOS is mobile-first. Tournament-day workflows must be fast and usable one-handed on a phone.
- Prefer clear sporting language over database or admin terminology.
- Preserve completed work and extend existing systems instead of creating parallel ones.

## Working rules

- Inspect the relevant existing implementation before making architectural assumptions.
- Make focused changes and avoid unrelated refactors.
- Read task-specific documentation only when relevant.
- If product scope or intent is unclear, consult `docs/PROJECT_SPEC.md` and `docs/claude-packs/OWNER_DECISIONS_2026-10-03.md`. Current owner decisions override older assumptions.

## Verification

- A green build is not proof that behaviour works.
- Match verification to the failure mode.
- Verify changed UI workflows in the running product.
- Directly test auth, RLS and permission boundaries when they change.
- In handoffs distinguish repository changes, test/build results, database state, deployment state and live verification.
- Never claim something is deployed, secure or verified without evidence.


## Cloudflare

- BuhurtOS uses Cloudflare only for the AI Event Assistant. Supabase remains the backend and system of record.
- The existing Worker is `buhurtos-eventai` at `https://buhurtos-eventai.garrettrobson95.workers.dev`.
- The Worker source and Wrangler config live in `workers/ai-event-assistant/`.
- Use the official Cloudflare Skills/MCP integration for Cloudflare platform work and current product guidance.
- Prefer Wrangler for Worker development, preview and deployment.
- Do not move BuhurtOS hosting, auth, database or permanent sporting data to Cloudflare unless the owner explicitly requests it.
- AI output is advisory. Never let the Worker directly create or mutate permanent tournament records without the normal BuhurtOS validation and organizer approval path.
- See `docs/runbooks/CLOUDFLARE_AI.md` before changing or deploying the Worker.
