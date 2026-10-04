# Pack 09B: Field-side scoring + Live Arena display

Branch `pack09b-field-scoring-arena` (from main `9d65342`, Pack 09A released). A future session continues from the checklist at the end.

Out of scope (09C): competition closeout, event closeout, podium / final-ranking publication.

## Preflight (2026-10-04)

* main `9d65342` had not moved. Hosted project `mvbxlebznlgroptwwdsm`: the repository fingerprint query run read-only against hosted gives the
  same 1170 objects as `supabase/schema.fingerprint.txt`; 25 function md5s differ, and every one of them is identical after stripping comments and
  whitespace (SQL-Editor pastes drop comments). No drift, nothing to re-run. Pack 09A queue objects present (column, 12 functions, 1 trigger).
* The hosted migration ledger lists only part of the chain (Packs 02-08 were pasted); real objects are the authority, as documented in STATUS.md.
* Supabase docs (via the docs search; supabase.com itself is egress-blocked here): Postgres Changes still supported and used by this app; Broadcast
  from database is the documented path for scale. New table needs RLS, explicit grants, publication membership. No deprecation touches what we use.
* Advisor baseline recorded before any change (security: 9 info rls-no-policy, 1 mutable search_path, 8 anon + 102 authenticated SECURITY DEFINER
  warnings = the repository's deliberate RPC pattern, 1 leaked-password-protection; performance: unindexed FKs, initplan, multiple permissive).

## Invariants kept (scoring engine, Pack 03/04/09A)

1. Boards are pure state in `src/lib/scoring.ts` / `marathon.ts` / `tournament.ts`; the UI renders what they return. Unchanged.
2. Every tap is queued in the device outbox (`record_score_event`, idempotent id, bound to user + event). Unchanged.
3. Finalization is `submit_match_result` with a per-board command id (idempotent), expected match version (stale detection), schema version
   window; `accepted | duplicate | conflict | stale`. Conflicts are kept for the head marshal, never overwrite. Unchanged.
4. The board for a match lives in IndexedDB until the server confirms. "Pending: NOT official" is never shown as official. Unchanged.
5. Queue advancement happens in the database at commit (Pack 09A). The scoring screen only reads the result of it.
6. `matches.version` is untouched by queue or live-score changes, so an open board is never made stale by them.
7. Public data: `matches`, `entries`, `competitions`, `events`, `fighters`, `teams` are readable by anon for published events; nothing private is
   joined into the Arena.

## Design

### Live score (the one new database concept)
Spectators want the score *during* the fight; the official result exists only at the end. The device already knows the running score; the
server did not. The smallest safe addition:

* `public.match_live_scores` (match_id PK, competition_id, score_a, score_b, phase text, detail jsonb, seq, device, updated_at). No auth user id: the table is public for published events, so who reported is not stored (the function still checks the caller may score).
  **Ephemeral display state, never a result.** RLS on; SELECT for anon/authenticated through the same public-event rule as `matches`
  (`private.is_event_public(...) or private.can_score(...)`); no INSERT/UPDATE/DELETE grants.
* `public.report_live_score(...)` SECURITY DEFINER (needed: scorers have no write grant on the table), explicit `auth.uid()` + `private.can_score`,
  fixed empty search_path, revoked from PUBLIC/anon, granted to authenticated. Refuses a final match and a stale match version; ignores an older
  `seq` from the same device (latest wins); another device simply takes over (two devices scoring one match is the conflict case the official
  path already handles). Returns `{status}`; the device never blocks on it.
* Trigger: when a match becomes final or is reopened (queue_state leaves `active`/live), the row is deleted. A result and its live score never coexist.
* Added to `supabase_realtime`, filtered per competition like `matches`.
* Writes: the scoring screen reports a snapshot (debounced 350 ms, fire-and-forget) after each board change. Offline: nothing is sent, nothing is lost.

### Scorekeeper screen (FieldPage, same engine)
Header: field, competition, stage; the two sides as the dominant element with the running score; a single **state banner** that is always one of
SCORING / READY TO CONFIRM / SAVING / OFFICIAL / PENDING, NO SIGNAL / NEEDS REVIEW / STALE. After OFFICIAL: winner, final score, **Next fight** (the
field's new active match, read from the server) and **Back to Event day**. Existing selectors used by CI (`Head or torso +2`, `End round`, `Finish match`,
`Save result`, `Pending: NOT official yet`, `Official: saved on the server`, `Needs review: not changed`, `Back to the queue`, …) are kept.

### Arena (`/events/:slug/arena`, `/events/:slug/arena/:field`)
Outside the site chrome (own route tree, no header/footer/nav/bug button). Public, anonymous, published events only. Dark, large type.
NOW (names, competition, stage, live score when reported), ON DECK, IN THE HOLE, one line of up next; a result card for ~25 s after a
finalization (from `finalized_at`, no client memory); intentional states: before the event, no draw, waiting, field finished, event over.
Field picker (Field 1 default; blank = Field 1; explicit names). Fullscreen API with graceful fallback; Exit always visible on hover/tap.
Data: `LiveSync` (realtime + polling fallback + safety refresh) over `matches` and `match_live_scores`.

## Decisions made while building
* The result card wins over "now fighting" for 25 s after a result (`finalized_at`), because the queue calls the next pair in the same commit as
  the result; the footer then reads **Up next** / **On deck**. The moment the next fight's scorer reports a score, the fight takes the screen.
* The scorekeeper's action row sits in flow at the end of the board, not floating: a sticky bar covered End round and Undo, the taps that matter.
* `.ar-*` / `.sk-*` class names only on the new screens: the app's global `.result` class was painting the arena result card.
* Phase on its own line on the display ("Round 2 of 2"); on short screens (≤ 820 px tall) the rhythm tightens so the fight and both next slots fit.

## Evidence (local, 2026-10-04)
* Database: `pack09b_gate.sql` 47 checks; full `supabase/tests/run_all.sh` (every gate, simulation, concurrency, fingerprint 1194 objects) passed.
* Unit: `arena.test.ts` 12, `liveScoreSnapshot.test.ts` 5; whole suite passes; typecheck and production build clean.
* Real stack (`scripts/e2e/arena-live.sh`, Postgres from the migrations + fixture, PostgREST, the real built app, Chromium): 103 checks across a
  scorekeeper phone (390), a 1080p display in a second anonymous context, a late-opened laptop display, tablet 768 portrait and 1024 landscape.
  Covers: open from Event day, live score reaches the display without a touch, undo, decided-but-unsaved stays a running score, Finish → confirm →
  Save → OFFICIAL with Next fight / Back to Event day, the result card then the next fight, Event day advances without reload, reload and a fresh
  screen rebuild from the server, display offline and back, scorer offline (PENDING, Try again → OFFICIAL), a conflicting result (Needs review on the
  phone, the official result on the display), a stale board (older version refused, nothing written), two fields isolated (blank = Field 1,
  case-insensitive name), anon/stranger/direct-table writes refused, no account id in a public row, unpublished event hidden, fullscreen fallback,
  no sideways scroll and 44 px controls at every size. The local stack has no realtime socket: the display is kept fresh by its 15 s polling fallback
  there; hosted, realtime makes it immediate.
* Regression: the CI browser suites unchanged (field-pack03 28, sw-update 28, pack07-ux 89, pack08-entrants 54, sample-mode 34, rankings-teams 22)
  and the Pack 09A real-stack run `eventday-live` 78 checks (it now finds the pairing in a visually hidden heading on the scoring screen).
* Screenshots reviewed at 1920×1080, 1366×768, 768×1024, 1024×768 and 390×844 (scorekeeper and display).

## Checklist
- [x] Preflight, docs check, advisor baseline, invariants, design
- [x] Migration + gate + fingerprint
- [x] Scorekeeper screen
- [x] Arena
- [x] Real-stack browser runs (scorekeeper journey, arena journey, multi-field) + screenshots at 390 / 768 / 1366 / 1920
- [x] Regression suites (CI browser suites, eventday-live)
- [ ] Advisors after the hosted migration
- [ ] Hosted migration applied + verified, merge, CI, deploy, smoke
