# Pack 09A: Event Day Command Center + Field Queue

> **Superseded by Pack 25 (2026-10-07):** Manage › Event day is now part of **Event Control › Live ops**; `/manage?tab=eventday` redirects there. The field boards, queue commands and planner are unchanged.

Branch: `pack09a-event-day-command-center` (based on `fix-team-rankings-categories`, which is based on main `8583a2b`).
Not deployed. Nothing applied to hosted Supabase. A future session can continue from the checklist at the bottom.

Out of scope (later packs): 09B scorekeeper-screen redesign, public arena/TV display; 09C competition finalization, event closeout, final publication.

## Existing invariants this pack must keep (found by reading the code and the scratch database)

1. `matches.queue_state` is `scheduled | on_deck | in_the_hole | active | final`. `final` is reached only through `finalize_match` (called by
   `submit_match_result`, paper entry, conflict resolution, walkovers) and left only through `reopen_match_core`.
2. `set_match_queue` (SECURITY DEFINER, `private.can_score`) moves ONE non-final match to any non-final state, and can set the field (`''` clears, null keeps).
   It does not check readiness and does not enforce one-active-per-field. A scorekeeper can already do this to any match of the event.
3. Only organizers (`private.is_organizer`: organizer, platform owner, organization admin) may UPDATE/INSERT/DELETE `matches` rows directly (field, scheduled_at,
   duration_minutes, entries, ...). Column grants list exactly which columns. Scorekeepers go through RPCs only.
4. `matches.version` bumps on finalize and on structural change (entries, stage, pool, links) only. Queue state, field, time and order changes do NOT bump it, so
   moving the queue never makes an open scoreboard "stale".
5. `matches` is in the `supabase_realtime` publication. `LiveSync` (debounced per-competition refetch, 15 s polling fallback, 120 s safety refresh) is the one
   live-update mechanism; `FieldPage` has its own 10 s poll + realtime nudge.
6. A match with no `field` is **Field 1**. The frontend does it in `toMatch` (`field?.trim() || 'Field 1'`); the database keeps NULL. Nothing may write "Field 1" into rows
   merely to display the default.
7. Bracket winner/loser propagation happens inside `finalize_match` (next match entry slot, third place). Queue advancement is a separate concern and must not touch
   results, entries or bracket links.
8. Check-in is per **registration** (`registration_checks`, readable only by `can_read_health` roles = organizers). A registration links to a fighter by `fighter_id`;
   a team entry stands in through `entry_fighters`/`entry_roster`. Organizer-added entrants may have no registration.
9. Result conflicts: `list_result_conflicts` (`can_resolve_results` = organizer, head marshal) and the existing `ResultConflicts` review UI. Schedule conflicts:
   `fighter_schedule_conflicts` (`can_score`) and `ConflictsPanel` in the Run tab.
10. Synthetic/test data stays isolated; nothing in this pack reads or changes ranking or statistics views.

## Design

### Database (one additive migration, `20261004000500_pack09a_event_day_queue.sql`)

* `matches.queue_order integer null`: the organizer's manual run order inside one field's upcoming list. Not writable by clients directly (no column grant); only the RPC
  below writes it. Chosen over reusing `scheduled_at` (would falsify times) or `position` (bracket structure).
* **Upcoming order** (one rule, in SQL `private.field_upcoming` and mirrored in `src/lib/eventDay.ts`, with matching fixtures in both test suites): runnable `scheduled`
  matches of the field, ordered by `queue_order` (manual, nulls last), `scheduled_at` (nulls last), competition `sort`, competition id, stage (pool/round robin, elimination,
  third place, final), round (pool round number; "Round of N" before Quarterfinal before Semifinal), pool, `position`, id.
* **Runnable** = both sides set and neither entry withdrawn/disqualified. Anything else is never promoted automatically.
* **Field key** = lower(trim(field)), blank = `Field 1`. Queues of different fields never touch each other.
* `private.settle_field_queue(event, field_key, start)`: fills gaps top-down and never demotes a runnable match: if nothing is active and `start`, the first runnable of
  (on deck, in the hole, upcoming) becomes active; then an empty on-deck slot and an empty in-the-hole slot are filled the same way. An unrunnable on-deck/in-the-hole
  match (side replaced by a withdrawal, say) goes back to `scheduled`; an unrunnable ACTIVE match is left alone. Convergent and idempotent: running it twice changes nothing.
* **Automatic advancement**: a deferred constraint trigger on `matches` (after update of `queue_state`, when a live match becomes `final`) calls settle for that match's
  field at commit, so it sees the bracket successor that `finalize_match` fills in. `start` is true only when the finalized match was ACTIVE. It runs inside the same
  transaction as the result (atomic) and inside a sub-block: a queue problem is logged to the audit trail and never rolls back or blocks a result. It is not callable
  by users; it only reacts to a finalization that `finalize_match` already authorized, and can only do the bounded promotion above.
* `public.advance_field_queue(event, field, start)`: "start the next match" / "fill the queue". `private.can_score` (the same people who may already set any match's state).
* `public.move_match_in_queue(match, action)`: `first | earlier | later | skip`. Organizers only (`private.is_organizer`), because it is organizer-level scheduling.
  Renumbers the field's upcoming list densely, so the result is deterministic. `skip` on an on-deck / in-the-hole match returns it to the line behind the next ready match and
  refills the slot. An active match cannot be moved.
* Concurrency: every queue-changing path takes one transaction advisory lock per event (`pg_advisory_xact_lock`) before touching rows: `set_match_queue`,
  `advance_field_queue`, `move_match_in_queue`, and the advancement trigger. Because settle is state-based, a second caller after the first sees a settled queue and changes nothing.
* No unique "one active per field" constraint: existing flows and data allow several; the Command Center reports it as a problem instead.

### Frontend

* `src/lib/eventDay.ts`: pure domain (field key, runnable/blocked reasons, upcoming order, field boards, advancement plan, competition progress, check-in gaps, attention list).
* `src/lib/useEventDayData.ts`: `LiveSync` + realtime on `matches` and `entries` (no standings), polling fallback, an explicit `refresh()`.
* `src/data/eventDay.ts`: RPC wrappers and the two small reads (event roster, registration check-in flags).
* `src/pages/EventDayTab.tsx` (+ small components): Manage → **Event day** tab. NOW dominates; on deck, in the hole, upcoming; per-field sections (field picker on phones, side by side
  on wide screens); Needs attention; Competition progress; links into Run, Check-in, Competitions and the existing scoreboard.
* `FieldPage`: `?match=<id>` opens that match's scoreboard directly; `?from=eventday` adds a way back. Scoring is otherwise untouched.
* `RunTab`: `?match=<id>` jumps to a match card (reusing the existing jump). Run stays the deeper editor.
* `ManagePage`: new tab; defaults to Event day only while the event is actually running (today within its dates, in the event's time zone).

### Authorization summary

| Action | Who | Where enforced |
| --- | --- | --- |
| See the Event day tab | organizers (as Manage today) | page gate + RLS on every read |
| Start next / fill queue (`advance_field_queue`), set a match's state | anyone who can score the event | `private.can_score` inside the function |
| Reorder / skip (`move_match_in_queue`) | organizers | `private.is_organizer` inside the function |
| Automatic advance after a result | triggered by finalization only | the finalizing function's own check; bounded transition |

The new functions are SECURITY DEFINER with an explicit check, exactly like `set_match_queue` and `finalize_match` (scorekeepers have no write grants on `matches`, so an
atomic multi-row change cannot be done any other way). No existing permission is widened.

## Verification plan

Unit (vitest) for every pure rule; `supabase/tests/pack09a_gate.sql` for authorization, atomicity, two fields, readiness, idempotency and ordering; a two-session shell test for
concurrent callers; browser runs against the real stack (Postgres built from the migrations + PostgREST + a small local auth shim) at 390 / 768 / 1280 px.

## Progress checklist

- [x] Investigation, invariants, plan (this file)
- [x] Migration + database gate (107 checks) + concurrency test (14) + schema fingerprint
- [x] Pure domain module + unit tests (40, sharing scenarios with the database gate)
- [x] Data layer + live hook
- [x] Event day UI (tab, field boards, attention, progress)
- [x] FieldPage / RunTab / ManagePage hooks
- [x] Real-stack browser run: 78 checks (`scripts/e2e/eventday-live.sh`; needs a PostgREST binary, not part of CI)
- [x] Skeptical QA pass (double tap, stale screen, withdrawn called fight, missing-column fallback, re-runnable migration, overlay/CSS class collision found and fixed)
- [x] Full gates, STATUS.md, handoff

## Known limits, left on purpose

* Realtime push is not exercised by the local stack (it offers no socket); the polling fallback is. The subscription is the same `LiveSync` + channel pattern the public screens use.
* Check-in warnings cover people who have a registration on the event. Entrants added by an organizer with no registration are not reported.
* Two organizers pressing "Run later" on the same match at the same moment both apply (each is a valid move).
* A unique "one active match per field" constraint is not added (existing flows and data allow several); the screen reports it.
* Event day is organizer-only. Head marshals and scorekeepers keep using the field screens, which now see the queue advance by itself.
* `FieldPage.open()` (existing) still writes the field name onto a match a scorekeeper opens that was not already active.
* 09B: scoreboard redesign, arena / TV display. 09C: explicit competition finalization, closeout, final publication.

## Deploy order

Apply `20261004000500_pack09a_event_day_queue.sql` to the database BEFORE deploying the frontend. Without it the Event day tab shows matches in schedule order and says the update has not been applied when an action is tried; every public page is unaffected either way (the public queries do not read the new column). The migration contains `alter table ... add column` and a `create constraint trigger`: if the hosted migration tool cancels it, run the file in the SQL Editor. It is safe to run twice.
