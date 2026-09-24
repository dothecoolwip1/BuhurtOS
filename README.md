# BuhurtOS

**BuhurtOS** is a mobile first tournament operations platform for Buhurt and armored combat events.

## What is included

The current project contains:

* Field marshal operations and fight card ordering
* Guided scoring and result validation
* Single and double elimination, round robin, and pools competition structures
* Anti fratricide seeding where possible
* Automatic bye handling
* Fighter and ghost fighter roster management
* Event safety and compliance gates
* Event and season standings support
* Discipline tracking
* Team and marshal fight notes
* Public spectator view and supported livestream embeds
* Public registration and private waiver upload
* Role based permissions enforced in PostgreSQL and Supabase RLS
* Offline mutation queue with explicit conflict handling
* Supabase PostgreSQL schema, RLS, RPCs, storage, realtime, audit, and bootstrap migrations

Paid registration is intentionally fail closed until a real payment provider and webhook are configured. A registration can be saved without attempting a charge, but BuhurtOS does not pretend a checkout succeeded when no provider exists.

## Project structure

`src/` contains the React and TypeScript application source.

`supabase/migrations/` contains the backend schema, RLS policies, RPCs, audit rules, realtime configuration, registration storage, authentication bootstrap, and first run admin bootstrap.

`supabase/functions/` contains server-side Edge Functions for privileged or capability-token workflows.

`tests/` contains frontend and tournament rule regression checks.

`supabase/tests/database/` contains pgTAP authorization, workflow, concurrency, and abuse tests.

`site/` contains a legacy standalone demo snapshot. GitHub Pages deployment is built from the Vite application and does not use production Supabase credentials.

## Local development

```bash
npm ci
npm run dev
```

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Database verification also requires the Supabase CLI and Docker:

```bash
supabase start
supabase db reset
supabase test db
```

## GitHub Pages

The repository deploys the safe frontend build to:

`https://dothecoolwip1.github.io/BuhurtOS/`

The Vite configuration uses the `/BuhurtOS/` base path for GitHub Pages builds.
