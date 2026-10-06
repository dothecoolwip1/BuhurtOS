// Red Deer Reavers: one account across the club website and BuhurtOS, joining, the 2026 fee waiver, the 2026 AGM (RSVP, video, proxies,
// check-in, printable voting list) and the executive tools, on the REAL_AUTH local stack (scripts/e2e/club-live.sh): Postgres built from every
// migration on top of the real Supabase Auth server's schema, PostgREST, Supabase Auth with a mail sink and its DEFAULT (link-only) emails, the
// real built BuhurtOS app and the real club website files, both served from ONE origin exactly like production
// (https://dothecoolwip1.github.io/BuhurtOS/ and /Red-deer-reavers/ -> http://localhost:4300/BuhurtOS/ and /Red-deer-reavers/).
//   A. accounts: create on the club site (confirm by email link) -> profile -> same user on BuhurtOS; existing BuhurtOS account on the club site;
//      duplicate sign-up makes nothing; password reset by email link on the club site; no enumeration
//   B. joining and the fee waiver: application pending -> approved -> eligible without paying; BuhurtOS shows "Fee waived" and has no AGM screens
//   C. the AGM for a member: date/time, In Person, Video (+ link set by the executive), Proxy (invalid refused, change, cancel), Not Attending
//   D. executive: AGM dashboard (counts, filters), check-in separate from RSVP, proxy list, printable list, saved record; VP read-only
//   E. the database refuses what the screens hide (real tokens through the real API)
// LOCAL EVIDENCE ONLY (needs PostgREST and Supabase Auth binaries; not part of CI).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, DB = process.env.PGDATABASE, MAIL = process.env.MAILSINK;
const SITE_DIR = process.env.REAVERS_DIR ?? '/home/user/Red-deer-reavers';
const ORIGIN = 'http://localhost:4300', BOS = `${ORIGIN}/BuhurtOS`, SITE = `${ORIGIN}/Red-deer-reavers`, MEMBERS = `${SITE}/members.html`;
if (!MAIL) { console.error('MAILSINK is not set: run through scripts/e2e/club-live.sh (REAL_AUTH=1)'); process.exit(2); }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const PW = 'Fixture-pass-club';
const REAVERS = '00000000-0000-0000-0000-0000000c1ea1', MEETING = '00000000-0000-0000-0000-0000000c1ec1';
const MEM = (n) => `00000000-0000-0000-0000-0000000c1eb${n}`;

// ---- one origin, two sites: BuhurtOS built with base /BuhurtOS/, the club website's real files (only the API address swapped for the local one)
const BUILD = '/tmp/e2e-club-origin';
execFileSync('npx', ['vite', 'build', '--outDir', BUILD, '--emptyOutDir'], { env: { ...process.env, VITE_BASE: '/BuhurtOS/', VITE_SUPABASE_URL: API, VITE_SUPABASE_PUBLISHABLE_KEY: 'local-publishable-key' }, stdio: 'ignore' });
const SERVE = mkdtempSync(`${tmpdir()}/reavers-`);
cpSync(SITE_DIR, SERVE, { recursive: true, filter: (src) => !src.includes('/.git') });
const realConfig = readFileSync(`${SITE_DIR}/assets/js/buhurtos-config.js`, 'utf8');
writeFileSync(`${SERVE}/assets/js/buhurtos-config.js`, realConfig.replace('https://mvbxlebznlgroptwwdsm.supabase.co', API).replace('https://dothecoolwip1.github.io/BuhurtOS', BOS));
writeFileSync(`${SERVE}/members.html`, readFileSync(`${SITE_DIR}/members.html`, 'utf8').replaceAll('https://mvbxlebznlgroptwwdsm.supabase.co', API).replaceAll('wss://mvbxlebznlgroptwwdsm.supabase.co', API.replace('http', 'ws')));
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.avif': 'image/avif' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, ORIGIN);
  let root, rel;
  if (u.pathname.startsWith('/BuhurtOS/')) { root = BUILD; rel = u.pathname.slice('/BuhurtOS/'.length); }
  else if (u.pathname.startsWith('/Red-deer-reavers/')) { root = SERVE; rel = u.pathname.slice('/Red-deer-reavers/'.length); }
  else { res.writeHead(404); return res.end(); }
  let file = path.join(root, decodeURIComponent(rel || 'index.html'));
  if (!file.startsWith(root) || !existsSync(file) || file.endsWith('/')) file = root === BUILD ? path.join(BUILD, 'index.html') : file;
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(4300, '127.0.0.1');
check('the committed club website config points at the hosted BuhurtOS project and the production BuhurtOS address',
  realConfig.includes('https://mvbxlebznlgroptwwdsm.supabase.co') && realConfig.includes("appUrl: 'https://dothecoolwip1.github.io/BuhurtOS'"));

// ---- the real Auth server and the database, as a device would use them
async function token(email, password = PW) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x' }, body: JSON.stringify({ email, password }) });
  return (await r.json().catch(() => ({}))).access_token ?? null;
}
const tokens = new Map();
async function bearer(email) { if (!tokens.has(email)) tokens.set(email, await token(email)); return tokens.get(email); }
async function api(email, method, p, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', prefer: 'return=representation', ...(email ? { authorization: `Bearer ${await bearer(email)}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (email, fn, args) => api(email, 'POST', `rpc/${fn}`, args);
const refused = (r) => r.status >= 400 && r.status < 500;
const mail = async () => (await (await fetch(`${MAIL}/`)).json());
const mailTo = async (email, wait = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < wait) { const m = (await mail()).filter(x => x.to.includes(email)); if (m.length) return m; await sleep(250); } return []; };
const linkIn = (m, type) => m?.links.find(l => /\/auth\/v1\/verify/.test(l) && l.includes(`type=${type}`));
const userId = (email) => sql(`select id from auth.users where email = '${email}'`);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, desktop: { viewport: { width: 1280, height: 900 } } };
const pages = [];
async function open(kind = 'phone') {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  // the sandbox has no internet: the club site's Materialize / Google Fonts are left out (layout is checked without them, the harder case)
  await ctx.route(/posthog\.com|maps\.googleapis\.com|accounts\.google\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.abort('failed'));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|net::ERR|Failed to fetch|40[0-9]|42501|\[BuhurtOS\]|AuthApiError|AuthPKCE|AuthRetryable/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  pages.push(page);
  return page;
}
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = async (page, name, full = true) => { if (SHOTS) { await sleep(350); await page.screenshot({ path: `${SHOTS}/club-${name}.png`, fullPage: full }).catch(() => undefined); } };
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const until = async (fn, timeout = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const sessionUser = (page) => page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) { const s = JSON.parse(localStorage.getItem(k) ?? 'null'); if (s?.user?.id) return s.user.id; } return null; });
async function siteSignIn(page, email, password = PW) {
  await page.goto(MEMBERS);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#password-btn').click();
  await until(async () => !(await page.locator('#signed-in').isHidden()) && (await text(page, '#view')).length > 20);
}
async function bosSignIn(page, email, password = PW, next = '/account') {
  await page.goto(`${BOS}/sign-in?next=${encodeURIComponent(next)}`);
  const form = page.getByRole('form', { name: 'Sign in with email and password' });
  await form.getByLabel('Email', { exact: true }).fill(email);
  await form.getByLabel('Password', { exact: true }).fill(password);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await until(async () => !!(await sessionUser(page)));
}
const tab = (page, name) => page.locator('#tabs').getByRole('button', { name, exact: true }).click();
let phoneOk = true; const phoneBad = [];
async function phoneCheck(page, name) { const ok = await noSideways(page); if (!ok) { phoneOk = false; phoneBad.push(name); } await shot(page, name); }

// ================================================================ A. one account
const NEW = 'riley.new@example.test';
let newId = null;
{
  const p = await open('phone');
  await p.goto(MEMBERS);
  await p.locator('[data-auth-tab=signup]').click();
  await phoneCheck(p, 'site-create-account-phone');
  await p.locator('#su-name').fill('Riley Newmember');
  await p.locator('#su-email').fill(NEW);
  await p.locator('#su-password').fill('Riley-pass-2026');
  await p.locator('#su-password2').fill('Riley-pass-2026');
  await p.locator('#signup-btn').click();
  await until(async () => p.locator('#signup-check').isVisible());
  check('A1 Create account on the club website asks the person to confirm their email', (await text(p, '#signup-check')).includes('Check your email'));
  const link = linkIn((await mailTo(NEW))[0], 'signup');
  check('A2 the confirmation email returns to the club website (not BuhurtOS)', !!link && decodeURIComponent(link).includes('/Red-deer-reavers/members.html'), link);
  await p.goto(link);
  await until(async () => (await p.locator('[data-testid=profile-setup]').count()) > 0);
  newId = await sessionUser(p);
  check('A3 confirming the email signs the new person in on the club website: ONE new auth.users row, with a BuhurtOS profile',
    !!newId && sql(`select count(*) from auth.users where email = '${NEW}'`) === '1' && sql(`select count(*) from public.profiles where id = '${newId}'`) === '1', newId);
  await phoneCheck(p, 'site-profile-setup-phone');
  check('A4 the profile step suggests the name given at sign-up', (await p.locator('#pf-name').inputValue()) === 'Riley Newmember');
  await p.getByRole('button', { name: 'Continue' }).click();
  await until(async () => (await p.locator('[data-testid=apply-form]').count()) > 0);
  check('A5 the profile step completes BuhurtOS\'s own setup (complete_my_profile) and leads straight to Join the Red Deer Reavers',
    sql(`select (onboarded_at is not null) || '/' || display_name || '/' || array_to_string(interests, ',') from public.profiles where id = '${newId}'`) === 'true/Riley Newmember/fighter'
    && (await text(p, '#tabs')).includes('Join the Reavers'));
  // B. join (continues with the same person)
  await phoneCheck(p, 'site-join-phone');
  check('B1 the application form already has the name and says the 2026 fee is waived', (await p.locator('#ap-name').inputValue()) === 'Riley Newmember' && (await text(p, '[data-testid=apply-form]')).includes('membership fee is waived'));
  await p.locator('label.check', { hasText: '18 or older' }).click();
  await p.locator('label.check', { hasText: 'bylaws' }).click();
  await p.getByRole('button', { name: 'Apply to join' }).click();
  await until(async () => (await text(p, '#view')).includes('Membership Application Pending'));
  const pend = await text(p, '[data-testid=my-membership]');
  check('B2 after applying: "Membership Application Pending", 2026 fee WAIVED, NOT CURRENTLY ELIGIBLE (pending approval)',
    pend.includes('Membership Application Pending') && pend.includes('WAIVED') && pend.includes('NOT CURRENTLY ELIGIBLE TO VOTE') && pend.includes('Membership pending approval'), pend);
  await phoneCheck(p, 'site-pending-phone');
  // sign out on the club website, then sign in to BuhurtOS with the account created on the club website
  await p.locator('#sign-out').click();
  await until(async () => !(await sessionUser(p)));
  const bos = await open('desktop');
  await bosSignIn(bos, NEW, 'Riley-pass-2026');
  await bos.goto(`${BOS}/account`);
  await sleep(1500);
  check('A6 the account created on the club website signs in to BuhurtOS: the SAME Supabase user id, no second account',
    (await sessionUser(bos)) === newId && sql(`select count(*) from auth.users where email = '${NEW}'`) === '1', `${await sessionUser(bos)} vs ${newId}`);
  check('A7 BuhurtOS does not send them through setup again (profile already complete)', !bos.url().includes('/welcome'), bos.url());
  // same origin: the browser keeps one sign-in for both websites
  await bos.goto(MEMBERS);
  await until(async () => !(await bos.locator('#signed-in').isHidden()));
  check('A8 being signed in on BuhurtOS means being signed in on the club website (same origin, same session; no token passed)', (await text(bos, '#who')) === NEW);

  // an existing BuhurtOS account signs in on the club website
  const memberId = userId('member@example.test');
  const before = sql('select count(*) from auth.users');
  const ex = await open('phone');
  await siteSignIn(ex, 'member@example.test');
  check('A9 an existing BuhurtOS account signs in on the club website as the same user, with no new account or membership',
    (await sessionUser(ex)) === memberId && sql('select count(*) from auth.users') === before && sql(`select count(*) from public.club_memberships where user_id = '${memberId}'`) === '1'
    && (await text(ex, '#view')).includes('Membership: Active'));
  // trying to create an account with an email that already has one
  const dup = await open('phone');
  await dup.goto(MEMBERS);
  await dup.locator('[data-auth-tab=signup]').click();
  await dup.locator('#su-name').fill('Someone Else');
  await dup.locator('#su-email').fill('member@example.test');
  await dup.locator('#su-password').fill('Another-pass-1');
  await dup.locator('#su-password2').fill('Another-pass-1');
  await dup.locator('#signup-btn').click();
  await until(async () => dup.locator('#signup-check').isVisible() || (await text(dup, '#status')).length > 0);
  const dupText = await text(dup, '#signed-out');
  check('A10 signing up with an existing email creates no second identity and offers Sign in / Reset password without saying the account exists',
    sql(`select count(*) from auth.users where email = 'member@example.test'`) === '1' && sql('select count(*) from auth.users') === before
    && /sign in/i.test(dupText) && /reset your password/i.test(dupText) && sql(`select encrypted_password = extensions.crypt('${PW}', encrypted_password) from auth.users where email = 'member@example.test'`) === 't', dupText);
  // password reset from the club website
  await fetch(`${MAIL}/`, { method: 'DELETE' });
  const rs = await open('phone');
  await rs.goto(MEMBERS);
  await rs.locator('[data-auth-tab=forgot]').click();
  await rs.locator('#fp-email').fill('john@example.test');
  await rs.locator('#forgot-btn').click();
  await until(async () => rs.locator('#forgot-check').isVisible());
  const rlink = linkIn((await mailTo('john@example.test'))[0], 'recovery');
  check('A11 the reset email returns to the club website', !!rlink && decodeURIComponent(rlink).includes('/Red-deer-reavers/members.html?reset=1'), rlink);
  await rs.goto(rlink);
  await until(async () => rs.locator('#new-password').isVisible());
  await phoneCheck(rs, 'site-new-password-phone');
  await rs.locator('#np-password').fill('John-new-pass-26');
  await rs.locator('#np-password2').fill('John-new-pass-26');
  await rs.locator('#newpw-btn').click();
  await until(async () => (await text(rs, '#status')).includes('Password saved'));
  check('A12 the new password works on BuhurtOS too (one account)', !!(await token('john@example.test', 'John-new-pass-26')) && !(await token('john@example.test', PW)));
  const nf = await open('phone');
  await nf.goto(MEMBERS);
  await nf.locator('[data-auth-tab=forgot]').click();
  await nf.locator('#fp-email').fill('nobody-here@example.test');
  await nf.locator('#forgot-btn').click();
  await until(async () => nf.locator('#forgot-check').isVisible());
  check('A13 a reset request for an unknown address gets the same answer (no account enumeration)', await nf.locator('#forgot-check').isVisible());
  const wp = await open('phone');
  await wp.goto(MEMBERS);
  await wp.locator('#email').fill('member@example.test'); await wp.locator('#password').fill('wrong-password-1'); await wp.locator('#password-btn').click(); await sleep(900);
  const w1 = await text(wp, '#status');
  await wp.locator('#email').fill('nobody-here@example.test'); await wp.locator('#password').fill('wrong-password-1'); await wp.locator('#password-btn').click(); await sleep(900);
  check('A14 a wrong password and an unknown email read the same', w1.length > 0 && w1 === await text(wp, '#status'));
}

// ================================================================ B (cont). approval and the fee waiver
{
  const tr = await open('phone');
  await siteSignIn(tr, 'treas@example.test');
  await tab(tr, 'Members');
  await until(async () => (await tr.locator('[data-testid=member-row]').count()) > 0);
  const t = await text(tr, '[role=table]');
  check('B3 the executive dashboard shows the fee as waived, not Unpaid, and nobody owes dues', t.includes('Fee waived') && !t.includes('Unpaid') && (await text(tr, '[data-testid=summary]')).includes('0 Dues outstanding'), t.slice(0, 300));
  check('B4 John (fee never paid) is eligible to vote in 2026', /John Smith.*?Can vote/.test(t));
  tr.once('dialog', d => d.accept());
  await tr.getByRole('button', { name: 'Approve Riley Newmember' }).click();
  await until(async () => sql(`select status from public.club_memberships where user_id = '${newId}'`) === 'active');
  const rp = await open('phone');
  await siteSignIn(rp, NEW, 'Riley-pass-2026');
  const mine = await text(rp, '[data-testid=my-membership]');
  check('B5 once approved: Membership: Active, fee WAIVED, ELIGIBLE TO VOTE without paying $20',
    mine.includes('Membership: Active') && mine.includes('WAIVED') && mine.includes('ELIGIBLE TO VOTE') && !mine.includes('NOT CURRENTLY') && sql(`select d.status from public.club_dues d join public.club_memberships m on m.id = d.membership_id where m.user_id = '${newId}'`) === 'unpaid', mine);
  check('B6 a regular member gets no executive tabs on the club website', !(await text(rp, '#tabs')).includes('Members') && !(await text(rp, '#tabs')).includes('AGM admin'));
  // BuhurtOS: membership infrastructure only, no AGM screens, fee shown as waived
  const bo = await open('phone');
  await bosSignIn(bo, 'treas@example.test', PW, '/teams/red-deer-reavers/membership');
  await bo.goto(`${BOS}/teams/red-deer-reavers/membership`);
  await until(async () => (await bo.getByTestId('member-row').count()) > 0);
  const tabsText = await text(bo, '.tabs');
  const bt = await text(bo, 'main');
  check('B7 BuhurtOS keeps membership, dues and eligibility but has NO AGM screens', !/AGM/i.test(tabsText) && !/RSVP|proxy|check.?in/i.test(bt), tabsText);
  check('B8 BuhurtOS shows the 2026 fee as waived', bt.includes('Fee waived') && !bt.includes('Unpaid'));
  await shot(bo, 'bos-dashboard-waived-phone');
}

// ================================================================ C. the AGM for a member
{
  const p = await open('phone');
  await siteSignIn(p, 'member@example.test');
  await tab(p, '2026 AGM');
  await until(async () => (await p.locator('[data-testid=agm-member]').count()) > 0);
  const head = await text(p, '[data-testid=agm-head]');
  check('C1 the AGM shows Sunday, October 18, 2026 at 5:30 PM (Red Deer time)', head.includes('RED DEER REAVERS 2026 AGM') && head.includes('Sunday, October 18, 2026') && head.includes('5:30 PM') && head.includes('Mountain time'), head);
  const card = await text(p, '[data-testid=agm-member]');
  check('C2 the AGM card shows membership, WAIVED fee and voting status', card.includes('Active') && card.includes('2026 Membership Fee WAIVED') && card.includes('ELIGIBLE TO VOTE'), card);
  await phoneCheck(p, 'site-agm-member-phone');
  await p.getByRole('button', { name: 'In Person', exact: true }).click();
  await until(async () => (await text(p, '[data-testid=rsvp-now]')).includes('Attending In Person'));
  check('C3 In Person: shows "Attending In Person" and records it', sql(`select response from public.club_meeting_rsvps where membership_id = '${MEM(5)}'`) === 'in_person');
  await p.getByRole('button', { name: 'Video Call', exact: true }).click();
  await until(async () => (await text(p, '[data-testid=rsvp-now]')).includes('Attending by Video Call'));
  check('C4 Video Call: shows "Attending by Video Call" and that the link will appear (none set yet); still ONE RSVP row',
    (await text(p, '[data-testid=video-info]')).includes('will appear here') && sql(`select count(*) from public.club_meeting_rsvps where membership_id = '${MEM(5)}'`) === '1');
  // the executive sets the video link; the member sees it
  const sec = await open('desktop');
  await siteSignIn(sec, 'sec@example.test');
  await tab(sec, 'AGM admin');
  await until(async () => (await sec.locator('[data-testid=video-form]').count()) > 0);
  await sec.locator('#vid-link').fill('https://meet.example/reavers-agm-2026');
  await sec.locator('#vid-details').fill('Passcode 1018');
  await sec.getByRole('button', { name: 'Save video link' }).click();
  await until(async () => (await text(sec, '#status')).includes('Video link saved'));
  await p.reload(); await until(async () => !(await p.locator('#signed-in').isHidden()));
  await tab(p, '2026 AGM');
  await until(async () => (await text(p, '[data-testid=video-info]')).includes('meet.example'));
  check('C5 after the executive adds it, the member sees the private video link', (await text(p, '[data-testid=video-info]')).includes('https://meet.example/reavers-agm-2026') && (await text(p, '[data-testid=video-info]')).includes('Passcode 1018'));
  // a signed-in person who is not a member never gets the link
  const nm = await rpc('next@example.test', 'club_meeting_member_view', { p_team: REAVERS });
  check('C6 a signed-in non-member never receives the video link', nm.status === 200 && nm.body.video === null && nm.body.membership === null);
  // proxy
  await p.getByRole('button', { name: 'Voting by Proxy', exact: true }).click();
  await until(async () => (await p.locator('[data-testid=proxy-form]').count()) > 0);
  const opts = await p.locator('#proxy-holder option').allInnerTexts();
  check('C7 the proxy list offers only eligible voting members (not pending Jane, not under-18 Kit, not themselves)',
    opts.includes('John Smith') && !opts.includes('Jane Smith') && !opts.includes('Kit Young') && !opts.includes('Morgan Member'), opts.join(','));
  await p.locator('#proxy-holder').selectOption({ label: 'John Smith' });
  await p.getByRole('button', { name: 'Save my proxy' }).click();
  check('C8 a proxy without the explicit authorization is refused', (await text(p, '[data-testid=proxy-form] .err')).includes('Tick the authorization'));
  check('C9 the authorization wording names the October 18, 2026 Red Deer Reavers AGM', (await text(p, '[data-testid=proxy-form]')).includes('I authorize the selected member to act as my proxy for the October 18, 2026 Red Deer Reavers AGM.'));
  await phoneCheck(p, 'site-proxy-form-phone');
  await p.locator('#proxy-ok').check();
  await p.getByRole('button', { name: 'Save my proxy' }).click();
  await until(async () => (await text(p, '[data-testid=proxy-holder]')) === 'John Smith');
  check('C10 Voting by Proxy: "Your Proxy: John Smith", stored with giver, holder, time and wording',
    sql(`select h.full_name || '|' || (p.authorized_at is not null) || '|' || p.authorization_text from public.club_meeting_proxies p join public.club_memberships h on h.id = p.holder_membership_id where p.grantor_membership_id = '${MEM(5)}' and p.status = 'active'`)
      === 'John Smith|true|I authorize John Smith to act as my proxy for the October 18, 2026 Red Deer Reavers AGM.');
  const bad = await rpc('member@example.test', 'set_club_meeting_rsvp', { p_meeting: MEETING, p_response: 'proxy', p_proxy_holder: MEM(7), p_authorize: true });
  check('C11 an invalid proxy (holder not eligible: pending Jane) is rejected by the database', bad.status >= 400 && /not eligible/.test(JSON.stringify(bad.body)), JSON.stringify(bad.body));
  await p.getByRole('button', { name: 'Change proxy' }).click();
  await p.locator('#proxy-holder').selectOption({ label: 'Kedrixx Streit' });
  await p.locator('#proxy-ok').check();
  await p.getByRole('button', { name: 'Save my proxy' }).click();
  await until(async () => (await text(p, '[data-testid=proxy-holder]')) === 'Kedrixx Streit');
  check('C12 changing the proxy replaces the old one (kept as history), one active', sql(`select string_agg(status, ',' order by authorized_at) from public.club_meeting_proxies where grantor_membership_id = '${MEM(5)}'`) === 'replaced,active');
  p.once('dialog', d => d.accept());
  await p.getByRole('button', { name: 'Cancel proxy' }).click();
  await until(async () => (await text(p, '[data-testid=agm-member]')).includes('How will you participate?'));
  check('C13 cancelling the proxy ends it and asks again how they will participate', sql(`select count(*) from public.club_meeting_proxies where grantor_membership_id = '${MEM(5)}' and status = 'active'`) === '0');
  await p.getByRole('button', { name: 'Not Attending', exact: true }).click();
  await until(async () => (await text(p, '[data-testid=rsvp-now]')).includes('Not Attending'));
  check('C14 Not Attending is recorded; every change is in the RSVP history',
    sql(`select string_agg(coalesce(previous_response,'-') || '>' || coalesce(new_response,'-'), ',' order by id) from public.club_meeting_rsvp_history where membership_id = '${MEM(5)}'`)
      === '->in_person,in_person>video,video>proxy,proxy>-,->not_attending');
  // a few more answers for the executive views
  const kid = await open('phone'); await siteSignIn(kid, 'kid@example.test'); await tab(kid, '2026 AGM');
  await kid.getByRole('button', { name: 'Voting by Proxy', exact: true }).click(); await kid.locator('#proxy-holder').selectOption({ label: 'Kedrixx Streit' }); await kid.locator('#proxy-ok').check();
  await kid.getByRole('button', { name: 'Save my proxy' }).click(); await until(async () => (await text(kid, '[data-testid=proxy-holder]')) === 'Kedrixx Streit');
  check('C15 an under-18 member may still register (here: by proxy); their proxy shows as not valid', (await text(kid, '[data-testid=rsvp-now]')).includes('Not currently valid'));
  const jo = await open('phone'); await siteSignIn(jo, 'john@example.test', 'John-new-pass-26'); await tab(jo, '2026 AGM');
  await jo.getByRole('button', { name: 'Voting by Proxy', exact: true }).click(); await jo.locator('#proxy-holder').selectOption({ label: 'Kedrixx Streit' }); await jo.locator('#proxy-ok').check();
  await jo.getByRole('button', { name: 'Save my proxy' }).click(); await until(async () => (await text(jo, '[data-testid=proxy-holder]')) === 'Kedrixx Streit');
  const rl = await open('phone'); await siteSignIn(rl, NEW, 'Riley-pass-2026'); await tab(rl, '2026 AGM');
  await rl.getByRole('button', { name: 'In Person', exact: true }).click(); await until(async () => (await text(rl, '[data-testid=rsvp-now]')).includes('Attending In Person'));
  const pr = await open('phone'); await siteSignIn(pr, 'pres@example.test'); await tab(pr, '2026 AGM');
  check('C16 the proxy holder sees the proxy authority they hold, separate from their own vote', (await text(pr, '[data-testid=agm-member]')).includes('Proxy authority you hold') && (await text(pr, '[data-testid=agm-member]')).includes('John Smith'));
}

// ================================================================ D. executive AGM tools
{
  const tr = await open('phone');
  await siteSignIn(tr, 'treas@example.test');
  await tab(tr, 'AGM admin');
  await until(async () => (await tr.locator('[data-testid=agm-row]').count()) > 0);
  const sum = await text(tr, '[data-testid=agm-summary]');
  check('D1 AGM dashboard counts: total, voting eligible, in person, video, proxy, not attending, no response',
    /7 Total members/.test(sum) && /1 In person/.test(sum) && /0 Video call/.test(sum) && /2 Voting by proxy/.test(sum) && /1 Not attending/.test(sum) && /3 No response/.test(sum) && /5 Voting eligible/.test(sum), sum);
  await phoneCheck(tr, 'site-agm-admin-phone');
  await tr.locator('.filters button', { hasText: 'Proxy' }).click();
  const prox = await text(tr, '#view');
  check('D2 the Proxy filter lists who gave proxies and to whom', (await tr.locator('[data-testid=agm-row]').count()) === 2 && prox.includes('Proxy → Kedrixx Streit'));
  await tr.locator('.filters button', { hasText: 'No response' }).click();
  check("D3 the No response filter works", (await tr.locator("[data-testid=agm-row]").count()) === 3);
  await tr.locator('.filters button', { hasText: 'All' }).first().click();
  await tr.getByRole('button', { name: 'Present in person: Riley Newmember' }).click();
  await until(async () => sql(`select status from public.club_meeting_attendance a join public.club_memberships m on m.id = a.membership_id where m.user_id = '${newId}'`) === 'present_in_person');
  await tr.getByRole('button', { name: 'Present by video: Morgan Member' }).click();
  await until(async () => sql(`select status from public.club_meeting_attendance where membership_id = '${MEM(5)}'`) === 'present_video');
  check('D4 check-in records attendance, who and when, and does NOT overwrite the RSVP',
    sql(`select a.status || '|' || a.recorded_by_name || '|' || r.response from public.club_meeting_attendance a join public.club_meeting_rsvps r using (meeting_id, membership_id) where a.membership_id = '${MEM(5)}'`) === 'present_video|Garrett Robson|not_attending');
  await until(async () => (await text(tr, '#view')).includes('Present by video'));
  await tab(tr, 'Proxies');
  await until(async () => (await tr.locator('[data-testid=proxy-holder-row]').count()) > 0);
  const pl = await text(tr, '#view');
  check('D5 the proxy dashboard shows the holder\'s own vote and how many VALID proxies they hold (Kit\'s under-18 proxy not valid)',
    /Kedrixx Streit Own vote: eligible · Proxy authority held: 1 valid/.test(pl) && /From Kit Young\s*—\s*Not valid\s*Member giving the proxy is not eligible to vote/.test(pl) && /From John Smith\s*—\s*Valid/.test(pl), pl.slice(0, 600));
  await phoneCheck(tr, 'site-proxies-phone');
  await tab(tr, 'AGM voting list');
  await until(async () => (await tr.locator('[data-testid=print-eligible-count]').count()) > 0);
  const list = await text(tr, '[data-testid=agm-print]');
  check('D6 the printable voting list: eligible voters, attendance, in person / video attendees, valid proxies, not eligible with reasons, no response',
    list.includes('Eligible voters') && list.includes('Riley Newmember — Present in person') && list.includes('Present by video Morgan Member') && list.includes('Kedrixx Streit holds the proxy of John Smith')
    && /Jane Smith\s*Membership pending approval/.test(list) && /Kit Young\s*Under 18/.test(list) && list.includes('No response'), list.slice(0, 900));
  await tr.emulateMedia({ media: 'print' });
  await shot(tr, 'site-voting-list-print');
  check('D7 printing hides the navigation, tabs and buttons', await tr.evaluate(() => getComputedStyle(document.querySelector('#tabs')).display === 'none' && getComputedStyle(document.querySelector('.row-btns.no-print')).display === 'none'));
  await tr.emulateMedia({ media: 'screen' });
  tr.once('dialog', d => d.accept());
  await tr.getByRole('button', { name: 'Save official AGM record' }).click();
  await until(async () => sql(`select count(*) from public.club_meeting_records`) === '1');
  sql(`update public.club_memberships set status = 'inactive' where id = '${MEM(6)}'`);   // a change AFTER the record was saved
  check('D8 the saved official record does not change when a membership changes later',
    sql(`select e->>'eligible' from public.club_meeting_records r, jsonb_array_elements(r.snapshot->'members') e where e->>'full_name' = 'John Smith'`) === 'true');
  sql(`update public.club_memberships set status = 'active' where id = '${MEM(6)}'`);
  // vice president: can look, cannot check in
  const vp = await open('desktop');
  await siteSignIn(vp, 'vp@example.test');
  await tab(vp, 'AGM admin');
  await until(async () => (await vp.locator('[data-testid=agm-row]').count()) > 0);
  check('D9 the Vice President sees the AGM dashboard but no check-in buttons or video link form', (await vp.locator('.checkin').count()) === 0 && (await vp.locator('[data-testid=video-form]').count()) === 0);
  await shot(vp, 'site-agm-admin-desktop');
  check('D10 the AGM dashboard fits desktop', await noSideways(vp));
}

// ================================================================ E. the database refuses what the screens hide
{
  check('E1 a regular member cannot change dues', refused(await rpc('member@example.test', 'set_club_dues', { p_membership: MEM(6), p_status: 'paid' })));
  check('E2 a regular member cannot approve themselves or change eligibility inputs', refused(await rpc('member@example.test', 'set_club_membership_status', { p_membership: MEM(5), p_status: 'active' }))
    && refused(await api('member@example.test', 'PATCH', `club_memberships?id=eq.${MEM(5)}`, { date_of_birth: '1990-01-01' })));
  check('E3 a regular member cannot give themselves an executive role', refused(await rpc('member@example.test', 'assign_team_officer', { p_team: REAVERS, p_email: 'member@example.test', p_office: 'treasurer' })));
  check('E4 a regular member cannot change another person\'s RSVP or create a proxy for them', refused(await api('member@example.test', 'PATCH', `club_meeting_rsvps?membership_id=eq.${MEM(6)}`, { response: 'video' }))
    && refused(await api('member@example.test', 'POST', 'club_meeting_proxies', { meeting_id: MEETING, grantor_membership_id: MEM(6), holder_membership_id: MEM(5), authorization_text: 'I authorize Morgan to act', authorized_by: userId('member@example.test') })));
  check('E5 a regular member cannot record check-in or change it', refused(await rpc('member@example.test', 'set_club_meeting_attendance', { p_meeting: MEETING, p_membership: MEM(5), p_status: 'present_in_person' }))
    && refused(await api('member@example.test', 'PATCH', `club_meeting_attendance?membership_id=eq.${MEM(5)}`, { status: 'absent' })));
  check('E6 nobody can alter history or saved AGM records through the API', refused(await api('pres@example.test', 'PATCH', 'club_meeting_rsvp_history?id=gt.0', { new_response: 'video' }))
    && refused(await api('pres@example.test', 'DELETE', 'club_meeting_records?id=gt.0')) && refused(await api('pres@example.test', 'PATCH', 'club_dues_history?id=gt.0', { note: 'x' })));
  check('E7 a regular member cannot open the executive AGM views', refused(await rpc('member@example.test', 'club_meeting_dashboard', { p_meeting: MEETING })) && refused(await rpc('member@example.test', 'club_meeting_proxy_list', { p_meeting: MEETING })));
  check('E8 another club\'s Treasurer cannot see or administer the Reavers AGM', refused(await rpc('other@example.test', 'club_meeting_dashboard', { p_meeting: MEETING }))
    && refused(await rpc('other@example.test', 'set_club_meeting_attendance', { p_meeting: MEETING, p_membership: MEM(5), p_status: 'absent' })));
  check('E9 President and Secretary can also record check-in', (await rpc('pres@example.test', 'set_club_meeting_attendance', { p_meeting: MEETING, p_membership: MEM(8), p_status: 'absent' })).status < 300
    && (await rpc('sec@example.test', 'set_club_meeting_attendance', { p_meeting: MEETING, p_membership: MEM(8), p_status: 'present_video' })).status < 300);
  check('E10 anonymous callers read nothing', refused(await api(null, 'GET', 'club_meetings?select=id')) && refused(await rpc(null, 'club_meeting_member_view', { p_team: REAVERS })));
}

check('P1 every club-website screen fits a 390px phone without sideways scrolling', phoneOk, phoneBad.join(', '));
check('P2 no page errors on either website', pages.every(x => x.errors.length === 0), pages.flatMap(x => x.errors).join(' | '));
await browser.close();
server.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(failed ? 'CLUB LIVE FAILED' : 'CLUB LIVE PASSED');
process.exit(failed ? 1 : 0);
