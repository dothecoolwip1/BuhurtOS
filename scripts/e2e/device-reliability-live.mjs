// Pack 18.1, RELIABILITY of a temporary event device over a long event, against the REAL local stack (Postgres from every migration + PostgREST + the local API
// front serving the REAL device-session handler + the built app in real Chromium). The session token is shortened to 75 s (DEVICE_TOKEN_TTL_S) so a few minutes of
// wall clock stand in for hours: many token refreshes, a signal outage LONGER than a token, the device coming back by itself, a device revoked while it was
// offline, a code typed again after a restart, and replacing a device. LOCAL EVIDENCE ONLY. Run through scripts/e2e/device-reliability-live.sh.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const E1 = '00000000-0000-0000-0000-00000000ed01';
const ORG = jwt('00000000-0000-0000-0000-0000000000a2', 'u2@example.test');
const SLUG = 'test-stuff-test';
const TTL = Number(process.env.DEVICE_TOKEN_TTL_S) || 75;

sql(`delete from public.event_sessions; delete from public.event_credentials; delete from public.device_code_attempts;`);
async function api(body, token) {
  const r = await fetch(`${API}/functions/v1/device-session`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'local-publishable-key', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const calls = [];   // device-session calls seen by the browser: { who, action }
async function open(label, stored = null) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|youtube(-nocookie)?\.com|twitch\.tv|vimeo\.com/, r => r.abort('failed'));
  if (stored) await ctx.addInitScript(([k, v]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); } catch { /* blocked */ } }, ['bos-device-session', stored]);
  ctx.on('request', r => { if (r.url().includes('/functions/v1/device-session')) { try { calls.push({ who: label, action: JSON.parse(r.postData() ?? '{}').action }); } catch { /* not JSON */ } } });
  const page = await ctx.newPage();
  page.ctx = ctx; page.label = label; page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  return page;
}
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const until = async (fn, timeout = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(250); } return false; };
const path = (page) => new URL(page.url()).pathname;
const stored = (page) => page.evaluate(() => { try { return localStorage.getItem('bos-device-session'); } catch { return null; } });
const tokenOf = async (page) => { try { return JSON.parse(await stored(page)).access_token; } catch { return null; } };
const refreshCount = (who) => calls.filter(c => c.who === who && c.action === 'refresh').length;
async function signIn(page, code) {
  await page.goto(BASE + '/device');
  await page.waitForSelector('#ds-code', { timeout: 30000 });
  await page.fill('#ds-code', code);
  await page.getByRole('button', { name: 'Sign in this device' }).click();
  await page.waitForURL(u => !u.pathname.endsWith('/device'), { timeout: 30000 });
}
const rpcAsToken = async (token, name, args = {}) => {
  const r = await fetch(`${API}/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: `Bearer ${token}` }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

try {
  check('0. the scenario shortens the device token to ' + TTL + ' s (a few minutes stand in for hours of an event)', TTL >= 70 && TTL <= 120, `ttl=${TTL}`);
  const mk = async (label, role) => { const r = await api({ action: 'create', event: E1, kind: 'device', label, role }, ORG); return r.body; };
  const marshal = await mk('Marshal Phone', 'marshal');
  const counter = await mk('Counter Phone 1', 'counter');
  const secretary = await mk('Secretary Tablet', 'scorekeeper');
  check('1. three device codes made (Marshal, Counter, Secretary)', !!(marshal?.code && counter?.code && secretary?.code), JSON.stringify([marshal, counter, secretary]).slice(0, 200));

  // ---- 1. a device that works for a long time: many quiet refreshes, no sign-out, still authorised
  const m = await open('marshal');
  await signIn(m, marshal.code);
  const landing = path(m);
  check('2. the marshal phone is signed in and on its own screen', /\/events\/test-stuff-test/.test(landing), landing);
  const t0 = await tokenOf(m);
  const startRefreshes = refreshCount('marshal');
  await sleep(52000);
  const t1 = await tokenOf(m);
  check('3. while it sits open the device quietly refreshes its token by itself (at least two refreshes in under a minute) and stays signed in', refreshCount('marshal') - startRefreshes >= 2 && t1 && t1 !== t0 && !/\/device$/.test(path(m)), `${refreshCount('marshal') - startRefreshes} refreshes, same token: ${t0 === t1}, at ${path(m)}`);
  const who = await rpcAsToken(t1, 'device_whoami');
  check('4. the refreshed token is accepted by the database (device_whoami answers with this device, not an error)', who.status === 200 && who.body?.label === 'Marshal Phone', JSON.stringify(who));

  // ---- 2. the signal drops for LONGER than a token lives, then comes back
  const before = await tokenOf(m);
  await m.ctx.setOffline(true);
  await sleep((TTL + 30) * 1000);
  check('5. a signal outage longer than a token: the device stays on its screen and does NOT sign itself out', !/\/device$/.test(path(m)) && (await stored(m)) !== null, `${path(m)}`);
  await m.ctx.setOffline(false);
  const back = await until(async () => { const t = await tokenOf(m); return t && t !== before; }, 40000);
  check('6. when the signal returns the device gets a fresh token by itself (no code typed, no reload)', back, 'token unchanged after reconnect');
  const after = await tokenOf(m);
  const who2 = after ? await rpcAsToken(after, 'device_whoami') : { status: 0 };
  check('7. ... and that token works at the database; the device is still itself', who2.status === 200 && who2.body?.label === 'Marshal Phone' && !/\/device$/.test(path(m)), JSON.stringify(who2).slice(0, 200));
  const screenOk = await until(async () => !/Could not load|went wrong|Something went wrong/i.test(await text(m)), 15000);
  check('8. ... and its screen carries on without an error page', screenOk && m.errors.length === 0, `${await text(m)} ${m.errors.join(' | ')}`.slice(0, 300));

  // ---- 3. browser restart: the same stored session in a brand-new browser context
  const keep = await stored(m);
  await m.ctx.close();
  const m2 = await open('marshal-restart', keep);
  await m2.goto(BASE + `/events/${SLUG}`);
  const restarted = await until(async () => (await m2.locator('[data-testid="device-bar"]').count()) === 1, 30000);
  check('9. after the browser is closed and reopened the device is still signed in on its screen (no code typed)', restarted && !/\/device$/.test(path(m2)), path(m2));

  // ---- 4. a device revoked while it was offline learns it the moment the signal returns
  const c = await open('counter');
  await signIn(c, counter.code);
  await c.ctx.setOffline(true);
  const rv = await fetch(`${API}/rest/v1/rpc/revoke_event_credential`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: `Bearer ${ORG}` }, body: JSON.stringify({ p_credential: counter.credential.id, p_reason: 'e2e' }) });
  check('10. the organizer revokes the counter phone while it has no signal', rv.status === 200, String(rv.status));
  await sleep(3000);
  check('11. offline, the device cannot know yet and stays where it is (nothing crashes)', !/\/device$/.test(path(c)));
  await c.ctx.setOffline(false);
  const ended = await until(async () => /\/device$/.test(path(c)) && /access has ended/i.test(await text(c)), 45000);
  check('12. the signal returns: the revoked device signs itself out and says its access has ended', ended, `${path(c)} ${await text(c)}`.slice(0, 200));

  // ---- 5. restarting a device: typing the same code again works any number of times
  const s1 = await open('secretary-a');
  await signIn(s1, secretary.code);
  await s1.evaluate(() => { try { localStorage.clear(); } catch { /* blocked */ } });   // storage cleared (a phone reset, a different browser)
  const s2 = await open('secretary-b');
  await signIn(s2, secretary.code);
  check('13. a code can simply be typed again after a restart or a cleared browser: the device signs in again (the older session is replaced)', !/\/device$/.test(path(s2)), path(s2));
  const stillOne = sql(`select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.label = 'Secretary Tablet' and s.ended_at is null`);
  check('14. exactly one live session per code (the new one), so two phones can never both pass as one station', stillOne === '1', stillOne);

  // ---- 6. replace: a new code for the same station; the old code and its session die, the new one works at once
  const oldTok = await tokenOf(s2);   // the old device's token, kept to prove the DATABASE refuses it (the device itself also signs out within one check)
  const rep = await api({ action: 'replace', credential: secretary.credential.id }, ORG);
  check('15. the organizer replaces the Secretary Tablet: a new code is issued', rep.status === 200 && rep.body?.code && rep.body.code !== secretary.code, JSON.stringify(rep).slice(0, 160));
  const oldGone = await until(async () => oldTok && (await rpcAsToken(oldTok, 'device_whoami')).status >= 400, 20000);
  check('16. the old device is refused at the database right away (even with its still-unexpired token)', !!oldGone);
  check('16b. ... and the old device screen signs itself out within one check', await until(async () => /\/device$/.test(path(s2)), 45000), path(s2));
  const s3 = await open('secretary-new');
  await signIn(s3, rep.body.code);
  check('17. the new code signs the station in at once', !/\/device$/.test(path(s3)), path(s3));
  const olds = await open('secretary-oldcode');
  await olds.goto(BASE + '/device'); await olds.waitForSelector('#ds-code');
  await olds.fill('#ds-code', secretary.code); await olds.getByRole('button', { name: 'Sign in this device' }).click();
  check('18. the OLD code no longer works', await until(async () => /did not work/i.test(await text(olds)), 15000));

  // ---- 7. sign everything out, then create another device quickly (the event-day recovery path needs no tools)
  const all = await fetch(`${API}/rest/v1/rpc/revoke_all_event_devices`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: `Bearer ${ORG}` }, body: JSON.stringify({ p_event: E1 }) });
  check('19. "sign out all temporary devices" works', all.status === 200, String(all.status));
  const ended3 = await until(async () => /\/device$/.test(path(s3)), 45000);
  check('20. the signed-in devices all sign out by themselves within one check', ended3, path(s3));
  const fresh = await mk('Counter Phone 2', 'counter');
  const f = await open('counter-2');
  await signIn(f, fresh.code);
  check('21. a new device can be created and signed in right after, no developer tools involved', !/\/device$/.test(path(f)), path(f));

  const errs = [m, m2, c, s1, s2, s3, f].flatMap(p => p.errors);
  check('22. no page errors anywhere in the run', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  check('scenario ran to the end', false, e.stack ?? e);
}
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
console.log(failed ? 'DEVICE RELIABILITY LIVE FAILED' : 'DEVICE RELIABILITY LIVE PASSED');
process.exit(failed ? 1 : 0);
