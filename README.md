# BuhurtOS

**BuhurtOS** is a mobile first tournament operations platform for Buhurt and armored combat events.

## Project status

The application combines showcase screens with operational workflows. Read [verified status](docs/BUHURTOS_STATUS.md), the [twelve-pack roadmap](docs/BUHURTOS_PLAN.md), and the [handoff](docs/BUHURTOS_HANDOFF.md) before continuing development. Source presence is not proof of a working production integration.

## What is included

The current project contains:

- Field marshal operations and fight card ordering
- Guided scoring and result validation
- Single elimination bracket generation and progression
- Anti fratricide seeding where possible
- Automatic bye handling
- Fighter and ghost fighter roster management
- Event safety and compliance gates
- Event and season standings support
- Discipline tracking
- Team and marshal fight notes
- Public spectator view and livestream links
- Public registration, waiver, and payment ready flows
- Role based permissions
- Offline mutation queue and conflict handling
- Supabase PostgreSQL schema, RLS, RPCs, storage, realtime, audit, and bootstrap migrations

## Project structure

`src/` contains the real React and TypeScript application source.

`supabase/migrations/` contains the backend schema, RLS policies, RPCs, audit rules, realtime configuration, registration storage, authentication bootstrap, and first run admin bootstrap.

`tests/` contains the core tournament rule regression checks.

`site/` is a legacy standalone demo. The current GitHub Pages workflow builds `src/` into `dist/`. Without Supabase environment values, operational screens use local demo data; showcase pages use fixtures independently.

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

## GitHub Pages

The repository builds the React application in GitHub Pages mode and deploys `dist/` to:

`https://dothecoolwip1.github.io/BuhurtOS/`

The GitHub Pages build uses the `/BuhurtOS/` base path and hash routing. CI runs clean installation, type checking, unit tests, desktop/mobile browser smoke checks, and a clean Supabase schema rebuild with pgTAP tests before deployment. Pull requests run checks without deploying.

To run browser smoke checks locally, install Chromium with `npx playwright install chromium`, then run `npm run test:browser`. Use Node 24 to match CI. For a live backend, copy `.env.example` to `.env` and configure the intended Supabase project; never put a secret/service-role key in a Vite environment variable. No live backend is configured by the current Pages workflow.
