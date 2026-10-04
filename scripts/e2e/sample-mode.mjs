// Drives the REAL built app in a REAL Chromium at phone size against a mocked Supabase (scripts/e2e/mock-rest.mjs) and checks that sample mode
// persists in this browser until it is switched off: ?sample=1, refresh, navigation, another tab, a browser restart (storage state carried
// into a new context, sessionStorage not), signing out; the owner's switch under Platform; Leave sample mode; ?sample=0; first visitors stay off;
// a non-owner never sees the switch; the sample EventPage only opens in sample mode.
//   VITE_BASE=/ npx vite build --outDir /tmp/e2e-dist && npx vite preview --outDir /tmp/e2e-dist --port 4180 &
//   E2E_BASE=http://localhost:4180 node scripts/e2e/sample-mode.mjs
import { chromium } from 'playwright-core';
import { IDS, REF, createMock, sessionFor, storageKey } from './mock-rest.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4180';
const SHOTS = process.env.E2E_SHOTS;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 300)}`); };
const ON_TEXT = 'Sample mode is ON. Invented teams, fighters, events and scores may be shown.'.toLowerCase();
const OFF_TEXT = 'Sample mode is OFF.'.toLowerCase();

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const mock = createMock();
const errors = [];
async function newContext(storageState) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block', ...(storageState ? { storageState } : {}) });
  await ctx.route(`https://${REF}.supabase.co/**`, mock.handle);
  await ctx.route('https://maps.googleapis.com/**', r => r.abort('failed'));
  await ctx.route(/posthog\.com/, r => r.abort('failed'));
  return ctx;
}
async function newPage(ctx) { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e).slice(0, 200))); return p; }
// innerText follows CSS text-transform, so text is compared in lower case. The banner is found by its element, not its words.
const text = async (p) => (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).toLowerCase();
const banner = (p) => p.evaluate(() => !!document.querySelector('.mockflag'));
const stored = (p) => p.evaluate(() => localStorage.getItem('bos-sample'));
const go = async (p, path) => { await p.goto(`${BASE}${path}`); await p.waitForLoadState('networkidle'); };
const settle = (p) => p.waitForTimeout(300);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/sample-${name}.png`, fullPage: true }); };

try {
  // ---------------------------------------------------------------- a first-time visitor
  const fresh = await newContext();
  const v = await newPage(fresh);
  await go(v, '/');
  check('first-time visitor: no sample banner', !(await banner(v)));
  check('first-time visitor: nothing stored', (await stored(v)) === null);
  await go(v, '/events/prairie-steel-open');
  check('first-time visitor: a sample event id opens the real workspace, not the sample hub', !(await text(v)).includes('Prairie Steel Open'.toLowerCase()), await text(v));
  await fresh.close();

  // ---------------------------------------------------------------- ?sample=1 persists
  const ctx = await newContext();
  const p = await newPage(ctx);
  await go(p, '/?sample=1');
  check('?sample=1 shows the sample banner', await banner(p));
  check('?sample=1 stores the setting in localStorage', (await stored(p)) === '1');
  check('?sample=1 is removed from the address once applied', !p.url().includes('sample='), p.url());
  await shot(p, 'on-home');
  await p.reload(); await p.waitForLoadState('networkidle');
  check('refresh keeps sample mode on', await banner(p));
  await p.getByRole('link', { name: 'Events' }).first().click(); await p.waitForLoadState('networkidle');
  check('in-app navigation keeps sample mode on', await banner(p) && p.url().includes('/events'), p.url());
  await go(p, '/rankings');
  check('opening another page directly keeps sample mode on', await banner(p));
  await go(p, '/events/prairie-steel-open');
  check('sample mode: a sample event id opens the sample EventPage', (await text(p)).includes('Prairie Steel Open'.toLowerCase()));
  const p2 = await newPage(ctx);
  await go(p2, '/teams');
  check('another tab opens with sample mode on', await banner(p2));

  // ---------------------------------------------------------------- browser restart: localStorage survives, sessionStorage does not
  const state = await ctx.storageState();
  const reopened = await newContext(state);
  const r = await newPage(reopened);
  await go(r, '/');
  check('after a browser restart (storage carried, session gone) sample mode is still on', await banner(r));
  check('the restarted browser has no session copy of the flag', (await r.evaluate(() => sessionStorage.getItem('bos-sample'))) === null);
  await reopened.close();

  // ---------------------------------------------------------------- signing in and out does not touch it
  await p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, sessionFor(IDS.owner, 'owner@example.test')]);
  await go(p, '/account');
  check('signed in as the owner: sample mode still on', await banner(p));
  await p.getByRole('button', { name: 'Sign out' }).click(); await p.waitForLoadState('networkidle'); await settle(p);
  check('after signing out: sample mode still on', await banner(p) && (await stored(p)) === '1');
  await p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, sessionFor(IDS.owner, 'owner@example.test')]);

  // ---------------------------------------------------------------- the owner's switch
  await go(p, '/platform');
  const plat = await text(p);
  check('Platform shows the Test / sample mode switch to the owner', plat.includes('Test / sample mode'.toLowerCase()), plat);
  check('the switch says sample mode is ON', plat.includes(ON_TEXT), plat);
  await shot(p, 'platform-on');
  await p.getByRole('button', { name: 'Disable sample mode' }).click(); await settle(p);
  check('Disable: the banner disappears immediately (no reload)', !(await banner(p)));
  check('Disable: the switch says sample mode is OFF', (await text(p)).includes(OFF_TEXT));
  check('Disable: the stored setting is cleared', (await stored(p)) === null);
  await shot(p, 'platform-off');
  await p2.waitForTimeout(300);
  check('Disable: the other open tab follows at once', !(await banner(p2)));
  await go(p2, '/events/prairie-steel-open');
  check('after Disable: a sample event id opens the real workspace again', !(await text(p2)).includes('Prairie Steel Open'.toLowerCase()));
  await p.reload(); await p.waitForLoadState('networkidle');
  check('after Disable + refresh: still off', !(await banner(p)) && (await text(p)).includes(OFF_TEXT));
  await p.getByRole('button', { name: 'Enable sample mode' }).click(); await settle(p);
  check('Enable: the banner appears immediately and the setting is stored', await banner(p) && (await stored(p)) === '1' && (await text(p)).includes(ON_TEXT));
  await p.reload(); await p.waitForLoadState('networkidle');
  check('Enable + refresh: still on', await banner(p));

  // ---------------------------------------------------------------- Leave sample mode (banner) and ?sample=0
  await go(p, '/events');
  await p.getByRole('button', { name: 'Leave sample mode' }).click(); await settle(p);
  check('Leave sample mode: banner gone immediately and setting cleared', !(await banner(p)) && (await stored(p)) === null);
  await p.reload(); await p.waitForLoadState('networkidle');
  check('Leave sample mode + refresh: still off', !(await banner(p)));
  await go(p, '/?sample=1');
  check('?sample=1 again: on', await banner(p));
  await p.getByRole('button', { name: 'Leave sample mode' }).click(); await settle(p);
  await p.reload(); await p.waitForLoadState('networkidle');
  check('Leave sample mode on a page opened with ?sample=1, then refresh: stays off', !(await banner(p)) && (await stored(p)) === null, p.url());
  await go(p, '/?sample=1');
  await go(p, '/teams?sample=0');
  check('?sample=0 turns it off and clears the setting', !(await banner(p)) && (await stored(p)) === null);
  await go(p, '/');
  check('after ?sample=0, later pages stay off', !(await banner(p)));
  await ctx.close();

  // ---------------------------------------------------------------- a signed-in non-owner never sees the switch
  const sctx = await newContext();
  const s = await newPage(sctx);
  await go(s, '/');
  await s.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, sessionFor(IDS.stranger, 'stranger@example.test')]);
  await go(s, '/platform');
  const st = await text(s);
  check('a non-owner on /platform does not get the sample switch', !st.includes('Test / sample mode'.toLowerCase()) && !st.includes('Enable sample mode'.toLowerCase()), st);
  check('a non-owner stays out of sample mode', !(await banner(s)) && (await stored(s)) === null);
  await sctx.close();
} catch (e) {
  check('script ran to the end', false, e.stack ?? e);
}
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
