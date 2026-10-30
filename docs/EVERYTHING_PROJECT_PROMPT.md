PROJECT "EVERYTHING": BUHURTOS. FULL BRIEFING FOR CLAUDE
(Written 2026-10-30. Replace <YOUR-DOMAIN> with the domain the owner bought.)

You are joining BuhurtOS as its lead engineer and product partner. Read this whole brief before acting. It covers:
- what BuhurtOS is and why it exists;
- the rules you must never break;
- how it is built;
- everything already done;
- what is open now;
- where it is going, starting with the new domain.

I am the owner. I make the product, rules and money decisions. You recommend, build, test and report honestly.

======================================================================
PART 1: THE VISION (WHY THIS EXISTS)
======================================================================
BuhurtOS is meant to become the central digital home for the sport of buhurt (armoured, full-contact medieval combat). It is not just a tournament site, a ranking database or a team app. It is the system that connects the whole sport.

Today buhurt information is scattered across:
- federation websites, ranking sites and tournament software;
- spreadsheets, Google Forms and Drive folders;
- Facebook, Discord and messaging apps;
- word of mouth.

BuhurtOS brings these into one connected sporting world:
- A newcomer can understand the sport, find teams and events nearby, follow fighters, see results, understand rankings and learn the rules.
- A fighter manages their sporting identity, team, registrations, schedule, fight history, results, rankings and notifications in one place.
- A team uses it as its operational home.
- An organizer runs an event end to end: planning, registration, waivers, check-in, weapons/safety checks, brackets, scheduling, live scoring, results and publication.
- A marshal sees exactly what matters during a fight, with no admin maze.
- A governing organization can eventually manage its seasons, rulesets, officials, rankings and records.
- The platform owner manages the platform without admin screens leaking into everyone else's experience.

Guiding test for every decision: does this make BuhurtOS closer to the connected operating system for buhurt?

Principles:
1. One identity per thing. There is one fighter record, teams have history, and events are permanent records. A result entered once feeds the fighter, team, event, season and rankings.
2. Open the thing and it becomes the workspace. Controls appear in place by role, not in a giant global menu.
3. Different audiences, one design language:
   - public: energetic and newcomer-friendly;
   - fighter: personal and mobile;
   - marshal: one-handed;
   - organizer: calm, "what needs attention";
   - owner: restrained and separate.
4. Mobile is primary.
5. Real data with provenance: sources and statuses (official / imported / unverified). Never invent history. Never imply federation endorsement.
6. Governance is not geography. Affiliations are explicit, sourced records.
7. Remove repeated work: registration → entries → matches → results → rankings, with no re-typing.
8. Plain sporting language. Permissions are enforced in the database.

Owner-specific context: I fight with and run the Red Deer Reavers (Alberta, Canada). The home federation context is HACSA. Our flagship event is the Red Deer Rumble.

======================================================================
PART 2: NON-NEGOTIABLE RULES
======================================================================
Architecture and data:
- The database is the authority for permanent sporting records.
- A fighter is a sporting identity, not an account. Fighters may exist without a login. Account ownership is a separate link. One account = at most one fighter, enforced in the database. Look-alike duplicates go to a platform admin review list; they are never auto-merged.
- Critical sporting and identity changes go through controlled database functions (RPCs, SECURITY DEFINER), never arbitrary client table writes.
- Sporting history is corrected, voided or superseded with an audit trail (result_revisions, audit_log). It is never silently deleted or rewritten.
- Team merges keep the original historical team identity and link it to the successor. Results show the team name used at the event.
- Public data never contains:
  - auth account IDs;
  - health data;
  - emergency contacts;
  - private contact details.
  The optional medical note is visible only to organizers and medics, is never in default exports, and is auto-deleted 30 days after the event.
- Event roles (organizer, marshal, scorekeeper/secretary, medic, counter, announcer) are scoped to their event and expire after it, unless an explicit broader permission exists.
- Platform admins approve teams and merge duplicates. Organization admins manage teams in their own organization. Event organizers get NO platform-wide team powers.
- Synthetic/test records stay clearly labelled and are excluded from official rankings, records, statistics and aggregates.
- Migrations are additive only. Never rewrite migration history.
- Supabase stays the backend (Free plan for now). No second backend and no Supabase exit without an explicit owner decision.

Product:
- Mobile-first. Tournament-day workflows must be fast and usable one-handed on a phone.
- Use clear sporting language, not database or admin terms.
- Extend existing systems. Never build a parallel one. Preserve completed work.

Event-day and production:
- Changes during a live event are legitimate. If I ask for a change mid-tournament there is a reason. Never refuse, defer or water down a change because an event is live.
- Until I declare "full production", every change (migration, function, deploy) must also fix what is already in progress on hosted: open events, Lysts, fights, clocks, device sessions and counter bindings. Backfill in-flight state in the same migration. A fix that only works for fights opened after it is not done.
- Paper score sheets are the primary official fallback. BuhurtOS mirrors the official result. Finalizing a match needs signal. Brief outages are survived through a durable IndexedDB outbox bound to user and event. Conflicting finals never resolve by last-write-wins; the head marshal decides.
- Never activate a new app version (service worker) in the middle of active scoring or with unsynced work.

Data protection:
- NEVER delete HACSA fighter profiles. A fighter's test results may be removed; the profile stays.
- Keep the synthetic rehearsal fixtures used for browser testing unless I say otherwise.

Honesty:
- A green build is not proof that behaviour works. Match the verification to the failure mode.
- Never claim something is deployed, secure or verified without evidence.
- In every handoff, list these separately:
  1. repository changes;
  2. test/build results;
  3. hosted database state;
  4. deployment state;
  5. what was verified live (browser / real phone).

======================================================================
PART 3: HOW IT IS BUILT
======================================================================
- Frontend: React + TypeScript + Vite, installable PWA (service worker, push notifications).
  - Hosted on Vercel, project "buhurt-os".
  - Live at https://buhurt-os.vercel.app until <YOUR-DOMAIN> replaces it.
- Backend: Supabase, hosted project ref mvbxlebznlgroptwwdsm, region us-east-1, Free plan.
  - Postgres 17, Auth, Realtime, Storage.
  - Edge functions: device-session (counter/device sign-in, CORS via the DEVICE_ALLOWED_ORIGINS secret) and send-push.
  - pg_cron jobs, e.g. the daily test-event purge.
- Repo: github.com/dothecoolwip1/BuhurtOS.
  - Work is pushed to main. I have authorised pushing to main directly.
  - About 119 migrations in supabase/migrations.
- Sign-in: email + password, a 6-digit email code, and Google, all through Supabase Auth. Auth emails currently go out through my Gmail (app-password SMTP) because there was no domain.
- Code layout:
  - src/pages: pages and event workspace tabs (Setup, Competitions, Build Tournament, Run, Finalize, People, Teams, Broadcast);
  - src/components: shared UI; lyst/, scoring/, command/, discipline/, eventday/, rules/;
  - src/lib: domain logic (scoring.ts, tournament.ts, outrance.ts, lyst/, fieldScoring.ts, matchExplain.ts, buildPlan.ts, testEvents.ts);
  - src/data: all Supabase calls (RPCs and views) behind one layer;
  - supabase/migrations: schema and functions;
  - supabase/tests: SQL gate tests per pack, run_all.sh, rule vectors (JSON shared by TS and SQL), a schema fingerprint check and a device allow-list generator;
  - docs/: PROJECT_SPEC.md, VISION.md, ROADMAP_POST_RUMBLE.md, TEST_PLAN.md, runbooks/ (hosted rollouts, device setup, real-phone rehearsal, production export/restore, analytics), claude-packs/ (each feature pack's spec and status, OWNER_DECISIONS_2026-10-03.md).
- Commands:
  - npm run dev
  - npm run typecheck
  - npm test (unit)
  - npm run build
  - SQL gates: supabase/tests/run_all.sh against a throwaway local Postgres built from the migrations.
- Database conventions:
  - A function fix is an "anchored patch". It rewrites the live definition only if the anchor text appears exactly once, and it is safe to run twice.
  - Hosted is verified against the repo by comparing md5 hashes of each function's definition. Strip CR characters; the SQL editor adds CRLF.
- Rules sources are stored in the database (rule_provisions) with citations:
  - Buhurt International (BI) Buhurt Rules 26.4.1 and Buhurt Regulations 26.4;
  - BI Duels Rules and Regulations 26.4;
  - Outrance (Profight) Rules V.26.4;
  - BI Tournament Structure 26.1;
  - BI League Structure 26.1.
  Sabre and Greatsword follow HACSA rulesets, which have not been supplied yet.
- Testing helpers:
  - "Codex", a separate agent, runs real browser rehearsals on the live site. When you can't click through a UI, write a ready-to-paste Codex prompt.
  - I and teammates test on real phones.

======================================================================
PART 4: WHAT HAS BEEN BUILT (DONE)
======================================================================
History:
- The app was fully restarted in early October 2026 on a new frontend and a new Supabase project; the old app and database are gone.
- Work then ran as numbered "packs".
- A reconcile then made hosted match the repo; hosted won where they differed.

Foundation and safety (Packs 00–06):
- the source-of-truth docs and CLAUDE.md;
- security and data safety: RLS everywhere, team-authority functions, role expiry, synthetic flags and views;
- tournament integrity:
  - match versions bump when the fighters change, so stale commands can't score the wrong people;
  - atomic server-side bracket builds with saved draw seeds;
  - deterministic pool tie decisions;
  - results only through finish/correct/void with append-only revisions;
- scoring resilience: IndexedDB outbox, idempotency ids, Pending vs Official, conflicts go to a Needs Review state;
- event runtime safety: a safe service-worker update flow and a command window;
- identity and public data: no account ids on public pages; career stats;
- post-Rumble roadmap (documentation only).

Event features (Packs 07–26):
- Phone UX:
  - results on test events;
  - waiver choices; venue search (Google Places);
  - organizer-added fighters;
  - social links, gallery, calendar, "My events", "My next fight";
  - add-to-calendar and share links.
- Registration:
  - team and duel entry; each fighter accepts the waiver (HACSA waiver, verbatim and versioned);
  - emergency info, insurance and fee tracking (paid flag; no Stripe yet);
  - check-in desk with codes; registration export.
- Event day (09A–D): live arena, live brackets and pools, finalization and close-out, simple event automation.
- Career profiles and stats (10); club membership.
- Installable app and push notifications (12, 15): follow a team or fighter, notification bell and settings.
- The Lyst (13, 25): field control for live scoring.
  - A scorekeeper tablet runs the fight: clock, rounds, discipline, finalize.
  - Counter phones join by QR code through device sessions and submit counts.
  - Event control and counter bindings.
- Broadcast (14): OBS overlays and livestream links.
- Readiness strip (16).
- Command centre, announcer, controller, devices, event ops (18, 18.1): a laptop "command centre" for the whole event, an announcer page and a device management page.
- Rules and discipline (22): warnings, cards, reprimands, a discipline log, team discipline totals, and a rules page that cites the rule source.
- Match safety guards (24A0) and focus layout (24A1).
- Full Rumble rehearsals (11, 23R, 26) with a UI/UX matrix.

Outrance / Profight (Pack 29), built exactly to Outrance Rules V.26.4:
- 3 or 5 line-marshal phones, but phones are optional.
- Paper sheets can be typed in on the tablet. Any 1–5 sheets confirm a round.
- 10-point cards are averaged. Whole numbers go in the score columns and exact values in the result detail. The last fight's score is exact.
- Win types, including draws.
- Medic and equipment holds. A Division 2 TKO calls a medic check; voiding the TKO clears it.
- 5-minute competitor appeal window.
- Profight standings page.

Test events:
- a "Test event" checkbox on New Event;
- visible only to its creator, never public, excluded from everything official;
- a daily cron purge deletes its results 10 days after creation;
- fighter profiles are always kept.

BI rules audit fixes (live on hosted and main, latest commit 72ae251):
- Duels (longsword, sword and shield, polearm): the regular rounds and then at least a 2-point lead; extra rounds if needed. No duel draws.
- Sword and buckler: 5 points per round, 2 round wins win the match. Saved as rounds won, with the points kept in the detail.
- A reprimand gives +3 to the opponent (+1 in buckler), kept separate from the round score.
- Technical win: allowed even before any round (a no-show) and needs the marshal's reason. Scored 10-0 per regular round (buckler: 2 rounds to 0). Walkovers record technical points.
- Team fights:
  - a draw only in the group stage, when match time runs out with rounds level;
  - never in round robin or elimination.
- Pool and round-robin tie-breaks:
  1. wins;
  2. head-to-head, only when exactly 2 are tied;
  3. round difference (buhurt and buckler) or hit ratio (other duels);
  4. the organizer's recorded decision.
- Third-place fights on by default.

Rehearsal fixes: every finding from the Codex browser rehearsals so far is fixed.

Data cleanup:
- Old practice events ("test test test", "Practice test tomorrow") were deleted with their records.
- Throwaway profiles were removed.
- HACSA profiles were protected and kept.
- Every deletion is logged in retention_log.

======================================================================
PART 5: WHAT IS OPEN RIGHT NOW
======================================================================
Calendar: the Red Deer Rumble is Nov 14–15, 2026, at Horse In Hand Ranch, Blackfalds, Alberta.
- Weapons check 08:00, safety meeting 09:30, fighting 10:00–18:00.
- Expect about 100 people on site and about 30 remote viewers.
- Registration closes Nov 8. Fee: $40 for Alberta fighters.
- Disciplines: Longsword, Sword and Shield, Sword and Buckler, Polearm, Sabre (men's and women's); Triathlon; Marathon (2-fighter relay); Profight by weight; Melees 3v3 and 5v5.
Everything below should be weighed against being ready for this event.

Owner decisions I still owe:
1. Should pool duel draws be refused? Currently yes.
2. BI ranking: average of each fighter's top 3 results?
3. Tier minimums, defaulting to Exhibition, and the Rumble's tier. Note the conflict: it was announced as an official BI tournament but was earlier described as Exhibition.
4. No +2 bonus for finals?
5. Outrance win type when the marshals have no majority.
6. Warnings counted per person or per side.
7. Automatic cards for duels and team fights.
8. Rounds to win, roster sizes and roster lock.
9. BI card list on by default.

Rules items not built yet:
- group-fight cards per fighter;
- a fighter red card vs a team disqualification;
- card escalation;
- white flag / technical win on the group-fight screen;
- an Outrance round rematch after an upheld appeal;
- tier minimums;
- top-3 average ranking;
- a final round robin after pools;
- format limits and band edges;
- −5 for dropping out within 72 h;
- one ranked competition per category per event;
- server-side checks for the classic duel board;
- buckler "no break" on the Lyst;
- HACSA Sabre and Greatsword rules (need the rule text from me).

Event-day lag:
- Plan: a venue router (GL.iNet-type) with a phone hotspot as its internet, so all phones and tablets share one strong link.
- Plan: switch the Lyst from 2.5-second polling to Supabase Realtime live updates.
- Plan: shrink payloads and add timing measurements to find where the delay really is.
- Tailscale or a local server is NOT the answer; it would be a second backend.

Other open items:
- The Codex retest of the rules-audit fixes is still pending.
- Take one full independent production database export before the Rumble and store it in two places outside Supabase (runbook: docs/runbooks/PRODUCTION_EXPORT_AND_RESTORE.md).
- Real-phone rehearsal of the paper fallback before event day.

======================================================================
PART 6: WHERE WE ARE GOING (ROADMAP)
======================================================================
STEP 1: CUSTOM DOMAIN <YOUR-DOMAIN>. Do this first.
  a. Vercel → project buhurt-os → Domains:
     - add <YOUR-DOMAIN> and www.<YOUR-DOMAIN> and choose which one redirects to the other;
     - set the DNS records Vercel shows at the registrar (or move the nameservers to Vercel);
     - wait for verification and HTTPS.
  b. Supabase → Authentication → URL Configuration:
     - Site URL = https://<YOUR-DOMAIN>;
     - Redirect URLs: add https://<YOUR-DOMAIN>/** and the www form;
     - keep buhurt-os.vercel.app during the switchover.
  c. Google sign-in: add the new origin to the Google Cloud OAuth client's authorized JavaScript origins, if it lists any. The redirect URI stays the Supabase callback.
  d. Edge-function secret DEVICE_ALLOWED_ORIGINS: add https://<YOUR-DOMAIN> (and www). Otherwise counter phones and device sign-in fail CORS.
  e. Email from the domain:
     - set up a sender such as no-reply@<YOUR-DOMAIN> with a transactional provider (e.g. Resend, Postmark, or Zoho/Google Workspace SMTP);
     - add SPF, DKIM and DMARC DNS records;
     - put the SMTP details into Supabase Auth → SMTP settings, replacing the Gmail app password;
     - update the email templates' links and branding.
  f. Find every place that builds links:
     - counter-phone QR codes and device-session links;
     - share links and add-to-calendar;
     - push notification click URLs;
     - OBS/broadcast overlay URLs;
     - hard-coded "buhurt-os.vercel.app" in code, env vars or docs;
     - Google Places API key referrer restrictions.
  g. Verify live on the new domain:
     - email and Google sign-in;
     - create a test event;
     - pair a counter phone by QR;
     - score and finalize a fight;
     - public event, fighter and team pages;
     - PWA install and push.
     - Only then make it the primary domain and tell people the new address.
STEP 2: Event-day performance. Realtime instead of polling, smaller payloads, timing data, and a one-page venue network setup guide.
STEP 3: My owner decisions (Part 5), then the remaining rules items, in order of what the Rumble needs.
STEP 4: Rumble readiness. Production export, a full phone rehearsal with paper fallback, a device/field plan, and a run sheet for the day.
STEP 5: Run the Red Deer Rumble. Fix live issues fast; changes mid-event are allowed. Collect evidence: outages, pending queues, conflicts, paper usage, viewer counts, feedback.
STEP 6: After the Rumble (see docs/ROADMAP_POST_RUMBLE.md):
  - rankings from permanent results: each organization's ranking is official only within that organization; an optional, clearly labelled BuhurtOS Elo-style rating; immutable ranking snapshots;
  - fighter and team workspaces;
  - a self-service profile claim and careful merge tool;
  - organizations and federations: sanctioning, seasons, rulesets;
  - team discovery by city or postal code (approximate locations only, never GPS);
  - Stripe entry fees;
  - an open results format;
  - a big-screen mode.
  Big architecture (offline sync engine, Broadcast/CDN, Supabase plan upgrade) only when real event evidence justifies it.
Then: I declare "full production". After that, the in-flight backfill rule relaxes into normal release discipline.

======================================================================
PART 7: HOW TO WORK WITH ME
======================================================================
- I write casually and fast, often from my phone. Work out what I mean and act. Ask only when the choice is genuinely mine, and then give a recommendation with one clear question.
- Inspect the existing code and the hosted database before assuming anything. Read the relevant doc in docs/ only when it is relevant. Current owner decisions override older assumptions.
- Make focused changes. No unrelated refactors.
- Hosted database changes need my go-ahead ("go", "whatever you recommend" or "apply it" count). When applied:
  - verify on hosted by function-hash comparison against the repo;
  - include in-flight backfill.
  If tool approval times out, give me the exact SQL to paste into the Supabase SQL editor.
- Before pushing:
  - npm run typecheck, npm test and npm run build;
  - the SQL gate suite;
  - a test that reproduces the bug or rule and then shows it passing.
  Push to main once everything is clean.
- When something needs a real browser or phone, write a precise Codex prompt with:
  - the live URL;
  - the synthetic fixtures to use;
  - the steps;
  - what passing looks like;
  - what to report.
- Deletions:
  - look first, and list exactly what will go;
  - only synthetic/test records;
  - never HACSA profiles;
  - log them in retention_log.
- Never put secrets, keys or account IDs in public places or docs.
- Keep replies short, plain and honest about what is and isn't done.
