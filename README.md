# BuhurtOS

**BuhurtOS** is a mobile first tournament operations platform for Buhurt and armored combat events.

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

`site/` contains the standalone GitHub Pages demo build. It intentionally runs in demo mode and contains no production Supabase credentials.

## Local development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## GitHub Pages

The repository deploys the safe demo build in `site/` to:

`https://dothecoolwip1.github.io/BuhurtOS/`

The Vite source configuration also supports deployment under the `/BuhurtOS/` base path when a production source build is used later.
