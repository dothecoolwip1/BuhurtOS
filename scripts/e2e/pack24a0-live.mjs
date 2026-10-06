// Pack 24A0: match safety guards, verified in the running product (real Postgres from every migration, PostgREST, the built app, Chromium).
// TEST DATA ONLY (the Pack 23R fixture). Run it through scripts/e2e/pack24a0-live.sh. Not part of CI.
// What it proves in the browser: the real client's draws are accepted by the new bracket validation (Build tournament and pools to bracket);
// opening Event day does not clear a deliberate hold; the public page lists NOW, ON DECK, IN THE HOLE; a draw that cannot be rebuilt says why (both the
// case the screen can see and the case only the server can see); the scorekeeper's field screen still opens a called fight; Run > Set time still works
// and is audited; and the raw table rights the Pack 23R rehearsal used are refused by the live API.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const E = {}, results = [];
const note = (k, v) => { E[k] = v; console.log(`EVIDENCE ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 900)); return v; };
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); return !!ok; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const A = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const hex = (n) => n.toString(16).padStart(2, '0');
const fid = (n) => `00000000-0000-0000-0000-0000000f11${hex(n)}`;
const uid = (n) => `00000000-0000-0000-0000-0000000e11${hex(n)}`;
const WHO = { organizer: [A(2), 'a2@example.test'], headmarshal: [A(3), 'a3@example.test'], scorer: [A(4), 'a4@example.test'], checkin: [A(5), 'a5@example.test'], stranger: [A(7), 'a7@example.test'], f1: [uid(1), 'f1@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-q', '-d', DB, '-c', q], { encoding: 'utf8', env: { ...process.env, PGTZ: 'America/Edmonton' } }).trim();
const hdr = (who) => ({ 'content-type': 'application/json', apikey: 'x', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) });
async function rpc(who, fn, args) { const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: hdr(who), body: JSON.stringify(args) }); const body = await r.json().catch(() => null); return { status: r.status, body, msg: body?.message ?? '' }; }
async function rest(who, method, path, body) { const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: { ...hdr(who), prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined }); const out = await r.json().catch(() => null); return { status: r.status, rows: Array.isArray(out) ? out.length : null, msg: out?.message ?? '' }; }
const ver = (m) => Number(sql(`select version from public.matches where id = '${m}'`));
const finish = (who, m, result = 'a', a = 5, b = 3) => rpc(who, 'submit_match_result', { p_command: crypto.randomUUID(), p_match: m, p_result: result, p_score_a: a, p_score_b: b, p_detail: {}, p_expected_version: ver(m), p_schema: 1 });

const SLUG = 'test-rumble-23r';
let EV = '';
const K = {};
const comp = (nm) => K[nm] ?? (K[nm] = sql(`select id from public.competitions where event_id = '${EV}' and name = '${nm.replace(/'/g, "''")}'`));
const idsOf = (nm) => sql(`select string_agg(id::text, ',' order by id) from public.matches where competition_id = '${comp(nm)}'`);
const count = (nm) => Number(sql(`select count(*) from public.matches where competition_id = '${comp(nm)}'`));

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VP = { phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, tabletP: { viewport: { width: 768, height: 1024 }, hasTouch: true }, desktop: { viewport: { width: 1280, height: 900 } } };
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VP[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.addInitScript(() => { try { localStorage.setItem('bos-lyst-mode', 'classic'); localStorage.setItem('bos-push-asked', '1'); } catch { /* ignore */ } });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|nominatim/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('dialog', d => d.accept());
  return { ctx, page };
}
const text = async (page, sel = 'body') => ((await page.locator(sel).first().innerText({ timeout: 8000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ');
const waitText = (page, sel, t, timeout = 40000) => page.waitForFunction(([s, x]) => (document.querySelector(s)?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(x), [sel, t.toLowerCase()], { timeout }).then(() => true, () => false);
const shot = async (page, nm, full = true) => { await sleep(300); await page.screenshot({ path: `${SHOTS}/p24a0-${nm}.png`, fullPage: full }).catch(() => undefined); };

try {
  // ============================================================== 0. the weekend, as in Pack 23R
  EV = sql(`select rehearsal.setup_23r()`);
  sql(`select rehearsal.register_all('${EV}') || '|' || rehearsal.accept_rest('${EV}') || '|' || rehearsal.mark_fees('${EV}') || '|' || rehearsal.set_rosters('${EV}') || '|' || rehearsal.checkin_rest('${EV}')`);
  for (const [email, role] of [['a3@example.test', 'head_marshal'], ['a4@example.test', 'scorekeeper'], ['a5@example.test', 'check_in']]) {
    const r = await rpc('organizer', 'grant_event_role_by_email', { p_event: EV, p_email: email, p_role: role });
    check(`crew: ${role} granted`, r.status < 300, r.msg);
  }

  // ============================================================== 1. Build tournament: every draw the real client plans is accepted by the new bracket validation
  {
    const { ctx, page } = await open('desktop', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=build`);
    await page.locator('section[aria-label="Build tournament"]').waitFor({ timeout: 45000 });
    await waitText(page, 'section[aria-label="Build tournament"]', 'tournament plan ready', 60000);
    const row = (nm) => page.locator('.bt-list li', { has: page.locator('b', { hasText: new RegExp(`^${nm.replace(/[&()]/g, '\\$&')}$`) }) });
    await row('Men Longsword').locator('summary').click();
    await row('Men Longsword').getByRole('spinbutton', { name: 'Pools' }).fill('4');
    for (const nm of ['Men Sword & Shield', 'Men Sword & Buckler', 'Men 5v5']) { await row(nm).locator('summary').click(); await row(nm).getByLabel('Format').selectOption('single_elimination'); }
    await page.getByRole('button', { name: 'Review plan' }).click();
    await page.getByRole('button', { name: /Use this plan/ }).click();
    check('Build tournament: all draws built (the server accepted every bracket shape the client planned, byes included)', await waitText(page, 'main', 'tournament built', 120000), await text(page, 'main'));
    note('build.done', (await text(page, '.bt-done')).slice(0, 200));
    check('10 competitions and 99 fights exist', sql(`select count(distinct competition_id) || '/' || count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}'`) === '10/99');
    check('every bracket match that others feed has both sides covered, exactly once (the rule the server enforces)', sql(`select count(*) from public.matches t join public.competitions k on k.id = t.competition_id where k.event_id = '${EV}' and t.stage <> 'third_place'
      and exists (select 1 from public.matches f where f.next_match_id = t.id)
      and ((t.entry_a is not null)::int + (select count(*) from public.matches f where f.next_match_id = t.id and f.next_slot = 'a') <> 1
        or (t.entry_b is not null)::int + (select count(*) from public.matches f where f.next_match_id = t.id and f.next_slot = 'b') <> 1)`) === '0');
    await ctx.close();
  }

  // ============================================================== 2. pools to bracket through the real Run screen (the 'append' path validates the bracket too)
  {
    const pool = sql(`select string_agg(id::text, ',' order by pool, position) from public.matches where competition_id = '${comp('Men Longsword')}' and stage = 'pool'`).split(',');
    let ok = 0;
    for (const m of pool) {
      const [fa, fb] = sql(`select (select f.n from public.entries e join rehearsal.fighter f on rehearsal.fid(f.n) = e.fighter_id where e.id = m.entry_a) || ',' || (select f.n from public.entries e join rehearsal.fighter f on rehearsal.fid(f.n) = e.fighter_id where e.id = m.entry_b) from public.matches m where m.id = '${m}'`).split(',').map(Number);
      const r = await finish('scorer', m, fa < fb ? 'a' : 'b', fa < fb ? 5 : 2, fa < fb ? 2 : 5);
      if (r.body?.status === 'accepted') ok += 1;
    }
    check('the 24 Longsword pool fights are finished by the scorekeeper', ok === 24, `${ok}`);
    const { ctx, page } = await open('tabletP', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=run`);
    const ls = page.locator('section[aria-label="Men Longsword"]');
    await ls.waitFor({ timeout: 45000 });
    await ls.getByRole('button', { name: 'Build bracket from pool results' }).click({ timeout: 30000 });
    const btn = ls.getByRole('button', { name: /Create \d+ bracket matches/ });
    await btn.waitFor({ timeout: 30000 });
    await btn.click();
    await sleep(2500);
    check('pools to bracket: the 8 bracket fights were accepted', sql(`select count(*) from public.matches where competition_id = '${comp('Men Longsword')}' and stage <> 'pool'`) === '8');
    check('... and the final has both feeders', sql(`select count(*) from public.matches f where f.next_match_id = (select id from public.matches where competition_id = '${comp('Men Longsword')}' and stage = 'final')`) === '2');
    await ctx.close();
  }

  // ============================================================== 3. a deliberate hold survives opening Event day (the Pack 23R finding)
  {
    const H = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and k.name = 'Men 3v3' and m.queue_state = 'scheduled' and m.entry_a is not null and m.entry_b is not null order by m.position, m.id offset 3 limit 1`);
    const hold = await rpc('organizer', 'set_match_hold', { p_match: H, p_held: true, p_reason: 'Fighter at the medic (TEST)' });
    check('the organizer holds a fight with a reason', hold.status === 200 && sql(`select plan_hold || '/' || hold_manual from public.matches where id = '${H}'`) === 'true/true', JSON.stringify(hold));
    // make the page do real work: wipe the saved plan, so opening Event day has to re-plan and save it
    sql(`update public.matches m set plan_order = null, plan_hold = (m.hold_manual) from public.competitions k where k.id = m.competition_id and k.event_id = '${EV}' and m.queue_state = 'scheduled'`);
    const planned0 = Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'scheduled' and m.plan_order is not null`));
    check('(setup) no saved plan before Event day is opened', planned0 === 0, String(planned0));
    for (const kind of ['desktop', 'tabletP']) {
      sql(`update public.matches m set plan_order = null from public.competitions k where k.id = m.competition_id and k.event_id = '${EV}' and m.queue_state = 'scheduled'`);
      const { ctx, page } = await open(kind, 'organizer');
      await page.goto(BASE + `/events/${SLUG}/manage?tab=eventday`);
      await page.locator('section[aria-label="Event day"]').waitFor({ timeout: 45000 });
      await sleep(7000);   // the page saves its plan about a second after it has loaded it
      const planned = Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'scheduled' and m.plan_order is not null`));
      check(`[${kind}] opening Event day saved the plan (so the page really did write: ${planned} fights planned)`, planned > 20, String(planned));
      check(`[${kind}] ... and the deliberate hold is still held`, sql(`select plan_hold || '/' || hold_manual from public.matches where id = '${H}'`) === 'true/true', sql(`select plan_hold || '/' || hold_manual from public.matches where id = '${H}'`));
      await shot(page, `03-eventday-hold-${kind}`, false);
      await ctx.close();
    }
    const rel = await rpc('organizer', 'set_match_hold', { p_match: H, p_held: false });
    check('the organizer releases it explicitly', rel.status === 200 && sql(`select plan_hold || '/' || hold_manual from public.matches where id = '${H}'`) === 'false/false', JSON.stringify(rel));
    const { ctx, page } = await open('desktop', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=eventday`); await page.locator('section[aria-label="Event day"]').waitFor({ timeout: 45000 }); await sleep(5000);
    check('... and opening Event day does not hold it again by itself', sql(`select plan_hold::text || '/' || hold_manual::text from public.matches where id = '${H}'`) === 'false/false');
    await ctx.close();
    note('hold.audit', sql(`select string_agg(action || ' by ' || coalesce((select email from auth.users where id = actor), '?'), ', ' order by id) from public.audit_log where subject = '${H}' and action like 'queue.hold%'`));
    // refused for everyone else
    for (const who of ['scorer', 'headmarshal', 'checkin', 'f1', 'stranger']) {
      const r = await rpc(who, 'set_match_hold', { p_match: H, p_held: true, p_reason: 'not allowed' });
      check(`${who} cannot hold a fight`, r.status === 403, JSON.stringify(r));
    }
  }

  // ============================================================== 4. the public page lists NOW, ON DECK, IN THE HOLE
  {
    for (let i = 0; i < 3; i += 1) { const r = await rpc('scorer', 'advance_field_queue', { p_event: EV, p_field: 'Field 1', p_start: true }); if (r.status !== 200) break; }
    const states = sql(`select string_agg(queue_state, ',' order by case queue_state when 'active' then 0 when 'on_deck' then 1 else 2 end) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state in ('active','on_deck','in_the_hole')`);
    check('Field 1 has a fight now, one on deck and one in the hole', states === 'active,on_deck,in_the_hole', states);
    for (const kind of ['phone', 'desktop']) {
      const { ctx, page } = await open(kind, null);
      await page.goto(BASE + `/events/${SLUG}`);
      await page.waitForFunction(() => /now and next/i.test(document.body.innerText), null, { timeout: 45000 });
      await sleep(1500);
      const body = (await text(page, 'main'));
      const at = body.search(/NOW AND NEXT/i);
      const seg = body.slice(at + 'NOW AND NEXT'.length, at + 'NOW AND NEXT'.length + 700);   // after the heading, which itself contains the word NOW
      const order = [...seg.matchAll(/\b(NOW|ON DECK|IN THE HOLE)\b/g)].map(m => m[1]);
      note(`public.${kind}.order`, order);
      check(`[${kind}] the public page lists NOW, then ON DECK, then IN THE HOLE`, order.slice(0, 3).join('>') === 'NOW>ON DECK>IN THE HOLE', order.join('>'));
      const el = page.locator('text=/now and next/i').first();
      await el.scrollIntoViewIfNeeded().catch(() => undefined);
      await shot(page, `04-public-now-next-${kind}`, false);
      await ctx.close();
    }
  }

  // ============================================================== 5. a draw that cannot be rebuilt says why
  {
    const live = sql(`select k.name from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active' limit 1`);
    const { ctx, page } = await open('desktop', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=run`);
    const sec = page.locator(`section[aria-label="${live}"]`);
    await sec.waitFor({ timeout: 45000 });
    // (a) the screen can see the fight is being fought: the control is off and says why
    await sec.getByRole('button', { name: 'Build a new draw' }).click();
    const msg = await text(page, `section[aria-label="${live}"] [role="alert"]`);
    check(`(a) ${live}: a fight is active, so the draw cannot be replaced and the screen says why`, /started or have a result/.test(msg) && /never deleted/.test(msg), msg);
    check('(a) ... "Use this draw" is disabled', await sec.getByRole('button', { name: 'Use this draw' }).isDisabled());
    await sec.locator('[role="alert"]').first().scrollIntoViewIfNeeded();
    await shot(page, '05-rebuild-blocked-active-1280', false);
    const before = idsOf(live);
    // (b) history the screen cannot see: a waiting fight with scoring events (the server decides)
    const Y = 'Women Longsword';
    const wy = sql(`select id from public.matches where competition_id = '${comp(Y)}' and queue_state = 'scheduled' order by id limit 1`);
    sql(`insert into public.score_events (id, match_id, kind, payload, recorded_by) values (gen_random_uuid(), '${wy}', 'round', '{"a":1,"b":0}', '${A(4)}')`);
    const ys = page.locator(`section[aria-label="${Y}"]`);
    await ys.getByRole('button', { name: 'Build a new draw' }).click();
    await ys.getByRole('button', { name: 'Use this draw' }).click();
    await ys.getByRole('button', { name: 'Yes, replace them' }).click();
    const refused = await waitText(page, `section[aria-label="${Y}"]`, 'cannot be replaced', 20000);
    const emsg = await text(page, `section[aria-label="${Y}"] [role="alert"]`);
    check(`(b) ${Y}: the server refuses and the screen shows its reason`, refused && /scoring has been recorded/.test(emsg), emsg);
    check('(b) ... the fights and the scoring event are untouched', count(Y) === 10 && sql(`select count(*) from public.score_events where match_id = '${wy}'`) === '1');
    await ys.locator('[role="alert"]').first().scrollIntoViewIfNeeded();
    await shot(page, '05-rebuild-refused-by-server-1280', false);
    check('(a) ... the active fight\'s competition is intact too', idsOf(live) === before);
    // (c) an untouched draw is rebuilt by the same screen
    const Z = 'Men Sabre';
    const zBefore = idsOf(Z);
    const zs = page.locator(`section[aria-label="${Z}"]`);
    await zs.getByRole('button', { name: 'Build a new draw' }).click();
    await zs.getByRole('button', { name: 'Draw again' }).click();
    await zs.getByRole('button', { name: 'Use this draw' }).click();
    await zs.getByRole('button', { name: 'Yes, replace them' }).click();
    await sleep(3500);
    check(`(c) ${Z}: an untouched draw can still be rebuilt from the screen`, idsOf(Z) !== zBefore && count(Z) === 9, `${count(Z)}`);
    check('(c) ... and the rebuild is on the audit trail with what it replaced', /^replace\|9$/.test(sql(`select details ->> 'mode' || '|' || (details ->> 'replaced') from public.audit_log where action = 'schedule.built' and subject = '${comp(Z)}' order by id desc limit 1`)));
    await ctx.close();
  }

  // ============================================================== 6. the scorekeeper's field screen still works; the shortcuts do not
  {
    const { ctx, page } = await open('tabletP', 'scorer');
    await page.goto(BASE + `/events/${SLUG}/field/Field%201`);
    await page.locator('button[aria-label^="Score "]').first().waitFor({ timeout: 45000 });
    const called = await page.locator('button[aria-label^="Score "]').count();
    note('scorer.field_called_fights_listed', called);
    check('the scorekeeper sees only the called fights (now, on deck, in the hole), not the whole line', called >= 1 && called <= 3, String(called));
    await shot(page, '06-scorer-field-768');
    const onDeck = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'on_deck' limit 1`);
    await page.locator('button[aria-label^="Score "]').nth(1).click();
    await sleep(3500);
    check('... tapping the on-deck fight opens it (set_match_queue active for a called fight still works)', sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active'`) !== '0' && /Pending: not official until you save|Round 1/.test(await text(page, 'main')), (await text(page, 'main')).slice(0, 300));
    await shot(page, '06-scorer-scoring-768', false);
    await ctx.close();
    const waiting = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'scheduled' and m.entry_a is not null and m.entry_b is not null order by m.id limit 1`);
    const pull = await rpc('scorer', 'set_match_queue', { p_match: waiting, p_state: 'on_deck', p_field: null });
    check('the scorekeeper cannot pull a waiting fight on deck any more (403)', pull.status === 403 && sql(`select queue_state from public.matches where id = '${waiting}'`) === 'scheduled', JSON.stringify(pull));
    const pull2 = await rpc('headmarshal', 'set_match_queue', { p_match: waiting, p_state: 'on_deck', p_field: null });
    check('... nor the head marshal (403)', pull2.status === 403, JSON.stringify(pull2));
    const ok = await rpc('organizer', 'set_match_queue', { p_match: waiting, p_state: 'on_deck', p_field: null });
    check('... the organizer still can (204)', ok.status === 204, JSON.stringify(ok));
    await rpc('organizer', 'set_match_queue', { p_match: waiting, p_state: 'scheduled', p_field: null });
    // the raw table rights the rehearsal used
    const m0 = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'scheduled' and m.next_match_id is not null limit 1`);
    const raw = {
      delete: await rest('organizer', 'DELETE', `matches?id=eq.${m0}`),
      patch_entry: await rest('organizer', 'PATCH', `matches?id=eq.${m0}`, { entry_a: null }),
      patch_link: await rest('organizer', 'PATCH', `matches?id=eq.${m0}`, { next_match_id: null }),
      insert: await rest('organizer', 'POST', 'matches', { competition_id: comp('Men 3v3'), stage: 'round_robin', round_label: 'Extra', position: 99 })
    };
    note('raw_table_writes_as_organizer', raw);
    check('the live API refuses the organizer\'s raw DELETE, entrant edit, relink and insert (403)', Object.values(raw).every(r => r.status === 403), JSON.stringify(raw));
    check('... and the match is still there, unchanged', sql(`select count(*) from public.matches where id = '${m0}' and next_match_id is not null and entry_a is not null`) === '1');
  }

  // ============================================================== 7. Run > Set time still works and is audited
  {
    const { ctx, page } = await open('desktop', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=run`);
    const sec = page.locator('section[aria-label="Men Long Axe (Polearm)"]');
    await sec.waitFor({ timeout: 45000 });
    const card = sec.locator('button', { hasText: /^Set time$/ }).first();
    await card.click();
    await sec.locator('input[type="datetime-local"]').first().fill('2026-10-07T10:30');
    await sec.getByRole('button', { name: 'Save' }).first().click();
    await sleep(2500);
    if (await sec.getByRole('button', { name: 'Schedule anyway' }).count()) await sec.getByRole('button', { name: 'Schedule anyway' }).click();
    await sleep(2500);
    const row = sql(`select to_char(m.scheduled_at at time zone 'America/Edmonton', 'YYYY-MM-DD HH24:MI') from public.matches m where m.competition_id = '${comp('Men Long Axe (Polearm)')}' and m.scheduled_at is not null`);
    check('Run: Set time wrote the time', row === '2026-10-07 10:30', row);
    const aud = sql(`select count(*) || '|' || max((details -> 'changes' -> 0 -> 'scheduled_at' ->> 1)) from public.audit_log where event_id = '${EV}' and action = 'match.schedule_changed'`);
    check('... and it is on the audit trail with the new time', /^1\|/.test(aud), aud);
    await shot(page, '07-run-set-time-1280', false);
    await ctx.close();
  }

  // ============================================================== 8. the audit trail of this run
  note('audit.actions', sql(`select string_agg(action || '=' || n, ', ' order by action) from (select action, count(*) n from public.audit_log where event_id = '${EV}' group by action) x`));
} catch (e) {
  console.log('RUN STOPPED:', String(e?.stack ?? e).slice(0, 1500));
  E.__stopped = String(e?.message ?? e).slice(0, 500);
} finally {
  fs.writeFileSync(`${SHOTS}/evidence.json`, JSON.stringify({ evidence: E, checks: results }, null, 1));
  await browser.close();
  const failed = results.filter(c => !c.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(E.__stopped || failed ? 1 : 0);
}
