# Pack 29: Outrance (Profight) on the Lyst, to Outrance Rules and Regulations V.26.4

Status: PLAN (2026-10-29). Nothing in this pack is built yet. Step 0 (bringing the repository level with hosted) is done in the same change
as this plan: `supabase/migrations/20261108000100_hosted_reconcile_2026_10_29.sql`.

Source: *Outrance Rules and Regulations V.26.4* (April 2026), owner's copy in Drive. Section numbers below (§) are that document's.

## 1. Where things stand (main `36850b2` = Vercel production = hosted database after Step 0)

- Profight fights never open on the Lyst. `FieldPage.tsx` sends only duels to `LystScoring`; Profight gets the classic `ProBoard`, which never
  calls `lyst_open` and never starts the Lyst clock. So a field's current fight is never set for a Profight fight, and a counter phone on that
  Lyst waits ("Waiting for the next fight on this Lyst") for the whole fight.
- `ProBoard` is one person's sheet: strike points and deductions for both sides, `proRoundScore` gives 10-10 / 10-9 / 10-8 / 10-7 for that one
  sheet ("Fight total, this marshal"), and the saved result is that one sheet. Nothing averages line marshals, nothing records the decision type.
- Weapon losses, the armour-failure clock, cards in Profight, KO/TKO, Division 1/2 timings and the tournament third round are not modelled.
- Hosted has no Profight fights in progress (three Profight competitions, no fights drawn), so the in-flight backfill is small, but it is still
  written (CLAUDE.md: every change carries in-flight state).

## 2. Owner decisions (2026-10-29)

1. **Hosted wins** for the repository/hosted drift (Step 0).
2. **The official round score is the average of the 10-point cards** (§15.3.1). This is a deliberate, Outrance-only exception to the Pack 13 rule
   "nothing averages counters": raw strike taps are still never averaged or summed into a score; what is averaged is each card's 10-point
   result, as the rules require.
3. **One counter per side stays.** The server pairs a red phone with a blue phone into one card (red counter n with blue counter n). In most
   fights there is one pair, and **the secretary tablet acts as the marshal** (it makes the calls the counters cannot: other criteria,
   deductions, KO/TKO, confirm).
4. **Score columns stay whole numbers.** `matches.score_a/score_b` hold the rounded totals for display and sorting; the exact averages, every
   card and the decision type go in the result detail.

## 3. The rules this pack must implement

| § | Rule | Where it lands |
|---|---|---|
| 4.1, 4.2 | Tournament: 2 rounds, 1 break of 45 s, a 3rd round if level. Matched fight: 3 rounds, 2 breaks of 60 s. Division 1 rounds 120 s, Division 2 rounds 90 s. Tiebreaker round same length. | Competition settings, then Lyst timer presets and round count |
| 1.3 | Division 1 / Division 2 | `competitions.division` already allows `'1'`, `'2'`, `'open'` on hosted |
| 15.2.1 | One strike point per clean legal strike with weapon, leg, arm or shield. Head strikes score nothing. | Counter phone wording (one COUNT button per side) |
| 15.3.1 | Each card scores the round; strike gap 0-5 → 10-10, or 10-9 if other criteria decide; 6-10 → 10-9; 11-15 → 10-8; 16+ → 10-7. KO and TKO → 10-7. Round score = average of the cards. | Server: per-card band, then average |
| 15.2.2-15.2.5 | Other criteria in order: grappling, list control, aggression, defence | One call per round on the tablet, used only for cards with a gap of 5 or less |
| 15.3.2, 13.2 | Yellow card −1, armour failure −1 each instance, weapon-loss penalty −1. Deducted from the round score. | Applied once to the averaged round score |
| 14.1 | Losing the weapon 3 or more times in one round: −1 | Weapon-loss taps on the tablet; the 3rd loss in a round makes the deduction |
| 14.4 | Armour failure: −1 if fixed in 90 s; a further 90 s may be granted for another −1; not fixed → TKO armour/weapon failure | Armour-failure button: 90 s equipment clock, "+90 s" (second −1), expiry offers TKO |
| 14.2, 14.3 | Weapon or shield breakage replaced: no penalty; weapon not replaceable → TKO armour/weapon failure | Finish reason |
| 13.1, 13.4 | 3 verbal warnings → yellow card; 2nd yellow → red = disqualification | Existing discipline sheet with Outrance rules |
| 14.8 | TKO for lack of defence: Division 1 loses the fight; Division 2 loses the round (10-7) | Tablet: "TKO" asks round or fight by division |
| 14.11 | KO ends the fight; the fighter cannot continue in the tournament | Finish reason; withdrawal from later fights |
| 15.4.1 | Total fight score = sum of the round scores; tournaments total between 14 and 20, matched fights between 21 and 30 | Server totals; sanity check |
| 15.4.2 | Unanimous / majority / split decision; unanimous / majority / split draw; TKO; KO | Computed from the per-card fight totals, stored in the detail |
| 17 | League ranking: win/loss record by weight class | Uses `competitions.weight_class` / `ref_weight_classes` (already on hosted) |

## 4. Design

### 4.1 Database (one additive migration, `2026110900xx_pack29_outrance.sql`, written against the reconciled hosted definitions)

- `competitions.fight_format text not null default 'tournament' check (fight_format in ('tournament','matched'))`. Division stays
  `competitions.division` (`'1'`, `'2'`, `'open'`; for Profight `'open'` is treated as Division 1 until set).
- `private.outrance_timing(competition)` returns round seconds, break seconds, regular rounds (2 or 3), tiebreak allowed.
- `lyst_matches.counter_input` stays `simple` for Profight (one COUNT per side). A new `lyst_matches.scoring text default 'marshal'`, with
  `'outrance'` for Profight, so every Lyst function can branch without guessing from the category.
- **Cards.** `public.lyst_outrance_cards (match_id, round_no, rev, card_no, seat_a, seat_b, strikes_a, strikes_b, gap_band, criteria,
  card_a numeric, card_b numeric)`, written only by the confirm function, frozen with the round revision. Pairing: the official seats on each
  side in seat order; red n with blue n; an unpaired phone stays evidence only. The tablet may re-pair before confirming (recorded).
- **Round result.** `public.lyst_outrance_rounds (match_id, round_no, rev, criteria, cards int, exact_a numeric(6,3), exact_b numeric(6,3),
  deduct_a, deduct_b, weapon_losses_a, weapon_losses_b, method)`, append-only by revision like `lyst_round_revisions`.
  `lyst_rounds.awarded_a/b` keep the rounded value so every existing reader (Live, broadcast, announcer, Discord) still shows a number.
- **Weapon losses.** A new discipline kind `weapon_loss` (amount 0) in `match_discipline`; the 3rd active one in a round on a side inserts
  the −1 deduction automatically, voiding one undoes it.
- **Armour failure.** Discipline kind `armour_failure` (−1), plus `armour_failure_extended` (−1); both start the existing `equipment` timer
  mode with 90 s.
- **Functions.**
  - `lyst_open`: Profight sets `scoring = 'outrance'` and uses the Outrance timing.
  - `lyst_confirm_outrance_round(p_command, p_match, p_round, p_expected_rev, p_pairs jsonb, p_criteria text, p_method text, p_reason text)`:
    reads the frozen counter totals itself (never trusts numbers from the client), builds the cards, averages them, applies the round's
    deductions once, writes the round revision; the same command id, stale revision, secretary-boundary and delivery-review rules as
    `lyst_confirm_round`. No pair at all → the tablet enters the strike points itself (the marshal's own card).
  - `lyst_finalize` for Outrance: the winner comes from the exact totals; level in an elimination fight → another round (no draw);
    KO / TKO / DQ / armour-failure TKO as finish bases; the detail stores rounds, cards, exact totals and the decision type;
    `score_a/score_b` = rounded exact totals.
  - `private.outrance_decision(cards)` → `unanimous` | `majority` | `split` decision or draw.
- **Permissions.** Every new function: `security definer`, empty `search_path`, revoked from `public`/`anon`, granted to `authenticated`
  only (the counter phones keep using `counter_record`; nothing new for `bos_event_device`). Regenerate `supabase/tests/device_allowlist.txt`.
- **In flight.** The migration opens Lyst state for any Profight fight that is active/on deck with a field (`lyst_matches` row with
  `scoring = 'outrance'`, field current fight if the field has none), and rebinds the field's counter phones on it. A fight already scored
  on the classic board keeps its saved board; its rounds are carried in as confirmed Outrance rounds with the reason "carried from the
  classic board" (none exist on hosted today; the code path is still written and tested).

### 4.2 Counter phone

- Profight: one big COUNT button for the side's fighter, UNDO, round confirm as today. Banner: "Tap COUNT for every clean strike by
  <fighter>. Head strikes don't count."
- A phone never shows another phone's number (line-marshal independence, §2.3). Check `counter_state` for this and pin it with a test.

### 4.3 Lyst tablet (secretary acting as marshal)

- `FieldPage` sends Profight to `LystScoring` like duels (classic board stays one tap away, as for duels).
- The round zone for Outrance replaces the 0-9 picker:
  - each card: "Card 1 · Red Anna 23 · Blue Ben 14 · gap 9 → 10-9 Red";
  - if any card's gap is 5 or less: one choice "Other criteria: Red / Even / Blue" (grappling, list control, aggression, defence);
  - this round's deductions per side (cards, armour failure, weapon losses: tap WEAPON LOST, the counter shows 1, 2, 3 → −1);
  - the round score: the average, e.g. "Round 1: 9.67 – 10" (two decimals only when cards disagree);
  - CONFIRM ROUND. A correction later needs a reason (as now).
- Buttons on the clock bar: ARMOUR FAILURE (starts 90 s, −1), +90 s (another −1), and at expiry "TKO, armour failure?"
- Finish: by decision (with the decision type shown), KO, TKO (Division 1: the fight; Division 2: asks "this round only?"), DQ, armour or
  weapon failure TKO. Elimination + level after the regular rounds → START ROUND 3 (tiebreak), never a draw.
- Mobile-first, one-handed: every action is one tap from the round zone; nothing needs drag and drop.

### 4.4 Front end (TypeScript)

- `src/lib/outrance.ts` (pure, unit-tested): `cardBand(strikesA, strikesB, criteria)`, `averageCards(cards)`, `roundScore(cards, deductions)`,
  `fightTotals(rounds)`, `decisionType(cardTotals)`, `outranceTiming(division, format)`. The same table of vectors is run in SQL
  (`supabase/tests/vectors_gate.sql` pattern) so TypeScript and the database can never disagree.
- `proRoundScore` (classic board) reuses `cardBand`, so the classic board and the Lyst give the same number.
- Competition setup: Division 1 / 2 and Tournament / Matched fight for Profight competitions.

## 5. Verification (what "done" means)

- Unit: band edges (5/6, 10/11, 15/16), other criteria only at gap 5 or less, averaging of 1, 2, 3 and 5 cards, deductions after averaging,
  3rd weapon loss, decision types (all six), totals 14-20 and 21-30.
- Database gate `pack29_outrance_gate.sql`: allowed and denied cases for every new function (fighter, other-event organizer, anon, device,
  secretary off the board refused; marshal and secretary on the board allowed); a client cannot pass its own strike numbers; a card is
  frozen with the round; one counter on one side only → evidence only; corrections keep the old revision; synthetic events stay out of
  rankings; the in-flight backfill opens an active Profight fight and seats its phones.
- Fingerprint and allow-list regenerated in the same change.
- Browser (real local stack, phone 390 px and desktop): a full Division 2 tournament fight with one red and one blue phone and the
  secretary tablet: two rounds, one level → round 3, a weapon loss ×3, an armour failure with +90 s, finish by decision; then a TKO in
  Division 1 and Division 2; screenshots in `docs/reviews/assets/`.
- Hosted: applied only when the owner asks; then the read-only checks (fingerprint against hosted, the new functions' grants) and a
  signed-in walk on a synthetic event.

## 6. Open questions for the owner

1. **Average vs majority.** §15.4.1 declares the winner by the total of the averaged round scores, while §15.4.2 names the decision type
   from the cards. With several cards these can point to different winners (two cards narrowly Red, one card heavily Blue). Plan: the
   averaged total decides the winner (§15.4.1) and the decision type is reported from the cards; if they disagree it is labelled a split
   decision. Confirm.
2. **Level after round 3 in elimination.** The rules allow "a tiebreaker round" but say nothing about a second one. Plan: keep adding
   tiebreak rounds of the same length until the fight is not level; the head marshal can also decide with a reason.
3. **Matched fights** (§4.1): are they run as a competition of their own (one fight each), or as single fights inside an event? Plan: a
   Profight competition with Format = Matched fight.

## 7. Order of work

0. Repository level with hosted (done in this change; see the migration header).
1. `src/lib/outrance.ts` + vectors (TS and SQL).
2. Migration: settings, tables, functions, permissions, backfill; gate.
3. Lyst tablet Outrance round zone, clock-bar buttons, finish; FieldPage routing.
4. Counter phone wording; competition setup fields.
5. Browser verification on the local stack; docs and status; PR.
