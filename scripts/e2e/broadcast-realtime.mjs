// Regression for the 2026-10-05 production blank screen (Manage › Broadcast): run the REAL built app against the real local stack (Postgres + PostgREST)
// WITH a working realtime connection. The local stack has no realtime server, which is why the earlier browser runs never saw the failure: every channel
// stayed un-joined. Here each browser context gets a minimal Phoenix (Supabase Realtime protocol 2.0.0) stand-in through Playwright's routeWebSocket,
// so channels really reach "joined" exactly as they do in production. Run through scripts/e2e/broadcast-realtime.sh. LOCAL EVIDENCE (not part of CI).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE, SHOTS = process.env.E2E_SHOTS;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 600)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const WHO = { organizer: ['00000000-0000-0000-0000-0000000000a2', 'u2@example.test'], scorekeeper: ['00000000-0000-0000-0000-0000000000a4', 'u4@example.test'], stranger: ['00000000-0000-0000-0000-0000000000a7', 'u7@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const EVENT = '00000000-0000-0000-0000-00000000ed01';

// ---- a minimal realtime server: replies "ok" to every join (echoing the postgres_changes bindings with ids, as the real server does), to heartbeats and leaves
const joins = [];
async function fakeRealtime(ctx) {
  await ctx.routeWebSocket(/\/realtime\/v1\/websocket/, ws => {
    ws.onMessage(raw => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      const [joinRef, ref, topic, event, payload] = m;
      if (event === 'phx_join') {
        joins.push(topic);
        const pc = (payload?.config?.postgres_changes ?? []).map((f, i) => ({ ...f, id: 1000 + i }));
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: pc } }]));
      } else if (event === 'heartbeat' || event === 'phx_leave' || event === 'access_token') {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      }
    });
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
async function open(who, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: viewport.width < 500, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|youtube(-nocookie)?\.com|twitch\.tv|vimeo\.com/, r => r.abort('failed'));
  await fakeRealtime(ctx);
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, ['sb-localhost-auth-token', session(WHO[who])]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  return page;
}
const rootText = (page) => page.evaluate(() => (document.getElementById('root')?.innerText ?? '').replace(/\s+/g, ' ').trim()).catch(() => '');
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/br-${name}.png` }).catch(() => undefined); };
/** The failure: content appears, then the whole app unmounts ~0.5 s later. So wait well past that and check the app is still there. */
const settledText = async (page, ms = 4000) => { await sleep(ms); return rootText(page); };
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);

try {
  // 1. Manage › Broadcast for an event that has NEVER had broadcast settings or sponsors
  sql(`delete from public.event_sponsors where event_id = '${EVENT}'; delete from public.event_broadcast where event_id = '${EVENT}'`);
  const org = await open('organizer');
  await org.goto(`${BASE}/events/test-stuff-test/manage?tab=broadcast`);
  await org.getByText('OBS overlay').first().waitFor({ timeout: 30000 }).catch(() => undefined);
  const t1 = await settledText(org);
  check('1. realtime is really connected in this run (channels joined, as in production)', joins.length > 0, JSON.stringify(joins));
  check('2. Manage › Broadcast, event with NO event_broadcast row and NO sponsors: still rendered after 4 s (no blank app)', /OBS overlay/.test(t1) && /Livestream link/.test(t1) && /No sponsors yet/.test(t1), t1.slice(0, 300) + ' | errors: ' + org.errors.join(' | '));
  check('3. ... no uncaught page error', org.errors.length === 0, org.errors.join(' | '));
  check('4. ... no sideways scrolling at 390 px', await noSideways(org));
  await shot(org, '01-manage-broadcast-empty');

  // 2. the organizer configures it: saving works and the page stays up
  await org.getByLabel(/Livestream link/).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await org.getByRole('button', { name: 'Save broadcast settings' }).click();
  await org.getByText('Saved.').waitFor({ timeout: 15000 }).catch(() => undefined);
  check('5. organizer saves broadcast settings from the unconfigured state', sql(`select stream_url from public.event_broadcast where event_id = '${EVENT}'`) === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await org.getByLabel('Sponsor name').fill('Ironworks Armoury');
  await org.getByRole('button', { name: 'Add sponsor' }).click();
  await org.getByText('Sponsor added.').waitFor({ timeout: 15000 }).catch(() => undefined);
  check('6. organizer adds a sponsor', sql(`select count(*) from public.event_sponsors where event_id = '${EVENT}'`) === '1');

  // 3. reload with settings AND sponsors present
  await org.reload();
  await org.getByText('OBS overlay').first().waitFor({ timeout: 30000 }).catch(() => undefined);
  const t2 = await settledText(org);
  check('7. Manage › Broadcast WITH settings and a sponsor: still rendered after 4 s', /OBS overlay/.test(t2) && /Ironworks Armoury/.test(t2) && org.errors.length === 0, t2.slice(0, 300) + ' | ' + org.errors.join(' | '));
  await shot(org, '02-manage-broadcast-configured');

  // 4. moving between Manage tabs (each mount / unmount subscribes and unsubscribes) never blanks the app
  for (const tab of ['eventday', 'broadcast', 'home', 'broadcast']) {
    await org.goto(`${BASE}/events/test-stuff-test/manage?tab=${tab}`);
    await sleep(2500);
  }
  const t3 = await rootText(org);
  check('8. switching Manage tabs back and forth (Event day, Broadcast, Home, Broadcast): the app is still there', /OBS overlay/.test(t3) && org.errors.length === 0, t3.slice(0, 200) + ' | ' + org.errors.join(' | '));

  // 5. the public event page with a stream (it uses the same broadcast hook next to the page's own event watcher)
  const pub = await open(null);
  await pub.goto(`${BASE}/events/test-stuff-test`);
  await pub.locator('.ls').first().waitFor({ timeout: 30000 }).catch(() => undefined);
  const t4 = await settledText(pub);
  check('9. public event page with a livestream: the stream block and the page are still there after 4 s', (await pub.locator('.ls iframe').count()) === 1 && /Test stuff test/i.test(t4) && pub.errors.length === 0, t4.slice(0, 200) + ' | ' + pub.errors.join(' | '));
  check('10. ... no sideways scrolling at 390 px', await noSideways(pub));
  await shot(pub, '03-public-event-stream');

  // 6. unauthorized people: refused, but never a blank app
  for (const who of ['stranger', 'scorekeeper']) {
    const p = await open(who);
    await p.goto(`${BASE}/events/test-stuff-test/manage?tab=broadcast`);
    const t = await settledText(p);
    check(`11. ${who} on Manage › Broadcast: no broadcast setup offered, and the page is not blank`, t.length > 40 && !/OBS overlay/.test(t) && p.errors.length === 0, t.slice(0, 200) + ' | ' + p.errors.join(' | '));
  }

  // 7. the OBS overlay and the venue display (public, same hooks)
  const tv = await open(null, { width: 1920, height: 1080 });
  await tv.goto(`${BASE}/broadcast/test-stuff-test/Field%201?bg=dark`);
  await tv.waitForSelector('.bc[data-ready="true"]', { timeout: 30000 }).catch(() => undefined);
  await sleep(4000);
  check('12. OBS overlay route still renders with realtime connected', (await tv.locator('.bc[data-ready="true"]').count()) === 1 && /Aldric Stone/i.test(await rootText(tv)) && tv.errors.length === 0, (await rootText(tv)).slice(0, 200) + ' | ' + tv.errors.join(' | '));
  await tv.goto(`${BASE}/events/test-stuff-test/arena/Field%201`);
  await tv.waitForSelector('.arena .ar-main', { timeout: 30000 }).catch(() => undefined);
  await sleep(3000);
  check('13. venue display (Arena) still renders with realtime connected', (await tv.locator('.arena .ar-main').count()) === 1 && tv.errors.length === 0, tv.errors.join(' | '));

  // 8. Pack 13 lyst / field screen for the scorekeeper (it holds its own channels)
  const keeper = await open('scorekeeper', { width: 768, height: 1024 });
  await keeper.goto(`${BASE}/events/test-stuff-test/field/Field%201`);
  const t5 = await settledText(keeper);
  check('14. the field / Lyst screen (Pack 13) still loads with realtime connected', /Aldric Stone|Field 1/i.test(t5) && keeper.errors.length === 0, t5.slice(0, 200) + ' | ' + keeper.errors.join(' | '));
} catch (e) {
  check('the run completed without an exception', false, e?.stack ?? e);
} finally {
  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
  process.exit(bad.length ? 1 : 0);
}
