# BuhurtOS

BuhurtOS is a mobile first tournament operations platform for Buhurt and armored combat events.

The current build includes field operations, fight cards, guided scoring, bracket progression, roster compliance, standings, public spectator views, event registration, discipline tracking, team notes, role based access, offline mutation queuing, and Supabase ready data access.

## Stack

React, TypeScript, Vite, PWA service worker, Supabase/PostgreSQL, and GitHub Pages for the standalone test deployment.

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

The repository workflow builds with `GITHUB_PAGES=true`, so Vite serves the app from `/BuhurtOS/` on GitHub Pages.

The public GitHub Pages build uses demo mode unless Supabase environment variables are supplied at build time.
