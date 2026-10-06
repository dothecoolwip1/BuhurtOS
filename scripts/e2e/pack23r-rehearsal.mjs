// Pack 23R: Red Deer Rumble REHEARSAL AND GAP ANALYSIS (TEST DATA ONLY) against a REAL local stack. Run it through scripts/e2e/pack23r-rehearsal.sh.
// A discovery run, not a gate: every observation is recorded in <shots>/evidence.json (and printed as EVIDENCE lines); CHECK lines are the few
// things the run itself needs to be true to continue. Authority is exercised exactly as the app does it: RPCs and REST with each person's own JWT
// (organizer a2, head marshal a3, scorekeeper a4, check-in staff a5, stranger a7, fighters f1..f52), the Build tournament and Run screens in Chromium.
// Nothing here is hosted; the fixture is scripts/e2e/fixtures/pack23r.sql on a throwaway database.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const E = {};                       // evidence, by key
const checks = [];
const note = (k, v) => { E[k] = v; console.log(`EVIDENCE ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 1500)); return v; };
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 600)}`); return !!ok; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const A = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const hex = (n) => n.toString(16).padStart(2, '0');
const fid = (n) => `00000000-0000-0000-0000-0000000f11${hex(n)}`;
const uid = (n) => `00000000-0000-0000-0000-0000000e11${hex(n)}`;
const WHO = { organizer: [A(2), 'a2@example.test'], headmarshal: [A(3), 'a3@example.test'], scorer: [A(4), 'a4@example.test'], checkin: [A(5), 'a5@example.test'], stranger: [A(7), 'a7@example.test'] };
for (let n = 1; n <= 52; n += 1) WHO[`f${n}`] = [uid(n), `f${n}@example.test`];
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-q', '-d', DB, '-c', q], { encoding: 'utf8', env: { ...process.env, PGTZ: 'America/Edmonton' } }).trim();
const hdr = (who) => ({ 'content-type': 'application/json', apikey: 'x', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) });
async function rpc(who, fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: hdr(who), body: JSON.stringify(args) });
  const body = await r.json().catch(() => null);
  return { status: r.status, body, msg: body?.message ?? '' };
}
async function rest(who, method, path, body) {
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: { ...hdr(who), prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const out = await r.json().catch(() => null);
  return { status: r.status, rows: Array.isArray(out) ? out.length : null, body: out, msg: out?.message ?? '' };
}
const outcome = (r) => `${r.status}${r.msg ? ' ' + r.msg : ''}${r.rows != null ? ` rows=${r.rows}` : ''}`;
const ver = (m) => Number(sql(`select version from public.matches where id = '${m}'`));
const finish = (who, m, result = 'a', a = 5, b = 3) => rpc(who, 'submit_match_result', { p_command: crypto.randomUUID(), p_match: m, p_result: result, p_score_a: a, p_score_b: b, p_detail: {}, p_expected_version: ver(m), p_schema: 1 });

const SLUG = 'test-rumble-23r';
const TODAY = sql(`select to_char((now() at time zone 'America/Edmonton')::date, 'YYYY-MM-DD')`);
let EV = '';
const K = {};
const comp = (nm) => K[nm] ?? (K[nm] = sql(`select id from public.competitions where event_id = '${EV}' and name = '${nm.replace(/'/g, "''")}'`));
const entryOf = (n, nm) => sql(`select id from public.entries where competition_id = '${comp(nm)}' and fighter_id = '${fid(n)}'`);
/** The server's own line for Field 1 (private.queue_ordered: manual order, plan order, time, bracket order), called slots first. */
const line = () => sql(`select string_agg(x::text, ',' order by o) from private.queue_ordered('${EV}', 'field 1', array['on_deck','in_the_hole','scheduled']) with ordinality q(x, o)`).split(',').filter(Boolean);
const label = (m) => sql(`select k.name || ' · ' || case when m.pool is not null then 'Pool ' || m.pool || ' ' else '' end || m.round_label || ' #' || m.position
  || ' · ' || coalesce(fa.display_name, ta.name, '(to be decided)') || ' vs ' || coalesce(fb.display_name, tb.name, '(to be decided)')
  from public.matches m join public.competitions k on k.id = m.competition_id
  left join public.entries ea on ea.id = m.entry_a left join public.fighters fa on fa.id = ea.fighter_id left join public.teams ta on ta.id = ea.team_id
  left join public.entries eb on eb.id = m.entry_b left join public.fighters fb on fb.id = eb.fighter_id left join public.teams tb on tb.id = eb.team_id where m.id = '${m}'`);
const day2 = new Set(['Men Long Axe (Polearm)', 'Men Sword & Buckler', 'Women Sword & Shield', 'Men Sabre', 'Men 5v5', 'Women 3v3']);
const compOf = (m) => sql(`select k.name from public.matches m join public.competitions k on k.id = m.competition_id where m.id = '${m}'`);
const activeOn = () => sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active' order by m.id limit 1`);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VP = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  tabletP: { viewport: { width: 768, height: 1024 }, hasTouch: true }, tabletL: { viewport: { width: 1024, height: 768 }, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 } }, tv: { viewport: { width: 1920, height: 1080 } }
};
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VP[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.addInitScript(() => { try { localStorage.setItem('bos-lyst-mode', 'classic'); localStorage.setItem('bos-push-asked', '1'); } catch { /* ignore */ } });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|nominatim/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.errors = []; page.requests = 0;
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('request', r => { if (r.url().includes('/rest/v1/')) page.requests += 1; });
  page.on('dialog', d => d.accept());
  return { ctx, page };
}
const text = async (page, sel = 'body') => ((await page.locator(sel).first().innerText({ timeout: 8000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ');
const waitText = (page, sel, t, timeout = 40000) => page.waitForFunction(([s, x]) => (document.querySelector(s)?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(x), [sel, t.toLowerCase()], { timeout }).then(() => true, () => false);
const shot = async (page, nm, full = true) => { await sleep(300); await page.screenshot({ path: `${SHOTS}/p23r-${nm}.png`, fullPage: full }).catch(() => undefined); };
/** Page-scale numbers for the scale findings: height, controls, rows, DOM size, sideways scrolling, 'Field 1' mentions. */
const measure = (page) => page.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const main = document.querySelector('main') ?? document.body;
  const buttons = [...main.querySelectorAll('button, a.btn, select, input, summary')].filter(vis);
  return {
    height: document.scrollingElement.scrollHeight, screens: +(document.scrollingElement.scrollHeight / innerHeight).toFixed(1),
    controls: buttons.length, smallTargets: buttons.filter(e => e.getBoundingClientRect().height < 40).length,
    rows: [...main.querySelectorAll('li, tr, article')].filter(vis).length, dom: document.getElementsByTagName('*').length,
    sideways: document.scrollingElement.scrollWidth > innerWidth + 1, field1: ((main.innerText ?? '').match(/Field 1/g) ?? []).length
  };
});
async function visit(kind, who, path, nm, ready, { wait = 2500, full = true } = {}) {
  const { ctx, page } = await open(kind, who);
  const t0 = Date.now();
  await page.goto(BASE + path);
  if (ready) await page.locator(ready).first().waitFor({ timeout: 45000 }).catch(() => undefined);
  const loadMs = Date.now() - t0;
  await sleep(wait);
  const m = { path, who, kind, loadMs, requests: page.requests, errors: page.errors.length, ...(await measure(page)) };
  await shot(page, nm, full);
  return { ctx, page, m };
}
const S = {};   // screen measurements

try {
  // ============================================================== 0. the weekend: event, ten categories, 50 registrations, check-in, crew
  EV = sql(`select rehearsal.setup_23r()`);
  const reg = sql(`select rehearsal.register_all('${EV}') || '|' || rehearsal.accept_rest('${EV}') || '|' || rehearsal.mark_fees('${EV}') || '|' || rehearsal.set_rosters('${EV}') || '|' || rehearsal.checkin_rest('${EV}')`);
  note('setup.registrations_accepted_paid_rosters_checkedin', reg);
  for (const [email, role] of [['a3@example.test', 'head_marshal'], ['a4@example.test', 'scorekeeper'], ['a5@example.test', 'check_in']]) {
    const r = await rpc('organizer', 'grant_event_role_by_email', { p_event: EV, p_email: email, p_role: role });
    check(`crew: ${role} granted`, r.status < 300, outcome(r));
  }
  note('setup.entries_per_competition', sql(`select string_agg(k.name || '=' || (select count(*) from public.entries e where e.competition_id = k.id), ', ' order by k.sort) from public.competitions k where k.event_id = '${EV}'`));
  note('setup.event', sql(`select name || ' | ' || starts_on || '..' || ends_on || ' | field_count=' || field_count || ' | synthetic=' || private.is_synthetic('event', id) from public.events where id = '${EV}'`));
  note('setup.fighters_in_3plus_categories', sql(`select count(*) from (select coalesce(e.fighter_id, ef.fighter_id) f from public.entries e join public.competitions k on k.id = e.competition_id left join public.entry_fighters ef on ef.entry_id = e.id where k.event_id = '${EV}' group by 1 having count(distinct k.id) >= 3) x`));

  // ============================================================== 1. Build tournament on the real screen, ONE lyst, as an organizer would
  {
    const { ctx, page } = await open('desktop', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=build`);
    await page.locator('section[aria-label="Build tournament"]').waitFor({ timeout: 45000 });
    await waitText(page, 'section[aria-label="Build tournament"]', 'tournament plan ready', 60000);
    note('build.plan_text', (await text(page, 'section[aria-label="Build tournament"]')).slice(0, 1600));
    await shot(page, '01-build-advice-1280');
    const row = (nm) => page.locator('.bt-list li', { has: page.locator('b', { hasText: new RegExp(`^${nm.replace(/[&()]/g, '\\$&')}$`) }) });
    const rowText = async (nm) => ((await row(nm).innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ');
    const advice = {};
    for (const nm of ['Men Longsword', 'Men Sword & Shield', 'Women Longsword', 'Men 3v3', 'Men Long Axe (Polearm)', 'Men Sword & Buckler', 'Women Sword & Shield', 'Men Sabre', 'Men 5v5', 'Women 3v3']) advice[nm] = await rowText(nm);
    note('build.default_advice_per_competition', advice);
    // the organizer's choices, as the paper schedule had them: 4 pools of 4 in Longsword; knockouts in Sword & Shield (6 → 8 slots), Buckler and 5v5
    await row('Men Longsword').locator('summary').click();
    await row('Men Longsword').getByRole('spinbutton', { name: 'Pools' }).fill('4');
    for (const nm of ['Men Sword & Shield', 'Men Sword & Buckler', 'Men 5v5']) {
      await row(nm).locator('summary').click();
      await row(nm).getByLabel('Format').selectOption('single_elimination');
    }
    const chosen = {};
    for (const nm of ['Men Longsword', 'Men Sword & Shield', 'Men Sword & Buckler', 'Men 5v5', 'Women Sword & Shield']) chosen[nm] = await rowText(nm);
    note('build.after_organizer_choices', chosen);
    note('build.no_day_or_time_control_on_build_screen', !/saturday|sunday|day 1|day 2|start time/i.test(await text(page, 'section[aria-label="Build tournament"]')));
    await page.getByRole('button', { name: 'Review plan' }).click();
    await sleep(800);
    note('build.review_lanes', await page.locator('.bt-lanes > div').count());
    note('build.review_text_head', (await text(page, '.bt-lanes')).slice(0, 900));
    await shot(page, '01-build-review-1280');
    const t0 = Date.now();
    await page.getByRole('button', { name: /Use this plan/ }).click();
    check('Build tournament: built', await waitText(page, 'main', 'tournament built', 120000));
    note('build.ms', Date.now() - t0);
    note('build.done_text', (await text(page, '.bt-done')).slice(0, 500));
    await ctx.close();
  }

  // ============================================================== 2. what was built: counts, byes, placeholders, numbers, the two-entrant category
  {
    note('built.matches_per_competition', sql(`select string_agg(k.name || '=' || (select count(*) from public.matches m where m.competition_id = k.id), ', ' order by k.sort) from public.competitions k where k.event_id = '${EV}'`));
    note('built.total_matches', Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}'`)));
    note('built.fields_used', sql(`select string_agg(distinct coalesce(m.field, '(null = Field 1)'), ',') from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}'`));
    note('built.scheduled_at_set', sql(`select count(*) filter (where scheduled_at is not null) || ' of ' || count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}'`));
    note('built.sword_shield_6_in_8', sql(`select string_agg(stage || ':' || round_label || ' pos' || position || ' sides=' || ((entry_a is not null)::int + (entry_b is not null)::int) || coalesce(' next=' || next_slot, ''), ' | ' order by private.stage_rank(stage), position) from public.matches where competition_id = '${comp('Men Sword & Shield')}'`));
    note('built.buckler_8', sql(`select string_agg(round_label || ' pos' || position || ' sides=' || ((entry_a is not null)::int + (entry_b is not null)::int), ' | ' order by private.stage_rank(stage), position) from public.matches where competition_id = '${comp('Men Sword & Buckler')}'`));
    note('built.longsword_non_pool_rows_before_pools_finish', Number(sql(`select count(*) from public.matches where competition_id = '${comp('Men Longsword')}' and stage <> 'pool'`)));
    note('built.sabre_rows', sql(`select string_agg(stage || ':' || coalesce(pool, '-'), ',') from (select stage, pool from public.matches where competition_id = '${comp('Men Sabre')}' order by pool, position) x`));
    note('built.two_entrant_women_sword_shield', sql(`select count(*) || ' match(es): ' || string_agg(stage || ' / ' || coalesce(round_label, ''), '; ') from public.matches where competition_id = '${comp('Women Sword & Shield')}'`));
    note('built.placeholder_rows_with_unknown_side', Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and (m.entry_a is null or m.entry_b is null)`)));
    note('built.number_like_columns_on_matches', sql(`select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name = 'matches' and column_name ~ '(number|no$|bout|seq|code|label)'`));
    // the planned, event-wide order: does Sunday sit inside Saturday's line?
    const order = sql(`select string_agg(k.name, '|' order by m.plan_order) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.plan_order is not null`).split('|');
    note('built.planned_fights', order.length);
    note('built.planned_first_30_competitions', order.slice(0, 30));
    const firstSunday = order.findIndex(n => day2.has(n));
    note('built.first_sunday_fight_at_planned_position', firstSunday + 1);
    note('built.sunday_fights_in_first_60_planned', order.slice(0, 60).filter(n => day2.has(n)).length);
    note('built.plan_hold_count', Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.plan_hold`)));
    let switches = 0; for (let i = 1; i < order.length; i += 1) if (order[i] !== order[i - 1]) switches += 1;
    note('built.competition_switches_in_planned_order', switches);
    const appearances = sql(`select max(c) || '|' || count(*) filter (where c >= 5) from (select coalesce(e.fighter_id, ef.fighter_id) f, count(*) c from public.matches m join public.competitions k on k.id = m.competition_id join public.entries e on e.id in (m.entry_a, m.entry_b) left join public.entry_fighters ef on ef.entry_id = e.id and e.fighter_id is null where k.event_id = '${EV}' group by 1) x`).split('|');
    note('built.max_known_appearances_per_fighter', Number(appearances[0]));
    note('built.fighters_with_5plus_known_appearances', Number(appearances[1]));
  }

  // ============================================================== 3. organizer screens at four sizes BEFORE anything runs (scale)
  for (const kind of ['phone', 'tabletP', 'tabletL', 'desktop']) {
    for (const [nm, path, ready] of [['eventday', `/events/${SLUG}/manage?tab=eventday`, 'section[aria-label="Event day"]'], ['run', `/events/${SLUG}/manage?tab=run`, 'section[aria-label="Men Longsword"]'], ['command', `/events/${SLUG}/command`, 'main h1']]) {
      const v = await visit(kind, 'organizer', path, `03-${nm}-${kind}`, ready, { wait: nm === 'run' ? 4000 : 2500 });
      S[`before.${nm}.${kind}`] = v.m;
      if (nm === 'eventday' && kind === 'desktop') note('eventday.text_before', (await text(v.page, 'main')).slice(0, 1500));
      if (nm === 'run' && kind === 'desktop') {
        note('run.sword_shield_section_text', (await text(v.page, 'section[aria-label="Men Sword & Shield"]')).slice(0, 900));
        note('run.longsword_section_head', (await text(v.page, 'section[aria-label="Men Longsword"]')).slice(0, 500));
      }
      await v.ctx.close();
    }
  }
  note('scale.before', S);

  // ============================================================== 4. match identity under movement, and who may move what
  {
    const L0 = line();
    note('identity.line_length_field1', L0.length);
    const X = L0[7];
    const before = sql(`select id || '|' || position || '|' || round_label || '|' || stage || '|' || coalesce(plan_order::text, '-') || '|' || coalesce(queue_order::text, '-') from public.matches where id = '${X}'`);
    note('identity.X_before (id|position|round|stage|plan_order|queue_order)', before + ' at line index 8: ' + label(X));
    const moves = [];
    for (const a of ['later', 'later', 'later']) { const r = await rpc('organizer', 'move_match_in_queue', { p_match: X, p_action: a }); moves.push(a + ':' + outcome(r) + ':idx=' + (line().indexOf(X) + 1)); }
    { const r = await rpc('organizer', 'move_match_in_queue', { p_match: X, p_action: 'earlier' }); moves.push('earlier:' + outcome(r) + ':idx=' + (line().indexOf(X) + 1)); }
    note('identity.organizer_moves', moves);
    note('identity.X_after', sql(`select id || '|' || position || '|' || round_label || '|' || stage || '|' || coalesce(plan_order::text, '-') || '|' || coalesce(queue_order::text, '-') from public.matches where id = '${X}'`));
    note('identity.manual_queue_order_rows_after_moves', Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_order is not null`)));
    note('identity.audit_rows_for_moves', Number(sql(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'queue.reordered'`)));
    // who may reorder / hold / call
    const Y = line()[12];
    const perm = {};
    for (const who of ['headmarshal', 'scorer', 'checkin', 'f1', 'stranger']) {
      perm[`${who}.move_match_in_queue`] = outcome(await rpc(who, 'move_match_in_queue', { p_match: Y, p_action: 'later' }));
      perm[`${who}.save_queue_plan`] = outcome(await rpc(who, 'save_queue_plan', { p_event: EV, p_order: [Y], p_hold: [] }));
      perm[`${who}.clear_manual_queue`] = outcome(await rpc(who, 'clear_manual_queue', { p_event: EV, p_field: 'Field 1' }));
      perm[`${who}.patch_scheduled_at`] = outcome(await rest(who, 'PATCH', `matches?id=eq.${Y}`, { scheduled_at: new Date(Date.now() + 3600e3).toISOString() }));
      perm[`${who}.withdraw_entry`] = outcome(await rpc(who, 'withdraw_entry', { p_entry: entryOf(19, 'Men Sword & Shield'), p_reason: 'permission probe', p_walkovers: false }));
      perm[`${who}.build_schedule_replace`] = outcome(await rpc(who, 'build_schedule', { p_competition: comp('Women 3v3'), p_matches: [], p_mode: 'replace' }));
      perm[`${who}.delete_match`] = outcome(await rest(who, 'DELETE', `matches?id=eq.${Y}`));
      perm[`${who}.send_event_announcement`] = outcome(await rpc(who, 'send_event_announcement', { p_event: EV, p_message: 'TEST probe', p_audience: 'everyone' }));
    }
    note('permissions.denied_or_allowed', perm);
    // the scorekeeper CAN call any fight out of order through set_match_queue (the Run tab's state buttons use it); put it back afterwards
    const Z = line()[20];
    const zr = await rpc('scorer', 'set_match_queue', { p_match: Z, p_state: 'on_deck', p_field: null });
    note('permissions.scorekeeper_set_match_queue_on_deck_out_of_order', outcome(zr) + ' state=' + sql(`select queue_state from public.matches where id = '${Z}'`) + ' line index now ' + (line().indexOf(Z) + 1));
    const hr = await rpc('headmarshal', 'set_match_queue', { p_match: Z, p_state: 'scheduled', p_field: null });
    note('permissions.headmarshal_set_match_queue_back_to_scheduled', outcome(hr) + ' state=' + sql(`select queue_state from public.matches where id = '${Z}'`));
    const cr = await rpc('checkin', 'set_match_queue', { p_match: Z, p_state: 'on_deck', p_field: null });
    note('permissions.checkin_set_match_queue', outcome(cr));
    // a fight HELD while later ones run: the organizer's hold (plan_hold), then an organizer simply opening Event day
    const H = line()[2];
    const order = sql(`select string_agg(m.id::text, ',' order by m.plan_order) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.plan_order is not null and m.queue_state = 'scheduled'`).split(',');
    const hold = await rpc('organizer', 'save_queue_plan', { p_event: EV, p_order: order, p_hold: [H] });
    note('hold.organizer_save_queue_plan_hold', outcome(hold) + ' plan_hold=' + sql(`select plan_hold from public.matches where id = '${H}'`) + ' · ' + label(H));
    const v = await visit('desktop', 'organizer', `/events/${SLUG}/manage?tab=eventday`, '04-eventday-after-hold-1280', 'section[aria-label="Event day"]', { wait: 6000 });
    note('hold.after_an_organizer_opens_event_day_plan_hold_is', sql(`select plan_hold from public.matches where id = '${H}'`));
    await v.ctx.close();
  }

  // ============================================================== 5. a printed, timed running order (Saturday only), lunch, and drift
  {
    // Saturday's four categories in the server's current line, timed like the paper sheet: 7 minutes a fight, a 45-minute lunch after fight 24.
    // Anchored in the past so the event is ~15 minutes late right now. Written exactly as Run › Set time does it (REST update by the organizer).
    const sat = line().filter(m => !day2.has(compOf(m)));
    const start = Date.now() - 22 * 60e3;
    let t = start, wrote = 0, lunchAt = null;
    for (let i = 0; i < sat.length; i += 1) {
      if (i === 24) { lunchAt = new Date(t).toISOString(); t += 45 * 60e3; }
      const r = await rest('organizer', 'PATCH', `matches?id=eq.${sat[i]}`, { scheduled_at: new Date(t).toISOString(), duration_minutes: 7 });
      if (r.status < 300 && r.rows === 1) wrote += 1;
      t += 7 * 60e3;
    }
    note('time.saturday_fights_timed', `${wrote} of ${sat.length} (first ${new Date(start).toISOString()}, lunch gap at ${lunchAt})`);
    note('time.lunch_row_possible', 'no table or row type for a non-fight block; lunch exists only as a gap in scheduled_at (and free text in events.time_note)');
    const ann = await rpc('organizer', 'send_event_announcement', { p_event: EV, p_message: 'TEST: lunch 12:00 to 12:45, Lyst reopens 12:45', p_audience: 'everyone' });
    note('time.closest_lunch_concept_announcement', outcome(ann));
    note('time.headmarshal_cannot_retime', outcome(await rest('headmarshal', 'PATCH', `matches?id=eq.${sat[5]}`, { scheduled_at: new Date().toISOString() })));
    note('time.columns_on_matches', sql(`select string_agg(column_name || ':' || data_type, ', ') from information_schema.columns where table_schema = 'public' and table_name = 'matches' and data_type like 'timestamp%'`));
    note('time.after_timing_line_first_10', line().slice(0, 10).map(m => compOf(m)));
  }

  // ============================================================== 6. the secretary runs fights (scorekeeper's own calls), the bye bracket fills, a match is moved earlier
  {
    const st = await rpc('scorer', 'advance_field_queue', { p_event: EV, p_field: 'Field 1', p_start: true });
    note('run.scorekeeper_advance_field_queue', outcome(st));
    // the organizer moves the two Sword & Shield quarterfinals to the front (moved EARLIER), so the byes' semifinals can be watched filling
    const qf = sql(`select string_agg(id::text, ',' order by position) from public.matches where competition_id = '${comp('Men Sword & Shield')}' and stage = 'elimination' and entry_a is not null and entry_b is not null and queue_state = 'scheduled'`).split(',').filter(Boolean);
    const sf = sql(`select string_agg(id::text, ',' order by position) from public.matches where competition_id = '${comp('Men Sword & Shield')}' and round_label = 'Semifinal'`).split(',').filter(Boolean);
    const sfBefore = sf.map(m => `${label(m)} @line ${line().indexOf(m) + 1} plan_order=${sql(`select coalesce(plan_order::text, 'none') from public.matches where id = '${m}'`)}`);
    note('bracket.sword_shield_semis_before', sfBefore);
    for (const m of qf.reverse()) note(`move.earlier_first ${label(m)}`, outcome(await rpc('organizer', 'move_match_in_queue', { p_match: m, p_action: 'first' })) + ' idx=' + (line().indexOf(m) + 1));
    const ran = [];
    const t0 = Date.now();
    for (let i = 0; i < 16; i += 1) {
      let a = activeOn();
      if (!a) { await rpc('scorer', 'advance_field_queue', { p_event: EV, p_field: 'Field 1', p_start: true }); a = activeOn(); }
      if (!a) break;
      const r = await finish('scorer', a, 'a', 5, 3);
      ran.push(`${compOf(a)}${day2.has(compOf(a)) ? ' [SUNDAY]' : ''}: ${r.body?.status ?? outcome(r)}`);
    }
    note('run.sixteen_fights_in_order_run', ran);
    note('run.ms_per_fight_api', Math.round((Date.now() - t0) / Math.max(1, ran.length)));
    note('bracket.sword_shield_semis_after', sf.map(m => `${label(m)} @line ${line().indexOf(m) + 1} state=${sql(`select queue_state from public.matches where id = '${m}'`)}`));
    note('time.actual_start_stored', 'no column: start can only be inferred from audit_log queue.advanced; finish = finalized_at');
    note('time.audit_queue_advanced_rows', Number(sql(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'queue.advanced'`)));
  }

  // ============================================================== 6b. the event drifts late: a timed fight comes up overdue
  {
    // Let BuhurtOS plan it again (Event day's own button) so time order applies again after the hand moves.
    note('delay.organizer_clear_manual_queue', outcome(await rpc('organizer', 'clear_manual_queue', { p_event: EV, p_field: 'Field 1' })));
    // The day is ~18 minutes behind: re-time the waiting Saturday fights so the first is 18 minutes overdue (Run › Set time, as the organizer).
    const waitingTimed = sql(`select string_agg(m.id::text, ',' order by m.scheduled_at) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'scheduled' and m.scheduled_at is not null`).split(',').filter(Boolean);
    for (let i = 0; i < waitingTimed.length; i += 1) await rest('organizer', 'PATCH', `matches?id=eq.${waitingTimed[i]}`, { scheduled_at: new Date(Date.now() - 18 * 60e3 + i * 7 * 60e3).toISOString() });
    note('delay.waiting_timed_fights_retimed', waitingTimed.length);
    note('delay.schedule_changed_notifications', Number(sql(`select count(*) from public.notifications where kind = 'schedule_changed' and payload ->> 'event_slug' = '${SLUG}'`)));
    { const r = await visit('desktop', 'organizer', `/events/${SLUG}/manage?tab=eventday`, '06b-eventday-replan-1280', 'section[aria-label="Event day"]', { wait: 6000 }); await r.ctx.close(); }   // Event day re-plans and saves
    const cur = activeOn();
    if (cur) await finish('scorer', cur, 'a', 5, 3);
    if (!activeOn()) await rpc('scorer', 'advance_field_queue', { p_event: EV, p_field: 'Field 1', p_start: true });
    const now = activeOn();
    note('delay.now_fighting', label(now) + ' · scheduled ' + sql(`select coalesce(to_char(scheduled_at at time zone 'America/Edmonton', 'HH24:MI'), 'no time') || ' · minutes late=' || coalesce(floor(extract(epoch from now() - scheduled_at) / 60)::text, 'n/a') from public.matches where id = '${now}'`));
    note('delay.line_first_8_after_replan', line().slice(0, 8).map(m => `${compOf(m)} @ ${sql(`select coalesce(to_char(scheduled_at at time zone 'America/Edmonton', 'HH24:MI'), 'untimed') from public.matches where id = '${m}'`)}`));
    note('delay.waiting_timed_fights_already_overdue', Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state <> 'final' and m.scheduled_at < now()`)));
    note('delay.saturday_finished_out_of_time_order', sql(`with f as (select m.id, m.scheduled_at, m.finalized_at from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'final' and m.scheduled_at is not null)
      select count(*) || ' of ' || (select count(*) from f) || ' timed fights finished before a fight timed earlier than them' from f a where exists (select 1 from f b where b.scheduled_at < a.scheduled_at and b.finalized_at > a.finalized_at)`));
    const v = await visit('tabletP', 'organizer', `/events/${SLUG}/command`, '06b-command-late-768', 'main h1', { wait: 3000 });
    note('delay.command_centre_text', (await text(v.page, 'main')).slice(0, 900));
    await v.ctx.close();
    const w = await visit('tabletP', 'organizer', `/events/${SLUG}/manage?tab=eventday`, '06b-eventday-late-768', 'section[aria-label="Event day"]', { wait: 3000 });
    note('delay.eventday_head', (await text(w.page, 'section[aria-label="Event day"]')).slice(0, 700));
    await w.ctx.close();
  }

  // ============================================================== 7. withdrawal / injury on Sunday morning (Sword & Shield: a fighter waiting in a semifinal)
  {
    const SS = comp('Men Sword & Shield');
    const e = sql(`select entry_a from public.matches where competition_id = '${SS}' and round_label = 'Semifinal' and queue_state = 'scheduled' and entry_a is not null order by position limit 1`);
    const all = () => sql(`select string_agg(round_label || ' pos' || position || ': ' || coalesce(fa.display_name, '?') || ' vs ' || coalesce(fb.display_name, '?') || ' ' || m.queue_state || ':' || coalesce(m.result, '-') || coalesce(' walkover=' || (m.detail ->> 'walkover'), ''), ' | ' order by private.stage_rank(m.stage), m.position)
      from public.matches m left join public.entries ea on ea.id = m.entry_a left join public.fighters fa on fa.id = ea.fighter_id left join public.entries eb on eb.id = m.entry_b left join public.fighters fb on fb.id = eb.fighter_id where m.competition_id = '${SS}'`);
    note('withdraw.before', all());
    note('withdraw.headmarshal', outcome(await rpc('headmarshal', 'withdraw_entry', { p_entry: e, p_reason: 'Knee injury (TEST)', p_walkovers: true })));
    note('withdraw.organizer', outcome(await rpc('organizer', 'withdraw_entry', { p_entry: e, p_reason: 'Knee injury (TEST)', p_walkovers: true })));
    note('withdraw.after', all());
    note('withdraw.withdrawn_fighter_now_in_third_place_match', sql(`select count(*) from public.matches where competition_id = '${SS}' and stage = 'third_place' and '${e}' in (entry_a, entry_b)`));
    note('withdraw.third_place_runnable', sql(`select coalesce(bool_and(private.match_runnable(m)), false) from public.matches m where competition_id = '${SS}' and stage = 'third_place'`));
  }

  // ============================================================== 8. two entrants: one fight; a best of three attempted with what exists
  {
    const W = comp('Women Sword & Shield');
    const [ea, eb] = sql(`select string_agg(id::text, ',' order by id) from public.entries where competition_id = '${W}'`).split(',');
    const before = sql(`select string_agg(id::text, ',') from public.matches where competition_id = '${W}'`);
    const bo3 = await rpc('organizer', 'build_schedule', { p_competition: W, p_mode: 'replace', p_matches: [1, 2, 3].map(i => ({ key: `bo3-${i}`, stage: 'round_robin', round_label: `Bout ${i}`, position: i - 1, pool: '', a: ea, b: eb })) });
    note('format.best_of_three_as_three_round_robin_rows', outcome(bo3) + ' rows now ' + sql(`select count(*) from public.matches where competition_id = '${W}'`) + ' (old ids gone: ' + (sql(`select count(*) from public.matches where id::text = any(string_to_array('${before}', ','))`) === '0') + ')');
    const bouts = sql(`select string_agg(id::text, ',' order by position) from public.matches where competition_id = '${W}'`).split(',');
    // A wins bout 1 and 3, B wins bout 2 (2-1): what do standings and places say?
    for (const [i, res] of [[0, 'a'], [1, 'b'], [2, 'a']]) note(`format.bo3_bout_${i + 1}`, outcome(await finish('scorer', bouts[i], res, res === 'a' ? 5 : 3, res === 'a' ? 3 : 5)));
    const pre = await rpc('organizer', 'competition_finalize_preflight', { p_competition: W, p_multiplier_source: null });
    note('format.bo3_finalize_preflight', JSON.stringify(pre.body).slice(0, 900));
    note('format.bo3_counts_as_three_career_fights', sql(`select count(*) from public.career_fights_all where competition_id = '${W}'`));
  }

  // ============================================================== 9. rebuilding a draw after fights started
  {
    // a competition with fights but no official result yet (Sunday categories have not run much)
    const RB = sql(`select k.id from public.competitions k where k.event_id = '${EV}' and k.name not like 'Exhibition%' and (select count(*) from public.matches m where m.competition_id = k.id) >= 3
      and not exists (select 1 from public.matches m where m.competition_id = k.id and m.queue_state in ('final', 'active')) order by k.sort desc limit 1`);
    note('rebuild.competition', sql(`select name from public.competitions where id = '${RB}'`));
    const m1 = sql(`select id from public.matches where competition_id = '${RB}' and entry_a is not null and entry_b is not null order by position limit 1`);
    note('rebuild.scorekeeper_starts_a_fight', outcome(await rpc('scorer', 'set_match_queue', { p_match: m1, p_state: 'active', p_field: null })) + ' · ' + label(m1));
    const se = await rpc('scorer', 'record_score_event', { p_id: crypto.randomUUID(), p_match: m1, p_kind: 'round', p_payload: { a: 1, b: 0 }, p_client_at: new Date().toISOString() });
    note('rebuild.live_score_event_recorded', outcome(se) + ' rows=' + sql(`select count(*) from public.score_events where match_id = '${m1}'`));
    // the same pairings again, as Run › Build a new draw would send them
    const plan = JSON.parse(sql(`select json_agg(json_build_object('key', 'k' || row_number, 'stage', stage, 'round_label', round_label, 'position', position, 'pool', coalesce(pool, ''), 'a', entry_a, 'b', entry_b)) from (select *, row_number() over () from public.matches where competition_id = '${RB}' and stage in ('pool', 'round_robin')) x`));
    const rb = await rpc('organizer', 'build_schedule', { p_competition: RB, p_mode: 'replace', p_matches: plan, p_draw: { mode: 'random', seed: 99, format: plan[0].stage === 'pool' ? 'pools' : 'round_robin', algorithm: 'circle' } });
    note('rebuild.replace_while_a_fight_is_ACTIVE', outcome(rb) + ` · the active fight's row still exists: ${sql(`select count(*) from public.matches where id = '${m1}'`)} · its score events left: ${sql(`select count(*) from public.score_events where match_id = '${m1}'`)} · active fights in this competition now: ${sql(`select count(*) from public.matches where competition_id = '${RB}' and queue_state = 'active'`)}`);
    note('rebuild.audit', sql(`select string_agg(action || ' ' || (details ->> 'mode') || ' matches=' || (details ->> 'matches'), ', ' order by id) from public.audit_log where event_id = '${EV}' and action = 'schedule.built' and subject = '${RB}'`));
    const n1 = sql(`select id from public.matches where competition_id = '${RB}' and entry_a is not null and entry_b is not null order by id limit 1`);
    note('rebuild.finish_one', outcome(await finish('scorer', n1, 'a', 5, 0)));
    note('rebuild.replace_after_an_official_result', outcome(await rpc('organizer', 'build_schedule', { p_competition: RB, p_mode: 'replace', p_matches: plan })));
    // the organizer DELETEs a single waiting bracket fight through the table API (the grant exists): what happens to the bracket?
    const BK = comp('Men Sword & Buckler');
    const qf = sql(`select id from public.matches where competition_id = '${BK}' and round_label = 'Quarterfinal' and next_match_id is not null and queue_state = 'scheduled' order by position limit 1`);
    const nxt = sql(`select next_match_id from public.matches where id = '${qf}'`);
    const feeders = () => sql(`select count(*) from public.matches where next_match_id = '${nxt}'`);
    const f0 = feeders();
    const del = await rest('organizer', 'DELETE', `matches?id=eq.${qf}`);
    note('rebuild.organizer_deletes_one_waiting_buckler_quarterfinal_via_table_api', outcome(del) + ` · feeders for its semifinal ${f0} → ${feeders()} · audit rows naming it: ${sql(`select count(*) from public.audit_log where event_id = '${EV}' and subject = '${qf}'`)} · the semifinal can now ever fill: ${feeders() === '2' ? 'yes' : 'NO (one side stays To be decided forever)'}`);
    for (const who of ['headmarshal', 'scorer']) note(`rebuild.${who}_delete_attempt`, outcome(await rest(who, 'DELETE', `matches?id=eq.${nxt}`)) + ' (still there: ' + sql(`select count(*) from public.matches where id = '${nxt}'`) + ')');
    const someone = sql(`select id from public.entries where competition_id = '${BK}' order by id desc limit 1`);
    const tamper = await rest('organizer', 'PATCH', `matches?id=eq.${nxt}`, { entry_a: someone });
    note('rebuild.organizer_writes_a_semifinal_side_directly_via_table_api', outcome(tamper) + ' · semifinal now: ' + label(nxt) + ' · audit rows naming it: ' + sql(`select count(*) from public.audit_log where event_id = '${EV}' and subject = '${nxt}'`));
  }

  // ============================================================== 10. a fun / exhibition fight inserted during the day
  {
    const c = await rpc('organizer', 'create_competition', { p_event: EV, p_name: 'Exhibition: Fun fight (TEST)', p_category: 'longsword', p_gender: 'men', p_ruleset: null, p_structure: 'round_robin', p_rounds_to_win: null });
    note('exhibition.create_competition', outcome(c));
    const X = comp('Exhibition: Fun fight (TEST)');
    note('exhibition.set_tier_Exhibition', outcome(await rpc('organizer', 'set_competition_tier', { p_comp: X, p_tier: 'Exhibition' })));
    for (const n of [1, 2]) note(`exhibition.add_entrant_f${n}`, outcome(await rpc('organizer', 'add_entrant', { p_competition: X, p_fighter: fid(n), p_team: null })));
    const [a, b] = sql(`select string_agg(id::text, ',' order by fighter_id) from public.entries where competition_id = '${X}'`).split(',');
    note('exhibition.build', outcome(await rpc('organizer', 'build_schedule', { p_competition: X, p_mode: 'new', p_matches: [{ key: 'x', stage: 'round_robin', round_label: 'Round 1', position: 0, pool: '', a, b }] })));
    const xm = sql(`select id from public.matches where competition_id = '${X}'`);
    note('exhibition.in_server_line_at', line().indexOf(xm) + 1);
    note('exhibition.finish', outcome(await finish('scorer', xm, 'b', 3, 5)));
    note('exhibition.in_career_fights_all (official view = this minus synthetic/excluded events; no tier filter)', sql(`select count(*) || ' rows, tier=' || max(tier) || ', synthetic=' || bool_or(synthetic) || ', stats_excluded=' || bool_or(stats_excluded) from public.career_fights_all where competition_id = '${X}'`));
    const pf = await rpc('organizer', 'competition_finalize_preflight', { p_competition: X, p_multiplier_source: null });
    note('exhibition.finalize_preflight (medals/places?)', JSON.stringify(pf.body).slice(0, 700));
    note('exhibition.visible_on_public_event_as_competition', sql(`set role anon; select count(*) from public.competitions where id = '${X}'`));
  }

  // ============================================================== 11. pools → bracket: placeholders before, the build after, and where the new fights go
  {
    const LS = comp('Men Longsword');
    const pool = sql(`select string_agg(id::text, ',' order by pool, position) from public.matches where competition_id = '${LS}' and stage = 'pool' and queue_state <> 'final'`).split(',').filter(Boolean);
    let ok = 0;
    for (const m of pool) {
      const [fa, fb] = sql(`select (select f.n from public.entries e join rehearsal.fighter f on rehearsal.fid(f.n) = e.fighter_id where e.id = m.entry_a) || ',' || (select f.n from public.entries e join rehearsal.fighter f on rehearsal.fid(f.n) = e.fighter_id where e.id = m.entry_b) from public.matches m where m.id = '${m}'`).split(',').map(Number);
      const r = await finish('scorer', m, fa < fb ? 'a' : 'b', fa < fb ? 5 : 2, fa < fb ? 2 : 5);
      if (r.body?.status === 'accepted') ok += 1;
    }
    note('pools.longsword_pool_fights_finished', `${ok} of ${pool.length}`);
    note('pools.placeholders_before_bracket', 'none: no bracket rows exist until every pool fight is final (build_schedule append)');
    const { ctx, page } = await open('tabletP', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=run`);
    const ls = page.locator('section[aria-label="Men Longsword"]');
    await ls.waitFor({ timeout: 45000 });
    await ls.getByRole('button', { name: 'Build bracket from pool results' }).click({ timeout: 30000 });
    const btn = ls.getByRole('button', { name: /Create \d+ bracket matches/ });
    await btn.waitFor({ timeout: 30000 });
    note('pools.bracket_offer', (await btn.innerText()).trim());
    await shot(page, '11-pool-bracket-768');
    await btn.click();
    await sleep(2500);
    note('pools.bracket_rows', sql(`select string_agg(round_label || ' pos' || position || ' sides=' || ((entry_a is not null)::int + (entry_b is not null)::int), ' | ' order by private.stage_rank(stage), position) from public.matches where competition_id = '${LS}' and stage <> 'pool'`));
    await page.goto(BASE + `/events/${SLUG}/manage?tab=run`); await ls.waitFor({ timeout: 45000 }); await sleep(3000);
    note('pools.run_tab_bracket_text', (await text(page, 'section[aria-label="Men Longsword"]')).replace(/.*?(Quarterfinal)/, '$1').slice(0, 900));
    await shot(page, '11-run-longsword-bracket-768');
    await ctx.close();
    const qf = sql(`select string_agg(id::text, ',' order by position) from public.matches where competition_id = '${LS}' and stage = 'elimination' and round_label = 'Quarterfinal'`).split(',');
    note('pools.new_quarterfinals_scheduled_at', sql(`select count(*) filter (where scheduled_at is not null) || ' of ' || count(*) || ' have a time' from public.matches where id::text = any(string_to_array('${qf.join(',')}', ','))`));
    note('pools.new_quarterfinals_line_positions_before_event_day_replans', qf.map(m => line().indexOf(m) + 1));
    const v = await visit('desktop', 'organizer', `/events/${SLUG}/manage?tab=eventday`, '11-eventday-after-bracket-1280', 'section[aria-label="Event day"]', { wait: 6000 });
    note('pools.new_quarterfinals_line_positions_after_event_day_replans', qf.map(m => line().indexOf(m) + 1));
    note('pools.line_length_now', line().length);
    await v.ctx.close();
  }

  // ============================================================== 12. everyone's view at realistic scale (four sizes; tablet is the secretary's)
  {
    // one fight live on Field 1 so every screen has a now / next
    if (!activeOn()) await rpc('scorer', 'advance_field_queue', { p_event: EV, p_field: 'Field 1', p_start: true });
    const views = [
      ['organizer', 'eventday', `/events/${SLUG}/manage?tab=eventday`, 'section[aria-label="Event day"]', ['phone', 'tabletP', 'tabletL', 'desktop']],
      ['organizer', 'run', `/events/${SLUG}/manage?tab=run`, 'section[aria-label="Men Longsword"]', ['phone', 'tabletP', 'tabletL', 'desktop']],
      ['organizer', 'command', `/events/${SLUG}/command`, 'main h1', ['phone', 'tabletP', 'tabletL', 'desktop']],
      ['headmarshal', 'command', `/events/${SLUG}/command`, 'main h1', ['tabletP']],
      ['headmarshal', 'manage', `/events/${SLUG}/manage?tab=eventday`, 'main', ['tabletP']],
      ['headmarshal', 'field', `/events/${SLUG}/field/Field%201`, 'main', ['tabletP']],
      ['scorer', 'field', `/events/${SLUG}/field/Field%201`, 'main', ['phone', 'tabletP', 'tabletL']],
      ['scorer', 'manage', `/events/${SLUG}/manage?tab=eventday`, 'main', ['tabletP']],
      ['checkin', 'event', `/events/${SLUG}`, 'main', ['tabletP']],
      ['f1', 'event', `/events/${SLUG}`, '[aria-labelledby="mynext-h"]', ['phone', 'tabletP']],
      ['f20', 'event', `/events/${SLUG}`, '[aria-labelledby="mynext-h"]', ['phone']],
      ['stranger', 'event', `/events/${SLUG}`, 'main', ['phone', 'desktop']],
      [null, 'event', `/events/${SLUG}`, 'main', ['phone', 'tabletL']],
      [null, 'arena', `/events/${SLUG}/arena`, '.arena', ['tabletL', 'tv']]
    ];
    for (const [who, nm, path, ready, kinds] of views) {
      for (const kind of kinds) {
        const v = await visit(kind, who, path, `12-${who ?? 'anon'}-${nm}-${kind}`, ready, { wait: nm === 'run' ? 4500 : 3000 });
        S[`live.${who ?? 'anon'}.${nm}.${kind}`] = v.m;
        if (kind === kinds[0]) {
          const body = await text(v.page, 'main');
          note(`view.${who ?? 'anon'}.${nm}.text`, body.slice(0, 1400));
          if (nm === 'event' && (who === 'f1' || who === 'f20')) {
            note(`view.${who}.my_next_fight`, await text(v.page, '[aria-labelledby="mynext-h"]'));
            const n = Number(who.slice(1));
            const L = line();
            const mineIdx = L.map((m, i) => [m, i]).filter(([m]) => sql(`select count(*) from public.matches m join public.entries e on e.id in (m.entry_a, m.entry_b) left join public.entry_fighters ef on ef.entry_id = e.id where m.id = '${m}' and (e.fighter_id = '${fid(n)}' or ef.fighter_id = '${fid(n)}')`) !== '0').map(([, i]) => i);
            note(`view.${who}.server_line_fights_ahead_of_each_of_his_fights`, mineIdx.slice(0, 6));
          }
          if (nm === 'event') note(`view.${who ?? 'anon'}.now_and_next_order`, ((await text(v.page, 'main')).match(/NOW AND NEXT.{0,400}/i)?.[0] ?? '').match(/\b(NOW|ON DECK|IN THE HOLE)\b/gi)?.slice(0, 4) ?? []);
        }
        if (who === 'scorer' && nm === 'field' && kind === 'tabletP') {
          const b = v.page.locator('button[aria-label^="Score "]').first();
          if (await b.count()) { await b.click(); await sleep(2500); await shot(v.page, '12-scorer-scoring-screen-768'); S['live.scorer.scoring.tabletP'] = await measure(v.page); }
        }
        await v.ctx.close();
      }
    }
    note('scale.live', S);
    note('time.command_centre_behind_text', (E['view.organizer.command.text'] ?? '').match(/[^.·]*behind schedule[^.·]*/i)?.[0] ?? '(no behind-schedule text shown)');
  }

  // ============================================================== 13. the full line at the end (for the report)
  note('final.line_field1', line().map((m, i) => `${i + 1}. ${label(m)}`).slice(0, 40));
  note('final.state_counts', sql(`select string_agg(queue_state || '=' || c, ', ') from (select queue_state, count(*) c from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' group by 1) x`));
} catch (e) {
  console.log('RUN STOPPED:', String(e?.stack ?? e).slice(0, 1500));
  E.__stopped = String(e?.message ?? e).slice(0, 500);
} finally {
  fs.writeFileSync(`${SHOTS}/evidence.json`, JSON.stringify(E, null, 1));
  await browser.close();
  const failed = checks.filter(c => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} run checks passed; ${Object.keys(E).length} evidence items written to ${SHOTS}/evidence.json`);
  process.exit(E.__stopped || failed ? 1 : 0);
}
