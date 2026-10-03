-- Pack 04 (2026-10-03): a defined compatibility window for scoring command versions.
-- The finalization command (public.submit_match_result) carries a schema version. The server accepts every version inside the window, so a phone
-- that is a deployment behind keeps working, and refuses anything outside it clearly. Policy: widen the window when a new version ships, and do not
-- narrow it until after the event. Currently only version 1 exists, so the window is 1..1.
create or replace function private.command_schema_ok(p_schema integer) returns boolean
language sql immutable set search_path = '' as $$ select p_schema is not null and p_schema between 1 and 1 $$;
revoke execute on function private.command_schema_ok(integer) from public;
grant execute on function private.command_schema_ok(integer) to anon, authenticated;

do $do$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'submit_match_result';
  v_def := replace(v_def, $$if p_schema is null or p_schema <> 1 then raise exception 'this app version is not supported by the server; reload the page' using errcode = '22023'; end if;$$,
    $$if not private.command_schema_ok(p_schema) then raise exception 'this app version (command version %) is not supported by the server; reload the page. Your scoring is saved on this device and nothing was changed.', p_schema using errcode = '22023'; end if;$$);
  if position('command_schema_ok' in v_def) = 0 then raise exception 'submit_match_result body did not match the expected text'; end if;
  execute v_def;
end $do$;
