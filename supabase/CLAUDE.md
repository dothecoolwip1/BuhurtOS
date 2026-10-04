# BuhurtOS database rules

These rules apply when working in `supabase/`.

- Use additive migrations only. Never rewrite existing migration history.
- PostgreSQL is authoritative for permanent sporting records.
- Use controlled database functions/RPCs for critical sporting and identity mutations.
- Preserve auditability. Correct, void or supersede historical sporting records rather than silently rewriting or deleting them.
- Preserve RLS and least-privilege boundaries. Never weaken authorization for implementation convenience.
- Event-scoped roles must not gain access to unrelated events.
- Public data must not expose auth account IDs, health data, emergency-contact data or private contact data.
- Fighters may exist without auth accounts. Fighter identity and account ownership are separate.
- Synthetic/test records must remain identifiable and excluded from official rankings, records and aggregates.
- When permissions, RLS or permanent data behaviour changes, directly test allowed and denied cases.
- Do not apply migrations to the hosted database unless the task explicitly requests it.
