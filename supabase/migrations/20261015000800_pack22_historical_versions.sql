-- Pack 22 (additive): HISTORICAL editions of an official document, side by side with the version in force, never confused with it.
--
-- A historical edition is an earlier version of a document found in the governing body's archive (e.g. Duel Regulations V2024.12 when 26.4 is in
-- force). It is a ruleset_versions row like any other version of the document, marked historical, with:
--   * edition_seq       its place among the document's historical editions (1 = oldest), decided from the documents themselves (cover, footers,
--                       change log), never from file names; the current release's version is newer than every historical edition
--   * edition_evidence  why this file is this document and this edition, in words a reviewer can check
--   * source_files      every archive file that IS this edition (byte-identical copies and files with the same text), with SHA-256 and archive
-- Rules:
--   * a historical edition is NEVER the version in force: it can never take the status 'published'. After review the platform owner publishes it
--     AS HISTORICAL (publish_historical_version), which makes it readable as an older version (status 'superseded'), and nothing else changes;
--   * the current release's importer never touches a historical edition, and the historical importer never touches a current version;
--   * the same text is never two versions of a document; the same file is never two editions;
--   * published historical text is frozen like any published text (corrections go through correct_rule_provision, which keeps the old words).
-- Nothing here changes a current version, a citation, a competition's version or any discipline behaviour.

alter table public.ruleset_versions
  add column if not exists historical boolean not null default false,
  add column if not exists edition_seq integer check (edition_seq is null or edition_seq > 0),
  add column if not exists edition_evidence text check (edition_evidence is null or char_length(edition_evidence) <= 1000),
  add column if not exists source_files jsonb check (source_files is null or jsonb_typeof(source_files) = 'array');
do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'ruleset_versions_historical_shape' and conrelid = 'public.ruleset_versions'::regclass) then
    alter table public.ruleset_versions add constraint ruleset_versions_historical_shape
      check (historical = (edition_seq is not null) and (historical or source_files is null) and (not historical or jsonb_array_length(source_files) > 0));
  end if;
end $do$;
create unique index if not exists ruleset_versions_edition_seq_idx on public.ruleset_versions (ruleset_id, edition_seq) where historical;
comment on column public.ruleset_versions.historical is 'Pack 22: an earlier edition from the governing body''s archive. Never the version in force (never status published).';
comment on column public.ruleset_versions.edition_seq is 'Pack 22: order among the document''s historical editions, 1 = oldest, from the documents'' own evidence.';
comment on column public.ruleset_versions.source_files is 'Pack 22: the archive files that are this edition: [{file, archive, sha256, drive_file_id}].';
-- The API reads the new columns like the other version facts (published_by stays hidden).
grant select (historical, edition_seq, edition_evidence, source_files) on public.ruleset_versions to anon, authenticated;

-- The version guard, extended: a historical edition never becomes the version in force, and what it is stays what it is.
create or replace function private.ruleset_version_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'in_review') or new.published_at is not null or new.successor_version_id is not null then
      raise exception 'a new ruleset version starts as a draft or in review: it is published through publish_ruleset_version' using errcode = 'P0001'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'in_review') then raise exception 'a published ruleset version is never deleted: withdraw or supersede it' using errcode = 'P0001'; end if;
    return old;
  end if;
  if new.historical is distinct from old.historical then raise exception 'a version is historical or not from the moment it is imported; that never changes' using errcode = 'P0001'; end if;
  if old.status in ('published', 'superseded', 'withdrawn') and
     (new.ruleset_id, new.version, new.title, new.published_on, new.source_url, new.source_sha256, new.page_count, new.import_release, new.content_sha256, new.synthetic, new.effective_from, new.imported_at, new.published_at, new.published_by,
      new.edition_seq, new.edition_evidence, new.source_files)
     is distinct from
     (old.ruleset_id, old.version, old.title, old.published_on, old.source_url, old.source_sha256, old.page_count, old.import_release, old.content_sha256, old.synthetic, old.effective_from, old.imported_at, old.published_at, old.published_by,
      old.edition_seq, old.edition_evidence, old.source_files) then
    raise exception 'a published ruleset version cannot be changed: import a new version instead' using errcode = 'P0001';
  end if;
  if new.historical then
    if new.status = 'published' then
      raise exception 'a historical edition is never the version in force: publish it as historical (publish_historical_version)' using errcode = 'P0001'; end if;
    if new.status is distinct from old.status and not (
         (old.status = 'draft' and new.status = 'in_review') or (old.status = 'in_review' and new.status in ('draft', 'superseded'))
      or (old.status = 'superseded' and new.status = 'withdrawn')) then
      raise exception 'a historical edition cannot move from % to %', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status = 'superseded' and old.status = 'in_review' and new.published_at is null then raise exception 'publish it through publish_historical_version' using errcode = 'P0001'; end if;
  else
    if new.status is distinct from old.status and not (
         (old.status = 'draft' and new.status = 'in_review') or (old.status = 'in_review' and new.status in ('draft', 'published'))
      or (old.status = 'published' and new.status in ('superseded', 'withdrawn')) or (old.status = 'superseded' and new.status = 'withdrawn')) then
      raise exception 'a ruleset version cannot move from % to %', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status = 'superseded' and new.successor_version_id is null then raise exception 'say which version supersedes this one' using errcode = 'P0001'; end if;
  end if;
  if new.status = 'withdrawn' and new.withdrawn_reason is null then raise exception 'say why this version is withdrawn' using errcode = 'P0001'; end if;
  if old.successor_version_id is not null and new.successor_version_id is distinct from old.successor_version_id then raise exception 'the superseding version is permanent' using errcode = 'P0001'; end if;
  if new.status = 'published' and (new.published_at is null) then raise exception 'publish through publish_ruleset_version' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.ruleset_version_guard() from public, anon, authenticated;

-- The current release's importer, unchanged except that it refuses to touch a historical edition (and it never creates one).
create or replace function private.rules_import_version(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(coalesce(p ->> 'governing_body', ''));
  v_ver jsonb := p -> 'version';
  v_set public.rulesets; v_old public.ruleset_versions; v_vid uuid; v_pr jsonb; v_parent uuid; v_n int := 0; v_status text;
  v_content text := coalesce(v_ver ->> 'content_sha256', '');
begin
  if v_ver is null or coalesce(v_ver ->> 'version', '') = '' then raise exception 'version is required' using errcode = '22023'; end if;
  if v_content !~ '^[0-9a-f]{64}$' then raise exception 'content_sha256 is required' using errcode = '22023'; end if;
  if jsonb_typeof(p -> 'provisions') <> 'array' then raise exception 'provisions must be a list' using errcode = '22023'; end if;
  if coalesce((v_ver ->> 'historical')::boolean, false) then raise exception 'a historical edition is loaded by rules_import_historical_version' using errcode = '22023'; end if;
  select * into v_set from public.rulesets where governing_body = v_body and inventory_key = p ->> 'inventory_key';
  if not found then raise exception 'document % is not in the % inventory: import the inventory first', p ->> 'inventory_key', v_body using errcode = 'P0002'; end if;
  v_status := case when coalesce((v_ver -> 'reconciliation' ->> 'ok')::boolean, false) then 'in_review' else 'draft' end;
  select * into v_old from public.ruleset_versions where ruleset_id = v_set.id and version = v_ver ->> 'version';
  if found then
    if v_old.historical then
      raise exception '% % is a historical edition: the current release never replaces it', v_set.name, v_old.version using errcode = 'P0001'; end if;
    if v_old.content_sha256 = v_content and v_old.source_sha256 is not distinct from (v_ver ->> 'source_sha256') then
      return jsonb_build_object('status', 'unchanged', 'version_id', v_old.id);
    end if;
    if v_old.status not in ('draft', 'in_review') then
      raise exception '% % is already %: a changed official file is imported as a new version, never over the old one', v_set.name, v_old.version, v_old.status using errcode = 'P0001';
    end if;
    delete from public.rule_provisions where ruleset_version_id = v_old.id;
    update public.ruleset_versions set title = v_ver ->> 'title', published_on = (v_ver ->> 'published_on')::date, source_url = v_ver ->> 'source_url', source_sha256 = v_ver ->> 'source_sha256',
      source_retrieved_at = (v_ver ->> 'retrieved_at')::timestamptz, page_count = (v_ver ->> 'page_count')::int, import_release = p ->> 'release', extractor = v_ver ->> 'extractor',
      content_sha256 = v_content, reconciliation = v_ver -> 'reconciliation', imported_at = now(), effective_from = (v_ver ->> 'effective_from')::date,
      source_id = coalesce(v_set.inventory_source_id, source_id), status = v_status, synthetic = coalesce((p ->> 'synthetic')::boolean, false), note = left(v_ver ->> 'note', 500)
    where id = v_old.id;
    v_vid := v_old.id;
  else
    insert into public.ruleset_versions (ruleset_id, version, source_id, effective_from, note, title, status, published_on, source_url, source_sha256, source_retrieved_at, page_count,
                                         import_release, extractor, content_sha256, reconciliation, imported_at, synthetic)
    values (v_set.id, v_ver ->> 'version', v_set.inventory_source_id, (v_ver ->> 'effective_from')::date, left(v_ver ->> 'note', 500), v_ver ->> 'title', v_status, (v_ver ->> 'published_on')::date,
            v_ver ->> 'source_url', v_ver ->> 'source_sha256', (v_ver ->> 'retrieved_at')::timestamptz, (v_ver ->> 'page_count')::int, p ->> 'release', v_ver ->> 'extractor', v_content,
            v_ver -> 'reconciliation', now(), coalesce((p ->> 'synthetic')::boolean, false))
    returning id into v_vid;
  end if;
  for v_pr in select * from jsonb_array_elements(p -> 'provisions') loop
    v_parent := null;
    if coalesce(v_pr ->> 'parent_key', '') <> '' then
      select id into v_parent from public.rule_provisions where ruleset_version_id = v_vid and stable_key = v_pr ->> 'parent_key';
      if v_parent is null then raise exception 'provision % names parent % which does not come before it', v_pr ->> 'stable_key', v_pr ->> 'parent_key' using errcode = '22023'; end if;
    end if;
    insert into public.rule_provisions (ruleset_version_id, parent_id, ordinal, depth, kind, number, title, body, page_from, page_to, stable_key, content_sha256, review_status, review_note,
                                        topics, keywords, cross_refs, has_figures, extraction)
    values (v_vid, v_parent, (v_pr ->> 'ordinal')::int, coalesce((v_pr ->> 'depth')::smallint, 0), v_pr ->> 'kind', nullif(v_pr ->> 'number', ''), nullif(v_pr ->> 'title', ''), coalesce(v_pr ->> 'body', ''),
            (v_pr ->> 'page_from')::int, (v_pr ->> 'page_to')::int, v_pr ->> 'stable_key', v_pr ->> 'content_sha256', coalesce(v_pr ->> 'review_status', 'extracted'), nullif(v_pr ->> 'review_note', ''),
            coalesce((select array_agg(x) from jsonb_array_elements_text(v_pr -> 'topics') x), '{}'), coalesce((select array_agg(x) from jsonb_array_elements_text(v_pr -> 'keywords') x), '{}'),
            coalesce((select array_agg(x) from jsonb_array_elements_text(v_pr -> 'cross_refs') x), '{}'),
            coalesce((v_pr ->> 'has_figures')::boolean, false), coalesce(nullif(v_pr ->> 'extraction', ''), 'text'));
    v_n := v_n + 1;
  end loop;
  if v_n <> coalesce((v_ver -> 'reconciliation' ->> 'provisions')::int, v_n) then
    raise exception 'the release says % provisions but % were given', v_ver -> 'reconciliation' ->> 'provisions', v_n using errcode = '22023'; end if;
  perform private.audit(null, 'rules.version_imported', v_vid::text, jsonb_build_object('document', v_set.inventory_key, 'version', v_ver ->> 'version', 'provisions', v_n, 'status', v_status, 'content_sha256', v_content, 'release', p ->> 'release'));
  return jsonb_build_object('status', case when v_old.id is null then 'new' else 'replaced' end, 'version_id', v_vid, 'provisions', v_n, 'version_status', v_status);
end $$;
revoke execute on function private.rules_import_version(jsonb) from public, anon, authenticated;

-- The historical importer (database owner only, run as a generated migration). Idempotent like the current one; it refuses:
--   * a label the document already uses for a CURRENT version (it never touches one);
--   * a text another version of the document already has (one edition is one version), or a file another historical edition already is;
--   * an edition without its archive files, order or evidence.
create or replace function private.rules_import_historical_version(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(coalesce(p ->> 'governing_body', ''));
  v_ver jsonb := p -> 'version';
  v_set public.rulesets; v_old public.ruleset_versions; v_twin public.ruleset_versions; v_vid uuid; v_pr jsonb; v_parent uuid; v_n int := 0; v_status text;
  v_content text := coalesce(v_ver ->> 'content_sha256', '');
  v_seq int := (v_ver ->> 'edition_seq')::int;
  v_files jsonb := v_ver -> 'source_files';
begin
  if v_ver is null or coalesce(v_ver ->> 'version', '') = '' then raise exception 'version is required' using errcode = '22023'; end if;
  if not coalesce((v_ver ->> 'historical')::boolean, false) then raise exception 'only a historical edition is loaded here' using errcode = '22023'; end if;
  if v_content !~ '^[0-9a-f]{64}$' then raise exception 'content_sha256 is required' using errcode = '22023'; end if;
  if coalesce(v_ver ->> 'source_sha256', '') !~ '^[0-9a-f]{64}$' then raise exception 'source_sha256 is required' using errcode = '22023'; end if;
  if v_seq is null or v_seq < 1 then raise exception 'edition_seq (the order of the edition) is required' using errcode = '22023'; end if;
  if char_length(coalesce(v_ver ->> 'edition_evidence', '')) < 20 then raise exception 'edition_evidence is required' using errcode = '22023'; end if;
  if jsonb_typeof(v_files) <> 'array' or jsonb_array_length(v_files) = 0
     or exists (select 1 from jsonb_array_elements(v_files) f where coalesce(f ->> 'file', '') = '' or coalesce(f ->> 'sha256', '') !~ '^[0-9a-f]{64}$') then
    raise exception 'source_files must list every archive file of the edition with its sha256' using errcode = '22023'; end if;
  if jsonb_typeof(p -> 'provisions') <> 'array' then raise exception 'provisions must be a list' using errcode = '22023'; end if;
  select * into v_set from public.rulesets where governing_body = v_body and inventory_key = p ->> 'inventory_key';
  if not found then raise exception 'document % is not in the % inventory: import the inventory first', p ->> 'inventory_key', v_body using errcode = 'P0002'; end if;
  v_status := case when coalesce((v_ver -> 'reconciliation' ->> 'ok')::boolean, false) then 'in_review' else 'draft' end;
  select * into v_old from public.ruleset_versions where ruleset_id = v_set.id and version = v_ver ->> 'version';
  if found and not v_old.historical then
    raise exception '% % is a current version: a historical edition never replaces it', v_set.name, v_old.version using errcode = 'P0001'; end if;
  select * into v_twin from public.ruleset_versions where ruleset_id = v_set.id and id is distinct from v_old.id and (content_sha256 = v_content or source_sha256 = v_ver ->> 'source_sha256') limit 1;
  if found then
    raise exception '% %: the same % as version % (one edition is one version)', v_set.name, v_ver ->> 'version',
      case when v_twin.source_sha256 = v_ver ->> 'source_sha256' then 'file' else 'text' end, v_twin.version using errcode = 'P0001'; end if;
  if v_old.id is not null then
    if v_old.content_sha256 = v_content and v_old.source_sha256 is not distinct from (v_ver ->> 'source_sha256') and v_old.edition_seq = v_seq and v_old.source_files = v_files then
      return jsonb_build_object('status', 'unchanged', 'version_id', v_old.id);
    end if;
    if v_old.status not in ('draft', 'in_review') then
      raise exception '% % is already %: a historical edition is corrected through correct_rule_provision, never re-imported over', v_set.name, v_old.version, v_old.status using errcode = 'P0001';
    end if;
    delete from public.rule_provisions where ruleset_version_id = v_old.id;
    update public.ruleset_versions set title = v_ver ->> 'title', published_on = (v_ver ->> 'published_on')::date, source_url = v_ver ->> 'source_url', source_sha256 = v_ver ->> 'source_sha256',
      page_count = (v_ver ->> 'page_count')::int, import_release = p ->> 'history', extractor = v_ver ->> 'extractor', content_sha256 = v_content, reconciliation = v_ver -> 'reconciliation',
      imported_at = now(), effective_from = (v_ver ->> 'effective_from')::date, source_id = coalesce(v_set.inventory_source_id, source_id), status = v_status, note = left(v_ver ->> 'note', 500),
      edition_seq = v_seq, edition_evidence = left(v_ver ->> 'edition_evidence', 1000), source_files = v_files
    where id = v_old.id;
    v_vid := v_old.id;
  else
    insert into public.ruleset_versions (ruleset_id, version, source_id, effective_from, note, title, status, published_on, source_url, source_sha256, page_count,
                                         import_release, extractor, content_sha256, reconciliation, imported_at, synthetic, historical, edition_seq, edition_evidence, source_files)
    values (v_set.id, v_ver ->> 'version', v_set.inventory_source_id, (v_ver ->> 'effective_from')::date, left(v_ver ->> 'note', 500), v_ver ->> 'title', v_status, (v_ver ->> 'published_on')::date,
            v_ver ->> 'source_url', v_ver ->> 'source_sha256', (v_ver ->> 'page_count')::int, p ->> 'history', v_ver ->> 'extractor', v_content,
            v_ver -> 'reconciliation', now(), v_set.synthetic, true, v_seq, left(v_ver ->> 'edition_evidence', 1000), v_files)
    returning id into v_vid;
  end if;
  for v_pr in select * from jsonb_array_elements(p -> 'provisions') loop
    v_parent := null;
    if coalesce(v_pr ->> 'parent_key', '') <> '' then
      select id into v_parent from public.rule_provisions where ruleset_version_id = v_vid and stable_key = v_pr ->> 'parent_key';
      if v_parent is null then raise exception 'provision % names parent % which does not come before it', v_pr ->> 'stable_key', v_pr ->> 'parent_key' using errcode = '22023'; end if;
    end if;
    insert into public.rule_provisions (ruleset_version_id, parent_id, ordinal, depth, kind, number, title, body, page_from, page_to, stable_key, content_sha256, review_status, review_note,
                                        topics, keywords, cross_refs, has_figures, extraction)
    values (v_vid, v_parent, (v_pr ->> 'ordinal')::int, coalesce((v_pr ->> 'depth')::smallint, 0), v_pr ->> 'kind', nullif(v_pr ->> 'number', ''), nullif(v_pr ->> 'title', ''), coalesce(v_pr ->> 'body', ''),
            (v_pr ->> 'page_from')::int, (v_pr ->> 'page_to')::int, v_pr ->> 'stable_key', v_pr ->> 'content_sha256', coalesce(v_pr ->> 'review_status', 'extracted'), nullif(v_pr ->> 'review_note', ''),
            coalesce((select array_agg(x) from jsonb_array_elements_text(v_pr -> 'topics') x), '{}'), coalesce((select array_agg(x) from jsonb_array_elements_text(v_pr -> 'keywords') x), '{}'),
            coalesce((select array_agg(x) from jsonb_array_elements_text(v_pr -> 'cross_refs') x), '{}'),
            coalesce((v_pr ->> 'has_figures')::boolean, false), coalesce(nullif(v_pr ->> 'extraction', ''), 'text'));
    v_n := v_n + 1;
  end loop;
  if v_n <> coalesce((v_ver -> 'reconciliation' ->> 'provisions')::int, v_n) then
    raise exception 'the history says % provisions but % were given', v_ver -> 'reconciliation' ->> 'provisions', v_n using errcode = '22023'; end if;
  perform private.audit(null, 'rules.historical_version_imported', v_vid::text, jsonb_build_object('document', v_set.inventory_key, 'version', v_ver ->> 'version', 'edition_seq', v_seq,
    'provisions', v_n, 'status', v_status, 'content_sha256', v_content, 'history', p ->> 'history', 'files', (select jsonb_agg(f ->> 'file') from jsonb_array_elements(v_files) f)));
  return jsonb_build_object('status', case when v_old.id is null then 'new' else 'replaced' end, 'version_id', v_vid, 'provisions', v_n, 'version_status', v_status);
end $$;
revoke execute on function private.rules_import_historical_version(jsonb) from public, anon, authenticated;

-- The platform owner publishes a reviewed historical edition AS HISTORICAL: it becomes readable as an older version ('superseded'), pointing at the
-- next newer edition (or the document's current version). The version in force, competitions and citations are untouched.
create or replace function public.publish_historical_version(p_version uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.ruleset_versions; v_next uuid; v_open int;
begin
  if not coalesce(private.is_owner(), false) then raise exception 'only the platform owner publishes a historical edition' using errcode = '42501'; end if;
  select * into v from public.ruleset_versions where id = p_version for update;
  if not found then raise exception 'ruleset version not found' using errcode = 'P0002'; end if;
  if not v.historical then raise exception 'this is not a historical edition: a current version is published through publish_ruleset_version' using errcode = 'P0001'; end if;
  if v.status = 'superseded' then return jsonb_build_object('status', 'duplicate'); end if;
  if v.status <> 'in_review' then raise exception 'only a historical edition in review can be published (this one is %)', v.status using errcode = 'P0001'; end if;
  if not coalesce((v.reconciliation ->> 'ok')::boolean, false) then raise exception 'the source reconciliation for this edition did not pass' using errcode = 'P0001'; end if;
  select count(*) into v_open from public.rule_provisions where ruleset_version_id = p_version and review_status = 'needs_review';
  if v_open > 0 then raise exception '% provision(s) still need review against the archived document', v_open using errcode = 'P0001'; end if;
  if not exists (select 1 from public.rule_provisions where ruleset_version_id = p_version) then raise exception 'this edition has no provisions' using errcode = 'P0001'; end if;
  -- the next newer edition, else the document's current version (the one in force, else the newest current-release version)
  select id into v_next from public.ruleset_versions where ruleset_id = v.ruleset_id and historical and edition_seq > v.edition_seq order by edition_seq limit 1;
  if v_next is null then
    select id into v_next from public.ruleset_versions where ruleset_id = v.ruleset_id and not historical and status <> 'withdrawn'
      order by (status = 'published') desc, imported_at desc nulls last limit 1;
  end if;
  update public.ruleset_versions set status = 'superseded', successor_version_id = v_next, published_at = now(), published_by = auth.uid(),
    note = coalesce(left(nullif(btrim(p_note), ''), 500), note) where id = p_version;
  perform private.audit(null, 'rules.historical_version_published', p_version::text, jsonb_build_object('ruleset', v.ruleset_id, 'version', v.version, 'edition_seq', v.edition_seq, 'next', v_next,
    'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('status', 'ok', 'next', v_next);
end $$;
revoke execute on function public.publish_historical_version(uuid, text) from public, anon;
grant execute on function public.publish_historical_version(uuid, text) to authenticated;

-- The discipline log says when a cited rule is from an earlier (historical) edition (one more field; everything else as before).
create or replace function public.event_discipline_log(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.can_score(p_event) then raise exception 'only this event''s officials can read its discipline log' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select d.id, d.match_id, d.round_no, d.side, d.kind, d.label, d.amount, d.related_id, d.created_at, d.voided_at,
             dp.reason, dp.called_by, dp.void_reason,
             nullif(btrim(pr.display_name), '') as recorded_by_name,
             (dp.recorded_by = auth.uid()) as recorded_by_me,
             m.field, m.round_label, m.queue_state, k.id as competition_id, k.name as competition_name,
             en.id as entry_id, en.fighter_id, en.team_id, coalesce(f.display_name, t.name) as against,
             cite.provision_id, rp.number as rule_number, rp.title as rule_title, rs.name as rule_document, rv.version as rule_version, rv.status as rule_version_status, rv.historical as rule_version_historical,
             (select count(*) from public.match_discipline_rules z where z.discipline_id = d.id) as citation_changes
      from public.match_discipline d
      join public.match_discipline_private dp on dp.discipline_id = d.id
      join public.matches m on m.id = d.match_id
      join public.competitions k on k.id = m.competition_id
      left join public.entries en on en.id = case d.side when 'a' then m.entry_a else m.entry_b end
      left join public.fighters f on f.id = en.fighter_id
      left join public.teams t on t.id = en.team_id
      left join public.profiles pr on pr.id = dp.recorded_by
      left join lateral (select r.provision_id from public.match_discipline_rules r where r.discipline_id = d.id order by r.created_at desc, r.id desc limit 1) cite on true
      left join public.rule_provisions rp on rp.id = cite.provision_id
      left join public.ruleset_versions rv on rv.id = rp.ruleset_version_id
      left join public.rulesets rs on rs.id = rv.ruleset_id
      where d.event_id = p_event
    ) x), '[]'::jsonb);
end $$;
