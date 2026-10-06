// Pack 24A1: focus layout and tablet safety, verified in the RUNNING product (real Postgres from every migration + the Pack 24A1 fixture, PostgREST,
// the built app, Chromium). TEST DATA ONLY (synthetic event "Test stuff test"). Run it through scripts/e2e/pack24a1-live.sh. Not part of CI.
// What it proves, at 390x844, 768x1024, 1024x768 and 1280x900: the field (Lyst) screen and the check-in desk carry no site chrome (no header, bottom
// bar, footer, bug button, theme switch); Start round is fully visible and the topmost thing where a thumb lands, at every scroll position; Marshal's
// call, Counters and Record are reachable and tappable; nothing scrolls sideways; a long event name cannot push Exit or Start round away; the desk's
// search is at the top and stays there over a long list, also with the software keyboard's smaller viewport; Undo is quieter than Check in; Exit
// returns to the event; auth and role refusals are what they were; Start round still goes through the same server command (lyst_timer_command).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const E = {}, results = [];
const note = (k, v) => { E[k] = v; console.log(`EVIDENCE ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 900)); return v; };
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); return !!ok; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const U = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const WHO = {
  organizer: [U('a2'), 'u2@example.test'], scorer: [U('a4'), 'u4@example.test'], stranger: [U('a7'), 'u7@example.test'], head: [U('c1'), 'c1@example.test'],
  desk: [U('d1'), 'd1@example.test'], inspector: [U('d2'), 'd2@example.test'], otherDesk: [U('d4'), 'd4@example.test']
};
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-q', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const hdr = (who) => ({ 'content-type': 'application/json', apikey: 'x', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) });
async function rpc(who, fn, args) { const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: hdr(who), body: JSON.stringify(args) }); const body = await r.json().catch(() => null); return { status: r.status, body }; }
const refused = (r) => r.status >= 400 && r.status < 500;

const EVENT = '00000000-0000-0000-0000-00000000ed01', SLUG = 'test-stuff-test', NAME = 'Test stuff test';
const M1 = '00000000-0000-0000-0000-0000000fd001';
const FIELD = `/events/${SLUG}/field/Field%201`, DESK = `/events/${SLUG}/checkin`;
const timerRow = () => sql(`select coalesce((select status || ':' || mode || ':' || round_no from public.lyst_timer where event_id = '${EVENT}' and field_key = 'field 1'), 'none')`);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VP = {
  '390x844': { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  '768x1024': { viewport: { width: 768, height: 1024 }, hasTouch: true },
  '1024x768': { viewport: { width: 1024, height: 768 }, hasTouch: true },
  '1280x900': { viewport: { width: 1280, height: 900 } }
};
async function open(kind, who, { classic = false } = {}) {
  const ctx = await browser.newContext({ ...VP[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.addInitScript(([c]) => { try { localStorage.setItem('bos-lyst-mode', c ? 'classic' : 'lyst'); localStorage.setItem('bos-push-asked', '1'); } catch { /* ignore */ } }, [classic]);
  await ctx.route(/posthog\.com|maps\.googleapis\.com|nominatim/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('dialog', d => d.accept());
  return { ctx, page };
}
const shot = async (page, nm, full = false) => { await sleep(300); await page.screenshot({ path: `${SHOTS}/p24a1-${nm}.png`, fullPage: full }).catch(() => undefined); };
const text = async (page, sel = 'body') => ((await page.locator(sel).first().innerText({ timeout: 8000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ');

/** Site chrome present on the page, and sideways scroll. */
const chrome = (page) => page.evaluate(() => ({
  siteHeader: !!document.querySelector('header.top'), bottomBar: !!document.querySelector('nav.bottom'), footer: !!document.querySelector('footer'),
  bugButton: !!document.querySelector('.bug-btn, [aria-label*="bug" i]'), themeSwitch: !!document.querySelector('[aria-label="Switch light or dark"]'),
  focusHeader: !!document.querySelector('[data-testid="focus-header"]'), sideways: document.scrollingElement.scrollWidth - innerWidth
}));
/** Where an element is, whether it is fully on screen, and what a tap at its centre would actually hit. */
const where = (page, sel, nth = 0) => page.evaluate(([s, n]) => {
  const el = document.querySelectorAll(s)[n];
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return { top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height), vh: innerHeight, inView: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth,
    topmost: !!t && (el === t || el.contains(t)), hit: t ? `${t.tagName}.${t.className}`.slice(0, 60) : null };
}, [sel, nth]);
const GO = 'button.ly-go';

try {
  // ============================================================== 0. setup: the organizer calls m1 (Aldric v Brann, longsword duel) to Field 1 through the product's own API
  sql(`update public.events set status = 'published' where id = '${EVENT}'`);
  const call = await rpc('organizer', 'set_match_queue', { p_match: M1, p_state: 'on_deck', p_field: 'Field 1' });
  check('(setup) the organizer puts Aldric v Brann on deck on Field 1', call.status < 300, JSON.stringify(call));

  // ============================================================== 1. the field / Lyst screen at the four sizes
  // 768x1024 goes last: it starts round 1 through the screen, so every size is measured with Start round on screen
  for (const kind of ['390x844', '1024x768', '1280x900', '768x1024']) {
    const { ctx, page } = await open(kind, 'scorer');
    const rpcCalls = [];
    page.on('request', r => { const m = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.url()); if (m && r.method() === 'POST') rpcCalls.push(m[1]); });
    await page.goto(BASE + FIELD);
    await page.locator('button[aria-label^="Score "]').first().waitFor({ timeout: 45000 });
    const c0 = await chrome(page);
    note(`field.${kind}.queue.chrome`, c0);
    check(`[${kind}] field queue: no site header, bottom bar, footer, bug button or theme switch; the focus header is there`, !c0.siteHeader && !c0.bottomBar && !c0.footer && !c0.bugButton && !c0.themeSwitch && c0.focusHeader, JSON.stringify(c0));
    const head = await text(page, '[data-testid="focus-header"]');
    check(`[${kind}] the focus header names the event and the field and offers Exit`, /Exit/.test(head) && head.includes(NAME) && /Field 1/i.test(head), head);
    // open the fight
    await page.locator('button[aria-label^="Score "]').first().click();
    await page.locator(GO).waitFor({ timeout: 30000 });
    await sleep(600);
    const ctxText = await text(page, '[data-testid="focus-header"]');
    check(`[${kind}] the header says this is the Lyst on Field 1`, /Lyst · Field 1/i.test(ctxText), ctxText);
    const c1 = await chrome(page);
    check(`[${kind}] Lyst screen: no site bottom bar or header, no sideways scroll`, !c1.bottomBar && !c1.siteHeader && c1.sideways <= 0, JSON.stringify(c1));
    // Start round at every scroll position: fully on screen and the topmost thing at its centre (nothing over it)
    const maxY = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    const pos = [];
    for (const y of [0, Math.round(maxY / 3), Math.round((2 * maxY) / 3), maxY]) {
      await page.evaluate((v) => window.scrollTo(0, v), y); await sleep(150);
      pos.push({ y, label: (await text(page, GO)).trim(), ...(await where(page, GO)) });
    }
    note(`field.${kind}.start_round_by_scroll`, pos);
    check(`[${kind}] Start round is fully visible and nothing covers it, at every scroll position (top to bottom)`, pos.every(p => /^Start round 1/.test(p.label) && p.inView && p.topmost), JSON.stringify(pos));
    check(`[${kind}] Start round is a large target (at least 64 px tall, 280 px wide)`, pos[0].h >= 64 && pos[0].w >= Math.min(280, VP[kind].viewport.width - 40), JSON.stringify(pos[0]));
    // the tools: reachable by scrolling, then topmost (the sticky action never sits on them for good)
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `field-lyst-${kind}`);
    const tools = [];
    for (const nm of ['Marshal\'s call', 'Counters', 'Record', 'Back to the queue']) {
      const loc = page.getByRole('button', { name: new RegExp(`^${nm}`) }).first();
      await loc.scrollIntoViewIfNeeded(); await sleep(150);
      const box = await loc.boundingBox();
      const hit = await loc.evaluate(el => { const b = el.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!t && (t === el || el.contains(t)); });
      tools.push({ nm, h: Math.round(box?.height ?? 0), topmost: hit });
    }
    note(`field.${kind}.tools`, tools);
    check(`[${kind}] Marshal's call, Counters, Record and Back to the queue are reachable, uncovered and at least 44 px tall`, tools.every(t => t.topmost && t.h >= 44), JSON.stringify(tools));
    if (kind === '768x1024') {
      // the same server flow: Start round is one lyst_timer_command, and the server's clock is what changes
      const before = timerRow();
      rpcCalls.length = 0;
      await page.locator(GO).click();
      await page.getByRole('button', { name: /End round/ }).waitFor({ timeout: 20000 });
      await sleep(800);
      note('field.start_round.rpc_calls', rpcCalls);
      check('Start round still goes through the server: one lyst_timer_command, and the server clock is now running round 1', rpcCalls.includes('lyst_timer_command') && /^running:fight:1$/.test(timerRow()), `${before} -> ${timerRow()} ${JSON.stringify(rpcCalls)}`);
      const end = await where(page, GO);
      check('... the next primary action (End round) is in the same reachable place', end?.inView && end?.topmost, JSON.stringify(end));
      const mc = page.getByRole('button', { name: /^Marshal's call/ });
      await mc.scrollIntoViewIfNeeded();
      check('... Marshal\'s call is enabled once the round runs and opens the marshal\'s sheet', await mc.isEnabled() && (await mc.click().then(() => true, () => false)) && await page.getByRole('dialog').first().waitFor({ timeout: 8000 }).then(() => true, () => false));
      await page.keyboard.press('Escape'); await sleep(300);
      check('... and the official score did not change because of the layout (no round confirmed, 0-0 public)', sql(`select count(*) from public.lyst_round_scores where match_id = '${M1}' and official_a is not null`) === '0');
      // reset the clock for the next sizes, through the same command
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    check(`[${kind}] no page errors`, page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }
  // the round is running now: on the shortest screen (tablet landscape) End round and the clock's Pause are both reachable and uncovered at every scroll position
  {
    const { ctx, page } = await open('1024x768', 'scorer');
    await page.goto(BASE + FIELD);
    await page.locator('button[aria-label^="Score "]').first().click({ timeout: 45000 });
    await page.getByRole('button', { name: /End round/ }).waitFor({ timeout: 30000 }); await sleep(600);
    const maxY = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    const pos = [];
    for (const y of [0, Math.round(maxY / 2), maxY]) {
      await page.evaluate((v) => window.scrollTo(0, v), y); await sleep(150);
      const pause = await page.getByRole('button', { name: 'Pause' }).evaluate(el => { const b = el.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { inView: b.top >= 0 && b.bottom <= innerHeight, topmost: !!t && (t === el || el.contains(t)) }; });
      pos.push({ y, endLabel: (await text(page, GO)).trim(), end: await where(page, GO), pause });
    }
    note('field.running.1024x768', pos);
    check('[1024x768] round running: End round and Pause are both fully visible and uncovered at every scroll position (the clock never slides under the action)', pos.every(p => /^End round/.test(p.endLabel) && p.end.inView && p.end.topmost && p.pause.inView && p.pause.topmost), JSON.stringify(pos));
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'field-lyst-running-1024x768');
    await ctx.close();
  }
  // put the field back to "round not started" for the remaining checks
  sql(`delete from public.lyst_timer where event_id = '${EVENT}'; delete from public.lyst_rounds where match_id = '${M1}'`);

  // ============================================================== 2. a long event name cannot push the controls away (phone and tablet)
  sql(`update public.events set name = 'The Extremely Long Annual Central Alberta International Armoured Combat Steel Championship and Spring Open TEST' where id = '${EVENT}'`);
  for (const kind of ['390x844', '768x1024']) {
    const { ctx, page } = await open(kind, 'scorer');
    await page.goto(BASE + FIELD);
    await page.locator('button[aria-label^="Score "]').first().click({ timeout: 45000 });
    await page.locator(GO).waitFor({ timeout: 30000 }); await sleep(500);
    const h = await where(page, '[data-testid="focus-header"]');
    const exit = await where(page, '.focus-exit');
    const go = await where(page, GO);
    const c = await chrome(page);
    note(`longname.${kind}`, { header: h, exit, go, sideways: c.sideways });
    check(`[${kind}] long event name: the header stays one compact row (<= 72 px), Exit and Start round stay on screen, no sideways scroll`, h.h <= 72 && exit.inView && exit.topmost && go.inView && go.topmost && c.sideways <= 0, JSON.stringify({ h, exit, go, c }));
    if (kind === '390x844') await shot(page, 'field-long-name-390x844');
    await ctx.close();
  }
  sql(`update public.events set name = '${NAME}' where id = '${EVENT}'`);

  // ============================================================== 3. the classic scoreboard (phone): Finish match / Back to the queue are not under anything
  {
    const { ctx, page } = await open('390x844', 'scorer', { classic: true });
    await page.goto(BASE + FIELD);
    await page.locator('button[aria-label^="Score "]').first().click({ timeout: 45000 });
    await page.getByRole('button', { name: 'Finish match' }).waitFor({ timeout: 30000 });
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight)); await sleep(300);
    const fin = await where(page, '.sk-actions .btn', 2);
    const back = await where(page, '.sk-actions .btn', 0);
    const c = await chrome(page);
    check('[390x844] classic scoreboard: Finish match and Back to the queue are fully visible and uncovered at the end of the page; no bottom bar', fin?.inView && fin?.topmost && back?.inView && back?.topmost && !c.bottomBar && c.sideways <= 0, JSON.stringify({ fin, back, c }));
    await ctx.close();
  }

  // ============================================================== 4. Exit returns to the event (and to Event day when that is where the scorer came from)
  {
    const { ctx, page } = await open('768x1024', 'scorer');
    await page.goto(BASE + FIELD);
    await page.locator('button[aria-label^="Score "]').first().waitFor({ timeout: 45000 });
    await page.locator('.focus-exit').click();
    await page.waitForURL(u => new URL(u).pathname === `/events/${SLUG}`, { timeout: 20000 }).catch(() => undefined);
    await page.locator('header.top').waitFor({ timeout: 20000 }).catch(() => undefined);
    const c = await chrome(page);
    check('Exit on the field screen returns to the event page, which has the normal site chrome again', new URL(page.url()).pathname === `/events/${SLUG}` && c.siteHeader && !c.focusHeader, `${page.url()} ${JSON.stringify(c)}`);
    await ctx.close();
    const o = await open('768x1024', 'organizer');
    await o.page.goto(BASE + FIELD + '?from=eventday');
    await o.page.locator('.focus-exit').waitFor({ timeout: 45000 });
    const href = await o.page.locator('.focus-exit').getAttribute('href');
    check('Coming from Event day, Exit goes back to Event day', href === `/events/${SLUG}/manage?tab=eventday`, href);
    await o.ctx.close();
  }

  // ============================================================== 5. the check-in desk
  for (const kind of Object.keys(VP)) {
    const { ctx, page } = await open(kind, 'desk');
    await page.goto(BASE + DESK);
    await page.waitForSelector('.desk-counts', { timeout: 45000 });
    await page.waitForSelector('.desk-card', { timeout: 30000 });
    const c = await chrome(page);
    check(`[${kind}] desk: no site header, bottom bar, footer, bug button or theme switch; no sideways scroll`, !c.siteHeader && !c.bottomBar && !c.footer && !c.bugButton && !c.themeSwitch && c.focusHeader && c.sideways <= 0, JSON.stringify(c));
    const head = await text(page, '[data-testid="focus-header"]');
    check(`[${kind}] desk header: Exit, "Check-in" and the event`, /Exit/.test(head) && /Check-in/i.test(head) && head.includes(NAME), head);
    const s0 = await where(page, '.desk-find input');
    check(`[${kind}] the search is reachable straight away: on screen, near the top (top <= 150 px), uncovered, at least 48 px tall`, s0.inView && s0.top <= 150 && s0.topmost && s0.h >= 48, JSON.stringify(s0));
    await page.getByRole('button', { name: 'Everyone' }).click().catch(() => undefined);
    await sleep(400);
    const cards = await page.locator('.desk-card').count();
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight)); await sleep(300);
    const s1 = await where(page, '.desk-find input');
    note(`desk.${kind}.search`, { atLoad: s0, afterScrollingTheList: s1, cards });
    check(`[${kind}] after scrolling to the end of a long list (${cards} fighters) the search is still on screen and uncovered`, cards >= 30 && s1.inView && s1.topmost, JSON.stringify(s1));
    await page.evaluate(() => window.scrollTo(0, 0));
    if (kind === '768x1024') await shot(page, 'checkin-768x1024');
    check(`[${kind}] no page errors`, page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 6. the desk with the software keyboard open (tablet portrait and phone): search, find, check in, undo
  for (const [kind, kbHeight] of [['768x1024', 620], ['390x844', 480]]) {
    const { ctx, page } = await open(kind, 'desk');
    await page.goto(BASE + DESK);
    await page.waitForSelector('.desk-card', { timeout: 45000 });
    await page.evaluate(() => window.scrollTo(0, 400)).catch(() => undefined);
    // a software keyboard takes the bottom of the screen: the layout viewport the page gets is what is left
    await page.setViewportSize({ width: VP[kind].viewport.width, height: kbHeight });
    const n = kind === '768x1024' ? '07' : '08';
    await page.locator('.desk-find input').focus();
    await page.keyboard.type(`Test Fighter ${n}`);
    await sleep(500);
    const s = await where(page, '.desk-find input');
    const card = page.locator('.desk-card', { has: page.locator('h3', { hasText: `Test Fighter ${n}` }) });
    const checkIn = card.getByRole('button', { name: 'Check in' });
    await checkIn.scrollIntoViewIfNeeded();
    const b = await checkIn.boundingBox();
    check(`[${kind}, keyboard open: ${kbHeight} px left] the search stays on screen while typing, and the match's Check in is visible`, s.inView && s.topmost && b && b.y >= 0 && b.y + b.height <= kbHeight, JSON.stringify({ s, b }));
    await checkIn.click();
    const reg = sql(`select id from public.registrations where full_name = 'Test Fighter ${n}'`);
    const att = await (async () => { for (let i = 0; i < 30; i += 1) { const v = sql(`select count(*) from public.registration_checks where registration_id = '${reg}' and check_name = 'checked_in' and passed`); if (v === '1') return v; await sleep(300); } return '0'; })();
    check(`[${kind}] Check in saved on the server (set_attendance, unchanged)`, att === '1', att);
    const undo = card.getByRole('button', { name: 'Undo' });
    await undo.waitFor({ timeout: 15000 });
    const look = await card.evaluate(el => {
      const btns = [...el.querySelectorAll('.desk-row button')];
      const u = btns.find(x => x.innerText.trim() === 'Undo');
      const cs = (x) => { const s = getComputedStyle(x); const r = x.getBoundingClientRect(); return { bg: s.backgroundColor, border: s.borderTopColor, w: Math.round(r.width), h: Math.round(r.height) }; };
      return { undo: u ? cs(u) : null, others: btns.filter(x => x !== u).map(x => ({ label: x.innerText.trim(), ...cs(x) })) };
    });
    note(`desk.${kind}.undo_look`, look);
    check(`[${kind}] Undo is quiet (no fill) and still a real target (>= 44 px tall)`, look.undo && /rgba\(0, 0, 0, 0\)|transparent/.test(look.undo.bg) && look.undo.h >= 44, JSON.stringify(look));
    if (kind === '768x1024') {
      // the primary action, for someone not yet here: Check in is the filled button and Undo is not
      await page.locator('.desk-find input').fill('Test Fighter 09');
      await sleep(400);
      const card9 = page.locator('.desk-card', { has: page.locator('h3', { hasText: 'Test Fighter 09' }) });
      await card9.getByRole('button', { name: 'Arrived' }).click();
      await card9.getByRole('button', { name: 'Undo' }).waitFor({ timeout: 15000 });
      const both = await card9.evaluate(el => { const f = (t) => [...el.querySelectorAll('.desk-row button')].find(x => x.innerText.trim() === t); const cs = (x) => { const r = x.getBoundingClientRect(); return { bg: getComputedStyle(x).backgroundColor, w: Math.round(r.width), h: Math.round(r.height) }; }; return { checkIn: cs(f('Check in')), undo: cs(f('Undo')) }; });
      note('desk.arrived.checkin_vs_undo', both);
      check('an arrived fighter: Check in is the filled, wider button; Undo is unfilled and narrower', !/rgba\(0, 0, 0, 0\)/.test(both.checkIn.bg) && /rgba\(0, 0, 0, 0\)/.test(both.undo.bg) && both.checkIn.w > both.undo.w, JSON.stringify(both));
      await page.setViewportSize(VP[kind].viewport);
      await card9.scrollIntoViewIfNeeded();
      await shot(page, 'checkin-search-768x1024');
    }
    await ctx.close();
  }

  // ============================================================== 7. inspection context, and Exit from the desk
  {
    const { ctx, page } = await open('768x1024', 'inspector');
    await page.goto(BASE + DESK);
    await page.waitForSelector('.desk-card', { timeout: 45000 });
    const head = await text(page, '[data-testid="focus-header"]');
    check('the armour inspector sees the desk as "Armour inspection" in the same focus layout', /Armour inspection/i.test(head) && !(await chrome(page)).bottomBar, head);
    await page.locator('.focus-exit').click();
    await page.waitForURL(u => new URL(u).pathname === `/events/${SLUG}`, { timeout: 20000 }).catch(() => undefined);
    check('Exit on the desk returns to the event page', new URL(page.url()).pathname === `/events/${SLUG}`, page.url());
    await ctx.close();
    const o = await open('1280x900', 'organizer');
    await o.page.goto(BASE + DESK);
    await o.page.waitForSelector('.desk-card', { timeout: 45000 });
    const oh = await text(o.page, '[data-testid="focus-header"]');
    check('the organizer (check-in and inspection) sees "Check-in and armour"', /Check-in and armour/i.test(oh), oh);
    await o.ctx.close();
  }

  // ============================================================== 8. auth and role guards are what they were
  {
    const cases = [
      ['stranger', FIELD, 'This area is for scorekeepers and marshals', 'button[aria-label^="Score "]'],
      ['desk', FIELD, 'This area is for scorekeepers and marshals', 'button[aria-label^="Score "]'],
      [null, FIELD, 'Sign in', 'button[aria-label^="Score "]'],
      ['stranger', DESK, "check-in desk and armour inspectors", '.desk-card'],
      ['otherDesk', DESK, "check-in desk and armour inspectors", '.desk-card'],
      ['scorer', DESK, "check-in desk and armour inspectors", '.desk-card'],
      [null, DESK, 'Sign in', '.desk-card']
    ];
    for (const [who, path, want, forbidden] of cases) {
      const { ctx, page } = await open('390x844', who);
      await page.goto(BASE + path);
      const ok = await page.waitForFunction((w) => document.body.innerText.toLowerCase().includes(w.toLowerCase()), want, { timeout: 30000 }).then(() => true, () => false);
      const leaked = await page.locator(forbidden).count();
      const c = await chrome(page);
      check(`${who ?? 'signed out'} on ${path.endsWith('checkin') ? 'the desk' : 'the field'}: refused as before ("${want}"), nothing operational shown, still inside the focus layout with Exit`, ok && leaked === 0 && c.focusHeader && !c.bottomBar, `${ok} ${leaked} ${await text(page, 'main')}`.slice(0, 400));
      await ctx.close();
    }
    const api = {
      stranger_timer: await rpc('stranger', 'lyst_timer_command', { p_event: EVENT, p_field: 'Field 1', p_match: M1, p_expected_rev: 0, p_command: crypto.randomUUID(), p_action: 'start', p_mode: 'fight', p_duration_ms: 60000, p_round: 1, p_delta_ms: 0 }),
      desk_queue: await rpc('desk', 'set_match_queue', { p_match: M1, p_state: 'active', p_field: 'Field 1' }),
      scorer_checkin: await rpc('scorer', 'set_attendance', { p_reg: '00000000-0000-0000-0000-00000000ae02', p_state: 'checked_in' }),
      other_desk_checkin: await rpc('otherDesk', 'set_attendance', { p_reg: '00000000-0000-0000-0000-00000000ae02', p_state: 'checked_in' })
    };
    note('api.refusals', Object.fromEntries(Object.entries(api).map(([k, v]) => [k, v.status])));
    check('the database still refuses: a stranger\'s clock command, check-in staff moving a fight, a scorekeeper or another event\'s desk checking someone in', Object.values(api).every(refused), JSON.stringify(api).slice(0, 600));
    // Pack 24A0 (reconciled with Pack 18.1): calling a fight stays a scoring-staff power; what holds is that nobody deletes a fight through the table.
    const del = await fetch(`${API}/rest/v1/matches?id=eq.00000000-0000-0000-0000-0000000fd003`, { method: 'DELETE', headers: { ...hdr('organizer'), prefer: 'return=representation' } });
    check('... and Pack 24A0 still holds: not even the organizer can delete a fight through the table', refused({ status: del.status }) && sql(`select count(*) from public.matches where id = '00000000-0000-0000-0000-0000000fd003'`) === '1', String(del.status));
  }

  // ============================================================== 9. the normal site keeps its chrome (the focus layout is only where it was applied)
  {
    const { ctx, page } = await open('768x1024', 'organizer');
    await page.goto(BASE + `/events/${SLUG}/manage?tab=eventday`);
    await page.locator('section[aria-label="Event day"]').waitFor({ timeout: 45000 });
    const c = await chrome(page);
    check('Manage › Event day is unchanged: normal header and bottom bar, no focus header', c.siteHeader && c.bottomBar && !c.focusHeader, JSON.stringify(c));
    await ctx.close();
  }
} catch (e) {
  console.log('RUN STOPPED:', String(e?.stack ?? e).slice(0, 1500));
  E.__stopped = String(e?.message ?? e).slice(0, 500);
} finally {
  fs.writeFileSync(`${SHOTS}/evidence.json`, JSON.stringify({ evidence: E, checks: results }, null, 1));
  await browser.close();
  const failed = results.filter(c => !c.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(E.__stopped || failed ? 1 : 0);
}
