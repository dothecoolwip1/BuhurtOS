-- Pack 26: the people who run the day make the Counter QR and the device codes, and add staff.
--
-- Until now only the event's permanent organizer could make the Counter QR, mint device codes, see them, or (for staff roles) only the organizer and the
-- Event Admin tablet. On a practice night the organizer is often not the one holding the tablet: the head marshal, the Secretary / Scorekeeper or the
-- Event Admin tablet (a Temporary Organizer device) stood in front of "This event has no Counter QR yet" with no way forward.
--
-- Now: everyone private.can_command says runs the day (organizer, head marshal, Secretary / Scorekeeper, and the Event Admin tablet through its
-- device roles) may make and show the Counter QR, make / replace / revoke ordinary device codes, see the device list, and add or remove staff.
-- What stays with the permanent organizer: making or replacing an Event Admin (temporary_organizer) or stream controller code, and adding or removing
-- another organizer. Nobody can hand out more authority than they hold.
--
-- Patched in place with an anchor (the Pack 18.1 technique), so the hosted definitions (which carry later additions such as the Training Counter QR)
-- keep everything else exactly as it is. Additive: no table, grant or policy changes; nothing in flight is affected.
create or replace function pg_temp.bos_patch(p_fn regprocedure, p_from text, p_to text) returns void language plpgsql as $p$
declare v_def text;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_from in v_def) = 0 then raise exception 'pack26 patch anchor not found in %: %', p_fn, p_from; end if;
  execute replace(v_def, p_from, p_to);
end $p$;

-- 1. the Counter QR: who may make it (can_create) --------------------------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'counter_pool_code' loop
    perform pg_temp.bos_patch(r.fn, $a$'can_create', private.is_organizer(p_event)$a$, $b$'can_create', private.can_command(p_event)$b$);
  end loop;
end $$;

-- 2. device codes: make, see, replace, revoke -----------------------------------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_event_credential' loop
    perform pg_temp.bos_patch(r.fn,
      $a$  if p_event is null or not private.is_organizer(p_event) then raise exception 'only an organizer of this event can create device codes' using errcode = '42501'; end if;$a$,
      $b$  if p_event is null or not private.can_command(p_event) then raise exception 'only this event''s organizers, head marshal or secretary can create device codes' using errcode = '42501'; end if;
  if not private.is_organizer(p_event) and (p_kind = 'controller' or p_role = 'temporary_organizer') then raise exception 'only an organizer can make an Event Admin or stream controller code' using errcode = '42501'; end if;$b$);
  end loop;
end $$;
select pg_temp.bos_patch('public.list_event_credentials(uuid)'::regprocedure,
  $a$not private.is_organizer(p_event) then raise exception 'only an organizer of this event can see its device codes'$a$,
  $b$not private.can_command(p_event) then raise exception 'only this event''s organizers, head marshal or secretary can see its device codes'$b$);
select pg_temp.bos_patch('public.replace_event_credential(uuid, bytea)'::regprocedure,
  $a$  if not found or not private.is_organizer(v_c.event_id) then raise exception 'only an organizer of this event can replace a device code' using errcode = '42501'; end if;$a$,
  $b$  if not found or not private.can_command(v_c.event_id) then raise exception 'only this event''s organizers, head marshal or secretary can replace a device code' using errcode = '42501'; end if;
  if not private.is_organizer(v_c.event_id) and (v_c.kind = 'controller' or v_c.role = 'temporary_organizer') then raise exception 'only an organizer can replace an Event Admin or stream controller code' using errcode = '42501'; end if;$b$);
select pg_temp.bos_patch('public.revoke_event_credential(uuid, text)'::regprocedure,
  $a$  if not found or not private.is_organizer(v_c.event_id) then raise exception 'only an organizer of this event can revoke a device' using errcode = '42501'; end if;$a$,
  $b$  if not found or not private.can_command(v_c.event_id) then raise exception 'only this event''s organizers, head marshal or secretary can revoke a device' using errcode = '42501'; end if;
  if not private.is_organizer(v_c.event_id) and (v_c.kind = 'controller' or v_c.role = 'temporary_organizer') then raise exception 'only an organizer can revoke an Event Admin or stream controller code' using errcode = '42501'; end if;$b$);

-- 3. staff roles: add, remove, see -----------------------------------------------------------------------------------------------------------------
select pg_temp.bos_patch('public.grant_event_role_by_email(uuid, text, text)'::regprocedure,
  $a$if not private.is_event_operator(p_event) then raise exception 'only an organizer can add staff' using errcode = '42501'; end if;$a$,
  $b$if not (private.is_event_operator(p_event) or private.can_command(p_event)) then raise exception 'only the people who run this event can add staff' using errcode = '42501'; end if;$b$);
select pg_temp.bos_patch('public.remove_event_role(uuid, uuid, text)'::regprocedure,
  $a$if not private.is_event_operator(p_event) or (p_role = 'organizer' and not private.is_organizer(p_event))$a$,
  $b$if not (private.is_event_operator(p_event) or private.can_command(p_event)) or (p_role = 'organizer' and not private.is_organizer(p_event))$b$);
select pg_temp.bos_patch('public.list_event_staff(uuid)'::regprocedure,
  $a$if not private.is_organizer(p_event) then raise exception 'only an organizer can see the staff' using errcode = '42501'; end if;$a$,
  $b$if not (private.is_event_operator(p_event) or private.can_command(p_event)) then raise exception 'only the people who run this event can see the staff' using errcode = '42501'; end if;$b$);
