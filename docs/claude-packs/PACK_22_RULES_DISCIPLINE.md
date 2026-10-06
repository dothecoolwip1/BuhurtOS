# Pack 22: rules, regulations, penalties and discipline

Branch `ccr-321cc545-1coq4p`, started from `main` `532fbab`. `main` was merged in at `9d97be4`, after PR #40 and #41 (Red Deer Reavers membership) landed during the work.
The authoritative source is https://www.buhurtinternational.com/rules.

## 0. The one thing to know first

**The official rule documents could not be read in this environment.** The cloud environment's network policy denies
`www.buhurtinternational.com`, `drive.google.com` and every mirror, both from the shell and from the web-fetch tool. Only GitHub and package
registries are reachable. Web search returned titles only.

The owner supplied a **saved copy of the rules page** (HTML). From it, BuhurtOS now has the complete, verified **inventory** of the official
material: 42 documents and 3 archive folders, with their committees, headings and official links. The text inside those documents (rule
numbers, wording, pages, versions, disciplinary provisions) was **not retrieved**, so **no Buhurt International rule text is imported**.
Nothing was typed in from memory.

Everything that turns those documents into searchable, versioned, traceable rules is built and tested end to end: schema, importer,
reconciliation, search, pages, officiating, discipline log and permissions. The tests use invented example documents, clearly labelled as such.
To import the real rules, either allow the hosts above in the environment's network settings or provide the PDFs, then follow
`rules-library/README.md`.

Completion criteria 1, 2, 4 and 7 of the pack brief are therefore **not met for the rule text itself**:
- 1: investigating the official material;
- 2: accounting for all rules;
- 4: every rule traceable to its source;
- 7: official penalty concepts represented accurately.

They are met for the document inventory only. This record says so wherever it matters.

## 1. Official documents available from the rules page

Source: saved copy of the page, sha256 `68e97d7b29556dfaf0bf34c8c54d5e5f2aafa97bd9d5ae208867b50cfc4b7576`, captured 2026-10-06. Committed gzipped at
`rules-library/buhurt-international/snapshots/2026-10-06-rules-page.html.gz`.

The page groups documents under four committees, each introduced as "documents that are approved by" the Board of Directors (Exec), the Marshal
committee (MC), the Tournament Committee (TC) or the Authenticity committee (AC). The Authenticity section has sub-headings: "Infractions
Classification and Application", "General Requirements", "Helmets Requirements" and "Armor Requirements".

The inventory is produced by `scripts/rules/inventory.ts` and rebuilds byte-exactly from the snapshot (unit test). An independent anchor count
agreed: 42 file links + 3 folder links. **The page prints no versions or dates**; those exist only inside the documents.

Per committee:
- Executive: 8 documents
- Marshal: 6 documents + 1 archive folder
- Tournament: 5 documents + 1 archive folder
- Authenticity: 23 documents + 1 archive folder

"BuhurtOS kind / formats" is BuhurtOS's reading of the title, for filtering (`classification.json`), not official. "Earlier BuhurtOS citation" is
the version an earlier pack quoted from files the owner supplied then. It is **not** verified to be the version linked today.

| # | Committee | Heading on page | Document (label as linked) | Hosted on | BuhurtOS kind / formats | Earlier BuhurtOS citation |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Executive (Board of Directors) |  | [Gender policies](https://www.buhurtinternational.com/_files/ugd/d219c5_cd29c29d07894734abfd546ea3665066.pdf) | buhurtinternational.com file | eligibility |  |
| 2 | Executive (Board of Directors) |  | [Committees Internal Regulations](https://www.buhurtinternational.com/_files/ugd/d219c5_08fcf19112fc416992b0b429ba714b84.pdf) | buhurtinternational.com file | governance |  |
| 3 | Executive (Board of Directors) |  | [Committees Decision Process](https://www.buhurtinternational.com/_files/ugd/d219c5_78b65da8c8f041eda86d604ca17a67f6.pdf) | buhurtinternational.com file | governance |  |
| 4 | Executive (Board of Directors) |  | [Judiciary Committee](https://www.buhurtinternational.com/_files/ugd/d219c5_8f5a49fd19eb4c0696ad541e20b40ee4.pdf) | buhurtinternational.com file | discipline |  |
| 5 | Executive (Board of Directors) |  | [NO Agreement](https://www.buhurtinternational.com/_files/ugd/735f05_5ca8040d7eca41c896090743c2bc9fab.pdf) | buhurtinternational.com file | governance |  |
| 6 | Executive (Board of Directors) |  | [Code of Conduct](https://www.buhurtinternational.com/_files/ugd/735f05_eae9128857c1444290eaee38ec0fa73b.pdf) | buhurtinternational.com file | discipline |  |
| 7 | Executive (Board of Directors) |  | [Rule Update Policy](https://www.buhurtinternational.com/_files/ugd/d219c5_0fec8c7da3bb4ab4a6f507e1ea724410.pdf) | buhurtinternational.com file | governance |  |
| 8 | Executive (Board of Directors) |  | [Structure,Accreditation,Titles](https://www.buhurtinternational.com/_files/ugd/d219c5_ffce59b9558045d8a5dec698616e1b21.pdf) | buhurtinternational.com file | officials |  |
| 9 | Marshal Committee |  | [Duels Rules](https://drive.google.com/file/d/1BsQVd3-9v_mp8l5DPj2p_jDUGn2hZPrD/view?usp=drive_link) | Google Drive file | rules / duels | Duels rules V.26.4 |
| 10 | Marshal Committee |  | [Buhurt Rules](https://drive.google.com/file/d/1peAGsMBV8ldNkSlgR-U33V0JqCFYL8ja/view?usp=drive_link) | Google Drive file | rules / buhurt | Buhurt Rules V.26.4.1 |
| 11 | Marshal Committee |  | [Outrance rules](https://drive.google.com/file/d/1nRkVgelFzD3Vrk4EGXIAvZaCzWYniqQz/view?usp=drive_link) | Google Drive file | rules / outrance | Outrance Rules V.26.4 |
| 12 | Marshal Committee |  | [Jobs, Titles, Uniforms, Accreditations](https://www.buhurtinternational.com/_files/ugd/53cbbd_8340848f5250498c85d1c11c1b3653c8.pdf) | buhurtinternational.com file | officials |  |
| 13 | Marshal Committee |  | [Accreditation](https://www.buhurtinternational.com/_files/ugd/53cbbd_aadb219ddd34443c817c2c5f6236a6a9.pdf) | buhurtinternational.com file | officials |  |
| 14 | Marshal Committee |  | [Weapon/Shield Chart](https://drive.google.com/file/d/1n1JTMVa9t4lgQdTEp9kU8U63flesYTqy/view?usp=drive_link) | Google Drive file | equipment / buhurt, duels, outrance |  |
| 15 | Marshal Committee |  | [Marshal Archives](https://drive.google.com/drive/folders/1_nt_ivlEw9uKvR8_xtLkhNxYjV2A9nMP?usp=drive_link) | Google Drive FOLDER (archive) | archive |  |
| 16 | Tournament Committee |  | [Buhurt Regulations](https://drive.google.com/file/d/154lPdIUM8lnf4VSZmY_vlY88Waygzoq5/view?usp=drive_link) | Google Drive file | regulations / buhurt | Buhurt Regulations V.26.4 |
| 17 | Tournament Committee |  | [Duel Regulations](https://drive.google.com/file/d/1gr2EmgMvo5SprZo46vBgGKWOOg6m7bTx/view?usp=drive_link) | Google Drive file | regulations / duels | Duels Regulations V.26.4 |
| 18 | Tournament Committee |  | [Tournament Structure](https://www.buhurtinternational.com/_files/ugd/735f05_c0af5616cd814a779c43181befa8b29c.pdf) | buhurtinternational.com file | tournament_structure | Tournament Structure and Formats (Jan 2026) |
| 19 | Tournament Committee |  | [League Structure](https://www.buhurtinternational.com/_files/ugd/735f05_a1ec192413a34eef82ef91f57207ab80.pdf) | buhurtinternational.com file | tournament_structure | League Structure V2026.1 |
| 20 | Tournament Committee |  | [Secretary Accreditation](https://www.buhurtinternational.com/_files/ugd/d219c5_bb995d5ca4d345d2a649067d7cb9d494.pdf) | buhurtinternational.com file | officials |  |
| 21 | Tournament Committee |  | [Tournament Archives](https://drive.google.com/drive/folders/16KiaP13iB5zjUbBOSqe3Q_CopdafCOPw?usp=drive_link) | Google Drive FOLDER (archive) | archive |  |
| 22 | Authenticity Committee | Infractions Classification and Application | [Infractions](https://drive.google.com/file/d/1NQ5O-CT62qn-V6w3Zh4JqcCzKJVxEZS5/view?usp=drive_link) | Google Drive file | infractions |  |
| 23 | Authenticity Committee | General Requirements | [Armor Requirements](https://drive.google.com/file/d/1yQDGSiXkM2pjHS9yj5e-HLJklWIeRKZE/view?usp=drive_link) | Google Drive file | equipment |  |
| 24 | Authenticity Committee | General Requirements | [Weapon requirements](https://drive.google.com/file/d/1cVip6PUx62koGD1yzrygb9p0sAJ44IOj/view?usp=drive_link) | Google Drive file | equipment |  |
| 25 | Authenticity Committee | General Requirements | [Falchions](https://drive.google.com/file/d/1blWdDUbcSepUW9dy1C4x-MCzGFymFki6/view?usp=drive_link) | Google Drive file | equipment |  |
| 26 | Authenticity Committee | General Requirements | [Shields & Bucklers](https://drive.google.com/file/d/1u3RCMI3PhELiRPootNoVZiLR9YbU5Nzt/view?usp=drive_link) | Google Drive file | equipment |  |
| 27 | Authenticity Committee | General Requirements | [Aesthetics and Decorations](https://drive.google.com/file/d/1eTch7jpn5rapbeYvzmIZ48g49bcIKF4O/view?usp=drive_link) | Google Drive file | equipment |  |
| 28 | Authenticity Committee | General Requirements | [Belt flag(s)](https://drive.google.com/file/d/1ATswdLydtmGmWQeiTmF7GmyAod7GSQci/view?usp=sharing) | Google Drive file | equipment |  |
| 29 | Authenticity Committee | General Requirements | [Tabards](https://drive.google.com/file/d/1mkBe8JCRfQxDuPPTMJImzV_UWaW4Mgvc/view?usp=drive_link) | Google Drive file | equipment |  |
| 30 | Authenticity Committee | General Requirements | [Textile and Leather](https://drive.google.com/file/d/1a7vTdkrW4ZhS-SdA22eczMmKrTUR2X38/view?usp=sharing) | Google Drive file | equipment |  |
| 31 | Authenticity Committee | Helmets Requirements | [Klappvisors](https://drive.google.com/file/d/1nGbacRRmwzdVNeJg2OrkxRItcKL_Bu9a/view?usp=sharing) | Google Drive file | equipment |  |
| 32 | Authenticity Committee | Helmets Requirements | [Great Helms](https://drive.google.com/file/d/12ImGYz_z95qyThLls4MI8j0IUDuRDkq8/view?usp=sharing) | Google Drive file | equipment |  |
| 33 | Authenticity Committee | Helmets Requirements | [Wolfribs](https://drive.google.com/file/d/1hd82Hg44UkAK7xa2puStRUIxoGKC_McR/view?usp=drive_link) | Google Drive file | equipment |  |
| 34 | Authenticity Committee | Helmets Requirements | [Nasals & Breteches](https://drive.google.com/file/d/1UhguW3phwP3DUHV1kiUcsu8pM1nQ0z7M/view?usp=sharing) | Google Drive file | equipment |  |
| 35 | Authenticity Committee | Helmets Requirements | [Side-pivoting visored Bascinets](https://drive.google.com/file/d/1v9GjZNB6xaTEkKWBgC-zo0tkiCin6VSc/view?usp=drive_link) | Google Drive file | equipment |  |
| 36 | Authenticity Committee | Helmets Requirements | [Eyebars](https://drive.google.com/file/d/1skAksQXo5-RNNdEP1Tje8dGw_uiJ_ucb/view?usp=sharing) | Google Drive file | equipment |  |
| 37 | Authenticity Committee | Helmets Requirements | [Barbutes](https://drive.google.com/file/d/1zllcOqunbMXrrV1K1PPtahGEjncrol3V/view?usp=drive_link) | Google Drive file | equipment |  |
| 38 | Authenticity Committee | Helmets Requirements | [Aventails](https://drive.google.com/file/d/1nKUSTq1LoUk3-OTymAJa4Pa_SWcJQA0h/view?usp=sharing) | Google Drive file | equipment |  |
| 39 | Authenticity Committee | Helmets Requirements | [Sallets](https://drive.google.com/file/d/1wQX1hGzV4fkjc8R5cmV_HsLYMDlmfEw6/view?usp=drive_link) | Google Drive file | equipment |  |
| 40 | Authenticity Committee | Helmets Requirements | [Perforated Visor Bascinets](https://drive.google.com/file/d/1hXeuPmztpXG9LdNrGV8j5dlr7ne7R93p/view?usp=drive_link) | Google Drive file | equipment |  |
| 41 | Authenticity Committee |  | [Authenticity Archives](https://drive.google.com/drive/folders/1amr_AsH10QsnCOMjFB8ebcpUyUUp66yW?usp=drive_link) | Google Drive FOLDER (archive) | archive |  |
| 42 | Authenticity Committee | Armor Requirements | [Gauntlets](https://drive.google.com/file/d/1u71LdLSm6zVKW7jhI5djRKiF7D5UtqRS/view?usp=drive_link) | Google Drive file | equipment |  |
| 43 | Authenticity Committee | Armor Requirements | [Sabatons](https://drive.google.com/file/d/1xeX4tDns1F0hnF1mGNhfDbtYTwPScrhv/view?usp=sharing) | Google Drive file | equipment |  |
| 44 | Authenticity Committee | Armor Requirements | [Greaves](https://drive.google.com/file/d/1f9RnYIO90XcFlZyoKKVo6HjoM_3WH8xE/view?usp=sharing) | Google Drive file | equipment |  |
| 45 | Authenticity Committee | Armor Requirements | [Neck Protection](https://drive.google.com/file/d/1bo8-eNr_pTawNLNGod5mN64-d4EkkLS-/view?usp=sharing) | Google Drive file | equipment |  |

## 2. Versions and dates

None are printed on the page. Versions are only known indirectly, from what earlier packs quoted (`src/content/rules.ts`, `src/lib/tournament.ts`,
`ref_categories.source`):
- Buhurt Rules V.26.4.1
- Buhurt Regulations V.26.4
- Duels rules / Duels Regulations V.26.4
- Outrance Rules (and Regulations) V.26.4
- League Structure V2026.1
- Tournament Structure and Formats (Jan 2026)

Whether those are the files linked today is unknown. The importer detects the printed version and date from each PDF's first pages, and a person
must confirm them (`overrides/*.json`) before a version can be stored as reviewable.

## 3. Structure

Four committee sections. Most rulebooks are Google Drive files; governance documents are files on the site itself. Each committee has an
"Archives" Drive folder of earlier editions. These are excluded from a current import automatically, but they are the place to find historical
versions if past events need them later.

The internal structure of the documents (sections, numbering, appendices) could not be inspected. The importer handles the shapes rulebooks usually
have: numbered sections such as 1, 1.1 and 1.1.1, sub-numbers without a printed parent, appendices, bullets, tables, headers and footers, and
image-only pages. Anything it cannot read with confidence is flagged for a person rather than guessed.

## 4. Disciplinary concepts

**Not determinable from official text here.** What is known, and how reliable it is:
- Paraphrases committed by earlier packs, from owner-supplied files (secondary, unverified against today's documents):
  - "verbal warning, yellow card or red card" for thrusting (Buhurt Rules §4.2);
  - disqualification on "2 yellow cards or 1 red" leading to a technical win (Duels rules §2.3);
  - "a yellow card … costs one point" in the 10-point must system (Outrance §15.3);
  - "fewest penalties" as a tiebreak (Tournament Structure §3).
- Documents whose titles indicate disciplinary or eligibility content, not read: Code of Conduct, Judiciary Committee, Infractions (Classification and
  Application), Gender policies, and the Committees' internal regulations and decision process (likely appeals).

**Decision.** BuhurtOS does not invent a Buhurt International sanction vocabulary, suspension model or eligibility rule:
- Officials keep using the Pack 13 model on the field: warning, card from the **event's own card list**, deduction, DQ. These records are structured,
  void-only, audited, and keep reasons private.
- Pack 22 adds the ability to **cite the exact rule** on any of these records, plus an event-wide **discipline log**.
- Suspensions and bans (eligibility restrictions) were **not built**. Whether, how and by whom Buhurt International imposes them (presumably the
  Judiciary Committee and Code of Conduct) must be read first. Nothing blocks anyone automatically.

The schema allows adding them later: a sanction vocabulary per ruleset version, citing provisions, and an eligibility-restriction table that points
at a cited provision and a disciplinary record.

## 5. Existing BuhurtOS code that already touched rules, penalties, eligibility or discipline (all kept)

| Where | What it was | What Pack 22 did with it |
| --- | --- | --- |
| `public.rulesets`, `public.ruleset_versions`, `competitions.ruleset_version_id` (connected model, empty on hosted) | ruleset + version + competition link, owner-written | **Extended** in place: rulesets = official document series; versions gain review state, file checksum, supersession; the competition link is now guarded |
| `public.sources`, `record_sources` | provenance | the page snapshot is a `sources` row (kind official) that every inventoried document points at |
| `public.ref_categories.source`, `src/lib/quickSetup.ts`, `competitions.ruleset` text | free-text ruleset labels citing V.26.4 | unchanged |
| `src/content/rules.ts` + `src/pages/RulesPage.tsx` | 23 hardcoded paraphrased summaries, simple substring search | summaries **kept** and labelled "BuhurtOS summaries, not the official wording", linked to their official documents; the page now searches official text first |
| `public.match_discipline(+_private)`, `lyst_record_discipline`, `lyst_void_discipline`, event card list in `event_lyst_settings` (Pack 13) | in-bout warnings/cards/deductions/DQ | **unchanged**; rule citations are a separate append-only table referencing these records |
| `entries.status = 'disqualified'` | competition-level DQ | unchanged |
| Pack 16 readiness, Pack 18 Command Centre | event-day authority (organizer, head marshal) | reused: discipline log uses `private.can_score`; Command Centre gains links to it and to Rules |

## 6. Contradictions and uncertainties found

1. **Source access**: see section 0.
2. **Versions** linked today vs. versions BuhurtOS quoted earlier: unknown (section 2).
3. **Known document disagreement** (pre-existing, kept): League Structure V2026.1 and Tournament Structure (Jan 2026) give different tier multipliers.
   `ref_tiers` keeps both. Once imported, this belongs in `rule_conflicts`.
4. `FormatsPage` notes that Buhurt Regulations §4 (round and match structure) "was not readable" in the earlier files: expect a table or image there.
5. "NO Agreement" is read as "National Organization agreement" from the site's navigation (OUR MEMBERS → /nationalorganization). Confirm on reading.
6. The Weapon/Shield Chart is probably a table or image: likely `needs_review` or excluded with a link.
7. Google Drive files download automatically only if shared publicly; otherwise the owner supplies them (`register`).
8. **Hosted database** contains migrations not in BuhurtOS `main` at the start (`club_membership_dues_voting`, `club_fee_waiver_and_agm`). They
   arrived in `main` through PR #40/#41 during this work. Pack 22's migrations were renumbered to `20261015…` to follow them.

## 7. Schema and integration (implemented)

Migrations (additive; no DROP of existing objects; one RESTRICTIVE policy narrows the old open read of versions):

### `20261015000100_pack22_rules_library.sql`

**Tables**
- `rulesets`: new columns for document metadata. Each row has an inventory key such as `marshal/buhurt-rules`, its committee and heading, the
  official link and file id, whether it is still listed on the page, and the BuhurtOS classification (applies-to formats, kind, relevance).
- `ruleset_versions`: one row per document version. Status runs draft → in_review → published → superseded or withdrawn. It stores the source URL,
  file sha256, retrieval time, page count, extractor, a content sha256 and the reconciliation summary, plus `successor_version_id` and the
  withdrawal reason. `published_by` is hidden from the API.
- `rule_provisions`: the text, one row per provision in reading order. Each carries its parent, number, title, body and pages, a stable key that is
  the same rule across versions, a content sha256 (the same definition in SQL and TypeScript), review status and note, BuhurtOS topics and search
  words, and cross-references.
- `rule_provision_revisions`: append-only corrections.
- `rule_conflicts`: recorded disagreements between documents.
- `match_discipline_rules`: append-only rule citations on Pack 13 records.

**Guards**
- Published content is frozen and status only moves forward.
- New versions must start as draft or in review.
- Published versions and provisions are never deleted, and inventoried documents are never deleted.
- A finished competition keeps its version. Only published or superseded versions can be linked, and test rulesets only by test events.

**Importer (database owner only)**: `private.rules_import_inventory(jsonb)` and `private.rules_import_version(jsonb)`.
- Idempotent by checksum.
- Refuses to overwrite a published version.
- Failed reconciliation → stored as an owner-only draft.

**Owner functions (audited)**: `publish_ruleset_version`, `withdraw_ruleset_version`, `review_rule_provision`, `correct_rule_provision`,
`note_rule_conflict`, `resolve_rule_conflict`.

**Organizer**: `set_competition_ruleset_version`.

**Officials**
- `lyst_cite_rule(command, discipline, provision)`: idempotent, through the scoring outbox.
- `event_discipline_log(event)`: staff only, no account ids.

### `20261015000200_pack22_bi_document_inventory.sql`

Generated by `scripts/rules/release.ts inventory-sql`. It loads the 45 directory entries with classification and links. **No rule text.**

### App

- `/rules`
  - Search box (sticky), format filter, "include older versions".
  - Official rule results first; BuhurtOS summaries after, labelled.
  - With no search: official documents by committee, in the page's own order, with the bout-rules committee open first.
  - States the text is not imported yet.
- `/rules/doc/:slug`: issuer, formats, official file, versions, contents in reading order, search within the document; or "text not in BuhurtOS yet"
  with the official link.
- `/rules/r/:id`
  - Number, title, full text.
  - Status banner: older version (with a link to the wording in force, and the note that past results keep this wording), withdrawn, or unpublished.
  - Source table: governing body and committee, document, version, section path, pages, formats, review state.
  - Official document link at the page; corrections with the earlier text; recorded conflicts.
  - Children, referenced rules, the same rule in other versions, previous/next.
- **Search** (`src/lib/rules/search.ts`): deterministic.
  - Rule-number queries (`4.2`, `§ 4.2`, `rule 4.2`).
  - Light stemming.
  - A small BuhurtOS synonym list (search aids only; e.g. back of knee / behind the knee, two-handed / 2h, armour / armor, appeal / protest).
  - Field weights: number, then title, then search words, then section, then text. Phrase bonus.
  - All words required, with a clearly labelled "closest matches" fallback.
- **Offline**: the library is cached in the browser and shown immediately, then refreshed in the background.
- **Lyst screen**
  - A "Rules" sheet: look up and read a rule without leaving the fight.
  - "Add the rule (optional)" on the marshal's call.
  - "Add/Change the rule" on each record in the match record.
  - The rule shown on records.
  - Citations ride the existing outbox (`lyst.cite_rule`); older builds refuse the unknown kind safely.
- `/events/:slug/discipline`: per fighter or team, tallies of records in force (voided shown but never counted), reason, marshal, fight, rule cited
  and whether it changed. Linked from the Command Centre.
- **Manage › Competitions**: optional "Official ruleset in BuhurtOS" per competition. It appears only when a published version exists for the
  format, and is shown read-only once the competition is finished.

## 8. Evidence

| Level | Result |
| --- | --- |
| Starting commit | `532fbab` (main). Baseline: DATABASE GATE PASSED, typecheck clean, Vitest 959/959, build OK |
| Repository | migrations `20261015000100`, `20261015000200`; `scripts/rules/*`; `rules-library/*`; `src/lib/rules/*`, `src/data/rules.ts`, `src/pages/rules/*`, `src/pages/RulesPage.tsx`, `src/pages/DisciplineLogPage.tsx`, `src/components/rules/*`, Lyst sheet/log wiring, `scoreSender` kind; gate `pack22_gate.sql`; browser `scripts/e2e/pack22-live.{sh,mjs}` + fixture |
| Unit tests | Vitest 1010/1010 on the merged tree. New: inventory 4 (includes byte-exact rebuild from the snapshot and the 42/3/per-committee counts), structuring and reconciliation 11 (lost, added and duplicated text, unconfirmed version, release accounting, reproducibility of the committed fixture), search 26 (every example query in the brief, numbers, partial and no results, 4000-rule speed), discipline log 4, sender 2 |
| Database gate | `run_all.sh` **DATABASE GATE PASSED** on the merged tree; `pack22_gate.sql` **124 checks**; schema fingerprint 2238 lines. Two earlier gates' data assumptions were updated to Pack 22's rules (`security_gate`: exactly one `sources` row; a new draft version readable by anon). The real problems these gates caught were fixed: `published_by` was anon-readable; the column `superseded_by` was renamed `successor_version_id` |
| Importer end to end | invented example PDFs generated with Chromium → `register` → `extract` (pdftotext 24.02) → `structure` → `reconcile` PASSED (r1: 2 imported / 2 excluded with reasons; r2: 1 / 3) → SQL → loaded; re-load is "unchanged"; a changed file for a published version is refused |
| Browser (real Chromium, built app, real Postgres + PostgREST 12.2.3) | `scripts/e2e/pack22-live.sh` **71/71** at 390×844 (and desktop for the keyboard). Covers: the real BI directory (4 committees, 8/6/5/23, official Drive link opens in a new tab, "not imported yet" notice); test rules hidden outside sample mode; summaries labelled; searches back of knee, two handed weapon, helmet, yellow card, grounded fighter, grappling, protest, shield, `3.2`, `4`, zebra (no results), partial match; older versions and format filter; rule detail source, version, page and official link; older version banner and link to current; correction with earlier text; a 9-paragraph rule; document contents and both versions; keyboard (type, Enter, Tab to result with focus ring, Enter opens, clear); no sideways scroll on every screen; Lyst Rules sheet without changing the match; rule cited on a warning through the outbox, audited, changed append-only, shown in the record; head marshal's discipline log; stranger refused; API refusals (anon/stranger cite, anon log, `set_by` hidden, organizer cannot publish or correct, nobody inserts rule text); Manage › Competitions link audited; no page errors |
| Regression browser suites | field-pack03 28/28, sw-update 28/28, pack07-ux 89/89, pack08-entrants 54/54, pack12-app 78/78, pack13-live 88/88, pack16-live passed (before the merge with main; main's changes did not touch these screens); pack22-live re-run on the merged tree 71/71 |
| Not run | `pack18-live` (needs a Supabase Auth server binary that is not available here; Pack 22 only added two links to the Command Centre), the remaining live suites |
| Hosted database | **NOT changed.** Read-only check only: 0 rulesets, 0 versions, 0 linked competitions, 2 `match_discipline` rows; latest migration `20261006042421 club_fee_waiver_and_agm` |
| Deployment / production | **NOT deployed, NOT merged, no PR.** |

## 9. What remains (owner / next run)

1. Give the environment access to `www.buhurtinternational.com`, `drive.google.com`, `drive.usercontent.google.com` and `*.googleusercontent.com`, or
   supply the 42 PDFs. Then run the import (`rules-library/README.md`), including the human review of every `needs_review` item and version label.
2. Read the Code of Conduct, Judiciary Committee and Infractions documents. Then decide, with the owner, whether to add a per-ruleset sanction
   vocabulary and eligibility restrictions (suspensions or bans), as warnings, not automatic blocks.
3. Record known document conflicts (for example the tier multipliers) in `rule_conflicts` once both documents are imported.
4. Apply the two migrations to the hosted database (`docs/runbooks/PACK22_HOSTED_ROLLOUT.md`), then verify live.
