-- Pack 22 (additive): what the official page looks like, for every provision.
--   * has_figures: the official pages of this provision carry pictures (photos, drawings, a chart printed as an image). The rule page says so and
--     links to the page; BuhurtOS never describes a picture in words of its own.
--   * extraction: how the words were read. 'text' = the PDF's own text layer; 'ocr' = the page is an image of text, read by OCR and checked against
--     the page image (reviewed corrections are listed in the release files); 'mixed' = both.
--   * a page that holds only pictures is a provision of kind 'figure' with no number, no title and an EMPTY body: nothing is ever written into
--     official text to describe it.
-- Both new columns are source facts: once a version is published they change only through correct_rule_provision, like the words.

alter table public.rule_provisions add column if not exists has_figures boolean not null default false;
alter table public.rule_provisions add column if not exists extraction text not null default 'text';
do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'rule_provisions_extraction_check' and conrelid = 'public.rule_provisions'::regclass) then
    alter table public.rule_provisions add constraint rule_provisions_extraction_check check (extraction in ('text', 'ocr', 'mixed'));
  end if;
  -- A picture-only page has no words; every other provision has a number, a title or text.
  if exists (select 1 from pg_constraint where conname = 'rule_provisions_check1' and conrelid = 'public.rule_provisions'::regclass) then
    alter table public.rule_provisions drop constraint rule_provisions_check1;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rule_provisions_has_content' and conrelid = 'public.rule_provisions'::regclass) then
    alter table public.rule_provisions add constraint rule_provisions_has_content
      check (number is not null or title is not null or char_length(body) > 0 or (kind = 'figure' and has_figures));
  end if;
end $do$;
comment on column public.rule_provisions.has_figures is 'Pack 22: the official pages of this provision carry pictures; the rule page links to them.';
comment on column public.rule_provisions.extraction is 'Pack 22: text = PDF text layer; ocr = read from a page image by OCR and checked against it; mixed = both.';

-- The guard: the new source facts are as final as the words once the version is published.
create or replace function private.rule_provision_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.ruleset_versions where id = coalesce(old.ruleset_version_id, new.ruleset_version_id);
  if tg_op = 'DELETE' then
    if v_status not in ('draft', 'in_review') then raise exception 'published rule text is never deleted' using errcode = 'P0001'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if v_status not in ('draft', 'in_review') then raise exception 'provisions are only added to a version before it is published' using errcode = 'P0001'; end if;
    return new;
  end if;
  if (new.id, new.ruleset_version_id, new.ordinal, new.stable_key, new.created_at) is distinct from (old.id, old.ruleset_version_id, old.ordinal, old.stable_key, old.created_at) then
    raise exception 'a provision''s identity and position never change' using errcode = 'P0001'; end if;
  if v_status not in ('draft', 'in_review')
     and (new.parent_id, new.depth, new.kind, new.number, new.title, new.body, new.page_from, new.page_to, new.content_sha256, new.cross_refs, new.has_figures, new.extraction)
         is distinct from (old.parent_id, old.depth, old.kind, old.number, old.title, old.body, old.page_from, old.page_to, old.content_sha256, old.cross_refs, old.has_figures, old.extraction)
     and coalesce(current_setting('bos.rule_correction', true), '') <> 'on' then
    raise exception 'published rule text changes only through correct_rule_provision, which keeps the old text' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function private.rule_provision_guard() from public, anon, authenticated;

-- The importer stores the new facts (and keeps the version note current while the version is still a draft or in review).
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
  select * into v_set from public.rulesets where governing_body = v_body and inventory_key = p ->> 'inventory_key';
  if not found then raise exception 'document % is not in the % inventory: import the inventory first', p ->> 'inventory_key', v_body using errcode = 'P0002'; end if;
  v_status := case when coalesce((v_ver -> 'reconciliation' ->> 'ok')::boolean, false) then 'in_review' else 'draft' end;
  select * into v_old from public.ruleset_versions where ruleset_id = v_set.id and version = v_ver ->> 'version';
  if found then
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
