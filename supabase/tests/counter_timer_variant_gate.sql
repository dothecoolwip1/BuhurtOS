-- The hosted clock accepts p_pressed_at as an eleventh argument (reconciled into the repository 2026-10-29). Instrument that real
-- function so the gate can see the press time; check that lyst_timer_command_reliable passes the press through on every call.
\set ON_ERROR_STOP on
begin;
\ir fixtures/independent_rehearsal.sql
do $variant$
declare body text;
begin
  body:=pg_get_functiondef('public.lyst_timer_command(uuid,text,uuid,integer,uuid,text,text,integer,integer,integer,timestamptz)'::regprocedure);
  if strpos(body,'p_pressed_at timestamp with time zone DEFAULT NULL')=0 then raise exception 'clock variant fixture anchor missing'; end if;
  if strpos(body,E'\nbegin\n')=0 then raise exception 'clock body anchor missing'; end if;
  body:=replace(body,E'\nbegin\n',E'\nbegin\n  perform set_config(''counter_variant.press'',coalesce(p_pressed_at::text,''missing''),true);\n');
  execute body;
end $variant$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a2';
select public.lyst_open('00000000-0000-0000-0000-0000000fd001','simple');
select clock_timestamp() press \gset
select public.lyst_timer_command_reliable('00000000-0000-0000-0000-00000000ed01','field 1','00000000-0000-0000-0000-0000000fd001',0,gen_random_uuid(),'start','fight',60000,1,0,null,:'press');
select set_config('counter_variant.expected',:'press',true);
do $$ begin if current_setting('counter_variant.press')::timestamptz is distinct from current_setting('counter_variant.expected')::timestamptz then raise exception 'start press was not passed through'; end if; end $$;
select clock_timestamp() pause_press \gset
select public.lyst_timer_command_reliable('00000000-0000-0000-0000-00000000ed01','field 1','00000000-0000-0000-0000-0000000fd001',1,gen_random_uuid(),'pause',null,null,null,0,null,:'pause_press');
select set_config('counter_variant.expected',:'pause_press',true);
do $$ begin
  if current_setting('counter_variant.press')::timestamptz is distinct from current_setting('counter_variant.expected')::timestamptz then raise exception 'pause press was not passed through'; end if;
  raise notice 'COUNTER TIMER VARIANT GATE PASSED';
end $$;
rollback;
