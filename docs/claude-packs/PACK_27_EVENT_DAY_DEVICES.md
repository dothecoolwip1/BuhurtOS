# Pack 27: Event Day Counters and Devices (2026-10-07)

Durable work log. Levels kept apart: **repository**, **local database**, **build / tests**, **browser verification**, **hosted database**, **deployment**.

**Hosted Supabase and production are not touched during Pack 27 development. Nothing below claims otherwise until a rollout section says so with evidence.**

## 0. Starting point

| | |
| --- | --- |
| `main` at start | `3bccb4ed` (Pack 26 closed: PR #58 `27c0df24`, #59 `d2276f4c`, #60 `3bccb4ed`) |
| Branch | `ccr-ba2f7d4b-7bn1n5`, restarted from `main` `3bccb4ed` (this session's designated branch; it carries one phase at a time and is restarted from `main` after each phase merges) |
| Phases | A Official Counter Foundation · B Training Counters · C Counter and Device Operations · D Team Fight Counters · E Event Day Device UX and Resilience |
| Product model | **credential** (reusable or single-use event access: Counter QR, Training Counter QR, scorekeeper code, marshal code) · **device session** (one temporary browser session from a credential, one role context) · **operator** (the human using it; for counters a typed name, audit metadata not authentication) · **operational assignment** (what the session is doing now: Counter on Lyst 1 Red …). The phone is not the identity. |

## 1. Investigation (before any edit)

Read from the code on `main` `3bccb4ed` (Pack 26 merged), not from earlier notes. Three parallel surveys (credentials and devices; the counter and Lyst model; team fights, offline, realtime, public surfaces) plus first-hand reads of `20261020000100_pack25_counter_pool.sql`, `20261020000200_pack25_field_current_follow.sql`, `20261020000300_pack25_sides.sql`, `CounterPage.tsx`, `counters.ts`, `friendlyError.ts`, `DevicesPanel.tsx`, `GroupCounterRounds.tsx`, `LystScoring.tsx`, `deviceSession.ts`, `supabase.ts`, `AuthContext.tsx`. Every claim below was reconfirmed against a file and line on `main`.

### 1.1 What Packs 25 and 26 left in place

**Pack 26 did not touch counters or devices**: its one migration redefines `push_claim`, adds `private.field_label` and rewrites `private.notification_text`. Its client changes were Lyst wording (`fieldLabel`), the second-tablet "This fight is final" guard, event filters, progress rules. So the counter and device architecture is Pack 25's (25, 25.1 follow, 25.2 sides, 25.3 polish) on top of Pack 13 (Lyst) and Pack 18.1 (event sessions).

**Credentials and sessions** (`20261015000100_pack181_event_sessions.sql`, Pack 25 §counter pool).
- `event_credentials.kind in ('device','controller','counter_pool')`; a `counter_pool` row carries a plaintext 12-character Crockford `pool_code`, one open pool per event (partial unique index). Device and controller credentials stay single-session (`event_sessions_one_open` applies only where `multi = false`); pool sessions are `multi = true`. So **§8 (reusable low-privilege credential, many sessions) already exists** and privileged credentials remain single-session.
- The Edge Function / local handler opens a session from the pool code; the browser stores it in `localStorage['bos-device-session']`; `isDeviceMode()` picks `createDeviceClient` per page load (`src/lib/supabase.ts`), `App.tsx` mounts `DeviceApp` for device mode. **The account token (`sb-…-auth-token`) is never deleted by device code**; device sign-out clears only the device key and does `location.replace('/device')`.
- `private.device_ctx()` / `assert_session_alive()` / `private.counter_session()` derive session, event, credential and role from `auth.uid()`: the client never names its session or event. **§13 (direct server operation from trusted context) exists as `counter_bind(p_field, p_side, p_operator)`.**
- `counter_pool_code(p_event)` returns the pool code to the organizer, head marshal, marshal and scorekeeper (`can_score`); fighters and other events are refused (gate §3).

**Counter model** (Pack 25 on Pack 13).
- `counter_bindings(session_id pk, event_id, field_key, side, operator_name)` = the operational assignment; `counter_operator_log` (append-only; session, event, operator, field, side, started/ended) = operator turns; `lyst_counter_seats` (role official/learning, status, match_id, side, display_name, `user_id` = session id or account id) = the observation on one fight; `lyst_counts` (append-only, client-chosen id, weight, `undo_of`, `operator_name`) = taps and undos; `lyst_counter_rounds` = "Done with round" marks; `lyst_field_current(event_id, field_key pk) → match_id` = the one current fight per Lyst.
- `counter_record(p_id, p_seat, p_round, p_weight)` takes the **match from the seat**, never from the client, and refuses: not your seat (42501), seat not active/expired, `WAITING_FOR_FIGHT`, no side, match final, `ROUND_NOT_STARTED`, `ROUND_CHANGED` (round not the max), `ROUND_ENDED` (round not running), weight outside the input mode, standing over `lyst_per_side`. Retried ids answer `duplicate`. **§15–16 stale rejection exists.**
- `private.counter_rebind_field(event, key, match)` runs from `lyst_open` and from the `lyst_timer` trigger (25.1): every active seat on another match is ended (taps kept) and recreated at zero on the new match with the same side and role; bound sessions with a side but no seat get a seat. **§14 following the Lyst exists** and is audited `lyst.counters_followed`.
- Handoff: `counter_set_operator` keeps the seat and its tally, closes/opens the operator-log turn, stamps later taps with the new name. Change Lyst/side: `counter_bind` ends the old seat (taps kept) and creates a new one. **§18–19 exist**, with the caveats in 1.2.
- Undo: `counter_undo` reverses the seat's latest un-undone tap in the round; one undo per tap (`lyst_counts_one_undo`). Submission: `counter_submit` writes `lyst_counter_rounds`, informational only (✓ on the tablet); the official round is only ever `lyst_confirm_round` with the marshal's numbers; `lyst_finalize` reads only `lyst_round_scores`. **§21–22: per-observer undo and the manual, informational submission model exist.**
- Many counters per side: no slot limit, per-seat tallies (`lyst_seat_total`), nothing anywhere sums or averages (`rounds.ts` header, `CounterEvidence` lists each seat). Tested in gate §4, pack13-live 36/57, pack26-live 101/111. **§10 exists.**
- The old ceremony (`request_counter_seat`, `assign_counter_seat`, `carry_counter_seats`, pending/declined, client seat carry) was **dropped in Pack 25** (`M25:703-707`); the gate asserts the functions are absent; `src/` has no reference. **§23 is done except for leftovers** (1.2).
- Phone landing (`CounterPage.tsx` `DeviceCounter` + `nextStep`): operator → Lyst (skipped with one Lyst; shows "now fighting" names per Lyst) → RED/BLUE (fighter names) → count. No approval step, no "seat" words on screen (`friendlyError` maps the two seat messages). **§9 exists**, except the remembered name (1.2).
- Count screen: badge, side, Lyst, operator, competition/round, fighter vs opponent, last/now/next, clock, banner, big count, Undo, Done with round, "New counter" / "Change side" / "Change Lyst" / "Stop counting", offline queue `TapQueue` in `localStorage['bos-lyst-taps:<seat>']`. **§20 mostly exists.**
- Scoring tablet: `LystScoring` renders a compact `CounterEvidence` strip under the score and rounds; the Counters drawer has This fight / Counter QR / Training QR / Sides. **§24 partly exists.**

**Training** (Pack 13 join codes reworked in Pack 25): `lyst_join_codes` one 10-char code per (event, field), 12 h; `join_training_counter(code, name, side)` is **accounts only** (`M25:410` refuses device sessions), creates a `learning` seat on that field's current match, 8 h; trainees follow the Lyst through `counter_rebind_field`; learning seats are excluded from hints (`LystScoring.tsx:315`), from public state (no counter columns at all), from finalize detail; the snapshot tags them `role: learning`. There is no official comparison in the trainee's state.

**Team fights** (`GroupCounterRounds.tsx` under the classic `ScoringScreen`): calls `openLyst(match, 'standing')` once if no `lyst_matches` row exists; "Start/End round N for counters" drive `lyst_timer_command`; when the board's rounds-won moves up it writes `confirmRound` 1–0 directly over RPC (errors swallowed, retried each poll); the result is `submitMatchResult` from the board, not `lyst_finalize`. Phone standing mode: server stores downs, phone shows `per_side − downs`, refuses the (n+1)th down. `lyst_per_side` parses the category (`5v5` → 5) with fallback 1; the client `perSideFor` falls back to 5.

**Devices tooling**: `list_event_device_sessions` (organizer / head marshal / scorekeeper on the server; the UI shows the tool to the organizer only), `platform_device_sessions` (cross-event, platform staff), `move_counter_session` (owner or `can_score`; audit `counter.moved` records only the new field/side; the operator log is not touched), `end_event_session`, `device_session_preview` (owner or `can_command`; returns `counter_state_for(session)`), `counter_operator_history`. The device allowlist (`supabase/tests/device_allowlist.txt`) is pinned by `pack181_sessions_gate.sql`; `device_session_preview` and `counter_operator_history` are not on it (staff RPCs, correct).

**Offline / realtime**: the phone polls `counter_state()` every 2.5 s (no realtime, correct: realtime is not the sole mechanism anywhere); the tablet polls 2.5 s plus nudges on `lyst_timer`, `lyst_rounds`, `match_discipline`; counts and seats reach the tablet by poll only. `TapQueue` sends in order, stops on offline or a thrown error, drops the round's queue on a refusal.

**Public surfaces**: `lyst_public_state` has no counter/operator/session columns (gate §12 asserts the column names); anon cannot read `lyst_counts`, seats, bindings, operator log, sessions, credentials (gate §13, pack26-live 195–199). Exposed but harmless: `lyst_timer.last_command` (a client command uuid), `match_live_scores.device` (a per-tab opaque id).

**Tests in place**: `pack13_gate.sql` §3–4, §9–15 (counter pool, binding, counting, stale, handoff, follow, snapshot, finalize ignores counters, RLS, anon, allowlist of absent ceremony functions); `pack13_commit.sh` check 5 (30 concurrent seats); `lyst.test.ts` counter block; `pack13-live` 19–76; `pack25-live` 40–73; `pack26-live` 88–129. No SQL gate covers standing mode at all.

### 1.2 Gaps against the Pack 27 behaviour, by phase

**Phase A (Official Counter Foundation)**
- A1 The counter's name is not remembered on the phone (`§9`): it lives only in `counter_bindings` for that session; a re-scan asks again.
- A2 "Seat" wording still reaches people indirectly: the `friendlyError` mapping for "not your counter seat" is unreachable (42501 is answered first, `friendlyError.ts:14` before `:16`); the banner says "This phone's place on the Lyst has run out"; the server messages themselves say "seat"; `lyst_join_codes` comment and `end_counter_seat(p_decline)` carry old-model words.
- A3 Operator-turn model (`§11–12`): `counter_operator_log` has no `match_id`; handoff **overwrites `display_name` on the active seat** (`M25:376`), so the round snapshot credits the whole tally to the latest operator (gate :343 even expects `Oak:33` where Ash tapped 32). Taps already carry `operator_name` per row, so the evidence exists; the snapshot and the tablet attribute it wrongly.
- A4 One-active-match-per-Lyst (`§17`): the only invariant is the `lyst_field_current` PK. `lyst_open` replaces the current match without checking the previous one is mid-round; the timer trigger rewrites `lyst_field_current` on any timer status change, so a stale tablet pausing the old fight can pull the phones back ("ping-pong"); nothing tests concurrent `lyst_open`.
- A5 No test sends a tap or undo with the **old seat id after a rebind** (only a tap on a final match before rebind is covered); concurrent undo is untested (`counter_undo` `on conflict do nothing` answers `ok` for a swallowed second undo).
- A6 Count screen: "Stop counting" calls `counter_leave` and returns to the landing; there is no "Exit Counter" that ends the device session and returns a personal phone to normal (`§6, §20`); queued taps for an old seat stay in `localStorage` for ever, silently (`§20`); "Done with round" ignores `state.submitted`.
- A7 Tablet (`§24`): the compact strip omits `sides`, so custom side names fall back to Red/Blue there (`LystScoring.tsx:357`); it sits under the rounds rather than beside the score; waiting phones are matched to seats by operator name (`CountersPanel.tsx:60`).
- A8 Personal phone (`§6`): the token is preserved, but nothing tests it end to end, nothing says so on scan, and exit lands on `/device` instead of where the person was.
- A9 Counter QR lifecycle: `DevicesPanel` drops the pool credential from its lists (`splitCredentials`), there is no UI to revoke or regenerate the Counter QR, `replace_event_credential` refuses a pool, and `revoke_all_event_devices` only revokes `kind = 'device'` (pool sessions survive "sign every device out"). The Counter QR itself is retrievable from Lyst Control › Counters › Counter QR.
- A10 `RoundEntry` lets one tap copy a single counter's total into the awarded score (recorded as `recommended`): an explicit marshal choice, documented here as such; the result is still never computed from counters.

**Phase B (Training Counters)**
- B1 `join_training_counter` requires a signed-in account and refuses device sessions, so a phone that scanned a QR cannot train (`§30`).
- B2 The Training QR is **per Lyst** (`lyst_join_codes.field_key`): the trainee never chooses a Lyst and cannot change side in place (`§29, §31`).
- B3 No official same-side comparison in the trainee's state (`§33`).
- B4 Trainee renames are not logged; a trainee who joins a second field keeps the first seat.
- B5 pack26-live 114 says "and the trainee" but asserts only official seats.

**Phase C (Counter and Device Operations)**
- C1 No single Counter QR sheet with Official and Training side by side plus instructions, reachable from Run hub / Lyst header / Lyst Control (`§36–37`); today: two tabs in the Counters drawer.
- C2 Event Devices rows show the role only via a sentence; pool and single-use are not distinguished; `SIDE_WORD` is hardcoded Red/Blue (`devices.ts:152`); no revoke from the session views; Move audit lacks the previous field/side and does not write an operator-log turn; the Move Lyst list is built client-side (`§38–41`).
- C3 View Screen is a summary card of `device_session_preview` (counters only), not the counter's screen (`§42`).
- C4 The devices tool is organizer-only in the UI though the database allows head marshal and scorekeeper to list sessions.

**Phase D (Team Fight Counters)**
- D1 The server stores downs; the tablet `CounterEvidence` shows downs labelled as a count; the phone alone computes standing (`§47`).
- D2 Starting count fallbacks disagree (server 1, client 5); a `buhurt` competition whose category is not `NvN` gets `per_side = 1` (`§48`).
- D3 The board round is device-local; `lyst_rounds` is a best-effort mirror over a direct RPC that swallows errors; the board can run ahead of the Lyst round (`§49`).
- D4 `GroupCounterRounds` hardcodes `names = {a:'Red', b:'Blue'}` and `'standing'`, and its header counts seats, not fighters.
- D5 Next team fight rebinds only if `openLyst` runs on mount or the clock starts; `ScoringScreen`'s "Next fight" does not call `openLyst`.
- D6 No SQL gate for standing: `lyst_per_side`, the bound, weight = 1, `counter_input = 'standing'`; pack26-live 127 is vacuous (`|| true`).

**Phase E (Event Day Device UX and Resilience)**
- E1 Error language: a 42501 during the 30 s window before `device_whoami` notices is shown as "The round had already ended"; the pump never uses `friendlyError`; expired/ended messages do not say "This counter session has ended."
- E2 `flushTaps` drops **all** queued items for the round on any refusal, including an Undo queued after an over-tap (`counters.ts:57-60`).
- E3 No pump on `visibilitychange` (state refresh only).
- E4 Reading-position shift (Pack 26 §9): cause by code reading is layout above the anchor changing height (Live ops glance/attention list; public `LiveFields` slots), no `overflow-anchor` rule exists; not reproduced in a browser yet.
- E5 Responsive matrix for the counter and devices screens not yet recorded for 360/390/landscape/768/1024/desktop in Pack 27 terms.

### 1.3 Decisions taken from the investigation

- Phase A is **verification plus gap-filling**, not a rebuild: `counter_bind` is the "take a corner" operation and keeps its name (renaming a working RPC on the device allowlist buys nothing); the ceremony is gone; follow, stale rejection, handoff and per-seat evidence exist and are tested. The Phase A migration is additive and small: `match_id` on operator turns, attribution-correct snapshots, the one-current-fight rule tightened, pool credential covered by revoke-all, people-facing server messages.
- Nothing here needs a second backend, a sync engine or realtime for counts.
- Hosted stays untouched: every migration is exercised only by `supabase/tests/run_all.sh` and the local stack.

## 2. Phase A: Official Counter Foundation

## 3. Phase B: Training Counters

## 4. Phase C: Counter and Device Operations

## 5. Phase D: Team Fight Counters

## 6. Phase E: Event Day Device UX and Resilience

## 7. Tests

## 8. Browser evidence

## 9. Known issues, deferred work, owner questions

## 10. STATUS of each phase
