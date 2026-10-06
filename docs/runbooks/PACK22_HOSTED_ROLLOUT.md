# Pack 22 hosted rollout (NOT performed)

Project `mvbxlebznlgroptwwdsm`. Nothing below has been done. Apply only when the owner asks.

## Order

1. Confirm hosted already has `club_membership_dues_voting` and `club_fee_waiver_and_agm` (it did on 2026-10-06). Pack 22 does not depend on them,
   but its migration versions follow them.
2. Apply `supabase/migrations/20261015000100_pack22_rules_library.sql`. It is additive:
   - new columns on `rulesets` / `ruleset_versions`;
   - four new tables;
   - functions and triggers;
   - one RESTRICTIVE select policy on `ruleset_versions`;
   - `revoke select` + column grants on `ruleset_versions` (hides `published_by`).

   The importer function body contains a `delete` limited to unpublished provisions. If the hosted migration tool cancels statements containing
   DELETE (as it once did for Pack 02), run the file in the SQL Editor instead.
3. Apply `supabase/migrations/20261015000200_pack22_bi_document_inventory.sql`. Data only: the 45 Buhurt International directory entries and one
   `sources` row. It is safe to re-run (it reports "unchanged").

## Read-only checks afterwards

- `select count(*) from rulesets where governing_body = 'Buhurt International'` → 45. The same filter excluding `source_host = 'drive_folder'` → 42.
- As anon: `select published_by from ruleset_versions` → permission denied. `select set_by from match_discipline_rules` → permission denied.
- `has_function_privilege('anon', 'public.lyst_cite_rule(uuid,uuid,uuid)', 'execute')` → false. The same for `event_discipline_log`,
  `publish_ruleset_version` and the other owner functions.
- Advisors: expect only the existing accepted class "authenticated can execute SECURITY DEFINER" for the new functions (each checks its role inside).

## Live checks (a phone)

- `/rules` lists the four committees (8 / 6 / 5 / 23) and says the official text is not imported yet. Every document opens its official link.
- Summaries still search.
- The Lyst screen shows a "Rules" button. With no imported text it says so, and the marshal's call shows no rule step.
- Command Centre › "Cards and penalties" opens for the organizer and head marshal. A stranger is refused.

## Importing the official text later

Follow `rules-library/README.md`. The generated migration loads versions "in review". The owner then publishes each one with
`publish_ruleset_version`.
