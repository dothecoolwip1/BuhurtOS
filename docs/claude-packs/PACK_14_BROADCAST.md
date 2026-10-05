# Pack 14: Broadcast, livestream and spectator graphics (2026-10-08)

Branch `pack14-broadcast` (from `main` at `12f2e66`, Pack 13 merged). Read with `STATUS.md` (Pack 14 section). Nothing here is deployed.

## 1. Investigation: where the authoritative state already lives (nothing is copied)
| Needed on screen | Authoritative source (already public) | Used by |
| --- | --- | --- |
| active / next / following fights, field, order | `matches.queue_state` + `field` + queue order, read through `useArenaData` / `buildArena` (Pack 09B) | Arena now, overlay next |
| fighters / teams, corner | `entries` (`fighter_id` / `team_id`) → `fighters`, `teams` (public read; teams only when approved) | `matches` select |
| crest, emblem, colours, country/region | `teams.colors / crest_division / initial / emblem_path / city / region / country`, bucket `team-emblems` | `Crest` component |
| photo | `fighters.avatar_path`, bucket `avatars` (public) | profile pages |
| record | `fighter_career(fighter)` / `team_career(team)` (Pack 10, security invoker, official context excludes test events) | profile pages |
| official score, round, round state | `lyst_public_state` (Pack 13: official totals of confirmed rounds, current round + status) | Arena |
| clock (round, break, equipment, DQ countdown) | `lyst_timer` through `lyst_public_state` + the measured server-clock offset (`ServerClock`) | Arena |
| cards, warnings, deductions, DQ | `lyst_public_state.discipline` (official records only) | Arena |
| winner / result / "final" | `matches.result`, `winner_entry_id`, `score_a/b`, `finalized_at` (result hold window `RESULT_HOLD_MS`) | Arena |
| event, competition, division names | `events`, `competitions` via `fetchEvent` | Arena |
| realtime | `LiveSync` (per-competition realtime + polling fallback + full reload on reconnect); `useLystPublic` (poll 3 s + realtime nudge) | Arena |
| public visibility | RLS through `private.is_event_public` (published, and organization-enabled) | every public table |

What does **not** exist and is therefore the only new state: a stream address for the event, sponsor logos for the event, and the per-event broadcast presentation options. Nothing about scores, timers, cards or the queue is new.

## 2. Decisions
1. **No second state system.** The overlay is another read-only view of the same data the venue display (Arena) already consumes. It reuses `useArenaData` + `buildArena` + `useLystPublic`; the presentation-state machine (`src/lib/broadcast/state.ts`) is a pure function of those inputs and the server clock. Nothing is stored for OBS.
2. **No secret token.** The overlay shows only what the public Arena already shows for a *published* event, so a secret in the URL would protect nothing and would add a false sense of security. The URL carries only the public event slug, the field and presentation options (`layout`, `bg`, `scale`). It cannot write (the page has no write calls and the database grants no write to anyone but organizers through functions), cannot reach a draft event (RLS), and cannot expose private data (it reads public tables only; no account, contact or health column is selected). Organization boundaries are enforced by the same `is_event_public` rule.
3. **Presentation states** are derived, never operated: event idle, upcoming, intro (fight called to the field, no round yet), match ready (clock armed), live, paused, round break (break clock or "scores being confirmed"), equipment timeout, DQ countdown, disqualification, match complete (first seconds after the result), winner/result (hold window), between matches. A scorekeeper does nothing for the broadcast.
4. **Smallest additions:** two tables (`event_broadcast`, `event_sponsors`), one storage bucket (`sponsor-logos`, public read, organizer-only write by path), three organizer functions. Fighter / team presentation reads existing public tables and the existing career functions. No broadcast-specific copies of profiles or statistics.
5. **Stage:** a fixed 1920×1080 canvas scaled to the browser source size, transparent background by default (OBS composites it over video), a chroma-green option, and layouts: `full` (scorebug + lower-third + queue + sponsors), `bug` (scorebug only), `queue`, `sponsors`.
6. **Recovery:** the overlay never trusts its last local state. Realtime is a nudge; polling and the full reload on reconnect re-read the server. The clock is `remaining_ms − (server now − started_at)` using the measured server offset, so it is right after any gap. Data older than 20 s is flagged (`data-stale`, optional visible dot with `?status=1`).
7. **Admin** (Manage › Broadcast, phone-first): stream address, OBS URLs per field and layout (copy buttons, size hints), corner scheme, records / photos / sponsors switches, sponsor list with logo upload. **Public event page:** embedded livestream (allow-listed YouTube / Twitch / Vimeo hosts only) with the live fight, clock and next fight beside it, from the same hooks.
8. **Out of scope** (not built): advertising platform, sponsor impressions, scheduling of sponsor slots, chat, replay, camera switching, a separate broadcast backend, PowerSync, an offline layer.

## 3. Database (additive, `20261008000100_pack14_broadcast.sql`)
- `event_broadcast(event_id pk, stream_url, stream_title, corners, show_records, show_photos, show_sponsors, sponsor_seconds, updated_at)`: public read for public events, organizer-only write through `set_broadcast_settings`.
- `event_sponsors(id, event_id, name, logo_path, link_url, tier, sort_order, on_broadcast, created_at)`: same read rule; `save_event_sponsor` / `remove_event_sponsor` (organizer). Sponsors are presentation, not sporting history: removal is a delete, audited.
- Storage bucket `sponsor-logos`: public read; insert / update / delete only for an organizer of the event named by the first path segment; png / jpg / webp, 512 KB.
- Every write is audited with `private.audit`. No account ids in any public column.

## 4. Status of each level
See `STATUS.md`. Hosted Supabase is **not** touched by this pack until the owner asks.
