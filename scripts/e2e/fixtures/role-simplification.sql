-- Disposable local role rehearsal only. Never seed into the hosted database.
\i scripts/e2e/fixtures/announcer.sql
insert into public.fighters (id, display_name, gender) values ('00000000-0000-0000-0000-00000000f121', 'Reserve Fighter (local test)', 'male');
insert into public.entries (id, competition_id, fighter_id) values ('00000000-0000-0000-0000-00000000e256', '00000000-0000-0000-0000-00000000cd04', '00000000-0000-0000-0000-00000000f121');
update public.fighters set joined_year = 2018 where id = '00000000-0000-0000-0000-00000000f115';

update public.fighters set joined_year = 2017 where id = '00000000-0000-0000-0000-00000000f117';
