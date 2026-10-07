// Pack 26 production smoke test: READ-ONLY against the LIVE GitHub Pages site. Signs nobody in, writes nothing, creates no code, session or fight.
// What it proves on the deployed build: the footer names the expected commit; the served bundle carries the Pack 26 changes (Lyst wording, the
// idle-Lyst jump, rounds-won labels, the closed Register window, the notification hints, the second-tablet guard, the pools-done rule) and the
// Pack 25.2 / 25.3 work; the public pages of the owner's test event open with the Lyst wording and leak no personal detail; the counter and
// device pages load; the staff screens ask for a sign-in when signed out. Run by .github/workflows/pack26-production-smoke.yml.
//   BASE=https://dothecoolwip1.github.io/BuhurtOS EXPECT_COMMIT=27c0df2 EVENT=testing-stuff-v3 CHROME=/path/to/chrome node scripts/e2e/pack26-production-smoke.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const BASE = (process.env.BASE ?? 'https://dothecoolwip1.github.io/BuhurtOS').replace(/\/$/, '');
const EXPECT_COMMIT = process.env.EXPECT_COMMIT || '';
const EVENT = process.env.EVENT || 'testing-stuff-v3';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  <-- ' + String(d).slice(0, 300)}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || chromium.executablePath() });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|posthog|net::ERR|401|403/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const go = async (p) => { await page.goto(BASE + p, { waitUntil: 'domcontentloaded' }); await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); };
const sideways = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// 1. home + version
await go('/'); const home = await body();
const ver = home.match(/v[0-9.]+ · [^·]+ · ([0-9a-f]{7}) · /); 
check('1. production Home loads and its footer names the deployed commit ' + (EXPECT_COMMIT || '(any)'), !!ver && (!EXPECT_COMMIT || ver[1] === EXPECT_COMMIT), (home.match(/v0\.1\.0[^A-Z]{0,80}/) ?? [''])[0]);
check('1b. no sideways scroll on Home at 390', (await sideways()) <= 0, await sideways());
// bundle: the Pack 26, 25.2 and 25.3 code is in the served bundle
const html = await (await fetch(BASE + '/')).text(); const js = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
const bundle = js ? await (await fetch(`${BASE}/${js}`)).text() : '';
const has = (s) => bundle.includes(s);
check('4. the bundle carries the Pack 26 Lyst wording (fieldLabel, Lyst Control, Other Lysts, How many Lysts)', has('Lyst Control') && has('Other Lysts') && has('How many Lysts') && has('Fights on this Lyst'), js);
check('5. the idle-Lyst attention item jumps to the board (Start it, lyst- anchor)', has('Start it') && has('lyst-'), '');
check('8. team-fight numbers are labelled rounds won on the big screen and Live', has('rounds won') && has('ar-score-unit') && has('lf-unit'), '');
check('9. the Register page knows a closed / not yet open window', has('Registration is closed') && has('Registration is not open yet'), '');
check('11/12. the notifications sheet hints say 2 fights away and announcements', has('Called to fight, 2 fights away, schedule changes') && has('Announcements, registration, armour inspection'), '');
check('P1. the second-tablet guard is deployed (This fight is final)', has('This fight is final') && has('final-elsewhere'), '');
check('P2. the pools-done rule is deployed (Pools complete, bracket needs building; structure in the live competition)', has('Pools complete, bracket needs building') && has('pools_elimination'), '');
check('17. Pack 25.2 (sides and colours) is intact in the bundle', has('cp-side-now') && has('Now fighting:'), '');
check('18. Pack 25.3 (attention list at the top) is intact in the bundle', has('#cc-attention') && has('Needs attention') && has(' more ›'), '');
check('11b. the compact notifications sheet is deployed (Choose what BuhurtOS tells you about, Manage devices)', has('Choose what BuhurtOS tells you about') && has('Manage devices'), '');
// 2. events + the production test event
await go('/events'); const ev = await body();
check('2. the events list loads (test events stay behind the Show test data toggle for a visitor)', /events/i.test(ev) && /calendar/i.test(ev) && (await page.getByTestId('show-test').count()) === 1, ev.slice(0, 200));
await go(`/events/${EVENT}`); const ovw = await body();
check('2b. the production test event opens (Overview / Live / Results)', /testing stuff|test/i.test(ovw) && /overview|live|results/i.test(ovw), ovw.slice(0, 200));
check('2c. no sideways scroll on the event page', (await sideways()) <= 0, await sideways());
await go(`/events/${EVENT}/live`); const live = await body();
check('14. the public Live view loads and speaks Lyst (or says nothing is fighting)', /lyst|nothing is fighting|nothing on the/i.test(live), live.slice(0, 200));
check('14b. the public Live view uses the Pack 26 wording, not Field', !/\bField [0-9]\b/.test(live), (live.match(/.{30}Field [0-9].{30}/) ?? [''])[0]);
await go(`/events/${EVENT}/results`); const res = await body();
check('14c. the public Results view loads', /results|official|no results|not official|nothing/i.test(res), res.slice(0, 200));
await go(`/events/${EVENT}/arena`); const ar = await body();
check('8b. the big screen of the test event loads with Lyst in its heading or says it is not public', /lyst|not public|event complete/i.test(ar), ar.slice(0, 200));
// 15. public pages: no e-mail, phone, medical or insurance detail, no operator name labels
const leak = [home, ev, ovw, live, res, ar].map(t => t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b|medical|allerg|insurance number|emergency contact|operator:/i)).filter(Boolean);
check('15. no e-mail, phone number, medical, insurance or operator detail on the public pages', leak.length === 0, JSON.stringify(leak.map(m => m[0])));
// 6/7. the counter and device pages load (signed-out: the code / sign-in screens)
await go('/lyst/counter'); const cp = await body();
check('6. the counter screen loads (asks for its code / sign in; no error)', /code|sign in|counter|scan/i.test(cp) && !/something went wrong|error/i.test(cp), cp.slice(0, 200));
await go('/device'); const dv = await body();
check('6b. the device sign-in page loads with the 12-character code field', /12-character code/i.test(dv), dv.slice(0, 200));
// 404
await go('/no-such-page-' + Date.now()); const nf = await body();
check('404. an unknown page is a plain 404 with a way out', /404/.test(nf) && /see events/i.test(nf), nf.slice(0, 200));
// signed-out gates for staff screens (3, 10, 16): they ask to sign in rather than erroring or leaking
await go(`/events/${EVENT}/control?mode=live`); const lo = await body();
check('3. Live ops (signed out) asks for a sign-in; no error, no data', /sign in/i.test(lo) && !/needs attention/i.test(lo), lo.slice(0, 200));
await go('/my-events'); const me = await body();
check('10. My events (signed out) asks for a sign-in', /sign in/i.test(me), me.slice(0, 200));
await go('/platform/devices'); const pd = await body();
check('16. Platform › Devices (signed out) asks for a sign-in or refuses; no sessions shown', /sign in|owner|not for you|platform/i.test(pd) && !/session-row/i.test(pd), pd.slice(0, 200));
check('1c. no page errors across the smoke run', errors.length === 0, errors.join(' | '));
if (SHOTS) { await go('/'); await page.screenshot({ path: `${SHOTS}/p26-prod-home-390.png` }); await go(`/events/${EVENT}/live`); await page.screenshot({ path: `${SHOTS}/p26-prod-live-390.png`, fullPage: true }); }
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
