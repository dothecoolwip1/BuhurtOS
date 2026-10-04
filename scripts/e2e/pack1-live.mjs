/**
 * Pack 1 browser checks against a REAL local stack (Postgres built from the migrations + PostgREST + an auth shim + the app).
 * It is not part of CI (CI has no PostgREST); it is the evidence run recorded in docs/claude-packs/STATUS.md.
 *   E2E_BASE=http://127.0.0.1:5173 E2E_REST=http://127.0.0.1:54321 CHROME=/path/to/chrome node scripts/e2e/pack1-live.mjs [shots-dir]
 * Accounts: the six @buhurtos.ca test accounts plus a local-only superadmin@buhurtos.ca owner, password testing123!, via /test-login.
 * It creates one event (pack-one-cup-<n>) and one registration in the LOCAL database only.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:5173';
const REST = process.env.E2E_REST ?? 'http://127.0.0.1:54321';
const SHOTS = process.argv[2] ?? '/tmp/pack1-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const VP = { m390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, d1440: { viewport: { width: 1440, height: 900 } } };
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ' :: ' + note : ''}`); };
const slug = `pack-one-cup-${Date.now().toString(36).slice(-5)}`;

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
async function ctx(vp) {
  const c = await browser.newContext({ ...VP[vp], locale: 'en-CA', timezoneId: 'America/Edmonton' });
  const page = await c.newPage();
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.route(u => !u.href.startsWith('http://127.0.0.1') && !u.href.startsWith('http://localhost'), r => r.abort());
  return { c, page };
}
const go = async (page, path, wait = 1200) => { await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForTimeout(wait); try { await page.waitForFunction(() => !/Loading…/i.test(document.body.innerText), null, { timeout: 8000 }); } catch {} };
const text = async (page) => page.locator('main').innerText();
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
async function login(page, who) {
  await page.goto(BASE + '/test-login');
  await page.fill('input[type=email]', who + '@buhurtos.ca'); await page.fill('input[type=password]', 'testing123!');
  await page.click('button[type=submit]'); await page.waitForSelector('text=Signed in as', { timeout: 10000 });
}
const token = (page) => page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) return JSON.parse(localStorage.getItem(k)).access_token; return null; });

for (const vp of ['m390', 'd1440']) {
  // ---------------- anonymous: upcoming lists, no PGRST201, synthetic results on the event's own page
  {
    const { c, page } = await ctx(vp);
    await go(page, '/teams/iron-wolves-test'); const t1 = await text(page); await shot(page, `${vp}-team-upcoming`);
    check(`[${vp}] TEST 1 team page upcoming loads (a team entered in the current test event)`, /UPCOMING EVENTS[\s\S]{0,200}Red Deer Rumble-test/i.test(t1) && !/Could not load events/i.test(t1), t1.match(/UPCOMING EVENTS[\s\S]{0,80}/i)?.[0]?.replace(/\s+/g, ' '));
    await go(page, '/teams/mountain-bears-test'); const t1b = await text(page);
    check(`[${vp}] TEST 1b a team with nothing upcoming shows no error (panel simply absent)`, !/Could not load events/i.test(t1b));
    await go(page, '/fighters/4feb7fd3-dd4d-532d-a360-5869eb50cc97'); const t2 = await text(page); await shot(page, `${vp}-fighter-upcoming`);
    check(`[${vp}] TEST 2 fighter page upcoming loads`, /UPCOMING/i.test(t2) && !/Could not load upcoming/i.test(t2));
    await go(page, '/rankings');
    check(`[${vp}] TEST 3 no PGRST201 on team, fighter or rankings`, !page.errors.some(e => e.includes('PGRST201')), page.errors.find(e => e.includes('PGRST')) ?? '');
    await go(page, '/events/central-alberta-steel-open-test', 2500);
    const t4 = await text(page); await shot(page, `${vp}-caso-results`);
    check(`[${vp}] TEST 4 Central Alberta Steel Open-test shows its results`, /Fictional results/i.test(t4) && /1ST|1st/i.test(t4) && !/No final placings are recorded/i.test(t4));
    await c.close();
  }
}
// TEST 5: official sources unchanged (REST, anonymous)
{
  const anon = await fetch(REST + '/rest/v1/events?select=id&slug=eq.central-alberta-steel-open-test').then(r => r.status);
  const key = process.env.E2E_ANON_KEY ?? '';
  const h = key ? { apikey: key, Authorization: 'Bearer ' + key } : {};
  const official = await fetch(REST + '/rest/v1/result_rows?select=competition_id&event_slug=eq.central-alberta-steel-open-test', { headers: h }).then(r => r.json());
  const all = await fetch(REST + '/rest/v1/result_rows_all?select=competition_id,synthetic&event_slug=eq.central-alberta-steel-open-test', { headers: h }).then(r => r.json());
  check('TEST 5 official result_rows still exclude the synthetic event; result_rows_all carries it flagged', Array.isArray(official) && official.length === 0 && Array.isArray(all) && all.length > 0 && all.every(r => r.synthetic === true), `official=${JSON.stringify(official).slice(0, 60)} all=${Array.isArray(all) ? all.length : JSON.stringify(all).slice(0, 80)} (events status ${anon})`);
}

// ---------------- organizer: create event, see the blocker, add a competition, publish
{
  const { c, page } = await ctx('m390');
  await login(page, 'organizer');
  await go(page, '/events/new');
  await page.fill('input >> nth=0', 'Pack One Cup'); await page.fill('input >> nth=1', slug);
  await page.fill('input[type=date] >> nth=0', '2026-12-05'); await page.fill('input[type=date] >> nth=1', '2026-12-06');
  await page.click('button[type=submit]'); await page.waitForURL(/manage\?tab=setup/, { timeout: 15000 }); await page.waitForTimeout(1500);
  check('TEST 6 organizer creates a draft event', page.url().includes(`/events/${slug}/manage`));
  const t7 = await text(page); await shot(page, 'm390-setup-blocker');
  check('TEST 7 publish checklist says no competitions yet, with an action', /No competitions yet/i.test(t7) && (await page.getByRole('link', { name: '+ Add competition' }).count()) > 0 && (await page.locator('button:has-text("Publish event")').isDisabled()));
  await page.getByRole('link', { name: '+ Add competition' }).first().click(); await page.waitForTimeout(1200);
  check('TEST 8 the action opens the Competitions tab', page.url().includes('tab=competitions') && /Competitions \(0\)/i.test(await text(page)));
  await page.getByRole('button', { name: '+ Add competition' }).click(); await page.waitForTimeout(400);
  await page.selectOption('label:has-text("Category") select', 'longsword');
  const suggested = await page.inputValue('label:has-text("Name") input');
  await page.fill('label:has-text("Ruleset") input', 'Duels V.26.4');
  await shot(page, 'm390-competition-form');
  await page.click('button:has-text("Save competition")'); await page.waitForTimeout(1500);
  const t9 = await text(page); await shot(page, 'm390-competition-added');
  check('TEST 9 organizer creates a competition', /Added Longsword \(open\)/i.test(t9) && /Competitions \(1\)/i.test(t9), `suggested name: ${suggested}`);
  // a second one, then remove it (unused)
  await page.getByRole('button', { name: '+ Add competition' }).click(); await page.selectOption('label:has-text("Category") select', '5v5'); await page.getByRole('button', { name: 'Men', exact: true }).click();
  await page.click('button:has-text("Save competition")'); await page.waitForTimeout(1200);
  const rows = page.locator('li', { hasText: 'Men 5v5' }); await rows.getByRole('button', { name: 'Remove' }).click(); await page.getByRole('button', { name: 'Yes, remove it' }).click(); await page.waitForTimeout(1200);
  check('TEST 9b an unused competition can be removed', /Removed Men 5v5/i.test(await text(page)) && /Competitions \(1\)/i.test(await text(page)));
  // waiver + close so the rest of the checklist is green, then publish
  await go(page, `/events/${slug}/manage?tab=setup`);
  await page.click('button:has-text("Add the waiver")'); await page.fill('textarea', 'Pack one waiver text.'); await page.click('button:has-text("Save waiver")'); await page.waitForTimeout(1200);
  await page.locator('input[type=datetime-local] >> nth=1').fill('2026-12-01T23:59'); await page.fill('label:has-text("Venue") input', 'Pack Hall');
  await page.fill('label:has-text("Entry fee") input', '25'); await page.selectOption('label:has-text("Who pays") select', 'ALL'); await page.fill('label:has-text("Note about payment") input', 'E-transfer to the club treasurer, or cash at the door.');
  await page.click('button:has-text("Save changes")'); await page.waitForTimeout(1500);
  const t10 = await text(page); await shot(page, 'm390-setup-ready');
  check('TEST 10 the publish requirement clears once a competition exists', !/No competitions yet/i.test(t10) && /✓ At least one competition is set up/i.test(t10) && !(await page.locator('button:has-text("Publish event")').isDisabled()));
  await page.click('button:has-text("Publish event")'); await page.click('button:has-text("Yes, publish")'); await page.waitForTimeout(1500);
  check('TEST 10b publish succeeds', /PUBLISHED|This event is public/i.test(await text(page)));
  await go(page, `/events/${slug}/manage?tab=run`); const t11 = await text(page); await shot(page, 'm390-run-with-competition');
  check('TEST 11 the competition appears in Run', /LONGSWORD \(OPEN\)/i.test(t11) && !/No competitions yet/i.test(t11));
  await c.close();
}
// ---------------- stranger cannot create a competition (server-side)
{
  const { c, page } = await ctx('m390');
  await login(page, 'fighter');
  const tok = await token(page);
  const ev = await fetch(`${REST}/rest/v1/events?select=id&slug=eq.${slug}`, { headers: { Authorization: 'Bearer ' + tok, apikey: process.env.E2E_ANON_KEY ?? '' } }).then(r => r.json());
  const r = await fetch(`${REST}/rest/v1/rpc/create_competition`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tok, apikey: process.env.E2E_ANON_KEY ?? '' }, body: JSON.stringify({ p_event: ev[0]?.id, p_name: 'Sneaky', p_category: 'polearm', p_gender: 'open' }) });
  const body = await r.json().catch(() => ({}));
  check('TEST 12 a non-organizer cannot create a competition', r.status >= 400 && body.code === '42501', `${r.status} ${body.code ?? ''} ${body.message ?? ''}`);
  // ---------------- fighter registers: event-driven days, no Rumble copy
  await go(page, `/events/${slug}/register`); const form = await text(page); await shot(page, 'm390-register-generic');
  check('TEST 21 registration for a non-Rumble event has no Rumble-specific dates or text', /Saturday, Dec 5/i.test(form) && /Sunday, Dec 6/i.test(form) && !/Nov 14|Nov 15|November 11|November 13/i.test(form) && /before check-in/i.test(form) && /E-transfer to the club treasurer/i.test(form));
  await page.fill('label:has-text("Full name") input', 'Pack One Fighter');
  await page.getByRole('button', { name: 'Male', exact: true }).click(); await page.getByRole('button', { name: 'HACSA', exact: true }).click();
  await page.selectOption('label:has-text("Where are you from") select', 'AB');
  await page.getByLabel('Longsword (open)').check(); await page.getByLabel('Saturday, Dec 5').check(); await page.getByRole('button', { name: 'No', exact: true }).click();
  await page.getByLabel(/HACSA member in good standing/).check();
  await page.fill('label:has-text("Emergency contact name") input', 'Pat'); await page.fill('label:has-text("Emergency contact phone") input', '4035550100');
  await page.getByLabel(/medically fit/).check(); await page.getByLabel(/understand and will pay/).check(); await page.getByLabel(/read and agree to the waiver/).check();
  await page.fill('label:has-text("Type your full name to sign") input', 'Pack One Fighter');
  await page.click('button:has-text("Submit registration")'); await page.waitForTimeout(2500);
  check('TEST 15 fighter registers for the event', /you are registered/i.test(await text(page)));
  await go(page, '/my-events'); const my = await text(page); await shot(page, 'm390-my-events-fighter');
  check('TEST 16 the event appears in the fighter\'s My events with the reason', /Pack One Cup/i.test(my) && /Registration waiting for review/i.test(my));
  check('TEST 20a test events are hidden by default with a switch to show them', !/Rumble-test/i.test(my) && /Show test events/i.test(my));
  await page.getByLabel(/Show test events/).check(); await page.waitForTimeout(400); const my2 = await text(page);
  check('TEST 20b showing test events lists the fictional events the fighter is entered in', /-test/i.test(my2) && /You are entered/i.test(my2));
  const headings = await page.locator('h2.acct-h').allInnerTexts();
  const upcomingDates = await page.locator('section[aria-labelledby="myev-upcoming"] article .src').allInnerTexts();
  check('TEST 19 ordering: Coming up before Past, soonest first', headings.map(h => h.toUpperCase()).indexOf('COMING UP') < headings.map(h => h.toUpperCase()).indexOf('PAST'), headings.join(' > ') + ' | ' + upcomingDates.slice(0, 3).join(' ; '));
  await page.locator(`a[href="/events/${slug}/register"]`).first().click(); await page.waitForTimeout(1500);
  const reg = await text(page); await shot(page, 'm390-my-registration');
  check('TEST 17 View registration shows the registration, not a blank form', /YOUR REGISTRATION/i.test(reg) && /Waiting for review/i.test(reg) && /Longsword \(open\)/i.test(reg) && !/Submit registration/i.test(reg));
  await go(page, '/account'); const acct = await text(page);
  check('TEST 16b Account links to My events with a count', /My events/i.test(acct) && /\d+ events? you take part in/i.test(acct));
  await c.close();
}
// ---------------- owner is not special in My events
{
  const { c, page } = await ctx('d1440');
  await login(page, 'superadmin'); await go(page, '/my-events'); const t = await text(page); await shot(page, 'd1440-my-events-owner');
  check('TEST 18 the platform owner does not get every event under My events', !/Central Alberta Steel Open-test/i.test(t) && !/Rocky Mountain Rumble-test/i.test(t) && /Nothing yet|Show test events/i.test(t), t.slice(0, 120).replace(/\s+/g, ' '));
  await c.close();
}
// ---------------- scorekeeper reaches the ring from normal navigation; no organizer powers
{
  const { c, page } = await ctx('m390');
  await login(page, 'scorekeeper');
  await go(page, '/account'); await page.getByRole('link', { name: /My events/ }).click(); await page.waitForTimeout(1500);
  await page.getByLabel(/Show test events/).check(); await page.waitForTimeout(400);
  const my = await text(page); await shot(page, 'm390-my-events-scorekeeper');
  check('TEST 13a scorekeeper sees the assigned event with the role', /Red Deer Rumble-test/i.test(my) && /Scorekeeper/i.test(my));
  await page.locator('article', { hasText: 'Red Deer Rumble-test' }).getByRole('link', { name: 'Scorekeeping' }).click(); await page.waitForTimeout(2500);
  const ev = await text(page); await shot(page, 'm390-event-scorekeeping-panel');
  check('TEST 13b the event page shows a Scorekeeping panel with the fields', /SCOREKEEPING/i.test(ev) && /Open Ring 1/i.test(ev));
  await page.getByRole('link', { name: 'Open Ring 1' }).click(); await page.waitForTimeout(2000);
  const q = await text(page); await shot(page, 'm390-ring1-queue');
  check('TEST 13c the field queue opens', /RING 1/i.test(q) && /Pick one to start scoring|Nothing queued on Ring 1/i.test(q) && /Other fields/i.test(q));
  await go(page, '/events/red-deer-rumble-test/manage'); const m = await text(page);
  check('TEST 14 scorekeeper gets no organizer area', /This area is for organizers/i.test(m) && !/Review \(/i.test(m));
  await go(page, '/events/red-deer-rumble-test/manage?tab=competitions'); check('TEST 14b nor the Competitions tab', /This area is for organizers/i.test(await text(page)));
  await c.close();
}
// ---------------- desktop pass on the organizer screens
{
  const { c, page } = await ctx('d1440');
  await login(page, 'organizer');
  await go(page, `/events/${slug}/manage?tab=competitions`); await shot(page, 'd1440-competitions-tab');
  await go(page, `/events/${slug}/manage`); const rv = await text(page);
  check('TEST 15b organizer sees the registration with event-day attendance', /Pack One Fighter/i.test(rv));
  await page.locator('summary:has-text("Contact")').click(); await page.waitForTimeout(300);
  check('TEST 21b organizer review shows the chosen event day', /Can attend: Saturday, Dec 5/i.test(await text(page)));
  await page.getByRole('button', { name: 'Accept', exact: true }).click(); await page.waitForTimeout(1500);
  await c.close();
  const f = await ctx('d1440'); await login(f.page, 'fighter'); await go(f.page, '/my-events'); const t = await text(f.page); await shot(f.page, 'd1440-my-events-fighter-accepted');
  check('TEST 16c acceptance shows up in My events with what is outstanding', /Registration accepted/i.test(t) && /Fee not marked paid/i.test(t));
  await f.c.close();
}
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:', failed.map(f => f.name).join(' | ')); process.exit(1); }
