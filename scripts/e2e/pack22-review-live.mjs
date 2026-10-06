// Pack 22, the state production is in until the owner publishes: the whole Buhurt International release (and the earlier editions) imported IN REVIEW,
// nothing published. Real local stack (Postgres from every migration + PostgREST + the built app), real Chromium, phone 390x844.
// A visitor sees no text and no unpublished provision; the platform owner opens an imported document in review and reads its provisions, clearly marked
// not published; "the text is not in BuhurtOS yet" (nothing imported) is said only to the owner, who can tell; everyone else reads "not published yet",
// never "not imported", and a signed-in non-owner is told texts in review are for the platform owner (the 2026-10-06 report). LOCAL EVIDENCE ONLY.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 900)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, timeout = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(200); } return false; };
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const OWNER = ['00000000-0000-0000-0000-0000000000a1', 'u1@example.test'], STRANGER = ['00000000-0000-0000-0000-0000000000a7', 'u7@example.test'];
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const text = async (page) => (await page.locator('main, body').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/p22r-${name}.png`, fullPage: true }).catch(() => undefined) : undefined);
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const DUELS = 'buhurt-international-marshal-duels-rules', FOLDER = 'buhurt-international-marshal-marshal-archives';

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
async function phone(who) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  if (who) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('p22r-set')) { localStorage.setItem(k, v); sessionStorage.setItem('p22r-set', '1'); } }, [STORAGE_KEY, JSON.stringify(session(who))]);
  const page = await ctx.newPage();
  page.errors = []; page.api = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('response', async r => {
    const m = /\/rest\/v1\/(ruleset_versions|rule_provisions)\?/.exec(r.url());
    if (m && r.request().method() === 'GET') { const b = await r.json().catch(() => null); page.api.push({ table: m[1], status: r.status(), rows: Array.isArray(b) ? b.length : null, url: r.url().length }); }
  });
  return { ctx, page };
}
const settled = (page) => until(async () => /in BuhurtOS yet|Document not found|could not be loaded|Search in |Earlier editions/.test(await text(page)) && !/Loading/i.test(await text(page)), 30000);

// 1. a visitor
{
  const { ctx, page } = await phone(null);
  await page.goto(`${BASE}/rules/doc/${DUELS}`); await settled(page);
  const t = await text(page); await shot(page, 'visitor-duels');
  check('R1 visitor: Duels Rules says "the text is not published in BuhurtOS yet" (never "not imported") and shows no version', /The text is not published in BuhurtOS yet/i.test(t) && !/not been imported|once the official file has been imported/i.test(t) && !/signed in as/i.test(t) && !/in review/i.test(t) && !/26\.4/.test(t.replace(/V\.26\.4/g, '')), t.slice(0, 600));
  check('R2 visitor: the API returns no version and no provision (nothing published; nothing in review leaks)',
    page.api.some(a => a.table === 'ruleset_versions') && page.api.every(a => a.status === 200 && a.rows === 0), JSON.stringify(page.api));
  await ctx.close();
}

// 2. the platform owner
{
  const { ctx, page } = await phone(OWNER);
  await page.goto(`${BASE}/rules/doc/${DUELS}`); await settled(page);
  const t = await text(page); await shot(page, 'owner-duels');
  const vers = page.api.filter(a => a.table === 'ruleset_versions'), provs = page.api.filter(a => a.table === 'rule_provisions');
  check('R3 owner: the API returns the versions in review and their provisions', vers.some(a => a.status === 200 && a.rows > 0) && provs.some(a => a.status === 200 && a.rows > 0) && page.api.every(a => a.status === 200),
    JSON.stringify(page.api));
  check('R4 owner: Duels Rules opens on the imported current version 26.4, marked as not published (in review)', /26\.4/.test(t) && /in review|not published/i.test(t) && !/text is not (published )?in BuhurtOS yet/i.test(t), t.slice(0, 900));
  check('R5 owner: its provisions are readable (the rule list, with numbers)', (await page.locator('.rl-doc-list a, .rl-hit, a[href*="/rules/r/"]').count()) > 10, t.slice(0, 600));
  check('R6 owner: earlier editions are offered apart, never as the current version', /Earlier editions \(2\)/i.test(t), t.slice(0, 900));
  check('R7 owner: the page fits the phone width', await noSideways(page));
  // a rule of it
  const first = page.locator('a[href*="/rules/r/"]').first();
  if (await first.count()) {
    await first.click(); await until(async () => /Rule not found|not published|in review/i.test(await text(page)), 20000);
    const rt = await text(page); await shot(page, 'owner-duels-rule');
    check('R8 owner: a rule of the version in review opens, marked not published', !/Rule not found/i.test(rt) && /in review|not published/i.test(rt), rt.slice(0, 600));
  } else check('R8 owner: a rule of the version in review opens, marked not published', false, 'no rule link');
  // a document with no imported text: the notice is right there
  await page.goto(`${BASE}/rules/doc/${FOLDER}`); await until(async () => /in BuhurtOS yet/i.test(await text(page)), 30000);
  const ft = await text(page); await shot(page, 'owner-folder');
  check('R9 owner: a document with no imported text says "the text is not in BuhurtOS yet" (not imported)', /The text is not in BuhurtOS yet/i.test(ft) && /has not been imported/i.test(ft) && !/in review/i.test(ft), ft.slice(0, 600));
  check('R10 owner: no page errors', page.errors.length === 0, page.errors.join(' | '));
  // signing out: the next person on this phone sees no text
  await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
  page.api = [];
  await page.goto(`${BASE}/rules/doc/${DUELS}`); await settled(page);
  const after = await text(page);
  check('R11 after sign-out on the same phone: no version, no provision, the notice again (nothing kept from the owner\'s copy)',
    /The text is not published in BuhurtOS yet/i.test(after) && !/in review/i.test(after) && page.api.every(a => a.rows === 0), after.slice(0, 500) + JSON.stringify(page.api));
  await ctx.close();
}

// 3. a signed-in person who is not the owner
{
  const { ctx, page } = await phone(STRANGER);
  await page.goto(`${BASE}/rules/doc/${DUELS}`); await settled(page);
  const t = await text(page);
  check('R12 signed-in non-owner: no version in review, no provision; the page says "not published yet"', /The text is not published in BuhurtOS yet/i.test(t) && page.api.every(a => a.rows === 0), t.slice(0, 400) + JSON.stringify(page.api));
  check('R13 signed-in non-owner: told that texts in review are for the platform owner, and which account is signed in', /shown only to the platform owner/i.test(t) && t.includes(STRANGER[1]), t.slice(0, 700));
  await ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\nPACK22 REVIEW LIVE: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
