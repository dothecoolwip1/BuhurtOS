# Analytics and privacy: how it works and what has to be true

The public statement is `/privacy` (`src/pages/PrivacyPage.tsx`). This file is for whoever runs BuhurtOS. The page and the behaviour must agree:
change one, check the other. Not legal advice; see "Still needs a person" at the end.

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
* PostHog: one organization, one project (643201, US cloud). Its privacy settings and the three transformations were read back and match this document.
  The Conversations (live chat) product was switched on for the project at 05:38 by someone other than the code in this repo; the SDK is told
  `disable_conversations: true` so the site cannot show a chat box. Decide whether the project setting should stay on.
* The last production build (GitHub Pages, run for `cff6dc5`) had **empty** `POSTHOG_KEY`, `POSTHOG_HOST` and `POSTHOG_REPLAY`: production sends nothing to
  PostHog today, and replay was never on. Set `POSTHOG_KEY` (this project's client-safe key) and `POSTHOG_HOST` (`https://us.i.posthog.com`) to turn it on.
* Hosted Supabase (`mvbxlebznlgroptwwdsm`, the project the app points at): the schema of migrations `...002500` to `...003000` is **already present**
  (functions are identical to the repository's after ignoring whitespace and comments), but the migration history lists only 22 migrations, so the history
  table cannot be trusted; compare the schema. Genuinely pending: `...002400_match_delete_unlink_fix` and `...003100_analytics_privacy`.
  Until 3100 is applied the hosted database still stores `utm_source` and `language` (12 existing visits carry them), still keeps search words if an old
  browser sends them, and has no `purge-activity` cron job (only the 1%-of-requests purge in `track_activity`).

## Before this goes live (checklist)
1. Apply `...002400` then `...003100` to the hosted project (additive; reviewed; 2400 swaps a check on `matches` for a weaker one, no row violates either).
2. Repository variables: `POSTHOG_KEY`, `POSTHOG_HOST`, `PRIVACY_EMAIL`; delete `POSTHOG_REPLAY` (no longer read). `ANALYTICS_CONSENT` defaults to `notice`.
3. QA and production would share project 643201 unless a second PostHog key is created: test events would mix with real ones.
4. Check: the footer says what `/privacy` says; `/privacy` loads at 390px and desktop; with a Global Privacy Control browser, nothing is sent.

## Still needs a person
Name the individual responsible for privacy (Alberta PIPA expects one) and put their contact in `PRIVACY_EMAIL`; decide whether 1-year PostHog
retention is acceptable or whether to drop `identify` or PostHog altogether; Terms of Use do not exist yet; have a lawyer read `/privacy` before
BuhurtOS targets people outside Alberta/Canada (the US hosting at PostHog is disclosed but not assessed).
