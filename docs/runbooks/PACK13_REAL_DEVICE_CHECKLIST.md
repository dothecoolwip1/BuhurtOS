# Real-device checklist: Lyst Control, counters, the display

CI and the sandbox cannot prove how this feels in a hall with real tablets, phones, sunlight, gloves, noise and a flaky network. These steps can only be done by people at (or standing in for) a real lyst.
**Nothing below has been performed. Do not tick a box unless you actually did it, and write the date, device, OS/browser version and the person beside it.**

Before you start: production must be on a build that includes Pack 13, and the hosted database must have the Pack 13 migrations (`PACK13_HOSTED_ROLLOUT.md`). Use a **test event** (test events never notify) with two fields,
a duel competition on each, and a scorekeeper, a head marshal and 4 to 6 volunteers' accounts. Roles: tablet operator (scorekeeper), head marshal (settings, voiding), 2 to 4 counters, 1 learning counter, someone on the public display.

## The tablet (operator)
- [ ] On the real lyst tablet (note model and browser), open the field, open a fight: the clock, START ROUND and the score are readable from standing height and from 1.5 m away in daylight.
- [ ] One-handed on a phone as well (portrait): every button used during a fight is reachable with the thumb; nothing important sits under the bottom navigation bar.
- [ ] Gloves: with the thin gloves actually worn at the lyst, the number keys (0 to 9), −/+, CONFIRM ROUND and START ROUND are hit without mistakes.
- [ ] START ROUND 1, then lock the screen for 20 s and unlock; reload the page: the clock is the true time (it did not stop or restart) and the fight is still open.
- [ ] Put the tablet in airplane mode mid-round: the screen says "No signal", the clock buttons are disabled, the clock keeps running on the public display. Enter the marshal's score offline: it shows as pending. Turn signal back on: it becomes official by itself, once.
- [ ] Break workflow with a real 30 s break and a real marshal calling the score: END ROUND, enter the score, CONFIRM ROUND, START ROUND 2 inside the break. Note the time it really took: ______ s, taps: ______.
- [ ] Press CONFIRM ROUND twice quickly with a real finger: still one confirmation.
- [ ] Record a warning, a card (from the event's own list), a −1 deduction and a disqualification with the marshal calling them. Void one with a reason. Check the Record view tells the truth.
- [ ] Correct a confirmed round with a reason. The Record view shows both the old and the new score.
- [ ] FINISH MATCH: the totals on screen are the marshal's confirmed rounds. Save: Official. The next fight opens with the counters already seated.
- [ ] Two tablets on the same field (operator and head marshal) both open: both show the same clock; press PAUSE on both at once: one wins, the other says another device changed the clock.
- [ ] Field 1 and Field 2 run at the same time on two tablets without affecting each other.

## Counters
- [ ] A volunteer scans the QR from the tablet with the phone camera (iPhone and Android both): the browser opens the counter page; if signed out they sign in and come back to it.
- [ ] They appear as waiting on the tablet; the operator seats them on a fighter in two taps. The phone then shows the fighter's name, the clock and the COUNT button.
- [ ] COUNT is big enough to hit without looking, with sweaty/gloved hands, at arm's length. Weighted buttons (+2 / +1) are not confused for each other.
- [ ] Tap fast for 10 s (about 5 taps per second): the number on the phone matches the taps; the tablet's tally for that counter matches.
- [ ] UNDO LAST removes only that counter's last tap.
- [ ] Phone in a pocket with the screen locked for 30 s mid-round, then unlock: the page recovers, nothing is lost or doubled.
- [ ] Walk out of signal (or airplane mode) and keep tapping, then come back: all taps arrive once. When the round has ended in the meantime, the phone says the taps were not counted.
- [ ] The round ends (break starts): COUNT stops on every phone and says so.
- [ ] A learning counter's phone says it is practice; their number appears on the tablet only under "Learning" and never in the marshal's entry list or on the public display.
- [ ] The marshal's call differs from the counters (for example counters say 6 and 5, marshal says 7–5): the tablet records exactly what was entered; nothing is averaged.

## Public display
- [ ] The venue display (TV/projector/phone) shows the clock, the confirmed score, the round, and "Scores being confirmed…" during the break. Readable from the back of the hall; the clock fits with the fight and the on-deck footer on the real screen.
- [ ] A card/warning/−points mark appears beside the right fighter and disappears if voided.
- [ ] A display left open for an hour recovers by itself after the Wi-Fi drops and returns.
- [ ] The display never shows counter numbers, names or learners.

## After
- [ ] The head marshal and an organizer can explain from the Record view and the audit trail who did what and when.
- [ ] Notifications: fighters with Pack 12 alerts on received exactly the queue alerts they would have received without Lyst Control, no extra.
- [ ] Anything that felt slow, confusing or risky is written down here: ____________________
