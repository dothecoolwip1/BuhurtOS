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
      text/<doc>.json                     pdftotext output, one entry per page, with pdfinfo; OCR lines (with confidence, box, picture flags) for pages without text
      overrides/<doc>.json                reviewed decisions: confirmed version label/date, OCR fixes, noise, headings/tables, per-provision review, search words
      structured/<doc>.json               GENERATED provisions (number, title, text, pages, parent, review state) + per-document reconciliation
      reconciliation.json / .md           GENERATED release reconciliation: every inventory document imported or excluded with a reason
  _example-body/                          INVENTED test documents (not real rules) used by the tests, the database gate and the browser tests
  bi-source-drop/<date>/                  (branch pack22-bi-sources) the official PDFs as fetched, with SHA256SUMS.txt
```

## Current release: Buhurt International 2026-10-06

All 42 documents imported, 3 archive folders excluded, reconciliation PASSED (`releases/2026-10-06/reconciliation.md`; per-document table in
`docs/claude-packs/PACK_22_SOURCE_QA.md`). Loaded by migration `20261015000400_rules_bi_2026_10_06.sql` as versions **in review**; the platform owner
publishes them from Platform › Rules (`/platform/rules`).

The files came from the official links through a one-shot GitHub Actions workflow (provenance in `release.json` → `source_drop` and in
`fetch-log.json`), because this environment cannot reach the hosts. To re-run the release from the drop:
```
node scripts/rules/release.ts register-drop rules-library/buhurt-international 2026-10-06   # only if fetch-log.json is missing
node scripts/rules/release.ts extract   rules-library/buhurt-international 2026-10-06        # pdftotext + OCR (tesseract, pdftoppm) for pages without text
node scripts/rules/release.ts structure rules-library/buhurt-international 2026-10-06
node scripts/rules/release.ts reconcile rules-library/buhurt-international 2026-10-06
node scripts/rules/release.ts sql       rules-library/buhurt-international 2026-10-06 supabase/migrations/20261015000400_rules_bi_2026_10_06.sql
```
Structuring is reproducible from the committed `text/` and `overrides/`: a unit test re-structures every document of this release and compares it with
the committed `structured/` files. OCR output depends on the tesseract version (5.3.4 here), which is why `text/` is committed rather than regenerated
in CI. Set `OMP_THREAD_LIMIT=1` when OCR runs in parallel.

### Who checked what

The version labels, OCR corrections, table transcriptions, heading decisions and review notes were made by **Claude Code during the Pack 22 import, against
the page images of the official PDFs**, and are recorded with that attribution (`version_confirmed_by`, `review.reviewed_by`). Nothing becomes the rule
in force until the **platform owner publishes it**; publishing is the human act of acceptance, and the owner can open any version from Platform › Rules
first.

### Pages without a text layer (OCR)

`scripts/rules/ocr_page.py` renders the page at 300 dpi, reads it with tesseract (psm 4) and uses the image to decide what each line is:
- a small square first glyph followed by a gap is a bullet (filled ●, hollow ○);
- a strongly coloured band at the page edge with no dark ink is decoration and is dropped;
- lettering inside a picture (a very small line, faint words on a non-paper background, or no readable word) is set aside as page furniture with the
  reason, never presented as rule text. Reconciliation counts these lines (`picture_text_lines`).

Every OCR line keeps its confidence. Only genuinely uncertain lines are flagged for review; clear text is not.

### Overrides (reviewed decisions)

| Key | What it records |
| --- | --- |
| `version`, `published_on`, `note`, `version_confirmed_by`, `confirmed_on` | the label as printed and where it is printed |
| `ocr.fix` / `ocr.insert` | `"<page>:<line>"` → corrected text, each checked against the page image (diacritics, numbering, a line OCR missed) |
| `noise` | lines that are not text of the document (form labels on a scoring sheet, decorative lines) |
| `layout.headings` | `"<page>:<line>"` → `{title, kind}` for a printed heading without a number (keyed by its title; no number is invented) |
| `layout.tables` | `{replaces, rows, header_rows, note}`: a table transcribed as pipe rows. `^` = merged with the cell above, `<` = merged with the cell to the left, `<br>` = paragraph break in a cell. A word-multiset check refuses a transcription that adds or drops a word |
| `review` | per provision: `status`, `note`, `reviewed_by`, and `content_sha256` of the text reviewed. If the text changes later, the review is stale and the provision is back to `needs_review` |
| `keywords` | BuhurtOS search words (not official) |

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
4. **Extract**: `node scripts/rules/release.ts extract rules-library/buhurt-international 2026-11` (needs `pdftotext` / `pdfinfo` / `pdftoppm`,
   poppler-utils, and `tesseract` with Python Pillow for pages without a text layer).
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
9. **Publish**: after the migration is applied, the platform owner publishes from Platform › Rules (`/platform/rules`), one version or all ready
   versions, each with a confirm step (it calls `publish_ruleset_version(<version id>, <note>)`).
   Publishing refuses while any provision still needs review. The previous version becomes *superseded*: it stays readable, and every competition
   and disciplinary record that points at it keeps its meaning.

## Guarantees enforced by the database (migrations `20261015000100` and `20261015000300`)

- A published version's text, title, version label, file checksum and pages never change. A changed official file is a **new version**.
- Corrections of extraction mistakes go through `correct_rule_provision` with a reason; the old words stay in `rule_provision_revisions`.
- A published version is never deleted. It can be superseded or withdrawn (with a reason).
- Drafts and versions in review are visible to the platform owner only.
- Conflicts between official documents are recorded (`note_rule_conflict`) and resolved only by citing the source. BuhurtOS never decides between them.
- A finished competition keeps the ruleset version it was fought under.
