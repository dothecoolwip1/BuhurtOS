# BuhurtOS

The new web app for armored combat (buhurt): events, brackets, results, teams, rules.

Status: **preview build on sample data.** Teams, people, events and scores are invented and the app says so. The rules
content is paraphrased from Buhurt International documents with the document, version and section on each item. This is not
official text and does not imply endorsement by Buhurt International.

## Stack
Vite, React 19, TypeScript (strict), React Router with real URLs, plain CSS built on design tokens (light and dark).
Static hosting on GitHub Pages. Backend (Supabase) is not connected yet; the UI reads from a typed fixture layer in `src/data`.

## Run it
```
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # rule maths: points, structure advice, 10-point must, duel scoring
npm run build      # outputs dist/ with base /BuhurtOS/
```
Set `VITE_BASE=/` for a custom domain.

## Layout
* `src/lib/tournament.ts` pure rule maths (tested). The UI renders what it returns and never decides rules itself.
* `src/content/` formats, tiers and rules text, each with its source.
* `src/data/` domain types and fixtures (the future database shape).
* `src/pages/`, `src/components/` UI. `src/styles/app.css` tokens and components.

## Deploy
`.github/workflows/pages.yml` typechecks, tests, builds and deploys `main` to GitHub Pages. In the repo settings set
**Pages > Source: GitHub Actions** once. `dist/404.html` is a copy of `index.html` so deep links work on Pages.

## Known gaps
* Two BI documents disagree on the Regional and Conference points multiplier. Both are shown; the owner decides.
* Group-fight round structure, weapon charts and armour requirements are not included (source files were images).
* Built but never run against the real Supabase project or on a real phone: draw and bracket builder (organizer Run tab), field scoring with the offline outbox (`/events/:slug/field/:field`), live public bracket and results, create-event and create-team forms. See `docs/TEST_PLAN.md`.
* Migration `20261001001100_competition_fixes.sql` (third-place routing, clear field, version check) is written and passes the local security gate but is **not applied** to Supabase yet.
* Third place needs tie rules beyond wins and score difference; head-to-head is not applied. Group-fight rounds-to-win is still a setting.
* Not built yet: fighter and team workspaces, rankings pages, volunteer safety form, big-screen mode, QR codes, follow and notifications, Stripe.
