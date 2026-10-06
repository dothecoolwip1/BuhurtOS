// PRODUCTION check for Pack 22 (rules library, discipline, historical editions) on the LIVE site, in real Chromium, desktop and phone-sized, each in a
// fresh browser context. Read-only: it never publishes, never writes sporting data and never signs anyone up. Nothing is published on 2026-10-06, so a
// visitor must see the rules directory with no text and no earlier editions; what the owner sees in review is checked by hand (see the runbook).
// Optional: with SMOKE_X_EMAIL / SMOKE_X_PASSWORD (the fixed pre-confirmed smoke account, armed by the owner) it also signs in and out and checks that
// the next visitor gets nothing from the saved rules copy. If the account is not armed, that part is reported as skipped, not passed.
//   BASE=https://dothecoolwip1.github.io/BuhurtOS EXPECT_BUILD=142 EXPECT_COMMIT=702df15 node scripts/e2e/pack22-production-check.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = (process.env.BASE ?? 'https://dothecoolwip1.github.io/BuhurtOS').replace(/\/$/, '');
const SHOTS = process.env.SHOTS ?? '/tmp/p22-prod-shots';
const EXPECT_BUILD = process.env.EXPECT_BUILD ?? '', EXPECT_COMMIT = process.env.EXPECT_COMMIT ?? '';
// a historical edition (Duel Regulations 26.1), one of its provisions, the current release's version of the same document, and a live event
const DOC = 'buhurt-international-tournament-duel-regulations', HIST_V = 'b644b33b-919b-4cc7-916a-b3184ecec755', HIST_P = '8e95a699-6555-4db2-bf86-4c0c7c90a4bc';
const CUR_V = 'df1382ca-0944-4347-8eed-c6f80c792d1a', EVENT = process.env.EVENT ?? 'red-deer-rumble-test';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 500)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, timeout = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const text = async (page) => (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => undefined);

const browser = await chromium.launch();
const VIEWS = [
  ['desktop', { viewport: { width: 1280, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }]
];

async function freshPage(opts) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.errors = []; page.rules = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('response', async r => {
    if (/\/rest\/v1\/(ruleset_versions|rule_provisions)\b/.test(r.url()) && r.request().method() === 'GET') {
      const body = await r.json().catch(() => null);
      page.rules.push({ table: /ruleset_versions/.test(r.url()) ? 'versions' : 'provisions', rows: Array.isArray(body) ? body : null });
    }
  });
  return { ctx, page };
}

for (const [view, opts] of VIEWS) {
  const { ctx, page } = await freshPage(opts);
  await page.goto(`${BASE}/rules`, { waitUntil: 'domcontentloaded' });
  const loaded = await until(async () => /Authenticity Committee/i.test(await text(page)) && !/Loading the rules/i.test(await text(page)), 40000);
  await until(async () => page.rules.some(r => r.table === 'versions'), 15000);
  const ver = await page.locator('[data-testid="app-version"]').innerText().catch(() => '');
  check(`[${view}] footer shows the deployed build (${ver})`, (!EXPECT_BUILD || ver.includes(`build ${EXPECT_BUILD}`)) && (!EXPECT_COMMIT || ver.includes(EXPECT_COMMIT)), ver);
  const body = await text(page);
  await shot(page, `${view}-rules`);
  check(`[${view}] /rules loads the Buhurt International directory`, loaded, body.slice(0, 300));
  check(`[${view}] /rules lists the four committees`, [/Executive/i, /Marshal Committee/i, /Tournament Committee/i, /Authenticity Committee/i].every(r => r.test(body)), body.slice(0, 400));
  check(`[${view}] /rules shows no earlier edition to a visitor`, !/Earlier edition/i.test(body), body.slice(0, 300));
  check(`[${view}] /rules offers no "include earlier editions" while none is readable`, (await page.getByLabel('Include older versions and earlier editions').count()) === 0);
  const vrows = page.rules.filter(r => r.table === 'versions'), prows = page.rules.filter(r => r.table === 'provisions');
  check(`[${view}] the API returns no rule version and no provision to a visitor (nothing published, nothing in review leaks)`,
    vrows.length > 0 && vrows.every(r => r.rows && r.rows.length === 0) && prows.every(r => r.rows && r.rows.length === 0), JSON.stringify(page.rules.map(r => [r.table, r.rows?.length])));
  if (view === 'phone') check(`[${view}] /rules fits the phone width`, await noSideways(page));

  // search: current text only by default; nothing published, so no results and no crash
  const search = page.getByLabel('Search rules');
  if (await search.count()) { await search.fill('helmet'); await sleep(800); }
  const afterSearch = await text(page);
  check(`[${view}] search runs with nothing published (no crash, no earlier edition)`, (await search.count()) === 1 && !/Earlier edition/i.test(afterSearch) && page.errors.length === 0, page.errors.join(' | '));

  // direct addresses of an earlier edition and of one of its rules: never shown as current, never readable while not published
  await page.goto(`${BASE}/rules/doc/${DOC}?v=${HIST_V}`, { waitUntil: 'domcontentloaded' });
  await until(async () => /not in BuhurtOS yet|Document not found/i.test(await text(page)), 40000);
  const doc = await text(page);
  await shot(page, `${view}-doc-hist`);
  check(`[${view}] earlier-edition address (?v=) opens the document page without any version: nothing called current, no text`,
    /Duel Regulations/i.test(doc) && /not in BuhurtOS yet/i.test(doc) && !/\b26\.1\b/.test(doc) && !/Earlier edition/i.test(doc) && (await page.locator('.rl-banner').count()) === 0
    && (await page.locator('.rl-meta dt', { hasText: /Version/i }).count()) === 0, doc.slice(0, 700));
  await page.goto(`${BASE}/rules/doc/${DOC}?v=${CUR_V}`, { waitUntil: 'domcontentloaded' });
  await until(async () => /not in BuhurtOS yet|Document not found/i.test(await text(page)), 40000);
  check(`[${view}] current-release address (?v=) shows no version and no text while it is in review`, /not in BuhurtOS yet/i.test(await text(page)) && (await page.locator('.rl-meta dt', { hasText: /Version/i }).count()) === 0
    && (await page.locator('.rl-banner').count()) === 0, (await text(page)).slice(0, 500));
  await page.goto(`${BASE}/rules/r/${HIST_P}`, { waitUntil: 'domcontentloaded' });
  await until(async () => /Rule not found/i.test(await text(page)), 40000);
  check(`[${view}] an earlier edition's rule address says "Rule not found" (not published)`, /Rule not found/i.test(await text(page)), (await text(page)).slice(0, 300));

  // discipline log: officials only; a visitor gets the sign-in prompt
  await page.goto(`${BASE}/events/${EVENT}/discipline`, { waitUntil: 'domcontentloaded' });
  await until(async () => /officiates at this event|not found/i.test(await text(page)), 40000);
  const disc = await text(page);
  await shot(page, `${view}-discipline`);
  check(`[${view}] the event discipline page loads and asks a visitor to sign in as an official`, /officiates at this event/i.test(disc), disc.slice(0, 300));
  if (view === 'phone') check(`[${view}] the discipline page fits the phone width`, await noSideways(page));
  check(`[${view}] no page errors`, page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// signed in, then signed out: the next visitor in the same browser must not get the signed-in person's saved rules
const EMAIL = process.env.SMOKE_X_EMAIL, PASSWORD = process.env.SMOKE_X_PASSWORD;
if (EMAIL && PASSWORD) {
  const { ctx, page } = await freshPage(VIEWS[1][1]);
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  const form = page.getByRole('form', { name: 'Sign in with email and password' });
  await form.getByLabel('Email', { exact: true }).fill(EMAIL);
  await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await form.getByRole('button', { name: 'Sign in' }).click();
  const signedIn = () => page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token') && JSON.parse(localStorage.getItem(k) ?? 'null')?.access_token));
  if (!(await until(signedIn, 15000))) {
    check('[signed in] the smoke account signs in (not armed by the owner?)', null);
  } else {
    page.rules = [];
    await page.goto(`${BASE}/rules`, { waitUntil: 'domcontentloaded' });
    await until(async () => /Authenticity Committee/i.test(await text(page)) && !/Loading the rules/i.test(await text(page)), 40000);
    await sleep(1500);
    const cache = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bos-rules-cache-v3') ?? 'null'); } catch { return null; } });
    check('[signed in] a signed-in non-owner sees no rule version in review', page.rules.filter(r => r.table === 'versions').every(r => r.rows && r.rows.length === 0) && !/Earlier edition/i.test(await text(page)));
    check('[signed in] the saved rules copy is stamped with the account that loaded it', !!cache && typeof cache.viewer === 'string' && cache.viewer.length > 0, JSON.stringify(cache)?.slice(0, 200));
    await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Sign out' }).click({ timeout: 8000 }).catch(() => undefined);
    await until(async () => !(await signedIn()), 8000);
    page.rules = [];
    await page.goto(`${BASE}/rules`, { waitUntil: 'domcontentloaded' });
    await until(async () => /Authenticity Committee/i.test(await text(page)) && !/Loading the rules/i.test(await text(page)), 40000);
    await sleep(1500);
    check('[signed out] after sign-out the next visitor is a visitor (no session) and sees no saved rules from the account', !(await signedIn()) && !/Earlier edition/i.test(await text(page))
      && page.rules.filter(r => r.table === 'versions').every(r => r.rows && r.rows.length === 0));
    check('[signed in/out] no page errors', page.errors.length === 0, page.errors.join(' | '));
  }
  await ctx.close();
} else {
  check('[signed in/out] smoke account not provided: sign-in and sign-out cache check not run', null);
}

await browser.close();
const ran = results.filter(r => r.ok !== null), failed = ran.filter(r => !r.ok);
console.log(`\nPACK22 PRODUCTION CHECK: ${ran.length - failed.length}/${ran.length} passed, ${results.length - ran.length} skipped`);
process.exit(failed.length ? 1 : 0);
