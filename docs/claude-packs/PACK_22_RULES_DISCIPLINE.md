# Pack 22: rules, regulations, penalties and discipline

Branch `ccr-321cc545-1coq4p`, started from `main` `532fbab`. `main` was merged in at `9d97be4`, after PR #40 and #41 (Red Deer Reavers membership) landed during the work.
The authoritative source is https://www.buhurtinternational.com/rules.

## 0. Summary

**All 42 official Buhurt International documents are imported, reconciled and stored as versions waiting for the owner to publish.**

- The official files were fetched from the links on the rules page by a one-shot GitHub Actions workflow on branch `pack22-bi-sources`
  (`rules-library/bi-source-drop/2026-10-06/`, `SHA256SUMS.txt`). The workflow was removed afterwards (`975152e`). This environment still cannot
  reach the hosts directly. Provenance per file is in `rules-library/buhurt-international/releases/2026-10-06/fetch-log.json`.
- Release `2026-10-06`:
  - **45** inventory entries: **42 imported**, **3 excluded** (the three archive folders, which are links to earlier editions, not documents);
    **0 missing**.
  - **1281 provisions** in official numbering. No number was invented: unnumbered printed headings (weapon chart) keep their printed title.
  - **15 tables** transcribed as rows and cells, with merged cells kept.
  - **24 picture-only pages**, stored as figures with no words of BuhurtOS's own.
  - **210 pages** read by OCR, because they have no text layer. **37** OCR corrections were checked against the page image.
  - **111 lines of lettering inside pictures** (labels on drawings, photo captions) were set aside, not presented as rules.
  - Reconciliation **PASSED** (`reconciliation.md`): every source line is accounted for once, character coverage is at least 98 % per document,
    and every version label was read from the document itself.
  - The per-document table is in `docs/claude-packs/PACK_22_SOURCE_QA.md`.
- **Nothing is published yet.** Publishing is the platform owner's act, through Platform › Rules (`/platform/rules`): one version, or "Publish all N
  ready", each with a confirm step. Every version is ready: reconciled, with no provision left to check.
- The discipline domain is built **from the official text**, every concept traced to its provision. It is in section 4:
  - BI card vocabulary;
  - sanctions outside a fight;
  - authenticity infractions and green cards;
  - appeals and Judiciary reviews with their official windows;
  - suspensions with authority and scope;
  - eligibility blocks on every event-day desk.
- **Conflicts found are recorded, not decided** (section 6). Example: the tier points in League Structure 2.3.4/2.3.5 versus 3.3.2 and Tournament
  Structure 4.2.
- **Hosted database: not changed.** Nothing merged, nothing deployed, no PR.

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
the version an earlier pack quoted from files the owner supplied then. Each matches the version linked today (section 2).

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

## 2. Versions and dates (read from each document)

The rules page prints no versions. Every version label below was read from the official PDF itself: the cover, page footers and change log. Each
was recorded with `version_confirmed_by` "Claude Code (Pack 22 import), read from the official PDF: cover, page footers and changelog" and
`confirmed_on` 2026-10-06 in `overrides/<doc>.json`. The note stored with each version says where the label was printed.

| Version | Documents |
| --- | --- |
| 26.4.1 | Buhurt Rules |
| 26.4 | Duels Rules, Outrance Rules and Regulations, Buhurt Regulations, Duel Regulations, Infractions, Weapon requirements, Shields & Bucklers, Perforated Visor Bascinets |
| 26.2.1 | Weapon/Shield Chart |
| 26.1 | Code of Conduct, League Structure, and the remaining Authenticity documents |
| January 2026 | NO Agreement, Tournament Structure (as printed: a date, not a number) |
| 2025.03 | Marshal Accreditation |
| 2025.02 | Marshal Jobs, Titles, Uniforms and Accreditation |
| December 2024 | Committees Internal Regulations, Committees Decision Process, Committees Structure, Accreditation and Titles |
| 2024.06 | Judiciary Committee, Rule Update Policy, Secretary Accreditation |
| 2024.03 | Gender policies. The file name says "V2024.06" but the document prints 2024.03; the printed label is used and the mismatch is noted on the version |

The earlier BuhurtOS citations (Buhurt Rules V.26.4.1, Regulations V.26.4, Duels V.26.4, Outrance V.26.4, League Structure V2026.1, Tournament
Structure January 2026) match the documents linked today.

## 3. Structure and extraction

- **Text layer first.** `pdftotext -layout`. Pages without a text layer were rendered at 300 dpi and read with tesseract 5.3.4 (`psm 4`).
  `scripts/rules/ocr_page.py` then uses the page image to decide:
  - bullets (a small filled or hollow square → ● / ○);
  - coloured page-edge bands (dropped);
  - lettering inside a picture: a very small line, faint words on a non-paper background, or no readable word. These lines are set aside as page
    furniture with the reason, and are never shown as rule text.
- **Official numbering only.** Provisions are keyed `<series>:<number>`. A printed heading without a number keeps its printed title (the weapon
  chart's ten headings). A page that is only pictures becomes a `figure` with an empty body (`has_figures`). Each provision records its
  `extraction` (text, OCR or mixed). The rule page says when text was read from an image and when the page also has pictures that BuhurtOS does
  not reproduce.
- **Tables are not flattened.** The 15 tables are transcribed in `overrides/<doc>.json` (`layout.tables`) as rows and cells:
  - `^` marks a cell merged with the one above, `<` a cell merged with the one to the left, and `<br>` a paragraph break inside a cell;
  - a word-multiset check proves the transcription neither adds nor drops a word of the extracted text;
  - the app renders them as real tables with merged cells, scrolling inside their own box on a phone.
- **Reviewed decisions are data.** `overrides/<doc>.json` holds `ocr.fix` / `ocr.insert` (37 corrections, each checked against the page image),
  `noise` (form labels on the Outrance scoring sheet, a decorative line), `layout.headings` / `layout.tables`, and `review` notes.
  - Each review is bound to the provision's `content_sha256`, so a later change to the text re-opens it as `needs_review`.
  - Review was not ceremonial. 26 provisions carry a note, where something real needed checking: a table, a heading read from an image, a picture
    caption. Clear text was not flagged.
- **Reproducible.** Re-structuring the committed `text/` with the committed `overrides/` gives the committed `structured/` files exactly (unit test,
  every document of the release). Re-running `reconcile` and `sql` from them gives the committed migration byte for byte (checked 2026-10-06 with
  `cmp`). OCR depends on the tesseract version, so the OCR text is committed.

## 4. Disciplinary concepts (from the official text) and how BuhurtOS represents them

Every concept below carries the provision stable keys that define it. BuhurtOS records decisions made by officials. It never judges a fight and
never computes a consequence the documents leave to people (no AI referee, no automatic score changes).

| Concept | Official source | BuhurtOS |
| --- | --- | --- |
| Verbal warning, reprimand, yellow card, red card, green card | Buhurt Regulations 6.1–6.4, Duel Regulations 4.1–4.5, Outrance 13, Tournament Structure 2, Infractions 3 | `discipline_card_types` (BI preset): each card is its own concept with its sources. A **green card is never a yellow card** (Buhurt Regulations 6.5.2: green cards do not count toward team disqualification). The event's tablet list can be set from the preset ("Buhurt International cards"), keys kept |
| Cards in a fight | Buhurt / Duel Regulations 6 / 4 | Pack 13 `match_discipline` now records the `card_key` and the **ruleset version in force for the competition**, filled by the database. Void-only, as before |
| Score effects | Duel Regulations 4.2 (a reprimand adds points to the opponent), Outrance 15.3 | **Not applied automatically.** The card is recorded; the official changes the score through the existing scoring path. A finalized result is never rewritten: voiding a card from a final match is refused until the result is reopened |
| Yellow and red cards stay in their tournament; green cards follow the competitor | Tournament Structure 2 (January 2026) | Cards outside a fight are `event_sanctions` with a competition when one applies. Infractions 3 gives one green card per tournament, and Tournament Structure 2 says it follows the competitor into every tournament. Read together, **one green card is in force per competitor at the event** until it is removed, counting green cards given on the field tablet too. This is BuhurtOS's reading of the two provisions, cited in the refusal message |
| Authenticity infractions: minor, moderate, major | Infractions (classification and application) | `authenticity_findings`, recorded by the Authenticity Officer (inspector), the head marshal or an organizer of the event. Kept separate from cards. A finding closes once (corrected or voided) and is never deleted |
| Appeal at the event: to the Secretary within 15 minutes, decided by the Knight Marshal | Buhurt Regulations 7.2/7.4, Duel Regulations 5.2/5.4, Outrance 16.3/16.4 | `discipline_reviews` kind `event_appeal`, deadline computed from the end of the fight. The Secretary (scorekeeper) lodges it; the Knight Marshal (head marshal) or an organizer decides. Outrance 16.3 sends it to the Knight Marshal instead; the note says so. Outcomes as printed: rematch round, restart, cards imposed or withdrawn, point deduction imposed or withdrawn (Outrance 16.4), and "kept" (not approved: 7.1 / 5.1 "If an appeal is approved"). The deadline always runs from the end of the fight and cannot be set by hand. Only the Secretary or a decider records a withdrawal, with a reason, and it is audited. Applying a decision uses the record's own path (void, withdraw or lift), never a silent edit |
| Judiciary Committee: red card review (14 days), application (30 days) | Judiciary Committee 3.1.1, 3.2, 3.4, 4.4 | Kinds `judiciary_red_card` / `judiciary_application`, decided by the platform owner or the event's organization admin. Outcomes kept, revoked, increased, reduced |
| Suspensions and bans | Code of Conduct, Judiciary Committee | `discipline_suspensions`. **Authority**: the event (organizer or head marshal), an organization (its admins) or the platform (owner). **Scope**: rest of the event, one competition, the organization's events, all events. Changing one creates a new row that supersedes the old; lifting keeps it with the reason. Full history in `discipline_history` (append-only) |
| Eligibility | (follows from the above) | One database answer, `discipline_block_reason(fighter, event, team)`, enforced by triggers on registration acceptance, check-in, entries (including a withdrawn entry being put back) and roster. A team suspension counts at every one of these steps. Entries that existed before a suspension are not removed or rewritten: readiness shows the person NOT READY, and the organizer withdraws the entry. It is shown as a **clear block** on Manage › review, the check-in desk and readiness. A readiness override is refused while a block applies. A warning that is not a block (for example an open finding) is shown as a warning |
| Marshal roles | Marshal Accreditation, Jobs/Titles/Uniforms/Accreditation, Committees Structure/Accreditation/Titles | The documents are imported and searchable ("marshal accreditation"). BuhurtOS keeps the distinct event roles it already has (head marshal, marshal, scorekeeper, inspector). It does **not** build a global accreditation registry or merge roles |

**Privacy.**
- Reasons, notes and who recorded a decision live in `_private` tables, readable only by event staff and the deciding authority. Suspension reasons
  are readable only by the issuing authority. Account ids (`issued_by`, `recorded_by` and similar) are not readable through direct table reads.
- A fighter reads their own record; a captain reads their team's. Their history shows what happened and when, but never the reason or who decided.
- Another event's staff learn only that a fighter is blocked from *their* event, never the reason.
- No function returns account ids.

**Notifications** reuse Pack 15: `suspension_changed`, `review_decided` and `green_card_changed`, deduplicated.

## 5. Existing BuhurtOS code that already touched rules, penalties, eligibility or discipline (all kept)

| Where | What it was | What Pack 22 did with it |
| --- | --- | --- |
| `public.rulesets`, `public.ruleset_versions`, `competitions.ruleset_version_id` (connected model, empty on hosted) | ruleset + version + competition link, owner-written | **Extended** in place: rulesets = official document series; versions gain review state, file checksum, supersession; the competition link is now guarded |
| `public.sources`, `record_sources` | provenance | the page snapshot is a `sources` row (kind official) that every inventoried document points at |
| `public.ref_categories.source`, `src/lib/quickSetup.ts`, `competitions.ruleset` text | free-text ruleset labels citing V.26.4 | unchanged |
| `src/content/rules.ts` + `src/pages/RulesPage.tsx` | 23 hardcoded paraphrased summaries, simple substring search | summaries **kept** and labelled "BuhurtOS summaries, not the official wording", linked to their official documents; the page now searches official text first |
| `public.match_discipline(+_private)`, `lyst_record_discipline`, `lyst_void_discipline`, event card list in `event_lyst_settings` (Pack 13) | in-bout warnings/cards/deductions/DQ | **extended, not replaced**: rule citations are a separate append-only table; each record now also carries the card concept (`card_key`) and the ruleset version in force, filled by the database; the void path is reused by appeal decisions |
| `entries.status = 'disqualified'` | competition-level DQ | unchanged |
| Pack 16 readiness, Pack 18 Command Centre | event-day authority (organizer, head marshal) | reused: discipline log uses `private.can_score`; `private.readiness_rows` patched in place (asserted anchors) so a discipline block makes a fighter NOT READY with the reason; Command Centre gains links to the discipline desk and to Rules |
| Pack 15 notifications | kinds, categories, routes, dedupe | reused: three new kinds added by rebuilding the kind constraint and patching the category / route / text functions in place |
| `registrations`, `registration_checks`, `entries`, `entry_fighters`, `registration_overrides` | event-day writes | guarded by eligibility triggers (a block refuses acceptance, check-in, entry, roster and overrides) |

## 6. Contradictions and uncertainties found

1. **Tier points, recorded as open conflicts** (migration `20261015000600`, visible on the rule page once both documents are published):
   - League Structure 26.1 2.3.4 / 2.3.5 tables: Regional "Points given 150 %", Conference "Points given 200 %";
   - League Structure 26.1 3.3.2: "x1.25 for Regional", "x1.5 for Conference";
   - Tournament Structure (January 2026) 4.2: "1.25x" and "1.5x".

   BuhurtOS does not decide between them. `ref_tiers` keeps both readings, as it already did.
2. **Gender policies version**: the file name says V2024.06 and the document prints 2024.03. The printed label is used; the mismatch is noted on the
   version.
3. **Score effects of cards** (Duel Regulations 4.2: a reprimand adds points to the opponent; Outrance 15.3: a yellow card costs a point): these
   are deterministic in the text, but they depend on the format's scoring, which the officials control. BuhurtOS records the card and does not
   change the score automatically. That is a deliberate choice, not a gap in the import.
4. **Document precedence** is not stated across documents (for example Rules versus Regulations). BuhurtOS never assumes it. Each concept cites every
   provision that defines it.
5. "NO Agreement" is the National Organization agreement (confirmed by the document's text).
6. **Hosted database** contains migrations not in BuhurtOS `main` at the start (`club_membership_dues_voting`, `club_fee_waiver_and_agm`). They
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
  - Quick questions (chips) once official text is published; change logs, covers and empty figures are never offered as rules.
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

### `20261015000300_pack22_provision_layout.sql`

- `rule_provisions.has_figures` and `extraction` (text / ocr / mixed).
- The content check now allows a picture-only figure (`rule_provisions_has_content`).
- The frozen-content guard covers the new columns; the importer stores them.

### `20261015000400_rules_bi_2026_10_06.sql` (generated, about 950 KB)

Generated by `scripts/rules/release.ts sql` from the reconciled release. It loads 42 versions **in review** with their 1281 provisions, file
checksums, reconciliation summaries and confirmed version labels. It is idempotent: a re-load reports "unchanged". It refuses to touch a
published version.

### `20261015000500_pack22_discipline.sql`

- **Competition documents**: `competition_rulesets` (several documents per competition, frozen once it is finished; published versions only).
  - `set_competition_rulesets`.
  - `apply_current_documents(competition, governing_body)` picks from the classification: documents for this format plus documents for every
    format. The primary rulebook is the format's `rules` document.
  - Not hardcoded to Buhurt International: the governing body is a parameter, and the organizer can pick any published version.
- **Vocabulary**: `discipline_card_types`, `discipline_review_rules` (BI presets with sources); `apply_card_preset`.
- **Records**:
  - `match_discipline.card_key` / `ruleset_version_id`, set by a trigger;
  - `event_sanctions` (+ `_private`): `issue_event_sanction`, `end_event_sanction`;
  - `authenticity_findings`: `record_authenticity_finding`, `close_authenticity_finding`;
  - `discipline_suspensions` (+ `_private`): `issue_suspension`, `change_suspension` (supersedes), `lift_suspension`;
  - `discipline_reviews`: `lodge_review`, `withdraw_review`, `decide_review` (optionally applying the decision through the record's own path).
- **History**: `discipline_history`, append-only, no client read. It is reached through `discipline_record_history`, for people who may read the
  record. Every write is also audited through `private.audit`.
- **Eligibility**:
  - `discipline_block_reason`, plus triggers on registrations, check-in, entries, entry fighters and readiness overrides;
  - the readiness patch;
  - `discipline_eligibility` (blocks and warnings, for one fighter at one event).
- **Reads**: `event_discipline_overview`, `fighter_discipline`, `managed_suspensions`.
- **Notifications**: three kinds, with producers.
- **Permissions**: the existing helpers (`can_score`, `can_resolve_results`, `can_inspect`, `can_see_readiness_detail`, `is_org_admin`,
  `is_owner`, `is_team_captain`, `fighter_accounts`). No new super-admin.

### `20261015000600_pack22_bi_rule_conflicts.sql`

The three tier-points conflicts in section 6, recorded open and audited. Data only, and idempotent.

### `20261015000700_pack22_discipline_fixes.sql`

The fixes from the skeptical QA pass (section 8). Functions are replaced, triggers and column grants added, and the BI appeal rule row corrected to
the official text. `supabase/tests/pack22_qa_fixes_gate.sql` has one block per finding, and it fails on the schema without this migration.

### App (Pack 22 completion)

- `/rules`:
  - quick questions;
  - tables with merged cells;
  - picture and OCR notices;
  - a "Read from" row, the version note and review notes;
  - change log banner;
  - search aids: fighter/competitor, strike/hit, accreditation, infraction.
- `/events/:slug/discipline`: the discipline desk, with tabs Cards, Sanctions, Authenticity, Appeals and Suspensions.
  - Every dangerous action asks twice: the first press shows exactly what will happen, inside the sticky action bar.
  - The person picker uses the event's registrations.
  - A desk the caller cannot use is not shown, and the database refuses it anyway.
- Check-in desk, Manage › review and readiness: a discipline block is shown in plain words, and the check-in and override buttons are hidden.
- Organization page and Platform › Rules: suspensions for the organization or the platform, with change, lift and history.
- Platform › Rules: publishing the imported versions.
- Fighter page: the fighter's own discipline record, for the fighter, their captains and authorities.
- Manage › Competitions: "Use the current Buhurt International documents" and the list of attached documents.
- Lyst settings: "Buhurt International cards".

## 8. Skeptical QA pass and what it changed

An independent review agent probed the discipline domain, importer and UI against a local database, with impersonated roles. It reported
12 confirmed and 3 plausible findings. Each one was checked, fixed in migration `20261015000700` and the UI, and covered by a test that fails
without the fix.

| # | Finding | Fix |
| --- | --- | --- |
| 1 | The fighter and their captain could read private reasons (lift, change, withdrawal) through the record history | The history strips reasons and names unless the caller is the authority or event staff |
| 2 | A suspended fighter could be put back into a competition by re-adding a withdrawn entry | The entry check also runs when an entry goes from withdrawn or disqualified back to registered |
| 3 | A team suspension was ignored at check-in, on rosters and for team-only registrations | The team is checked at every step. The roster check reads the entry itself, because triggers run in name order and the competition was not filled in yet |
| 4 | The Secretary could move the start of an appeal's 15-minute window | Refused for event appeals; the window always runs from the end of the fight |
| 5 | Any marshal could withdraw an appeal, with no reason and no audit | Only the Secretary (scorekeeper) or a decider; a reason is required, the withdrawal is audited, and the desk asks twice |
| 6 | Event suspensions could target people not at the event | Refused unless the person or team takes part in the event |
| 7 | Eligibility could be probed for other teams, or for people not at the event | Each subject is authorised separately; staff only for their event's participants |
| 8 | Merging away a team with disciplinary records failed obscurely | A clear refusal ("keep this team when merging"); merging the other way works and the records stay |
| 9 | Organization and platform end dates moved by a day in North America, and further on every edit | Whole days in UTC, like the database (unit test across time zones, and a browser check in America/Edmonton) |
| 10 | An appeal about a fight where nothing was recorded could not be lodged | The desk lists the event's started and finished fights |
| 11 | Event suspension reasons were visible to all desk staff | Visible only to the head marshal and organizers (the issuers) |
| 12 | Account ids were readable through direct table reads | Column grants exclude every `*_by` column |
| 13 | Green card limit and appeal note did not match the cited text | Green card reworded and cited (Infractions 3 + Tournament Structure 2), field green cards counted; appeal note and outcomes corrected to the official text (Outrance 16.3 / 16.4) |
| 14 | A review without a content hash could never go stale | A `verified` review must record `content_sha256`, otherwise it counts as not reviewed (unit test). The example fixtures were bound to their hashes; the BI release already was |
| 15 | Organization suspensions ignored events whose organization comes from their season | They now use `private.event_org`, like every other organization check. **No dedicated test** (fixture shape) |

Finding 14 also notes that the 26 BI reviews and the 42 version confirmations were made by Claude Code during the import, not by a person. That is
how they are attributed in the files, and publishing (Platform › Rules) is the owner's act of acceptance.

## 9. Evidence

| Level | Result |
| --- | --- |
| Source drop | 42 PDFs, `SHA256SUMS.txt` verified; provenance in `release.json` / `fetch-log.json` |
| Import | `reconcile` **PASSED**: 45 inventory, 42 imported, 3 excluded, 0 missing; 1281 provisions; 0 left to review. Re-running `reconcile` + `sql` reproduces migration `20261015000400` byte for byte (`cmp`) |
| Unit tests | Vitest **1031/1031**: importer 22, including reproducibility of the BI release and review binding; rules body/search; readiness; suspension dates across time zones. Typecheck clean. Production build OK |
| Database gate | `run_all.sh` **DATABASE GATE PASSED** (every gate, simulation, league verifier, concurrency, vectors). `pack22_gate` **139**, `pack22_discipline_gate` **119**, `pack22_qa_fixes_gate` **43** checks. Schema fingerprint 2552 lines |
| Browser (real Chromium, built app, real Postgres + PostgREST, 390×844 phone and desktop) | `pack22-live` **71/71**; `pack22-discipline-live` **56/56** |
| Browser with the real Supabase Auth server (REAL_AUTH, every role signs in by password) | `pack22-discipline-live` **57/57**. Auth built locally from `supabase/auth` master `ce9a8ee`, with upstream `godotenv` v1.5.1 in place of the fork, which was not in the module archive |
| Regression browser suites re-run after the fixes | `pack16-live` **66/66**, `pack13-live` **88/88**, `pack18-live` (real Supabase Auth) **67/67** |
| Not re-run in this session | field-pack03, sw-update, pack07-ux, pack08, pack12-app and the other live suites (they passed earlier on this branch, before the import and discipline work) |
| Hosted database | **NOT changed.** None of the seven Pack 22 migrations is applied |
| Deployment / production | **NOT deployed, NOT merged, no PR** |

## 10. What remains (owner / next run)

1. Merge decision and hosted rollout: `docs/runbooks/PACK22_HOSTED_ROLLOUT.md` (seven migrations in order; the 950 KB data migration may need the SQL
   Editor or `psql`).
2. Publish the 42 versions from Platform › Rules after reading them. Nothing is public until then.
3. Owner decisions the documents leave open:
   - whether BuhurtOS should ever apply deterministic score effects of cards (Duel Regulations 4.2, Outrance 15.3); today the officials do;
   - the tier points conflict (section 6), which BuhurtOS does not decide;
   - how an existing entry should be handled when a suspension arrives mid-event; today readiness flags it and the organizer withdraws it.
4. Live verification on a phone after the hosted rollout. NOT VERIFIED.

