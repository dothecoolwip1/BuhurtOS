# Running an event with Event Control and the Counter QR (Pack 25)

For whoever runs the day. No developer tools needed. Read with `PACK181_DEVICES.md` (staff device codes) and `PACK13_REAL_DEVICE_CHECKLIST.md` (the Lyst).

## The public event page: three places
- **Overview** – what, when, where, registration, competitions, the livestream, good to know.
- **Live** – what is on each field right now: NOW, ON DECK, IN THE HOLE, with the official clock and score. A signed-in fighter sees **My next fight** first.
- **Results** – official results, the permanent record once the event is complete.

The bare event address opens on the place the day needs: the Overview before the event, Live while it runs, Results after. The three are one tap apart at the top of the page.

## Event Control: the one staff door
Staff see one button on the event page: **Event Control** (`/events/<event>/control`). It opens on the mode the day needs; an organizer can switch at any time.

| Mode | Who | What |
| --- | --- | --- |
| **Set up** | organizer | where the event is, the one thing to do next, the set-up tools: competitions, registrations, entrants, build tournament, draws and schedule, event settings, staff and roles, teams, broadcast |
| **Live ops** | organizer, head marshal, secretary / scorekeeper, Event Admin tablet | what needs attention, the fields (start the next fight, change the line), workstations, the Counter QR, fighters' readiness, competition progress, fights, broadcast, announcements, staff; the organizer's device codes (folded) |
| **Results** | organizer | review and finalize each competition, close the event |

A tool opens inside Event Control and has a **← back** to its mode. The old addresses (`…/manage?tab=…`, `…/command`) still work: they redirect into Event Control.

**Workstations** are full-screen jobs for one person and one phone: Lyst Control per field, the check-in desk, the announcer, the big screen, cards and penalties. **Exit** on a workstation opened from Event Control returns to Live ops.

## Counters: one QR, no seats, no approval
1. **Before the day** an organizer makes the event's **Counter QR** once: Event Control › Live ops › Counter QR › *Make the Counter QR* (also under *Counters and devices*). It is one code for every counter phone of the event. It is not a secret code to guard: it can only count.
2. **Show it** from Live ops (organizer, head marshal, secretary), from the Lyst's **Counters** sheet (*Counter QR* tab), or from the Counters and devices tool. Any number of phones can scan it.
3. **A counter phone**: scan → *Who is counting?* (their name, for the log) → *Which Lyst?* (only if the event has several fields) → **RED** or **BLUE** → count. The phone follows that Lyst by itself: when the Lyst opens the next fight, the phone is on it, same side. Nobody assigns a fighter.
4. **Handoff**: tap **New counter**, type the new name. Same Lyst, same side, the tally of the fight carries on; every tap carries the name of whoever held the phone.
5. **Change side or Lyst**: the links under the count button. A phone can also be moved by staff (below).
6. **Lost or dead phone**: scan the Counter QR on another phone. Nothing else to do.
7. **Training**: the Lyst's Counters sheet › *Training QR*. A trainee scans it on their own phone, gives their name, picks a side and counts along. Training counts are listed apart and are never official.
8. **Team fights** (5v5 and other NvN): the Lyst's group board has *Start round for counters*; a counter phone on that Lyst shows **RED 5 STANDING / FIGHTER DOWN / UNDO**. Evidence only.

**Counters are evidence, never the score.** The Lyst shows each phone on its own (operator, side, tally, online, submitted). Numbers are never summed, averaged or voted. The marshal's confirmed rounds are the only official score; finalization reads those alone.

## Managing the phones (no impersonation, ever)
- **Event Control › Live ops › Counters and devices** (organizer): the Counter QR, every phone signed in (operator, Lyst, side, online), **Move** (another Lyst or side), **Device preview** (read only: what the phone shows), **Who held it**, **Sign out** (that phone only; it can scan again), and the Pack 18.1 device codes for the staff tablets.
- **Platform › Devices** (platform owner): the same list across every event.
- Nothing on these pages acts as a phone. A move or a sign-out is written by the database with an audit entry; a preview reads the phone's state and touches nothing.

## Security, in one breath
A counter phone can count on its own seat only, on its own event, on the live round, never on a final match; its taps are idempotent; the organizer can end any phone and the code expires 24 hours after the event. The public display and the public API never show a counter's name or number. Training seats are kept apart and the pool QR can do nothing but count.

## Rolling Pack 25 out to the hosted BuhurtOS (owner, once)
The hosted migration tool cannot run a migration that drops a function without an interactive confirmation, so this one step is the owner's; everything after it is scripted and read-only.

1. **Apply the migration (SQL Editor).** Open the hosted project's SQL Editor, paste `supabase/manual/hosted_rollout_pack25.sql` whole, run it. It is `supabase/migrations/20261020000100_pack25_counter_pool.sql` verbatim plus one ledger row, in one transaction: either everything applies or nothing does. Expected: no error. Check: `select count(*) from public.counter_bindings` answers `0`; `select proname from pg_proc where proname = 'request_counter_seat'` answers nothing.
2. **Verify the database without touching real history.** Run `supabase/tests/hosted/pack25_hosted_verify.sql` in the SQL Editor (or ask the session to run it). It builds a synthetic event, walks the counter journeys and the refusals under the real roles, prints every check, then rolls itself back on purpose (`P25VERIFY ROLLED BACK`). Nothing may say `FAIL`.
3. **Redeploy the Edge Function** `device-session` (verify JWT off, as today) from `supabase/functions/device-session/index.ts` with `deno.json` and `../_shared/deviceSession.ts`. Only after step 1: the new function sends the pool code to the database, which the old database does not accept.
4. **Merge PR #54**; "CI and Deploy" on `main` publishes the site. Note the build number and commit it prints.
5. **Check the live site, read-only.** Actions › "Pack 25 production check (read-only)" › Run workflow, with that build number and commit, `sections` = `fn,ui` and a label such as `after-rollout` so the screenshots are committed to the branch. It opens the test events in their three phases, the legacy addresses, the workstations and the device page at five viewports, and the function's refusals and CORS. Its screenshots are an artifact (`pack25-hosted-screenshots`).
6. **Make the Counter QR** for the event (Event Control › Live ops › Counter QR) and scan it with a real phone: that is the one check no script can do.
