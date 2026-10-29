# Suggested fixes — c2b1624 (not applied)

These suggestions are grounded in the production commit's source, inspected with git show c2b1624:<path>. They are proposals, not tested patches. No application files were edited.

## F1 — P1: recount has no way to enter its required reason

Source: src/components/lyst/OutranceScoring.tsx, recount() around line 177 and RoundSheets reason input around line 411.

Observed: after all 3 sheets arrive, clicking Return the round to the line marshals for recount displays “Say why the round goes back to the line marshals.” The dialog contains zero textboxes. The reason input is rendered only when deliveryReason or missing phones is truthy, while recount always requires 3 characters. Consequently the normal all-submitted path cannot recount.

Minimal proposed change: also expose the reason input whenever the recount action is available. Keep normal confirmation reason-free; do not change canConfirm or server authorization.


e.g. replace the input's visibility condition:

~~~tsx
// In RoundSheets, within the existing !confirmed block:
{(deliveryReason || missing.length > 0 || sheets.length > 0) && (
  <label className="ly-reason">
    <span>Reason (required for recount or an override)</span>
    <input
      value={reason}
      maxLength={200}
      onChange={e => onReason(e.target.value)}
      placeholder="Why the marshal is returning or overriding this round"
    />
  </label>
)}
~~~

Why: the same reason state already feeds recount and missing-phone confirmation. This removes the impossible UI dependency without weakening the audit requirement. A more focused follow-up design could use a dedicated Recount dialog with its own reason state; the small change above fits the current architecture.

Verify: submit a phone plus two paper sheets; enter a reason; return for recount. Only phone submission should reopen; both paper sheets must remain. Resubmit and confirm with no override reason required. Test at both viewport sizes.

## F2 — P2: next round is incorrectly labeled already handed in

Source: src/pages/lyst/CounterPage.tsx lines 280, 368, 545.

Observed after confirming round 1, before round 2 starts: phone says “Prepared round 2” and “Round 2: sheet handed in” with round 1's 9–0 strikes / 10–9 result. The payload selection omSheet is scoped to om.round_no/state.round.no, but the label uses round, which prioritizes the next prepared run.

~~~tsx
// In the existing omSheet branch, label the sheet's server round,
// not the next prepared counter run:
<b>Round {om?.round_no}: sheet handed in</b>
~~~

Why: changing the shared round variable could break prepared/offline counting. Limit the fix to the handed-in sheet's identity. If preferred, derive a submittedSheetRound alongside omSheet and use it in all sheet-related text.

Verify: submit round 1, confirm it on desk, and wait before starting round 2. The old sheet must remain labeled round 1; no round-2 submission is implied. Starting round 2 must show fresh zero counts and permit its own submission.

## F3 — P2: stale success notice contradicts final fight state

Source: src/pages/lyst/CounterPage.tsx notice state around line 281 and submission success around line 477 (also duel done()).

Observed on both Profight and duel after finalization: Last fight correctly shows the final score and “Waiting for the next fight”, but the alert still says “Sheet handed in. Wait for the next round.” / “Score confirmed. Wait for the next round.” It disappears on a fresh tab; it is local transient notice state.

~~~tsx
// Near the notice state/effects. Clear only obsolete success notices;
// keep offline evidence, failures, and review notices intact.
useEffect(() => {
  if (!state.final && !state.waiting) return;
  setNotice(previous =>
    previous === 'Sheet handed in. Wait for the next round.' ||
    previous === 'Score confirmed. Wait for the next round.'
      ? null
      : previous
  );
}, [state.final, state.waiting]);
~~~

Why: the main counter banner already derives the current phase from server state. A cached success string should not contradict it. A future typed notice model keyed by match/run would further avoid stale notices across all transitions.

Verify: finish a Profight and a duel without reloading the phone; assert the exact Last fight score and absence of the obsolete next-round success notice. Also verify that held-count warnings survive finalization.

## F4 — P3: line-marshal prepared-round text reverses sides

Source: src/pages/lyst/CounterPage.tsx around line 532. Main heading and strike pads use om.fighters.a/b; the prepared-round text uses side-oriented state.fighter/opponent.

Observed: heading is Man A vs Man C, but Prepared round says Man C vs Man A. This is a presentation inconsistency, not proof that the prepared run points to the previous match. The same pair happened to fight in reverse order previously; do not infer data corruption from that coincidence.

~~~tsx
// Use the same canonical red/blue identities as the Profight heading.
const preparedA = lineMarshal && om?.position === 'ok'
  ? om.fighters.a ?? sides.a.name
  : state.fighter;
const preparedB = lineMarshal && om?.position === 'ok'
  ? om.fighters.b ?? sides.b.name
  : state.opponent;
// In the existing prepared-round paragraph:
<p>Prepared round {state.prepared_run.no}: {preparedA} vs {preparedB}.
  {/* Keep the existing offline-start instructions here. */}
</p>
~~~

Why: a line marshal scores both fighters, so the ordinary one-side counter identity is inappropriate. Preserve the side-oriented wording for ordinary Red/Blue counters.

Verify: line-marshal heading, prepared text and pads agree on Red/Blue names; ordinary Blue counter still leads with its own fighter as intended.

## Transport interruption and hidden-tab test

A transient no-signal episode retained Blue's count of 2. Confirm showed “Could not confirm. Your counts are kept here. Try again.” Retry succeeded, the desk received 2, and result finalized 4–2. No warn/error console entries were captured. No network root cause was established, so do not invent a backend fix. Add a recovery regression in a test harness with separate desk/phone browser contexts:

~~~ts
// Suggested Playwright test fragment; requires separately authenticated fixtures.
await phone.context().setOffline(true);
await phone.getByRole('button', { name: 'Count two points, head or torso' }).click();
await expect(phone.getByRole('status', { name: 'Your count 2', exact: true })).toBeVisible();
await phone.context().setOffline(false);
// End round from desk, confirm the phone, then assert one accepted count of 2,
// no duplicate tap, and a final score consistent with the marshal's award.
~~~

The genuine hidden-tab check was blocked by Windows input: “GetCursorPos failed: Access is denied. (0x80070005)”. DOM visibility readings stayed visible and cannot prove a background/foreground transition. No app fix is justified by this tooling failure. Retest manually or in a browser harness with real tab activation: background desk 1, submit a paper sheet from desk 2, foreground desk 1 and time the update without reload.
