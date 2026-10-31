# Full rehearsal — 4c78d57 — partial, blocked at event creation

| Existing Edge profile actually used | Role in this phase | Session |
|---|---|---|
| Profile 1 | Organizer | Existing Test organizer login |
| Profile 6 | Secretary account inspection, then signed-out spectator | Existing Test scorekeeper login, explicitly signed out before public checks |
| Other five profiles | NOT USED yet | No new profiles created |

Owner authorized reusing the existing seven profiles for additional roles. This does not simulate twelve simultaneous people. Date: **2026-10-30 America/Denver**; evidence timestamps are **2026-10-31 UTC**, approximately03:48–04:05. Live footer4c78d57, built2026-10-31 03:46 UTC; local Git ancestry verified it includes required3aab7f9. No later build observed. Phone viewport390×844; simulated, not physical touch. Organizer creation was inspected at the existing desktop window size, not yet1440×900; no tablet check yet.

## Blocking finding

At https://buhurt-os.app/events/new the authenticated shared organizer sees **“Event creation is for approved organizers”**, followed by **“If you run events and want to be approved, ask the BuhurtOS owner. Once you are approved, come back to this page.”** This persisted after accepting the offered app update. Screenshot01. Automatic staff membership in test events is not equivalent to creation permission.

No new event could be created. Preserved synthetic fixtures were not changed to bypass this requirement. The expected fixture name is TEST Full Rehearsal 2026-10-30, but **it does not exist from this run**. Do not treat the scoring/KO fix as retested.

## Verified in this phase

- www events redirect preserved `/events?x=1` on the apex; old Vercel events address loaded the app.
- Signed-out Home, Events, Fighters, Teams, Rules and Rankings loaded; measured viewport390, document width375, no horizontal overflow. Captured warning/error arrays were empty. This is captured console evidence, not proof all network responses succeeded.
- Specified real fighter page no longer listed Red Deer Rumble-test; no Upcoming section was shown. Fictional TEST-fighter history half of that check remains untested.
- Sampled public fighter/team pages showed no private contact/medical/account fields. Public event intentionally contains an e-transfer contact email, so the literal requirement of no email anywhere fails; this is organizer-authored public contact copy, not evidence of leaked registration fields. Network response bodies were not inspected.
- Sign-in code form says **“We email you a sign-in code instead of using a password.”** No six-digit promise. No code requested or redeemed; email subject/body and new-person onboarding remain untested.
- Manifest loaded with relative scope`./` and start_url`./?source=pwa`. Edge offered Install BuhurtOS; no installation or push subscription performed.
- Public event Google Calendar link embeds the apex event URL. Share did not produce readable clipboard content in this run; ICS not verified. No calendar entry or external message sent.

## Other failures and suggested fixes

### Event creation: setup/permission blocker, not a proposed broad security bypass

Source`src/pages/NewEventPage.tsx` calls`fetchCanCreateEvents` and returns the approval panel before rendering QuickSetup. Verify the shared test organizer's intended provisioning through the normal owner-controlled process. Do not grant all authenticated users event creation or bypass checks in the UI. If product intent is a test-only creation capability, make it explicit and server-enforced:

```ts
// Design sketch, not an applied patch or existing API.
type CreationCapability = { realEvents: boolean; testEvents: boolean };
const allowed = requestedTestEvent ? capability.testEvents : capability.realEvents;
if (!allowed) throw new Error('Organizer approval required');
// Re-evaluate from authenticated identity inside the creation transaction.
// A test-only caller cannot submit test_event=false, convert to a real event,
// or link a real organization outside their existing authorization.
```

Regression: shared test organizer can create private synthetic events if intended; ordinary nonstaff cannot create real events; UI and server enforce identical capability. Current behavior may be intentional; the rehearsal account setup is insufficient either way. No permission changes made by Codex.

### Touch targets below requested44px

Examples: Events Upcoming/Past/All40px; Events/Calendar tabs37.70px; Rules category buttons40px; public event navigation42px; Add to calendar40px; header Sign in40px. Measurements JSON contains full DOM bounding boxes. Checkbox input dimensions alone do not establish the associated label's tappable area, so13px inputs are not separately classified as failures.

```css
/* Illustrative: apply to the actual shared control classes, then remeasure. */
@media (max-width: 600px) {
  .seg button, .event-tabs a, .calendar-action, .header-sign-in {
    min-block-size: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
}
```

Keep bottom navigation visible without covering focused controls; do not globally enlarge every prose link. Check each real component's selector and computed styles before patching. Test390×844 and desktop after changing shared styles.

### Public Events lacks Show test data

Expanded filters have Show archived events, but no Show test data. Source`src/components/EventFilters.tsx` gates it on`showTest`, whose documented contract is signed-in people only. This conflicts with the requested signed-out journey. Clarify desired public fictional-data browsing separately from private rehearsal events; do not expose private test_event records to satisfy the filter.

```tsx
// Sketch only: backend must already distinguish public fictional examples
// from private test events and enforce visibility before filtering.
<EventFilters showTest={canBrowsePublicFictionalExamples} {...filterProps} />
```

Acceptance: signed-out toggle can reveal only explicitly public fictional examples if intended; private rehearsal records remain inaccessible by list, direct URL and API. If current signed-in-only policy is intentional, revise the test expectation instead.

## Not verified and why

Event-dependent registration, draws, teams, scoring, KO/TKO, appeals, offline retry, cross-desk reconciliation, finalization and notification flows: no new authorized synthetic fixture could be created. Extra participant accounts/fresh alias are also not provided. No passwords/codes were printed or stored. No genuine hidden-tab,70-minute refresh, Slow3G or busiest15-minute Supabase workload was generated; do not carry earlier reports' passes into this run. Database/schema/auth settings were not touched, and no database connector writes were made.

## Record impact

Real records modified: **none**. Public real event/fighter/team pages were read only. Synthetic records created/changed/deleted: **none**. No preserved fixture modified. Browser-local sign-out and temporary viewport changes only.

## Numbered-step ledger

Each NOT RUN row is a coverage statement, not a test result. Evidence timestamps/builds are in measurements.json. No screenshot is claimed for an action that was not run.

| Step | Status | UTC / build | Evidence / reason |
|---|---|---|---|
| 1.1 | PASS|03:59–04:01 / 4c78d57|02,04–06,09–10 screenshots; six public pages, no overflow or captured console errors |
| 1.2 | PASS|03:58–04:01 / 4c78d57|02 and11; www preserves query; old host loads |
| 1.3 | NOT RUN|04:03 / 4c78d57|14 verifies corrected code wording only; all three actual login journeys not rerun |
| 1.4 | NOT RUN|03:54–03:58 / 4c78d57|Existing organizer/secretary pages showed no account ID; fresh sign-out/sign-in cycle not completed |
| 1.5 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 1.6 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 2.1 | FAIL|04:00–04:02 / 4c78d57|07,08,12; public payment-contact email violates literal no-email requirement; no private fields seen; network bodies not inspected |
| 2.2 | NOT RUN|04:00 / 4c78d57|08: real fighter fictional Upcoming exclusion passed; TEST fighter counterpart not checked |
| 2.3 | FAIL|03:59 / 4c78d57|03: no Show test data filter when signed out |
| 2.4 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 2.5 | NOT RUN|04:02 / 4c78d57|13: Google Calendar apex URL passed; share/ICS not verified; sampled real event read-only |
| 2.6 | PASS|04:03 / 4c78d57|15: relative manifest scope/start URL; install offered, not installed |
| 3.1 | FAIL|03:58 / 4c78d57|01: Event creation is for approved organizers; confirmed again after update |
| 3.2 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 3.3 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 3.4 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 3.5 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 3.6 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 4.1 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 4.2 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 4.3 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 4.4 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 4.5 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 4.6 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 5.1 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 5.2 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 5.3 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 5.4 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 5.5 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 6.1 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 6.2 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 6.3 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 6.4 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 6.5 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 6.6 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 6.7 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 6.8 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 6.9 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 6.10 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 7.1 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 7.2 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 7.3 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 7.4 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.1 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.2 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.3 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.4 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.5 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.6 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.7 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.8 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.9 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.10 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 8.11 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 9.1 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 9.2 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 9.3 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 9.4 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 9.5 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 9.6 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 9.7 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 9.8 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 9.9 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 10.1 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 10.2 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 10.3 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 10.4 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 10.5 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 10.6 | NOT RUN | — / — | Blocked by new-event creation and/or unavailable participant accounts; no screenshot |
| 11 | FAIL (partial coverage) | 03:58–04:03 / 4c78d57 | measurements.json; measured controls below44px; no complete role/tablet/desktop pass |
| 12 | NOT RUN | — / — | No busiest15-minute rehearsal workload; no new health conclusions |
