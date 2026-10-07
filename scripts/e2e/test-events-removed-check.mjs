// READ-ONLY check of the LIVE site after the one-off deletion of the test events test-stuff-test and test-new-test (2026-10-07,
// supabase/manual/hosted_delete_test_events_2026-10-07.sql). Never writes anything.
//   BASE=https://dothecoolwip1.github.io/BuhurtOS node scripts/e2e/test-events-removed-check.mjs
// Signed out: the Events list, Calendar, homepage, Rankings, the organization page of test-new-test (hacsa) and the two old event URLs must not show
// either test event, while a real event (red-deer-rumble-2026) still loads, and the public API (the site's own anon key) returns no row for either.
// Optional: with SMOKE_X_EMAIL / SMOKE_X_PASSWORD it also signs in and checks My events and the platform Events list the same way.
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE ?? 'https://dothecoolwip1.github.io/BuhurtOS').replace(/\/$/, '');
const X = { email: process.env.SMOKE_X_EMAIL ?? '', password: process.env.SMOKE_X_PASSWORD ?? '' };
const GONE = /Test stuff test|Test new test|test-stuff-test|test-new-test/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, timeout = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok === null) { console.log(`SKIP  ${name}${detail ? ` (${detail})` : ''}`); return; }
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `: ${detail}` : ''}`);
};

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const p = await ctx.newPage();
const pageText = async () => (await p.evaluate(() => document.body.innerText)) ?? '';
const linksToGone = async () => p.evaluate(() => [...document.querySelectorAll('a')].map(a => a.getAttribute('href') ?? '').filter(h => /test-stuff-test|test-new-test/.test(h)).length);

async function listing(path, loaded) {
  await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  const ok = await until(async () => loaded.test(await pageText()), 25000);
  await sleep(1500);
  const t = await pageText();
  check(`${path} loaded (${loaded})`, ok, t.slice(0, 160).replace(/\s+/g, ' '));
  check(`${path} shows neither test event and links to neither`, !GONE.test(t) && (await linksToGone()) === 0, (t.match(GONE) ?? [''])[0]);
}

// public API, with the anon key the live bundle ships
const html = await (await fetch(`${BASE}/`, { cache: 'no-store' })).text();
const js = html.match(/assets\/index-[^"']+\.js/)?.[0];
const bundle = js ? await (await fetch(`${BASE}/${js}`, { cache: 'no-store' })).text() : '';
const url = bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
const key = bundle.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0] ?? bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
console.log(`NOTE  live bundle ${js}; API ${url}`);
if (url && key) {
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const r = await fetch(`${url}/rest/v1/events?select=id,slug&or=(slug.in.(test-stuff-test,test-new-test),id.in.(feec4fde-ea8c-4eaa-86f2-9538b5c61785,1acb67d3-db5f-40a5-bce7-682e0aa6edb3))`, { headers: h });
  const rows = await r.json();
  check('public API: no event row for either test event (by slug or id)', r.ok && Array.isArray(rows) && rows.length === 0, JSON.stringify(rows));
  const all = await (await fetch(`${url}/rest/v1/events?select=slug`, { headers: h })).json();
  check(`public API: the public event list still answers (${Array.isArray(all) ? all.length : '?'} events) and holds neither slug`, Array.isArray(all) && all.length > 0 && !all.some(e => GONE.test(e.slug)));
} else check('public API reachable with the site key', false, 'no Supabase URL/key found in the bundle');

await listing('/events', /Rumble|Clash|Open|Cup/i);
await listing('/calendar', /Rumble|Clash|Open|Cup|calendar/i);
await listing('/', /BuhurtOS|Events|Fighters/i);
await listing('/rankings', /Rank/i);
await listing('/organizations/hacsa', /HACSA|Association|Organization/i);

await p.goto(`${BASE}/events/red-deer-rumble-2026`, { waitUntil: 'domcontentloaded' });
check('a real event (red-deer-rumble-2026) still loads', await until(async () => /Red Deer Rumble/i.test(await pageText()), 25000));
for (const slug of ['test-stuff-test', 'test-new-test']) {
  await p.goto(`${BASE}/events/${slug}`, { waitUntil: 'domcontentloaded' });
  await until(async () => (await pageText()).trim().length > 40, 15000);
  await sleep(4000);
  const t = await pageText();
  check(`/events/${slug} no longer shows the event`, !/Test stuff test|Test new test/i.test(t), t.slice(0, 200).replace(/\s+/g, ' '));
  console.log(`NOTE  /events/${slug} now shows: ${t.slice(0, 160).replace(/\s+/g, ' ')}`);
}

if (!X.email || !X.password) {
  check('signed-in My events and platform Events list', null, 'SMOKE_X_EMAIL / SMOKE_X_PASSWORD not provided');
} else {
  await p.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  const form = p.locator('form[aria-label="Sign in with email and password"]');
  await form.waitFor({ timeout: 20000 });
  await form.locator('input[type=email], input[autocomplete=email], input[id*=email]').first().fill(X.email);
  await form.locator('#signin-password').fill(X.password);
  await form.getByRole('button', { name: 'Sign in', exact: true }).click();
  check('sign in with the smoke account', await until(async () => (await p.locator('button[aria-label*="otification"]').count()) > 0, 30000));
  await listing('/my-events', /event/i);
  await listing('/platform/events', /event|platform|not/i);
}
await browser.close();
console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
