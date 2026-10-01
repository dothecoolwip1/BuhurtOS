-- BuhurtOS foundation: private helper schema, locked-down defaults, accounts, platform roles, reference data.
-- Rule for this database: nothing is readable or writable until a table is granted AND has a row-level-security policy.
-- No publicly readable table carries an account id.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- New objects start with no access for API roles. Each migration grants exactly what it needs.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- Accounts are personal and private. Public sporting identities (fighters, teams) are separate tables.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(left(new.raw_user_meta_data ->> 'full_name', 80), ''), ''))
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

-- Platform owner. Written only by the database owner (SQL editor / migrations), never by the API.
create table public.platform_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('owner')),
  granted_at timestamptz not null default now()
);
alter table public.platform_roles enable row level security;
create policy platform_roles_select_own on public.platform_roles for select to authenticated using (user_id = auth.uid());
grant select on public.platform_roles to authenticated;

create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_roles where user_id = auth.uid() and role = 'owner')
$$;
revoke execute on function private.is_owner() from public;
grant execute on function private.is_owner() to anon, authenticated;

-- Audit trail. Written only by security-definer functions.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  event_id uuid,
  action text not null,
  subject text,
  details jsonb not null default '{}'::jsonb
);
alter table public.audit_log enable row level security;
create index audit_log_event_idx on public.audit_log (event_id, at desc);

create or replace function private.audit(p_event uuid, p_action text, p_subject text, p_details jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, event_id, action, subject, details) values (auth.uid(), p_event, p_action, p_subject, coalesce(p_details, '{}'::jsonb))
$$;
revoke execute on function private.audit(uuid, text, text, jsonb) from public, anon, authenticated;

-- Reference data from Buhurt International documents (League Structure V2026.1, Tournament Structure Jan 2026).
-- Both multiplier schemes are kept because the documents disagree for Regional and Conference.
create table public.ref_tiers (
  name text primary key,
  sort int not null,
  multiplier_tournament_structure numeric not null,
  multiplier_league_structure numeric not null,
  submit_days int,
  source text not null
);
alter table public.ref_tiers enable row level security;
create policy ref_tiers_read on public.ref_tiers for select to anon, authenticated using (true);
grant select on public.ref_tiers to anon, authenticated;
insert into public.ref_tiers values
  ('Exhibition', 0, 0, 0, null, 'League Structure V2026.1 §2.3.1'),
  ('Source', 1, 0.5, 0.5, 45, 'League Structure V2026.1 §2.3.2'),
  ('Classic', 2, 1, 1, 45, 'League Structure V2026.1 §2.3.3'),
  ('Regional', 3, 1.25, 1.5, 90, 'League Structure V2026.1 §2.3.4; Tournament Structure §4.2'),
  ('Conference', 4, 1.5, 2, 120, 'League Structure V2026.1 §2.3.5; Tournament Structure §4.2');

create table public.ref_categories (
  code text primary key,
  league text not null check (league in ('buhurt', 'duels', 'outrance')),
  name text not null,
  sort int not null,
  source text not null
);
alter table public.ref_categories enable row level security;
create policy ref_categories_read on public.ref_categories for select to anon, authenticated using (true);
grant select on public.ref_categories to anon, authenticated;
insert into public.ref_categories values
  ('3v3', 'buhurt', '3v3', 10, 'Buhurt Regulations V.26.4 §1.2.1'),
  ('5v5', 'buhurt', '5v5', 11, 'Buhurt Regulations V.26.4 §1.2.1'),
  ('12v12', 'buhurt', '12v12', 12, 'Buhurt Regulations V.26.4 §1.2.1'),
  ('30v30', 'buhurt', '30v30', 13, 'Buhurt Regulations V.26.4 §1.2.1'),
  ('sword_shield', 'duels', 'Sword & Shield', 20, 'Duels rules V.26.4 §2.1.1'),
  ('buckler', 'duels', 'Sword & Buckler', 21, 'Duels rules V.26.4 §2.1.2'),
  ('longsword', 'duels', 'Longsword', 22, 'Duels rules V.26.4 §2.1.4'),
  ('polearm', 'duels', 'Polearm', 23, 'Duels rules V.26.4 §2.1.3'),
  ('profight', 'outrance', 'Profight', 30, 'Outrance Rules V.26.4');
