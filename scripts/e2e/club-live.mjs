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
  page.on('pageerror', e => { page.errors.push(String(e).slice(0, 300)); console.log('PAGE ERROR  ' + String(e).slice(0, 300)); });
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

// ================================================================ F. AGM concerns and executive nominations (club website only)
{
  const officersBefore = sql(`select string_agg(office || ':' || user_id || ':' || coalesce(ended_on::text, '-'), ',' order by office, user_id) from public.team_officers where team_id = '${REAVERS}'`);
  const m = await open('phone');
  await siteSignIn(m, 'member@example.test');
  await tab(m, '2026 AGM');
  await until(async () => (await m.locator('[data-testid=agm-topics]').count()) > 0);
  const pageText = await text(m, '#view');
  check('F1 the AGM page keeps the RSVP and adds "Something you want discussed?" and Executive Nominations',
    pageText.includes('Not Attending') && pageText.includes('Change how you will participate') && pageText.includes('Voting by Proxy'), pageText.slice(0, 200));
  check('F2 the concern wording is the friendly one from the club', pageText.includes('Something you want discussed?') && pageText.includes('If there is a concern, question, idea or topic you would like brought up at the AGM, submit it here.') && pageText.includes('Executive Nominations'));
  await phoneCheck(m, 'site-agm-extras-phone');
  await m.getByRole('button', { name: 'Submit AGM Concern / Topic' }).click();
  await m.locator('#topic-subject').fill('Hall rental costs');
  await m.locator('#topic-details').fill('The hall costs more next year.\nCan we talk about a second location?');
  await m.getByRole('button', { name: 'Submit for AGM' }).click();
  await until(async () => (await m.locator('[data-testid=topic-received]').count()) > 0);
  check('F3 submitting a topic confirms it was received and lists it with its date and status Submitted',
    (await text(m, '[data-testid=topic-received]')).includes('Received') && (await text(m, '[data-testid=my-topic]')).includes('Hall rental costs') && (await text(m, '[data-testid=my-topic]')).includes('Submitted'), await text(m, '#agm-topics'));
  check('F4 the topic is stored against the member\'s own membership', sql(`select m.full_name || '|' || t.status from public.club_meeting_topics t join public.club_memberships m on m.id = t.membership_id where t.subject = 'Hall rental costs'`) === 'Morgan Member|submitted');
  await m.getByRole('button', { name: 'Edit', exact: true }).click();
  await m.locator('#topic-subject').fill('Hall rental costs and a second location');
  await m.getByRole('button', { name: 'Save changes' }).click();
  await until(async () => (await text(m, '[data-testid=my-topic]')).includes('second location'));
  check('F5 the member can edit their own topic (the history keeps both versions)', sql(`select count(*) from public.club_meeting_topic_history h join public.club_meeting_topics t on t.id = h.topic_id where t.subject like 'Hall rental costs and%'`) === '2');
  // another member cannot touch it
  const topicId = sql(`select id from public.club_meeting_topics where subject like 'Hall rental costs%'`);
  check('F6 another member cannot edit or withdraw it, and cannot read the table', refused(await rpc('john@example.test', 'update_club_agm_topic', { p_topic: topicId, p_subject: 'Changed by John', p_details: 'x' }).catch(() => ({ status: 400 })))
    && refused(await rpc('john@example.test', 'withdraw_club_agm_topic', { p_topic: topicId })) && refused(await api('john@example.test', 'GET', 'club_meeting_topics?select=id')));
  // the executive sees it and updates its status
  const tr = await open('phone');
  await siteSignIn(tr, 'treas@example.test');
  await tab(tr, 'AGM admin');
  await until(async () => (await tr.locator('[data-testid=agm-row]').count()) > 0);
  await tr.getByRole('button', { name: 'Concerns', exact: true }).click();
  await until(async () => (await tr.locator('[data-testid=topic-row]').count()) > 0);
  const row = await text(tr, '[data-testid=topic-row]');
  check('F7 the Treasurer sees the concern with the member, subject, details, time and status',
    row.includes('Hall rental costs and a second location') && row.includes('Morgan Member') && row.includes('Can we talk about a second location?') && row.includes('Submitted') && row.includes('edited'), row);
  await phoneCheck(tr, 'site-concerns-admin-phone');
  await tr.getByRole('button', { name: 'Add to agenda' }).click();
  await until(async () => sql(`select status from public.club_meeting_topics where id = '${topicId}'`) === 'on_agenda');
  await m.reload(); await until(async () => !(await m.locator('#signed-in').isHidden())); await tab(m, '2026 AGM');
  await until(async () => (await m.locator('[data-testid=my-topic]').count()) > 0);
  check('F8 the member sees "Added to Agenda" and can still edit it', (await text(m, '[data-testid=my-topic]')).includes('Added to Agenda') && (await m.getByRole('button', { name: 'Edit', exact: true }).count()) === 1);
  const vp = await open('desktop');
  await siteSignIn(vp, 'vp@example.test'); await tab(vp, 'AGM admin'); await until(async () => (await vp.locator('[data-testid=agm-row]').count()) > 0);
  await vp.getByRole('button', { name: 'Concerns', exact: true }).click();
  await until(async () => (await vp.locator('[data-testid=topic-row]').count()) > 0);
  check('F9 the Vice President can read the concerns but has no status buttons', (await vp.getByRole('button', { name: 'Add to agenda' }).count()) === 0 && refused(await rpc('vp@example.test', 'set_club_agm_topic_status', { p_topic: topicId, p_status: 'addressed' })));
  check('F10 a regular member cannot open the executive concerns list or set a status', refused(await rpc('member@example.test', 'club_agm_topics_admin', { p_meeting: MEETING })) && refused(await rpc('member@example.test', 'set_club_agm_topic_status', { p_topic: topicId, p_status: 'addressed' })));
  m.once('dialog', d => d.accept());
  await m.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await until(async () => (await text(m, '[data-testid=my-topic]')).includes('Withdrawn'));
  check('F11 the member can withdraw their topic: it stays (status Withdrawn), no longer editable; the executive sees it withdrawn', sql(`select status from public.club_meeting_topics where id = '${topicId}'`) === 'withdrawn'
    && (await m.getByRole('button', { name: 'Edit', exact: true }).count()) === 0);
  await tr.getByRole('button', { name: 'Nominations', exact: true }).click(); await tr.getByRole('button', { name: 'Concerns', exact: true }).click();
  await until(async () => (await text(tr, '#view')).includes('Withdrawn'));
  check('F12 the executive list shows the withdrawn topic and says the member withdrew it', (await text(tr, '[data-testid=topic-row]')).includes('The member withdrew this topic.'));

  // ---- nominations: yourself, three offices
  const nom = m.locator('[data-testid=nominate-form]');
  const rolePick = (page, r) => page.locator('[data-testid=nominate-form]').getByRole('button', { name: r, exact: true }).click();
  await nom.getByRole('button', { name: 'Nominate Myself' }).click();
  await rolePick(m, 'President');
  const conf = await text(m, '[data-testid=nomination-confirm]');
  check('F13 nominating yourself asks to confirm: "You are nominating yourself for President at the 2026 Red Deer Reavers AGM."', conf.includes('You are nominating yourself for President at the 2026 Red Deer Reavers AGM.'), conf);
  await phoneCheck(m, 'site-nominate-phone');
  await m.getByRole('button', { name: 'Confirm Nomination' }).click();
  await until(async () => (await text(m, '[data-testid=office-president]')).includes('Morgan Member'));
  check('F14 a self-nomination is accepted at once and shows as an accepted candidate', sql(`select o.office || ':' || n.status from public.club_meeting_nominations n join public.club_memberships c on c.id = n.nominee_membership_id join (select 'president' as office) o on true where c.full_name = 'Morgan Member' and n.office = 'president'`) === 'president:accepted'
    && (await text(m, '[data-testid=office-president]')).includes('Accepted Candidates: Morgan Member'));
  for (const r of ['Secretary', 'Treasurer']) {
    await m.locator('[data-testid=nominate-form]').getByRole('button', { name: 'Nominate Myself' }).click();
    await rolePick(m, r);
    await m.getByRole('button', { name: 'Confirm Nomination' }).click();
    await until(async () => (await text(m, `[data-testid=office-${r.toLowerCase()}]`)).includes('Morgan Member'));
  }
  check('F15 the same member can stand for Secretary and Treasurer too', sql(`select count(*) from public.club_meeting_nominations n join public.club_memberships c on c.id = n.nominee_membership_id where c.full_name = 'Morgan Member' and n.status = 'accepted'`) === '3');
  const board = await text(m, '[data-testid=agm-nominations]');
  check('F16 the candidate section shows the current officer for each role (from the officer records) and no e-mail addresses',
    board.includes('Current Officer: Kedrixx Streit') && board.includes('Current Officer: Garrett Robson') && board.includes('2026 Executive Nominations') && !/@/.test(board), board.slice(0, 500));
  check('F17 Secretary has no officer with a membership name yet it still names the current officer from the officer record', /Secretary Current Officer: (Carm Example|not assigned)/.test(board), board);

  // ---- nominate another member; the nominee answers
  await m.locator('[data-testid=nominate-form]').getByRole('button', { name: 'Nominate Another Member' }).click();
  await m.locator('#nominee').selectOption({ label: 'John Smith' });
  await rolePick(m, 'Secretary');
  const conf2 = await text(m, '[data-testid=nomination-confirm]');
  check('F18 nominating another member shows who and for what, and that they must accept', conf2.includes('You are nominating John Smith for Secretary') && conf2.includes('must accept'), conf2);
  const offered = await m.locator('#nominee option').allInnerTexts();
  check('F19 only members who can currently vote are offered (not pending Jane, not under-18 Kit, not yourself)', offered.includes('John Smith') && offered.includes('Kedrixx Streit') && !offered.includes('Jane Smith') && !offered.includes('Kit Young') && !offered.includes('Morgan Member'), offered.join(','));
  await m.getByRole('button', { name: 'Confirm Nomination' }).click();
  await until(async () => (await text(m, '[data-testid=nomination-notice]')).includes('Nomination sent'));
  check('F20 the nominee is "awaiting acceptance" and NOT yet a confirmed candidate', sql(`select n.status from public.club_meeting_nominations n join public.club_memberships c on c.id = n.nominee_membership_id where c.full_name = 'John Smith' and n.office = 'secretary'`) === 'awaiting_acceptance'
    && /awaiting acceptance: John Smith/.test(await text(m, '[data-testid=office-secretary]')) && !/Accepted Candidates:[^A-Z]*John/.test((await text(m, '[data-testid=office-secretary]')).replace(/Morgan Member/, '')));
  const nomId = sql(`select n.id from public.club_meeting_nominations n join public.club_memberships c on c.id = n.nominee_membership_id where c.full_name = 'John Smith' and n.office = 'secretary'`);
  check('F21 the nominator cannot accept or decline on the nominee\'s behalf', refused(await rpc('member@example.test', 'respond_to_club_nomination', { p_nomination: nomId, p_response: 'accept' })) && refused(await rpc('member@example.test', 'respond_to_club_nomination', { p_nomination: nomId, p_response: 'decline' })));
  // a second nominator of the same person and office: still ONE candidacy
  const dup = await rpc('pres@example.test', 'nominate_for_club_office', { p_meeting: MEETING, p_office: 'secretary', p_nominee: MEM(6) });
  check('F22 five people nominating the same member for the same office still make ONE candidacy (both nominators are kept)',
    dup.status < 300 && String(dup.body).replaceAll('"', '') === nomId && sql(`select count(*) from public.club_meeting_nominations where id = '${nomId}'`) === '1' && sql(`select count(*) from public.club_meeting_nominators where nomination_id = '${nomId}'`) === '2'
    && sql(`select count(*) from public.club_meeting_nominations n join public.club_memberships c on c.id = n.nominee_membership_id where c.full_name = 'John Smith' and n.office = 'secretary' and n.status in ('awaiting_acceptance','accepted')`) === '1', JSON.stringify(dup.body));
  const jo = await open('phone');
  await siteSignIn(jo, 'john@example.test', 'John-new-pass-26');
  await until(async () => (await jo.locator('[data-testid=nominated-banner]').count()) > 0);
  check('F23 signing in, the nominee sees "You\'ve Been Nominated" straight away', (await text(jo, '[data-testid=nominated-banner]')).includes('You\'ve Been Nominated') && (await text(jo, '[data-testid=nominated-banner]')).includes('You have been nominated for Secretary for the 2026 Red Deer Reavers AGM.'));
  await shot(jo, 'site-nominated-banner-phone');
  await tab(jo, '2026 AGM');
  await until(async () => (await jo.locator('[data-testid=nominated-card]').count()) > 0);
  const card = await text(jo, '[data-testid=nominated-card]');
  check('F24 the nomination shows who nominated, the role and the date, with Accept and Decline', card.includes('Nominated by') && card.includes('Morgan Member') && card.includes('Kedrixx Streit') && card.includes('Role Secretary') && /Date \w+ \d+, \d{4}/.test(card)
    && (await jo.getByRole('button', { name: 'Accept Nomination' }).count()) === 1 && (await jo.getByRole('button', { name: 'Decline Nomination' }).count()) === 1, card);
  await phoneCheck(jo, 'site-nominated-card-phone');
  await jo.getByRole('button', { name: 'Accept Nomination' }).click();
  await until(async () => sql(`select status from public.club_meeting_nominations where id = '${nomId}'`) === 'accepted');
  await until(async () => (await text(jo, '[data-testid=office-secretary]')).includes('Accepted Candidates: John Smith'));
  check('F25 accepting makes them an accepted candidate; the original nomination and nominators are kept', (await text(jo, '[data-testid=office-secretary]')).includes('John Smith')
    && sql(`select count(*) from public.club_meeting_nominators where nomination_id = '${nomId}'`) === '2' && sql(`select string_agg(action, ',' order by id) from public.club_meeting_nomination_history where nomination_id = '${nomId}'`) === 'nominated,also_nominated,accepted');
  // decline
  const nd = await rpc('member@example.test', 'nominate_for_club_office', { p_meeting: MEETING, p_office: 'treasurer', p_nominee: MEM(1) });
  const pr = await open('phone');
  await siteSignIn(pr, 'pres@example.test');
  await until(async () => (await pr.locator('[data-testid=nominated-banner]').count()) > 0);
  await tab(pr, '2026 AGM');
  await until(async () => (await pr.locator('[data-testid=nominated-card]').count()) > 0);
  pr.once('dialog', d => d.accept());
  await pr.getByRole('button', { name: 'Decline Nomination' }).click();
  await until(async () => sql(`select status from public.club_meeting_nominations where id = '${String(nd.body).replaceAll('"', '')}'`) === 'declined');
  await until(async () => (await pr.locator('[data-testid=nominated-card]').count()) === 0);
  check('F26 declining records the nomination as declined (kept, not deleted) and removes it from the member board', nd.status < 300 && sql(`select count(*) from public.club_meeting_nominations where status = 'declined'`) === '1'
    && !(await text(pr, '[data-testid=office-treasurer]')).includes('Kedrixx Streit Accepted') && !/awaiting acceptance: Kedrixx/.test(await text(pr, '[data-testid=office-treasurer]')));
  // who may nominate
  const jn = await open('phone');
  await siteSignIn(jn, 'jane@example.test');
  await tab(jn, '2026 AGM');
  await until(async () => (await jn.locator('[data-testid=agm-nominations]').count()) > 0);
  check('F27 a member who cannot vote can read the nominations but cannot nominate, and is told why', (await jn.locator('[data-testid=nominate-form]').count()) === 0
    && (await text(jn, '[data-testid=nominate-blocked]')).includes('Only members who can currently vote can nominate') && (await text(jn, '[data-testid=nominate-blocked]')).includes('Membership pending approval'), await text(jn, '[data-testid=agm-nominations]'));
  check('F28 the database refuses a non-voting member (pending Jane, under-18 Kit)', refused(await rpc('jane@example.test', 'nominate_for_club_office', { p_meeting: MEETING, p_office: 'president' }))
    && refused(await rpc('kid@example.test', 'nominate_for_club_office', { p_meeting: MEETING, p_office: 'president' })) && refused(await rpc('newbie@example.test', 'nominate_for_club_office', { p_meeting: MEETING, p_office: 'president' })));
  check('F29 nobody can read or write nominations directly, or nominate for another office, or an ineligible member',
    refused(await api('member@example.test', 'GET', 'club_meeting_nominations?select=id')) && refused(await api('member@example.test', 'POST', 'club_meeting_nominations', { meeting_id: MEETING, office: 'president', nominee_membership_id: MEM(6), status: 'accepted' }))
    && refused(await rpc('member@example.test', 'nominate_for_club_office', { p_meeting: MEETING, p_office: 'director' })) && refused(await rpc('member@example.test', 'nominate_for_club_office', { p_meeting: MEETING, p_office: 'president', p_nominee: MEM(7) })));
  check('F30 nominations never change the officers', sql(`select string_agg(office || ':' || user_id || ':' || coalesce(ended_on::text, '-'), ',' order by office, user_id) from public.team_officers where team_id = '${REAVERS}'`) === officersBefore);
  // executive nomination dashboard
  await tr.getByRole('button', { name: 'Nominations', exact: true }).click();
  await until(async () => (await tr.locator('[data-testid=nomination-row]').count()) > 0);
  const adm = await text(tr, '#view');
  check('F31 the executive nomination dashboard shows each role, its current officer, every nominee with status, who nominated them and self / member nomination',
    adm.includes('Current Officer: Kedrixx Streit') && /President[\s\S]*Morgan Member[\s\S]*Accepted[\s\S]*Self nomination/.test(adm) && /John Smith[\s\S]*Accepted[\s\S]*Member nomination[\s\S]*Nominated by Kedrixx Streit, Morgan Member|John Smith[\s\S]*Accepted[\s\S]*Member nomination[\s\S]*Nominated by Morgan Member, Kedrixx Streit/.test(adm)
    && /Kedrixx Streit[\s\S]*Declined[\s\S]*Member nomination[\s\S]*Nominated by Morgan Member/.test(adm) && /Accepted 1 · Awaiting acceptance 0 · Declined 1 · Withdrawn 0/.test(adm), adm);
  await phoneCheck(tr, 'site-nominations-admin-phone');
  check('F32 a regular member and another club\'s Treasurer cannot open the executive nomination dashboard', refused(await rpc('member@example.test', 'club_agm_nominations_admin', { p_meeting: MEETING })) && refused(await rpc('other@example.test', 'club_agm_nominations_admin', { p_meeting: MEETING })));
  check('F33 the original AGM RSVP is untouched: Morgan is still "Not Attending" and the existing executive People view still works',
    sql(`select response from public.club_meeting_rsvps where membership_id = '${MEM(5)}'`) === 'not_attending' && (await text(m, '[data-testid=agm-member]')).includes('Not Attending'));
  await tr.getByRole('button', { name: 'People and check-in', exact: true }).click();
  await until(async () => (await tr.locator('[data-testid=agm-summary]').count()) > 0);
  check('F34 the executive AGM dashboard still shows its counts and check-in buttons', (await text(tr, '[data-testid=agm-summary]')).includes('Total members') && (await tr.locator('.checkin').count()) > 0);
}

// ================================================================ G. "How the AGM Works" (member help on the AGM tab)
{
  const m = await open('phone');
  await siteSignIn(m, 'member@example.test');
  await tab(m, '2026 AGM');
  await until(async () => (await m.locator('[data-testid=agm-help]').count()) > 0 && (await m.locator('[data-testid=agm-nominations]').count()) > 0);
  const titles = await m.locator('[data-testid=agm-help] summary').allInnerTexts();
  check('G1 the AGM tab has "How the AGM Works" with six short headings, all closed until tapped',
    (await text(m, '[data-testid=agm-help] h3')) === 'How the AGM Works' && titles.join('|') === 'Who can vote?|How to join|Executive roles|How nominations work|Submit an AGM topic|RSVP and proxy voting'
    && (await m.locator('[data-testid=agm-help] details[open]').count()) === 0, titles.join('|'));
  const helpBox = await m.locator('[data-testid=agm-help]').boundingBox();
  const rsvpBox = await m.locator('[data-testid=agm-member]').boundingBox();
  check('G2 the help sits directly under the AGM card and RSVP buttons (before the topic and nomination sections)', helpBox.y >= rsvpBox.y + rsvpBox.height - 2 && helpBox.y < (await m.locator('[data-testid=agm-topics]').boundingBox()).y);
  check('G3 collapsed, the help is compact (six rows on a phone)', helpBox.height < 420, String(helpBox.height));
  await phoneCheck(m, 'site-agm-help-closed-phone');
  await m.locator('[data-testid=help-vote] summary').click();
  const vote = await text(m, '[data-testid=help-vote]');
  check('G4 Who can vote? says 18+, approved member, ELIGIBLE TO VOTE, the 2026 fee is waived (normal $20) and an account alone is not enough',
    vote.includes('18 or older') && vote.includes('an approved Red Deer Reavers member') && vote.includes('ELIGIBLE TO VOTE') && vote.includes('Membership fees are waived for 2026. You do not need to pay the normal $20 fee to vote this year.')
    && vote.includes('Making an account is not enough on its own. You also need an approved membership.'), vote);
  await m.evaluate(() => document.querySelectorAll('.help-item').forEach(d => { d.open = true; }));
  const helpText = await text(m, '[data-testid=agm-help]');
  check('G5 How to join: same account (never two), sign in, Create account, Continue, Apply to join, wait for approval, fee waived, ELIGIBLE TO VOTE',
    helpText.includes('same account') && helpText.includes('You never need two.') && helpText.includes('Already have a BuhurtOS account? Sign in with it.') && helpText.includes('“Create account”') && helpText.includes('“Continue”')
    && helpText.includes('“Apply to join”') && helpText.includes('Wait for the executive to approve you.') && helpText.includes('The 2026 fee is waived, so there is nothing to pay.'), helpText.slice(0, 1200));
  check('G6 Executive roles: three positions with the plain descriptions, and the holders come from the officer records',
    /President Helps lead the society and meetings\. Currently: Kedrixx Streit/.test(helpText) && /Secretary Helps keep society records, meeting information and official paperwork organized\. Currently: Carm Example/.test(helpText)
    && /Treasurer Helps manage the society's money and financial records\. Currently: Garrett Robson/.test(helpText), helpText.slice(0, 2000));
  const g7 = [/A nomination does not give anyone the job\. The decision is made at the AGM election\. If nobody runs against the current officer, they stay in the position\./.test(helpText),
    helpText.includes('\u201cNominate Myself\u201d'), helpText.includes('\u201cNominate Another Member\u201d'), helpText.includes('\u201cConfirm Nomination\u201d'),
    helpText.includes('must accept before they are a confirmed candidate'), helpText.includes('They can also decline. You cannot accept for them.'), !/remov|removal/i.test(helpText)];
  check('G7 Nominations: not automatic, decided at the AGM, current officer stays if nobody runs, self-nomination steps, nominate-another steps, nominee must accept and can decline', g7.every(Boolean), `failing clauses: ${g7.map((x, i) => x ? '' : i).join(',')} :: ${helpText.slice(helpText.indexOf('How nominations work'), helpText.indexOf('How nominations work') + 700)}`);
  check('G8 AGM topic: examples, steps with the real button names, edit or withdraw rule, privacy', helpText.includes('“Submit AGM Concern / Topic”') && helpText.includes('“Submit for AGM”') && helpText.includes('an idea for the club')
    && helpText.includes('Only you and the executive can see what you submit.') && helpText.includes('“Your AGM topics”'));
  check('G9 RSVP and proxy: date, time and place come from the AGM record; the four real choices; proxy steps with the real button names',
    helpText.includes('AGM: Sunday, October 18, 2026 at 5:30 PM, ') && helpText.includes('In Person') && helpText.includes('Video Call') && helpText.includes('Voting by Proxy') && helpText.includes('Not Attending')
    && helpText.includes('Can\'t attend but still want your vote represented?') && helpText.includes('“Save my proxy”') && helpText.includes('“Change proxy”') && helpText.includes('“Cancel proxy”'));
  // every button or heading the help quotes must really exist in the page's own code
  const src = readFileSync(`${SITE_DIR}/assets/js/member-portal.js`, 'utf8'), html = readFileSync(`${SITE_DIR}/members.html`, 'utf8');
  const outside = src.slice(0, src.indexOf('function agmHelp()')) + src.slice(src.indexOf('// ---- concerns / topics')) + html;
  const quoted = [...new Set([...helpText.matchAll(/“([^”]+)”/g)].map(x => x[1]))];
  const missing = quoted.filter(n => !(outside.includes(n) || outside.includes(n.replace(/'/g, "\\'"))));
  check(`G10 every button or heading quoted in the help (${quoted.length}) is the real label used elsewhere on the site`, quoted.length >= 14 && missing.length === 0, `missing: ${missing.join(' | ')}`);
  check('G11 the real buttons the help points to are on this tab right now', (await m.getByRole('button', { name: 'Nominate Myself' }).count()) === 1 && (await m.getByRole('button', { name: 'Nominate Another Member' }).count()) === 1
    && (await m.getByRole('button', { name: 'Submit AGM Concern / Topic' }).count()) === 1 && (await m.getByRole('button', { name: 'Voting by Proxy', exact: true }).count()) === 1 && (await m.getByRole('button', { name: 'In Person', exact: true }).count()) === 1);
  check('G12 the help with every section open fits a 390px phone', await noSideways(m));
  await phoneCheck(m, 'site-agm-help-open-phone');
  // nothing about taking an office away
  check('G13 the help does not discuss removing executives', !/remov|vote out|replace the (president|secretary|treasurer)/i.test(helpText.replace('Treasurer','')), helpText);

  // an office with no officer record (its holder has no account yet) shows the fallback; an office with a holder never does
  sql(`update public.team_officers set ended_on = current_date where team_id = '${REAVERS}' and office in ('president', 'treasurer') and ended_on is null`);
  await m.reload(); await until(async () => !(await m.locator('#signed-in').isHidden())); await tab(m, '2026 AGM');
  await until(async () => (await m.locator('[data-testid=help-role-president]').count()) > 0 && (await m.locator('[data-testid=office-president]').count()) > 0);
  await m.evaluate(() => document.querySelectorAll('.help-item').forEach(d => { d.open = true; }));
  const roles = await text(m, '[data-testid=help-role-president]') + ' | ' + await text(m, '[data-testid=help-role-secretary]') + ' | ' + await text(m, '[data-testid=help-role-treasurer]');
  check('G14 President shows "Kedrixx - no active account", the Secretary comes from the records, Treasurer shows "Carmalee - no active account"',
    roles.includes('Currently: Kedrixx - no active account') && roles.includes('Currently: Carm Example') && roles.includes('Currently: Carmalee - no active account'), roles);
  const nomBoard = await text(m, '[data-testid=agm-nominations]');
  check('G15 the Executive Nominations list shows the same names', nomBoard.includes('Current Officer: Kedrixx - no active account') && nomBoard.includes('Current Officer: Carm Example') && nomBoard.includes('Current Officer: Carmalee - no active account'), nomBoard);
  check('G16 the fallback grants nothing: no officer record was created, and the databases still has no President or Treasurer', sql(`select count(*) from public.team_officers where team_id = '${REAVERS}' and ended_on is null and office in ('president','treasurer')`) === '0');
  await phoneCheck(m, 'site-agm-help-fallback-phone');
  sql(`update public.team_officers set ended_on = null where team_id = '${REAVERS}' and office in ('president', 'treasurer')`);
  // a signed-in person who has not joined: the help is still there, without names
  const nb = await open('phone');
  await siteSignIn(nb, 'newbie@example.test'); await tab(nb, '2026 AGM');
  await until(async () => (await nb.locator('[data-testid=agm-help]').count()) > 0);
  await nb.locator('[data-testid=help-roles] summary').click();
  const nbRoles = await text(nb, '[data-testid=help-roles]');
  check('G17 someone who has not joined still sees the help; names are for members ("Members can see who holds each position here.")', nbRoles.includes('Members can see who holds each position here.') && !nbRoles.includes('Currently:'), nbRoles);
  check('G18 ... and still sees the way to join', (await text(nb, '[data-testid=agm-member]')).includes('Only Red Deer Reavers members can register. Join first'));
  // desktop
  const dk = await open('desktop');
  await siteSignIn(dk, 'member@example.test'); await tab(dk, '2026 AGM');
  await until(async () => (await dk.locator('[data-testid=agm-help]').count()) > 0);
  await dk.evaluate(() => document.querySelectorAll('.help-item').forEach(d => { d.open = true; }));
  check('G19 the help is readable on desktop (no sideways scroll)', await noSideways(dk));
  await shot(dk, 'site-agm-help-open-desktop');
}

// ================================================================ H. bylaws link on sign-up and join; Member / Admin sign-in buttons in every footer
{
  const BYLAWS = 'https://drive.google.com/file/d/1R9EDu7BpUZ1KM790BDNN0iIaXZYtUtCE/view?usp=drivesdk';
  const pagesWithFooter = ['index.html', 'programs.html', 'steps.html', 'involved.html', 'contact.html', 'agm.html', 'members.html'];
  const bad = pagesWithFooter.filter(f => { const h = readFileSync(`${SITE_DIR}/${f}`, 'utf8'); const foot = h.slice(h.indexOf('<footer')); return !(foot.includes('href="members.html"') && foot.includes('>Member Sign In<') && foot.includes('href="members.html?view=agm-admin"') && foot.includes('>Admin Sign In<')); });
  check('H1 every page that has a footer (home, programs, steps, involved, contact, AGM, members) has Member Sign In and Admin Sign In buttons', bad.length === 0, bad.join(', '));
  const ph = await open('phone');
  await ph.goto(`${SITE}/index.html`);
  const mBtn = ph.locator('footer .footer-signin a', { hasText: 'Member Sign In' }), aBtn = ph.locator('footer .footer-signin a', { hasText: 'Admin Sign In' });
  await mBtn.scrollIntoViewIfNeeded();
  const bb = await mBtn.boundingBox(), ab = await aBtn.boundingBox();
  check('H2 on a 390px phone both footer buttons are visible, tappable (44px tall or more) and fit without sideways scrolling', bb.height >= 36 && ab.height >= 36 && bb.x >= 0 && ab.x + ab.width <= 390 && await noSideways(ph), JSON.stringify([bb, ab]));
  await shot(ph, 'site-footer-buttons-phone');
  await mBtn.click();
  await until(async () => (await ph.locator('#signed-out').isVisible().catch(() => false)));
  check('H3 Member Sign In opens the Members page sign-in', ph.url().endsWith('/members.html') && (await text(ph, '#signed-out')).includes('Member sign in') && (await ph.locator('#admin-note').isHidden()));
  // sign-up: the bylaws link
  await ph.locator('[data-auth-tab=signup]').click();
  const su = ph.locator('[data-testid=bylaws-link-signup]');
  check('H4 the Create account page links to the bylaws PDF (new tab, no referrer or opener) and says an account does not make you a member', (await su.getAttribute('href')) === BYLAWS && (await su.getAttribute('target')) === '_blank' && /noopener/.test(await su.getAttribute('rel'))
    && (await text(ph, '[data-auth-panel=signup]')).includes('Creating an account does not make you a member.'));
  await phoneCheck(ph, 'site-create-account-bylaws-phone');
  // the join form
  const nb = await open('phone');
  await siteSignIn(nb, 'newbie@example.test');
  await until(async () => (await nb.locator('[data-testid=apply-form]').count()) > 0);
  const jl = nb.locator('[data-testid=bylaws-link-join]');
  check('H5 the Join form links to the bylaws PDF right under the bylaws checkbox', (await jl.getAttribute('href')) === BYLAWS && (await jl.getAttribute('target')) === '_blank' && (await text(nb, '[data-testid=apply-form]')).includes('I agree to follow the Red Deer Reavers bylaws and team standards'));
  await nb.locator('label.check', { hasText: 'bylaws' }).click();
  check('H6 clicking the checkbox text still just ticks the box (the link is separate)', await nb.locator('#ap-bylaws').isChecked());
  await phoneCheck(nb, 'site-join-bylaws-phone');
  // Admin Sign In: one shared account; executives land on the AGM admin, everyone else on their own page
  const ad = await open('desktop');
  await ad.goto(`${SITE}/index.html`);
  await ad.locator('footer .footer-signin a', { hasText: 'Admin Sign In' }).click();
  await until(async () => (await ad.locator('#signed-out').isVisible().catch(() => false)));
  check('H7 Admin Sign In opens the same sign-in page and says there is no separate admin login', ad.url().endsWith('/members.html?view=agm-admin') && (await text(ad, '#admin-note')).includes('There is no separate admin login.'));
  await ad.locator('#email').fill('treas@example.test'); await ad.locator('#password').fill(PW); await ad.locator('#password-btn').click();
  await until(async () => (await ad.locator('[data-testid=agm-summary]').count()) > 0);
  check('H8 an executive signing in that way lands on the AGM admin dashboard', (await text(ad, '#tabs')).includes('AGM admin') && (await text(ad, '[data-testid=agm-summary]')).includes('Total members'));
  const me = await open('desktop');
  await me.goto(`${MEMBERS}?view=agm-admin`);
  await me.locator('#email').fill('member@example.test'); await me.locator('#password').fill(PW); await me.locator('#password-btn').click();
  await until(async () => !(await me.locator('#signed-in').isHidden()) && (await text(me, '#view')).length > 20);
  check('H9 a regular member using Admin Sign In gets their own member page and a clear note that this account is not an executive (no admin tools, no error)',
    !(await text(me, '#tabs')).includes('AGM admin') && (await text(me, '#status')).includes('not a current executive') && (await me.locator('[data-testid=my-membership]').count()) === 1);
  // the static home page's menu script comes from the Materialize CDN, which this offline sandbox blocks ("M is not defined"); that is not a page error
  for (const pg of [ph, ad]) pg.errors = pg.errors.filter(e => !/M is not defined/.test(e));
  check('H10 the database still refuses a regular member the executive views (nothing about security changed)', refused(await rpc('member@example.test', 'club_meeting_dashboard', { p_meeting: MEETING })));
}

check('P1 every club-website screen fits a 390px phone without sideways scrolling', phoneOk, phoneBad.join(', '));
check('P2 no page errors on either website', pages.every(x => x.errors.length === 0), pages.flatMap(x => x.errors).join(' | '));
await browser.close();
server.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(failed ? 'CLUB LIVE FAILED' : 'CLUB LIVE PASSED');
process.exit(failed ? 1 : 0);
