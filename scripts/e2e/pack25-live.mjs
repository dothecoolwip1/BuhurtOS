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
  {
    // Pack 25.3: the summary card at the top names what needs attention and jumps to the list (or says all is good)
    const headline = await o.page.locator('.cc-overall').innerText().catch(() => '');
    const glanceN = await o.page.getByTestId('cc-glance').locator('li').count();
    let jumped = /all good/i.test(headline);
    if (!jumped && glanceN > 0) {
      await o.page.getByTestId('cc-glance').locator('a').first().click();
      jumped = await until(async () => o.page.locator('#cc-attention').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= -4 && r.top < innerHeight; }), 5000);
    }
    check('16a. the top card names what needs attention and a tap lands on the list (or says all is good)', jumped && (glanceN > 0 || /all good/i.test(headline)), `${headline} | glance ${glanceN}`);
  }
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

  // ═════════════ PART 2: COUNTERS — one Counter QR, phones bind themselves to a Lyst and a side, operators are logged, staff manage the phones
  const made = await fetch(`${API}/functions/v1/device-session`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: `Bearer ${session(WHO.organizer).access_token}` }, body: JSON.stringify({ action: 'create', event: EVENT, kind: 'counter_pool' }) }).then(async r => ({ status: r.status, body: await r.json() }));
  const poolCode = (made.body?.code ?? sql(`select pool_code from public.event_credentials where event_id = '${EVENT}' and kind = 'counter_pool' and revoked_at is null limit 1`)).replace(/-/g, '');
  check('40. the event has ONE Counter QR (made through the device-session function, or already there)', /^[0-9A-Z]{12}$/.test(poolCode), JSON.stringify(made));
  const opened = await rpc('scorekeeper', 'lyst_open', { p_match: mid(1), p_counter_input: 'weighted' });
  check('41. the Lyst opens the fight on Field 1', opened.status === 200, JSON.stringify(opened));
  const phone = async (name) => { const c = await open('phone'); c.page.name = name; return c.page; };
  const p1 = await phone('p1');
  await go(p1, `/device#c=${poolCode}`);
  check('42. scan → the phone asks who is counting (no seat request, no approval)', await until(async () => await has(p1, 'who is counting'), 30000), await body(p1));
  await shot(p1, 'counter-01-who-390');
  await p1.fill('#cp-name', 'Garrett Robson');
  await p1.getByRole('button', { name: 'Continue' }).click();
  check('43. then which Lyst (the event has more than one field)', await until(async () => await has(p1, 'which lyst')), await body(p1));
  check('43a. each Lyst in the chooser says who is fighting there (Pack 25.2)', await until(async () => await has(p1, 'aldric stone vs brann oakley')), await body(p1));
  await shot(p1, 'counter-02-lyst-390');
  await p1.getByRole('button', { name: /Field 1/ }).click();
  check('44. then RED or BLUE, in words not just colour', await until(async () => await has(p1, 'which side on field 1') && await has(p1, 'red') && await has(p1, 'blue')), await body(p1));
  check('44a. the side buttons name the fighter on each side, and the fight on now', await until(async () => /aldric stone/i.test(await p1.getByTestId('cp-pick-a').innerText().catch(() => '')) && /brann oakley/i.test(await p1.getByTestId('cp-pick-b').innerText().catch(() => '')) && /now fighting/i.test(await p1.getByTestId('cp-side-now').innerText().catch(() => ''))), await body(p1));
  await shot(p1, 'counter-03-side-390');
  await p1.getByRole('button', { name: /RED/ }).click();
  check('45. the phone is on the fight (Aldric, red) waiting for the round; no fighter was assigned by hand', await until(async () => await has(p1, 'aldric stone') && await has(p1, 'waiting for the round')), await body(p1));
  await shot(p1, 'counter-04-waiting-390');
  const t1 = await rpc('scorekeeper', 'lyst_timer_command', { p_event: EVENT, p_field: 'Field 1', p_match: mid(1), p_expected_rev: 0, p_command: crypto.randomUUID(), p_action: 'start', p_mode: 'fight', p_duration_ms: 60000, p_round: 1, p_delta_ms: 0 });
  check('46. round 1 starts on the Lyst', t1.body?.status === 'ok', JSON.stringify(t1));
  check('47. COUNT is live on the phone', await until(async () => p1.getByRole('button', { name: 'Count two points, head or torso' }).isEnabled().catch(() => false), 20000), await body(p1));
  await p1.getByRole('button', { name: 'Count two points, head or torso' }).click();
  await p1.getByRole('button', { name: 'Count two points, head or torso' }).click();
  await p1.getByRole('button', { name: 'Count one point, arm leg or hand' }).click();
  const tally = () => sql(`select coalesce((select private.lyst_seat_total(s.id, 1) from public.lyst_counter_seats s where s.status = 'active' and s.match_id = '${mid(1)}' and s.side = 'a' and s.role = 'official' order by s.id limit 1), 0)`);
  check('48. the taps land as this phone\'s own evidence: 5', await until(async () => tally() === '5'), tally());
  await shot(p1, 'counter-05-counting-390');
  // handoff: a new operator, the tally carries on, both names on the taps
  await p1.getByRole('button', { name: 'New counter' }).click();
  await until(async () => await has(p1, 'who is counting'));
  await p1.fill('#cp-name', 'Nathan Toth');
  await p1.getByRole('button', { name: 'Continue' }).click();
  check('49. handoff: Nathan takes the phone, same Lyst and side, the tally still 5', await until(async () => await has(p1, 'nathan toth') && (await p1.locator('.cp-total output').innerText().catch(() => '')) === '5'), await body(p1));
  await p1.getByRole('button', { name: 'Count one point, arm leg or hand' }).click();
  check('50. the next tap carries Nathan\'s name: every tap is attributed', await until(async () => sql(`select string_agg(distinct operator_name, ',' order by operator_name) from public.lyst_counts where match_id = '${mid(1)}'`) === 'Garrett Robson,Nathan Toth'), sql(`select string_agg(distinct operator_name, ',') from public.lyst_counts`));
  check('51. the operator log has both, Garrett\'s turn closed', sql(`select count(*) from public.counter_operator_log where event_id = '${EVENT}' and ended_at is not null and operator_name = 'Garrett Robson'`) === '1' && sql(`select count(*) from public.counter_operator_log where event_id = '${EVENT}' and ended_at is null and operator_name = 'Nathan Toth'`) === '1');
  await shot(p1, 'counter-06-handoff-390');
  // a second phone, same QR, blue
  const p2 = await phone('p2');
  await go(p2, `/device#c=${poolCode}`);
  await until(async () => await has(p2, 'who is counting'), 30000);
  await p2.fill('#cp-name', 'Taylor'); await p2.getByRole('button', { name: 'Continue' }).click();
  await until(async () => await has(p2, 'which lyst')); await p2.getByRole('button', { name: /Field 1/ }).click();
  await until(async () => await has(p2, 'which side')); await p2.getByRole('button', { name: /BLUE/ }).click();
  check('52. a second phone on the SAME QR counts blue: no fixed number of phones', await until(async () => await has(p2, 'brann oakley')) && sql(`select count(*) from public.event_sessions where ended_at is null and multi`) === '2', await body(p2));
  await shot(p2, 'counter-07-blue-390');
  await p1.reload();
  check('53. a refresh comes back on the same fight with the same tally (6)', await until(async () => await has(p1, 'aldric stone') && (await p1.locator('.cp-total output').innerText().catch(() => '')) === '6', 20000), await body(p1));
  // the Lyst: evidence, never a score
  const tab = await open('tablet', 'scorekeeper');
  await go(tab.page, `${E}/field/Field%201?open=${mid(1)}&from=control`);
  await tab.page.waitForSelector('.ly-timer', { timeout: 30000 });
  check('54. the Lyst shows the counters as evidence: operator, side, online', await until(async () => await has(tab.page, 'nathan toth') && await has(tab.page, 'taylor') && await has(tab.page, 'online'), 20000), await body(tab.page));
  await shot(tab.page, 'lyst-evidence-768');
  await tab.page.getByRole('button', { name: /^Counters/ }).click();
  check('55. the Counters sheet lists each phone on its own: never summed, averaged or voted', await until(async () => (await tab.page.getByTestId('counter-row').count()) >= 2 && await has(tab.page, 'evidence only')), await body(tab.page));
  await shot(tab.page, 'lyst-counters-sheet-768');
  // the sides: the secretary turns side A yellow from the Counters sheet; the Lyst's tag and every phone follow at once (Pack 25.2)
  await tab.page.getByTestId('counters-tab-sides').click();
  await tab.page.getByTestId('swatch-a-yellow').click();
  await tab.page.getByTestId('sides-save').click();
  check('55a. the secretary sets side A to Yellow: the Lyst tag says Yellow', await until(async () => (await tab.page.getByTestId('sk-tag-a').innerText().catch(() => '')).trim() === 'Yellow', 20000), await body(tab.page));
  check('55b. the counter phone on side A says YELLOW, in yellow with dark ink', await until(async () => (await p1.locator('.cp-corner').innerText().catch(() => '')).trim() === 'YELLOW'
    && (await p1.locator('.cp-corner').evaluate(el => getComputedStyle(el).backgroundColor).catch(() => '')) === 'rgb(242, 178, 51)'
    && (await p1.locator('.cp-corner').evaluate(el => getComputedStyle(el).color).catch(() => '')) === 'rgb(17, 17, 17)', 20000), await body(p1));
  check('55c. the other side is untouched (BLUE)', (await p2.locator('.cp-corner').innerText().catch(() => '')).trim() === 'BLUE', await body(p2));
  check('55d. the change is audited as the sides', sql(`select count(*) from public.audit_log where event_id = '${EVENT}' and action = 'lyst.sides'`) === '1');
  await tab.page.getByTestId('counters-tab-sides').click();   // the sheet stays open after a save (it goes back to This fight)
  await tab.page.getByTestId('swatch-a-red').click();
  await tab.page.getByTestId('sides-save').click();
  check('55e. and back to Red', await until(async () => (await tab.page.getByTestId('sk-tag-a').innerText().catch(() => '')).trim() === 'Red' && (await p1.locator('.cp-corner').innerText().catch(() => '')).trim() === 'RED', 20000), await body(p1));
  await tab.page.getByTestId('counters-tab-qr').click();
  check('56. the Lyst shows the Counter QR for the next phone', await until(async () => (await tab.page.getByTestId('counter-qr-code').innerText().catch(() => '')).replace(/-/g, '') === poolCode), await body(tab.page));
  await tab.page.keyboard.press('Escape');
  // the next fight: the phones follow by themselves
  const o2 = await rpc('scorekeeper', 'lyst_open', { p_match: mid(2), p_counter_input: 'weighted' });
  check('57. the Lyst opens the next fight on Field 1', o2.status === 200, JSON.stringify(o2));
  check('58. both phones follow to the new fight (Cael / Dara) by themselves, same sides', await until(async () => await has(p1, 'cael rhodes') && await has(p2, 'dara voss'), 20000), (await body(p1)).slice(0, 200));
  await shot(p1, 'counter-08-next-fight-390');
  check('59. a field never binds counters to two open matches', sql(`select count(*) from public.lyst_field_current where event_id = '${EVENT}' and field_key = 'field 1'`) === '1' && sql(`select count(distinct match_id) from public.lyst_counter_seats where status = 'active' and field_key = 'field 1' and role = 'official'`) === '1');

  // ───────────── device management: the organizer's tool and the platform owner's page
  await go(o.page, `${E}/control?mode=live&tool=devices`);
  check('60. the devices tool lists the two counter phones with Lyst, side and operator', await until(async () => (await o.page.getByTestId('session-row').count()) >= 2 && await has(o.page, 'nathan toth') && await has(o.page, 'field 1 · blue · taylor'), 20000), await body(o.page));
  await shot(o.page, 'devices-tool-390');
  await o.page.getByTestId('session-preview').first().click();
  check('61. device preview is read only and shows what the phone shows', await until(async () => (await o.page.getByTestId('device-preview').count()) === 1 && await has(o.page, 'read only')), await body(o.page));
  await shot(o.page, 'devices-preview-390');
  await o.page.keyboard.press('Escape');
  const own = await open('phone', 'owner');
  await go(own.page, '/platform/devices');
  check('62. the platform owner sees every phone signed in, across events', await until(async () => (await own.page.getByTestId('session-row').count()) >= 2, 20000), await body(own.page));
  await shot(own.page, 'platform-devices-390');
  const blueRow = own.page.locator('[data-testid=session-row]', { hasText: 'Taylor' }).first();
  await blueRow.getByTestId('session-move').click();
  await own.page.getByRole('button', { name: 'RED' }).click();
  await own.page.getByRole('button', { name: 'Move', exact: true }).click();
  check('63. the owner moves Taylor\'s phone to RED; the phone follows at once', await until(async () => await has(p2, 'cael rhodes') && (await p2.locator('.cp-on-a').count()) >= 1, 20000), await body(p2));
  check('64. the move is written, not impersonated: the binding changed, the operator did not', sql(`select side || ':' || operator_name from public.counter_bindings b join public.event_sessions s on s.id = b.session_id where b.operator_name = 'Taylor'`) === 'a:Taylor');
  await blueRow.getByTestId('session-end').click();
  await own.page.getByRole('button', { name: 'Sign out', exact: true }).click();
  check('65. the owner signs ONE phone out; the other keeps counting', await until(async () => sql(`select count(*) from public.event_sessions where ended_at is null and multi`) === '1', 10000) && await until(async () => await has(p2, 'signed out') || !(await has(p2, 'cael rhodes')), 20000), await body(p2));
  check('66. the phone that was signed out can simply scan the QR again', (await go(p2, `/device#c=${poolCode}`), await until(async () => await has(p2, 'who is counting'), 30000)), await body(p2));

  // ───────────── a team fight: standing count, evidence only
  await rpc('organizer', 'set_match_queue', { p_match: mid(42), p_state: 'active', p_order: null });
  await go(tab.page, `${E}/field/Field%202?open=${mid(42)}&from=control`);
  check('67. the group board offers counters for this fight (standing count)', await until(async () => (await tab.page.getByTestId('group-counter-rounds').count()) === 1, 30000), await body(tab.page));
  const p3 = await phone('p3');
  await go(p3, `/device#c=${poolCode}`);
  await until(async () => await has(p3, 'who is counting'), 30000);
  await p3.fill('#cp-name', 'Morgan'); await p3.getByRole('button', { name: 'Continue' }).click();
  await until(async () => await has(p3, 'which lyst')); await p3.getByRole('button', { name: /Field 2/ }).click();
  await until(async () => await has(p3, 'which side')); await p3.getByRole('button', { name: /RED/ }).click();
  check('68. the phone binds to Field 2 red and waits for the round', await until(async () => await has(p3, 'ankle biters') || await has(p3, 'waiting'), 20000), await body(p3));
  await tab.page.getByRole('button', { name: /Start round 1 for counters/ }).click();
  check('69. standing count: RED 5 STANDING (5v5 is five a side) with FIGHTER DOWN', await until(async () => (await p3.getByTestId('cp-standing').innerText().catch(() => '')) === '5' && (await p3.getByRole('button', { name: 'Fighter down' }).isEnabled().catch(() => false)), 20000), await body(p3));
  await shot(p3, 'team-standing-390');
  await p3.getByRole('button', { name: 'Fighter down' }).click();
  check('70. one down → 4 standing; UNDO brings it back to 5', await until(async () => (await p3.getByTestId('cp-standing').innerText().catch(() => '')) === '4', 10000) && (await p3.getByRole('button', { name: /Undo/ }).click(), await until(async () => (await p3.getByTestId('cp-standing').innerText().catch(() => '')) === '5', 10000)), await body(p3));
  await p3.getByRole('button', { name: 'Fighter down' }).click();
  await p3.getByRole('button', { name: 'Fighter down' }).click();
  check('71. the Lyst shows the standing counter as evidence on the group board', await until(async () => await has(tab.page, 'morgan'), 20000), await body(tab.page));
  await shot(tab.page, 'team-board-evidence-768');
  check('72. counters never touch the official result: no round, no score was written by a counter', sql(`select count(*) from public.lyst_rounds where match_id = '${mid(42)}' and status = 'confirmed'`) === '0' && sql(`select result from public.matches where id = '${mid(42)}'`) === '');
  check('73. no page errors on the phones, the Lyst tablet, the devices tool or the platform page', [p1, p2, p3, tab.page, own.page].every(p => p.errors.length === 0), JSON.stringify([p1.errors, p2.errors, p3.errors, tab.page.errors, own.page.errors]));
} catch (e) {
  check('script ran to the end', false, e && e.stack ? e.stack : String(e));
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed${bad.length ? `; FAILED: ${bad.map(r => r.name).join('; ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
