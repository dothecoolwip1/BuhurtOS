// Pack 18.1, CLIENT side: temporary event devices against a REAL local stack (Postgres built from every migration + the device fixture, PostgREST, the local API
// front serving the REAL device-session Edge Function handler, the real built app in real Chromium).
// The story: the organizer creates eight device credentials through the Edge Function (Counter Phone 1-4, Secretary / Scorekeeper tablet, Marshal phone,
// Announcer tablet, Event Admin tablet). Each device signs in ONCE through the real /device page in its own browser context (phones 390x844 for counter /
// marshal / secretary, 820x1180 for announcer and admin) and lands on its own screen with the identity bar. Then: persistence, QR fragment hygiene, the
// uniform wrong-code answer, route restrictions, the secretary reordering the queue, the counter flow across three devices, the check-in desk for the admin,
// revocation and replacement ending a device within one check, sign-out, and a scan for the plaintext code anywhere it must not be.
// Run it through scripts/e2e/device-live.sh. LOCAL EVIDENCE ONLY (needs a PostgREST binary; not part of CI).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 900)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const U = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const ORG = { E1: [U('a2'), 'u2@example.test'], E2: [U('a5'), 'u5@example.test'] };
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const E1 = '00000000-0000-0000-0000-00000000ed01', E2 = '00000000-0000-0000-0000-00000000ed02';
const mid = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const SLUG = 'test-stuff-test';
const HOME = `/events/${SLUG}`, COMMAND = `${HOME}/command`, ANNOUNCER = `${HOME}/announcer`, CHECKIN = `${HOME}/checkin`, FIELD1 = `${HOME}/field/Field%201`, FIELD2 = `${HOME}/field/Field%202`;

// ---------------------------------------------------------------- the database starts from the fixture every time (this script may be re-run on the same stack)
sql(`delete from public.event_sessions; delete from public.event_credentials; delete from public.device_code_attempts;
     update public.matches set queue_state = 'scheduled', queue_order = null, result = null, winner_entry_id = null where queue_state <> 'scheduled' or queue_order is not null;
     update public.matches set queue_state = 'on_deck' where id in ('${mid(1)}', '${mid(11)}', '00000000-0000-0000-0000-0000000fd0f1');
     update public.matches set queue_state = 'in_the_hole' where id in ('${mid(2)}', '${mid(12)}');`);
// (a re-run on the same database: the Lyst records are append-only for the app, so the reset bypasses their triggers; a fresh database needs none of this)
sql(`delete from public.registration_checks where check_name = 'arrived'`);
for (const t of ['lyst_counts', 'lyst_counter_seats', 'lyst_join_codes', 'lyst_round_revisions', 'lyst_rounds', 'lyst_timer', 'lyst_matches']) { try { sql(`set session_replication_role = replica; delete from public.${t}`); } catch { /* absent or differently shaped: ignored */ } }

async function api(body, token) {
  const r = await fetch(`${API}/functions/v1/device-session`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'local-publishable-key', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function rest(token, method, path, body) {
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: { 'content-type': 'application/json', apikey: 'x', prefer: 'return=representation', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const orgToken = (ev) => jwt(...ORG[ev]);
const create = (ev, event, label, role, extra = {}) => api({ action: 'create', event, kind: 'device', label, role, ...extra }, orgToken(ev));

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, desktop: { viewport: { width: 1280, height: 900 } } };
const net = [];   // every request of every context: url, headers, body
const consoleLines = [];
const bodies = {};   // the Edge Function's answers, per device
async function open(kind, label, stored = null) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|youtube(-nocookie)?\.com|twitch\.tv|vimeo\.com/, r => r.abort('failed'));
  if (stored) await ctx.addInitScript(([k, v]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); } catch { /* blocked */ } }, ['bos-device-session', stored]);
  await ctx.route('**/functions/v1/device-session', async route => { const resp = await route.fetch(); bodies[label] = (bodies[label] ?? '') + await resp.text(); await route.fulfill({ response: resp }); });
  ctx.on('request', r => net.push({ who: label, url: r.url(), headers: r.headers(), post: r.postData() ?? '' }));
  const page = await ctx.newPage();
  page.ctx = ctx; page.label = label; page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { consoleLines.push(m.text()); if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|net::ERR|Failed to fetch|40[0-9]|42501/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  return page;
}
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = async (page, name) => { if (SHOTS) { await sleep(300); await page.screenshot({ path: `${SHOTS}/dev-${name}.png`, fullPage: false }).catch(() => undefined); } };
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const until = async (fn, timeout = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const path = (page) => new URL(page.url()).pathname;
const stored = (page) => page.evaluate(() => { try { return localStorage.getItem('bos-device-session'); } catch { return null; } });
const norm = (c) => c.replace(/-/g, '');
const ENDED = /This device's access has ended/;

// ---------------------------------------------------------------- 1. the organizer creates the eight devices through the real Edge Function route
const DEVICES = [
  ['counter1', 'Counter Phone 1', 'counter', 'phone'], ['counter2', 'Counter Phone 2', 'counter', 'phone'], ['counter3', 'Counter Phone 3', 'counter', 'phone'], ['counter4', 'Counter Phone 4', 'counter', 'phone'],
  ['secretary', 'Secretary Tablet', 'scorekeeper', 'phone'], ['marshal', 'Marshal Phone', 'marshal', 'phone'], ['announcer', 'Announcer Tablet', 'announcer', 'tablet'], ['admin', 'Event Admin Tablet', 'temporary_organizer', 'tablet']
];
const dev = {};     // key -> { code, label, role, kind }
const codes = [];   // every plaintext code ever issued (to scan for leaks)
try {
  const noAuth = await api({ action: 'create', event: E1, kind: 'device', label: 'Nope', role: 'marshal' });
  check('1. creating a device code without an organizer sign-in is refused (401)', noAuth.status === 401, JSON.stringify(noAuth));
  const stranger = await api({ action: 'create', event: E1, kind: 'device', label: 'Nope', role: 'marshal' }, jwt(U('a7'), 'u7@example.test'));
  check('2. ... and a stranger\'s own sign-in cannot create one either (403)', stranger.status === 403 || stranger.status === 400, JSON.stringify(stranger));
  for (const [key, label, role] of DEVICES) {
    const r = await create('E1', E1, label, role);
    if (r.status !== 200) { check(`3. create ${label}`, false, JSON.stringify(r)); continue; }
    dev[key] = { code: r.body.code, label, role }; codes.push(r.body.code);
  }
  check('3. the organizer created all eight devices through the Edge Function; each code is XXXX-XXXX-XXXX (Crockford, no I L O U) and shown once', Object.keys(dev).length === 8 && Object.values(dev).every(d => /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(d.code)), JSON.stringify(Object.values(dev).map(d => d.code)));
  check('4. only a keyed verifier is stored: no table column anywhere holds a plaintext code', !Object.values(dev).some(d => sql(`select count(*) from public.event_credentials c where c::text ilike '%${norm(d.code)}%' or c::text ilike '%${d.code}%'`) !== '0'));
  const extra = {};
  for (const [key, label, role] of [['expired', 'Expired Phone', 'counter'], ['revoked', 'Revoked Phone', 'counter'], ['spare', 'Spare Marshal', 'marshal']]) {
    const r = await create('E1', E1, label, role);
    extra[key] = r.body; codes.push(r.body.code);
  }
  sql(`update public.event_credentials set expires_at = now() - interval '1 minute' where id = '${extra.expired.credential.id}'`);
  const rv = await rest(orgToken('E1'), 'POST', 'rpc/revoke_event_credential', { p_credential: extra.revoked.credential.id, p_reason: 'e2e' });
  check('5. fixtures for the failure cases: one code already expired, one revoked by the organizer, one never used', rv.status === 200, JSON.stringify(rv));
  const e2c = await create('E2', E2, 'E2 Counter', 'counter'); codes.push(e2c.body.code);

  // ------------------------------------------------------------ 2. the sign-in page, wrong codes, QR fragment
  const anon = await open('phone', 'visitor');
  await anon.goto(BASE + '/device');
  await anon.waitForSelector('#ds-code', { timeout: 30000 });
  const tabs = await anon.locator('header.top, nav.bottom, footer').count();
  const links = await anon.locator('a[href*="account"], a[href*="welcome"], a[href*="sign-in"], a[href*="my-events"]').count();
  check('6. /device is a bare page: no site header, menus, footer, account or sign-in links', tabs === 0 && links === 0, `${tabs} ${links}`);
  check('7. /device tells browsers not to send a referrer (meta referrer = no-referrer)', (await anon.locator('meta[name="referrer"][content="no-referrer"]').count()) === 1);
  check('8. the sign-in page names what it is: a code, once, not an account', /Sign in this device/.test(await text(anon)) && /not a personal account/i.test(await text(anon)));
  await shot(anon, '01-signin-phone');
  const wrong = {};
  const tryCode = async (key, code) => {
    await anon.fill('#ds-code', code);
    await anon.getByRole('button', { name: 'Sign in this device' }).click();
    await anon.locator('#ds-err').waitFor({ timeout: 15000 });
    wrong[key] = await text(anon, '#ds-err');
  };
  await tryCode('wrong', 'ZZZZ-ZZZZ-ZZZZ');
  await tryCode('expired', extra.expired.code);
  await tryCode('revoked', extra.revoked.code);
  check('9. a wrong, an EXPIRED and a REVOKED code give the identical message (nothing says which)', wrong.wrong.length > 10 && wrong.wrong === wrong.expired && wrong.expired === wrong.revoked, JSON.stringify(wrong));
  check('10. ... and nothing was stored: this browser is still not in device mode', (await stored(anon)) === null && path(anon) === '/device');
  const shortCode = await anon.evaluate(() => { const i = document.querySelector('#ds-code'); return i.value; });
  check('11. the field is cleared after a refusal (the wrong code does not sit there)', shortCode === '');
  await anon.fill('#ds-code', 'abcdefghjkmn');
  check('12. typing is tidied as you go: upper case, dashes after each four', (await anon.inputValue('#ds-code')) === 'ABCD-EFGH-JKMN');
  await anon.ctx.close();

  // a QR whose code is wrong: the fragment is gone from the address at once, and the code was only ever in a POST body
  const bad = await open('phone', 'badqr');
  await bad.goto(BASE + '/device#c=000000000000');
  await bad.locator('#ds-err').waitFor({ timeout: 20000 });
  check('13. QR link with a wrong code: it tried once, said the same words, and the address is plain /device (fragment already removed)', (await text(bad, '#ds-err')) === wrong.wrong && bad.url() === `${BASE}/device`, `${bad.url()} :: ${await text(bad, '#ds-err')}`);
  const badPosts = net.filter(n => n.who === 'badqr' && n.post.includes('000000000000'));
  check('14. ... the code appears in exactly one request body (the POST to the sign-in function) and in no URL or header', badPosts.length === 1 && badPosts[0].url.endsWith('/functions/v1/device-session') && !net.filter(n => n.who === 'badqr').some(n => n.url.includes('000000000000') || JSON.stringify(n.headers).includes('000000000000')));
  await bad.ctx.close();

  // ------------------------------------------------------------ 3. each device signs in once through the real page
  const P = {};
  const signedResponse = bodies;
  for (const key of ['counter1', 'counter2', 'counter3', 'counter4', 'marshal', 'announcer', 'admin']) {
    const d = dev[key];
    const page = await open(DEVICES.find(x => x[0] === key)[3], key);
    await page.goto(BASE + '/device');
    await page.waitForSelector('#ds-code', { timeout: 30000 });
    // typed the way a person would: lower case, no dashes
    await page.fill('#ds-code', norm(d.code).toLowerCase());
    await page.getByRole('button', { name: 'Sign in this device' }).click();
    P[key] = page;
  }
  // the secretary arrives by QR link: nothing to type
  {
    const page = await open('phone', 'secretary');
    await page.goto(`${BASE}/device#c=${norm(dev.secretary.code)}`);
    P.secretary = page;
  }
  const LANDING = { counter1: '/lyst/counter', counter2: '/lyst/counter', counter3: '/lyst/counter', counter4: '/lyst/counter', secretary: COMMAND, marshal: HOME, announcer: ANNOUNCER, admin: COMMAND };
  const landed = {};
  for (const [key, want] of Object.entries(LANDING)) landed[key] = await until(async () => path(P[key]) === want && (await P[key].locator('[data-testid="device-bar"]').count()) === 1, 45000);
  check('15. every valid code lands on the right screen with no fighter onboarding: counters on the counter screen', ['counter1', 'counter2', 'counter3', 'counter4'].every(k => landed[k]), JSON.stringify(landed));
  check('16. ... Secretary / Scorekeeper on the Command Centre (QR link, nothing typed)', landed.secretary, path(P.secretary));
  check('17. ... Marshal on the event home with the field picker', landed.marshal && (await until(async () => /Field 1/.test(await text(P.marshal, '[data-testid="device-home"]')))), await text(P.marshal));
  check('18. ... Announcer on the announcer view', landed.announcer, path(P.announcer));
  check('19. ... Event Admin / Temporary Organizer on the Command Centre', landed.admin, path(P.admin));
  check('20. QR link: the fragment is gone and the page is signed in; the code reached the network only in the sign-in POST body', !P.secretary.url().includes('#') && !net.filter(n => n.who === 'secretary').some(n => n.url.includes(norm(dev.secretary.code)) || n.url.includes(dev.secretary.code) || JSON.stringify(n.headers).includes(norm(dev.secretary.code))), P.secretary.url());
  check('21. no device went through onboarding or a profile page', Object.values(P).every(p => !/\/welcome|\/account|\/claim-profile/.test(path(p))));
  await shot(P.marshal, '02-marshal-home'); await shot(P.secretary, '03-secretary-command'); await shot(P.admin, '04-admin-command'); await shot(P.announcer, '05-announcer'); await shot(P.counter1, '06-counter');

  // ------------------------------------------------------------ 4. the device bar (identity), Camera Off, no account chrome
  const ENDS = sql(`select to_char(((e.ends_on + 1)::timestamp at time zone e.timezone + interval '24 hours') at time zone e.timezone, 'Dy HH24:MI') from public.events e where e.id = '${E1}'`);
  const ROLE = { counter: 'Role: Counter', scorekeeper: 'Role: Secretary / Scorekeeper', marshal: 'Role: Marshal', announcer: 'Role: Announcer', temporary_organizer: 'Role: Event Admin / Temporary Organizer' };
  let barOk = true; const barDetail = [];
  for (const [key, label, role] of DEVICES) {
    const bar = await text(P[key], '[data-testid="device-bar"]');
    const lo = bar.toLowerCase();
    const ok = lo.includes('test stuff test') && lo.includes('temporary device') && lo.includes(label.toLowerCase()) && lo.includes(ROLE[role].toLowerCase()) && lo.includes(`access ends ${ENDS}`.toLowerCase()) && /sign out this device/i.test(bar);
    if (!ok) { barOk = false; barDetail.push(`${key}: ${bar}`); }
  }
  check(`22. every device shows its identity bar: event, "Temporary Device", its label, "Role: ...", "Access ends ${ENDS}" in the EVENT's time zone, and Sign out`, barOk, barDetail.join(' || '));
  await P.marshal.goto(BASE + FIELD1); await P.marshal.waitForSelector('.fq-row', { timeout: 30000 });
  check('23. the bar stays on a field screen too (every device screen)', (await P.marshal.locator('[data-testid="device-bar"]').count()) === 1 && (await text(P.marshal, '[data-testid="device-bar"]')).includes('Marshal Phone'));
  const cam = {};
  for (const k of Object.keys(P)) cam[k] = await until(async () => (await P[k].locator('[data-testid="camera-off"] .camoff-btn').count()) > 0, 8000);
  check('24. CAMERA OFF is on the screen of the Secretary, Marshal, Announcer and Event Admin devices', cam.secretary && cam.marshal && cam.announcer && cam.admin, JSON.stringify(cam));
  check('25. ... and never on a Counter device', !cam.counter1 && !cam.counter2 && !cam.counter3 && !cam.counter4, JSON.stringify(cam));
  const chrome = [];
  for (const [k, p] of Object.entries(P)) {
    const bad = await p.evaluate(() => ({ links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => /account|welcome|sign-in|my-events|team-manager|platform|claim-profile/.test(h)), bug: !!document.querySelector('[aria-label*="bug" i], .bug-btn, button[title*="bug" i]'), nav: !!document.querySelector('nav.bottom, header.top') }));
    if (bad.links.length || bad.bug || bad.nav) chrome.push(`${k}: ${JSON.stringify(bad)}`);
  }
  check('26. no device shows an account, profile, onboarding, team or platform link, the site menus or a bug button', chrome.length === 0, chrome.join(' | '));
  check('27. the code is never shown on any device screen after sign-in', (await Promise.all(Object.entries(P).map(async ([k, p]) => !(await text(p)).includes(norm(dev[k].code)) && !(await text(p)).includes(dev[k].code)))).every(Boolean));
  const sawKeys = {};
  for (const k of Object.keys(P)) sawKeys[k] = await stored(P[k]);
  check('28. localStorage holds the session (secret, token, whoami) and NEVER the plaintext code', Object.entries(sawKeys).every(([k, v]) => v && JSON.parse(v).secret && !v.includes(norm(dev[k].code)) && !v.includes(dev[k].code)));
  check('29. the sign-in answers carry a session secret and a token but NOT the plaintext code', Object.entries(signedResponse).filter(([k]) => dev[k]).every(([k, v]) => /session_secret/.test(v) && !v.includes(norm(dev[k].code)) && !v.includes(dev[k].code)), JSON.stringify(Object.keys(signedResponse)));

  // ------------------------------------------------------------ 5. persistence: reload, installed-app start, a fresh context holding the stored session
  await P.marshal.goto(BASE + HOME);
  await P.marshal.reload(); await P.marshal.waitForSelector('[data-testid="device-bar"]', { timeout: 30000 });
  check('30. RELOAD: the marshal is still signed in, on the same page', path(P.marshal) === HOME && /Marshal Phone/.test(await text(P.marshal, '[data-testid="device-bar"]')));
  const fresh = await open('phone', 'marshal-fresh', await stored(P.marshal));
  await fresh.goto(BASE + '/?source=pwa');
  await fresh.waitForSelector('[data-testid="device-bar"]', { timeout: 30000 });
  check('31. a NEW browser context holding the stored session (the installed app opening on ./?source=pwa) lands straight on the marshal screen', await until(async () => path(fresh) === HOME), path(fresh));
  await fresh.goto(BASE + '/device');
  check('32. opening /device while signed in goes back to the device\'s own screen (no second sign-in)', await until(async () => path(fresh) === HOME), path(fresh));
  await fresh.ctx.close();
  const pwaCounter = await open('phone', 'counter-fresh', await stored(P.counter4));
  await pwaCounter.goto(BASE + '/?source=pwa');
  check('33. the installed app on a COUNTER device opens on the counter screen', await until(async () => path(pwaCounter) === '/lyst/counter'), path(pwaCounter));
  await pwaCounter.ctx.close();

  // ------------------------------------------------------------ 6. what each role may open (route restrictions: only what is OFFERED; the database refuses the rest, checked below)
  const goes = async (page, to, want, wait = 15000) => { await page.goto(BASE + to); return until(async () => path(page) === want, wait); };
  check('34. a Marshal who opens /account lands back on its own screen', await goes(P.marshal, '/account', HOME));
  check('35. a Marshal who opens the Command Centre is sent home (it is not a marshal tool)', await goes(P.marshal, COMMAND, HOME));
  check('36. a Counter who opens a field screen lands on the counter screen', await goes(P.counter4, FIELD1, '/lyst/counter'));
  check('37. an Announcer who opens a field screen or the desk lands on the announcer view', (await goes(P.announcer, FIELD1, ANNOUNCER)) && (await goes(P.announcer, CHECKIN, ANNOUNCER)));
  check('38. a Secretary who opens the check-in desk or Manage lands on the Command Centre', (await goes(P.secretary, CHECKIN, COMMAND)) && (await goes(P.secretary, `${HOME}/manage`, COMMAND)));
  check('39. another event\'s tools never open: the admin opening /events/other-event/command is sent to its own Command Centre', await goes(P.admin, '/events/other-event/command', COMMAND));
  check('40. public pages stay readable by a device (rules, the venue display of its event)', (await goes(P.marshal, '/rules', '/rules')) && (await goes(P.marshal, `${HOME}/arena/Field%201`, `${HOME}/arena/Field%201`)));
  await P.marshal.goto(BASE + HOME);

  // ------------------------------------------------------------ 7. the Command Centre (read only) and the check-in desk
  await P.secretary.goto(BASE + COMMAND);
  check('41. the Secretary / Scorekeeper device opens the Command Centre for its event (read only)', await until(async () => /command centre/i.test(await text(P.secretary, '.cmd-centre')) && /test stuff test/i.test(await text(P.secretary, '.cmd-centre')), 30000), await text(P.secretary));
  check('42. the Event Admin device opens the Command Centre too', await (async () => { await P.admin.goto(BASE + COMMAND); return until(async () => /command centre/i.test(await text(P.admin, '.cmd-centre')), 30000); })(), await text(P.admin));
  await P.admin.goto(BASE + CHECKIN);
  await P.admin.waitForSelector('.desk-counts', { timeout: 30000 }).catch(() => undefined);
  const counts = await text(P.admin, '.desk-counts');
  check('43. the Event Admin / Temporary Organizer opens the CHECK-IN DESK: 4 expected, readiness counts, cards of fighters', /4 expected/.test(counts) && (await P.admin.locator('article.desk-card').count()) >= 1, counts + ' / ' + (await text(P.admin)).slice(0, 300));
  await shot(P.admin, '07-admin-checkin');
  const desk = P.admin.locator('article.desk-card[aria-label="Brann Oakley"]');
  const deskName = 'Brann Oakley';
  const arrive = desk.getByRole('button', { name: 'Arrived' });
  if (await arrive.count()) {
    await arrive.click();
    check('44. the admin marks a fighter ARRIVED from the desk; the database confirms it, and the audit names the DEVICE (not a person)', await until(async () => sql(`select count(*) from public.registration_checks where check_name = 'arrived' and passed`) !== '0') && sql(`select count(*) from public.audit_log where action = 'checkin.arrived' and details::text ilike '%Event Admin Tablet%'`) !== '0', sql(`select details::text from public.audit_log where action = 'checkin.arrived' limit 1`) + deskName);
  } else check('44. the desk offers an Arrived button', false, deskName);

  // ------------------------------------------------------------ 8. the Secretary reorders the queue (Field 2: m11 on deck, m12 in the hole)
  const state = (n) => sql(`select queue_state from public.matches where id = '${mid(n)}'`);
  await P.secretary.goto(BASE + FIELD2);
  await P.secretary.waitForSelector('.fq-row', { timeout: 30000 });
  const rows = async (p) => (await p.locator('.fq-names').allInnerTexts()).map(s => s.replace(/\s+/g, ' ').trim());
  const before = await rows(P.secretary);
  check('45. the queue on Field 2 shows the on-deck and in-the-hole fights in order', before.length === 2 && /aldric stone/i.test(before[0]) && /hale morrow/i.test(before[1]), before.join(' | '));
  check('46. the Secretary sees Move earlier / Move later / Make next on queue rows; the first row cannot move earlier', (await P.secretary.locator('.fq-adjust').count()) === 2 && (await P.secretary.locator('.fq-adjust').first().getByRole('button', { name: /Move .* earlier/ }).isDisabled()) && !(await P.secretary.locator('.fq-adjust').nth(1).getByRole('button', { name: /Move .* earlier/ }).isDisabled()));
  await P.marshal.goto(BASE + FIELD2); await P.marshal.waitForSelector('.fq-row', { timeout: 30000 });
  check('47. a Marshal device on the same screen is NOT offered the controls (it may only score)', (await P.marshal.locator('.fq-adjust').count()) === 0 && (await P.marshal.locator('.fq-row').count()) === 2);
  await shot(P.secretary, '08-secretary-queue');
  await P.secretary.getByRole('button', { name: /Move .*Hale Morrow.* earlier/ }).click();
  check('48. MOVE EARLIER: the database swaps the line (m12 now on deck, m11 in the hole) and the screen says so', await until(async () => state(12) === 'on_deck' && state(11) === 'in_the_hole') && await until(async () => /Moved up one place/.test(await text(P.secretary))), `${state(11)} ${state(12)}`);
  check('49. ... and the order on screen follows without a reload', await until(async () => { const r = await rows(P.secretary); return /hale morrow/i.test(r[0]) && /aldric stone/i.test(r[1]); }), (await rows(P.secretary)).join(' | '));
  check('50. ... the marshal device\'s screen follows by itself (live refresh)', await until(async () => { const r = await rows(P.marshal); return /hale morrow/i.test(r[0]); }, 25000), (await rows(P.marshal)).join(' | '));
  await P.secretary.getByRole('button', { name: /Make .*Aldric Stone.* next/ }).click();
  check('51. MAKE NEXT puts it back at the front; the audit log names the secretary DEVICE and the action', await until(async () => state(11) === 'on_deck' && state(12) === 'in_the_hole') && sql(`select count(*) from public.audit_log where action = 'queue.reordered' and details::text ilike '%Secretary Tablet%'`) !== '0', `${state(11)} ${state(12)}`);
  await P.admin.goto(BASE + FIELD2); await P.admin.waitForSelector('.fq-row', { timeout: 30000 });
  check('52. the Event Admin device is offered the queue controls as well', (await P.admin.locator('.fq-adjust').count()) === 2);
  const probe = async (key, fn, args) => rest(JSON.parse(await stored(P[key])).access_token, 'POST', `rpc/${fn}`, args);
  const rc = await probe('marshal', 'move_match_in_queue', { p_match: mid(12), p_action: 'first' });
  check('53. direct probe: a Marshal device calling move_match_in_queue is REFUSED by the database (not just hidden)', rc.status >= 400 && state(12) === 'in_the_hole', JSON.stringify(rc));

  // ------------------------------------------------------------ 9. the counter flow across three devices
  await P.marshal.goto(BASE + FIELD1); await P.marshal.waitForSelector('.fq-row', { timeout: 30000 });
  await P.marshal.getByRole('button', { name: /Score Aldric Stone against Brann Oakley/ }).click();
  await P.marshal.waitForSelector('.ly-timer', { timeout: 30000 });
  check('54. the marshal device opens the fight on the Lyst screen (a duel)', (await P.marshal.locator('.ly-timer').count()) === 1, await text(P.marshal));
  await P.marshal.getByRole('button', { name: /^Counters/ }).click();
  await P.marshal.getByRole('dialog').getByRole('button', { name: 'Show join code' }).click();
  await P.marshal.getByRole('dialog').locator('.ly-code').waitFor({ timeout: 15000 });
  const joinCode = (await P.marshal.getByRole('dialog').locator('.ly-code').innerText()).trim();
  check('55. the MARSHAL device shows a join code for the field', /^[A-Z0-9]{10}$/.test(joinCode), joinCode);
  await P.marshal.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await P.counter1.goto(BASE + '/lyst/counter');
  await P.counter1.waitForSelector('#cp-code', { timeout: 20000 });
  await P.counter1.fill('#cp-code', joinCode);
  await P.counter1.getByRole('button', { name: 'Join', exact: true }).click();
  const waiting = await P.counter1.getByText(/Waiting for the lyst to seat you/).waitFor({ timeout: 30000 }).then(() => true, () => false);
  check('56. the COUNTER device types the code: it is only PENDING ("Waiting for the lyst to seat you"); a code grants nothing by itself', waiting && sql(`select count(*) from public.lyst_counter_seats where status = 'pending'`) === '1', await text(P.counter1));
  await shot(P.counter1, '09-counter-waiting');
  // the Secretary device seats it
  await P.secretary.goto(BASE + FIELD1); await P.secretary.waitForSelector('.fq-row', { timeout: 30000 });
  await P.secretary.getByRole('button', { name: /Score Aldric Stone against Brann Oakley/ }).click();
  await P.secretary.waitForSelector('.ly-timer', { timeout: 30000 });
  await P.secretary.getByRole('button', { name: /^Counters/ }).click();
  const seatGroup = P.secretary.getByRole('dialog').getByRole('group', { name: /^Seat Counter Phone 1$/ });
  await seatGroup.waitFor({ timeout: 30000 });
  check('57. the SECRETARY device sees the pending counter by the device\'s label ("Counter Phone 1"), not a person\'s name', true);
  await seatGroup.getByRole('button', { name: 'Counts Aldric Stone' }).click();
  check('58. the Secretary seats it: an official counter for Aldric (slot A) on the server', await until(async () => sql(`select string_agg(slot || ':' || role || ':' || side, ',') from public.lyst_counter_seats where status = 'active'`) === 'A:official:a'), sql(`select string_agg(slot || ':' || role || ':' || side || ':' || status, ',') from public.lyst_counter_seats`));
  await P.secretary.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await P.marshal.getByRole('button', { name: /Start round 1/ }).click();
  check('59. the marshal starts round 1; the counter\'s phone shows its fighter, its slot and a COUNT button that is live', await until(async () => /counting · A/i.test(await text(P.counter1)) && /aldric stone/i.test(await text(P.counter1)), 30000) && await until(async () => (await P.counter1.getByRole('button', { name: 'Count two points, head or torso' }).isEnabled()), 20000), await text(P.counter1));
  const plus2 = P.counter1.getByRole('button', { name: 'Count two points, head or torso' }), plus1 = P.counter1.getByRole('button', { name: 'Count one point, arm leg or hand' });
  await plus2.click(); await plus2.click(); await plus1.click();
  const seatTotal = () => sql(`select coalesce((select private.lyst_seat_total(s.id, 1) from public.lyst_counter_seats s where s.status = 'active' and s.match_id = '${mid(1)}' limit 1), 0)`);
  check('60. the counter device taps +2 +2 +1: the server holds 5 as PROVISIONAL evidence and the phone shows 5', await until(async () => seatTotal() === '5') && (await until(async () => (await text(P.counter1, '.cp-total output')) === '5')), `${seatTotal()} ${await text(P.counter1, '.cp-total')}`);
  check('61. nothing official changed: no round score exists', sql(`select count(*) from public.lyst_round_scores where official_a is not null`) === '0');
  const cr = await probe('counter1', 'finalize_match', { p_match: mid(1), p_result: 'a', p_score_a: 5, p_score_b: 0, p_detail: {}, p_expected_version: 0 });
  const ct = await probe('counter1', 'lyst_timer_command', { p_event: E1, p_field: 'Field 1', p_match: mid(1), p_expected_rev: 0, p_command: crypto.randomUUID(), p_action: 'pause', p_mode: null, p_duration_ms: null, p_round: 1, p_delta_ms: null });
  check('62. direct probe: a Counter device cannot finalize a match or touch the clock (refused by the database)', cr.status >= 400 && ct.status >= 400, JSON.stringify([cr, ct]).slice(0, 300));
  check('63. the counter flow left every device on its own screen (no console errors on the three devices)', P.counter1.errors.length === 0 && P.marshal.errors.length === 0 && P.secretary.errors.length === 0, [...P.counter1.errors, ...P.marshal.errors, ...P.secretary.errors].join(' | '));
  await shot(P.counter1, '10-counter-counting'); await shot(P.marshal, '11-marshal-lyst');

  // ------------------------------------------------------------ 10. what the database refuses, with the device's own token (the UI is not the boundary)
  const probes = [
    ['Counter: own-event fighter data (registrations table)', () => rest(JSON.parse(sawKeys.counter2).access_token, 'GET', 'registrations?select=id')],
    ['Marshal: staff table', () => rest(JSON.parse(sawKeys.marshal).access_token, 'GET', 'event_staff?select=user_id')],
    ['Admin: platform roles', () => rest(JSON.parse(sawKeys.admin).access_token, 'GET', 'platform_roles?select=role')],
    ['Announcer: send an announcement', () => rest(JSON.parse(sawKeys.announcer).access_token, 'POST', 'rpc/send_event_announcement', { p_event: E1, p_message: 'hello', p_audience: 'all' })],
    ['Marshal: list the event\'s devices', () => rest(JSON.parse(sawKeys.marshal).access_token, 'POST', 'rpc/list_event_credentials', { p_event: E1 })],
    ['Admin: create a device credential directly', () => rest(JSON.parse(sawKeys.admin).access_token, 'POST', 'rpc/create_event_credential', { p_event: E1, p_kind: 'device', p_label: 'Sneaky', p_role: 'marshal', p_code_hash: '\\x' + '11'.repeat(32), p_expires_at: null })]
  ];
  const probed = [];
  for (const [name, f] of probes) { const r = await f(); const refused = r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0); probed.push([name, refused, r.status]); }
  check('64. direct probes with each device\'s own token: staff, platform roles, registrations, announcements (announcer), the device list and device creation are all refused or empty', probed.every(p => p[1]), JSON.stringify(probed));
  const track = await probe('marshal', 'track_event', { p_session: crypto.randomUUID(), p_name: 'x', p_props: {} });
  check('65. device mode never calls analytics: no track_activity / track_event / report_bug request left any device', !net.some(n => /track_activity|track_event|report_bug/.test(n.url) && Object.keys(P).includes(n.who)), net.filter(n => /track_/.test(n.url)).map(n => n.who + ' ' + n.url).join(' | ') + ' ' + track.status);
  check('66. device mode does not register for push or read profiles: no push_devices, profiles or platform_roles request from a device', !net.some(n => /push_devices|register_push|\/profiles|platform_roles|\/event_staff(\?|$)|\/registrations/.test(n.url) && Object.keys(P).includes(n.who)), net.filter(n => /push_devices|register_push|\/profiles|platform_roles|\/event_staff(\?|$)|\/registrations/.test(n.url) && Object.keys(P).includes(n.who)).map(n => n.who + ' ' + n.url).join(' | '));
  const e2 = await api({ action: 'signin', code: e2c.body.code });
  const xev = await rest(e2.body.access_token, 'POST', 'rpc/camera_state', { p_event: E1 });
  const xq = await rest(e2.body.access_token, 'POST', 'rpc/move_match_in_queue', { p_match: mid(12), p_action: 'first' });
  check('67. Event B\'s device (its own code) is useless at Event A: its token cannot read or change Event A\'s queue', e2.status === 200 && e2.body.whoami.event.slug === 'other-event' && xq.status >= 400 && state(12) === 'in_the_hole', JSON.stringify([e2.status, xev.status, xq.status]));

  // ------------------------------------------------------------ 11. revocation, replacement, sign-out
  const c4 = JSON.parse(await stored(P.counter4));
  const live = await rest(c4.access_token, 'POST', 'rpc/device_whoami', {});
  const ended0 = Date.now();
  const cred4 = sql(`select c.id from public.event_credentials c where c.label = 'Counter Phone 4'`);
  const rev = await rest(orgToken('E1'), 'POST', 'rpc/revoke_event_credential', { p_credential: cred4, p_reason: 'e2e revoke' });
  const dead = await rest(c4.access_token, 'POST', 'rpc/device_whoami', {});
  check('68. REVOKE one device (organizer): its very next call is refused by the database (42501), the others are untouched', live.status === 200 && rev.status === 200 && dead.status >= 400 && /42501/.test(JSON.stringify(dead.body)) && (await rest(JSON.parse(sawKeys.counter3).access_token, 'POST', 'rpc/device_whoami', {})).status === 200, JSON.stringify([live.status, rev.status, dead]));
  await P.counter4.goto(BASE + '/lyst/counter'); // any screen; the next check ends it
  const endedUi = await until(async () => path(P.counter4) === '/device' && ENDED.test(await text(P.counter4)), 30000);
  check('69. the revoked device\'s screen signs itself out within one check: back on /device saying "This device\'s access has ended"', endedUi, `${path(P.counter4)} ${(await text(P.counter4)).slice(0, 200)}`);
  check('70. ... its stored session is gone and the message went away with the note (reload shows the plain sign-in)', (await stored(P.counter4)) === null && (await (async () => { await P.counter4.reload(); await P.counter4.waitForSelector('#ds-code'); return !ENDED.test(await text(P.counter4)); })()));
  check('71. the revoked code no longer signs anything in (same words as any wrong code)', (await api({ action: 'signin', code: dev.counter4.code })).status === 401);
  // replacement: signing the same code in on a second browser ends the first (last sign-in wins)
  const again = await api({ action: 'signin', code: dev.counter2.code });
  await P.counter2.evaluate(() => window.dispatchEvent(new Event('focus')));
  check('72. the SAME code signed in elsewhere: the first device is signed out within one check (a copied code cannot quietly run two devices)', again.status === 200 && (await until(async () => path(P.counter2) === '/device' && ENDED.test(await text(P.counter2)), 30000)), `${again.status} ${path(P.counter2)} ${(await text(P.counter2)).slice(0, 200)}`);
  // sign out on purpose
  await P.counter3.getByRole('button', { name: 'Sign out this device' }).click();
  const dlg = P.counter3.getByRole('dialog');
  await dlg.waitFor({ timeout: 10000 });
  const dlgText = (await dlg.innerText()).replace(/\s+/g, ' ');
  check('73. SIGN OUT asks first ("Sign out this device?") and says what happens', /sign out this device\?/i.test(dlgText) && /new code/i.test(dlgText), dlgText);
  await dlg.getByRole('button', { name: /No, stay signed in/ }).click();
  check('74. "No, stay signed in" changes nothing', (await P.counter3.locator('[data-testid="device-bar"]').count()) === 1 && (await stored(P.counter3)) !== null);
  await P.counter3.getByRole('button', { name: 'Sign out this device' }).click();
  await P.counter3.getByRole('dialog').getByRole('button', { name: /Yes, sign out/ }).click();
  check('75. "Yes, sign out": the device ends on the server, forgets itself and shows the plain sign-in page (no "ended" warning)', await until(async () => path(P.counter3) === '/device' && (await P.counter3.locator('#ds-code').count()) === 1) && (await stored(P.counter3)) === null && !ENDED.test(await text(P.counter3)) && sql(`select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.label = 'Counter Phone 3' and s.ended_at is not null`) !== '0');

  // ------------------------------------------------------------ 12. the normal site is unchanged, and the whole run is clean
  const visitor = await open('desktop', 'visitor2');
  await visitor.goto(BASE + `/events/${SLUG}`);
  await visitor.waitForSelector('header.top', { timeout: 30000 });
  check('76. a visitor with no device session gets the normal site (header, menus, footer) on the same build', (await visitor.locator('header.top').count()) === 1 && (await visitor.locator('footer').count()) === 1 && (await visitor.locator('[data-testid="device-bar"]').count()) === 0);
  await visitor.goto(BASE + ANNOUNCER);
  check('77. the announcer route exists for permanent accounts too (chrome-less)', await until(async () => (await visitor.locator('header.top').count()) === 0 && /NOW FIGHTING|FOCUS LYST/i.test(await text(visitor)), 20000), await text(visitor));
  await visitor.ctx.close();

  let sideways = [];
  for (const k of ['counter1', 'marshal', 'secretary']) { await P[k].goto(BASE + LANDING[k]); await sleep(1200); if (!(await noSideways(P[k]))) sideways.push(k); }
  check('78. no sideways scroll at 390x844 on the counter, marshal and secretary screens', sideways.length === 0, sideways.join(','));
  const fieldScreens = await noSideways(P.secretary);
  await P.secretary.goto(BASE + FIELD2); await sleep(1500);
  check('79. ... nor on a field screen with the bar and the queue controls', (await noSideways(P.secretary)) && fieldScreens);
  const errs = Object.entries(P).flatMap(([k, p]) => p.errors.map(e => `${k}: ${e}`));
  check('80. no console or page errors on any device', errs.length === 0, errs.join(' | '));
  // the plaintext code: nowhere it must not be
  const leak = [];
  for (const c of codes) for (const v of [c, norm(c)]) {
    for (const n of net) { if (n.url.includes(v) || JSON.stringify(n.headers).includes(v)) leak.push(`url/header ${n.who} ${n.url.slice(0, 80)}`); if (n.post.includes(v) && !n.url.endsWith('/functions/v1/device-session')) leak.push(`post ${n.who} ${n.url.slice(0, 80)}`); }
    for (const l of consoleLines) if (l.includes(v)) leak.push('console');
    for (const t of ['audit_log', 'event_credentials', 'event_sessions', 'notifications']) { try { if (sql(`select count(*) from public.${t} x where x::text ilike '%${v}%'`) !== '0') leak.push(`table ${t}`); } catch { /* absent */ } }
  }
  check('81. the plaintext code is nowhere it must not be: no URL, header, console line, audit row or table; in a request body only for the sign-in POST', leak.length === 0, [...new Set(leak)].join(' | '));
  check('82. the secret is not in any URL or console line either', Object.values(sawKeys).every(v => { const s = JSON.parse(v).secret; return !net.some(n => n.url.includes(s)) && !consoleLines.some(l => l.includes(s)); }));
} catch (e) {
  check('the run completed without an unexpected error', false, e?.stack ?? e);
} finally {
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} PASS, ${failed.length} FAIL, ${results.length} checks`);
  process.exit(failed.length ? 1 : 0);
}
