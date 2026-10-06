begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000aa02','o@example.test');
insert into public.events (id, slug, name, status, starts_on, ends_on) values ('00000000-0000-0000-0000-00000000ee01','hold-baseline','Hold baseline','published', current_date, current_date);
insert into public.event_staff (event_id,user_id,role) values ('00000000-0000-0000-0000-00000000ee01','00000000-0000-0000-0000-00000000aa02','organizer');
insert into public.teams (id, slug, name, status, city, country) select ('00000000-0000-0000-0000-00000000cc'||lpad(n::text,2,'0'))::uuid, 'ht'||n,'T'||n,'approved','x','CA' from generate_series(1,3) n;
insert into public.competitions (id,event_id,name,category,gender,tier,structure,sort) values ('00000000-0000-0000-0000-00000000bb01','00000000-0000-0000-0000-00000000ee01','Comp','5v5','men','Classic','round_robin',1);
insert into public.entries (id,competition_id,team_id) select ('00000000-0000-0000-0000-00000000dd'||lpad(n::text,2,'0'))::uuid,'00000000-0000-0000-0000-00000000bb01',('00000000-0000-0000-0000-00000000cc'||lpad(n::text,2,'0'))::uuid from generate_series(1,3) n;
insert into public.matches (id,competition_id,stage,round_label,position,entry_a,entry_b) values
 ('00000000-0000-0000-0000-00000000ff01','00000000-0000-0000-0000-00000000bb01','round_robin','Round 1',0,'00000000-0000-0000-0000-00000000dd01','00000000-0000-0000-0000-00000000dd02'),
 ('00000000-0000-0000-0000-00000000ff02','00000000-0000-0000-0000-00000000bb01','round_robin','Round 2',0,'00000000-0000-0000-0000-00000000dd01','00000000-0000-0000-0000-00000000dd03');
set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000aa02',true);
select 'hold written through the only hold API (save_queue_plan)', public.save_queue_plan('00000000-0000-0000-0000-00000000ee01', array['00000000-0000-0000-0000-00000000ff01','00000000-0000-0000-0000-00000000ff02']::uuid[], array['00000000-0000-0000-0000-00000000ff01']::uuid[])::text;
select 'plan_hold now', plan_hold from public.matches where id='00000000-0000-0000-0000-00000000ff01';
select 'Event day opened (it sends the planner holds only, none here)', public.save_queue_plan('00000000-0000-0000-0000-00000000ee01', array['00000000-0000-0000-0000-00000000ff01','00000000-0000-0000-0000-00000000ff02']::uuid[], '{}'::uuid[])::text;
select 'plan_hold now', plan_hold from public.matches where id='00000000-0000-0000-0000-00000000ff01';
rollback;
