// Red Deer Reavers membership, dues and voting on the REAL_AUTH local stack (scripts/e2e/club-live.sh): Postgres built from every migration on top of
// the real Supabase Auth server's schema, PostgREST, Supabase Auth (GoTrue) with a local mail sink, the real built BuhurtOS app, and the Red Deer
// Reavers website (its real files, served from a SECOND origin) pointed at the same local Auth + API.
//   A. one account: the same person signs in on BuhurtOS and on the club website (password, and an email code that creates a new account on the club
//      site) and both resolve to the same Supabase user id; sessions stay per website (no token passes between the two)
//   B. the club website's members area: member view, apply, executive dashboard, dues dialog, approve, AGM snapshot, history, refusals
//   C. BuhurtOS: team page link, member view, dashboard filters, dues dialog, AGM, history, executive roles (assign / end moves the permission)
//   D. the API directly with each person's real token: what the screens hide is also refused by the database
//   phone 390x844 and desktop 1280x900, screenshots, no sideways scrolling
// LOCAL EVIDENCE ONLY (needs PostgREST and Supabase Auth binaries; not part of CI).
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, DB = process.env.PGDATABASE, MAIL = process.env.MAILSINK;
const SITE_DIR = process.env.REAVERS_DIR ?? '/home/user/Red-deer-reavers', SITE_PORT = 4190, SITE = `http://127.0.0.1:${SITE_PORT}`;
if (!MAIL) { console.error('MAILSINK is not set: run through scripts/e2e/club-live.sh (REAL_AUTH=1)'); process.exit(2); }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const PW = 'Fixture-pass-club';
const YEAR = new Date().getFullYear();
const REAVERS = '00000000-0000-0000-0000-0000000c1ea1', OTHER = '00000000-0000-0000-0000-0000000c1ea2';
const MEM = (n) => `00000000-0000-0000-0000-0000000c1eb${n}`;

// ---- the club website on its own origin (python's static server). A copy of its real files is served with ONLY the API address swapped for the local
// stack (config + the matching Content-Security-Policy connect-src); everything else is the committed website.
const LOCAL_CONFIG = `window.BUHURTOS = { supabaseUrl: '${API}', publishableKey: 'local-publishable-key', appUrl: '${BASE}', teamSlug: 'red-deer-reavers' };`;
const SERVE = mkdtempSync(`${tmpdir()}/reavers-`);
cpSync(SITE_DIR, SERVE, { recursive: true, filter: (src) => !src.includes('/.git') });
writeFileSync(`${SERVE}/assets/js/buhurtos-config.js`, LOCAL_CONFIG);
writeFileSync(`${SERVE}/members.html`, readFileSync(`${SITE_DIR}/members.html`, 'utf8').replaceAll('https://mvbxlebznlgroptwwdsm.supabase.co', API).replaceAll('wss://mvbxlebznlgroptwwdsm.supabase.co', API.replace('http', 'ws')));
const site = spawn('python3', ['-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1'], { cwd: SERVE, stdio: 'ignore' });
process.on('exit', () => site.kill());
for (let i = 0; i < 40; i++) { if (await fetch(`${SITE}/members.html`).then(r => r.ok, () => false)) break; await sleep(250); }
const realConfig = readFileSync(`${SITE_DIR}/assets/js/buhurtos-config.js`, 'utf8');
check('the committed club website config points at the hosted BuhurtOS project', realConfig.includes('https://mvbxlebznlgroptwwdsm.supabase.co') && realConfig.includes("teamSlug: 'red-deer-reavers'"));

// ---- the real Auth server and the database, as a device would use them
async function token(email, password = PW) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x' }, body: JSON.stringify({ email, password }) });
  const b = await r.json().catch(() => ({}));
  return b.access_token ?? null;
}
const tokens = new Map();
async function bearer(email) { if (!tokens.has(email)) tokens.set(email, await token(email)); return tokens.get(email); }
async function api(email, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', prefer: 'return=representation', ...(email ? { authorization: `Bearer ${await bearer(email)}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (email, fn, args) => api(email, 'POST', `rpc/${fn}`, args);
const refused = (r) => r.status >= 400 && r.status < 500;
const mail = async () => (await (await fetch(`${MAIL}/`)).json());
const mailTo = async (email, wait = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < wait) { const m = (await mail()).filter(x => x.to.includes(email)); if (m.length) return m; await sleep(250); } return []; };
const codeIn = (m) => (/code: (\d{6})/.exec(m.text) ?? /<p>\s*(\d{6})\s*<\/p>/.exec(m.text) ?? /\b(\d{6})\b/.exec(m.text))?.[1] ?? null;

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, desktop: { viewport: { width: 1280, height: 900 } } };
async function open(kind = 'phone') {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  // the sandbox has no internet: the club site's Materialize / Google Fonts are left out (layout is checked without them, the harder case)
  await ctx.route(/posthog\.com|maps\.googleapis\.com|accounts\.google\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.abort('failed'));
  const page = await ctx.newPage();
  page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|net::ERR|Failed to fetch|40[0-9]|42501|\[BuhurtOS\]|AuthApiError|AuthPKCE|AuthRetryable/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  return page;
}
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = async (page, name, full = true) => { if (SHOTS) { await sleep(350); await page.screenshot({ path: `${SHOTS}/club-${name}.png`, fullPage: full }).catch(() => undefined); } };
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const until = async (fn, timeout = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const sessionUser = (page) => page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) { const s = JSON.parse(localStorage.getItem(k) ?? 'null'); if (s?.user?.id) return s.user.id; } return null; });
const userId = (email) => sql(`select id from auth.users where email = '${email}'`);
async function bosSignIn(page, email, next) {
  await page.goto(`${BASE}/sign-in?next=${encodeURIComponent(next)}`);
  const form = page.getByRole('form', { name: 'Sign in with email and password' });
  await form.getByLabel('Email', { exact: true }).fill(email);
  await form.getByLabel('Password', { exact: true }).fill(PW);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await until(async () => !!(await sessionUser(page)));
}
async function siteSignIn(page, email) {
  await page.goto(`${SITE}/members.html`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PW);
  await page.locator('#password-btn').click();
  await until(async () => !(await page.locator('#signed-in').isHidden()));
}
const pages = [];
const done = (p) => { pages.push(p); return p; };

// ================================================================ A. one account across both websites
{
  const memberId = userId('member@example.test');
  const bos = done(await open('phone'));
  await bosSignIn(bos, 'member@example.test', '/teams/red-deer-reavers/membership');
  const onBos = await sessionUser(bos);
  const club = done(await open('phone'));
  await siteSignIn(club, 'member@example.test');
  const onClub = await sessionUser(club);
  check('A1 the same email + password signs in on BuhurtOS and on the club website', !!onBos && !!onClub, `${onBos} / ${onClub}`);
  check('A2 both websites resolve to the SAME Supabase user id (one account)', onBos === memberId && onClub === memberId, `${onBos} ${onClub} ${memberId}`);
  check('A3 the club website never stores a password and has no account table of its own', !readFileSync(`${SITE_DIR}/assets/js/member-portal.js`, 'utf8').match(/localStorage\.setItem|password\s*[:=]\s*['"]/));
  // sessions are per website: a new browser that only signed in on the club site is NOT signed in on BuhurtOS (nothing is handed across)
  const fresh = done(await open('phone'));
  await siteSignIn(fresh, 'john@example.test');
  await fresh.goto(`${BASE}/teams/red-deer-reavers/membership`);
  await until(async () => (await text(fresh, 'main')).includes('Sign in'));
  check('A4 signing in on the club website does not hand a session to buhurtos (no token passes between sites)', (await text(fresh, 'main')).includes('Sign in') && !(await sessionUser(fresh)), await text(fresh, 'main'));
  // a person who has never had an account: the club site's email code creates the ONE account, then BuhurtOS accepts the same email by code
  await fetch(`${MAIL}/`, { method: 'DELETE' });
  const brand = done(await open('phone'));
  await brand.goto(`${SITE}/members.html`);
  await brand.locator('#email').fill('brandnew@example.test');
  await brand.locator('#code-send-btn').click();
  const m1 = await mailTo('brandnew@example.test');
  await brand.locator('#code').fill(codeIn(m1[0] ?? { text: '' }) ?? '');
  await brand.locator('#code-verify-btn').click();
  await until(async () => !!(await sessionUser(brand)));
  const viaClub = await sessionUser(brand);
  check('A5 an email code on the club website creates a BuhurtOS account (one auth.users row)', !!viaClub && sql(`select count(*) from auth.users where email = 'brandnew@example.test'`) === '1', viaClub);
  await fetch(`${MAIL}/`, { method: 'DELETE' });
  const brand2 = done(await open('desktop'));
  await brand2.goto(`${BASE}/sign-in?next=%2Fteams%2Fred-deer-reavers%2Fmembership`);
  await brand2.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await brand2.getByRole('form', { name: 'Sign in with an email code' }).getByLabel('Email', { exact: true }).fill('brandnew@example.test');
  await brand2.getByRole('form', { name: 'Sign in with an email code' }).getByRole('button', { name: 'Email me a code' }).click();
  const m2 = await mailTo('brandnew@example.test');
  await brand2.getByRole('form', { name: 'Enter the email code' }).getByLabel(/code/i).fill(codeIn(m2[0] ?? { text: '' }) ?? '');
  await brand2.getByRole('form', { name: 'Enter the email code' }).getByRole('button', { name: 'Sign in' }).click();
  await until(async () => !!(await sessionUser(brand2)));
  check('A6 the same new person then signs in to BuhurtOS and is the same user id', (await sessionUser(brand2)) === viaClub && sql(`select count(*) from auth.users where email = 'brandnew@example.test'`) === '1', `${await sessionUser(brand2)} vs ${viaClub}`);
  check('A7 a wrong password on the club site gives the same words as an unknown email (no account enumeration)', await (async () => {
    const p = done(await open('phone')); await p.goto(`${SITE}/members.html`);
    await p.locator('#email').fill('member@example.test'); await p.locator('#password').fill('wrong-password-1'); await p.locator('#password-btn').click(); await sleep(900);
    const a = await text(p, '#status');
    await p.locator('#email').fill('nobody-here@example.test'); await p.locator('#password').fill('wrong-password-1'); await p.locator('#password-btn').click(); await sleep(900);
    return a.length > 0 && a === await text(p, '#status');
  })());
}

// ================================================================ B. the club website's members area
{
  // a regular member: own record, eligible, no leadership tabs
  const p = done(await open('phone'));
  await siteSignIn(p, 'member@example.test');
  await until(async () => (await text(p, '#view')).includes('ELIGIBLE TO VOTE'));
  const t = await text(p, '#view');
  check('B1 a regular member sees their membership, dues and ELIGIBLE TO VOTE on the club website', t.includes('ELIGIBLE TO VOTE') && t.includes('Active') && t.includes('Paid') && t.includes(String(YEAR)), t.slice(0, 300));
  check('B2 a regular member gets no members list, AGM or history tabs', await p.locator('#tabs').isHidden() && !(await text(p)).includes('Pending applications'));
  check('B3 member view fits a 390px phone', await noSideways(p));
  await shot(p, 'site-member-phone');
  // John: active, unpaid -> NOT ELIGIBLE with the reason
  const j = done(await open('phone'));
  await siteSignIn(j, 'john@example.test');
  await until(async () => (await text(j, '#view')).includes('ELIGIBLE'));
  check('B4 an unpaid member sees NOT ELIGIBLE TO VOTE with "Dues unpaid"', (await text(j, '#view')).includes('NOT ELIGIBLE TO VOTE') && (await text(j, '#view')).includes('Dues unpaid'));
  await shot(j, 'site-unpaid-phone');
  // Nell: has an account, never applied -> applies on the club site
  const n = done(await open('phone'));
  await siteSignIn(n, 'newbie@example.test');
  await until(async () => (await n.locator('[data-testid=apply-form]').count()) > 0);
  await shot(n, 'site-apply-phone');
  await n.locator('#ap-name').fill('Nell Newbie');
  await n.locator('#ap-discord').fill('nell#42');
  await n.locator('[data-testid=apply-form] button[type=submit]').click();
  await sleep(500);
  check('B5 applying without the bylaws agreement is stopped with a reason', (await text(n, '[data-testid=apply-form] .err')).includes('18 or older') || (await text(n, '[data-testid=apply-form] .err')).length > 0);
  await n.locator('label.check', { hasText: '18 or older' }).click();
  await n.locator('label.check', { hasText: 'bylaws' }).click();
  await n.locator('[data-testid=apply-form] button[type=submit]').click();
  await until(async () => (await text(n, '#view')).includes('Membership pending approval'));
  check('B6 a new application is Pending with dues Unpaid, and shows why the person cannot vote yet',
    sql(`select m.status || '/' || d.status from public.club_memberships m join public.club_dues d on d.membership_id = m.id where m.user_id = '${userId('newbie@example.test')}'`) === 'pending/unpaid'
    && (await text(n, '#view')).includes('NOT ELIGIBLE TO VOTE'));
  await shot(n, 'site-applied-phone');

  // the Treasurer: dashboard, dues dialog, approve, AGM, history
  const tr = done(await open('phone'));
  await siteSignIn(tr, 'treas@example.test');
  await until(async () => (await tr.locator('[data-testid=member-row]').count()) > 0);
  const sum = await text(tr, '[data-testid=summary]');
  check('B7 the Treasurer sees the members dashboard with the six counts', /7 Total members/.test(sum) && /2 Pending applications/.test(sum) && /3 Can vote/.test(sum), sum);
  check('B8 dashboard fits a 390px phone (no giant table)', await noSideways(tr));
  await shot(tr, 'site-dashboard-phone');
  await tr.getByRole('button', { name: 'Cannot vote', exact: true }).click();
  const cannot = await text(tr, '[role=table]');
  check('B9 "Cannot vote" lists each excluded member with the reason', cannot.includes('John Smith') && cannot.includes('Dues unpaid') && cannot.includes('Kit Young') && cannot.includes('Under 18') && cannot.includes('Membership pending approval') && !cannot.includes('Morgan Member'), cannot);
  await tr.getByRole('button', { name: 'All', exact: true }).click();
  await tr.getByRole('button', { name: 'Change dues for John Smith' }).click();
  await until(async () => tr.locator('#dues-dialog').isVisible());
  await shot(tr, 'site-dues-dialog-phone', false);
  await tr.locator('#dues-dialog label', { hasText: 'Paid' }).first().click();
  await tr.locator('#dues-note').fill('cash at practice');
  await tr.locator('#dues-save').click();
  await until(async () => !(await tr.locator('#dues-dialog').isVisible()));
  await until(async () => (await text(tr, '[data-testid=summary]')).includes('4 Can vote'));
  const johnDues = sql(`select status || '/' || amount_cents || '/' || (changed_by = '${userId('treas@example.test')}') || '/' || note from public.club_dues where membership_id = '${MEM(6)}'`);
  check('B10 the Treasurer marks John paid in a small dialog; John becomes eligible', johnDues === 'paid/2000/true/cash at practice' && (await text(tr, '[data-testid=summary]')).includes('4 Can vote'), johnDues + ' | ' + await text(tr, '[data-testid=summary]'));
  await tr.getByRole('button', { name: 'Approve Nell Newbie' }).click({ trial: true }).catch(() => undefined);
  tr.once('dialog', d => d.accept());
  await tr.getByRole('button', { name: 'Approve Nell Newbie' }).click();
  await until(async () => sql(`select status from public.club_memberships where user_id = '${userId('newbie@example.test')}'`) === 'active');
  check('B11 the Treasurer approves a pending application from the dashboard', sql(`select status from public.club_memberships where user_id = '${userId('newbie@example.test')}'`) === 'active');
  await tr.getByRole('button', { name: 'AGM voters' }).click();
  await until(async () => (await tr.locator('[data-testid=agm-count]').count()) > 0);
  const agm = await text(tr, '[data-testid=agm]');
  check('B12 AGM snapshot: number of eligible voters, the voters, and the excluded with reasons', /4 eligible voters/.test(agm) && /Kit Young\s*Under 18/.test(agm) && /Nell Newbie\s*Dues unpaid/.test(agm) && /Jane Smith\s*Membership pending approval/.test(agm) && /Eligible to vote.*John Smith.*Not eligible/.test(agm), agm);
  await shot(tr, 'site-agm-phone');
  await tr.getByRole('button', { name: 'Dues history' }).click();
  await until(async () => (await text(tr, '[data-testid=history]')).includes('John Smith'));
  check('B13 dues history names who changed what, from what, to what, when', (await text(tr, '[data-testid=history]')).includes(`Garrett Robson (Treasurer) changed John Smith's ${YEAR} dues from Unpaid to Paid ($20)`), await text(tr, '[data-testid=history]'));
  check('B14 no page errors on the club website', pages.every(x => x.errors.length === 0), pages.flatMap(x => x.errors).join(' | '));

  // Vice President (executive without dues authority): sees the list, no Dues / Approve buttons
  const vp = done(await open('desktop'));
  await siteSignIn(vp, 'vp@example.test');
  await until(async () => (await vp.locator('[data-testid=member-row]').count()) > 0);
  check('B15 the Vice President sees the members list but no Dues or Approve buttons', (await vp.getByRole('button', { name: /^Change dues for/ }).count()) === 0 && (await vp.getByRole('button', { name: /^Approve / }).count()) === 0);
  await shot(vp, 'site-vp-desktop');
  // another team's treasurer: only their own record on the Reavers site
  const o = done(await open('phone'));
  await siteSignIn(o, 'other@example.test');
  await until(async () => (await text(o, '#view')).length > 0);
  check('B16 another team\'s Treasurer gets no Reavers leadership tools on the club site', await o.locator('#tabs').isHidden() && (await o.locator('[data-testid=member-row]').count()) === 0 && (await o.locator('[data-testid=apply-form]').count()) === 1);
  // desktop view of the Treasurer dashboard
  const trd = done(await open('desktop'));
  await siteSignIn(trd, 'treas@example.test');
  await until(async () => (await trd.locator('[data-testid=member-row]').count()) > 0);
  await shot(trd, 'site-dashboard-desktop');
  check('B17 the club dashboard fits desktop', await noSideways(trd));
}

// ================================================================ C. BuhurtOS
{
  const p = done(await open('phone'));
  await bosSignIn(p, 'member@example.test', '/teams/red-deer-reavers');
  await p.goto(`${BASE}/teams/red-deer-reavers`);
  await until(async () => (await p.getByTestId('club-membership-link').count()) > 0);
  check('C1 the team page shows a Club membership link', (await p.getByTestId('club-membership-link').count()) === 1);
  await p.getByTestId('club-membership-link').click();
  await until(async () => (await p.getByTestId('vote-banner').count()) > 0);
  const t = await text(p, 'main');
  check('C2 a member sees status, year, dues and ELIGIBLE TO VOTE in BuhurtOS', t.includes('ELIGIBLE TO VOTE') && !t.includes('NOT ELIGIBLE') && /active/i.test(t) && t.includes(String(YEAR)) && t.includes('Paid') && !t.includes('Dues history'), t.slice(0, 400));
  check('C3 BuhurtOS member view fits a 390px phone', await noSideways(p));
  await shot(p, 'bos-member-phone');

  const tr = done(await open('phone'));
  await bosSignIn(tr, 'treas@example.test', '/teams/red-deer-reavers/membership');
  await tr.goto(`${BASE}/teams/red-deer-reavers/membership`);
  await until(async () => (await tr.getByTestId('member-row').count()) > 0);
  check('C4 the Treasurer lands on the members dashboard', (await text(tr, '[data-testid=club-summary]')).includes('Total members'));
  check('C5 BuhurtOS dashboard fits a 390px phone', await noSideways(tr));
  await shot(tr, 'bos-dashboard-phone');
  await tr.getByRole('button', { name: 'Dues unpaid' }).click();
  const unpaid = await text(tr, '[role=table]');
  check('C6 the Dues unpaid filter shows only unpaid members', unpaid.includes('Nell Newbie') && !unpaid.includes('John Smith') && !unpaid.includes('Morgan Member'), unpaid);
  await tr.getByRole('button', { name: 'Change dues for Nell Newbie' }).click();
  await tr.getByTestId('dues-dialog').locator('label', { hasText: 'Gear contribution' }).click();
  await tr.getByLabel('Value of the gear (optional)').fill('45');
  await tr.getByLabel('Note (optional)').fill('donated a gambeson');
  await shot(tr, 'bos-dues-dialog-phone', false);
  await tr.getByRole('button', { name: 'Save dues' }).click();
  await until(async () => sql(`select d.status from public.club_dues d join public.club_memberships m on m.id = d.membership_id where m.user_id = '${userId('newbie@example.test')}'`) === 'gear_contribution');
  check('C7 a gear contribution recorded in BuhurtOS makes the member eligible', sql(`select d.status || '/' || d.amount_cents from public.club_dues d join public.club_memberships m on m.id = d.membership_id where m.user_id = '${userId('newbie@example.test')}'`) === 'gear_contribution/4500');
  await tr.getByRole('tab', { name: 'AGM' }).click();
  await until(async () => (await tr.getByTestId('agm-count').count()) > 0);
  check('C8 BuhurtOS AGM snapshot counts 5 eligible voters', (await text(tr, '[data-testid=agm-count]')) === '5', await text(tr, '[data-testid=agm]'));
  await shot(tr, 'bos-agm-phone');
  await tr.emulateMedia({ media: 'print' });
  await shot(tr, 'bos-agm-print');
  check('C9 the printed AGM page hides navigation and controls', await tr.evaluate(() => getComputedStyle(document.querySelector('header.top')).display === 'none' && getComputedStyle(document.querySelector('.no-print')).display === 'none'));
  await tr.emulateMedia({ media: 'screen' });
  await tr.getByRole('tab', { name: 'Dues history' }).click();
  await until(async () => (await text(tr, '[data-testid=dues-history]')).includes('Nell Newbie'));
  check('C10 BuhurtOS dues history shows the change made on the club website too', (await text(tr, '[data-testid=dues-history]')).includes("changed John Smith's") && (await text(tr, '[data-testid=dues-history]')).includes('Gear contribution ($45)'));
  check('C11 the Treasurer cannot assign executive roles (no assign form)', await (async () => { await tr.getByRole('tab', { name: 'Executive' }).click(); await sleep(600); return (await tr.getByRole('button', { name: 'Assign' }).count()) === 0 && (await text(tr, 'main')).includes('Kedrixx Streit'); })());

  // the President hands the Treasurer role to Nora; Garrett loses it at once, Nora gains it
  const pr = done(await open('desktop'));
  await bosSignIn(pr, 'pres@example.test', '/teams/red-deer-reavers/membership?view=officers');
  await pr.goto(`${BASE}/teams/red-deer-reavers/membership?view=officers`);
  await until(async () => (await pr.getByRole('button', { name: 'Assign' }).count()) > 0);
  await shot(pr, 'bos-officers-desktop');
  await pr.getByLabel('Their BuhurtOS sign-in email').fill('next@example.test');
  await pr.getByLabel('Role').selectOption('treasurer');
  await pr.getByLabel('Note (optional)').fill('elected at AGM');
  await pr.getByRole('button', { name: 'Assign' }).click();
  await until(async () => (await text(pr, 'main')).includes('Nora Next'));
  check('C12 the President assigns a new Treasurer by sign-in email', (await text(pr, 'main')).includes('Treasurer Nora Next'));
  await tr.goto(`${BASE}/teams/red-deer-reavers/membership`);
  await until(async () => (await tr.getByTestId('my-membership').count()) > 0 || (await tr.getByTestId('member-row').count()) > 0);
  check('C13 the former Treasurer immediately loses the dashboard', (await tr.getByTestId('member-row').count()) === 0 && (await tr.getByTestId('my-membership').count()) === 1);
  const nx = done(await open('phone'));
  await bosSignIn(nx, 'next@example.test', '/teams/red-deer-reavers/membership');
  await nx.goto(`${BASE}/teams/red-deer-reavers/membership`);
  await until(async () => (await nx.getByTestId('member-row').count()) > 0);
  check('C14 the new Treasurer immediately gets the dashboard and Dues buttons', (await nx.getByRole('button', { name: /^Change dues for/ }).count()) > 0);
  check('C15 no page errors in BuhurtOS', pages.every(x => x.errors.length === 0), pages.flatMap(x => x.errors).join(' | '));

  const dd = done(await open('desktop'));
  await bosSignIn(dd, 'sec@example.test', '/teams/red-deer-reavers/membership');
  await dd.goto(`${BASE}/teams/red-deer-reavers/membership`);
  await until(async () => (await dd.getByTestId('member-row').count()) > 0);
  await shot(dd, 'bos-dashboard-desktop');
  check('C16 BuhurtOS dashboard fits desktop and shows the column headings', await noSideways(dd) && /voting/i.test(await text(dd, '.club-row.head')));
  await dd.getByRole('button', { name: 'View Jane Smith' }).click();
  await dd.getByRole('button', { name: 'Approve membership' }).click();
  await until(async () => sql(`select status from public.club_memberships where id = '${MEM(7)}'`) === 'active');
  check('C17 the Secretary approves a pending member from the member drawer', sql(`select status from public.club_memberships where id = '${MEM(7)}'`) === 'active');
}

// ================================================================ D. the database refuses what the screens hide (real tokens through the real API)
{
  check('D1 a regular member cannot change dues through the API', refused(await rpc('member@example.test', 'set_club_dues', { p_membership: MEM(6), p_status: 'unpaid' })));
  check('D2 a regular member cannot write dues directly', await (async () => { const r = await api('member@example.test', 'PATCH', `club_dues?membership_id=eq.${MEM(5)}`, { status: 'waived' }); return refused(r) && sql(`select status from public.club_dues where membership_id = '${MEM(5)}'`) === 'paid'; })());
  check('D3 a regular member cannot make themselves active / change eligibility inputs', refused(await api('member@example.test', 'PATCH', `club_memberships?id=eq.${MEM(5)}`, { status: 'active', date_of_birth: '1990-01-01' })));
  check('D4 a regular member cannot give themselves an executive role (insert)', refused(await api('member@example.test', 'POST', 'team_officers', { team_id: REAVERS, user_id: userId('member@example.test'), office: 'treasurer' })));
  check('D5 a regular member cannot give themselves an executive role (RPC)', refused(await rpc('member@example.test', 'assign_team_officer', { p_team: REAVERS, p_email: 'member@example.test', p_office: 'treasurer' })));
  check('D6 another team\'s Treasurer cannot change Reavers dues', refused(await rpc('other@example.test', 'set_club_dues', { p_membership: MEM(5), p_status: 'unpaid' })));
  check('D7 another team\'s Treasurer cannot read the Reavers roster', refused(await rpc('other@example.test', 'club_member_roster', { p_team: REAVERS, p_year: YEAR })));
  check('D8 the Vice President cannot change dues', refused(await rpc('vp@example.test', 'set_club_dues', { p_membership: MEM(5), p_status: 'unpaid' })));
  check('D9 the former Treasurer cannot change dues any more', refused(await rpc('treas@example.test', 'set_club_dues', { p_membership: MEM(5), p_status: 'unpaid' })));
  check('D10 the President can change dues', (await rpc('pres@example.test', 'set_club_dues', { p_membership: MEM(5), p_status: 'waived', p_note: 'president check' })).status < 300);
  check('D11 the Secretary can change dues', (await rpc('sec@example.test', 'set_club_dues', { p_membership: MEM(5), p_status: 'paid', p_note: 'secretary check' })).status < 300);
  check('D12 the new Treasurer can change dues', (await rpc('next@example.test', 'set_club_dues', { p_membership: MEM(5), p_status: 'paid', p_amount_cents: 2500, p_note: 'treasurer check' })).status < 300);
  check('D13 nobody can edit or remove dues history through the API', refused(await api('pres@example.test', 'PATCH', 'club_dues_history?id=gt.0', { note: 'x' })) && refused(await api('pres@example.test', 'DELETE', 'club_dues_history?id=gt.0')));
  check('D14 anonymous callers read no memberships', refused(await api(null, 'GET', 'club_memberships?select=id')));
  check('D15 a regular member reads only their own membership row', await (async () => { const r = await api('member@example.test', 'GET', 'club_memberships?select=id'); return r.status === 200 && r.body.length === 1 && r.body[0].id === MEM(5); })());
  // B10 John paid, C7 Nell gear, D10 president, D11 secretary, D12 new treasurer
  check('D16 every dues change made in this run left a history row', Number(sql(`select count(*) from public.club_dues_history`)) === 5, sql(`select count(*) from public.club_dues_history`));
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(failed ? 'CLUB LIVE FAILED' : 'CLUB LIVE PASSED');
process.exit(failed ? 1 : 0);
