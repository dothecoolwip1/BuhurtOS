# Pack 22 hosted rollout (NOT performed)

Project `mvbxlebznlgroptwwdsm`. Nothing below has been done. Apply only when the owner asks, after the branch is merged.

## Order

Apply the files in this order (ten Pack 22 migrations). Every file is additive.

1. Confirm hosted already has `club_membership_dues_voting` and `club_fee_waiver_and_agm` (it did on 2026-10-06). Pack 22 does not depend on them,
   but its migration versions follow them.
2. `20261018000100_pack22_rules_library.sql`
   - new columns on `rulesets` / `ruleset_versions`;
   - four new tables;
   - functions and triggers;
   - one RESTRICTIVE select policy on `ruleset_versions`;
   - `revoke select` + column grants (hides `published_by`).

   The importer function body contains a `delete` limited to unpublished provisions. If the hosted migration tool cancels statements containing
   DELETE (as it once did for Pack 02), run the file in the SQL Editor instead.
3. `20261018000200_pack22_bi_document_inventory.sql`: data, the 45 directory entries and one `sources` row. Re-runnable ("unchanged").
4. `20261018000300_pack22_provision_layout.sql`: two provision columns, a content check that allows picture-only pages, and the guard and importer
   updated.
5. `20261018000400_rules_bi_2026_10_06.sql`: **about 950 KB of data**, the 42 Buhurt International versions **in review** with 1281 provisions.
   - The Supabase migration tool and MCP may reject a statement this large. If so, run it in the SQL Editor, or with `psql -f` against the
     connection string.
   - It is idempotent: a second run reports "unchanged" for every version.
6. `20261018000500_pack22_discipline.sql`: the discipline domain. It patches `private.readiness_rows` and the Pack 15 notification functions in place
   and asserts its anchors. If hosted has drifted from the repository in those functions, the migration **stops with an error** instead of
   guessing. Compare the function bodies with the repository first if that happens.
7. `20261018000600_pack22_bi_rule_conflicts.sql`: data, the three tier-points conflicts. Re-runnable.
8. `20261018000700_pack22_discipline_fixes.sql`: the fixes from the QA pass. It replaces discipline functions, adds three triggers (event
   suspension participants, delete guards on teams and fighters) and column grants (no `*_by` account ids by direct read), and corrects the BI
   event-appeal rule row.

9. `20261018000800_pack22_historical_versions.sql`: historical editions. Four columns on `ruleset_versions`, the version guard extended (a
   historical edition is never the version in force), the current importer refusing historical rows, `rules_import_historical_version`,
   `publish_historical_version`, and one extra field in `event_discipline_log`.
10. `20261018000900_rules_bi_history_archive_2026_10_06.sql`: **about 970 KB of data**, the 37 earlier editions **in review** (1357 provisions).
    Same size caveat as the current release's data file (SQL Editor or `psql -f` if the migration tool rejects it). Idempotent: a second run
    reports "unchanged".
11. `20261018001000_pack22_historical_qa_fixes.sql`: the QA fixes. Functions replaced only:
    - the version guard (historical editions only through the controlled functions);
    - both importers (duplicate checks);
    - `publish_historical_version` (no successor; keeps the edition's note);
    - the two competition guards and the two citation checks (an earlier edition can be neither a competition's ruleset nor cited).

## Read-only checks afterwards

- Documents:
  - `select count(*) from rulesets where governing_body = 'Buhurt International'` → 45. Excluding `source_host = 'drive_folder'` → 42.
  - `select status, count(*) from ruleset_versions v join rulesets r on r.id = v.ruleset_id where r.governing_body = 'Buhurt International' group by 1`
    → `in_review 42`.
  - `select count(*) from rule_provisions p join ruleset_versions v on v.id = p.ruleset_version_id where v.import_release = '2026-10-06'` → 1281.
    The same with `review_status = 'needs_review'` → 0.
- `select count(*) from rule_conflicts` → 3, all `open`.
- `select outcomes from discipline_review_rules where kind = 'event_appeal'` includes `point_deduction_imposed`.
- As an authenticated non-owner: `select issued_by from event_sanctions_private` → permission denied.
- `select key from discipline_card_types where governing_body = 'Buhurt International' order by sort` → verbal_warning, reprimand, yellow_card,
  red_card, green_card.
- As anon:
  - `select published_by from ruleset_versions` → permission denied;
  - `select count(*) from ruleset_versions` → 0 (nothing is published yet);
  - `select * from event_sanctions` / `discipline_suspensions` / `discipline_history` → permission denied or no rows.
- `has_function_privilege('anon', p.oid, 'execute')` is false for every Pack 22 write function:
  - `issue_event_sanction`, `issue_suspension`, `lodge_review`, `decide_review`;
  - `record_authenticity_finding`, `publish_ruleset_version`, `lyst_cite_rule`;
  - the others in those migrations.
- Advisors: expect only the existing accepted class "authenticated can execute SECURITY DEFINER" for the new functions (each checks its role inside).

- Historical editions: `select status, count(*) from ruleset_versions where historical group by 1` → `in_review 37`; and
  `select count(*) from ruleset_versions where not historical and status = 'published'` is unchanged by migrations 800/900 (0 before any publishing).
- As anon: `select count(*) from ruleset_versions where historical` → 0 (nothing in review is public).

## Publishing (the owner, after the checks)

Platform › Rules (`/platform/rules`) lists the 42 versions with their reconciliation. Open any of them first. Then use "Publish all 42 ready" (or
publish one at a time), and confirm. Published text is frozen; a later official file becomes a new version.

## Live checks (a phone)

- `/rules`:
  - lists the four committees (8 / 6 / 5 / 23);
  - after publishing, the quick questions work: "striking grounded fighter" (Buhurt Rules 4.12), "back of knee", "green card",
    "marshal accreditation";
  - Duel Regulations 3.2 shows a table; League Structure 3.3.2 shows its recorded conflict.
- Lyst screen: the "Rules" sheet finds a rule without leaving the fight. The event's card list can be set to "Buhurt International cards".
- `/events/<slug>/discipline`:
  - opens for the organizer and head marshal, and for the inspector on Authenticity;
  - is refused for a stranger;
  - every dangerous action asks twice.
- Check-in desk: a suspended fighter shows the block in plain words, with no check-in or override button.

## Earlier editions (historical), when the owner wants them public

Platform › Rules lists them apart under "Earlier editions (historical)". An edition with provisions still to check cannot be published (44 open
items across the 37 editions on 2026-10-06; see `rules-library/buhurt-international/history/archive-2026-10-06/reconciliation.md`). "Publish as
earlier edition" makes it readable as an older version; it never changes the version in force.
