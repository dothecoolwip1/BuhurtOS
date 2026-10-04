# BuhurtOS full-site QA, UX, UI and responsive audit

Date: 2026-10-03 / 04. Commit audited: `433085f` (branch `ccr-3b8f5e2b-gglnaw`, identical to `main`).
Audit only: no application code, schema, migration, hosted configuration or production data was changed.
Screenshots referenced below live in `docs/reviews/assets/2026-10-03-audit/` (downscaled JPEGs; names carry route, role and viewport).

## 0. How this was tested, and what could not be

**What ran.** The running application was driven with Playwright (real Chromium 1194, Android Chrome and iPhone user agents, touch
enabled) at 360x800, 390x844, 430x932, 768x1024, 1024x768, 1440x900 and 1920x1080, plus 844x390 landscape for the scoring screens:
35 public routes at all seven widths, every test role at phone and desktop widths, and complete clicked-through journeys
(organizer creates and publishes an event, fighter registers, organizer reviews and checks in, captain edits a team, new user
onboards and joins a team, scorekeeper scores offline and online, organizer builds draws and schedules). axe-core 4 ran on 25
pages. Loading was measured on the production bundle under a 1.2 Mbps / 300 ms link. Dark mode, keyboard focus, long names,
duplicate submits and error paths were exercised.

**What could not run, and why it matters.** This container's network policy denied `mvbxlebznlgroptwwdsm.supabase.co`,
`dothecoolwip1.github.io` and `buhurtos.ca`. So the product was run as a **local build of this branch against a local Postgres 16
built from every repository migration (Packs 01 to 05 included), PostgREST 13.0.4, and a small auth shim** for the six
`@buhurtos.ca` accounts plus a local-only `superadmin@buhurtos.ca` owner (the repo deliberately ships no owner test account).
The data is the same seed the hosted project holds (fictional NACL-test league, HACSA teams, the Red Deer Rumble 2026 draft);
hosted additionally has one empty draft `test-stuff-test`. Consequences:

* Hosted behaviour was **not** observed. Where a finding depends on database shape I checked the hosted project read-only through
  the Supabase MCP and say so. Hosted still carries only part of the Pack 01/02 migrations (see `docs/claude-packs/STATUS.md`), so
  hosted can differ from what is reported here in both directions.
* No Realtime: every published event page showed the "Reconnecting: showing the last information we have" banner. Live updates,
  the LIVE labels and realtime reconnect behaviour are **untested**.
* No Storage: avatar, emblem and bug-screenshot uploads are **untested**. No email codes, no Google sign-in.
* The hosted deployment itself (service worker, caching, GitHub Pages headers, PostHog) is **untested**. Offline reload of the
  installed app was not tested; offline scoring without reload was.
* Features the brief lists that **do not exist in this codebase** and therefore could not be audited: a calendar (month or
  agenda), a "My Calendar", a dedicated My Events page (only a section on Account), fighter photo galleries, organizer-added
  fighters, waiver PDF upload or starter template, competition creation (see finding B3), fighter withdrawal by the fighter,
  event status "cancelled" UI, maps.

Severity, effort and confidence are given per finding. "Proven" means I reproduced it in the browser against the local stack;
"Strong evidence" means code plus a hosted read-only check; "Needs confirmation" means it should be re-checked on hosted.

---

## 1. Executive summary

**What feels strong.** The visual identity is real and consistent: the condensed display face, the brass/steel chips, the shield
crests and the warm hero gradient read as one product in light and dark mode. The copy is unusually honest ("Written by the
fighter, not checked by BuhurtOS", "The paper sheet is the official record"). The scoring screen's core loop works under a
dropped signal: six actions queued offline, a clear "Pending: NOT official yet" state with the paper instruction, exactly-once
delivery after reconnect, then "Official: saved on the server". The new-user path (set up profile, find a team, request to
join, captain gets a notification, accepts, fighter page appears) worked end to end without a dead end. Validation messages
are plain-language everywhere. Keyboard focus is visible, the drawer is a real dialog, and no developer error text reached a
normal screen during the journeys.

**What feels weak.** BuhurtOS is still several good screens stapled together rather than an operating system. The public
event page is one 8,000-pixel scroll with every bracket inline and no way to jump to a competition. The organizer Run tab is a
32,000-pixel wall with 584 buttons. A fighter who has registered cannot find that registration from their account. The
scorekeeper has no link anywhere to the screen they score on. The one thing an organizer must do before publishing, adding a
competition, has no user interface at all. Two regressions from the October packs break "upcoming" lists on every team and
fighter page and hide the results of every fictional event from its own page. Everything public is labelled "-test", so the
first impression of the live site is a demo. Test data badges fail WCAG contrast, as does the bottom navigation.

**Ready for real users?** Not yet for self-service. Spectators can browse; fighters can register; organizers cannot create a
competition, and nobody but the owner can create an event. With the owner doing setup by SQL and present on the day, it is a
closed beta.

**Ready for the Red Deer Rumble (Nov 14)?** The scoring and check-in cores are credible, but four things stand between here and
the day: the entries-to-competitions query bug (B1), a navigable path for scorekeepers to their ring (B5), a Run tab that can be
operated from a phone under pressure (W1), and competition setup that does not depend on SQL (B3). The hosted migration state
must also be reconciled before any of this is judged live.

---

## 2. Top 20 problems, ranked by value of fixing

| # | Problem | Type | Sev | Effort | Conf |
|---|---|---|---|---|---|
| 1 | `entries → competitions` embed is ambiguous since `pool_tie_decisions` (Pack 02): team page "Upcoming events: Could not load events", fighter page "Upcoming: Could not load upcoming", console error on Rankings | Bug | P1 | Small | Proven locally; hosted has the same two foreign keys |
| 2 | No way to add a competition in the product; publish checklist and Run tab both dead-end on it | Missing feature / UX | P1 | Medium | Proven |
| 3 | Scorekeepers have no link to `/events/<slug>/field/<ring>`; the queue is empty until an organizer sets queue state in a 32k-px page | UX | P1 | Small | Proven |
| 4 | Organizer Run tab renders every competition, match card and roster editor expanded on one page (32,148 px at 390 wide; 21,472 px at 1440) | UX / structure | P1 | Large | Proven |
| 5 | Public event page is a single scroll with all pools and brackets inline, no competition navigation; brackets clip on desktop | UX / structure | P1 | Medium | Proven |
| 6 | Fighter's own registration is invisible from Account ("My events" is staff-only; owner gets every event) | UX | P1 | Small | Proven |
| 7 | Completed fictional event page shows "No final placings are recorded" although four competitions are finished (reads `result_rows`, which excludes synthetic) | Bug | P1 | Small | Proven |
| 8 | Registration form carries hard-coded Rumble copy (Nov 14/15 days, "before November 13", "before November 11, 2026") for every event | Bug / copy | P2 | Small | Proven |
| 9 | Test data chips, date-box year and the bottom nav labels fail contrast (2.6 to 3.8:1 at 11 px) on every page | Accessibility | P2 | Tiny | Proven (axe) |
| 10 | Scoring board header pushes the actual board below the fold on phones; global bottom nav stays during scoring; landscape unusable without scrolling | UX mobile | P2 | Small | Proven |
| 11 | After reconnect the sync bar says "all confirmed" while the result card still says six actions are waiting; no automatic finalize retry | UX / state | P2 | Small | Proven |
| 12 | Blank page until the 1 MB bundle arrives; no shell, no skeleton; content height jumps 844 → 2353 → 8927 px | Performance | P2 | Medium | Proven |
| 13 | "-test" naming and TEST DATA badges dominate every public list and the home hero ("See Red Deer Rumble-test") | Product / copy | P2 | Small | Proven |
| 14 | Fighter and team pages contradict themselves ("No competitions are recorded" above a tournament history and medal counts) | Copy / UX | P2 | Tiny | Proven |
| 15 | After Accept in Review the list shows "NOTHING HERE" with no confirmation; registration page reopens as a blank form after submitting | UX | P2 | Small | Proven |
| 16 | Rankings lands on an empty state behind five controls ("Choose a season. This organization has no seasons yet.") | UX | P2 | Small | Proven |
| 17 | `organizer@buhurtos.ca` cannot create events; the refusal page has no action; "Create an event" is shown to every role | UX / permissions | P2 | Small | Proven |
| 18 | `/marshal` demo scoring page with fixture teams and "Pretend there is no signal (preview only)" is publicly reachable | Product hygiene | P2 | Tiny | Proven |
| 19 | Teams directory repeats the provenance sentence on all 20 cards; HACSA crests are identical placeholders | UI | P3 | Small | Proven |
| 20 | Check-in footer tells organizers "The signed waiver is not recorded in registration data yet" | Copy / dev leak | P3 | Tiny | Proven |

---

## 3. P0 and P1 issues

No P0 was found in the browser. Two items are P0-adjacent and belong to the owner, not this audit: the hosted database still
lacks most of the Pack 01 to 05 migrations (`docs/claude-packs/HOSTED_RECONCILIATION_2026-10-03.md`), and the hosted results
table is still organizer-writable until that script runs.

**B1. Ambiguous embed breaks "upcoming" everywhere.** P1 · Bug · Small · Proven locally, strong evidence hosted.
PostgREST answers `PGRST201 Could not embed because more than one relationship was found for 'entries' and 'competitions'`
because `pool_tie_decisions` (Pack 02) references both tables and so creates a second, many-to-many path. The hosted project
has `pool_tie_decisions_competition_id_fkey` and `pool_tie_decisions_entry_id_fkey` (checked read-only), so hosted PostgREST
will answer the same. Affected calls: `src/data/teamDirectory.ts:81` (team page "Upcoming events"), `src/data/careers.ts:173`
(`APP_SELECT`, fighter page "Upcoming" and participation; also used behind the Rankings page). Visible result: every team page
says "Could not load events.", every fighter page says "Could not load upcoming.". Fix: disambiguate with
`competitions!entries_competition_id_fkey(...)` at the three call sites. Screenshot: `anon-team-mountain-bears-desktop-1440.jpg`.

**B2. Fictional event pages show no results.** P1 · Bug · Small · Proven. `central-alberta-steel-open-test` has four finished
competitions and 21 result rows, yet its "Event record › Results" tab says "No final placings are recorded for this event yet."
`src/data/careers.ts:237` reads `result_rows`, which Pack 01 filters to non-synthetic events. The brief's explicit scenario
("synthetic results visible on its own test event page without entering official rankings") therefore fails. Read
`result_rows_all` with the synthetic flag for the event's own page. Screenshot: `anon-event-caso-test-phone-390-no-results.jpg`.

**B3. Competition setup does not exist.** P1 · Missing feature · Medium · Proven. The Setup tab lists "✗ At least one competition
is set up" and "Publish is off until: at least one competition is set up"; the Run tab says "Add competitions to <event> first".
There is no screen, button or form that writes `competitions`; `grep` finds no insert in `src/`. The seed competitions were
written by SQL. For anyone who is not the owner this is a hard stop, and the only step in the checklist without an inline
action. Screenshots: `organizer-setup-publish-dead-end-phone-390.jpg`, `organizer-run-no-competitions-phone-390.jpg`.

**B4. Scorekeepers cannot find their ring.** P1 · UX · Small · Proven. Nothing links to `/events/:slug/field/:field` (only the
route exists). The scorekeeper's Account page shows the generic fighter copy and "Create an event"; the event page's "Now and
next" panel is not linked; the field queue is empty until an organizer changes a match's queue state. On the day a scorekeeper
needs a URL from someone's notes.

**B5. The Run tab cannot be operated under pressure.** P1 · UX · Large · Proven. For the nine-competition test event the page
measures 32,148 px tall at 390 wide and 21,472 px at 1440, with 81 match cards, 21 disclosure widgets and 584 buttons. Every
card repeats a four-button queue group and a schedule editor; team roster editors list every club member. There is no
per-competition collapse, no "now and next" view, no filter by ring or day. Screenshots:
`organizer-run-tab-rdr-test-desktop-1440-whole-page-thumbnail.jpg`, `...-first-6000px-of-21472.jpg`.

**B6. A fighter cannot see their registration from their account.** P1 · UX · Small · Proven. `fetchMyEvents` returns
staffed events only (`src/data/api.ts:81`, `src/lib/draftView.ts:26`), so after registering and being accepted, the fighter's
Account has no My events section at all; the only place the status appears is the event page itself. The owner, conversely, gets
all 18 events listed under My events. Screenshots: `fighter-account-no-my-events-phone-390.jpg`,
`superadmin-account-my-events-dump-phone-390.jpg`.

**B7. Public event page as one scroll.** P1 · UX · Medium · Proven. See section 7, Event page.

---

## 4. Mobile findings (phone-specific)

* **Scoring board header.** On 390 x 844 the eyebrow, a 34 px uppercase title ("IRON WOLVES-TEST VS NORTHERN RAVENS-TEST" wraps to
  five lines) and a four-line "Pending: not official until you save" chip push the fighter buttons to the second screen;
  "Back to the queue / Finish match" sit at the bottom nav. In landscape (844 x 390) only the title fits. The global bottom nav
  stays visible while scoring, inviting a mis-tap to Home. P2 · Small. `scorekeeper-5v5-board-phone-390.jpg`,
  `scorekeeper-5v5-board-landscape-844x390.jpg`.
* **Standings tables overflow their card** by about 13 px at 390 (table right edge 403 px) and more at 360, on every published
  event page; the Formats list-size table overflows at 390 too. The page does not scroll sideways, so the last column is clipped.
  P2 · Tiny.
* **Event record tab strip is cut off** ("Attendance Categories Brackets Resu…") with no scroll affordance. P3 · Tiny.
* **Manage page tab strip** ("Review (1 waiting) · Check-in (0/1 ready) · Run · Setup · People · Teams") overflows and must be
  swiped; the active tab label is long. P3 · Small.
* **Signed-in header drops the wordmark** to fit bug, bell and Account buttons: three round buttons, no product name. P3.
* **Public event page** is 8,111 px tall at 390 (10 screens) before any match has been played, because all nine competitions'
  standings and brackets render inline. P1 (B7).
* **Teams and Fighters directories** are 4,773 and 4,864 px tall for 20 teams / 24 fighters: one tall card per row, each with
  a repeated provenance sentence or three chips. P3 · Small.
* **Run tab** 32k px. P1 (B5).
* **Setup tab** is a single 3,285 px form with the publish panel on top and the fields below; a province/state free-text box
  while registration uses a province select. P3.
* **Bottom nav** labels are 11 px at 2.9:1 contrast (axe). P2 · Tiny.
* **The "Reconnecting…" live banner** renders at 11 px uppercase monospace, hard to read and alarming on a 2023 event. P3.
* Tap targets are generally good (buttons ≥ 44 px; check-in buttons 56 px). Exceptions: the "← All events / ← Back" links at
  22 px tall, "Read the text" summaries at 25 px, inline "Edit team" and phone links.

## 5. Desktop findings

* **Hero wastes the right half** of 1440 and 1920 layouts (700 px tall, nothing right of the headline). P3 · Small.
  `anon-home-desktop-1440.jpg`.
* **Run tab and Setup tab stay a single narrow column** at 1440; the Run tab is 21,472 px tall with 1,000 px of empty margin.
  A two-pane layout (competition list left, matches right) is the obvious use of the width. P2 · Medium.
* **Brackets clip** on the public event page at 1440 (the "Third" column is cut); the bracket is in a non-focusable scroll
  region (axe `scrollable-region-focusable`). P2 · Small.
* **Team roster grid** uses four equal columns; "Since Oct 2022" wraps under long names and the CAPTAIN chip breaks row
  alignment. P3 · Tiny. `anon-team-mountain-bears-desktop-1440.jpg`.
* **Teams directory on desktop** is a 3-column grid where every HACSA card has an identical blue/white placeholder crest and the
  same sentence; the eye has nothing to catch. P3.
* **Rankings** is a 1,000 px page that is 60 % empty state. P2 (section 7).
* Tablet portrait and landscape (768, 1024) behave like wide phones: no layout issues found beyond the above.

---

## 6. Role-by-role findings

**Anonymous.** Understands the sport within one screen (the "Pick your fight" cards are the best explanatory copy on the site).
Does not understand that everything is fictional until reading a badge: the hero's primary button is "See Red Deer Rumble-test".
Can register only after sign-in (fine). Hits `Could not load events` on every team page. `/marshal` is reachable and looks like a
live scoring console for teams that do not exist. 404 and draft-event-not-available pages are clear.

**New user.** Onboarding is one short form with good validation; the "Later" option on public pages is right. After joining a
team they immediately get a fighter page and a home team. Irrelevant: "Run events › Create an event" leads to a refusal page with
no way to ask for approval. The Account header shows only a letter avatar and email; nothing says "you are a fighter on Mountain
Bears" except a row title.

**Fighter.** Registration: 14 required answers across seven cards, all validated at once on submit with a count ("Please fix the
14 highlighted item(s)"), which is honest but means the first submit is always a wall of red for someone who skipped ahead.
Day checkboxes and payment deadline are the Rumble's, not the event's (J4). After submitting: "Thank you, you are registered"
then "Back to events"; the event page then shows "Your registration: Waiting for review · Fee $40 · not marked paid yet". Good.
But the Account page never mentions it (B6), `/register` reopens as a blank form (submitting again gives the correct "Your
registration was already accepted; ask an organizer to change it", but only after refilling everything). "Team manager" tells a
fighter who already has a home team to "Find your team and ask to join". No withdrawal path exists for the fighter.

**Captain.** Team manager is clean: "Your team › Edit team / Team page / Roster", join inbox, notification deep-links. Team edit
works and social links display after save (the brief's regression check passes). The emblem-saves-now versus form-saves-later
split is explained with two chips and three paragraphs; it is understandable but wordy. Validation copy is good ("Use a full
https:// address", "Use a four digit year from 1900 to 2026"). No way to see or manage event entries for the team; "Roster"
links to the public page.

**Organizer.** Cannot create events on hosted (not a platform organizer). Once allowed: create → setup is a sensible flow and the
slug auto-fills; publish checklist is a good idea undone by the missing competition UI. People tab works and says why an unknown
email fails. Review cards are complete (categories, blockers, insurance select, paid toggle, contact under a disclosure, medical
note behind a second click). Problems: Accept makes the card vanish into "NOTHING HERE"; Review and Check-in split the same
person across two tabs; the Run tab (B5); the "waiver not recorded" footer; the OrganizerPanel on the event page still says "The
draw and event-day scoring arrive in this workspace next."

**Scorekeeper.** The queue page is the best mobile screen on the site (large rows, state chips, "Tap to start scoring"). The
boards are correct and the offline path is trustworthy. Missing: any link to get there (B4); a focused layout (header,
bottom nav); auto-retry after reconnect (J13); an undo on the group board after a confirmed round (only duel has "Undo last
strike"). The duel header "ROUND 1 OF 2 · 1:00" reads like a timer but does not count.

**Organization admin.** The Account chip says "Organization admin" but there is no organization admin area: the only extra
surface is "Admin: teams and captains" inside Team manager (name a captain, approve teams). `/organizations/nacl-test` has no
admin controls; standings, events and staff for the organization are not administrable in the UI. Feels like a flag, not a role.

**Super admin (owner).** Platform home is four tidy cards. Organizations page: "ORGANIZATIONS" breaks mid-word at 390
(`superadmin-organizations-phone-390.jpg`); a toggle labelled "[✓] Enabled" with literal brackets; stat tiles where HACSA shows
"Fighters 0" because imported teams have no rosters (true but looks broken). Analytics is a 23,661 px page of tables at 390.
Team manager lists all 20 teams with Edit/Captains buttons and a search; fine. The owner's My events lists every event (18) and
Events page shows "Create an event" and "Your drafts" (good). The owner is the only person who can publish the real Rumble
draft; its Run tab correctly shows nine competitions with 0 entrants each. Platform pages are reachable only from the More
drawer and Account rows under the odd heading "Run events".

---

## 7. Page-by-page findings

**Home (`/`).** Strong hero, clear sport explainer. Issues: primary CTA names a test event; "Coming up" is one fictional event;
desktop right half empty; 11 px chip text everywhere. The headline "Every list. Every fight. Every result." assumes the reader
knows "list" means arena.

**Events (`/events`).** Chronological upcoming then past, format segmented control, past filters by season/organization/province.
Missing: search, a hide-test-data switch, any upcoming/past toggle besides the section split, status chips other than
"Registration open" and "Draft". 16 of 17 events say "-test". Cards are good on desktop; on phone each is 190 px tall. The
"HACSA" organization chip uses the same steel tone as the format chips so three chips read as one kind.

**Event page (`/events/:slug`).** One vertical page: title, test banner, date chip, where, org chips, share button, live banner,
"Now and next", competitions grouped by league, "Results" with a standings table or bracket per competition, "Good to know".
No tabs, no anchors, no competition picker; `?tab=` is silently ignored (the tabbed `EventPage.tsx` only renders in sample
mode). Standings tables show W L D +/- all zero for every entrant before the first match. Brackets show mostly "To be decided".
A 2023 event still mounts the live subscription and shows "Reconnecting". The event record tabs for completed events hide
fictional results (B2). The page has the content for a good event hub; it needs structure: a sticky sub-nav (Overview · Live ·
Competitions · Results · Info) and one competition at a time.

**Register (`/events/:slug/register`).** Complete and correctly validated; hard-coded Rumble dates (J4); reopens blank after
submission; no draft saving; "Buhurt International fighter profile, if you have one (fighters without one go in a separate
bracket)" is a 90-character label. Preview mode (`?preview=1`) is reachable by anyone and is labelled.

**Manage (`/events/:slug/manage`).** Six tabs in a scrolling segment. Review: good cards, weak feedback. Check-in: the right
design (sticky counters, big buttons, blocked reasons in red) and the fastest screen for a queue of 40 people, let down by the
waiver footer and by being a tab away from Review. Run: B5. Setup: publish panel then a long form; "Province or state" free
text; fee logic ("Who pays the fee: Only people from Alberta") is a specific policy exposed as a general option. People: fine.
Teams: platform-wide team approval and merging inside an event's workspace is confusing scope ("Teams belong to the platform,
not one event", the code comment admits).

**Field (`/events/:slug/field/:ring`).** See scorekeeper. Also: "Nothing queued on Ring 1" explains the organizer dependency but
offers no action.

**Teams (`/teams`).** Search and affiliation filter work; grouped by organization. Cards repeat provenance; crests identical.
"Add your team" → Team manager (sign-in) is fine.

**Team page.** Good information order (crest, place, founded, join CTA, About, Affiliations, Roster, Record, Upcoming, History).
Broken Upcoming (B1); "Team record: No competitions are recorded for this team yet" directly above seven events of history
(synthetic exclusion without saying so); roster grid alignment; three provenance disclaimers on one page.

**Team edit.** Works; wordy save-model explanation; no success message after save (navigates straight back).

**Fighters (`/fighters`).** Search, team, gender, discipline, region filters; 24 per page with pagination at the bottom only.
Cards show chips for every discipline, so a 5v5+3v3+longsword fighter card is three lines of chips. Feels like a list, not a
sports database: no photo, no record, no team crest.

**Fighter page.** Order: header, About, Career, By category, Tournament history, Upcoming, Team history. Career says "No
competitions are recorded" while By category says "3 competitions, best place 3rd, 1 bronze" and History lists three placings
(B6-adjacent copy bug). Upcoming broken (B1). "Captain · team history" chip with a footnote explaining itself. The page is
long but not unreasonably; the problem is contradiction, not length. Tabs are not needed.

**Profile edit.** Clear, single page, photo saves immediately (untestable here), 12 discipline checkboxes, character counters.
Good.

**Rankings.** Defaults to HACSA + 5v5 + Men + Season and lands on "Nothing to show yet. Choose a season. This organization has no
seasons yet." Seven controls before any content. The methodology sentence is good. Needs a default that has data, or an
explicit empty-first design that says "No official rankings yet; fictional events are never counted".

**Formats.** Good explanatory cards; tables overflow at 390; the page is long (3,891 px) but scannable.

**Rules.** Search-first with category segments; every rule is rendered on one 6,963 px page beneath the search, which is fine for
find-in-page but heavy on phones. Document and section chips distinguish source from paraphrase well.

**Marshal (`/marshal`).** A demo with fixture teams and a "Pretend there is no signal (preview only)" checkbox. Remove from the
build or gate behind sample mode.

**Organizations.** Directory of two; organization page lists every event flat (16) with "Rankings for NACL-test" at the very
bottom. Fine, but the organization page is where standings and the season structure should live.

**Account.** Clear rows, correct roles chips. Problems: "Run events › Create an event" for everyone; My events staff-only; no
role explanation for scorekeeper/marshal; "Teams" heading for the owner.

**Sign in.** "SIGN IN" h1 and "SIGN IN" h2 one above the other; otherwise minimal and fine.

**Welcome.** Fine.

**Platform pages.** See Super admin.

**Privacy, 404, "Event not available", "This area is for organizers".** All clear, plain and short. Good.

---

## 8. Ugly or visually weak screens, worst to best

1. **Organizer Run tab (phone and desktop).** 584 buttons, no hierarchy between setup and live operation, every panel open.
   Nothing dominates; a match card and a roster editor have the same weight.
2. **Public event page before the event.** Nine "STANDINGS" tables of zeros and three near-empty brackets with "To be decided"
   boxes; the brackets clip; the page says "Results" about things that have not happened.
3. **Platform › Analytics on a phone.** 23k px of two-column tables; readable only on desktop.
4. **Scoring board header on phones.** Five-line uppercase title plus a four-line chip; the actual board is off-screen.
5. **Teams directory.** Identical placeholder crests and the same provenance sentence twenty times; the TEST DATA and
   organization chips compete with the team name.
6. **Rankings.** Seven controls and an empty card.
7. **Fighters directory.** Three rows of chips per card, no imagery, pagination hidden at the bottom.
8. **Setup tab.** A 3,000 px form with a status panel on top; the publish state and the form fields look the same.
9. **Team page roster.** Misaligned four-column grid.
10. **Home on 1440+.** Half-empty hero.

Consistently good: Check-in, the Ring queue, the More drawer, the Account page, the Welcome form, the Rules search.

---

## 9. Confusing or user-unfriendly workflows, ranked

1. Publishing an event (checklist points at a step that cannot be done).
2. Getting a scorekeeper onto a ring (needs a URL, then an organizer action in the Run tab).
3. Operating the Run tab on the day (B5).
4. Finding "my registration" as a fighter (B6).
5. Accepting a registration (card disappears; the person moves to another tab for check-in).
6. Understanding the public event page (where are results for competition X?).
7. Reading the Rankings for the first time (empty by default).
8. Understanding what "Organization admin" lets you do.
9. Editing a team (two save models explained at length).
10. The pending-after-reconnect state on the scoring screen.

---

## 10. Bugs (functional defects)

| ID | Bug | Where | Sev | Effort | Conf |
|---|---|---|---|---|---|
| B1 | PGRST201 ambiguous `entries→competitions` embed (pool_tie_decisions) | `teamDirectory.ts:81`, `careers.ts:173` | P1 | Small | Proven / hosted FK confirmed |
| B2 | Completed synthetic event shows no results (`result_rows` excludes synthetic) | `careers.ts:237`, `EventHistory.tsx` | P1 | Small | Proven |
| B3 | No competition creation UI; publish and run dead-end | `SetupTab.tsx`, `RunTab.tsx` | P1 | Medium | Proven |
| B8 | Registration form hard-codes "Saturday Nov 14 / Sunday Nov 15", "before November 13", "before November 11, 2026" | `RegisterPage.tsx`, `model.ts` INSURANCE_OPTIONS | P2 | Small | Proven |
| B9 | `/register` shows a blank form to someone already registered; error only after refilling | `RegisterPage.tsx` | P2 | Small | Proven |
| B10 | After reconnect the SyncBar says all confirmed while the pending card still reports waiting actions | `FieldPage.tsx` | P2 | Small | Proven |
| B11 | Check-in footer "signed waiver is not recorded" although registrations store `waiver_version_id` | `CheckinPanel.tsx` | P3 | Tiny | Proven |
| B12 | `?tab=` on public events ignored; sample-mode `EventPage.tsx` is dead code for real events | `EventRoute.tsx` | P3 | Tiny | Proven |
| B13 | "Set 0 times" button label when "Keep matches that already have a time" leaves nothing to set | `BulkSchedule.tsx` | P3 | Tiny | Proven |
| B14 | Live subscription and "Reconnecting" banner on events years in the past (`showLive = published`) | `EventWorkspace.tsx` | P3 | Tiny | Proven (banner caused by no Realtime here, but the condition is wrong regardless) |
| B15 | Standings tables overflow their card at ≤ 390 px | `LivePools` CSS | P2 | Tiny | Proven |
| B16 | "ORGANIZATIONS" h1 breaks mid-word at 390 | `.PageHead` display font, no `overflow-wrap` tuning | P3 | Tiny | Proven |
| B17 | Staff add with unknown email returns HTTP 500 (P0002) to the console; UI message is fine | `grant_event_role_by_email` | P4 | Tiny | Proven |
| B18 | Fighter's "Career" says none recorded while "By category" counts 3 competitions and a bronze | `FighterPage.tsx` | P2 | Tiny | Proven |

Not reproducible here, needs hosted confirmation: anything involving Storage uploads, Realtime, service worker updates, email
codes, Google sign-in.

---

## 11. Responsive problems

* Table overflow in standings (≤ 430) and formats (≤ 390).
* Scoring board above-the-fold content on 360/390 and in landscape.
* Display-font h1 word-break at 390 ("ORGANIZATION / S"; also "RUMBLE-TEST" splits by hyphen which is fine).
* Segmented tab strips (Manage, Event record) overflow without affordance.
* Run tab single column at every width.
* Home hero on ≥ 1440.
* Tablet widths: no distinct layout; phone layout stretched (acceptable).
* No horizontal page scroll was found at any width on any public route (good).

---

## 12. Accessibility

axe-core (wcag2a/aa/21aa + best practice) on 25 pages, phone width:

* **Colour contrast (serious), every page.** Bottom nav inactive labels `#8a93a3` on `#f6f7f9`, 11 px: 2.88:1. Event date-box
  year 2.61:1. TEST DATA / brass chips `#9a6b1f` on `#f3e8d2`, 11 px: 3.84:1 (needs 4.5). The "vs" separator 2.54:1. One token
  change (`--muted`, brass chip foreground) fixes most of it. P2 · Tiny.
* **Heading order (moderate)** on 12 pages: h3 directly under h1 (panels use h3). P3 · Small.
* **Scrollable regions not focusable (serious):** pools boards and brackets on event pages and the formats table. P3 · Tiny.
* **Duplicate landmark labels** in multiple brackets. P4.
* Manual: focus rings are visible (2 px); the More drawer is `role=dialog` with Escape and a close button; icon buttons have
  labels; form inputs are all labelled (no unlabeled inputs found on any audited page); `role=alert` used for errors and
  `role=status` for success. No skip link. Group-fight board buttons announce "fighter 3 out/standing" (good). Colour alone is
  not used for state (chips carry text). Reduced motion: a global `prefers-reduced-motion: reduce` rule disables all animations and transitions (good). Text
  scaling to 200 % was not tested.

---

## 13. Copy and terminology

* **Developer language on user screens:** "Rounds to win is a setting on the competition: the round structure comes from the
  tournament regulations." (board); "The signed waiver is not recorded in registration data yet" (check-in); "Every action is
  checked by the database again; this page only decides what is shown." (Platform); "Owner tools"; "[✓] Enabled".
* **Stale copy:** "The draw and event-day scoring arrive in this workspace next." (event page organizer panel).
* **Hard-coded event specifics** in the generic registration form (B8).
* **Sport terms without explanation for newcomers:** "list" (hero), "On deck / In the hole", "Draw number", "pools", "mercenary",
  "BI profile", "Outrance", "profight". Formats page explains the fighting styles well; tournament terms are explained only
  inside the Run tab's "Suggested format" disclosure.
* **The same thing, different words:** Entrant / Entry / Registration / Fighter (Run tab says "entrants", Review says
  "registrations", DB says entries); Competition / Category (registration form calls competitions "Categories"); Field / Ring
  (field pages titled "Ring 1" under the route `field`); Organizer / event owner / platform owner / BuhurtOS owner; Sign-up /
  Register / Registration (register page eyebrow says "SIGN-UP" when registration mode is none).
* **Status words:** "Pending" (registration) vs "Waiting for review" (fighter's view) vs "Pending: NOT official" (scoring) vs
  "Waiting for a captain" (team request). Pick one word per concept per audience.
* **Over-long labels:** "Buhurt International fighter profile, if you have one (fighters without one go in a separate bracket)";
  "Volunteer information (shown to volunteers; for example where to find the separate volunteer safety, liability and tracking
  form)".
* **Provenance disclaimers** appear up to three times on one team page and once per card in directories.
* **Good:** error copy throughout, the draft/not-available page, the paper-sheet instruction, "Nothing is lost."

---

## 14. Inconsistencies

* Date formats: `NOV 14-15, 2026` chip, `Sep 12-13, 2026`, `asked Oct 3, 2026`, `December 1, 2026 at 11:59 p.m. Mountain time`,
  `Sat 10:00` (Run tab), `from 2023-01-01` (affiliations). Five styles.
* Province: free text in event setup (hosted has an event with region "Alberta" next to events with "AB") vs a select in
  registration.
* Back navigation: "← All events / ← All teams / ← All fighters" links, "← Back to the event", "← Platform", and pages with no
  back link (Manage tabs rely on the "← Back to the event" at top only).
* Status chips: Draft (brass), Published (win), Registration open (brass), Test data (brass), Pending (brass), Active (live),
  Cleared (win), Blocked (brass). Brass means five different things.
* Save models: emblem/photo save immediately; team and profile forms save on submit; check-in toggles save on tap with
  optimistic rollback; setup form saves on submit with a status line. Each is explained differently.
* Empty states: some are panels with an h3 ("No events published yet"), some muted paragraphs ("Could not load events."), some
  sentences inside panels; errors sometimes red paragraphs, sometimes `role=alert` without colour.
* Search inputs: `type=search` with placeholder examples on Teams/Fighters; a labelled plain input on Review; the Rules page uses
  a pill with an icon. Three looks.
* Section headings: public pages use uppercase display h2/h3 in panels; Account uses small-caps eyebrow headings; Platform uses
  bold sentence-case card titles.

---

## 15. Missing features discovered (genuinely useful only)

* Competition creation and editing (name, category, gender, structure, ruleset, rounds to win) in Setup. (B3)
* A link from Account and from the event page to the field screens for staff, and a field picker for scorekeepers.
* "My registrations" on Account, with status, fee and what is still required, and a way to withdraw.
* Event page sub-navigation (per competition), and an "Entrants" view listing teams and duellists.
* Hide-test-data toggle (or default-hidden synthetic content) on public lists while test data stays in production.
* A Run tab "Now and next" operations view: per ring, current and next match, one tap to advance.
* Organization admin surface: events, seasons, standings, staff for the organization.
* A request-organizer-approval action instead of "ask the BuhurtOS owner".
* Registration drafts, or at least per-section validation.

## 16. Things to remove or simplify

* `/marshal` demo page and the sample-mode `EventPage.tsx` hub (dead for real data).
* "Create an event" row for roles that cannot create events.
* Repeated provenance sentences on directory cards (keep on the detail page).
* Standings tables before any match is played (show the entrant list instead).
* The "Results" heading before a draw exists.
* Platform-wide team approval and merge inside the per-event Manage › Teams tab (belongs in Team manager admin only).
* The four-button queue group on every match card (one "Next on Ring X" action per ring is what the day needs).
* Three paragraphs explaining the emblem save model (one line: "Emblem changes are live immediately").
* The "Who pays the fee: only people from <province>" option list (a specific policy as a general feature).

## 17. Quick wins (Tiny or Small, high value)

1. Add the FK hint to the three embeds (B1). Small.
2. Read `result_rows_all` for an event's own record and label it (B2). Small.
3. Link field screens from Account (for staff) and from the event page "Now and next" (B4). Small.
4. Include registrations in My events (`my_event_entries` RPC already exists); stop listing all events for the owner. Small.
5. Fix contrast tokens for muted text and brass chips. Tiny.
6. Derive registration day checkboxes and deadlines from the event's dates; move insurance deadline text to event settings. Small.
7. Show "You are registered: <status>" on `/register` instead of a blank form. Small.
8. After Accept, keep the card visible with a "Accepted" state for a few seconds or switch the filter automatically. Tiny.
9. Collapse each competition in the Run tab by default; show a one-line summary. Small.
10. Hide the bottom nav and shrink the header on `/field/*` routes. Small.
11. Auto-retry finalize when the outbox drains after reconnect. Small.
12. Remove `/marshal` from the public router. Tiny.
13. Add an index.html shell (brand, "Loading BuhurtOS…") and split the Rules/Formats/Platform chunks. Small.
14. Make `showLive` depend on the event date window. Tiny.
15. Change "No competitions are recorded" copy to "Fictional results are not counted in career statistics" when synthetic. Tiny.
16. "ORGANIZATIONS" word-break: `overflow-wrap: normal; hyphens: manual` on `.PageHead h1`, or a shorter title. Tiny.

## 18. Before the Rumble (Nov 14)

Must: B1, B3 (or an owner-run SQL procedure documented and rehearsed), B4, the Run tab made operable (at minimum collapsed
competitions and a per-ring "now/next" list), scoring-screen focus mode (header and bottom nav), reconnect auto-retry, B8
(day checkboxes and deadlines come from the event), hosted migration reconciliation and a real-phone rehearsal
(`docs/runbooks/REAL_PHONE_REHEARSAL.md`) on Android Chrome at the venue.
Should: My registrations on Account, Accept feedback, contrast tokens, standings overflow, waiver footer, remove `/marshal`,
"Reconnecting" banner only for current events.

## 19. After the Rumble

Event page information architecture (sub-nav, per-competition views, entrants), Run tab redesign as an operations console,
competition editor UI (if the Rumble is handled by SQL), organization admin area, directory card redesign (crests, less
provenance), Rankings defaults and empty-first design, code splitting and an app shell, terminology pass (one word per concept),
design-system consolidation (status chip tones, date formatting, empty-state and error components), accessibility pass for
heading order and scroll regions, Realtime and Storage verification on hosted, fighter withdrawal, registration drafts.

## 20. Recommended implementation packs

**Pack A — Correctness before the Rumble (P1 bugs).** B1 embed hints; B2 `result_rows_all` on event pages; B8 event-derived
registration dates and deadlines; B10 auto-retry; B14 live window; B15 table overflow; B11 footer. Small, low risk, testable
with the existing gates plus one browser test per fix.

**Pack B — Event-day operations.** Field screen discoverability (Account rows for staff, event page links, ring picker); Run tab
collapsed-by-default with a "Now and next per ring" operations panel and one-tap advance; scoring focus mode (hide bottom nav,
compact header, landscape layout); organizer "Next match on Ring X" from the queue page itself. Medium to Large; this is the
pack that decides whether the Rumble is run from the app or from paper.

**Pack C — Competition setup.** Competition create/edit in Setup (category, gender, structure, ruleset, rounds to win, sort),
wired to the existing publish checklist, with the checklist linking to it. Medium. Needs an RPC under the existing permission
model (organizer of the event only).

**Pack D — Fighter and account.** My registrations on Account (status, fee, outstanding items, withdraw); `/register` shows the
existing registration; remove "Create an event" for non-organizers; approval request path; scorekeeper/marshal role rows.
Small to Medium.

**Pack E — Public event page structure.** Sub-navigation, per-competition result views, entrants view, hide zero standings and
premature "Results", bracket scroll affordance and focus, `?tab=` honoured. Medium.

**Pack F — Public discovery and test data.** Hide-test-data default or toggle, hero CTA logic that never picks a synthetic event,
directory card simplification (provenance once, crest fallback variety), Rankings defaults with data or explicit empty-first,
events search. Small to Medium.

**Pack G — Admin surfaces.** Organization admin area; Platform analytics responsive tables; Team approval/merge out of the event
workspace; organizations page polish (toggle label, h1 wrap, zero tiles explained). Medium.

**Pack H — Design system, copy and accessibility.** Contrast tokens; chip tone semantics (one meaning per colour); date format
helper used everywhere; back-link and empty-state components; heading order; scroll-region focus; terminology glossary applied
(entrant/competition/ring/registration/pending); remove developer sentences; app shell and code splitting. Small items, many of
them; best done as one sweep with screenshots before and after.

---

## Appendix A — Journey scorecards

| Journey | Confusing moments | Dead ends | Serious bugs | Ugly screens | Unclear states |
|---|---|---|---|---|---|
| A New spectator | 3 (test naming, where are results, "list") | 0 | B1 on team/fighter pages | event page | "Reconnecting" |
| B New fighter | 2 (Create an event, Team manager wording) | 1 (approval page) | 0 | — | — |
| C Existing fighter | 3 (no My events, blank re-register, hard-coded days) | 0 | B8 | — | registration status only on event page |
| D Captain | 1 (two save models) | 0 | B1 | roster grid | — |
| E Organizer | 6 | 2 (competition, approval) | B3 | Run tab, Setup | Accept feedback |
| F Scorekeeper | 2 (how to reach ring, header) | 1 (no link) | B10 | board header | sync bar vs card |
| G Organization admin | 2 | 1 (no admin area) | 0 | — | what the role does |
| H Super admin | 2 | 0 | 0 | analytics, organizations h1 | My events dump |

## Appendix B — Measurements

| Page (390 wide) | Height px | Notes |
|---|---|---|
| Home | 2,483 | |
| Events | 3,783 | 17 events |
| Event: Red Deer Rumble-test | 8,111 | all brackets inline |
| Event: Central Alberta Steel Open-test | 2,060 | results empty (B2) |
| Teams | 4,773 | 20 teams |
| Team: Mountain Bears-test | 3,601 | |
| Fighters | 4,864 | 24 of 120 |
| Fighter: Abel Coil-test | 2,679 | |
| Rules | 6,963 | |
| Formats | 3,891 | |
| Manage › Run (RDR-test) | 32,148 | 81 match cards, 584 buttons |
| Manage › Run (RDR-test, 1440 wide) | 21,472 | single column |
| Platform › Analytics | 23,661 | |
| Registration form | 4,230 | 14 required answers |

Production bundle: one JS chunk 1,021 kB (285 kB gzipped), CSS 58 kB. At 1.2 Mbps / 300 ms: Events page blank at 2 s, content at
~5 s; event page "Loading…" at 0.7 s, content at 2 s, full height at 5 s.

## Appendix C — Scripts and raw evidence

Playwright harness and journey scripts were kept in the session scratchpad (not committed): route sweeps per viewport, role
sweeps, organizer/fighter/captain/new-user/scorekeeper journeys, axe sweep, throttled-load capture. Raw full-page screenshots
(about 300 MB) were not committed; 38 representative downscaled images are in the assets folder.
