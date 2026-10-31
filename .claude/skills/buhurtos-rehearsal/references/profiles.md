# Edge profiles and roles

## What is documented

- The owner has **seven existing Microsoft Edge profiles** and wants them reused, with concurrent people kept in separate sessions
  (owner request 2026-10-31).
- The seven-profile runs of 2026-10-29/30 used: organizer, secretary, four QR counters and a signed-out spectator.
- `organizer@buhurtos.ca` and `scorekeeper@buhurtos.ca` are shared test accounts that are staff on every test event automatically
  (full rehearsal prompt). Every other account (head marshal, medic, announcer, fighter, captain, a brand-new person) is **owner-provided**.
- Counters join by QR **signed out**; they must not hold an account sign-in.

## What is assumed

- The profile names and numbering on the owner's machine are not written down in the repository. The 4c78d57 report called them
  "Profile 1" (organizer) and "Profile 6" (secretary, later spectator). Record the real names at the start of each run.
- The default mapping below is this skill's proposal. Change it when the owner says otherwise, and record what you used.

## Default mapping

| Profile | Main role (always concurrent) | Session | Viewport | May also play (one at a time, with a recorded boundary) |
|---|---|---|---|---|
| Profile A | Organizer (P1) | organizer@buhurtos.ca | desk 1440×900, phone 390×844 for the "repeat on phone" steps | Organizer's second tab for "two tabs, one person" only |
| Profile B | Secretary, second desk (P2) | scorekeeper@buhurtos.ca | desk 1440×900 | Nothing else while a fight is running |
| Profile C | Counter 1 / line marshal 1 (P4) | signed out, QR only | phone 390×844 | Wrong-person phone (E3) between fights |
| Profile D | Counter 2 / line marshal 2 (P5) | signed out, QR only | phone | Late arrival (E6): leave its QR unopened until round 1 has started |
| Profile E | Counter 3 / line marshal 3 (P6) | signed out, QR only | phone | Bad connection (E7) |
| Profile F | Counter 4 / line marshal 4 (P7) | signed out, QR only | phone | Tab closed mid-round and reopened |
| Profile G | Spectator (P12) | signed out | phone | Head marshal (P3, tablet 820×1180), medic (P8), announcer (P9), fighter (P10), captain (P11), brand-new person (E1), non-staff user (E5): each only in its own step |

Why this split: the steps that need people **at the same time** are two desks plus up to four counters plus someone watching the public or
observer page. That is seven. Everyone else acts at a separate moment and can share Profile G sequentially.

## Rules for reuse (documented requirement, procedure assumed)

1. Before a profile changes role: finish or leave its current screen, sign out (Account → Sign out) or, for a counter, close the counter tab,
   and screenshot the signed-out state.
2. Sign in as the new role. Record in the profile log: UTC time, profile, old role, new role, "signed out first: yes".
3. A role that must be active **while** another role in the same profile is active cannot be tested in that profile. Mark the step NOT RUN
   with "needs another isolated session", or ask the owner for one. Do not open the second role in another tab of the same profile.
4. A counter seat is the QR session, not an account. Reusing a counter profile for a different seat means closing the old QR tab first and
   recording which seat it now holds ("Profile C: Counter 1 → Lyst 2 Counter 1 at 14:05:10Z").
5. InPrivate windows share one InPrivate session across every InPrivate window. One InPrivate window may be used as an eighth isolated
   session only if the owner approves it for that run; record it as such.
6. When a role is **removed** during a test (E4 role switcher), record the time of removal and the time the screen lost the duty.

## Profile log (copy into the report)

| UTC | Profile | Role before | Role after | Signed out first | Seat / screen | Notes |
|---|---|---|---|---|---|---|

## Profiles and roles actually used (required report table)

| Profile | Roles played (in order) | Accounts (by role name only) | Viewports | Concurrent with |
|---|---|---|---|---|

## When Claude Code drives the browsers (buhurtos-full-test)

The seven sessions are the Playwright MCP servers `edge-organizer` (A), `edge-secretary` (B), `edge-counter-1`–`4` (C–F) and `edge-guest` (G),
each a separate Edge with its own profile folder. They replace the owner's everyday profiles for that run; the same reuse rules apply. See
`.agents/skills/buhurtos-full-test/SKILL.md`.
