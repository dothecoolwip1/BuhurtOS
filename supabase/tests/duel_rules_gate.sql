-- Duel rules gate: BI Duels Rules 26.4, Duels Regulations 26.4 (rules audit 2026-10-29). Pack 18.1 fixture; everything is rolled back.
-- u1 organizer E1, u4 scorekeeper (secretary) E1.
\set ON_ERROR_STOP on
begin;
\i supabase/tests/pack181_common.sql

select t.as_admin();
create function t.r(mn int, r int) returns void language sql security definer as $$
  insert into public.lyst_rounds (match_id, round_no, event_id, status) values (t.m(mn), r, t.ev(1), 'confirming') $$;
create function t.rev(mn int, r int) returns int language sql stable security definer as $$ select rev from public.lyst_rounds where match_id = t.m(mn) and round_no = r $$;
create function t.ver(mn int) returns int language sql stable security definer as $$ select version from public.matches where id = t.m(mn) $$;
create function t.conf(mn int, r int, a int, b int) returns text language sql as $$ select public.lyst_confirm_round(gen_random_uuid(), t.m(mn), r, a, b, t.rev(mn, r), null, null, null) ->> 'status' $$;
create function t.fin(mn int, res text, basis text default 'score', why text default null) returns text language sql as $$ select public.lyst_finalize(gen_random_uuid(), t.m(mn), t.ver(mn), res, basis, why) ->> 'status' $$;
grant execute on all functions in schema t to authenticated, anon;

insert into public.competitions (id, event_id, name, category, gender, tier, structure, sort) values
  (t.comp(31), t.ev(1), 'Sword and buckler', 'buckler', 'men', 'Classic', 'round_robin', 3);
insert into public.entries (id, competition_id, fighter_id) select t.en(310 + n), t.comp(31), ('00000000-0000-0000-0000-' || lpad('f181' || n, 12, '0'))::uuid from generate_series(1, 2) n;
insert into public.matches (id, competition_id, stage, round_label, position, entry_a, entry_b, queue_state, field) values
  (t.m(31), t.comp(1), 'round_robin', 'R1', 31, t.en(1), t.en(2), 'active', 'Field 5'),
  (t.m(32), t.comp(31), 'round_robin', 'R1', 32, t.en(311), t.en(312), 'active', 'Field 6'),
  (t.m(33), t.comp(1), 'round_robin', 'R1', 33, t.en(3), t.en(4), 'active', 'Field 7'),
  (t.m(34), t.comp(1), 'round_robin', 'R1', 34, t.en(1), t.en(3), 'active', 'Field 8');

select t.as_user(t.u(4));
select public.lyst_open(t.m(n), 'simple') from generate_series(31, 34) n;

-- Rules 2.2.2: longsword (and sword and shield, polearm): the regular rounds, then at least 2 points more; never a draw
select t.as_admin(); select t.r(31, 1); select t.as_user(t.u(4));
select t.conf(31, 1, 5, 4);
select t.expect_error('one round is not a duel: fight the 2 regular rounds', $q$select t.fin(31, 'a')$q$, 'P0001');
select t.as_admin(); select t.r(31, 2); select t.as_user(t.u(4));
select t.conf(31, 2, 3, 3);
select t.expect_error('8-7 after two rounds is not a win (2 points more, Rules 2.2.2)', $q$select t.fin(31, 'a')$q$, 'P0001');
select t.expect_error('a duel has no draw', $q$select t.fin(31, 'draw')$q$, 'P0001');
select t.as_admin(); select t.r(31, 3); select t.as_user(t.u(4));
select t.conf(31, 3, 2, 0);
select t.expect_eq('after an extra round 10-7: Red wins', t.fin(31, 'a'), 'accepted');

-- Rules 2.2.1: sword and buckler: 5 points win a round, 2 round victories win the match
select t.as_admin(); select t.r(32, 1); select t.as_user(t.u(4));
select t.expect_error('a sword and buckler round is at most 5 points', $q$select t.conf(32, 1, 6, 2)$q$, '22023');
select t.conf(32, 1, 5, 0);
select t.as_admin(); select t.r(32, 2); select t.as_user(t.u(4));
select t.conf(32, 2, 4, 5);
select t.expect_error('9-5 in points is 1-1 in rounds: a third round is fought', $q$select t.fin(32, 'a')$q$, 'P0001');
select t.as_admin(); select t.r(32, 3); select t.as_user(t.u(4));
select t.conf(32, 3, 3, 5);
select t.expect_error('the points leader does not win: Blue has 2 round victories', $q$select t.fin(32, 'a')$q$, 'P0001');
select t.expect_eq('Blue wins on 2 round victories (12-10 in points to Red)', t.fin(32, 'b'), 'accepted');
select t.as_admin();
select t.expect_eq('... recorded as rounds won 1-2, the points 12-10 kept in the detail', (select score_a || '-' || score_b || ' ' || (detail -> 'totals' ->> 'a') || '-' || (detail -> 'totals' ->> 'b') from public.matches where id = t.m(32)), '1-2 12-10');

-- Regulations 4.2: a reprimand adds 3 points to the opponent (1 in sword and buckler), separately, not a deduction that stops at 0
select t.as_admin(); select t.r(33, 1); select t.as_user(t.u(4));
select t.expect_eq('the secretary records a reprimand against Red', public.lyst_record_discipline(gen_random_uuid(), t.m(33), 1, 'a', 'reprimand') ->> 'status', 'ok');
select t.as_admin();
select t.expect_eq('... it is worth 3 points to the opponent', (select amount from public.match_discipline where match_id = t.m(33) and kind = 'reprimand'), 3);
select t.as_user(t.u(4));
select t.conf(33, 1, 1, 0);
select t.expect_eq('a 1-0 round with a reprimand on Red is 1-3, and the 3 are kept apart', (select official_a || '-' || official_b || ' +' || award_b from public.lyst_round_scores where match_id = t.m(33) and round_no = 1), '1-3 +3');
select t.expect_error('a reprimand is not for a team fight or anything but a duel', $q$select public.lyst_record_discipline(gen_random_uuid(), t.m(33), 1, 'a', 'reprimand', 'Yellow')$q$, '22023');

-- Rules 2.3, 2.3.4: a technical win before any round (a no-show), scored 10-0 per regular round
select t.expect_error('a technical win needs the marshal''s reason', $q$select t.fin(34, 'b', 'technical')$q$, '22023');
select t.expect_eq('a technical win before any round is fought', t.fin(34, 'b', 'technical', 'Red did not report to the list'), 'accepted');
select t.as_admin();
select t.expect_eq('... scored 0-20 (10-0 for each of the 2 regular rounds)', (select score_a || '-' || score_b from public.matches where id = t.m(34)), '0-20');
select t.expect_eq('a sword and buckler technical win is 2 rounds to 0 (5-0 for 2 rounds)', private.technical_win_points(t.m(32)), 2);

do $$ begin raise notice 'DUEL RULES GATE PASSED % checks', (select count(*) from t.log); end $$;
rollback;
