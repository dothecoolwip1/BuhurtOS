# Rules library: how official rules get into BuhurtOS

BuhurtOS shows rules **exactly as the governing body published them**, traceable to the document, version and page.
Nobody types rules in by hand, and no rule text lives in React components. Text reaches the database only through the
reproducible pipeline below (`scripts/rules/`). Each step writes files you can review and commit.

The governing body remains the authority. BuhurtOS is not a governing body and does not author rules.

## Layout

```
rules-library/
  buhurt-international/
    snapshots/<date>-rules-page.html.gz   saved copy of https://www.buhurtinternational.com/rules (evidence for the inventory)
    source-inventory.json                 GENERATED from the snapshot: every document the page links to (committee, heading, URL, file id)
    classification.json                   BuhurtOS-authored, NOT official: kind / formats / relevance per document, for filtering
    releases/<release>/                   one import of a set of official files
      release.json                        governing body, release name, documents deliberately excluded (each with a reason)
      sources/<doc>.pdf                   the official files (NOT committed: identified by checksum in fetch-log.json)
      fetch-log.json                      where each file came from, when, its sha256 and size; or who supplied it
      text/<doc>.json                     pdftotext output, one entry per page, with pdfinfo
      overrides/<doc>.json                a PERSON's decisions: confirmed version label/date, per-provision review, BuhurtOS search words
      structured/<doc>.json               GENERATED provisions (number, title, text, pages, parent, review state) + per-document reconciliation
      reconciliation.json / .md           GENERATED release reconciliation: every inventory document imported or excluded with a reason
  _example-body/                          INVENTED test documents (not real rules) used by the tests, the database gate and the browser tests
```

## Updating when Buhurt International publishes new documents

Run every command from the repository root. The examples use release name `2026-11`.

1. **Re-take the inventory.** Save https://www.buhurtinternational.com/rules as HTML, gzip it into `snapshots/`, then run:
   ```
   node scripts/rules/inventory-cli.ts rules-library/buhurt-international/snapshots/<date>-rules-page.html.gz <date> "<who saved it>" \
     > rules-library/buhurt-international/source-inventory.json
   ```
   Review the diff. New documents must also be added to `classification.json`; a test fails until they are.
   Documents that disappeared are not deleted. The next import marks them "no longer listed".
2. **Create the release.** Write `releases/2026-11/release.json` with `{ "release": "2026-11", "governing_body": "Buhurt International", "excluded": [] }`.
   List any document you deliberately do not import (archive folders are excluded automatically), each with a real reason.
   Example: an image-only chart that stays a link.
3. **Get the files.** Use `node scripts/rules/release.ts fetch rules-library/buhurt-international 2026-11`.
   This needs network access to `www.buhurtinternational.com` and `drive.usercontent.google.com`. A changed file is never overwritten: it is saved
   beside the old one and reported. If you obtained a file another way, run
   `node scripts/rules/release.ts register rules-library/buhurt-international 2026-11 <inventory-key> <file.pdf> "<who supplied it>"`.
4. **Extract**: `node scripts/rules/release.ts extract rules-library/buhurt-international 2026-11` (needs `pdftotext` / `pdfinfo`, poppler-utils).
5. **Structure**: `node scripts/rules/release.ts structure rules-library/buhurt-international 2026-11`.
   The first run writes `overrides/<doc>.json` with the version and date it detected. A person must open each official PDF and:
   - confirm or fix `version` and `published_on`, then set `version_confirmed_by` and `confirmed_on`;
   - review every provision marked `needs_review`: text before the first heading, tables, skipped numbers, numbers printed twice, pages without
     text. Record each review under `review` with `"status": "verified"` and a note;
   - optionally add BuhurtOS search words under `keywords` (words people type that the text does not use).

   Re-run `structure` until every document says `ok`. Never edit `structured/` by hand. If the extraction is wrong, fix `scripts/rules/structure.ts`
   (with a test), or leave the provision `needs_review` with a note.
6. **Reconcile**: `node scripts/rules/release.ts reconcile rules-library/buhurt-international 2026-11`. It must say PASSED: every inventory document is
   imported or excluded, no file is imported twice, every document's lines are accounted for, and character coverage is at least 98%.
7. **Generate the migration**: `node scripts/rules/release.ts sql rules-library/buhurt-international 2026-11 supabase/migrations/<timestamp>_rules_bi_2026_11.sql`.
   It refuses if the release does not reconcile. With `--draft`, it stores owner-only drafts that can never be published.
8. **Verify locally**: `supabase/tests/run_all.sh` (and update the schema fingerprint if needed). Load the migration into a scratch database and
   look at it in the app as the owner.
9. **Publish**: after the migration is applied, the platform owner calls `publish_ruleset_version(<version id>, <note>)` for each version.
   Publishing refuses while any provision still needs review. The previous version becomes *superseded*: it stays readable, and every competition
   and disciplinary record that points at it keeps its meaning.

## Guarantees enforced by the database (migration `20261015000100_pack22_rules_library.sql`)

- A published version's text, title, version label, file checksum and pages never change. A changed official file is a **new version**.
- Corrections of extraction mistakes go through `correct_rule_provision` with a reason; the old words stay in `rule_provision_revisions`.
- A published version is never deleted. It can be superseded or withdrawn (with a reason).
- Drafts and versions in review are visible to the platform owner only.
- Conflicts between official documents are recorded (`note_rule_conflict`) and resolved only by citing the source. BuhurtOS never decides between them.
- A finished competition keeps the ruleset version it was fought under.
