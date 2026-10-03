# Pack 01: security and data safety

## Goal

Close the proven permission and data-safety holes without deleting the test accounts or changing the Supabase plan.

## Scope

This pack covers:

- team-management permission boundaries
- event-role scope and expiry
- synthetic-data identification
- protection against synthetic data contaminating official aggregates
- a practical pre-event export runbook

It does not redesign auth, delete test accounts, create a separate QA backend or upgrade Supabase.

## Required behaviour

### Team authority

Implement and verify these rules in the database:

- Platform administrators may approve, merge and delete or retire teams platform-wide as allowed by the domain model.
- Organization administrators may manage teams within the organization they administer.
- Event organizers do not gain platform-wide team management powers merely by organizing any event.
- Event organizers may add organizers and other event roles only within events they are authorized to manage.
- Event-specific roles expire shortly after the event finishes or become inactive through an explicit event-lifecycle rule. Choose the smallest robust implementation that fits the current schema.

Do not rely on client-side hiding for any of these boundaries.

### Test accounts

Keep the existing `@buhurtos.ca` test accounts for now.

Do not special-case them with hidden superpowers.

After permission scoping, test organizer accounts should naturally lose platform-wide destructive team powers unless they also hold the proper platform or organization role.

### Synthetic records

Use the existing machine-readable fictional-source marker.

Synthetic records may remain visible, but:

- clearly label them Test or Fictional in public and administrative surfaces where confusion is possible
- exclude them from official rankings, official historical aggregates and official statistics
- do not infer test status only from names ending in `-test`
- preserve provenance rather than deleting the source marker

Do not delete the synthetic dataset in this pack.

### Recovery runbook

The owner chose to remain on Supabase Free and take one full independent export before the Rumble.

Create a documented, reproducible export procedure that:

- can export the production schema and data independently of Supabase platform backups
- records the date, project, migration head and integrity/checksum information where practical
- includes a restore rehearsal procedure against a disposable/local database
- instructs the owner to store the final pre-event export in at least two locations separate from Supabase

Do not silently perform the owner's one final pre-event export weeks early and call that obligation complete. The runbook should make the actual pre-event export obvious and repeatable.

## Investigation requirement

Before editing, identify every function, grant, RLS policy, view and client path involved in:

- team approval
- team merge
- team deletion or retirement
- event-role assignment
- event organizer assignment
- public synthetic-data queries
- rankings or statistics that can ingest published test results

Use the review as a lead, not as a substitute for fresh inspection.

## Required tests

At minimum, prove:

1. A platform admin can perform intended platform-wide team operations.
2. An organization admin can perform intended operations only for their organization.
3. An event organizer cannot merge or delete an unrelated real team.
4. An event organizer can add an organizer only to an event they control.
5. An unauthorized signed-in user cannot gain those powers by direct RPC or table calls.
6. The existing test organizer account cannot use its event-organizer status to alter unrelated real teams.
7. Synthetic results do not contribute to official ranking/statistical queries.
8. Synthetic public records are visibly labelled wherever they remain visible.

Use direct database/RPC tests for permission checks. Do not prove security only through the UI.

## Acceptance criteria

- The platform-wide organizer team vulnerability is gone.
- The test accounts still exist.
- Event roles are scoped and have a lifecycle/expiry mechanism.
- Synthetic data remains available for testing but cannot masquerade as real official data.
- A restore-oriented export runbook exists.
- Existing legitimate event workflows still function.

## Handoff

Report separately:

- repository changes
- migration(s)
- hosted database changes actually applied
- role/RLS tests and results
- synthetic-data query changes
- export/restore runbook path
- live/deployed verification, if any
- commit SHA

Update STATUS.md and continue to Pack 02.
