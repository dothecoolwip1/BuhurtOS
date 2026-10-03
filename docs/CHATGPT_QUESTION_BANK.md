# BuhurtOS question bank for ChatGPT

How to use: paste the **Preamble** first, then one section at a time. Ask ChatGPT to answer every question, to say "unknown" instead of guessing,
and to label each claim **fact / opinion / speculation**. Bring the answers back and they will be checked against the repository before anything is built.
Anything about a library, API, price or law should be verified against its current official documentation: models can be out of date.

## Preamble (paste first)
BuhurtOS is a web app for armored combat (buhurt): events, brackets, results, teams, fighters, rankings and rules, for organizers, team captains,
fighters, marshals, spectators and a platform owner. Stack: Vite 8, React 19, TypeScript strict, React Router, plain CSS tokens, Supabase (Postgres with
row-level security, auth with PKCE, pg_cron, storage), static hosting on GitHub Pages, optional PostHog analytics. Priorities, in order: safety and correctness of
competition results; trust and privacy (Alberta PIPA, minimal data); works on a phone at a muddy field with bad signal; simple for volunteers; fast.
Rules text is paraphrased from Buhurt International documents and must never be presented as official. Answer as a skeptical senior engineer and say what you would not build.

## 1. Basics (warm-up)
1. What are the 10 most important things any tournament-management product must get right before it adds a single extra feature?
2. Single elimination, double elimination, round robin, Swiss, pools-to-bracket: when does each fit a buhurt event with 8, 24 and 128 fighters?
3. What is the simplest correct way to seed fighters from rankings, and what are three common seeding mistakes?
4. How should byes, walkovers, withdrawals and no-shows be recorded so rankings stay honest?
5. What data does a spectator want in the first 5 seconds on a phone? What does a marshal want? An organizer? A captain?
6. What should a results page show when a score is disputed or corrected after publication?
7. What are the minimum fields for a fighter profile that avoid collecting anything risky?
8. How do ranking systems (Elo, Glicko-2, points tables, TrueSkill) differ, and which suits sparse, irregular, team-based combat data?
9. What should an event organizer be able to do in under one minute with one thumb?
10. List the roles and permissions a combat-sports platform needs and the typical privilege-escalation bugs for each.

## 2. Product and feature ideas (vision-first, then push)
11. Give 25 features ranked by value to buhurt communities, each with who benefits, effort (S/M/L) and the risk it adds.
12. Which 5 features would make organizers choose this over spreadsheets and Facebook posts? Why would they not switch?
13. How would you design a live "big screen" mode for a venue (fields, next fights, queue, results) that survives a flaky network?
14. How should a fight queue and call-to-the-field flow work (notify fighters, grace timers, forfeits, re-ordering)?
15. Design a safety and incident workflow (injury log, medical hold, concussion protocol hand-off, who sees what, retention).
16. Design a gear/armour inspection check-in that works offline and leaves an audit trail without storing photos of people's bodies.
17. How could QR codes be used safely (check-in, field scoring, spectator follow, team join) and how are they abused?
18. What would a fair, transparent ranking page look like, including how ties, inactive fighters and cross-region events are handled?
19. How would you model team history, transfers, guest fighters, merged or renamed teams and captains over time?
20. What would a "season" or "league" layer (such as a national league) need that single events do not?
21. How could video clips or replays be linked to bouts without hosting video (links, timestamps, consent, takedown)?
22. What accessibility needs (colour-blind, low vision, one-handed, glove-wearing, bright sun, screen readers) matter at a venue?
23. Multilingual: which languages first for the buhurt community, and how do you avoid mistranslating rules text?
24. What offline-first behaviours are essential (field scoring, check-in), and what conflicts can occur when two devices score the same bout?
25. What notification channels (push, email, SMS, none) fit, and what is the abuse and consent model for each?
26. How would you let organizers import from spreadsheets, existing registration tools or other bracket tools without data loss?
27. What public API or embeds (bracket widget, results JSON, calendar feed) would grow the ecosystem, and how would you rate-limit and version them?
28. What would a sponsor or media view need, and how do you add it without tracking spectators?
29. Extreme: how would you support three fighting formats at once (duels, group fights, relay or melee) in one data model without special cases everywhere?
30. Extreme: could results be cryptographically signed or hash-chained so disputes can be audited? Is that worth the complexity?

## 3. Extreme and adversarial
31. How would a malicious organizer, captain, fighter and spectator each try to cheat rankings, and what controls stop each?
32. Walk through a race condition where two marshals submit different scores for one bout. What should the database do?
33. What happens if an organizer deletes or edits an event after rankings were computed from it? Propose an immutable-history design.
34. How could row-level security policies be bypassed in Supabase (security-definer functions, views, storage policies, realtime), and how do you test for it?
35. What are the failure modes of a PKCE/OAuth login on static hosting with a base path, and how are open-redirect risks handled?
36. Threat-model the analytics pipeline: what could leak (URLs, IDs, IP, location), and how would you prove it does not?
37. How would you design the system to survive losing the primary developer tomorrow (docs, runbooks, bus factor, data export)?
38. What is the worst realistic day (event day, venue Wi-Fi down, database paused, quota hit)? Describe degraded modes.
39. What happens at 10x and 100x load during a live final (realtime connections, read amplification, cache)? Where does Supabase break first?
40. Extreme: what is the minimum viable architecture that still works if Supabase disappeared (portability, export, self-hosting)?
41. Extreme: how would you detect and respond to a data breach under Canadian and Alberta law, including notification duties?
42. Extreme: could minors compete, and what changes legally and in the data model if so?
43. Extreme: how would you fuzz the bracket generator and the scoring maths (property-based tests, invariants worth asserting)?
44. Extreme: propose five invariants that must hold forever (for example "a fighter is never in two active bouts") and how to enforce them in the database.

## 4. Technology research (ask for current, dated, linked answers)
45. For this app, compare staying on Supabase against Postgres plus a thin API, Convex, Firebase, PocketBase, Cloudflare D1/Workers and Neon. Give migration cost and lock-in.
46. Compare React Router, TanStack Router and Next/Remix style frameworks for a static-hosted, offline-capable app. When is a static SPA the wrong choice?
47. Compare service worker strategies (Workbox, custom, background sync, periodic sync) for an offline scoring outbox, including iOS Safari limits.
48. Which local-first and sync technologies (CRDTs, Automerge, Yjs, ElectricSQL, PowerSync, Replicache/Zero, RxDB) fit a bout-scoring outbox? Which are overkill?
49. Compare realtime options (Supabase Realtime, SSE, WebSockets, polling) for live brackets under spotty networks.
50. What are the current best practices for PWA install, push (Web Push, iOS limits), and badging for event apps?
51. Compare bracket and tournament libraries and open-source projects (names, licences, maintenance status) and what could be reused instead of rebuilt.
52. Which open-source projects in sports management, tournament software and HEMA or combat-sport tooling are worth studying? Link repositories and say what to learn from each.
53. Which public APIs would enrich the product (maps and geocoding, weather, calendar/ICS, payments, email, SMS, video embeds)? Compare privacy and cost for each.
54. Payments: compare Stripe, Square and PayPal for Canadian event registration, refunds, waivers and payouts to organizers (Stripe Connect).
55. Observability: compare PostHog, Plausible, Sentry, OpenTelemetry and Supabase logs for a privacy-first app. What is the smallest useful set?
56. Testing: what is the best stack for end-to-end tests of offline and realtime behaviour (Playwright, MSW, pgTAP, property-based tests)?
57. Type safety end to end: compare generated Supabase types, Zod, Valibot, tRPC and OpenAPI for this architecture.
58. Language and runtime: where, if anywhere, would Rust/WASM, Go or Deno edge functions beat TypeScript in this product (bracket solver, rankings batch, PDF export)?
59. AI: where would machine learning or LLMs help (rules Q&A with citations, schedule optimization, anomaly detection in scores, draft translations) and where would it be dangerous or untrustworthy?
60. Extreme: would a schedule optimizer (constraint solvers such as OR-Tools or SAT) be worth it for fields, rest time and armour-change time? Describe the model.
61. Extreme: what would a plugin or extension system for organizers look like, and what would sandboxing need?
62. Extreme: how would you do a zero-downtime migration of a live Postgres schema with RLS, and how do you roll back?

## 5. Product, community and business
63. Who are the real users and what are their jobs-to-be-done? Which of them would pay, and for what?
64. What pricing or funding models work for a community tool (free for fighters, paid events, sponsorship, donations, grants)?
65. How do you earn trust with leagues and federations without implying official endorsement?
66. What governance is needed for rules content (version pinning, source citation, change log, who may edit)?
67. What are the legal documents needed (privacy policy, terms, waiver handling, accessibility statement), and what a lawyer must review?
68. What metrics prove the product works (organizer time saved, scoring errors, results published within N minutes) without invasive tracking?
69. What are the top 10 reasons community software projects like this fail, and how does this plan avoid each?
70. Give a 90-day roadmap with the smallest slices that each deliver value on a real event day, and a kill-criterion for each.

## 6. Make it commit
71. Which three questions above did you find weakest or most speculative to answer, and why?
72. What did this brief assume that might be wrong? What would you ask the owner before building anything?
73. If only one thing could ship before the next event, what is it and what is the test that proves it works on a phone in a field?
74. Give your five strongest disagreements with the architecture described in the preamble.
75. What do you recommend we do not build?
