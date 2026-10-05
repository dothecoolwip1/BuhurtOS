# Pack 13 hosted rollout (2026-10-07): record and operations

Project `mvbxlebznlgroptwwdsm`. All steps were done through the Supabase MCP tools (no SQL pasted by the owner). The record of what was actually applied and checked is in `STATUS.md` (Pack 13 section).

## What is applied, in order
1. Migration `pack13_lyst_core` (= `20261007000100`): event lyst settings, the match registry, the authoritative timer, official rounds + append-only revisions, discipline (public columns + private reasons),
   `lyst_round_scores`, the controlled functions (`lyst_open`, `lyst_timer_command`, `lyst_end_round`, `lyst_confirm_round`, `lyst_record_discipline`, `lyst_void_discipline`, `set_lyst_settings`), the final-match trigger, realtime publication.
2. Migration `pack13_lyst_counters` (= `20261007000200`): join codes, counter seats, append-only tallies, per-seat round submissions, join-attempt limiter, counter / tablet state functions, `lyst_finalize`, `lyst_public_state`.
Both are additive (new tables, functions, views, one trigger on `matches` for a final match, three tables added to `supabase_realtime`). No existing table or function is changed. No Edge Function, no cron job, no extension.

## Turning it off
Nothing outside the lyst screen depends on it. Marshals can use the classic scoreboard per device ("Use the classic scoreboard"). To stop the lyst entirely for everyone, remove the duel branch in `FieldPage.tsx` (a one-line change) and redeploy;
the tables can stay (they hold the audit trail). Do not drop the Pack 13 tables: they are the record of official rounds, penalties and corrections.

## Operations
- Who changes durations, cards, deductions: the head marshal / organizer, on the lyst screen → Lyst settings. Stored per event in `event_lyst_settings`.
- Stuck clock: any scorekeeper of the event can RESET or SET the clock from Clock options. In the database: `select * from lyst_timer where event_id = '<event>';`.
- A wrong confirmed round: Correct on the lyst screen (reason required; old numbers stay in `lyst_round_revisions`). After the match is final: reopen through the existing path first.
- A wrong penalty: Record → Void with a reason (head marshal / organizer any time; the recorder for 10 minutes while live).
- A counter who should not be there: Counters → Remove. Codes expire after 30 minutes, seats after 8 hours; `select * from lyst_counter_seats where status = 'active';`.
- Evidence of what counters tapped is in `lyst_counts` (append-only) and frozen into `lyst_round_revisions.counters` at each confirmation. Staff only.
