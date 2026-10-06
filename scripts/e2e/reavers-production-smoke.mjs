// PRODUCTION smoke test for the shared BuhurtOS / Red Deer Reavers account, membership and AGM flows, driven in real Chromium against the LIVE
// websites and the LIVE Supabase project. Run only by hand (.github/workflows/reavers-production-smoke.yml, workflow_dispatch).
//
// It creates two clearly labelled TEST accounts on the owner's test domain (reavers-smoke-<tag>-a / -b @buhurtos.ca):
//   A is created on the club website, B on BuhurtOS. When the project asks for email confirmation, the script WAITS (up to WAIT_MINUTES) for an
//   operator to confirm the test address (the test mailboxes are not readable from here) and says so in its output. Membership approval of the
//   test accounts is also done by an operator (the Treasurer), which the script waits for. It never touches any real person's data.
// Afterwards the operator marks the test memberships Removed (records are never deleted).
// DISABLED BY DEFAULT: this suite creates new test accounts by sign-up, which sends real confirmation emails to addresses that cannot receive
// mail (they bounced to the owner on 2026-10-06). Production tests must use fixed pre-confirmed test accounts only (see
// reavers-production-agm-extras-smoke.mjs). It only runs if ALLOW_ACCOUNT_CREATION is set to the exact phrase below, which nobody should do.
if (process.env.ALLOW_ACCOUNT_CREATION !== 'yes-send-real-confirmation-emails') {
  console.error('REFUSING TO RUN: this suite creates accounts and sends confirmation emails. Use the fixed-account suite (suite = agm-extras).');
  process.exit(2);
}
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const SITE = process.env.SITE ?? 'https://dothecoolwip1.github.io/Red-deer-reavers/members.html';
const BOS = process.env.BOS ?? 'https://dothecoolwip1.github.io/BuhurtOS';
const API = process.env.SUPABASE_URL ?? 'https://mvbxlebznlgroptwwdsm.supabase.co';
const KEY = process.env.SUPABASE_KEY ?? 'sb_publishable_u76M-dggKSsdsyhUQKveJg_5fPJ5Nan';
const TAG = (process.env.TAG ?? String(Date.now())).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
const WAIT = Number(process.env.WAIT_MINUTES ?? 15) * 60_000;
const SHOTS = process.env.SHOTS ?? '/tmp/smoke-shots';
mkdirSync(SHOTS, { recursive: true });
const A = { email: `reavers-smoke-${TAG}-a@buhurtos.ca`, password: `Smoke-${TAG}-A-pw`, name: `Smoke Test ${TAG} A` };
const B = { email: `reavers-smoke-${TAG}-b@buhurtos.ca`, password: `Smoke-${TAG}-B-pw`, name: `Smoke Test ${TAG} B` };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 600)}`); };
const note = (s) => console.log(`NOTE  ${s}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, timeout = 20000, every = 300) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(every); } return false; };

async function token(email, password) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY }, body: JSON.stringify({ email, password }) });
  const b = await r.json().catch(() => ({}));
  return { ok: !!b.access_token, token: b.access_token, user: b.user?.id, code: b.error_code ?? b.code, msg: b.msg ?? b.error_description };
}
async function rpc(tok, fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY, authorization: `Bearer ${tok}` }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function waitForSignIn(who) {
  const first = await token(who.email, who.password);
  if (first.ok) return first;
  console.log(`WAITING  operator to confirm the test address ${who.email} (${first.code ?? first.msg}); polling for ${WAIT / 60000} min`);
  let t; await until(async () => (t = await token(who.email, who.password)).ok, WAIT, 10000);
  return t;
}

// ---- what the project is configured to do (public settings)
const settings = await (await fetch(`${API}/auth/v1/settings`, { headers: { apikey: KEY } })).json().catch(() => ({}));
note(`auth settings: email signup ${settings.external?.email ? 'on' : 'OFF'}, google ${settings.external?.google ? 'on' : 'off'}, mailer_autoconfirm ${settings.mailer_autoconfirm}, disable_signup ${settings.disable_signup}`);

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const pages = [];
async function open(kind = 'phone') {
  const ctx = await browser.newContext(kind === 'phone' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'en-CA', timezoneId: 'America/Edmonton' }
    : { viewport: { width: 1280, height: 900 }, locale: 'en-CA', timezoneId: 'America/Edmonton' });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|40[0-9]|42501|AuthApiError|posthog|\[BuhurtOS\]|WebSocket|realtime/i.test(m.text())) p.errors.push(m.text().slice(0, 300)); });
  pages.push(p);
  return p;
}
const text = async (p, sel = 'body') => (await p.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => undefined);
const sessionUser = (p) => p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) { const s = JSON.parse(localStorage.getItem(k) ?? 'null'); if (s?.user?.id) return s.user.id; } return null; });
const noSideways = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const tab = (p, name) => p.locator('#tabs').getByRole('button', { name, exact: true }).click();
async function siteSignIn(p, who) {
  await p.goto(SITE);
  await p.locator('#email').fill(who.email); await p.locator('#password').fill(who.password); await p.locator('#password-btn').click();
  await until(async () => !(await p.locator('#signed-in').isHidden()) && (await text(p, '#view')).length > 20, 30000);
}

let aId = null, bId = null;
const ONLY_APPROVED = process.env.ONLY === 'approved';
try {
  if (!ONLY_APPROVED) {
  // ================================================================ 1. the live websites
  const p = await open('phone');
  await p.goto(SITE);
  check('1 the live club website serves the new members area (Create account / Sign in / Forgot password)',
    (await p.locator('[data-auth-tab=signup]').count()) === 1 && (await p.locator('[data-auth-tab=forgot]').count()) === 1, await text(p, 'main'));
  await shot(p, '01-site-signed-out');

  // ================================================================ 2. A: create the account ON THE CLUB WEBSITE
  await p.locator('[data-auth-tab=signup]').click();
  await p.locator('#su-name').fill(A.name); await p.locator('#su-email').fill(A.email);
  await p.locator('#su-password').fill(A.password); await p.locator('#su-password2').fill(A.password);
  await p.locator('#signup-btn').click();
  await until(async () => (await p.locator('#signup-check').isVisible()) || !(await p.locator('#signed-in').isHidden()) || (await text(p, '#status')).length > 0, 30000);
  const afterSignup = (await p.locator('#signup-check').isVisible()) ? 'check-email' : !(await p.locator('#signed-in').isHidden()) ? 'signed-in' : 'error: ' + await text(p, '#status');
  await shot(p, '02-site-after-create-account');
  check('2 Create account on the club website was accepted by the live Supabase Auth', !afterSignup.startsWith('error'), afterSignup);
  note(`after Create account: ${afterSignup}`);
  const ta = await waitForSignIn(A);
  aId = ta.user;
  check('3 the account created on the club website exists and can sign in (live Auth)', ta.ok, `${ta.code} ${ta.msg}`);

  if (ta.ok) {
    // profile step + join, on the club website
    const s = await open('phone');
    await siteSignIn(s, A);
    const setup = (await s.locator('[data-testid=profile-setup]').count()) > 0;
    check('4 first sign-in on the club website shows the BuhurtOS profile step', setup, await text(s, '#view'));
    if (setup) { await s.getByRole('button', { name: 'Continue' }).click(); await until(async () => (await s.locator('[data-testid=apply-form]').count()) > 0, 30000); }
    await shot(s, '04-site-join');
    check('5 then "Join the Red Deer Reavers" with the 2026 fee waived', (await text(s, '[data-testid=apply-form]')).includes('membership fee is waived'));
    await s.locator('label.check', { hasText: '18 or older' }).click(); await s.locator('label.check', { hasText: 'bylaws' }).click();
    await s.getByRole('button', { name: 'Apply to join' }).click();
    await until(async () => (await text(s, '#view')).includes('Membership Application Pending'), 30000);
    const pend = await text(s, '[data-testid=my-membership]');
    check('6 application: "Membership Application Pending", 2026 fee WAIVED, NOT CURRENTLY ELIGIBLE (pending)', pend.includes('Membership Application Pending') && pend.includes('WAIVED') && pend.includes('NOT CURRENTLY ELIGIBLE TO VOTE'), pend);
    check('7 a regular member sees no executive tabs', !(await text(s, '#tabs')).includes('AGM admin'));
    await shot(s, '06-site-pending');
    // AGM
    await tab(s, '2026 AGM');
    await until(async () => (await s.locator('[data-testid=agm-head]').count()) > 0, 30000);
    const head = await text(s, '[data-testid=agm-head]');
    check('8 the live AGM shows Sunday, October 18, 2026, 5:30 PM (Red Deer time)', head.includes('Sunday, October 18, 2026') && head.includes('5:30 PM'), head);
    for (const [btn, shown] of [['In Person', 'Attending In Person'], ['Video Call', 'Attending by Video Call'], ['Not Attending', 'Not Attending']]) {
      await s.getByRole('button', { name: btn, exact: true }).click();
      check(`9 RSVP "${btn}" works on the live site`, await until(async () => (await text(s, '[data-testid=rsvp-now]')).includes(shown), 20000), await text(s, '#view'));
    }
    check('10 the members area fits a 390px phone', await noSideways(s));
    await shot(s, '09-site-agm');
    // the same account on BuhurtOS
    await s.locator('#sign-out').click();
    await until(async () => !(await sessionUser(s)), 15000);
    const b = await open('desktop');
    await b.goto(`${BOS}/sign-in?next=%2Faccount`);
    const form = b.getByRole('form', { name: 'Sign in with email and password' });
    await form.getByLabel('Email', { exact: true }).fill(A.email); await form.getByLabel('Password', { exact: true }).fill(A.password);
    await form.getByRole('button', { name: 'Sign in' }).click();
    await until(async () => !!(await sessionUser(b)), 30000);
    await sleep(2500);
    check('11 the account created on the club website signs in to LIVE BuhurtOS as the SAME Supabase user', (await sessionUser(b)) === aId && !!aId, `${await sessionUser(b)} vs ${aId}`);
    check('12 BuhurtOS does not ask for setup again', !b.url().includes('/welcome'), b.url());
    await shot(b, '11-bos-signed-in-A');
    await b.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k); });
  }

  // ================================================================ 3. B: an account created on BuhurtOS, then used on the club website
  const bo = await open('desktop');
  await bo.goto(`${BOS}/sign-in?mode=signup`);
  const sform = bo.getByRole('form', { name: 'Create an account' });
  await bo.locator('input[type=email]').first().fill(B.email);
  await bo.locator('#signup-password').fill(B.password);
  await sform.getByRole('button', { name: 'Create account' }).click();
  await sleep(4000);
  await shot(bo, '13-bos-create-account-B');
  note(`after BuhurtOS Create account: ${await text(bo, 'main')}`.slice(0, 400));
  const tb = await waitForSignIn(B);
  bId = tb.user;
  check('13 an account created on BuhurtOS exists (live Auth)', tb.ok, `${tb.code} ${tb.msg}`);
  if (tb.ok) {
    const s = await open('phone');
    await siteSignIn(s, B);
    check('14 the existing BuhurtOS account signs in on the live club website as the SAME user', (await sessionUser(s)) === bId, `${await sessionUser(s)} vs ${bId}`);
    const needsSetup = (await s.locator('[data-testid=profile-setup]').count()) > 0;
    check('14b an account made on BuhurtOS that never finished setup gets the same profile step on the club website', needsSetup);
    if (needsSetup) { await s.locator('#pf-name').fill(B.name); await s.getByRole('button', { name: 'Continue' }).click(); await until(async () => (await s.locator('[data-testid=apply-form]').count()) > 0, 30000); }
    check('15 not yet a member: the club website offers "Join the Red Deer Reavers"', (await text(s, '#tabs')).includes('Join the Reavers'));
    await s.locator('label.check', { hasText: '18 or older' }).click(); await s.locator('label.check', { hasText: 'bylaws' }).click();
    await s.getByRole('button', { name: 'Apply to join' }).click();
    await until(async () => (await text(s, '#view')).includes('Membership Application Pending'), 30000);
    await s.locator('#sign-out').click(); await until(async () => !(await sessionUser(s)), 15000);
  }

  // ================================================================ 4. duplicate registration and password reset (club website)
  const d = await open('phone');
  await d.goto(SITE);
  await d.locator('[data-auth-tab=signup]').click();
  await d.locator('#su-name').fill('Duplicate Attempt'); await d.locator('#su-email').fill(B.email);
  await d.locator('#su-password').fill('Duplicate-pw-1234'); await d.locator('#su-password2').fill('Duplicate-pw-1234');
  await d.locator('#signup-btn').click();
  await until(async () => (await d.locator('#signup-check').isVisible()) || (await text(d, '#status')).length > 0, 30000);
  const dupText = await text(d, '#signed-out');
  check('16 Create account with an existing email offers Sign in / Reset password', /sign in/i.test(dupText) && /reset your password/i.test(dupText), dupText);
  check('17 ...and the existing password still works (no new identity took the address)', (await token(B.email, B.password)).ok && !(await token(B.email, 'Duplicate-pw-1234')).ok);
  await shot(d, '16-site-duplicate');
  await d.locator('[data-goto=forgot]').first().click();
  await d.locator('#fp-email').fill(A.email); await d.locator('#forgot-btn').click();
  check('18 Forgot password on the live club website sends a reset email (accepted by Supabase)', await until(async () => d.locator('#forgot-check').isVisible(), 30000), await text(d, '#status'));
  await shot(d, '18-site-reset-requested');

  }
  // ================================================================ 5. approval -> eligible without paying; proxy
  const ta2 = await token(A.email, A.password), tb2 = await token(B.email, B.password);
  if (ta2.ok && tb2.ok) {
    const elig = async (t) => { const r = await rpc(t, 'club_membership_overview', { p_team: (await (await fetch(`${API}/rest/v1/teams?slug=eq.red-deer-reavers&select=id`, { headers: { apikey: KEY } })).json())[0].id }); return r.body?.memberships?.find(m => m.year === 2026); };
    console.log(`WAITING  operator (Treasurer) to approve the two TEST memberships; polling for ${WAIT / 60000} min`);
    await until(async () => (await elig(ta2.token))?.status === 'active' && (await elig(tb2.token))?.status === 'active', WAIT, 10000);
    const ma = await elig(ta2.token), mb = await elig(tb2.token);
    check('19a both test memberships were approved by the operator', ma?.status === 'active' && mb?.status === 'active', `${ma?.status} / ${mb?.status}`);
    check('19 once approved, a member is ELIGIBLE TO VOTE without paying (2026 fee waived, dues still "unpaid")', ma?.status === 'active' && ma?.eligible === true && ma?.dues_status === 'unpaid' && ma?.fee_waived === true, JSON.stringify(ma));
    const s = await open('phone');
    await siteSignIn(s, A);
    check('20 the club website shows Membership: Active and ELIGIBLE TO VOTE', (await text(s, '[data-testid=my-membership]')).includes('Membership: Active') && !(await text(s, '[data-testid=my-membership]')).includes('NOT CURRENTLY'));
    await tab(s, '2026 AGM');
    await s.getByRole('button', { name: 'Voting by Proxy', exact: true }).click();
    await until(async () => (await s.locator('[data-testid=proxy-form]').count()) > 0, 20000);
    await s.locator('#proxy-holder').selectOption({ label: B.name });
    await s.locator('label.check', { hasText: 'I authorize the selected member' }).click();
    await s.getByRole('button', { name: 'Save my proxy' }).click();
    check('21 Voting by Proxy: "Your Proxy: <member>" on the live site', await until(async () => (await text(s, '[data-testid=proxy-holder]')) === B.name, 20000), await text(s, '#view'));
    await shot(s, '21-site-proxy');
    const bad = await rpc(ta2.token, 'set_club_meeting_rsvp', { p_meeting: (await rpc(ta2.token, 'club_meeting_member_view', { p_team: (await (await fetch(`${API}/rest/v1/teams?slug=eq.red-deer-reavers&select=id`, { headers: { apikey: KEY } })).json())[0].id })).body.meeting.id, p_response: 'proxy', p_proxy_holder: ma.id, p_authorize: true });
    check('22 an invalid proxy (yourself) is rejected by the live database', bad.status >= 400, JSON.stringify(bad.body));
    s.once('dialog', x => x.accept());
    await s.getByRole('button', { name: 'Cancel proxy' }).click();
    check('23 Cancel proxy works', await until(async () => (await text(s, '[data-testid=agm-member]')).includes('How will you participate?'), 20000));
    await s.getByRole('button', { name: 'Not Attending', exact: true }).click();
    await until(async () => (await text(s, '[data-testid=rsvp-now]')).includes('Not Attending'), 20000);
    const dues = await rpc(ta2.token, 'set_club_dues', { p_membership: ma.id, p_status: 'paid' });
    check('24 a regular member cannot change dues on the live database', dues.status >= 400);
    const dash = await rpc(ta2.token, 'club_meeting_dashboard', { p_meeting: (await rpc(ta2.token, 'club_meeting_member_view', { p_team: ma && (await (await fetch(`${API}/rest/v1/teams?slug=eq.red-deer-reavers&select=id`, { headers: { apikey: KEY } })).json())[0].id })).body.meeting.id });
    check('25 a regular member cannot open the executive AGM dashboard on the live database', dash.status >= 400);
    // the newly deployed BuhurtOS membership page, for the same account (same origin: the club-site session is the BuhurtOS session)
    await s.goto(`${BOS}/teams/red-deer-reavers/membership`);
    await until(async () => (await s.getByTestId('vote-banner').count()) > 0, 30000);
    const bm = await text(s, 'main');
    check('27 live BuhurtOS membership page: same account already signed in, ELIGIBLE TO VOTE, 2026 fee shown as waived',
      bm.includes('ELIGIBLE TO VOTE') && !bm.includes('NOT ELIGIBLE') && /fee waived/i.test(bm), bm.slice(0, 500));
    check('28 live BuhurtOS has no AGM screens (RSVP / proxy / check-in live only on the club website)', !/RSVP|proxy|check-in|Voting by Proxy/i.test(bm) && !/AGM/.test(await text(s, '.tabs')), bm.slice(0, 300));
    await shot(s, '27-bos-membership');
  } else note('approval steps skipped: test accounts could not sign in');
} catch (e) {
  check('no unexpected error', false, e?.stack ?? String(e));
}
check('26 no page errors on the live sites', pages.every(x => x.errors.length === 0), pages.flatMap(x => x.errors).join(' | '));
console.log(`TEST ACCOUNTS  A=${A.email} (${aId})  B=${B.email} (${bId})`);
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(failed ? 'PRODUCTION SMOKE FAILED' : 'PRODUCTION SMOKE PASSED');
process.exit(failed ? 1 : 0);
