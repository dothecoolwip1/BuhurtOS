# Report, evidence and handoff

## Files (documented: owner request 2026-10-31 and earlier reports)

```
docs/test-reports/<YYYY-MM-DD>/
  full-rehearsal-<build>.md            the report (a narrower run uses its own name, e.g. retest-<build>.md)
  full-rehearsal-<build>.html          HTML companion with the same content and the screenshots inline or linked
  full-rehearsal-<build>-evidence/
    <step>-<short-name>-<viewport>.png sanitized screenshots, one per PASS or FAIL point
    measurements.json                  layout measurements (shape below)
    steps.json                         one object per step (shape below)
    console-network.json               sanitized console errors and failed / slow requests
```

`<YYYY-MM-DD>` is the UTC date the run started. `<build>` is the short commit in the footer at the start. If the build changes mid-run,
keep the starting build in the file name and record every build change in the report.

Upload: commit only these files to a `codex/` branch (for example `codex/full-rehearsal-2026-11-02`), push, then open each GitHub URL
(`https://github.com/dothecoolwip1/BuhurtOS/blob/<branch>/docs/test-reports/...`) and confirm it loads before reporting it. Uploading is
allowed only when the run prompt or the owner authorizes it. Never claim an upload that you did not confirm.

## Before saving any evidence

- Screenshots: redact or crop QR codes, QR links, sign-in codes, email addresses of test accounts, device tokens and account ids. If it cannot
  be redacted, do not save it; note "screenshot withheld: contained <kind>".
- Logs and network: keep only the RPC or path name, HTTP status, time and duration. Strip query strings, `apikey`, `Authorization`, cookies
  and request bodies that contain ids.
- Never paste passwords or codes into the report, even redacted to their length.

## Report layout

```markdown
# <Run name>: <build>: <complete | partial: N of M steps run>

Site, UTC window, builds seen (with the time each was first seen), browser (Microsoft Edge <version>), and this sentence:
"Phone and tablet sizes are browser viewports with touch emulation, not physical devices."

## Profiles and roles actually used
(table from profiles.md, then the profile log)

## Preflight
Build check, accounts available, event creation check.

## Step ledger
| Step | Status | UTC | Build | Role / profile / viewport | Evidence | Failure text |
Every requested step appears, with PASS, FAIL or NOT RUN. A NOT RUN gives its reason.

## Failures and suggested fixes
One section per FAIL, using the fields in SKILL.md §6.

## Contradictions
| Requested | Documented (file, section) | App behaviour | Tested against |

## Local automated tests (only if run)
Command, commit, result. Labelled separately from production browser checks.

## Supabase health
From supabase-health.md, or "NOT RUN: <reason>".

## Verified
## Not verified, and why
## Synthetic records created
Name, kind, public URL (no ids that identify an account).
## Real records changed
Must be "None". If anything real was touched, say exactly what, when, and stop the run.
```

## JSON shapes (assumption: matches the 2026-10-30 reports, extended with role, profile and viewport)

`steps.json`:

```json
[{ "step": "8.3", "case": "T20", "status": "PASS", "utc": "2026-11-02T18:04:11Z", "build": "abc1234",
   "role": "Organizer", "profile": "Profile A", "viewport": "1440x900",
   "text": "exact on-screen text for a FAIL", "screenshot": "8.3-ko-official-desk.png",
   "request": { "name": "outrance_finish", "status": 200, "ms": 412 } }]
```

`measurements.json`: one entry per screen measured, produced by `scripts/measure-layout.js`:

```json
[{ "step": "11", "screen": "counter pad", "utc": "...", "build": "...", "viewport": "390x844",
   "measure": { "innerWidth": 390, "scrollWidth": 390, "overflow": false, "minTarget": 44,
                "small": [{ "text": "Sign in", "height": 40, "width": 70 }], "targets": [ ... ] } }]
```

## Closing message for Claude (always the last thing in the run)

Give this as one fenced block the owner can copy:

```text
BuhurtOS rehearsal handoff
Build tested: <commit> (footer), UTC <start>–<end>; build changes: <none | list>
Run: <complete | partial: N of M steps>; profiles used: <count> (table in report)
Main passes: <case ids and one line each>
Main failures: <case id, severity, exact text, one line each>
Not run / not verified: <case ids and reasons>
Supabase health: <summary | NOT RUN: reason>
Suggested fix priorities: 1. <...> 2. <...> 3. <...>
Report: <verified GitHub URL of the .md>
HTML: <verified GitHub URL>
Evidence: <verified GitHub URL of the evidence folder>
Branch: codex/<name> @ <commit>
Real records changed: none
```

If any URL could not be confirmed, write "upload not verified" in its place.
