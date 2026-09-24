-- Pack 5: rulesets, divisions, seasons, provenance, eligibility, and immutable event policy snapshots.

alter table public.rulesets drop constraint if exists rulesets_status_check;
alter table public.rulesets
  add constraint rulesets_status_check check (status in ('draft','review','published','retired')),
  add column if not exists eligibility_policy jsonb not null default '{}'::jsonb,
  add column if not exists scoring_policy jsonb not null default '{}'::jsonb,
  add column if not exists tournament_policy jsonb not null default '{}'::jsonb,
  add column if not exists ranking_policy jsonb not null default '{}'::jsonb,
  add column if not exists published_at timestamptz,
  add column if not exists retired_at timestamptz,
  add column if not exists revision integer not null default 1 check (revision > 0);

alter table public.rulesets
  add constraint rulesets_policy_domains_are_objects check (
    jsonb_typeof(eligibility_policy) = 'object'
    and jsonb_typeof(scoring_policy) = 'object'
    and jsonb_typeof(tournament_policy) = 'object'
    and jsonb_typeof(ranking_policy) = 'object'
  );

create table public.ruleset_sources (
  id uuid primary key default gen_random_uuid(),
  ruleset_id uuid not null references public.rulesets(id) on delete cascade,
  label text not null check (length(trim(label)) > 1),
  source_url text,
  version_label text,
  effective_from timestamptz,
  effective_to timestamptz,
  source_kind text not null default 'official' check (source_kind in ('official','organization','event','historical','internal')),
  notes text,
  accessed_on date,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_edited_by uuid references public.profiles(id) default auth.uid(),
  check (source_url is null or source_url ~ '^https://'),
  check (effective_to is null or effective_from is null or effective_to > effective_from)
);

create index ruleset_sources_ruleset_idx on public.ruleset_sources(ruleset_id,created_at);

alter table public.ruleset_sources enable row level security;

create policy ruleset_sources_read
on public.ruleset_sources for select
to anon, authenticated
using (
  exists (
    select 1
    from public.rulesets r
    where r.id = ruleset_sources.ruleset_id
      and (
        r.status in ('published','retired')
        or private.is_platform_admin((select auth.uid()))
        or (
          r.organization_id is not null
          and private.has_org_role(
            (select auth.uid()),
            r.organization_id,
            array['organization_admin','organization_staff']::public.organization_role[]
          )
        )
      )
  )
);

create policy ruleset_sources_write
on public.ruleset_sources for all
to authenticated
using (
  exists (
    select 1
    from public.rulesets r
    where r.id = ruleset_sources.ruleset_id
      and r.status = 'draft'
      and (
        private.is_platform_admin((select auth.uid()))
        or (
          r.organization_id is not null
          and private.has_org_role(
            (select auth.uid()),
            r.organization_id,
            array['organization_admin']::public.organization_role[]
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.rulesets r
    where r.id = ruleset_sources.ruleset_id
      and r.status = 'draft'
      and (
        private.is_platform_admin((select auth.uid()))
        or (
          r.organization_id is not null
          and private.has_org_role(
            (select auth.uid()),
            r.organization_id,
            array['organization_admin']::public.organization_role[]
          )
        )
      )
  )
);

grant select on public.ruleset_sources to anon, authenticated;
grant insert, update, delete on public.ruleset_sources to authenticated;

create trigger ruleset_sources_updated
before update on public.ruleset_sources
for each row execute function public.set_updated_at();

create trigger ruleset_sources_actor
before update on public.ruleset_sources
for each row execute function private.stamp_foundation_actor();

create or replace function private.jsonb_deep_merge(p_base jsonb, p_patch jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb := coalesce(p_base, '{}'::jsonb);
  v_key text;
  v_value jsonb;
begin
  if p_patch is null then return v_result; end if;
  if jsonb_typeof(v_result) <> 'object' or jsonb_typeof(p_patch) <> 'object' then
    return p_patch;
  end if;

  for v_key, v_value in select key, value from jsonb_each(p_patch)
  loop
    if v_result ? v_key then
      v_result := jsonb_set(v_result, array[v_key], private.jsonb_deep_merge(v_result -> v_key, v_value), true);
    else
      v_result := jsonb_set(v_result, array[v_key], v_value, true);
    end if;
  end loop;
  return v_result;
end;
$$;

revoke execute on function private.jsonb_deep_merge(jsonb,jsonb) from public, anon, authenticated;

create or replace function private.resolve_ruleset_settings(p_ruleset_id uuid, p_seen uuid[] default '{}'::uuid[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row public.rulesets%rowtype;
  v_base jsonb := jsonb_build_object(
    'enabledFormats','[]'::jsonb,
    'scoringOverrides','{}'::jsonb,
    'compliance',jsonb_build_object(
      'requireCheckIn',true,
      'requireArmorClearance',true,
      'requireMedicalClearance',true,
      'requireWaiver',true,
      'requireWeighIn',true
    ),
    'discipline',jsonb_build_object(
      'yellowCardsBeforeSuspension',2,
      'redCardSuspensionMatches',1
    ),
    'bracket',jsonb_build_object('antiFratricide',true)
  );
begin
  if p_ruleset_id = any(p_seen) then raise exception 'Ruleset inheritance contains a cycle'; end if;
  select * into v_row from public.rulesets where id = p_ruleset_id;
  if not found then raise exception 'Ruleset not found'; end if;

  if v_row.parent_ruleset_id is not null then
    v_base := private.resolve_ruleset_settings(v_row.parent_ruleset_id, array_append(p_seen,p_ruleset_id));
  end if;
  return private.jsonb_deep_merge(v_base,coalesce(v_row.settings,'{}'::jsonb));
end;
$$;

create or replace function private.resolve_ruleset_policy(
  p_ruleset_id uuid,
  p_domain text,
  p_seen uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row public.rulesets%rowtype;
  v_own jsonb;
  v_base jsonb := '{}'::jsonb;
begin
  if p_domain not in ('eligibility','scoring','tournament','ranking') then
    raise exception 'Unsupported ruleset policy domain';
  end if;
  if p_ruleset_id = any(p_seen) then raise exception 'Ruleset inheritance contains a cycle'; end if;

  select * into v_row from public.rulesets where id = p_ruleset_id;
  if not found then raise exception 'Ruleset not found'; end if;

  if v_row.parent_ruleset_id is not null then
    v_base := private.resolve_ruleset_policy(v_row.parent_ruleset_id,p_domain,array_append(p_seen,p_ruleset_id));
  end if;

  v_own := case p_domain
    when 'eligibility' then v_row.eligibility_policy
    when 'scoring' then v_row.scoring_policy
    when 'tournament' then v_row.tournament_policy
    else v_row.ranking_policy
  end;

  return private.jsonb_deep_merge(v_base,coalesce(v_own,'{}'::jsonb));
end;
$$;

revoke execute on function private.resolve_ruleset_settings(uuid,uuid[]) from public, anon, authenticated;
revoke execute on function private.resolve_ruleset_policy(uuid,text,uuid[]) from public, anon, authenticated;

create or replace function private.guard_ruleset_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.rulesets%rowtype;
  v_cycle boolean;
begin
  if new.parent_ruleset_id is null then return new; end if;
  if new.parent_ruleset_id = new.id then raise exception 'Ruleset cannot inherit from itself'; end if;

  select * into v_parent from public.rulesets where id = new.parent_ruleset_id;
  if not found then raise exception 'Parent ruleset not found'; end if;
  if v_parent.status <> 'published' then raise exception 'Parent ruleset must be published'; end if;

  if new.organization_id is null and v_parent.organization_id is not null then
    raise exception 'Platform rulesets cannot inherit from organization rulesets';
  end if;
  if new.organization_id is not null and v_parent.organization_id is not null and v_parent.organization_id <> new.organization_id then
    raise exception 'Ruleset cannot inherit from another organization';
  end if;

  with recursive ancestry(id,parent_ruleset_id,path) as (
    select r.id,r.parent_ruleset_id,array[r.id]
    from public.rulesets r
    where r.id = new.parent_ruleset_id
    union all
    select r.id,r.parent_ruleset_id,a.path || r.id
    from public.rulesets r
    join ancestry a on r.id = a.parent_ruleset_id
    where not r.id = any(a.path)
  )
  select exists(select 1 from ancestry where id = new.id) into v_cycle;

  if v_cycle then raise exception 'Ruleset inheritance contains a cycle'; end if;
  return new;
end;
$$;

revoke execute on function private.guard_ruleset_parent() from public, anon, authenticated;

drop trigger if exists pack5_ruleset_parent on public.rulesets;
create trigger pack5_ruleset_parent
before insert or update of parent_ruleset_id,organization_id on public.rulesets
for each row execute function private.guard_ruleset_parent();

create or replace function private.enforce_ruleset_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_content jsonb;
  v_new_content jsonb;
begin
  v_old_content := to_jsonb(old) - array['status','published_at','retired_at','updated_at','last_edited_by','revision'];
  v_new_content := to_jsonb(new) - array['status','published_at','retired_at','updated_at','last_edited_by','revision'];

  if old.status in ('review','published','retired') and v_old_content <> v_new_content then
    raise exception 'Only draft rulesets can be edited';
  end if;

  if old.status <> new.status and not (
    (old.status='draft' and new.status in ('review','retired'))
    or (old.status='review' and new.status in ('draft','published'))
    or (old.status='published' and new.status='retired')
  ) then
    raise exception 'Invalid ruleset lifecycle transition from % to %',old.status,new.status;
  end if;

  if new.status = 'published' and old.status <> 'published' then
    if not exists (select 1 from public.ruleset_sources s where s.ruleset_id = old.id) then
      raise exception 'A reviewed ruleset needs at least one source before publication';
    end if;
    if new.parent_ruleset_id is not null and not exists (
      select 1 from public.rulesets p where p.id=new.parent_ruleset_id and p.status='published'
    ) then
      raise exception 'Parent ruleset must remain published';
    end if;
    perform private.resolve_ruleset_settings(old.id);
    perform private.resolve_ruleset_policy(old.id,'eligibility');
    perform private.resolve_ruleset_policy(old.id,'scoring');
    perform private.resolve_ruleset_policy(old.id,'tournament');
    perform private.resolve_ruleset_policy(old.id,'ranking');
    new.published_at := coalesce(old.published_at,timezone('utc',now()));
  end if;

  if new.status='retired' and old.status <> 'retired' then
    new.retired_at := timezone('utc',now());
  end if;

  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke execute on function private.enforce_ruleset_lifecycle() from public, anon, authenticated;

drop trigger if exists pack5_ruleset_lifecycle on public.rulesets;
create trigger pack5_ruleset_lifecycle
before update on public.rulesets
for each row execute function private.enforce_ruleset_lifecycle();

create table public.event_ruleset_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ruleset_id uuid not null references public.rulesets(id) on delete restrict,
  ruleset_name text not null,
  ruleset_short_name text not null,
  ruleset_version text not null,
  resolved_settings jsonb not null,
  eligibility_policy jsonb not null default '{}'::jsonb,
  scoring_policy jsonb not null default '{}'::jsonb,
  tournament_policy jsonb not null default '{}'::jsonb,
  ranking_policy jsonb not null default '{}'::jsonb,
  ruleset_chain jsonb not null default '[]'::jsonb,
  source_snapshot jsonb not null default '[]'::jsonb,
  locked_by uuid references public.profiles(id) on delete set null default auth.uid(),
  locked_at timestamptz not null default timezone('utc',now())
);

create index event_ruleset_snapshots_event_idx on public.event_ruleset_snapshots(event_id,locked_at desc);
create index event_ruleset_snapshots_ruleset_idx on public.event_ruleset_snapshots(ruleset_id);

alter table public.events
  add column if not exists ruleset_snapshot_id uuid references public.event_ruleset_snapshots(id) on delete restrict;

alter table public.event_ruleset_snapshots enable row level security;

create policy event_ruleset_snapshots_read
on public.event_ruleset_snapshots for select
to anon, authenticated
using (
  private.event_is_public(event_id)
  or private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer','field_marshal','assistant_marshal','team_captain','fighter']::public.event_role[]
  )
  or exists (
    select 1 from public.events e
    where e.id=event_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role(
          (select auth.uid()),
          e.organization_id,
          array['organization_admin','organization_staff']::public.organization_role[]
        )
      )
  )
);

create policy event_ruleset_snapshots_insert
on public.event_ruleset_snapshots for insert
to authenticated
with check (
  exists (
    select 1 from public.events e
    where e.id=event_id
      and (
        private.is_platform_admin((select auth.uid()))
        or private.has_org_role(
          (select auth.uid()),
          e.organization_id,
          array['organization_admin']::public.organization_role[]
        )
        or private.has_event_role((select auth.uid()),e.id,array['event_organizer']::public.event_role[])
      )
  )
);

grant select on public.event_ruleset_snapshots to anon, authenticated;
grant insert on public.event_ruleset_snapshots to authenticated;

create or replace function private.prevent_snapshot_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'Event ruleset snapshots are immutable';
end;
$$;

revoke execute on function private.prevent_snapshot_mutation() from public, anon, authenticated;

create trigger event_ruleset_snapshot_immutable
before update or delete on public.event_ruleset_snapshots
for each row execute function private.prevent_snapshot_mutation();

create table public.event_policy_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  division_id uuid references public.competition_divisions(id) on delete set null,
  ruleset_snapshot_id uuid references public.event_ruleset_snapshots(id) on delete set null,
  policy_domain text not null check (policy_domain in ('eligibility','scoring','tournament','ranking')),
  rule_key text not null check (length(trim(rule_key)) > 0),
  reason text not null check (length(trim(reason)) >= 8),
  status text not null default 'approved' check (status in ('approved','revoked')),
  approved_by uuid not null references public.profiles(id) default auth.uid(),
  approved_at timestamptz not null default timezone('utc',now()),
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index event_policy_exceptions_event_idx on public.event_policy_exceptions(event_id,status,approved_at desc);

alter table public.event_policy_exceptions enable row level security;

create policy event_policy_exceptions_read
on public.event_policy_exceptions for select
to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role(
    (select auth.uid()),
    organization_id,
    array['organization_admin','organization_staff']::public.organization_role[]
  )
  or private.has_event_role(
    (select auth.uid()),
    event_id,
    array['event_organizer','field_marshal','assistant_marshal']::public.event_role[]
  )
);

create policy event_policy_exceptions_manage
on public.event_policy_exceptions for all
to authenticated
using (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role((select auth.uid()),organization_id,array['organization_admin']::public.organization_role[])
  or private.has_event_role((select auth.uid()),event_id,array['event_organizer']::public.event_role[])
)
with check (
  private.is_platform_admin((select auth.uid()))
  or private.has_org_role((select auth.uid()),organization_id,array['organization_admin']::public.organization_role[])
  or private.has_event_role((select auth.uid()),event_id,array['event_organizer']::public.event_role[])
);

grant select,insert,update on public.event_policy_exceptions to authenticated;

create or replace function public.update_ruleset_draft_guarded(
  p_ruleset_id uuid,
  p_expected_updated_at timestamptz,
  p_parent_ruleset_id uuid,
  p_name text,
  p_short_name text,
  p_version text,
  p_description text,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_settings jsonb,
  p_eligibility_policy jsonb,
  p_scoring_policy jsonb,
  p_tournament_policy jsonb,
  p_ranking_policy jsonb
)
returns timestamptz
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_row public.rulesets%rowtype;
  v_updated timestamptz;
begin
  select * into v_row from public.rulesets where id=p_ruleset_id for update;
  if not found then raise exception 'Ruleset not found'; end if;
  if v_row.status <> 'draft' then raise exception 'Only draft rulesets can be edited'; end if;
  if p_expected_updated_at is null or v_row.updated_at <> p_expected_updated_at then
    raise exception 'Ruleset changed on another device';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 or length(trim(coalesce(p_short_name,''))) < 1 or length(trim(coalesce(p_version,''))) < 1 then
    raise exception 'Ruleset name, short name, and version are required';
  end if;
  if p_effective_to is not null and p_effective_from is not null and p_effective_to <= p_effective_from then
    raise exception 'Ruleset effective end must be after its start';
  end if;
  if jsonb_typeof(coalesce(p_settings,'{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_eligibility_policy,'{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_scoring_policy,'{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_tournament_policy,'{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_ranking_policy,'{}'::jsonb)) <> 'object'
  then raise exception 'Ruleset policies must be JSON objects'; end if;

  update public.rulesets set
    parent_ruleset_id=p_parent_ruleset_id,
    name=trim(p_name),
    short_name=trim(p_short_name),
    version=trim(p_version),
    description=nullif(trim(coalesce(p_description,'')),''),
    effective_from=p_effective_from,
    effective_to=p_effective_to,
    settings=coalesce(p_settings,'{}'::jsonb),
    eligibility_policy=coalesce(p_eligibility_policy,'{}'::jsonb),
    scoring_policy=coalesce(p_scoring_policy,'{}'::jsonb),
    tournament_policy=coalesce(p_tournament_policy,'{}'::jsonb),
    ranking_policy=coalesce(p_ranking_policy,'{}'::jsonb)
  where id=p_ruleset_id
  returning updated_at into v_updated;

  return v_updated;
end;
$$;

create or replace function public.transition_ruleset_guarded(
  p_ruleset_id uuid,
  p_expected_updated_at timestamptz,
  p_status text
)
returns timestamptz
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_row public.rulesets%rowtype;
  v_updated timestamptz;
begin
  select * into v_row from public.rulesets where id=p_ruleset_id for update;
  if not found then raise exception 'Ruleset not found'; end if;
  if p_expected_updated_at is null or v_row.updated_at <> p_expected_updated_at then
    raise exception 'Ruleset changed on another device';
  end if;
  if p_status not in ('draft','review','published','retired') then
    raise exception 'Unsupported ruleset status';
  end if;

  update public.rulesets set status=p_status where id=p_ruleset_id
  returning updated_at into v_updated;
  return v_updated;
end;
$$;

revoke execute on function public.update_ruleset_draft_guarded(uuid,timestamptz,uuid,text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.update_ruleset_draft_guarded(uuid,timestamptz,uuid,text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;
revoke execute on function public.transition_ruleset_guarded(uuid,timestamptz,text) from public,anon;
grant execute on function public.transition_ruleset_guarded(uuid,timestamptz,text) to authenticated;

create or replace function public.record_event_policy_exception(
  p_event_id uuid,
  p_division_id uuid,
  p_policy_domain text,
  p_rule_key text,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_event public.events%rowtype;
  v_id uuid;
begin
  select * into v_event from public.events where id=p_event_id;
  if not found then raise exception 'Event not found'; end if;
  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()),v_event.organization_id,array['organization_admin']::public.organization_role[])
    or private.has_event_role((select auth.uid()),v_event.id,array['event_organizer']::public.event_role[])
  ) then raise exception 'Not authorized to approve policy exceptions'; end if;
  if v_event.status='archived' then raise exception 'Archived events cannot receive new policy exceptions'; end if;
  if p_policy_domain not in ('eligibility','scoring','tournament','ranking') then raise exception 'Unsupported policy domain'; end if;
  if length(trim(coalesce(p_rule_key,''))) < 1 or length(trim(coalesce(p_reason,''))) < 8 then
    raise exception 'A rule key and meaningful exception reason are required';
  end if;

  insert into public.event_policy_exceptions(
    organization_id,event_id,division_id,ruleset_snapshot_id,policy_domain,rule_key,reason,metadata
  ) values (
    v_event.organization_id,p_event_id,p_division_id,v_event.ruleset_snapshot_id,p_policy_domain,trim(p_rule_key),trim(p_reason),coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values (
    v_event.organization_id,p_event_id,(select auth.uid()),'event_policy_exceptions',v_id,'approve_policy_exception',
    jsonb_build_object('domain',p_policy_domain,'ruleKey',trim(p_rule_key),'reason',trim(p_reason))
  );
  return v_id;
end;
$$;

revoke execute on function public.record_event_policy_exception(uuid,uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.record_event_policy_exception(uuid,uuid,text,text,text,jsonb) to authenticated;

create or replace function public.assign_event_ruleset_guarded(
  p_event_id uuid,
  p_ruleset_id uuid,
  p_expected_event_updated_at timestamptz,
  p_effective_window_exception_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_event public.events%rowtype;
  v_ruleset public.rulesets%rowtype;
  v_snapshot_id uuid;
  v_chain jsonb;
  v_sources jsonb;
  v_outside_window boolean;
begin
  select * into v_event from public.events where id=p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if not (
    private.is_platform_admin((select auth.uid()))
    or private.has_org_role((select auth.uid()),v_event.organization_id,array['organization_admin']::public.organization_role[])
    or private.has_event_role((select auth.uid()),v_event.id,array['event_organizer']::public.event_role[])
  ) then raise exception 'Not authorized to assign event rules'; end if;
  if v_event.status not in ('draft','published') then raise exception 'Live or historical events cannot change rulesets'; end if;
  if p_expected_event_updated_at is null or v_event.updated_at <> p_expected_event_updated_at then
    raise exception 'Event changed on another device';
  end if;

  if p_ruleset_id is null then
    update public.events
    set ruleset_id=null,ruleset_snapshot_id=null,last_edited_by=(select auth.uid())
    where id=p_event_id;
    return null;
  end if;

  select * into v_ruleset from public.rulesets where id=p_ruleset_id;
  if not found then raise exception 'Ruleset not found'; end if;
  if v_ruleset.status <> 'published' then raise exception 'Only published rulesets can be assigned to events'; end if;
  if v_ruleset.organization_id is not null and v_ruleset.organization_id <> v_event.organization_id then
    raise exception 'Ruleset belongs to another organization';
  end if;

  v_outside_window := (v_ruleset.effective_from is not null and v_event.starts_at < v_ruleset.effective_from)
    or (v_ruleset.effective_to is not null and v_event.starts_at >= v_ruleset.effective_to);
  if v_outside_window and length(trim(coalesce(p_effective_window_exception_reason,''))) < 8 then
    raise exception 'Event date is outside the ruleset effective window; record an exception reason';
  end if;

  with recursive chain as (
    select r.id,r.parent_ruleset_id,r.name,r.short_name,r.version,0 as depth,array[r.id] as path
    from public.rulesets r where r.id=p_ruleset_id
    union all
    select p.id,p.parent_ruleset_id,p.name,p.short_name,p.version,c.depth+1,c.path || p.id
    from public.rulesets p
    join chain c on p.id=c.parent_ruleset_id
    where not p.id=any(c.path)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object('id',id,'name',name,'shortName',short_name,'version',version)
    order by depth desc
  ),'[]'::jsonb)
  into v_chain
  from chain;

  with recursive chain_ids as (
    select r.id,r.parent_ruleset_id,array[r.id] as path
    from public.rulesets r where r.id=p_ruleset_id
    union all
    select p.id,p.parent_ruleset_id,c.path || p.id
    from public.rulesets p
    join chain_ids c on p.id=c.parent_ruleset_id
    where not p.id=any(c.path)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rulesetId',s.ruleset_id,
      'label',s.label,
      'url',s.source_url,
      'version',s.version_label,
      'effectiveFrom',s.effective_from,
      'effectiveTo',s.effective_to,
      'kind',s.source_kind,
      'accessedOn',s.accessed_on
    ) order by s.created_at
  ),'[]'::jsonb)
  into v_sources
  from public.ruleset_sources s
  where s.ruleset_id in (select id from chain_ids);

  insert into public.event_ruleset_snapshots(
    event_id,ruleset_id,ruleset_name,ruleset_short_name,ruleset_version,
    resolved_settings,eligibility_policy,scoring_policy,tournament_policy,ranking_policy,
    ruleset_chain,source_snapshot
  ) values (
    p_event_id,p_ruleset_id,v_ruleset.name,v_ruleset.short_name,v_ruleset.version,
    private.resolve_ruleset_settings(p_ruleset_id),
    private.resolve_ruleset_policy(p_ruleset_id,'eligibility'),
    private.resolve_ruleset_policy(p_ruleset_id,'scoring'),
    private.resolve_ruleset_policy(p_ruleset_id,'tournament'),
    private.resolve_ruleset_policy(p_ruleset_id,'ranking'),
    v_chain,v_sources
  ) returning id into v_snapshot_id;

  update public.events
  set ruleset_id=p_ruleset_id,ruleset_snapshot_id=v_snapshot_id,last_edited_by=(select auth.uid())
  where id=p_event_id;

  if v_outside_window then
    perform public.record_event_policy_exception(
      p_event_id,null,'tournament','ruleset_effective_window',
      trim(p_effective_window_exception_reason),
      jsonb_build_object('rulesetId',p_ruleset_id,'eventStartsAt',v_event.starts_at)
    );
  end if;

  insert into public.audit_log(organization_id,event_id,actor_user_id,table_name,record_id,action,payload)
  values (
    v_event.organization_id,p_event_id,(select auth.uid()),'events',p_event_id,'assign_ruleset_snapshot',
    jsonb_build_object('rulesetId',p_ruleset_id,'snapshotId',v_snapshot_id,'version',v_ruleset.version)
  );

  return v_snapshot_id;
end;
$$;

revoke execute on function public.assign_event_ruleset_guarded(uuid,uuid,timestamptz,text) from public,anon;
grant execute on function public.assign_event_ruleset_guarded(uuid,uuid,timestamptz,text) to authenticated;

alter table public.seasons
  add column if not exists default_ruleset_id uuid references public.rulesets(id) on delete restrict,
  add column if not exists ranking_policy jsonb not null default '{}'::jsonb,
  add column if not exists revision integer not null default 1 check (revision > 0);

alter table public.seasons
  add constraint seasons_ranking_policy_object check (jsonb_typeof(ranking_policy)='object');

create or replace function private.enforce_season_governance()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_ruleset public.rulesets%rowtype;
begin
  if tg_op='UPDATE' then
    if old.status='archived' and to_jsonb(new) <> to_jsonb(old) then
      raise exception 'Archived seasons are immutable';
    end if;
    if old.status <> new.status and not (
      (old.status='draft' and new.status in ('active','archived'))
      or (old.status='active' and new.status='archived')
    ) then
      raise exception 'Invalid season lifecycle transition from % to %',old.status,new.status;
    end if;
    if (
      old.starts_at is distinct from new.starts_at
      or old.ends_at is distinct from new.ends_at
      or old.default_ruleset_id is distinct from new.default_ruleset_id
      or old.ranking_policy is distinct from new.ranking_policy
    ) and exists (
      select 1 from public.events e
      where e.season_id=old.id and e.status in ('live','completed','archived')
    ) then
      raise exception 'Season policy and dates are locked after live competition begins';
    end if;
    new.revision := old.revision + 1;
  end if;

  if new.ends_at <= new.starts_at then raise exception 'Season end must be after its start'; end if;
  if jsonb_typeof(new.ranking_policy) <> 'object' then raise exception 'Season ranking policy must be a JSON object'; end if;

  if new.default_ruleset_id is not null then
    select * into v_ruleset from public.rulesets where id=new.default_ruleset_id;
    if not found or v_ruleset.status <> 'published' then raise exception 'Season default ruleset must be published'; end if;
    if v_ruleset.organization_id is not null and v_ruleset.organization_id <> new.organization_id then
      raise exception 'Season default ruleset belongs to another organization';
    end if;
  end if;

  if tg_op='UPDATE' and (old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at) and exists (
    select 1 from public.events e
    where e.season_id=new.id
      and (e.starts_at < new.starts_at or e.ends_at > new.ends_at)
  ) then
    raise exception 'Season dates cannot exclude an existing event';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_season_governance() from public,anon,authenticated;

drop trigger if exists pack5_season_governance on public.seasons;
create trigger pack5_season_governance
before insert or update on public.seasons
for each row execute function private.enforce_season_governance();

create or replace function public.update_season_guarded(
  p_season_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_default_ruleset_id uuid,
  p_ranking_policy jsonb
)
returns timestamptz
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_season public.seasons%rowtype;
  v_updated timestamptz;
begin
  select * into v_season from public.seasons where id=p_season_id for update;
  if not found then raise exception 'Season not found'; end if;
  if p_expected_updated_at is null or v_season.updated_at <> p_expected_updated_at then raise exception 'Season changed on another device'; end if;
  if length(trim(coalesce(p_name,''))) < 1 then raise exception 'Season name is required'; end if;

  update public.seasons set
    name=trim(p_name),
    starts_at=p_starts_at,
    ends_at=p_ends_at,
    default_ruleset_id=p_default_ruleset_id,
    ranking_policy=coalesce(p_ranking_policy,'{}'::jsonb),
    last_edited_by=(select auth.uid())
  where id=p_season_id
  returning updated_at into v_updated;
  return v_updated;
end;
$$;

create or replace function public.transition_season_guarded(
  p_season_id uuid,
  p_expected_updated_at timestamptz,
  p_status public.season_status
)
returns timestamptz
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_season public.seasons%rowtype;
  v_updated timestamptz;
begin
  select * into v_season from public.seasons where id=p_season_id for update;
  if not found then raise exception 'Season not found'; end if;
  if p_expected_updated_at is null or v_season.updated_at <> p_expected_updated_at then raise exception 'Season changed on another device'; end if;
  update public.seasons set status=p_status,last_edited_by=(select auth.uid())
  where id=p_season_id
  returning updated_at into v_updated;
  return v_updated;
end;
$$;

revoke execute on function public.update_season_guarded(uuid,timestamptz,text,timestamptz,timestamptz,uuid,jsonb) from public,anon;
grant execute on function public.update_season_guarded(uuid,timestamptz,text,timestamptz,timestamptz,uuid,jsonb) to authenticated;
revoke execute on function public.transition_season_guarded(uuid,timestamptz,public.season_status) from public,anon;
grant execute on function public.transition_season_guarded(uuid,timestamptz,public.season_status) to authenticated;

alter table public.competition_divisions
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists supersedes_division_id uuid references public.competition_divisions(id) on delete set null,
  add column if not exists min_experience_years numeric(5,2) check (min_experience_years is null or min_experience_years >= 0),
  add column if not exists max_experience_years numeric(5,2) check (max_experience_years is null or max_experience_years >= 0),
  add column if not exists eligibility_rules jsonb not null default '[]'::jsonb,
  add column if not exists eligibility_explanation text,
  add column if not exists published_at timestamptz,
  add column if not exists retired_at timestamptz,
  add column if not exists revision integer not null default 1 check (revision > 0);

alter table public.competition_divisions
  add constraint competition_divisions_experience_window check (
    max_experience_years is null or min_experience_years is null or max_experience_years >= min_experience_years
  ),
  add constraint competition_divisions_eligibility_rules_array check (jsonb_typeof(eligibility_rules)='array');

drop index if exists public.competition_divisions_owner_slug_unique_idx;
create unique index competition_divisions_owner_slug_version_unique_idx
  on public.competition_divisions(
    coalesce(organization_id,'00000000-0000-0000-0000-000000000000'::uuid),
    slug,
    version
  )
  where deleted_at is null;

create or replace function private.enforce_division_lifecycle()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_old_content jsonb;
  v_new_content jsonb;
  v_ruleset public.rulesets%rowtype;
begin
  if tg_op='UPDATE' then
    v_old_content := to_jsonb(old) - array['status','published_at','retired_at','updated_at','last_edited_by','revision'];
    v_new_content := to_jsonb(new) - array['status','published_at','retired_at','updated_at','last_edited_by','revision'];

    if old.status in ('published','retired') and v_old_content <> v_new_content then
      raise exception 'Published and retired divisions are immutable; create a new version';
    end if;
    if old.status <> new.status and not (
      (old.status='draft' and new.status in ('published','retired'))
      or (old.status='published' and new.status='retired')
    ) then
      raise exception 'Invalid division lifecycle transition from % to %',old.status,new.status;
    end if;
    new.revision := old.revision + 1;
  end if;

  if jsonb_typeof(new.eligibility_rules) <> 'array' then raise exception 'Division eligibility rules must be a JSON array'; end if;

  if new.ruleset_id is not null then
    select * into v_ruleset from public.rulesets where id=new.ruleset_id;
    if not found or v_ruleset.status <> 'published' then raise exception 'Division ruleset must be published'; end if;
    if new.organization_id is null and v_ruleset.organization_id is not null then
      raise exception 'Global divisions cannot use organization rulesets';
    end if;
    if new.organization_id is not null and v_ruleset.organization_id is not null and new.organization_id <> v_ruleset.organization_id then
      raise exception 'Division ruleset belongs to another organization';
    end if;
  end if;

  if new.status='published' and (tg_op='INSERT' or old.status <> 'published') then
    new.published_at := coalesce(new.published_at,timezone('utc',now()));
  end if;
  if new.status='retired' and (tg_op='INSERT' or old.status <> 'retired') then
    new.retired_at := coalesce(new.retired_at,timezone('utc',now()));
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_division_lifecycle() from public,anon,authenticated;

drop trigger if exists pack5_division_lifecycle on public.competition_divisions;
create trigger pack5_division_lifecycle
before insert or update on public.competition_divisions
for each row execute function private.enforce_division_lifecycle();

create or replace function public.create_division_version(p_division_id uuid)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_old public.competition_divisions%rowtype;
  v_version integer;
  v_id uuid;
begin
  select * into v_old from public.competition_divisions where id=p_division_id;
  if not found then raise exception 'Division not found'; end if;
  if v_old.status not in ('published','retired') then raise exception 'Only published or retired divisions need a new version'; end if;

  select coalesce(max(version),0)+1 into v_version
  from public.competition_divisions
  where coalesce(organization_id,'00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(v_old.organization_id,'00000000-0000-0000-0000-000000000000'::uuid)
    and slug=v_old.slug;

  insert into public.competition_divisions(
    organization_id,name,slug,competition_format_id,ruleset_id,team_size,
    min_weight_kg,max_weight_kg,age_min,age_max,min_experience_years,max_experience_years,
    eligibility_label,eligibility_rules,eligibility_explanation,status,metadata,version,
    supersedes_division_id
  ) values (
    v_old.organization_id,v_old.name,v_old.slug,v_old.competition_format_id,v_old.ruleset_id,v_old.team_size,
    v_old.min_weight_kg,v_old.max_weight_kg,v_old.age_min,v_old.age_max,v_old.min_experience_years,v_old.max_experience_years,
    v_old.eligibility_label,v_old.eligibility_rules,v_old.eligibility_explanation,'draft',v_old.metadata,v_version,
    v_old.id
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_division_version(uuid) from public,anon;
grant execute on function public.create_division_version(uuid) to authenticated;

alter table public.event_divisions
  add column if not exists division_snapshot jsonb,
  add column if not exists ruleset_snapshot_id uuid references public.event_ruleset_snapshots(id) on delete set null;

create or replace function private.govern_event_division()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_event public.events%rowtype;
  v_division public.competition_divisions%rowtype;
begin
  select * into v_event from public.events where id=coalesce(new.event_id,old.event_id);
  if not found then raise exception 'Event not found'; end if;

  if tg_op='DELETE' then
    if v_event.status not in ('draft','published') then raise exception 'Live or historical event divisions cannot be removed'; end if;
    return old;
  end if;

  if v_event.status not in ('draft','published') then raise exception 'Live or historical event divisions cannot be changed'; end if;

  if tg_op='UPDATE' then
    if old.division_id is distinct from new.division_id
      or old.division_snapshot is distinct from new.division_snapshot
      or old.ruleset_snapshot_id is distinct from new.ruleset_snapshot_id
    then raise exception 'Event division identity and snapshots are immutable'; end if;
    return new;
  end if;

  select * into v_division from public.competition_divisions where id=new.division_id;
  if not found or v_division.status <> 'published' then raise exception 'Only published divisions can be assigned to events'; end if;
  if v_division.organization_id is not null and v_division.organization_id <> v_event.organization_id then
    raise exception 'Division belongs to another organization';
  end if;

  new.division_snapshot := jsonb_build_object(
    'id',v_division.id,
    'name',v_division.name,
    'slug',v_division.slug,
    'version',v_division.version,
    'competitionFormatId',v_division.competition_format_id,
    'rulesetId',v_division.ruleset_id,
    'teamSize',v_division.team_size,
    'minWeightKg',v_division.min_weight_kg,
    'maxWeightKg',v_division.max_weight_kg,
    'ageMin',v_division.age_min,
    'ageMax',v_division.age_max,
    'minExperienceYears',v_division.min_experience_years,
    'maxExperienceYears',v_division.max_experience_years,
    'eligibilityLabel',v_division.eligibility_label,
    'eligibilityRules',v_division.eligibility_rules,
    'eligibilityExplanation',v_division.eligibility_explanation
  );
  new.ruleset_snapshot_id := coalesce(new.ruleset_snapshot_id,v_event.ruleset_snapshot_id);
  return new;
end;
$$;

revoke execute on function private.govern_event_division() from public,anon,authenticated;

drop trigger if exists pack5_event_division_governance on public.event_divisions;
create trigger pack5_event_division_governance
before insert or update or delete on public.event_divisions
for each row execute function private.govern_event_division();

create or replace function private.enforce_event_season_and_snapshot()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_season public.seasons%rowtype;
  v_snapshot public.event_ruleset_snapshots%rowtype;
begin
  select * into v_season from public.seasons where id=new.season_id;
  if not found then raise exception 'Season not found'; end if;
  if v_season.organization_id <> new.organization_id then raise exception 'Event and season must belong to the same organization'; end if;
  if new.starts_at < v_season.starts_at or new.ends_at > v_season.ends_at then
    raise exception 'Event dates must be inside the selected season';
  end if;
  if tg_op='INSERT' and v_season.status='archived' then raise exception 'Cannot create an event in an archived season'; end if;

  if tg_op='UPDATE' and old.status in ('live','completed','archived') and old.season_id is distinct from new.season_id then
    raise exception 'Live or historical events cannot move to another season';
  end if;

  if new.ruleset_snapshot_id is not null then
    select * into v_snapshot from public.event_ruleset_snapshots where id=new.ruleset_snapshot_id;
    if not found or v_snapshot.event_id <> new.id or v_snapshot.ruleset_id <> new.ruleset_id then
      raise exception 'Event ruleset snapshot does not match the event and ruleset';
    end if;
  elsif new.ruleset_id is not null and new.status in ('live','completed','archived') then
    raise exception 'Live or historical events with rulesets require an immutable ruleset snapshot';
  end if;

  if tg_op='UPDATE'
    and old.status in ('live','completed','archived')
    and (
      old.ruleset_id is distinct from new.ruleset_id
      or old.ruleset_snapshot_id is distinct from new.ruleset_snapshot_id
    )
  then raise exception 'Live or historical event rulesets are immutable'; end if;

  return new;
end;
$$;

revoke execute on function private.enforce_event_season_and_snapshot() from public,anon,authenticated;

drop trigger if exists pack5_event_governance on public.events;
create trigger pack5_event_governance
before insert or update of organization_id,season_id,starts_at,ends_at,status,ruleset_id,ruleset_snapshot_id on public.events
for each row execute function private.enforce_event_season_and_snapshot();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='event_ruleset_snapshots'
  ) then
    alter publication supabase_realtime add table public.event_ruleset_snapshots;
  end if;
end;
$$;
