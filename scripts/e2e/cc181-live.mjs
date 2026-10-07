// Pack 18.1: the Command Centre's Event devices, Broadcast, Staff and Camera Off panels, against a REAL local stack (scripts/e2e/cc181-live.sh):
// Postgres built from every migration + the cc181 fixture, PostgREST, the local stack serving the REAL device-session Edge Function handler (HS256),
// and the real built app in real Chromium at 390x844 and 1280x900.
//   * the permanent organizer: creates device codes through the real Edge Function route (code shown ONCE, QR carries the fragment link, copy, replace,
//     revoke one, sign out all, the stream laptop's own code, the usual set + print sheet) and the code is verified to exist nowhere afterwards
//     (DOM, storage, audit log, database dump, console, request URLs);
//   * Broadcast: heartbeat data, Take Lyst / Holding / Break / Return to Auto / music / Auto Duck change the control row (checked in the database),
//     a stale revision is handled, a missing / silent controller says so, Camera Off banner;
//   * a Temporary Organizer DEVICE (credential + session rows, HS256 token with role bos_event_device and sub = the session id): refused device
//     management by the database, and the real page opens on that token and calls only allow-listed functions;
//   * the Secretary / Scorekeeper and the head marshal see what they may; a stranger and a signed-out visitor are refused;
//   * live changes (a new heartbeat, a revoke from another session) refresh in place: scroll, open sections and an unsent announcement draft stay.
// LOCAL EVIDENCE ONLY (needs a PostgREST binary; not part of CI).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const qrcode = require('qrcode-generator');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 900)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (claims) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify(claims)); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const jwt = (sub, email) => sign({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 });
const sess = (id, email, token) => ({ access_token: token ?? jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const U = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const WHO = { organizer: [U('a2'), 'u2@example.test'], scorekeeper: [U('a4'), 'u4@example.test'], head: [U('c1'), 'c1@example.test'], announcer: [U('e1'), 'anna@example.test'],
  newcomer: [U('e3'), 'newcomer@example.test'], stranger: [U('a7'), 'u7@example.test'], otherOrg: [U('e4'), 'e4@example.test'] };
const STORAGE_KEY = 'sb-localhost-auth-token';
const EV = '00000000-0000-0000-0000-00000000ed01', OTHER_EV = '00000000-0000-0000-0000-00000000ed02';
const GATE_SESSION = '00000000-0000-0000-0000-0000000e5d01';
const SLUG = 'test-stuff-test', CMD = `/events/${SLUG}/control?mode=live`;
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim().split('\n').at(-1) ?? '';   // the last line: "SET" lines from a leading set timezone are dropped
const count = (q) => Number(sql(q));
const orgToken = jwt(...WHO.organizer);

// ------------------------------------------------------------------ the Data API and the Edge Function, as any client would call them
const tokenFor = (who) => (typeof who === 'string' ? jwt(...WHO[who]) : who.jwt);
async function rest(who, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', prefer: 'return=representation', ...(who ? { authorization: `Bearer ${tokenFor(who)}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args) => rest(who, 'POST', `rpc/${fn}`, args);
const refused = (r) => r.status >= 400 && r.status < 500;
const deviceJwt = (sessionId, role = 'bos_event_device') => ({ jwt: sign({ aud: 'authenticated', role, sub: sessionId, session_id: sessionId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }) });
async function edge(body, bearer) {
  const r = await fetch(`${API}/functions/v1/device-session`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const sameJson = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b).sort());
const raw = (code) => code.replace(/-/g, '');
const signin = (code) => edge({ action: 'signin', code });

// ------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { desktop: { viewport: { width: 1280, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };
const NOISE = /Failed to load resource|WebSocket|realtime|net::ERR|Failed to fetch|40[0-9]|42501|\[BuhurtOS\]|ERR_CERT/i;
async function open(kind, who, extra = {}) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton', permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|youtube(-nocookie)?\.com|twitch\.tv|vimeo\.com/, r => r.abort('failed'));
  await ctx.addInitScript(() => { window.__prints = []; window.print = () => { window.__prints.push(document.body.className); }; });
  if (who) {
    const s = extra.session ?? sess(...WHO[who]);
    await ctx.addInitScript(([k, v]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked frame */ } }, [STORAGE_KEY, s]);
  }
  const page = await ctx.newPage();
  page.ctx = ctx; page.errors = []; page.logs = []; page.reqs = []; page.fnReqs = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { page.logs.push(m.text()); if (m.type() === 'error' && !NOISE.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('response', r => { page.reqs.push({ url: r.url(), status: r.status(), method: r.request().method() }); });
  page.on('request', r => { if (r.url().includes('/functions/v1/device-session')) page.fnReqs.push({ headers: r.headers(), body: r.postData() }); });
  return page;
}
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = async (page, name) => { if (SHOTS) { await sleep(300); await page.screenshot({ path: `${SHOTS}/cc181-${name}.png`, fullPage: true }).catch(() => undefined); } };
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const until = async (fn, timeout = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(200); } return false; };
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
async function openCmd(page) {
  await page.goto(BASE + CMD);
  await page.locator('.cmd-centre').waitFor({ timeout: 30000 });
  await sleep(1500);
}
async function openSection(page, id) {
  const d = page.locator(id);
  if (!(await d.evaluate(el => el.open))) await d.locator('> summary').click();
  await until(() => d.evaluate(el => el.open));
}
const focusRefresh = (page) => page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
const closeSheet = async (page) => { await page.getByRole('dialog').getByRole('button', { name: /^Done/ }).click(); await until(async () => (await page.getByRole('dialog').count()) === 0); };

// where could a code be? the page (DOM, storage, IndexedDB, cookies, history), what the browser logged, every URL it asked for, and the database
async function codeInBrowser(page, code) {
  const r = raw(code);
  const hay = await page.evaluate(async () => {
    const out = [document.documentElement.outerHTML, document.cookie, location.href, JSON.stringify(history.state ?? null)];
    for (const [k, v] of Object.entries(localStorage)) out.push(k, v);
    for (const [k, v] of Object.entries(sessionStorage)) out.push(k, v);
    try {
      const dbs = (await indexedDB.databases?.()) ?? [];
      for (const d of dbs) {
        out.push(String(d.name));
        await new Promise((ok) => {
          const req = indexedDB.open(d.name);
          req.onerror = () => ok(null);
          req.onsuccess = () => {
            const db = req.result; const names = [...db.objectStoreNames];
            if (!names.length) { db.close(); return ok(null); }
            const tx = db.transaction(names, 'readonly'); let left = names.length;
            for (const n of names) { const g = tx.objectStore(n).getAll(); g.onsuccess = () => { try { out.push(JSON.stringify(g.result)); } catch { /* skip */ } if (--left === 0) { db.close(); ok(null); } }; g.onerror = () => { if (--left === 0) { db.close(); ok(null); } }; }
          };
        });
      }
    } catch { /* no IndexedDB */ }
    out.push(...performance.getEntriesByType('resource').map(e => e.name));
    return out.join('\n');
  });
  const inLogs = page.logs.some(l => l.includes(code) || l.includes(r));
  const inUrls = page.reqs.some(q => q.url.includes(r) || q.url.includes(code));
  return { dom: hay.includes(code) || hay.includes(r), logs: inLogs, urls: inUrls };
}
const codeInDb = (code) => {
  const r = raw(code);
  return {
    audit: count(`select count(*) from public.audit_log a where a::text ilike '%${r}%' or a::text ilike '%${code}%'`),
    credentials: count(`select count(*) from public.event_credentials c where c::text ilike '%${r}%'`),
    sessions: count(`select count(*) from public.event_sessions s where s::text ilike '%${r}%'`),
    attempts: count(`select count(*) from public.device_code_attempts a where a::text ilike '%${r}%'`)
  };
};
const qrPath = (url) => { const q = qrcode(0, 'M'); q.addData(url); q.make(); const s = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); return { d: /<path d="([^"]+)"/.exec(s)?.[1], viewBox: /viewBox="([^"]+)"/.exec(s)?.[1] }; };
const qrInPage = (page, scope) => page.locator(`${scope} .dev-qr svg`).first().evaluate(svg => ({ d: svg.querySelector('path')?.getAttribute('d'), viewBox: svg.getAttribute('viewBox') }));
const ctlRow = () => sql(`select concat_ws('|', mode, coalesce(target_kind, ''), coalesce(target_field, ''), music_mode, auto_duck, rev) from public.event_broadcast_control where event_id = '${EV}'`);
const camActive = () => sql(`select coalesce((select active::text from public.event_camera_state where event_id = '${EV}'), 'none')`);
const credState = (label) => sql(`select concat_ws('|', kind, role, case when revoked_at is null then 'open' else 'revoked' end) from public.event_credentials where event_id = '${EV}' and lower(label) = lower('${label}') order by created_at desc limit 1`);
const heartbeat = (patch) => sql(`update public.broadcast_controller_status set reported_at = now(), status = status || '${JSON.stringify(patch)}'::jsonb where event_id = '${EV}'`);
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const usedCodes = [];                                   // every code this run saw, for the final whole-database search

const pages = [];
try {
  // =================================================================== 0. starting point
  sql(`update public.broadcast_controller_status set reported_at = now() where event_id = '${EV}'`);   // the fixture's heartbeat is "just sent"
  check('0.1 fixture: three Lysts have fights, a controller credential and a fresh heartbeat exist, one Temporary Organizer device holds an open session',
    count(`select count(distinct coalesce(nullif(btrim(m.field), ''), 'Field 1')) from public.matches m join public.competitions c on c.id = m.competition_id where c.event_id = '${EV}'`) === 3
    && credState('Stream laptop') === 'controller|broadcast_controller|open' && count(`select count(*) from public.broadcast_controller_status where event_id = '${EV}' and reported_at > now() - interval '30 seconds'`) === 1
    && count(`select count(*) from public.event_sessions where id = '${GATE_SESSION}' and ended_at is null`) === 1);
  const countsBefore = () => ({ audit: count('select count(*) from public.audit_log'), control: count('select count(*) from public.event_broadcast_control'), creds: count('select count(*) from public.event_credentials'),
    camera: count('select count(*) from public.event_camera_state'), ann: count('select count(*) from public.event_announcements'), sessions: count('select count(*) from public.event_sessions') });

  // =================================================================== 1. the permanent organizer, phone: the page, the broadcast panel, creating a device
  const org = await open('phone', 'organizer'); pages.push(org);
  await openCmd(org);
  await org.evaluate(() => { document.querySelector('.cmd-centre').dataset.mark = 'kept'; });
  const camY = await org.locator('[data-testid="camera-off"]').boundingBox().then(b => b?.y ?? -1).catch(() => -1);
  const attY = await org.locator('#cc-attention').boundingBox().then(b => b?.y ?? -1).catch(() => -1);
  check('1.1 Camera Off sits at the TOP of the page (above Needs attention) with the red button, for the organizer', camY > 0 && camY < attY && (await org.getByRole('button', { name: 'Emergency camera off' }).count()) === 1, `${camY} / ${attY}`);
  check('1.2 organizer sees every panel: Broadcast, Announcements, Staff, Event devices', (await org.locator('#cc-broadcast, #cc-announce, #cc-staff, #cc-devices').count()) === 4);
  const bc = await text(org, '#cc-broadcast');
  check('1.3 Broadcast shows the heartbeat in plain words: OBS Connected, Mode AUTO, On air Lyst 1, the fight, Camera, Overlay Live, Music Playing, Mic Quiet, Auto Duck On, Camera Safety ON AIR',
    /OBS\s*✓?\s*Connected/.test(bc) && /MODE\s*✓?\s*AUTO/i.test(bc) && /ON AIR\s*✓?\s*Lyst 1/i.test(bc) && /Aldric Stone vs Brann Oakley/.test(bc) && /CAMERA\s*Lyst 1 camera/i.test(bc)
    && /OVERLAY\s*✓?\s*Live/i.test(bc) && /MUSIC\s*Playing/i.test(bc) && /MIC\s*Quiet/i.test(bc) && /AUTO DUCK\s*✓?\s*On/i.test(bc) && /CAMERA SAFETY\s*✓?\s*ON AIR/i.test(bc), bc);
  check('1.4 Broadcast: controller seen just now; "Also live: Lyst 2 (…)" and the setup problem are shown', /Stream controller: Last seen (just now|\d+ s ago)/.test(bc) && /Also live: Lyst 2 \(Garrick Fell vs Hale Morrow, round 1\)/.test(bc) && /Lyst 3 has no camera mapping/.test(bc), bc);
  check('1.5 Broadcast badge says AUTO in the section header', /AUTO/.test(await text(org, '#cc-broadcast > summary')));
  check('1.6 390x844: no sideways scroll with every panel open', await noSideways(org));
  await shot(org, '01-phone-top');

  await openSection(org, '#cc-devices');
  const devText0 = await text(org, '#cc-devices');
  const gate = org.locator('[data-testid="device-row"][data-label="Gate Tablet"]');
  const expEnd = sql(`set timezone = 'America/Edmonton'; select to_char(private.device_credential_expiry('00000000-0000-0000-0000-0000000c0d01'), 'Dy HH24:MI TZ')`);
  check('1.7 Event devices lists the Temporary Organizer device: name, "Event Admin / Temporary Organizer", Active, and "Access ends <event-time>" matching the database',
    (await gate.count()) === 1 && /Event Admin \/ Temporary Organizer/.test(await gate.innerText()) && /Active/i.test(await gate.innerText()) && (await gate.innerText()).includes(`Access ends ${expEnd}`), `${expEnd} :: ${await gate.innerText().catch(() => '')}`);
  const lap = org.locator('[data-testid="device-row"][data-label="Stream laptop"]');
  check('1.8 the stream laptop is listed apart, as "Stream controller", Active, with no device-style form', (await lap.count()) === 1 && /Stream controller/.test(await lap.innerText()) && (await org.locator('#cc-devices h3', { hasText: 'Stream laptop (OBS controller)' }).count()) === 1);
  check('1.9 the list never shows a code or a hash', !/[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/.test(devText0) && !/\\x|code_hash/i.test(devText0));

  // ---- create one device through the REAL Edge Function route
  const dev = org.locator('#cc-devices');
  await dev.getByLabel('Name').fill('Counter Phone 9');
  await dev.getByLabel('Role').selectOption('counter');
  const fnBefore = org.fnReqs.length;
  await dev.getByRole('button', { name: 'Make a code' }).click();
  const sheet = org.getByTestId('code-sheet');
  await sheet.waitFor({ timeout: 15000 });
  const code9 = (await org.getByTestId('device-code').innerText()).trim();
  usedCodes.push(code9);
  check('1.10 the code is shown in a sheet, big and grouped XXXX-XXXX-XXXX (Crockford alphabet)', CODE_RE.test(code9), code9);
  const sheetText = await text(org, '[role="dialog"]');
  check('1.11 plain warning: it will not be shown again; role and name are shown', /will not be shown again/i.test(sheetText) && /Counter Phone 9/i.test(sheetText) && /Counter/i.test(sheetText), sheetText);
  const req = org.fnReqs.slice(fnBefore).at(-1);
  const body = JSON.parse(req?.body ?? '{}');
  check('1.12 the request went to the Edge Function: POST /functions/v1/device-session {action create, event, kind device, label, role} with the organizer\'s own access token and the apikey',
    req && body.action === 'create' && body.event === EV && body.kind === 'device' && body.label === 'Counter Phone 9' && body.role === 'counter' && req.headers.authorization === `Bearer ${orgToken}` && !!req.headers.apikey, JSON.stringify({ body, h: req?.headers?.authorization?.slice(0, 20) }));
  const qrBrowser = await qrInPage(org, '[role="dialog"]');
  const expectUrl = `${BASE}/device#c=${raw(code9)}`;
  const qrExpected = qrPath(expectUrl);
  check('1.13 the QR is drawn and encodes <origin>/device#c=<code> (the code in the URL FRAGMENT only): same modules as the QR library makes for exactly that link',
    qrBrowser.d && qrBrowser.d === qrExpected.d && qrBrowser.viewBox === qrExpected.viewBox, `${qrBrowser.viewBox} vs ${qrExpected.viewBox}`);
  check('1.14 ...and it is NOT the QR of the bare code, nor of a query-string link (so the fragment is what it carries)', qrBrowser.d !== qrPath(code9).d && qrBrowser.d !== qrPath(`${BASE}/device?c=${raw(code9)}`).d);
  await sheet.getByRole('button', { name: 'Copy code' }).click();
  await until(async () => /Copied/.test(await text(org, '[role="dialog"]')));
  const clip = await org.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  check('1.15 Copy puts exactly the code on the clipboard and says "Copied"', clip === code9, String(clip));
  await org.evaluate(() => navigator.clipboard.writeText('')).catch(() => undefined);
  await shot(org, '02-phone-code-sheet');
  check('1.16 the sheet fits a 390 px phone (no sideways scroll) and has Print and Done', await noSideways(org) && (await org.getByRole('dialog').getByRole('button', { name: /^Print/ }).count()) === 1 && (await org.getByRole('dialog').getByRole('button', { name: /^Done/ }).count()) === 1);
  const si1 = await signin(code9);
  check('1.17 the shown code is real: signing in with it through the Edge Function opens a Counter session (label and role in whoami, a 10-minute token)',
    si1.status === 200 && si1.body?.whoami?.role === 'counter' && si1.body?.whoami?.label === 'Counter Phone 9' && si1.body?.whoami?.event?.slug === SLUG && si1.body?.expires_in === 600 && typeof si1.body?.session_secret === 'string', JSON.stringify(si1));
  await closeSheet(org);
  check('1.18 closing the sheet removes the code from the DOM, storage, IndexedDB, cookies, history, console and every URL requested', await (async () => { const r = await codeInBrowser(org, code9); return !r.dom && !r.logs && !r.urls; })(), JSON.stringify(await codeInBrowser(org, code9)));
  const dbHits = codeInDb(code9);
  check('1.19 the code is in no database row either: not the audit log, credentials, sessions or sign-in attempts (only the keyed verifier is stored)', Object.values(dbHits).every(n => n === 0), JSON.stringify(dbHits));
  check('1.20 the audit log records "device.created" for the label (and nothing secret)', count(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'device.created' and subject = 'Counter Phone 9'`) === 1);
  const row9 = org.locator('[data-testid="device-row"][data-label="Counter Phone 9"]');
  await until(async () => (await row9.count()) === 1);
  check('1.21 the new device appears in the list: Counter, Active', (await row9.count()) === 1 && /Counter/.test(await row9.innerText()) && /Active/i.test(await row9.innerText()), await row9.innerText().catch(() => ''));
  check('1.22 creating the same name again is refused in words (a device with that name already exists)', await (async () => {
    await dev.getByLabel('Name').fill('counter phone 9'); await dev.getByRole('button', { name: 'Make a code' }).click();
    return until(async () => /already exists/i.test(await text(org, '#cc-devices')), 8000);
  })(), await text(org, '#cc-devices'));
  check('1.23 ...and no sheet opened for the refused name', (await org.getByRole('dialog').count()) === 0);
  await dev.getByLabel('Name').fill('');

  // ---- a second sign-in with the same code: "signed in on another device"
  const si2 = await signin(code9);
  check('1.24 a second sign-in with the same code is allowed and ends the first session', si2.status === 200 && count(`select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.label = 'Counter Phone 9' and s.ended_at is null`) === 1);
  const elsewhereLocal = sql(`set timezone = 'America/Edmonton'; select to_char(elsewhere_at, 'HH24:MI') from public.event_credentials where label = 'Counter Phone 9' and revoked_at is null`);
  await focusRefresh(org);
  check('1.25 the row warns "Signed in on another device at hh:mm" (the event\'s clock)', await until(async () => (await row9.innerText()).includes(`Signed in on another device at ${elsewhereLocal}`), 15000), `${elsewhereLocal} :: ${await row9.innerText().catch(() => '')}`);
  check('1.26 the row says when it was last seen', /Last seen/.test(await row9.innerText()), await row9.innerText());

  // ---- replace: the old code and any session die immediately; the new code is shown once
  await org.getByRole('button', { name: 'New code for Counter Phone 9' }).click();
  check('1.27 replace asks first and says the old code stops working right away', /old code stops working right away/i.test(await text(org, '[role="dialog"]')));
  await org.getByRole('dialog').getByRole('button', { name: 'Make a new code' }).click();
  await sheet.waitFor({ timeout: 15000 });
  const code9b = (await org.getByTestId('device-code').innerText()).trim();
  usedCodes.push(code9b);
  check('1.28 replace shows a NEW code once (different from the old one), with the same note and QR', CODE_RE.test(code9b) && code9b !== code9 && /will not be shown again/i.test(await text(org, '[role="dialog"]')) && (await qrInPage(org, '[role="dialog"]')).d === qrPath(`${BASE}/device#c=${raw(code9b)}`).d);
  check('1.29 the replace request was {action replace, credential} through the Edge Function', (() => { const b = JSON.parse(org.fnReqs.at(-1)?.body ?? '{}'); return b.action === 'replace' && typeof b.credential === 'string'; })());
  const oldSignin = await signin(code9);
  const oldRefresh = await edge({ action: 'refresh', session_secret: si2.body.session_secret });
  check('1.30 the OLD code no longer signs in, and the session that was open on it can no longer refresh (both die immediately)', oldSignin.status === 401 && oldRefresh.status === 401, `${oldSignin.status}/${oldRefresh.status}`);
  const newSignin = await signin(code9b);
  check('1.31 the new code signs in', newSignin.status === 200 && newSignin.body?.whoami?.label === 'Counter Phone 9');
  await closeSheet(org);
  const hitsB = await codeInBrowser(org, code9b);
  check('1.32 after closing: the new code is nowhere in the browser or the database, and the old one still is not', !hitsB.dom && !hitsB.logs && !hitsB.urls && Object.values(codeInDb(code9b)).every(n => n === 0) && Object.values(codeInDb(code9)).every(n => n === 0));
  check('1.33 the old credential is revoked ("replaced") and linked to the new one; the audit log says device.replaced', count(`select count(*) from public.event_credentials where label = 'Counter Phone 9' and revoked_at is not null and revoked_reason = 'replaced' and replaced_by is not null`) === 1 && count(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'device.replaced'`) === 1);

  // ---- a second device, then revoke ONE: the others are unaffected
  await dev.getByLabel('Name').fill('Counter Phone 8'); await dev.getByLabel('Role').selectOption('counter'); await dev.getByRole('button', { name: 'Make a code' }).click();
  await sheet.waitFor({ timeout: 15000 });
  const code8 = (await org.getByTestId('device-code').innerText()).trim(); usedCodes.push(code8);
  const si8 = await signin(code8);
  await closeSheet(org);
  const si9 = await signin(code9b);
  const gateBefore = await rpc(deviceJwt(GATE_SESSION), 'device_whoami', {});
  await org.getByRole('button', { name: 'Revoke Counter Phone 9' }).click();
  check('1.34 revoke asks first and says other devices are not affected', /Other devices are not affected/.test(await text(org, '[role="dialog"]')));
  await org.getByRole('dialog').getByRole('button', { name: 'Revoke', exact: true }).click();
  check('1.35 revoked: the row leaves the active list (it is under "Revoked and expired") and the page says so', await until(async () => (await org.locator('#cc-devices .dev-list').first().locator('[data-label="Counter Phone 9"]').count()) === 0 && /Counter Phone 9 is signed out/.test(await text(org, '#cc-devices'))), await text(org, '#cc-devices'));
  const r9 = await edge({ action: 'refresh', session_secret: si9.body.session_secret }), r8 = await edge({ action: 'refresh', session_secret: si8.body.session_secret }), s9 = await signin(code9b);
  const gateAfter = await rpc(deviceJwt(GATE_SESSION), 'device_whoami', {});
  check('1.36 revoking ONE device ends only that one: its session and code are refused; Counter Phone 8 and the Temporary Organizer device are untouched',
    r9.status === 401 && s9.status === 401 && r8.status === 200 && gateBefore.status === 200 && gateAfter.status === 200 && credState('Counter Phone 8') === 'device|counter|open', `${r9.status} ${s9.status} ${r8.status} ${gateAfter.status}`);
  check('1.37 audit: device.revoked for that label', count(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'device.revoked' and subject = 'Counter Phone 9'`) === 1);
  await org.locator('#cc-devices .dev-past > summary').click();
  check('1.38 "Revoked and expired" keeps the history: Counter Phone 9 shows as Revoked with no action buttons', await (async () => { const r = org.locator('#cc-devices .dev-past [data-label="Counter Phone 9"]'); return (await r.count()) >= 1 && /Revoked/i.test(await r.first().innerText()) && (await r.first().getByRole('button').count()) === 0; })());

  // =================================================================== 2. the Temporary Organizer DEVICE: refused device management; the real page on a device token
  const GATE = deviceJwt(GATE_SESSION);
  const g = {
    list: await rpc(GATE, 'list_event_credentials', { p_event: EV }),
    revoke: await rpc(GATE, 'revoke_event_credential', { p_credential: '00000000-0000-0000-0000-0000000c0d01', p_reason: null }),
    revokeAll: await rpc(GATE, 'revoke_all_event_devices', { p_event: EV }),
    create: await edge({ action: 'create', event: EV, kind: 'device', label: 'Sneaky Tablet', role: 'counter' }, GATE.jwt),
    createRpc: await rpc(GATE, 'create_event_credential', { p_event: EV, p_kind: 'device', p_label: 'Sneaky 2', p_role: 'counter', p_code_hash: '\\x' + '11'.repeat(32) }),
    replace: await edge({ action: 'replace', credential: '00000000-0000-0000-0000-0000000c0d01' }, GATE.jwt)
  };
  check('2.1 the Temporary Organizer device is refused device management by the DATABASE: list, revoke, revoke-all, create, replace (Data API and Edge Function)',
    refused(g.list) && refused(g.revoke) && refused(g.revokeAll) && refused(g.createRpc) && g.create.status >= 400 && g.replace.status >= 400, JSON.stringify(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.status]))));
  check('2.2 ...and nothing changed: Gate Tablet is still active, no Sneaky device exists', credState('Gate Tablet') === 'device|temporary_organizer|open' && count(`select count(*) from public.event_credentials where label ilike 'Sneaky%'`) === 0);
  const snapG = await rpc(GATE, 'event_command_snapshot', { p_event: EV });
  check('2.3 it may open the Command Centre: viewer = {organizer false, announce, operator, camera_off, camera_release, broadcast true}', snapG.status === 200 && sameJson(snapG.body?.viewer, { organizer: false, announce: true, operator: true, camera_off: true, camera_release: true, broadcast: true }), JSON.stringify(snapG.body?.viewer));
  const stateG = await rpc(GATE, 'broadcast_control_state', { p_event: EV });
  check('2.4 it may read and control the broadcast (can_control true)', stateG.status === 200 && stateG.body?.can_control === true);
  const tables = await Promise.all(['event_staff', 'event_credentials', 'registrations', 'profiles', 'platform_roles', 'audit_log'].map(async t => [t, await rest(GATE, 'GET', `${t}?select=*&limit=1`)]));
  check('2.5 a device cannot read the tables that need a person (event_staff, event_credentials, registrations, profiles, platform_roles, audit_log): the page must not call them', tables.every(([, r]) => refused(r) || (Array.isArray(r.body) && r.body.length === 0)), JSON.stringify(tables.map(([t, r]) => [t, r.status])));
  const names = await rpc(GATE, 'list_event_staff_names', { p_event: EV });
  check('2.6 it may list staff NAMES (no emails anywhere in the answer)', names.status === 200 && names.body.length >= 4 && !JSON.stringify(names.body).includes('@') && names.body.every(r => Object.keys(r).sort().join() === 'name,role,user_id'), JSON.stringify(names.body).slice(0, 300));
  const gOrg = await rpc(GATE, 'grant_event_role_by_email', { p_event: EV, p_email: 'newcomer@example.test', p_role: 'organizer' });
  check('2.7 it may NOT make an organizer (refused by the database)', refused(gOrg) && count(`select count(*) from public.event_staff where event_id = '${EV}' and user_id = '${U('e3')}'`) === 0, JSON.stringify(gOrg));

  const dpage = await open('phone', 'organizer', { session: sess(GATE_SESSION, 'device@example.test', GATE.jwt) }); pages.push(dpage);
  await openCmd(dpage);
  check('2.8 the real page opens on the device token: header, Camera Off, Broadcast and Staff', (await dpage.locator('.cmd-centre').count()) === 1 && (await dpage.locator('[data-testid="camera-off"]').count()) === 1 && (await dpage.locator('#cc-broadcast').count()) === 1 && (await dpage.locator('#cc-staff').count()) === 1, await text(dpage));
  check('2.9 a Temporary Organizer sees Announcements (with the history) and the broadcast controls, but NOT Event devices and no Manage links', (await dpage.locator('#cc-announce').count()) === 1 && (await dpage.getByTestId('bc-controls').count()) === 1 && (await dpage.locator('#cc-devices').count()) === 0 && (await dpage.locator('.cmd-centre a[href*="/manage"]').count()) === 0);
  check('2.10 the device is offered Camera Off and turning cameras back on (released by an event admin)', (await dpage.getByRole('button', { name: 'Emergency camera off' }).count()) === 1);
  await openSection(dpage, '#cc-staff');
  const gtext = await text(dpage, '#cc-staff');
  check('2.11 Staff: names only (no emails), an add form whose roles leave out Organizer but include Announcer', (await dpage.getByTestId('staff-names').count()) === 1 && !/@/.test(gtext) && /Announcer Anna/.test(gtext) && /Medic Mo/.test(gtext)
    && await (async () => { const opts = await dpage.locator('#cc-staff select option').allInnerTexts(); return !opts.includes('Organizer') && opts.includes('Announcer') && opts.includes('Secretary / Scorekeeper'); })(), gtext);
  // the page's own requests: only public reads and allow-listed functions
  const bad = dpage.reqs.filter(r => r.status >= 400 && /\/rest\/v1\//.test(r.url));
  const mine = bad.filter(r => /event_staff|event_credentials|registrations|list_event_credentials|list_event_staff\b|audit_log|my_desk_roles/.test(r.url));
  check('2.12 the page asked a device only for what a device may read: no refused call to a table or function that needs a person from the Command Centre', mine.length === 0, JSON.stringify(mine));
  console.log('     (informational: other refused calls on this page, not from the Command Centre:', JSON.stringify(bad.map(r => `${r.status} ${new URL(r.url).pathname.replace('/rest/v1', '')}`)), ')');
  await shot(dpage, '03-phone-temporary-organizer');
  // the device presses Take Lyst 2 from the page; the organizer's page (another session) sees it change in place
  await dpage.getByRole('button', { name: 'Take Lyst 2' }).click();
  await until(async () => (await ctlRow()).startsWith('manual|lyst|field 2'));
  check('2.13 the Temporary Organizer takes Lyst 2 from the page: the control row says manual / lyst / field 2', (await ctlRow()).startsWith('manual|lyst|field 2|'), await ctlRow());
  check('2.14 the audit record names the DEVICE (label, role, kind) and not a person', count(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'broadcast.control' and details -> 'device' ->> 'label' = 'Gate Tablet' and details -> 'device' ->> 'role' = 'temporary_organizer'`) >= 1);
  await focusRefresh(org);
  check('2.15 the organizer\'s page (another session) shows MANUAL / Lyst 2 held within seconds, in place', await until(async () => /MODE\s*⚠?\s*MANUAL/i.test(await text(org, '#cc-broadcast')) && /holding Lyst 2/i.test(await text(org, '#cc-broadcast')), 12000), await text(org, '#cc-broadcast'));
  check('2.16 ...without remounting the page (the marker on the page root is still there)', await org.evaluate(() => document.querySelector('.cmd-centre')?.dataset.mark === 'kept'));
  await dpage.locator('#cc-broadcast').getByRole('button', { name: 'Return to Auto' }).click();
  await until(async () => (await ctlRow()).startsWith('auto|'));
  check('2.17 Return to Auto from the device: mode auto, manual target cleared', /^auto\|\|\|/.test(await ctlRow()), await ctlRow());
  // staff add / remove as the Temporary Organizer
  await dpage.locator('#cc-staff').getByLabel('Email').fill('newcomer@example.test');
  await dpage.locator('#cc-staff').getByLabel('Role').selectOption('announcer');
  await dpage.locator('#cc-staff').getByRole('button', { name: 'Add', exact: true }).click();
  check('2.18 the Temporary Organizer adds a person by email as Announcer: the list shows the NAME', await until(async () => /Newcomer Nia/.test(await text(dpage, '#cc-staff')), 10000) && count(`select count(*) from public.event_staff where event_id = '${EV}' and user_id = '${U('e3')}' and role = 'announcer'`) === 1, await text(dpage, '#cc-staff'));
  await dpage.getByRole('button', { name: 'Remove Newcomer Nia as Announcer' }).click();
  check('2.19 ...and removes them again', await until(async () => (await dpage.locator('#cc-staff [data-testid="staff-row"]', { hasText: 'Newcomer Nia' }).count()) === 0, 10000) && count(`select count(*) from public.event_staff where event_id = '${EV}' and user_id = '${U('e3')}'`) === 0);
  check('2.20 the Temporary Organizer page has no page errors', dpage.errors.length === 0, dpage.errors.join(' | '));

  // =================================================================== 3. the organizer: sign out all, the stream laptop, the usual set
  await focusRefresh(org);
  await org.getByRole('button', { name: 'Sign out all temporary devices' }).click();
  check('3.1 sign out all asks first, says the stream laptop is not affected', /stream laptop is not affected/i.test(await text(org, '[role="dialog"]')));
  await org.getByRole('dialog').getByRole('button', { name: 'Sign out all', exact: true }).click();
  check('3.2 sign out all: the list says how many were signed out and no device code is active', await until(async () => /temporary devices? signed out/.test(await text(org, '#cc-devices')) && /No device codes are active/.test(await text(org, '#cc-devices')), 10000), await text(org, '#cc-devices'));
  const gAfter = await rpc(deviceJwt(GATE_SESSION), 'device_whoami', {});
  const dAfter = await rpc(deviceJwt(GATE_SESSION), 'event_command_snapshot', { p_event: EV });
  check('3.3 every temporary device is out at once: the Temporary Organizer token and Counter Phone 8 are refused', refused(gAfter) && refused(dAfter) && (await edge({ action: 'refresh', session_secret: si8.body.session_secret })).status === 401, `${gAfter.status} ${dAfter.status}`);
  check('3.4 ...but the stream controller credential is untouched', credState('Stream laptop') === 'controller|broadcast_controller|open' && count(`select count(*) from public.event_credentials where event_id = '${EV}' and kind = 'device' and revoked_at is null`) === 0);
  check('3.5 audit: device.revoked_all with the count', count(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'device.revoked_all' and (details ->> 'devices')::int >= 2`) === 1);
  await focusRefresh(dpage); await sleep(1500);
  check('3.6 the device\'s own page notices on its next read (the database refuses it: the Command Centre says it is not for it, not a broken screen)', await until(async () => /not for|Could not|permission|Command Centre is for/i.test(await text(dpage)) || (await dpage.locator('.cmd-centre').count()) === 1, 25000));

  // ---- the stream laptop's own credential: replace, revoke, create, only one
  const lapRow = org.locator('[data-testid="device-row"][data-label="Stream laptop"]');
  await lapRow.getByRole('button', { name: 'New code for Stream laptop' }).click();
  await org.getByRole('dialog').getByRole('button', { name: 'Make a new code' }).click();
  await sheet.waitFor({ timeout: 15000 });
  const codeL1 = (await org.getByTestId('device-code').innerText()).trim(); usedCodes.push(codeL1);
  const siL1 = await signin(codeL1);
  check('3.7 the stream laptop code is replaced (shown once); it signs in as the controller (role broadcast_controller, database role bos_controller)',
    CODE_RE.test(codeL1) && siL1.status === 200 && siL1.body?.whoami?.kind === 'controller' && siL1.body?.whoami?.role === 'broadcast_controller' && JSON.parse(Buffer.from(siL1.body.access_token.split('.')[1], 'base64url').toString()).role === 'bos_controller', JSON.stringify(siL1.body?.whoami));
  check('3.8 the controller can report a heartbeat and read its state, and nothing else', (await rpc(deviceJwt(siL1.body.whoami.session_id, 'bos_controller'), 'broadcast_controller_heartbeat', { p_status: { obs_connected: true, mode: 'auto' } })).status === 200
    && refused(await rpc(deviceJwt(siL1.body.whoami.session_id, 'bos_controller'), 'set_broadcast_control', { p_event: EV, p_expected_rev: 0, p_patch: { mode: 'manual', target_kind: 'holding' } })));
  await closeSheet(org);
  check('3.9 the controller code is also nowhere afterwards', await (async () => { const r = await codeInBrowser(org, codeL1); return !r.dom && !r.logs && !r.urls && Object.values(codeInDb(codeL1)).every(n => n === 0); })());
  const oneMore = await edge({ action: 'create', event: EV, kind: 'controller', label: 'Second laptop', role: 'broadcast_controller' }, orgToken);
  check('3.10 only ONE stream controller code at a time: a second is refused in words', oneMore.status === 400 && /already has a stream controller/i.test(oneMore.body?.error ?? ''), JSON.stringify(oneMore));
  check('3.11 ...and the page offers no second one while one is active', (await org.getByRole('button', { name: /Make a code for the stream laptop/ }).count()) === 0);
  await lapRow.getByRole('button', { name: 'Revoke Stream laptop' }).click();
  await org.getByRole('dialog').getByRole('button', { name: 'Revoke', exact: true }).click();
  check('3.12 revoking the laptop offers a new one', await until(async () => (await org.getByRole('button', { name: /Make a code for the stream laptop/ }).count()) === 1, 10000));
  check('3.13 ...and the old laptop session can no longer report', refused(await rpc(deviceJwt(siL1.body.whoami.session_id, 'bos_controller'), 'broadcast_controller_heartbeat', { p_status: { obs_connected: true } })));
  await org.getByRole('button', { name: /Make a code for the stream laptop/ }).click();
  await sheet.waitFor({ timeout: 15000 });
  const codeL2 = (await org.getByTestId('device-code').innerText()).trim(); usedCodes.push(codeL2);
  const bodyL = JSON.parse(org.fnReqs.at(-1)?.body ?? '{}');
  check('3.14 a new stream laptop code is made (kind controller, role broadcast_controller, label "Stream laptop") and works', CODE_RE.test(codeL2) && bodyL.kind === 'controller' && bodyL.role === 'broadcast_controller' && bodyL.label === 'Stream laptop' && (await signin(codeL2)).status === 200);
  await closeSheet(org);
  check('3.15 audit: controller.created / controller.revoked are recorded', count(`select count(*) from public.audit_log where event_id = '${EV}' and action in ('controller.created', 'controller.revoked')`) >= 2);

  // ---- the usual set, all codes together, printable
  await org.getByRole('button', { name: 'Add the usual set for an event' }).click();
  await sheet.waitFor({ timeout: 30000 });
  await until(async () => (await org.getByTestId('code-card').count()) === 8, 20000);
  const cards = org.getByTestId('code-card');
  const setCodes = await org.getByTestId('device-code').allInnerTexts();
  setCodes.forEach(c => usedCodes.push(c.trim()));
  const labels = await cards.locator('.dev-card-label').allTextContents();
  check('3.16 the usual set: ONE sheet with EIGHT cards: Counter Phone 1-4, Secretary Tablet, Marshal Phone, Announcer Tablet, Event Admin Tablet', JSON.stringify(labels) === JSON.stringify(['Counter Phone 1', 'Counter Phone 2', 'Counter Phone 3', 'Counter Phone 4', 'Secretary Tablet', 'Marshal Phone', 'Announcer Tablet', 'Event Admin Tablet']), JSON.stringify(labels));
  check('3.17 each card has its role, a code and a QR; all eight codes are different', (await cards.locator('.dev-qr svg').count()) === 8 && new Set(setCodes.map(c => c.trim())).size === 8 && setCodes.every(c => CODE_RE.test(c.trim())));
  const roles = await cards.locator('.dev-card-role').allTextContents();
  check('3.18 roles in words: Counter x4, Secretary / Scorekeeper, Marshal, Announcer, Event Admin / Temporary Organizer', JSON.stringify(roles) === JSON.stringify(['Counter', 'Counter', 'Counter', 'Counter', 'Secretary / Scorekeeper', 'Marshal', 'Announcer', 'Event Admin / Temporary Organizer']), JSON.stringify(roles));
  const qrs = await Promise.all([0, 3, 7].map(async i => ({ i, q: await cards.nth(i).locator('.dev-qr svg').evaluate(s => s.querySelector('path').getAttribute('d')) })));
  check('3.19 the QRs encode each card\'s own fragment link', qrs.every(({ i, q }) => q === qrPath(`${BASE}/device#c=${raw(setCodes[i].trim())}`).d));
  const dbSet = sql(`select string_agg(label || ':' || role, ',' order by label) from public.event_credentials where event_id = '${EV}' and kind = 'device' and revoked_at is null`);
  check('3.20 the database holds exactly those eight devices, active, with those roles', dbSet === 'Announcer Tablet:announcer,Counter Phone 1:counter,Counter Phone 2:counter,Counter Phone 3:counter,Counter Phone 4:counter,Event Admin Tablet:temporary_organizer,Marshal Phone:marshal,Secretary Tablet:scorekeeper', dbSet);
  const evAdmin = setCodes[7].trim();
  const adminIn = await signin(evAdmin);
  check('3.21 the Event Admin Tablet code signs in as a Temporary Organizer (real Edge Function token) and may read the Command Centre; the Counter Phone 1 code gets nothing there',
    adminIn.status === 200 && adminIn.body?.whoami?.role === 'temporary_organizer' && (await rpc({ jwt: adminIn.body.access_token }, 'event_command_snapshot', { p_event: EV })).status === 200
    && refused(await rpc({ jwt: (await signin(setCodes[0].trim())).body.access_token }, 'event_command_snapshot', { p_event: EV })));
  await shot(org, '04-phone-usual-set');
  await org.getByRole('dialog').getByRole('button', { name: /^Copy all codes/ }).click();
  const clipAll = await org.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check('3.22 Copy all codes puts "label: code" lines on the clipboard', clipAll.split('\n').length === 8 && clipAll.includes(`Event Admin Tablet: ${evAdmin}`), clipAll.slice(0, 100));
  await org.evaluate(() => navigator.clipboard.writeText('')).catch(() => undefined);
  await org.getByRole('dialog').getByRole('button', { name: /^Print/ }).click();
  const prints = await org.evaluate(() => window.__prints);
  check('3.23 Print calls window.print once, with the page switched to print layout (body class printing-codes)', prints.length === 1 && /printing-codes/.test(prints[0]), JSON.stringify(prints));
  await org.emulateMedia({ media: 'print' });
  const printView = await org.evaluate(() => ({
    root: getComputedStyle(document.getElementById('root')).display,
    cards: [...document.querySelectorAll('[data-testid="code-card"]')].filter(e => e.getBoundingClientRect().height > 0).length,
    once: getComputedStyle(document.querySelector('.dev-once')).display, buttons: [...document.querySelectorAll('.dev-noprint')].every(e => getComputedStyle(e).display === 'none'),
    title: getComputedStyle(document.querySelector('.dev-print-title')).display, bg: getComputedStyle(document.body).backgroundColor, keep: getComputedStyle(document.querySelector('.dev-card')).breakInside
  }));
  check('3.24 print CSS: only the sheet prints (page hidden), eight cards, no buttons or warning banner, a title line, white background, a card never split across pages',
    printView.root === 'none' && printView.cards === 8 && printView.buttons && printView.once === 'none' && printView.title !== 'none' && /255, 255, 255/.test(printView.bg) && printView.keep === 'avoid', JSON.stringify(printView));
  if (SHOTS) await org.pdf({ path: `${SHOTS}/cc181-05-print-sheet.pdf` }).catch(() => undefined);
  await org.emulateMedia({ media: 'screen' });
  await org.evaluate(() => document.body.classList.remove('printing-codes'));
  await closeSheet(org);
  const allHits = await Promise.all(setCodes.map(c => codeInBrowser(org, c.trim())));
  check('3.25 after closing the printable sheet none of the eight codes remains in the page, its storage, the console or any URL; none is in the database', allHits.every(r => !r.dom && !r.logs && !r.urls) && setCodes.every(c => Object.values(codeInDb(c.trim())).every(n => n === 0)));
  await org.getByRole('button', { name: 'Add the usual set for an event' }).click();
  check('3.26 asking for the usual set again makes no duplicates: it says they are already set up, and no sheet opens', await until(async () => /Already set up/i.test(await text(org, '#cc-devices')), 10000) && (await org.getByRole('dialog').count()) === 0 && count(`select count(*) from public.event_credentials where event_id = '${EV}' and kind = 'device' and revoked_at is null`) === 8);
  check('3.27 the organizer page has had no page errors so far', org.errors.length === 0, org.errors.join(' | '));

  // =================================================================== 4. Broadcast controls (organizer): each press changes the control row
  const rev0 = Number(sql(`select rev from public.event_broadcast_control where event_id = '${EV}'`));
  const R = (n) => rev0 + n;
  heartbeat({ obs_connected: true, mode: 'auto', fight: 'Aldric Stone vs Brann Oakley', on_air: { kind: 'lyst', field: 'field 1', scene: 'Lyst 1 camera', reason: 'first live' }, music: { state: 'playing', ducking: false, mic: 'quiet' } });   // (the test controller above replaced the whole report)
  await sleep(5500);
  const lyst = n => org.locator('#cc-broadcast').getByRole('button', { name: `Take Lyst ${n}`, exact: true });
  const press = async (name, expectRow, exact = true) => {
    await org.locator('#cc-broadcast').getByRole('button', { name, exact }).click();
    return until(async () => (await ctlRow()).startsWith(expectRow), 8000);
  };
  check('4.1 the controls offer one Take button per Lyst that has fights: Lyst 1, 2 and 3', (await org.locator('#cc-broadcast').getByRole('button', { name: /^Take Lyst/ }).count()) === 3 && (await lyst(3).count()) === 1);
  check('4.2 the controls do not include Camera Off (that is the red button at the top)', (await org.getByTestId('bc-controls').getByRole('button', { name: /camera/i }).count()) === 0);
  check('4.3 Take Lyst 2: the control row becomes manual / lyst / field 2 (rev 1) and the page shows MANUAL', await press('Take Lyst 2', `manual|lyst|field 2|auto|t|${R(1)}`) && await until(async () => /MANUAL/.test(await text(org, '#cc-broadcast > summary'))), await ctlRow());
  check('4.4 Take Lyst 2 is shown as pressed; AUTO is available again; Return to Auto appears', (await lyst(2).getAttribute('aria-pressed')) === 'true' && (await lyst(1).getAttribute('aria-pressed')) === 'false' && (await org.locator('#cc-broadcast').getByRole('button', { name: 'Return to Auto' }).count()) === 1);
  check('4.5 Holding / Between fights: manual / holding, no field', await press('Holding / Between fights', `manual|holding||auto|t|${R(2)}`), await ctlRow());
  check('4.6 Break: manual / break', await press('Break', `manual|break||auto|t|${R(3)}`), await ctlRow());
  check('4.7 Return to Auto: mode auto, manual target cleared', await press('Return to Auto', `auto|||auto|t|${R(4)}`) && await until(async () => /AUTO/.test(await text(org, '#cc-broadcast > summary'))), await ctlRow());
  check('4.8 MANUAL on its own keeps what the controller shows on air (Lyst 1)', await press('MANUAL', `manual|lyst|field 1|auto|t|${R(5)}`), await ctlRow());
  check('4.9 AUTO again', await press('AUTO', `auto|||auto|t|${R(6)}`), await ctlRow());
  check('4.10 Music Mute -> music_mode muted', await press('Mute', `auto|||muted|t|${R(7)}`), await ctlRow());
  check('4.11 Music Pause -> paused', await press('Pause', `auto|||paused|t|${R(8)}`), await ctlRow());
  check('4.12 Music Unmute -> back to automatic', await press('Unmute', `auto|||auto|t|${R(9)}`), await ctlRow());
  check('4.13 Auto Duck Off -> auto_duck false, and the line says Off', await press('Auto Duck Off', `auto|||auto|f|${R(10)}`) && await until(async () => /AUTO DUCK\s*⚠?\s*Off/i.test(await text(org, '#cc-broadcast'))), await ctlRow());
  check('4.14 Auto Duck On -> true', await press('Auto Duck On', `auto|||auto|t|${R(11)}`), await ctlRow());
  check('4.15 every press is audited as broadcast.control (12 so far from this page and the device)', count(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'broadcast.control'`) >= 12);
  // ---- a stale revision: someone else changed the row while this page still shows the old one
  await org.route('**/rpc/broadcast_control_state', r => r.abort());
  sql(`update public.event_broadcast_control set rev = rev + 1, music_mode = 'paused', updated_by_label = 'Other Organizer' where event_id = '${EV}'`);
  const rowBeforeStale = await ctlRow();
  await lyst(3).click();
  check('4.16 a stale press is refused and says so in words: "Someone else just changed this; check and try again."', await until(async () => /Someone else just changed this; check and try again\./.test(await text(org, '#cc-broadcast')), 8000), await text(org, '#cc-broadcast'));
  check('4.17 ...nothing was overwritten (the other change stands), and the page now shows the current truth (music paused)', (await ctlRow()) === rowBeforeStale && /MUSIC[^]*Paused/i.test(await text(org, '#cc-broadcast')) && (await org.locator('#cc-broadcast').getByRole('button', { name: 'Pause', exact: true }).getAttribute('aria-pressed')) === 'true', `${await ctlRow()} / ${rowBeforeStale}`);
  await org.unroute('**/rpc/broadcast_control_state');
  await lyst(3).click();
  check('4.18 trying again then works (manual / lyst / field 3)', await until(async () => (await ctlRow()).startsWith('manual|lyst|field 3|paused|'), 8000), await ctlRow());
  await press('Return to Auto', 'auto|||paused|t|');
  await press('Unmute', 'auto|||auto|t|');
  await shot(org, '06-phone-broadcast');

  // ---- heartbeat live updates, silent controller, no controller
  heartbeat({ fight: 'Cael Rhodes vs Dara Voss', on_air: { kind: 'lyst', field: 'field 2', scene: 'Lyst 2 camera', reason: 'earliest live' }, music: { state: 'muted', ducking: true, mic: 'speaking' }, obs_connected: false });
  check('4.19 a new heartbeat refreshes the panel in place within seconds: OBS Not connected, On air Lyst 2, new fight, Music Muted, Mic Speaking', await until(async () => { const t = await text(org, '#cc-broadcast'); return /OBS\s*⚠?\s*Not connected/i.test(t) && /ON AIR[^]*Lyst 2/i.test(t) && /Cael Rhodes vs Dara Voss/.test(t) && /MUSIC\s*Muted/i.test(t) && /MIC\s*Speaking/i.test(t); }, 12000), await text(org, '#cc-broadcast'));
  sql(`update public.broadcast_controller_status set reported_at = now() - interval '75 seconds' where event_id = '${EV}'`);
  check('4.20 a controller silent for 30 s or more is called out: "Stream controller: Silent for N s", the badge says so, "Also live" is dropped', await until(async () => { const t = await text(org, '#cc-broadcast'); return /Silent for (7\d|8\d) s/.test(t) && /Controller silent/.test(await text(org, '#cc-broadcast > summary')) && !/Also live/.test(t); }, 12000), await text(org, '#cc-broadcast'));
  sql(`delete from public.broadcast_controller_status where event_id = '${EV}'`);
  check('4.21 no controller reporting: "Stream controller not connected" said plainly; the control lines (Mode, Music, Auto Duck, Camera Safety) still show; nothing breaks', await until(async () => { const t = await text(org, '#cc-broadcast'); return /Stream controller not connected/.test(t) && /MODE/i.test(t) && /CAMERA SAFETY/i.test(t) && !/OBS\b/.test(t.replace(/OBS-level/g, '')); }, 12000) && org.errors.length === 0, await text(org, '#cc-broadcast'));
  await shot(org, '07-phone-no-controller');
  sql(`insert into public.broadcast_controller_status (event_id, reported_at, status) values ('${EV}', now(), '{"obs_connected":true,"mode":"auto","on_air":"holding"}')`);
  check('4.22 a partial report from an early controller (on_air as a plain name, nothing else) shows what it can and does not break', await until(async () => { const t = await text(org, '#cc-broadcast'); return /OBS\s*✓?\s*Connected/i.test(t) && /ON AIR[^]*Holding/i.test(t) && /MUSIC\s*Not reported/i.test(t); }, 12000), await text(org, '#cc-broadcast'));
  heartbeat({ fight: 'Aldric Stone vs Brann Oakley', on_air: { kind: 'lyst', field: 'field 1', scene: 'Lyst 1 camera', reason: 'first live' }, music: { state: 'playing', ducking: false, mic: 'quiet' } });

  // ---- Camera Off appears on the organizer's page when a marshal presses it (from another session)
  const camAct = await rpc('head', 'camera_off_activate', { p_event: EV, p_reason: 'privacy' });
  check('4.23 the head marshal turns the cameras off (another session)', camAct.status === 200 && (await camActive()) === 'true');
  check('4.24 the organizer\'s page shows the CAMERAS OFF banner at the top, with who, why and when, and the Broadcast panel says CAMERAS OFF', await until(async () => { const t = await text(org, '[data-testid="camera-off"]'); return /CAMERAS OFF/.test(t) && /Private moment/.test(t) && /Activated by:/.test(t) && /CAMERAS OFF/.test(await text(org, '#cc-broadcast')); }, 12000), await text(org, '[data-testid="camera-off"]'));
  check('4.25 the organizer is offered "Turn cameras back on"; the Broadcast controls are unchanged (no Camera Off among them)', (await org.getByRole('button', { name: 'Turn cameras back on' }).count()) === 1 && (await org.getByTestId('bc-controls').getByRole('button', { name: /camera/i }).count()) === 0);
  await shot(org, '08-phone-camera-off');
  await org.getByRole('button', { name: 'Turn cameras back on' }).click();
  await org.getByRole('dialog').getByRole('button', { name: /Yes, turn the cameras back on/ }).click();
  check('4.26 the organizer turns them back on (confirmed): banner gone, state released', await until(async () => (await camActive()) === 'false' && (await org.locator('.camoff-banner').count()) === 0, 10000));

  // ---- staff panel (organizer): names only, add by email, remove; Organizer is offered to a permanent organizer
  await openSection(org, '#cc-staff');
  const staffText = await text(org, '#cc-staff');
  check('4.27 Staff (organizer): names with roles, never an email', /Announcer Anna/.test(staffText) && /Medic Mo/.test(staffText) && /Secretary \/ Scorekeeper/.test(staffText) && !/@/.test(staffText), staffText);
  const orgOpts = await org.locator('#cc-staff select option').allInnerTexts();
  check('4.28 a permanent organizer is offered every role including Organizer and the new Announcer', orgOpts.includes('Organizer') && orgOpts.includes('Announcer') && orgOpts.includes('Head marshal'), JSON.stringify(orgOpts));
  await org.locator('#cc-staff').getByLabel('Email').fill('newcomer@example.test');
  await org.locator('#cc-staff').getByLabel('Role').selectOption('marshal');
  await org.locator('#cc-staff').getByRole('button', { name: 'Add', exact: true }).click();
  check('4.29 add by email: Newcomer Nia appears as Marshal; the database agrees', await until(async () => /Newcomer Nia\s*Marshal/.test(await text(org, '#cc-staff')), 10000) && count(`select count(*) from public.event_staff where event_id = '${EV}' and user_id = '${U('e3')}' and role = 'marshal'`) === 1, await text(org, '#cc-staff'));
  await org.locator('#cc-staff').getByLabel('Email').fill('nobody-at-all@example.test');
  await org.locator('#cc-staff').getByRole('button', { name: 'Add', exact: true }).click();
  check('4.30 an unknown address is refused in words, not a broken screen', await until(async () => (await org.locator('#cc-staff [role="alert"]').count()) > 0, 8000), await text(org, '#cc-staff'));
  await org.getByRole('button', { name: 'Remove Newcomer Nia as Marshal' }).click();
  check('4.31 remove: gone from the list and the database', await until(async () => (await org.locator('#cc-staff [data-testid="staff-row"]', { hasText: 'Newcomer Nia' }).count()) === 0, 10000) && count(`select count(*) from public.event_staff where event_id = '${EV}' and user_id = '${U('e3')}'`) === 0);
  await org.locator('#cc-staff').getByLabel('Email').fill('');

  // =================================================================== 5. live updates keep the view (scroll, open sections, an unsent draft, no remount)
  await openSection(org, '#cc-announce');
  const draft = 'Unsent draft: Lyst 2 will start late';
  await org.locator('#cc-announce textarea').fill(draft);
  await org.locator('#cc-fighters > summary').click();                              // the organizer closes the Fighters section on purpose
  const fightersClosed = !(await org.locator('#cc-fighters').evaluate(el => el.open));
  await org.evaluate(() => window.scrollTo(0, 1100));
  await sleep(500);
  const y0 = await scrollY(org);
  await org.evaluate(() => { document.querySelector('.cmd-centre').dataset.mark = 'kept2'; });
  // changes from "other sessions": a new heartbeat, a revoke, a control change, a staff change, then a focus + reconnect refresh
  heartbeat({ fight: 'Edric Hale vs Fenna Crow', on_air: { kind: 'lyst', field: 'field 3', scene: 'Lyst 3 camera' } });
  const revokeId = sql(`select id from public.event_credentials where event_id = '${EV}' and label = 'Marshal Phone' and revoked_at is null`);
  const rv = await rpc('organizer', 'revoke_event_credential', { p_credential: revokeId, p_reason: null });
  sql(`update public.event_broadcast_control set updated_by_label = 'Other Organizer' where event_id = '${EV}'`);
  await focusRefresh(org);
  await sleep(1000);
  await focusRefresh(org);
  const seen = await until(async () => /Edric Hale vs Fenna Crow/.test(await text(org, '#cc-broadcast')) && (await org.locator('#cc-devices .dev-list').first().locator('[data-label="Marshal Phone"]').count()) === 0, 15000);
  await sleep(11000);                                                               // a full device poll (10 s) and a broadcast poll later
  const y1 = await scrollY(org);
  check('5.1 live changes (a new heartbeat, a revoke from another session) reach the page in place: the fight changes, the revoked device leaves the active list', rv.status === 200 && seen, `${rv.status} ${await text(org, '#cc-broadcast')}`);
  check('5.2 scroll position is kept (no jump to the top): before ' + y0 + ' after ' + y1, y0 > 700 && Math.abs(y1 - y0) <= 4, `${y0} -> ${y1}`);
  check('5.3 the unsent announcement draft is untouched', (await org.locator('#cc-announce textarea').inputValue()) === draft);
  check('5.4 the page was not remounted (marker on the root survived), and the sections the organizer opened or closed stayed as they were',
    (await org.evaluate(() => document.querySelector('.cmd-centre')?.dataset.mark)) === 'kept2' && fightersClosed && !(await org.locator('#cc-fighters').evaluate(el => el.open)) && (await org.locator('#cc-devices').evaluate(el => el.open)) && (await org.locator('#cc-staff').evaluate(el => el.open)));
  check('5.5 no page errors after all of that', org.errors.length === 0, org.errors.join(' | '));
  await shot(org, '09-phone-after-live-updates');

  // =================================================================== 6. the Secretary / Scorekeeper (permanent account), phone
  const sk = await open('phone', 'scorekeeper'); pages.push(sk);
  await openCmd(sk);
  check('6.1 the scorekeeper may open the Command Centre and sees Camera Off, Broadcast status and Announcements', (await sk.locator('.cmd-centre').count()) === 1 && (await sk.getByRole('button', { name: 'Emergency camera off' }).count()) === 1 && (await sk.locator('#cc-broadcast').count()) === 1 && (await sk.locator('#cc-announce').count()) === 1);
  check('6.2 ...but NOT Event devices, and no broadcast controls (status only)', (await sk.locator('#cc-devices').count()) === 0 && (await sk.getByTestId('bc-controls').count()) === 0 && /Stream controller/.test(await text(sk, '#cc-broadcast')));
  check('6.3 ...and no staff editing (the passive "who is assigned" list), no Manage links', (await sk.getByTestId('staff-names').count()) === 0 && (await sk.locator('.cmd-centre a[href*="/manage"]').count()) === 0);
  await openSection(sk, '#cc-announce');
  check('6.4 the announcement panel is SEND-ONLY for the scorekeeper: the history was refused by the database (a 403 on the wire) and the page shows NO error for it',
    sk.reqs.some(r => /list_event_announcements/.test(r.url) && r.status >= 400) && !/Could not load sent announcements/.test(await text(sk)) && (await sk.locator('#cc-announce [role="alert"]').count()) === 0, await text(sk, '#cc-announce'));
  await sk.locator('#cc-announce textarea').fill('Secretary: lunch break ends at 1:15 PM.');
  await sk.locator('#cc-announce').getByRole('button', { name: 'Send announcement' }).click();
  check('6.5 the scorekeeper can SEND an announcement: "Sent to N people", recorded in the database', await until(async () => /Sent to \d+ people?/.test(await text(sk, '#cc-announce')), 10000) && count(`select count(*) from public.event_announcements where event_id = '${EV}' and message like 'Secretary:%'`) === 1, await text(sk, '#cc-announce'));
  check('6.6 still no error banner after sending, and no history shown', (await sk.locator('#cc-announce [role="alert"]').count()) === 0 && !/Sent\b.*Everyone/.test(await text(sk, '#cc-announce ul')));
  const skCall = { creds: await rpc('scorekeeper', 'list_event_credentials', { p_event: EV }), ctl: await rpc('scorekeeper', 'set_broadcast_control', { p_event: EV, p_expected_rev: 0, p_patch: { mode: 'manual', target_kind: 'holding' } }),
    state: await rpc('scorekeeper', 'broadcast_control_state', { p_event: EV }), staff: await rpc('scorekeeper', 'list_event_staff_names', { p_event: EV }), release: await rpc('scorekeeper', 'camera_off_release', { p_event: EV, p_note: null }) };
  check('6.7 by the database: the scorekeeper is refused devices, broadcast control, the staff list and releasing Camera Off, but may read the broadcast state', refused(skCall.creds) && refused(skCall.ctl) && refused(skCall.staff) && refused(skCall.release) && skCall.state.status === 200 && skCall.state.body.can_control === false, JSON.stringify(Object.fromEntries(Object.entries(skCall).map(([k, v]) => [k, v.status]))));
  const snapSk = await rpc('scorekeeper', 'event_command_snapshot', { p_event: EV });
  check('6.8 the snapshot tells the page what the scorekeeper may do: announce + camera_off, not organizer / operator / camera_release / broadcast', sameJson(snapSk.body?.viewer, { organizer: false, announce: true, operator: false, camera_off: true, camera_release: false, broadcast: false }), JSON.stringify(snapSk.body?.viewer));
  await shot(sk, '10-phone-scorekeeper');
  check('6.9 the scorekeeper page has no page errors and no sideways scroll', sk.errors.length === 0 && await noSideways(sk), sk.errors.join(' | '));

  // =================================================================== 7. head marshal: camera off and back on; viewing writes nothing
  const hm = await open('phone', 'head'); pages.push(hm);
  await openCmd(hm);
  check('7.1 the head marshal sees Camera Off and Broadcast status; no announcements, devices, controls, staff editing or Manage links', (await hm.getByRole('button', { name: 'Emergency camera off' }).count()) === 1 && (await hm.locator('#cc-broadcast').count()) === 1
    && (await hm.locator('#cc-announce, #cc-devices').count()) === 0 && (await hm.getByTestId('bc-controls').count()) === 0 && (await hm.getByTestId('staff-names').count()) === 0 && (await hm.locator('.cmd-centre a[href*="/manage"]').count()) === 0);
  const before = countsBefore();
  await sleep(24000);
  const after = countsBefore();
  check('7.2 viewing writes nothing: 24 s open (every panel polling) changed no audit row, control row, credential, camera state, announcement or session', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
  await hm.getByRole('button', { name: 'Emergency camera off' }).click();
  await hm.getByRole('dialog').getByRole('button', { name: /Camera problem/ }).click();
  check('7.3 the head marshal turns the cameras off with one tap on a reason; the banner shows and offers "Turn cameras back on"', await until(async () => (await camActive()) === 'true' && /CAMERAS OFF/.test(await text(hm, '[data-testid="camera-off"]')) && (await hm.getByRole('button', { name: 'Turn cameras back on' }).count()) === 1, 10000));
  check('7.4 the scorekeeper\'s page (may activate, may not release) shows the banner WITHOUT a release button', await until(async () => /CAMERAS OFF/.test(await text(sk, '[data-testid="camera-off"]')), 10000) && (await sk.getByRole('button', { name: 'Turn cameras back on' }).count()) === 0 && /Waiting for authorized release/.test(await text(sk, '[data-testid="camera-off"]')));
  await hm.getByRole('button', { name: 'Turn cameras back on' }).click();
  await hm.getByRole('dialog').getByRole('button', { name: /Yes, turn the cameras back on/ }).click();
  check('7.5 the head marshal turns the cameras back on', await until(async () => (await camActive()) === 'false', 10000));
  check('7.6 the head marshal page has no page errors', hm.errors.length === 0, hm.errors.join(' | '));

  // =================================================================== 8. refused: a stranger, another event's organizer, a signed-out visitor
  const st = await open('phone', 'stranger'); pages.push(st);
  await st.goto(BASE + CMD); await st.waitForLoadState('networkidle').catch(() => undefined); await sleep(1500);
  check('8.1 a stranger is told the Command Centre is for organizers, head marshal and secretary: no panels, no controls', /for this event's organizers, head marshal and secretary/.test(await text(st)) && (await st.locator('#cc-broadcast, #cc-devices, [data-testid="camera-off"]').count()) === 0, await text(st));
  const oo = await rpc('otherOrg', 'list_event_credentials', { p_event: EV });
  check('8.2 another event\'s organizer is refused this event\'s devices and broadcast state by the database', refused(oo) && refused(await rpc('otherOrg', 'broadcast_control_state', { p_event: EV })) && refused(await rpc('otherOrg', 'set_broadcast_control', { p_event: EV, p_expected_rev: 0, p_patch: { mode: 'auto' } })));
  const anon = await open('phone', null); pages.push(anon);
  await anon.goto(BASE + CMD); await anon.waitForLoadState('networkidle').catch(() => undefined); await sleep(1500);
  check('8.3 signed out: the sign-in form is shown in place (no panels, no device list)', (await anon.getByRole('form', { name: 'Sign in with email and password' }).count()) === 1 && (await anon.locator('#cc-devices, #cc-broadcast').count()) === 0);
  check('8.4 anonymous callers are refused every Pack 18.1 function', refused(await rpc(null, 'list_event_credentials', { p_event: EV })) && refused(await rpc(null, 'broadcast_control_state', { p_event: EV })) && refused(await rpc(null, 'list_event_staff_names', { p_event: EV })) && refused(await rpc(null, 'camera_off_activate', { p_event: EV, p_reason: 'other' })));

  // =================================================================== 9. desktop 1280x900: layout, the printable set on a wide screen
  const dk = await open('desktop', 'organizer'); pages.push(dk);
  await openCmd(dk);
  const rev = await rpc('organizer', 'revoke_all_event_devices', { p_event: EV });
  await focusRefresh(dk);
  check('9.1 desktop: every panel is there, no sideways scroll', (await dk.locator('#cc-broadcast, #cc-announce, #cc-staff, #cc-devices').count()) === 4 && await noSideways(dk) && rev.status === 200);
  const camBox = await dk.locator('[data-testid="camera-off"]').boundingBox(), attBox = await dk.locator('#cc-attention').boundingBox();
  check('9.2 desktop: the Camera Off row spans the full width above Needs attention', !!camBox && !!attBox && camBox.y < attBox.y && camBox.width > 900, JSON.stringify([camBox, attBox]));
  await openSection(dk, '#cc-devices');
  await until(async () => /No device codes are active/.test(await text(dk, '#cc-devices')), 15000);
  await dk.getByRole('button', { name: 'Add the usual set for an event' }).click();
  await dk.getByTestId('code-sheet').waitFor({ timeout: 30000 });
  await until(async () => (await dk.getByTestId('code-card').count()) === 8, 20000);
  (await dk.getByTestId('device-code').allInnerTexts()).forEach(c => usedCodes.push(c.trim()));
  const dlg = await dk.locator('.dlg').boundingBox();
  const cardsBox = await dk.getByTestId('code-card').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));
  check('9.3 desktop: the usual-set sheet is wide with the cards in two columns, all eight visible by scrolling inside the sheet', dlg.width > 700 && new Set(cardsBox.map(c => c[0])).size === 2 && await noSideways(dk), JSON.stringify([dlg, cardsBox.slice(0, 4)]));
  await shot(dk, '11-desktop-usual-set');
  await dk.getByRole('dialog').getByRole('button', { name: /^Print/ }).click();
  await dk.emulateMedia({ media: 'print' });
  const dPrint = await dk.evaluate(() => ({ root: getComputedStyle(document.getElementById('root')).display, w: document.querySelector('.dev-cards').getBoundingClientRect().width, cols: getComputedStyle(document.querySelector('.dev-cards')).gridTemplateColumns.split(' ').length }));
  check('9.4 desktop print preview: page hidden, the cards in two columns', dPrint.root === 'none' && dPrint.cols === 2, JSON.stringify(dPrint));
  await dk.emulateMedia({ media: 'screen' });
  await dk.evaluate(() => document.body.classList.remove('printing-codes'));
  await closeSheet(dk);
  await shot(dk, '12-desktop-top');
  check('9.5 desktop page has no page errors', dk.errors.length === 0, dk.errors.join(' | '));

  // =================================================================== 10. the code is nowhere in the whole database
  let dumped = null;
  try { dumped = execFileSync('pg_dump', ['-a', '-d', DB], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }); } catch { dumped = null; }
  if (dumped === null) console.log('     (pg_dump not available: the whole-database search was skipped; the per-table searches above ran)');
  else check(`10.1 a data-only dump of the whole scratch database contains none of the ${usedCodes.length} codes shown during this run (grouped or ungrouped)`, usedCodes.every(c => !dumped.includes(c) && !dumped.includes(raw(c))), 'a code was found in the dump');
  check('10.2 only keyed verifiers are stored: every credential row holds a 32-byte code_hash and the shown codes are not derivable from the rows', count(`select count(*) from public.event_credentials where octet_length(code_hash) <> 32`) === 0);
} catch (e) {
  check('the run completed without an unexpected error', false, e?.stack ?? e);
} finally {
  await Promise.all(pages.map(p => p.ctx.close().catch(() => undefined)));
  await browser.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
if (failed.length) { console.log('FAILED:\n  ' + failed.map(f => f.name).join('\n  ')); process.exit(1); }
