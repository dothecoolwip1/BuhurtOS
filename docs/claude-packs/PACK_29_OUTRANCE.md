# Pack 29: Outrance (Profight) exactly to Outrance Rules and Regulations V.26.4

Status: PLAN (rewritten 2026-10-29 to follow the rules exactly). Nothing in this pack is built yet. Step 0, bringing the repository level
with hosted, is done: `supabase/migrations/20261108000100_hosted_reconcile_2026_10_29.sql`.

Source: *Outrance Rules and Regulations V.26.4* (April 2026), the owner's PDF (28 pages), including the example scoresheet on page 25.
Every behaviour below cites its section (§). Where the rules are silent, this plan does not invent a rule: section 7 lists those gaps for
the owner or the head marshal (§2.1: the head marshal has the final say on interpreting the rules).

## 1. Where things stand (main = Vercel production; hosted database = repository after Step 0)

- Profight fights never open on the Lyst. `FieldPage.tsx` sends only duels to `LystScoring`; Profight gets the classic `ProBoard`, which never
  calls `lyst_open` or starts the Lyst clock. Counter phones on that Lyst wait for the whole fight.
- `ProBoard` is one person's sheet. It has no second or third line marshal, no averaging, no criteria in priority order (one combined
  "other criteria" choice), and no takedowns, weapon losses, armour-failure grants, KO/TKO, divisions, matched fights or win types.
- Hosted has no Profight fights in progress (three Profight competitions, none drawn). The in-flight backfill is still written and tested
  (CLAUDE.md).

## 2. Owner decisions (2026-10-29)

1. Hosted wins for the repository drift (Step 0, done).
2. Follow the Outrance rules exactly.
3. **3 or 5 line-marshal phones.** Each phone is one line marshal's scoresheet for both fighters (§2.3, §15.1.1, the p.25 sheet). This
   replaces the earlier "one counter per side" idea for Profight. Other disciplines keep their counters unchanged.
4. The Round Score is the secretary's average of the marshals' scores (§15.3.1). This is the Outrance-only exception to Pack 13's "nothing
   averages": raw taps are still never summed or averaged; what is averaged is each marshal's 10-point round score, as §15.3.1 says.
5. `matches.score_a/score_b` stay whole numbers (rounded totals, for display and sorting). The exact Round Scores, every marshal's sheet
   and the win type are stored in the result detail.

## 3. The rules, and where each one lands

### 3.1 Officials (§2)

| § | Rule | In BuhurtOS |
|---|---|---|
| 2.3, 15.1.1 | 3 or 5 line marshals, each scoring independently, on different sides of the list, with no contact during the round | 3 or 5 **line-marshal phones** per Profight fight. A phone never shows another marshal's numbers. The round cannot be confirmed with any other number of submitted sheets (see §7 gap 5). |
| 2.2 | Knight marshal: start/stop, clinch time, breakages, losses of weapon, KO/TKO, warnings and cards, announces the winner from the line marshals' points | The **Lyst tablet** records the knight marshal's calls (cards, KO/TKO, stoppages). |
| 2.4 | Timekeeper: rounds, breaks, repair time; "Time" | The Lyst clock: round, break and the 90 s repair clock. |
| 2.5 | Secretary: records each round's result from the line marshals' points; marks every yellow and red card in the protocol; notes medical conditions | The **secretary tablet** shows the submitted sheets, the computed Round Score, the cards; confirms the round. It cannot edit a marshal's sheet (only return it for recount, as now). |
| 2 (intro) | Duties may be combined (timekeeper with secretary, etc.) | One tablet may run the clock and the secretary's screen. |

### 3.2 The line marshal's sheet (§15, scoresheet p.25)

Per round, per side, each marshal records:

- **Effective strikes** (§15.2.1): one strike point per clean legal landed blow with weapon, leg, arm or shield. **Head strikes score nothing.**
- **Effective takedowns** (§15.2.2; "recorded for posterity").
- **Loss of weapon** (§2.3 "take note of loss of weapons", §14.1).
- **Armour failures** (§2.3, §14.4).
- **Point deductions** (total).

The round result on that sheet (§15.3.1 and the sheet's "Win Criteria"):

| Strike point difference | Result on the sheet |
|---|---|
| 16 or more | 10-7, "Dominant" |
| 11 to 15 | 10-8, "Moderate" |
| 6 to 10 | 10-9, "Slight" |
| 5 or less | "Even": go through the criteria **in priority order**, each Red / Even / Blue: (2) effective grappling, (3) effective list control, (4) effective aggression, (5) effective defence. The **first** criterion that is not Even gives that side 10-9. All Even → **10-10** ("a drawn round is scored 10 for both fighters"). |
| KO or TKO | 10-7 (§15.3.1) |

Then the sheet's deductions for that round (§15.3.2, p.25 "Point Deductions"):

- **Yellow card**: −1 for each card (§13.2).
- **Loss of weapon**: losing the weapon 3 or more times in one round is **one** −1 for that round (§14.1, p.25).
- **Armour failure**: −1 for each 90 seconds granted for the repair (§14.4, p.25): fixed within 90 s → −1; a further 90 s granted → −1 more;
  not fixed after that → the opponent wins by TKO armour/weapon failure.
- Weapon breakage replaced: no penalty (§14.2). Shield breakage removed or replaced: no penalty (§14.3).
- Example (§15.3.3): an even round, B has one armour failure fixed in time → A 10, B 9.

The sheet's fight result is the sum of its rounds (the p.25 "Fight Result").

### 3.3 Round Score, Total Fight Score, win types (§15.3.1, §15.4)

- **Round Score** = (sum of the marshals' round scores) ÷ (number of marshals) (§15.3.1). Kept exactly (e.g. 9.667), never rounded for
  the decision.
- **Total Fight Score** = sum of the Round Scores; it declares the winner of the match (§15.4.1). Expected ranges: tournaments 14-20,
  matched fights 21-30 (shown as a check, never enforced, because deductions can go below).
- **Win types** (§15.4.2), from each marshal's own fight result: unanimous decision; unanimous draw; majority decision (the majority for
  one side, the others a draw); majority draw (the majority a draw); split decision (the majority for one side, the others for the other
  side); split draw (all different, the totals a draw); TKO; KO.

### 3.4 The fight (§4, §5, §6, §11, §13, §14)

| § | Rule | In BuhurtOS |
|---|---|---|
| 4.1 | Matched fight: Division 1 = 3 rounds of 120 s, 2 breaks of 60 s; Division 2 = 3 rounds of 90 s, 2 breaks of 60 s | Competition **format = Matched fight** and **Division 1/2** set the clock and the round count. |
| 4.2 | Tournament fight: Division 1 = 2 rounds of 120 s, 1 break of 45 s; Division 2 = 2 rounds of 90 s, 1 break of 45 s; a draw after 2 rounds → a 3rd round, same length | **Format = Tournament.** Level Total Fight Score after round 2 → the tablet offers ROUND 3 only (no finish). |
| 1.3 | Division 1 (over 2 years' experience or international experience); Division 2 (under 2 years); Division 2 fighters may choose Division 1 | `competitions.division` (`'1'`/`'2'`, already on hosted). A Profight fight cannot open while its competition has no division set. |
| 13.1 | 3 verbal warnings → yellow card. Verbal warnings need not be recorded. | Warnings are tallied on the tablet; the 3rd for the same competitor or corner man prompts the yellow card. |
| 13.2 | Yellow card to a competitor or corner man; recorded in the protocol; counts in the score | Card on the tablet → −1 on every marshal's sheet for that round. |
| 13.3 | Corner man expelled: noted, no effect on the score | A protocol note. |
| 13.4 | Red card = disqualification; automatic on a second yellow; or for disruption | The second yellow records the red card and ends the fight by DQ. |
| 14.8 | TKO for lack of defence: warning, 5-second count, stop. Division 1: loses the **match**. Division 2: loses the **round**. Every TKO is checked by the medic. | TKO on the tablet: Division 1 ends the fight; Division 2 scores the round 10-7 and the fight goes on. Either way the fighter is marked "medic check needed" before their next fight. |
| 11.4 | Stalling after Break/Hold: warning, 5-second count, then TKO win to the opponent | Finish reason "TKO (stalling)". |
| 14.4, 14.2 | Armour not fixed after 90 + 90 s, or a weapon that cannot be replaced → TKO armour/weapon failure | The 90 s repair clock; at expiry the tablet offers "+90 s (−1)" or "TKO armour/weapon failure". |
| 14.10 | DQ for no weapon / unrepairable armour: until their next match to fix it, or out of the tournament. DQ also = red card. | Finish reason, and a hold on the fighter's next match until marked fixed. |
| 14.11 | KO: the fighter takes no further part in the tournament | Finish reason; the fighter's later matches in that competition are withdrawn (through the existing withdrawal path). |
| 5.2, 6.2 | Competitor yields or forfeits; corner man throws the towel (TKO, TKO armour/weapon failure, medical retirement); each needs an assessment before continuing | Finish reasons, each marking "assessment needed" (medic and head marshal) before the next fight. |
| 14.5, 14.7 | Clinch: Break after 10 s inactive. Grounded: up to 30 s of consistent action, Break after 10 s inactivity | Optional knight-marshal stopwatches on the tablet. They never score. |

### 3.5 After the fight (§16, §17, §1.2)

| § | Rule | In BuhurtOS |
|---|---|---|
| 16.1-16.3 | Written appeal by the competitor at the end of the fight (before leaving the list), or by the corner men in person within 15 minutes | "Appeal" on the result, timestamped, with the 15-minute window shown. |
| 16.4 | Outcomes: a rematch of the round; imposing or withdrawing cards; imposing or withdrawing a point deduction | The decided appeal applies its outcome through the existing correction path. A round rematch supersedes that round's sheets (kept, never deleted) and re-opens the round. |
| 16.5 | Further appeal to the BI Control and Disciplinary Committee or the head of the BI Marshals' Committee | Recorded as a note. |
| 17 | League ranking: win/loss record, compared within the active weight category; no fight for 1 year → "retired"; 2 years → removed from the standings | A Profight ranking by weight class with W/L (synthetic records excluded). Retired after 1 year, hidden after 2. This is a ranking view only: no fight is deleted. |
| 1.2 | Weight classes (men 6, women 5); open weight by agreement with no weight modifier; weigh-in up to 24 h before, one more attempt allowed | `ref_weight_classes` and `competitions.weight_class` (on hosted); weigh-ins already exist (Pack 16). |

## 4. Design

### 4.1 Database (one additive migration, written against the reconciled hosted definitions)

- `competitions.fight_format text check (fight_format in ('tournament','matched'))`, required for Profight before a fight opens.
- `private.outrance_timing(competition)` returns round seconds, break seconds, the round count (§4).
- `lyst_matches.scoring text default 'marshal'`; `'outrance'` for Profight, so every Lyst function branches on it, never on the category.
- **Line-marshal seats.** Counter seats get `role = 'line_marshal'` for Outrance fights. A line marshal joins with the Counter QR and picks
  "Line marshal" (no side). 3 or 5 per fight.
- **Sheet entries.** Taps go through the existing tap journal (`counter_record` with idempotent ids), with an action kind:
  `strike`, `takedown`, `weapon_loss`, `armour_failure` and a side. Undo stays per tap.
- **The sheet.** `public.outrance_sheets (match_id, round_no, seat_id, rev, strikes_a, strikes_b, takedowns_a, takedowns_b, weapon_losses_a,
  weapon_losses_b, armour_a, armour_b, grappling, list_control, aggression, defence, result_a, result_b, deduct_a, deduct_b, score_a,
  score_b, submitted_at)`. The totals are computed **by the server** from the journal (a phone cannot post numbers). The criteria are the
  marshal's own choices, asked only when the strike difference is 5 or less. Submitted sheets are append-only by revision.
- **The round.** `public.outrance_rounds (match_id, round_no, rev, marshals, score_a numeric(6,3), score_b numeric(6,3), method)`, written
  by the confirm function. `lyst_rounds.awarded_a/b` keep the rounded value so existing screens still show a number.
- **Protocol.** `match_discipline` gains Outrance kinds: `verbal_warning`, `yellow`, `red`, `armour_grant` (each 90 s granted), and
  `corner_expelled` (note). A yellow or armour grant applies −1 on every sheet of that round. The second active yellow records the red card.
- **Functions** (all `security definer`, empty `search_path`; revoked from `public` and `anon`):
  - `lyst_open`: Profight → `scoring = 'outrance'`, Outrance timing; refuses while division or format is missing.
  - `outrance_submit_sheet(p_command, p_seat, p_round, p_criteria jsonb)` for the phone (`bos_event_device`): reads its own journal,
    computes the sheet, refuses criteria when the difference is over 5 and requires them when it is 5 or less.
  - `outrance_confirm_round(p_command, p_match, p_round, p_expected_rev, p_reason)` for the secretary or marshal: needs exactly 3 or 5
    submitted sheets; computes the Round Score (§15.3.1); same command-id, stale-revision, secretary-boundary and delivery-review rules as
    `lyst_confirm_round`.
  - `outrance_finish(...)`: decision (winner from the Total Fight Score, §15.4.1; win type, §15.4.2), KO, TKO (with its kind), DQ, yield,
    medical retirement. A tournament fight level after 2 rounds is refused until round 3 is fought (§4.2).
  - `private.outrance_win_type(sheet totals)`.
- **Permissions.** Phones: only the sheet functions they need, added to `supabase/tests/device_allowlist.txt` in the same change.
- **In flight.** The migration opens Lyst state for any Profight fight that is active or on deck with a field, and re-seats the bound
  phones (none on hosted today).

### 4.2 Line-marshal phone (one-handed)

- Two big buttons: **RED STRIKE** and **BLUE STRIKE** (in the day's side colours). A smaller row: Red takedown, Blue takedown, Red weapon
  lost, Blue weapon lost, Armour failure (Red/Blue). UNDO undoes the last tap.
- Reminder line: "Clean legal strikes only. Head strikes don't count."
- At the end of the round: the phone shows the marshal's own totals. If the difference is 5 or less, it asks the four criteria in order,
  one screen each (Red / Even / Blue), stopping at the first that is not Even. Then SUBMIT SHEET.
- It never shows another marshal's sheet, the Round Score or the running Total Fight Score (§2.3).

### 4.3 Secretary / Lyst tablet

- `FieldPage` sends Profight to `LystScoring` (the classic board stays one tap away, as for duels).
- Round zone: "3 of 3 sheets in" (or 5), each sheet's result (e.g. "M1 10-9 Slight Red · M2 10-9 Even/grappling Red · M3 10-10"), the
  cards and deductions for the round, the Round Score ("Red 10 · Blue 9.333"), CONFIRM ROUND, RETURN FOR RECOUNT.
- Knight marshal bar: Verbal warning, Yellow, Armour failure (starts 90 s), +90 s, Weapon broken (replace / TKO), KO, TKO, Stop.
- Finish shows the Total Fight Score, the win type, and each marshal's total.

### 4.4 TypeScript

- `src/lib/outrance.ts` (pure): `sheetRound(strikes, criteria, deductions)`, `roundScore(sheets)`, `totalFightScore(rounds)`, `winType(sheets)`,
  `timing(division, format)`, `weaponLossDeduction(losses)`, `armourDeduction(grants)`. The same vectors are checked in SQL
  (`vectors_gate.sql` pattern), so the phone, the tablet and the database cannot disagree.
- The classic `ProBoard` is changed to the same per-sheet rules (criteria in priority order) so it never gives a different number.

## 5. Verification

- Unit: every band edge (5/6, 10/11, 15/16), criteria stopping at the first non-Even, all-Even 10-10, the §15.3.3 example, 3 weapon losses
  = −1 (and 4 still −1), each 90 s grant −1, averages over 3 and 5 sheets, all six decision/draw win types, Division 1 and 2 TKO.
- Database gate `pack29_outrance_gate.sql`: allowed and denied cases for every function (phone, secretary on and off the board, marshal,
  fighter, other-event organizer, anon); a phone cannot post totals or see another sheet; 2 or 4 sheets cannot confirm a round; a
  tournament draw after 2 rounds cannot finish; a round rematch keeps the old sheets; synthetic events stay out of the ranking; the
  in-flight backfill.
- Fingerprint and device allow-list regenerated in the same change.
- Browser, real local stack, phone 390 px and desktop: a Division 2 tournament fight with 3 phones, level after 2 rounds → round 3; a
  weapon lost 3 times; an armour failure with +90 s; finish by split decision. A Division 1 TKO and a Division 2 TKO. Screenshots in
  `docs/reviews/assets/`.
- Hosted: applied only when the owner asks; then the read-only checks and a signed-in walk on a synthetic event.

## 6. What the rules decide that the earlier plan got wrong

- One counter per side and the secretary acting as marshal: replaced by 3 or 5 line marshals (§2.3, §15.1.1).
- One "other criteria" call per round: replaced by each marshal's own criteria in priority order (§15.2, p.25).
- Weapon losses and armour failures on the tablet only: each marshal notes them on their sheet (§2.3, p.25).
- "Keep adding tiebreak rounds": the rules give one 3rd round for a tournament draw (§4.2); what happens after that is not written (§7).

## 7. Gaps in the rules (for the owner or the head marshal; nothing here is invented by the app)

1. **A tournament fight still level after round 3.** §4.2 gives a 3rd round only. The app records the draw and asks the head marshal
   (§2.1) to record a decision with a reason, which is kept with the result. Is there a rule to apply instead?
2. **Total Fight Score vs the marshals' majority.** With averaging, the side with the higher Total Fight Score (which "declares the winner",
   §15.4.1) can differ from the side most marshals scored (§15.4.2). The app follows §15.4.1 for the winner and reports the win type from
   the sheets. Confirm.
3. **Whose count of weapon losses and armour failures applies.** The sheet (p.25) has them per marshal, so marshals could disagree. Plan:
   each sheet uses its own weapon-loss count (§2.3 "take note"); armour grants and yellow cards come from the protocol (the timekeeper
   counts repair time, §2.4; the secretary records cards, §2.5) and apply to every sheet. Confirm.
4. **A Division 2 TKO in the last round.** The round is lost (10-7) and, the rounds being over, the fight ends on the Total Fight Score.
   Confirm.
5. **A line-marshal phone fails mid-fight.** The rules need 3 or 5 marshals. Plan: the round waits until the marshal is back (another
   phone can take over their seat with the existing handoff); the head marshal may confirm with fewer, with a reason, and the result is
   marked "not 3 or 5 line marshals". Confirm.

## 8. Order of work

0. Repository level with hosted (done).
1. `src/lib/outrance.ts` + SQL vectors.
2. Migration: settings, seats, sheets, protocol kinds, functions, permissions, backfill; gate.
3. Line-marshal phone.
4. Secretary/Lyst tablet: round zone, knight-marshal bar, finish, appeals; FieldPage routing.
5. Competition setup (division, format, weight class); Profight ranking by weight class (§17).
6. Browser verification on the local stack; docs and status; PR.
