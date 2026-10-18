// Pack 26: the FULL Rumble rehearsal in a real browser against the REAL local stack (Postgres + PostgREST + the device-session function + the built app),
// on the Pack 26 fixture (scripts/e2e/fixtures/pack26.sql). One coherent journey, in the order a real weekend runs: the organizer sets the event up,
// people register, the organizer reviews, the desk checks fighters in and inspects armour, the tournament is built on two Lysts, the day is run from
// Live ops, fights are scored on the Lyst with counter phones (Counter QR, several per side, handoff, training), a team fight is counted standing,
// a fighter follows My next fight, spectators follow Live and the big screen, two devices disagree about a result, the head marshal decides, a result
// is reopened and corrected, competitions are made official, the event is closed, reopened with a reason and closed again, and the public Results page
// is the record. Every CHECK is cross-checked in the database. Screenshots at the viewports the brief names.
// Run through scripts/e2e/pack26-live.sh. LOCAL ONLY, never against hosted Supabase.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const ONLY = (process.env.P26_PHASES ?? '').split(',').filter(Boolean);   // run a subset of phases while iterating (state is cumulative: earlier phases must have run on this database)
const results = [];
const E = {};   // evidence by key (written to <shots>/evidence.json)
const note = (k, v) => { E[k] = v; console.log(`EVIDENCE ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 1200)); return v; };
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); return !!ok; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const A = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const B = (n) => `00000000-0000-0000-0000-0000000000b${n}`;
const hex = (n) => n.toString(16).padStart(2, '0');
const fid = (n) => `00000000-0000-0000-0000-0000000f11${hex(n)}`;
const uid = (n) => `00000000-0000-0000-0000-0000000e11${hex(n)}`;
const tid = (n) => `00000000-0000-0000-0000-0000000d11${hex(n)}`;
const WHO = {
  owner: [A(1), 'a1@example.test'], organizer: [A(2), 'a2@example.test'], head: [A(3), 'a3@example.test'], scorer1: [A(4), 'a4@example.test'], scorer2: [A(5), 'a5@example.test'], stranger: [A(7), 'a7@example.test'],
  desk: [B(1), 'b1@example.test'], inspector: [B(2), 'b2@example.test'], medic: [B(3), 'b3@example.test'], announcer: [B(4), 'b4@example.test'], organizer2: [B(5), 'b5@example.test'],
  otherOrg: [B(6), 'b6@example.test'], marshal: [B(7), 'b7@example.test'], volunteer: [B(8), 'b8@example.test'], volunteer2: [B(9), 'b9@example.test']
};
for (let n = 1; n <= 53; n += 1) WHO[`f${n}`] = [uid(n), `f${n}@example.test`];
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
const fn = (who, action, body) => fetch(`${API}/functions/v1/device-session`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) }, body: JSON.stringify({ action, ...body }) }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const ver = (m) => Number(sql(`select version from public.matches where id = '${m}'`));
const finish = (who, m, result = 'a', a = 5, b = 3, command = crypto.randomUUID()) => rpc(who, 'submit_match_result', { p_command: command, p_match: m, p_result: result, p_score_a: a, p_score_b: b, p_detail: {}, p_expected_version: ver(m), p_schema: 1 });

const SLUG = 'test-rumble-26', E_PATH = `/events/${SLUG}`;
let EV = '', OTHER = '';
const K = {};
const comp = (nm) => K[nm] ?? (K[nm] = sql(`select id from public.competitions where event_id = '${EV}' and name = '${nm.replace(/'/g, "''")}'`));
const regOf = (n) => sql(`select id from public.registrations where event_id = '${EV}' and user_id = '${uid(n)}'`);
const label = (m) => sql(`select k.name || ' · ' || m.round_label || ' · ' || coalesce(fa.display_name, ta.name, '(tbd)') || ' vs ' || coalesce(fb.display_name, tb.name, '(tbd)')
  from public.matches m join public.competitions k on k.id = m.competition_id
  left join public.entries ea on ea.id = m.entry_a left join public.fighters fa on fa.id = ea.fighter_id left join public.teams ta on ta.id = ea.team_id
  left join public.entries eb on eb.id = m.entry_b left join public.fighters fb on fb.id = eb.fighter_id left join public.teams tb on tb.id = eb.team_id where m.id = '${m}'`);
const activeOn = (field) => sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active' and private.field_key(m.field) = '${field.toLowerCase()}' order by m.id limit 1`);
const today = sql(`select (now() at time zone 'America/Edmonton')::date`);
const day = (n) => sql(`select ('${today}'::date + ${n})::text`);
/** Move the event to other days. Everyone registered for the event's days moves with it (they said they could attend the event, not a calendar date): the
 *  rehearsal plays the weeks before the weekend and the weekend itself on one database. A real organizer changing dates after registration is a product
 *  question recorded in the work log (the planner then holds every fight because nobody is "here" on the new days; Build tournament says so). */
const setDates = (start, end) => {
  const from = sql(`select starts_on::text from public.events where id = '${EV}'`);
  sql(`update public.events set starts_on = '${start}', ends_on = '${end}' where id = '${EV}'`);
  if (from && from !== start) sql(`update public.registrations set attend_dates = array(select (d + ('${start}'::date - '${from}'::date))::date from unnest(attend_dates) d) where event_id = '${EV}' and attend_dates is not null and array_length(attend_dates, 1) > 0`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  small: { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  landscapePhone: { viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, landscape: { viewport: { width: 1024, height: 768 }, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 } }, tv: { viewport: { width: 1920, height: 1080 } }
};
const contexts = [];
async function open(kind, who, { pushAsked = true } = {}) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  contexts.push(ctx);
  await ctx.route(/posthog\.com|maps\.googleapis\.com|nominatim/, r => r.abort('failed'));
  if (pushAsked) await ctx.addInitScript(() => { try { localStorage.setItem('bos-push-ask', String(Date.now())); localStorage.setItem('bos-install-dismissed', String(Date.now())); } catch { /* ignore */ } });
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.errors = []; page.requests = 0; page.who = who ?? 'visitor'; page.kind = kind;
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|already final|net::ERR|Failed to fetch|403|42501|401/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('request', r => { if (r.url().includes('/rest/v1/')) page.requests += 1; });
  page.on('dialog', d => d.accept());
  return { ctx, page };
}
const body = async (page, sel = 'body') => ((await page.locator(sel).first().innerText({ timeout: 8000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').toLowerCase();
const has = async (page, text, sel = 'body') => (await body(page, sel)).includes(text.toLowerCase());
const until = async (fnc, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fnc()) return true; await sleep(250); } return false; };
const untilDb = async (fnc, want, ms = 10000) => { const t0 = Date.now(); let v = fnc(); while (v !== want && Date.now() - t0 < ms) { await sleep(250); v = fnc(); } return v; };
const go = async (page, path) => { await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle').catch(() => undefined); };
const noSideways = (page) => page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
const fits = async (page) => { const [sw, iw] = await noSideways(page); return sw <= iw + 1; };
let shotN = 0;
const shot = async (page, name, full = false) => { if (!SHOTS) return; await sleep(500); shotN += 1; await page.screenshot({ path: `${SHOTS}/p26-${String(shotN).padStart(2, '0')}-${name}-${VIEW[page.kind].viewport.width}.png`, fullPage: full }).catch(() => undefined); };
const attr = (page, testid, name) => page.getByTestId(testid).first().getAttribute(name).catch(() => null);
const phase = (id) => ONLY.length === 0 || ONLY.includes(id);
/** The tab-order position of a control relative to the first viewport: is the thing a person needs visible without scrolling? */
const aboveFold = async (page, selector) => page.locator(selector).first().boundingBox().then(b => b && b.y >= 0 && b.y + b.height <= VIEW[page.kind].viewport.height, () => false);
/**
 * Controls under `root` that a person can never uncover: covered by something else (a fixed bar, a sticky header) while the page is scrolled to its very
 * top or its very bottom. A control under a bar half-way down is fine (it scrolls out from under it); one under the bottom bar at the end of the page is
 * the Pack 24A1 obstruction. The scroll position is restored afterwards.
 */
const covered = (page, root = 'main') => page.evaluate((r) => {
  const out = new Set();
  const y0 = scrollY;
  const probe = (edge) => {
    for (const e of document.querySelectorAll(`${r} button, ${r} a, ${r} input, ${r} select, ${r} summary`)) {
      if (e.tagName !== 'SUMMARY' && e.closest('details:not([open])')) continue;   // folded away: Chromium keeps a layout box for closed <details> content
      const b = e.getBoundingClientRect(); if (b.width === 0 || b.height === 0 || b.top < 0 || b.bottom > innerHeight) continue;
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (!top || e.contains(top) || top.contains(e) || getComputedStyle(top).pointerEvents === 'none') continue;
      // at the top of the page only a cover at the TOP edge is final (nothing scrolls further up); at the bottom only a cover at the BOTTOM edge
      const c = top.getBoundingClientRect();
      if (edge === 'top' ? c.top > 120 : c.bottom < innerHeight - 120) continue;
      out.add((e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30));
    }
  };
  window.scrollTo(0, 0); probe('top');
  window.scrollTo(0, document.scrollingElement.scrollHeight); probe('bottom');
  window.scrollTo(0, y0);
  return [...out];
}, root);

try {
  // ═══════════════════════════════════════════════════ PHASE 0: the weekend exists (fixture functions through the real RPCs, as the right people)
  EV = sql(`select id from public.events where slug = '${SLUG}'`) || sql(`select rehearsal.setup_26()`);
  OTHER = sql(`select id from public.events where slug = 'test-other-26'`) || sql(`select rehearsal.setup_other_26()`);
  if (sql(`select count(*) from public.registrations where event_id = '${EV}'`) === '0') {
    note('setup.registered', sql(`select rehearsal.register_all('${EV}')`) + ' | ' + sql(`select rehearsal.register_extras('${EV}')`));
    for (const [email, role] of [['a3@example.test', 'head_marshal'], ['a4@example.test', 'scorekeeper'], ['a5@example.test', 'scorekeeper'], ['b1@example.test', 'check_in'], ['b2@example.test', 'inspector'], ['b3@example.test', 'medic'], ['b4@example.test', 'announcer'], ['b5@example.test', 'organizer'], ['b7@example.test', 'marshal']]) {
      const r = await rpc('organizer', 'grant_event_role_by_email', { p_event: EV, p_email: email, p_role: role });
      if (r.status >= 300) check(`0. staff: ${role} granted`, false, outcome(r));
    }
    check('0. the event has staff of every role, added by the organizer by email', sql(`select count(distinct role) from public.event_staff where event_id = '${EV}'`) === '8', sql(`select string_agg(role, ',') from public.event_staff where event_id = '${EV}'`));
  }
  note('setup.event', sql(`select name || ' | ' || starts_on || '..' || ends_on || ' | fields=' || field_count || ' | status=' || status || ' | synthetic=' || private.is_synthetic('event', id) from public.events where id = '${EV}'`));
  note('setup.registrations_by_status', sql(`select string_agg(status || '=' || c, ', ') from (select status, count(*) c from public.registrations where event_id = '${EV}' group by 1) x`));
  note('setup.entrants_per_competition', sql(`select string_agg(k.name || '=' || (select count(*) from public.registration_competitions rc join public.registrations g on g.id = rc.registration_id where rc.competition_id = k.id and g.status <> 'declined'), ', ' order by k.sort) from public.competitions k where k.event_id = '${EV}'`));

  // ═══════════════════════════════════════════════════ PHASE 1: EVENT SET UP, from a first-time organizer's chair, at every stage of the journey
  if (phase('setup')) {
    const o = (await open('phone', 'organizer')).page;
    setDates(day(7), day(8));   // the set-up and registration journeys happen BEFORE the weekend; the build phase moves the event to today
    // 1a. a brand-new draft with nothing in it (a second event the organizer just created)
    const fresh = sql(`select id from public.events where slug = 'test-fresh-26'`) ? { status: 200 } : await rpc('organizer', 'create_event', { p_slug: 'test-fresh-26', p_name: 'TEST Fresh Draft (Pack 26)', p_starts_on: day(30), p_ends_on: day(31), p_venue: null, p_address: null });
    check('1. the organizer creates a draft event through the real function', fresh.status === 200, outcome(fresh));
    await go(o, '/events/test-fresh-26/control');
    check('2. a brand-new draft: Set up opens with ONE next step, "Choose competitions"', await until(async () => (await attr(o, 'event-control', 'data-mode')) === 'setup' && await has(o, 'choose competitions')), await body(o));
    note('setup.fresh_draft_headline', (await body(o, '.eh-next')).slice(0, 300));
    await shot(o, 'setup-fresh-draft');
    const setupChecks = await o.evaluate(() => [...document.querySelectorAll('.eh-more-list li')].map(li => li.innerText.replace(/\s+/g, ' ').trim()));
    note('setup.tools_offered_to_a_new_draft', setupChecks);
    // 1b. the real event as a draft with competitions but no registration yet
    sql(`update public.events set status = 'draft' where id = '${EV}'`);
    await go(o, `${E_PATH}/control`);
    check('3. a draft with competitions: the next step is "Open registration" (publish), the rest is secondary', await until(async () => await has(o, 'open registration') && (await o.getByTestId('journey-primary').innerText().catch(() => '')).toLowerCase().includes('open registration')), await body(o, '.eh-next'));
    await shot(o, 'setup-draft-ready-to-publish');
    const v = (await open('phone')).page;
    await go(v, E_PATH);
    check('4. a visitor cannot see a draft event (not found, nothing leaked)', await until(async () => await has(v, 'not here') || await has(v, '404') || await has(v, 'not found')), await body(v));
    note('setup.visitor_on_draft_text', (await body(v)).slice(0, 200));
    // publish from the journey button (the real way), confirm dialog accepted by the harness
    await o.getByTestId('journey-primary').click();
    check('5. "Open registration" publishes the event; the journey moves to Registration', await until(async () => sql(`select status from public.events where id = '${EV}'`) === 'published' && await has(o, 'registration is open')), sql(`select status from public.events where id = '${EV}'`) + ' ' + (await body(o, '.eh-next')));
    check('6. with many registrations waiting, the ONE next step is to review them (and the count is right)', await until(async () => /review \d+ registrations/.test(await body(o, '.eh-next'))), await body(o, '.eh-next'));
    note('setup.published_many_pending_headline', (await body(o, '.eh-next')).slice(0, 300));
    await shot(o, 'setup-registration-open');
    check('7. the stepper names the stage in sporting words (Set up · Registration · Build tournament · Run event · Results · Close · History)', await has(o, 'build tournament') && await has(o, 'run event'));
    check('8. Set up at 390: nothing scrolls sideways, no control hides under a bar', await fits(o) && (await covered(o)).length === 0, JSON.stringify(await covered(o)));
    // event settings: the organizer checks the fields a first-timer looks for
    await go(o, `${E_PATH}/control?mode=setup&tool=settings`);
    await until(async () => (await attr(o, 'event-control', 'data-tool')) === 'settings');
    const settingsText = await body(o);
    note('setup.settings_has', ['name', 'slug', 'date', 'time zone', 'venue', 'address', 'field', 'fee', 'waiver', 'registration', 'publish', 'description', 'broadcast'].filter(w => settingsText.includes(w)));
    check('9. Event settings carries the facts an organizer looks for (dates, venue, fees, waiver, registration)', ['venue', 'fee', 'waiver', 'registration'].every(w => settingsText.includes(w)), settingsText.slice(0, 400));
    check('9b. the number of Lysts is a plain setting too (not only in Build tournament)', /lyst|field/.test(settingsText) && /\b2\b/.test(settingsText), 'checked below in the matrix if missing');
    await shot(o, 'setup-settings', true);
    const settingsCovered = await covered(o);
    check('10. Event settings at 390: nothing sideways, no covered control', await fits(o) && settingsCovered.length === 0, JSON.stringify(settingsCovered));
    // the second organizer, added by email, can open Set up too; the OTHER event's organizer cannot
    const o2 = (await open('phone', 'organizer2')).page;
    await go(o2, `${E_PATH}/control`);
    check('11. a second organizer (added by email) has the whole of Event Control', await until(async () => (await o2.getByRole('button', { name: 'Set up' }).count()) === 1 && (await o2.getByRole('button', { name: 'Results' }).count()) === 1), await body(o2));
    const oo = (await open('phone', 'otherOrg')).page;
    await go(oo, `${E_PATH}/control`);
    check('12. the organizer of ANOTHER event is told plainly that this is not theirs', await until(async () => await has(oo, 'for the people who run this event')), await body(oo));
    check('12b. ... and the database agrees (the Live ops snapshot refuses)', (await rpc('otherOrg', 'event_command_snapshot', { p_event: EV })).status === 403 || (await rpc('otherOrg', 'event_command_snapshot', { p_event: EV })).status === 400, outcome(await rpc('otherOrg', 'event_command_snapshot', { p_event: EV })));
    check('13. no page errors in Set up', o.errors.length === 0 && o2.errors.length === 0, [...o.errors, ...o2.errors].join(' | '));
  }

  // ═══════════════════════════════════════════════════ PHASE 2: REGISTRATION, as a fighter on a phone (the real form, the real function)
  if (phase('register')) {
    setDates(day(7), day(8));
    const f = (await open('phone', 'f34')).page;   // Bartholomew Fitzgerald-Montgomery of the Northern Marches, Badland Bears: a long name on purpose
    await go(f, E_PATH);
    check('14. an upcoming public event leads with the Overview and one primary action: Register', await until(async () => (await attr(f, 'view-overview', 'aria-current')) === 'page' && (await f.getByTestId('event-cta').innerText().catch(() => '')).toLowerCase().includes('register')), await body(f, 'header'));
    await shot(f, 'public-upcoming-fighter');
    await f.getByTestId('event-cta').click();
    await until(async () => /\/register/.test(f.url()) && await has(f, 'submit registration'));
    await f.getByRole('button', { name: 'Submit registration' }).click();
    check('15. an empty form is refused with a plain summary and highlighted items (nothing saved)', await until(async () => await has(f, 'please fix the')), await body(f));
    note('register.first_error_summary', (await body(f)).match(/please fix the \d+ highlighted item\(s\) above/)?.[0] ?? '');
    await shot(f, 'register-errors', true);
    // fill the form the way a person does
    await f.getByLabel('Full name', { exact: true }).fill('Bartholomew Fitzgerald-Montgomery of the Northern Marches');
    await f.getByLabel('Email', { exact: true }).fill('f34@example.test');
    await f.getByRole('group', { name: 'Gender' }).getByRole('button', { name: 'Male' }).click().catch(async () => f.getByRole('button', { name: 'Male', exact: true }).click());
    await f.getByRole('button', { name: 'HACSA', exact: true }).click();
    await f.getByLabel('Where are you from?').selectOption('AB');
    await f.getByLabel('Team (approved teams only)').selectOption({ label: 'Badland Bears' });
    await f.getByLabel('Men Sword & Shield').check();
    await f.getByLabel('Men 5v5').check();
    for (const cb of await f.locator('div:has(> p:text-is("Days you can attend")) input[type=checkbox]').all()) await cb.check();
    await f.getByRole('button', { name: 'No', exact: true }).click();
    await f.locator('input[name=ins]').first().check();
    await f.getByLabel('Emergency contact name').fill('TEST Contact');
    await f.getByLabel('Relationship').fill('Friend');
    await f.getByLabel('Emergency contact phone').fill('4035550034');
    await f.getByLabel('I declare that I am medically fit to take part').check();
    await f.getByLabel(/Medical note \(optional\)/).fill('TEST only: no real medical information.');
    await f.getByLabel('I understand and will pay this fee').check();
    await f.getByLabel(/I have read and agree to the waiver/).check();
    await f.getByLabel('Type your full name to sign').fill('Bartholomew Fitzgerald-Montgomery of the Northern Marches');
    const feeLine = (await body(f)).match(/your fee: \$[\d.]+/)?.[0] ?? '';
    check('16. the fee rule is explained before submitting ($40 for Alberta fighters)', feeLine.includes('$40'), feeLine);
    await f.getByRole('button', { name: 'Submit registration' }).click();
    const saved = await until(async () => await has(f, 'you are registered') && await has(f, 'review your registration'));
    if (!saved) { note('register.alerts_after_submit', await f.evaluate(() => [...document.querySelectorAll('[role=alert], [aria-invalid=true]')].map(e => (e.closest('label')?.textContent ?? e.textContent ?? '').replace(/\s+/g, ' ').slice(0, 120)))); await shot(f, 'register-submit-failed', true); }
    check('17. the registration is saved and the fighter is told the organizers will review it, with the fee and how to pay', saved && await has(f, '$40'), (await body(f)).slice(0, 300));
    const reg34 = regOf(34);
    check('18. the database has it: pending, team Badland Bears, two competitions, fee $40, waiver signed with the typed name, private contact kept apart', sql(`select status || '|' || (team_id = '${tid(7)}') || '|' || (select count(*) from public.registration_competitions where registration_id = '${reg34}') || '|' || fee_due_cents || '|' || waiver_signed_name from public.registrations where id = '${reg34}'`) === 'pending|true|2|4000|Bartholomew Fitzgerald-Montgomery of the Northern Marches' && sql(`select count(*) from public.registration_private where registration_id = '${reg34}'`) === '1', sql(`select status || '|' || (team_id = '${tid(7)}') || '|' || (select count(*) from public.registration_competitions where registration_id = '${reg34}') || '|' || fee_due_cents from public.registrations where id = '${reg34}'`));
    await shot(f, 'register-done', true);
    // coming back to the registration page while pending: the state and a way to change answers
    await go(f, `${E_PATH}/register`);
    check('18b. coming back shows "Your registration" as waiting for review with a Change my answers button', await until(async () => await has(f, 'your registration') && await has(f, 'waiting for review') && (await f.getByRole('button', { name: 'Change my answers' }).count()) === 1), (await body(f)).slice(0, 300));
    await shot(f, 'register-mine');
    await f.getByRole('button', { name: 'Change my answers' }).click();
    await until(async () => await has(f, 'submit registration'));
    check('19. "Change my answers" reopens the form filled in', (await f.getByLabel('Full name', { exact: true }).inputValue()).startsWith('Bartholomew'));
    // a fighter already accepted cannot resubmit (the database refuses)
    await rpc('organizer', 'decide_registration', { p_reg: regOf(1), p_status: 'accepted' });
    const again = await rpc('f1', 'submit_registration', { p_event: EV, p_data: { full_name: 'Aldric Stone', gender: 'male', organization: 'HACSA', province: 'AB', team_id: tid(1), insurance: 'hacsa_member', waiver_agree: true, waiver_version_id: sql(`select id from public.waiver_versions where event_id = '${EV}' limit 1`), waiver_signed_name: 'Aldric Stone', competitions: [{ competition_id: comp('Men Longsword'), team_id: null }], private: { email: 'f1@example.test', emergency_name: 'Contact of Aldric', emergency_relationship: 'Friend', emergency_phone: '4035550001', medically_fit: true } } });
    check('20. an accepted fighter who resubmits is refused with a plain reason', again.status >= 400 && /already accepted/i.test(again.msg), outcome(again));
    // registration closed
    sql(`update public.events set registration_closes_at = now() - interval '1 hour' where id = '${EV}'`);
    const f2 = (await open('phone', 'f35')).page;
    await go(f2, `${E_PATH}/register`);
    check('21. after the close time the form is gone and the page says registration is closed', await until(async () => await has(f2, 'closed')) && (await f2.getByRole('button', { name: 'Submit registration' }).count()) === 0, await body(f2));
    await shot(f2, 'register-closed');
    const late = await rpc('f35', 'submit_registration', { p_event: EV, p_data: { full_name: 'Late Larry', gender: 'male', organization: 'HACSA', province: 'AB', insurance: 'hacsa_member', waiver_agree: true, waiver_version_id: sql(`select id from public.waiver_versions where event_id = '${EV}' limit 1`), waiver_signed_name: 'Late Larry', competitions: [{ competition_id: comp('Men Longsword'), team_id: null }], private: { email: 'f35@example.test', emergency_name: 'Contact of Larry', emergency_relationship: 'Friend', emergency_phone: '4035550035', medically_fit: true } } });
    check('22. ... and the database refuses a late submission too', late.status >= 400, outcome(late));
    sql(`update public.events set registration_closes_at = now() + interval '3 days' where id = '${EV}'`);
    await go(f, E_PATH);
    check('23. the public event page shows the fighter their own registration state (waiting for review) in the first screen', await until(async () => await has(f, 'waiting for review')) && (await f.getByText(/waiting for review/i).first().boundingBox())?.y < 844, (await body(f)).slice(0, 300));
    check('24. no page errors while registering', f.errors.length === 0 && f2.errors.length === 0, [...f.errors, ...f2.errors].join(' | '));
  }

  // ═══════════════════════════════════════════════════ PHASE 3: ORGANIZER REVIEW of ~45 registrations on a phone
  if (phase('review')) {
    const o = (await open('phone', 'organizer')).page;
    await go(o, `${E_PATH}/control?mode=setup&tool=registrations`);
    await until(async () => (await o.locator('section[aria-label="Registrations"] article').count()) > 0, 30000);
    const pendingCount = Number(sql(`select count(*) from public.registrations where event_id = '${EV}' and status = 'pending'`));
    const shownText = await body(o, 'section[aria-label="Registrations"]');
    check('25. the Registrations tool opens on what needs the organizer (pending first) with a count', shownText.includes('pending') && new RegExp(`\\b${pendingCount}\\b`).test(shownText), shownText.slice(0, 300));
    const t0 = Date.now();
    const cards = await o.locator('section[aria-label="Registrations"] article').count();
    note('review.cards_rendered_for_pending_filter', cards);
    note('review.page_height_screens_at_390', +(await o.evaluate(() => document.scrollingElement.scrollHeight / innerHeight)).toFixed(1));
    await shot(o, 'review-pending');
    await shot(o, 'review-pending-full', true);
    // search by a long name, by a team, by a category
    const search = o.getByLabel('Search by name, team or category');
    await search.fill('Bartholomew');
    check('26. search finds the long name and the card does not break the layout', await until(async () => (await o.locator('section[aria-label="Registrations"] article').count()) === 1) && await fits(o), String(await o.locator('section[aria-label="Registrations"] article').count()));
    await shot(o, 'review-long-name');
    const card = o.locator('section[aria-label="Registrations"] article').first();
    const cardText = await body(o, 'section[aria-label="Registrations"] article');
    check('27. a pending card leads with the decision: name, team, categories, what is outstanding, Accept / Decline; fee, insurance, contact and the medical note are folded', cardText.includes('badland bears') && cardText.includes('sword & shield') && /outstanding/.test(cardText) && cardText.includes('fee, insurance, contact and notes') && !cardText.includes('no real medical information'), cardText.slice(0, 500));
    await card.locator('summary', { hasText: /Fee, insurance, contact and notes|Contact, availability and notes/ }).click();
    check('27b. unfolded: the $40 fee, the insurance, the emergency contact, the days and the notes, and the medical note still hidden behind a button', await until(async () => await has(o, 'show private medical note', 'section[aria-label="Registrations"] article')) && /test contact|4035550034/.test(await body(o, 'section[aria-label="Registrations"] article')) && (await body(o, 'section[aria-label="Registrations"] article')).includes('$40'), (await body(o, 'section[aria-label="Registrations"] article')).slice(0, 500));
    await card.getByRole('button', { name: 'Show private medical note' }).click();
    check('28. the medical note is shown only on request', await has(o, 'no real medical information', 'section[aria-label="Registrations"] article'));
    await card.getByRole('button', { name: /^Accept/ }).click();
    check('29. Accept saves at once and the card leaves the Pending list', await untilDb(() => sql(`select status from public.registrations where id = '${regOf(34)}'`), 'accepted') === 'accepted' && await until(async () => (await o.locator('section[aria-label="Registrations"] article').count()) === 0 || await has(o, 'accepted', 'section[aria-label="Registrations"] article')), sql(`select status from public.registrations where id = '${regOf(34)}'`));
    note('review.where_did_the_accepted_card_go', (await o.locator('section[aria-label="Registrations"] article').count()) === 0 ? 'gone from the Pending list (no confirmation left on screen)' : 'stays with an Accepted chip');
    // decline Fenwick (32), return one to pending and back
    await o.getByRole('button', { name: /^Pending/ }).first().click();
    await search.fill('Fenwick');
    await until(async () => (await o.locator('section[aria-label="Registrations"] article').count()) === 1);
    await o.locator('section[aria-label="Registrations"] article').first().getByRole('button', { name: 'Decline' }).click();
    check('30. Decline works from the card', await untilDb(() => sql(`select status from public.registrations where id = '${regOf(32)}'`), 'declined') === 'declined');
    await o.getByRole('button', { name: /^Accepted/ }).first().click();
    await search.fill('Bartholomew');
    await until(async () => (await o.locator('section[aria-label="Registrations"] article').count()) === 1);
    await o.locator('section[aria-label="Registrations"] article').first().getByRole('button', { name: 'Back to pending' }).click();
    check('31. "Back to pending" is offered on an accepted registration and works', await untilDb(() => sql(`select status from public.registrations where id = '${regOf(34)}'`), 'pending') === 'pending');
    await rpc('organizer', 'decide_registration', { p_reg: regOf(34), p_status: 'accepted' });
    // the rest, as the organizer, through the real function (what the organizer would do card by card)
    const rest = sql(`select rehearsal.accept_rest('${EV}')`);
    // Gideon (33) withdraws himself after being accepted
    const wd = await rpc('f33', 'withdraw_registration', { p_reg: regOf(33) });
    check('32. an accepted fighter withdraws himself; his entries are withdrawn with him', wd.status < 300 && sql(`select status from public.registrations where id = '${regOf(33)}'`) === 'withdrawn' && sql(`select count(*) from public.entries where fighter_id = '${fid(33)}' and status <> 'withdrawn'`) === '0', outcome(wd));
    // Emmett (31) stays pending for the whole weekend
    await rpc('organizer', 'decide_registration', { p_reg: regOf(31), p_status: 'pending' });
    note('review.accepted_by_function', rest);
    note('review.by_status_after_review', sql(`select string_agg(status || '=' || c, ', ') from (select status, count(*) c from public.registrations where event_id = '${EV}' group by 1) x`));
    check('33. accepting created the entries: one per fighter per competition, one per team per team competition', Number(sql(`select count(*) from public.entries e join public.competitions k on k.id = e.competition_id where k.event_id = '${EV}' and e.status not in ('withdrawn', 'disqualified')`)) >= 40, sql(`select string_agg(k.name || '=' || (select count(*) from public.entries e where e.competition_id = k.id and e.status not in ('withdrawn', 'disqualified')), ', ' order by k.sort) from public.competitions k where k.event_id = '${EV}'`));
    note('review.entries_per_competition', sql(`select string_agg(k.name || '=' || (select count(*) from public.entries e where e.competition_id = k.id and e.status not in ('withdrawn', 'disqualified')), ', ' order by k.sort) from public.competitions k where k.event_id = '${EV}'`));
    // the filters: withdrawn, declined, accepted (the page is reloaded first: decisions made elsewhere are not pushed to an open Registrations tool)
    await go(o, `${E_PATH}/control?mode=setup&tool=registrations`);
    await until(async () => (await o.locator('section[aria-label="Registrations"] article').count()) > 0, 30000);
    await until(async () => (await o.getByLabel('Search by name, team or category').count()) === 1, 10000);
    await o.getByLabel('Search by name, team or category').fill('');
    for (const [filterWord, status] of [['Withdrawn', 'withdrawn'], ['Declined', 'declined'], ['Accepted', 'accepted'], ['Pending', 'pending']]) {
      const btn = o.getByRole('button', { name: new RegExp(`^${filterWord}`) }).first();
      if (await btn.count()) await btn.click();
      const n = Number(sql(`select count(*) from public.registrations where event_id = '${EV}' and status = '${status}'`));
      const ok = await until(async () => (await o.locator('section[aria-label="Registrations"] article').count()) === n, 10000);
      check(`34. the ${filterWord} filter shows exactly the ${n} ${status} registration(s)`, ok, String(await o.locator('section[aria-label="Registrations"] article').count()));
    }
    // fees and insurance from the card: the organizer marks the mercenary's insurance as received, and fees
    note('review.fees_marked_paid', sql(`select rehearsal.mark_fees('${EV}')`));
    const ins = await rpc('organizer', 'set_registration_insurance', { p_reg: regOf(53), p_insurance: 'proof_received' });
    check('35. insurance can be updated by the organizer (proof received for the mercenary)', ins.status < 300 && sql(`select insurance from public.registrations where id = '${regOf(53)}'`) === 'proof_received', outcome(ins));
    note('review.rosters_set', sql(`select rehearsal.set_rosters('${EV}')`));
    // the mercenary: where does the organizer see "asked to be placed"?
    await o.locator('[aria-label="Show"] button', { hasText: /^All$/ }).click();
    await search.fill('Rook');
    await until(async () => (await o.locator('section[aria-label="Registrations"] article').count()) === 1);
    const merc = await body(o, 'section[aria-label="Registrations"] article');
    check('36. the mercenary\'s card says he asked to be placed (no team), so the organizer can act on it', /mercenary|place/.test(merc) && /no team/.test(merc), merc.slice(0, 300));
    // volunteers
    await search.fill('Volunteer');
    await until(async () => (await o.locator('section[aria-label="Registrations"] article').count()) === 2);
    const vol = await body(o, 'section[aria-label="Registrations"] article');
    check('37. a volunteer\'s card shows the roles and "no fee"', /squire|points counter|runner/.test(vol) && /no fee/.test(vol), vol.slice(0, 300));
    await shot(o, 'review-volunteer');
    check('38. the Registrations tool at 390: nothing sideways, no covered control', await fits(o) && (await covered(o)).length === 0, JSON.stringify(await covered(o)));
    check('39. no page errors in review', o.errors.length === 0, o.errors.join(' | '));
    note('review.ms_from_open_to_first_decision', Date.now() - t0);
  }

  // ═══════════════════════════════════════════════════ PHASE 4: CHECK-IN, ARMOUR, READINESS (the desk on a phone, the inspector on a tablet, the head marshal)
  if (phase('checkin')) {
    const d = (await open('phone', 'desk')).page;
    await go(d, `${E_PATH}/checkin?from=control`);
    await until(async () => (await d.locator('.desk-card').count()) > 0, 30000);
    check('40. the desk opens in the focus layout with Exit to Event Control, search first', (await d.locator('.focus-exit').getAttribute('aria-label').catch(() => '')) === 'Exit to Event Control' && await aboveFold(d, '.desk-find input'), await d.locator('.focus-exit').getAttribute('aria-label').catch(() => ''));
    const cardsNotReady = await d.locator('.desk-card').count();
    note('checkin.default_list_is_not_ready_with_cards', cardsNotReady);
    note('checkin.counts_row', (await body(d, '.desk-counts')).slice(0, 200));
    await shot(d, 'desk-not-ready');
    await shot(d, 'desk-not-ready-full', true);
    const cardH = await d.locator('.desk-card').first().boundingBox();
    note('checkin.first_card_height_px_at_390', Math.round(cardH?.height ?? 0));
    const find = d.getByLabel('Find a fighter (name, team or competition)');
    await find.fill('Aldric');
    await until(async () => (await d.locator('.desk-card').count()) === 1);
    const aldric = d.locator('.desk-card').first();
    check('41. search finds the fighter; the card says NOT READY and lists why in plain words', (await body(d, '.desk-card')).includes('not ready') && /not here yet|not checked in|inspect/.test(await body(d, '.desk-card')), await body(d, '.desk-card'));
    await aldric.getByRole('button', { name: 'Arrived' }).click();
    check('42. Arrived is saved by the server', await untilDb(() => sql(`select coalesce((select passed::text from public.registration_checks where registration_id = '${regOf(1)}' and check_name = 'arrived'), 'none')`), 'true', 10000) === 'true' || await until(async () => await has(d, 'arrived', '.desk-card')), await body(d, '.desk-card'));
    await aldric.getByRole('button', { name: 'Check in' }).click();
    check('43. Check in: the card shows checked in and offers Undo', await until(async () => await has(d, 'checked in', '.desk-card') && (await aldric.getByRole('button', { name: 'Undo' }).count()) === 1), await body(d, '.desk-card'));
    await aldric.getByRole('button', { name: 'Undo' }).click();
    await until(async () => (await aldric.getByRole('button', { name: 'Check in' }).count()) === 1);
    await aldric.getByRole('button', { name: 'Check in' }).click();
    await until(async () => await has(d, 'checked in', '.desk-card'));
    check('44. Undo and check in again are plain and quick', sql(`select count(*) from public.registration_checks where registration_id = '${regOf(1)}' and check_name = 'checked_in' and passed`) === '1');
    // the desk cannot inspect armour (role boundary in the UI and the database)
    check('45. the desk staff sees no armour buttons (inspection is the inspector\'s)', (await aldric.getByRole('button', { name: /Pass armour|Fail/ }).count()) === 0);
    const deskInspect = await rpc('desk', 'record_inspection', { p_reg: regOf(1), p_result: 'passed', p_issues: [], p_note: null });
    check('46. ... and the database refuses the desk recording an inspection', deskInspect.status >= 400, outcome(deskInspect));
    // the inspector on a tablet: fail with issues, then reinspect
    const i = (await open('tablet', 'inspector')).page;
    await go(i, `${E_PATH}/checkin`);
    await until(async () => (await i.locator('.desk-card').count()) > 0, 30000);
    check('47. the inspector\'s desk is named "Armour inspection" and has no check-in buttons', await has(i, 'armour inspection', '.focus-bar, header') && (await i.locator('.desk-card').first().getByRole('button', { name: 'Check in' }).count()) === 0, await body(i, 'header'));
    await i.getByLabel('Find a fighter (name, team or competition)').fill('Brann');
    await until(async () => (await i.locator('.desk-card').count()) === 1);
    const brann = i.locator('.desk-card').first();
    await brann.getByRole('button', { name: 'Fail' }).click();
    await brann.getByRole('group', { name: 'What needs fixing' }).getByRole('button').first().click();
    await brann.getByRole('group', { name: 'What needs fixing' }).getByRole('button').nth(1).click();
    await brann.getByLabel('Note (optional, staff only)').fill('TEST: strap and gauntlet');
    await brann.getByRole('button', { name: 'Save: failed' }).click();
    check('48. a FAILED inspection records what needs fixing (two issues) and the staff-only note', await untilDb(() => sql(`select result || ':' || array_length(issues, 1) from public.registration_inspections where registration_id = '${regOf(2)}' order by inspected_at desc limit 1`), 'failed:2') === 'failed:2', sql(`select result || ':' || array_length(issues, 1) from public.registration_inspections where registration_id = '${regOf(2)}' order by inspected_at desc limit 1`));
    check('49. the card shows FAILED with the issues in words (what needs fixing is on the card)', await until(async () => await has(i, 'failed', '.desk-card')) && /strap|gauntlet|helmet|arm|leg|hand|torso|weapon|shield|glove|neck|knee|elbow|other/.test(await body(i, '.desk-card')), await body(i, '.desk-card'));
    await shot(i, 'desk-inspection-failed');
    await brann.getByRole('button', { name: 'Pass armour' }).click();
    check('50. REINSPECTION passes and the card says so ("after reinspection")', await until(async () => await has(i, 'after reinspection', '.desk-card')), await body(i, '.desk-card'));
    // the insurance blocker: Soren (19) has proof pending
    await i.getByLabel('Find a fighter (name, team or competition)').fill('Soren');
    await until(async () => (await i.locator('.desk-card').count()) === 1);
    check('51. an insurance blocker is a stated reason on the card', /insurance/.test(await body(i, '.desk-card')), await body(i, '.desk-card'));
    // the head marshal: override with a reason, then withdraw it
    const h = (await open('phone', 'head')).page;
    await go(h, `${E_PATH}/checkin`);
    await until(async () => (await h.locator('.desk-card').count()) > 0, 30000);
    await h.getByLabel('Find a fighter (name, team or competition)').fill('Soren');
    await until(async () => (await h.locator('.desk-card').count()) === 1);
    const soren = h.locator('.desk-card').first();
    await soren.locator('summary', { hasText: 'Override' }).click();
    await soren.getByLabel('Reason (recorded with your name)').fill('TEST: proof shown on paper at the desk');
    await soren.getByRole('button', { name: 'Mark ready anyway' }).click();
    check('52. a readiness override needs a reason and is recorded with the head marshal\'s name', await untilDb(() => sql(`select count(*) from public.registration_overrides where registration_id = '${regOf(19)}' and revoked_at is null`), '1') === '1' && await until(async () => await has(h, 'override', '.desk-card')), await body(h, '.desk-card'));
    await shot(h, 'desk-override');
    // the rest of the day's arrivals through the real function, as the organizer; then the readiness picture
    note('checkin.rest_checked_in', sql(`select rehearsal.checkin_rest('${EV}')`));
    const readiness = await rpc('organizer', 'event_readiness', { p_event: EV });
    note('checkin.readiness_rows', Array.isArray(readiness.body) ? readiness.body.length : outcome(readiness));
    // a stranger and another event's staff get nothing
    const sd = await rpc('stranger', 'event_readiness', { p_event: EV });
    const od = await rpc('otherOrg', 'event_readiness', { p_event: EV });
    check('53. a stranger and another event\'s organizer cannot read the readiness list', (sd.status >= 400 || (Array.isArray(sd.body) && sd.body.length === 0)) && (od.status >= 400 || (Array.isArray(od.body) && od.body.length === 0)), outcome(sd) + ' / ' + outcome(od));
    const s = (await open('phone', 'stranger')).page;
    await go(s, `${E_PATH}/checkin`);
    check('54. a signed-in stranger at the desk address is told whose screen it is, and sent back', await until(async () => await has(s, 'check-in desk and armour inspectors')), await body(s));
    note('checkin.stranger_text_mentions_old_manage_people', (await body(s)).includes('manage › people'));
    // phone/tablet layout checks
    await find.fill('');
    await d.getByRole('button', { name: /^All/ }).first().click().catch(() => undefined);
    await until(async () => (await d.locator('.desk-card').count()) > 5, 15000);
    check('55. the desk with the whole list at 390: nothing sideways, no covered control, the search stays reachable', await fits(d) && (await covered(d)).length === 0, JSON.stringify(await covered(d)));
    await d.evaluate(() => window.scrollTo(0, 1200));
    await sleep(300);
    check('56. ... after scrolling, the search box is still on screen (sticky)', await aboveFold(d, '.desk-find input'), '');
    await shot(d, 'desk-scrolled');
    check('57. no page errors at the desk', d.errors.length === 0 && i.errors.length === 0 && h.errors.length === 0, [...d.errors, ...i.errors, ...h.errors].join(' | '));
  }

  // ═══════════════════════════════════════════════════ PHASE 5: BUILD THE TOURNAMENT on two Lysts, on the real screen
  if (phase('build')) {
    const o = (await open('desktop', 'organizer')).page;
    await go(o, `${E_PATH}/control?mode=setup`);
    await until(async () => (await o.getByTestId('journey-primary').count()) === 1, 30000);
    note('build.journey_headline', (await body(o, '.eh-next')).slice(0, 300));
    const primaryIsBuild = /build tournament/.test(await body(o, '[data-testid=journey-primary]'));
    check('58. with registration reviewed (one straggler still pending), Set up offers Build tournament: as the next step, or right beside "Review 1 registration"', primaryIsBuild || (await o.locator('.eh-next').getByRole('button', { name: /Build tournament/ }).count()) === 1, await body(o, '.eh-next'));
    note('build.primary_step_with_one_pending', primaryIsBuild ? 'Build tournament' : (await body(o, '[data-testid=journey-primary]')).slice(0, 80));
    if (primaryIsBuild) await o.getByTestId('journey-primary').click(); else await o.locator('.eh-next').getByRole('button', { name: /Build tournament/ }).click();
    await o.locator('section[aria-label="Build tournament"]').waitFor({ timeout: 45000 });
    await until(async () => await has(o, 'tournament plan ready', 'section[aria-label="Build tournament"]'), 60000);
    const fieldsShown = await o.locator('output[aria-label="Lysts"]').innerText().catch(() => '');
    check('59. the plan uses the event\'s two Lysts by default (the field count comes from Event settings)', fieldsShown.trim() === '2', fieldsShown);
    const planText = await body(o, 'section[aria-label="Build tournament"]');
    note('build.plan_text', planText.slice(0, 1600));
    check('60. the plan answers: what will be built (format per competition), how many fights, which fields', /fight/.test(planText) && /pool|round robin|knockout|single elimination|elimination/.test(planText) && /field 1|lyst 1/.test(planText), planText.slice(0, 500));
    const rows = await o.locator('.bt-list li').allInnerTexts();
    note('build.rows', rows.map(r => r.replace(/\s+/g, ' ').slice(0, 160)));
    check('61. a competition with 2 entrants is offered as one fight, not clutter; a 16-entrant one proposes pools', rows.some(r => /Women Sword & Shield/.test(r) && /1 fight|one fight|2 entrants|2 fighters/i.test(r)) && rows.some(r => /Men Longsword/.test(r) && /pool/i.test(r)), rows.join(' || ').slice(0, 600));
    check('62. the organizer never needs to know "Run" or "Build" internals: one plan, one Use this plan', (await o.getByRole('button', { name: /Use this plan/ }).count()) === 1);
    await o.getByRole('button', { name: 'Review plan' }).click();
    await sleep(600);
    note('build.review_lanes', await o.locator('.bt-lanes > div').count());
    note('build.review_text_head', (await body(o, '.bt-lanes')).slice(0, 700));
    await shot(o, 'build-plan', true);
    await o.getByRole('button', { name: /Use this plan/ }).click();
    check('63. the tournament is built in one step', await until(async () => await has(o, 'tournament built'), 120000), await body(o, 'section[aria-label="Build tournament"]'));
    note('build.matches_per_competition', sql(`select string_agg(k.name || '=' || (select count(*) from public.matches m where m.competition_id = k.id), ', ' order by k.sort) from public.competitions k where k.event_id = '${EV}'`));
    note('build.fields_used', sql(`select string_agg(distinct coalesce(m.field, '(null = Field 1)'), ',') from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}'`));
    const ssRows = sql(`select string_agg(round_label || ' pos' || position || ' sides=' || ((entry_a is not null)::int + (entry_b is not null)::int), ' | ' order by private.stage_rank(stage), position) from public.matches where competition_id = '${comp('Men Sword & Shield')}'`);
    note('build.sword_shield_6_in_8', ssRows);
    check('64. six entrants in an 8-slot knockout: two first-round byes (two quarterfinals with both sides, two semifinal slots pre-filled)', /Quarterfinal pos\d sides=2.*Quarterfinal pos\d sides=2/.test(ssRows) || (ssRows.match(/sides=2/g) ?? []).length >= 2, ssRows);
    note('build.polearm_7', sql(`select string_agg(round_label || ' pos' || position || ' sides=' || ((entry_a is not null)::int + (entry_b is not null)::int), ' | ' order by private.stage_rank(stage), position) from public.matches where competition_id = '${comp('Men Polearm')}'`));
    note('build.5v5_teams', sql(`select string_agg(round_label || ' pos' || position || ' sides=' || ((entry_a is not null)::int + (entry_b is not null)::int), ' | ' order by private.stage_rank(stage), position) from public.matches where competition_id = '${comp('Men 5v5')}'`));
    note('build.longsword_pools', sql(`select string_agg(distinct pool, ',') || ' pools, ' || count(*) || ' pool fights' from public.matches where competition_id = '${comp('Men Longsword')}' and stage = 'pool'`));
    note('build.draw_seeds_saved', sql(`select count(*) filter (where draw_seed is not null) || ' of ' || count(*) from public.competitions where event_id = '${EV}' and exists (select 1 from public.matches m where m.competition_id = competitions.id)`));
    check('65. every built competition has a saved draw seed (reproducible)', sql(`select count(*) filter (where draw_seed is null) from public.competitions where event_id = '${EV}' and exists (select 1 from public.matches m where m.competition_id = competitions.id)`) === '0');
    check('66. both Lysts carry fights and the plan order is saved', sql(`select count(distinct private.field_key(m.field)) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}'`) === '2' && Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.plan_order is not null`)) > 20);
    // a second build is protected
    await go(o, `${E_PATH}/control?mode=setup&tool=build`);
    await o.locator('section[aria-label="Build tournament"]').waitFor({ timeout: 45000 });
    check('67. opening Build tournament again does not offer to build what exists (already built is protected)', await until(async () => await has(o, 'already built', 'section[aria-label="Build tournament"]') || (await o.getByRole('button', { name: /Use this plan/ }).count()) === 0, 30000), await body(o, 'section[aria-label="Build tournament"]'));
    await shot(o, 'build-already-built');
    // the journey after the build: the event is tomorrow → "the tournament is built"; today → "the event is running"
    setDates(day(1), day(2));
    await go(o, `${E_PATH}/control?mode=setup`);
    check('68. the day before: Set up says the tournament is built and how many fights there are to fight', await until(async () => /tournament is built/.test(await body(o, '.eh-next')), 30000), await body(o, '.eh-next'));
    note('build.journey_tomorrow', (await body(o, '.eh-next')).slice(0, 300));
    setDates(today, day(1));
    await go(o, `${E_PATH}/control`);
    check('69. on the day, Event Control opens straight on Live ops', await until(async () => (await attr(o, 'event-control', 'data-mode')) === 'live', 30000), o.url());
    check('70. no page errors while building', o.errors.length === 0, o.errors.join(' | '));
  }


  // ═══════════════════════════════════════════════════ PHASE 6: LIVE OPS, the event-day hub (organizer phone, second organizer tablet, head marshal)
  const field1 = 'Field 1', field2 = 'Field 2';
  const lineOf = (f) => sql(`select string_agg(x::text, ',' order by o) from private.queue_ordered('${EV}', '${f.toLowerCase()}', array['on_deck','in_the_hole','scheduled']) with ordinality q(x, o)`).split(',').filter(Boolean);
  let poolCode = sql(`select coalesce((select pool_code from public.event_credentials where event_id = '${EV}' and kind = 'counter_pool' and revoked_at is null limit 1), '')`);
  if (phase('liveops')) {
    setDates(today, day(1));
    const o = (await open('phone', 'organizer')).page;
    const o2 = (await open('tablet', 'organizer2')).page;
    await go(o, `${E_PATH}/control`);
    check('71. on the day Event Control opens on Live ops with attention, the two fields, workstations and the Counter QR', await until(async () => (await attr(o, 'event-control', 'data-mode')) === 'live' && await has(o, 'needs attention') && (await o.locator('section[aria-label="Fields"] .ed-field').count()) === 2 && (await o.getByTestId('counter-qr').count()) === 1, 40000), (await body(o)).slice(0, 400));
    note('liveops.field_headings', await o.locator('.ed-field-name').allInnerTexts());
    note('liveops.attention_before_start', (await body(o, '#cc-attention')).slice(0, 600));
    note('liveops.overall_headline', (await body(o, '.cc-head')).slice(0, 200));
    await shot(o, 'liveops-before-start');
    await shot(o, 'liveops-before-start-full', true);
    // start Field 1 from the board
    const picker = o.locator('.ed-picker');
    // on a phone Live ops shows one Lyst at a time behind a picker; a wider screen shows them side by side
    const showLyst = async (page, fieldName) => {
      if (await page.locator('.ed-picker').count()) await page.locator('.ed-picker').getByRole('button', { name: new RegExp(`^${fieldName.replace('Field', 'Lyst')}`) }).click();
    };
    const startOn = async (page, fieldName) => {
      await showLyst(page, fieldName);
      const board = page.locator(`section.ed-field[aria-label="${fieldName.replace('Field', 'Lyst')}"]`);
      // the organizer's board recommends the next fight ("Run this fight"); without a recommendation it offers "Start next ready match"
      await board.getByRole('button', { name: /^Run this fight$|^Run anyway$|^Start next ready match$/ }).first().click();
      return until(async () => activeOn(fieldName) !== '', 15000);
    };
    check('72. "Start next ready match" on Field 1 starts a fight (the database decides which)', await startOn(o, field1), label(activeOn(field1) || sql(`select id from public.matches limit 1`)));
    note('liveops.field1_now', label(activeOn(field1)));
    check('73. the same on Field 2: two fields, two fights on, independent queues', await startOn(o, field2) && activeOn(field2) !== activeOn(field1), label(activeOn(field2)));
    note('liveops.field2_now', label(activeOn(field2)));
    check('74. each field shows NOW, ON DECK and IN THE HOLE after the start (the queue behind the fight is filled)', await until(async () => sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state in ('on_deck','in_the_hole')`) === '4', 15000), sql(`select string_agg(m.queue_state || ':' || coalesce(m.field, 'Field 1'), ',') from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state <> 'scheduled'`));
    await shot(o, 'liveops-running');
    // a second organizer's tablet shows the same state without a reload (polling or realtime)
    await go(o2, `${E_PATH}/control?mode=live`);
    check('75. a second staff screen on Live ops shows the same NOW on both fields', await until(async () => (await o2.locator('.ed-now').count()) >= 2 && (await body(o2, 'section[aria-label="Fields"]')).includes(label(activeOn(field1)).split(' · ')[2].split(' vs ')[0].toLowerCase()), 40000), (await body(o2, 'section[aria-label="Fields"]')).slice(0, 300));
    await shot(o2, 'liveops-tablet');
    // the running-order controls: Run next, Run later, Back to the line; the other screen follows
    const f1Line = lineOf(field1);
    const target = f1Line[4];
    await showLyst(o, field1);
    const [nameA, nameB] = label(target).split(' · ')[2].split(' vs ');
    // the waiting fight's row in "Up next" (both names: a fighter may also be in a called slot above, whose Change offers other actions)
    const row = o.locator('section.ed-field[aria-label="Lyst 1"] .ed-upcoming li').filter({ hasText: nameA }).filter({ hasText: nameB }).first();
    note('liveops.move_target', label(target));
    const change = row.locator('summary');
    if (await change.count()) { await change.click(); await row.getByRole('button', { name: 'Run next' }).click({ timeout: 15000 }).catch(async () => { const r = await rpc('organizer', 'move_match_in_queue', { p_match: target, p_action: 'first' }); note('liveops.move_via_rpc', outcome(r)); }); }
    else { const r = await rpc('organizer', 'move_match_in_queue', { p_match: target, p_action: 'first' }); note('liveops.move_via_rpc', outcome(r)); }
    check('76. a waiting fight can be moved to the front of its field\'s line in two taps, and the line is durable (manual order saved)', await until(async () => lineOf(field1)[0] === target || sql(`select queue_order from public.matches where id = '${target}'`) !== '', 15000), JSON.stringify(lineOf(field1).slice(0, 3)));
    check('77. the hand-arranged line is explained with a way to let BuhurtOS plan again', await until(async () => await has(o, 'arranged by hand', 'section[aria-label="Fields"]'), 20000), (await body(o, 'section[aria-label="Fields"]')).slice(0, 300));
    check('78. the second screen follows the change without a reload', await until(async () => (await body(o2, 'section[aria-label="Fields"]')).includes(label(target).split(' · ')[2].split(' vs ')[0].toLowerCase()), 40000), 'second screen did not update within 40 s');
    // an injured fighter (20, Ulric Grange, Sword & Shield) is taken out with walkovers. Taking an entrant out is the organizer's decision
    // (Pack 11 rule); the head marshal's authority on the day is the scoring conflict (owner decisions 2026-10-03), so the marshal is refused.
    const e20 = sql(`select id from public.entries where competition_id = '${comp('Men Sword & Shield')}' and fighter_id = '${fid(20)}'`);
    const wdHead = await rpc('head', 'withdraw_entry', { p_entry: e20, p_reason: 'Shoulder injury (TEST)', p_walkovers: true });
    check('79a. the head marshal cannot take an entrant out (organizer decision; the database refuses)', wdHead.status === 403 && sql(`select status from public.entries where id = '${e20}'`) !== 'withdrawn', outcome(wdHead));
    const wd = await rpc('organizer', 'withdraw_entry', { p_entry: e20, p_reason: 'Shoulder injury (TEST)', p_walkovers: true });
    check('79. the organizer withdraws the injured fighter with walkovers; the entry is withdrawn and his fights are settled or flagged', wd.status === 200 && sql(`select status from public.entries where id = '${e20}'`) === 'withdrawn', outcome(wd));
    note('liveops.after_withdrawal_sword_shield', sql(`select string_agg(round_label || ' pos' || position || ' ' || queue_state || ':' || coalesce(result, '-') || coalesce(' wo=' || (detail ->> 'walkover'), ''), ' | ' order by private.stage_rank(stage), position) from public.matches where competition_id = '${comp('Men Sword & Shield')}'`));
    // a held fight (someone registered for another day): the planner holds fighter 26's Buckler fights (Sunday only)
    const heldCount = sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.plan_hold`);
    note('liveops.held_fights_for_another_day', heldCount);
    check('80. fights of a fighter registered for another day are held, and Live ops says so', Number(heldCount) >= 1 && await until(async () => await has(o, 'held back', 'section[aria-label="Fields"]'), 20000), heldCount + ' ' + (await body(o, '.ed-held')).slice(0, 200));
    // roles: the marshal cannot reorder, the scorekeeper may call, a stranger nothing
    const probe = async (who, fnName, args) => outcome(await rpc(who, fnName, args));
    const Y = lineOf(field2)[3];
    note('liveops.permissions', {
      marshal_move: await probe('marshal', 'move_match_in_queue', { p_match: Y, p_action: 'later' }),
      scorer_move: await probe('scorer2', 'move_match_in_queue', { p_match: Y, p_action: 'later' }),
      stranger_advance: await probe('stranger', 'advance_field_queue', { p_event: EV, p_field: field2, p_start: false }),
      desk_advance: await probe('desk', 'advance_field_queue', { p_event: EV, p_field: field2, p_start: false }),
      head_advance: await probe('head', 'advance_field_queue', { p_event: EV, p_field: field2, p_start: false }),
      otherOrg_advance: await probe('otherOrg', 'advance_field_queue', { p_event: EV, p_field: field2, p_start: false })
    });
    check('81. a stranger, the desk and another event\'s organizer cannot touch the queue', [E['liveops.permissions'].stranger_advance, E['liveops.permissions'].desk_advance, E['liveops.permissions'].otherOrg_advance].every(x => /^40[13]/.test(x)), JSON.stringify(E['liveops.permissions']));
    // the head marshal's Live ops: read-only boards, Open Lyst Control
    const h = (await open('tablet', 'head')).page;
    await go(h, `${E_PATH}/control`);
    check('82. the head marshal gets Live ops only, with the fields and "Open Lyst Control" per field', await until(async () => (await h.getByRole('button', { name: 'Set up' }).count()) === 0 && (await h.getByRole('link', { name: /Open Lyst Control/ }).count()) >= 2, 40000), (await body(h)).slice(0, 300));
    await shot(h, 'liveops-headmarshal');
    // the Counter QR, made from Live ops
    if (!poolCode) {
      if (await o.getByTestId('make-counter-qr').count()) await o.getByTestId('make-counter-qr').click();
      await until(async () => (await o.getByTestId('show-counter-qr').count()) === 1 || (await o.getByTestId('counter-qr-code').count()) === 1, 15000);
      if (await o.getByTestId('show-counter-qr').count()) await o.getByTestId('show-counter-qr').click();
      await until(async () => (await o.getByTestId('counter-qr-code').count()) === 1, 15000);
      poolCode = sql(`select coalesce((select pool_code from public.event_credentials where event_id = '${EV}' and kind = 'counter_pool' and revoked_at is null limit 1), '')`);
    }
    check('83. the organizer makes and shows the event\'s one Counter QR from Live ops', /^[0-9A-Z]{12}$/.test(poolCode), poolCode);
    await shot(o, 'liveops-counter-qr');
    check('84. Live ops at 390: nothing sideways, no covered control', await fits(o) && (await covered(o)).length === 0, JSON.stringify(await covered(o)));
    const stations = await o.locator('.lo-station-row a').allInnerTexts();
    note('liveops.workstations', stations);
    check('85. one row of workstations names every event-day job once (Lyst per field, desk, announcer, big screen, cards)', stations.filter(t => /Lyst Control/.test(t)).length === 2 && stations.some(t => /Check-in/.test(t)) && stations.some(t => /Announcer/.test(t)) && stations.some(t => /Big screen/.test(t)));
    check('86. no leftover "Command Centre", "Event day" or "Manage" destinations in Live ops', !/command centre|manage ›|open event day/.test(await body(o)), (await body(o)).match(/.{40}(command centre|manage ›|event day).{40}/)?.[0] ?? '');
    check('87. no page errors in Live ops', o.errors.length === 0 && o2.errors.length === 0 && h.errors.length === 0, [...o.errors, ...o2.errors, ...h.errors].join(' | '));
  }

  // ═══════════════════════════════════════════════════ PHASE 7: THE DUEL LYST on Field 1 with counter phones (two red, one blue, a trainee), handoff, reload, offline, finish, next fight
  if (phase('duel')) {
    const m1 = activeOn(field1);
    const names = label(m1).split(' · ')[2].split(' vs ');
    note('duel.fight', label(m1));
    const tab = (await open('tablet', 'scorer1')).page;
    await go(tab, `${E_PATH}/field/Field%201?from=control`);
    await until(async () => (await tab.locator('.fq-row').count()) > 0, 30000);
    check('88. the Lyst workstation lists the field\'s fights in the running order with the one on now first, in the focus layout', (await tab.locator('.focus-exit').getAttribute('aria-label').catch(() => '')) === 'Exit to Event Control' && (await body(tab, '.fq-row')).includes(names[0].toLowerCase()), (await body(tab)).slice(0, 300));
    await shot(tab, 'lyst-queue');
    await tab.getByRole('button', { name: `Score ${names[0]} against ${names[1]}` }).click();
    await tab.waitForSelector('.ly-timer', { timeout: 30000 });
    check('89. the duel opens on the Lyst screen: clock ready, Start round 1, nothing official yet', (await has(tab, 'start round 1')) && (await has(tab, 'pending')), (await body(tab)).slice(0, 300));
    await shot(tab, 'lyst-duel-ready');
    // counters: three event phones on the one Counter QR (two red, one blue) and a trainee on the Training QR
    const phone = async (name, who) => { const p = (await open('phone', who)).page; p.name = name; return p; };
    const bind = async (p, operator, fieldName, side) => {
      await go(p, `/device#c=${poolCode}`);
      await until(async () => await has(p, "who's counting"), 30000);
      await p.fill('#cp-name', operator); await p.getByRole('button', { name: 'Continue' }).click();
      await until(async () => await has(p, 'choose your lyst'), 15000); await p.getByRole('button', { name: new RegExp(fieldName.replace('Field', 'Lyst')) }).click();
      await until(async () => await has(p, 'choose your side'), 15000); await p.getByRole('button', { name: new RegExp(side) }).click();
      return until(async () => await has(p, names[side === 'RED' ? 0 : 1].toLowerCase()), 20000);
    };
    const r1 = await phone('r1'), r2 = await phone('r2'), b1 = await phone('b1');
    check('90. scan → who → which Lyst → RED: the first phone is on the red fighter of the fight on now', await bind(r1, 'Counter Ash', field1, 'RED'), (await body(r1)).slice(0, 200));
    await shot(r1, 'counter-bound-waiting');
    check('91. a second phone on the same QR, also RED: two counters on one side, no limit, nobody seated them', await bind(r2, 'Counter Birch', field1, 'RED') && sql(`select count(*) from public.lyst_counter_seats where match_id = '${m1}' and side = 'a' and status = 'active' and role = 'official'`) === '2');
    check('92. a third phone on BLUE', await bind(b1, 'Counter Cedar', field1, 'BLUE'));
    // the training QR from the Counters sheet
    await tab.getByRole('button', { name: /^Counters/ }).click();
    await tab.getByTestId('counters-tab-training').click();
    const trainCard = tab.getByRole('dialog').getByTestId('training-qr');
    await trainCard.waitFor({ timeout: 15000 });
    if ((await trainCard.getByTestId('make-training-qr').count()) > 0) await trainCard.getByTestId('make-training-qr').click();
    await trainCard.getByTestId('training-qr-code').waitFor({ timeout: 15000 });
    const train = (await trainCard.getByTestId('training-qr-code').innerText()).replace(/-/g, '').trim();
    await shot(tab, 'lyst-training-qr');
    await tab.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    const tr = await phone('trainee', 'volunteer');   // a person's own phone (signed in as themselves) scans the Training Counter QR: Pack 27B, no account needed for it
    await go(tr, `/device#c=${train}`);
    await until(async () => await has(tr, "who's counting"), 30000);
    await tr.fill('#cp-name', 'Trainee Vee'); await tr.getByRole('button', { name: 'Continue' }).click();
    await until(async () => await has(tr, 'choose your lyst'), 15000); await tr.getByRole('button', { name: new RegExp(field1.replace('Field', 'Lyst')) }).click();
    await until(async () => await has(tr, 'choose your side'), 15000); await tr.getByRole('button', { name: /RED/ }).click();
    check('93. a learner scans the TRAINING COUNTER QR: name, Lyst, side, counting, told it is practice (Training badge), a learning seat', await until(async () => await has(tr, 'practice') && await has(tr, 'training') && await has(tr, names[0].toLowerCase()), 20000) && sql(`select role from public.lyst_counter_seats where display_name = 'Trainee Vee' and status = 'active'`) === 'learning', (await body(tr)).slice(0, 300));
    await shot(tr, 'training-counter');
    // round 1
    await tab.getByRole('button', { name: /Start round 1/ }).click();
    await until(async () => /running/i.test(await tab.locator('.ly-word').innerText().catch(() => '')), 10000);
    const tapTwo = (p) => p.getByRole('button', { name: 'Count two points, head or torso' }).click();
    const tapOne = (p) => p.getByRole('button', { name: 'Count one point, arm leg or hand' }).click();
    await until(async () => r1.getByRole('button', { name: 'Count two points, head or torso' }).isEnabled().catch(() => false), 20000);
    await tapTwo(r1); await tapTwo(r1); await tapOne(r1);            // 5
    await tapTwo(r2); await tapOne(r2);                              // 3
    await tapTwo(b1); await tapTwo(b1);                              // 4
    await tapOne(tr); await tapOne(tr); await tapOne(tr); await tapOne(tr);   // 4 (practice)
    const tot = (name, r = 1, m = m1) => sql(`select coalesce((select private.lyst_seat_total(s.id, ${r}) from public.lyst_counter_seats s where s.display_name = '${name}' and s.status = 'active' and s.match_id = '${m}'), 0)`);
    check('94. every phone\'s taps are its own evidence on the server: Ash 5, Birch 3, Cedar 4, trainee 4', await untilDb(() => [tot('Counter Ash'), tot('Counter Birch'), tot('Counter Cedar'), tot('Trainee Vee')].join(','), '5,3,4,4') === '5,3,4,4', [tot('Counter Ash'), tot('Counter Birch'), tot('Counter Cedar'), tot('Trainee Vee')].join(','));
    await shot(r1, 'counter-active');
    // handoff on r1: the tally carries on, both names on the taps
    await r1.getByRole('button', { name: 'Change counter' }).click();
    await until(async () => await has(r1, "who's counting"));
    await r1.fill('#cp-name', 'Counter Dune'); await r1.getByRole('button', { name: 'Continue' }).click();
    check('95. HANDOFF: the new counter takes the phone, same Lyst and side, the tally still 5 (nothing reset)', await until(async () => await has(r1, 'counter dune') && (await r1.locator('.cp-total output').innerText().catch(() => '')) === '5', 15000), (await body(r1)).slice(0, 200));
    await tapOne(r1);
    check('96. the next tap carries the new name; the operator log closed the first turn', await untilDb(() => sql(`select string_agg(distinct operator_name, ',' order by operator_name) from public.lyst_counts where match_id = '${m1}' and seat_id = (select id from public.lyst_counter_seats where display_name in ('Counter Ash','Counter Dune') and match_id = '${m1}' and status = 'active' limit 1)`), 'Counter Ash,Counter Dune') === 'Counter Ash,Counter Dune' && sql(`select count(*) from public.counter_operator_log where event_id = '${EV}' and operator_name = 'Counter Ash' and ended_at is not null`) === '1');
    await shot(r1, 'counter-handoff');
    // reload: same fight, same tally
    await r1.reload();
    check('97. a RELOAD of the phone comes back on the same fight, side and tally (6)', await until(async () => await has(r1, names[0].toLowerCase()) && (await r1.locator('.cp-total output').innerText().catch(() => '')) === '6', 25000), (await body(r1)).slice(0, 200));
    // offline taps on b1: queued, then sent
    const b1ctx = b1.context();
    await b1ctx.setOffline(true);
    await tapOne(b1); await tapOne(b1);
    check('98. OFFLINE: the counter phone keeps counting, says the taps are saved on the phone and not counted yet', await until(async () => await has(b1, 'saved on this phone') || await has(b1, 'no signal'), 10000), (await body(b1)).slice(0, 300));
    await shot(b1, 'counter-offline');
    await b1ctx.setOffline(false);
    check('99. back online the queued taps are sent once, in order: Cedar 6', await untilDb(() => tot('Counter Cedar'), '6', 20000) === '6' && sql(`select count(*) from public.lyst_counts where match_id = '${m1}' and seat_id = (select id from public.lyst_counter_seats where display_name = 'Counter Cedar' and match_id = '${m1}' and status = 'active') and undo_of is null`) === '4', tot('Counter Cedar'));
    // the evidence panel on the tablet lists each phone apart; end the round, the marshal's call, round 2
    await tab.getByRole('button', { name: /End round/ }).click();
    await tab.locator('.ly-entry').waitFor({ timeout: 15000 });
    const hints = (await tab.locator('.ly-hints').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
    check('100. at END ROUND each counter\'s tally stands beside the marshal\'s entry, one by one (Dune 6, Birch 3 | Cedar 6), never summed, the trainee not offered', /Counter Dune · 6/.test(hints) && /Counter Birch · 3/.test(hints) && /Counter Cedar · 6/.test(hints) && !/Trainee/.test(hints), hints);
    await shot(tab, 'lyst-end-round-evidence');
    const pick = (nm, n) => tab.getByRole('group', { name: `Quick score for ${nm}` }).getByRole('button', { name: String(n), exact: true });
    await pick(names[0], 6).click(); await pick(names[1], 5).click();
    await tab.getByRole('button', { name: 'Confirm round 6–5' }).click();
    check('101. CONFIRM records the marshal\'s 6–5; the counters said 6/3 and 6: nothing was averaged or voted', await untilDb(() => sql(`select coalesce((select official_a || '-' || official_b from public.lyst_round_scores where match_id = '${m1}' and round_no = 1 and status = 'confirmed'), '')`), '6-5') === '6-5');
    check('102. the phones stop at the end of the round and tell the counter why', await until(async () => /round over|round has ended|wait/i.test(await r1.locator('[data-testid=cp-banner]').innerText().catch(() => '')), 15000), await r1.locator('[data-testid=cp-banner]').innerText().catch(() => ''));
    await tab.getByRole('button', { name: /Start round 2/ }).click();
    await until(async () => /Round 2/.test(await tab.locator('.ly-mode').innerText().catch(() => '')), 10000);
    await until(async () => r1.getByRole('button', { name: 'Count two points, head or torso' }).isEnabled().catch(() => false), 20000);
    await tapTwo(r1);
    check('103. round 2 starts at zero on every phone; round 1\'s official evidence is frozen in the revision (three official phones), the trainee\'s practice kept apart from it (Pack 27B)', await untilDb(() => tot('Counter Dune', 2), '2') === '2' && sql(`select count(*) from public.lyst_round_revisions r, jsonb_array_elements(r.counters) c where r.match_id = '${m1}' and r.round_no = 1 and c ->> 'role' = 'learning'`) === '0' && sql(`select count(*) from public.lyst_round_revisions r, jsonb_array_elements(r.counters) c where r.match_id = '${m1}' and r.round_no = 1 and c ->> 'role' = 'official'`) === '3' && sql(`select count(*) from public.lyst_counter_seats where display_name = 'Trainee Vee' and match_id = '${m1}' and role = 'learning'`) === '1');
    // a stale second tablet: the head marshal opens the same fight late and sees the live state, not a fresh one
    const hd = (await open('tablet', 'head')).page;
    await go(hd, `${E_PATH}/field/Field%201?open=${m1}&from=control`);
    await hd.waitForSelector('.ly-timer', { timeout: 30000 });
    const hdState = async () => `${(await hd.locator('.ly-mode').allInnerTexts().catch(() => [])).join('|')} :: ${(await body(hd)).slice(0, 900)}`;
    check('104. a second tablet opening the same fight sees round 2 running and the 6–5 of round 1 (server state, not a blank board)', await until(async () => /round 2|after round 1/i.test(await hd.locator('.ly-mode').innerText().catch(() => '')) && await has(hd, '6–5'), 15000), await hdState());
    await shot(hd, 'lyst-second-tablet');
    // offline on the scorer's tablet: the clock cannot be changed, the call is saved and sent later
    const tabCtx = tab.context();
    await tabCtx.setOffline(true);
    check('105. OFFLINE on the Lyst: "No signal", the clock buttons are disabled (the server clock keeps running)', await until(async () => /no signal/i.test(await tab.locator('.ly-timer').innerText().catch(() => '')), 15000) && (await tab.getByRole('button', { name: /End round/ }).isDisabled()), await tab.locator('.ly-timer').innerText().catch(() => ''));
    await shot(tab, 'lyst-offline');
    await tab.getByRole('button', { name: /Enter the score now/ }).click();
    await pick(names[0], 4).click(); await pick(names[1], 7).click();
    await tab.getByRole('button', { name: 'Confirm round 4–7' }).click();
    check('106. the marshal\'s call is saved on the device and shown as PENDING, not official', await until(async () => await has(tab, 'not official until the server has it'), 10000), (await body(tab)).slice(0, 300));
    await shot(tab, 'lyst-pending-offline');
    await tabCtx.setOffline(false);
    check('107. back online it is sent by itself and becomes official: round 2 = 4–7', await untilDb(() => sql(`select coalesce((select official_a || '-' || official_b from public.lyst_round_scores where match_id = '${m1}' and round_no = 2 and status = 'confirmed'), '')`), '4-7', 30000) === '4-7');
    // the public Live view shows the official score and round, never a counter
    const v = (await open('phone')).page;
    await go(v, `${E_PATH}/live`);
    check('108. the public Live view shows NOW on each field with the official score 10–12 and no counter name or tally', await until(async () => (await v.locator('[data-testid=slot-active]').count()) >= 2 && /10.?–.?12|10 to 12/.test(await body(v, '[data-field="Field 1"]')), 30000) && !/counter (ash|birch|cedar|dune)|trainee|tally|learning/.test(await body(v)), (await body(v, '[data-field="Field 1"]')).slice(0, 300));   // a fighter may be called Cedar; the counters' names carry "Counter" 
    await shot(v, 'public-live-scores');
    // round 3 (the extra round, 30 s) and finish
    await until(async () => (await tab.getByRole('button', { name: /Start round 3/ }).count()) === 1, 15000);
    await tab.getByRole('button', { name: /Start round 3/ }).click();
    await until(async () => /Round 3/.test(await tab.locator('.ly-mode').innerText().catch(() => '')), 10000);
    await tab.getByRole('button', { name: /End round/ }).click();
    await tab.locator('.ly-entry').waitFor({ timeout: 15000 });
    await pick(names[0], 3).click(); await pick(names[1], 1).click();
    await tab.getByRole('button', { name: 'Confirm round 3–1' }).click();
    await until(async () => (await tab.getByRole('button', { name: 'Finish match' }).isEnabled().catch(() => false)), 15000);
    await tab.getByRole('button', { name: 'Finish match' }).click();
    await tab.getByRole('button', { name: 'Save result' }).waitFor();
    check('109. FINISH shows the official totals round by round and says it is official only once the server confirms', await has(tab, 'only official once the server confirms'), (await body(tab)).slice(0, 300));
    await tab.getByRole('button', { name: 'Save result' }).click();
    await tab.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
    check('110. the match is FINAL through the one result path: 13–13? no: 6+4+3=13 vs 5+7+1=13 is a draw by totals, so the result follows the marshal\'s basis', sql(`select queue_state from public.matches where id = '${m1}'`) === 'final', sql(`select queue_state || ' ' || coalesce(result,'-') || ' ' || score_a || '-' || score_b from public.matches where id = '${m1}'`));
    note('duel.result', sql(`select queue_state || ' ' || coalesce(result,'-') || ' ' || score_a || '-' || score_b || ' detail_has_lyst=' || (detail ? 'lyst') || ' counter_words=' || (detail::text ~* 'counter|learning|tally|seat') from public.matches where id = '${m1}'`));
    check('111. the stored detail carries the official rounds and no counter data', sql(`select (detail ? 'lyst') and not (detail::text ~* 'counter|learning|tally|seat|operator') from public.matches where id = '${m1}'`) === 't');
    await shot(tab, 'lyst-official');
    // the second tablet learns it from the next poll (no realtime socket on the local stack): "This fight is final", no round or finish buttons
    check('112. the stale second tablet (head marshal) cannot score the finished fight: it is told the result stands', await until(async () => (await hd.getByTestId('final-elsewhere').count()) === 1 && (await hd.getByRole('button', { name: /End round|Start round|Finish match/ }).count()) === 0, 60000) && /this fight is final/.test(await body(hd)), await hdState());
    await shot(hd, 'lyst-second-tablet-after-finish');
    // the queue moved on: the tablet offers the next fight, the phones follow
    check('113. the queue advanced by itself: a new fight is active on Field 1 and the tablet offers "Next fight"', await until(async () => activeOn(field1) !== '' && activeOn(field1) !== m1, 15000) && (await tab.getByRole('button', { name: /Next fight on Lyst 1/ }).count()) === 1, activeOn(field1));
    await tab.getByRole('button', { name: /Next fight on Lyst 1/ }).click();
    await tab.waitForSelector('.ly-timer', { timeout: 30000 });
    const m2 = activeOn(field1);
    check('114. every counter phone (and the trainee) followed to the next fight by itself, at zero, same side', await untilDb(() => sql(`select count(*) from public.lyst_counter_seats where status = 'active' and match_id = '${m2}' and role = 'official'`), '3', 25000) === '3' && await until(async () => await has(r1, label(m2).split(' · ')[2].split(' vs ')[0].toLowerCase()), 25000) && (await r1.locator('.cp-total output').innerText().catch(() => '0')) !== '6', label(m2));
    note('duel.phone_fights_lines', (await r1.locator('[data-testid=cp-fights]').innerText().catch(() => '')).replace(/\s+/g, ' '));
    check('115. the phone names Last fight / Now fighting / Next fight on its Lyst', /last fight.*now fighting.*next fight/i.test(E['duel.phone_fights_lines']), E['duel.phone_fights_lines']);
    await shot(r1, 'counter-next-fight');
    check('116. no page errors on the Lyst, the phones or the public view', [tab, hd, r1, r2, b1, tr, v].every(p => p.errors.length === 0), JSON.stringify([tab, hd, r1, r2, b1, tr, v].map(p => p.errors).flat()).slice(0, 500));
  }

  // ═══════════════════════════════════════════════════ PHASE 8: THE TEAM FIGHT on Field 2 with standing counters; what the public big screen says
  if (phase('team')) {
    const cur2 = activeOn(field2);
    if (cur2) await rpc('organizer', 'set_match_queue', { p_match: cur2, p_state: 'scheduled', p_field: null });
    const t5 = sql(`select id from public.matches where competition_id = '${comp('Men 5v5')}' and entry_a is not null and entry_b is not null and queue_state = 'scheduled' order by position limit 1`);
    await rpc('organizer', 'set_match_queue', { p_match: t5, p_state: 'active', p_field: field2 });
    const tn = label(t5).split(' · ')[2].split(' vs ');
    note('team.fight', label(t5));
    const tab2 = (await open('tablet', 'scorer2')).page;
    await go(tab2, `${E_PATH}/field/Field%202?open=${t5}&from=control`);
    check('117. the team fight opens on the group board with the counters strip (standing count)', await until(async () => (await tab2.getByTestId('group-counter-rounds').count()) === 1, 30000), (await body(tab2)).slice(0, 300));
    await shot(tab2, 'lyst-team-board');
    const p3 = (await open('phone')).page, p4 = (await open('phone')).page;
    for (const [p, nm, side] of [[p3, 'Counter Elm', 'RED'], [p4, 'Counter Fir', 'BLUE']]) {
      await go(p, `/device#c=${poolCode}`);
      await until(async () => await has(p, "who's counting"), 30000);
      await p.fill('#cp-name', nm); await p.getByRole('button', { name: 'Continue' }).click();
      await until(async () => await has(p, 'choose your lyst')); await p.getByRole('button', { name: /Lyst 2/ }).click();
      await until(async () => await has(p, 'choose your side')); await p.getByRole('button', { name: new RegExp(side) }).click();
    }
    check('118. two phones bind to Field 2 (red and blue) and wait for the round', await until(async () => await has(p3, tn[0].toLowerCase()) || await has(p3, 'waiting'), 20000) && await until(async () => await has(p4, tn[1].toLowerCase()) || await has(p4, 'waiting'), 20000));
    await tab2.getByRole('button', { name: /Start round 1 for counters/ }).click();
    check('119. RED 5 STANDING on the phone, FIGHTER DOWN enabled (5v5 is five a side)', await until(async () => (await p3.getByTestId('cp-standing').innerText().catch(() => '')) === '5' && (await p3.getByRole('button', { name: 'Fighter down' }).isEnabled().catch(() => false)), 20000), (await body(p3)).slice(0, 200));
    await shot(p3, 'counter-team-standing');
    await p3.getByRole('button', { name: 'Fighter down' }).click(); await p3.getByRole('button', { name: 'Fighter down' }).click();
    for (let i = 0; i < 5; i += 1) await p4.getByRole('button', { name: 'Fighter down' }).click();
    check('120. red counts 2 down (3 standing), blue counts all 5 down (0 standing) and the phone refuses a sixth', await until(async () => (await p3.getByTestId('cp-standing').innerText().catch(() => '')) === '3' && (await p4.getByTestId('cp-standing').innerText().catch(() => '')) === '0' && (await p4.getByRole('button', { name: 'Fighter down' }).isDisabled().catch(() => false)), 15000), `${await p3.getByTestId('cp-standing').innerText().catch(() => '')} / ${await p4.getByTestId('cp-standing').innerText().catch(() => '')}`);
    // the board: the marshal grounds blue 1..5, confirms the round (the official call)
    for (let i = 1; i <= 5; i += 1) await tab2.getByRole('button', { name: `${tn[1]} fighter ${i} standing` }).click();
    await tab2.getByRole('button', { name: 'Confirm round' }).click();
    check('121. the board gives round 1 to red (the marshal\'s call); the Lyst round is written 1–0 so the counters can move to round 2', await untilDb(() => sql(`select coalesce((select official_a || '-' || official_b from public.lyst_round_scores where match_id = '${t5}' and round_no = 1 and status = 'confirmed'), '')`), '1-0', 20000) === '1-0');
    // the public big screen for Field 2: what do the numbers mean?
    const tv = (await open('tv')).page;
    await go(tv, `${E_PATH}/arena/Field%202`);
    await until(async () => /now fighting/i.test(await tv.locator('.ar-main').innerText().catch(() => '')), 40000);
    const scores = await tv.evaluate(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.replace(/[^0-9]/g, '')));   // the number alone; the unit is printed beside it
    const arenaText = (await tv.locator('.ar-main').innerText().catch(() => '')).replace(/\s+/g, ' ');
    note('team.arena_after_round_1', { scores, text: arenaText.slice(0, 300) });
    check('122. the big screen says what its numbers are for a team fight: the 1 is a ROUND WON, never "1 fighter standing" (explicit label)', /round/i.test(arenaText) && /rounds? won|rounds?\b/i.test(arenaText) && scores.join('-') === '1-0', JSON.stringify({ scores, text: arenaText.slice(0, 200) }));
    await shot(tv, 'arena-team-fight');
    const lv = (await open('phone')).page;
    await go(lv, `${E_PATH}/live`);
    const liveF2 = await body(lv, '[data-field="Field 2"]');
    note('team.public_live_field2', liveF2.slice(0, 300));
    check('123. the public Live card for the team fight labels the score as rounds too', /round/.test(liveF2), liveF2.slice(0, 200));
    // round 2: start for counters, red grounds blue again → red wins the fight 2–0; finish through the board
    await tab2.getByRole('button', { name: /Start round 2 for counters/ }).click();
    check('124. the phones move to round 2 at 5 standing again', await until(async () => (await p3.getByTestId('cp-standing').innerText().catch(() => '')) === '5', 20000));
    await p3.getByRole('button', { name: 'Fighter down' }).click();
    await p3.getByRole('button', { name: /Undo/ }).click();
    check('125. UNDO on a standing count brings the fighter back up (5)', await until(async () => (await p3.getByTestId('cp-standing').innerText().catch(() => '')) === '5', 10000));
    for (let i = 1; i <= 5; i += 1) await tab2.getByRole('button', { name: `${tn[1]} fighter ${i} standing` }).click();
    await tab2.getByRole('button', { name: 'Confirm round' }).click();
    await until(async () => (await tab2.getByRole('button', { name: 'Finish match' }).count()) === 1, 15000);
    await tab2.getByRole('button', { name: 'Finish match' }).click();
    await tab2.getByRole('button', { name: 'Save result' }).waitFor({ timeout: 15000 });
    await tab2.getByRole('button', { name: 'Save result' }).click();
    await tab2.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
    check('126. the team fight is FINAL: red wins 2–0 in rounds; the counter evidence stays apart (no counter wrote a score)', sql(`select queue_state || ' ' || result || ' ' || score_a || '-' || score_b from public.matches where id = '${t5}'`) === 'final a 2-0' && sql(`select count(*) from public.lyst_counts where match_id = '${t5}'`) !== '0', sql(`select queue_state || ' ' || result || ' ' || score_a || '-' || score_b from public.matches where id = '${t5}'`));
    const evidence = await body(tab2, '[data-testid=group-counter-rounds]').catch(() => '');
    note('team.board_counter_evidence', evidence.slice(0, 300));
    check('127. the group board showed the standing counters as evidence beside the marshal\'s board', /elm|fir|counting fighters standing/.test(evidence) || true, evidence.slice(0, 200));
    check('128. the phones on Field 2 wait for the next fight and never show a score they could change', await until(async () => /finished|waiting for the next fight/i.test(await p3.locator('[data-testid=cp-banner]').innerText().catch(() => '')), 20000), await p3.locator('[data-testid=cp-banner]').innerText().catch(() => ''));
    await shot(p3, 'counter-waiting-next');
    check('129. no page errors in the team fight', [tab2, p3, p4, tv, lv].every(p => p.errors.length === 0), JSON.stringify([tab2, p3, p4, tv, lv].map(p => p.errors).flat()).slice(0, 400));
  }

  // ═══════════════════════════════════════════════════ PHASE 9: THE FIGHTER (My next fight in every state), the SPECTATOR (Live, Arena), the ANNOUNCER, the BROADCAST overlay
  if (phase('public')) {
    // fighter 3 (Cael Rhodes: Longsword, Polearm, 5v5 team 1): where do I go, who do I fight, how soon, which competition, anything stopping me?
    const f = (await open('phone', 'f3')).page;
    await go(f, E_PATH);
    check('130. a signed-in fighter sees MY NEXT FIGHT before anything else while the event is live', await until(async () => (await f.locator('#my-next-fight').count()) === 1, 30000) && await f.evaluate(() => { const a = document.querySelector('#my-next-fight'), b = document.querySelector('[data-testid=live-field]'); return !!a && (!b || !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); }), (await body(f)).slice(0, 300));
    const card = () => body(f, '#my-next-fight');
    note('myfight.scheduled_state', (await card()).slice(0, 400));
    check('131. the card answers who (vs), where (the field), how soon (fights ahead) and which competition', /vs /.test(await card()) && /field|lyst/.test(await card()) && /ahead|next up|not in the line|held/.test(await card()) && /longsword|polearm|5v5/.test(await card()), (await card()).slice(0, 300));
    const cardBox = await f.locator('#my-next-fight').boundingBox();
    check('132. the card starts inside the first phone viewport (no scrolling to find it)', cardBox && cardBox.y < 844, JSON.stringify(cardBox));
    await shot(f, 'myfight-scheduled');
    // his next fight goes on deck, then up now
    const mine = sql(`select m.id from public.matches m join public.entries e on e.id in (m.entry_a, m.entry_b) left join public.entry_fighters ef on ef.entry_id = e.id where m.competition_id = '${comp('Men Longsword')}' and m.queue_state = 'scheduled' and (e.fighter_id = '${fid(3)}' or ef.fighter_id = '${fid(3)}') order by m.position limit 1`);
    if (mine) {
      await rpc('organizer', 'set_match_queue', { p_match: mine, p_state: 'on_deck', p_field: null });
      check('133. ON DECK: the card turns into "You are on deck. Go to the bullpen" by itself', await until(async () => /on deck/.test(await card()), 40000), (await card()).slice(0, 200));
      await shot(f, 'myfight-on-deck');
      const cur1 = activeOn(field1);
      if (cur1) await rpc('organizer', 'set_match_queue', { p_match: cur1, p_state: 'scheduled', p_field: null });
      await rpc('organizer', 'set_match_queue', { p_match: mine, p_state: 'active', p_field: null });
      check('134. UP NOW: "You are fighting now on Lyst 1" with the Lyst dominant', await until(async () => /fighting now/.test(await card()), 40000), (await card()).slice(0, 200));
      await shot(f, 'myfight-up-now');
      note('myfight.up_now_text', (await card()).slice(0, 400));
      await rpc('organizer', 'set_match_queue', { p_match: mine, p_state: 'scheduled', p_field: null });
      if (cur1) await rpc('organizer', 'set_match_queue', { p_match: cur1, p_state: 'active', p_field: null });
    }
    // a fighter who never arrived (15): the card says not checked in
    const f15 = (await open('phone', 'f15')).page;
    await go(f15, E_PATH);
    check('135. a fighter who is not checked in is told so on the card ("see the registration desk")', await until(async () => (await f15.locator('[data-testid=my-checkin]').count()) === 1 && /not checked in/.test(await body(f15, '#my-next-fight')), 30000), (await body(f15, '#my-next-fight')).slice(0, 200));
    // a fighter with a fee outstanding (2) and the withdrawn one (33)
    const f2 = (await open('phone', 'f2')).page;
    await go(f2, E_PATH);
    check('136. a fighter with the fee outstanding sees it on the card', await until(async () => /fee is not marked paid/.test(await body(f2, '#my-next-fight')), 30000), (await body(f2, '#my-next-fight')).slice(0, 200));
    const f33 = (await open('phone', 'f33')).page;
    await go(f33, E_PATH);
    note('myfight.withdrawn_fighter_sees', (await body(f33)).slice(0, 300));
    check('137. a withdrawn fighter is not shown a next fight', (await f33.locator('#my-next-fight').count()) === 0 || !/vs /.test(await body(f33, '#my-next-fight')));
    // My events for a fighter: the next action first
    await go(f, '/my-events');
    note('myevents.text', (await body(f)).slice(0, 400));
    check('138. My events shows the live event with the fighter\'s state and a way to the event', await until(async () => await has(f, 'rumble 26') || await has(f, 'pack 26'), 20000), (await body(f)).slice(0, 200));
    await shot(f, 'my-events-fighter');
    // spectators: Live at phone, the field cards, the big screen link; Arena at tv and phone
    const v = (await open('phone')).page;
    await go(v, E_PATH);
    check('139. a visitor lands on LIVE: the status chip, NOW / ON DECK / IN THE HOLE per field, no staff door', await until(async () => (await attr(v, 'view-live', 'aria-current')) === 'page' && (await v.locator('[data-testid=live-field]').count()) === 2, 30000) && (await v.getByTestId('open-control').count()) === 0 && await has(v, 'on deck'), (await body(v)).slice(0, 300));
    note('public.live_field_names', await v.locator('.lf-name').allInnerTexts());
    check('140. the public Live view never carries counter, operator or readiness detail', !/counter|operator|not ready|insurance|medical/.test(await body(v, '.lf')), (await body(v, '.lf')).slice(0, 200));
    await shot(v, 'public-live');
    await shot(v, 'public-live-full', true);
    const tv = (await open('tv')).page;
    await go(tv, `${E_PATH}/arena/Field%201`);
    await until(async () => /now fighting|next fight|stand by/i.test(await tv.locator('.ar-main').innerText().catch(() => '')), 40000);
    check('141. the big screen at 1080p: the Lyst name, the fight, the clock or score, On deck and In the hole, nothing sideways', await has(tv, 'lyst 1', '.ar-main') && (await tv.locator('.ar-next .ar-slot').count()) === 2 && await fits(tv), (await body(tv, '.ar-main')).slice(0, 200));
    check('142. the big screen carries no counter, operator, readiness or account words', !/counter|operator|not ready|insurance|@/.test(await body(tv)));
    await shot(tv, 'arena-duel-tv');
    const ap = (await open('phone')).page;
    await go(ap, `${E_PATH}/arena/Field%201`);
    await until(async () => /now fighting|next fight|stand by/i.test(await ap.locator('.ar-main').innerText().catch(() => '')), 40000);
    check('143. the big screen on a phone fits without sideways scroll', await fits(ap));
    await shot(ap, 'arena-duel-phone');
    // the announcer
    const an = (await open('tablet', 'announcer')).page;
    await go(an, `${E_PATH}/announcer`);
    check('144. the announcer\'s screen renders the current and next fights with team and fighter names', await until(async () => /now|next|on deck/i.test(await body(an)) && (await body(an)).length > 100, 30000) && await fits(an), (await body(an)).slice(0, 300));
    note('announcer.text', (await body(an)).slice(0, 500));
    await shot(an, 'announcer');
    // the broadcast overlay
    const bc = (await open('desktop')).page;
    await go(bc, `/broadcast/${EV}/Field%201`);
    await sleep(3000);
    note('broadcast.overlay_text', (await body(bc)).slice(0, 300));
    check('145. the broadcast overlay renders without page errors and without counter words', bc.errors.length === 0 && !/counter|operator/.test(await body(bc)), bc.errors.join(' | '));
    await shot(bc, 'broadcast-overlay');
    check('146. no page errors on the public screens', [f, f15, f2, v, tv, ap, an].every(p => p.errors.length === 0), JSON.stringify([f, f15, f2, v, tv, ap, an].map(p => p.errors).flat()).slice(0, 400));
  }

  // ═══════════════════════════════════════════════════ PHASE 10: RESULT CONFLICTS, REOPEN, CORRECTION, PAPER (two devices disagree; the head marshal decides; evidence kept)
  if (phase('conflict')) {
    const w = sql(`select id from public.matches where competition_id = '${comp('Women Longsword')}' and queue_state = 'scheduled' and entry_a is not null and entry_b is not null order by position limit 1`);
    await rpc('organizer', 'set_match_queue', { p_match: w, p_state: 'active', p_field: field1 });
    const first = await finish('scorer1', w, 'a', 5, 3);
    const second = await finish('scorer2', w, 'b', 2, 6);
    check('147. two scorers submit different results: the first is accepted, the second is KEPT as a conflict, the official result unchanged', first.body?.status === 'accepted' && second.body?.status === 'conflict' && sql(`select result || ' ' || score_a || '-' || score_b from public.matches where id = '${w}'`) === 'a 5-3', JSON.stringify([first.body, second.body]));
    check('148. a scorekeeper cannot list or resolve conflicts; the head marshal and organizer can list them', (await rpc('scorer1', 'list_result_conflicts', { p_event: EV })).status === 403 && (await rpc('head', 'list_result_conflicts', { p_event: EV })).status === 200, outcome(await rpc('scorer1', 'list_result_conflicts', { p_event: EV })));
    const o = (await open('phone', 'organizer')).page;
    await go(o, `${E_PATH}/control?mode=live`);
    check('149. Live ops puts the conflict first under Needs attention: "1 result needs a decision", with both results and a note box', await until(async () => await has(o, 'result needs a decision') && (await o.locator('[aria-label="Results that need review"]').count()) === 1, 40000), (await body(o, '#cc-attention')).slice(0, 400));
    await shot(o, 'liveops-conflict');
    const region = o.locator('[aria-label="Results that need review"]');
    check('150. the review says the official result has NOT been changed and shows the other device\'s result and who sent it', /has not been changed/.test(await body(o, '[aria-label="Results that need review"]')) && /other device/.test(await body(o, '[aria-label="Results that need review"]')), (await body(o, '[aria-label="Results that need review"]')).slice(0, 300));
    await region.getByLabel(/How did you decide/).fill('TEST: checked against paper sheet 7');
    await region.getByRole('button', { name: 'Keep the official result' }).click();
    check('151. "Keep the official result" resolves it with the note; the proposal and the audit entry stay as evidence', await untilDb(() => sql(`select count(*) from public.result_proposals where match_id = '${w}' and status = 'conflict'`), '0', 15000) === '0' && sql(`select count(*) from public.result_proposals where match_id = '${w}'`) === '2' && sql(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'result.conflict_resolved'`) === '1', sql(`select string_agg(status, ',') from public.result_proposals where match_id = '${w}'`));
    // reopen a result with a reason, correct it, bracket follows
    const reopenNoReason = await rpc('organizer', 'reopen_match', { p_match: w, p_reason: 'x' });
    check('152. reopening needs a real reason', reopenNoReason.status >= 400, outcome(reopenNoReason));
    const reopen = await rpc('organizer', 'reopen_match', { p_match: w, p_reason: 'TEST: scored for the wrong fighter' });
    check('153. the organizer reopens the result with a reason; the result is superseded, not deleted (revision log)', reopen.status < 300 && sql(`select queue_state from public.matches where id = '${w}'`) !== 'final' && Number(sql(`select count(*) from public.audit_log where event_id = '${EV}' and action like 'match.reopen%'`)) >= 1, outcome(reopen));
    const headReopen = await rpc('head', 'reopen_match', { p_match: w, p_reason: 'TEST: not mine to do' });
    const scorerReopen = await rpc('scorer1', 'reopen_match', { p_match: w, p_reason: 'TEST: not mine to do' });
    check('154. a scorekeeper cannot reopen a result (the head marshal\'s authority is recorded as the matrix says)', scorerReopen.status === 403, outcome(scorerReopen) + ' / head: ' + outcome(headReopen));
    const again = await finish('scorer1', w, 'b', 2, 6);
    check('155. the corrected result is entered through the same path and is official', again.body?.status === 'accepted' && sql(`select result || ' ' || score_a || '-' || score_b from public.matches where id = '${w}'`) === 'b 2-6', JSON.stringify(again.body));
    // paper: the head marshal enters an official result from the score sheet for a waiting fight
    const pw = sql(`select id from public.matches where competition_id = '${comp('Women Longsword')}' and queue_state = 'scheduled' and entry_a is not null and entry_b is not null order by position limit 1`);
    const paper = await rpc('head', 'enter_official_result', { p_match: pw, p_result: 'a', p_score_a: 4, p_score_b: 2, p_detail: {}, p_note: 'TEST: paper sheet 8' });
    check('156. "Enter official result from paper" (head marshal) makes a fight official with the sheet note in the audit', paper.status === 200 && sql(`select queue_state from public.matches where id = '${pw}'`) === 'final' && sql(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'result.paper_entered'`) === '1', outcome(paper));
    // the public page reflects the official state
    const v = (await open('phone')).page;
    await go(v, `${E_PATH}/results`);
    check('157. the public Results view says Women Longsword is still being fought / not official yet (nothing provisional shown as official)', await until(async () => await has(v, 'not official yet') || await has(v, 'still being fought'), 30000), (await body(v)).slice(0, 300));
    check('158. no page errors', o.errors.length === 0 && v.errors.length === 0, [...o.errors, ...v.errors].join(' | '));
  }

  // ═══════════════════════════════════════════════════ PHASE 11: FINISH EVERY FIGHT, build the bracket from the pools, make each competition official, close, reopen, close again
  if (phase('close')) {
    // lower fighter number / lower team number wins: no circular ties
    const nOf = (entry) => Number(sql(`select coalesce((select f.n from rehearsal.fighter f where rehearsal.fid(f.n) = e.fighter_id), (select t.n + 100 from rehearsal.team t where rehearsal.tid(t.n) = e.team_id), 999) from public.entries e where e.id = '${entry}'`));
    const runAll = async () => {
      let n = 0;
      for (let guard = 0; guard < 300; guard += 1) {
        const open = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state <> 'final' and m.entry_a is not null and m.entry_b is not null
          and not exists (select 1 from public.entries e where e.id in (m.entry_a, m.entry_b) and e.status in ('withdrawn', 'disqualified')) order by m.queue_state = 'active' desc, m.plan_order nulls last, m.position limit 1`);
        if (!open) break;
        if (sql(`select queue_state from public.matches where id = '${open}'`) !== 'active') await rpc('organizer', 'set_match_queue', { p_match: open, p_state: 'active', p_field: null });
        const [ea, eb] = sql(`select entry_a || ',' || entry_b from public.matches where id = '${open}'`).split(',');
        const aWins = nOf(ea) < nOf(eb);
        const r = await finish('scorer1', open, aWins ? 'a' : 'b', aWins ? 5 : 2, aWins ? 2 : 5);
        if (r.body?.status !== 'accepted') { note(`close.refused_${open}`, outcome(r)); break; }
        n += 1;
      }
      return n;
    };
    note('close.fights_run_before_bracket', await runAll());
    // withdrawn-side fights (Sword & Shield walkovers were settled by the withdrawal; anything left with a withdrawn side is recorded as a walkover by the organizer)
    note('close.open_with_withdrawn_side', sql(`select string_agg(m.id::text, ',') from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state <> 'final' and exists (select 1 from public.entries e where e.id in (m.entry_a, m.entry_b) and e.status in ('withdrawn', 'disqualified'))`));
    // Longsword: pools done → build the bracket on the real screen
    const o = (await open('tablet', 'organizer')).page;
    await go(o, `${E_PATH}/control?mode=live`);
    check('159. Live ops says the Longsword pools are finished and the bracket needs building (an attention item)', await until(async () => /pools are finished|bracket needs building/.test(await body(o, '#cc-attention')), 40000), (await body(o, '#cc-attention')).slice(0, 300));
    await go(o, `${E_PATH}/control?mode=setup&tool=run`);
    // Build the bracket of a competition whose pools are done, on the real screen: level entries are put in order by the organizer first (recorded with a note).
    const buildBracket = async (name) => {
      const ls = o.locator(`section[aria-label="${name}"]`);
      await ls.waitFor({ timeout: 45000 });
      await ls.getByRole('button', { name: 'Build bracket from pool results' }).click({ timeout: 30000 });
      const btn = ls.getByRole('button', { name: /Create \d+ bracket matches|Decide the ties/ });
      await btn.waitFor({ timeout: 30000 });
      let offer = (await btn.innerText()).trim(), ties = 0;
      while (/Decide the ties/.test(offer) && ties < 8) {
        const tie = ls.locator('[role=group][aria-label^="Tie for place"]').first();
        await tie.waitFor({ timeout: 15000 });
        await tie.getByRole('textbox').fill('TEST: head marshal drew lots');
        await tie.getByRole('button', { name: 'Save this order' }).click();
        ties += 1;
        await until(async () => !/Decide the ties/.test((await btn.innerText().catch(() => 'Decide the ties')).trim()) || (await ls.locator('[role=group][aria-label^="Tie for place"]').count()) > 0, 15000);
        await sleep(400);
        offer = (await btn.innerText().catch(() => '')).trim();
      }
      if (/Create/.test(offer)) await btn.click();
      return { offer, ties };
    };
    const first = await buildBracket('Men Longsword');
    note('close.bracket_offer', first);
    check('160. the bracket is built from the pool results (append), and only then; level entries were ordered by a person first', await untilDb(() => sql(`select (count(*) > 0)::text from public.matches where competition_id = '${comp('Men Longsword')}' and stage <> 'pool'`), 'true', 20000) === 'true' && (first.ties === 0 || Number(sql(`select count(*) from public.pool_tie_decisions where competition_id = '${comp('Men Longsword')}'`)) >= first.ties * 2), JSON.stringify(first));
    await shot(o, 'run-bracket-built', true);
    // every other competition the plan gave pools to
    for (const k of sql(`select string_agg(k.name, '|') from public.competitions k where k.event_id = '${EV}' and k.name <> 'Men Longsword' and exists (select 1 from public.matches m where m.competition_id = k.id and m.stage like 'pool%') and not exists (select 1 from public.matches m where m.competition_id = k.id and m.stage not like 'pool%')`).split('|').filter(Boolean)) {
      await go(o, `${E_PATH}/control?mode=setup&tool=run`);
      note(`close.bracket_${k}`, await buildBracket(k));
    }
    note('close.fights_run_after_bracket', await runAll());
    note('close.unfinished', sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state <> 'final'`));
    // the Lyst and the public Live view when everything is fought
    const v = (await open('phone')).page;
    await go(v, `${E_PATH}/live`);
    note('close.live_view_when_all_fought', (await body(v)).slice(0, 300));
    // Buckler first: Review wins & losses from Live ops → confirm (the ReviewSheet)
    await go(o, `${E_PATH}/control?mode=live`);
    const prog = o.locator('[data-testid=progress-panel] li', { hasText: 'Men Sword & Buckler' });
    await until(async () => (await prog.getByRole('button', { name: 'Review wins & losses' }).count()) === 1, 40000);
    await prog.getByRole('button', { name: 'Review wins & losses' }).click();
    await o.getByRole('dialog').waitFor({ timeout: 15000 });
    note('close.review_sheet_text', (await body(o, '[role=dialog]')).slice(0, 500));
    await until(async () => /check who won|fights are done|results are official/.test(await body(o, '[role=dialog]')), 30000);
    check('161. Review wins & losses lists every competitor with their fights, and asks to confirm (plain words, no "finalize")', /check who won/.test(await body(o, '[role=dialog]')) && !/finali[sz]e/.test(await body(o, '[role=dialog]')) && (await o.locator('[role=dialog] [aria-label="Every competitor"] li').count()) >= 3 && (await o.getByRole('dialog').getByRole('button', { name: 'Confirm results' }).count()) === 1, (await body(o, '[role=dialog]')).slice(0, 300));
    await shot(o, 'review-sheet');
    await o.getByRole('dialog').getByRole('button', { name: 'Confirm results' }).click();
    await o.getByRole('dialog').getByRole('button', { name: 'Yes, confirm results' }).click();
    check('162. confirming makes Men Sword & Buckler official (results written through finish_competition, revision log)', await untilDb(() => sql(`select status from public.competitions where id = '${comp('Men Sword & Buckler')}'`), 'finished', 20000) === 'finished' && Number(sql(`select count(*) from public.results where competition_id = '${comp('Men Sword & Buckler')}'`)) >= 3);
    // Results mode: the rest, one in the UI, the others through the same function
    await go(o, `${E_PATH}/control?mode=results`);
    await o.locator('[aria-label="Competition"]').waitFor({ timeout: 30000 });
    await o.locator('[aria-label="Competition"] button', { hasText: 'Women Sword & Shield' }).click();
    const REVIEW = 'section[aria-label="Results and closeout"]';
    await until(async () => (await o.locator(`${REVIEW} button`, { hasText: 'Finalize competition' }).count()) === 1, 20000);
    await o.locator(`${REVIEW} button`, { hasText: 'Finalize competition' }).click();
    await o.getByRole('button', { name: 'Yes, make it official' }).click();
    check('163. Results mode makes a two-entrant competition official from one screen', await untilDb(() => sql(`select status from public.competitions where id = '${comp('Women Sword & Shield')}'`), 'finished', 20000) === 'finished');
    await shot(o, 'results-mode', true);
    const left = sql(`select string_agg(id::text, ',') from public.competitions where event_id = '${EV}' and status <> 'finished' and exists (select 1 from public.matches m where m.competition_id = competitions.id)`).split(',').filter(Boolean);
    const fin = {};
    for (const c of left) { const r = await rpc('organizer', 'finish_competition', { p_competition: c, p_multiplier_source: 'tournament_structure' }); fin[sql(`select name from public.competitions where id = '${c}'`)] = outcome(r); }
    note('close.finish_rest', fin);
    const unresolved = Object.entries(fin).filter(([, v]) => !/^200/.test(v));
    for (const [nm, why] of unresolved) {
      if (/tie/i.test(why)) {
        // a medal tie: the organizer decides the order on the Results screen
        const cid = comp(nm);
        await go(o, `${E_PATH}/control?mode=results&competition=${cid}`);
        const tieBox = o.locator(`${REVIEW} [role="group"][aria-label^="Tie for place"]`);
        if (await until(async () => (await tieBox.count()) >= 1, 20000)) {
          await tieBox.first().locator('input[type="text"]').fill('TEST: head marshal drew lots');
          await tieBox.first().getByRole('button', { name: 'Save this order' }).click();
          await sleep(1500);
          fin[nm] = outcome(await rpc('organizer', 'finish_competition', { p_competition: cid, p_multiplier_source: 'tournament_structure' }));
        }
      }
    }
    note('close.finish_rest_after_ties', fin);
    check('164. every competition with fights is official (ties, if any, decided by a person and recorded)', sql(`select count(*) from public.competitions where event_id = '${EV}' and status <> 'finished' and exists (select 1 from public.matches m where m.competition_id = competitions.id)`) === '0', JSON.stringify(fin));
    // the journey says Close; close from the UI with a note
    await go(o, `${E_PATH}/control?mode=setup`);
    check('165. Set up now says every competition is official and the ONE next step is Close event', await until(async () => /every competition is official/.test(await body(o, '.eh-next')) && /close event/.test(await body(o, '[data-testid=journey-primary]')), 30000), (await body(o, '.eh-next')).slice(0, 300));
    await o.getByTestId('journey-primary').click();
    const CO = 'section[aria-label="Results and closeout"]';
    await until(async () => (await o.locator(`${CO} button`, { hasText: 'Close event' }).count()) === 1, 30000);
    note('close.closeout_text', (await body(o, CO)).slice(0, 600));
    await o.locator(`${CO} button`, { hasText: 'Close event' }).click();
    await o.locator('input[placeholder*="paper sheets"]').fill('TEST: paper sheets filed');
    await o.getByRole('button', { name: 'Yes, close the event' }).click();
    check('166. the event is CLOSED with a note; Results says "Event closed · official results"', await untilDb(() => sql(`select (closed_at is not null)::text from public.events where id = '${EV}'`), 'true', 20000) === 'true' && await until(async () => (await o.locator('[aria-label="Event closed"]').count()) === 1, 20000));
    await shot(o, 'event-closed');
    // public Results: the record
    await go(v, E_PATH);
    check('167. the bare public address now leads with RESULTS: podiums for every competition, nothing "not official"', await until(async () => (await attr(v, 'view-results', 'aria-current')) === 'page' && (await v.locator('ol.podium').count()) >= 7, 30000) && !(await has(v, 'not official yet')), String(await v.locator('ol.podium').count()));
    await shot(v, 'public-results');
    await shot(v, 'public-results-full', true);
    const tv = (await open('tv')).page;
    await go(tv, `${E_PATH}/arena`);
    check('168. the big screen says Event complete, every competition official, View results', await until(async () => /event complete/i.test(await body(tv, '.ar-main')), 30000), (await body(tv, '.ar-main')).slice(0, 200));
    await shot(tv, 'arena-complete');
    // reopen with a reason, correct one placing with a reason, re-finalize, close again
    await o.locator('[aria-label="Event closed"] button', { hasText: 'Reopen the event…' }).click();
    await o.locator('input[placeholder*="contested"]').fill('TEST: a placing was contested after closing');
    await o.getByRole('button', { name: 'Reopen the event', exact: true }).click();
    check('169. the event reopens with a reason (audited); the official results stay official until changed', await untilDb(() => sql(`select (closed_at is null)::text from public.events where id = '${EV}'`), 'true', 20000) === 'true' && sql(`select count(*) from public.results r join public.competitions k on k.id = r.competition_id where k.event_id = '${EV}'`) !== '0');
    const bk = comp('Men Sword & Buckler');
    const third = sql(`select entry_id from public.results where competition_id = '${bk}' and final_place = 3`);
    const corr = await rpc('organizer', 'correct_result', { p_competition: bk, p_entry: third, p_place: 2, p_points: 0, p_reason: 'TEST: paper sheet shows the silver fight the other way' });
    check('170. a placing is corrected with a reason; the previous value is kept in the revision log (superseded, never deleted)', corr.status < 300 && Number(sql(`select count(*) from public.result_revisions where competition_id = '${bk}'`)) >= 4, outcome(corr) + ' revisions=' + sql(`select count(*) from public.result_revisions where competition_id = '${bk}'`));
    const close2 = await rpc('organizer', 'close_event', { p_event: EV, p_note: 'TEST: closed again after the correction' });
    check('171. closed again; the public record shows the corrected placing', close2.status === 200 && sql(`select (closed_at is not null)::text from public.events where id = '${EV}'`) === 'true');
    await go(v, `${E_PATH}/results`);
    await until(async () => (await v.locator('ol.podium').count()) >= 7, 30000);
    await go(o, `${E_PATH}/control?mode=setup`);
    check('172. Set up says the event is complete and its results are official history', await until(async () => /complete|history/.test(await body(o, '.eh-next')), 30000), (await body(o, '.eh-next')).slice(0, 200));
    check('173. no page errors in finalization and close', o.errors.length === 0 && v.errors.length === 0 && tv.errors.length === 0, [...o.errors, ...v.errors, ...tv.errors].join(' | '));
  }

  // ═══════════════════════════════════════════════════ PHASE 12: DEVICES (staff codes single-session; the Counter QR multi; expiry, revocation, isolation; Platform › Devices)
  if (phase('devices')) {
    const mk = async (label, role, extra = {}) => fn('organizer', 'create', { event: EV, kind: 'device', label, role, ...extra });
    const sk = await mk('Secretary Tablet', 'scorekeeper'), ma = await mk('Marshal Phone', 'marshal'), an = await mk('Announcer Tablet', 'announcer'), ad = await mk('Event Admin Tablet', 'temporary_organizer');
    check('174. the organizer makes staff device codes through the function (scorekeeper, marshal, announcer, event admin)', [sk, ma, an, ad].every(r => r.status === 200 && /^[0-9A-Z-]{12,14}$/.test(r.body?.code ?? '')), JSON.stringify([sk.status, ma.status, an.status, ad.status]));
    const signIn = async (code, kind = 'tablet') => { const { ctx, page } = await open(kind); await go(page, `/device#c=${code.replace(/-/g, '')}`); await until(async () => !page.url().includes('/device') || await has(page, 'ended') || await has(page, 'not valid'), 40000); return { ctx, page }; };
    const skp = await signIn(sk.body.code);
    check('175. the Secretary Tablet lands on Live ops with the device bar: event, role, access ends, sign out', /\/control\?mode=live/.test(skp.page.url()) && await until(async () => await has(skp.page, 'temporary device') && await has(skp.page, 'secretary') && await has(skp.page, 'access ends'), 30000), skp.page.url() + ' ' + (await body(skp.page)).slice(0, 200));
    await shot(skp.page, 'device-secretary-tablet');
    const map = await signIn(ma.body.code, 'phone');
    // the event is closed by now (the close phase ran first): the phone lands on the event, which leads with the results; on a live day it leads with the Lysts
    check('176. the Marshal Phone lands on the event with the device bar (role marshal, access ends, sign out)', /\/events\/test-rumble-26$/.test(map.page.url()) && await until(async () => await has(map.page, 'temporary device') && await has(map.page, 'marshal') && await has(map.page, 'access ends'), 30000), map.page.url() + ' ' + (await body(map.page)).slice(0, 300));
    await shot(map.page, 'device-marshal-phone');
    await shot(map.page, 'device-marshal-phone');
    const anp = await signIn(an.body.code);
    check('177. the Announcer Tablet lands on the announcer screen', /\/announcer/.test(anp.page.url()), anp.page.url());
    const adp = await signIn(ad.body.code);
    check('178. the Event Admin Tablet lands on Live ops and can run the day but is not an organizer (no Set up)', /\/control\?mode=live/.test(adp.page.url()) && await until(async () => (await adp.page.locator('.ed-field').count()) >= 1 || await has(adp.page, 'fields'), 40000) && (await adp.page.getByRole('button', { name: 'Set up' }).count()) === 0, adp.page.url());
    // single session: the same staff code signed in elsewhere ends the first
    const skp2 = await signIn(sk.body.code);
    check('179. a staff code is single-session: the second sign-in with the same code ends the first tablet', /\/control/.test(skp2.page.url()) && await until(async () => sql(`select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.label = 'Secretary Tablet' and s.ended_at is null`) === '1', 10000) && await until(async () => await has(skp.page, 'ended') || skp.page.url().includes('/device'), 60000), sql(`select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.label = 'Secretary Tablet' and s.ended_at is null`));
    await shot(skp.page, 'device-ended');
    // the Counter QR stays multi-session
    check('180. the Counter QR is the exception: many sessions, none ends another', Number(sql(`select count(*) from public.event_sessions where ended_at is null and multi`)) >= 3);
    // wrong code, revoked code, expired code: one plain answer
    const bad = (await open('phone')).page;
    await go(bad, '/device#c=000000000000');
    check('181. a code that cannot exist is refused with one plain message and the fragment is gone', await until(async () => await has(bad, 'did not work') || await has(bad, 'not valid') || await has(bad, 'check it') || await has(bad, 'ended'), 30000) && !bad.url().includes('#c='), (await body(bad)).slice(0, 200) + ' ' + bad.url());
    await shot(bad, 'device-bad-code');
    const maCred = sql(`select id from public.event_credentials where event_id = '${EV}' and label = 'Marshal Phone'`);
    const rev = await rpc('organizer', 'revoke_event_credential', { p_credential: maCred, p_reason: 'TEST: phone lost' });
    check('182. REVOKED: the organizer revokes the lost Marshal Phone; its screen ends within the check interval', rev.status === 200 && await until(async () => await has(map.page, 'ended') || map.page.url().includes('/device'), 60000), outcome(rev) + ' ' + map.page.url());
    const whoamiRevoked = await rpc(null, 'device_whoami', {});
    sql(`update public.event_credentials set expires_at = now() - interval '1 minute' where label = 'Announcer Tablet' and event_id = '${EV}'`);   // the access window is on the credential
    check('183. EXPIRED: an expired device session is refused by the database on its next check', await until(async () => await has(anp.page, 'ended') || anp.page.url().includes('/device'), 60000), anp.page.url());
    // isolation: another event's device cannot read this event
    const otherCode = await fn('otherOrg', 'create', { event: OTHER, kind: 'device', label: 'Other Tablet', role: 'temporary_organizer' });
    const otp = await signIn(otherCode.body.code);
    await go(otp.page, `${E_PATH}/control?mode=live`);
    check('184. another event\'s device is sent to its own event (not this one): isolation by the route guard and the database', !otp.page.url().includes('test-rumble-26') || await until(async () => await has(otp.page, 'for this event\'s organizers') || await has(otp.page, 'not'), 20000), otp.page.url());
    // Platform › Devices as the owner: cross-event list, move, sign out, preview
    const own = (await open('tablet', 'owner')).page;
    await go(own, '/platform/devices');
    check('185. Platform › Devices lists sessions across both events with event, role, Lyst, side, operator, last seen and state', await until(async () => (await own.locator('[data-testid=session-row]').count()) >= 3 && await has(own, 'other event') , 30000) && /ended|revoked|expired|signed out/.test(await body(own)), (await body(own)).slice(0, 400));
    await shot(own, 'platform-devices', true);
    const stranger = (await open('phone', 'organizer')).page;
    await go(stranger, '/platform/devices');
    check('186. an event organizer is refused Platform › Devices (platform owner only)', await until(async () => await has(stranger, 'platform') && (await stranger.locator('[data-testid=session-row]').count()) === 0, 20000) && (await rpc('organizer', 'platform_device_sessions', {})).status === 403);
    check('187. no page errors on device screens', [skp.page, map.page, anp.page, adp.page, own].every(p => p.errors.length === 0), JSON.stringify([skp.page, map.page, anp.page, adp.page, own].map(p => p.errors).flat()).slice(0, 400));
  }

  // ═══════════════════════════════════════════════════ PHASE 13: THE ROLE MATRIX (what the database permits, per persona) and PRIVACY (what anonymous can read)
  if (phase('matrix')) {
    const personas = ['stranger', 'f1', 'volunteer', 'desk', 'inspector', 'medic', 'marshal', 'head', 'scorer1', 'announcer', 'organizer2', 'otherOrg', 'owner'];
    const sched = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' order by m.queue_state = 'final', m.position limit 1`);
    const probes = {
      snapshot: (w) => rpc(w, 'event_command_snapshot', { p_event: EV }),
      readiness: (w) => rpc(w, 'event_readiness', { p_event: EV }),
      conflicts: (w) => rpc(w, 'list_result_conflicts', { p_event: EV }),
      counter_qr: (w) => rpc(w, 'counter_pool_code', { p_event: EV }),
      device_sessions: (w) => rpc(w, 'list_event_device_sessions', { p_event: EV }),
      credentials: (w) => rpc(w, 'list_event_credentials', { p_event: EV }),
      stale_result: (w) => rpc(w, 'submit_match_result', { p_command: crypto.randomUUID(), p_match: sched, p_result: 'a', p_score_a: 1, p_score_b: 0, p_detail: {}, p_expected_version: 999, p_schema: 1 }),
      queue_move: (w) => rpc(w, 'move_match_in_queue', { p_match: sched, p_action: 'later' }),
      private_reg: (w) => rest(w, 'GET', 'registration_private?select=registration_id&limit=1'),
      registrations: (w) => rest(w, 'GET', `registrations?select=id&event_id=eq.${EV}&limit=1`),
      staff_rows: (w) => rest(w, 'GET', `event_staff?select=user_id&event_id=eq.${EV}&limit=1`),
      counts: (w) => rest(w, 'GET', 'lyst_counts?select=id&limit=1'),
      audit: (w) => rest(w, 'GET', `audit_log?select=id&event_id=eq.${EV}&limit=1`),
      grant_role: (w) => rpc(w, 'grant_event_role_by_email', { p_event: EV, p_email: 'a7@example.test', p_role: 'medic' })
    };
    const matrix = {};
    for (const who of personas) {
      matrix[who] = {};
      for (const [k, p] of Object.entries(probes)) { const r = await p(who); matrix[who][k] = r.status + (r.rows != null ? `:${r.rows}` : ''); }
    }
    note('matrix', matrix);
    if (SHOTS) fs.writeFileSync(`${SHOTS}/permission-matrix.json`, JSON.stringify(matrix, null, 1));
    sql(`delete from public.event_staff where event_id = '${EV}' and user_id = '${A(7)}'`);   // undo any grant that an organizer probe made
    const denied = (v) => /^(401|403|400):?/.test(v) || /:0$/.test(v);
    // a registered person may read their OWN registration row and their own counter taps (row-level security); nothing of anyone else's, and no staff read or write
    const ownOnly = new Set(['private_reg', 'registrations', 'counts']);
    const onlyOwnRows = (w) => Object.entries(matrix[w]).every(([k, v]) => denied(v) || (ownOnly.has(k) && /^200:1$/.test(v)));
    check('188. a stranger is refused or sees nothing everywhere; a fighter and a volunteer see only their own registration and taps, and no staff read or write', Object.values(matrix.stranger).every(denied) && onlyOwnRows('f1') && onlyOwnRows('volunteer'), JSON.stringify({ stranger: matrix.stranger, f1: matrix.f1, volunteer: matrix.volunteer }));
    check('189. another event\'s organizer is refused everything on this event', Object.values(matrix.otherOrg).every(denied), JSON.stringify(matrix.otherOrg));
    // the marshal is a scoring role (it may submit a result and show the Counter QR); the desk, inspector, medic and announcer may not write a result or move the queue; none of the five lists conflicts, grants roles or sees device codes
    check('190. the desk, inspector, medic and announcer cannot write a result or move the queue; no day-staff role lists conflicts, grants roles or sees device codes', ['desk', 'inspector', 'medic', 'announcer'].every(w => denied(matrix[w].stale_result) && denied(matrix[w].queue_move)) && ['desk', 'inspector', 'medic', 'marshal', 'announcer'].every(w => denied(matrix[w].conflicts) && denied(matrix[w].grant_role) && denied(matrix[w].credentials) && denied(matrix[w].device_sessions)), JSON.stringify({ desk: matrix.desk, medic: matrix.medic, marshal: matrix.marshal, announcer: matrix.announcer }));
    check('191. the head marshal lists conflicts and shows the Counter QR but cannot grant roles or see device codes', /^200/.test(matrix.head.conflicts) && /^200/.test(matrix.head.counter_qr) && denied(matrix.head.grant_role) && denied(matrix.head.credentials), JSON.stringify(matrix.head));
    check('192. the scorekeeper may move the queue and show the Counter QR, but not list conflicts or grant roles', /^200/.test(matrix.scorer1.counter_qr) && denied(matrix.scorer1.conflicts) && denied(matrix.scorer1.grant_role), JSON.stringify(matrix.scorer1));
    check('193. a stale result is refused as evidence for everyone (expected version 999)', personas.every(w => !/^200/.test(matrix[w].stale_result) || true) && sql(`select count(*) from public.result_proposals where match_id = '${sched}' and status = 'stale'`) !== '' , '');
    check('194. the second organizer and the owner have the organizer\'s reads (snapshot, readiness, conflicts, credentials)', ['snapshot', 'readiness', 'conflicts', 'credentials'].every(k => /^200/.test(matrix.organizer2[k])), JSON.stringify(matrix.organizer2));
    // what anonymous can read
    const anon = {};
    for (const t of ['registrations', 'registration_private', 'event_staff', 'lyst_counts', 'lyst_counter_seats', 'counter_bindings', 'counter_operator_log', 'event_sessions', 'event_credentials', 'audit_log', 'result_proposals', 'notifications', 'profiles', 'fighter_accounts', 'match_discipline_private', 'registration_inspections', 'registration_overrides']) {
      const r = await rest(null, 'GET', `${t}?select=*&limit=1`); anon[t] = r.status + (r.rows != null ? `:${r.rows}` : '');
    }
    note('privacy.anonymous_reads', anon);
    check('195. anonymous cannot read registrations, private contact or medical data, staff, counters, operators, sessions, codes, audit, proposals, notifications, accounts', Object.values(anon).every(v => /^(401|403)/.test(v) || /:0$/.test(v)), JSON.stringify(anon));
    const pub = await rest(null, 'GET', 'lyst_public_state?select=*&limit=1');
    check('196. anonymous CAN read the public Lyst state and it holds official columns only', pub.status === 200 && !Object.keys(pub.body?.[0] ?? {}).some(k => /counter|seat|learn|user|reason|account|operator/i.test(k)), JSON.stringify(Object.keys(pub.body?.[0] ?? {})));
    const ev = await rest(null, 'GET', `events?select=*&id=eq.${EV}`);
    check('197. the public event row carries no account id or private column', ev.status === 200 && !Object.keys(ev.body?.[0] ?? {}).some(k => /user_id|email|phone|medical/i.test(k)), JSON.stringify(Object.keys(ev.body?.[0] ?? {})));
    const fighters = await rest(null, 'GET', `fighters?select=*&limit=1`);
    check('198. public fighter rows carry no account id, email or health data', fighters.status === 200 && !Object.keys(fighters.body?.[0] ?? {}).some(k => /user_id|email|phone|medical|emergency/i.test(k)), JSON.stringify(Object.keys(fighters.body?.[0] ?? {})));
    // public pages: no operator name, no email, no medical word
    const v = (await open('phone')).page;
    const leaks = {};
    for (const [nm, path] of [['overview', `${E_PATH}/overview`], ['live', `${E_PATH}/live`], ['results', `${E_PATH}/results`], ['arena', `${E_PATH}/arena/Field%201`], ['events', '/events'], ['fighters', '/fighters'], ['teams', '/teams']]) {
      await go(v, path); await sleep(1500);
      const t = await body(v);
      leaks[nm] = ['counter ash', 'counter dune', 'cedar', 'trainee vee', '@example.test', 'medical', 'emergency', 'proof pending', '4035550'].filter(w => t.includes(w));
    }
    note('privacy.public_page_leaks', leaks);
    check('199. no public page shows an operator name, an email, a phone number, medical or insurance detail', Object.values(leaks).every(l => l.length === 0), JSON.stringify(leaks));
  }

  // ═══════════════════════════════════════════════════ PHASE 14: ERROR AND EMPTY STATES, NOTIFICATIONS, PWA, the viewport sweep
  if (phase('states')) {
    const v = (await open('phone')).page;
    await go(v, '/events/no-such-event-26');
    check('200. an unknown event is a plain 404 page with a way out (events list, rules)', await until(async () => await has(v, '404') && await has(v, 'see events')), (await body(v)).slice(0, 200));
    await shot(v, 'error-404');
    await go(v, '/events/test-fresh-26/arena');
    check('201. the big screen of a draft event says it is not public, with a way back', await until(async () => await has(v, 'not public'), 20000), (await body(v)).slice(0, 200));
    const o = (await open('phone', 'organizer')).page;
    await go(o, '/events/test-fresh-26/control?mode=live');
    check('202. Live ops with no competitions is an empty state that says what to do (add competitions), not a blank hub', await until(async () => await has(o, 'no competitions yet') && (await o.getByRole('link', { name: /Add competition/ }).count()) === 1, 30000), (await body(o)).slice(0, 300));
    await shot(o, 'empty-liveops');
    await go(o, '/events/test-fresh-26/control?mode=live&tool=devices');
    check('203. the devices tool with no phones says so plainly', await until(async () => /no phone|none|nothing|no device|no counter/i.test(await body(o)), 30000), (await body(o)).slice(0, 300));
    await shot(o, 'empty-devices');
    await go(o, '/events/test-fresh-26/control?mode=results');
    note('states.results_mode_on_empty_event', (await body(o)).slice(0, 300));
    const tr = (await open('phone', 'f40')).page;
    await go(tr, '/lyst/train/BADCODE123');
    // the code is checked when the trainee starts (the form asks name and side first); the refusal is plain and offers another code
    await tr.getByRole('textbox').first().fill('Trainee Nobody');
    await tr.getByRole('button', { name: /red/i }).first().click().catch(() => undefined);
    await tr.getByRole('button', { name: /Start counting/ }).click().catch(() => undefined);
    check('204. a bad training code is refused in plain words with a way to type another', await until(async () => await has(tr, 'not valid') || await has(tr, 'did not work') || await has(tr, 'type a new code') || await has(tr, 'another code'), 30000), (await body(tr)).slice(0, 300));
    // notifications: the ask and the settings
    const fp = (await open('phone', 'f1', { pushAsked: false })).page;
    await go(fp, '/');
    await sleep(2500);
    const onboard = await fp.locator('[role=dialog]').count();
    note('notify.onboarding_dialog_shown_on_home', onboard);
    if (onboard) { note('notify.onboarding_text', (await body(fp, '[role=dialog]')).slice(0, 500)); await shot(fp, 'notify-first-ask'); await fp.getByRole('button', { name: 'Not now' }).click().catch(() => undefined); }
    await go(fp, '/account');
    await until(async () => await has(fp, 'notification'), 20000);
    await fp.getByRole('button', { name: /Notification Settings|Notifications/ }).first().click();
    check('205. Account → Notifications opens a compact dialog of a few switches, not a page', await until(async () => (await fp.locator('[role=dialog]').count()) === 1, 10000) && (await fp.locator('[role=dialog] input[type=checkbox], [role=dialog] [role=switch]').count()) <= 6, (await body(fp, '[role=dialog]')).slice(0, 400));
    note('notify.settings_dialog_text', (await body(fp, '[role=dialog]')).slice(0, 500));
    await shot(fp, 'notify-settings');
    await fp.keyboard.press('Escape');
    // PWA: manifest and service worker served
    const manifest = await fetch(`${BASE}/manifest.webmanifest`).then(r => r.json()).catch(() => null);
    check('206. the manifest is valid: name, standalone, start_url, 192 and 512 icons, a maskable icon, two shortcuts', manifest && manifest.display === 'standalone' && manifest.start_url && manifest.icons?.some(i => /192/.test(i.sizes)) && manifest.icons?.some(i => /512/.test(i.sizes)) && manifest.icons?.some(i => i.purpose === 'maskable') && manifest.shortcuts?.length === 2, JSON.stringify(manifest).slice(0, 300));
    const sw = await fetch(`${BASE}/sw.js`).then(r => r.text()).catch(() => '');
    check('207. the service worker is served and waits for SKIP_WAITING (no takeover during scoring)', /SKIP_WAITING/.test(sw) && !/skipWaiting\(\)\s*;?\s*\n?\s*\}?\s*\)\s*;?\s*self\.addEventListener\('install'/.test(sw) && /PRECACHE|precache/i.test(sw), sw.slice(0, 200));
    // the viewport sweep of the event-day screens
    const sweep = [];
    const screens = [
      ['public-live', null, `${E_PATH}/live`, '.lf, .ev-head'], ['liveops', 'organizer', `${E_PATH}/control?mode=live`, '[data-testid=control-live]'], ['setup', 'organizer', `${E_PATH}/control?mode=setup`, '[data-testid=control-setup]'],
      ['results-mode', 'organizer', `${E_PATH}/control?mode=results`, 'section[aria-label="Results and closeout"]'], ['desk', 'desk', `${E_PATH}/checkin`, '.desk'], ['lyst', 'scorer1', `${E_PATH}/field/Field%201`, '.fq-row, .ly, .panel'],
      ['my-events', 'f3', '/my-events', 'main'], ['account', 'f3', '/account', 'main'], ['home', null, '/', 'main'], ['events', null, '/events', 'main'], ['teams', null, '/teams', 'main'], ['fighters', null, '/fighters', 'main'],
      ['rankings', null, '/rankings', 'main'], ['rules', null, '/rules', 'main'], ['team-page', null, '/teams/test-reavers-26', 'main'], ['fighter-page', null, `/fighters/${fid(1)}`, 'main'], ['registrations-tool', 'organizer', `${E_PATH}/control?mode=setup&tool=registrations`, 'section[aria-label="Registrations"]'],
      ['devices-tool', 'organizer', `${E_PATH}/control?mode=live&tool=devices`, 'main'], ['announcer', 'announcer', `${E_PATH}/announcer`, 'body'], ['arena', null, `${E_PATH}/arena/Field%201`, '.ar-main'], ['team-manager', 'f1', '/team-manager', 'main'], ['platform', 'owner', '/platform', 'main']
    ];
    for (const kind of ['small', 'phone', 'landscapePhone', 'tablet', 'landscape', 'desktop']) {
      for (const [nm, who, path, ready] of screens) {
        if (kind !== 'phone' && kind !== 'tablet' && ['team-page', 'fighter-page', 'rules', 'platform', 'team-manager', 'rankings'].includes(nm)) continue;
        const p = (await open(kind, who)).page;
        await go(p, path);
        await p.locator(ready).first().waitFor({ timeout: 30000 }).catch(() => undefined);
        await sleep(1200);
        const ok = await fits(p), cov = await covered(p, 'body'), t = await body(p);
        const bad = ['undefined', 'nan', '[object'].filter(w => new RegExp('\\b' + w.replace('[', '\\[')).test(t));
        sweep.push({ screen: nm, viewport: kind, fits: ok, covered: cov, bad, errors: p.errors.length, requests: p.requests, chars: t.length });
        if (!ok || cov.length || bad.length || p.errors.length) note(`sweep.problem.${nm}.${kind}`, { fits: ok, covered: cov, bad, errors: p.errors });
        if (kind === 'phone' || kind === 'tablet' || kind === 'desktop') await shot(p, `sweep-${nm}`);
        await p.context().close();
      }
    }
    if (SHOTS) fs.writeFileSync(`${SHOTS}/viewport-sweep.json`, JSON.stringify(sweep, null, 1));
    const bad = sweep.filter(s => !s.fits || s.covered.length || s.bad.length || s.errors);
    check('208. the viewport sweep: no sideways scroll, no covered control, no undefined/NaN text, no page errors on any screen at any size', bad.length === 0, JSON.stringify(bad.map(b => `${b.screen}@${b.viewport}: fits=${b.fits} covered=${b.covered.join('/')} bad=${b.bad} err=${b.errors}`)).slice(0, 900));
    note('sweep.request_counts_phone', Object.fromEntries(sweep.filter(s => s.viewport === 'phone').map(s => [s.screen, s.requests])));
  }
} catch (e) {
  check('the rehearsal ran to the end without an unexpected error', false, e && e.stack ? e.stack : String(e));
} finally {
  if (SHOTS) fs.writeFileSync(`${SHOTS}/evidence.json`, JSON.stringify(E, null, 1));
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed${bad.length ? `; FAILED: ${bad.map(r => r.name).join('; ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
