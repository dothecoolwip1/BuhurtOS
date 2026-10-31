// Site sweep: every tournament-day person opens every screen they would use, each in their OWN browser (no shared cookies or storage), at their
// own viewport, against a REAL local stack (Postgres from every migration + scripts/e2e/fixtures/sweep.sql, PostgREST, the real built app).
// Run it through scripts/e2e/site-sweep.sh. LOCAL ONLY; never pointed at a hosted project. It records, per screen:
//   console errors and page errors, failed or 5xx requests, requests slower than 3 s, sideways scroll, tap targets under 44 px on phones,
//   private data (an emergency contact, a medical note, a private email) anywhere in the page or in any response the browser received,
//   whether a staff screen refused a person without the role, and how many bytes of script the first screen downloaded.
// Output: PASS/FAIL lines, and <shots>/sweep.json with every measurement. Screenshots for every screen in <shots>/.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); return !!ok; };
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const session = (id, email) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const A = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const U = (n) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`;
const EV = '/events/test-stuff-test';
const ALDRIC = '/fighters/00000000-0000-0000-0000-00000000f101';
const PRIVATE = ['SWEEP-PRIVATE-MEDICAL', '403-555-0199', 'sweep-private@example.test', 'Sweep Emergency Person'];
const VP = { phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }, desk: { viewport: { width: 1440, height: 900 } } };
// A refusal is any of the app's own "you do not have this role" wordings; the check below also requires that no fight list was drawn.
const REFUSED = /Only this event|officials can|organizers|not (a member of|on) (the )?(event )?staff|need(s)? (an? )?(event )?role|not allowed|only for|is for|sign in|cannot open|No access|Not found|don.t have access/i;

// Who plays, in which browser, and what they open. `canSeePrivate` people may legitimately see the private fixture data on the listed screens.
const CAST = [
  { key: 'spectator', who: null, vp: 'phone', pages: ['/', '/events', '/events?test=1', '/calendar', '/fighters', '/teams', '/rankings', '/rules', '/formats', '/organizations', '/privacy', EV, EV + '/live', EV + '/results', ALDRIC, '/teams/test-sweep-wardens', '/sign-in', '/this-page-does-not-exist'] },
  { key: 'spectator-desk', who: null, vp: 'desk', pages: ['/', '/events', EV, ALDRIC] },
  { key: 'venue-screen', who: null, vp: 'desk', pages: [EV + '/arena', '/broadcast/test-stuff-test'] },
  { key: 'stranger', who: [A(7), 'u7@example.test'], vp: 'phone', staffProbe: true, pages: ['/account', '/my-events', EV + '/control', EV + '/checkin', EV + '/field/Field%201', EV + '/discipline', '/platform', EV + '/announcer'] },
  { key: 'fighter', who: [U(1), 'fighter1@example.test'], vp: 'phone', pages: ['/my-events', '/account', ALDRIC, ALDRIC + '/edit', EV + '/register', EV] },
  { key: 'captain', who: [U(2), 'fighter2@example.test'], vp: 'phone', pages: ['/team-manager', '/teams/test-sweep-wardens', '/teams/test-sweep-wardens/edit', '/my-events'] },
  { key: 'organizer', who: [A(2), 'u2@example.test'], vp: 'desk', canSeePrivate: true, pages: [EV + '/control', '/events/new', EV + '/checkin', EV + '/field/Field%201', EV + '/discipline', EV + '/results'] },
  { key: 'organizer-phone', who: [A(2), 'u2@example.test'], vp: 'phone', canSeePrivate: true, pages: [EV + '/control', EV + '/checkin', EV + '/field/Field%201'] },
  { key: 'secretary', who: [A(4), 'u4@example.test'], vp: 'desk', pages: [EV + '/control', EV + '/field/Field%201', EV + '/field/Field%202'] },
  { key: 'head-marshal', who: [A(3), 'u3@example.test'], vp: 'tablet', pages: [EV + '/control', EV + '/field/Field%201', EV + '/discipline'] },
  { key: 'medic', who: [A(5), 'u5@example.test'], vp: 'phone', canSeePrivate: true, pages: [EV + '/control', EV + '/checkin'] },
  { key: 'announcer', who: [A(6), 'u6@example.test'], vp: 'desk', pages: [EV + '/announcer', EV + '/arena'] },
  { key: 'owner', who: [A(1), 'u1@example.test'], vp: 'desk', canSeePrivate: true, pages: ['/platform', '/platform/events', '/platform/fighters', '/platform/analytics', '/platform/bugs', '/platform/devices'] }
];

const MEASURE = () => {
  const MIN = 44;
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const target = (e) => (e.matches('input[type=checkbox],input[type=radio]') && (e.closest('label') || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)))) || e;
  const seen = new Set(); const small = []; const clipped = [];
  for (const e of document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab]')) {
    const t = target(e); if (seen.has(t) || !visible(t) || t.disabled) continue; seen.add(t);
    const r = t.getBoundingClientRect();
    // inline links inside running text are exempt (WCAG 2.5.8 exception); everything else is a control
    const inline = t.tagName === 'A' && getComputedStyle(t).display === 'inline' && t.closest('p,li,td');
    const text = (t.getAttribute('aria-label') || t.innerText || t.value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (r.height < MIN && !inline) small.push({ text, tag: t.tagName.toLowerCase(), cls: String(t.className).slice(0, 40), parent: String(t.parentElement?.className ?? '').slice(0, 40), h: Math.round(r.height) });
    if (r.right > innerWidth + 0.5) clipped.push({ text, tag: t.tagName.toLowerCase() });
  }
  const se = document.scrollingElement;
  return { scrollWidth: se.scrollWidth, innerWidth, overflow: se.scrollWidth > innerWidth + 1, small, clipped, controls: seen.size, text: document.body.innerText };
};

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const report = { base: BASE, startedUtc: new Date().toISOString(), screens: [] };
try {
  for (const role of CAST) {
    const ctx = await browser.newContext({ ...VP[role.vp], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
    if (role.who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(...role.who)]);
    const page = await ctx.newPage();
    let net = [];
    page.on('console', (m) => { if (m.type() === 'error') net.push({ kind: 'console', text: m.text().slice(0, 300) }); });
    page.on('pageerror', (e) => net.push({ kind: 'pageerror', text: String(e).slice(0, 300) }));
    // ERR_ABORTED is a request the app cancelled itself (the screen changed); a local stack has no Realtime, so the app polls (recorded, not failed)
    page.on('requestfailed', (r) => { if (!/favicon|fonts\.g/.test(r.url()) && r.failure()?.errorText !== 'net::ERR_ABORTED') net.push({ kind: 'failed', url: r.url().replace(/\?.*/, ''), text: r.failure()?.errorText }); });
    page.on('response', async (r) => {
      const url = r.url(); const t = r.request().timing(); const ms = t && t.responseEnd > 0 ? Math.round(t.responseEnd) : null;
      const rec = { kind: 'response', url: url.replace(/\?.*/, ''), status: r.status(), ms, type: r.request().resourceType(), bytes: 0 };
      try { const body = await r.body(); rec.bytes = body.length; if (!role.canSeePrivate && /\/rest\/v1\//.test(url)) { const s = body.toString(); const hit = PRIVATE.find((p) => s.includes(p)); if (hit) rec.privateLeak = hit; } } catch { /* body gone after navigation */ }
      net.push(rec);
    });
    for (const path of role.pages) {
      net = [];
      const started = Date.now();
      let navError = null;
      try { await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) { navError = String(e).slice(0, 200); }
      await page.waitForTimeout(600);
      const loadMs = Date.now() - started;
      const m = await page.evaluate(MEASURE).catch((e) => ({ error: String(e) }));
      const name = `${role.key}${path.replace(/[^a-z0-9]+/gi, '-')}`.replace(/-+$/, '').slice(0, 90);
      await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }).catch(() => {});
      const responses = net.filter((x) => x.kind === 'response');
      const scriptBytes = responses.filter((x) => x.type === 'script').reduce((s, x) => s + x.bytes, 0);
      const localOnly = (x) => /realtime\/v1\/websocket/.test(x.text ?? '');
      // a refused staff screen gets 403s from the database by design: that is the refusal, not an error
      const expected4xx = (x) => role.staffProbe && /status of 40[13]/.test(x.text ?? '');
      const errors = net.filter((x) => (x.kind === 'console' || x.kind === 'pageerror') && !localOnly(x) && !expected4xx(x));
      const http4xx = responses.filter((x) => x.status >= 400 && x.status < 500).map((x) => `${x.status} ${x.url.replace(/^https?:\/\/[^/]+/, '')}`);
      const failed = net.filter((x) => x.kind === 'failed' || (x.kind === 'response' && x.status >= 500));
      const slow = responses.filter((x) => x.ms != null && x.ms > 3000);
      const leaks = [...new Set([...responses.filter((x) => x.privateLeak).map((x) => `${x.privateLeak} in ${x.url.replace(BASE, '')}`),
        ...(role.canSeePrivate ? [] : PRIVATE.filter((p) => (m.text ?? '').includes(p)).map((p) => `${p} on the screen`))])];
      const rec = { role: role.key, viewport: role.vp, path, loadMs, navError, scriptKB: Math.round(scriptBytes / 1024), requests: responses.length,
        apiRequests: responses.filter((x) => /\/rest\/v1\//.test(x.url)).length, overflow: m.overflow, scrollWidth: m.scrollWidth, small: role.vp === 'phone' ? m.small : [], clipped: m.clipped,
        errors, http4xx, realtimeUnavailable: net.some(localOnly), failed, slow, leaks, heading: (m.text ?? '').split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 160) };
      // a person without the role: the staff screen must refuse, and must not draw the fight list
      if (role.staffProbe && /\/(control|checkin|field|discipline)|^\/platform/.test(path)) {   // the announcer screen is public by design (official data only)
        rec.refused = REFUSED.test(m.text ?? '') && !/Aldric Stone vs|Brann Oakley vs/.test(m.text ?? '');
        check(`[${role.key}] ${path} refuses a signed-in person with no role, and shows no fights`, rec.refused, rec.heading);
      }
      report.screens.push(rec);
      const label = `[${role.key} ${role.vp}] ${path}`;
      check(`${label} opens without a page error`, !navError && !errors.some((e) => e.kind === 'pageerror'), navError ?? JSON.stringify(errors.slice(0, 2)));
      check(`${label} no console errors`, errors.length === 0, JSON.stringify(errors.slice(0, 3)));
      check(`${label} no failed or 5xx requests`, failed.length === 0, JSON.stringify(failed.slice(0, 3)));
      check(`${label} no private data (emergency contact, medical note, private email)`, leaks.length === 0, leaks.join('; '));
      if (role.vp !== 'desk') check(`${label} no sideways scroll`, !m.overflow, `scrollWidth ${m.scrollWidth} > ${m.innerWidth}`);
      else check(`${label} nothing cut off on the right`, (m.clipped ?? []).length === 0, JSON.stringify(m.clipped?.slice(0, 4)));
      if (role.vp === 'phone') check(`${label} every control at least 44 px tall`, (m.small ?? []).length === 0, JSON.stringify(m.small?.slice(0, 5)));
    }
    await ctx.close();
  }
} catch (e) {
  check('the sweep ran to the end', false, String(e?.stack ?? e).slice(0, 600));
} finally {
  await browser.close();
  report.finishedUtc = new Date().toISOString();
  report.passed = results.filter((r) => r.ok).length; report.failed = results.filter((r) => !r.ok).map((r) => r.name);
  fs.writeFileSync(`${SHOTS}/sweep.json`, JSON.stringify(report, null, 2));
  console.log(`\n${report.passed}/${results.length} checks passed${report.failed.length ? ' — ' + report.failed.length + ' FAILED' : ''}`);
  process.exitCode = report.failed.length ? 1 : 0;
}
