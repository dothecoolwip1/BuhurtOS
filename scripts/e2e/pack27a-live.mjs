// Pack 27A (Official Counter Foundation) in a real browser against the REAL local stack (Postgres + PostgREST + the device-session function + the built
// app), pack13 fixture. The Phase A completion gate, as one journey: ONE Counter QR, three phones (two red, one blue) that bind themselves by name,
// Lyst and side; a round; independent counting; the tablet shows every phone apart; one phone undoes its own tap; Change Counter keeps the history;
// a second tablet cannot switch the Lyst mid-round; the marshal's call and the result ignore the phones; the next fight moves every phone; stale taps
// from the earlier fight never land; a person's own phone enters Counter mode and leaves it with their account untouched; the phone remembers its name.
// Run through scripts/e2e/pack27a-live.sh. LOCAL ONLY, never against hosted Supabase.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const E = {};
const note = (k, v) => { E[k] = v; console.log(`EVIDENCE ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 900)); return v; };
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); return !!ok; };
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
const EVENT = '00000000-0000-0000-0000-00000000ed01', SLUG = 'test-stuff-test', EP = `/events/${SLUG}`;
async function rest(who, method, path, body, token) {
  const headers = { 'content-type': 'application/json', apikey: 'x', ...(token ? { authorization: `Bearer ${token}` } : who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args, token) => rest(who, 'POST', `rpc/${fn}`, args, token);
const ver = (m) => Number(sql(`select version from public.matches where id = '${m}'`));

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  small: { viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  large: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 },
  landscapePhone: { viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, landscape: { viewport: { width: 1024, height: 768 }, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 } }
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
const shot = async (page, name, full = false) => { if (!SHOTS) return; await sleep(400); shotN += 1; await page.screenshot({ path: `${SHOTS}/p27a-${String(shotN).padStart(2, '0')}-${name}-${VIEW[page.kind].viewport.width}.png`, fullPage: full }).catch(() => undefined); };
const go = async (page, path) => { await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle').catch(() => undefined); };
const fits = async (page) => { const [sw, iw] = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]); return sw <= iw + 1; };
const FORBIDDEN = /\bseat\b|approv|pending|request a|enrol|waiting for approval/i;   // words the product model forbids on a counter phone
const clean = async (page) => !FORBIDDEN.test(await body(page));
const tapTwo = (p) => p.getByRole('button', { name: 'Count two points, head or torso' }).click();
const tapOne = (p) => p.getByRole('button', { name: 'Count one point, arm leg or hand' }).click();
const total = (name, m, r = 1) => sql(`select coalesce((select private.lyst_seat_total(s.id, ${r}) from public.lyst_counter_seats s where s.display_name = '${name}' and s.status = 'active' and s.match_id = '${m}'), -1)`);
const shown = async (p) => (await p.locator('.cp-total output').innerText().catch(() => '')).trim();
const deviceToken = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('bos-device-session') ?? 'null')?.access_token ?? null; } catch { return null; } });
const moreHasNotifications = async (p) => { await p.getByRole('button', { name: 'More' }).click(); const ok = await until(async () => (await p.locator('nav.more-list').count()) > 0 && await has(p, 'notifications', 'nav.more-list'), 8000); await p.keyboard.press('Escape'); return ok; };

try {
  // ───────────── the fixture: the day is on; the fight on Lyst 1 is Aldric Stone vs Brann Oakley, next Cael Rhodes vs Dara Voss
  await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  await rpc('organizer', 'set_match_queue', { p_match: mid(11), p_state: 'active', p_order: null }).catch(() => undefined);
  const made = await fetch(`${API}/functions/v1/device-session`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: `Bearer ${session(WHO.organizer).access_token}` }, body: JSON.stringify({ action: 'create', event: EVENT, kind: 'counter_pool' }) }).then(async r => ({ status: r.status, body: await r.json() }));
  const poolCode = (made.body?.code ?? sql(`select pool_code from public.event_credentials where event_id = '${EVENT}' and kind = 'counter_pool' and revoked_at is null limit 1`)).replace(/-/g, '');
  check('1. the event has ONE reusable Counter QR (low-privilege, many phones)', /^[0-9A-Z]{12}$/.test(poolCode) && sql(`select count(*) from public.event_credentials where event_id = '${EVENT}' and kind = 'counter_pool' and revoked_at is null`) === '1', JSON.stringify(made));

  // the scoring tablet opens the fight on Lyst 1 (this is what makes it the Lyst's current fight)
  const tab = (await open('tablet', 'scorekeeper')).page;
  await go(tab, `${EP}/field/Field%201?open=${mid(1)}&from=control`);
  await tab.waitForSelector('.ly-timer', { timeout: 30000 });
  check('2. the tablet opens Aldric vs Brann on Lyst 1: it is the Lyst\'s one current fight', await untilDb(() => sql(`select coalesce((select match_id::text from public.lyst_field_current where event_id = '${EVENT}' and field_key = 'field 1'), '')`), mid(1)) === mid(1) && await has(tab, 'start round 1'), await body(tab));

  // ───────────── three phones scan the same QR: Garrett (Lyst 1 Red), Nathan (Lyst 1 Red), Joe (Lyst 1 Blue)
  const bind = async (p, operator, lystRe, side, expectName, nowText = 'aldric stone vs brann oakley') => {
    await go(p, `/device#c=${poolCode}`);
    if (!await until(async () => await has(p, "who's counting"), 30000)) return `no who's counting: ${(await body(p)).slice(0, 200)}`;
    if (!await clean(p)) return `forbidden word on the name screen: ${(await body(p)).slice(0, 300)}`;
    await p.fill('#cp-name', operator); await p.getByRole('button', { name: 'Continue' }).click();
    if (!await until(async () => await has(p, 'choose your lyst'), 15000)) return `no Lyst chooser: ${(await body(p)).slice(0, 200)}`;
    if (!await has(p, nowText)) return `Lyst chooser lacks the fight on now: ${(await body(p)).slice(0, 300)}`;
    await p.getByRole('button', { name: lystRe }).click();
    if (!await until(async () => await has(p, 'choose your side on lyst 1') && await has(p, 'red') && await has(p, 'blue'), 15000)) return `no side chooser: ${(await body(p)).slice(0, 200)}`;
    await p.getByRole('button', { name: new RegExp(side) }).click();
    if (!await until(async () => await has(p, expectName.toLowerCase()), 20000)) return `not on ${expectName}: ${(await body(p)).slice(0, 200)}`;
    if (!await clean(p)) return `forbidden word on the count screen: ${(await body(p)).slice(0, 300)}`;
    return 'ok';
  };
  const g = (await open('phone')).page, n = (await open('small')).page, j = (await open('landscapePhone')).page;
  const bg = await bind(g, 'Garrett Robson', /Lyst 1|Field 1/, 'RED', 'Aldric Stone');
  check('3. phone A (390): scan → Who\'s counting? → Choose your Lyst (with the fight on now) → RED → on Aldric; no seat / approval / pending words anywhere', bg === 'ok', bg);
  await shot(g, 'phone-a-bound');
  const bn = await bind(n, 'Nathan Toth', /Lyst 1|Field 1/, 'RED', 'Aldric Stone');
  check('4. phone B (360): a second counter on the SAME side of the same Lyst, no limit, nobody kicked out', bn === 'ok' && sql(`select count(*) from public.lyst_counter_seats where match_id = '${mid(1)}' and side = 'a' and role = 'official' and status = 'active'`) === '2', bn);
  const bj = await bind(j, 'Joe', /Lyst 1|Field 1/, 'BLUE', 'Brann Oakley');
  check('5. phone C (landscape 740×360): BLUE, on Brann; three phones, three sessions of one QR', bj === 'ok' && sql(`select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.kind = 'counter_pool' and c.event_id = '${EVENT}' and s.ended_at is null`) === '3', bj);
  check('5a. the landscape phone fits without sideways scroll', await fits(j));
  await shot(j, 'phone-c-landscape');
  check('6. each phone has an OPERATOR TURN naming who, Lyst 1, the side and THIS fight', sql(`select string_agg(operator_name || ':' || side || ':' || (match_id = '${mid(1)}')::text, ',' order by operator_name) from public.counter_operator_log where event_id = '${EVENT}' and ended_at is null`) === 'Garrett Robson:a:true,Joe:b:true,Nathan Toth:a:true', sql(`select string_agg(operator_name || ':' || coalesce(side, '-') || ':' || coalesce(match_id::text, 'null'), ',') from public.counter_operator_log where event_id = '${EVENT}'`));
  check('7. before the round the phones wait with the clock, and say so', await has(g, 'waiting for the round') && await has(j, 'waiting for the round'), (await body(g)).slice(0, 200));

  // ───────────── round 1: independent counting
  await tab.getByRole('button', { name: /Start round 1/ }).click();
  check('8. round 1 starts on the Lyst; COUNT is live on every phone', await until(async () => (await g.getByRole('button', { name: 'Count two points, head or torso' }).isEnabled().catch(() => false)) && (await j.getByRole('button', { name: 'Count two points, head or torso' }).isEnabled().catch(() => false)), 20000), await body(g));
  await tapTwo(g); await tapTwo(g); await tapOne(g);               // Garrett 5
  await tapTwo(n);                                                 // Nathan 2
  await tapTwo(j); await tapTwo(j); await tapOne(j); await tapOne(j);   // Joe 6
  const tots = () => [total('Garrett Robson', mid(1)), total('Nathan Toth', mid(1)), total('Joe', mid(1))].join(',');
  check('9. every phone\'s taps are its own evidence on the server: Garrett 5, Nathan 2, Joe 6 (two on one side, kept apart)', await untilDb(tots, '5,2,6', 15000) === '5,2,6', tots());
  check('9a. each phone shows its own count at once', (await shown(g)) === '5' && (await shown(n)) === '2' && (await shown(j)) === '6', `${await shown(g)} ${await shown(n)} ${await shown(j)}`);
  await shot(g, 'phone-a-counting'); await shot(n, 'phone-b-counting');
  // the tablet: all three, per side, compact, never summed
  const strip = async () => body(tab, '[data-testid=counter-evidence]');
  const stripNumbers = async () => (await tab.locator('[data-testid=counter-evidence] .ly-seat-n').allInnerTexts().catch(() => [])).map(t => t.trim()).sort().join(',');
  check('10. the scoring tablet shows all three counters beside the score, per side (Red: Garrett 5, Nathan 2 · Blue: Joe 6), never a combined number', await until(async () => { const s = await strip(); return /garrett robson/.test(s) && /nathan toth/.test(s) && /joe/.test(s) && (await stripNumbers()) === '2,5,6'; }, 20000)
    && (await tab.locator('[data-testid=counter-evidence] [data-testid=counter-row]').count()) === 3 && !/\b13\b|\b7\b/.test(await strip()), `${await strip()} :: ${await stripNumbers()}`);
  await shot(tab, 'tablet-evidence-strip');

  // ───────────── individual undo
  await j.getByRole('button', { name: 'Undo last' }).click();
  check('11. Joe undoes HIS last tap: 6 → 5; Garrett and Nathan are untouched', await untilDb(tots, '5,2,5', 10000) === '5,2,5' && (await shown(j)) === '5' && (await shown(g)) === '5', tots());
  check('11a. the undo is a row of its own naming Joe; nothing was deleted', sql(`select count(*) || ':' || string_agg(distinct operator_name, ',') from public.lyst_counts c join public.lyst_counter_seats s on s.id = c.seat_id where s.match_id = '${mid(1)}' and c.undo_of is not null`) === '1:Joe');

  // ───────────── Change Counter: Garrett hands phone A to Taylor
  await g.getByRole('button', { name: 'Change counter' }).click();
  await until(async () => await has(g, "who's counting"));
  check('12. Change Counter asks who is counting now, offering the current name', (await g.inputValue('#cp-name')) === 'Garrett Robson', await g.inputValue('#cp-name'));
  await g.fill('#cp-name', 'Taylor Robson'); await g.getByRole('button', { name: 'Continue' }).click();
  check('13. the handoff keeps the Lyst, the side and the tally (5); the screen names Taylor', await until(async () => await has(g, 'taylor robson') && (await shown(g)) === '5', 15000), (await body(g)).slice(0, 200));
  await tapOne(g);
  check('14. the next tap carries Taylor\'s name; Garrett\'s turn is closed on this fight, Taylor\'s is open on it; no tap was rewritten', await untilDb(() => sql(`select string_agg(operator_name || ':' || weight, ',' order by created_at) from public.lyst_counts c where c.seat_id = (select id from public.lyst_counter_seats where display_name = 'Taylor Robson' and match_id = '${mid(1)}' and status = 'active') and c.undo_of is null`), 'Garrett Robson:2,Garrett Robson:2,Garrett Robson:1,Taylor Robson:1', 10000) === 'Garrett Robson:2,Garrett Robson:2,Garrett Robson:1,Taylor Robson:1'
    && sql(`select (select (ended_at is not null and match_id = '${mid(1)}')::text from public.counter_operator_log where event_id = '${EVENT}' and operator_name = 'Garrett Robson') || '|' || (select (ended_at is null and match_id = '${mid(1)}')::text from public.counter_operator_log where event_id = '${EVENT}' and operator_name = 'Taylor Robson')`) === 'true|true');
  check('15. the tablet shows the phone under Taylor with the taps by each counter: Garrett Robson 5 · Taylor Robson 1', await until(async () => /garrett robson 5 · taylor robson 1/.test(await body(tab, '[data-testid=counter-operators]')), 15000), await body(tab, '[data-testid=counter-operators]'));
  await shot(tab, 'tablet-handoff-attribution');
  await shot(g, 'phone-a-handoff');

  // ───────────── one current fight per Lyst: a second tablet cannot switch Lyst 1 mid-round
  const hd = (await open('landscape', 'head')).page;
  await go(hd, `${EP}/field/Field%201?open=${mid(2)}&from=control`);
  check('16. a second tablet opening ANOTHER fight on Lyst 1 while round 1 runs is refused in words: "Lyst 1 is still in round 1 of Aldric Stone vs Brann Oakley"', await until(async () => await has(hd, 'lyst 1 is still in round 1 of aldric stone vs brann oakley'), 20000), (await body(hd)).slice(0, 400));
  check('16a. Lyst 1 still runs Aldric vs Brann; every phone is still on it', sql(`select match_id::text from public.lyst_field_current where event_id = '${EVENT}' and field_key = 'field 1'`) === mid(1) && sql(`select count(*) from public.lyst_counter_seats where match_id = '${mid(1)}' and status = 'active'`) === '3');
  await shot(hd, 'second-tablet-refused');

  // ───────────── "Done with round", end round, the marshal's call
  await j.getByRole('button', { name: 'Done with round' }).click();
  check('17. "Done with round" is recorded and the button says so (Round 1 sent ✓); it changes nothing official', await until(async () => await has(j, 'round 1 sent'), 10000) && sql(`select count(*) from public.lyst_counter_rounds r join public.lyst_counter_seats s on s.id = r.seat_id where s.display_name = 'Joe' and r.match_id = '${mid(1)}'`) === '1' && sql(`select count(*) from public.lyst_rounds where match_id = '${mid(1)}' and status = 'confirmed'`) === '0', await body(j));
  await tab.getByRole('button', { name: /End round/ }).click();
  await tab.locator('.ly-entry').waitFor({ timeout: 15000 });
  const hints = (await tab.locator('.ly-hints').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
  check('18. at End round each phone\'s tally stands beside the marshal\'s entry one by one (Taylor 6, Nathan 2 | Joe 5), never summed', /Taylor Robson · 6/.test(hints) && /Nathan Toth · 2/.test(hints) && /Joe · 5/.test(hints) && !/\b8\b|\b13\b/.test(hints), hints);
  check('18a. the phones stop and are told the round is over', await until(async () => /round over|confirming|ended|wait/i.test(await g.locator('[data-testid=cp-banner]').innerText().catch(() => '')), 15000), await g.locator('[data-testid=cp-banner]').innerText().catch(() => ''));
  const pick = (nm, k) => tab.getByRole('group', { name: `Quick score for ${nm}` }).getByRole('button', { name: String(k), exact: true });
  await pick('Aldric Stone', 7).click(); await pick('Brann Oakley', 4).click();
  await tab.getByRole('button', { name: 'Confirm round 7–4' }).click();
  check('19. the marshal confirms 7–4 (the phones said 6, 2 and 5): the official round is 7–4, nothing averaged, voted or copied', await untilDb(() => sql(`select coalesce((select official_a || '-' || official_b from public.lyst_round_scores where match_id = '${mid(1)}' and round_no = 1 and status = 'confirmed'), '')`), '7-4') === '7-4');
  check('19a. the evidence frozen with the call keeps every phone with the taps by each operator (Taylor\'s phone: Garrett 5 · Taylor 1)', sql(`select string_agg((c ->> 'operator') || ':' || (c ->> 'total') || '[' || coalesce((select string_agg((o ->> 'name') || '=' || (o ->> 'total'), ',') from jsonb_array_elements(c -> 'operators') o), '') || ']', ' ' order by c ->> 'side', c ->> 'operator') from public.lyst_round_revisions r, jsonb_array_elements(r.counters) c where r.match_id = '${mid(1)}' and r.round_no = 1`) === 'Nathan Toth:2[Nathan Toth=2] Taylor Robson:6[Garrett Robson=5,Taylor Robson=1] Joe:5[Joe=5]', sql(`select counters::text from public.lyst_round_revisions where match_id = '${mid(1)}'`));

  // ───────────── phone C goes offline and keeps tapping into a round that is over on the server; the fight is finished; the next fight opens
  await j.context().setOffline(true);
  await sleep(300);
  // (the round is over: the buttons are off on the phone that knows; this phone is offline and may still show the round as live until it hears)
  const fin = await rpc('scorekeeper', 'lyst_finalize', { p_command: crypto.randomUUID(), p_match: mid(1), p_expected_version: ver(mid(1)), p_result: 'a', p_basis: 'score', p_reason: null });
  check('20. FINISH through the official path: accepted on the official 7–4; the stored result carries no counter data', fin.body?.status === 'accepted' && sql(`select (result || ' ' || score_a || '-' || score_b) || '|' || (not (detail::text ~* 'counter|tally|seat|operator'))::text from public.matches where id = '${mid(1)}'`) === 'a 7-4|true', JSON.stringify(fin.body));
  const oldSeatJ = sql(`select id from public.lyst_counter_seats where display_name = 'Joe' and match_id = '${mid(1)}'`);
  const rowsJBefore = sql(`select count(*) from public.lyst_counts where seat_id = '${oldSeatJ}'`);
  // the Lyst moves on: "Next fight" (what the tablet's button calls)
  const nxt = await rpc('scorekeeper', 'lyst_open', { p_match: mid(2), p_counter_input: 'weighted' });
  check('21. the Lyst opens the next fight (Cael vs Dara); every phone follows by itself, same sides, at zero; the old places are ended with their evidence kept', nxt.status === 200 && await until(async () => await has(g, 'cael rhodes') && await has(n, 'cael rhodes'), 20000)
    && sql(`select string_agg(display_name || ':' || side, ',' order by side, display_name) from public.lyst_counter_seats where match_id = '${mid(2)}' and status = 'active'`) === 'Nathan Toth:a,Taylor Robson:a,Joe:b'
    && sql(`select count(*) from public.lyst_counter_seats where match_id = '${mid(1)}' and status = 'ended'`) === '3' && sql(`select count(*) from public.lyst_counts where match_id = '${mid(1)}'`) !== '0', (await body(g)).slice(0, 200));
  check('21a. each counter\'s turn moved to the new fight (Taylor, Nathan, Joe open on Cael vs Dara; their earlier turns closed)', sql(`select string_agg(operator_name || ':' || (match_id = '${mid(2)}')::text, ',' order by operator_name) from public.counter_operator_log where event_id = '${EVENT}' and ended_at is null`) === 'Joe:true,Nathan Toth:true,Taylor Robson:true');
  // a STALE action with the OLD place, by the phone's own token: refused, in people's words
  const tokJ = await deviceToken(j);
  const stale = await rpc(null, 'counter_record', { p_id: crypto.randomUUID(), p_seat: oldSeatJ, p_round: 1, p_weight: 1 }, tokJ);
  check('22. a stale tap with the earlier fight\'s place is refused by the server ("not counting now", never "seat"); nothing landed', stale.status >= 400 && /not counting now/.test(stale.body?.message ?? '') && !/seat/i.test(stale.body?.message ?? '') && sql(`select count(*) from public.lyst_counts where seat_id = '${oldSeatJ}'`) === rowsJBefore, JSON.stringify(stale.body));
  await j.context().setOffline(false);
  check('23. phone C back online follows to the new fight; its screen is on Dara (blue) at zero', await until(async () => await has(j, 'dara voss'), 25000) && await untilDb(() => total('Joe', mid(2)), '0', 10000) === '0', (await body(j)).slice(0, 300));
  check('23a. no tap from before the follow ever reached the new fight; the old fight\'s evidence is unchanged', sql(`select count(*) from public.lyst_counts where match_id = '${mid(2)}'`) === '0' && sql(`select count(*) from public.lyst_counts where seat_id = '${oldSeatJ}'`) === rowsJBefore);
  await shot(g, 'phone-a-next-fight');

  // ───────────── a PERSONAL phone: signed in as a fighter, enters Counter mode, counts, exits; the account is untouched
  const d = (await open('large', 'fighter')).page;
  await go(d, EP);
  const signedInBefore = await moreHasNotifications(d);
  check('24. a person\'s own phone is signed in (their account shows Notifications in More)', signedInBefore, await body(d));
  const tokenBefore = await d.evaluate(k => localStorage.getItem(k), STORAGE_KEY);
  const bd = await bind(d, 'Dana', /Lyst 1|Field 1/, 'BLUE', 'Dara Voss', 'cael rhodes vs dara voss');
  check('25. the same phone scans the Counter QR: Counter mode, Dana on Lyst 1 Blue, on Cael vs Dara at once; the account token is still stored underneath', bd === 'ok' && (await d.evaluate(k => localStorage.getItem(k), STORAGE_KEY)) === tokenBefore, bd);
  check('25a. the screen fits a large Android phone (412 wide) and shows Exit Counter, not "stop" or "sign out of the account"', await fits(d) && await has(d, 'exit counter'), (await body(d)).slice(0, 300));
  await shot(d, 'personal-phone-counting');
  await d.getByRole('button', { name: 'Exit Counter' }).click();
  check('26. Exit Counter asks once, in plain words (counts stay with the fight; scan again to count)', await until(async () => await has(d, 'exit counter?') && await has(d, 'scan the counter qr'), 8000), await body(d));
  await d.getByTestId('cp-exit').click();
  check('27. the phone leaves Counter mode: back on the ordinary site (not the device sign-in page), device session gone, the ACCOUNT TOKEN untouched', await until(async () => !d.url().includes('/device') && !d.url().includes('/lyst/counter') && (await d.evaluate(() => localStorage.getItem('bos-device-session'))) === null, 20000)
    && (await d.evaluate(k => localStorage.getItem(k), STORAGE_KEY)) === tokenBefore, d.url());
  await d.waitForLoadState('networkidle').catch(() => undefined);
  check('28. ... and the person is still signed in (Notifications in More); the server ended that counter session and its place on the Lyst, evidence kept', await moreHasNotifications(d)
    && await untilDb(() => sql(`select coalesce((select status from public.lyst_counter_seats where display_name = 'Dana' order by requested_at desc limit 1), '')`), 'ended', 10000) === 'ended'
    && sql(`select count(*) from public.counter_bindings where operator_name = 'Dana'`) === '0'
    && sql(`select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.kind = 'counter_pool' and c.event_id = '${EVENT}' and s.ended_at is null`) === '3', d.url());
  await shot(d, 'personal-phone-after-exit');
  // the phone remembers its counter's name on the next scan
  await go(d, `/device#c=${poolCode}`);
  check('29. scanning again, the phone offers the last name typed on it (a name, never a sign-in)', await until(async () => await has(d, "who's counting"), 30000) && (await d.inputValue('#cp-name')) === 'Dana', await d.inputValue('#cp-name').catch(() => ''));
  await shot(d, 'rescan-remembers-name');
  // the other three phones still count on the new fight
  check('30. the other three phones were never affected by any of this: still three sessions, three places on Cael vs Dara', sql(`select count(*) from public.lyst_counter_seats where match_id = '${mid(2)}' and status = 'active' and display_name in ('Taylor Robson', 'Nathan Toth', 'Joe')`) === '3');

  // ───────────── public privacy and page health
  const anon = await rest(null, 'GET', `lyst_public_state?event_id=eq.${EVENT}&select=*`);
  check('31. the public Lyst state carries no counter, operator or session data', anon.status === 200 && !JSON.stringify(anon.body).match(/counter|operator|seat|session|garrett|taylor|nathan|joe|dana/i), JSON.stringify(anon.body).slice(0, 300));
  for (const [nm, tbl] of [['lyst_counts', 'lyst_counts'], ['seats', 'lyst_counter_seats'], ['bindings', 'counter_bindings'], ['operator log', 'counter_operator_log'], ['sessions', 'event_sessions']]) {
    const r = await rest(null, 'GET', `${tbl}?select=*&limit=1`);
    check(`31${nm[0]}. anon cannot read ${nm}`, r.status === 401 || r.status === 403 || (r.status === 200 && Array.isArray(r.body) && r.body.length === 0), `${r.status}`);
  }
  check('32. no page errors on any phone or tablet', [g, n, j, d, tab, hd].every(p => p.errors.length === 0), JSON.stringify([g.errors, n.errors, j.errors, d.errors, tab.errors, hd.errors]));
} catch (e) {
  check('script ran to the end', false, e && e.stack ? e.stack : String(e));
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser.close();
}
const pass = results.filter(r => r.ok).length;
console.log(`\n${pass}/${results.length} checks passed`);
if (SHOTS) { try { fs.writeFileSync(`${SHOTS}/evidence.json`, JSON.stringify({ results, evidence: E }, null, 2)); } catch { /* ignore */ } }
process.exit(pass === results.length ? 0 : 1);
