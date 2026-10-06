// Pack 18 against a REAL local stack with the REAL Supabase Auth server (scripts/e2e/pack18-live.sh): Postgres built from every migration on top of
// Auth's own schema, PostgREST, Supabase Auth (GoTrue) with a local mail sink, and the real built app in real Chromium.
//   Part A: email + password sign-in, sign-up with email confirmation, forgot / reset password, change password (including Supabase's reauthentication
//           code), destinations kept through sign-in, existing accounts (fixture + the hosted test-login seed) unchanged, no account enumeration.
//   Part B: the Organizer Command Centre on a realistic event (two fields, a running and a paused Lyst, a result conflict, fighters missing / not
//           checked in / needing armour correction / ready after reinspection), deep links, live changes, permissions, and that viewing writes nothing.
// LOCAL EVIDENCE ONLY (needs a PostgREST binary and a Supabase Auth binary; not part of CI).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, DB = process.env.PGDATABASE, MAIL = process.env.MAILSINK;
if (!MAIL) { console.error('MAILSINK is not set: run through scripts/e2e/pack18-live.sh (REAL_AUTH=1)'); process.exit(2); }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const PW = 'Fixture-pass-18';
const EVENT = '00000000-0000-0000-0000-00000000ed01', OTHER = '00000000-0000-0000-0000-00000000ed02';
const REG = (n) => `00000000-0000-0000-0000-00000000ae0${n}`;   // 1 Aldric, 2 Brann, 3 Cael, 4 Dara
const MID = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const EM = { organizer: 'u2@example.test', scorekeeper: 'u4@example.test', stranger: 'u7@example.test', head: 'c1@example.test', desk: 'd1@example.test', inspector: 'd2@example.test',
  captain: 'd3@example.test', otherDesk: 'd4@example.test', brann: 'fighter2@example.test', codeOnly: 'c7@example.test' };
const SLUG = 'test-stuff-test', CMD = `/events/${SLUG}/command`;

// ---- the real Auth server and the database, as a device would use them
const tokens = new Map();
async function token(email, password = PW) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x' }, body: JSON.stringify({ email, password }) });
  const b = await r.json().catch(() => ({}));
  return { status: r.status, token: b.access_token ?? null, body: b };
}
async function bearer(who) { if (!tokens.has(who)) tokens.set(who, (await token(EM[who])).token); return tokens.get(who); }
async function rpc(who, fn, args) {
  const headers = { 'content-type': 'application/json', apikey: 'x', ...(who ? { authorization: `Bearer ${await bearer(who)}` } : {}) };
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const refused = (r) => r.status >= 400 && r.status < 500;
const mail = async () => (await (await fetch(`${MAIL}/`)).json());
const clearMail = async () => { await fetch(`${MAIL}/`, { method: 'DELETE' }); };
const mailTo = async (email, wait = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < wait) { const m = (await mail()).filter(x => x.to.includes(email)); if (m.length) return m; await sleep(250); } return []; };
const linkIn = (m) => m.links.find(l => /\/auth\/v1\/verify/.test(l));
const codeIn = (m) => (/code: (\d{6})/.exec(m.text) ?? /<p>\s*(\d{6})\s*<\/p>/.exec(m.text))?.[1] ?? null;

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, desktop: { viewport: { width: 1280, height: 900 } } };
async function open(kind = 'phone') {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|accounts\.google\.com/, r => r.abort('failed'));
  const page = await ctx.newPage();
  page.ctx = ctx; page.errors = []; page.tokenCalls = 0;
  page.on('request', r => { if (/\/auth\/v1\/token\?grant_type=password/.test(r.url())) page.tokenCalls++; });
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|net::ERR|Failed to fetch|40[0-9]|42501|\[BuhurtOS\]|AuthApiError|AuthPKCE|AuthRetryable/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  return page;
}
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = async (page, name, full = true) => { if (SHOTS) { await sleep(350); await page.screenshot({ path: `${SHOTS}/p18-${name}.png`, fullPage: full }).catch(() => undefined); } };
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const until = async (fn, timeout = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const path = (page) => { const u = new URL(page.url()); return u.pathname + u.search + u.hash; };
async function signInHere(page, email, password = PW) {
  const form = page.getByRole('form', { name: 'Sign in with email and password' });
  await form.getByLabel('Email', { exact: true }).fill(email);
  await form.getByLabel('Password', { exact: true }).fill(password);
  await form.getByRole('button', { name: 'Sign in' }).click();
}
const signedIn = (page) => page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token') && JSON.parse(localStorage.getItem(k) ?? 'null')?.access_token));
async function signOutVia(page) {
  await page.goto(BASE + '/account');
  // an account still in its first-sign-in step is kept on /welcome by the existing gate: then forget the session in this browser instead
  const clicked = await page.getByRole('button', { name: 'Sign out' }).click({ timeout: 6000 }).then(() => true, () => false);
  if (!clicked || !(await until(async () => !(await signedIn(page)), 5000))) { await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k); }); await page.goto(BASE + '/account'); }
  await until(async () => !(await signedIn(page)));
}

const pages = [];
try {
  const usersBefore = Number(sql('select count(*) from auth.users'));
  const linksBefore = sql('select md5(string_agg(fighter_id::text || user_id::text, \',\' order by fighter_id, user_id)) from public.fighter_accounts');
  const staffBefore = sql('select md5(string_agg(event_id::text || user_id::text || role, \',\' order by event_id, user_id, role)) from public.event_staff');

  // =================================================================================== PART A: email + password
  const a = await open('phone'); pages.push(a);
  await a.goto(BASE + CMD);
  const form = a.getByRole('form', { name: 'Sign in with email and password' });
  await form.waitFor({ timeout: 30000 });
  check('A1. signed out, the Command Centre address shows a normal sign-in in place: Email, Password, Sign in, Forgot password?, Create account',
    (await form.getByLabel('Email', { exact: true }).count()) === 1 && (await form.getByLabel('Password', { exact: true }).count()) === 1 && (await form.getByRole('button', { name: 'Sign in' }).count()) === 1
    && (await a.getByRole('button', { name: 'Forgot password?' }).count()) === 1 && (await a.getByRole('button', { name: 'Create account' }).count()) === 1);
  check('A2. password-manager semantics: username + current-password; the email code and Google stay as other ways',
    (await form.getByLabel('Email', { exact: true }).getAttribute('autocomplete')) === 'username' && (await form.getByLabel('Password', { exact: true }).getAttribute('autocomplete')) === 'current-password'
    && /Email me a sign-in code/.test(await text(a, '.auth-card')) && /Continue with Google/.test(await text(a, '.auth-card')));
  check('A3. 390x844: no sideways scroll on the sign-in', await noSideways(a));
  await shot(a, '01-sign-in-phone');
  await form.getByLabel('Password', { exact: true }).fill('abc');
  await a.getByRole('button', { name: 'Show password' }).click();
  check('A4. show / hide password', (await form.getByLabel('Password', { exact: true }).getAttribute('type')) === 'text' && (await a.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')) === 'true');
  await a.getByRole('button', { name: 'Hide password' }).click();
  await signInHere(a, EM.organizer, 'wrong-password-123');
  const wrong = await until(async () => (await a.getByRole('alert').count()) > 0) ? await text(a, '.auth-error') : '';
  await signInHere(a, 'nobody-here@example.test', 'wrong-password-123');
  await sleep(1200);
  const unknown = await text(a, '.auth-error');
  check('A5. a wrong password and an unknown email get the SAME answer (no enumeration), and nobody is signed in', wrong.length > 10 && wrong === unknown && !(await signedIn(a)), `${wrong} | ${unknown}`);
  a.tokenCalls = 0;
  await form.getByLabel('Email', { exact: true }).fill(EM.organizer);
  await form.getByLabel('Password', { exact: true }).fill(PW);
  const btn = form.getByRole('button', { name: 'Sign in' });
  // two taps in the same instant (before the page can re-render) and Enter: the busy guard must let only one request out
  await btn.evaluate(el => { el.click(); el.click(); el.closest('form')?.requestSubmit(); });
  await until(async () => (await a.locator('.cc').count()) === 1, 20000);
  check('A6. Sign in (button and Enter pressed together) sends ONE request; the organizer lands on the page they asked for (the Command Centre)', a.tokenCalls === 1 && path(a) === CMD && (await a.locator('.cc').count()) === 1, `${a.tokenCalls} calls, at ${path(a)}`);
  await signOutVia(a);
  check('A7. sign out clears the session', !(await signedIn(a)));
  await a.goto(BASE + '/account');
  await signInHere(a, EM.organizer);
  check('A8. sign in again works (Account page)', await until(async () => /Sign out/.test(await text(a))));
  await signOutVia(a);

  // Pack 15: a fight alert lands on the event page; sign in there; you stay there
  await a.goto(BASE + `/events/${SLUG}#my-next-fight`);
  await a.locator('#my-next-fight').getByRole('form', { name: 'Sign in with email and password' }).waitFor({ timeout: 20000 });
  await a.locator('#my-next-fight').getByLabel('Email', { exact: true }).fill(EM.brann);
  await a.locator('#my-next-fight').getByLabel('Password', { exact: true }).fill(PW);
  await a.locator('#my-next-fight').getByRole('button', { name: 'Sign in' }).click();
  check('A9. Pack 15 fight-alert landing: sign in on the event page and stay there (#my-next-fight kept)', await until(async () => (await signedIn(a)) && path(a) === `/events/${SLUG}#my-next-fight`, 15000), path(a));
  await signOutVia(a);
  await a.goto(BASE + '/sign-in?next=%2Fmy-events');
  await signInHere(a, EM.organizer);
  check('A10. /sign-in?next=/my-events returns to My events after signing in', await until(async () => path(a) === '/my-events'), path(a));
  await signOutVia(a);
  await a.goto(BASE + '/sign-in?next=https%3A%2F%2Fevil.example%2F');
  await signInHere(a, EM.organizer);
  check('A11. an outside "next" is never followed (goes home instead)', await until(async () => new URL(a.page?.url?.() ?? a.url()).origin === new URL(BASE).origin && path(a) === '/'), a.url());
  await signOutVia(a);

  // the hosted test-login seed, exactly as committed (passwords filled in), on the real Auth server
  const seed = readFileSync('supabase/seed/test_logins.sql', 'utf8').replace(/SET-A-PASSWORD-FOR-([A-Z]+)/g, (_, r) => `Seed-${r.toLowerCase()}-pass-1`);
  writeFileSync('/tmp/p18-test-logins.sql', seed);
  execFileSync('psql', ['-X', '-q', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-f', '/tmp/p18-test-logins.sql']);
  const seeded = await Promise.all(['fighter', 'captain', 'organizer', 'orgadmin', 'scorekeeper', 'newuser'].map(async r => (await token(`${r}@buhurtos.ca`, `Seed-${r}-pass-1`)).status));
  check('A12. the existing test accounts (supabase/seed/test_logins.sql) all sign in through the real Auth server', seeded.every(s => s === 200), seeded.join(','));
  await a.goto(BASE + '/account');
  await signInHere(a, 'newuser@buhurtos.ca', 'Seed-newuser-pass-1');
  check('A13. ... and the not-yet-set-up test account is taken to the existing first-sign-in step (/welcome)', await until(async () => path(a).startsWith('/welcome'), 15000), path(a));
  await signOutVia(a);

  // create an account: confirmation email -> back where they started, into the existing onboarding; no fighter record is invented
  const fightersBefore = sql('select count(*) from public.fighters');
  await clearMail();
  await a.goto(BASE + `/sign-in?mode=signup&next=%2Fevents%2F${SLUG}`);
  const su = a.getByRole('form', { name: 'Create an account' });
  await su.getByLabel('Email', { exact: true }).fill('new.fighter@example.test');
  await su.getByLabel('Choose a password', { exact: true }).fill('short');
  await su.getByRole('button', { name: 'Create account' }).click();
  check('A14. sign-up: a too-short password is refused before anything is sent', /at least 8/.test(await text(a, '.auth-error')) && (await mailTo('new.fighter@example.test', 800)).length === 0);
  await su.getByLabel('Choose a password', { exact: true }).fill('New-fighter-pass-1');
  await su.getByRole('button', { name: 'Create account' }).click();
  check('A15. "Check your email" (only after Supabase accepted it), worded without saying whether the address had an account',
    await until(async () => /Check your email/.test(await text(a, '.auth-card'))) && /can be used for a new BuhurtOS account/.test(await text(a, '.auth-card')));
  await shot(a, '02-check-email');
  const conf = (await mailTo('new.fighter@example.test'))[0];
  check('A16. the real Auth server sent the confirmation email', !!conf && !!linkIn(conf), JSON.stringify(conf ?? {}).slice(0, 200));
  await a.goto(linkIn(conf));
  check('A17. the confirmation link returns to BuhurtOS signed in, through the existing first-sign-in step, keeping where they were going',
    await until(async () => (await signedIn(a)) && path(a).startsWith('/welcome') && path(a).includes(encodeURIComponent(`/events/${SLUG}`)), 20000), path(a));
  check('A18. a profile row was created by the existing trigger; NO fighter record or claim was invented', sql(`select count(*) from public.profiles p join auth.users u on u.id = p.id where u.email = 'new.fighter@example.test'`) === '1'
    && sql('select count(*) from public.fighters') === fightersBefore && sql(`select count(*) from public.fighter_accounts fa join auth.users u on u.id = fa.user_id where u.email = 'new.fighter@example.test'`) === '0');
  await signOutVia(a);
  await clearMail();
  await a.goto(BASE + '/sign-in?mode=signup');
  await a.getByRole('form', { name: 'Create an account' }).getByLabel('Email', { exact: true }).fill(EM.stranger);
  await a.getByRole('form', { name: 'Create an account' }).getByLabel('Choose a password', { exact: true }).fill('Some-other-pass-1');
  await a.getByRole('form', { name: 'Create an account' }).getByRole('button', { name: 'Create account' }).click();
  check('A19. signing up with an address that already has an account shows the SAME "Check your email" (no enumeration) and creates nothing',
    await until(async () => /Check your email/.test(await text(a, '.auth-card'))) && sql(`select count(*) from auth.users where email = '${EM.stranger}'`) === '1'
    && sql(`select count(*) from auth.users where email = '${EM.stranger}' and encrypted_password = extensions.crypt('Some-other-pass-1', encrypted_password)`) === '0');

  // forgot password -> reset link -> new password
  await clearMail();
  const forgot = async (page, email) => {
    await page.goto(BASE + `/sign-in?next=%2Fmy-events`);
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByRole('form', { name: 'Reset your password' }).getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('form', { name: 'Reset your password' }).getByRole('button', { name: 'Email me a reset link' }).click();
    await until(async () => /Check your email/.test(await text(page, '.auth-card')));
    return (await text(page, '.auth-card')).replace(email, '<email>');
  };
  // the unknown address first: a later request from the same browser replaces the earlier link's one-time key (Supabase PKCE), as the page explains
  const nobody = await forgot(a, 'nobody-here@example.test'), known = await forgot(a, EM.stranger);
  await sleep(1500);
  check('A20. forgot password: the same answer for an account and for an unknown address; an email goes ONLY to the real account',
    known === nobody && (await mailTo(EM.stranger)).length === 1 && (await mailTo('nobody-here@example.test', 500)).length === 0, `${known} | ${nobody}`);
  const reset1 = linkIn((await mailTo(EM.stranger))[0]);
  // the link opened in the SAME browser it was asked from (PKCE): the recovery sign-in, then the new password twice
  await a.goto(reset1);
  const rp = a.getByRole('form', { name: 'Choose a new password' });
  check('A21. the reset link opens BuhurtOS on "Choose a new password" for that account', await until(async () => (await rp.count()) === 1, 20000) && (await text(a, '.auth-card')).includes(EM.stranger), await text(a));
  await a.goto(BASE + `/events/${SLUG}`); await a.goto(BASE + '/reset-password?next=%2Fmy-events');
  check('A22. leaving and coming back keeps the reset possible (the recovery sign-in lasts)', await until(async () => (await rp.count()) === 1));
  await rp.getByLabel('New password', { exact: true }).fill('Brand-new-pass-1');
  await rp.getByLabel('Confirm new password', { exact: true }).fill('Brand-new-pass-2');
  await rp.getByRole('button', { name: 'Save password' }).click();
  check('A23. mismatched copies are refused before saving', /do not match/.test(await text(a, '.auth-error')));
  await rp.getByLabel('Confirm new password', { exact: true }).fill('Brand-new-pass-1');
  await rp.getByRole('button', { name: 'Save password' }).click();
  check('A24. password saved, with an obvious way on', await until(async () => /Password saved/.test(await text(a, '.auth-card'))) && (await a.getByRole('button', { name: 'Continue where you were' }).count()) === 1);
  await shot(a, '03-reset-saved');
  await a.getByRole('button', { name: 'Continue where you were' }).click();
  check('A25. ... Continue goes where they were going (/my-events)', await until(async () => path(a) === '/my-events'), path(a));
  check('A26. the new password signs in; the old one no longer does', (await token(EM.stranger, 'Brand-new-pass-1')).status === 200 && (await token(EM.stranger, PW)).status === 400);
  await signOutVia(a);
  const b = await open('phone'); pages.push(b);
  await b.goto(reset1);
  check('A27. the same reset link used again: explained (expired or already used), with a way to get a new one',
    await until(async () => /expired|already used|could not be used|different browser/i.test(await text(b, '.auth-card')), 20000) && (await b.getByRole('form', { name: 'Send a new reset link' }).count()) === 1, await text(b, '.auth-card'));
  await shot(b, '04-reset-link-used');
  await clearMail();
  await forgot(a, EM.stranger);
  const reset2 = linkIn((await mailTo(EM.stranger))[0]);
  await b.goto(reset2);
  check('A28. a fresh link opened in a DIFFERENT browser than the one that asked: explained, not a silent failure',
    await until(async () => /different browser|expired|already used/i.test(await text(b, '.auth-card')), 20000) && (await b.getByRole('form', { name: 'Choose a new password' }).count()) === 0, await text(b, '.auth-card'));
  // asking again straight away hits Supabase's per-address limit, which only exists for real accounts: the answer must still be the ordinary one
  const again = await forgot(a, EM.stranger);
  check('A28b. asking again within the limit: the same answer as for any address (Supabase\'s "too soon" for real accounts is not shown)', again === nobody, `${again} | ${nobody}`);
  await sleep(1500); await clearMail();
  await forgot(a, EM.stranger);
  const reset3 = linkIn((await mailTo(EM.stranger))[0]);
  sql(`update auth.one_time_tokens set created_at = now() - interval '2 days' where relates_to = '${EM.stranger}' and token_type = 'recovery_token'`);
  sql(`update auth.users set recovery_sent_at = now() - interval '2 days' where email = '${EM.stranger}'`);
  await a.goto(reset3);
  check('A29. an EXPIRED link: explained, with a new-link form', await until(async () => /expired|already used|could not be used/i.test(await text(a, '.auth-card')), 20000) && (await a.getByRole('form', { name: 'Send a new reset link' }).count()) === 1, await text(a, '.auth-card'));
  await b.ctx.close();

  // change password while signed in (Account › Password)
  await a.goto(BASE + '/account');
  await signInHere(a, EM.stranger, 'Brand-new-pass-1');
  await until(async () => /Sign out/.test(await text(a)));
  await a.locator('#password summary').click();
  const cp = a.getByRole('form', { name: 'Change password' });
  await cp.getByLabel('Current password', { exact: true }).fill('not-my-password-1');
  await cp.getByLabel('New password', { exact: true }).fill('Changed-pass-2');
  await cp.getByLabel('Confirm new password', { exact: true }).fill('Changed-pass-2');
  await cp.getByRole('button', { name: 'Save new password' }).click();
  check('A30. change password: a wrong current password is refused', await until(async () => /current password is not right/.test(await text(a, '#password'))), await text(a, '#password'));
  await cp.getByLabel('Current password', { exact: true }).fill('Brand-new-pass-1');
  await cp.getByRole('button', { name: 'Save new password' }).click();
  check('A31. ... the right one changes it', await until(async () => /Password changed/.test(await text(a, '#password'))) && (await token(EM.stranger, 'Changed-pass-2')).status === 200 && (await token(EM.stranger, 'Brand-new-pass-1')).status === 400);
  check('A32. Account › Password at 390x844: no sideways scroll', await noSideways(a));
  await shot(a, '05-change-password');
  await signOutVia(a);

  // an account that has only ever used email codes sets its first password; Supabase asks for reauthentication (session older than 24 h)
  await clearMail();
  await a.goto(BASE + '/account');
  await a.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await a.getByRole('form', { name: 'Sign in with an email code' }).getByLabel('Email', { exact: true }).fill(EM.codeOnly);
  await a.getByRole('form', { name: 'Sign in with an email code' }).getByRole('button', { name: 'Email me a code' }).click();
  const otp = codeIn((await mailTo(EM.codeOnly))[0] ?? { text: '' });
  await a.getByRole('form', { name: 'Enter the email code' }).getByLabel('Code').fill(otp ?? '');
  await a.getByRole('form', { name: 'Enter the email code' }).getByRole('button', { name: 'Sign in' }).click();
  check('A33. the existing email-code sign-in still works (code from the real email)', !!otp && await until(async () => /Sign out/.test(await text(a))), otp);
  sql(`update auth.sessions set created_at = now() - interval '2 days' where user_id = (select id from auth.users where email = '${EM.codeOnly}')`);
  await clearMail();
  await a.locator('#password summary').click();
  await cp.getByLabel('I have never set a password', { exact: false }).check();
  await cp.getByLabel('New password', { exact: true }).fill('First-pass-1');
  await cp.getByLabel('Confirm new password', { exact: true }).fill('First-pass-1');
  await cp.getByRole('button', { name: 'Save new password' }).click();
  const re = await until(async () => /emailed you a code/.test(await text(a, '#password')), 15000);
  const nonce = codeIn((await mailTo(EM.codeOnly))[0] ?? { text: '' });
  check('A34. secure password change: Supabase asks to reauthenticate, a code is emailed and asked for', re && !!nonce, await text(a, '#password'));
  await cp.getByLabel(/emailed you a code/).fill(nonce ?? '');
  await cp.getByRole('button', { name: 'Confirm and save' }).click();
  check('A35. ... with the code, the first password is set and signs in', await until(async () => /Password changed/.test(await text(a, '#password'))) && (await token(EM.codeOnly, 'First-pass-1')).status === 200, await text(a, '#password'));
  await signOutVia(a);

  // offline
  await a.goto(BASE + '/account');
  await a.getByRole('form', { name: 'Sign in with email and password' }).waitFor();
  await a.ctx.setOffline(true);
  await signInHere(a, EM.organizer);
  check('A36. offline: sign-in says so plainly and does not pretend', await until(async () => /offline|Could not reach/i.test(await text(a, '.auth-error'))) && !(await signedIn(a)), await text(a, '.auth-error'));
  await a.ctx.setOffline(false);
  check('A37. existing accounts untouched: fighter claims and event roles exactly as before; only the one new sign-up account (and the re-created seed accounts) were added',
    sql('select md5(string_agg(fighter_id::text || user_id::text, \',\' order by fighter_id, user_id)) from public.fighter_accounts where user_id in (select id from auth.users where email like \'%@example.test\')') === linksBefore
    && sql('select md5(string_agg(event_id::text || user_id::text || role, \',\' order by event_id, user_id, role)) from public.event_staff where user_id in (select id from auth.users where email like \'%@example.test\')') === staffBefore
    && Number(sql('select count(*) from auth.users where email like \'%@example.test\'')) === usersBefore + 1);
  check('A38. passwords live only in Supabase Auth: no BuhurtOS table has a password column', sql(`select count(*) from information_schema.columns where table_schema in ('public', 'private') and column_name ilike '%password%'`) === '0');

  // =================================================================================== PART B: the Command Centre
  // the event day so far, through the real functions, as the real staff accounts
  await rpc('desk', 'set_attendance', { p_reg: REG(2), p_state: 'checked_in' });
  await rpc('desk', 'set_attendance', { p_reg: REG(4), p_state: 'arrived' });
  await rpc('inspector', 'record_inspection', { p_reg: REG(1), p_result: 'passed', p_issues: [], p_note: null });
  await rpc('inspector', 'record_inspection', { p_reg: REG(2), p_result: 'conditional', p_issues: ['helmet'], p_note: 'SECRET-NOTE grille loose' });
  await rpc('inspector', 'record_inspection', { p_reg: REG(3), p_result: 'passed', p_issues: [], p_note: null });
  await rpc('inspector', 'record_weigh_in', { p_reg: REG(3), p_weight_kg: 83.4 });
  const call = await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  const call2 = await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: 'Field 2', p_start: true });
  const version = (n) => Number(sql(`select version from public.matches where id = '${MID(n)}'`));
  // a polearm semifinal (Field 1) is scored, then a second device disagrees about it: a result conflict
  const ok12 = await rpc('scorekeeper', 'submit_match_result', { p_command: crypto.randomUUID(), p_match: MID(21), p_result: 'a', p_score_a: 5, p_score_b: 3, p_detail: {}, p_expected_version: version(21), p_schema: 1 });
  const dis12 = await rpc('head', 'submit_match_result', { p_command: crypto.randomUUID(), p_match: MID(21), p_result: 'b', p_score_a: 2, p_score_b: 5, p_detail: {}, p_expected_version: version(21) - 1, p_schema: 1 });
  const active = (f) => sql(`select id from public.matches m where m.queue_state = 'active' and coalesce(m.field, 'Field 1') = '${f}' limit 1`);
  const rev = (f) => Number(sql(`select coalesce((select rev from public.lyst_timer where event_id = '${EVENT}' and field_key = '${f.toLowerCase()}'), 0)`));
  const timer = (f, match, action, extra = {}) => rpc('scorekeeper', 'lyst_timer_command', { p_event: EVENT, p_field: f, p_match: match, p_expected_rev: rev(f), p_command: crypto.randomUUID(), p_action: action, ...extra });
  const f1 = active('Field 1'), f2 = active('Field 2');
  await rpc('scorekeeper', 'lyst_open', { p_match: f1, p_counter_input: 'simple' });
  await timer('Field 1', f1, 'set', { p_mode: 'fight', p_duration_ms: 60000, p_round: 1 }); await timer('Field 1', f1, 'start');
  await rpc('scorekeeper', 'lyst_open', { p_match: f2, p_counter_input: 'simple' });
  await timer('Field 2', f2, 'set', { p_mode: 'fight', p_duration_ms: 60000, p_round: 1 }); await timer('Field 2', f2, 'start'); await timer('Field 2', f2, 'pause');
  check('B0. setup through the real functions: both fields called, Field 1 clock running, Field 2 paused, a result conflict (polearm semifinal, Field 1)',
    call.status === 200 && call2.status === 200 && ok12.body?.status === 'accepted' && dis12.body?.status === 'conflict' && f1 === MID(1) && f2 === MID(12)
    && sql(`select status from public.lyst_timer where event_id = '${EVENT}' and field_key = 'field 2'`) === 'paused', JSON.stringify([call.status, ok12.body, dis12.body, f1, f2]));

  const org = await open('phone'); pages.push(org);
  await org.goto(BASE + '/account'); await signInHere(org, EM.organizer); await until(async () => /Sign out/.test(await text(org)));
  await org.goto(BASE + `/events/${SLUG}`);
  await org.getByTestId('open-command').click();
  await org.locator('.cc').waitFor({ timeout: 30000 });
  await until(async () => (await org.locator('.cc-item').count()) >= 5, 20000);
  const head = await text(org, '.cc-head');
  check('B1. organizer: the entry on the event page opens the Command Centre (event-scoped route)', path(org) === CMD);
  check('B2. header: event name, status, event time, an overall state from real conditions, and "Live · updated"', /Test stuff test/i.test(head) && /Published/i.test(head) && /at the event/.test(head) && /things need attention \(\d+ now\)/.test(head) && /Live · updated/.test(head), head);
  const att = await text(org, '#cc-attention');
  check('B3. needs attention: the result conflict, Brann called to fight with armour needing correction, the armour issue, Dara arrived not checked in, Field 2 paused',
    /result needs a decision/.test(att) && /Field 2/.test(att) && /called to fight but not ready.*Brann Oakley \(armour needs correction\)/.test(att) && /armour fixed and reinspected/.test(att)
    && /arrived but not checked in.*Dara Voss/.test(att) && /Field 2: clock paused/.test(att), att);
  check('B4. most urgent first ("Now" items lead), every item says what to do', (await org.locator('.cc-item').first().locator('.cc-urg').innerText()) === 'NOW' || (await org.locator('.cc-item').first().locator('.cc-urg').innerText()) === 'Now'
    && (await org.locator('.cc-item .cc-act').count()) === (await org.locator('.cc-item').count()));
  check('B5. no private inspection notes or weights anywhere on the page', !/SECRET-NOTE|83\.4|84 kg/.test(await text(org)));
  const fieldsText = await text(org, '#cc-fields');
  check('B6. fields from Pack 13: Field 1 "Fight on, clock running" Aldric v Brann with the readiness warning; Field 2 "Clock paused" (state words, no second clock or score)',
    /Field 1 Fight on, clock running/i.test(fieldsText) && /Aldric Stone vs Brann Oakley/.test(fieldsText) && /Not ready: Brann Oakley/.test(fieldsText) && /Field 2 Clock paused/i.test(fieldsText)
    && !/\b\d:\d\d\b/.test(fieldsText), fieldsText);   // no countdown like 0:45 (event times are hh:mm)
  const tiles = await text(org, '#cc-fighters');
  check('B7. fighters from Pack 16: 4 expected, 1 arrived not in, 3 checked in, 2 ready, 2 not ready, 1 armour issue', /4 expected/.test(tiles) && /1 arrived, not in/.test(tiles) && /3 checked in/.test(tiles) && /2 ready/.test(tiles) && /2 not ready/.test(tiles) && /1 ⚠? ?armour issues/.test(tiles), tiles);
  check('B8. 390x844: no sideways scroll', await noSideways(org));
  await shot(org, '10-command-problems-phone');
  // deep links into the authoritative screens
  await org.locator('.cc-item', { hasText: 'armour fixed and reinspected' }).getByRole('link').click();
  check('B9. "See armour issues" opens the check-in desk on the armour-issues list, with Brann', await until(async () => path(org) === `/events/${SLUG}/checkin?f=issues` && (await org.locator('article.desk-card[aria-label="Brann Oakley"]').count()) === 1
    && (await org.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Armour issues' }).getAttribute('aria-pressed')) === 'true', 15000), path(org));
  await org.goBack(); await org.locator('.cc').waitFor();
  await until(async () => (await org.locator('.cc-item').count()) >= 5);
  await org.locator('.cc-item', { hasText: 'result needs a decision' }).getByRole('link').click();
  check('B10. the result conflict opens Event day, where it is decided', await until(async () => path(org) === `/events/${SLUG}/manage?tab=eventday` && /review|disagree/i.test(await text(org)), 20000), path(org));
  await org.goto(BASE + CMD); await org.locator('.cc').waitFor();
  await org.getByRole('link', { name: 'Open Lyst Control · Field 2' }).click();
  check('B11. "Open Lyst Control · Field 2" opens that field\'s Lyst Control screen', await until(async () => path(org) === `/events/${SLUG}/field/Field%202`), path(org));

  // viewing writes nothing
  const world = () => sql(`select md5(concat_ws('|', (select string_agg(m::text, ',' order by m.id) from public.matches m), (select string_agg(t::text, ',' order by t.field_key) from public.lyst_timer t),
    (select string_agg(r::text, ',' order by r.match_id, r.round_no) from public.lyst_rounds r), (select string_agg(c::text, ',' order by c.registration_id, c.check_name) from public.registration_checks c),
    (select count(*) from public.audit_log), (select count(*) from public.result_proposals), (select count(*) from public.notifications)))`);
  const w0 = world();
  const watcher = await open('desktop'); pages.push(watcher);
  await watcher.goto(BASE + '/account'); await signInHere(watcher, EM.organizer); await until(async () => /Sign out/.test(await text(watcher)));
  await watcher.goto(BASE + CMD); await watcher.locator('.cc').waitFor({ timeout: 30000 });
  await sleep(25000);   // longer than one snapshot cycle, with the live channels and Lyst polling running
  check('B12. 25 s of the Command Centre open (snapshot, live matches, Lyst state) changed NOTHING: matches, timers, rounds, checks, audit log, results, notifications', world() === w0);

  // the authoritative state changes; the Command Centre follows (no reload)
  await org.goto(BASE + CMD); await org.locator('.cc').waitFor();
  await rpc('inspector', 'record_inspection', { p_reg: REG(2), p_result: 'passed', p_issues: [], p_note: null });
  await timer('Field 2', f2, 'start');
  check('B13. Brann passes reinspection and Field 2 resumes: the warnings and the paused clock leave the Command Centre by themselves (no reload)',
    await until(async () => { const t = await text(org, '#cc-attention'); return !/Brann/.test(t) && !/clock paused/.test(t); }, 40000) && /Field 2 Fight on, clock running/i.test(await text(org, '#cc-fields')), await text(org, '#cc-attention'));
  // offline / stale is said out loud
  await org.ctx.setOffline(true);
  await org.evaluate(() => window.dispatchEvent(new Event('offline')));
  check('B14. offline: "Offline · last updated …. This may be out of date."', await until(async () => /Offline · last updated .* This may be out of date/.test(await text(org, '[data-testid="cc-fresh"]')), 10000), await text(org, '[data-testid="cc-fresh"]'));
  await shot(org, '11-command-offline', false);
  await org.ctx.setOffline(false);
  await org.evaluate(() => window.dispatchEvent(new Event('online')));
  check('B15. back online it reads again and says "Live"', await until(async () => /Live · updated/.test(await text(org, '[data-testid="cc-fresh"]')), 20000));

  // everything healthy
  await rpc('desk', 'set_attendance', { p_reg: REG(4), p_state: 'checked_in' });
  await rpc('inspector', 'record_inspection', { p_reg: REG(4), p_result: 'passed', p_issues: [], p_note: null });
  const conflicts = await rpc('organizer', 'list_result_conflicts', { p_event: EVENT });
  for (const c of conflicts.body ?? []) await rpc('organizer', 'resolve_result_conflict', { p_proposal: c.proposal_id, p_decision: 'keep_official', p_note: 'Checked the sheet' });
  // the organizer moves Aldric's two Field 2 fights apart from his Field 1 fights (the double bookings the Command Centre reported)
  sql(`update public.matches set scheduled_at = now() + interval '3 hours' where id = '${MID(11)}'`);
  sql(`update public.matches set scheduled_at = now() + interval '4 hours' where id = '${MID(13)}'`);
  await org.evaluate(() => window.dispatchEvent(new Event('focus')));
  check('B16. with everything in order the header says "All good" and Needs attention says nothing needs you', await until(async () => /All good/.test(await text(org, '.cc-head')), 40000)
    && /Nothing needs you right now/.test(await text(org, '#cc-attention')), await text(org, '#cc-attention'));
  await shot(org, '12-command-healthy-phone');

  // head marshal: the same picture, no organizer-only routes, no announcements panel
  const hm = await open('phone'); pages.push(hm);
  await hm.goto(BASE + '/account'); await signInHere(hm, EM.head); await until(async () => /Sign out/.test(await text(hm)));
  await hm.goto(BASE + `/events/${SLUG}`);
  await hm.getByTestId('open-command').click();
  await hm.locator('.cc').waitFor({ timeout: 30000 });
  check('B17. head marshal: own entry on the event page, the Command Centre opens; no links to organizer-only pages, no announcement form',
    path(hm) === CMD && (await hm.locator('.cc a[href*="/manage"]').count()) === 0 && (await hm.locator('#cc-announce').count()) === 0, await text(hm, '.cc-quick'));
  // organizer sees and can use the existing announcement capability (Pack 15) from here
  check('B18. organizer: the Pack 15 announcement panel is here (reused, not rebuilt)', (await org.locator('#cc-announce').count()) === 1 && /announcement|140/i.test(await text(org, '#cc-announce')));

  // permissions, directly against the database with real sessions
  const who = ['scorekeeper', 'stranger', 'brann', 'captain', 'desk', 'inspector', 'otherDesk'];
  tokens.set('stranger', (await token(EM.stranger, 'Changed-pass-2')).token);
  const rs = await Promise.all(who.map(async w => [w, (await rpc(w, 'event_command_snapshot', { p_event: EVENT })).status]));
  check('B19. refused by the database: scorekeeper, unrelated user, fighter, captain, check-in desk, inspector, other event\'s staff', rs.every(([, s]) => s >= 400 && s < 500), JSON.stringify(rs));
  check('B20. refused for anonymous callers', refused(await rpc(null, 'event_command_snapshot', { p_event: EVENT })));
  check('B21. the organizer is refused for an event they do not run (no cross-event leak)', refused(await rpc('organizer', 'event_command_snapshot', { p_event: OTHER })));
  const sk = await open('phone'); pages.push(sk);
  await sk.goto(BASE + CMD); await signInHere(sk, EM.scorekeeper);
  check('B22. a scorekeeper opening the address sees "for this event\'s organizers and head marshal" and no event data', await until(async () => /organizers and head marshal/.test(await text(sk)), 20000)
    && (await sk.locator('.cc-item, .cc-field, .cc-tile').count()) === 0);
  const snapText = JSON.stringify((await rpc('organizer', 'event_command_snapshot', { p_event: EVENT })).body);
  check('B23. the snapshot carries no notes, weights or emails', !/SECRET-NOTE|83\.4|example\.test|"note"|weight/.test(snapText));

  // layouts
  for (const [kind, name] of [['tablet', '13-command-tablet'], ['desktop', '14-command-desktop']]) {
    const p = await open(kind); pages.push(p);
    await p.goto(BASE + '/account'); await signInHere(p, EM.organizer); await until(async () => /Sign out/.test(await text(p)));
    await p.goto(BASE + CMD); await p.locator('.cc').waitFor({ timeout: 30000 });
    check(`B24. ${kind}: no sideways scroll`, await noSideways(p));
    await shot(p, name);
  }
  const errs = pages.flatMap(p => p.errors);
  check('B25. no page errors in any browser', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('unexpected error', false, e.stack ?? String(e));
} finally {
  await browser.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(failed.length ? 'PACK18 LIVE FAILED' : 'PACK18 LIVE PASSED');
process.exit(failed.length ? 1 : 0);
