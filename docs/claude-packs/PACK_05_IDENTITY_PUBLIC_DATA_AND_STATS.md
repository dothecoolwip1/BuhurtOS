# Pack 05: identity, public data and pre-Rumble product consistency

## Goal

Fix the known fighter-identity duplication problem and make the public/test/statistical presentation match the owner's decisions without expanding into the deferred full identity platform.

## Fighter account rule

The product rule is one account equals one fighter.

Model/enforce this carefully:

- one account may be linked to at most one claimed fighter
- one claimed fighter may be linked to at most one account
- fighter sporting records may exist without an account for historical, imported or organizer-created participants

Do not interpret the rule as requiring every historical fighter record to have a login.

## Stop avoidable duplicate creation

Inspect registration acceptance, team-join acceptance and every other path that creates/link fighters.

Where an account can be linked to an existing fighter, do not create a new duplicate automatically.

When identity is ambiguous:

- do not auto-merge
- create an administration-visible conflict/needs-review item or equivalent
- provide enough context for an administrator to decide which fighter record is correct
- preserve the source/provenance of both records until resolved

A sophisticated self-service claim/merge system is not required in this pack.

## Public synthetic labels

Verify the Pack 01 synthetic-data rules across the actual public experience:

- event cards/pages
- team pages
- fighter pages
- results
- rankings/statistics if exposed

The label should be obvious enough that a newcomer will not mistake fictional competition history for real sport history.

Do not hide all test data simply because it is test data. The owner chose visible, clearly labelled test data.

## Team history presentation

Where practical in current event/result views, support the owner's desired historical presentation:

- event-time team name/identity
- current team name/identity when different

Do not rewrite old results just to simplify rendering.

## Ranking direction

Do not build a new ranking engine before the Rumble.

Make sure current data and public copy do not imply that a future BuhurtOS statistical rating is an organization's official ranking.

Record the long-term direction in documentation:

- official organization rankings remain official
- BuhurtOS may later add a separate Elo-style statistical rating
- published ranking snapshots should be immutable once that system exists

## Deterministic spectator explanations

Where the current event UI explains a simple result, use deterministic rule/data templates.

Examples include:

- why a team won the round
- simple pool/bracket explanation
- basic score meaning

Do not call an LLM to decide factual sporting outcomes.

Keep this small. Do not turn it into a content-generation project.

## Team-near-me privacy direction

If team discovery is touched before the Rumble, use city/town, province/state or postal-code search and approximate public team locations.

Do not require precise GPS.

If this feature is not already in the pre-Rumble path, document the rule and do not expand scope merely to build it.

## Event stats

Make sure analytics added or retained in Pack 04 can distinguish synthetic/test traffic/data from real Rumble metrics where relevant.

The owner wants useful statistics from the Rumble. Preserve those metrics so they can inform post-event decisions about scaling, realtime and offline needs.

## Required tests

At minimum:

1. Registration acceptance does not create a duplicate fighter when a valid existing account/fighter link is available.
2. Team-join acceptance does not create an avoidable duplicate.
3. One account cannot claim two fighters through direct database/RPC calls.
4. One fighter cannot be claimed by two accounts.
5. Ambiguous identity creates admin intervention rather than silent auto-merge.
6. Synthetic public entities are visibly labelled.
7. Synthetic records are excluded from official aggregates.
8. Historical team display does not lose the event-time identity.

## Acceptance criteria

- Known duplicate-creation paths are fixed.
- Account/fighter uniqueness is enforced in the database.
- Ambiguous duplicates go to administrators.
- Public test history is unmistakably labelled.
- No new ranking engine is introduced.
- Public factual result explanations do not depend on LLM inference.

## Handoff

Report:

- identity constraints/functions changed
- migrations
- duplicate scenarios tested
- public pages checked
- analytics/statistics implications
- anything intentionally deferred
- commit SHA

Update STATUS.md and continue to Pack 06.
