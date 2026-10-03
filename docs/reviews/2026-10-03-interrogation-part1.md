# BuhurtOS interrogation — Part 1: evidence and the 1,012 questions

Date: 2026-10-03. Read-only pass: no repository file was changed (the only repo write earlier today was the question-bank doc, before this task).

## 0. How to read this

**Evidence tags.** `[V]` = I verified it this pass in code, the hosted database, a build, or an official page. `[D]` = stated only in a document and not confirmed. `[U]` = **not inspected** this pass. I did not render the public pages, watch a real phone, or test hosted behaviour beyond SQL. Where a question needs that, it is marked UNVERIFIED rather than guessed.

**Classes.** STRONG / PARTIAL / MISSING / NOT NOW / BAD IDEA / OWNER DECISION, as you defined. I add UNVERIFIED as a *suffix* when I could not check (e.g. `PARTIAL?` = probably partial, unverified).

**Coverage honesty.** Questions are answered in ranges where the answer is the same; every number 1–1012 is covered. Detail (evidence / user problem / solution / effort / risk / dependency / timing) is given once, in section 2, for every PARTIAL/MISSING finding that was actually evidenced, and the question ranges point to those findings (F1…F30).

**What I inspected.** docs (VISION, PROJECT_SPEC, TEST_PLAN, ANALYTICS_PRIVACY, README, ADMIN_MOCK_RETIRED); package.json; `App.tsx` routes; `outbox.ts`, `useOutbox.ts`, `scoreSender.ts`, `FieldPage.tsx` scoring/save path, `boardStore.ts`; `public/sw.js`, `swPrecachePlugin.ts`, `manifest.webmanifest`; `.github/workflows/pages.yml`; a production build (bundle sizes); the 30 migration filenames; and, on the **hosted Supabase project** (read-only SQL): table/RLS/policy counts, function counts and anon grants, realtime publication, buckets, extensions, row counts per table, event and team lists, `record_score_event` source, column lists for fighters/competitions/matches/results, and the security advisor. I also read two official pages (Supabase Realtime docs, MDN/WebKit on Background Sync and Web Push).

**What I did not inspect:** most page components (visual design, copy, 390px layout of public pages), `tournament.ts`/`bracket.ts` logic internals, most SQL function bodies other than `record_score_event`/`finalize_match` headers, storage policies, hosted Auth settings, Supabase backups/plan, PostHog ingestion, the live site (blocked from this sandbox).

---

## 1. The most important facts found (read these first)

| # | Finding | Evidence |
|---|---|---|
| E1 | **The production database holds a fictional league published next to the real one.** 16 published events named `…-test` (2023–2026), 851 matches, 596 results, 121 fighters, org `nacl-test`; 10 real HACSA teams sit alongside `-test` teams. The real **Red Deer Rumble 2026 is still `draft`**, while `red-deer-rumble-test` is **published with the same start date (2026-11-14)**. | hosted SQL `[V]` |
| E2 | **"Scoring works offline" is only half true.** Score *actions* are queued locally, but the **result is committed online-only**: `save()` drains the outbox, then calls `finalize_match`; if signal is absent it shows "still waiting… try again". The queued `score_events` table has **0 rows** and nothing reads it; `finalize_match` takes the result as arguments, not from the log. | `FieldPage.tsx:75–90`, `scoreSender.ts`, hosted `score_events=0` `[V]` |
| E3 | **Outbox weaknesses.** One global FIFO queue per device: a single `retry` at the head blocks every match and field on that phone. Rejected (permanently refused) entries are kept **only in a JS variable** and vanish on reload. Storage is `localStorage` (try/catch swallows quota errors), not IndexedDB. | `outbox.ts:59–101`, `useOutbox.ts:7–40` `[V]` |
| E4 | **The CI gate is thin.** CI runs typecheck + unit tests + build only. The four SQL gates (90+695+68+65 = 918 checks), the browser audits and the privacy checks run **only on a developer machine**. No Dependabot, no CSP, no Playwright in CI. Every push to `main` auto-deploys, including during an event. | `pages.yml`; no `.github/dependabot.yml` `[V]` |
| E5 | **One 989 kB JS chunk (276 kB gzip) for everyone**, plus a 293 kB lazily loaded PostHog module. Spectators on venue cellular download admin, platform and scoring code. | `npm run build` today `[V]` |
| E6 | **Realtime uses Postgres Changes on whole tables** (`matches`, `entries`) with no row filter in the subscription call; Supabase documents per-subscriber authorization cost and recommends Broadcast above ~3,000 concurrent subscribers. | `useLiveMatches.ts:62–73`, `FieldPage.tsx:182`; Supabase docs `[V]` |
| E7 | **Fighter identity has no claim or merge path.** `fighters` ↔ `fighter_accounts` exist (a fighter can exist unclaimed), but there is no claim-request table and the only merge function is `merge_teams`. `fighters.team_id` is a single nullable column; history lives in `team_memberships`. | hosted schema `[V]` |
| E8 | **No slug history or redirect table**; 35 `on delete cascade` clauses across migrations (e.g. team→membership rows). Event/team URLs are slugs. | migrations grep `[V]` |
| E9 | **Docs are stale and one is wrong.** README says "Backend (Supabase) is not connected yet; the UI reads from a typed fixture layer" and lists rankings pages, notifications as "not built". `RankingsPage`, `NotificationBell`, `NewEventPage`, Supabase RPCs all exist. TEST_PLAN says there is no create-event/team screen (there is). PROJECT_SPEC lists notifications and organizations UI as out of scope until after the Rumble (both exist). **No `CLAUDE.md`.** Hosted migration history lists 22 entries vs 30 migration files. | `[V]` |
| E10 | **Security advisor:** 6 SECURITY DEFINER functions are callable by `anon` (`fighter_profile`, `list_active_organizations`, `report_bug`, `team_roster`, `track_activity`, `track_event`; all intentional public). 64 definer functions are callable by signed-in users (by design; checks are inside). 7 tables have RLS and **no policy** (deny-all, accessed only via functions: intended). Leaked-password protection off. `/test-login` ships in the production bundle. | advisor + `App.tsx:59` `[V]` |
| E11 | **PostHog project 643201 had console-log and performance capture ON** until I turned them off earlier today. The transformation chain could not be re-read (tool denied). Production site not browser-verified. | earlier today `[V]` |
| E12 | **Good foundations are real:** 38 tables, all with RLS; 48 policies; 64 definer functions all with `search_path` set (the two inspected); `record_score_event` is idempotent (`on conflict do nothing`); `finalize_match` uses an expected-version check (stale → refused, not last-write-wins); `reopen_match` exists; `audit_log` 1,043 rows written only by definer functions; `ruleset_versions` table and `competitions.ruleset_version_id` exist; `record_sources`/`sources` give provenance; seasons, organizations, team affiliations exist; hosted DB rebuilds locally from migrations (918 checks pass today). | `[V]` |
| E13 | **Service worker is more complete than the README implies:** app-shell precache keyed by build hash, offline navigation fallback, public-read cache for `events/competitions/matches` (network-first for matches), fonts cache. **But** `skipWaiting()` + `clients.claim()` swap the code under an open scoring screen, and there is **no minimum-client-version check** against the server. | `public/sw.js` `[V]` |
| E14 | **Stack versions are unusually new** (TypeScript 7.0.2, Vitest 5, Vite 8.3, React 19.3). React Router is used **declaratively** (`BrowserRouter`+`Routes`), no data APIs; no TanStack Query, no Zod/Valibot, no generated Supabase types, no map library. | `package.json` `[V]` |

---

## 2. Findings requiring work (F-list)

Format: **evidence → user problem → solution → effort / risk / dependency → timing.**

**F1 Test league on production (E1).** Spectators and rankings mix fiction with reality; the same-date `red-deer-rumble-test` can be mistaken for the real event; any "rankings" derived from 596 fictional results mislead. → Everyone, especially newcomers. → Keep test data but make it *structurally* non-public: add `is_test`/`visibility` flag (or move to a separate Supabase project); public queries filter it; testers see it only when signed in with a test account. At minimum unpublish all `-test` events before real registration opens. Effort: Small. Risk: medium (touches every public query/RLS). Dependency: owner decision on separate project vs flag. **Before Nov 1.**

**F2 Real event is a draft (E1).** Registration cannot work for the public until it is published. → Fighters/captains. → Owner publishes after waiver, categories, fee, closing time are confirmed and a dry-run registration completes. Effort: Tiny. **Before Nov 1.**

**F3 Offline finalize (E2).** Marshal scores a fight in a field with no signal; the screen keeps the board but cannot save; the result is invisible to spectators and brackets cannot advance until a phone regains signal; if the phone dies, localStorage board is the only copy. → Scorekeeper, organizer, spectator. → Decide the contract: either (a) **queue the finalize as a command** in the outbox with the expected version, show "Saved on this device, not yet on server", and let the server reject/flag conflicts for an organizer review list; or (b) accept online-only finalize and say so plainly, plus a **paper-score fallback** and an organizer "enter result" override. Option (a) is Medium. The `score_events` log should either become the audit source of truth or be dropped (currently dead weight). Risk: high (touches the integrity path) so it needs the SQL gate plus a concurrency test. **Nov 1–14 (decision) / probably after Rumble (build) unless venue connectivity is known to be poor.** OWNER DECISION on connectivity at Horse in Hand Ranch.

**F4 Outbox hardening (E3).** → Scorekeepers. → Persist rejects (so a refused score is still visible after reload); make the queue non-blocking across subjects (retry on one match should not stall another field); move to IndexedDB (or at minimum detect `QuotaExceeded` and warn); show "n unsynced" persistently. Effort: Small–Medium. Risk: medium. **Nov 1–14.**

**F5 CI is not the gate (E4).** The things that protect integrity (918 SQL checks) are not enforced on merge. → Everyone (regressions on event day). → Run the SQL gates in CI against a Postgres service container with `run_nacl_league.sh --no-seed`; add a Playwright smoke (home, event, register, field screen at 390px, offline→online). Add Dependabot (security updates). Add a **deploy freeze** convention (no merges to `main` Nov 13–15) or a manual approval on the `github-pages` environment. Effort: Small–Medium. Risk: low. **Before Nov 14.**

**F6 Bundle splitting (E5).** → Spectator on cellular. → `React.lazy` per route group (manage, platform, field, rules), keep public shell small. No framework change needed with React Router 7 declarative mode. Effort: Small. Risk: low. **Before Nov 14.**

**F7 Realtime scope (E6).** → Spectators / scorekeepers. → Add `filter: competition_id=in.(…)` or `event_id` (needs the column on matches/join) to subscriptions; keep a polling fallback; consider Broadcast **after** Rumble. At 16–40 duelists and a few hundred spectators Postgres Changes is acceptable; the doc threshold (~3,000 subscribers) is far away. Effort: Small. Risk: low. **Before Nov 14 (filter) / Later (Broadcast).**

**F8 Fighter identity: claim and merge (E7).** → Fighters with a historical record, organizers cleaning duplicates. → `fighter_claims` (request → organizer/owner approval, source evidence) and `merge_fighters(keep, remove)` mirroring `merge_teams` with audit entry and re-pointing `entry_fighters`, `team_memberships`, `results`. Effort: Medium. Risk: high (history rewrite) → test with gates. Dependency: owner rules on who approves. **Immediately after Rumble.** The vision's "claim flow" was already on the PROJECT_SPEC cut-list.

**F9 Slug history (E8).** Renaming a team/event breaks shared links, QR codes and search results. → Everyone sharing links. → `slug_history(entity, old_slug, entity_id)` + lookup fallback in route loaders. Effort: Small. Risk: low. **Immediately after Rumble** (before QR codes ship).

**F10 Delete semantics (E8).** `on delete cascade` from teams/events can destroy sporting history. → Historians, organizers. → Replace hard delete with archive for published events/teams; keep cascades only for draft/private data; document the rule. Effort: Small–Medium (audit 35 cascades). Risk: medium. **Immediately after Rumble**; for Rumble, ensure no UI exposes delete on published events (unverified `[U]`).

**F11 Doc drift (E9).** A new developer or agent will build on false statements. → Maintainer. → Rewrite README (stack, status, what exists); mark TEST_PLAN with a date and "stale items"; add `CLAUDE.md` with permanent rules (DB authoritative, RPC for mutations, outbox contract, privacy invariants, test gates); reconcile hosted migration history by documenting the drift, **without** re-running migrations. Effort: Small. **Before Nov 1.** *I did not make these edits; you asked for no changes.*

**F12 `/test-login` in production (E10).** A password form for `@buhurtos.ca` accounts is reachable on the real site. If test accounts exist with weak passwords, they could score fictional events (and whatever RLS grants to those roles). → Platform operator. → Build-time gate (`VITE_ENABLE_TEST_LOGIN`) or remove after QA; delete test auth users before real registration; confirm no test account holds a real role. Effort: Tiny. **Before Nov 1.** Also enable leaked-password protection or confirm password auth is off for real users.

**F13 Rate limiting (E10).** `report_bug`, `track_activity`, `track_event` are anon-callable definer functions: spam/storage abuse vector (activity events are capped per session, bug reports are not verified). → Operator. → Per-IP limits at the edge are not available on GitHub Pages; use in-function throttles (per session/ip hash, size caps) and keep the 90-day purge. Effort: Small. **Before Nov 14.**

**F14 Stale service worker mid-event (E13).** A tab open since yesterday can run old scoring code against a newer schema; `skipWaiting` can swap assets under a live screen. → Scorekeeper. → Add `min_client_build` check in a small RPC/`app_config` row; if the client is older, block *finalize* and show "update required"; replace silent `skipWaiting` with an "Update available" prompt that waits for an idle moment; show build id on the field screen. Effort: Small–Medium. Risk: medium. **Nov 1–14.**

**F15 Event-day deployment control.** No rollback runbook is documented `[D]` (none in docs). → Organizer. → Document "revert to previous Pages deployment" (GitHub Actions re-run of last good SHA) and DB rollback stance (additive migrations only during the event). Effort: Tiny. **Before Nov 14.**

**F16 Backups and restore.** Plan and backup configuration not verifiable from here `[U]`. → Everyone. → Owner confirms plan (free plans have no point-in-time recovery), performs one export and one restore test into a scratch project, and writes an event-day export (CSV of brackets/results) for paper continuation (`exportCsv.ts` exists for registrations). Effort: Small. **Before Nov 14.**

**F17 Type safety at the RPC boundary (E14).** `submit_registration(p jsonb)`, `update_team_profile(p jsonb)`, `request_new_team(p jsonb)` accept free-form JSON; client types are hand-written. → Developer. → Generate Supabase types in CI to detect drift; add Zod/Valibot only at the jsonb entry points and import paths (not everywhere). Effort: Small. **Immediately after Rumble.**

**F18 Public-page experience unverified.** I did not render the homepage, event pages, fighters, bracket mobile layout. Questions 21–60 and 361–383 need a human walk-through on a phone. → Newcomers. → Run a 10-person "stranger test" on the real site once F1/F2 are done. Effort: Small. **Before Nov 1.**

**F19 No map exists** (no map library in `package.json`; `EventSummaryMap.ts` is a data helper). Questions 515–530 are about a feature not yet built. NOT NOW for Rumble.

**F20 Analytics/privacy loose ends (E11).** Transformation chain re-test and live ingestion not verified; privacy contact unset; PIPA-responsible person unnamed; `/privacy` not re-read against production behaviour. **Before Nov 1** (owner + a networked browser).

**F21 Claim of "no GPS ever" vs a future "near me".** Current promise holds (no geolocation API used `[D]`); any near-me feature must remain manual city/region entry. OWNER DECISION.

**F22 Rankings built on unverified data.** `RankingsPage` and `fighter_season_stats` exist and, on production, are fed by fictional results (E1). Rankings methodology/versioning/snapshot immutability not found `[U]`. Do not publish rankings as "official" until formula, snapshot rule and source labels exist. **Immediately after Rumble.** OWNER DECISION on formula.

**F23 Hosted/manual migration drift.** 30 migration files vs 22 history rows; 2400/3100 applied by hand. Fresh-project rebuild from migrations is verified locally (918 checks). → Maintainer. → Add a `supabase/DRIFT.md` listing which versions were applied manually and a schema-diff script in CI. Effort: Small. **Before Nov 14.**

**F24 Storage policy gap (earlier).** `team-emblems` and `avatars` buckets are public with no SELECT policy; cleanup of replaced files may leave orphans. Small. **Later.**

**F25 Scorekeeper identity on shared devices.** Outbox is keyed per device in `localStorage` with no user binding: a queue written by user A can be flushed under user B's session after sign-in switch (the sender uses whatever session exists). `[V]` from `realSender` (uses current session; entry has no user id). → Scorekeepers sharing a phone. → Store `userId` on entries; refuse to flush entries for a different user. Effort: Tiny. Risk: low. **Nov 1–14.**

**F26 Auth reliability at check-in.** Email codes go through the owner's Gmail SMTP `[D]`; Gmail rate limits/delays are a known single point of failure at check-in. → Fighters at registration/check-in. → Dedicated SMTP/transactional sender and domain before Nov 1; offer Google sign-in as the backup (needs production redirect allow-list verified). OWNER DECISION (domain purchase). **Before Nov 1.**

**F27 Idempotency is strong, but unique constraint races for capacity** (registration capacity, double bracket generation) — not verified `[U]`; add concurrency tests to the SQL gate (two sessions). Small–Medium. **Before Nov 14.**

**F28 Observability.** No error-monitoring service; PostHog covers usage only; failures in `finalize` surface to the user only. → Operator. → A tiny first-party `client_errors` RPC (route, build, error class, no content) or Sentry with scrubbing; start with first-party. Small. **Before Nov 14.**

**F29 Accessibility unverified `[U]`.** No axe or manual run in CI. Small via Playwright. **Before Nov 14** for the scoring and registration screens.

**F30 Notifications:** in-app bell exists (`notifications` table, 2 rows); no push; no preferences `[V partial]`. Keep in-app only for Rumble.

---

## 3. The 1,012 questions, classified

Key: `→F#` points to section 2. `E#` points to section 1. UNVERIFIED = not inspected.

### 1. North star and product identity (1–20)
1 PARTIAL?: shared identity tables (organizations, seasons, affiliations, sources) exist `[V]`, but UI cohesion is unverified. 2 PARTIAL: results/fighters/teams link by ids `[V]`; ranking flow unverified →F22. 3 PARTIAL: registration vs roster vs entries (`entry_fighters`, `set_entry_roster`) suggests fixes exist; duplicate team lists (`team_request_private`) `[V]`; detail UNVERIFIED. 4 PARTIAL: `profiles`, `fighters`, `fighter_accounts` = three records per person `[V]`, joined by `fighter_accounts`. 5 PARTIAL: `teams` + `team_affiliations` + `team_roles` + `team_memberships`; merge exists. 6 PARTIAL: events survive (published, permanent) but cascades threaten →F10. 7 PARTIAL: `results`, `fighter_season_stats` exist `[V]`; rankings formula unverified →F22. 8 STRONG: sporting identity (`fighters`) is separate from auth (`fighter_accounts`) `[V]`. 9 STRONG: fighters exist without accounts (121 fighters, 2 accounts) `[V]`. 10 MISSING →F8. 11 MISSING →F8. 12 STRONG: `merge_teams` + `teamMerge` tests `[V]`. 13 PARTIAL →F10. 14 PARTIAL: `ruleset_version_id` column exists `[V]`; freezing on start unverified. 15 STRONG: `sources`/`record_sources` (1,003 rows) `[V]`. 16 PARTIAL: provenance rows can coexist; UI display unverified. 17 OWNER DECISION. 18 UNVERIFIED (candidate: bug-report button, analytics are ops tools not sport features). 19 PARTIAL: Marathon/Triathlon specially handled (`marathon.ts`) `[V]`, group formats via `structure`. 20 UNVERIFIED (ask users).

### 2. First-time visitor and public experience (21–60)
21–47: UNVERIFIED (public pages not rendered; stranger test needed →F18). 31–35 PARTIAL?: rules page and formats page exist `[V route]`; plain-language quality unverified. 41–43 NOT NOW: highlights field exists on fighters (`highlights:ARRAY`) `[V]`; galleries not. 44 STRONG?: `sources` status; unverified in UI. 45 OWNER DECISION (Buhurt 101). 46–47 PARTIAL: `LiveNow` component exists `[V]`; behaviour unverified. 48–50 NOT NOW. 49 OWNER DECISION: city search over GPS (consistent with current privacy promise →F21). 50 NOT NOW →F19. 51 NOT NOW: no map exists. 52–53 NOT NOW/OWNER DECISION. 54–55 UNVERIFIED (filters as URL state). 56–58 MISSING?/NOT NOW (single global search not found in routes). 59–60 NOT NOW: structured data/prerender helpful for SEO but SPA on Pages is adequate for the Rumble; revisit after F18.

### 3. Navigation and information architecture (61–80)
61 PARTIAL?: routes show small set (Home, Events, Teams, Fighters, Rankings, Rules, Formats, Marshal…) `[V routes]`; `/marshal` plus `/events/:id/field/:field` both exist (preview vs real) — confusing. 62–72 UNVERIFIED. 63 PARTIAL: `EventRoute` + `ManagePage` tabs `[V]`. 64 PARTIAL: Team Manager exists. 65 NOT NOW. 66 STRONG?: `/platform` isolated route `[V]`. 73–80 UNVERIFIED. 75–76 PARTIAL: Pages uses 404.html copy so deep links load `[V]`. 78 STRONG: analytics strips query/fragment `[V earlier]`.

### 4. Accounts, authentication, onboarding (81–105)
81–82 UNVERIFIED →F26. 83 PARTIAL →F26. 84 UNVERIFIED (Google redirects allow-list) →F26. 85 PARTIAL?: session persistence implemented `[D]`. 86 MISSING →F25. 87 STRONG: `resetUser` clears analytics identity `[V earlier]`. 88 PARTIAL?: outbox and board persisted in localStorage are not cleared on sign-out (verified they are not user-scoped) →F25. 89 PARTIAL →F25. 90–91 NOT NOW. 92 STRONG: `grant_event_role_by_email`, `remove_event_role` `[V]`. 93 MISSING: no expiry found `[U]`. 94 STRONG?: `remove_event_role` exists; effect on open session: RPCs check `can_score` per call `[V record_score_event]`, so revocation applies on the next call. 95 STRONG (same reason). 96 STRONG?: roles in tables (`platform_roles`, `event_staff`, `team_roles`) `[V]`. 97 PARTIAL?: checks run in SQL not JWT claims `[V partial]` — good. 98 STRONG. 99 PARTIAL: `team_memberships` supports many rows; UI unverified. 100–101 UNVERIFIED. 102–103 UNVERIFIED. 104 STRONG: public viewing needs no account `[D]`. 105 STRONG: fighters seeded without accounts `[V]`.

### 5. Fighter identity and career (106–130)
106 PARTIAL: UUID `fighters.id` `[V]`; no external id. 107 MISSING (no alias table `[V schema]`). 108 PARTIAL: `display_name` only; legal name lives in private registration. 109 MISSING. 110 PARTIAL: city/region/country columns, no history. 111 PARTIAL: `team_memberships`. 112 PARTIAL?: mercenary in registration `[D]`; model unverified. 113 MISSING. 114 PARTIAL: entries per competition `[V]`. 115 MISSING/NOT NOW. 116 MISSING (no suspension table `[V]`) →OWNER DECISION. 117 NOT NOW. 118–124 PARTIAL?: `careers.ts`, `careerView.ts`, `fighter_season_stats` exist `[V]`; head-to-head unverified. 124 NOT NOW. 125–126 MISSING →F8. 127 PARTIAL?: `fighter_profile` RPC controls what is exposed. 128–129 OWNER DECISION (legal) + PARTIAL: `fighter_accounts` cascade on user delete, fighter record survives `[V]` since `fighters` is separate. 130 MISSING: no status enum in `fighters` columns `[V]`.

### 6. Teams (131–160)
131 PARTIAL: slug can change →F9. 132–133 PARTIAL: emblem via `set_team_emblem`; historical branding not versioned. 134–137 PARTIAL/MISSING: `organizations` vs `teams` exist; club/chapter distinction unclear `[V]`. 138 STRONG: `team_roles`, `assign_team_captain`, `remove_team_captain`. 139 STRONG?: separate roles. 140 STRONG: "historical captain" handled earlier in captain work `[V earlier]`. 141 PARTIAL: invites unverified; 142–143 STRONG: `request_team_join`, `decide_team_join`, `cancel_team_join`. 144 STRONG?: one pending request logic tested earlier. 145 MISSING. 146 PARTIAL?: guest/mercenary states unverified. 147–148 NOT NOW. 149–150 PARTIAL: `team_clearance` RPC shows registration status per team `[V]`. 151–152 NOT NOW. 153–154 PARTIAL?: contact privacy on teams unverified. 155 NOT NOW. 156 NOT NOW. 157–159 MISSING (merge exists, split/rename history does not). 160 UNVERIFIED (`Crest.tsx` exists).

### 7. Events and registration (161–209)
161–166 PARTIAL: `NewEventPage`, `create_event`, draft/published `[V]`; templates MISSING. 167–172 PARTIAL?: closing time exists `[D]`; per-category close/waitlist/capacity UNVERIFIED →F27. 173–175 STRONG?: `team_clearance`, `registration_checks` `[V]`. 176–178 UNVERIFIED. 179 STRONG: waiver_versions with version/timestamp `[D+V table]`. 180–181 UNVERIFIED →OWNER DECISION. 182–183 PARTIAL?: `set_registration_paid`. 184–187 NOT NOW: paid flag exists; refunds/comps not modeled. 188 STRONG: `set_registration_insurance` stores a state. 189 NOT NOW. 190–193 STRONG?: `registration_private` separate table, purge function (migration 1300) `[V]`; default-export exclusion `[D]`. 194–197 UNVERIFIED (check-in on phone `CheckinPanel` exists `[V]`); QR NOT NOW. 198–202 PARTIAL: days attending + equipment sharing captured in form `[D]`; conflicts via `fighter_schedule_conflicts` `[V]`. 203–206 PARTIAL?: volunteer roles `[D]`; shift model NOT NOW. 207–209 PARTIAL?: medic role is event staff; offline access to emergency data is a deliberate OWNER DECISION (privacy vs safety) and currently MISSING.

### 8. Competition model and bracket engine (210–264)
210–213 PARTIAL: `competitions` is first-class with `ruleset`, `tier`, `structure`, `ruleset_version_id` `[V]`; mixed rulesets per event are possible. 214–216 UNVERIFIED (freeze + override audit). 217–219 PARTIAL: pools, round robin, single elimination implemented (`LivePools`, `bracket.ts`) `[V files]`; double elimination NOT NOW (`structure` column is text → extensible). 220–221 PARTIAL. 222–224 PARTIAL?: modes in `scoring.ts` `[V file]`. 225–226 PARTIAL: `marathon.ts`; Triathlon unverified. 227 UNVERIFIED. 228–229 UNVERIFIED (generation guard; `Withdrawals.tsx`, `autoResolve.ts` exist). 230–231 PARTIAL?: `draw.ts` is seeded `[V file]`; whether the seed is stored UNVERIFIED. 232–234 PARTIAL: manual placement exists (`RunTab`); fratricide separation UNVERIFIED. 235–241 PARTIAL?: byes, withdrawals, walkovers handled (`autoResolve`, `Withdrawals`); disqualification/medical forfeit/double forfeit UNVERIFIED. 242–244 PARTIAL: `reopen_match` refuses if next match already final `[V finalize_match]` — safe but manual. 245–248 PARTIAL: `queue_state='final'` vs live; "provisional vs confirmed" not modeled; `reopen_match` takes a reason; audit_log records changes `[V]`. 249–252 UNVERIFIED. 253–254 MISSING: unit tests exist; property-based invariants not found. 255 PARTIAL: DB constraint `matches_next_link_has_slot` plus triggers `[V]`. 256–257 PARTIAL/BAD IDEA: `audit_log` + `score_events` give partial replay; full event sourcing is BAD IDEA now. 258–260 PARTIAL: rule maths in TS `tournament.ts`; advancement/finalization in SQL `finalize_match` `[V]`; the split is implicit and undocumented →F11. 261 NOT NOW. 262 BAD IDEA (WASM/Rust). 263–264 NOT NOW/BAD IDEA: Buhurt rules are specific; evaluate only for double-elimination later.

### 9. Field scoring and marshal UX (265–310)
265–272 UNVERIFIED (real-device UX); PARTIAL?: `fq-big` large controls, confirm step before save `[V FieldPage]`. 273 MISSING?: Screen Wake Lock not found (`grep` for wakeLock not run) UNVERIFIED. 274–276 PARTIAL: board persisted in localStorage so refresh/restart recovers `[V boardStore]`. 277–279 PARTIAL: **actions queue; finalize does not** →F3. 280 STRONG: ids generated at enqueue, persisted with entry `[V]`. 281 STRONG: `on conflict do nothing`. 282–283 PARTIAL: second finalizer gets "match changed… reload" via expected version `[V finalize_match]`; not a last-write-wins; but both scorekeepers' *events* are appended and unread. 284–285 PARTIAL: conflict is explicit to the second scorer; organizer sees nothing →F3. 286 STRONG (implemented). 287 PARTIAL: `matches.version` + audit_log; no per-revision table. 288–290 PARTIAL: waiting count shown `[V]`; "saved on device vs on server" distinction partial. 291 PARTIAL: flush every 8 s and on online event; manual retry via save. 292 PARTIAL: rejects shown in screen but lost on reload →F4. 293 BAD IDEA: Background Sync is **not supported in Safari/iOS** (MDN/caniuse), so it cannot be the strategy. 294 PARTIAL: localStorage sufficient for hundreds of events but fragile →F4. 295 BAD IDEA now. 296–298 NOT NOW: PowerSync would sync datasets locally; scoping to a field is possible but it adds a second sync authority next to RLS; revisit only if multi-hour offline editing becomes real. 299–303 PARTIAL/OWNER DECISION: sw caches public `events/competitions/matches` only `[V]`; rules content is in the JS bundle (offline once cached); rosters not cached; medical info must not be cached. 304–306 PARTIAL: `client_at` stored; server `received_at` exists `[V index]`; ordering authority is server. 307 PARTIAL →F3. 308–310 OWNER DECISION/BAD IDEA: a local event server adds operational risk; prefer paper fallback + organizer override.

### 10. Live event operations (311–340)
311–320 PARTIAL?: `RunConflicts`, `MatchSchedule`, `BulkSchedule`, `RunTab` exist `[V files]`; "needs attention" quality UNVERIFIED. 321–322 PARTIAL?: `duration_minutes` column exists. 323–325 PARTIAL: `MyNextFight` exists. 326 NOT NOW: targeted announcements. 327–328 MISSING: no incident log table `[V]`. 329–331 PARTIAL: `field` text on matches. 332–335 PARTIAL: `BulkSchedule`. 336 NOT NOW. 337–338 UNVERIFIED. 339–340 MISSING →F16.

### 11. Realtime architecture (341–360)
341–342 STRONG (known): Postgres Changes on `matches`, `entries`, published tables exactly those two `[V]`. 343–344 NOT NOW →F7. 345–348 PARTIAL: public data read via RLS; changes authorized per subscriber (cost) →F7. 349 PARTIAL: fine at hundreds, per Supabase guidance ~3,000 threshold. 350 BAD IDEA to rely on it →Broadcast later. 351–352 PARTIAL. 353 STRONG?: pages re-read state (poll fallback) UNVERIFIED. 354–355 PARTIAL?. 356–358 NOT NOW. 359–360 NOT NOW.

### 12. Spectator live experience (361–383)
361–375 UNVERIFIED (`LiveNow`, `LiveBracket`, `LivePools` exist `[V files]`). 374–375 PARTIAL?: bracket on 390px unverified. 376–377 NOT NOW/BAD IDEA (React Flow). 378 PARTIAL? 379 NOT NOW. 380–383 NOT NOW (overlay route cheap later: read-only `/overlay/:match`).

### 13. Rankings, statistics, sport history (384–422)
384–390 PARTIAL?: `RankingsPage`, `RankTable`, `fighter_season_stats`, `seasons` exist `[V]`; formula versioning/snapshots NOT found →F22. 391–394 OWNER DECISION. 395–397 NOT NOW (Elo/Glicko only after data quality). 398–402 UNVERIFIED/NOT NOW. 403–407 MISSING: snapshot immutability, uncertainty not found →F22. 408–414 PARTIAL?: `careers.ts` may supply; rest NOT NOW. 415–422 NOT NOW/OWNER DECISION (licensing, provenance: `sources` supports it `[V]`; review queue MISSING).

### 14. Organizations and governance (423–445)
423–426 PARTIAL/STRONG: `organizations`, `team_affiliations` (20 rows), `organization_staff` `[V]`; effective dates UNVERIFIED. 427–432 UNVERIFIED/PARTIAL: `set_event_organization` (event→org) exists; sanction vs host separation UNVERIFIED; ruleset ownership via `rulesets` table. 433–436 STRONG?: `set_organization_enabled`, `grant_organization_admin`, platform separation `[V fn names]`. 437–440 PARTIAL. 441–444 MISSING/NOT NOW. 445 PARTIAL: model is additive.

### 15. Rules and knowledge (446–464)
446–452 PARTIAL: `content/rules.ts` with document/version/section per item `[D README]`; two-doc conflicts shown `[D]`. 453 STRONG? `[D]` paraphrase labelling. 454–458 PARTIAL?: `RulesPage`; search quality UNVERIFIED. 459–462 NOT NOW (AI assistant needs citations; must never make rulings). 463–464 MISSING: no trace from executable scoring to rule text.

### 16. Mobile, PWA, native (465–488)
465–473 UNVERIFIED (earlier work covered 390px only for specific pages). 474–477 STRONG: manifest + icons + sw precache exist `[V]`. 478–479 PARTIAL. 480–481 PARTIAL→F14. 482–483 MISSING →F14. 484–488 BAD IDEA now for native (no need identified); Capacitor is the only reasonable path if push/camera becomes essential; Expo = AVOID.

### 17. Offline-first architecture (489–514)
489–500 see E2/E3/F3/F4: reads partial (public tables only, sw cache); writes partial; storage `localStorage`; unencrypted (OWNER DECISION: score payloads are not sensitive); quota errors swallowed; Safari eviction risk real. 501–506 custom outbox is right-sized today (KEEP+IMPROVE); PowerSync/Electric NOT NOW. 507–509 BAD IDEA (CRDT for authoritative results); possibly NOT NOW for collaborative scheduling. 510 STRONG (command-based + server version check is the right model). 511–512 STRONG/PARTIAL: ids idempotent; commands reference match id but not version (F3). 513 PARTIAL: conflicts visible to scorer only. 514 PARTIAL: outbox unit tests exist; no browser kill/restore test →F5.

### 18. Maps and location (515–530)
515–530 NOT NOW: no map exists `[V]` →F19. If built: MapLibre GL JS is open-source; do not use `tile.openstreetmap.org` for production traffic (OSM tile usage policy) — use a tile provider or PMTiles; store geocoded results; round coordinates by default; PostGIS NOT NOW at 20 teams. 529–530: manual city/region search keeps the no-GPS promise (OWNER DECISION).

### 19. Notifications (531–550)
531–539 OWNER DECISION on priority; in-app bell exists (`notifications` 2 rows, 2 RPCs) `[V]`. 540 STRONG: in-app first. 541–542: email for registration/schedule changes; Web Push only for installed PWAs on iOS (WebKit) `[V external]` → NOT NOW. 543–550 NOT NOW.

### 20. API and integration (551–575)
551–575 NOT NOW except: 567 CSV first (STRONG direction; `exportCsv.ts` exists). 562 idempotency is the pattern already used. 570 Zod only at import boundaries →F17. 571 PARTIAL →F17. 573–574 PARTIAL: portable event archive MISSING. 565 OWNER DECISION (partnership). 572 NOT NOW.

### 21. Edge functions and server-side logic (576–588)
576–579 STRONG: bracket advancement, finalize, permissions in SQL `[V]`. 580–583 NOT NOW (needed for webhooks/Stripe/email fan-out later). 584 STRONG: RPC for transactional tournament changes. 585 NOT NOW. 586–587 PARTIAL: rule of thumb exists implicitly; write it down →F11. 588 PARTIAL: TS `scoring.ts` and SQL `finalize_match` can drift; add shared test vectors (Small).

### 22. Database and data integrity (589–623)
589 STRONG: UUID PKs. 590–592 PARTIAL →F9. 593 STRONG?: FK-heavy schema `[V]`. 594–595 PARTIAL →F10. 596–597 PARTIAL: `audit_log`. 598–599 PARTIAL?. 600 STRONG?: `timestamptz`. 601 STRONG: unique constraints/ `on conflict`. 602–605 UNVERIFIED →F27. 606 STRONG: `version` on matches. 607–609 PARTIAL. 610–611 PARTIAL?: `ref_*` tables exist for tiers/categories `[V]`. 612–613 UNVERIFIED. 614–617 STRONG for scale at hundreds of thousands rows; partitioning NOT NOW. 618–619 UNVERIFIED →F16. 620 STRONG: rebuild from migrations verified `[V earlier]`. 621–623 PARTIAL →F23.

### 23. Security (624–658)
624 STRONG?: anon can only call 6 definer functions (all intentional); anon mutation = `report_bug`, `track_*` only `[V]`. 625–630 STRONG: 918 gate checks cover these `[V earlier]`. 631–634 STRONG?: all 64 definer functions listed; explicit grants and search_path verified for inspected ones; full audit UNVERIFIED. 635–637 PARTIAL?: buckets: two public (avatars, emblems), one private; policies not audited `[U]`; signed URLs UNVERIFIED. 638–639 STRONG: only the publishable key in the bundle `[D earlier]`. 640 UNVERIFIED (key model). 641 PARTIAL →F12. 642–643 PARTIAL →F12. 644–646 MISSING →F13 (OTP brute force is handled by Supabase Auth rate limits `[U]`). 647 STRONG?: React escapes text; any `dangerouslySetInnerHTML` not searched. 648–649 PARTIAL?: avatar upload validated in `image.ts` `[V file exists]`, SVG handling UNVERIFIED. 650–652 MISSING: no CSP; GitHub Pages cannot set headers (a `<meta>` CSP is possible but limited) → revisit hosting after Rumble. 653–656 MISSING →F5. 657–658 PARTIAL: `reopen_match` + audit log.

### 24. Privacy (659–682)
659–675 PARTIAL: verified in code/tests earlier; live ingestion/transform re-test unverified →F20. 665 STRONG (opt-out stops both sinks, 16 checks earlier). 669–670 PARTIAL: privacy regression checks live outside CI →F5. 671 STRONG: purge cron verified today. 672 PARTIAL?: PostHog retention depends on plan. 673–675 STRONG? 676–677 OWNER DECISION. 678–681 OWNER DECISION. 682 PARTIAL: medical note purged after 30 days `[D+V fn]`.

### 25. Accessibility (683–701)
683–698 UNVERIFIED. 699–701 NOT NOW for Storybook; axe via Playwright →F29.

### 26. Testing (702–740)
702 PARTIAL: 472 unit tests mostly pure logic `[V]`; 918 SQL checks (strong). 703–710 MISSING in CI (scripts/e2e probes are manual) →F5. 711–715 STRONG (SQL gates). 716–718 STRONG: seeded deterministic NACL league, fictional by `-test` naming `[V]`. 719–730 MISSING →F5 (Playwright is already installed in the environment; not in `package.json`). 731–734 NOT NOW. 735 MISSING (fast-check) Small. 736–739 MISSING. 740 PARTIAL: tests prove code; nothing proves the deployed product except my manual runs.

### 27. Performance (741–764)
741–744 PARTIAL →F6 (989 kB single chunk; admin code to all). 745–746 PARTIAL: PostHog lazy `[V]`; no maps/bracket libs to load. 747–749 UNVERIFIED (`image.ts` resizes avatars `[V file]`). 750–751 NOT NOW. 752–755 UNVERIFIED →F7. 756–758 NOT NOW. 759 PARTIAL →F6. 760 PARTIAL. 761–762 NOT NOW: no measured render problem; adopt only with a profile. 763 STRONG: Vite 8 builds in <1 s `[V]`. 764 UNVERIFIED.

### 28. Observability and operations (765–784)
765–770 MISSING →F28. 771 STRONG: bug report button exists (`BugReport.tsx`, `report_bug`); event/match context attached UNVERIFIED. 772–775 OWNER DECISION: first-party error log recommended before Sentry. 776 STRONG: build id/commit in footer `[D]`. 777–778 MISSING →F14. 779 NOT NOW. 780 MISSING. 781–783 MISSING →F15. 784 MISSING →F5.

### 29. Deployment and hosting (785–800)
785 STRONG for Rumble. 786 concrete limits: no response headers/CSP, no server redirects, 404.html trick, no edge caching control. 787–792 PARTIAL: PKCE works with base path; deep links work via 404.html (HTTP 404 status for deep links — fine for users, bad for crawlers). 793–795 NOT NOW; Vercel has no specific requirement here. 796–797 STRONG: URL and key are env-overridable; portable. 798 PARTIAL: README run steps stale →F11. 799–800 PARTIAL →F11.

### 30. Repository structure and DX (801–820)
801–803 PARTIAL: `lib` (pure), `data` (RPC wrappers), `pages`, `components` separation is real `[V]`. 804 PARTIAL: UI role checks exist but DB enforces. 805 MISSING →F17. 806 PARTIAL. 807–808 NOT NOW. 809–812 BAD IDEA (monorepo now). 813–815 MISSING →F11. 816 PARTIAL (comments in migrations). 817 PARTIAL. 818 MISSING: no tech-debt register. 819–820 MISSING →F11.

### 31. Extreme scale (821–840)
821–823 nothing breaks at 100–1,000 with the current design if F6/F7 are done; ≈3,000 concurrent realtime subscribers is the documented soft limit for Postgres Changes. 824 Needs a CDN snapshot + Broadcast design. 825–826 NOT NOW. 827–831 UNVERIFIED (plan limits). 832–836 PARTIAL: data is public by design; scraping acceptable; abuse limits →F13. 837–838 BAD IDEA: bracket maths trivial vs. network latency. 839–840 NOT NOW.

### 32. Extreme failure (841–864)
841 PARTIAL →F3. 842 PARTIAL: read cache + outbox; finalize blocked. 843 PARTIAL: Pages outage = app shell cached by sw `[V]`. 844 NOT NOW. 845–846 STRONG: PostHog is lazy and wrapped in `try`; failure cannot block core `[V earlier]`. 847–850 PARTIAL: board is on that phone only; another device can resume a field from server state, not from the dead phone's unsynced data →F3/F25. 851 PARTIAL →F14. 852–854 PARTIAL: migration compatibility not checked at runtime →F14. 855–858 PARTIAL: derived `results`/stats recomputable from matches; rebuild procedure undocumented. 859–864 PARTIAL →F10/F16.

### 33. Extreme human error (865–882)
865–869 PARTIAL: reopen_match with reason; downstream-played match blocks reopen `[V]`; "30-second change of mind" needs an undo window (Tiny). 870–874 PARTIAL: duplicates → F8. 875–880 PARTIAL?: withdrawals, bulk schedule shift exist; category cancel UNVERIFIED. 881–882 PARTIAL?: private fields live in separate tables (`registration_private`, `team_request_private`) — a structural control `[V]`.

### 34. Extreme sport-model (883–900)
883–888 PARTIAL: `structure`/`ruleset` text columns are extensible; format-specific code in `marathon.ts` etc. is not data-driven. 889–890 PARTIAL?: mercenary entries unverified. 891–895 PARTIAL: `gender`, `division` text columns on competitions `[V]`; age/weight modeled as division text. 896–899 OWNER DECISION: individual melee stats are operationally unrealistic without dedicated spotters. 900 OWNER DECISION.

### 35. Professional sports features (901–923)
901–923 NOT NOW as a group; individually: shareable result cards (905–906) and embeds (907–909) are good post-Rumble candidates; `ShareEventButton`/`share.ts` exist `[V]`. 919 NOT NOW (printable credentials possible via CSV). 920–923 BAD IDEA now.

### 36. Social and community (924–938)
924–926 NOT NOW (follow); 927–938: AVOID comments/messaging/likes (moderation burden outside the mission); link out to Discord/Facebook instead. OWNER DECISION.

### 37. Imports and global data (939–960)
939–960 OWNER DECISION + NOT NOW: provenance (`sources`, `record_sources`) is the right foundation `[V]`; a published open result format is a strong long-term idea (see section L).

### 38. AI features (961–976)
961–976: NOT NOW; plausible low-risk wins later: duplicate-fighter suggestions (963–964), spreadsheet column mapping (962), cited rules Q&A (969). 970–972 BAD IDEA (AI must never score/rule/alter results). 973 STRONG principle: label AI output. 974–975 BAD IDEA.

### 39. Business sustainability (977–992)
977–981 UNVERIFIED (plan costs). Likely first costs: database/egress at scale, Realtime messages, image bandwidth. 982–990 OWNER DECISION. 991 PARTIAL: lock-in moderate (SQL + RLS + RPC are Postgres; Realtime/Auth/Storage are Supabase-specific). 992 PARTIAL: CSV export for registrations exists; full-archive export MISSING →F16.

### 40. Red Deer Rumble reality check (993–1012)
993 required before Nov 1: F1, F2, F11, F12, F18, F20, F26. 994 before Nov 14: F4, F5, F6, F7, F14, F16, F25, F13, F15, F27, F28. 995 cut/defer: big screen, QR, push, rankings publicity, organization UI polish, analytics dashboards. 996 highest-risk dependency: venue connectivity + finalize path (F3). 997 weakest real-device test: field scoring on iPhone Safari and low-end Android. 998 weakest DB protection: capacity/double-generation concurrency (F27, UNVERIFIED). 999 weakest offline: finalize online-only (F3). 1000 weakest UX: unverified public pages (F18) and the `/marshal` vs `/field` duplication. 1001 most likely to fail under pressure: sign-in codes by Gmail SMTP at check-in (F26) and phones losing signal at finalize. 1002 simplify: remove `/test-login` from prod, hide unused routes. 1003 do not rewrite: bracket/finalize SQL, outbox contract, routing, auth. 1004 organizer workload: one-tap "registrations needing attention" + CSV roster (exists in part). 1005 fighter confusion: a clear "my next fight / my status" (exists: `MyNextFight`). 1006 spectators: one "happening now" page that works on cellular. 1007 integrity: finalize contract + CI gates (F3, F5). 1008–1011 real-device matrix: Android Chrome, iPhone Safari (installed PWA and browser), poor connectivity (airplane mode mid-fight), someone other than the developer scoring a full duel and melee. 1012 Garrett should personally: run a full dry-run event with 6 people on real phones including one forced offline finalize, one two-scorekeeper conflict, one revoked role, one phone restart mid-fight, and read `/privacy` on the live site.
