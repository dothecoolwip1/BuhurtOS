// Pack 16 (check-in, armour control and fighter readiness) against a REAL local stack: Postgres built from every migration + the Pack 16 fixture,
// PostgREST, the real built app in real Chromium at a 390x844 phone. The event-day story: a fighter arrives, is checked in, fails part of the armour
// inspection, the Lyst screen warns (and does NOT block or rewrite the fight), the fighter fixes it, is reinspected and passes, and every screen agrees.
// Then the boundaries: fighters, scorekeepers, captains, other-event staff and anonymous callers are refused by the database, not just the UI.
// Run it through scripts/e2e/pack16-live.sh. LOCAL EVIDENCE ONLY (needs a PostgREST binary; not part of CI).
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
const U = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const WHO = {
  organizer: [U('a2'), 'u2@example.test'], scorekeeper: [U('a4'), 'u4@example.test'], stranger: [U('a7'), 'u7@example.test'], head: [U('c1'), 'c1@example.test'],
  desk: [U('d1'), 'd1@example.test'], inspector: [U('d2'), 'd2@example.test'], captain: [U('d3'), 'd3@example.test'], otherDesk: [U('d4'), 'd4@example.test'],
  brann: ['00000000-0000-0000-0000-000000000102', 'fighter2@example.test']
};
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const EVENT = '00000000-0000-0000-0000-00000000ed01', OTHER = '00000000-0000-0000-0000-00000000ed02', TEAM = '00000000-0000-0000-0000-00000000a616';
const REG = (n) => `00000000-0000-0000-0000-00000000ae0${n}`;   // 1 Aldric, 2 Brann, 3 Cael (profight), 4 Dara
const M1 = '00000000-0000-0000-0000-0000000fd001';                // Longsword Round 1: Aldric v Brann, Field 1
async function rest(who, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', prefer: 'return=representation', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args) => rest(who, 'POST', `rpc/${fn}`, args);
const refused = (r) => r.status >= 400 && r.status < 500;

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { desktop: { viewport: { width: 1280, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|youtube(-nocookie)?\.com|twitch\.tv|vimeo\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); } catch { /* blocked frame */ } }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|net::ERR|Failed to fetch|403|401|42501/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  return page;
}
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = async (page, name) => { if (SHOTS) { await sleep(400); await page.screenshot({ path: `${SHOTS}/p16-${name}.png`, fullPage: true }).catch(() => undefined); } };
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const until = async (fn, timeout = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn()) return true; await sleep(250); } return false; };
const card = (page, name) => page.locator(`article.desk-card[aria-label="${name}"]`);
const cardText = (page, name) => text(page, `article.desk-card[aria-label="${name}"]`);
const DESK = '/events/test-stuff-test/checkin', EVENT_PAGE = '/events/test-stuff-test', FIELD1 = '/events/test-stuff-test/field/Field%201';
const m1Row = () => sql(`select concat_ws('|', queue_state, field, entry_a, entry_b, result, winner_entry_id, scheduled_at, queue_order) from public.matches where id = '${M1}'`);
const audit = (action) => sql(`select count(*) from public.audit_log where event_id = '${EVENT}' and action = '${action}'`);

try {
  // ------------------------------------------------------------------ 0. starting point
  check('0. fixture: Brann is registered and accepted, not here yet, armour not inspected', /expected\|not_inspected/.test(sql(`select concat_ws('|', 'expected', 'not_inspected') where not exists (select 1 from public.registration_checks where registration_id = '${REG(2)}')`)));
  const m1Before = m1Row();

  // ------------------------------------------------------------------ 1. the check-in desk (role: check-in desk) on a phone
  const desk = await open('phone', 'desk');
  await desk.goto(BASE + DESK);
  await desk.waitForSelector('.desk-counts', { timeout: 30000 });
  const counts0 = await text(desk, '.desk-counts');
  check('1. the desk opens for a check-in desk account with counts (4 expected, 2 not here yet, 0 ready)', /4 expected/.test(counts0) && /2 not here yet/.test(counts0) && /0 ready/.test(counts0), counts0);
  check('2. the desk is phone-sized with no sideways scroll at 390x844', await noSideways(desk));
  await shot(desk, '01-desk-open');
  await desk.getByLabel(/Find a fighter/).fill('brann');
  await card(desk, 'Brann Oakley').waitFor({ timeout: 10000 });
  check('3. search by name finds Brann; the list shows only him', (await desk.locator('article.desk-card').count()) === 1, await text(desk, '.desk'));
  await desk.getByLabel(/Find a fighter/).fill('iron wolves');
  check('4. search by team finds both Iron Wolves fighters', await until(async () => (await desk.locator('article.desk-card').count()) === 2), await desk.locator('article.desk-card').count());
  await desk.getByLabel(/Find a fighter/).fill('brann');
  await card(desk, 'Brann Oakley').getByRole('button', { name: 'Arrived' }).click();
  check('5. ARRIVED: saved only after the server confirms; the card says "Arrived" and "Arrived, not checked in"', await until(async () => /Arrived, not checked in/.test(await cardText(desk, 'Brann Oakley'))), await cardText(desk, 'Brann Oakley'));
  check('6. ... the database has the arrival and it is audited', sql(`select passed from public.registration_checks where registration_id = '${REG(2)}' and check_name = 'arrived'`) === 't' && audit('checkin.arrived') === '1');
  await card(desk, 'Brann Oakley').getByRole('button', { name: 'Check in' }).click();
  check('7. CHECK IN: the card now says Checked in; the only reason left is the armour', await until(async () => { const t = await cardText(desk, 'Brann Oakley'); return /Checked in/.test(t) && /Armour inspection required/.test(t) && !/Not checked in/.test(t); }), await cardText(desk, 'Brann Oakley'));
  check('8. ... still NOT READY, in words and a symbol (not colour alone)', /✕ NOT READY/.test(await cardText(desk, 'Brann Oakley')));
  check('9. the check-in desk role gets NO inspection buttons (that is the inspector\'s job)', (await card(desk, 'Brann Oakley').getByRole('button', { name: /Pass armour|Needs correction/ }).count()) === 0);
  await shot(desk, '02-checked-in');

  // ------------------------------------------------------------------ 2. armour inspection: needs correction
  const insp = await open('phone', 'inspector');
  await insp.goto(BASE + DESK);
  await insp.waitForSelector('.desk-counts', { timeout: 30000 });
  // Aldric passes first (so only Brann is the problem in his fight)
  await card(insp, 'Aldric Stone').getByRole('button', { name: 'Pass armour' }).click();
  check('10. the inspector passes Aldric: Armour passed, and Aldric is READY (he was checked in already)', await until(async () => { const t = await cardText(insp, 'Aldric Stone'); return /Armour passed/.test(t) && /✓ READY/.test(t); }), await cardText(insp, 'Aldric Stone'));
  await insp.getByLabel(/Find a fighter/).fill('brann');
  const b = card(insp, 'Brann Oakley');
  await b.getByRole('button', { name: 'Needs correction' }).click();
  check('11. "Needs correction" asks what needs fixing; Save stays disabled until an issue is picked', await b.getByRole('button', { name: /Save: needs correction/ }).isDisabled());
  await b.getByRole('button', { name: 'Helmet' }).click();
  await b.getByLabel(/Note/).fill('Grille bar loose on the left');
  check('12. the picked issue shows as pressed with a tick', (await b.getByRole('button', { name: 'Helmet' }).getAttribute('aria-pressed')) === 'true');
  await shot(insp, '03-needs-correction-form');
  await b.getByRole('button', { name: /Save: needs correction/ }).click();
  check('13. saved: "Needs correction: Helmet", the note, the inspector, and the reason "Armour needs correction"', await until(async () => { const t = await cardText(insp, 'Brann Oakley'); return /Needs correction: Helmet/.test(t) && /Grille bar loose/.test(t) && /Armour needs correction/.test(t) && /Inspector Ines/.test(t); }), await cardText(insp, 'Brann Oakley'));
  check('14. the database keeps the record (result, issue, note, inspector) and the kit flag stays false', sql(`select concat_ws('|', result, array_to_string(issues, ','), note, inspected_by = '${U('d2')}') from public.registration_inspections where registration_id = '${REG(2)}' order by inspected_at desc limit 1`) === 'conditional|helmet|Grille bar loose on the left|t' && sql(`select coalesce((select passed::text from public.registration_checks where registration_id = '${REG(2)}' and check_name = 'kit'), 'none')`) !== 't');
  await shot(insp, '04-needs-correction');

  // the desk dashboard reflects it (on its next read; reconnect also triggers a read)
  await desk.getByLabel(/Find a fighter/).fill('');
  await desk.evaluate(() => window.dispatchEvent(new Event('focus')));
  check('15. the desk dashboard shows Brann with the armour issue (1 armour issue)', await until(async () => /1 armour issues?/.test(await text(desk, '.desk-counts'))), await text(desk, '.desk-counts'));

  // ------------------------------------------------------------------ 3. the Lyst screen warns, and does not block or rewrite the fight
  const call = await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  check('16. the organizer calls Field 1 through the existing queue (Brann not being ready does not stop it)', call.status === 200 && sql(`select queue_state from public.matches where id = '${M1}'`) === 'active', JSON.stringify(call));
  const m1Called = m1Row();
  const tab = await open('phone', 'scorekeeper');
  await tab.goto(BASE + FIELD1);
  await tab.getByRole('button', { name: /Score Aldric Stone against Brann Oakley/ }).click();
  await tab.locator('[data-testid="readiness-strip"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const strip = await text(tab, '[data-testid="readiness-strip"]');
  check('17. the Lyst screen shows "Not ready: Brann Oakley: armour needs correction" (and nothing about Aldric, who is ready)', /Not ready/.test(strip) && /Brann Oakley: armour needs correction/.test(strip) && !/Aldric/.test(strip), strip);
  check('18. the warning does not leak the inspector\'s note to the Lyst screen', !/Grille/.test(await text(tab)));
  check('19. the Lyst screen still works: the clock and the scoring are there (nothing blocked)', await until(async () => (await tab.locator('.ly-timer').count()) === 1, 15000));
  check('20. the fight was not rewritten or cancelled: the match row is exactly what the queue made it', m1Row() === m1Called && m1Called.startsWith('active|'), `${m1Before} -> ${m1Called} -> ${m1Row()}`);
  check('21. the Lyst screen has no sideways scroll at 390x844 with the warning', await noSideways(tab));
  await shot(tab, '05-lyst-warning');

  // ------------------------------------------------------------------ 4. the captain sees it, cannot change it
  const cap = await open('phone', 'captain');
  await cap.goto(BASE + EVENT_PAGE);
  await cap.locator('[data-testid="team-day"]').waitFor({ timeout: 20000 }).catch(() => undefined);
  const capText = await text(cap, 'section[aria-labelledby^="myteam-"]');
  check('22. the captain sees the team: 2/2 checked in, 1/2 ready; Brann "Not ready · Armour needs correction"', /2\/2 checked in · 1\/2 ready/.test(capText) && /Brann Oakley ✕ Not ready Armour needs correction/i.test(capText), capText);
  check('23. the captain does not see the inspector\'s note', !/Grille/.test(await text(cap)));
  check('24. the captain cannot check anyone in or inspect (database refuses)', refused(await rpc('captain', 'set_attendance', { p_reg: REG(2), p_state: 'checked_in' })) && refused(await rpc('captain', 'record_inspection', { p_reg: REG(2), p_result: 'passed', p_issues: [], p_note: null })));
  await cap.goto(BASE + DESK);
  check('25. the captain opening the desk is told it is for staff (no list)', await until(async () => /check-in desk and armour inspectors/.test(await text(cap))) && (await cap.locator('article.desk-card').count()) === 0, await text(cap));
  await shot(cap, '06-captain-refused');

  // ------------------------------------------------------------------ 5. reinspection passes; everything agrees
  await insp.getByRole('button', { name: 'Pass armour' }).first().click();
  check('26. REINSPECTION: Brann passes; the card says "Armour passed (after reinspection)" and ✓ READY', await until(async () => { const t = await cardText(insp, 'Brann Oakley'); return /Armour passed \(after reinspection\)/.test(t) && /✓ READY/.test(t); }), await cardText(insp, 'Brann Oakley'));
  await card(insp, 'Brann Oakley').locator('summary', { hasText: 'Inspection history' }).click();
  check('27. the history keeps both records, newest first: Armour passed, then Needs correction: Helmet with the note', await until(async () => { const h = await text(insp, 'article.desk-card[aria-label="Brann Oakley"] .desk-history'); return /Armour passed.*Needs correction: Helmet: Grille bar loose/.test(h); }), await text(insp, 'article.desk-card[aria-label="Brann Oakley"]'));
  check('28. nothing was overwritten: two inspection rows; the kit flag (existing screens) is now passed; audit has both with the reinspection flag', sql(`select count(*) from public.registration_inspections where registration_id = '${REG(2)}'`) === '2' && sql(`select passed from public.registration_checks where registration_id = '${REG(2)}' and check_name = 'kit'`) === 't' && sql(`select count(*) from public.audit_log where event_id = '${EVENT}' and action = 'inspection.passed' and subject = '${REG(2)}' and (details->>'reinspection')::boolean`) === '1', sql(`select action, details from public.audit_log where event_id = '${EVENT}' order by at`));
  await shot(insp, '07-passed-history');
  await tab.evaluate(() => window.dispatchEvent(new Event('online')));
  check('29. the Lyst warning clears on its next read (reconnect triggers one)', await until(async () => (await tab.locator('[data-testid="readiness-strip"]').count()) === 0, 15000), await text(tab, '[data-testid="readiness-strip"]'));
  await shot(tab, '08-lyst-clear');
  await cap.goto(BASE + EVENT_PAGE);
  check('30. the captain now sees 2/2 ready and Brann ✓ Ready', await until(async () => /2\/2 checked in · 2\/2 ready/.test(await text(cap, '[data-testid="team-day"]')), 20000) && /Brann Oakley ✓ Ready/i.test(await text(cap, 'section[aria-labelledby^="myteam-"]')), await text(cap, 'section[aria-labelledby^="myteam-"]'));
  check('31. the captain\'s event page has no sideways scroll at 390x844', await noSideways(cap));
  await shot(cap, '09-captain-ready');

  // ------------------------------------------------------------------ 6. the fighter's own check-in code (QR)
  const brann = await open('phone', 'brann');
  await brann.goto(BASE + EVENT_PAGE);
  await brann.locator('[data-testid="checkin-code"] summary').click({ timeout: 20000 });
  check('32. Brann sees "Your check-in code" on his own registration and it draws a QR', await until(async () => (await brann.locator('[data-testid="checkin-code"] svg').count()) === 1));
  await shot(brann, '10-fighter-qr');
  await brann.goto(BASE + `${DESK}?r=${REG(2)}`);
  check('33. the QR address opened by the FIGHTER grants nothing: "for staff" message, no list', await until(async () => /check-in desk and armour inspectors/.test(await text(brann))) && (await brann.locator('article.desk-card').count()) === 0, await text(brann));
  check('34. the fighter cannot check himself in or clear himself (database refuses)', refused(await rpc('brann', 'set_attendance', { p_reg: REG(2), p_state: 'checked_in' })) && refused(await rpc('brann', 'record_inspection', { p_reg: REG(2), p_result: 'passed', p_issues: [], p_note: null })) && refused(await rpc('brann', 'event_readiness', { p_event: EVENT })));
  await desk.goto(BASE + `${DESK}?r=${REG(4)}`);
  await desk.waitForSelector('.desk-counts', { timeout: 30000 });
  check('35. the same address opened by DESK staff pins that person to the top of the list (Dara, from her code)', await until(async () => (await desk.locator('article.desk-card').first().getAttribute('aria-label')) === 'Dara Voss' && (await desk.locator('article.desk-card.is-pinned').count()) === 1));
  await desk.goto(BASE + `${DESK}?r=00000000-0000-0000-0000-00000000ffff`);
  check('36. an unknown code says so plainly (search is the fallback)', await until(async () => /not a registration for this event/.test(await text(desk))));
  const anonDesk = await open('phone', null);
  await anonDesk.goto(BASE + `${DESK}?r=${REG(2)}`);
  check('37. the QR address opened signed-out asks for sign-in and shows nobody', await until(async () => /Sign in/i.test(await text(anonDesk))) && (await anonDesk.locator('article.desk-card').count()) === 0);

  // ------------------------------------------------------------------ 7. connectivity: never pretend it saved
  await desk.goto(BASE + DESK);
  await desk.waitForSelector('.desk-counts', { timeout: 30000 });
  await desk.getByLabel(/Find a fighter/).fill('dara');
  await card(desk, 'Dara Voss').waitFor();
  await desk.ctx.setOffline(true);
  await card(desk, 'Dara Voss').getByRole('button', { name: 'Check in' }).click();
  check('38. OFFLINE: pressing Check in says "Not saved" and the card does not pretend (still Not here yet)', await until(async () => { const t = await cardText(desk, 'Dara Voss'); return /Not saved/.test(t) && /Not here yet/.test(t); }), await cardText(desk, 'Dara Voss'));
  check('39. ... and the database has nothing for Dara', sql(`select count(*) from public.registration_checks where registration_id = '${REG(4)}'`) === '0');
  await shot(desk, '11-offline-not-saved');
  await desk.ctx.setOffline(false);
  await card(desk, 'Dara Voss').getByRole('button', { name: 'Check in' }).click();
  check('40. back online, the same button saves it', await until(async () => /Checked in/.test(await cardText(desk, 'Dara Voss'))) && sql(`select passed from public.registration_checks where registration_id = '${REG(4)}' and check_name = 'checked_in'`) === 't');
  sql(`insert into public.registration_checks (registration_id, check_name, passed) values ('${REG(1)}', 'arrived', true) on conflict do nothing`);
  sql(`update public.registration_checks set passed = false where registration_id = '${REG(1)}' and check_name = 'checked_in'`);
  await desk.ctx.setOffline(true); await sleep(300); await desk.ctx.setOffline(false);
  await desk.getByLabel(/Find a fighter/).fill('aldric');
  check('41. a change made elsewhere shows after reconnect (Aldric un-checked-in by another device)', await until(async () => /Arrived, not checked in/.test(await cardText(desk, 'Aldric Stone'))), await cardText(desk, 'Aldric Stone'));
  await rpc('desk', 'set_attendance', { p_reg: REG(1), p_state: 'checked_in' });

  // ------------------------------------------------------------------ 8. weigh-in (profight only, never public)
  const caelDesk = desk;
  await caelDesk.getByLabel(/Find a fighter/).fill('cael');
  const cael = card(caelDesk, 'Cael Rhodes');
  check('42. weigh-in is offered for the profight entrant, with the declared weight', /Weigh-in: not recorded \(declared 84 kg\)/.test(await cardText(caelDesk, 'Cael Rhodes')), await cardText(caelDesk, 'Cael Rhodes'));
  await cael.getByLabel(/Weight of Cael Rhodes/).fill('83.46');
  await cael.getByRole('button', { name: 'Save weight' }).click();
  check('43. the weight is saved (rounded to 0.1 kg) and is not a blocker', await until(async () => /Weigh-in: 83\.5 kg/.test(await cardText(caelDesk, 'Cael Rhodes'))) && sql(`select weight_kg from public.registration_weighins where registration_id = '${REG(3)}' order by recorded_at desc limit 1`).startsWith('83.5'), await cardText(caelDesk, 'Cael Rhodes'));
  await caelDesk.getByLabel(/Find a fighter/).fill('dara');
  check('44. no weigh-in for a non-profight fighter', !/Weigh-in/.test(await cardText(caelDesk, 'Dara Voss')));
  check('45. weights and notes are not readable by the scorekeeper, captain, fighter or anonymous callers (tables and readiness)', (await Promise.all(['scorekeeper', 'captain', 'brann', null].map(async w => {
    const a = await rest(w, 'GET', 'registration_weighins?select=weight_kg'), b2 = await rest(w, 'GET', 'registration_inspections?select=note'), c = await rpc(w, 'inspection_history', { p_reg: REG(2) });
    return (refused(a) || (Array.isArray(a.body) && a.body.length === 0)) && (refused(b2) || (Array.isArray(b2.body) && b2.body.length === 0)) && refused(c);
  }))).every(Boolean));
  const mr = await rpc('scorekeeper', 'match_readiness', { p_match: M1 });
  check('46. the scorekeeper\'s fight readiness has status words only (no note, no weight fields)', mr.status === 200 && Array.isArray(mr.body) && mr.body.length === 2 && mr.body.every(r => !('note' in r) && !('weight_kg' in r)), JSON.stringify(mr.body));

  // ------------------------------------------------------------------ 9. override (head marshal), reason, audited
  const head = await open('phone', 'head');
  await head.goto(BASE + DESK);
  await head.waitForSelector('.desk-counts', { timeout: 30000 });
  await head.getByLabel(/Find a fighter/).fill('dara');
  const d = card(head, 'Dara Voss');
  await d.locator('summary', { hasText: 'Override' }).click();
  check('47. the override needs a reason first (button disabled)', await d.getByRole('button', { name: 'Mark ready anyway' }).isDisabled());
  await d.getByLabel(/Reason/).fill('Loaner kit checked by head marshal at ringside');
  await d.getByRole('button', { name: 'Mark ready anyway' }).click();
  check('48. OVERRIDE: Dara is ✓ READY with the override reason shown', await until(async () => { const t = await cardText(head, 'Dara Voss'); return /✓ READY/.test(t) && /Override: Loaner kit/.test(t); }), await cardText(head, 'Dara Voss'));
  check('49. ... audited with the reason and the head marshal as actor', sql(`select count(*) from public.audit_log where event_id = '${EVENT}' and action = 'readiness.override' and actor = '${U('c1')}' and details::text like '%Loaner kit%'`) === '1', sql(`select action, actor, details from public.audit_log where event_id = '${EVENT}' and action like 'readiness%'`));
  await shot(head, '12-override');
  if (!(await d.locator('details.desk-more', { hasText: 'Override in place' }).evaluate(e => e.open).catch(() => false))) await d.locator('summary', { hasText: 'Override in place' }).click();
  await d.getByRole('button', { name: 'Withdraw override' }).click();
  check('50. the override can be withdrawn: Dara is NOT READY again; the record is kept (revoked, not deleted)', await until(async () => /✕ NOT READY/.test(await cardText(head, 'Dara Voss'))) && sql(`select count(*) from public.registration_overrides where registration_id = '${REG(4)}' and revoked_at is not null`) === '1');
  check('51. the check-in desk and inspector cannot override (database refuses)', refused(await rpc('desk', 'set_readiness_override', { p_reg: REG(4), p_reason: 'trying it' })) && refused(await rpc('inspector', 'set_readiness_override', { p_reg: REG(4), p_reason: 'trying it' })));

  // ------------------------------------------------------------------ 10. the boundaries, directly against the database
  check('52. scorekeeper: cannot check in, inspect, weigh, or read the desk list', refused(await rpc('scorekeeper', 'set_attendance', { p_reg: REG(4), p_state: 'arrived' })) && refused(await rpc('scorekeeper', 'record_inspection', { p_reg: REG(4), p_result: 'passed', p_issues: [], p_note: null })) && refused(await rpc('scorekeeper', 'record_weigh_in', { p_reg: REG(3), p_weight_kg: 90 })) && refused(await rpc('scorekeeper', 'event_readiness', { p_event: EVENT })));
  check('53. check-in staff of ANOTHER event: refused for this event (event-scoped roles)', refused(await rpc('otherDesk', 'set_attendance', { p_reg: REG(4), p_state: 'arrived' })) && refused(await rpc('otherDesk', 'event_readiness', { p_event: EVENT })) && (await rpc('otherDesk', 'event_readiness', { p_event: OTHER })).status === 200);
  check('54. the check-in desk cannot inspect; the inspector cannot check in', refused(await rpc('desk', 'record_inspection', { p_reg: REG(4), p_result: 'passed', p_issues: [], p_note: null })) && refused(await rpc('inspector', 'set_attendance', { p_reg: REG(4), p_state: 'arrived' })));
  check('55. anonymous: every Pack 16 function is refused', (await Promise.all([['set_attendance', { p_reg: REG(4), p_state: 'arrived' }], ['record_inspection', { p_reg: REG(4), p_result: 'passed', p_issues: [], p_note: null }], ['event_readiness', { p_event: EVENT }], ['match_readiness', { p_match: M1 }], ['team_readiness', { p_event: EVENT, p_team: TEAM }], ['my_desk_roles', { p_event: EVENT }]].map(async ([f, a]) => refused(await rpc(null, f, a))))).every(Boolean));
  check('56. a stranger (no role): refused, and my_desk_roles says no detail', refused(await rpc('stranger', 'event_readiness', { p_event: EVENT })) && refused(await rpc('stranger', 'match_readiness', { p_match: M1 })) && (await rpc('stranger', 'my_desk_roles', { p_event: EVENT })).body?.detail === false);
  check('57. the desk cannot write inspection or check tables directly (no client writes)', refused(await rest('desk', 'POST', 'registration_inspections', { registration_id: REG(4), event_id: EVENT, result: 'passed' })) && refused(await rest('desk', 'POST', 'registration_checks', { registration_id: REG(4), check_name: 'kit', passed: true })));

  // ------------------------------------------------------------------ 11. existing screens still agree; staff roles in People
  const org = await open('phone', 'organizer');
  await org.goto(BASE + '/events/test-stuff-test/manage?tab=checkin');
  await org.getByRole('link', { name: 'Open the check-in desk' }).waitFor({ timeout: 30000 });
  await org.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All', exact: true }).click();
  check('58. Manage › Check-in links to the desk and still lists Brann as checked in with kit passed', await until(async () => /Checked in ✓/.test(await text(org, 'article[aria-label="Brann Oakley"]')) && /Kit passed ✓/.test(await text(org, 'article[aria-label="Brann Oakley"]'))), await text(org, 'article[aria-label="Brann Oakley"]'));
  await org.goto(BASE + '/events/test-stuff-test/manage?tab=people');
  await org.waitForSelector('select', { timeout: 30000 });
  const roleOptions = await org.locator('select').first().innerText();
  check('59. People offers the two new roles: Check-in desk and Armour inspector', /Check-in desk/.test(roleOptions) && /Armour inspector/.test(roleOptions), roleOptions);
  const deskHome = await open('phone', 'inspector');
  await deskHome.goto(BASE + EVENT_PAGE);
  check('60. an inspector\'s event page has the way in: "Open the check-in desk"', await deskHome.getByTestId('open-desk').waitFor({ timeout: 20000 }).then(() => true, () => false));
  check('61. the desk at 390x844 after all that: still no sideways scroll', await noSideways(head) && await noSideways(insp) && await noSideways(desk));
  await head.getByLabel(/Find a fighter/).fill('');
  await shot(head, '13-desk-final');

  const all = [desk, insp, tab, cap, brann, anonDesk, head, org, deskHome];
  const errs = all.flatMap(p => p.errors);
  check('62. no page errors in any browser', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('unexpected error', false, e.stack ?? String(e));
} finally {
  await browser.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(failed.length ? 'PACK16 LIVE FAILED' : 'PACK16 LIVE PASSED');
process.exit(failed.length ? 1 : 0);
