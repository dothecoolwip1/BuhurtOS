# Analytics and privacy: how it works and what has to be true

The public statement is `/privacy` (`src/pages/PrivacyPage.tsx`). This file is for whoever runs BuhurtOS. The page and the behaviour must agree:
change one, check the other. Not legal advice; see "Still needs a person" at the end.

## Deployment architecture (keep it this way)
* **Production frontend: GitHub Pages** (`.github/workflows/pages.yml`, base path `/BuhurtOS/`, `404.html` is the deep-link fallback). It deploys only from `main`.
* **Backend, auth, database: Supabase** (project `mvbxlebznlgroptwwdsm`) for every frontend: Pages, a QA deployment, or local development.
* **Analytics: PostHog project 643201.** Not tied to any host.
* **Vercel: temporary QA only.** It exists to give an external browser a deployment of a branch (authenticated tests, real analytics ingestion) without merging to
  `main`. It is never the canonical URL and nothing in the app depends on it. Its only footprint is `vercel.json` (sets `VITE_BASE=/` for that build and rewrites
  unknown paths to `index.html`). GitHub Pages ignores that file, and a Pages build without `VITE_BASE` still uses `/BuhurtOS/` (checked: built asset paths).
* Sign-in with Google redirects back to the page the person was on, so the Supabase Auth redirect allow-list must contain every origin that hosts the app
  (the Pages URL and, while testing, the QA URL). Password sign-in at `/test-login` and email-code sign-in need no redirect.

## Which PostHog project (read this before auditing or configuring anything)
BuhurtOS uses exactly one PostHog project: **project ID 643201**, organization **BuhurtOS**, **US cloud** (`https://us.posthog.com/project/643201`).
**Project 604020 is NOT BuhurtOS.** An independent PostHog connection was reading project 604020, which has default settings and no events; that is why it
once disagreed with this document. Do not audit, configure, or send BuhurtOS events to 604020, and do not modify it. Before changing any PostHog setting, read
the project back (`project-get`) and confirm `id: 643201`; the client key for the app (`POSTHOG_KEY`) must be this project's key.

## What is collected (all of it)
Two sinks, both fed only through `src/lib/analytics.ts`:
* **BuhurtOS database** (`activity_sessions`, `activity_views`, `activity_events`): page path, device class, browser and OS family, time zone, referring
  host, a random browser id (`bos-visitor`) and a random id per visit (`bos-visit`), the signed-in account id when there is one, and named actions
  with small plain properties. Read only by the platform owner (`admin_*` functions). Deleted after 90 days (see Retention).
* **PostHog** (US cloud, project 643201): the same facts as `$pageview` and action events, plus PostHog's own random id. No cookie (`persistence:
  'localStorage'`). Signed in: `identify(<account id>)`, no email or name. PostHog derives approximate country, region and city from the IP address.

Never sent: query strings or anchors, typed text (search words, forms), page titles, full user-agent, versions, screen sizes, language, campaign
parameters, clicks, recordings. `scrubCapture` (PostHog) and the database functions enforce this; `src/lib/analytics.test.ts` and
`supabase/tests/activity_gate.sql` test it.

## The choice
`src/lib/analyticsConsent.ts`. Default model is "notice": analytics run unless the person turns them off on `/privacy` (stored in `bos-analytics`).
A browser sending Global Privacy Control or Do Not Track starts with analytics off. Off means: PostHog is not even loaded on the next visit, no
first-party calls are made, the random ids are removed. Region switch: build variable `ANALYTICS_CONSENT=opt-in` (or `CONSENT_BY_REGION`) keeps
analytics off until the person turns them on.

## PostHog project settings (changed on 2026-10-03; re-check after any PostHog change)
* Discard client IP data: **on** (`anonymize_ips`). GeoIP still runs first, then the IP is dropped.
* Autocapture, exception capture, web vitals, dead clicks, heatmaps, surveys, console logs, performance capture, session recording: **off**.
* Transformations, in order: GeoIP, "Privacy: drop precise-looking GeoIP fields" (nulls latitude, longitude, postal code, accuracy radius),
  "Privacy: strip query strings and fragments from URLs" (defence in depth behind the app's own scrubbing).
* Event retention is set by the PostHog plan (free: 1 year, paid: 7 years) and **cannot be shortened**. The 90-day promise therefore applies to
  BuhurtOS's own records only, and `/privacy` says so. Deleting a person's PostHog events: persons API with `delete_events=true`.

## Retention of BuhurtOS's own records
`private.purge_activity()` (migration `20261001003100`) deletes visits and actions older than 90 days. It runs daily from pg_cron (`purge-activity`)
and also occasionally from `track_activity`. It only exists on a database that has applied migrations up to `20261001003100`.

## Reconciliation facts (checked 2026-10-03)
* PostHog: **project 643201** is BuhurtOS. Its privacy settings, Conversations (now **off**), and the three transformations were read back and match this document.
  The transformation "drop precise-looking GeoIP fields" was extended (version 2) after a chain test showed GeoIP also writes latitude, longitude, postal code
  and accuracy radius into `$set.$geoip_*` and `$set_once.$initial_geoip_*`; it now nulls all three places. Chain test (GeoIP, then filter, then URL stripper)
  passes: country, region, city and time zone remain; coordinates, postal code, radius, query strings and fragments are gone. Limits of that test: it runs on
  mock events, and the project's "discard client IP" setting is applied at ingestion, so it can only be proven with a real event.
* The last production build (GitHub Pages, run for `cff6dc5`) had **empty** `POSTHOG_KEY`, `POSTHOG_HOST` and `POSTHOG_REPLAY`: production sends nothing to
  PostHog today, and replay was never on.
* Hosted Supabase (`mvbxlebznlgroptwwdsm`): migrations 2400 and 3100 were applied by the owner via `supabase/manual/hosted_rollout_2400_3100.sql` and re-checked
  read-only on 2026-10-03: `matches_next_link_has_slot` and `matches_clear_orphan_slots` present, `matches_unlink_before_delete` gone, no orphan `next_match_id`,
  `private.purge_activity()` present and not executable by anon/authenticated, cron `purge-activity` (`41 9 * * *`) active, `track_event` drops `query`,
  `track_activity` stores no utm/language, RLS on all three activity tables, no stored utm/language/query values. A rolled-back purge proof with fictional rows passed.
  The migration history table is incomplete (22 entries); compare schema, not history. Do not run `supabase db push`.
* Production deploy: commit `a8d3650` on `main`, workflow run 37108406077, typecheck/test/build and Pages deploy succeeded (2026-10-03).
* PostHog 643201: `capture_console_log_opt_in` and `capture_performance_opt_in` were found ON and were switched off on 2026-10-03.

## Verification still to do from a networked browser
The coding environment's network policy blocks `dothecoolwip1.github.io` and the PostHog ingestion hosts, so these were **not** verified from it: real production page
loads at 390px and desktop, authentication, real PostHog events and stored properties, location privacy, opt-out and Super Admin on the live site, and a re-test
of the PostHog transformation chain (the tool call listing transformations was denied).

## Still needs a person
Name the individual responsible for privacy (Alberta PIPA expects one) and put their contact in `PRIVACY_EMAIL`; decide whether 1-year PostHog
retention is acceptable or whether to drop `identify` or PostHog altogether; Terms of Use do not exist yet; have a lawyer read `/privacy` before
BuhurtOS targets people outside Alberta/Canada (the US hosting at PostHog is disclosed but not assessed).
