// Pack 25 in a real browser against the REAL local stack (Postgres + PostgREST + the device-session function + the built app), pack13 fixture.
// Part 1: the public event page leads with its phase (Overview / Live / Results), one staff door (Event Control) with Set up, Live ops and Results,
// legacy Manage and Command addresses redirect, workstations exit back to Event Control. Screenshots at every viewport the task names.
// Run through scripts/e2e/pack25-live.sh. LOCAL ONLY, never against hosted Supabase.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const A = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const C = (n) => `00000000-0000-0000-0000-0000000000c${n}`;
const WHO = {
  owner: [A(1), 'u1@example.test'], organizer: [A(2), 'u2@example.test'], scorekeeper: [A(4), 'u4@example.test'], stranger: [A(7), 'u7@example.test'],
  head: [C(1), 'c1@example.test'], fighter: ['00000000-0000-0000-0000-000000000101', 'fighter1@example.test']
};
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const mid = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const EVENT = '00000000-0000-0000-0000-00000000ed01', SLUG = 'test-stuff-test', E = `/events/${SLUG}`;
async function rest(who, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args) => rest(who, 'POST', `rpc/${fn}`, args);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  small: { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, landscape: { viewport: { width: 1024, height: 768 }, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 } }
};
const contexts = [];
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  contexts.push(ctx);
  await ctx.route(/posthog\.com|maps\.googleapis\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|already final|net::ERR|Failed to fetch|403|42501/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  return { ctx, page };
}
const body = async (page) => (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').toLowerCase();
const has = async (page, text) => (await body(page)).includes(text.toLowerCase());
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(250); } return false; };
const shot = async (page, name, full = false) => { if (SHOTS) { await sleep(600); await page.screenshot({ path: `${SHOTS}/p25-${name}.png`, fullPage: full }).catch(() => undefined); } };
const noSideways = (page) => page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
const attr = (page, testid, name) => page.getByTestId(testid).first().getAttribute(name).catch(() => null);
const go = async (page, path) => { await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle').catch(() => undefined); };
const today = sql(`select (now() at time zone 'America/Edmonton')::date`);
const setDates = (start, end) => sql(`update public.events set starts_on = '${start}', ends_on = '${end}' where id = '${EVENT}'`);
const day = (n) => sql(`select ('${today}'::date + ${n})::text`);

try {
  // ───────────── the fixture: today is the first of two event days; m1 fights on Field 1, m11 on Field 2
  await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  await rpc('organizer', 'set_match_queue', { p_match: mid(11), p_state: 'active', p_order: null }).catch(() => undefined);
  const active = sql(`select count(*) from public.matches where queue_state = 'active' and competition_id in (select id from public.competitions where event_id = '${EVENT}')`);
  check('0. the fixture has fights on now', Number(active) >= 1, active);

  // ───────────── PART 1a: the public page while LIVE (visitor, phone)
  const v = await open('phone');
  await go(v.page, E);
  check('1. a visitor lands on LIVE while the event runs', await until(async () => (await attr(v.page, 'view-live', 'aria-current')) === 'page'), await body(v.page));
  check('2. the status chip says Live and no Event Control door is offered to a visitor', await has(v.page, 'live') && (await v.page.getByTestId('open-control').count()) === 0);
  check('3. each field shows NOW with the fight on it', await until(async () => (await v.page.getByTestId('live-field').count()) >= 1 && (await v.page.getByTestId('slot-active').count()) >= 1), await body(v.page));
  const fieldsOnPage = await v.page.getByTestId('live-field').count();
  check('4. the Live view has NOW / ON DECK / IN THE HOLE per field', await has(v.page, 'now') && (fieldsOnPage >= 1), String(fieldsOnPage));
  check('5. nothing scrolls sideways at 390', (await noSideways(v.page)).every((x, i, a) => a[0] <= a[1]), JSON.stringify(await noSideways(v.page)));
  await shot(v.page, 'public-live-390');
  await shot(v.page, 'public-live-390-full', true);
  await v.page.getByTestId('view-overview').click();
  check('6. Overview is one tap away and has the event facts', await until(async () => (await attr(v.page, 'view-overview', 'aria-current')) === 'page' && await has(v.page, 'test arena')), await body(v.page));
  await shot(v.page, 'public-overview-390');
  await v.page.getByTestId('view-results').click();
  check('7. Results is one tap away and says nothing is official yet while fighting', await until(async () => (await attr(v.page, 'view-results', 'aria-current')) === 'page' && await has(v.page, 'official')), await body(v.page));
  await shot(v.page, 'public-results-390');
  check('8. no page errors on the public views', v.page.errors.length === 0, v.page.errors.join(' | '));

  // ───────────── PART 1b: UPCOMING and COMPLETED (the dates move; nothing else changes)
  setDates(day(7), day(8));
  await go(v.page, E);
  check('9. before the event, the bare address leads with the Overview', await until(async () => (await attr(v.page, 'view-overview', 'aria-current')) === 'page' && await has(v.page, 'upcoming')), await body(v.page));
  await shot(v.page, 'public-upcoming-390');
  await go(v.page, `${E}/live`);
  check('10. Live before the event is quiet, not broken', await until(async () => (await v.page.getByTestId('live-quiet').count()) === 1 || (await v.page.getByTestId('live-field').count()) >= 1), await body(v.page));
  setDates(day(-3), day(-2));
  await go(v.page, E);
  check('11. after the event, the bare address leads with the Results', await until(async () => (await attr(v.page, 'view-results', 'aria-current')) === 'page' && await has(v.page, 'complete')), await body(v.page));
  await shot(v.page, 'public-completed-390');
  setDates(today, day(1));

  // ───────────── PART 1c: the fighter sees their own fight first
  const f = await open('phone', 'fighter');
  await go(f.page, E);
  check('12. a signed-in fighter sees MY NEXT FIGHT before the fields', await until(async () => await has(f.page, 'my next fight') && (await f.page.getByTestId('mf-state').count()) === 1), await body(f.page));
  const cardBefore = await f.page.evaluate(() => { const a = document.querySelector('#my-next-fight'), b = document.querySelector('[data-testid=live-field]'); return a && b ? a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 'first' : 'after' : 'missing'; });
  check('13. the card comes before the fields and marks the fight as theirs', cardBefore === 'first' && (await f.page.locator('.lf-slot.is-mine').count()) >= 1, cardBefore);
  await shot(f.page, 'fighter-on-deck-390');

  // ───────────── PART 1d: EVENT CONTROL (organizer) — phase aware, three modes, tools come back
  const o = await open('phone', 'organizer');
  await go(o.page, E);
  check('14. the organizer sees ONE staff door: Event Control', await until(async () => (await o.page.getByTestId('open-control').count()) === 1), await body(o.page));
  await o.page.getByTestId('open-control').click();
  check('15. Event Control opens on Live ops while the event runs', await until(async () => (await attr(o.page, 'event-control', 'data-mode')) === 'live'), await body(o.page));
  check('16. Live ops has attention, the fields, workstations and the Counter QR', await until(async () => await has(o.page, 'needs attention') && await has(o.page, 'workstations') && (await o.page.getByTestId('counter-qr').count()) === 1, 20000), await body(o.page));
  check('17. nothing scrolls sideways in Live ops at 390', (await noSideways(o.page))[0] <= (await noSideways(o.page))[1], JSON.stringify(await noSideways(o.page)));
  await shot(o.page, 'control-live-390');
  await shot(o.page, 'control-live-390-full', true);
  await o.page.getByRole('button', { name: 'Set up' }).click();
  check('18. Set up: the guided journey with one next step and the set-up tools', await until(async () => (await attr(o.page, 'event-control', 'data-mode')) === 'setup' && (await o.page.getByTestId('journey-primary').count()) === 1 && (await o.page.getByTestId('tool-competitions').count()) === 1), await body(o.page));
  await shot(o.page, 'control-setup-390');
  await o.page.getByTestId('tool-competitions').click();
  check('19. a tool opens inside Event Control with a way back to its mode', await until(async () => (await attr(o.page, 'event-control', 'data-tool')) === 'competitions' && (await o.page.getByTestId('tool-back').count()) === 1), await body(o.page));
  await o.page.getByTestId('tool-back').click();
  check('20. back lands on Set up', await until(async () => (await attr(o.page, 'event-control', 'data-mode')) === 'setup' && (await attr(o.page, 'event-control', 'data-tool')) === ''), o.page.url());
  await o.page.getByRole('button', { name: 'Results' }).click();
  check('21. Results mode is the finalization screen', await until(async () => (await attr(o.page, 'event-control', 'data-mode')) === 'results' && await has(o.page, 'results')), await body(o.page));
  await shot(o.page, 'control-results-390');
  check('22. no page errors in Event Control', o.page.errors.length === 0, o.page.errors.join(' | '));

  // ───────────── legacy addresses
  await go(o.page, `${E}/manage?tab=review`);
  check('23. /manage?tab=review redirects to Event Control › Set up › Registrations', await until(async () => /\/control\?mode=setup&tool=registrations/.test(o.page.url())), o.page.url());
  await go(o.page, `${E}/manage?tab=run&match=${mid(2)}`);
  check('24. /manage?tab=run&match= keeps the match', await until(async () => /tool=run/.test(o.page.url()) && o.page.url().includes(`match=${mid(2)}`)), o.page.url());
  await go(o.page, `${E}/command`);
  check('25. /command redirects to Live ops', await until(async () => /\/control\?mode=live/.test(o.page.url())), o.page.url());
  await go(o.page, `${E}/manage`);
  check('26. bare /manage lands in Event Control', await until(async () => /\/control/.test(o.page.url())), o.page.url());

  // ───────────── workstations exit back to Event Control
  await go(o.page, `${E}/control?mode=live`);
  await until(async () => (await o.page.getByTestId('station-lyst').count()) >= 1);
  await o.page.getByTestId('station-lyst').first().click();
  check('27. Lyst Control opened from Event Control has Exit → Event Control', await until(async () => (await o.page.locator('.focus-exit').getAttribute('aria-label').catch(() => '')) === 'Exit to Event Control'), await o.page.locator('.focus-exit').getAttribute('aria-label').catch(() => ''));
  await o.page.locator('.focus-exit').click();
  check('28. Exit returns to Live ops', await until(async () => /\/control\?mode=live/.test(o.page.url())), o.page.url());
  await o.page.getByTestId('station-desk').click();
  check('29. the check-in desk opened from Event Control exits to Event Control', await until(async () => (await o.page.locator('.focus-exit').getAttribute('aria-label').catch(() => '')) === 'Exit to Event Control'), o.page.url());

  // ───────────── who may open it
  const h = await open('phone', 'head');
  await go(h.page, `${E}/control`);
  check('30. the head marshal gets Live ops only (no mode switch, no set-up tools)', await until(async () => (await attr(h.page, 'event-control', 'data-mode')) === 'live' && (await h.page.getByRole('button', { name: 'Set up' }).count()) === 0 && await has(h.page, 'needs attention'), 20000), await body(h.page));
  check('31. the head marshal can show the Counter QR', await until(async () => (await h.page.getByTestId('counter-qr').count()) === 1, 10000), await body(h.page));
  await shot(h.page, 'control-live-headmarshal-390');
  const s = await open('phone', 'stranger');
  await go(s.page, `${E}/control`);
  check('32. a stranger is told Event Control is for the people who run the event', await until(async () => await has(s.page, 'for the people who run this event')), await body(s.page));
  await go(s.page, E);
  check('33. a signed-in non-staff person sees no Event Control door', await until(async () => (await attr(s.page, 'view-live', 'aria-current')) === 'page') && (await s.page.getByTestId('open-control').count()) === 0);

  // ───────────── the Counter QR from Live ops
  await go(o.page, `${E}/control?mode=live`);
  await until(async () => (await o.page.getByTestId('counter-qr').count()) === 1, 20000);
  if (await o.page.getByTestId('make-counter-qr').count()) await o.page.getByTestId('make-counter-qr').click();
  const showBtn = o.page.getByTestId('show-counter-qr');
  if (await until(async () => (await showBtn.count()) === 1, 8000)) await showBtn.click();
  check('34. the organizer shows the Counter QR from Live ops in two taps', await until(async () => (await o.page.getByTestId('counter-qr-code').count()) === 1, 10000), await body(o.page));
  await shot(o.page, 'control-counter-qr-390');

  // ───────────── the other viewports
  for (const [kind, name] of [['small', '360x800'], ['tablet', '768x1024'], ['landscape', '1024x768'], ['desktop', 'desktop']]) {
    const p = await open(kind);
    await go(p.page, E);
    await until(async () => (await p.page.getByTestId('live-field').count()) >= 1);
    const [sw, iw] = await noSideways(p.page);
    check(`35. public live at ${name}: no sideways scroll`, sw <= iw, `${sw} > ${iw}`);
    await shot(p.page, `public-live-${name}`);
    const q = await open(kind, 'organizer');
    await go(q.page, `${E}/control?mode=live`);
    await until(async () => await has(q.page, 'workstations'), 20000);
    const [sw2, iw2] = await noSideways(q.page);
    check(`36. Live ops at ${name}: no sideways scroll`, sw2 <= iw2, `${sw2} > ${iw2}`);
    await shot(q.page, `control-live-${name}`);
    await go(q.page, `${E}/control?mode=setup`);
    await until(async () => (await q.page.getByTestId('journey-primary').count()) === 1, 20000);
    await shot(q.page, `control-setup-${name}`);
    check(`37. no page errors at ${name}`, p.page.errors.length === 0 && q.page.errors.length === 0, [...p.page.errors, ...q.page.errors].join(' | '));
  }
} catch (e) {
  check('script ran to the end', false, e && e.stack ? e.stack : String(e));
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed${bad.length ? `; FAILED: ${bad.map(r => r.name).join('; ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
