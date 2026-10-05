# Pack 13: Lyst Control, timing, counter scoring and marshal authority (2026-10-07)

Read with `STATUS.md` (Pack 13 section), `docs/runbooks/PACK13_HOSTED_ROLLOUT.md` and `docs/runbooks/PACK13_REAL_DEVICE_CHECKLIST.md`.

## The rule everything else follows
**The marshal has final sporting authority.** BuhurtOS records what the marshal decides; it never decides for them.

| What | Authority | Where it lives |
| --- | --- | --- |
| The score of a round | the marshal's call, entered by the person operating the tablet | `lyst_rounds` (+ append-only `lyst_round_revisions`) |
| Warnings, cards, point deductions, disqualifications | the marshal's call, recorded by the operator | `match_discipline` (+ private reasons) |
| The clock | the server | `lyst_timer` (one row per event + field) |
| What a counter taps | **evidence only**: provisional, never a score | `lyst_counts`, `lyst_counter_seats` (staff and the counter's own rows only) |
| The match result | a person, through the existing finalization path | `lyst_finalize` → `submit_match_result` (Pack 03 / 09C) |

Nothing averages, takes the higher or lower of, majority-votes or auto-accepts counters. A counter's number can be *shown* next to the marshal's entry and the operator may tap it to copy it into the
entry (that tap is recorded as "recommended"); that is a person choosing, not the system deciding. A **learning counter** (chosen by the operator, never by the counter) taps exactly the same screen and is stored the
same way so they practise the real job, but it has no path to anything official and is listed apart everywhere.

## What it does
**Clock (authoritative, refresh-proof).** One timer per event + field, in the database. `remaining = remaining_ms − (server now − started_at)`; screens only *display* it, and measure the server-clock offset on every
answer, so a refresh, a sleeping tab, a reconnect or a device with a wrong clock shows the true time. Presets are settings, not rules (Round 1:00, Break 0:30, Long break 3:00, DQ countdown 1:00, Equipment 1:00;
custom 1 s to 60 min; ±1/±5 s adjust; reset; one level of "undo last clock change"). Revision + command id on every command: a stale second tablet changes nothing and is told so; a retried tap is a duplicate. Field 1 and Field 2 are independent.
The clock cannot be changed without signal (it would otherwise look done when it was not): the buttons disable and say why while the server clock keeps running.

**The break workflow (≤ 5 taps).** END ROUND (starts the break, round → "confirming", counters stop) → choose the marshal's score for each fighter (a tap on a number; nothing pre-filled) → CONFIRM ROUND → START ROUND n+1.
Measured in the real-stack rehearsal: **5 taps, 4–5 s of automation** (a person is slower, but the 30 s break leaves ample margin; the entry screen is on screen 50–60 ms after END ROUND). Extra rounds follow the Duels rule already in the repository
(two rounds, then shorter rounds until a fighter leads by 2): `regular_rounds` (2) and `extra_round_seconds` (30) are **event settings**, and the lead rule is shown only as a suggestion ("Aldric lead by 3 after 2 rounds").
Corrections to a confirmed round need a reason, keep the previous numbers in the revision log, and are refused once the match is final (use the existing reopen path, then correct).

**Discipline (marshal's call).** Warning, Card (only from the event's own card list: **no card is invented; the list starts empty**), point deduction (amounts are an event setting), disqualification. A card can carry a linked deduction.
A deduction is an *official act* that lowers that round's official score and stays on the record; it is never "undo". Mistakes are corrected by **voiding with a reason** (the record stays, reason kept privately),
by the person who made it for 10 minutes while the match is live, or by the head marshal / an organizer any time. Records can never be deleted or rewritten (database trigger).

**Counters (optional).** The tablet shows a short-lived join code and QR for its field; a signed-in person scans it and only **asks** for a seat. The operator seats them on one fighter (slots A,B watch fighter A; C,D watch fighter B;
learners L1, L2, … without a device limit). A counter's phone shows the fighter, the clock, one enormous COUNT (or +2 / +1 where the ruleset scores that way), their own total, UNDO LAST (their own last tap only) and "Done with round".
Taps are saved on the phone first, carry their own ids, and are sent in order: a lost signal, refresh or double send can neither lose a tap nor count it twice (40 clicks in one burst landed exactly 40 times in the browser test).
A counter can only touch their own tally on the live round of the match they are seated on; "NEXT FIGHT" carries the seats to the next match on the same field. Seats expire after 8 hours; the code after 30 minutes; wrong guesses are rate-limited (15 per 10 minutes).

**Finishing.** FINISH MATCH shows the marshal-confirmed totals round by round and says it is only official when the server confirms. The result is saved through the existing path (idempotent command id kept on the device, version check,
conflict → "Needs review", stale → head marshal, bracket progression, audit). The totals are read from the official rounds *by the server*, so a result cannot disagree with what the marshal awarded. A result on scores must be supported by the totals;
a DQ needs a recorded disqualification against the other side; a technical result needs the marshal's reason. Detail stored with the result carries the official rounds and penalties and **no counter data**.

**The public display (Arena).** Official state only: the marshal-confirmed totals, the clock, the round, and penalties as official marks. While a round awaits the marshal's call it says **"Scores being confirmed…"** and shows no number for it.
Never counters, learners, seats, reasons or accounts (a public view with no such columns; tested).

**Network failure.** Confirmed rounds, penalties and voids ride the **existing scoring outbox** (IndexedDB, bound to the account and event, ordered per match, refused entries kept for a person). No second offline system.
Finishing the match and the clock need signal. Offline is shown plainly ("Pending: NOT official until the server has it").

**Compatibility.** Nothing in Lyst Control touches `queue_state`, creates a notification, or changes My Next Fight / Event day (proved: notification count unchanged across the whole rehearsal until the finish; the finish moves the queue only through the
existing path). Classic scoring boards remain (a marshal can switch per device; refresh of a classic board is unchanged). Lyst Control applies to duels (the boards that score rounds: Sword and shield, Longsword, Buckler, Polearm); team fights, Profight and the series boards are unchanged.

## For Pack 14 (Broadcast): clean official data, nothing built
`lyst_public_state` (security_invoker view; one row per match with lyst activity): field, queue state, timer (mode, status, duration, remaining at start, started_at, revision), current round and status, official totals, confirmed round count,
official penalties list (`round, side, kind, label, amount`), `server_now`. Realtime already publishes `lyst_timer`, `lyst_rounds`, `match_discipline`. A future overlay can read exactly this; no broadcast UI, overlays or officials-certification were built.

## Security model (directly tested: `supabase/tests/pack13_gate.sql` 220 checks, `pack13_commit.sh` 14 parallel-session checks, `scripts/e2e/pack13-live.mjs` 88 browser checks against a real PostgREST + Postgres)
- Every write is a controlled function (`SECURITY DEFINER`, empty `search_path`, signed-in + role checks inside); no client has INSERT/UPDATE/DELETE on any new table; anonymous has no execute on any lyst/counter function.
- Staff = `private.can_score(event)` (organizer, head marshal, marshal, scorekeeper) for the tablet; settings and voiding anyone's record = `can_resolve_results` (organizer, head marshal). Another event's organizer, a medic, a fighter and a counter are refused (403/42501); the matrix is tested per function.
- Counters: own seat only, active + unexpired, match not final, round = the live round and running. Reads: own seat and own tally rows only. A stranger or another event's staff sees nothing.
- Public tables carry no account ids, reasons or counter data. Anonymous cannot read tallies, seats, revisions, private reasons, settings, match registry or join codes.
- Append-only: `lyst_round_revisions`, `lyst_counts`, discipline (void only). Cascade deletion of an event is not blocked differently from the existing `result_revisions`.
- Synthetic data: nothing here feeds rankings, statistics or aggregates (checked: no aggregate view references a lyst table).

## Defaults that were not in the rules text (all settings, all editable)
Round 1:00, break 0:30, long break 3:00, DQ 1:00, equipment 1:00 (from the operating description); duel regular rounds 2 and extra rounds 0:30 (the Duels rules text already in `tournament.ts`);
deduction amounts 1, 2, 3; reasons (Unsafe conduct, Illegal strike, Equipment, Conduct, Other); **no cards** (an event types its own); counter input by category (+2/+1 for Sword and shield and Longsword, one tap otherwise).
The head marshal or an organizer changes any of them in *Lyst settings* on the lyst screen.

## Evidence ladder (what was actually done)
See STATUS.md for the final table. In short: repository changed; typecheck, unit tests and production build pass; local database gates and real-commit/parallel-session tests pass; real-browser rehearsal passes against a real local Postgres + PostgREST;
hosted database, CI, deploy and production are recorded in STATUS.md as they happened. **Nothing was tested on a physical phone or tablet or in a real hall**: `docs/runbooks/PACK13_REAL_DEVICE_CHECKLIST.md` is the list to run.
