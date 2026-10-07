# Pack 24A1: Focus layout and tablet safety

Branch `claude/focus-layout-tablet-safety-b40tc4`, fast-forwarded onto the Pack 24A0 branch (`ccr-1138edea-jygf5t`: `11f2263` 23R, `eea04aa` and `38f195e` 24A0). Every Pack 24A0 protection is kept; this pack changes no SQL, no grants and no RPCs. **Local only: nothing deployed, nothing applied to hosted Supabase.**

**State (2026-10-07):**
- **Merged:** PR #51, `main` `4298aec`.
- **Deployed:** CI and Deploy run 153, GitHub Pages; the live bundle is labelled `build 153 · 4298aec`.
- **Production check (automated, live site):** `scripts/e2e/pack24-production-check.mjs`, run 37564308976, **47/47** at 390x844, 768x1024 and 1024x768.
  - The field page and check-in desk run in the focus layout: focus header with Exit, one compact row (72 px or less), no site header, bottom bar or footer.
  - The build label is shown inside the focus layout and matches.
  - No sideways scroll and no page errors.
- **Not verified in production:**
  - Start round / End round / Back to the queue on a live fight: that needs a staff session and a fight, and no production fight may be created for UI testing.
  - The signed-in checks: the smoke-account secrets were empty in that workflow.
  - Covered locally instead: `pack24a1-live` 83/83 at the same sizes.
- **Physical phones and tablets:** not tested.
- **Fix after opening (`ca858a8`):** the focus layout had dropped the build label (`[data-testid=app-version]`) with the site footer. It's back as a small line at the end of focus screens, below every control.

**Reconciled onto `main` (2026-10-06)** on branch `claude/pack-24-safety-reconcile-grf0gg`. The original text below was written for `claude/focus-layout-tablet-safety-b40tc4` before Pack 18.1 and Pack 22 reached `main`. What changed in the port:

- **Routing:** the `FocusLayout` route group sits next to `main`'s chrome-less routes, after the Pack 18.1 `/device` sign-in route. Field scoring and the check-in desk keep their URLs. A temporary event device (Pack 18.1) runs `DeviceApp` with its own frame and identity bar, and does not use `FocusLayout`. `useFocusBar` does nothing outside it, so device screens are unchanged.
- **Desk:** keeps Pack 22's rule that a blocked fighter gets no Check in button. Undo uses the quieter 24A1 style.
- **FieldPage:** keeps `main`'s Pack 18.1 role lists (`operator`, `QUEUE_ROLES`) and Pack 22 rule citations. Only the `useFocusBar` call was added.
- **Browser suite** `scripts/e2e/pack24a1-live.sh`: one check assumed the first Pack 24A0 draft's rule that a scorekeeper cannot call a waiting fight. Under the reconciled 24A0 that is still allowed (the Pack 18.1 matrix), so the check now asserts what 24A0 does guarantee: not even the organizer can delete a fight through the table. On the reconciled branch: **83/83** at 390x844, 768x1024, 1024x768 and 1280x900. Start round and Back to the queue are uncovered at every scroll position, and while a round runs at 1024x768, End round and Pause stay uncovered and the clock never slides under them.

The rule this pack enforces: *while a live operation screen is open, the device is event equipment.* No site chrome around the controls, nothing fixed over them, and an obvious way back to the event.

Evidence: `docs/reviews/assets/2026-10-06-pack24a1/` (`evidence.json` with every measurement, 7 screenshots). Reproduce with `scripts/e2e/pack24a1-live.sh`.

Pack 23R suggested folding 24A1 into 24A4 because the tablet sizes it measured had no sideways scroll or small targets. The owner asked for 24A1 as its own pack; the obstruction below is why it was worth doing first. Pack 23R did not measure what sits *over* the controls; this pack did.

---

## 1. Before: reproduced in a real browser

Local stack (Postgres from every migration + the Pack 24A1 fixture, PostgREST 12.2.3, the built app, Chromium), scorekeeper on `/events/test-stuff-test/field/Field 1`, a longsword fight opened in the Lyst. The code was the Pack 24A0 head. A tap at the centre of a control was checked with `elementFromPoint`.

| Size | What was over the operation |
| --- | --- |
| 390 × 844 | site bottom bar shown (bottom 62 px); **Back to the queue** under it at the end of the page; **Start round** under it once scrolled to the bottom edge; the sticky lyst clock slid **behind the sticky site header** (a tap on the clock hit the header); bug button, notification bell, Account, footer on the page |
| 768 × 1024 | bottom bar shown (the bar appears up to 980 px wide, so an upright tablet gets the phone bar); **Start round** under it once scrolled to the bottom edge |
| 1024 × 768 | no bottom bar, but Start round started below the fold (bottom at 788 of 768) and the clock slid behind the site header |
| 1280 × 900 | no bottom bar; site header, footer and bug button around the screen |

Screenshot: `before-field-390x844-site-chrome.jpg` (the clock under the header, the footer and the bottom bar on the scoring screen).

## 2. What changed

### 2.1 Routes (same URLs)

| Route | Before | After |
| --- | --- | --- |
| `/events/:eventId/field/:field` (field queue, classic scoreboard, Lyst Control) | inside `Layout` | inside **`FocusLayout`** |
| `/events/:eventId/checkin` (check-in desk, armour inspection, weigh-in, readiness) | inside `Layout` | inside **`FocusLayout`** |

This follows the existing pattern: the venue display (`arena`), broadcast overlay and counter phone (`lyst/*`) are already sibling routes outside `Layout` in `src/App.tsx`. The two routes moved into a `<Route element={<FocusLayout />}>` group next to them. Deep links (`?match=`, `?open=`, `?from=eventday` on the field; `?r=` and `?f=` on the desk) are untouched; the pages read them exactly as before.

**Inspection.** Armour inspection has no route of its own: it is the same `/checkin` desk, where an inspector account sees the inspection controls (`roles.inspect`). It is the event-day workstation for inspectors, so it is covered by the same change. The header names what the account does there: *Check-in*, *Armour inspection* (inspector only) or *Check-in and armour* (organizer, head marshal). No new route was invented.

**Not moved** (deliberately): Manage (all tabs, including Event day and Run), Command Centre, the event page, the Marshal guide. They are overview and planning pages, not one focused live task, and the running-order work (24A3/24A4) will reshape them.

### 2.2 `FocusLayout` (`src/components/FocusLayout.tsx`, new)

- **Compact header** (one row, scrolls away, never fixed): **Exit** (44 px), the operational context (`FIELD 1`, `LYST · FIELD 1`, `CHECK-IN`, `ARMOUR INSPECTION`, `CHECK-IN AND ARMOUR`) and the event name, ellipsed on one line with the full name as a tooltip.
- **Exit** goes to the event page (`/events/:slug`, `#scorekeeping` from the field), or to Event day when the field was opened from Event day (`?from=eventday`, the same rule the page already used for its own back link). It is there on every state of the page, including loading, sign-in and "this area is for scorekeepers".
- **Connection chip**, from information the screens already have: *Offline* from the browser's online state (the same source as the existing offline banner); on the field screen *Synced* / *N pending* from the scoring outbox (`useOutbox().waiting`, the same count the sync bar shows). The desk has no outbox, so it shows only *Offline* when offline.
- **Kept from `Layout`**: offline banner, update banner, `ProfileGate` (unchanged: the field still sends an un-set-up account to profile setup exactly as before), push wiring, page-view analytics, the sample-mode flag, the error boundary, the stored light/dark choice (applied; `useTheme` is now exported from `Layout`).
- **Not rendered**: site header and navigation, phone bottom bar, More drawer, footer, bug-report button, notification bell, notification onboarding prompt, Account link, theme switch.
- **Safe areas**: header padding uses `env(safe-area-inset-top/left/right)`; the page bottom and the sticky action use `env(safe-area-inset-bottom)`.
- Pages describe themselves with `useFocusBar({ eventName, context, exit, pending })`. Outside `FocusLayout` the hook does nothing.

### 2.3 Field and Lyst screen

- No site chrome (above). That alone removes every obstruction measured in §1.
- **Sticky round action** (`.ly-act`, CSS only in the focus layout): Start round, End round, and *Start round N + Finish match* (two columns) stay at the bottom edge of the screen while the score above them is scrolled, and settle back into place at the end of the page, so nothing below them (Marshal's call, Counters, Record, Back to the queue) is covered for good. `position: sticky`, never `fixed`.
- **The clock never slides under the action**: on a short screen (tablet landscape) the sticky clock now stops just above the action row instead of overlapping it. Found by the new browser test: the first version put the action row over the running clock's Pause button at 1024 × 768.
- Markup change in `LystScoring.tsx`: the action buttons are wrapped in one-row `.ly-act` containers that are direct children of the screen, and the two secondary links (*Enter the score now without a break*, *Start a long break*) moved just below their row instead of inside it. Same buttons, same labels, same handlers, same order of actions. **No scoring logic changed**: server-confirmed scoring, the outbox, Pending vs Official, readiness as a warning only, the lyst clock and the round rules are untouched.
- The classic scoreboard needed no change beyond losing the site chrome.

### 2.4 Check-in desk

- No site chrome; the large page title is replaced by the focus header (an `sr-only` h1 keeps the page heading for screen readers).
- **Search first, and sticky** at the top while the list scrolls (52 px tall, 18 px text, `enterkeyhint="search"`). Same label, same filtering.
- **Compact summary**: the six counts are still buttons that set the filter (and the same `.desk-counts` element), now 48 px tall with smaller labels, below the search.
- **Undo** is now an unfilled, underlined text button, at least 44 px tall, at the right of the row; *Check in* stays the filled primary button and *Arrived* the outlined one. Same action, same server call.
- Attendance, inspection, weigh-in, override and readiness logic are unchanged. No new readiness model. Check-in is not merged with any Manage screen.

## 3. Security

UI and layout only. No migration, no grant, no RPC, no RLS change. The pages' own role checks (`SCORE_ROLES`, `my_desk_roles`) run exactly as before inside the new layout, and the database still decides every action (verified below, including a Pack 24A0 refusal). Scoring-role authority was not touched.

## 4. Tests and results (all local)

| Check | Result |
| --- | --- |
| `npm test` | 87 files, **1045 tests passed** (unchanged count: this pack adds browser coverage, not unit tests) |
| `npm run typecheck` | clean |
| `npm run build` | clean |
| **New** `scripts/e2e/pack24a1-live.sh` (real Chromium, local stack) | **83 / 83** |
| `scripts/e2e/pack16-live.sh` (check-in, armour, readiness) | **66 / 66** |
| `scripts/e2e/pack13-live.sh` (Lyst Control, counters, clock, rounds) | **88 / 88** |
| `scripts/e2e/pack24a0-live.sh` (match safety guards, scorekeeper field screen opens a called fight) | **41 / 41** |

The first full run of the new suite was 82/83: the Exit check read the page before the event page had rendered. The test now waits for the site header; the behaviour itself was already right (an earlier run had passed the same check).

### 4.1 What the new browser suite proves

| Required proof | Checks |
| --- | --- |
| 1, 2. Field screen at phone and tablet portrait has no site bottom bar | at all four sizes, on the queue and on the Lyst: no `nav.bottom`, no site header, no footer, no bug button, no theme switch, focus header present |
| 3. Start round is fully visible and tappable | at all four sizes, at four scroll positions from top to bottom: fully inside the viewport and the topmost element at its centre; 64 px tall |
| 4. Marshal's call and Counters reachable | Marshal's call, Counters, Record, Back to the queue: scrolled to, uncovered, ≥ 44 px, at all four sizes; Marshal's call opens its sheet once the round runs; at 1024 × 768 with the round running, End round and Pause are both uncovered at every scroll position |
| 5. Check-in search reachable without scrolling past summaries | at all four sizes the search is on screen at load with its top ≤ 150 px, and still on screen and uncovered after scrolling to the end of a 40-fighter list |
| keyboard | the viewport reduced to what a software keyboard leaves (768 × 620 and 390 × 480): typing keeps the search on screen, the found fighter's Check in is visible and saves on the server |
| 6. Exit returns to the event | field and desk Exit land on the event page (normal site chrome again); from Event day, Exit goes back to Event day |
| 7. Auth and role restrictions | signed-out, a stranger and check-in staff on the field; signed-out, a stranger, a scorekeeper and another event's desk on the desk: each gets the same refusal as before, no operational controls, still with Exit; the database refuses a stranger's clock command, check-in staff moving a fight, a scorekeeper or another event's desk checking someone in, and (24A0) a scorekeeper calling a waiting fight |
| 8. Same server flow | Start round sends one `lyst_timer_command` and the server's clock becomes `running:fight:1`; no round score appears from the layout |
| long names | a 111-character event name: header stays one row (≤ 72 px), Exit and Start round on screen, no sideways scroll (390 and 768) |
| no sideways scroll | measured on every field and desk screen at every size |
| scope | Manage › Event day still has the normal header and bottom bar |

## 5. Browser sizes verified (real Chromium; touch emulation for phone and tablet)

| Size | Field queue | Lyst (Start round) | Desk |
| --- | --- | --- | --- |
| 390 × 844 | no chrome, no sideways scroll | Start round fully visible and uncovered at every scroll position; tools reachable; classic scoreboard's Finish match and Back uncovered at the end of the page | search at the top, sticky over 40 fighters; keyboard case passes |
| 768 × 1024 | same | same; Start round → server clock running; Marshal's call opens | same; keyboard case passes; Undo quieter than Check in |
| 1024 × 768 | same | Start round visible on open (the sticky row brings it above the fold); running round: End round and Pause both uncovered | same |
| 1280 × 900 | same | same | same |

Screenshots (inspected by hand): `field-lyst-390x844.jpg`, `field-lyst-768x1024.jpg`, `field-lyst-1024x768.jpg`, `field-lyst-running-1024x768.jpg`, `field-long-name-390x844.jpg`, `checkin-768x1024.jpg`, plus the before shot.

**Not verified:** a physical phone or tablet, iOS Safari and its real safe-area insets and software keyboard (the keyboard was simulated by shrinking the viewport, which is what Chromium on Android does; iOS behaves differently), the real Supabase Auth and realtime (the local stack signs its own tokens and the field polls), landscape phones.

## 6. Files

| File | Change |
| --- | --- |
| `src/components/FocusLayout.tsx` | new: the layout and `useFocusBar` |
| `src/App.tsx` | field and check-in routes moved into a `FocusLayout` group (same paths) |
| `src/components/Layout.tsx` | `useTheme` exported (no behaviour change) |
| `src/pages/FieldPage.tsx` | describes itself to the focus header (event, field or Lyst, exit, pending count) |
| `src/components/lyst/LystScoring.tsx` | one-row `.ly-act` around the round actions; two secondary links moved below their row |
| `src/pages/CheckinDeskPage.tsx` | focus header; search first and sticky; title to `sr-only`; quieter Undo |
| `src/styles/app.css` | focus layout block (header, main, sticky action, clock stop, desk search, compact counts, Undo) |
| `scripts/e2e/pack24a1-live.{sh,mjs}`, `scripts/e2e/fixtures/pack24a1.sql` | new browser suite and TEST fixture (Pack 16 fixture + 36 synthetic fighters) |
| `docs/claude-packs/PACK_24A1_FOCUS_LAYOUT.md`, `STATUS.md`, `docs/reviews/assets/2026-10-06-pack24a1/` | this report, status, evidence |

## 7. Deliberately not changed, and left for later packs

- **Not in scope and not touched:** secretary/table permissions (24A2), running order (24A3), secretary tablet controller (24A4), Live consolidation, printing, TV board, best of three, navigation cleanup, the 24D typography and accessibility sweep.
- **Field queue view** keeps its large page title and the full-text sync bar; the focus header repeats the field and a short sync chip. Harmless, left for 24A4's screen work.
- **Readiness strip** on the Lyst can be tall on a phone (three lines of reasons); it scrolls away and the action stays reachable. Making it collapsible is a 24A4 / 24D question.
- **Sync wording** appears twice on the Lyst (header chip and the sync bar). The sync bar is the existing server-confirmed indicator and was kept as it is.
- **The desk's filter control** still scrolls sideways on phones (existing behaviour of the segmented control, not a primary action).
- **Command Centre, Event day and Run** stay in the normal layout; whether the secretary's controller becomes a focus screen is 24A4's decision.
- **Physical-device check** (iPad upright at the table, an iPhone with the home indicator, a real software keyboard) is still needed before the Rumble.
