// Pack 27B (Training Counters) in a real browser against the REAL local stack, pack13 fixture. The Phase B gate: the Lyst shows the TRAINING COUNTER QR
// beside the Counter QR; a learner's own phone scans it (no account, no approval), says who they are, picks a Lyst and a side and counts the same
// screen, clearly marked Training; their tally is theirs alone, compared against the official counters of the same side (one line each, never a
// combined number); the tablet lists them apart; the marshal's call, the frozen evidence and the result never see them; they follow the next fight as
// learners; a second learner may join; Exit Training returns the phone to the ordinary site.
// Run through scripts/e2e/pack27b-live.sh. LOCAL ONLY, never against hosted Supabase.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); return !!ok; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const A = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const C = (n) => `00000000-0000-0000-0000-0000000000c${n}`;
const WHO = { owner: [A(1), 'u1@example.test'], organizer: [A(2), 'u2@example.test'], scorekeeper: [A(4), 'u4@example.test'], head: [C(1), 'c1@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const mid = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const EVENT = '00000000-0000-0000-0000-00000000ed01', SLUG = 'test-stuff-test', EP = `/events/${SLUG}`;
async function rest(who, method, path, body, token) {
  const headers = { 'content-type': 'application/json', apikey: 'x', ...(token ? { authorization: `Bearer ${token}` } : who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args, token) => rest(who, 'POST', `rpc/${fn}`, args, token);
const ver = (m) => Number(sql(`select version from public.matches where id = '${m}'`));
const fnCreate = (kind, extra = {}) => fetch(`${API}/functions/v1/device-session`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: `Bearer ${session(WHO.organizer).access_token}` }, body: JSON.stringify({ action: 'create', event: EVENT, kind, ...extra }) }).then(async r => ({ status: r.status, body: await r.json() }));

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  small: { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  large: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 },
  tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, desktop: { viewport: { width: 1280, height: 900 } }
};
const contexts = [];
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  contexts.push(ctx);
  await ctx.route(/posthog\.com|maps\.googleapis\.com|nominatim/, r => r.abort('failed'));
  await ctx.addInitScript(() => { try { localStorage.setItem('bos-push-ask', String(Date.now())); localStorage.setItem('bos-install-dismissed', String(Date.now())); } catch { /* ignore */ } });
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.errors = []; page.kind = kind;
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|already final|net::ERR|Failed to fetch|403|42501|401|P0001|not counting/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('dialog', d => d.accept());
  return { ctx, page };
}
const body = async (page, sel = 'body') => ((await page.locator(sel).first().innerText({ timeout: 8000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').toLowerCase();
const has = async (page, text, sel = 'body') => (await body(page, sel)).includes(text.toLowerCase());
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(250); } return false; };
const untilDb = async (fnc, want, ms = 10000) => { const t0 = Date.now(); let v = fnc(); while (v !== want && Date.now() - t0 < ms) { await sleep(250); v = fnc(); } return v; };
let shotN = 0;
const shot = async (page, name, full = false) => { if (!SHOTS) return; await sleep(400); shotN += 1; await page.screenshot({ path: `${SHOTS}/p27b-${String(shotN).padStart(2, '0')}-${name}-${VIEW[page.kind].viewport.width}.png`, fullPage: full }).catch(() => undefined); };
const go = async (page, path) => { await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle').catch(() => undefined); };
const fits = async (page) => { const [sw, iw] = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]); return sw <= iw + 1; };
const FORBIDDEN = /\bseat\b|approv|pending|request a|enrol|sign in to practise|waiting for approval/i;
const clean = async (page) => !FORBIDDEN.test(await body(page));
const tapTwo = (p) => p.getByRole('button', { name: 'Count two points, head or torso' }).click();
const tapOne = (p) => p.getByRole('button', { name: 'Count one point, arm leg or hand' }).click();
const total = (name, m, r = 1) => sql(`select coalesce((select private.lyst_seat_total(s.id, ${r}) from public.lyst_counter_seats s where s.display_name = '${name}' and s.status = 'active' and s.match_id = '${m}'), -1)`);
const shown = async (p) => (await p.locator('.cp-total output').innerText().catch(() => '')).trim();
const bind = async (p, code, operator, lystRe, side, expectName) => {
  await go(p, `/device#c=${code}`);
  if (!await until(async () => await has(p, "who's counting"), 30000)) return `no who's counting: ${(await body(p)).slice(0, 200)}`;
  if (!await clean(p)) return `forbidden word: ${(await body(p)).slice(0, 300)}`;
  await p.fill('#cp-name', operator); await p.getByRole('button', { name: 'Continue' }).click();
  if (!await until(async () => await has(p, 'choose your lyst'), 15000)) return `no Lyst chooser: ${(await body(p)).slice(0, 200)}`;
  await p.getByRole('button', { name: lystRe }).click();
  if (!await until(async () => await has(p, 'choose your side'), 15000)) return `no side chooser: ${(await body(p)).slice(0, 200)}`;
  await p.getByRole('button', { name: new RegExp(side) }).click();
  if (!await until(async () => (await p.getByTestId('cp-fighter').count()) > 0 && (await p.getByTestId('cp-fighter').innerText().catch(() => '')).toLowerCase().includes(expectName.toLowerCase()), 20000)) return `not on ${expectName}: ${(await body(p)).slice(0, 200)}`;
  if (!await clean(p)) return `forbidden word on the count screen: ${(await body(p)).slice(0, 300)}`;
  return 'ok';
};

try {
  await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  await rpc('organizer', 'set_match_queue', { p_match: mid(11), p_state: 'active', p_order: null }).catch(() => undefined);
  const madeC = await fnCreate('counter_pool');
  const poolCode = (madeC.body?.code ?? '').replace(/-/g, '');
  check('1. the event has its Counter QR', /^[0-9A-Z]{12}$/.test(poolCode), JSON.stringify(madeC.body));

  // the tablet: the Counters sheet's Training tab shows the TRAINING COUNTER QR (made here by the organizer's tablet; the scorekeeper can only show it)
  const tab = (await open('tablet', 'scorekeeper')).page;
  await go(tab, `${EP}/field/Field%201?open=${mid(1)}&from=control`);
  await tab.waitForSelector('.ly-timer', { timeout: 30000 });
  await tab.getByRole('button', { name: /^Counters/ }).click();
  await tab.getByTestId('counters-tab-training').click();
  const card = tab.getByRole('dialog').getByTestId('training-qr');
  check('2. the Lyst\'s Training tab shows the Training Counter QR card, with no training QR made yet and no "make" button for a scorekeeper (the organizer makes it)', await until(async () => (await card.count()) === 1 && await has(tab, 'no training counter qr yet', '[data-testid=training-qr]'), 15000) && (await card.getByTestId('make-training-qr').count()) === 0, await body(tab, '[role=dialog]'));
  await shot(tab, 'training-tab-none');
  await tab.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  const org = (await open('desktop', 'organizer')).page;
  await go(org, `${EP}/field/Field%201?open=${mid(1)}&from=control`);
  await org.waitForSelector('.ly-timer', { timeout: 30000 });
  await org.getByRole('button', { name: /^Counters/ }).click();
  await org.getByTestId('counters-tab-training').click();
  await org.getByRole('dialog').getByTestId('make-training-qr').click();
  const ocard = org.getByRole('dialog').getByTestId('training-qr');
  check('3. the organizer makes the Training Counter QR from the same tab; it is a second reusable pool, marked training, beside the Counter QR', await ocard.getByTestId('training-qr-code').waitFor({ timeout: 15000 }).then(() => true, () => false)
    && sql(`select count(*) from public.event_credentials where event_id = '${EVENT}' and kind = 'counter_pool' and revoked_at is null`) === '2'
    && sql(`select training::text from public.event_credentials where event_id = '${EVENT}' and label = 'Training Counter QR'`) === 'true', await body(org, '[role=dialog]'));
  const trainCode = (await ocard.getByTestId('training-qr-code').innerText()).replace(/-/g, '').trim();
  check('3a. the card says what it is: Training Counter, practice only, listed apart, never official', await has(org, 'practice only', '[data-testid=training-qr]') && await has(org, 'never part of the official evidence', '[data-testid=training-qr]') && /^[0-9A-Z]{12}$/.test(trainCode) && trainCode !== poolCode, await body(org, '[data-testid=training-qr]'));
  await shot(org, 'training-qr-card');
  await org.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await tab.getByRole('button', { name: /^Counters/ }).click();
  await tab.getByTestId('counters-tab-training').click();
  check('4. the scorekeeper\'s tablet now shows the same Training Counter QR (retrievable by anyone who runs the Lyst)', await until(async () => (await card.getByTestId('training-qr-code').innerText().catch(() => '')).replace(/-/g, '').trim() === trainCode, 15000), await body(tab, '[role=dialog]'));
  await tab.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // two official phones and one learner on Lyst 1
  const g = (await open('phone')).page, n = (await open('small')).page, e = (await open('large')).page;
  check('5. official phone A (Garrett, Lyst 1 Red) on the Counter QR', await bind(g, poolCode, 'Garrett Robson', /Lyst 1|Field 1/, 'RED', 'Aldric Stone') === 'ok');
  check('6. official phone B (Nathan, Lyst 1 Red) on the Counter QR', await bind(n, poolCode, 'Nathan Toth', /Lyst 1|Field 1/, 'RED', 'Aldric Stone') === 'ok');
  const be = await bind(e, trainCode, 'Learner Lee', /Lyst 1|Field 1/, 'RED', 'Aldric Stone');
  check('7. a LEARNER\'s own phone scans the Training Counter QR: Who\'s counting → Choose your Lyst → RED → counting on Aldric; no account, no approval, no code typed, no "seat"', be === 'ok', be);
  check('8. the learner\'s screen is obviously Training: the badge, the practice note, "Training Counter · practice only" in the bar, Exit Training, and a LEARNING seat on the server', await has(e, 'training') && await has(e, 'practice') && await has(e, 'exit training') && !await has(e, 'exit counter')
    && (await e.locator('.cp-badge').innerText()).trim().toLowerCase() === 'training'
    && sql(`select role || ':' || side from public.lyst_counter_seats where display_name = 'Learner Lee' and status = 'active' and match_id = '${mid(1)}'`) === 'learning:a', (await body(e)).slice(0, 400));
  check('8a. the learner\'s phone fits 412 wide without sideways scroll', await fits(e));
  await shot(e, 'learner-bound');
  check('9. the operator turn of the learner is logged like any counter (who, Lyst, side, fight)', sql(`select operator_name || ':' || field_key || ':' || side || ':' || (match_id = '${mid(1)}')::text from public.counter_operator_log where operator_name = 'Learner Lee' and ended_at is null`) === 'Learner Lee:field 1:a:true');

  // round 1: everyone counts; the learner sees the officials of their side
  await tab.getByRole('button', { name: /Start round 1/ }).click();
  check('10. round 1: COUNT is live on the learner\'s phone as on the official ones', await until(async () => (await e.getByRole('button', { name: 'Count two points, head or torso' }).isEnabled().catch(() => false)) && (await g.getByRole('button', { name: 'Count two points, head or torso' }).isEnabled().catch(() => false)), 20000));
  await tapTwo(g); await tapTwo(g); await tapOne(g);          // Garrett 5
  await tapTwo(n);                                            // Nathan 2
  await tapTwo(e); await tapTwo(e); await tapTwo(e); await tapOne(e);   // Lee 7 (practice)
  const tots = () => [total('Garrett Robson', mid(1)), total('Nathan Toth', mid(1)), total('Learner Lee', mid(1))].join(',');
  check('11. three tallies, three numbers: Garrett 5, Nathan 2, Lee 7; the learner\'s is theirs alone', await untilDb(tots, '5,2,7', 15000) === '5,2,7' && (await shown(e)) === '7', tots());
  check('12. the learner compares against the OFFICIAL counters of their side, one line each (Garrett Robson 5 · Nathan Toth 2), never a combined number', await until(async () => /official counters on red: garrett robson 5 · nathan toth 2/.test(await body(e, '[data-testid=cp-officials]')), 15000) && !/\b7\b/.test(await body(e, '[data-testid=cp-officials]')), await body(e, '[data-testid=cp-officials]'));
  check('12a. an official phone has no comparison list (it never counts by another counter\'s number)', (await g.getByTestId('cp-officials').count()) === 0 && (await n.getByTestId('cp-officials').count()) === 0);
  await shot(e, 'learner-counting-compare');
  // the tablet lists the learner apart
  const evidence = async () => body(tab, '[data-testid=counter-evidence]');
  check('13. the tablet lists the learner APART under "Training (never official)", the two official phones under Red', await until(async () => /training \(never official\)/.test(await evidence()) && /learner lee/.test(await evidence()), 15000)
    && (await tab.locator('[data-testid=counter-evidence] [data-testid=counter-row][data-role=official]').count()) === 2
    && (await tab.locator('[data-testid=counter-evidence] [data-testid=counter-row][data-role=learning]').count()) === 1, await evidence());
  await shot(tab, 'tablet-learner-apart');
  // the learner undoes their own tap; the officials are untouched
  await e.getByRole('button', { name: 'Undo last' }).click();
  check('14. the learner\'s undo touches only the learner: Lee 6, Garrett 5, Nathan 2', await untilDb(tots, '5,2,6', 10000) === '5,2,6', tots());

  // end round: hints are official only; the marshal's call; the frozen evidence has no learner
  await tab.getByRole('button', { name: /End round/ }).click();
  await tab.locator('.ly-entry').waitFor({ timeout: 15000 });
  const hints = (await tab.locator('.ly-hints').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
  check('15. at End round the marshal is offered the OFFICIAL tallies only (Garrett 5, Nathan 2); the learner is not offered', /Garrett Robson · 5/.test(hints) && /Nathan Toth · 2/.test(hints) && !/Learner/.test(hints), hints);
  const pick = (nm, k) => tab.getByRole('group', { name: `Quick score for ${nm}` }).getByRole('button', { name: String(k), exact: true });
  await pick('Aldric Stone', 6).click(); await pick('Brann Oakley', 3).click();
  await tab.getByRole('button', { name: 'Confirm round 6–3' }).click();
  check('16. the marshal\'s 6–3 stands; the frozen evidence names the two official phones only; the learner\'s practice rows remain as practice', await untilDb(() => sql(`select coalesce((select official_a || '-' || official_b from public.lyst_round_scores where match_id = '${mid(1)}' and round_no = 1 and status = 'confirmed'), '')`), '6-3') === '6-3'
    && sql(`select string_agg((c ->> 'operator') || ':' || (c ->> 'role'), ',' order by c ->> 'operator') from public.lyst_round_revisions r, jsonb_array_elements(r.counters) c where r.match_id = '${mid(1)}' and r.round_no = 1`) === 'Garrett Robson:official,Nathan Toth:official'
    && sql(`select count(*) from public.lyst_counts c join public.lyst_counter_seats s on s.id = c.seat_id where s.display_name = 'Learner Lee' and c.match_id = '${mid(1)}'`) === '5', sql(`select counters::text from public.lyst_round_revisions where match_id = '${mid(1)}'`));
  check('16a. the learner is told the round is over, like everyone', await until(async () => /round over|confirming|ended|wait/i.test(await e.locator('[data-testid=cp-banner]').innerText().catch(() => '')), 15000));

  // finish; the next fight: the learner follows as a learner
  const fin = await rpc('scorekeeper', 'lyst_finalize', { p_command: crypto.randomUUID(), p_match: mid(1), p_expected_version: ver(mid(1)), p_result: 'a', p_basis: 'score', p_reason: null });
  check('17. the result is official on the marshal\'s rounds; nothing of the learner (or any counter) is in it', fin.body?.status === 'accepted' && sql(`select (not (detail::text ~* 'counter|tally|seat|operator|learn'))::text from public.matches where id = '${mid(1)}'`) === 'true', JSON.stringify(fin.body));
  const nxt = await rpc('scorekeeper', 'lyst_open', { p_match: mid(2), p_counter_input: 'weighted' });
  check('18. the Lyst opens the next fight: the learner follows by itself as LEARNING on Cael vs Dara, the officials as official', nxt.status === 200 && await until(async () => await has(e, 'cael rhodes') && await has(g, 'cael rhodes'), 20000)
    && sql(`select string_agg(display_name || ':' || role, ',' order by display_name) from public.lyst_counter_seats where match_id = '${mid(2)}' and status = 'active'`) === 'Garrett Robson:official,Learner Lee:learning,Nathan Toth:official', (await body(e)).slice(0, 200));
  // a second learner, on the other side; the first changes side
  const e2 = (await open('phone')).page;
  check('19. a second learner joins the same Training Counter QR on BLUE: two learners, no limit, each a learning seat', await bind(e2, trainCode, 'Learner Max', /Lyst 1|Field 1/, 'BLUE', 'Dara Voss') === 'ok'
    && sql(`select count(*) from public.lyst_counter_seats where match_id = '${mid(2)}' and status = 'active' and role = 'learning'`) === '2');
  await e.getByRole('button', { name: 'Change side' }).click();
  await until(async () => await has(e, 'choose your side'), 10000);
  await e.getByRole('button', { name: /BLUE/ }).click();
  check('20. a learner changes side in place (Lee → Blue): still learning, old place ended with its evidence kept', await until(async () => (await e.getByTestId('cp-fighter').innerText().catch(() => '')).toLowerCase().includes('dara voss'), 15000)
    && sql(`select role || ':' || side from public.lyst_counter_seats where display_name = 'Learner Lee' and status = 'active'`) === 'learning:b'
    && sql(`select count(*) from public.lyst_counter_seats where display_name = 'Learner Lee' and status = 'ended'`) === '2', (await body(e)).slice(0, 200));
  check('21. a learner never gets an official place by any path', sql(`select count(*) from public.lyst_counter_seats s join public.event_sessions es on es.id = s.user_id join public.event_credentials c on c.id = es.credential_id where c.training and s.role = 'official'`) === '0');
  // Exit Training
  await e.locator('nav.cp-links').getByRole('button', { name: 'Exit Training' }).click();
  check('22. Exit Training asks once, in training words', await until(async () => await has(e, 'exit training?') && await has(e, 'practice'), 8000), await body(e));
  await e.getByTestId('cp-exit').click();
  check('23. the learner\'s phone is back on the ordinary site; its session ended; its practice rows are kept; the other learner and the officials carry on', await until(async () => !e.url().includes('/device') && !e.url().includes('/lyst/counter') && (await e.evaluate(() => localStorage.getItem('bos-device-session'))) === null, 20000)
    && await untilDb(() => sql(`select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.training and s.ended_at is null`), '1', 10000) === '1'
    && sql(`select count(*) from public.lyst_counts c join public.lyst_counter_seats s on s.id = c.seat_id where s.display_name = 'Learner Lee'`) === '5'
    && sql(`select count(*) from public.lyst_counter_seats where match_id = '${mid(2)}' and status = 'active'`) === '3', e.url());
  // privacy
  const anon = await rest(null, 'GET', `lyst_public_state?event_id=eq.${EVENT}&select=*`);
  check('24. the public Lyst state carries nothing of learners or counters', anon.status === 200 && !JSON.stringify(anon.body).match(/learn|train|counter|operator|lee|max/i), JSON.stringify(anon.body).slice(0, 300));
  const cred = await rest(null, 'GET', 'event_credentials?select=training');
  check('24a. anon cannot read the credentials', cred.status === 401 || cred.status === 403 || (Array.isArray(cred.body) && cred.body.length === 0), `${cred.status}`);
  check('25. no page errors on the phones or tablets', [g, n, e, e2, tab, org].every(p => p.errors.length === 0), JSON.stringify([g.errors, n.errors, e.errors, e2.errors, tab.errors, org.errors]));
} catch (err) {
  check('script ran to the end', false, err && err.stack ? err.stack : String(err));
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser.close();
}
const pass = results.filter(r => r.ok).length;
console.log(`\n${pass}/${results.length} checks passed`);
if (SHOTS) { try { fs.writeFileSync(`${SHOTS}/evidence.json`, JSON.stringify({ results }, null, 2)); } catch { /* ignore */ } }
process.exit(pass === results.length ? 0 : 1);
