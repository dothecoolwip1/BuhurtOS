create type public.team_status as enum ('forming','pending','active','suspended','archived');

alter table public.teams
  add column status public.team_status not null default 'active';

update public.teams
set status=case when is_active then 'active'::public.team_status else 'suspended'::public.team_status end;
