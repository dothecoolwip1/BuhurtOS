# Production export and restore runbook

Owner decision (2026-10-03): BuhurtOS stays on the Supabase Free plan. The Free plan has **no downloadable platform backup and no point-in-time recovery**, so
the only recovery we control is an export we take ourselves. Take **one full export shortly before the Red Deer Rumble (Nov 14 to 15, 2026)** and store it in
**at least two places that are not Supabase**. This runbook makes that export repeatable. It has been rehearsed on a local database; **the real production
export has not been taken** (it needs the production database password, which only the owner holds).

Accepted risk, kept on record: if the hosted project is lost or paused for long, everything since the last export is lost.

## What you need
- The production database connection string (Supabase dashboard > Project Settings > Database > Connection string, URI, session mode). Keep it out of git, chat and shell history where you can.
- `postgresql-client` (`pg_dump`, `psql`), major version equal to or newer than the server's (production is Postgres 17).
- A disposable local Postgres for the restore rehearsal.
- Somewhere encrypted to store the result twice (for example an encrypted external drive and a second cloud account that is not Supabase).

## 1. Take the export
```bash
export SOURCE_DB_URL='postgresql://postgres:<password>@db.mvbxlebznlgroptwwdsm.supabase.co:5432/postgres'
CONFIRM_EXPORT=yes scripts/ops/export_production.sh ~/buhurtos-exports
```
Output folder `buhurtos-<UTC timestamp>/`:

| File | Purpose |
| --- | --- |
| `schema.sql` | tables, functions, policies, views (schemas `public`, `private`, `auth`, `storage`, `supabase_migrations`) |
| `data.sql` | all rows of those schemas |
| `rowcounts.tsv` | exact row count per table at export time |
| `manifest.txt` | date, source host (no password), server version, **migration head in the database**, migration head in the repository, tool version |
| `SHA256SUMS` | checksums of the four files above |

Check `manifest.txt`: `migration_head` (database) should equal the newest file in `supabase/migrations` (repository). If they differ, production is behind or ahead
of the repository; write that down before relying on the export.

## 2. Files that are not in the database dump
`storage.objects` rows are exported, but the **files** (team emblems, fighter photos) live in Storage buckets. Download them separately: dashboard > Storage,
or with the Supabase CLI `supabase storage cp -r ss:///<bucket> ./storage-<bucket> --experimental`. These are small and cosmetic; paper score sheets and the database are what matter.

## 3. Rehearse the restore (do this before trusting the export)
```bash
# a throwaway local Postgres, not a hosted project
PGHOST=/var/tmp/run PGPORT=55432 PGUSER=postgres scripts/ops/restore_rehearsal.sh ~/buhurtos-exports/buhurtos-<stamp>
```
The script verifies `SHA256SUMS`, loads the schema and data into a scratch database and compares every table's row count to `rowcounts.tsv`. It prints
`RESTORE OK` only when every table matches. Errors about extensions or roles that a plain Postgres lacks (pg_cron, Supabase roles) are expected; review the logs
it leaves in the export folder. A restore to a **new Supabase project** is the same two files loaded with `psql` after creating the project, then re-applying
`supabase/migrations` is **not** needed (the schema is in `schema.sql`); re-create the auth providers, SMTP and Realtime publication settings from the dashboard notes.

## 4. Store it
1. Encrypt the whole folder (for example `tar c buhurtos-<stamp> | gpg -c > buhurtos-<stamp>.tar.gpg`). The `auth` schema contains emails and provider data; **the export is personal data**.
2. Copy the encrypted file to two separate locations that are not Supabase. Record both locations and the date in `docs/claude-packs/STATUS.md` (not the password).
3. Delete the plaintext folder from shared machines once both copies are verified (`sha256sum -c` after copying).

## 5. When to repeat
Once before the Rumble (the owner's decision), and again right after the Rumble because that is when the sporting records are new. Re-run steps 1 to 4.

## Not covered
Point-in-time recovery, automatic scheduled backups and a read replica require a paid Supabase plan or an external scheduler. They are deliberately out of scope until the owner decides otherwise.
