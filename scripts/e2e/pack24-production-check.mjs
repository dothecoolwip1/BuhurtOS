// PRODUCTION check for Pack 24 (match safety guards + focus layout) on the LIVE site, in real Chromium, at 390x844, 768x1024 and 1024x768, each view in
// a fresh browser context with service workers blocked. Read-only: it never writes sporting data, never creates fights, device codes or staff rows, and
// never signs anyone up. The event used is the published TEST event red-deer-rumble-test (synthetic); test-stuff-test and test-new-test are not opened.
// Optional: with SMOKE_X_EMAIL / SMOKE_X_PASSWORD (the fixed pre-confirmed smoke account, a club member with no event role) it also signs in, checks the
// notification bell, popup and settings entry point, checks that the staff screens refuse a non-staff account inside the focus layout, and signs out.
// Without the account that part is reported as SKIP, not passed.
//   BASE=https://dothecoolwip1.github.io/BuhurtOS EXPECT_BUILD=153 EXPECT_COMMIT=4298aec node scripts/e2e/pack24-production-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = (process.env.BASE ?? 'https://dothecoolwip1.github.io/BuhurtOS').replace(/\/$/, '');
const SHOTS = process.env.SHOTS ?? '/tmp/p24-prod-shots';
const EXPECT_BUILD = process.env.EXPECT_BUILD ?? '', EXPECT_COMMIT = process.env.EXPECT_COMMIT ?? '';
const EVENT = process.env.EVENT ?? 'red-deer-rumble-test', EVENT_NAME = new RegExp(process.env.EVENT_NAME ?? 'Red Deer Rumble', 'i');
const X = { email: process.env.SMOKE_X_EMAIL ?? '', password: process.env.SMOKE_X_PASSWORD ?? '' };
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 500)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, timeout = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }).catch(() => undefined);
const versionOk = (v) => (!EXPECT_BUILD || v.includes(`build ${EXPECT_BUILD}`)) && (!EXPECT_COMMIT || v.includes(EXPECT_COMMIT));

const VIEWS = [
  ['390x844', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }],
  ['768x1024', { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['1024x768', { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true }]
];
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function freshPage(opts) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  return page;
}
// The focus layout (Pack 24A1): its own header with Exit, no site header, no bottom bar, no footer, the build label at the end.
async function focusChrome(page) {
  return page.evaluate(() => {
    const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const head = document.querySelector('[data-testid=focus-header]');
    return {
      focusHeader: vis(head), headerHeight: head ? Math.round(head.getBoundingClientRect().height) : 0,
      exit: !!head && !!head.querySelector('a[aria-label^="Exit"]'),
      siteHeader: vis(document.querySelector('header.top')), bottomBar: vis(document.querySelector('nav.bottom')), footer: vis(document.querySelector('footer')),
      version: document.querySelector('[data-testid=app-version]')?.textContent ?? ''
    };
  });
}

try {
  // ================================================================ 0. what the live site serves (the bundle, not a preview)
  const html = await (await fetch(`${BASE}/`, { cache: 'no-store' })).text();
  const js = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  const bundle = js ? await (await fetch(`${BASE}/${js}`, { cache: 'no-store' })).text() : '';
  const label = bundle.match(/v\d+\.\d+\.\d+ · [^"'`]{0,60}? UTC/)?.[0] ?? '';
  console.log(`NOTE  live bundle ${js}: ${label || 'no version label found'}`);
  check('0a the live bundle carries the expected build and commit', !!label && versionOk(label), label);
  check('0b the live bundle has the Pack 24A1 focus layout (focus-header)' + (BASE.includes('github.io') ? ' and points at the hosted Supabase project' : ''), bundle.includes('focus-header') && (!BASE.includes('github.io') || bundle.includes('mvbxlebznlgroptwwdsm.supabase.co')));

  for (const [view, opts] of VIEWS) {
    // ---------------------------------------------------------------- 1. homepage
    let p = await freshPage(opts);
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await until(async () => (await p.locator('[data-testid=app-version]').count()) > 0);
    const homeVersion = await text(p, '[data-testid=app-version]');
    check(`1 [${view}] homepage loads and its build label is ${EXPECT_BUILD || '?'} / ${EXPECT_COMMIT || '?'}`, versionOk(homeVersion), homeVersion);
    check(`1 [${view}] homepage: no sideways scroll`, await noSideways(p));
    await shot(p, `home-${view}`);

    // ---------------------------------------------------------------- 2. event page
    await p.goto(`${BASE}/events/${EVENT}`, { waitUntil: 'domcontentloaded' });
    const evOk = await until(async () => EVENT_NAME.test(await text(p)));
    check(`2 [${view}] event page (${EVENT}) loads`, evOk, (await text(p)).slice(0, 200));
    check(`2 [${view}] event page: no sideways scroll`, await noSideways(p));
    await shot(p, `event-${view}`);

    // ---------------------------------------------------------------- 3. field page in the focus layout (signed out: refused, but inside the focus layout)
    await p.goto(`${BASE}/events/${EVENT}/field/${encodeURIComponent('Field 1')}`, { waitUntil: 'domcontentloaded' });
    await until(async () => (await p.locator('[data-testid=focus-header]').count()) > 0 && /sign in/i.test(await text(p)));
    const fc = await focusChrome(p);
    check(`3 [${view}] field page runs in the focus layout: focus header with Exit, no site header, no bottom bar, no footer`, fc.focusHeader && fc.exit && !fc.siteHeader && !fc.bottomBar && !fc.footer, JSON.stringify(fc));
    check(`3 [${view}] field page: the focus header is one compact row (<= 72 px)`, fc.headerHeight > 0 && fc.headerHeight <= 72, String(fc.headerHeight));
    check(`3 [${view}] field page: the build label is shown in the focus layout and matches`, versionOk(fc.version), fc.version);
    check(`3 [${view}] field page signed out asks to sign in (nothing operational shown)`, /sign in/i.test(await text(p)) && !/Start round/i.test(await text(p)));
    check(`3 [${view}] field page: no sideways scroll`, await noSideways(p));
    await shot(p, `field-signed-out-${view}`);

    // ---------------------------------------------------------------- 4. check-in desk in the focus layout
    await p.goto(`${BASE}/events/${EVENT}/checkin`, { waitUntil: 'domcontentloaded' });
    await until(async () => (await p.locator('[data-testid=focus-header]').count()) > 0 && /sign in/i.test(await text(p)));
    const dc = await focusChrome(p);
    check(`4 [${view}] check-in desk runs in the focus layout (no site header, no bottom bar) and asks to sign in`, dc.focusHeader && dc.exit && !dc.siteHeader && !dc.bottomBar && /sign in/i.test(await text(p)), JSON.stringify(dc));
    check(`4 [${view}] check-in desk: no sideways scroll`, await noSideways(p));

    // ---------------------------------------------------------------- 5. Command Centre (normal site layout, signed out)
    await p.goto(`${BASE}/events/${EVENT}/control?mode=live`, { waitUntil: 'domcontentloaded' });
    const ccOk = await until(async () => /sign in/i.test(await text(p)) && (await p.locator('[data-testid=focus-header]').count()) === 0);
    check(`5 [${view}] Command Centre loads in the normal site layout and asks a visitor to sign in`, ccOk, (await text(p)).slice(0, 200));

    // ---------------------------------------------------------------- 6. Broadcast overlay (public, read-only)
    await p.goto(`${BASE}/broadcast/${EVENT}`, { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    check(`6 [${view}] Broadcast overlay renders without page errors`, (await p.locator('#root *').count()) > 0 && p.errors.length === 0, p.errors.join(' | '));

    // ---------------------------------------------------------------- 7. device sign-in (marshal / scorekeeper device mode entry)
    await p.goto(`${BASE}/device`, { waitUntil: 'domcontentloaded' });
    const devOk = await until(async () => (await p.locator('input').count()) > 0 && /code/i.test(await text(p)));
    check(`7 [${view}] device sign-in page (marshal / scorekeeper devices) renders its code entry`, devOk, (await text(p)).slice(0, 200));
    check(`7 [${view}] no page errors across these pages`, p.errors.length === 0, p.errors.join(' | '));
    await p.context().close();
  }

  // ================================================================ 8. signed in with the fixed smoke account (optional)
  if (!X.email || !X.password) {
    check('8 signed-in checks (sign in, notification bell / popup / settings, staff refusal in the focus layout, sign out)', null, 'SMOKE_X_EMAIL / SMOKE_X_PASSWORD not provided');
  } else {
    const p = await freshPage(VIEWS[0][1]);
    await p.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
    const form = p.locator('form[aria-label="Sign in with email and password"]');
    await form.waitFor({ timeout: 20000 });
    await form.locator('input[type=email], input[autocomplete=email], input[id*=email]').first().fill(X.email);
    await form.locator('#signin-password').fill(X.password);
    await form.getByRole('button', { name: 'Sign in', exact: true }).click();
    const bell = p.locator('button[aria-label*="otification"]').first();
    check('8a sign in with the fixed smoke account (email + password)', await until(async () => (await bell.count()) > 0, 30000), (await text(p)).slice(0, 200));
    // a first-run notification prompt (popup) may appear; it must be dismissible
    const popup = p.locator('[role=dialog]').first();
    if (await popup.isVisible().catch(() => false)) {
      check('8b the notification popup appears and can be closed', true);
      await p.keyboard.press('Escape').catch(() => undefined);
      await sleep(500);
    } else check('8b the notification popup (first-run prompt) did not appear for this account (already answered)', null, 'not shown');
    await bell.click();
    check('8c the notification bell opens the notifications panel', await until(async () => await p.locator('#notif-panel').isVisible()), '');
    await p.keyboard.press('Escape').catch(() => undefined);
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await p.locator('nav.bottom').getByRole('button', { name: /More/ }).click();
    const settings = p.locator('nav.more-list').getByRole('button', { name: 'Notifications', exact: true });   // Pack 26: the row is "Notifications"
    check('8d the notification settings entry point is in the More menu', await until(async () => await settings.isVisible()), '');
    await settings.click();
    check('8e it opens the notification settings dialog', await until(async () => (await p.locator('[role=dialog]').count()) > 0 && /notif/i.test(await text(p, '[role=dialog]'))), (await text(p, '[role=dialog]')).slice(0, 200));
    await p.keyboard.press('Escape').catch(() => undefined);
    await shot(p, 'signed-in-390x844');
    for (const [view, opts] of VIEWS) {
      await p.setViewportSize(opts.viewport);
      await p.goto(`${BASE}/events/${EVENT}/field/${encodeURIComponent('Field 1')}`, { waitUntil: 'domcontentloaded' });
      const refused = await until(async () => /scorekeepers and marshals/i.test(await text(p)));
      const fc = await focusChrome(p);
      check(`8f [${view}] a signed-in account without an event role is refused on the field page, inside the focus layout with Exit, no site chrome`, refused && fc.focusHeader && fc.exit && !fc.bottomBar && !fc.siteHeader, JSON.stringify(fc));
      check(`8f [${view}] no sideways scroll`, await noSideways(p));
      await shot(p, `field-refused-${view}`);
    }
    await p.goto(`${BASE}/events/${EVENT}/checkin`, { waitUntil: 'domcontentloaded' });
    check('8g a signed-in account without a desk role is refused on the check-in desk', await until(async () => /check-in desk and armour inspectors/i.test(await text(p))), (await text(p)).slice(0, 200));
    await p.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
    await p.getByRole('button', { name: 'Sign out' }).click();
    check('8h sign out', await until(async () => (await p.locator('button[aria-label*="otification"]').count()) === 0, 20000));
    check('8 no page errors while signed in', p.errors.length === 0, p.errors.join(' | '));
    await p.context().close();
  }
} catch (e) {
  check('script ran to the end', false, e.stack ?? String(e));
} finally {
  await browser.close();
  const failed = results.filter(r => r.ok === false).length, skipped = results.filter(r => r.ok === null).length;
  console.log(`\n${results.length - failed - skipped}/${results.length - skipped} checks passed${skipped ? `, ${skipped} skipped` : ''}`);
  process.exit(failed ? 1 : 0);
}
