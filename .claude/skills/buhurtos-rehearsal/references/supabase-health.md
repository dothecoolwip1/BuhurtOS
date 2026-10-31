# Supabase health during a rehearsal (read-only)

Run this only with **read-only** log access (Supabase dashboard Logs Explorer, or a connector's log query tool). Do not run SQL that writes,
do not change settings, do not restart or upgrade anything. If no read-only log access is available, write
**"Supabase health: NOT RUN: no read-only log access"** and stop here. A few screens that loaded are not evidence of health.

## What to report (documented: run prompt Part 12 and owner request 2026-10-31)

1. **Busiest 15-minute window** of the rehearsal: count API requests per minute over the whole run (UTC) and pick the 15 minutes with the most.
   State how you picked it.
2. For that window, for each of `counter_state`, `lyst_state`, `counter_acknowledge_run`, `device_whoami`, `outrance_enter_sheet`,
   `outrance_finish` (PostgREST paths `/rest/v1/rpc/<name>`): request count, HTTP status counts, and **maximum upstream time** (and p95 if the
   tool gives it).
3. Every **5xx** response in the window: time, path, status, upstream time.
4. Postgres log lines in the window containing `canceling statement due to statement timeout` or `still waiting for ShareLock`: count, first
   and last time, and the statement they name (table or function only).
5. Anything else unusual the logs show (slow checkpoints, Realtime change-polling over 5 s), labelled as an observation.

Present it as a table, then this sentence: **"These figures are project-wide: they include every user of the project in that window, and do
not by themselves show what caused a slow or failed screen."**

## How to reason about causes (documented in spirit by CLAUDE.md "Match verification to the failure mode"; method assumed)

- Browser lag alone does not prove a database problem. Separate: browser rendering or main-thread work, network (DevTools timing: queueing,
  TTFB, download), API gateway, PostgREST, Postgres execution, lock waits, Realtime.
- Compare the browser's request duration with the upstream time in the log for the same request. A long browser time with a short upstream
  time points away from the database.
- A lock wait or statement timeout on the same table and minute as a failed screen is a **lead**, not a proof. Say "Hypothesis".
- Advisor notices (unindexed foreign keys, unused indexes, multiple permissive policies) are leads for later investigation, never a reason
  to drop an index or change RLS during or because of a rehearsal.
- Known history: 2026-10-30 19:15–20:00 UTC showed about 60 statement timeouts (mostly `counter_state`, `lyst_state`, `device_whoami`) and
  ShareLock waits of 1–4 s on `update public.event_sessions set last_seen_at`; migration `20261113000200_rehearsal_ko_finish.sql` changed the
  heartbeat to `for update skip locked`. Check whether those waits are gone; do not assume it.

## Where to look in the repository for a suggested fix

- RPC definitions: `supabase/migrations/` (search `create or replace function public.<name>`); hosted may differ from the repo, so a
  suggestion is "repository-specific" only after reading the migration that defines the current version.
- Client callers: `src/data/lyst.ts` (`counter_state`, `lyst_state`, `counter_acknowledge_run`, `outrance_enter_sheet`, `outrance_finish`),
  `src/DeviceApp.tsx` and `src/lib/deviceClient.ts` (`device_whoami`), polling and back-off in `src/lib/lyst/pollRecovery.ts`.
- Use the `supabase-postgres-best-practices` skill for query, index, lock and RLS-efficiency reasoning, and the `supabase` skill for Auth,
  Realtime and client integration. Their advice is input to a suggested fix, not permission to apply it.
