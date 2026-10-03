# Hosted database reconciliation, Packs 01-05 (2026-10-03)

Goal: make the hosted Supabase database (project `mvbxlebznlgroptwwdsm`, Postgres 17.11) identical to branch `ccr-a435c5f7-pmrfxr`
(tested at `fd746d4`; migrations 20261003000100..0500) without damaging data.

Status when this file was written: **hosted NOT yet reconciled.** The script is ready, tested locally and waiting for the owner to run it in
the Supabase SQL Editor. Nothing below says hosted is fixed until the post-run checks in "After the owner runs it" are recorded.

## 1. How hosted was compared (read-only)

* One normalized line per object in `public` and `private` (tables, columns, constraints, indexes, policies, functions, views, triggers).
  Function, view and trigger bodies are compared as md5 of the definition with `--` comments removed and whitespace collapsed.
  The query is in `supabase/manual/build_hosted_rollout_packs_01_05.py` (`FP_LINES`).
* Privileges: for every function, table and view, whether `anon` / `authenticated` may execute / select / insert / update / delete (`FP_GRANTS`).
* Data facts: row counts and dependencies (section 4).

Results:

| | objects | schema hash | privilege rows | privilege hash |
|---|---|---|---|---|
| hosted (measured 2026-10-03) | 929 | `cf4b0beeaca3ee2bda16c7895e03b640` | 181 | `238204e7fac161c3c650c81d989a8ad0` |
| local replica, `supabase/manual/build_hosted_replica.sh` | 929 | `cf4b0beeaca3ee2bda16c7895e03b640` | 181 | `238204e7fac161c3c650c81d989a8ad0` |
| branch `fd746d4` (all migrations) | 1037 | `43986d8c12e7a5bbab04485e924e9a69` | 205 | `b5e6b055d964385036f10a98f3910e16` |

The replica is every migration up to `20261001003100`, then Pack 01 without its `drop function private.is_any_organizer()`, then Pack 02
up to `pool_standings`. Its fingerprint equals hosted's exactly, so tests run on the replica show what the script does to hosted's schema.

Raw (un-normalized) differences: 22 hosted function bodies differ from the repository only in whitespace or missing comments. They were
applied earlier through the hosted tool, which stripped comments and indentation:

* `registration_notify`, `cancel_team_join`, `request_team_join`, `request_new_team`: same code, comments missing.
* `merge_teams`, `decide_team_join`: same situation, but both are also older versions (see the table below).
* 16 others: whitespace only.

The script recreates the functions it replaces from the branch build, so those come back with their comments.

## 2. The `private.can_score` question

Hosted had `private.can_score(uuid)` all along. It is the **original definition from `20261001000200_teams_events.sql`**:

```sql
select private.has_event_role(p_event, array['organizer', 'marshal', 'scorekeeper'])
```

That is **HOSTED OLD VERSION**, not missing and not partial. Pack 03 replaces it with the same check plus `head_marshal`. The earlier STATUS
note said that `can_score` was missing. That was wrong: what was missing was the Pack 03 version. `pool_standings` (already on hosted) calls
`can_score`, so it did not error; it just did not know the head marshal role. Hosted's expiry rule (Pack 01, inside `has_event_role`) already
applied to it.

## 3. Object inventory (hosted before reconciliation)

Status is relative to the branch. "Pack" is the migration that introduced or changed the object (`01,02` = changed by both).
Only objects that any of Packs 01-05 touch are listed. Grant rows read "anon/auth" as two digits for execute, or eight digits for
delete/insert/select/update per role. Summary: 61 HOSTED MATCHES, 135 HOSTED MISSING, 12 HOSTED OLD VERSION (two of them obsolete
objects that must be removed), 2 HOSTED PARTIAL, 0 UNKNOWN.

| Pack | Object | Hosted before reconciliation |
|---|---|---|
| 01 | `column public.sources.synthetic` | HOSTED MATCHES |
| 01 | `function private.can_admin_team(p_team uuid)` | HOSTED MATCHES |
| 01 | `function private.can_assign_captain(p_team uuid)` | HOSTED MATCHES |
| 01 | `function private.can_manage_team(p_team uuid)` | HOSTED MATCHES |
| 01 | `function private.event_organizer_users(p_event uuid)` | HOSTED MATCHES |
| 01 | `function private.event_staff_active(p_event uuid)` | HOSTED MATCHES |
| 01 | `function private.has_event_role(p_event uuid, p_roles text[])` | HOSTED MATCHES |
| 01 | `function private.is_any_organizer()` | HOSTED OLD VERSION (obsolete object still present) |
| 01 | `function private.is_synthetic(p_type text, p_id uuid)` | HOSTED MATCHES |
| 01 | `function private.team_managers(p_team uuid)` | HOSTED MATCHES |
| 01 | `function public.approve_team(p_team uuid)` | HOSTED MATCHES |
| 01 | `function public.new_team_request_details(p_team uuid)` | HOSTED MATCHES |
| 01 | `function public.request_new_team(p_payload jsonb)` | HOSTED MATCHES |
| 01 | `function public.team_requests_inbox()` | HOSTED MATCHES |
| 01 | `function public.team_roster(p_team uuid)` | HOSTED MATCHES |
| 01 | `grant f private.can_admin_team(uuid) = 11 (anon/auth exec)` | HOSTED MATCHES |
| 01 | `grant f private.event_staff_active(uuid) = 11 (anon/auth exec)` | HOSTED MATCHES |
| 01 | `grant f private.is_any_organizer() = None (anon/auth exec)` | HOSTED OLD VERSION (obsolete object still present) |
| 01 | `grant f private.is_synthetic(text,uuid) = 11 (anon/auth exec)` | HOSTED MATCHES |
| 01 | `grant t synthetic_records = 00100010 (anon/auth d/i/s/u)` | HOSTED MATCHES |
| 01 | `policy public.team_affiliations team_affiliations_read` | HOSTED MATCHES |
| 01 | `policy public.team_memberships team_memberships_read` | HOSTED MATCHES |
| 01 | `policy public.teams teams_read` | HOSTED MATCHES |
| 01 | `view public.fighter_history` | HOSTED MATCHES |
| 01 | `view public.match_sides` | HOSTED MATCHES |
| 01 | `view public.played_events` | HOSTED MATCHES |
| 01 | `view public.result_rows` | HOSTED MATCHES |
| 01 | `view public.synthetic_records` | HOSTED MATCHES |
| 01,02 | `function public.merge_teams(p_keep uuid, p_remove uuid)` | HOSTED PARTIAL (= state after Pack 01) |
| 01,02 | `view public.team_history` | HOSTED PARTIAL (= state after Pack 01) |
| 02 | `column public.competitions.draw_algorithm` | HOSTED MATCHES |
| 02 | `column public.competitions.draw_mode` | HOSTED MATCHES |
| 02 | `column public.competitions.draw_seed` | HOSTED MATCHES |
| 02 | `column public.competitions.drawn_at` | HOSTED MATCHES |
| 02 | `column public.entries.team_name_at_event` | HOSTED MISSING |
| 02 | `column public.pool_tie_decisions.competition_id` | HOSTED MATCHES |
| 02 | `column public.pool_tie_decisions.decided_at` | HOSTED MATCHES |
| 02 | `column public.pool_tie_decisions.decided_by` | HOSTED MATCHES |
| 02 | `column public.pool_tie_decisions.entry_id` | HOSTED MATCHES |
| 02 | `column public.pool_tie_decisions.note` | HOSTED MATCHES |
| 02 | `column public.pool_tie_decisions.part` | HOSTED MATCHES |
| 02 | `column public.pool_tie_decisions.rank` | HOSTED MATCHES |
| 02 | `column public.result_revisions.action` | HOSTED MISSING |
| 02 | `column public.result_revisions.actor` | HOSTED MISSING |
| 02 | `column public.result_revisions.competition_id` | HOSTED MISSING |
| 02 | `column public.result_revisions.created_at` | HOSTED MISSING |
| 02 | `column public.result_revisions.entry_id` | HOSTED MISSING |
| 02 | `column public.result_revisions.id` | HOSTED MISSING |
| 02 | `column public.result_revisions.new_place` | HOSTED MISSING |
| 02 | `column public.result_revisions.new_points` | HOSTED MISSING |
| 02 | `column public.result_revisions.old_place` | HOSTED MISSING |
| 02 | `column public.result_revisions.old_points` | HOSTED MISSING |
| 02 | `column public.result_revisions.reason` | HOSTED MISSING |
| 02 | `column public.result_revisions.revision` | HOSTED MISSING |
| 02 | `column public.team_merges.kept_team_id` | HOSTED MISSING |
| 02 | `column public.team_merges.merged_at` | HOSTED MISSING |
| 02 | `column public.team_merges.removed_name` | HOSTED MISSING |
| 02 | `column public.team_merges.removed_slug` | HOSTED MISSING |
| 02 | `column public.team_merges.removed_team_id` | HOSTED MISSING |
| 02 | `column public.team_merges.was_public` | HOSTED MISSING |
| 02 | `constraint competitions competitions_draw_mode_check` | HOSTED MATCHES |
| 02 | `constraint pool_tie_decisions pool_tie_decisions_competition_id_fkey` | HOSTED MATCHES |
| 02 | `constraint pool_tie_decisions pool_tie_decisions_entry_id_fkey` | HOSTED MATCHES |
| 02 | `constraint pool_tie_decisions pool_tie_decisions_note_check` | HOSTED MATCHES |
| 02 | `constraint pool_tie_decisions pool_tie_decisions_pkey` | HOSTED MATCHES |
| 02 | `constraint pool_tie_decisions pool_tie_decisions_rank_check` | HOSTED MATCHES |
| 02 | `constraint result_revisions result_revisions_action_check` | HOSTED MISSING |
| 02 | `constraint result_revisions result_revisions_competition_id_entry_id_revision_key` | HOSTED MISSING |
| 02 | `constraint result_revisions result_revisions_competition_id_fkey` | HOSTED MISSING |
| 02 | `constraint result_revisions result_revisions_pkey` | HOSTED MISSING |
| 02 | `constraint team_merges team_merges_kept_team_id_fkey` | HOSTED MISSING |
| 02 | `constraint team_merges team_merges_pkey` | HOSTED MISSING |
| 02 | `function private.base_points(p_pool_wins integer, p_elim_wins integer, p_place integer)` | HOSTED MATCHES |
| 02 | `function private.bump_match_version()` | HOSTED MATCHES |
| 02 | `function private.clear_tie_decisions()` | HOSTED MISSING |
| 02 | `function private.compute_places(p_comp uuid)` | HOSTED MATCHES |
| 02 | `function private.group_ranks(p_comp uuid)` | HOSTED MATCHES |
| 02 | `function private.log_result_revision(p_comp uuid, p_entry uuid, p_action text, p_old_place integer, p_old_points numeric, p_new_place integer, p_new_points numeric, p_reason text)` | HOSTED MISSING |
| 02 | `function private.result_revisions_append_only()` | HOSTED MISSING |
| 02 | `function private.snapshot_entry_team()` | HOSTED MISSING |
| 02 | `function private.tier_points(p_base numeric, p_tier text, p_source text)` | HOSTED MATCHES |
| 02 | `function private.unfinish_competition()` | HOSTED OLD VERSION |
| 02 | `function private.unresolved_ties(p_comp uuid, p_top integer)` | HOSTED MATCHES |
| 02 | `function public.build_schedule(p_competition uuid, p_matches jsonb, p_mode text, p_draw jsonb, p_advance integer)` | HOSTED MISSING |
| 02 | `function public.correct_result(p_competition uuid, p_entry uuid, p_place integer, p_points numeric, p_reason text)` | HOSTED MISSING |
| 02 | `function public.finish_competition(p_competition uuid, p_multiplier_source text)` | HOSTED OLD VERSION |
| 02 | `function public.pool_standings(p_competition uuid)` | HOSTED MATCHES |
| 02 | `function public.record_tie_decision(p_competition uuid, p_part text, p_order uuid[], p_note text)` | HOSTED MISSING |
| 02 | `function public.void_result(p_competition uuid, p_entry uuid, p_reason text)` | HOSTED MISSING |
| 02 | `grant f build_schedule(uuid,jsonb,text,jsonb,integer) = 01 (anon/auth exec)` | HOSTED MISSING |
| 02 | `grant f correct_result(uuid,uuid,integer,numeric,text) = 01 (anon/auth exec)` | HOSTED MISSING |
| 02 | `grant f pool_standings(uuid) = 11 (anon/auth exec)` | HOSTED MATCHES |
| 02 | `grant f private.base_points(integer,integer,integer) = 00 (anon/auth exec)` | HOSTED MATCHES |
| 02 | `grant f private.bump_match_version() = 00 (anon/auth exec)` | HOSTED MATCHES |
| 02 | `grant f private.clear_tie_decisions() = 00 (anon/auth exec)` | HOSTED MISSING |
| 02 | `grant f private.group_ranks(uuid) = 00 (anon/auth exec)` | HOSTED MATCHES |
| 02 | `grant f private.log_result_revision(uuid,uuid,text,integer,numeric,integer,numeric,text) = 00 (anon/auth exec)` | HOSTED MISSING |
| 02 | `grant f private.result_revisions_append_only() = 00 (anon/auth exec)` | HOSTED MISSING |
| 02 | `grant f private.snapshot_entry_team() = 00 (anon/auth exec)` | HOSTED MISSING |
| 02 | `grant f private.tier_points(numeric,text,text) = 00 (anon/auth exec)` | HOSTED MATCHES |
| 02 | `grant f private.unresolved_ties(uuid,integer) = 00 (anon/auth exec)` | HOSTED MATCHES |
| 02 | `grant f record_tie_decision(uuid,text,uuid[],text) = 01 (anon/auth exec)` | HOSTED MISSING |
| 02 | `grant f void_result(uuid,uuid,text) = 01 (anon/auth exec)` | HOSTED MISSING |
| 02 | `grant t pool_tie_decisions = 00000010 (anon/auth d/i/s/u)` | HOSTED MATCHES |
| 02 | `grant t result_revisions = 00000010 (anon/auth d/i/s/u)` | HOSTED MISSING |
| 02 | `grant t results = 00100010 (anon/auth d/i/s/u)` | HOSTED OLD VERSION |
| 02 | `grant t team_merges = 00100010 (anon/auth d/i/s/u)` | HOSTED MISSING |
| 02 | `index public.pool_tie_decisions CREATE UNIQUE INDEX ON public.pool_tie_decisions USING btree (competition_id, entry_id)` | HOSTED MATCHES |
| 02 | `index public.result_revisions CREATE INDEX ON public.result_revisions USING btree (competition_id, created_at)` | HOSTED MISSING |
| 02 | `index public.result_revisions CREATE UNIQUE INDEX ON public.result_revisions USING btree (competition_id, entry_id, revision)` | HOSTED MISSING |
| 02 | `index public.result_revisions CREATE UNIQUE INDEX ON public.result_revisions USING btree (id)` | HOSTED MISSING |
| 02 | `index public.team_merges CREATE UNIQUE INDEX ON public.team_merges USING btree (removed_team_id)` | HOSTED MISSING |
| 02 | `policy public.pool_tie_decisions pool_tie_decisions_read` | HOSTED MATCHES |
| 02 | `policy public.result_revisions result_revisions_read` | HOSTED MISSING |
| 02 | `policy public.results results_organizer_write` | HOSTED OLD VERSION (obsolete object still present) |
| 02 | `policy public.team_merges team_merges_read` | HOSTED MISSING |
| 02 | `table public.pool_tie_decisions` | HOSTED MATCHES |
| 02 | `table public.result_revisions` | HOSTED MISSING |
| 02 | `table public.team_merges` | HOSTED MISSING |
| 02 | `trigger public.entries entries_snapshot_team` | HOSTED MISSING |
| 02 | `trigger public.matches matches_bump_version` | HOSTED MATCHES |
| 02 | `trigger public.matches matches_clear_tie_decisions` | HOSTED MISSING |
| 02 | `trigger public.result_revisions result_revisions_no_change` | HOSTED MISSING |
| 02,03 | `function public.reopen_match(p_match uuid, p_reason text)` | HOSTED OLD VERSION |
| 03 | `column public.result_proposals.created_at` | HOSTED MISSING |
| 03 | `column public.result_proposals.detail` | HOSTED MISSING |
| 03 | `column public.result_proposals.event_id` | HOSTED MISSING |
| 03 | `column public.result_proposals.expected_version` | HOSTED MISSING |
| 03 | `column public.result_proposals.id` | HOSTED MISSING |
| 03 | `column public.result_proposals.match_id` | HOSTED MISSING |
| 03 | `column public.result_proposals.note` | HOSTED MISSING |
| 03 | `column public.result_proposals.official_before` | HOSTED MISSING |
| 03 | `column public.result_proposals.proposed_by` | HOSTED MISSING |
| 03 | `column public.result_proposals.resolution_note` | HOSTED MISSING |
| 03 | `column public.result_proposals.resolved_at` | HOSTED MISSING |
| 03 | `column public.result_proposals.resolved_by` | HOSTED MISSING |
| 03 | `column public.result_proposals.result` | HOSTED MISSING |
| 03 | `column public.result_proposals.schema_version` | HOSTED MISSING |
| 03 | `column public.result_proposals.score_a` | HOSTED MISSING |
| 03 | `column public.result_proposals.score_b` | HOSTED MISSING |
| 03 | `column public.result_proposals.source` | HOSTED MISSING |
| 03 | `column public.result_proposals.status` | HOSTED MISSING |
| 03 | `constraint event_staff event_staff_role_check` | HOSTED OLD VERSION |
| 03 | `constraint result_proposals result_proposals_event_id_fkey` | HOSTED MISSING |
| 03 | `constraint result_proposals result_proposals_match_id_fkey` | HOSTED MISSING |
| 03 | `constraint result_proposals result_proposals_pkey` | HOSTED MISSING |
| 03 | `constraint result_proposals result_proposals_result_check` | HOSTED MISSING |
| 03 | `constraint result_proposals result_proposals_score_a_check` | HOSTED MISSING |
| 03 | `constraint result_proposals result_proposals_score_b_check` | HOSTED MISSING |
| 03 | `constraint result_proposals result_proposals_source_check` | HOSTED MISSING |
| 03 | `constraint result_proposals result_proposals_status_check` | HOSTED MISSING |
| 03 | `function private.can_resolve_results(p_event uuid)` | HOSTED MISSING |
| 03 | `function private.can_score(p_event uuid)` | HOSTED OLD VERSION |
| 03 | `function private.reopen_match_core(p_match uuid, p_reason text)` | HOSTED MISSING |
| 03 | `function public.enter_official_result(p_match uuid, p_result text, p_score_a integer, p_score_b integer, p_detail jsonb, p_note text)` | HOSTED MISSING |
| 03 | `function public.grant_event_role_by_email(p_event uuid, p_email text, p_role text)` | HOSTED OLD VERSION |
| 03 | `function public.list_result_conflicts(p_event uuid)` | HOSTED MISSING |
| 03 | `function public.resolve_result_conflict(p_proposal uuid, p_decision text, p_note text)` | HOSTED MISSING |
| 03 | `grant f enter_official_result(uuid,text,integer,integer,jsonb,text) = 01 (anon/auth exec)` | HOSTED MISSING |
| 03 | `grant f list_result_conflicts(uuid) = 01 (anon/auth exec)` | HOSTED MISSING |
| 03 | `grant f private.can_resolve_results(uuid) = 11 (anon/auth exec)` | HOSTED MISSING |
| 03 | `grant f private.reopen_match_core(uuid,text) = 00 (anon/auth exec)` | HOSTED MISSING |
| 03 | `grant f resolve_result_conflict(uuid,text,text) = 01 (anon/auth exec)` | HOSTED MISSING |
| 03 | `grant f submit_match_result(uuid,uuid,text,integer,integer,jsonb,integer,integer) = 01 (anon/auth exec)` | HOSTED MISSING |
| 03 | `grant t result_proposals = 00000010 (anon/auth d/i/s/u)` | HOSTED MISSING |
| 03 | `index public.result_proposals CREATE INDEX ON public.result_proposals USING btree (event_id) WHERE (status = 'conflict'::text)` | HOSTED MISSING |
| 03 | `index public.result_proposals CREATE INDEX ON public.result_proposals USING btree (match_id, created_at)` | HOSTED MISSING |
| 03 | `index public.result_proposals CREATE UNIQUE INDEX ON public.result_proposals USING btree (id)` | HOSTED MISSING |
| 03 | `policy public.result_proposals result_proposals_read` | HOSTED MISSING |
| 03 | `table public.result_proposals` | HOSTED MISSING |
| 03,04 | `function public.submit_match_result(p_command uuid, p_match uuid, p_result text, p_score_a integer, p_score_b integer, p_detail jsonb, p_expected_version integer, p_schema integer)` | HOSTED MISSING |
| 04 | `function private.command_schema_ok(p_schema integer)` | HOSTED MISSING |
| 04 | `grant f private.command_schema_ok(integer) = 11 (anon/auth exec)` | HOSTED MISSING |
| 05 | `column public.fighter_identity_reviews.candidate_id` | HOSTED MISSING |
| 05 | `column public.fighter_identity_reviews.created_at` | HOSTED MISSING |
| 05 | `column public.fighter_identity_reviews.fighter_id` | HOSTED MISSING |
| 05 | `column public.fighter_identity_reviews.id` | HOSTED MISSING |
| 05 | `column public.fighter_identity_reviews.note` | HOSTED MISSING |
| 05 | `column public.fighter_identity_reviews.reason` | HOSTED MISSING |
| 05 | `column public.fighter_identity_reviews.resolved_at` | HOSTED MISSING |
| 05 | `column public.fighter_identity_reviews.resolved_by` | HOSTED MISSING |
| 05 | `column public.fighter_identity_reviews.source` | HOSTED MISSING |
| 05 | `column public.fighter_identity_reviews.status` | HOSTED MISSING |
| 05 | `constraint fighter_identity_reviews fighter_identity_reviews_candidate_id_fkey` | HOSTED MISSING |
| 05 | `constraint fighter_identity_reviews fighter_identity_reviews_check` | HOSTED MISSING |
| 05 | `constraint fighter_identity_reviews fighter_identity_reviews_fighter_id_candidate_id_key` | HOSTED MISSING |
| 05 | `constraint fighter_identity_reviews fighter_identity_reviews_fighter_id_fkey` | HOSTED MISSING |
| 05 | `constraint fighter_identity_reviews fighter_identity_reviews_pkey` | HOSTED MISSING |
| 05 | `constraint fighter_identity_reviews fighter_identity_reviews_reason_check` | HOSTED MISSING |
| 05 | `constraint fighter_identity_reviews fighter_identity_reviews_source_check` | HOSTED MISSING |
| 05 | `constraint fighter_identity_reviews fighter_identity_reviews_status_check` | HOSTED MISSING |
| 05 | `function private.ensure_fighter_for_account(p_user uuid, p_name text, p_team uuid, p_source text)` | HOSTED MISSING |
| 05 | `function public.decide_registration(p_reg uuid, p_status text)` | HOSTED OLD VERSION |
| 05 | `function public.decide_team_join(p_request uuid, p_decision text)` | HOSTED OLD VERSION |
| 05 | `function public.list_fighter_identity_reviews()` | HOSTED MISSING |
| 05 | `function public.resolve_fighter_identity_review(p_review uuid, p_decision text, p_note text)` | HOSTED MISSING |
| 05 | `grant f list_fighter_identity_reviews() = 01 (anon/auth exec)` | HOSTED MISSING |
| 05 | `grant f private.ensure_fighter_for_account(uuid,text,uuid,text) = 00 (anon/auth exec)` | HOSTED MISSING |
| 05 | `grant f resolve_fighter_identity_review(uuid,text,text) = 01 (anon/auth exec)` | HOSTED MISSING |
| 05 | `grant t fighter_identity_reviews = 00000000 (anon/auth d/i/s/u)` | HOSTED MISSING |
| 05 | `grant t fighter_results_all = 00100010 (anon/auth d/i/s/u)` | HOSTED MISSING |
| 05 | `grant t result_rows_all = 00100010 (anon/auth d/i/s/u)` | HOSTED MISSING |
| 05 | `grant t team_results_all = 00100010 (anon/auth d/i/s/u)` | HOSTED MISSING |
| 05 | `index public.fighter_identity_reviews CREATE INDEX ON public.fighter_identity_reviews USING btree (created_at) WHERE (status = 'open'::text)` | HOSTED MISSING |
| 05 | `index public.fighter_identity_reviews CREATE UNIQUE INDEX ON public.fighter_identity_reviews USING btree (fighter_id, candidate_id)` | HOSTED MISSING |
| 05 | `index public.fighter_identity_reviews CREATE UNIQUE INDEX ON public.fighter_identity_reviews USING btree (id)` | HOSTED MISSING |
| 05 | `table public.fighter_identity_reviews` | HOSTED MISSING |
| 05 | `view public.fighter_results_all` | HOSTED MISSING |
| 05 | `view public.result_rows_all` | HOSTED MISSING |
| 05 | `view public.team_results_all` | HOSTED MISSING |

## 4. Data-preservation analysis

Hosted data on 2026-10-03:

* 17 events. 16 are synthetic, tagged by the NACL-test source. `red-deer-rumble-2026` is real, a **draft** with 17 competitions in setup
  and no results.
* 596 official results, **all on synthetic events**; 0 real results.
* 851 matches (775 final); 652 entries, 109 with a team.
* event_staff: 1 organizer and 1 scorekeeper, both on `red-deer-rumble-test`.
* 20 teams, 121 fighters, 2 fighter accounts, 0 pending registrations or join requests, 0 pool tie decisions, 1043 audit rows.

| Statement | What is removed or replaced | Real rows affected | Synthetic rows affected | Data or schema | Recovery |
|---|---|---|---|---|---|
| `drop function if exists private.is_any_organizer()` | A helper function. No function body, policy or view refers to it (checked: 0 dependents, 0 bodies, 0 policies). | 0 | 0 | schema | Its definition is in `20261001001900_org_control.sql`; recreate if ever needed. Nothing should call it. |
| `drop policy if exists results_organizer_write` + `revoke insert, update, delete on public.results from authenticated` | The policy that let any event organizer write `results` directly, and the matching privileges. | 0 | 0 | schema/privileges | Recreate the policy from `20261001000400_matches_scoring.sql`. Intended to stay removed. |
| `event_staff_role_check` drop + add | The CHECK constraint, replaced by one that also allows `head_marshal`. Existing rows are re-validated: 2 rows, both valid (the guard refuses otherwise). | 0 | 0 | schema | Re-add the old CHECK (only possible while no head_marshal rows exist). |
| `create or replace function` (26 functions) | Old bodies of `finish_competition`, `unfinish_competition`, `reopen_match`, `can_score`, `grant_event_role_by_email`, `decide_registration`, `decide_team_join`, plus the Pack 01 bodies of `merge_teams` and the `team_history` view. | 0 | 0 | code | Old bodies are in the earlier migrations; the replica holds them too. |
| DELETE inside new function bodies (`record_tie_decision`, `clear_tie_decisions`, `finish_competition`, `void_result`, `unfinish_competition`, `build_schedule`, `merge_teams`) | Nothing at rollout time. Later they run only through these audited paths, and every official result they remove is written to `result_revisions` first. | 0 now | 0 now | code | n/a |
| `update public.entries set team_name_at_event = t.name ... where team_name_at_event is null` | Nothing removed: fills the NEW column for the 109 entries with a team. | 0 removed (draft Rumble entries with a team, if any, get their current team name) | the synthetic entries with a team get their current name | additive data | The column is new; set it back to null if ever needed. |

Measured on the seeded replica: after the script ran (twice) and the verification ran (twice), results, matches, competitions, events, teams
and event_staff were byte-identical (md5 of every row), entries were identical apart from the new column, and no verification fixture
remained (0 `zz-verify-` rows, no `zzv` schema). Synthetic data is not deleted or changed by the script.

Run-time effects: every statement is in one transaction (`lock_timeout` 10 s). Creating triggers takes a brief lock on `matches` and
`entries`. The verification's rolled-back transaction consumes some `audit_log_id_seq` values, so audit ids get a gap. Realtime only
publishes committed rows, so nothing is broadcast.

## 5. The script

`supabase/manual/hosted_rollout_packs_01_05.sql`, generated by `supabase/manual/build_hosted_rollout_packs_01_05.py` from a branch build
and the replica. The function bodies are copied from the branch build with `pg_get_functiondef`, so they include the bodies the migrations
build by text-patching.

| Section | Content |
|---|---|
| 0 | Refuses unless `current_user = postgres` and hosted's schema and privilege fingerprints are exactly the measured partial state (or already the target); checks event_staff roles. |
| A | Pack 02 additive: `result_revisions`, `team_merges` (tables, index, RLS, read policies, grants), `entries.team_name_at_event` + backfill. |
| B | Pack 02 functions without DELETE (`log_result_revision`, `result_revisions_append_only`, `correct_result`, `snapshot_entry_team`) and the `team_history` view. |
| C | Statements that drop or replace something: `is_any_organizer`, `results_organizer_write` + revoke, `event_staff_role_check`. |
| D | Pack 02 functions with DELETE in their bodies, and the three new triggers. |
| E | Pack 03: `can_score`, `can_resolve_results`, `grant_event_role_by_email`, `reopen_match_core`, `reopen_match`, `result_proposals`, conflicts, paper path. |
| F | Pack 04: `command_schema_ok` and the final `submit_match_result`. |
| G | Pack 05: `fighter_identity_reviews`, `ensure_fighter_for_account`, `decide_registration`, `decide_team_join`, review functions, `*_all` views. |
| H | Refuses to COMMIT unless the result has exactly the branch's schema and privilege fingerprints. Then commits and runs the verification (135 checks, fixtures rolled back) as the final result table. |

Local evidence (Postgres 16, replica seeded with hosted-shaped data):

* **First run** on the replica: commits; the fingerprint matches the branch; 135/135 checks TRUE.
* **Second run** on the result: notices "already matches", commits, and changes no data; 135/135 TRUE.
* **Refusals.** Each of these exits before changing anything, and the schema is unchanged afterwards:
  * a pre-Packs database
  * a database after Pack 02 in full
  * the replica with one function altered (drift)
  * a non-`postgres` role
* **Canonical migrations.** 0100→0500 applied in order to the replica give exactly the branch fingerprint and privileges (section 6).
* **Full database gate** on the edited migrations: all suites pass, schema fingerprint OK (1041 objects).

## 6. Canonical migrations made rerunnable (Step 4)

Only the two migrations that hosted holds partially were changed, and only where they failed because objects already existed:

* `20261003000100`: `drop function if exists private.is_any_organizer()`.
* `20261003000200`, sections 1-3:
  * `create or replace trigger matches_bump_version`
  * `create table if not exists public.pool_tie_decisions`, followed by an assertion that an existing table has exactly the expected
    columns and 5 constraints (otherwise it raises)
  * `drop policy if exists` + `create policy pool_tie_decisions_read`

The text-patch anchors that 0200, 0300 and 0500 search for exist byte-for-byte in hosted's current bodies (checked on hosted). If one didn't,
those DO blocks raise rather than silently skip.

The clean-build fingerprint is unchanged (`supabase/schema.fingerprint.txt`, 1041 objects). After a full apply the files are still not
meant to be re-run (0100 would try to shrink `team_history`); they are rerunnable from the hosted state as it was on 2026-10-03.

## 7. Migration history: recommendation

The hosted ledger (`supabase_migrations.schema_migrations`) already differs from the repository:

* **Different version numbers before the packs.** For example, hosted has `20261001060802 foundation` where the repository has
  `20261001000100_foundation.sql`.
* **The packs are recorded as chunk names.** `pack01_*` and `pack02_a1/a2` are entries the repository does not have.

So `supabase db push` would refuse ("remote migration versions not found in local migrations directory") before reaching the Packs, and it
**must not be used** until the ledger is repaired. The SQL Editor run of this script will not add a ledger row.

Recommendation: **B, plus A for the existing rows.** Keep the existing rows: they truthfully record what was applied, in chunks. After the
owner runs the script and the post-run checks pass, record one explicit reconciliation migration through the migration tool. It would
contain only an assertion that fails unless hosted's fingerprints equal the branch's, and no DDL. The ledger then states truthfully that
the manual rollout happened and was verified at that point; nothing in it pretends that `20261003000100..0500` ran as files.

Mapping repository versions onto the ledger (`supabase migration repair`, option C) is a separate, post-Rumble decision for the owner.
It is needed only if the CLI workflow (`db push`) is to be used again.

## 8. Advisors (baseline, before the rollout)

Security: 7 INFO `rls_enabled_no_policy` (tables reached only through functions, by design). 7 WARN
`anon_security_definer_function_executable` (`fighter_profile`, `list_active_organizations`, `pool_standings`, `report_bug`, `team_roster`,
`track_activity`, `track_event`: public read or anonymous analytics, by design). 65 WARN `authenticated_security_definer_function_executable`
(the RPC API; each function checks authority itself, tested by the gates). 1 WARN leaked-password protection disabled.

Performance: 34 INFO unindexed foreign keys, 10 WARN `auth_rls_initplan`, 11 WARN multiple permissive policies (one of them is
`results_organizer_write`, which the rollout removes), 1 INFO unused index. Re-run and classify after the rollout.

## After the owner runs it

Record here: time of the run, the final result table (every row should be TRUE), hosted fingerprints re-measured with
`execute_sql`, the hosted permission tests, and the advisors after the change.
