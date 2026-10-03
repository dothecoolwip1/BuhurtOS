# BuhurtOS interrogation — Part 2: synthesis (A–L)

Evidence tags and F-numbers refer to Part 1. Nothing in the repository was changed.

## A. What BuhurtOS actually is today
A React 19 / TypeScript / Vite single-page app on GitHub Pages (one deploy per push to `main`) talking directly to a Supabase project (Postgres, Auth with email code + Google, Realtime, Storage, pg_cron). Business rules live mostly in 64 SECURITY DEFINER SQL functions with RLS on all 38 tables; the browser holds pure rule maths (`tournament.ts`, `scoring.ts`, `bracket.ts`, `draw.ts`), thin RPC wrappers (`src/data`) and screens. Built and in the hosted DB: event creation and publishing, registration with versioned waivers and private emergency/medical data (30-day purge), organizer review/check-in/setup/people tabs, teams with captains/join requests/merge/affiliations, fighters with profiles and careers, organizations and seasons, draws/pools/brackets, a field scoring screen with an offline-first action outbox, live bracket/pools/"live now" views over Realtime, in-app notifications, a Super Admin area (organizations, analytics, bug reports), a privacy page and consent mechanism, and a service worker that precaches the shell and caches public reads.
**Not built or not proven:** result commit while offline; fighter claim/merge; slug history; rankings methodology and snapshots; maps; push; big screen; QR; Stripe; a CI gate for the database; any verified real-phone run; any verified live-site run from this environment. The hosted DB currently contains a large fictional league published next to the real (still draft) Red Deer Rumble.

## B. North-star gap analysis (biggest gaps to "connected operating system for buhurt")
1. **Identity is half-connected.** Teams can merge; fighters cannot claim or merge (F8), so history cannot be trusted to follow a person. 
2. **History is mutable by design accident.** Cascade deletes, no slug history, no ranking snapshots (F9, F10, F22): the product cannot yet promise a permanent record.
3. **The fictional data problem** (F1): you cannot be the sport's record while fiction shares the namespace.
4. **Live operations stop at the venue's signal** (F3): an operating system keeps running when the network does not.
5. **Newcomer path unverified** (F18): the first audience in the vision has not been tested with strangers.
6. **Interop is absent**: no export of a full event archive, no open result format, no feeds (long-term).
7. **Governance is modeled, not exercised**: organizations/rulesets exist, but no second organization has used them.

## C. Keep / Improve / Replace / Avoid
| Item | Verdict | Why (problem → exists today? → cost) |
|---|---|---|
| React 19, TypeScript, Vite 8 | **KEEP** | Builds in <1 s; no problem to solve. |
| React Router 7 | **KEEP / IMPROVE** | Used declaratively; `React.lazy` gives the code-splitting you need (F6) without adopting framework mode. Data APIs: revisit later only if loaders solve a real waterfall. |
| TanStack Router | **AVOID** | Migration cost across ~40 routes for no current problem. |
| TanStack Query | **REVISIT LATER** | Real problem is cache/dedupe/stale reads, not yet painful; adding it before the Rumble creates a second cache beside the outbox. |
| React Compiler | **AVOID for now** | No measured render problem; adopt only against a profile. |
| Zod/Valibot | **IMPROVE (narrow)** | At jsonb RPC inputs and imports only (F17). |
| Supabase | **KEEP** | RLS + RPC model is the project's strongest asset; portability is moderate. |
| PostgreSQL functions/triggers | **KEEP** | Right place for integrity; document the rule (F11). |
| pg_cron | **KEEP** | In use (purge jobs verified). |
| Realtime Postgres Changes | **KEEP + filter (F7)** | Fine at Rumble scale. |
| Realtime Broadcast | **REVISIT LATER** | Supabase recommends it above ~3,000 subscribers; not today. |
| Presence | **AVOID (public) / NOT NOW (staff)** | Privacy and cost, no need. |
| Edge Functions | **REVISIT LATER** | Needed for webhooks, Stripe, notification fan-out — none exist yet. |
| PostGIS | **REVISIT LATER** | 20 teams; client distance is enough. |
| Custom offline outbox | **KEEP + IMPROVE** | Right-sized; fix F3/F4/F25. |
| Workbox | **AVOID** | Custom sw works; Background Sync is unsupported in Safari/iOS (MDN/caniuse), so it cannot be the strategy. |
| IndexedDB | **IMPROVE** | Replace localStorage for the outbox (F4). |
| SQLite/WASM, PowerSync, ElectricSQL | **REVISIT LATER** | Adds a second sync authority beside RLS; only if multi-hour multi-device offline *editing* becomes real. |
| CRDTs/Yjs | **AVOID** | Authoritative results need explicit conflict decisions, not merge. |
| PWA | **KEEP + IMPROVE** | Already present; add update prompt + client version gate (F14). |
| Web Push | **REVISIT LATER** | iOS requires an installed Home Screen web app (WebKit). |
| Passkeys | **REVISIT LATER** | Email-code reliability (F26) matters more. |
| Capacitor | **REVISIT LATER** | Only if push/camera/background needs prove essential. |
| React Native/Expo | **AVOID** | Duplicates UI and rules. |
| MapLibre + OSM / PMTiles | **REVISIT LATER** | No map exists; use a proper tile source, not OSM's volunteer tile servers, in production. |
| Playwright | **IMPROVE (add to CI)** | Highest-leverage missing test tool (F5). |
| axe-core | **IMPROVE (via Playwright)** | F29. |
| Storybook, visual regression | **REVISIT LATER** | Only after screens stabilize. |
| Property-based tests | **IMPROVE** | Bracket/draw invariants; Small. |
| Generated Supabase types | **IMPROVE** | F17. |
| OpenAPI, webhooks | **REVISIT LATER** | No external consumer yet. |
| OBS overlays | **REVISIT LATER** | Cheap once a public per-match JSON route exists. |
| WebSockets/SSE custom | **AVOID** | Supabase Realtime covers it. |
| Stripe | **REVISIT LATER** | Paid flag exists; add after Rumble. |
| Monorepo/packages | **AVOID** | One app, one team. |
| WASM/Rust | **AVOID** | No computational problem. |
| PostHog | **KEEP (verify)** | After live verification (F20). |
| GitHub Pages | **KEEP through Rumble; REPLACE ONLY IF…** headers/CSP, server redirects or crawler-visible deep links become requirements. |
| Alternate hosting (Cloudflare Pages etc.) | **REPLACE ONLY IF** the above. Vercel has no requirement here. |

## D. Rumble roadmap
**Before Nov 1 (registration / public / check-in only):** F1 separate or unpublish the test league; F2 publish the real event after a dry-run registration; F12 remove or gate `/test-login`, delete test auth users; F26 reliable email sender (domain/SMTP) and verified Google redirect; F11 fix README/TEST_PLAN, add `CLAUDE.md`; F20 privacy contact + live verification of PostHog and `/privacy`; F18 stranger test of public pages on phones; confirm HACSA/BI tier and fighters' BI-profile messaging (owner).
**Nov 1–14 (scoring / live reliability only):** decide F3 (queue finalize vs paper fallback); F4 outbox hardening; F25 bind queue to user; F14 client version gate + update prompt; F7 realtime filters; F5 CI gates (SQL gates, Playwright smoke incl. offline→online, Dependabot) and a deploy freeze Nov 13–15; F15 rollback runbook; F16 backup/restore test and event-day CSV export; F27 concurrency tests; F28 first-party error log; F13 throttles; a full real-phone dry run.
**Immediately after Rumble:** F8 fighter claim/merge; F9 slug history; F10 archive-not-delete; F22 ranking methodology + immutable snapshots; F17 types/validation; share cards and read-only overlay JSON; Stripe; data from real usage (what actually broke).
**Long term:** open result/event archive format and feeds; second organization onboarding; Broadcast + CDN snapshots for large events; map; push; passkeys; Capacitor if justified; scouting/video links.

## E. 20 highest-value opportunities
| # | Opportunity | User | Problem | Change | Why | Effort | Risk | When |
|---|---|---|---|---|---|---|---|---|
| 1 | Separate fiction from reality (F1) | all | fake data in the record | visibility flag / separate project | trust is the product | S | M | pre-Nov 1 |
| 2 | Publish and dry-run the real Rumble (F2) | fighters, captains | event is draft | publish + rehearsal | no registration otherwise | T | L | pre-Nov 1 |
| 3 | Finalize contract for no signal (F3) | scorekeepers, spectators | results stuck offline | queue finalize or paper fallback | event integrity | M | H | Nov 1–14 |
| 4 | Outbox hardening (F4/F25) | scorekeepers | lost rejects, blocked queues | IndexedDB, per-subject flush, user-bound | no silent loss | S–M | M | Nov 1–14 |
| 5 | DB gates + smoke in CI (F5) | everyone | regressions ship | CI jobs | protects integrity | S–M | L | pre-Nov 14 |
| 6 | "Happening now" first screen | spectators | cellular + newcomers | route-split + live-first home | the 60% audience | S | L | pre-Nov 14 |
| 7 | Client version gate (F14) | scorekeepers | stale code | min build check | stops bad writes | S–M | M | Nov 1–14 |
| 8 | Reliable sign-in (F26) | fighters | codes delayed | transactional SMTP, domain | check-in speed | S | L | pre-Nov 1 |
| 9 | Event-day export/paper kit (F16) | organizers | outage = chaos | printable brackets + CSV | continuity | S | L | pre-Nov 14 |
| 10 | Fighter claim and merge (F8) | fighters, organizers | duplicates, orphaned history | claim + merge with audit | core of "one identity" | M | H | post |
| 11 | Slug history (F9) | everyone | broken shared links | redirect table | needed before QR | S | L | post |
| 12 | Archive instead of delete (F10) | historians | cascades | policy + migration | permanent record | S–M | M | post |
| 13 | Ranking method + snapshots (F22) | fighters, teams | unlabeled rankings | versioned formula, immutable snapshots | credibility | M | M | post |
| 14 | Organizer "needs attention" board | organizers | scattered checks | single list (registrations, inspections, conflicts, delays) | reduces workload | M | L | post |
| 15 | Result correction workflow | organizers, spectators | silent changes | visible "corrected" marker + reason | trust | S | L | post |
| 16 | Match share cards | spectators, teams | growth | static image per result | newcomers arrive via shares | S | L | post |
| 17 | Read-only public match JSON + overlay | broadcasters | manual graphics | versioned endpoint | streaming ecosystem | M | L | post |
| 18 | Newcomer "Buhurt 101" | strangers | jargon | plain explainer + path to teams/events | north-star audience | S | L | post (owner copy) |
| 19 | Team workspace (attendance, registration state) | captains | chasing fighters | workspace panel | daily utility | M | L | post |
| 20 | Error log first-party (F28) | operator | blind spots | privacy-safe client error RPC | faster fixes | S | L | pre-Nov 14 |

## F. 20 things not to build yet
1. Native apps (no capability gap shown). 2. PowerSync/ElectricSQL (second sync authority). 3. CRDTs for results. 4. TanStack Router migration. 5. Monorepo split. 6. WASM/Rust bracket engine. 7. Event sourcing. 8. Public API keys/OAuth/webhooks (no consumer). 9. Social feed, comments, messaging, likes. 10. AI scoring or rulings. 11. Ticketing. 12. Wallet passes. 13. Interactive world map with live tiles (no map exists; list + city filter first). 14. PostGIS. 15. Elo/Glicko ratings before data quality and methodology agreement. 16. Presence indicators for spectators. 17. Storybook/visual regression suite. 18. A local on-site event server. 19. Web Push (iOS needs installed PWA). 20. Sponsorship/ad system.

## G. Ten architectural decisions that will hurt if ignored for a year
1. Cascade deletes against permanent history. 2. No slug history. 3. Fighter identity without claim/merge. 4. Offline contract undefined (`score_events` unused). 5. Logic split between TS and SQL without a written rule or shared test vectors. 6. Hand-written types over `jsonb` RPC payloads. 7. Single JS bundle. 8. Whole-table Realtime subscriptions. 9. Hosted migration drift. 10. Test data sharing namespace with real data.

## H. Ten UX risks (people abandon the product)
1. Homepage jargon for strangers (unverified). 2. Sign-in code not arriving. 3. Registration that shows no clear "what's missing". 4. A scorekeeper unable to save at the field. 5. Spectator seeing stale or fictional events. 6. Bracket unreadable on a phone (unverified). 7. Role confusion for people who are captain + fighter + volunteer. 8. `/marshal` (preview) vs `/events/:id/field/:field` (real) confusion. 9. Silent rejection of a queued score. 10. Update prompts that swap code mid-fight.

## I. Ten event-day failure risks
1. No signal at finalize. 2. Phone dies with unsynced board. 3. Head-of-line blocking of the outbox. 4. Gmail SMTP throttling at check-in. 5. A deploy during the event. 6. Stale tab running old code. 7. Two scorekeepers on the same match (explicit conflict but organizer blind). 8. Supabase paused/quota (plan unknown). 9. Double bracket generation / capacity race (unverified). 10. Unexpected category change after draw (withdraw/forfeit paths unverified).

## J. Hidden assumptions
- "Scoring works offline" (only actions queue; finalize needs signal).
- That `score_events` is an audit log someone reads (0 rows, no reader).
- That the venue has intermittent but usable signal (unknown).
- That test data is harmless on production (it is public and dated the same day as the real event).
- That the README/TEST_PLAN describe the app (they do not).
- That passing local SQL gates protect production (CI never runs them).
- That one shared phone means one user (outbox is not user-bound).
- That Pages deploys are safe during the event (no freeze/rollback runbook).
- That GeoIP/PostHog are configured as intended (two capture flags were on until today; transformations unverified).
- That hosted migration history equals hosted schema (it does not).
- That "unofficial but BI-announced" tier is resolved (PROJECT_SPEC says unresolved).

## K. Questions only Garrett can answer
1. What connectivity will Horse in Hand Ranch really have (and can a hotspot/Starlink be arranged)? 2. Offline finalize or paper fallback for the Rumble? 3. Separate Supabase project for test data, or a visibility flag? 4. Tier/sanctioning of the Rumble (BI official vs exhibition) and its points treatment. 5. Do HACSA rulesets for Sabre/Greatsword exist in text you can supply? 6. Who is the privacy officer and what is the contact mailbox? 7. Domain purchase and sender for email now or after? 8. Who may approve fighter claims and merges? 9. Which organization's ranking (if any) is shown, and what formula? 10. Should emergency/medical info ever be available offline to medics? 11. Which social features, if any, are in scope? 12. Is Stripe wanted for the next event? 13. May BuhurtOS publish historical results from other sources, and with whose permission? 14. Minors: allowed or not? 15. Terms of Use and legal review timing. 16. Backup plan/tier and who holds the credentials. 17. Is a deploy freeze acceptable Nov 13–15?

## L. 25 new ideas (each tested against "closer to the connected operating system for buhurt?")
1. **Event archive package**: one-click export of an event (entrants, brackets, matches, scores, corrections, sources) as JSON + CSV + printable PDF — permanent record and portability.
2. **Open buhurt result format** (versioned JSON schema) published for other platforms and ranking sites — makes BuhurtOS infrastructure rather than a silo.
3. **Corrections ledger**: every post-publication change is a visible, reasoned entry on the match page; downstream consumers can subscribe.
4. **"Why did they win?" explainer** generated deterministically from the rule engine (not an LLM) for each result — makes the sport legible to newcomers.
5. **Fight-card pages with plain-language stakes** ("winner meets X in the semifinal").
6. **Venue field kit**: printable QR-coded field sheets and paper score sheets that map 1:1 to the outbox commands, plus a "type in paper results" screen.
7. **Per-match public JSON + OBS browser-source overlay** with automatic names, crests, scores.
8. **Spectator "follow a fighter/team" by link** (no account) using local storage, with in-app "now fighting" banner.
9. **Team recruiting card**: structured "come try it" info (practice nights, loaner gear yes/no, beginner-friendly) with approximate location.
10. **Try-it flow**: from any event or team page, a three-step "how to attend your first practice" path.
11. **Media links on matches**: timestamped video URLs attached to a match (no video hosting), with takedown and credit fields.
12. **Source-linked historical backfill queue**: submit a missing result with evidence URL; reviewer approves; source badge shown.
13. **Fighter identity claim by evidence** (BI profile id, event, team captain attestation).
14. **Season pages that tell the story**: auto-generated from results (champions, upsets, streaks) with labeled formulas.
15. **Marshal rule lookup offline**: searchable cited rules bundle with version badges (plus "cannot find → call head marshal").
16. **Conflict-aware field handoff**: a QR "take over this field" that transfers scorekeeper control and shows unsynced counts from the previous phone if reachable.
17. **Event health strip for organizers**: late fields, empty fields, unresolved inspections, unpaid, conflicts — one line each with a fix button.
18. **Equipment-sharing aware scheduler hints** using the existing "shares equipment" registration field.
19. **Federation read-only dashboard**: an organization sees its teams, events, officials' accreditations, and published rankings without admin leakage.
20. **Official accreditation records** (marshals, inspectors) with expiry, private evidence, and public "accredited" badge.
21. **Reproducible draws**: store seed and draw log on the event page so anyone can verify the draw was fair.
22. **Results-integrity audit page**: per event, a public log of finalizations, reopenings and reasons.
23. **Calendar feeds (ICS) per team/region/organization** — the cheapest way into people's lives and other sites.
24. **Embeddable live bracket widget** for team and organizer sites (iframe or web component) reading the public JSON.
25. **Weather and venue practicalities** panel on event pages (camping, parking, accessibility notes) written by organizers — turns an event page into a trip-planning page for newcomers.

Rejected by me as flashy: AR/VR views, blockchain-signed results (hash-chaining the audit log is enough and optional), AI commentary, 3D bracket visualisation, gamified fan points, NFT-style fighter cards.
