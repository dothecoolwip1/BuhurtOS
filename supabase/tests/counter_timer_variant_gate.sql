-- A hosted clock variant accepts p_pressed_at as an eleventh argument. Keep
-- that signature and its implementation; pass the press through on every call.
\set ON_ERROR_STOP on
begin;
\ir fixtures/independent_rehearsal.sql
do $variant$
declare body text;
begin
  body:=pg_get_functiondef('public.lyst_timer_command(uuid,text,uuid,integer,uuid,text,text,integer,integer,integer)'::regprocedure);
  if strpos(body,'p_delta_ms integer DEFAULT 0)')=0 then raise exception 'clock variant fixture anchor missing'; end if;
  alter function public.lyst_timer_command(uuid,text,uuid,integer,uuid,text,text,integer,integer,integer) rename to lyst_timer_variant_baseline;
  body:=replace(body,'p_delta_ms integer DEFAULT 0)','p_delta_ms integer DEFAULT 0, p_pressed_at timestamptz DEFAULT NULL)');
  body:=replace(body,E'\nbegin\n',E'\nbegin\n  perform set_config(''counter_variant.press'',coalesce(p_pressed_at::text,''missing''),true);\n');
  execute body;
  revoke all on function public.lyst_timer_command(uuid,text,uuid,integer,uuid,text,text,integer,integer,integer,timestamptz) from public,anon;
  grant execute on function public.lyst_timer_command(uuid,text,uuid,integer,uuid,text,text,integer,integer,integer,timestamptz) to authenticated,bos_event_device;
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
