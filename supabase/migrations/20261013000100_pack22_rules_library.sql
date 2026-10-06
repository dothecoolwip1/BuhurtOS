-- Pack 22 (2026-10-13): the rules library, ruleset versions that never lose their meaning, and rule citations on officiating records.
-- ADDITIVE. It extends what already exists instead of building a parallel system:
--   public.rulesets          (connected model)  one official DOCUMENT SERIES, e.g. "Buhurt International · Marshal Committee · Buhurt Rules"
--   public.ruleset_versions  (connected model)  one VERSION of that document, e.g. V.26.4.1, with its source file checksum and review state
--   public.competitions.ruleset_version_id      (connected model)  the version a competition was fought under (now guarded once finished)
--   public.match_discipline  (Pack 13)          the official warnings / cards / deductions / DQs; a rule can now be CITED on one, append-only
-- New:
--   public.rule_provisions            the text of a version, one row per numbered rule / section / note, in reading order, with page and source position
--   public.rule_provision_revisions   append-only history of every correction made to an imported provision after it was published
--   public.rule_conflicts             a recorded disagreement between two official documents or provisions (kept, never decided silently)
--   public.match_discipline_rules     append-only: which provision a disciplinary record cites (latest row wins; a removal is a row with no provision)
-- Who can do what:
--   * anyone (anon included) reads published, superseded and withdrawn versions and their provisions; drafts and versions in review are the owner's only
--   * the official text is loaded by the reproducible importer (scripts/rules), run by the database owner as a migration; the API cannot import
--   * the platform owner publishes, withdraws, corrects (with a reason, kept), reviews and records conflicts, through audited functions only
--   * an event's organizer links a competition to a published version; refused once the competition is finished
--   * whoever may record a marshal's call (private.can_score) may cite a rule on it while the fight is live; afterwards the head marshal or an organizer
-- Nothing is deleted once published: a newer version supersedes the old one, which stays readable for every result fought under it.

-- ---------------------------------------------------------------- 1. document series
alter table public.rulesets
  add column if not exists governing_body text check (governing_body is null or char_length(governing_body) between 2 and 120),
  add column if not exists inventory_key text check (inventory_key is null or inventory_key ~ '^[a-z0-9]+(/[a-z0-9]+(-[a-z0-9]+)*)+$'),
  add column if not exists committee text check (committee is null or char_length(committee) <= 60),
  add column if not exists committee_name text check (committee_name is null or char_length(committee_name) <= 120),
  add column if not exists heading text check (heading is null or char_length(heading) <= 120),
  add column if not exists kind text check (kind is null or kind in ('rules', 'regulations', 'tournament_structure', 'equipment', 'infractions', 'discipline', 'eligibility', 'officials', 'governance', 'archive')),
  add column if not exists applies_to text[] not null default '{}' check (applies_to <@ array['buhurt', 'duels', 'outrance', 'hacsa']::text[]),
  add column if not exists relevance text check (relevance is null or relevance in ('direct', 'supporting', 'governance', 'archive')),
  add column if not exists official_url text check (official_url is null or (char_length(official_url) <= 500 and official_url ~ '^https://')),
  add column if not exists source_host text check (source_host is null or source_host in ('site_file', 'drive_file', 'drive_folder')),
  add column if not exists source_ref text check (source_ref is null or char_length(source_ref) <= 200),
  add column if not exists listed_on_page boolean not null default true,
  add column if not exists page_order integer,
  add column if not exists previously_cited_as text check (previously_cited_as is null or char_length(previously_cited_as) <= 120),
  add column if not exists classification_note text check (classification_note is null or char_length(classification_note) <= 500),
  add column if not exists inventory_source_id uuid references public.sources (id) on delete restrict,
  add column if not exists synthetic boolean not null default false;
create unique index if not exists rulesets_inventory_key_idx on public.rulesets (governing_body, inventory_key) where inventory_key is not null;
create index if not exists rulesets_inventory_source_idx on public.rulesets (inventory_source_id) where inventory_source_id is not null;
comment on column public.rulesets.inventory_key is 'Pack 22: the document''s key in the governing body''s source inventory (rules-library/<body>/source-inventory.json), e.g. marshal/buhurt-rules.';
comment on column public.rulesets.kind is 'Pack 22: BuhurtOS classification from the document title, for filtering. NOT official (rules-library/<body>/classification.json).';
comment on column public.rulesets.previously_cited_as is 'Pack 22: the version an earlier BuhurtOS pack quoted. Not verified to be the version currently linked from the official page.';

-- ---------------------------------------------------------------- 2. versions
alter table public.ruleset_versions
  add column if not exists title text check (title is null or char_length(title) <= 300),
  add column if not exists status text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'superseded', 'withdrawn')),
  add column if not exists published_on date,
  add column if not exists source_url text check (source_url is null or (char_length(source_url) <= 500 and source_url ~ '^https://')),
  add column if not exists source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists source_retrieved_at timestamptz,
  add column if not exists page_count integer check (page_count is null or page_count between 1 and 2000),
  add column if not exists import_release text check (import_release is null or char_length(import_release) <= 80),
  add column if not exists extractor text check (extractor is null or char_length(extractor) <= 200),
  add column if not exists content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists reconciliation jsonb,
  add column if not exists imported_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid,
  add column if not exists superseded_by uuid references public.ruleset_versions (id) on delete restrict,
  add column if not exists withdrawn_reason text check (withdrawn_reason is null or char_length(withdrawn_reason) between 3 and 500),
  add column if not exists synthetic boolean not null default false;
create index if not exists ruleset_versions_superseded_by_idx on public.ruleset_versions (superseded_by) where superseded_by is not null;
create index if not exists ruleset_versions_source_idx on public.ruleset_versions (source_id) where source_id is not null;
create unique index if not exists ruleset_versions_one_published_idx on public.ruleset_versions (ruleset_id) where status = 'published';
comment on column public.ruleset_versions.status is 'Pack 22: draft → in_review → published → superseded; any published/superseded version may be withdrawn with a reason. Never deleted once published.';

-- Who may read a version (and therefore its provisions): published/superseded/withdrawn for everyone, drafts and reviews for the owner only.
create or replace function private.rule_version_readable(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ruleset_versions v where v.id = p_version and v.status in ('published', 'superseded', 'withdrawn')) or private.is_owner()
$$;
revoke execute on function private.rule_version_readable(uuid) from public;
grant execute on function private.rule_version_readable(uuid) to anon, authenticated;

-- RESTRICTIVE, so it narrows the existing open read policy (ruleset_versions_read, using true) without dropping it.
create policy ruleset_versions_read_published on public.ruleset_versions as restrictive for select to anon, authenticated
  using (status in ('published', 'superseded', 'withdrawn') or (select private.is_owner()));

-- Published meaning is frozen: content columns never change, status only moves forward, and nothing published is deleted.
create or replace function private.ruleset_version_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'in_review') then raise exception 'a published ruleset version is never deleted: withdraw or supersede it' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status in ('published', 'superseded', 'withdrawn') and
     (new.ruleset_id, new.version, new.title, new.published_on, new.source_url, new.source_sha256, new.page_count, new.import_release, new.content_sha256, new.synthetic, new.effective_from, new.imported_at, new.published_at, new.published_by)
     is distinct from
     (old.ruleset_id, old.version, old.title, old.published_on, old.source_url, old.source_sha256, old.page_count, old.import_release, old.content_sha256, old.synthetic, old.effective_from, old.imported_at, old.published_at, old.published_by) then
    raise exception 'a published ruleset version cannot be changed: import a new version instead' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status = 'in_review') or (old.status = 'in_review' and new.status in ('draft', 'published'))
    or (old.status = 'published' and new.status in ('superseded', 'withdrawn')) or (old.status = 'superseded' and new.status = 'withdrawn')) then
    raise exception 'a ruleset version cannot move from % to %', old.status, new.status using errcode = 'P0001';
  end if;
  if new.status = 'superseded' and new.superseded_by is null then raise exception 'say which version supersedes this one' using errcode = 'P0001'; end if;
  if new.status = 'withdrawn' and new.withdrawn_reason is null then raise exception 'say why this version is withdrawn' using errcode = 'P0001'; end if;
  if old.superseded_by is not null and new.superseded_by is distinct from old.superseded_by then raise exception 'the superseding version is permanent' using errcode = 'P0001'; end if;
  if new.status = 'published' and (new.published_at is null) then raise exception 'publish through publish_ruleset_version' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke execute on function private.ruleset_version_guard() from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'ruleset_versions_guard' and tgrelid = 'public.ruleset_versions'::regclass) then
    create trigger ruleset_versions_guard before update or delete on public.ruleset_versions for each row execute function private.ruleset_version_guard();
  end if;
end $do$;

-- A document series in the inventory is never deleted (versions and history hang off it); it is marked as no longer listed instead.
create or replace function private.ruleset_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.inventory_key is not null then raise exception 'an inventoried rules document is never deleted: a later inventory marks it as no longer listed' using errcode = 'P0001'; end if;
  return old;
end $$;
revoke execute on function private.ruleset_guard() from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'rulesets_guard' and tgrelid = 'public.rulesets'::regclass) then
    create trigger rulesets_guard before delete on public.rulesets for each row execute function private.ruleset_guard();
  end if;
end $do$;

-- ---------------------------------------------------------------- 3. provisions: the text, in reading order
create table if not exists public.rule_provisions (
  id uuid primary key default gen_random_uuid(),
  ruleset_version_id uuid not null references public.ruleset_versions (id) on delete restrict,
  parent_id uuid references public.rule_provisions (id),   -- NO ACTION: a draft's provisions are replaced in one statement
  ordinal integer not null check (ordinal between 1 and 100000),
  depth smallint not null default 0 check (depth between 0 and 8),
  kind text not null check (kind in ('part', 'section', 'rule', 'definition', 'table', 'figure', 'note', 'appendix', 'unstructured')),
  number text check (number is null or char_length(number) between 1 and 40),        -- as printed: "1.3.2", "4", "A.1"
  title text check (title is null or char_length(title) <= 300),
  body text not null default '' check (char_length(body) <= 30000),
  page_from integer check (page_from is null or page_from between 1 and 2000),
  page_to integer check (page_to is null or page_to between 1 and 2000),
  stable_key text not null check (stable_key ~ '^[a-z0-9][a-z0-9._:-]{0,160}$'),   -- the same rule across versions: "<series>:<number>"
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  review_status text not null default 'extracted' check (review_status in ('extracted', 'needs_review', 'verified')),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  topics text[] not null default '{}' check (cardinality(topics) <= 12),     -- BuhurtOS topic keys, NOT official
  keywords text[] not null default '{}' check (cardinality(keywords) <= 30), -- BuhurtOS search aids people type, NOT official
  cross_refs text[] not null default '{}' check (cardinality(cross_refs) <= 40),
  created_at timestamptz not null default now(),
  check (page_to is null or page_from is null or page_to >= page_from),
  check (number is not null or title is not null or char_length(body) > 0),
  unique (ruleset_version_id, ordinal),
  unique (ruleset_version_id, stable_key)
);
-- The provision checksum, the same definition the importer uses (scripts/rules/structure.ts contentSha256): number, title and body joined by newlines.
create or replace function private.rule_content_sha256(p_number text, p_title text, p_body text) returns text
language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(p_number, '') || E'\n' || coalesce(p_title, '') || E'\n' || coalesce(p_body, ''), 'UTF8')), 'hex')
$$;
revoke execute on function private.rule_content_sha256(text, text, text) from public, anon, authenticated;
create index if not exists rule_provisions_parent_idx on public.rule_provisions (parent_id) where parent_id is not null;
create index if not exists rule_provisions_stable_key_idx on public.rule_provisions (stable_key);
alter table public.rule_provisions enable row level security;
create policy rule_provisions_read on public.rule_provisions for select to anon, authenticated using (private.rule_version_readable(ruleset_version_id));
grant select on public.rule_provisions to anon, authenticated;
revoke insert, update, delete on public.rule_provisions from public, anon, authenticated;
comment on table public.rule_provisions is 'Pack 22: the official text of a ruleset version, one row per numbered provision, in reading order, traceable to its page. Loaded only by the importer; corrections keep the old text in rule_provision_revisions.';

create table if not exists public.rule_provision_revisions (
  id bigint generated always as identity primary key,
  provision_id uuid not null references public.rule_provisions (id) on delete restrict,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  reason text not null check (char_length(reason) between 3 and 500),
  before jsonb not null,
  after jsonb not null
);
create index if not exists rule_provision_revisions_provision_idx on public.rule_provision_revisions (provision_id, changed_at);
alter table public.rule_provision_revisions enable row level security;
create policy rule_provision_revisions_read on public.rule_provision_revisions for select to anon, authenticated
  using (private.rule_version_readable((select p.ruleset_version_id from public.rule_provisions p where p.id = provision_id)));
-- Supabase grants table-wide SELECT by default; take it back so only the columns below are readable.
revoke select on public.rule_provision_revisions from public, anon, authenticated;
grant select (id, provision_id, changed_at, reason, before, after) on public.rule_provision_revisions to anon, authenticated;
revoke insert, update, delete on public.rule_provision_revisions from public, anon, authenticated;

-- Imported text is final once the version leaves review. Review state and search aids may change (audited, through the owner's functions);
-- the words, numbers and pages only through correct_rule_provision, which keeps the old text.
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
     and (new.parent_id, new.depth, new.kind, new.number, new.title, new.body, new.page_from, new.page_to, new.content_sha256, new.cross_refs)
         is distinct from (old.parent_id, old.depth, old.kind, old.number, old.title, old.body, old.page_from, old.page_to, old.content_sha256, old.cross_refs)
     and coalesce(current_setting('bos.rule_correction', true), '') <> 'on' then
    raise exception 'published rule text changes only through correct_rule_provision, which keeps the old text' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function private.rule_provision_guard() from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'rule_provisions_guard' and tgrelid = 'public.rule_provisions'::regclass) then
    create trigger rule_provisions_guard before insert or update or delete on public.rule_provisions for each row execute function private.rule_provision_guard();
  end if;
end $do$;

create or replace function private.rule_revision_guard() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'rule revision history is append-only' using errcode = 'P0001'; end $$;
revoke execute on function private.rule_revision_guard() from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'rule_provision_revisions_guard' and tgrelid = 'public.rule_provision_revisions'::regclass) then
    create trigger rule_provision_revisions_guard before update or delete on public.rule_provision_revisions for each row execute function private.rule_revision_guard();
  end if;
end $do$;

-- ---------------------------------------------------------------- 4. conflicts between official documents (recorded, never decided silently)
create table if not exists public.rule_conflicts (
  id uuid primary key default gen_random_uuid(),
  governing_body text not null check (char_length(governing_body) between 2 and 120),
  version_a uuid not null references public.ruleset_versions (id) on delete restrict,
  provision_a uuid references public.rule_provisions (id) on delete restrict,
  version_b uuid references public.ruleset_versions (id) on delete restrict,
  provision_b uuid references public.rule_provisions (id) on delete restrict,
  description text not null check (char_length(description) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved_by_source', 'not_a_conflict')),
  resolution text check (resolution is null or char_length(resolution) between 3 and 2000),
  noted_at timestamptz not null default now(),
  noted_by uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  check ((status = 'open') = (resolution is null))
);
create index if not exists rule_conflicts_a_idx on public.rule_conflicts (version_a);
create index if not exists rule_conflicts_b_idx on public.rule_conflicts (version_b) where version_b is not null;
create index if not exists rule_conflicts_pa_idx on public.rule_conflicts (provision_a) where provision_a is not null;
create index if not exists rule_conflicts_pb_idx on public.rule_conflicts (provision_b) where provision_b is not null;
alter table public.rule_conflicts enable row level security;
create policy rule_conflicts_read on public.rule_conflicts for select to anon, authenticated
  using (private.rule_version_readable(version_a) and (version_b is null or private.rule_version_readable(version_b)));
-- Supabase grants table-wide SELECT by default; take it back so only the columns below are readable.
revoke select on public.rule_conflicts from public, anon, authenticated;
grant select (id, governing_body, version_a, provision_a, version_b, provision_b, description, status, resolution, noted_at, resolved_at) on public.rule_conflicts to anon, authenticated;
revoke insert, update, delete on public.rule_conflicts from public, anon, authenticated;

-- ---------------------------------------------------------------- 5. the importer (database owner only: run from a migration / SQL editor)
-- The source inventory: one document series per listed document. Re-running with the same inventory changes nothing; a document no longer listed
-- is kept and marked listed_on_page = false; nothing is deleted. Classification (BuhurtOS, not official) is stored next to it for filtering.
create or replace function private.rules_import_inventory(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(coalesce(p ->> 'governing_body', ''));
  v_snap jsonb := p -> 'snapshot';
  v_src uuid; v_doc jsonb; v_cls jsonb; v_sec jsonb; v_id uuid; v_slug text; v_new int := 0; v_upd int := 0; v_same int := 0; v_gone int := 0; v_keys text[] := '{}';
  v_old public.rulesets;
begin
  if char_length(v_body) < 2 then raise exception 'governing_body is required' using errcode = '22023'; end if;
  if coalesce(v_snap ->> 'sha256_html', '') !~ '^[0-9a-f]{64}$' then raise exception 'the snapshot checksum is required' using errcode = '22023'; end if;
  if jsonb_typeof(p -> 'documents') <> 'array' or jsonb_array_length(p -> 'documents') = 0 then raise exception 'no documents in the inventory' using errcode = '22023'; end if;
  select id into v_src from public.sources where kind = 'official' and citation = 'snapshot sha256 ' || (v_snap ->> 'sha256_html');
  if v_src is null then
    insert into public.sources (kind, title, url, citation, retrieved_on)
    values ('official', left(v_body || ': rules page (' || coalesce(p ->> 'page_title', 'rules') || ')', 200), left(p ->> 'page_url', 500),
            'snapshot sha256 ' || (v_snap ->> 'sha256_html'), (v_snap ->> 'captured_on')::date)
    returning id into v_src;
  end if;
  for v_doc in select * from jsonb_array_elements(p -> 'documents') loop
    v_cls := coalesce(p -> 'classification' -> 'documents' -> (v_doc ->> 'key'), '{}'::jsonb);
    v_sec := (select s from jsonb_array_elements(p -> 'sections') s where s ->> 'key' = v_doc ->> 'committee' limit 1);
    v_keys := v_keys || (v_doc ->> 'key');
    select * into v_old from public.rulesets where governing_body = v_body and inventory_key = v_doc ->> 'key';
    if not found then
      v_slug := left(regexp_replace(lower(v_body), '[^a-z0-9]+', '-', 'g'), 30) || '-' || regexp_replace(v_doc ->> 'key', '[^a-z0-9]+', '-', 'g');
      v_slug := regexp_replace(regexp_replace(v_slug, '-+', '-', 'g'), '^-|-$', '', 'g');
      insert into public.rulesets (slug, name, governing_body, inventory_key, committee, committee_name, heading, kind, applies_to, relevance, official_url, source_host, source_ref,
                                   listed_on_page, page_order, previously_cited_as, classification_note, inventory_source_id, synthetic)
      values (v_slug, left(v_doc ->> 'label', 120), v_body, v_doc ->> 'key', v_doc ->> 'committee', v_sec ->> 'name', v_doc ->> 'heading', v_cls ->> 'kind',
              coalesce((select array_agg(x) from jsonb_array_elements_text(v_cls -> 'applies_to') x), '{}'), v_cls ->> 'relevance', v_doc ->> 'url', v_doc ->> 'host', v_doc ->> 'ref',
              true, (v_doc ->> 'order')::int, v_cls ->> 'previously_cited_as', v_cls ->> 'note', v_src, coalesce((p ->> 'synthetic')::boolean, false))
      returning id into v_id;
      v_new := v_new + 1;
    else
      if (v_old.name, v_old.committee, v_old.committee_name, v_old.heading, v_old.kind, v_old.applies_to, v_old.relevance, v_old.official_url, v_old.source_host, v_old.source_ref, v_old.listed_on_page, v_old.page_order, v_old.previously_cited_as, v_old.classification_note)
         is not distinct from
         (left(v_doc ->> 'label', 120), v_doc ->> 'committee', v_sec ->> 'name', v_doc ->> 'heading', v_cls ->> 'kind', coalesce((select array_agg(x) from jsonb_array_elements_text(v_cls -> 'applies_to') x), '{}'), v_cls ->> 'relevance', v_doc ->> 'url', v_doc ->> 'host', v_doc ->> 'ref', true, (v_doc ->> 'order')::int, v_cls ->> 'previously_cited_as', v_cls ->> 'note') then
        v_same := v_same + 1;
      else
        update public.rulesets set name = left(v_doc ->> 'label', 120), committee = v_doc ->> 'committee', committee_name = v_sec ->> 'name', heading = v_doc ->> 'heading', kind = v_cls ->> 'kind',
          applies_to = coalesce((select array_agg(x) from jsonb_array_elements_text(v_cls -> 'applies_to') x), '{}'), relevance = v_cls ->> 'relevance', official_url = v_doc ->> 'url',
          source_host = v_doc ->> 'host', source_ref = v_doc ->> 'ref', listed_on_page = true, page_order = (v_doc ->> 'order')::int, previously_cited_as = v_cls ->> 'previously_cited_as',
          classification_note = v_cls ->> 'note', inventory_source_id = v_src
        where id = v_old.id;
        perform private.audit(null, 'rules.inventory_changed', v_old.id::text, jsonb_build_object('key', v_old.inventory_key, 'before', jsonb_build_object('name', v_old.name, 'url', v_old.official_url, 'listed', v_old.listed_on_page)));
        v_upd := v_upd + 1;
      end if;
    end if;
  end loop;
  update public.rulesets set listed_on_page = false where governing_body = v_body and inventory_key is not null and listed_on_page and not (inventory_key = any (v_keys));
  get diagnostics v_gone = row_count;
  perform private.audit(null, 'rules.inventory_imported', v_body, jsonb_build_object('snapshot', v_snap ->> 'sha256_html', 'new', v_new, 'changed', v_upd, 'unchanged', v_same, 'no_longer_listed', v_gone));
  return jsonb_build_object('source_id', v_src, 'new', v_new, 'changed', v_upd, 'unchanged', v_same, 'no_longer_listed', v_gone);
end $$;
revoke execute on function private.rules_import_inventory(jsonb) from public, anon, authenticated;

-- One imported document version with its provisions. Never overwrites published text:
--   * same version, same checksums  → 'unchanged' (re-running a release is harmless)
--   * same version, still draft / in review → its provisions are replaced (the import is being fixed before anyone relies on it)
--   * same version, already published → refused: a changed official file is a NEW version (or a correction through correct_rule_provision)
-- A version whose reconciliation did not pass is stored as 'draft' (it can be read and reviewed by the owner, never published).
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
      source_id = coalesce(v_set.inventory_source_id, source_id), status = v_status, synthetic = coalesce((p ->> 'synthetic')::boolean, false)
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
  -- Provisions arrive in reading order; a parent is named by its stable key and must come first.
  for v_pr in select * from jsonb_array_elements(p -> 'provisions') loop
    v_parent := null;
    if coalesce(v_pr ->> 'parent_key', '') <> '' then
      select id into v_parent from public.rule_provisions where ruleset_version_id = v_vid and stable_key = v_pr ->> 'parent_key';
      if v_parent is null then raise exception 'provision % names parent % which does not come before it', v_pr ->> 'stable_key', v_pr ->> 'parent_key' using errcode = '22023'; end if;
    end if;
    insert into public.rule_provisions (ruleset_version_id, parent_id, ordinal, depth, kind, number, title, body, page_from, page_to, stable_key, content_sha256, review_status, review_note, topics, keywords, cross_refs)
    values (v_vid, v_parent, (v_pr ->> 'ordinal')::int, coalesce((v_pr ->> 'depth')::smallint, 0), v_pr ->> 'kind', nullif(v_pr ->> 'number', ''), nullif(v_pr ->> 'title', ''), coalesce(v_pr ->> 'body', ''),
            (v_pr ->> 'page_from')::int, (v_pr ->> 'page_to')::int, v_pr ->> 'stable_key', v_pr ->> 'content_sha256', coalesce(v_pr ->> 'review_status', 'extracted'), nullif(v_pr ->> 'review_note', ''),
            coalesce((select array_agg(x) from jsonb_array_elements_text(v_pr -> 'topics') x), '{}'), coalesce((select array_agg(x) from jsonb_array_elements_text(v_pr -> 'keywords') x), '{}'),
            coalesce((select array_agg(x) from jsonb_array_elements_text(v_pr -> 'cross_refs') x), '{}'));
    v_n := v_n + 1;
  end loop;
  if v_n <> coalesce((v_ver -> 'reconciliation' ->> 'provisions')::int, v_n) then
    raise exception 'the release says % provisions but % were given', v_ver -> 'reconciliation' ->> 'provisions', v_n using errcode = '22023'; end if;
  perform private.audit(null, 'rules.version_imported', v_vid::text, jsonb_build_object('document', v_set.inventory_key, 'version', v_ver ->> 'version', 'provisions', v_n, 'status', v_status, 'content_sha256', v_content, 'release', p ->> 'release'));
  return jsonb_build_object('status', case when v_old.id is null then 'new' else 'replaced' end, 'version_id', v_vid, 'provisions', v_n, 'version_status', v_status);
end $$;
revoke execute on function private.rules_import_version(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 6. the owner's controlled actions
create or replace function public.publish_ruleset_version(p_version uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.ruleset_versions; v_prev uuid; v_open int;
begin
  if not coalesce(private.is_owner(), false) then raise exception 'only the platform owner publishes a ruleset version' using errcode = '42501'; end if;
  select * into v from public.ruleset_versions where id = p_version for update;
  if not found then raise exception 'ruleset version not found' using errcode = 'P0002'; end if;
  if v.status = 'published' then return jsonb_build_object('status', 'duplicate'); end if;
  if v.status <> 'in_review' then raise exception 'only a version in review can be published (this one is %)', v.status using errcode = 'P0001'; end if;
  if not coalesce((v.reconciliation ->> 'ok')::boolean, false) then raise exception 'the source reconciliation for this version did not pass' using errcode = 'P0001'; end if;
  select count(*) into v_open from public.rule_provisions where ruleset_version_id = p_version and review_status = 'needs_review';
  if v_open > 0 then raise exception '% provision(s) still need review against the official document', v_open using errcode = 'P0001'; end if;
  if not exists (select 1 from public.rule_provisions where ruleset_version_id = p_version) then raise exception 'this version has no provisions' using errcode = 'P0001'; end if;
  select id into v_prev from public.ruleset_versions where ruleset_id = v.ruleset_id and status = 'published' for update;
  if v_prev is not null then
    update public.ruleset_versions set status = 'superseded', superseded_by = p_version, effective_to = coalesce(effective_to, coalesce(v.effective_from, current_date)) where id = v_prev;
  end if;
  update public.ruleset_versions set status = 'published', published_at = now(), published_by = auth.uid(), note = coalesce(left(nullif(btrim(p_note), ''), 500), note) where id = p_version;
  perform private.audit(null, 'rules.version_published', p_version::text, jsonb_build_object('ruleset', v.ruleset_id, 'version', v.version, 'supersedes', v_prev, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('status', 'ok', 'superseded', v_prev);
end $$;

create or replace function public.withdraw_ruleset_version(p_version uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.ruleset_versions;
begin
  if not coalesce(private.is_owner(), false) then raise exception 'only the platform owner withdraws a ruleset version' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'say why (3 to 500 characters)' using errcode = '22023'; end if;
  select * into v from public.ruleset_versions where id = p_version for update;
  if not found then raise exception 'ruleset version not found' using errcode = 'P0002'; end if;
  if v.status = 'withdrawn' then return jsonb_build_object('status', 'duplicate'); end if;
  if v.status not in ('published', 'superseded') then raise exception 'only a published or superseded version is withdrawn; a draft is simply re-imported' using errcode = 'P0001'; end if;
  update public.ruleset_versions set status = 'withdrawn', withdrawn_reason = btrim(p_reason) where id = p_version;
  perform private.audit(null, 'rules.version_withdrawn', p_version::text, jsonb_build_object('version', v.version, 'from', v.status, 'reason', btrim(p_reason)));
  return jsonb_build_object('status', 'ok');
end $$;

-- Review state and BuhurtOS search aids on a provision. Allowed at any status (they never change the official words); audited.
create or replace function public.review_rule_provision(p_provision uuid, p_status text, p_note text default null, p_topics text[] default null, p_keywords text[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.rule_provisions;
begin
  if not coalesce(private.is_owner(), false) then raise exception 'only the platform owner reviews rule text' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('extracted', 'needs_review', 'verified') then raise exception 'unknown review status' using errcode = '22023'; end if;
  if p_keywords is not null and exists (select 1 from unnest(p_keywords) k where k is null or char_length(btrim(k)) not between 2 and 60) then raise exception 'each search word is 2 to 60 characters' using errcode = '22023'; end if;
  if p_topics is not null and exists (select 1 from unnest(p_topics) k where k is null or k !~ '^[a-z][a-z0-9_]{1,40}$') then raise exception 'topic keys are short lower-case words' using errcode = '22023'; end if;
  select * into v from public.rule_provisions where id = p_provision for update;
  if not found then raise exception 'provision not found' using errcode = 'P0002'; end if;
  update public.rule_provisions set review_status = p_status, review_note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000),
    topics = coalesce(p_topics, topics), keywords = coalesce((select array_agg(btrim(k)) from unnest(p_keywords) k), case when p_keywords is null then keywords else '{}' end)
  where id = p_provision;
  perform private.audit(null, 'rules.provision_reviewed', p_provision::text, jsonb_build_object('from', v.review_status, 'to', p_status, 'note', nullif(btrim(coalesce(p_note, '')), ''), 'topics', p_topics, 'keywords', p_keywords));
  return jsonb_build_object('status', 'ok');
end $$;

-- Fixing an extraction mistake in published text: the old words are kept in rule_provision_revisions with the reason; the record shows it was corrected.
create or replace function public.correct_rule_provision(p_provision uuid, p_title text, p_body text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.rule_provisions; v_vstatus text;
begin
  if not coalesce(private.is_owner(), false) then raise exception 'only the platform owner corrects rule text' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'say why the text is being corrected (3 to 500 characters)' using errcode = '22023'; end if;
  if p_body is null or char_length(p_body) > 30000 or char_length(coalesce(p_title, '')) > 300 then raise exception 'the text is too long' using errcode = '22023'; end if;
  select * into v from public.rule_provisions where id = p_provision for update;
  if not found then raise exception 'provision not found' using errcode = 'P0002'; end if;
  select status into v_vstatus from public.ruleset_versions where id = v.ruleset_version_id;
  if v_vstatus = 'withdrawn' then raise exception 'a withdrawn version is not corrected' using errcode = 'P0001'; end if;
  if (v.title, v.body) is not distinct from (nullif(btrim(coalesce(p_title, '')), ''), p_body) then return jsonb_build_object('status', 'duplicate'); end if;
  insert into public.rule_provision_revisions (provision_id, changed_by, reason, before, after)
  values (p_provision, auth.uid(), btrim(p_reason), jsonb_build_object('title', v.title, 'body', v.body, 'content_sha256', v.content_sha256),
          jsonb_build_object('title', nullif(btrim(coalesce(p_title, '')), ''), 'body', p_body));
  perform set_config('bos.rule_correction', 'on', true);
  update public.rule_provisions set title = nullif(btrim(coalesce(p_title, '')), ''), body = p_body,
    content_sha256 = private.rule_content_sha256(v.number, nullif(btrim(coalesce(p_title, '')), ''), p_body)
  where id = p_provision;
  perform set_config('bos.rule_correction', '', true);
  perform private.audit(null, 'rules.provision_corrected', p_provision::text, jsonb_build_object('version', v.ruleset_version_id, 'number', v.number, 'reason', btrim(p_reason)));
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.note_rule_conflict(p_version_a uuid, p_provision_a uuid, p_version_b uuid, p_provision_b uuid, p_description text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_body text;
begin
  if not coalesce(private.is_owner(), false) then raise exception 'only the platform owner records a rules conflict' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 10 and 2000 then raise exception 'describe the conflict (10 to 2000 characters)' using errcode = '22023'; end if;
  select r.governing_body into v_body from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where v.id = p_version_a;
  if v_body is null then raise exception 'ruleset version not found' using errcode = 'P0002'; end if;
  if p_provision_a is not null and not exists (select 1 from public.rule_provisions where id = p_provision_a and ruleset_version_id = p_version_a) then raise exception 'provision A is not in version A' using errcode = '22023'; end if;
  if p_provision_b is not null and (p_version_b is null or not exists (select 1 from public.rule_provisions where id = p_provision_b and ruleset_version_id = p_version_b)) then raise exception 'provision B is not in version B' using errcode = '22023'; end if;
  insert into public.rule_conflicts (governing_body, version_a, provision_a, version_b, provision_b, description, noted_by)
  values (v_body, p_version_a, p_provision_a, p_version_b, p_provision_b, btrim(p_description), auth.uid()) returning id into v_id;
  perform private.audit(null, 'rules.conflict_noted', v_id::text, jsonb_build_object('a', coalesce(p_provision_a, p_version_a), 'b', coalesce(p_provision_b, p_version_b)));
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

create or replace function public.resolve_rule_conflict(p_conflict uuid, p_status text, p_resolution text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.rule_conflicts;
begin
  if not coalesce(private.is_owner(), false) then raise exception 'only the platform owner resolves a rules conflict' using errcode = '42501'; end if;
  if p_status not in ('resolved_by_source', 'not_a_conflict') then raise exception 'a conflict is resolved by the source, or found not to be one' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_resolution, ''))) not between 3 and 2000 then raise exception 'say how it was resolved, citing the source' using errcode = '22023'; end if;
  select * into v from public.rule_conflicts where id = p_conflict for update;
  if not found then raise exception 'conflict not found' using errcode = 'P0002'; end if;
  if v.status <> 'open' then raise exception 'this conflict is already closed' using errcode = 'P0001'; end if;
  update public.rule_conflicts set status = p_status, resolution = btrim(p_resolution), resolved_at = now(), resolved_by = auth.uid() where id = p_conflict;
  perform private.audit(null, 'rules.conflict_resolved', p_conflict::text, jsonb_build_object('status', p_status, 'resolution', btrim(p_resolution)));
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- 7. competitions: the version they are fought under
-- Organizers already write competitions under the existing policy. Whatever the path, the link must name a published (or, for a past event, a superseded)
-- version, test rulesets only for test events, and it is frozen once the competition is finished: its results keep meaning what they meant.
create or replace function private.competition_ruleset_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_status text; v_syn boolean;
begin
  if new.ruleset_version_id is not distinct from (case when tg_op = 'UPDATE' then old.ruleset_version_id else null end) then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'finished' then raise exception 'a finished competition keeps the ruleset it was fought under' using errcode = 'P0001'; end if;
  if new.ruleset_version_id is not null then
    select status, synthetic into v_status, v_syn from public.ruleset_versions where id = new.ruleset_version_id;
    if v_status is null or v_status not in ('published', 'superseded') then raise exception 'choose a published ruleset version' using errcode = '22023'; end if;
    if v_syn and not private.is_synthetic('event', new.event_id) then raise exception 'a test ruleset can only be used by a test event' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
revoke execute on function private.competition_ruleset_guard() from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'competitions_ruleset_guard' and tgrelid = 'public.competitions'::regclass) then
    create trigger competitions_ruleset_guard before insert or update of ruleset_version_id on public.competitions for each row execute function private.competition_ruleset_guard();
  end if;
end $do$;
create index if not exists competitions_ruleset_version_idx on public.competitions (ruleset_version_id) where ruleset_version_id is not null;

create or replace function public.set_competition_ruleset_version(p_competition uuid, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.competitions;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_c from public.competitions where id = p_competition for update;
  if not found or not private.is_organizer(v_c.event_id) then raise exception 'only this event''s organizers choose its ruleset' using errcode = '42501'; end if;
  if v_c.ruleset_version_id is not distinct from p_version then return jsonb_build_object('status', 'duplicate'); end if;
  update public.competitions set ruleset_version_id = p_version where id = p_competition;
  perform private.audit(v_c.event_id, 'competition.ruleset_version', p_competition::text, jsonb_build_object('from', v_c.ruleset_version_id, 'to', p_version));
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------------------------------------------------------------- 8. citing a rule on an official warning / card / deduction / DQ (Pack 13)
create table if not exists public.match_discipline_rules (
  id uuid primary key,                                                   -- the command id (idempotent, sent through the scoring outbox)
  discipline_id uuid not null references public.match_discipline (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete cascade,
  provision_id uuid references public.rule_provisions (id) on delete restrict,   -- null: the citation was removed
  set_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists match_discipline_rules_discipline_idx on public.match_discipline_rules (discipline_id, created_at);
create index if not exists match_discipline_rules_event_idx on public.match_discipline_rules (event_id);
create index if not exists match_discipline_rules_provision_idx on public.match_discipline_rules (provision_id) where provision_id is not null;
alter table public.match_discipline_rules enable row level security;
create policy match_discipline_rules_read on public.match_discipline_rules for select to anon, authenticated using (private.is_event_public(event_id) or private.can_score(event_id));
-- Public columns only: who set it is staff information (event_discipline_log).
-- Supabase grants table-wide SELECT by default; take it back so only the columns below are readable.
revoke select on public.match_discipline_rules from public, anon, authenticated;
grant select (id, discipline_id, event_id, provision_id, created_at) on public.match_discipline_rules to anon, authenticated;
revoke insert, update, delete on public.match_discipline_rules from public, anon, authenticated;
comment on table public.match_discipline_rules is 'Pack 22: which rule provision a Pack 13 disciplinary record cites. Append-only; the latest row per record is current; a row without a provision removes the citation.';

create or replace function private.discipline_rule_guard() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'rule citations are append-only: add a new citation instead' using errcode = 'P0001'; end $$;
revoke execute on function private.discipline_rule_guard() from public, anon, authenticated;
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'match_discipline_rules_guard' and tgrelid = 'public.match_discipline_rules'::regclass) then
    create trigger match_discipline_rules_guard before update or delete on public.match_discipline_rules for each row execute function private.discipline_rule_guard();
  end if;
end $do$;

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
    if v_vsyn and not private.is_synthetic('event', v_d.event_id) then raise exception 'a test ruleset can only be cited at a test event' using errcode = '22023'; end if;
  end if;
  select provision_id into v_current from public.match_discipline_rules where discipline_id = p_discipline order by created_at desc, id desc limit 1;
  if found and v_current is not distinct from p_provision then return jsonb_build_object('status', 'unchanged'); end if;
  if not found and p_provision is null then return jsonb_build_object('status', 'unchanged'); end if;
  insert into public.match_discipline_rules (id, discipline_id, event_id, provision_id, set_by) values (p_command, p_discipline, v_d.event_id, p_provision, auth.uid());
  perform private.audit(v_d.event_id, 'lyst.discipline_rule', v_d.match_id::text, jsonb_build_object('id', p_discipline, 'provision', p_provision, 'previous', v_current));
  return jsonb_build_object('status', 'ok', 'id', p_command);
end $$;

-- ---------------------------------------------------------------- 9. the event's discipline log (staff)
-- Every official warning / card / deduction / DQ at the event, with who it was against, the reason, the marshal, the rule cited and its history.
-- Staff who can score this event only (the same people who read match_discipline_private today). No account ids leave the database.
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
             cite.provision_id, rp.number as rule_number, rp.title as rule_title, rs.name as rule_document, rv.version as rule_version, rv.status as rule_version_status,
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

-- ---------------------------------------------------------------- 10. privileges
revoke execute on function public.publish_ruleset_version(uuid, text), public.withdraw_ruleset_version(uuid, text),
  public.review_rule_provision(uuid, text, text, text[], text[]), public.correct_rule_provision(uuid, text, text, text),
  public.note_rule_conflict(uuid, uuid, uuid, uuid, text), public.resolve_rule_conflict(uuid, text, text),
  public.set_competition_ruleset_version(uuid, uuid), public.lyst_cite_rule(uuid, uuid, uuid), public.event_discipline_log(uuid) from public, anon;
grant execute on function public.publish_ruleset_version(uuid, text), public.withdraw_ruleset_version(uuid, text),
  public.review_rule_provision(uuid, text, text, text[], text[]), public.correct_rule_provision(uuid, text, text, text),
  public.note_rule_conflict(uuid, uuid, uuid, uuid, text), public.resolve_rule_conflict(uuid, text, text),
  public.set_competition_ruleset_version(uuid, uuid), public.lyst_cite_rule(uuid, uuid, uuid), public.event_discipline_log(uuid) to authenticated;

-- Realtime: the field tablets and the discipline log learn about a new citation the same way they learn about a new card.
do $do$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_discipline_rules') then
    alter publication supabase_realtime add table public.match_discipline_rules;
  end if;
end $do$;
