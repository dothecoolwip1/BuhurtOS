// PRODUCTION check for Pack 25 (Event Control, the phase-aware public event page, the Counter QR) on the LIVE site, in real Chromium, at 390x844,
// 360x800, 768x1024, 1024x768 and 1280x900, each view in a fresh browser context with service workers blocked. READ-ONLY: it never writes sporting
// data, never creates a fight, a device code, a Counter QR or a session, never signs anyone in or up. It opens three published TEST events
// (synthetic, or the owner's own test event) in their three phases, the legacy addresses, the workstations signed out, the device sign-in page with
// a code that cannot exist (which exercises the deployed device-session function from the real origin), and the function's own refusals directly.
//   BASE=https://dothecoolwip1.github.io/BuhurtOS EXPECT_BUILD=160 EXPECT_COMMIT=abc1234 node scripts/e2e/pack25-production-check.mjs
// Events (slugs) and names come from the environment so the same script runs against the local stack: EVENT_UPCOMING, EVENT_LIVE, EVENT_COMPLETED.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = (process.env.BASE ?? 'https://dothecoolwip1.github.io/BuhurtOS').replace(/\/$/, '');
const API = (process.env.API ?? 'https://mvbxlebznlgroptwwdsm.supabase.co').replace(/\/$/, '');
const SHOTS = process.env.SHOTS ?? '/tmp/p25-prod-shots';
const EXPECT_BUILD = process.env.EXPECT_BUILD ?? '', EXPECT_COMMIT = process.env.EXPECT_COMMIT ?? '';
const UP = process.env.EVENT_UPCOMING ?? 'red-deer-rumble-test', LIVE = process.env.EVENT_LIVE ?? 'testing-stuff-v3', DONE = process.env.EVENT_COMPLETED ?? 'rocky-mountain-rumble-test';
const PHASES = (process.env.PHASES ?? 'upcoming,live,completed').split(',');   // the local stack has one event: PHASES=live
const SECTIONS = (process.env.SECTIONS ?? 'fn,ui').split(',');   // fn = the deployed function directly (seconds); ui = the browser journeys (minutes)
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${ok === false ? '  <-- ' + String(detail).slice(0, 500) : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, timeout = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }).catch(() => undefined);
const versionOk = (v) => (!EXPECT_BUILD || v.includes(`build ${EXPECT_BUILD}`)) && (!EXPECT_COMMIT || v.includes(EXPECT_COMMIT));
const path = (page) => { const u = new URL(page.url()); return u.pathname.replace(/^\/BuhurtOS/, '') + u.search; };
const OLD_WORDS = /Command Centre|Manage ›|More options|Event home|Waiting for the lyst to seat|seat request|join code|Seat Counter/i;

const VIEWS = [
  ['390x844', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }],
  ['360x800', { viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
  ['768x1024', { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['1024x768', { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true }],
  ['1280x900', { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }]
];
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME, args: ['--proxy-bypass-list=127.0.0.1;localhost'] } : {});
async function freshPage(opts) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com/, r => r.abort('failed'));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  return page;
}
const headerBox = (page) => page.evaluate(() => { const h = document.querySelector('[data-testid=event-header]'); const v = document.querySelector('.ev-views'); return h && v ? { bottom: Math.round(v.getBoundingClientRect().bottom), vh: innerHeight } : null; });
const active = (page) => page.evaluate(() => document.querySelector('.ev-view[aria-current=page]')?.getAttribute('data-testid') ?? '');
const focusChrome = (page) => page.evaluate(() => {
  const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none';
  const head = document.querySelector('[data-testid=focus-header]');
  return { focusHeader: vis(head), exit: head?.querySelector('a[aria-label^="Exit"]')?.getAttribute('aria-label') ?? '', siteHeader: vis(document.querySelector('header.top')), bottomBar: vis(document.querySelector('nav.bottom')) };
});

try {
  // ================================================================ 0. what the live site serves
  const html = await (await fetch(`${BASE}/`, { cache: 'no-store' })).text();
  const js = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  const bundle = js ? await (await fetch(`${BASE}/${js}`, { cache: 'no-store' })).text() : '';
  const label = bundle.match(/v\d+\.\d+\.\d+ · [^"'`]{0,60}? UTC/)?.[0] ?? '';
  console.log(`NOTE  live bundle ${js}: ${label || 'no version label found'}`);
  check('0a the live bundle carries the expected build and commit', !!label && versionOk(label), label);
  check('0b the live bundle is Pack 25 (Event Control, the Counter QR, the three views) and points at the hosted project', bundle.includes('event-control') && bundle.includes('counter-qr') && bundle.includes('ev-view') && bundle.includes('event-header') && (!BASE.includes('github.io') || bundle.includes('mvbxlebznlgroptwwdsm')));
  check('0c the live bundle holds no trace of the old ceremony (request_counter_seat, assign_counter_seat, carry_counter_seats, CommandCentrePage)', !/request_counter_seat|assign_counter_seat|carry_counter_seats|cmd-centre-page/.test(bundle));

  // ================================================================ 6. the deployed device-session function, directly (first: it takes seconds and never depends on the build)
  if (SECTIONS.includes('fn')) {
  const fn = `${API}/functions/v1/device-session`;
  const post = async (body, headers = {}) => { const t0 = Date.now(); const r = await fetch(fn, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dothecoolwip1.github.io', ...headers }, body: JSON.stringify(body) }); return { status: r.status, ms: Date.now() - t0, acao: r.headers.get('access-control-allow-origin'), body: await r.json().catch(() => null) }; };
  const pre = await fetch(fn, { method: 'OPTIONS', headers: { origin: 'https://dothecoolwip1.github.io', 'access-control-request-method': 'POST' } });
  check('6a CORS preflight from the app origin: 204 with the origin echoed', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://dothecoolwip1.github.io', `${pre.status} ${pre.headers.get('access-control-allow-origin')}`);
  const evil = await fetch(fn, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"action":"signin","code":"ZZZZ-ZZZZ-ZZZZ"}' });
  check('6b a browser call from another origin is refused (403) and gets no useful CORS header', evil.status === 403 && evil.headers.get('access-control-allow-origin') !== 'https://evil.example', `${evil.status} ${evil.headers.get('access-control-allow-origin')}`);
  const bad = await post({ action: 'signin', code: 'ZZZZ-ZZZZ-ZZZZ' });
  check('6c a code that cannot exist: 401 with the one plain message, after the minimum delay, no detail', bad.status === 401 && /did not work/i.test(bad.body?.error ?? '') && bad.ms >= 300 && Object.keys(bad.body ?? {}).join() === 'error', JSON.stringify(bad));
  const garbage = await post({ action: 'signin', code: 'not a code at all' });
  check('6d garbage is the same 401 (no distinction between a wrong code and a non-code)', garbage.status === 401 && garbage.body?.error === bad.body?.error, JSON.stringify(garbage));
  const refresh = await post({ action: 'refresh', session_secret: 'x'.repeat(40) });
  check('6e an unknown session secret cannot refresh (an ended or never-existing session): 401', refresh.status === 401, JSON.stringify(refresh));
  const signout = await post({ action: 'signout', session_secret: 'x'.repeat(40) });
  check('6f sign-out of an unknown secret is idempotent (ok, nothing leaks)', signout.status === 200 && signout.body?.ok === true, JSON.stringify(signout));
  const create = await post({ action: 'create', event: '00000000-0000-0000-0000-000000000000', kind: 'counter_pool' });
  check('6g making a Counter QR without an organizer sign-in is refused (401)', create.status === 401, JSON.stringify(create));
  const createAnon = await post({ action: 'create', event: '00000000-0000-0000-0000-000000000000', kind: 'counter_pool' }, { authorization: 'Bearer not.a.jwt' });
  check('6h making a Counter QR with a token that is not a person is refused by the database (403/400), never created', createAnon.status === 403 || createAnon.status === 400, JSON.stringify(createAnon));
  const unknown = await post({ action: 'teleport' });
  check('6i an unknown action is 400', unknown.status === 400, JSON.stringify(unknown));
  const get = await fetch(fn, { method: 'GET', headers: { origin: 'https://dothecoolwip1.github.io' } });
  check('6j GET is 405', get.status === 405, String(get.status));
  check('6k no response carried a code, a secret or a token', ![bad, garbage, refresh, signout, create, createAnon, unknown].some(r => /access_token|session_secret|code_hash|[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/.test(JSON.stringify(r.body))));
  }

  for (const [view, opts] of (SECTIONS.includes('ui') ? VIEWS : [])) {
    const p = await freshPage(opts);
    const phone = opts.viewport.width < 500;
    for (const phase of PHASES) {
      const slug = phase === 'upcoming' ? UP : phase === 'live' ? LIVE : DONE;
      const want = phase === 'upcoming' ? 'view-overview' : phase === 'live' ? 'view-live' : 'view-results';
      // -------------------------------------------------------------- 1. the bare event address leads with its phase
      await p.goto(`${BASE}/events/${slug}`, { waitUntil: 'domcontentloaded' });
      const loaded = await until(async () => (await p.locator('[data-testid=event-header]').count()) > 0 && (await active(p)) !== '');
      const act = await active(p);
      check(`1 [${view}] ${phase} event ${slug}: lands on ${want.replace('view-', '')}`, loaded && act === want, `${act} ${(await text(p)).slice(0, 160)}`);
      const hb = await headerBox(p);
      check(`1 [${view}] ${phase}: the header and the three views fit in the first viewport (views bottom ${hb?.bottom} of ${hb?.vh})`, !!hb && hb.bottom <= hb.vh * 0.6, JSON.stringify(hb));
      const body = await text(p);
      check(`1 [${view}] ${phase}: three destinations only (Overview, Live, Results), no staff door for a visitor, none of the old wording`, (await p.locator('.ev-view').count()) === 3 && (await p.locator('[data-testid=open-control]').count()) === 0 && !OLD_WORDS.test(body), body.match(OLD_WORDS)?.[0] ?? '');
      check(`1 [${view}] ${phase}: status word matches the phase`, phase === 'upcoming' ? /upcoming/i.test(body) : phase === 'live' ? /\blive\b/i.test(body) : /complete/i.test(body), body.slice(0, 120));   // the status chip is upper-cased by CSS, so innerText is upper case
      check(`1 [${view}] ${phase}: no sideways scroll`, await noSideways(p));
      await shot(p, `event-${phase}-${view}`);
      if (phase === 'live') {
        // the Live view: per-field NOW / ON DECK / IN THE HOLE, or an honest quiet state; never counter numbers
        // the fields come from the live-state query after the event itself: wait for them (or the honest quiet state) instead of reading "Loading the fields…"
        const fieldsLoaded = await until(async () => (await p.locator('[data-testid=live-field]').count()) > 0 || (await p.locator('[data-testid=live-quiet]').count()) > 0, 20000);
        const liveBody = await text(p);
        check(`1 [${view}] live: the Live view shows the fields (NOW / ON DECK / IN THE HOLE) or says plainly that nothing is on`, fieldsLoaded, liveBody.slice(0, 200));
        check(`1 [${view}] live: no counter names or tallies on the public page`, !/counter|tally|operator/i.test(liveBody));
        await shot(p, `event-live-fields-${view}`);
      }
      // -------------------------------------------------------------- 2. the other two views, one tap away
      for (const v of ['view-overview', 'view-live', 'view-results']) {
        if (v === want) continue;
        await p.locator(`[data-testid=${v}]`).click({ timeout: 8000 }).catch(() => undefined);   // a missing view is a FAIL below, never the end of the run
        const ok = await until(async () => (await active(p)) === v, 10000);
        check(`2 [${view}] ${phase}: ${v.replace('view-', '')} opens in place at /events/${slug}/${v.replace('view-', '')}`, ok && path(p) === `/events/${slug}/${v.replace('view-', '')}`, path(p));
        check(`2 [${view}] ${phase}: ${v.replace('view-', '')}: no sideways scroll`, await noSideways(p));
        if (phase === 'live' || (phase === 'completed' && v === 'view-overview') || (phase === 'upcoming' && v === 'view-results')) await shot(p, `event-${phase}-${v.replace('view-', '')}-${view}`);
      }
      check(`2 [${view}] ${phase}: no page errors`, p.errors.length === 0, p.errors.join(' | '));
    }
    if (phone) {
      // -------------------------------------------------------------- 3. legacy addresses redirect into Event Control (a visitor is then asked to sign in)
      const slug = LIVE;
      for (const [from, to] of [
        ['/manage', '/control?mode=setup'], ['/manage?tab=eventday', '/control?mode=live'], ['/manage?tab=run', '/control?mode=setup&tool=run'],
        ['/manage?tab=review', '/control?mode=setup&tool=registrations'], ['/manage?tab=finalize', '/control?mode=results'], ['/command', '/control?mode=live'],
        ['/manage?tab=run&match=00000000-0000-0000-0000-000000000001', '/control?mode=setup&tool=run&match=00000000-0000-0000-0000-000000000001']]) {
        await p.goto(`${BASE}/events/${slug}${from}`, { waitUntil: 'domcontentloaded' });
        const ok = await until(async () => path(p) === `/events/${slug}${to}` && /sign in/i.test(await text(p)), 15000);
        check(`3 [${view}] ${from} → ${to} (sign-in asked, no loop, no 404)`, ok, `${path(p)} ${(await text(p)).slice(0, 120)}`);
      }
      await shot(p, `legacy-command-${view}`);
      // -------------------------------------------------------------- 4. workstations signed out: focus layout, Exit goes where it came from
      await p.goto(`${BASE}/events/${slug}/field/${encodeURIComponent('Field 1')}?from=control`, { waitUntil: 'domcontentloaded' });
      await until(async () => (await p.locator('[data-testid=focus-header]').count()) > 0);
      let fc = await focusChrome(p);
      check(`4 [${view}] Lyst Control opened from Event Control: focus layout, Exit to Event Control, no site chrome`, fc.focusHeader && fc.exit === 'Exit to Event Control' && !fc.siteHeader && !fc.bottomBar, JSON.stringify(fc));
      await p.locator('.focus-exit').click({ timeout: 8000 }).catch(() => undefined);
      check(`4 [${view}] Exit lands on Live ops`, await until(async () => path(p) === `/events/${slug}/control?mode=live`), path(p));
      await p.goto(`${BASE}/events/${slug}/field/${encodeURIComponent('Field 1')}`, { waitUntil: 'domcontentloaded' });
      await until(async () => (await p.locator('[data-testid=focus-header]').count()) > 0);
      fc = await focusChrome(p);
      check(`4 [${view}] Lyst Control opened on its own: Exit to the event`, fc.exit === 'Exit to Event', JSON.stringify(fc));
      await p.goto(`${BASE}/events/${slug}/checkin?from=control`, { waitUntil: 'domcontentloaded' });
      await until(async () => (await p.locator('[data-testid=focus-header]').count()) > 0);
      fc = await focusChrome(p);
      check(`4 [${view}] the check-in desk from Event Control: focus layout, Exit to Event Control`, fc.focusHeader && fc.exit === 'Exit to Event Control', JSON.stringify(fc));
      await shot(p, `desk-signed-out-${view}`);
      await p.goto(`${BASE}/events/${slug}/arena`, { waitUntil: 'domcontentloaded' });
      await sleep(3000);
      const arena = await text(p);
      check(`4 [${view}] the big screen renders and carries no counter data`, (await p.locator('#root *').count()) > 0 && !/counter|tally|operator|learn/i.test(arena), arena.slice(0, 200));
      await p.goto(`${BASE}/events/${slug}/announcer`, { waitUntil: 'domcontentloaded' });
      await sleep(2500);
      check(`4 [${view}] the announcer view renders (signed out it asks for the announcer's device or account)`, (await p.locator('#root *').count()) > 0 && p.errors.length === 0, p.errors.join(' | '));
      await p.goto(`${BASE}/platform/devices`, { waitUntil: 'domcontentloaded' });
      check(`4 [${view}] Platform › Devices refuses a visitor plainly`, await until(async () => /platform owner|sign in/i.test(await text(p))), (await text(p)).slice(0, 160));
      // -------------------------------------------------------------- 5. the device sign-in page, and a scan that cannot work (the real function answers)
      await p.goto(`${BASE}/device`, { waitUntil: 'domcontentloaded' });
      check(`5 [${view}] the device sign-in page renders its code entry`, await until(async () => (await p.locator('#ds-code').count()) > 0), (await text(p)).slice(0, 120));
      await shot(p, `device-signin-${view}`);
      await p.goto(`${BASE}/device#c=ZZZZZZZZZZZZ`, { waitUntil: 'domcontentloaded' });
      const refused = await until(async () => /did not work/i.test(await text(p)), 20000);
      check(`5 [${view}] a QR link with a code that cannot exist is refused by the deployed function (from the real origin), with the plain message and the fragment gone`, refused && !p.url().includes('#c='), `${p.url()} ${(await text(p)).slice(0, 160)}`);
      check(`5 [${view}] no page errors on the workstations and the device page`, p.errors.length === 0, p.errors.join(' | '));
    }
    await p.context().close();
  }

} catch (e) {
  check('the run completed without an unexpected error', false, e && e.stack ? e.stack : String(e));
} finally {
  await browser.close();
  const bad = results.filter(r => r.ok === false);
  console.log(`\n${results.filter(r => r.ok === true).length} passed, ${bad.length} failed, ${results.filter(r => r.ok === null).length} skipped of ${results.length}`);
  if (bad.length) console.log('FAILED:\n' + bad.map(r => ' - ' + r.name).join('\n'));
  process.exit(bad.length ? 1 : 0);
}
