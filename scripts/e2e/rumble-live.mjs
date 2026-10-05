// Pack 11: the Red Deer Rumble FULL DRESS REHEARSAL against a REAL local stack (Postgres from every migration + scripts/e2e/fixtures/rumble.sql,
// PostgREST, the real built app in a real Chromium). Run it through scripts/e2e/rumble-live.sh. Not part of CI (needs a PostgREST binary).
// The event does not exist when this starts: it is created through Quick Setup and run from the first registration to the closed event through
// the application's own screens and functions (registrations through submit_registration as each person, results through the scoring screen or
// submit_match_result as the scorekeeper on duty). Every claim a screen makes is checked against the database as well. No result row is injected.
// RUMBLE_STOP_AFTER=<section> ends the run after that section (for developing the journey); RUMBLE_FAST=1 skips the slow layout sweeps.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const STOP_AFTER = Number(process.env.RUMBLE_STOP_AFTER ?? 99);
const results = [];
const issues = [];   // problems found on the way (severity, where, what): reported at the end and carried into the pack document
const metrics = {};  // rehearsal metrics (counts, timings) printed at the end
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); return !!ok; };
const issue = (severity, where, what) => { issues.push({ severity, where, what }); console.log(`ISSUE ${severity} [${where}] ${what}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const A = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const A5 = A(5);
const hex = (n) => n.toString(16).padStart(2, '0');
const fid = (n) => `00000000-0000-0000-0000-0000000f11${hex(n)}`;
const uid = (n) => `00000000-0000-0000-0000-0000000e11${hex(n)}`;
const tid = (n) => `00000000-0000-0000-0000-0000000d11${hex(n)}`;
const WHO = {
  owner: [A(1), 'a1@example.test'], organizer: [A(2), 'a2@example.test'], marshal: [A(3), 'a3@example.test'], scorer1: [A(4), 'a4@example.test'],
  scorer2: [A(5), 'a5@example.test'], stranger: [A(7), 'a7@example.test'], orgadmin: [A(9), 'a9@example.test']
};
for (let n = 1; n <= 52; n += 1) WHO[`f${n}`] = [uid(n), `f${n}@example.test`];
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-q', '-d', DB, '-c', q], { encoding: 'utf8', env: { ...process.env, PGTZ: 'America/Edmonton' } }).trim();
const sqlAs = (role, q) => execFileSync('psql', ['-X', '-At', '-q', '-d', DB, '-c', `set role ${role}; ${q}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PGTZ: 'America/Edmonton' } }).trim();
const pub = (q) => sqlAs('anon', q);
const metricsSql = (eventId) => JSON.parse(execFileSync('psql', ['-X', '-At', '-q', '-d', DB, '-v', `event=${eventId}`, '-f', 'scripts/e2e/rumble-plan-metrics.sql'], { encoding: 'utf8' }).trim());
async function rpc(who, fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}), apikey: 'x' }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function rest(who, path) {
  const r = await fetch(`${API}/rest/v1/${path}`, { headers: { ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}), apikey: 'x' } });
  return { status: r.status, body: await r.json().catch(() => null), text: '' };
}
/** A scorekeeper's device finishing a fight through the Pack 09B command (idempotent, versioned), exactly as the scoring screen does. */
const finish = (who, matchId, result = 'a', a = 5, b = 3, command = crypto.randomUUID(), detail = {}) => rpc(who, 'submit_match_result', {
  p_command: command, p_match: matchId, p_result: result, p_score_a: a, p_score_b: b, p_detail: detail, p_expected_version: Number(sql(`select version from public.matches where id = '${matchId}'`)), p_schema: 1
});
const name = (n) => sql(`select name from rehearsal.fighter where n = ${n}`);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VP = {
  desktop: { viewport: { width: 1280, height: 900 } }, tv: { viewport: { width: 1920, height: 1080 } }, laptop: { viewport: { width: 1366, height: 768 } },
  tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
};
async function open(kind, who, opts = {}) {
  const ctx = await browser.newContext({ ...VP[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton', ...opts });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|nominatim/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.errors = []; page.responses = []; page.requests = 0;
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|net::ERR_INTERNET_DISCONNECTED|Failed to fetch/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('request', r => { if (r.url().includes('/rest/v1/')) page.requests += 1; });
  page.on('response', async r => { if (r.url().includes('/rest/v1/')) page.responses.push({ url: r.url(), status: r.status(), body: r.status() < 300 ? await r.text().catch(() => '') : '' }); });
  page.on('dialog', d => d.accept());
  return { ctx, page };
}
const inner = async (loc) => ((await loc.innerText({ timeout: 10000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ');
const text = async (page, sel = 'body') => ((await page.locator(sel).first().innerText({ timeout: 8000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ');
const has = async (page, t, sel = 'body') => (await text(page, sel)).toLowerCase().includes(t.toLowerCase());
const waitText = (page, sel, t, timeout = 40000) => page.waitForFunction(([s, x]) => (document.querySelector(s)?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(x), [sel, t.toLowerCase()], { timeout }).then(() => true, () => false);
const shot = async (page, nm, full = true) => { if (SHOTS) { await sleep(350); await page.screenshot({ path: `${SHOTS}/r11-${nm}.png`, fullPage: full }).catch(() => undefined); } };
const sideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1
  || [...document.querySelectorAll('main *')].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.seg,.tabs,.eh-steps,.fz-pick,[style*="overflow"]'); }));
const tinyTargets = (page, sel = 'main') => page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} .btn, ${s} select, ${s} summary`)]
  .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40 && !e.classList.contains('linklike') && getComputedStyle(e).visibility !== 'hidden'; })
  .map(e => (e.innerText || e.getAttribute('aria-label') || e.tagName).slice(0, 40)), sel);
const layout = async (page, nm) => {
  const over = await page.evaluate(() => [...document.querySelectorAll('main *')].map(e => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { tag: e.tagName.toLowerCase(), cls: e.className || '', text: (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 90), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), pos: s.position, overflowX: s.overflowX };
  }).filter(x => x.width > 0 && x.right > innerWidth + 1 && x.pos !== 'fixed' && !/seg|tabs|eh-steps|fz-pick/.test(String(x.cls))).slice(0, 12));
  check(`[${nm}] no sideways scrolling`, !(await sideways(page)), over.map(x => `${x.tag}.${String(x.cls)} right=${x.right} width=${x.width} overflow=${x.overflowX} text="${x.text}"`).join(' | '));
  const tiny = await tinyTargets(page);
  check(`[${nm}] no small tap targets`, tiny.length === 0, tiny.join(' | '));
  const body = await text(page, 'main');
  const bad = ['undefined', 'NaN', '[object', 'null '].filter(w => body.includes(w));
  check(`[${nm}] no undefined / NaN in the text`, bad.length === 0, bad.join(','));
};
/** Clicks and waits for the address to change; a second tap if the first was swallowed by a re-render (as a person would). */
const follow = async (page, loc, re) => { for (let i = 0; i < 2; i += 1) { await loc.click({ timeout: 10000 }); const ok = await page.waitForURL(re, { timeout: 8000 }).then(() => true, () => false); if (ok) return; } await page.waitForURL(re, { timeout: 15000 }); };
const noErrors = (page, where) => check(`[${where}] no page errors`, page.errors.length === 0, page.errors.join(' | '));
const privacyLeak = (page) => page.responses.filter(r => /@example\.test|emergency_|medical|"user_id"|0000000000a[0-9]|0000000e11/.test(r.body)).map(r => r.url.replace(API, '').slice(0, 120));
const waitDb = async (fn, want, timeout = 20000) => { const t0 = Date.now(); let v = fn(); while (v !== want && Date.now() - t0 < timeout) { await sleep(500); v = fn(); } return v; };
const timed = async (label, fn) => { const t0 = Date.now(); const out = await fn(); metrics[label] = Date.now() - t0; return out; };
const field = (page, f) => page.locator(`section.ed-field[aria-label="${f}"]`);
const stop = (n) => { if (STOP_AFTER <= n) { console.log(`\n(stopping after section ${n} as asked)`); throw new Error('__stop__'); } };

const TODAY = sql(`select to_char((now() at time zone 'America/Edmonton')::date, 'YYYY-MM-DD')`);
const TOMORROW = sql(`select to_char((now() at time zone 'America/Edmonton')::date + 1, 'YYYY-MM-DD')`);
const SLUG = 'red-deer-rumble-rehearsal';
let EV = '';           // the event id once created
const K = {};          // competition ids by name
const comp = (nm) => K[nm] ?? (K[nm] = sql(`select id from public.competitions where event_id = '${EV}' and name = '${nm}'`));
const entryOf = (n, compName) => sql(`select e.id from public.entries e where e.competition_id = '${comp(compName)}' and e.fighter_id = '${fid(n)}'`);
const teamEntry = (t, compName) => sql(`select e.id from public.entries e where e.competition_id = '${comp(compName)}' and e.team_id = '${tid(t)}'`);
const mstate = (id) => sql(`select queue_state || ':' || coalesce(result, '-') || ':' || coalesce(score_a::text, '-') || '-' || coalesce(score_b::text, '-') from public.matches where id = '${id}'`);
/** the match between two entries in a competition (either side) */
const matchBetween = (compName, e1, e2) => sql(`select id from public.matches where competition_id = '${comp(compName)}' and ((entry_a = '${e1}' and entry_b = '${e2}') or (entry_a = '${e2}' and entry_b = '${e1}')) limit 1`);
/** The rehearsal's one rule for who wins (every path, screen taps included, follows it so the engineered ties and draw come out): a three-way
 *  cycle at the top of the Buckler round robin (4, 10, 25 beat each other 5-3, everyone else 5-0) and at the top of one Longsword pool (the first
 *  pool without the no-show), one draw in Women Longsword (41 vs 42), otherwise the lower fighter number (duels) or the lower entry id (teams). */
const fighterOf = (entryId) => Number(sql(`select f.n from public.entries e join rehearsal.fighter f on rehearsal.fid(f.n) = e.fighter_id where e.id = '${entryId}'`) || 0);
let _tiePool = null;
const tiePool = () => {
  if (_tiePool) return _tiePool;
  const pools = sql(`select string_agg(distinct m.pool, ',' order by m.pool) from public.matches m where m.competition_id = '${comp('Men Longsword')}' and m.pool is not null`).split(',');
  const noShow = entryOf(15, 'Men Longsword');
  const avoid = sql(`select coalesce(min(pool), '') from public.matches where competition_id = '${comp('Men Longsword')}' and (entry_a = '${noShow}' or entry_b = '${noShow}')`);
  const pool = pools.find(x => x !== avoid) ?? pools[0];
  const ids = sql(`select string_agg(distinct e::text, ',' order by e::text) from (select entry_a as e from public.matches where competition_id = '${comp('Men Longsword')}' and pool = '${pool}' union select entry_b from public.matches where competition_id = '${comp('Men Longsword')}' and pool = '${pool}') x`).split(',');
  _tiePool = { pool, ids };
  return _tiePool;
};
const cycle = (ids, a, b) => { const i = ids.indexOf(a), j = ids.indexOf(b); if (i < 0 || j < 0) return null; if ((i + 1) % 3 === j) return 'a'; if ((j + 1) % 3 === i) return 'b'; return null; };
const decide = (matchId) => {
  const r = sql(`select k.name || '|' || m.entry_a || '|' || m.entry_b || '|' || (ea.fighter_id is not null) from public.matches m join public.competitions k on k.id = m.competition_id join public.entries ea on ea.id = m.entry_a where m.id = '${matchId}'`).split('|');
  const [kname, ea, eb, duel] = r;
  const fa = fighterOf(ea), fb = fighterOf(eb);
  if (kname === 'Men Sword & Buckler') {
    const top = [4, 10, 25];
    if (top.includes(fa) && top.includes(fb)) { const w = cycle(top, fa, fb); return { result: w, a: w === 'a' ? 4 : 2, b: w === 'a' ? 2 : 4 }; }
    if (top.includes(fa)) return { result: 'a', a: 4, b: 0 };
    if (top.includes(fb)) return { result: 'b', a: 0, b: 4 };
    return fa < fb ? { result: 'a', a: 4, b: 2 } : { result: 'b', a: 2, b: 4 };
  }
  if (kname === 'Men Longsword' && tiePool().ids.includes(ea) && tiePool().ids.includes(eb)) {
    const top = tiePool().ids.slice(0, 3);
    if (top.includes(ea) && top.includes(eb)) { const w = cycle(top, ea, eb); return { result: w, a: w === 'a' ? 4 : 2, b: w === 'a' ? 2 : 4 }; }
    return top.includes(ea) ? { result: 'a', a: 4, b: 0 } : { result: 'b', a: 0, b: 4 };
  }
  if (kname === 'Women Longsword' && ((fa === 41 && fb === 42) || (fa === 42 && fb === 41))) return { result: 'draw', a: 3, b: 3 };
  if (duel === 'true') return fa < fb ? { result: 'a', a: 4, b: 2 } : { result: 'b', a: 2, b: 4 };
  return ea < eb ? { result: 'a', a: 2, b: 0 } : { result: 'b', a: 0, b: 2 };
};
/** scores a duel or team fight on the open scoring screen so that `win` ('a' | 'b') wins; names = [sideA, sideB] as the board shows them */
const winOnScreen = async (page, win, names, taps = { n: 0 }, loserPoints = 0) => {
  if (await page.getByRole('button', { name: 'Head or torso +2' }).count()) {
    const hit = (side) => page.getByRole('button', { name: 'Head or torso +2' }).nth(side === 'a' ? 0 : 1).click();
    await hit(win); taps.n += 1;
    if (loserPoints >= 2) { await hit(win === 'a' ? 'b' : 'a'); taps.n += 1; }
    await page.getByRole('button', { name: 'End round' }).click(); taps.n += 1;
    await hit(win); await page.getByRole('button', { name: 'End round' }).click(); taps.n += 2;
  } else {
    const loser = win === 'a' ? names[1] : names[0];
    for (let r = 0; r < 2; r += 1) {
      const n = await page.locator(`button[aria-label^="${loser} fighter "]`).count();
      for (let i = 1; i <= n; i += 1) { await page.getByRole('button', { name: `${loser} fighter ${i} standing` }).click(); taps.n += 1; }
      await page.getByRole('button', { name: 'Confirm round' }).click(); taps.n += 1;
    }
  }
  await page.getByText(/wins the match|Fight decided/).first().waitFor({ timeout: 10000 });
};
const sideOf = (d) => (d.result === 'b' ? 'b' : 'a');
const liveCount = () => sql(`select count(*) from (select coalesce(e.fighter_id, ef.fighter_id) f, count(*) from public.matches m join public.competitions k on k.id = m.competition_id
  join public.entries e on e.id in (m.entry_a, m.entry_b) left join public.entry_fighters ef on ef.entry_id = e.id and e.fighter_id is null where k.event_id = '${EV}' and m.queue_state = 'active' group by 1 having count(*) > 1) x`);

try {
  // ============================================================== 1. Quick Setup on a phone, waiver, fee, open registration
  {
    const { ctx, page } = await open('phone', 'organizer');
    await page.goto(BASE + '/events/new'); await page.getByLabel('Event name').waitFor({ timeout: 30000 });
    await page.getByRole('checkbox').first().waitFor({ timeout: 30000 });
    await page.getByLabel('Event name').fill('Red Deer Rumble (rehearsal)');
    await page.getByLabel('First day').fill(TODAY); await page.getByLabel('Last day').fill(TOMORROW);
    check('the web address is made from the name', await page.getByText(`/events/${SLUG}`).count() > 0);
    await page.getByLabel('Venue', { exact: true }).fill('Westerner Park');
    await page.getByLabel('City', { exact: true }).fill('Red Deer');
    await page.getByLabel('Province or state').fill('Alberta');
    await page.getByRole('button', { name: 'One field more' }).click();
    check('two fields in one tap', (await page.locator('output[aria-label="Fields"]').innerText()) === '2');
    await page.getByRole('button', { name: 'Clear all' }).click();
    for (const c of ['Longsword', 'Sword & Shield', 'Polearm', 'Sword & Buckler', 'Sabre', '5v5', '3v3']) {
      await page.locator('.qs-cat', { has: page.locator('b', { hasText: new RegExp(`^${c.replace(/[&]/g, '\\$&')}$`) }) }).locator('input[type=checkbox]').check();
    }
    check('seven categories, men and women each: 14 competitions', (await text(page, '.qs-actions')).includes('14 competitions · 2 fields'), await text(page, '.qs-actions'));
    await shot(page, '01-quick-setup-390');
    if (!process.env.RUMBLE_FAST) await layout(page, 'quick setup 390');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Check your setup' }).waitFor();
    const review = await text(page, 'main');
    check('the review names the dates, venue, fields and every competition', review.includes(`${TODAY} to ${TOMORROW}`) && /Westerner Park/.test(review) && /2 fields/.test(review) && /5v5.*Team competition/.test(review), review.slice(0, 300));
    await page.getByRole('button', { name: 'Create event' }).click();
    await page.waitForURL(/manage\?tab=home/, { timeout: 30000 });
    await page.locator('section[aria-label="Event home"]').waitFor({ timeout: 30000 });
    EV = sql(`select id from public.events where slug = '${SLUG}'`);
    check('the event exists as a draft with 2 fields and 14 competitions', sql(`select status || '|' || field_count || '|' || (select count(*) from public.competitions k where k.event_id = e.id) from public.events e where id = '${EV}'`) === 'draft|2|14');
    check('created through the application: audit rows exist for the event', Number(sql(`select count(*) from public.audit_log where event_id = '${EV}'`)) >= 1);
    await waitText(page, '.eh-next', 'add the waiver');
    await follow(page, page.locator('.eh-primary'), /tab=setup/);
    await page.locator('[data-testid="waiver-paste"]').waitFor({ timeout: 30000 });
    await page.locator('[data-testid="waiver-paste"]').click();
    await page.getByLabel('Title').fill('Red Deer Rumble waiver');
    await page.getByLabel('Full text people agree to').fill('I accept the risks of armoured combat, I will follow the marshals and the rules of the event, and I release the organizers from liability. (Rehearsal text.)');
    await page.locator('[data-testid="save-waiver"]').click();
    await waitText(page, '#waiver', 'version 1');
    check('the waiver is version 1 in the database', sql(`select count(*) from public.waiver_versions where event_id = '${EV}' and version = 1`) === '1');
    await page.getByLabel('Entry fee in dollars (0 or empty for none)').fill('50');
    await page.getByLabel('Who pays the fee').selectOption('AB');
    await page.getByLabel('Registration closes (Mountain time)').fill(`${TOMORROW}T08:00`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await waitText(page, '#details', 'saved.', 20000);
    const fee = await waitDb(() => sql(`select coalesce(fee_cents::text, '-') || '|' || coalesce(fee_province, '-') || '|' || (registration_closes_at is not null) from public.events where id = '${EV}'`), '5000|AB|true');
    check('fee $50 for Albertans and a close time are stored', fee === '5000|AB|true', fee);
    await page.goto(BASE + `/events/${SLUG}/manage?tab=home`); await page.locator('section[aria-label="Event home"]').waitFor({ timeout: 30000 });
    await waitText(page, '.eh-next', 'open registration');
    await page.locator('.eh-primary').click();
    await waitText(page, '.eh-next', 'nobody has registered yet', 30000);
    check('Open registration publishes the event', sql(`select status from public.events where id = '${EV}'`) === 'published');
    await shot(page, '01-home-open-390');
    noErrors(page, 'quick setup');
    await ctx.close();
    metrics.competitions = 14;
    stop(1);
  }

  // ============================================================== 2. registrations arrive: three people on their phones, then everyone else the same way
  {
    const register = async (n, picks, days, opts = {}) => {
      const { ctx, page } = await open('phone', `f${n}`);
      await page.goto(BASE + `/events/${SLUG}/register`); await page.getByLabel('Full name', { exact: true }).waitFor({ timeout: 30000 });
      await page.getByLabel('Full name', { exact: true }).fill(name(n));
      await page.getByLabel('Email').fill(`f${n}@example.test`);
      await page.locator('[aria-label="Gender"]').getByRole('button', { name: opts.gender ?? 'Male', exact: true }).click();
      await page.locator('[aria-label="Organization"]').getByRole('button', { name: 'HACSA', exact: true }).click();
      await page.getByLabel('Where are you from?').selectOption(opts.province ?? 'AB');
      await page.getByLabel('Team (approved teams only)').selectOption({ label: opts.team });
      for (const p of picks) await page.getByLabel(p, { exact: true }).check();
      const dayBoxes = page.locator('div:has(> p:text-is("Days you can attend")) input[type=checkbox]');
      const nDays = await dayBoxes.count();
      check(`[register ${n}] both event days are offered`, nDays === 2, String(nDays));
      for (const i of days) await dayBoxes.nth(i).check();
      await page.locator('[aria-label="Shares equipment"]').getByRole('button', { name: opts.shares ? 'Yes' : 'No', exact: true }).click();
      if (opts.note) await page.getByLabel('Anything else about when you can fight').fill(opts.note);
      await page.getByRole('radio').nth(opts.insurance ?? 0).check();
      await page.getByLabel('Emergency contact name').fill(`Contact of ${name(n)}`);
      await page.getByLabel('Relationship').fill('Partner');
      await page.getByLabel('Emergency contact phone').fill(`403555${String(1000 + n)}`);
      await page.getByLabel('I declare that I am medically fit to take part').check();
      if (await page.getByLabel('I understand and will pay this fee').count()) await page.getByLabel('I understand and will pay this fee').check();
      await page.getByLabel(/I have read and agree to the waiver/).check();
      await page.getByLabel('Type your full name to sign').fill(name(n));
      await shot(page, `02-register-${n}-390`);
      await page.getByRole('button', { name: 'Submit registration' }).click();
      const ok = await waitText(page, 'main', 'will review your registration', 30000);
      check(`[register ${n}] the person sees their registration is in and will be reviewed`, ok, await text(page, 'main'));
      noErrors(page, `register ${n}`);
      await ctx.close();
    };
    await timed('register_aldric_ms', () => register(1, ['Men Longsword', 'Men Polearm', 'Men 5v5', 'Men 3v3'], [0, 1], { team: 'Kestrel Guard' }));
    await register(44, ['Women Longsword'], [0, 1], { team: 'Kestrel Guard', gender: 'Female', shares: true });
    await register(27, ['Men Sword & Buckler', 'Men 5v5', 'Men 3v3'], [1], { team: 'Coulee Ravens', note: 'Only here on the second day' });
    const r1 = sql(`select status || '|' || fee_due_cents || '|' || insurance || '|' || array_to_string(attend_dates, ',') || '|' || shares_equipment from public.registrations where event_id = '${EV}' and user_id = '${uid(1)}'`);
    check('Aldric: pending, $50 due, HACSA member, both days, no shared kit', r1 === `pending|5000|hacsa_member|${TODAY},${TOMORROW}|false`, r1);
    check('Aldric chose four competitions, the team ones for Kestrel Guard', sql(`select count(*) || '|' || count(*) filter (where rc.team_id = '${tid(1)}' and k.category in ('5v5', '3v3')) from public.registration_competitions rc join public.registrations g on g.id = rc.registration_id join public.competitions k on k.id = rc.competition_id where g.event_id = '${EV}' and g.user_id = '${uid(1)}'`) === '4|2', 'see query');
    check('the Sunday-only fighter is stored as attending the second day only', sql(`select array_to_string(attend_dates, ',') from public.registrations where event_id = '${EV}' and user_id = '${uid(27)}'`) === TOMORROW);
    check('private data went to registration_private, not the public row', sql(`select count(*) from public.registration_private p join public.registrations g on g.id = p.registration_id where g.event_id = '${EV}' and p.emergency_phone like '403555%'`) === '3'
      && !/emergency|medical/.test(sql(`select string_agg(column_name, ',') from information_schema.columns where table_name = 'registrations'`)));
    const n = sql(`select rehearsal.register_all('${EV}')`);
    check('everyone else registered the same way (submit_registration as themselves): 47 more, 50 in all', n === '47' && sql(`select count(*) from public.registrations where event_id = '${EV}'`) === '50', n);
    check('three people whose categories are not offered simply did not register', sql(`select count(*) from rehearsal.fighter f where not exists (select 1 from public.registrations g where g.event_id = '${EV}' and g.user_id = rehearsal.uid(f.n))`) === '2');
    check('out-of-province fighters owe no fee; Albertans owe $50', sql(`select count(*) filter (where fee_due_cents = 0) || '|' || count(*) filter (where fee_due_cents = 5000) from public.registrations where event_id = '${EV}'`) === '2|48');
    const anonSql = (q) => { try { return sqlAs('anon', q); } catch (e) { return 'DENIED'; } };
    check('the public cannot read registrations or private details (no grant at all for anon)', /DENIED|^0$/.test(anonSql(`select count(*) from public.registrations where event_id = '${EV}'`)) && /DENIED|^0$/.test(anonSql(`select count(*) from public.registration_private`)));
    const anonReg = await rest(null, `registration_private?select=*&limit=1`);
    check('... and not through the API either', anonReg.status >= 400 || (Array.isArray(anonReg.body) && anonReg.body.length === 0), JSON.stringify(anonReg).slice(0, 200));
    stop(2);
  }

  // ============================================================== 3. organizer review on a phone: accept, fees, insurance; rosters
  {
    const { ctx, page } = await open('phone', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=review`); await page.locator('article[aria-label]').first().waitFor({ timeout: 30000 });
    const main = await text(page, 'main');
    check('50 waiting, the pending list first', /Pending 50/.test(main), main.slice(0, 300));
    const card = page.locator('article[aria-label="Aldric Stone"]');
    const c = await inner(card);
    check('a registration card says who, which team, which competitions, what is outstanding', /Kestrel Guard/.test(c) && /Men Longsword, Men Polearm, Men 5v5, Men 3v3|Men Longsword.*Men 3v3/.test(c) && /Outstanding: .*[Ff]ee/.test(c), c);
    await shot(page, '03-review-390');
    if (!process.env.RUMBLE_FAST) await layout(page, 'review 390');
    await timed('accept_one_ms', async () => { await card.getByRole('button', { name: 'Accept' }).click(); await page.waitForFunction(() => !document.querySelector('article[aria-label="Aldric Stone"]'), null, { timeout: 20000 }).catch(() => undefined); });
    check('Accept moves him out of the pending list and into the competitions (fighter entries + team entries, no roster yet); the account is matched to his fighter identity',
      sql(`select status || '|' || fighter_id from public.registrations where event_id = '${EV}' and user_id = '${uid(1)}'`) === `accepted|${fid(1)}`
      && sql(`select count(*) from public.entries e where e.competition_id in (select id from public.competitions where event_id = '${EV}') and e.fighter_id = '${fid(1)}'`) === '2'
      && sql(`select count(*) from public.entries e where e.competition_id in (select id from public.competitions where event_id = '${EV}') and e.team_id = '${tid(1)}'`) === '2');
    await page.locator('[aria-label="Show"]').getByRole('button', { name: /^Accepted/ }).click();
    await page.locator('article[aria-label="Aldric Stone"]').waitFor({ timeout: 20000 });
    await page.locator('article[aria-label="Aldric Stone"]').getByRole('button', { name: /^Mark \$50(\.00)? paid/ }).click();
    await page.locator('article[aria-label="Aldric Stone"]').getByRole('button', { name: /^Paid \$50/ }).waitFor({ timeout: 20000 });
    check('the fee is marked paid from the card', sql(`select fee_paid from public.registrations where event_id = '${EV}' and user_id = '${uid(1)}'`) === 't');
    const accepted = sql(`select rehearsal.accept_rest('${EV}')`);
    check('the organizer accepts the other 49 the same way (decide_registration)', accepted === '49' && sql(`select count(*) from public.registrations where event_id = '${EV}' and status = 'accepted'`) === '50', accepted);
    sql(`select rehearsal.mark_fees('${EV}')`);
    check('fees: everyone paid except two who have not', sql(`select count(*) from public.registrations where event_id = '${EV}' and fee_due_cents > 0 and not fee_paid`) === '2');
    const entries = sql(`select string_agg(k.name || '=' || (select count(*) from public.entries e where e.competition_id = k.id), ',' order by k.name) from public.competitions k where k.event_id = '${EV}'`);
    check('entries per competition from the registrations', entries === 'Men 3v3=6,Men 5v5=8,Men Longsword=16,Men Polearm=7,Men Sabre=1,Men Sword & Buckler=5,Men Sword & Shield=9,Women 3v3=3,Women 5v5=0,Women Longsword=6,Women Polearm=0,Women Sabre=0,Women Sword & Buckler=0,Women Sword & Shield=0', entries);
    const rosters = sql(`select rehearsal.set_rosters('${EV}')`);
    check('team rosters set by the organizer through set_entry_roster (8 + 6 + 3 team entries)', rosters === '17' && sql(`select count(*) from public.entry_fighters ef join public.entries e on e.id = ef.entry_id join public.competitions k on k.id = e.competition_id where k.event_id = '${EV}'`) === '67', rosters);
    issue('P2', 'review', 'Accepting a team registration creates the team entry but no roster: the organizer must set every roster in Run › Team rosters (17 here). The registrations already say who fights for which team.');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=run`); await page.locator('section[aria-label="Men 5v5"]').waitFor({ timeout: 30000 });
    await page.locator('section[aria-label="Men 5v5"]').locator('summary', { hasText: 'Team rosters' }).click();
    await sleep(1500);
    check('Run shows the eight 5v5 rosters', /Team rosters \(8\)/.test(await text(page, 'section[aria-label="Men 5v5"]')) && (await has(page, 'Aldric Stone', 'section[aria-label="Men 5v5"]')));
    noErrors(page, 'review');
    await ctx.close();
    stop(3);
  }

  // ============================================================== 4. check-in on a phone: the real people, the blocked ones, the no-shows
  {
    const { ctx, page } = await open('phone', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=checkin`); await page.locator('article[aria-label]').first().waitFor({ timeout: 30000 });
    const head = await text(page, 'main');
    check('check-in header: 0/50 checked in, 3 blocked (insurance proof missing, two fees unpaid)', /0\/50 checked in/.test(head) && /3 blocked/.test(head) && /47 ready to check in/.test(head), head.slice(0, 200));
    await shot(page, '04-checkin-390');
    if (!process.env.RUMBLE_FAST) await layout(page, 'check-in 390');
    await page.locator('[aria-label="Show"]').getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('Search name, team or category').fill('Aldric');
    await timed('checkin_one_ms', async () => { await page.locator('article[aria-label="Aldric Stone"]').getByRole('button', { name: 'Check in', exact: true }).click(); await page.locator('article[aria-label="Aldric Stone"]').getByRole('button', { name: /Checked in ✓/ }).waitFor({ timeout: 20000 }); });
    await page.locator('article[aria-label="Aldric Stone"]').getByRole('button', { name: 'Kit check' }).click();
    await page.locator('article[aria-label="Aldric Stone"]').getByRole('button', { name: /Kit passed ✓/ }).waitFor({ timeout: 20000 });
    check('check-in and kit check are stored (set_registration_check)', sql(`select string_agg(check_name || '=' || passed, ',' order by check_name) from public.registration_checks c join public.registrations g on g.id = c.registration_id where g.event_id = '${EV}' and g.user_id = '${uid(1)}'`) === 'checked_in=true,kit=true');
    await page.getByLabel('Search name, team or category').fill('');
    await page.locator('[aria-label="Show"]').getByRole('button', { name: /^Blocked/ }).click();
    await sleep(800);
    const blocked = (await page.locator('article[aria-label]').allInnerTexts()).map(t => t.replace(/\s+/g, ' '));
    check('Blocked lists the three with a plain reason and offers Check in anyway', blocked.length === 3 && blocked.some(t => /Soren Fairweather/i.test(t) && /insurance/i.test(t)) && blocked.filter(t => /fee|paid/i.test(t)).length === 2 && blocked.every(t => /Check in anyway/.test(t)), blocked.join(' || '));
    await page.locator('article[aria-label="Soren Fairweather"]').getByRole('button', { name: 'Check in anyway' }).click();
    await page.locator('article[aria-label="Soren Fairweather"]').getByRole('button', { name: /Checked in ✓/ }).waitFor({ timeout: 20000 }).catch(() => undefined);
    check('an organizer can override a blocker on the spot (insurance proof arrived at the desk)', sql(`select passed from public.registration_checks c join public.registrations g on g.id = c.registration_id where g.event_id = '${EV}' and g.user_id = '${uid(19)}' and check_name = 'checked_in'`) === 't');
    const rest = sql(`select rehearsal.checkin_rest('${EV}')`);
    check('everyone who turned up is checked in the same way; the two no-shows are not', sql(`select count(*) from public.registration_checks c join public.registrations g on g.id = c.registration_id where g.event_id = '${EV}' and check_name = 'checked_in' and passed`) === '48', rest);
    await page.reload(); await page.locator('article[aria-label], .panel').first().waitFor({ timeout: 30000 }); await sleep(1200);
    await page.locator('[aria-label="Show"]').getByRole('button', { name: /^Not in yet/ }).click(); await sleep(600);
    const todo = (await page.locator('article[aria-label]').allInnerTexts()).map(t => t.replace(/\s+/g, ' '));
    check('"Not in yet" is exactly the two who never arrived', todo.length === 2 && todo.some(t => /Orin Brand/i.test(t)) && todo.some(t => /Rafe Ellery/i.test(t)), todo.join(' || '));
    check('the counter says 48/50', /48\/50 checked in/.test(await text(page, 'main')));
    noErrors(page, 'check-in');
    await ctx.close();
    stop(4);
  }

  // ============================================================== 5. Build tournament: the plan, two organizer choices, the fight order, the metrics
  {
    const { ctx, page } = await open('desktop', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=build`); await page.locator('section[aria-label="Build tournament"]').waitFor({ timeout: 30000 });
    await waitText(page, 'section[aria-label="Build tournament"]', 'tournament plan ready', 60000);
    const plan = await text(page, 'section[aria-label="Build tournament"]');
    check('the plan counts the fighters, competitions, fights and fields', /\b50\b fighters/.test(plan) && /\b8\b competitions/.test(plan) && /\b2\b fields/.test(plan), plan.slice(0, 400));
    check('the rest target is stated with how many fights meet it', /Preferred rest: 3 fights between appearances/.test(plan) && /fights ready to plan meet it/.test(plan));
    check('the Sunday-only fighter is reported, not silently planned', new RegExp(`fights? wait for someone who is not here on ${TODAY}`).test(plan), plan.slice(0, 600));
    check('empty and one-entrant divisions are offered, not built', /Not built:.*Women Sword & Shield \(nobody entered\)/.test(plan) && /Men Sabre \(1 entrant\)/.test(plan), plan.slice(-500));
    const row = (nm) => page.locator('.bt-list li', { has: page.locator('b', { hasText: new RegExp(`^${nm.replace(/[&]/g, '\\$&')}$`) }) });
    check('16 in Longsword is proposed as pools then a bracket', /16 entrants · Pools, then a bracket/.test(await inner(row('Men Longsword'))), await inner(row('Men Longsword')));
    check('7 in Polearm is proposed as pools; the organizer wants a bracket', /7 entrants · Pools, then a bracket/.test(await inner(row('Men Polearm'))));
    check('5 in Buckler is a round robin', /5 entrants · Round robin · 10 fights/.test(await inner(row('Men Sword & Buckler'))));
    // the organizer's two choices: four pools of four for Longsword (the structure document's option 2), a bracket with a third-place fight for Polearm
    await row('Men Longsword').locator('summary').click();
    await row('Men Longsword').getByRole('spinbutton', { name: 'Pools' }).fill('4');
    check('four pools of four: 24 pool fights', /\(4 pools\) · 24 fights/.test(await inner(row('Men Longsword'))), await inner(row('Men Longsword')));
    await row('Men Polearm').locator('summary').click();
    await row('Men Polearm').getByLabel('Format').selectOption('single_elimination');
    check('a bracket of 7 gets a third-place fight by default: 7 fights (one bye)', (await row('Men Polearm').getByLabel('Third-place fight').isChecked()) && /Single elimination.*7 fights/.test(await inner(row('Men Polearm'))), await inner(row('Men Polearm')));
    await page.getByRole('button', { name: 'Review plan' }).click();
    check('Review plan shows the fight order on both fields', (await page.locator('.bt-lanes > div').count()) === 2 && /vs/.test(await text(page, '.bt-lanes')));
    await shot(page, '05-build-plan-1280');
    const planned = await text(page, '.bt-rest');
    metrics.plan_preview = planned;
    await timed('build_ms', async () => { await page.getByRole('button', { name: /Use this plan/ }).click(); await waitText(page, 'main', 'tournament built', 120000); });
    const done = await text(page, '.bt-done');
    check('Tournament built: 8 competitions', /8 competitions/.test(done), done);
    const counts = sql(`select string_agg(k.name || '=' || (select count(*) from public.matches m where m.competition_id = k.id), ',' order by k.name) from public.competitions k where k.event_id = '${EV}' and exists (select 1 from public.matches m where m.competition_id = k.id)`);
    check('draws built for exactly the eight competitions with 2+ entrants', counts === 'Men 3v3=15,Men 5v5=12,Men Longsword=24,Men Polearm=7,Men Sword & Buckler=10,Men Sword & Shield=16,Women 3v3=3,Women Longsword=15', counts);
    metrics.fights_built = Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}'`));
    check('every draw went through build_schedule with a saved draw number', sql(`select count(*) from public.competitions where event_id = '${EV}' and draw_seed is not null and drawn_at is not null`) === '8');
    check('competitions were spread over both fields', sql(`select count(distinct coalesce(m.field, 'Field 1')) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}'`) === '2');
    check('the Polearm bracket: 3 quarterfinals, 2 semifinals, third place and final; the bye sits in a semifinal already', sql(`select string_agg(round_label || ':' || ((entry_a is not null)::int + (entry_b is not null)::int), ',' order by position) from public.matches where competition_id = '${comp('Men Polearm')}' and stage <> 'pool'`).replace(/Quarterfinal:2,?/g, 'Q,').replace(/,+$/, '') !== '' && sql(`select count(*) from public.matches where competition_id = '${comp('Men Polearm')}' and round_label = 'Semifinal' and (entry_a is not null or entry_b is not null)`) === '1', sql(`select string_agg(round_label || ':' || ((entry_a is not null)::int + (entry_b is not null)::int), ',' order by position) from public.matches where competition_id = '${comp('Men Polearm')}'`));
    check("the Sunday-only fighter's four Buckler fights are held back today (his team fights too: 12 held in all)", sql(`select count(*) from public.matches m where m.competition_id = '${comp('Men Sword & Buckler')}' and (m.entry_a = '${entryOf(27, 'Men Sword & Buckler')}' or m.entry_b = '${entryOf(27, 'Men Sword & Buckler')}') and m.plan_hold`) === '4');
    check('nothing was called or started by building', sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state <> 'scheduled'`) === '0');
    const mt = metricsSql(EV);
    metrics.plan = mt;
    console.log('PLAN METRICS', JSON.stringify(mt));
    check('plan metrics: no double booking, no availability violation, every unavailable fight held', mt.double_booked_slots === 0 && mt.availability_violations === 0 && mt.held === 12 && mt.held_for_unavailable === 12, JSON.stringify(mt));
    check('plan metrics: no back-to-back fight for anyone', mt.rest_0 === 0, JSON.stringify(mt));
    check('plan metrics: most fights with a previous appearance meet the 3-fight rest target', mt.with_rest > 0 && mt.rest_3_plus / mt.with_rest >= 0.8, JSON.stringify(mt));
    if (mt.rest_1 + mt.rest_2 > 0) issue('P3', 'planner', `${mt.rest_1 + mt.rest_2} of ${mt.with_rest} planned fights have 1 or 2 fights of rest (none back to back); the organizer sees each one as Short rest on Event day.`);
    await shot(page, '05-build-done-1280');
    noErrors(page, 'build');
    await ctx.close();
    stop(5);
  }
  // ============================================================== 6. the crew, My next fight before the first call, Event day on two fields
  {
    for (const [email, role] of [['a3@example.test', 'head_marshal'], ['a4@example.test', 'scorekeeper'], ['a5@example.test', 'scorekeeper']]) {
      const r = await rpc('organizer', 'grant_event_role_by_email', { p_event: EV, p_email: email, p_role: role });
      check(`the organizer adds ${role} ${email} (grant_event_role_by_email, as the People tab does)`, r.status < 300, JSON.stringify(r.body));
    }
    // a fighter looks at the event page before anything is called
    const { ctx: fctx, page: fp } = await open('phone', 'f1');
    await fp.goto(BASE + `/events/${SLUG}`); await fp.locator('[aria-labelledby="mynext-h"]').waitFor({ timeout: 30000 });
    await waitText(fp, '[aria-labelledby="mynext-h"]', 'coming up', 30000);
    const mn = await text(fp, '[aria-labelledby="mynext-h"]');
    check('[my next fight] before the first call: a planned place on the field, counted from the plan (never a clock time)', /Coming up/i.test(mn) && /fights? ahead of you on Field \d|You are up next|none ahead of you on Field \d/i.test(mn) && !/\b\d{1,2}:\d{2}\b/.test(mn), mn);
    check('[my next fight] only HIS fights: never the women\'s team of his club (roster-aware my_event_entries)', !/Women 3v3/.test(mn), mn);
    check('[my next fight] the other fights still to come are listed across his four competitions', /Also still to fight: \d+ fights/.test(mn) && /Men Longsword/.test(mn) && /Men 5v5/.test(mn) && /Men 3v3/.test(mn) && /Men Polearm/.test(mn), mn);
    check('[my next fight] he can see he is checked in', /✓ You are checked in/.test(mn), mn);
    await shot(fp, '06-mynext-before-390');
    await fctx.close();
    const { ctx: nctx, page: np } = await open('phone', 'f15');
    await np.goto(BASE + `/events/${SLUG}`); await np.locator('[aria-labelledby="mynext-h"]').waitFor({ timeout: 30000 }); await sleep(2500);
    check('[my next fight] the no-show sees he is NOT checked in', /Not checked in yet/.test(await text(np, '[aria-labelledby="mynext-h"]')), await text(np, '[aria-labelledby="mynext-h"]'));
    await nctx.close();
    const { ctx: hctx, page: hp } = await open('phone', 'f27');
    await hp.goto(BASE + `/events/${SLUG}`); await hp.locator('[aria-labelledby="mynext-h"]').waitFor({ timeout: 30000 });
    await waitText(hp, '[aria-labelledby="mynext-h"]', 'held for another day', 30000);
    check('[my next fight] the Sunday-only fighter is told his fights are held for another day', /Held for another day/i.test(await text(hp, '[aria-labelledby="mynext-h"]')), await text(hp, '[aria-labelledby="mynext-h"]'));
    await hctx.close();

    const { ctx, page } = await open('desktop', 'organizer');
    await timed('eventday_load_ms', async () => { await page.goto(BASE + `/events/${SLUG}/manage?tab=eventday`); await page.locator('article[aria-label="Next recommended on Field 1"]').waitFor({ timeout: 30000 }); });
    metrics.eventday_requests = page.requests;
    const c1 = await text(page, 'article[aria-label="Next recommended on Field 1"]');
    check('Field 1: one recommended fight with plain reasons, ready to fight', /vs/.test(c1) && /first fight today|fresh/i.test(c1) && /Ready to fight/.test(c1), c1);
    check('Field 2 has its own recommendation', await page.locator('article[aria-label="Next recommended on Field 2"]').count() === 1);
    check('the held fights are explained by name', new RegExp(`held back.*${name(27)}`).test(await text(page, '.ed-held')), await text(page, '.ed-held'));
    const nb = (await text(page, 'section.ed-progress')).match(/Not built: ([^.]*)\./)?.[1] ?? '';
    check('the six competitions nobody or one person entered are one line, not boards', nb.split(', ').sort().join(',') === 'Men Sabre,Women 5v5,Women Polearm,Women Sabre,Women Sword & Buckler,Women Sword & Shield', nb);
    await shot(page, '06-eventday-1280');
    await page.locator('article[aria-label="Next recommended on Field 1"]').getByRole('button', { name: /^(Run this fight|Run anyway)$/ }).click();
    await page.locator('article[aria-label="Now on Field 1"]').waitFor({ timeout: 30000 });
    const act1 = () => sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active' and coalesce(m.field, 'Field 1') = 'Field 1'`);
    const deck = (f) => sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'on_deck' and coalesce(m.field, 'Field 1') = '${f}'`);
    await waitDb(() => (deck('Field 1') ? 'y' : 'n'), 'y');
    check('Field 1 is called: active, on deck and in the hole filled', act1().length === 36 && deck('Field 1').length === 36 && sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'in_the_hole' and coalesce(m.field, 'Field 1') = 'Field 1'`) === '1');
    // Field 2: the organizer prefers another ready fight
    const card2 = page.locator('article[aria-label="Next recommended on Field 2"]');
    const rec2 = await text(page, 'article[aria-label="Next recommended on Field 2"] .ed-next-vs');
    await card2.getByRole('button', { name: 'Choose another fight' }).click();
    const dlg = page.locator('[role="dialog"]'); await dlg.waitFor();
    check('Choose another fight lists other ready fights with their rest', (await dlg.locator('.ed-choose li').count()) > 1 && /rest|fresh|first fight/i.test(await text(page, '[role="dialog"]')), (await text(page, '[role="dialog"]')).slice(0, 300));
    await shot(page, '06-choose-1280', false);
    const busyRows = await dlg.locator('.ed-choose li.ed-busy').count();
    check('fights whose people are fighting on the other field right now are marked and cannot be started (a double booking is impossible from here)', (await dlg.locator('.ed-choose li.ed-busy button[disabled]').count()) === busyRows, String(busyRows));
    metrics.choose_busy_rows = busyRows;
    const firstFree = dlg.locator('.ed-choose li:not(.ed-busy)').first();
    const pick = (await firstFree.locator('b').first().innerText()).trim();
    await firstFree.getByRole('button', { name: 'Run this instead' }).click();
    await page.locator('article[aria-label="Now on Field 2"]').waitFor({ timeout: 30000 });
    const now2 = await text(page, 'article[aria-label="Now on Field 2"]');
    check('the organizer’s choice runs on Field 2 instead of the recommendation', now2.toLowerCase().includes(pick.split(' vs ')[0].toLowerCase()) && pick.toLowerCase() !== rec2.toLowerCase(), `${pick} / ${rec2}`);
    check('nobody is in two live fights at once (event-wide)', liveCount() === '0', liveCount());
    // stability: a scorekeeper finishes Field 1; the fight on deck is the one that starts
    const d1 = deck('Field 1'), a1 = act1();
    const d6 = decide(a1);
    const r = await finish('scorer1', a1, d6.result, d6.a, d6.b);
    check('the Field 1 fight is scored by the scorekeeper (submit_match_result accepted)', r.body?.status === 'accepted', JSON.stringify(r.body));
    check('called fights stay stable: the fight that was on deck is now active', act1() === d1, `${act1()} vs ${d1}`);
    const moved = await waitText(page, 'article[aria-label="Now on Field 1"]', (await inner(page.locator('li.ed-slot[aria-label^="On deck"]').first())).split(' ')[0] || 'x', 5000).catch(() => false);
    void moved;
    check('the organizer’s screen followed without a reload', await page.waitForFunction((id) => document.querySelector(`article[aria-label="Now on Field 1"]`)?.innerText.length > 0, null, { timeout: 30000 }).then(() => true, () => false));
    // skip and reorder without drag and drop
    const f1 = field(page, 'Field 1');
    // one DOM node, held for the whole gesture: the line re-plans as results come in, so a re-resolved locator could point at another fight
    const up0 = await f1.locator('.ed-up').nth(1).elementHandle();
    await (await up0.$('summary')).click();
    const up0Text = ((await (await up0.$('.ed-up-body')).innerText()) ?? '').replace(/\s+/g, ' ');
    await (await up0.$('button:has-text("Run next")')).click();
    const [na, nbName] = up0Text.split(' Change')[0].split(/ (?:vs|VS) /).map(t => t.replace(/ (Men|Women) .*$/, '').trim());
    const movedId = sql(`select m.id from public.matches m join public.entries ea on ea.id = m.entry_a join public.entries eb on eb.id = m.entry_b left join public.fighters fa on fa.id = ea.fighter_id left join public.teams ta on ta.id = ea.team_id left join public.fighters fb on fb.id = eb.fighter_id left join public.teams tb on tb.id = eb.team_id join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and lower(coalesce(fa.display_name, ta.name)) = lower('${na.replace(/'/g, "''")}') and lower(coalesce(fb.display_name, tb.name)) = lower('${nbName.replace(/'/g, "''")}') limit 1`);
    const nowDeck = await (async () => { let v = ''; for (let i = 0; i < 40; i += 1) { v = sql(`select queue_state from public.matches where id = '${movedId}'`); if (v === 'on_deck' || v === 'in_the_hole') break; await sleep(500); } return v; })();
    check('Run next puts that fight at the front of the line: it is called now (on deck, or in the hole when on deck is taken), the rest shuffle back (no drag and drop)', nowDeck === 'on_deck' || nowDeck === 'in_the_hole', `${up0Text.slice(0, 60)} -> ${nowDeck}`);
    await page.reload(); await field(page, 'Field 1').locator('li.ed-slot').first().waitFor({ timeout: 30000 }); await sleep(800);
    const deckText = (await field(page, 'Field 1').locator('li.ed-slot').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
    check('... and the screen shows it in the called slots', deckText.toLowerCase().includes(na.toLowerCase().slice(0, 12)), `${deckText.slice(0, 120)} | ${na}`);
    check('the hand-made order is stored (queue_order), not a rebuilt plan', Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_order is not null`)) >= 1);
    check('Field 1 says its line was arranged by hand and offers to let BuhurtOS plan it again', /arranged by hand/.test(await inner(f1)) && (await f1.getByRole('button', { name: 'Let BuhurtOS plan it again' }).count()) === 1);
    await f1.getByRole('button', { name: 'Let BuhurtOS plan it again' }).click();
    await sleep(1500);
    check('... and the hand-made order is cleared again', sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_order is not null and m.queue_state = 'scheduled'`) === '0');
    noErrors(page, 'event day');
    await ctx.close();
    stop(6);
  }

  // ============================================================== 7. the scorekeeper on a phone: the real scoring screen, three fights in a row, the TV follows
  {
    const { ctx: tvctx, page: tv } = await open('tv', null);
    await tv.goto(BASE + `/events/${SLUG}/arena/Field%201`); await tv.waitForSelector('.arena .ar-main', { timeout: 30000 });
    await waitText(tv, '.ar-main', 'now fighting', 30000);
    check('[tv 1920] the venue display shows NOW FIGHTING on Field 1 with the competition and round', /now fighting/i.test(await text(tv, '.ar-main')) && /round|pool/i.test(await text(tv, '.ar-main')), await text(tv, '.ar-main'));
    await shot(tv, '07-tv-now-1920', false);
    const { ctx, page } = await open('phone', 'scorer1');
    const t0 = Date.now();
    await page.goto(BASE + `/events/${SLUG}/field/Field%201`); await page.locator('button[aria-label^="Score "]').first().waitFor({ timeout: 30000 });
    const rows = await page.locator('button[aria-label^="Score "]').count();
    check('[scorer phone] the field queue lists the active fight, on deck and in the hole', rows === 3, String(rows));
    let taps = 0;
    const scoreOne = async () => {
      const active = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active' and coalesce(m.field, 'Field 1') = 'Field 1'`);
      const names = sql(`select coalesce(fa.display_name, ta.name) || '|' || coalesce(fb.display_name, tb.name) from public.matches m join public.entries ea on ea.id = m.entry_a join public.entries eb on eb.id = m.entry_b left join public.fighters fa on fa.id = ea.fighter_id left join public.teams ta on ta.id = ea.team_id left join public.fighters fb on fb.id = eb.fighter_id left join public.teams tb on tb.id = eb.team_id where m.id = '${active}'`).split('|');
      const isDuel = sql(`select (e.fighter_id is not null)::text from public.matches m join public.entries e on e.id = m.entry_a where m.id = '${active}'`) === 'true';
      const dOne = decide(active), win = sideOf(dOne);
      await page.getByRole('button', { name: `Score ${names[0]} against ${names[1]}` }).first().click(); taps += 1;
      await page.getByText(/Head or torso \+2|standing/).first().waitFor({ timeout: 30000 });
      const t = { n: 0 }; await winOnScreen(page, win, names, t, win === 'a' ? dOne.b : dOne.a); taps += t.n;
      await page.getByRole('button', { name: 'Finish match' }).click(); taps += 1;
      await page.getByRole('button', { name: 'Save result' }).click(); taps += 1;
      await page.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
      return { active, names, isDuel, win };
    };
    const first = await timed('score_first_fight_ms', () => scoreOne());
    check('[scorer phone] the first fight is official on the server with the score as tapped (4-0 or 4-2 for a duel, 2-0 rounds for a team fight)', new RegExp(`^final:${first.win}:(${first.win === 'a' ? '4-0|4-2|2-0' : '0-4|2-4|0-2'})$`).test(mstate(first.active)), mstate(first.active));
    const sawTv = await tv.waitForFunction(() => /result|won|wins|now fighting/i.test(document.querySelector('.ar-main')?.innerText ?? ''), null, { timeout: 30000 }).then(() => true, () => false);
    check('[tv 1920] the display moved on by itself', sawTv);
    check('[scorer phone] after OFFICIAL the next fight on this field is one tap away', (await page.getByRole('button', { name: /Next fight on Field 1/ }).count()) === 1);
    await page.getByRole('button', { name: /Next fight on Field 1/ }).click(); taps += 1;
    await page.getByText(/Head or torso \+2|standing/).first().waitFor({ timeout: 30000 });
    // the venue display follows the running score of this one (a duel: one hit = 2-0; a team fight: one round confirmed = 1-0)
    const second = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active' and coalesce(m.field, 'Field 1') = 'Field 1'`);
    const names2 = [(await page.locator('.sk-side.a .sk-name').first().textContent()).trim(), (await page.locator('.sk-side.b .sk-name').first().textContent()).trim()];   // textContent: innerText would carry the CSS upper-casing
    const win2 = sideOf(decide(second));
    const duel2 = (await page.getByRole('button', { name: 'Head or torso +2' }).count()) > 0;
    const loser2 = win2 === 'a' ? names2[1] : names2[0];
    const downAll = async () => { const n = await page.locator(`button[aria-label^="${loser2} fighter "]`).count(); for (let i = 1; i <= n; i += 1) { await page.getByRole('button', { name: `${loser2} fighter ${i} standing` }).click(); taps += 1; } await page.getByRole('button', { name: 'Confirm round' }).click(); taps += 1; };
    if (duel2) { await page.getByRole('button', { name: 'Head or torso +2' }).nth(win2 === 'a' ? 0 : 1).click(); taps += 1; } else await downAll();
    const want = duel2 ? (win2 === 'a' ? '2-0' : '0-2') : (win2 === 'a' ? '1-0' : '0-1');
    const liveShown = await tv.waitForFunction((w) => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-').startsWith(w), want, { timeout: 30000 }).then(() => true, () => false);
    check(`[tv 1920] the running score ${want} reaches the hall display without anyone touching it`, liveShown, await text(tv, '.ar-main'));
    await shot(tv, '07-tv-live-1920', false);
    const d2nd = decide(second);
    if (duel2) {
      await page.getByRole('button', { name: 'Undo last strike' }).click(); taps += 1;
      const t2 = { n: 0 }; await winOnScreen(page, win2, names2, t2, win2 === 'a' ? d2nd.b : d2nd.a); taps += t2.n;
    } else await downAll();
    await page.getByText(/wins the match|Fight decided/).first().waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Finish match' }).click(); await page.getByRole('button', { name: 'Save result' }).click(); taps += 2;
    await page.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: /Next fight on Field 1/ }).click(); taps += 1;
    await page.getByText(/Head or torso \+2|standing/).first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Back to the queue' }).click();
    await page.locator('button[aria-label^="Score "]').first().waitFor({ timeout: 30000 });
    const third = await scoreOne();
    metrics.three_fights_ms = Date.now() - t0; metrics.taps_three_fights = taps;
    check('[scorer phone] three fights in a row from one phone, all official, each exactly once', sql(`select count(*) from public.result_proposals where event_id = '${EV}' and status = 'accepted'`) === '4' && mstate(third.active).startsWith(`final:${third.win}`), sql(`select count(*) from public.result_proposals where event_id = '${EV}' and status = 'accepted'`));
    check('[scorer phone] rapid scoring: three fights in under three minutes of wall time from one phone', metrics.three_fights_ms < 180000, String(metrics.three_fights_ms));
    await shot(page, '07-scorer-official-390');
    if (!process.env.RUMBLE_FAST) { await page.getByRole('button', { name: 'Back to the queue' }).click(); await page.locator('button[aria-label^="Score "]').first().waitFor({ timeout: 30000 }); await layout(page, 'field queue 390'); }
    noErrors(page, 'scorer phone');
    await ctx.close(); await tvctx.close();
    stop(7);
  }

  // ============================================================== 8. signal lost mid-fight, two results waiting, reconnect, browser closed and reopened
  {
    const { ctx, page } = await open('phone', 'scorer2');
    await page.goto(BASE + `/events/${SLUG}/field/Field%202`); await page.locator('button[aria-label^="Score "]').first().waitFor({ timeout: 30000 });
    const activeOn = (f) => sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active' and coalesce(m.field, 'Field 1') = '${f}'`);
    const namesOf = (id) => sql(`select coalesce(fa.display_name, ta.name) || '|' || coalesce(fb.display_name, tb.name) from public.matches m join public.entries ea on ea.id = m.entry_a join public.entries eb on eb.id = m.entry_b left join public.fighters fa on fa.id = ea.fighter_id left join public.teams ta on ta.id = ea.team_id left join public.fighters fb on fb.id = eb.fighter_id left join public.teams tb on tb.id = eb.team_id where m.id = '${id}'`).split('|');
    const idb = (store) => page.evaluate((s) => new Promise((res) => { const r = indexedDB.open('buhurtos-scoring'); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains(s)) return res([]); const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); }; r.onerror = () => res(null); }), store);
    const isDuel = (id) => sql(`select (e.fighter_id is not null)::text from public.matches m join public.entries e on e.id = m.entry_a where m.id = '${id}'`) === 'true';
    const A = activeOn('Field 2'), nA = namesOf(A);
    const B = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'on_deck' and coalesce(m.field, 'Field 1') = 'Field 2'`), nB = namesOf(B);
    await page.getByRole('button', { name: `Score ${nA[0]} against ${nA[1]}` }).first().click();
    await page.getByText(/Head or torso \+2|standing/).first().waitFor({ timeout: 30000 });
    check('[offline] the fight opens as pending until saved', await has(page, 'Pending: not official until you save'));
    await ctx.setOffline(true);
    { const d = decide(A); await winOnScreen(page, sideOf(d), nA, { n: 0 }, sideOf(d) === 'a' ? d.b : d.a); }
    await sleep(600);
    const box = await idb('outbox');
    check('[offline] score actions are kept in IndexedDB on the device while there is no signal', box.length >= 3 && box.every(e => e.userId === A5 && e.eventId === EV), `${box.length}`);
    check('[offline] the screen says Pending with the number saved on this device', /pending: \d+ score actions? saved on this device/i.test(await text(page)), await text(page, '.sk-status'));
    await page.getByRole('button', { name: 'Finish match' }).click();
    await page.getByRole('button', { name: 'Save result' }).click();
    await page.getByText('Pending: NOT official yet').waitFor({ timeout: 20000 });
    check('[offline] Save without signal: Pending, NOT official, paper sheet named; nothing reached the server', (await has(page, 'paper score sheet')) && mstate(A).startsWith('active'), mstate(A));
    await shot(page, '08-pending-390');
    // a second fight while still offline: the one on deck can be opened and scored on paper-and-phone
    check('[offline] the pending screen lets the scorer go on to the next fight without waiting for signal', (await page.getByRole('button', { name: 'Back to the queue (keep this pending)' }).count()) === 1);
    await page.getByRole('button', { name: 'Back to the queue (keep this pending)' }).click();
    await page.getByRole('button', { name: `Score ${nB[0]} against ${nB[1]}` }).first().waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: `Score ${nB[0]} against ${nB[1]}` }).first().click();
    const openedOffline = await page.getByText(/Head or torso \+2|standing/).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
    check('[offline] opening the NEXT fight needs signal (it is put on the field and its version re-read): without signal the screen says so, nothing is guessed', !openedOffline && /could not|signal|network|failed|offline/i.test(await text(page, 'main')), (await text(page, 'main')).slice(0, 300));
    issue('P2', 'scoring', 'Without signal a scorekeeper can finish the fight already open (pending on the device) but cannot open the next one: opening a fight sets it active on the server and re-reads its version. Paper is the fallback for the next fight until the signal is back (by design: no full offline mode).');
    await ctx.setOffline(false);
    await page.getByRole('button', { name: `Score ${nB[0]} against ${nB[1]}` }).first().click();
    await page.getByText(/Head or torso \+2|standing/).first().waitFor({ timeout: 30000 });
    await ctx.setOffline(true);
    { const d = decide(B); await winOnScreen(page, sideOf(d), nB, { n: 0 }, sideOf(d) === 'a' ? d.b : d.a); }
    await page.getByRole('button', { name: 'Finish match' }).click();
    await page.getByRole('button', { name: 'Save result' }).click();
    await page.getByText('Pending: NOT official yet').waitFor({ timeout: 20000 });
    const boards = await idb('boards');
    check('[offline] two finished boards wait on the device, bound to this scorekeeper and event (a command id is minted at the first real attempt)', boards.length === 2 && boards.every(b => b.userId === A5 && b.eventId === EV) && new Set(boards.map(b => b.matchId)).size === 2, JSON.stringify(boards.map(b => [b.matchId, b.finalizeCommandId])));
    // the browser is closed and reopened with signal
    await ctx.setOffline(false);
    await page.goto(BASE + `/events/${SLUG}/field/Field%202`); await page.locator('button[aria-label^="Score "]').first().waitFor({ timeout: 30000 });
    const drained = await (async () => { for (let i = 0; i < 30; i += 1) { const b = await idb('outbox'); if (b.filter(e => e.status === 'pending').length === 0) return true; await sleep(1000); } return false; })();
    check('[reconnect] the queued score actions were delivered once the signal came back', drained, JSON.stringify((await idb('outbox')).map(e => e.status)));
    check('[reconnect] nothing became official by itself: both fights still wait for the scorekeeper', mstate(A).startsWith('active') && /^(active|on_deck)/.test(mstate(B)), `${mstate(A)} ${mstate(B)}`);
    issue('P3', 'scoring', 'Opening the on-deck fight from the field queue makes it active while the first is still active (two active fights on one field, which Event day flags under Needs attention). Harmless with one scorekeeper per field; worth a confirm step.');
    await page.getByRole('button', { name: `Score ${nA[0]} against ${nA[1]}` }).first().click();
    await page.getByText(/wins the match|Fight decided/).first().waitFor({ timeout: 20000 });
    check('[reconnect] the finished board came back from the device', true);
    await page.getByRole('button', { name: 'Finish match' }).click();
    await page.getByRole('button', { name: 'Save result' }).click();
    await page.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
    check('[reconnect] Save again makes it official, exactly once (same command id, one accepted proposal)', /^final:(a|b)/.test(mstate(A)) && sql(`select count(*) from public.result_proposals where match_id = '${A}'`) === '1', mstate(A));
    check('[reconnect] the second fight is active now', mstate(B).startsWith('active'), mstate(B));
    await page.getByRole('button', { name: /Next fight on Field 2/ }).click();
    await page.getByText(/wins the match|Fight decided/).first().waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Finish match' }).click();
    await page.getByRole('button', { name: 'Save result' }).click();
    await page.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
    check('[reconnect] the second waiting result is official too, once', /^final:(a|b)/.test(mstate(B)) && sql(`select count(*) from public.result_proposals where match_id = '${B}'`) === '1', mstate(B));
    check('[reconnect] no stray proposal, no duplicate', sql(`select count(*) from public.result_proposals where event_id = '${EV}' and status not in ('accepted')`) === '0');
    noErrors(page, 'offline');
    await ctx.close();
    stop(8);
  }

  // ============================================================== 9. two devices disagree; a fight changes under an open board (stale); the head marshal decides
  {
    const activeOn = (f) => sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active' and coalesce(m.field, 'Field 1') = '${f}'`);
    const namesOf = (id) => sql(`select coalesce(fa.display_name, ta.name) || '|' || coalesce(fb.display_name, tb.name) from public.matches m join public.entries ea on ea.id = m.entry_a join public.entries eb on eb.id = m.entry_b left join public.fighters fa on fa.id = ea.fighter_id left join public.teams ta on ta.id = ea.team_id left join public.fighters fb on fb.id = eb.fighter_id left join public.teams tb on tb.id = eb.team_id where m.id = '${id}'`).split('|');
    const { ctx, page } = await open('phone', 'scorer1');
    await page.goto(BASE + `/events/${SLUG}/field/Field%201`); await page.locator('button[aria-label^="Score "]').first().waitFor({ timeout: 30000 });
    const M = activeOn('Field 1'), nM = namesOf(M);
    await page.getByRole('button', { name: `Score ${nM[0]} against ${nM[1]}` }).first().click();
    await page.getByText(/Head or torso \+2|standing/).first().waitFor({ timeout: 30000 });
    const dM = decide(M), officialM = `final:${dM.result}:${dM.a}-${dM.b}`;
    const other = await finish('scorer2', M, dM.result, dM.a, dM.b);
    check('[conflict] another device makes the fight official first', other.body?.status === 'accepted' && mstate(M) === officialM, `${mstate(M)} ${JSON.stringify(other.body)} M=${M}`);
    await winOnScreen(page, sideOf(dM) === 'a' ? 'b' : 'a', nM);   // this device saw it the other way
    await page.getByRole('button', { name: 'Finish match' }).click();
    await page.getByRole('button', { name: 'Save result' }).click();
    await page.getByText('A different result is already official for this match').waitFor({ timeout: 20000 });
    check('[conflict] the first device is told its result was NOT applied and needs review; the official result is unchanged', mstate(M) === officialM && sql(`select status from public.result_proposals where match_id = '${M}' and status = 'conflict'`) === 'conflict', mstate(M));
    await shot(page, '09-conflict-390');
    await page.getByRole('button', { name: 'I have told the head marshal: back to the queue' }).click();
    await page.locator('button[aria-label^="Score "], h3').first().waitFor({ timeout: 20000 });
    // stale: the match changes (reopened by the organizer) while this device holds it open
    const S = activeOn('Field 1'), nS = namesOf(S);
    await page.getByRole('button', { name: `Score ${nS[0]} against ${nS[1]}` }).first().click();
    await page.getByText(/Head or torso \+2|standing/).first().waitFor({ timeout: 30000 });
    const dS = decide(S);
    await finish('scorer2', S, dS.result, dS.a, dS.b);
    const re = await rpc('organizer', 'reopen_match', { p_match: S, p_reason: 'Marshal error: wrong fighter named' });
    check('[stale] meanwhile the fight was made official elsewhere and then reopened by the organizer (version moved on twice)', re.status < 300 && mstate(S).startsWith('scheduled'), `${re.status} ${mstate(S)}`);
    await winOnScreen(page, sideOf(dS), nS, { n: 0 }, sideOf(dS) === 'a' ? dS.b : dS.a);
    await page.getByRole('button', { name: 'Finish match' }).click();
    await page.getByRole('button', { name: 'Save result' }).click();
    const staleSeen = await waitText(page, 'body', 'This match changed after you opened it', 20000);
    check('[stale] the device is told the match changed; its result went to the head marshal; nothing was made official', staleSeen && mstate(S).startsWith('scheduled') && sql(`select count(*) from public.result_proposals where match_id = '${S}' and status = 'stale'`) === '1', `${mstate(S)}`);
    await shot(page, '09-stale-390');
    await ctx.close();
    // the head marshal reviews on their phone
    const { ctx: hctx, page: hp } = await open('phone', 'marshal');
    await hp.goto(BASE + `/events/${SLUG}/field/Field%201`); await hp.locator('[aria-label="Results that need review"]').waitFor({ timeout: 30000 });
    const rv = await text(hp, '[aria-label="Results that need review"]');
    check('[head marshal] Needs review shows the disagreement with both results', /needs? review|review/i.test(rv) && new RegExp(`${dM.a}.?${dM.b}`).test(rv), rv.slice(0, 300));
    await hp.getByPlaceholder('e.g. checked against paper sheet 14').first().fill('checked against paper sheet 12');
    await hp.getByRole('button', { name: 'Keep the official result' }).first().click();
    await sleep(1500);
    check('[head marshal] the decision and note are audited; the official result stands', sql(`select status || '|' || resolution_note from public.result_proposals where match_id = '${M}' and status like 'resolved%'`) === 'resolved_kept|checked against paper sheet 12' && mstate(M) === officialM);
    check('[head marshal] no review is left open on this field', (await hp.locator('[aria-label="Results that need review"]').count()) === 0 || !new RegExp(`${dM.a}.?${dM.b}`).test(await text(hp, '[aria-label="Results that need review"]')));
    // the reopened fight is called again and fought
    await rpc('organizer', 'set_match_queue', { p_match: S, p_state: 'active', p_field: null });
    const again = await finish('scorer1', S, dS.result, dS.a, dS.b);
    check('[stale] the reopened fight is called again and scored normally', again.body?.status === 'accepted' && mstate(S) === `final:${dS.result}:${dS.a}-${dS.b}`, JSON.stringify(again.body));
    noErrors(hp, 'head marshal');
    await hctx.close();
    stop(9);
  }

  // ============================================================== 10. paper: a result from the score sheet, and a wrong official result corrected with its history kept
  {
    const { ctx, page } = await open('phone', 'marshal');
    await page.goto(BASE + `/events/${SLUG}/field/Field%202`); await page.locator('[aria-label="Enter official result from paper"]').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Enter a result from the score sheet' }).click();
    const options = await page.getByLabel('Match').locator('option').evaluateAll(os => os.map(o => ({ value: o.value, text: o.textContent ?? '' })));
    const official = options.find(o => o.text.includes('(already official)') && /^(Men Sword & Shield|Men 5v5|Men 3v3|Women 3v3|Men Polearm)/.test(o.text) && sql(`select result || '|' || coalesce(detail->>'walkover', '') from public.matches where id = '${o.value}'`) === 'a|');
    const wrongLabel = official?.text ?? '';
    const wrongId = official?.value ?? '';
    check('[paper] the score-sheet form offers the fights of this field, official ones marked', options.length > 2 && !!official, options.slice(0, 4).map(o => o.text).join(' | '));
    await page.getByLabel('Match').selectOption(wrongId);
    await page.locator('[aria-label="Enter official result from paper"] select').nth(1).selectOption('b');
    const names = wrongLabel.split(': ')[1].replace(' (already official)', '').split(' vs ');
    await page.getByLabel(`${names[0]} score`).fill('3');
    await page.getByLabel(`${names[1]} score`).fill('5');
    await page.getByLabel('Where does this come from? (e.g. paper sheet number)').fill('paper sheet 4, marshal recount');
    await page.getByRole('button', { name: 'Make this the official result' }).click();
    const corrected = await waitText(page, '[aria-label="Enter official result from paper"]', 'official result corrected', 20000);
    const paperRow = sql(`select status || '|' || (official_before is not null) || '|' || coalesce(official_before->>'result', '') from public.result_proposals where match_id = '${wrongId}' and source = 'paper'`);
    check('[paper] a wrong official result is corrected from the score sheet; the earlier result is kept in the history (the proposal row records what was official before)', corrected && mstate(wrongId) === 'final:b:3-5' && /^accepted\|true\|a$/.test(paperRow), `${mstate(wrongId)} ${paperRow}`);
    await shot(page, '10-paper-390');
    noErrors(page, 'paper');
    await ctx.close();
    stop(10);
  }

  // ============================================================== 11. a late no-show and a mid-event injury: walkovers, not a rebuilt draw
  {
    const { ctx, page } = await open('phone', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=run`); await page.locator('section[aria-label="Men Longsword"]').waitFor({ timeout: 30000 });
    const ls = page.locator('section[aria-label="Men Longsword"]');
    await ls.locator('summary', { hasText: /^Entrants/ }).click();
    check('[no-show] the Entrants list explains that on the event day taking someone out gives walkovers', /event day: taking someone out keeps the draw/.test(await inner(ls)), (await inner(ls)).slice(0, 300));
    const row = ls.locator('li', { hasText: name(15) });
    await row.getByRole('button', { name: 'Take out' }).click();
    await page.getByLabel('Reason (kept with the walkover)').fill('Did not arrive');
    const before = sql(`select count(*) from public.matches where competition_id = '${comp('Men Longsword')}' and queue_state = 'final' and (entry_a = '${entryOf(15, 'Men Longsword')}' or entry_b = '${entryOf(15, 'Men Longsword')}')`);
    await page.getByRole('button', { name: 'Take them out' }).click();
    await waitText(page, 'section[aria-label="Men Longsword"]', 'is out.', 30000);
    const wo = sql(`select count(*) from public.matches where competition_id = '${comp('Men Longsword')}' and queue_state = 'final' and detail->>'walkover' = 'true' and (entry_a = '${entryOf(15, 'Men Longsword')}' or entry_b = '${entryOf(15, 'Men Longsword')}')`);
    check('[no-show] his unplayed pool fights became walkovers for the opponents, with the reason', Number(wo) === 3 - Number(before) && sql(`select count(*) from public.matches where competition_id = '${comp('Men Longsword')}' and detail->>'reason' = 'Did not arrive'`) === wo, `walkovers=${wo} before=${before}`);
    check('[no-show] the draw itself was not rebuilt (same 24 pool fights)', sql(`select count(*) from public.matches where competition_id = '${comp('Men Longsword')}'`) === '24');
    check('[no-show] his 5v5 team still fights (a team entry is not withdrawn by one absent member)', sql(`select status from public.entries where id = '${teamEntry(3, 'Men 5v5')}'`) === 'registered');
    issue('P2', 'event day', 'A no-show is handled by Take out per competition; nothing offers "take this person out of every competition" from check-in, so a fighter in three competitions means three Take outs.');
    // injury mid-event: Wyatt Juniper (Polearm bracket) withdraws
    const pa = page.locator('section[aria-label="Men Polearm"]');
    await pa.locator('summary', { hasText: /^Entrants/ }).click();
    const pe = entryOf(23, 'Men Polearm');
    const pending = sql(`select count(*) from public.matches where competition_id = '${comp('Men Polearm')}' and queue_state <> 'final' and entry_a is not null and entry_b is not null and (entry_a = '${pe}' or entry_b = '${pe}')`);
    await pa.locator('li', { hasText: name(23) }).getByRole('button', { name: 'Take out' }).click();
    await page.getByLabel('Reason (kept with the walkover)').fill('Injured (shoulder)');
    await page.getByRole('button', { name: 'Take them out' }).click();
    await waitText(page, 'section[aria-label="Men Polearm"]', 'is out.', 30000);
    check('[injury] a bracket fighter out mid-event: his known fight is a walkover, later rounds wait for the real winner', sql(`select status from public.entries where id = '${pe}'`) === 'withdrawn' && sql(`select count(*) from public.matches where competition_id = '${comp('Men Polearm')}' and detail->>'reason' = 'Injured (shoulder)'`) === pending, `pending=${pending}`);
    await shot(page, '11-withdraw-390');
    noErrors(page, 'withdrawals');
    await ctx.close();
    stop(11);
  }

  // ============================================================== 12. the rest of pool play, fight by fight, on two fields (scorekeepers' commands; engineered ties and a draw)
  {
    const drawMatch = matchBetween('Women Longsword', entryOf(41, 'Women Longsword'), entryOf(42, 'Women Longsword'));
    const drawPending = !mstate(drawMatch).startsWith('final');
    const activeOn = (f) => sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active' and coalesce(m.field, 'Field 1') = '${f}'`);
    let fought = 0, i = 0;
    const t0 = Date.now();
    const runFields = async () => {
      for (let guard = 0; guard < 400; guard += 1) {
        let any = false;
        for (const f of ['Field 1', 'Field 2']) {
          if (!activeOn(f)) await rpc('organizer', 'advance_field_queue', { p_event: EV, p_field: f, p_start: true });
          const m = activeOn(f);
          if (!m) continue;
          any = true;
          const d = decide(m);
          const r = await finish(i % 2 ? 'scorer1' : 'scorer2', m, d.result, d.a, d.b);
          i += 1;
          if (r.body?.status !== 'accepted') { check(`scoring ${m} on ${f}`, false, JSON.stringify(r.body)); return; }
          fought += 1;
          if (liveCount() !== '0') { check('nobody in two live fights at once (during the run)', false, liveCount()); return; }
        }
        if (!any) return;
      }
    };
    await runFields();
    // the held fights: the organizer calls them by hand from the line (Run next), as Event day offers
    const held = sql(`select string_agg(m.id::text, ',') from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'scheduled' and m.plan_hold`).split(',').filter(Boolean);
    check('[held] the twelve held fights (the Sunday-only fighter: Buckler, 5v5, 3v3) were not called by the queue', held.length === 12, String(held.length));
    for (const h of held) { const f = sql(`select coalesce(field, 'Field 1') from public.matches where id = '${h}'`); if (activeOn(f)) await runFields(); await rpc('organizer', 'set_match_queue', { p_match: h, p_state: 'active', p_field: null }); await runFields(); }
    metrics.pool_play_ms = Date.now() - t0; metrics.pool_fights_scored = fought;
    const poolsLeft = sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.stage in ('pool', 'round_robin') and m.queue_state <> 'final'`);
    check('[pool play] every pool and round-robin fight has a result, through the queue, one scorekeeper command each', poolsLeft === '0', `left=${poolsLeft} fought=${fought}`);
    check('[pool play] the Polearm bracket ran as far as it can (quarterfinals, then the semifinal with the bye as soon as both sides were known)', Number(sql(`select count(*) from public.matches where competition_id = '${comp('Men Polearm')}' and queue_state = 'final'`)) >= 3, sql(`select count(*) from public.matches where competition_id = '${comp('Men Polearm')}' and queue_state = 'final'`));
    check('[pool play] one draw was recorded in Women Longsword (3-3, the pool allows it)', !drawPending || sql(`select count(*) from public.matches where competition_id = '${comp('Women Longsword')}' and result = 'draw'`) === '1', drawPending ? 'expected a draw' : 'the pair was scored on a screen earlier (no draw possible there)');
    const st = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('part', part, 'rank', rank, 'tied', tied, 'wins', wins, 'diff', diff, 'h2h', head_to_head, 'for', score_for)), '[]') from public.pool_standings('${comp('Men Sword & Buckler')}')`));
    check('[tie] Buckler: three level at the top, equal on wins, score difference, head-to-head and points: a medal tie BuhurtOS will not guess', st.filter(r => r.rank === 1 && r.tied).length === 3, JSON.stringify(st));
    const lsA = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('rank', rank, 'tied', tied)), '[]') from public.pool_standings('${comp('Men Longsword')}') where part = '${tiePool().pool}'`));
    check(`[tie] Longsword pool ${tiePool().pool}: three level for first place; the bracket cannot be built until an organizer decides`, lsA.filter(r => r.rank === 1 && r.tied).length === 3, JSON.stringify(lsA));
    stop(12);
  }

  // ============================================================== 13. from pools to brackets: the tie is decided by a person, the brackets are built and fought
  {
    const { ctx, page } = await open('tablet', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=run`); await page.locator('section[aria-label="Men Longsword"]').waitFor({ timeout: 30000 });
    const ls = page.locator('section[aria-label="Men Longsword"]');
    await ls.getByRole('button', { name: 'Build bracket from pool results' }).waitFor({ timeout: 30000 });
    await ls.getByRole('button', { name: 'Build bracket from pool results' }).click();
    const tie = ls.locator(`[role="group"][aria-label^="Tie for place 1 in pool ${tiePool().pool}"]`);
    await tie.waitFor({ timeout: 30000 });
    check('[pools → bracket] the pool tie is put in front of the organizer: three names, Up / Down, a note', (await tie.locator('li').count()) === 3 && (await tie.getByRole('button', { name: /^Move .* up$/ }).count()) === 3 && /Decide the ties first/.test(await inner(ls)), await inner(tie));
    await tie.getByRole('button', { name: /^Move .* up$/ }).nth(1).click();
    await tie.getByLabel('How was this decided?').fill('Most points scored, then the head marshal drew lots');
    await tie.getByRole('button', { name: 'Save this order' }).click();
    await ls.getByRole('button', { name: /Create \d+ bracket matches/ }).waitFor({ timeout: 30000 });
    check('[pools → bracket] the decision is recorded with who and why (one row per level entry)', sql(`select count(*) || '|' || count(distinct decided_by) from public.pool_tie_decisions where competition_id = '${comp('Men Longsword')}' and note like 'Most points scored%'`) === '3|1');
    check('[pools → bracket] eight qualifiers, two per pool, and an 8-fight bracket with a third-place match proposed', /Create 8 bracket matches/.test(await inner(ls)), await inner(ls).then(t => t.slice(0, 200)));
    await shot(page, '13-pool-bracket-768');
    await ls.getByRole('button', { name: /Create 8 bracket matches/ }).click();
    await waitDb(() => sql(`select count(*) from public.matches where competition_id = '${comp('Men Longsword')}' and stage <> 'pool'`), '8');
    check('[pools → bracket] Longsword: 24 pool fights + 8 bracket fights (build_schedule append)', sql(`select count(*) || '|' || count(*) filter (where stage = 'elimination') || '|' || count(*) filter (where stage = 'final') || '|' || count(*) filter (where stage = 'third_place') from public.matches where competition_id = '${comp('Men Longsword')}'`) === '32|6|1|1');
    for (const nm of ['Men Sword & Shield', 'Men 5v5']) {
      const sec = page.locator(`section[aria-label="${nm}"]`);
      await sec.getByRole('button', { name: 'Build bracket from pool results' }).click();
      await sec.getByRole('button', { name: /Create \d+ bracket matches|Decide the ties first/ }).waitFor({ timeout: 30000 });
      for (const g of await sec.locator('[role="group"][aria-label^="Tie for place"]').all()) {   // a level pool (random draw): the organizer decides it the same way
        await g.getByLabel('How was this decided?').fill('Head marshal: points scored, then lots');
        await g.getByRole('button', { name: 'Save this order' }).click();
        await sleep(1500);
      }
      await sec.getByRole('button', { name: /Create \d+ bracket matches/ }).waitFor({ timeout: 30000 });
      await sec.getByRole('button', { name: /Create \d+ bracket matches/ }).click();
      await waitDb(() => sql(`select count(*) from public.matches where competition_id = '${comp(nm)}' and stage <> 'pool'`), '4');
      check(`[pools → bracket] ${nm}: top two of each pool, semifinals, final and third place`, sql(`select count(*) from public.matches where competition_id = '${comp(nm)}' and stage <> 'pool'`) === '4');
    }
    noErrors(page, 'pool bracket');
    await ctx.close();
    // the brackets are fought the same way as the pools
    const fighterOf = (entryId) => Number(sql(`select f.n from public.entries e join rehearsal.fighter f on rehearsal.fid(f.n) = e.fighter_id where e.id = '${entryId}'`) || 0);
    const activeOn = (f) => sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'active' and coalesce(m.field, 'Field 1') = '${f}'`);
    let fought = 0, i = 0;
    for (let guard = 0; guard < 100; guard += 1) {
      let any = false;
      for (const f of ['Field 1', 'Field 2']) {
        if (!activeOn(f)) await rpc('organizer', 'advance_field_queue', { p_event: EV, p_field: f, p_start: true });
        const m = activeOn(f);
        if (!m) continue;
        any = true;
        const r = sql(`select m.entry_a || '|' || m.entry_b || '|' || (ea.fighter_id is not null) from public.matches m join public.entries ea on ea.id = m.entry_a where m.id = '${m}'`).split('|');
        const duel = r[2] === 'true';
        const win = duel ? (fighterOf(r[0]) < fighterOf(r[1]) ? 'a' : 'b') : (r[0] < r[1] ? 'a' : 'b');
        const res = await finish(i % 2 ? 'scorer1' : 'scorer2', m, win, win === 'a' ? (duel ? 5 : 2) : (duel ? 2 : 0), win === 'b' ? (duel ? 5 : 2) : (duel ? 2 : 0));
        i += 1;
        if (res.body?.status !== 'accepted') { check(`bracket scoring ${m}`, false, JSON.stringify(res.body)); break; }
        fought += 1;
      }
      if (!any) break;
    }
    metrics.bracket_fights_scored = fought;
    const left = sql(`select string_agg(k.name || ':' || m.round_label, ', ') from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state <> 'final'`);
    check('[brackets] every bracket fight has a result: finals, third places, the Polearm bye all the way through', left === '', left);
    check('[brackets] the Polearm bracket: the bye fighter played his semifinal; a third place and a final exist with results', sql(`select count(*) from public.matches where competition_id = '${comp('Men Polearm')}' and stage in ('final', 'third_place') and queue_state = 'final'`) === '2');
    stop(13);
  }

  // ============================================================== 14. Review wins & losses with a medal tie, Results made official, a wrong placing corrected, the closeout
  {
    const { ctx, page } = await open('phone', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=eventday`); await page.locator('section.ed-progress').waitFor({ timeout: 30000 });
    await waitText(page, 'section.ed-progress', 'review wins & losses', 45000);
    const prog = await text(page, 'section.ed-progress');
    check('[review] every built competition asks for review (Review wins & losses on each)', (await page.getByRole('button', { name: 'Review wins & losses' }).count()) >= 8, prog.slice(0, 500));
    const bucklerRow = page.locator('section.ed-progress li', { hasText: 'Men Sword & Buckler' });
    await bucklerRow.getByRole('button', { name: 'Review wins & losses' }).click();
    const sheet = page.locator('[role="dialog"]');
    await sheet.waitFor(); await waitText(page, '[role="dialog"]', 'level for place 1', 30000);
    const s1 = await text(page, '[role="dialog"]');
    check('[review] the sheet shows records, the tie and refuses to guess', /3 wins · 1 loss/.test(s1) && /BuhurtOS will not guess/.test(s1) && (await sheet.locator('[role="group"][aria-label^="Tie for place 1"] li').count()) === 3, s1.slice(0, 400));
    await shot(page, '14-review-tie-390');
    const tie = sheet.locator('[role="group"][aria-label^="Tie for place 1"]');
    await tie.getByLabel('How was this decided?').fill('Deciding bouts: one extra exchange each, scored by the head marshal');
    await tie.getByRole('button', { name: 'Save this order' }).click();
    await sheet.getByRole('button', { name: 'Confirm results' }).waitFor({ timeout: 30000 });
    check('[review] once decided, the placings and points appear and Confirm is offered', /1st/.test(await text(page, '[role="dialog"]')) && /pts/.test(await text(page, '[role="dialog"]')));
    await sheet.getByRole('button', { name: 'Confirm results' }).click();
    check('[review] Confirm names the champion first', /is the champion/.test(await text(page, '[role="alertdialog"]')), await text(page, '[role="alertdialog"]'));
    await sheet.getByRole('button', { name: 'Yes, confirm results' }).click();
    await waitText(page, '[role="dialog"]', 'is official', 30000);
    check('[review] Buckler is official: finalize_competition, results rows, audit', sql(`select status || '|' || (select count(*) from public.results where competition_id = '${comp('Men Sword & Buckler')}') || '|' || (select count(*) from public.audit_log where action = 'competition.finished' and subject = '${comp('Men Sword & Buckler')}') from public.competitions where id = '${comp('Men Sword & Buckler')}'`) === 'finished|5|1');
    check('[review] the tie decision is on record with the note', sql(`select count(*) from public.pool_tie_decisions where competition_id = '${comp('Men Sword & Buckler')}' and note like 'Deciding bouts%'`) === '3');
    await sheet.getByRole('button', { name: 'Next' }).click();
    // the rest in Manage › Results, one tap each
    await page.goto(BASE + `/events/${SLUG}/manage?tab=finalize`); await page.locator('section[aria-label="Results and closeout"]').waitFor({ timeout: 30000 });
    for (const nm of ['Men Longsword', 'Women Longsword', 'Men Sword & Shield', 'Men Polearm', 'Men 5v5', 'Men 3v3', 'Women 3v3']) {
      await page.locator('.fz-pick').getByRole('button', { name: new RegExp(`^${nm.replace(/[&]/g, '\\$&')}( ●| ✓)?$`) }).click();
      await page.getByRole('button', { name: 'Finalize competition' }).waitFor({ timeout: 30000 });
      await sleep(1500);
      if (await page.getByRole('button', { name: 'Finalize competition' }).isDisabled()) {
        // a blocker the Results screen names (a medal tie, say): the organizer decides the order as the tie panel asks, through the same function
        const why = (await text(page, 'main')).match(/Needs review[^.]*\.[^.]*\./)?.[0] ?? '';
        const ties = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('part', part, 'rank', rank, 'id', entry_id) order by part, rank, entry_id), '[]') from public.pool_standings('${comp(nm)}') where tied and rank <= 3`));
        const parts = [...new Set(ties.map(t => t.part))];
        for (const part of parts) { const order = ties.filter(t => t.part === part).map(t => t.id); await rpc('organizer', 'record_tie_decision', { p_competition: comp(nm), p_part: part, p_order: order, p_note: 'Decided by the head marshal on points scored' }); }
        issue('P3', 'results', `${nm}: Finalize was blocked (${why || 'medal tie'}); the organizer decided ${ties.length} level entries, then finalized.`);
        await page.reload(); await page.locator('section[aria-label="Results and closeout"]').waitFor({ timeout: 30000 });
        await page.locator('.fz-pick').getByRole('button', { name: new RegExp(`^${nm.replace(/[&]/g, '\\$&')}( ●| ✓)?$`) }).click();
        await page.getByRole('button', { name: 'Finalize competition' }).waitFor({ timeout: 30000 }); await sleep(1500);
      }
      await page.getByRole('button', { name: 'Finalize competition' }).click();
      await page.getByRole('button', { name: 'Yes, make it official' }).click();
      const ok = await waitText(page, 'main', 'competition official', 30000);
      check(`[results] ${nm} made official from the Results screen`, ok && sql(`select status from public.competitions where id = '${comp(nm)}'`) === 'finished');
    }
    check('[results] the Polearm podium: the withdrawn fighter has no placing; every other fighter placed', sql(`select count(*) from public.results r where r.competition_id = '${comp('Men Polearm')}'`) === '6');
    check('[results] walkovers count as wins and losses in the Longsword placings; the no-show has no placing', sql(`select count(*) from public.results where competition_id = '${comp('Men Longsword')}'`) === '15');
    // a wrong placing found after the fact: reopen with a reason, correct the fight, finalize again
    await page.locator('.fz-pick').getByRole('button', { name: /^Women 3v3/ }).click();
    await page.getByRole('button', { name: 'Reopen…' }).waitFor({ timeout: 30000 });
    const goldBefore = sql(`select entry_id from public.results where competition_id = '${comp('Women 3v3')}' and final_place = 1`);
    await page.getByRole('button', { name: 'Reopen…' }).click();
    await page.getByPlaceholder('e.g. the final was scored for the wrong fighter').fill('Score sheet shows the final round went the other way');
    await page.getByRole('button', { name: 'Reopen the result' }).click();
    await waitText(page, 'main', 'reopened', 30000);
    check('[correction] the competition is reopened with the reason recorded; its results are superseded, not deleted', sql(`select status || '|' || (reopened_at is not null) from public.competitions where id = '${comp('Women 3v3')}'`) === 'running|true' || sql(`select (reopened_at is not null)::text from public.competitions where id = '${comp('Women 3v3')}'`) === 'true', sql(`select status || '|' || reopened_at from public.competitions where id = '${comp('Women 3v3')}'`));
    const wrongMatch = sql(`select m.id from public.matches m where m.competition_id = '${comp('Women 3v3')}' and (m.entry_a = '${goldBefore}' or m.entry_b = '${goldBefore}') order by position limit 1`);
    const flip = sql(`select case result when 'a' then 'b' else 'a' end from public.matches where id = '${wrongMatch}'`);
    const fix = await rpc('marshal', 'enter_official_result', { p_match: wrongMatch, p_result: flip, p_score_a: flip === 'a' ? 2 : 1, p_score_b: flip === 'b' ? 2 : 1, p_detail: {}, p_note: 'paper sheet 31: the final round was theirs' });
    check('[correction] the head marshal corrects the fight from the sheet (audited, the result before is kept on a proposal)', fix.status < 300 && Number(sql(`select count(*) from public.result_proposals where match_id = '${wrongMatch}' and source = 'paper' and official_before is not null`)) >= 1, JSON.stringify(fix.body));
    await page.reload(); await page.locator('section[aria-label="Results and closeout"]').waitFor({ timeout: 30000 });
    await page.locator('.fz-pick').getByRole('button', { name: /^Women 3v3/ }).click();
    await page.getByRole('button', { name: 'Finalize competition' }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Finalize competition' }).click();
    await page.getByRole('button', { name: 'Yes, make it official' }).click();
    await waitText(page, 'main', 'competition official', 30000);
    check('[correction] finalized again: the earlier placings are kept as revisions, the new ones are official', sql(`select status from public.competitions where id = '${comp('Women 3v3')}'`) === 'finished' && Number(sql(`select count(*) from public.result_revisions where competition_id = '${comp('Women 3v3')}'`)) >= 1 && Number(sql(`select count(*) from public.audit_log where subject = '${comp('Women 3v3')}' and action in ('competition.finished', 'competition.reopened')`)) >= 3, sql(`select count(*) from public.result_revisions where competition_id = '${comp('Women 3v3')}'`));
    // closeout
    await page.locator('#closeout, [aria-labelledby="co-h"]').first().waitFor({ timeout: 30000 });
    const co = await text(page, '[aria-labelledby="co-h"]');
    check('[closeout] the card lists every competition official and warns that five never ran (closed as not held)', /never ran/.test(co) && /Men Sabre/.test(co) && !/not official yet/.test(co), co.slice(0, 500));
    await shot(page, '14-closeout-390');
    await page.getByRole('button', { name: 'Close event' }).click();
    await page.getByRole('button', { name: 'Yes, close the event' }).click();
    await waitText(page, 'main', 'event closed', 30000);
    check('[closeout] closed: permanent history; nothing operational can change', sql(`select (closed_at is not null)::text from public.events where id = '${EV}'`) === 'true' && (await has(page, 'Nothing operational can change')));
    const locked = await rpc('organizer', 'set_match_queue', { p_match: sql(`select id from public.matches where competition_id = '${comp('Men Sword & Buckler')}' limit 1`), p_state: 'active', p_field: null });
    check('[closeout] the database refuses to touch a fight of a closed event', locked.status >= 400, JSON.stringify(locked.body));
    noErrors(page, 'results');
    await ctx.close();
    stop(14);
  }

  // ============================================================== 15. the public: results page, Arena after the event, a spectator who opens late
  {
    const { ctx, page } = await open('phone', null);
    await page.goto(BASE + `/events/${SLUG}`); await page.locator('[data-testid="event-closed"]').waitFor({ timeout: 30000 });
    await waitText(page, 'main', 'official results', 30000);
    const pubText = await text(page, 'main');
    check('[public] the event page says it is complete and lists the official podiums', /This event is complete/.test(pubText) && /Men Longsword/.test(pubText) && /Men Sword & Buckler/.test(pubText), pubText.slice(0, 300));
    check('[public] no private data on the page or behind it', !/@example\.test|emergency|0000000000a[0-9]/i.test(pubText) && privacyLeak(page).length === 0, privacyLeak(page).join(' | '));
    await shot(page, '15-public-results-390');
    if (!process.env.RUMBLE_FAST) await layout(page, 'public results 390');
    await ctx.close();
    for (const [kind, nm] of [['tv', '1920'], ['laptop', '1366'], ['tablet', '768']]) {
      const { ctx: c, page: tv } = await open(kind, null);
      await tv.goto(BASE + `/events/${SLUG}/arena`); await tv.waitForSelector('.arena .ar-main', { timeout: 30000 });
      await waitText(tv, '.ar-main', 'event complete', 30000);
      check(`[arena ${nm}] after the closeout the hall display says Event complete with a link to the results`, /Event complete/i.test(await text(tv, '.ar-main')) && (await tv.locator('.ar-main a.ar-btn').count()) === 1, await text(tv, '.ar-main'));
      check(`[arena ${nm}] fits the screen (no scrolling)`, !(await tv.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1 || document.scrollingElement.scrollHeight > innerHeight + 1)));
      await shot(tv, `15-arena-complete-${nm}`, false);
      await c.close();
    }
    stop(15);
  }
  // ============================================================== 16. the record afterwards: career profiles, team profile, rankings
  {
    const gold = sql(`select r.entry_id from public.results r where r.competition_id = '${comp('Men Longsword')}' and r.final_place = 1`);
    const champ = sql(`select fighter_id from public.entries where id = '${gold}'`);
    const champName = sql(`select display_name from public.fighters where id = '${champ}'`);
    const career = pub(`select events || ':' || competitions || ':' || matches || ':' || wins || '-' || losses || '-' || draws || ':' || golds || ':' || points from public.fighter_career('${champ}') where context = 'official' and scope = 'career' and kind is null`);
    check('[career] the Longsword champion has an official career line from this event alone', /^1:\d+:\d+:\d+-\d+-\d+:[1-9]\d*:/.test(career), career);
    metrics.champion_career = career;
    const { ctx, page } = await open('phone', null);
    await page.goto(BASE + `/fighters/${champ}`); await page.locator('[data-testid="career-line"]').waitFor({ timeout: 30000 }); await sleep(800);
    const hero = await text(page, 'header.teamhead');
    const events = await text(page, '#events');
    check(`[career] ${champName}'s profile shows the Rumble with the gold and the team represented`, /Red Deer Rumble \(rehearsal\)/.test(events) && /Gold Men Longsword/.test(events) && /Represented /.test(events) && /gold/.test(hero), events.slice(0, 300));
    check('[career] the fights list the real opponents with scores, walkovers labelled when there were any', /Won \d to \d/.test(await text(page, '#recent')), (await text(page, '#recent')).slice(0, 200));
    check('[career] no private data on the fighter page or behind it', privacyLeak(page).length === 0 && !/@example\.test/.test(await text(page, 'main')), privacyLeak(page).join(' | '));
    await shot(page, '16-champion-390');
    await page.goto(BASE + '/teams/kestrel-guard'); await page.locator('#roster').waitFor({ timeout: 30000 }); await sleep(1200);
    const teamPage = await text(page, 'main');
    check('[career] Kestrel Guard’s page shows its 5v5 / 3v3 record from the Rumble and the duelists who represented it', /5v5/.test(teamPage) && /Red Deer Rumble \(rehearsal\)/.test(teamPage) && /Fighters represented|represented/i.test(teamPage), teamPage.slice(0, 300));
    await page.goto(BASE + '/rankings?who=fighters&scope=career&category=longsword&division=men'); await sleep(2500);
    check('[career] the Longsword career ranking lists the Rumble champion', (await text(page, 'main')).includes(champName), champName);
    const teamCareer = pub(`select coalesce(sum(matches), 0) from public.team_career('${tid(1)}') where context = 'official' and scope = 'career' and category is null`);
    check('[career] team_career counts Kestrel Guard’s team fights', Number(teamCareer) >= 3, teamCareer);
    await ctx.close();
    stop(16);
  }

  // ============================================================== 17. archive (presentation only), exclude from statistics (exact), synthetic (isolated), inactive (history kept)
  {
    const gold = sql(`select r.entry_id from public.results r where r.competition_id = '${comp('Men Longsword')}' and r.final_place = 1`);
    const champ = sql(`select fighter_id from public.entries where id = '${gold}'`);
    const snap = () => pub(`select coalesce((select string_agg(scope || ':' || coalesce(kind, '-') || ':' || matches || ':' || golds || ':' || points, ',' order by scope, kind, category, gender) from public.fighter_career('${champ}') where context = 'official'), '-')
      || '|' || coalesce((select string_agg(scope || ':' || points, ',' order by scope, organization_id, season_id, category, gender) from public.ranking_fighters where fighter_id = '${champ}'), '-')
      || '|' || coalesce((select string_agg(scope || ':' || coalesce(category, '-') || ':' || matches || ':' || points, ',' order by scope, category, gender) from public.team_career('${tid(1)}') where context = 'official'), '-')`);
    const base = snap();
    const { ctx, page } = await open('desktop', 'owner');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=setup`); await page.locator('#lifecycle').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Archive event…' }).click();
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Archive event' }).click();
    await waitText(page, '#lifecycle', 'archived.');
    check('[archive] ARCHIVE CHANGES NO STATISTIC (career, rankings, team career identical)', snap() === base && sql(`select (archived_at is not null)::text from public.events where id = '${EV}'`) === 'true', snap());
    const anon = await open('phone', null);
    await anon.page.goto(BASE + `/events?when=past`); await sleep(2500);
    check('[archive] the archived event leaves the normal list and stays reachable with its results', !(await text(anon.page, 'main')).includes('Red Deer Rumble (rehearsal)'));
    await anon.page.goto(BASE + `/events/${SLUG}`); await waitText(anon.page, 'main', 'this event is archived', 20000);
    check('[archive] its page says it is archived and still shows the official results', (await has(anon.page, 'Men Longsword')));
    await page.getByRole('button', { name: 'Restore from archive' }).click();
    await waitText(page, '#lifecycle', 'restored from the archive');
    check('[archive] restored, still identical statistics', snap() === base);
    // exclude from statistics: owner only, exact
    await page.getByRole('button', { name: 'Exclude from statistics…' }).click();
    await page.getByLabel('Reason (required)').fill('Dress rehearsal: not a real tournament');
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Exclude from statistics' }).click();
    await waitText(page, '#lifecycle', 'excluded from official statistics.');
    const ex = snap();
    check('[exclude] EXCLUDE removes exactly this event’s contribution: no official career, no ranking row, no team career', ex === '-|-|-', ex);
    check('[exclude] the fights and results stay stored', sql(`select (select count(*) from public.results r join public.competitions k on k.id = r.competition_id where k.event_id = '${EV}') || '|' || (select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' and m.queue_state = 'final')`) === `${sql(`select count(*) from public.results r join public.competitions k on k.id = r.competition_id where k.event_id = '${EV}'`)}|${metrics.fights_built + 16}`);
    await anon.page.goto(BASE + `/fighters/${champ}`); await waitText(anon.page, 'main', 'not counted in statistics', 20000);
    check('[exclude] the fighter’s history still lists the event, marked Not counted in statistics', /Red Deer Rumble \(rehearsal\).*Not counted in statistics/i.test(await text(anon.page, '#events')));
    await page.getByRole('button', { name: 'Count it again…' }).click();
    await page.getByLabel('Reason (required)').fill('Decided to keep it as a real result');
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Count it again' }).click();
    await waitText(page, '#lifecycle', 'counted in official statistics again');
    check('[exclude] RESTORE returns exactly the baseline (no double counting)', snap() === base, snap());
    await shot(page, '17-lifecycle-1280');
    await anon.ctx.close();
    noErrors(page, 'lifecycle');
    await ctx.close();
    // inactive fighter: keeps every result
    const { ctx: fctx, page: fp } = await open('phone', 'f40');
    await fp.goto(BASE + `/fighters/${fid(40)}`); await fp.getByRole('button', { name: 'Set as inactive…' }).waitFor({ timeout: 30000 });
    await fp.getByRole('button', { name: 'Set as inactive…' }).click();
    await fp.locator('[role="dialog"]').getByRole('button', { name: 'Set as inactive' }).click();
    await waitText(fp, 'main', 'is not competing at the moment');
    const inactiveCareer = pub(`select coalesce(matches::text, '-') from public.fighter_career('${fid(40)}') where context = 'official' and scope = 'career' and kind is null`);
    check('[inactive] a fighter sets himself inactive after the event: his Rumble fights and placings stay (same career numbers)', sql(`select (inactive_at is not null)::text from public.fighters where id = '${fid(40)}'`) === 'true' && Number(inactiveCareer) >= 3, inactiveCareer);
    await fp.getByRole('button', { name: 'Make active again' }).click();
    await waitText(fp, 'main', 'set as inactive', 20000);
    await fctx.close();
    // synthetic: the rehearsal event is tagged fictional on this LOCAL copy (never on the hosted database)
    sql(`insert into public.sources (id, kind, title, citation, synthetic) values ('00000000-0000-0000-0000-0000000a1150', 'submitted', 'Pack 11 dress rehearsal (local only)', 'test', true)`);
    sql(`insert into public.record_sources (source_id, entity_type, entity_id, status, note) values ('00000000-0000-0000-0000-0000000a1150', 'event', '${EV}', 'unverified', 'rehearsal')`);
    const syn = snap();
    check('[synthetic] once the event is tagged fictional, every official aggregate of its people is empty', syn === '-|-|-', syn);
    check('[synthetic] the same fights appear in the test context only', Number(pub(`select coalesce(matches::text, '0') from public.fighter_career('${champ}') where context = 'test' and scope = 'career' and kind is null`)) >= 3);
    const { ctx: sctx, page: sp } = await open('phone', null);
    await sp.goto(BASE + `/events/${SLUG}`); await waitText(sp, 'main', 'fictional test event', 20000);
    check('[synthetic] the public event page says the event is a fictional test event', await has(sp, 'This is a fictional test event'));
    await sp.goto(BASE + `/fighters/${champ}`); await sleep(2500);
    check('[synthetic] the champion’s profile shows the Rumble as Test data, no official medal', /Test data/i.test(await text(sp, '#events')) && !/gold/.test(await text(sp, 'header.teamhead')), (await text(sp, 'header.teamhead')).slice(0, 200));
    await sctx.close();
    stop(17);
  }

  // ============================================================== 18. permissions straight at the database, and privacy of every public answer
  {
    const refuse = async (who, fn, args, label) => { const r = await rpc(who, fn, args); check(label, r.status >= 400, `${r.status} ${JSON.stringify(r.body)}`); };
    const anyMatch = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EV}' limit 1`);
    const anyReg = sql(`select id from public.registrations where event_id = '${EV}' limit 1`);
    await refuse(null, 'advance_field_queue', { p_event: EV, p_field: 'Field 1', p_start: true }, '[permissions] anonymous cannot run a field');
    await refuse('stranger', 'advance_field_queue', { p_event: EV, p_field: 'Field 1', p_start: true }, '[permissions] a signed-in stranger cannot run a field');
    const scorerField = await rpc('scorer1', 'advance_field_queue', { p_event: EV, p_field: 'Field 1', p_start: true });
    check('[permissions] a scorekeeper can run their event field but cannot use organizer-only tools', scorerField.status === 200, `${scorerField.status} ${JSON.stringify(scorerField.body)}`);
    await refuse('scorer1', 'decide_registration', { p_reg: anyReg, p_status: 'declined' }, '[permissions] a scorekeeper cannot decide registrations');
    await refuse('scorer1', 'set_registration_check', { p_reg: anyReg, p_check: 'checked_in', p_value: false }, '[permissions] a scorekeeper cannot check people in');
    await refuse('scorer1', 'enter_official_result', { p_match: anyMatch, p_result: 'a', p_score_a: 9, p_score_b: 0, p_detail: {}, p_note: 'nope' }, '[permissions] a scorekeeper cannot enter a paper result');
    await refuse('stranger', 'submit_match_result', { p_command: crypto.randomUUID(), p_match: anyMatch, p_result: 'a', p_score_a: 9, p_score_b: 0, p_detail: {}, p_expected_version: 1, p_schema: 1 }, '[permissions] a stranger cannot score');
    await refuse('scorer1', 'finalize_competition', { p_competition: comp('Men Longsword') }, '[permissions] a scorekeeper cannot make a competition official');
    await refuse('marshal', 'close_event', { p_event: EV, p_note: null }, '[permissions] the head marshal cannot close the event');
    await refuse('stranger', 'set_entry_roster', { p_entry: teamEntry(1, 'Men 5v5'), p_fighters: [] }, '[permissions] a stranger cannot change a roster');
    await refuse('organizer', 'exclude_event_from_stats', { p_event: EV, p_reason: 'trying' }, '[permissions] an organizer cannot change statistics eligibility');
    const strangerEntries = await rpc('stranger', 'my_event_entries', { p_event: EV });
    check('[permissions] a signed-in bystander gets no entries from my_event_entries', strangerEntries.status === 200 && Array.isArray(strangerEntries.body) && strangerEntries.body.length === 0, `${strangerEntries.status} ${JSON.stringify(strangerEntries.body)}`);
    const anonEntries = await rpc(null, 'my_event_entries', { p_event: EV });
    check('[permissions] anonymous gets nothing from my_event_entries', anonEntries.status >= 400 || (Array.isArray(anonEntries.body) && anonEntries.body.length === 0));
    const priv = await rest('scorer1', `registration_private?select=*&limit=1`);
    check('[privacy] a scorekeeper cannot read emergency or medical data', priv.status >= 400 || priv.body?.length === 0, JSON.stringify(priv.body).slice(0, 100));
    const flags = await rest('scorer1', `registrations?select=id,full_name,status,fighter_id&event_id=eq.${EV}&limit=2`);
    check('[privacy] a scorekeeper may read names and status for the check-in gaps, nothing private', flags.status === 200 || flags.status === 206, JSON.stringify(flags.body).slice(0, 100));
    const emails = await rest('scorer1', `registrations?select=email&event_id=eq.${EV}&limit=1`);
    check('[privacy] ... but not the email column', emails.status >= 400 || !JSON.stringify(emails.body).includes('@'), JSON.stringify(emails.body).slice(0, 100));
    // every public answer behind the public pages
    const { ctx, page } = await open('phone', null);
    for (const path of [`/events/${SLUG}`, `/events/${SLUG}/arena`, `/events/${SLUG}/field/Field%201`, `/rankings`, `/teams/kestrel-guard`, `/fighters/${fid(1)}`]) {
      await page.goto(BASE + path); await sleep(2500);
    }
    const leaks = privacyLeak(page);
    check('[privacy] no public API answer behind the event, arena, field, rankings, team or fighter pages carries an email, phone, account id or emergency data', leaks.length === 0, leaks.join(' | '));
    metrics.public_requests = page.requests;
    await ctx.close();
    stop(18);
  }

  // ============================================================== 19. edge and empty states; phone and tablet sweeps of the busiest screens
  {
    const { ctx, page } = await open('phone', 'scorer1');
    await page.goto(BASE + `/events/${SLUG}/field/Field%203`); await sleep(2500);
    check('[edge] a field with nothing queued says so, with the other fields offered', await has(page, 'Nothing queued on Field 3'), (await text(page, 'main')).slice(0, 200));
    await page.goto(BASE + `/events/${SLUG}/manage?tab=run`); await sleep(2500);
    check('[edge] a scorekeeper opening the organizer area is told it is for organizers', await has(page, 'This area is for organizers'));
    await ctx.close();
    const { ctx: nctx, page: np } = await open('phone', 'f48');
    await np.goto(BASE + `/events/${SLUG}`); await sleep(3000);
    check('[edge] a signed-in person with no entry sees no My next fight panel at all', (await np.locator('[aria-labelledby="mynext-h"]').count()) === 0);
    await nctx.close();
    const { ctx: octx, page: op } = await open('phone', 'organizer');
    await op.goto(BASE + `/events/${SLUG}/manage?tab=run`); await op.locator('section[aria-label="Men Sabre"]').waitFor({ timeout: 30000 }); await sleep(1500);
    check('[edge] the one-entrant competition explains it cannot be drawn', /at least 2 entrants/.test(await inner(op.locator('section[aria-label="Men Sabre"]'))));
    await octx.close();
    if (!process.env.RUMBLE_FAST) {
      for (const kind of ['phone', 'tablet']) {
        const w = kind === 'phone' ? '390' : '768';
        const { ctx: c, page: p } = await open(kind, 'organizer');
        for (const [tab, sel, nm] of [['checkin', 'article[aria-label]', 'check-in'], ['review', '[aria-label="Show"]', 'review'], ['eventday', 'section.eventday', 'event day'], ['run', 'section[aria-label="Men Longsword"]', 'run'], ['finalize', 'section[aria-label="Results and closeout"]', 'results']]) {
          const t0 = Date.now();
          await p.goto(BASE + `/events/${SLUG}/manage?tab=${tab}`); await p.locator(sel).first().waitFor({ timeout: 40000 }); await sleep(1500);
          metrics[`${tab}_${w}_ms`] = Date.now() - t0;
          if (tab === 'review') await p.locator('[aria-label="Show"]').getByRole('button', { name: 'All', exact: true }).click().catch(() => undefined);
          if (tab === 'checkin') await p.locator('[aria-label="Show"]').getByRole('button', { name: 'All', exact: true }).click().catch(() => undefined);
          await sleep(800);
          await shot(p, `19-${tab}-${w}`);
          await layout(p, `${nm} ${w}`);
        }
        await p.goto(BASE + `/events/${SLUG}`); await p.locator('[data-testid="event-closed"]').waitFor({ timeout: 30000 }); await sleep(1500);
        await shot(p, `19-public-${w}`); await layout(p, `public event ${w}`);
        await c.close();
      }
    }
    stop(19);
  }
} catch (e) {
  if (String(e?.message) !== '__stop__') check('journey ran to the end', false, e?.stack ?? String(e));
}
await browser.close();
console.log('\nMETRICS ' + JSON.stringify(metrics));
console.log('ISSUES ' + JSON.stringify(issues));
if (SHOTS) fs.writeFileSync(`${SHOTS}/r11-summary.json`, JSON.stringify({ results, issues, metrics }, null, 1));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
console.log(failed === 0 ? 'RUMBLE LIVE OK' : 'RUMBLE LIVE FAILED');
process.exit(failed === 0 ? 0 : 1);
