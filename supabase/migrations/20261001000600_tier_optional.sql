-- A competition's tier can be left unset until the organizer decides. No tier means no league points are computed.
alter table public.competitions alter column tier drop not null;
alter table public.competitions alter column tier drop default;
