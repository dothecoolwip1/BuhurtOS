// Real PostgreSQL sessions, coordinated by advisory barriers rather than guessed sleeps.
// Run only against the dedicated, freshly built scratch database; never accepts a URL.
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const host = process.env.PGHOST ?? '';
if (!(host.startsWith('/') || ['localhost', '127.0.0.1'].includes(host)) || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL) throw Error('Local scratch PostgreSQL only');
const db = 'bos_role_race', exe = process.env.PSQL_BIN ?? 'psql';
const args = ['-X', '-q', '-At', '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1', '-d', db];
function sql(s) {
  const r = spawnSync(exe, args, { input: s, encoding: 'utf8' });
  if (r.status !== 0) throw Error(r.stderr || String(r.error));
  return r.stdout.trim();
}
const actors = [];
function actor(name, s) {
  const p = spawn(exe, args, { env: { ...process.env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
  const a = { p, out: '', err: '', done: false };
  p.stdout.on('data', b => { a.out += b; }); p.stderr.on('data', b => { a.err += b; });
  a.exit = new Promise(resolve => p.on('close', code => { a.done = true; a.code = code; resolve(a); }));
  actors.push(a); p.stdin.write("set statement_timeout='20s';\n" + s + '\n'); return a;
}
async function until(test, why) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (test()) return; await new Promise(r => setTimeout(r, 40)); }
  throw Error(`Timed out: ${why}`);
}
async function blocked(name) {
  await until(() => sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock')`) === 't', name + ' waiting on a real lock');
}
const as = n => `set role authenticated; select set_config('request.jwt.claim.sub', t.u(${n})::text, false);`;
async function gate(name, n) { const g = actor(name, `begin; select pg_advisory_xact_lock(${n}); select 'HELD';`); await until(() => g.out.includes('HELD'), 'barrier acquired'); return g; }
async function finish(g) { g.p.stdin.end('commit;\n'); const r = await g.exit; assert.equal(r.code, 0, r.err); }
let wrapped = false;
try {
  sql('begin;\n\\i supabase/tests/pack181_common.sql\ncommit;');
  sql("update public.matches set queue_state=case when id=t.m(1) then 'on_deck' when id=t.m(2) then 'in_the_hole' else queue_state end;");
  // First secretary has started m1 but cannot commit until the controller releases the barrier.
  let g = await gate('role-race-controller', 820231);
  const a = actor('role-race-secretary-a', `begin; ${as(4)} select public.set_match_queue(t.m(1),'active',null); select 'STARTED'; select pg_advisory_xact_lock(820231); commit;`);
  await until(() => a.out.includes('STARTED'), 'first secretary started');
  const b = actor('role-race-secretary-b', `begin; ${as(4)} select public.set_match_queue(t.m(2),'active',null); commit;`); b.p.stdin.end();
  await blocked('role-race-secretary-b');
  await finish(g); a.p.stdin.end();
  assert.equal((await a.exit).code, 0, a.err);
  assert.notEqual((await b.exit).code, 0, 'second secretary must be refused');
  assert.match(b.err, /another fight is on now/);
  assert.equal(sql("select count(*) from public.matches where competition_id=t.comp(1) and field='Field 1' and queue_state='active'"), '1');
  console.log('PASS two secretaries starting concurrently leave exactly one active fight');

  // Instrument ONLY this throwaway database at the old read/lock gap.
  sql(`update public.matches set queue_state='scheduled', queue_order=null where competition_id=t.comp(1);
    alter function private.lock_matches_nowait(uuid[]) rename to role_race_original_lock;
    create function private.lock_matches_nowait(ids uuid[]) returns boolean language plpgsql security definer set search_path='' as $$
    begin perform pg_advisory_xact_lock(820232); return private.role_race_original_lock(ids); end $$;`);
  wrapped = true;
  g = await gate('role-race-controller', 820232);
  const lineup = actor('role-race-lineup', `begin; ${as(1)} select public.save_field_lineup(t.ev(1),'Field 1',array[t.m(2),t.m(1)],
    (select jsonb_object_agg(id::text,jsonb_build_object('version',version,'queue_state',queue_state,'queue_order',queue_order,'plan_order',plan_order,'plan_hold',plan_hold)) from public.matches where id in(t.m(1),t.m(2)))); commit;`);
  lineup.p.stdin.end(); await blocked('role-race-lineup');
  const open = actor('role-race-open', `begin; ${as(1)} select public.lyst_open(t.m(2),'simple'); commit;`); open.p.stdin.end();
  await blocked('role-race-open');
  await finish(g);
  await lineup.exit;
  if (lineup.code === 0) assert.match(lineup.out, /"status": "ok"/);
  else assert.match(lineup.err, /someone else is changing these fights right now; try again/);
  assert.equal((await open.exit).code, 0, open.err); assert.match(open.out, /"status": "ok"/);
  // lyst_open inserts lyst_matches (FK key-share) before waiting on the field lock. The lineup may therefore fail NOWAIT safely;
  // it must either complete before opening, or change nothing and ask the organizer to retry.
  assert.equal(sql("select queue_state from public.matches where id=t.m(2)"), lineup.code === 0 ? 'on_deck' : 'scheduled');
  assert.equal(sql('select count(*) from public.lyst_field_current where match_id=t.m(2)'), '1');
  console.log('PASS lineup versus Lyst open serializes or asks to retry without moving a started fight');

  sql("update public.matches set queue_state='active' where id in(t.m(3),t.m(4));");
  g = await gate('role-race-controller', 820233);
  const final = actor('role-race-final-first', `begin; ${as(1)} select public.submit_match_result(gen_random_uuid(),t.m(3),'a',5,3,'{}',0,1); select 'FINALIZED'; select pg_advisory_xact_lock(820233); commit;`);
  await until(() => final.out.includes('FINALIZED'), 'result held before commit');
  const late = actor('role-race-late-round', `begin; ${as(1)} select public.lyst_confirm_round(gen_random_uuid(),t.m(3),1,5,3,0); commit;`); late.p.stdin.end();
  const lateOpen = actor('role-race-late-open', `begin; ${as(1)} select public.lyst_open(t.m(3),'simple'); commit;`); lateOpen.p.stdin.end();
  await blocked('role-race-late-round'); await blocked('role-race-late-open'); await finish(g); final.p.stdin.end();
  assert.equal((await final.exit).code, 0, final.err);
  assert.notEqual((await late.exit).code, 0); assert.match(late.err, /already final/);
  assert.notEqual((await lateOpen.exit).code, 0); assert.match(lateOpen.err, /already final/);
  assert.equal(sql('select count(*) from public.lyst_rounds where match_id=t.m(3)'), '0');
  assert.equal(sql('select count(*) from public.lyst_field_current where match_id=t.m(3)'), '0');
  console.log('PASS finalization wins: waiting round and Lyst-open writers leave the final fight untouched');

  g = await gate('role-race-controller', 820234);
  const round = actor('role-race-round-first', `begin; ${as(11)} select public.lyst_confirm_round(gen_random_uuid(),t.m(4),1,5,3,0); select 'CONFIRMED'; select pg_advisory_xact_lock(820234); commit;`);
  await until(() => round.out.includes('CONFIRMED'), 'confirmed round held before commit');
  const after = actor('role-race-final-after', `begin; ${as(11)} select public.submit_match_result(gen_random_uuid(),t.m(4),'a',5,3,'{}',0,1); commit;`); after.p.stdin.end();
  await blocked('role-race-final-after'); await finish(g); round.p.stdin.end();
  assert.equal((await round.exit).code, 0, round.err); assert.equal((await after.exit).code, 0, after.err);
  assert.equal(sql("select queue_state from public.matches where id=t.m(4)"), 'final');
  assert.equal(sql("select status || ':' || awarded_a || '-' || awarded_b from public.lyst_rounds where match_id=t.m(4)"), 'confirmed:5-3');
  console.log('PASS round writer wins: finalization waits and completes without a deadlock');
  sql("insert into public.matches(id,competition_id,stage,round_label,position,entry_a,entry_b,queue_state,field) values(t.m(5),t.comp(1),'round_robin','Retry',5,t.en(1),t.en(2),'active','Field 4');");
  sql(`begin; ${as(1)} select public.lyst_confirm_round(gen_random_uuid(),t.m(5),1,5,3,0); commit;`);
  g = await gate('role-race-controller', 820235);
  const cmd = '00000000-0000-0000-0000-0000000adc99';
  const saved = actor('role-race-save', `begin; ${as(1)} select public.submit_match_result('${cmd}',t.m(5),'a',5,3,'{}',0,1); select 'SAVED'; select pg_advisory_xact_lock(820235); commit;`);
  await until(() => saved.out.includes('SAVED'), 'first result saved before commit');
  const retry = actor('role-race-retry', `begin; ${as(1)} select public.lyst_finalize('${cmd}',t.m(5),0,'a'); commit;`); retry.p.stdin.end();
  await blocked('role-race-retry'); await finish(g); saved.p.stdin.end();
  assert.equal((await saved.exit).code, 0, saved.err); assert.equal((await retry.exit).code, 0, retry.err);
  assert.match(retry.out, /"repeat": true/);
  assert.equal(sql(`select count(*) from public.result_proposals where id='${cmd}'`), '1');
  assert.equal(sql('select version from public.matches where id=t.m(5)'), '1');
  console.log('PASS concurrent retry through another scoring path returns the same result exactly once');
  console.log('ADVERSARIAL ROLE CONCURRENCY OK');
} finally {
  for (const a of actors) if (!a.done) a.p.kill();
  await Promise.all(actors.map(a => a.exit));
  if (wrapped) sql('drop function private.lock_matches_nowait(uuid[]); alter function private.role_race_original_lock(uuid[]) rename to lock_matches_nowait;');
}
