# Analytics and privacy: how it works and what has to be true

The public statement is `/privacy` (`src/pages/PrivacyPage.tsx`). This file is for whoever runs BuhurtOS. The page and the behaviour must agree:
change one, check the other. Not legal advice; see "Still needs a person" at the end.

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
  (twice); no Supabase CLI, access token or documented migration path exists in this repository. Until 3100 is applied the hosted database still stores
  `utm_source` and `language`, still keeps search words if an old browser sends them, and has no `purge-activity` cron job.

## Manual steps that remain (nothing here can be done from the coding environment)
1. **Hosted database.** In the Supabase dashboard SQL editor for project `mvbxlebznlgroptwwdsm`, run the contents of
   `supabase/migrations/20261001002400_match_delete_unlink_fix.sql`, then `supabase/migrations/20261001003100_analytics_privacy.sql` (in that order; each is one
   transaction and safe to re-run). Do not use `supabase db push`: the hosted history uses different version numbers, so it would try to re-run everything.
   Verify: `select conname from pg_constraint where conname = 'matches_next_link_has_slot'`; `select jobname, schedule, active from cron.job` shows
   `purge-activity` (`41 9 * * *`, calling `select private.purge_activity()`); then insert two fictional rows in `activity_sessions` (one `last_seen_at` 91 days ago,
   one 89 days ago), run `select private.purge_activity()`, confirm only the older one is gone, delete the other.
2. **GitHub Pages (production) variables.** Repository variables: `POSTHOG_KEY` (project 643201's client key), `POSTHOG_HOST` = `https://us.i.posthog.com`,
   `PRIVACY_EMAIL` when a mailbox exists. Delete `POSTHOG_REPLAY` (nothing reads it). `ANALYTICS_CONSENT` is optional (default `notice`).
3. **Vercel QA.** Create a Vercel project from this repository on branch `ccr-a435c5f7-pmrfxr` (do not merge to `main`). `vercel.json` already sets the base path
   and the single-page-app rewrite. Add environment variables `VITE_POSTHOG_KEY` (project 643201's client key) and `VITE_POSTHOG_HOST` = `https://us.i.posthog.com`.
   Turn off Vercel Deployment Protection for this project (or use a protection-bypass link) so QA browsers can open it without a Vercel account. Use a separate PostHog
   key or filter QA events afterwards, otherwise QA events mix with production events in project 643201.
4. Then run the real-ingestion checks listed in the task (anonymous, query string and fragment, typed text, signed-in and sign-out, opt-out, Super Admin).

## Still needs a person
Name the individual responsible for privacy (Alberta PIPA expects one) and put their contact in `PRIVACY_EMAIL`; decide whether 1-year PostHog
retention is acceptable or whether to drop `identify` or PostHog altogether; Terms of Use do not exist yet; have a lawyer read `/privacy` before
BuhurtOS targets people outside Alberta/Canada (the US hosting at PostHog is disclosed but not assessed).
