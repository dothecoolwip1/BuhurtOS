-- Pack 22 (additive): fixes from the skeptical QA pass over the historical editions (migrations 20261015000800 / 20261015000900).
--   * a historical edition is loaded, re-ordered and published ONLY through rules_import_historical_version / publish_historical_version (a session
--     flag they set); the owner's direct table access cannot insert one, change its order/evidence/files, or publish it past the review gates;
--     once published nothing about it changes (its words change only through correct_rule_provision)
--   * publishing an edition records no successor (it could point at an unpublished or later-withdrawn version) and keeps the edition's own note
--   * one archive file is one edition anywhere, one text is one version of a document: both importers check against every version
--   * the historical importer also notices a changed official link, title or note (so a corrected history re-imports)
--   * an earlier edition is for reading: a competition cannot be linked to one, and no new rule citation can name one
-- Current versions, current citations, competitions already linked and every discipline record are untouched.

create or replace function private.ruleset_version_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'in_review') or new.published_at is not null or new.successor_version_id is not null then
      raise exception 'a new ruleset version starts as a draft or in review: it is published through publish_ruleset_version' using errcode = 'P0001'; end if;
    if new.historical and not coalesce(current_setting('bos.rules_historical', true), '') = 'on' then
      raise exception 'a historical edition is loaded only by the historical importer (rules_import_historical_version)' using errcode = 'P0001'; end if;
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
    -- what an edition is (its order, evidence and files) and its publication change only through the controlled functions, never by direct writes
    if (new.edition_seq, new.edition_evidence, new.source_files) is distinct from (old.edition_seq, old.edition_evidence, old.source_files) and not coalesce(current_setting('bos.rules_historical', true), '') = 'on' then
      raise exception 'an edition''s order, evidence and files change only by re-importing it (rules_import_historical_version)' using errcode = 'P0001'; end if;
    if new.status is distinct from old.status and new.status = 'superseded' and not coalesce(current_setting('bos.rules_historical', true), '') = 'on' then
      raise exception 'publish a historical edition through publish_historical_version' using errcode = 'P0001'; end if;
    -- once published, nothing about the edition changes (a correction of its words goes through correct_rule_provision)
    if old.status in ('superseded', 'withdrawn') and (new.note, new.reconciliation, new.extractor, new.source_id, new.effective_to, new.successor_version_id, new.title)
       is distinct from (old.note, old.reconciliation, old.extractor, old.source_id, old.effective_to, old.successor_version_id, old.title) then
      raise exception 'a published historical edition cannot be changed' using errcode = 'P0001'; end if;
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
  if exists (select 1 from public.ruleset_versions h where h.ruleset_id = v_set.id and h.historical
               and (h.content_sha256 = v_content or h.source_sha256 = v_ver ->> 'source_sha256'
                    or exists (select 1 from jsonb_array_elements(h.source_files) f where f ->> 'sha256' = v_ver ->> 'source_sha256'))) then
    raise exception '% %: the same file or text as a historical edition of this document', v_set.name, v_ver ->> 'version' using errcode = 'P0001'; end if;
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
  perform set_config('bos.rules_historical', 'on', true);
  select * into v_old from public.ruleset_versions where ruleset_id = v_set.id and version = v_ver ->> 'version';
  if found and not v_old.historical then
    raise exception '% % is a current version: a historical edition never replaces it', v_set.name, v_old.version using errcode = 'P0001'; end if;
  -- one file is one edition anywhere (any document), and one text is one version of a document
  if exists (select 1 from public.ruleset_versions x where x.id is distinct from v_old.id
               and (x.source_sha256 in (select f ->> 'sha256' from jsonb_array_elements(v_files) f) or x.source_sha256 = v_ver ->> 'source_sha256'
                    or exists (select 1 from jsonb_array_elements(coalesce(x.source_files, '[]'::jsonb)) xf where xf ->> 'sha256' in (select f ->> 'sha256' from jsonb_array_elements(v_files) f)))) then
    raise exception '% %: an archive file of this edition already belongs to another version', v_set.name, v_ver ->> 'version' using errcode = 'P0001'; end if;
  if not exists (select 1 from jsonb_array_elements(v_files) f where f ->> 'sha256' = v_ver ->> 'source_sha256') then
    raise exception 'source_sha256 must be the SHA-256 of one of the edition''s source_files' using errcode = '22023'; end if;
  select * into v_twin from public.ruleset_versions where ruleset_id = v_set.id and id is distinct from v_old.id and (content_sha256 = v_content or source_sha256 = v_ver ->> 'source_sha256') limit 1;
  if found then
    raise exception '% %: the same % as version % (one edition is one version)', v_set.name, v_ver ->> 'version',
      case when v_twin.source_sha256 = v_ver ->> 'source_sha256' then 'file' else 'text' end, v_twin.version using errcode = 'P0001'; end if;
  if v_old.id is not null then
    if v_old.content_sha256 = v_content and v_old.source_sha256 is not distinct from (v_ver ->> 'source_sha256') and v_old.edition_seq = v_seq and v_old.source_files = v_files
       and v_old.source_url is not distinct from (v_ver ->> 'source_url') and v_old.title is not distinct from (v_ver ->> 'title') and v_old.note is not distinct from left(v_ver ->> 'note', 500) then
      perform set_config('bos.rules_historical', '', true);
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
  perform set_config('bos.rules_historical', '', true);
  return jsonb_build_object('status', case when v_old.id is null then 'new' else 'replaced' end, 'version_id', v_vid, 'provisions', v_n, 'version_status', v_status);
end $$;
revoke execute on function private.rules_import_historical_version(jsonb) from public, anon, authenticated;

create or replace function public.publish_historical_version(p_version uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.ruleset_versions; v_open int;
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
  -- No successor is recorded: a successor is permanent and could point at a version that is not published (or later withdrawn). The order of
  -- editions is edition_seq; the version in force is the document's published current version. The edition keeps its own note (the evidence
  -- about its label); the owner's note goes to the audit.
  perform set_config('bos.rules_historical', 'on', true);
  update public.ruleset_versions set status = 'superseded', published_at = now(), published_by = auth.uid() where id = p_version;
  perform set_config('bos.rules_historical', '', true);
  perform private.audit(null, 'rules.historical_version_published', p_version::text, jsonb_build_object('ruleset', v.ruleset_id, 'version', v.version, 'edition_seq', v.edition_seq,
    'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('status', 'ok');
end $$;
revoke execute on function public.publish_historical_version(uuid, text) from public, anon;
grant execute on function public.publish_historical_version(uuid, text) to authenticated;

create or replace function private.competition_ruleset_check() returns trigger language plpgsql set search_path = '' as $$
declare v_status text; v_syn boolean;
begin
  if new.ruleset_version_id is not distinct from (case when tg_op = 'UPDATE' then old.ruleset_version_id else null end) then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'finished' then raise exception 'a finished competition keeps the ruleset it was fought under' using errcode = 'P0001'; end if;
  if new.ruleset_version_id is not null then
    select status, synthetic into v_status, v_syn from public.ruleset_versions where id = new.ruleset_version_id;
    if v_status is null or v_status not in ('published', 'superseded') then raise exception 'choose a published ruleset version' using errcode = '22023'; end if;
    if (select historical from public.ruleset_versions where id = new.ruleset_version_id) then
      raise exception 'an earlier (historical) edition is for reading: a competition is fought under a version of the current release' using errcode = '22023'; end if;
    if v_syn and not private.is_synthetic('event', new.event_id) then raise exception 'a test ruleset can only be used by a test event' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
revoke execute on function private.competition_ruleset_check() from public, anon, authenticated;

create or replace function private.competition_rulesets_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_status text; v_vstatus text; v_syn boolean; v_event uuid;
begin
  select k.status, k.event_id into v_status, v_event from public.competitions k where k.id = coalesce(new.competition_id, old.competition_id);
  if v_status = 'finished' then raise exception 'a finished competition keeps the documents it was fought under' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' then raise exception 'remove the document and add the other one instead' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' then
    select status, synthetic into v_vstatus, v_syn from public.ruleset_versions where id = new.ruleset_version_id;
    if v_vstatus is null or v_vstatus not in ('published', 'superseded') then raise exception 'choose a published ruleset version' using errcode = '22023'; end if;
    if (select historical from public.ruleset_versions where id = new.ruleset_version_id) then
      raise exception 'an earlier (historical) edition is for reading: a competition is fought under a version of the current release' using errcode = '22023'; end if;
    if v_syn and not private.is_synthetic('event', v_event) then raise exception 'a test ruleset can only be used by a test event' using errcode = '22023'; end if;
    return new;
  end if;
  return old;
end $$;
revoke execute on function private.competition_rulesets_guard() from public, anon, authenticated;

create or replace function private.check_cited_provision(p_provision uuid, p_event uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_status text; v_syn boolean; v_version uuid;
begin
  if p_provision is null then return null; end if;
  select v.status, v.synthetic, v.id into v_status, v_syn, v_version from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id where p.id = p_provision;
  if v_status is null or v_status not in ('published', 'superseded') then raise exception 'cite a rule from a published ruleset' using errcode = '22023'; end if;
  if (select historical from public.ruleset_versions where id = v_version) then raise exception 'an earlier (historical) edition is for reading: cite the rule of the current release' using errcode = '22023'; end if;
  if v_syn and (p_event is null or not private.is_synthetic('event', p_event)) then raise exception 'a test ruleset can only be cited at a test event' using errcode = '22023'; end if;
  return v_version;
end $$;
revoke execute on function private.check_cited_provision(uuid, uuid) from public, anon, authenticated;

create or replace function public.lyst_cite_rule(p_command uuid, p_discipline uuid, p_provision uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_d public.match_discipline; v_old public.match_discipline_rules; v_state text; v_vstatus text; v_vsyn boolean; v_current uuid;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_command is null then raise exception 'a command id is required' using errcode = '22023'; end if;
  select * into v_d from public.match_discipline where id = p_discipline;
  if not found then raise exception 'record not found' using errcode = 'P0002'; end if;
  if not private.can_score(v_d.event_id) then raise exception 'you cannot run this lyst' using errcode = '42501'; end if;
  select * into v_old from public.match_discipline_rules where id = p_command;
  if found then
    if v_old.discipline_id <> p_discipline then raise exception 'that command id belongs to something else' using errcode = '42501'; end if;
    return jsonb_build_object('status', 'duplicate', 'id', p_command);
  end if;
  if v_d.voided_at is not null then raise exception 'this record was voided' using errcode = 'P0001'; end if;
  select queue_state into v_state from public.matches where id = v_d.match_id;
  if v_state = 'final' and not private.can_resolve_results(v_d.event_id) then raise exception 'the fight is final: only the head marshal or an organizer can change the rule cited' using errcode = '42501'; end if;
  if p_provision is not null then
    select v.status, v.synthetic into v_vstatus, v_vsyn from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id where p.id = p_provision;
    if v_vstatus is null or v_vstatus not in ('published', 'superseded') then raise exception 'cite a rule from a published ruleset' using errcode = '22023'; end if;
    if (select v.historical from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id where p.id = p_provision) then
      raise exception 'an earlier (historical) edition is for reading: cite the rule of the current release' using errcode = '22023'; end if;
    if v_vsyn and not private.is_synthetic('event', v_d.event_id) then raise exception 'a test ruleset can only be cited at a test event' using errcode = '22023'; end if;
  end if;
  select provision_id into v_current from public.match_discipline_rules where discipline_id = p_discipline order by created_at desc, id desc limit 1;
  if found and v_current is not distinct from p_provision then return jsonb_build_object('status', 'unchanged'); end if;
  if not found and p_provision is null then return jsonb_build_object('status', 'unchanged'); end if;
  insert into public.match_discipline_rules (id, discipline_id, event_id, provision_id, set_by) values (p_command, p_discipline, v_d.event_id, p_provision, auth.uid());
  perform private.audit(v_d.event_id, 'lyst.discipline_rule', v_d.match_id::text, jsonb_build_object('id', p_discipline, 'provision', p_provision, 'previous', v_current));
  return jsonb_build_object('status', 'ok', 'id', p_command);
end $$;
