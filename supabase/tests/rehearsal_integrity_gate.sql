-- Fictional non-HACSA records only; every fixture and mutation rolls back.
\set ON_ERROR_STOP on
begin;
\ir fixtures/independent_rehearsal.sql
create function pg_temp.assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if; end $$;
create function pg_temp.refused(stmt text, expected text, label text) returns void language plpgsql as $$
declare caught boolean := false;
begin
  begin execute stmt; exception when others then
    if sqlstate <> expected then raise exception 'FAIL %: expected %, got % (%)', label, expected, sqlstate, sqlerrm; end if;
    caught := true;
  end;
  if not caught then raise exception 'FAIL %: expected refusal', label; end if;
end $$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claim.sub', u, true); set local role authenticated; end $$;
grant execute on function pg_temp.assert(boolean,text), pg_temp.refused(text,text,text), pg_temp.as_user(text) to authenticated;

-- Unknown individual and team registrations must never be affirmative Ready.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.assert((select count(*) >= 4 and bool_and(ready is null) from public.announcer_readiness('00000000-0000-0000-0000-00000000ed01')
  where match_id in ('00000000-0000-0000-0000-0000000fd021','00000000-0000-0000-0000-0000000fd022')), 'unregistered individual readiness is unknown');
select pg_temp.assert((select ready is null from public.announcer_readiness('00000000-0000-0000-0000-00000000ed01')
  where match_id = '00000000-0000-0000-0000-0000000fd042' and side='a'), 'unregistered roster readiness is unknown');
select pg_temp.assert((select ready is false from public.announcer_readiness('00000000-0000-0000-0000-00000000ed01')
  where match_id = '00000000-0000-0000-0000-0000000fd042' and side='b'), 'recorded team block wins over unknown members');
select pg_temp.assert(exists(select 1 from public.announcer_readiness('00000000-0000-0000-0000-00000000ed01') where ready is false), 'recorded block remains not ready');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select pg_temp.refused($q$select public.announcer_readiness('00000000-0000-0000-0000-00000000ed01')$q$, '42501', 'outsider cannot read readiness');

-- Official points cannot change through the old entry point.
reset role;
update public.competitions set tier = 'Regional' where id = '00000000-0000-0000-0000-00000000cd03';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select public.finalize_match(id, 'a', 3, 1, '{}'::jsonb, version) from public.matches where id = '00000000-0000-0000-0000-0000000fd021';
select public.finalize_match(id, 'a', 3, 1, '{}'::jsonb, version) from public.matches where id = '00000000-0000-0000-0000-0000000fd022';
select public.finalize_match(id, 'a', 3, 1, '{}'::jsonb, version) from public.matches where id = '00000000-0000-0000-0000-0000000fd023';
select public.finalize_match(id, 'a', 3, 1, '{}'::jsonb, version) from public.matches where id = '00000000-0000-0000-0000-0000000fd024';
select public.finalize_competition('00000000-0000-0000-0000-00000000cd03', 'tournament_structure');
select pg_temp.refused($q$select public.finish_competition('00000000-0000-0000-0000-00000000cd03','league_structure')$q$, 'P0001', 'legacy finalize requires reopen');
select pg_temp.assert((select sum(points) = 25 from public.results where competition_id = '00000000-0000-0000-0000-00000000cd03'), 'official total stayed 25');
select pg_temp.assert(public.finalize_competition('00000000-0000-0000-0000-00000000cd03', 'league_structure')->>'status' = 'already_official', 'modern finalize stays idempotent');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
select pg_temp.refused($q$select public.finish_competition('00000000-0000-0000-0000-00000000cd03')$q$, '42501', 'secretary cannot finalize competition');

-- A later failed Lyst assignment rolls back earlier draws and field count too.
reset role;
insert into public.competitions(id,event_id,name,category,gender,structure) values
 ('00000000-0000-0000-0000-00000000cf01','00000000-0000-0000-0000-00000000ed01','Fictional Safety One','longsword','men','round_robin'),
 ('00000000-0000-0000-0000-00000000cf02','00000000-0000-0000-0000-00000000ed01','Fictional Safety Two','sword_shield','men','round_robin');
insert into public.entries(competition_id, fighter_id)
select c.id, f.id from public.competitions c cross join public.fighters f
where c.id in ('00000000-0000-0000-0000-00000000cf01','00000000-0000-0000-0000-00000000cf02')
  and f.id in ('00000000-0000-0000-0000-00000000f101','00000000-0000-0000-0000-00000000f102');
create function pg_temp.plan(comp uuid, lyst text) returns jsonb language sql as $$
 select jsonb_build_object('competition', comp, 'field', lyst, 'draw', jsonb_build_object('format','round_robin','mode','random','seed',123,'algorithm','ts-draw-v1'),
 'matches', jsonb_build_array(jsonb_build_object('key','one','stage','round_robin','round_label','Round 1','position',0,
 'a',(select id from public.entries where competition_id=comp order by id limit 1),
 'b',(select id from public.entries where competition_id=comp order by id desc limit 1))))
$$;
grant execute on function pg_temp.plan(uuid,text) to authenticated;
select field_count original_fields from public.events where id = '00000000-0000-0000-0000-00000000ed01' \gset
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.refused($q$select public.build_tournament_plan('00000000-0000-0000-0000-00000000ed01',4,
 jsonb_build_array(pg_temp.plan('00000000-0000-0000-0000-00000000cf01','Field 1'),pg_temp.plan('00000000-0000-0000-0000-00000000cf02','Field 99')))$q$, '22023', 'late assignment failure rolls back all draws');
select pg_temp.assert(not exists(select 1 from public.matches where competition_id in ('00000000-0000-0000-0000-00000000cf01','00000000-0000-0000-0000-00000000cf02')), 'neither competition partially built');
select pg_temp.assert((select field_count = :original_fields from public.events where id='00000000-0000-0000-0000-00000000ed01'), 'field count rolled back');
select pg_temp.assert(public.build_tournament_plan('00000000-0000-0000-0000-00000000ed01',4,
 jsonb_build_array(pg_temp.plan('00000000-0000-0000-0000-00000000cf01','Field 2'),pg_temp.plan('00000000-0000-0000-0000-00000000cf02','Field 1')))->>'built' = '2', 'both draws built atomically');
select pg_temp.assert((select count(*)=1 and bool_and(field='Field 2') from public.matches where competition_id='00000000-0000-0000-0000-00000000cf01'), 'chosen Lyst saved with draw');
select pg_temp.assert(public.build_tournament_plan('00000000-0000-0000-0000-00000000ed01',4,
 jsonb_build_array(pg_temp.plan('00000000-0000-0000-0000-00000000cf01','Field 2'),pg_temp.plan('00000000-0000-0000-0000-00000000cf02','Field 1')))->>'status'='duplicate', 'lost response retry confirms existing build');

-- Explicit reset permits a deterministic rebuild, while a lost response remains a duplicate.
reset role;
delete from public.matches where competition_id in ('00000000-0000-0000-0000-00000000cf01','00000000-0000-0000-0000-00000000cf02');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.assert(public.build_tournament_plan('00000000-0000-0000-0000-00000000ed01',4,
 jsonb_build_array(pg_temp.plan('00000000-0000-0000-0000-00000000cf01','Field 2'),pg_temp.plan('00000000-0000-0000-0000-00000000cf02','Field 1')))->>'status'='built','same plan builds again after an explicit reset');
select pg_temp.assert(public.build_tournament_plan('00000000-0000-0000-0000-00000000ed01',4,
 jsonb_build_array(pg_temp.plan('00000000-0000-0000-0000-00000000cf01','Field 2'),pg_temp.plan('00000000-0000-0000-0000-00000000cf02','Field 1')))->>'status'='duplicate','rebuilt plan retry remains idempotent');

-- Actual start/end/return functions; the counter has its own fictional account.
select public.lyst_open('00000000-0000-0000-0000-0000000fd001', 'weighted');
reset role;
insert into public.lyst_counter_seats(id,event_id,field_key,user_id,display_name,match_id,side,role,status,expires_at) values
 ('00000000-0000-0000-0000-0000000afe01','00000000-0000-0000-0000-00000000ed01','field 1','00000000-0000-0000-0000-000000000099','Fictional Safety Counter','00000000-0000-0000-0000-0000000fd001','a','learning','active',now()+interval '1 day');
select pg_temp.as_user('00000000-0000-0000-0000-000000000099');
select public.counter_state()->'prepared_run'->>'id' run1 \gset
select public.counter_acknowledge_run('00000000-0000-0000-0000-0000000afe01', :'run1', false, 0);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select coalesce((select rev from public.lyst_timer where event_id='00000000-0000-0000-0000-00000000ed01' and field_key='field 1'),0) timer_rev \gset
select public.lyst_timer_command('00000000-0000-0000-0000-00000000ed01','field 1','00000000-0000-0000-0000-0000000fd001',:timer_rev,gen_random_uuid(),'start','fight',60000,1,0);
select pg_temp.as_user('00000000-0000-0000-0000-000000000099');
select pg_temp.assert(public.counter_state()->'prepared_run'->>'id' = :'run1', 'prepared identity survives Go');
select public.counter_acknowledge_run('00000000-0000-0000-0000-0000000afe01', :'run1', true, 0);
select gen_random_uuid() tap1, gen_random_uuid() offline1, gen_random_uuid() late1 \gset
select pg_temp.assert(public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01', :'run1',
 jsonb_build_object('id', :'tap1','kind','tap','round',1,'weight',2))->>'status'='ok', 'live count accepted');
select pg_temp.assert(public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01', :'run1',
 jsonb_build_object('id', :'tap1','kind','tap','round',1,'weight',2))->>'status'='duplicate', 'lost acknowledgement retry is duplicate');
select pg_temp.assert(public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01', :'run1',
 jsonb_build_object('id', :'offline1','kind','tap','round',1,'weight',1,'recovery',true))->>'status'='review', 'manual offline start is always review evidence');
select pg_temp.assert((public.counter_state()->>'my_total')::int=2, 'provisional evidence never increases accepted tally');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select pg_temp.refused(format($q$select public.counter_acknowledge_run('00000000-0000-0000-0000-0000000afe01',%L,true,0)$q$, :'run1'), '42501', 'outsider cannot acknowledge a phone');
select pg_temp.refused(format($q$select public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01',%L,jsonb_build_object('id',gen_random_uuid(),'kind','tap','round',1,'weight',1))$q$, :'run1'), '42501', 'outsider cannot deliver a phone count');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select public.lyst_end_round('00000000-0000-0000-0000-0000000fd001',1);
select pg_temp.as_user('00000000-0000-0000-0000-000000000099');
select pg_temp.assert(public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01', :'run1',
 jsonb_build_object('id', :'late1','kind','tap','round',1,'weight',1))->>'status'='review', 'late count retained after end');
select pg_temp.assert(public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01', :'run1',
 jsonb_build_object('id', :'late1','kind','tap','round',1,'weight',1))->>'status'='review', 'late evidence retry is idempotent');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.assert(jsonb_array_length(public.lyst_state('00000000-0000-0000-0000-0000000fd001')->'counter_recovery')=2, 'marshal sees both retained actions once');
select rev round_rev from public.lyst_rounds where match_id='00000000-0000-0000-0000-0000000fd001' and round_no=1 \gset
select public.lyst_return_round(gen_random_uuid(),'00000000-0000-0000-0000-0000000fd001',1,:round_rev,'Fictional safety recount');
select pg_temp.as_user('00000000-0000-0000-0000-000000000099');
select public.counter_state()->'prepared_run'->>'id' run2 \gset
select pg_temp.assert(:'run1' <> :'run2', 'recount has a different run identity');
select pg_temp.assert(public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01', :'run1',
 jsonb_build_object('id',gen_random_uuid(),'kind','tap','round',1,'weight',1))->>'status'='review', 'old run cannot enter recount tally');
select pg_temp.assert(public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01', :'run2',
 jsonb_build_object('id',gen_random_uuid(),'kind','tap','round',1,'weight',1))->>'total'='3', 'new run count retains existing accepted evidence exactly once');
reset role;
select pg_temp.assert((select count(*)=2 from public.lyst_counts where seat_id='00000000-0000-0000-0000-0000000afe01'), 'only two accepted counts exist');
select pg_temp.assert(not exists(select 1 from public.matches where id='00000000-0000-0000-0000-0000000fd001' and result is not null), 'counter evidence never finalized a fight');

-- Clock recovery: missing preparation needs an explicit reason; a lost Go
-- response cannot restart after another action; an undelivered old Go expires.
insert into public.lyst_counter_seats(id,event_id,field_key,user_id,display_name,match_id,side,role,status,expires_at) values
 ('00000000-0000-0000-0000-0000000afe02','00000000-0000-0000-0000-00000000ed01','field 1','00000000-0000-0000-0000-0000000000a6','Fictional Official Phone','00000000-0000-0000-0000-0000000fd001','b','official','active',now()+interval '1 day');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select rev start_rev from public.lyst_timer where event_id='00000000-0000-0000-0000-00000000ed01' and field_key='field 1' \gset
select pg_temp.refused(format($q$select public.lyst_timer_command_reliable('00000000-0000-0000-0000-00000000ed01','field 1','00000000-0000-0000-0000-0000000fd001',%s,gen_random_uuid(),'start','fight',60000,1,0,null,clock_timestamp())$q$,:start_rev),'P0001','unprepared official phone requires start override');
-- Model a real five-second transport delay after the previous clock change.
reset role;
update public.lyst_timer set updated_at=clock_timestamp()-interval '30 seconds',started_at=clock_timestamp()-interval '30 seconds'
where event_id='00000000-0000-0000-0000-00000000ed01' and field_key='field 1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select gen_random_uuid() go_id,clock_timestamp()-interval '5 seconds' go_pressed \gset
select pg_temp.assert(public.lyst_timer_command_reliable('00000000-0000-0000-0000-00000000ed01','field 1','00000000-0000-0000-0000-0000000fd001',:start_rev,:'go_id','start','fight',60000,1,0,'Fictional marshal uses paper backup',:'go_pressed'::timestamptz)->>'status'='ok','reasoned start keeps organizer control');
select pg_temp.assert((public.lyst_state('00000000-0000-0000-0000-0000000fd001')->'timer'->>'now_remaining_ms')::int<=55000,'clock compensates bounded command transport lag');
select rev pause_rev from public.lyst_timer where event_id='00000000-0000-0000-0000-00000000ed01' and field_key='field 1' \gset
select public.lyst_timer_command_reliable('00000000-0000-0000-0000-00000000ed01','field 1','00000000-0000-0000-0000-0000000fd001',:pause_rev,gen_random_uuid(),'pause',null,null,null,0,null,clock_timestamp());
select pg_temp.assert(public.lyst_timer_command_reliable('00000000-0000-0000-0000-00000000ed01','field 1','00000000-0000-0000-0000-0000000fd001',:start_rev,:'go_id','start','fight',60000,1,0,'Fictional marshal uses paper backup',:'go_pressed'::timestamptz)->>'status'='duplicate','lost Go acknowledgement is duplicate after Pause');
select pg_temp.assert(public.lyst_state('00000000-0000-0000-0000-0000000fd001')->'timer'->>'status'='paused','retry never restarted the clock');
select rev expired_rev from public.lyst_timer where event_id='00000000-0000-0000-0000-00000000ed01' and field_key='field 1' \gset
select pg_temp.assert(public.lyst_timer_command_reliable('00000000-0000-0000-0000-00000000ed01','field 1','00000000-0000-0000-0000-0000000fd001',:expired_rev,gen_random_uuid(),'start','fight',60000,1,0,'Fictional paper backup',clock_timestamp()-interval '2 minutes')->>'status'='expired','an undelivered old Go cannot start late');
select pg_temp.assert((public.lyst_state('00000000-0000-0000-0000-0000000fd001')->'timer'->>'rev')::int=:expired_rev,'expired action changed no clock state');
select rev confirm_rev from public.lyst_rounds where match_id='00000000-0000-0000-0000-0000000fd001' and round_no=1 \gset
select pg_temp.refused(format($q$select public.lyst_confirm_round(gen_random_uuid(),'00000000-0000-0000-0000-0000000fd001',1,3,1,%s,null,null,null)$q$,:confirm_rev),'22023','missing delivery requires a marshal reason');
select pg_temp.assert(public.lyst_confirm_round(gen_random_uuid(),'00000000-0000-0000-0000-0000000fd001',1,3,1,:confirm_rev,null,null,'Marshal checked the fictional paper sheet')->>'status'='ok','paper score remains available with an audited reason');

-- A carried seat still uploads its old offered run, never into its new fight.
reset role;
update public.lyst_counter_seats set match_id='00000000-0000-0000-0000-0000000fd002' where id='00000000-0000-0000-0000-0000000afe01';
select pg_temp.as_user('00000000-0000-0000-0000-000000000099');
select pg_temp.assert(public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01', :'run1',
 jsonb_build_object('id',gen_random_uuid(),'kind','tap','round',1,'weight',1))->>'status'='review','historical offered assignment allows late evidence from a carried seat');
select pg_temp.assert(public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01', :'run1',
 jsonb_build_object('id',:'tap1','kind','tap','round',1,'weight',2))->>'status'='duplicate','carried seat recovers a lost old acknowledgement');
select pg_temp.refused(format($q$select public.counter_deliver_action('00000000-0000-0000-0000-0000000afe01',%L,jsonb_build_object('id',%L,'kind','tap','round',1,'weight',2))$q$,:'run2',:'tap1'),'42501','accepted command ID cannot move into a different run');
reset role;
select pg_temp.assert(not exists(select 1 from public.lyst_counts where seat_id='00000000-0000-0000-0000-0000000afe01' and match_id='00000000-0000-0000-0000-0000000fd002'),'old fight evidence never changes the carried seat new tally');

do $$ begin raise notice 'REHEARSAL INTEGRITY GATE PASSED'; end $$;
rollback;
