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
* Hosted Supabase (`mvbxlebznlgroptwwdsm`): the schema of migrations `...002500` to `...003000` is **already present** (functions identical to the repository's
  after ignoring whitespace and comments) but the migration history lists only 22 migrations, so compare the schema, not the history. Genuinely pending:
  `...002400_match_delete_unlink_fix` and `...003100_analytics_privacy`. Attempts to apply them through the Supabase tool were **cancelled** by the environment
  (three times); no Supabase CLI, access token or documented migration path exists in this repository. Until 3100 is applied the hosted database still stores
  `utm_source` and `language`, still keeps search words if an old browser sends them, and has no `purge-activity` cron job.

## Manual steps that remain (nothing here can be done from the coding environment)
1. **Hosted database.** Open `supabase/manual/hosted_rollout_2400_3100.sql`, paste it into the Supabase dashboard SQL editor for project `mvbxlebznlgroptwwdsm`
   and run it once. It applies migrations 2400 and 3100, runs 14 read-only checks (every row must say `ok = true`, including the `purge-activity` cron job), and
   proves the 90-day purge with fictional rows inside a transaction that is rolled back. It is safe to re-run. Do not use `supabase db push` (different history versions).
2. **GitHub Pages (production) variables.** `POSTHOG_KEY` (project 643201's client key), `POSTHOG_HOST` = `https://us.i.posthog.com`, `PRIVACY_EMAIL` when a mailbox
   exists. Delete `POSTHOG_REPLAY`. `ANALYTICS_CONSENT` is optional (the workflow defaults it to `notice`).
3. **Temporary Vercel QA.** Import the repository as a Vercel project and deploy branch `ccr-a435c5f7-pmrfxr` (do not merge to `main` for this). Add environment variables
   `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` (`https://us.i.posthog.com`). Turn off Vercel Deployment Protection so QA browsers need no Vercel account. QA events go to
   the same PostHog project as production unless a second key is used, so mark or filter them.
4. Run the real-ingestion checks (anonymous, query string and fragment, typed text, signed-in and sign-out, opt-out, Super Admin), then merge the same commit to `main`
   to deploy GitHub Pages and repeat the key checks on the real Pages URL.

## Still needs a person
Name the individual responsible for privacy (Alberta PIPA expects one) and put their contact in `PRIVACY_EMAIL`; decide whether 1-year PostHog
retention is acceptable or whether to drop `identify` or PostHog altogether; Terms of Use do not exist yet; have a lawyer read `/privacy` before
BuhurtOS targets people outside Alberta/Canada (the US hosting at PostHog is disclosed but not assessed).
