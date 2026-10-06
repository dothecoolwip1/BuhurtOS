// Live updates must not reset the view (Pack 18 requirement). Real stack (Postgres + PostgREST + the built app, real Chromium), Pack 16 fixture.
// For each long event-day screen, at 390x844 AND 1280x900: scroll well down, open / type transient UI state, then change the authoritative data on
// the server (results, check-in, inspection) and let the page receive it through its normal channels (realtime is not offered locally, so the
// polling fallbacks and the 20 s event-record watch), then check:
//   the displayed data changed; the page's root element is the SAME DOM node (no remount); the scroll position is effectively unchanged
//   (the element that was in the middle of the screen is still there, at the same place); open sections, filters, search text and unsent
//   input are intact. Then the same after a reconnect (offline -> online) and a focus-triggered background refresh.
// Run it through scripts/e2e/live-stability.sh. LOCAL EVIDENCE ONLY.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 600)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const U = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const WHO = { organizer: [U('a2'), 'u2@example.test'], scorekeeper: [U('a4'), 'u4@example.test'], desk: [U('d1'), 'd1@example.test'], inspector: [U('d2'), 'd2@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const EVENT = '00000000-0000-0000-0000-00000000ed01', SLUG = 'test-stuff-test';
const MID = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const REG = (n) => `00000000-0000-0000-0000-00000000ae0${n}`;
async function rpc(who, fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: `Bearer ${session(WHO[who]).access_token}` }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const version = (n) => Number(sql(`select version from public.matches where id = '${MID(n)}'`));
const finish = (n, a = 5, b = 3) => rpc('scorekeeper', 'submit_match_result', { p_command: crypto.randomUUID(), p_match: MID(n), p_result: a > b ? 'a' : 'b', p_score_a: a, p_score_b: b, p_detail: {}, p_expected_version: version(n), p_schema: 1 });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, desktop: { viewport: { width: 1280, height: 900 } } };
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|youtube(-nocookie)?\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); localStorage.setItem('bos-lyst-mode', 'classic'); } catch { /* blocked frame */ } }, ['sb-localhost-auth-token', session(WHO[who])]);
  const page = await ctx.newPage();
  page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  return page;
}
const text = async (page, sel) => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

/** Scroll well down, mark the page root and the element in the middle of the screen, remember where it is. */
async function settle(page, rootSel) {
  await page.locator(rootSel).first().waitFor({ timeout: 30000 });
  await sleep(1500);
  return page.evaluate(([rootSel, frac]) => {
    const se = document.scrollingElement, max = se.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.max(0, Math.round(max * frac)));
    const root = document.querySelector(rootSel);
    root.__stable = 'same-node';
    // the anchor: the reading position, i.e. the smallest block at the top-left of the content area under the sticky header, which is
    // what the browser's own scroll anchoring keeps in place (first visible content in reading order)
    const content = document.querySelector('main.wrap')?.getBoundingClientRect();
    // Pack 18.1: if the point lands on a big container (its padding or a gap between rows), step down until a small block is hit. Otherwise the
    // "anchor" is a whole section, and rows that are legitimately removed ABOVE the visible rows inside that same section (a fighter becoming
    // ready leaves the Not ready list) move the container while the browser correctly keeps the row the reader was looking at in place.
    const ax = Math.max(20, (content?.left ?? 0) + 24);
    let anchor = document.elementFromPoint(ax, 160);
    for (let yy = 160; yy <= 420 && anchor && anchor.getBoundingClientRect().height > 220; yy += 10) anchor = document.elementFromPoint(ax, yy) ?? anchor;
    while (anchor && anchor.parentElement && anchor.parentElement !== root && anchor.parentElement.getBoundingClientRect().height <= 220) anchor = anchor.parentElement;
    if (anchor) anchor.__anchor = true;
    window.__anchorEl = anchor;
    window.__heights = [...root.children].map(c => [c.tagName + (c.id ? '#' + c.id : '') + '.' + (c.className || '').toString().split(' ')[0] + ':' + (c.getAttribute('aria-labelledby') || c.getAttribute('aria-label') || ''), Math.round(c.getBoundingClientRect().height)]);
    window.__anchorDesc = anchor ? anchor.tagName + '.' + anchor.className + ' "' + (anchor.textContent || '').slice(0, 40) + '"' : null;
    return { y: se.scrollTop, max, top: anchor?.getBoundingClientRect().top ?? null };
  }, [rootSel, Number(process.env.STAB_SCROLL) || 0.6]);
}
/** Same root node? Same scroll? The anchor still at the same place? */
const after = (page, rootSel) => page.evaluate((rootSel) => {
  const root = document.querySelector(rootSel), a = window.__anchorEl;
  const now = root ? [...root.children].map(c => Math.round(c.getBoundingClientRect().height)) : [];
  const changed = (window.__heights || []).map(([n, h], i) => [n, h, now[i]]).filter(([, h, n]) => h !== n);
  return { sameRoot: !!root && root.__stable === 'same-node', y: document.scrollingElement.scrollTop, anchorConnected: !!a && a.isConnected, top: a && a.isConnected ? a.getBoundingClientRect().top : null,
    anchor: window.__anchorDesc, changed };
}, rootSel);
// Kept = same root node, not thrown back toward the top, and what was in the middle of the screen is still there (within 80 px). If the data
// replaced that very element, the scroll must still be where it was (within 400 px: the content around it legitimately changed).
const kept = (b, a, short) => a.sameRoot && (short || (a.y > 0 && (a.anchorConnected && b.top !== null && a.top !== null ? Math.abs(a.top - b.top) <= 80 : Math.abs(a.y - b.y) <= 400)));

const pages = [];
try {
  // ---------------------------------------------------------------------------------------- open everything, at both sizes
  const screens = [];
  for (const kind of ['phone', 'desktop']) {
    const ev = await open(kind, null); pages.push(ev);
    await ev.goto(BASE + `/events/${SLUG}`);
    screens.push({ kind, name: 'public event page', page: ev, root: 'section.fade-in' });

    const ed = await open(kind, 'organizer'); pages.push(ed);
    await ed.goto(BASE + `/events/${SLUG}/manage?tab=eventday`);
    screens.push({ kind, name: 'Event day (Manage)', page: ed, root: 'section.eventday', typeInto: { sel: 'textarea', value: `Unsent note ${kind}` } });

    const cc = await open(kind, 'organizer'); pages.push(cc);
    await cc.goto(BASE + `/events/${SLUG}/command`);
    screens.push({ kind, name: 'Command Centre', page: cc, root: 'section.cmd-centre', openDetails: '#cc-fights', typeInto: { sel: '#cc-announce textarea', value: `Unsent announcement ${kind}`, openFirst: '#cc-announce' } });

    const desk = await open(kind, 'desk'); pages.push(desk);
    await desk.goto(BASE + `/events/${SLUG}/checkin`);
    screens.push({ kind, name: 'Check-in desk', page: desk, root: 'section.desk', search: { sel: 'input[type="search"]', value: 'r' }, filter: 'Everyone' });

    const field = await open(kind, 'scorekeeper'); pages.push(field);
    await field.goto(BASE + `/events/${SLUG}/field/Field%201`);
    screens.push({ kind, name: 'Field 1 queue (Lyst Control entry)', page: field, root: 'section.marshal' });

    const bc = await open(kind, 'organizer'); pages.push(bc);
    await bc.goto(BASE + `/events/${SLUG}/manage?tab=broadcast`);
    screens.push({ kind, name: 'Manage › Broadcast', page: bc, root: 'main.wrap > *', noLiveData: true, typeInto: { sel: 'input[type="url"], input[name*="stream" i], input', value: 'https://www.youtube.com/watch?v=unsaved' } });
  }

  // transient state + scroll
  for (const s of screens) {
    const p = s.page;
    await p.locator(s.root).first().waitFor({ timeout: 30000 }).catch(() => undefined);
    if (s.filter) await p.getByRole('group', { name: 'Show' }).getByRole('button', { name: s.filter, exact: true }).click().catch(() => undefined);
    if (s.search) await p.locator(s.search.sel).first().fill(s.search.value).catch(() => undefined);
    if (s.openDetails) await p.locator(`${s.openDetails} > summary`).click().catch(() => undefined);
    if (s.typeInto) {
      if (s.typeInto.openFirst) await p.evaluate((sel) => { const d = document.querySelector(sel); if (d && !d.open) d.open = true; }, s.typeInto.openFirst);
      s.typed = await p.locator(s.typeInto.sel).first().fill(s.typeInto.value).then(() => true, () => false);
    }
    s.before = await settle(p, s.root);
    s.textBefore = await text(p, s.root);
  }
  for (const s of screens) s.short = s.before.max < 400;
  check('0. the long event-day screens can be scrolled well below the top (Event day, Command Centre, check-in desk and the event page at both sizes)',
    screens.filter(s => /Event day|Command Centre|Check-in|event page/.test(s.name)).every(s => !s.short), screens.map(s => `${s.kind}/${s.name}: ${s.before.max}px`).join('; '));

  // ---------------------------------------------------------------------------------------- authoritative changes on the server
  await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  const r1 = await finish(1, 5, 2);
  await rpc('desk', 'set_attendance', { p_reg: REG(2), p_state: 'checked_in' });
  await rpc('inspector', 'record_inspection', { p_reg: REG(1), p_result: 'passed', p_issues: [], p_note: null });
  check('1. server-side changes made through the real functions (queue called, a result, a check-in, an inspection)', r1.body?.status === 'accepted', JSON.stringify(r1));
  // long enough for every mechanism: live polling (15 s), the event-record watch (20 s), the desk (20 s) and the Command Centre snapshot (20 s)
  await sleep(48000);

  for (const s of screens) {
    const p = s.page, a = await after(p, s.root), now = await text(p, s.root);
    const label = `${s.kind} · ${s.name}`;
    if (!s.noLiveData) check(`2. ${label}: the displayed data updated`, now !== s.textBefore, 'no visible change');
    check(`3. ${label}: no remount (same root element)${s.short ? ' (page too short to test scrolling)' : ' and the view kept (the reading position is still there)'}`, kept(s.before, a, s.short), JSON.stringify({ before: s.before, after: a }));
    if (s.search) check(`4. ${label}: search text and filter kept`, (await p.locator(s.search.sel).first().inputValue()) === s.search.value
      && (await p.getByRole('group', { name: 'Show' }).getByRole('button', { name: s.filter, exact: true }).getAttribute('aria-pressed')) === 'true');
    if (s.openDetails) check(`4. ${label}: the section opened by hand is still open`, await p.evaluate((sel) => document.querySelector(sel)?.open === true, s.openDetails));
    if (s.typed) check(`4. ${label}: unsent input kept`, (await p.locator(s.typeInto.sel).first().inputValue()) === s.typeInto.value);
  }

  // ---------------------------------------------------------------------------------------- reconnect and focus refresh
  for (const s of screens) s.before = await settle(s.page, s.root);
  for (const s of screens) { await s.page.ctx.setOffline(true); await s.page.evaluate(() => window.dispatchEvent(new Event('offline'))); }
  await sleep(4000);
  for (const s of screens) { await s.page.ctx.setOffline(false); await s.page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); }); }
  await finish(2, 4, 5);   // something changes while they were away
  await sleep(26000);
  for (const s of screens) {
    const a = await after(s.page, s.root);
    check(`5. ${s.kind} · ${s.name}: after going offline and back (reconnect + focus refresh): no remount${s.short ? '' : ', view kept'}`, kept(s.before, a, s.short), JSON.stringify({ before: s.before, after: a }));
  }
  if (SHOTS) for (const s of screens.filter(x => x.kind === 'phone')) await s.page.screenshot({ path: `${SHOTS}/stability-${s.name.replace(/\W+/g, '-')}.png` }).catch(() => undefined);
  const errs = pages.flatMap(p => p.errors);
  check('6. no page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('unexpected error', false, e.stack ?? String(e));
} finally {
  await browser.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(failed.length ? 'LIVE STABILITY FAILED' : 'LIVE STABILITY PASSED');
process.exit(failed.length ? 1 : 0);
