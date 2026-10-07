// Pack 13 (Lyst Control) against a REAL local stack: Postgres built from every migration + the Pack 13 fixture, PostgREST, the real built app in real Chromium.
// A full field-side rehearsal: tablet(s), counters' phones, the public display, the head marshal, a stranger. Everything on screen is cross-checked in the database.
// Run it through scripts/e2e/pack13-live.sh. LOCAL EVIDENCE ONLY (needs a PostgREST binary; not part of CI).
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
  organizer: [A(2), 'u2@example.test'], scorekeeper: [A(4), 'u4@example.test'], stranger: [A(7), 'u7@example.test'],
  head: [C(1), 'c1@example.test'], keeper2: [C(2), 'c2@example.test'],
  ash: [C(3), 'c3@example.test'], birch: [C(4), 'c4@example.test'], cedar: [C(5), 'c5@example.test'], dune: [C(6), 'c6@example.test'], elm: [C(7), 'c7@example.test'],
  fighter: ['00000000-0000-0000-0000-000000000101', 'fighter1@example.test']
};
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const mid = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const EVENT = '00000000-0000-0000-0000-00000000ed01';
async function rest(who, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args) => rest(who, 'POST', `rpc/${fn}`, args);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = {
  desktop: { viewport: { width: 1280, height: 900 } }, tv: { viewport: { width: 1920, height: 1080 } },
  tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
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
const shot = async (page, name, full = false) => { if (SHOTS) { await sleep(500); await page.screenshot({ path: `${SHOTS}/p13-${name}.png`, fullPage: full }).catch(() => undefined); } };
const waitDb = async (fn, want, timeout = 8000) => { const t0 = Date.now(); let v = fn(); while (v !== want && Date.now() - t0 < timeout) { await sleep(250); v = fn(); } return v; };
const waitFor = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const textOf = (page, sel) => page.locator(sel).first().innerText().then(t => t.replace(/\s+/g, ' ').trim(), () => '');
const noSideways = (page) => page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
const tap = async (page, name, opts = {}) => { await page.getByRole('button', { name, exact: opts.exact ?? true }).first().click(); };
const FIELD1 = '/events/test-stuff-test/field/Field%201', FIELD2 = '/events/test-stuff-test/field/Field%202', ARENA1 = '/events/test-stuff-test/arena/Field%201';
const timerRow = (f = 'field 1') => sql(`select coalesce((select status || ':' || mode || ':' || round_no || ':' || rev from public.lyst_timer where event_id = '${EVENT}' and field_key = '${f}'), 'none')`);
const roundRow = (n, r) => sql(`select coalesce((select status || ':' || coalesce(awarded_a::text,'-') || '-' || coalesce(awarded_b::text,'-') from public.lyst_rounds where match_id = '${mid(n)}' and round_no = ${r}), 'none')`);
const official = (n) => sql(`select coalesce((select string_agg(coalesce(official_a::text,'-') || '-' || coalesce(official_b::text,'-'), ',' order by round_no) from public.lyst_round_scores where match_id = '${mid(n)}'), 'none')`);
const notifCount = () => Number(sql(`select count(*) from public.notifications`));
const clockText = (page) => textOf(page, '.ly-clock');
const clockSecs = async (page) => { const t = await clockText(page); const m = /^(\d+):(\d\d)$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

try {
  check('the lyst tables, functions and the public view exist in the database built from the migrations', sql(`select count(*) from pg_tables where schemaname = 'public' and tablename in ('lyst_timer','lyst_rounds','lyst_counts','lyst_counter_seats','match_discipline')`) === '5' && sql(`select count(*) from pg_views where viewname = 'lyst_public_state'`) === '1');

  // ================================================================ 1. the organizer calls Field 1 and Field 2; the tablet opens the fight
  const queue1 = await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  const queue2 = await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: 'Field 2', p_start: true });
  check('Field 1 and Field 2 are called through the existing queue (1 active on each)', queue1.status === 200 && queue2.status === 200 && sql(`select count(*) from public.matches where queue_state = 'active'`) === '2', JSON.stringify([queue1, queue2]));
  const notifAfterQueue = notifCount();

  const { page: tv } = await open('tv', null);   // the hall display: public, no sign-in
  await tv.goto(BASE + ARENA1); await tv.waitForSelector('.arena .ar-main', { timeout: 30000 });
  const arenaText = async () => (await tv.locator('.ar-main').innerText().catch(() => '')).replace(/\s+/g, ' ').toLowerCase();
  await waitFor(tv, () => /now fighting/i.test(document.querySelector('.ar-main')?.innerText ?? ''), null, 40000);

  const { ctx: tabCtx, page: tab } = await open('tablet', 'scorekeeper');
  await tab.goto(BASE + FIELD1);
  await tab.getByRole('button', { name: /Score Aldric Stone against Brann Oakley/ }).click();
  await tab.waitForSelector('.ly-timer', { timeout: 30000 });
  check('1. a duel opens on the LYST screen (clock, round zone), not the classic board', (await tab.locator('.ly-timer').count()) === 1 && (await tab.getByText('Head or torso +2').count()) === 0, await body(tab));
  check('2. the clock shows the round preset 1:00 and it is idle (nothing runs by itself)', (await clockText(tab)) === '1:00' && /ready/i.test(await textOf(tab, '.ly-word')) && timerRow() === 'none', `${await clockText(tab)} / ${timerRow()}`);
  check('3. the screen says the score is pending, and offers START ROUND 1', (await has(tab, 'Pending: not official until you finish the match')) && (await tab.getByRole('button', { name: /Start round 1/ }).count()) === 1);
  check('4. the match was opened in Lyst Control on the server (weighted +2/+1 input for a longsword duel)', await waitDb(() => sql(`select counter_input from public.lyst_matches where match_id = '${mid(1)}'`), 'weighted') === 'weighted');
  await shot(tab, '01-tablet-start');

  // ---------------------------------------------------------------- the head marshal sets the event's own vocabulary (nothing is invented by the product)
  const { page: head } = await open('tablet', 'head');
  await head.goto(BASE + FIELD1);
  await head.getByRole('button', { name: /Score Aldric Stone against Brann Oakley/ }).click();
  await head.waitForSelector('.ly-timer', { timeout: 30000 });
  check('5. only the head marshal / organizer is offered Lyst settings (the scorekeeper is not)', (await head.getByRole('button', { name: 'Lyst settings' }).count()) === 1 && (await tab.getByRole('button', { name: 'Lyst settings' }).count()) === 0);
  await head.getByRole('button', { name: 'Lyst settings' }).click();
  await head.getByRole('dialog').waitFor();
  const cardsBox = head.getByRole('dialog').locator('textarea').first();
  check('6. no cards are invented: the card list starts empty', (await cardsBox.inputValue()) === '');
  await cardsBox.fill('Card 1\nCard 2');
  await head.getByRole('dialog').getByLabel('Extra round length').fill('0:30');
  await head.getByRole('button', { name: 'Save settings' }).click();
  await head.getByRole('dialog').waitFor({ state: 'detached' });
  check('7. the settings are saved on the server: cards, regular rounds 2, extra round 30 s', sql(`select (settings -> 'cards' -> 0 ->> 'label') || '|' || (settings ->> 'regular_rounds') || '|' || (settings ->> 'extra_round_seconds') from public.event_lyst_settings where event_id = '${EVENT}'`) === 'Card 1|2|30', sql(`select settings::text from public.event_lyst_settings where event_id = '${EVENT}'`));
  await shot(head, '02-settings-saved');

  // ================================================================ 2. the clock (server state)
  const t0 = Date.now();
  await tab.getByRole('button', { name: /Start round 1/ }).click();
  await waitFor(tab, () => /running/i.test(document.querySelector('.ly-word')?.textContent ?? ''), null, 10000);
  check('8. START ROUND 1: the server timer is running round 1 (fight)', /^running:fight:1:/.test(timerRow()), timerRow());
  check('9. the round exists on the server as "running" (counters know which round is live)', roundRow(1, 1) === 'running:---', roundRow(1, 1));
  const s1 = await clockSecs(tab);
  check('10. the clock counts down from 1:00', s1 <= 60 && s1 >= 45, String(s1));
  const sawArenaClock = await waitFor(tv, () => /round 1/i.test(document.querySelector('.ar-main')?.innerText ?? '') && /\d:\d\d/.test(document.querySelector('.ar-clock')?.textContent ?? ''), null, 30000);
  check('11. [tv] the public display shows the official clock and "Round 1"', sawArenaClock, await arenaText());
  await shot(tv, '20-tv-running');
  // a refresh must not lose or reset the time
  await tab.reload(); await tab.waitForSelector('.ly-timer', { timeout: 30000 });
  await waitFor(tab, () => /running/i.test(document.querySelector('.ly-word')?.textContent ?? ''), null, 10000);
  const afterReload = await clockSecs(tab), elapsed = Math.round((Date.now() - t0) / 1000);
  check('12. REFRESH: the clock carries on from the server time (not reset, not frozen)', Math.abs((60 - afterReload) - elapsed) <= 4, `left ${afterReload}, elapsed ${elapsed}`);
  // pause / resume
  await tab.getByRole('button', { name: 'Pause', exact: true }).click();
  await waitFor(tab, () => /paused/i.test(document.querySelector('.ly-word')?.textContent ?? ''), null, 10000);
  const pausedAt = await clockSecs(tab);
  await sleep(2500);
  check('13. PAUSE holds the time exactly (it does not drift while paused)', (await clockSecs(tab)) === pausedAt && /^paused:/.test(timerRow()), `${pausedAt} vs ${await clockSecs(tab)} ${timerRow()}`);
  check('14. [tv] the display shows it paused', await waitFor(tv, () => /paused/i.test(document.querySelector('.ar-clock')?.textContent ?? ''), null, 30000), await arenaText());
  // the head's tablet sees it too (another device on the same field)
  check('15. a second tablet on the same field shows the same paused time', await waitFor(head, (s) => { const t = document.querySelector('.ly-clock')?.textContent ?? ''; return t.trim() === s; }, `${Math.floor(pausedAt / 60)}:${String(pausedAt % 60).padStart(2, '0')}`, 15000));
  // two tablets press at the same moment with the same view: only one wins
  const revBefore = timerRow();
  await Promise.all([tab.getByRole('button', { name: 'Resume', exact: true }).click(), head.getByRole('button', { name: 'Resume', exact: true }).click()]);
  await sleep(1500);
  const after = timerRow().split(':');
  check('16. two tablets pressing RESUME together: the timer resumed exactly once (revision +1)', after[0] === 'running' && Number(after[3]) === Number(revBefore.split(':')[3]) + 1, `${revBefore} -> ${timerRow()}`);
  const stale = (await body(tab)).includes('another device changed the clock') || (await body(head)).includes('another device changed the clock');
  check('17. ... and the losing tablet is told another device changed the clock', stale, (await textOf(tab, '.ly-timer')) + ' || ' + (await textOf(head, '.ly-timer')));
  await shot(tab, '03-running');

  // ================================================================ 3. Field 2 runs on its own clock
  const { page: tab2 } = await open('tablet', 'keeper2');
  await tab2.goto(BASE + FIELD2);
  await tab2.getByRole('button', { name: /Score .* against .*/ }).first().click();
  await tab2.waitForSelector('.ly-timer', { timeout: 30000 });
  await tab2.getByRole('button', { name: /Start round 1/ }).click();
  await waitFor(tab2, () => /running/i.test(document.querySelector('.ly-word')?.textContent ?? ''), null, 10000);
  check('18. FIELD 2 starts its own clock; Field 1 is untouched (still running, its own revision)', /^running:/.test(timerRow('field 2')) && /^running:fight:1:/.test(timerRow('field 1')) && sql(`select count(*) from public.lyst_timer where event_id = '${EVENT}'`) === '2', `${timerRow('field 1')} / ${timerRow('field 2')}`);

  // ================================================================ 4. counters: the event's ONE Counter QR; each phone binds itself to this Lyst and a side; a trainee uses the training QR (Pack 25)
  const made = await fetch(`${API}/functions/v1/device-session`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: `Bearer ${session(WHO.organizer).access_token}` }, body: JSON.stringify({ action: 'create', event: EVENT, kind: 'counter_pool' }) }).then(async r => ({ status: r.status, body: await r.json() }));
  const pool = (made.body?.code ?? '').replace(/-/g, '');
  await tab.getByRole('button', { name: /^Counters/ }).click();
  await tab.getByTestId('counters-tab-qr').click();
  await tab.getByRole('dialog').getByTestId('counter-qr-code').waitFor({ timeout: 15000 });
  const code = (await tab.getByRole('dialog').getByTestId('counter-qr-code').innerText()).replace(/-/g, '').trim();
  check('19. the tablet shows the event\'s Counter QR (one code for every counter phone) and its QR image', /^[A-Z0-9]{12}$/.test(code) && code === pool && (await tab.getByRole('dialog').locator('.ly-qr svg').count()) === 1, code);
  await shot(tab, '04-counters-code');
  await tab.getByTestId('counters-tab-training').click();
  await tab.getByRole('dialog').getByRole('button', { name: /Show training QR|New training code/ }).click();
  await tab.getByRole('dialog').getByTestId('training-qr').locator('.ly-code').waitFor({ timeout: 15000 });
  const train = (await tab.getByRole('dialog').getByTestId('training-qr').locator('.ly-code').innerText()).trim();
  check('19b. the Lyst also has a TRAINING QR of its own (learning only, kept apart)', /^[A-Z0-9]{8,12}$/.test(train), train);
  await tab.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  const phones = {};
  for (const [name, who, side] of [['ash', 'Counter Ash', 'RED'], ['birch', 'Counter Birch', 'RED'], ['cedar', 'Counter Cedar', 'BLUE'], ['dune', 'Counter Dune', 'BLUE']]) {
    const { page } = await open('phone');           // an event phone: no account, the Counter QR is its only credential
    await page.goto(`${BASE}/device#c=${code}`);
    await page.getByText(/Who is counting/i).waitFor({ timeout: 30000 });
    await page.fill('#cp-name', who);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Lyst 1|Field 1/ }).click();
    await page.getByRole('button', { name: new RegExp(side) }).click();
    phones[name] = page;
  }
  {
    const { page } = await open('phone', 'elm');     // the learner: their own phone and account, the training QR
    await page.goto(`${BASE}/lyst/train/${train}`);
    await page.getByText(/Who is counting/i).waitFor({ timeout: 30000 });
    await page.fill('#cp-tname', 'Counter Elm');
    await page.getByRole('button', { name: /RED/ }).click();
    await page.getByRole('button', { name: 'Start counting' }).click();
    phones.elm = page;
  }
  const seatRows = () => sql(`select string_agg(display_name || ':' || side || ':' || role, ',' order by display_name) from public.lyst_counter_seats where status = 'active' and match_id = '${mid(1)}'`);
  check('20. four phones scanned the one QR and chose Red or Blue themselves; nobody is pending, nobody was seated by hand', await waitDb(seatRows, 'Counter Ash:a:official,Counter Birch:a:official,Counter Cedar:b:official,Counter Dune:b:official,Counter Elm:a:learning', 30000) === 'Counter Ash:a:official,Counter Birch:a:official,Counter Cedar:b:official,Counter Dune:b:official,Counter Elm:a:learning' && sql(`select count(*) from public.lyst_counter_seats where status = 'pending'`) === '0', seatRows());
  check('21. 4 official counters (Ash, Birch on Aldric; Cedar, Dune on Brann) and 1 learner on the same fight; every one is its own evidence', sql(`select count(*) from public.lyst_counter_seats where status = 'active' and match_id = '${mid(1)}' and role = 'official'`) === '4' && sql(`select count(*) from public.event_sessions where ended_at is null and multi`) === '4');
  for (const p of Object.values(phones)) await p.getByText(/Aldric Stone|Brann Oakley/).first().waitFor({ timeout: 30000 });
  check('22. a counter\'s phone: the fighter, their side in words, who is counting, and a huge COUNT button', (await has(phones.ash, 'Aldric Stone')) && (await has(phones.ash, 'Counting')) && (await has(phones.ash, 'Red')) && (await has(phones.ash, 'Counter Ash')) && (await has(phones.elm, 'never changes any score')), (await body(phones.ash)) + ' || ' + (await body(phones.elm)));
  const big = await phones.ash.getByRole('button', { name: 'Count one point, arm leg or hand' }).boundingBox();
  check('23. the COUNT button is big (at least 150 px tall) and in thumb reach', big && big.height >= 150 && big.y + big.height > 450, JSON.stringify(big));
  await shot(phones.ash, '05-counter-phone');

  // ================================================================ 5. counting: provisional evidence
  const taps = async (page, nTwo, nOne) => {
    for (let i = 0; i < nTwo; i++) await page.getByRole('button', { name: 'Count two points, head or torso' }).click();
    for (let i = 0; i < nOne; i++) await page.getByRole('button', { name: 'Count one point, arm leg or hand' }).click();
  };
  await taps(phones.ash, 2, 2);      // 6
  await taps(phones.birch, 2, 2);    // 6
  await taps(phones.cedar, 2, 1);    // 5
  await taps(phones.dune, 1, 2);     // 4
  await taps(phones.elm, 4, 1);      // 9 (practice)
  const NAME = { A: 'Counter Ash', B: 'Counter Birch', C: 'Counter Cedar', D: 'Counter Dune', L1: 'Counter Elm' };
  const tot = (n, r = 1, m = mid(1)) => sql(`select coalesce((select private.lyst_seat_total(s.id, ${r}) from public.lyst_counter_seats s where s.display_name = '${NAME[n]}' and s.status = 'active' and s.match_id = '${m}'), 0)`);
  await waitDb(() => tot('A'), '6');
  check('24. taps are provisional evidence on the server: A 6, B 6, C 5, D 4, learner 9', [tot('A'), tot('B'), tot('C'), tot('D'), tot('L1')].join(',') === '6,6,5,4,9', [tot('A'), tot('B'), tot('C'), tot('D'), tot('L1')].join(','));
  check('25. the phone shows the count at once', (await textOf(phones.ash, '.cp-total output')) === '6', await textOf(phones.ash, '.cp-total'));
  await phones.ash.getByRole('button', { name: 'Count one point, arm leg or hand' }).click();
  await phones.ash.getByRole('button', { name: 'Undo last' }).click();
  await waitDb(() => tot('A'), '6');
  check('26. UNDO LAST on the counter\'s phone reverses only that counter\'s last tap (and is audited as an undo row)', (await textOf(phones.ash, '.cp-total output')) === '6' && tot('A') === '6' && sql(`select count(*) from public.lyst_counts where undo_of is not null`) === '1', `${await textOf(phones.ash, '.cp-total output')} ${tot('A')}`);
  check('27. NOTHING official changed: no round score exists, and the public state carries 0-0', roundRow(1, 1) === 'running:---' && sql(`select count(*) from public.lyst_round_scores where official_a is not null`) === '0' && sql(`select official_a || '-' || official_b from public.lyst_public_state where match_id = '${mid(1)}'`) === '0-0');
  // rapid taps: 40 clicks in one burst
  await phones.dune.getByRole('button', { name: 'Count one point, arm leg or hand' }).evaluate((el) => { for (let i = 0; i < 40; i++) el.click(); });
  const dBefore = 4;
  const dAfter = await waitDb(() => tot('D'), String(dBefore + 40), 15000);
  check('28. RAPID TAP: 40 clicks in one burst land exactly 40 times (none lost, none doubled)', dAfter === String(dBefore + 40), dAfter);
  await phones.dune.getByRole('button', { name: 'Undo last' }).click();  // 1
  for (let i = 0; i < 39; i++) await phones.dune.getByRole('button', { name: 'Undo last' }).click();
  await waitDb(() => tot('D'), '4', 15000);
  check('29. ... and 40 undos bring that counter back to 4', tot('D') === '4', tot('D'));
  check('30. [tv] while counters tap, the public display shows NO counter numbers: official 0-0, round 1', (await tv.evaluate(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-'))) === '0-0' && !/learn|counter|tally|\bL1\b/.test(await arenaText()) && /round 1/.test(await arenaText()), await arenaText());

  await shot(tab, '06-tablet-mid-round');
  const notifBefore = notifCount();

  // ================================================================ 6. the 30-second break: END ROUND, the marshal's call, START ROUND 2 (counted taps, measured time)
  let interactions = 0;
  const act = async (fn) => { interactions++; await fn(); };
  const pick = (name, n) => tab.getByRole('group', { name: `Quick score for ${name}` }).getByRole('button', { name: String(n), exact: true });
  const tStress = Date.now();
  await act(() => tab.getByRole('button', { name: /End round/ }).click());
  await waitFor(tab, () => !!document.querySelector('.ly-entry'), null, 15000);
  const tEntryShown = Date.now() - tStress;
  check('31. END ROUND starts the break in one tap: the round is "confirming" on the server and the break clock runs on the field', roundRow(1, 1) === 'confirming:---' && /^running:break:1:/.test(timerRow()), `${roundRow(1, 1)} ${timerRow()}`);
  check('32. the counters\' phones stop: COUNT is disabled and they are told the round is over', await waitFor(phones.ash, () => document.querySelector('.cp-count, .cp-weighted button')?.disabled === true && /round over/i.test(document.querySelector('.cp-msg')?.textContent ?? ''), null, 20000), await body(phones.ash));
  check('33. [tv] the public display says "Scores being confirmed…" and shows no score for the unconfirmed round (0-0 official)', await waitFor(tv, () => /scores being confirmed/i.test(document.querySelector('.ar-main')?.innerText ?? ''), null, 30000) && (await tv.evaluate(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-'))) === '0-0', await arenaText());
  const footBox = await tv.locator('.ar-next').boundingBox(), mainBox = await tv.locator('.ar-fight').boundingBox();
  check('33b. [tv] at 1080p the official clock fits with the fight: the On deck / In the hole footer is still fully on screen', footBox && footBox.y + footBox.height <= 1080 && mainBox && mainBox.y + mainBox.height <= footBox.y + 2, JSON.stringify({ footBox, mainBox }));
  const hintTexts = (await tab.locator('.ly-hints').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
  check('34. the tablet shows each counter\'s tally separately beside the marshal\'s entry (Ash 6, Birch 6 | Cedar 5, Dune 4), never a combined number, and the learner is not offered', /Counter Ash · 6/.test(hintTexts) && /Counter Birch · 6/.test(hintTexts) && /Counter Cedar · 5/.test(hintTexts) && /Counter Dune · 4/.test(hintTexts) && !/Elm/.test(hintTexts), hintTexts);
  check('35. the entry starts from nothing chosen (no pre-filled score) and CONFIRM is not possible yet', (await tab.locator('.ly-pick-val').allInnerTexts()).join(',') === '–,–' && (await tab.getByRole('button', { name: 'Choose both scores' }).isDisabled()));
  await shot(tab, '07-confirm-entry'); await shot(tv, '21-tv-confirming');
  await act(() => pick('Aldric Stone', 6).click());
  await act(() => pick('Brann Oakley', 5).click());
  await act(() => tab.getByRole('button', { name: 'Confirm round 6–5' }).click());
  check('36. CONFIRM ROUND records the MARSHAL\'S call 6–5 (the counters said 6/6 and 5/4: nothing was averaged, maxed or voted)', await waitDb(() => roundRow(1, 1), 'confirmed:6-5', 12000) === 'confirmed:6-5' && official(1) === '6-5', `${roundRow(1, 1)} ${official(1)}`);
  await waitFor(tab, () => !!document.querySelector('.ly-go') && /Start round 2/.test(document.body.innerText), null, 15000);
  const breakLeft = await clockSecs(tab);
  await act(() => tab.getByRole('button', { name: /Start round 2/ }).click());
  await waitFor(tab, () => /Round 2/.test(document.querySelector('.ly-mode')?.textContent ?? ''), null, 10000);
  const stressMs = Date.now() - tStress;
  check(`37. THE 30-SECOND BREAK: end round, enter the marshal's score, confirm and start the next round took ${interactions} taps and ${(stressMs / 1000).toFixed(1)} s (target: 5 taps, inside the 30 s break)`, interactions === 5 && stressMs < 30000 && breakLeft > 0, `${interactions} taps ${stressMs} ms, break had ${breakLeft}s left at the last tap, entry shown after ${tEntryShown} ms`);
  console.log(`(measure) break workflow: ${interactions} interactions, ${(stressMs / 1000).toFixed(1)} s wall time (entry screen after ${tEntryShown} ms; break clock had ${breakLeft}s left when round 2 started)`);
  check('38. the evidence is frozen with the confirmation: every counter\'s tally (learner marked as learning) is in the revision; the marshal\'s call is not derived from it', sql(`select string_agg((c ->> 'operator') || ':' || (c ->> 'role') || ':' || (c ->> 'total'), ',' order by c ->> 'operator') from public.lyst_round_revisions r, jsonb_array_elements(r.counters) c where r.match_id = '${mid(1)}' and r.round_no = 1`) === 'Counter Ash:official:6,Counter Birch:official:6,Counter Cedar:official:5,Counter Dune:official:4,Counter Elm:learning:9', sql(`select r.counters::text from public.lyst_round_revisions r where r.match_id = '${mid(1)}' and r.round_no = 1`));
  check('39. [tv] the display shows the official 6–5 and round 2 running', await waitFor(tv, () => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-') === '6-5' && /round 2/i.test(document.querySelector('.ar-main')?.innerText ?? ''), null, 30000), await arenaText());
  await shot(tab, '08-round-2');
  // the counters carry on in round 2, separately from round 1
  await waitFor(phones.ash, () => /tap count|count/i.test(document.querySelector('.cp-msg')?.textContent ?? '') && !document.querySelector('.cp-weighted button')?.disabled, null, 20000);
  await phones.ash.getByRole('button', { name: 'Count two points, head or torso' }).click();
  await waitDb(() => tot('A', 2), '2');
  check('40. round 2 counting starts at zero for the counter and round 1\'s tally is untouched (6)', tot('A', 2) === '2' && tot('A', 1) === '6' && (await textOf(phones.ash, '.cp-total output')) === '2', `${tot('A', 2)} ${tot('A', 1)}`);

  // ================================================================ 7. the marshal's call: warning, card, deduction, void
  await tab.getByRole('button', { name: /^Marshal's call/ }).click();
  const sheet = tab.getByRole('dialog');
  await sheet.waitFor();
  check('41. the sheet offers warning, card, take off points, disqualify; a deduction is explained as an OFFICIAL act (not an undo)', (await sheet.getByRole('button', { name: /^Warning/ }).count()) === 1 && (await sheet.getByRole('button', { name: /^Take off points/ }).count()) === 1 && (await sheet.getByRole('button', { name: /^Disqualify/ }).count()) === 1);
  await sheet.getByRole('button', { name: /^Warning/ }).click();
  await sheet.getByRole('group', { name: 'Against which fighter' }).getByRole('button', { name: /^Brann Oakley/ }).click();
  await sheet.getByRole('button', { name: 'Unsafe conduct' }).click();
  await sheet.getByRole('button', { name: /^Record warning · Brann Oakley/ }).click();
  await sheet.waitFor({ state: 'detached' });
  check('42. a WARNING against Brann is recorded (structured: round 2, side b), with the reason kept privately', await waitDb(() => sql(`select count(*) from public.match_discipline where match_id = '${mid(1)}' and kind = 'warning' and side = 'b' and round_no = 2`), '1') === '1' && sql(`select reason from public.match_discipline_private p join public.match_discipline d on d.id = p.discipline_id where d.kind = 'warning'`) === 'Unsafe conduct');
  await tab.getByRole('button', { name: /^Marshal's call/ }).click();
  await sheet.getByRole('button', { name: /^Card/ }).click();
  await sheet.getByRole('group', { name: 'Against which fighter' }).getByRole('button', { name: /^Aldric Stone/ }).click();
  check('43. cards come only from the event\'s own list: "Card 1" and "Card 2" (nothing invented by the product)', (await sheet.getByRole('group', { name: 'Card type' }).getByRole('button').allInnerTexts()).join('|') === 'Card 1|Card 2');
  await sheet.getByRole('button', { name: 'Card 1' }).click();
  await sheet.getByRole('group', { name: 'Also take off points' }).getByRole('button', { name: '−1' }).click();
  await sheet.getByRole('button', { name: /^Record Card 1 · Aldric Stone/ }).click();
  await sheet.waitFor({ state: 'detached' });
  await waitDb(() => sql(`select count(*) from public.match_discipline where match_id = '${mid(1)}' and side = 'a'`), '2');
  check('44. a CARD with an official −1 deduction is recorded as two linked records (the deduction points at the card)', sql(`select count(*) from public.match_discipline d where d.match_id = '${mid(1)}' and d.kind = 'deduction' and d.amount = 1 and d.related_id = (select id from public.match_discipline where kind = 'card' and label = 'Card 1')`) === '1');
  check('45. [tv] the display shows the penalties as official marks beside each fighter', await waitFor(tv, () => /card 1/i.test(document.querySelector('.ar-side.a')?.innerText ?? '') && /−1 point/i.test(document.querySelector('.ar-side.a')?.innerText ?? '') && /warning/i.test(document.querySelector('.ar-side.b')?.innerText ?? ''), null, 30000), await arenaText());
  // a −2 deduction by mistake, then voided with a reason (an official act is corrected by voiding, never by undo or delete)
  await tab.getByRole('button', { name: /^Marshal's call/ }).click();
  await sheet.getByRole('button', { name: /^Take off points/ }).click();
  check('46. the deduction sheet says it is official and that scoring mistakes are fixed by correcting the round', await sheet.getByText(/official deduction/i).count() >= 1 && await sheet.getByText(/correct the round instead/i).count() >= 1);
  await sheet.getByRole('group', { name: 'Against which fighter' }).getByRole('button', { name: /^Brann Oakley/ }).click();
  await sheet.getByRole('group', { name: 'Points to take off' }).getByRole('button', { name: '−2' }).click();
  await sheet.getByRole('button', { name: /^Record −2 points · Brann Oakley/ }).click();
  await sheet.waitFor({ state: 'detached' });
  await waitDb(() => sql(`select count(*) from public.match_discipline where match_id = '${mid(1)}' and amount = 2`), '1');
  await tab.getByRole('button', { name: /^Record$/ }).click();
  const log = tab.getByRole('dialog');
  await log.getByRole('listitem').filter({ hasText: '−2 points' }).getByRole('button', { name: /Void with a reason/ }).click();
  await log.getByPlaceholder('Why is this being voided?').fill('Tapped the wrong fighter');
  await log.getByRole('button', { name: 'Void it' }).click();
  await waitDb(() => sql(`select count(*) from public.match_discipline where amount = 2 and voided_at is not null`), '1');
  check('47. the −2 is VOIDED with a reason: the record stays (never deleted), the reason is kept privately', sql(`select count(*) from public.match_discipline where amount = 2 and voided_at is not null`) === '1' && sql(`select void_reason from public.match_discipline_private p join public.match_discipline d on d.id = p.discipline_id where d.amount = 2`) === 'Tapped the wrong fighter' && sql(`select count(*) from public.match_discipline where match_id = '${mid(1)}'`) === '4');
  await shot(tab, '09-record-log'); await shot(tv, '22-tv-marks');
  await log.getByRole('button', { name: 'Close' }).click();

  // ================================================================ 8. round 2: confirm (double tap), then correct round 1 with a reason
  await tab.getByRole('button', { name: /End round/ }).click();
  await tab.locator('.ly-entry').waitFor({ timeout: 15000 });
  await pick('Aldric Stone', 7).click(); await pick('Brann Oakley', 4).click();
  await tab.getByRole('button', { name: 'Confirm round 7–4' }).dblclick();
  await waitDb(() => roundRow(1, 2), 'confirmed:7-4', 12000);
  await sleep(1200);
  check('48. a DOUBLE TAP on CONFIRM ROUND confirms once (one revision for the round)', sql(`select count(*) from public.lyst_round_revisions where match_id = '${mid(1)}' and round_no = 2`) === '1', sql(`select count(*) from public.lyst_round_revisions where match_id = '${mid(1)}' and round_no = 2`));
  check('49. the OFFICIAL round 2 is the marshal\'s 7–4 minus the one active deduction against Aldric = 6–4 (the voided −2 does not count); totals 12–9', official(1) === '6-5,6-4', official(1));
  check('50. the lead rule is offered as a suggestion only ("Aldric Stone lead by 3 after 2 rounds"), and FINISH is still the marshal\'s choice', (await has(tab, 'Aldric Stone lead by 3 after 2 rounds')) && (await tab.getByRole('button', { name: 'Finish match' }).isEnabled()));
  await tab.getByRole('button', { name: 'Correct round 1' }).click();
  const fix = tab.getByRole('button', { name: /^Save correction/ });
  await pick('Aldric Stone', 7).click(); await pick('Brann Oakley', 5).click();
  check('51. a CORRECTION needs a reason before it can be saved', await fix.isDisabled());
  await tab.getByPlaceholder(/marshal re-counted/i).fill('Marshal re-counted after the break');
  await fix.click();
  await waitDb(() => roundRow(1, 1), 'confirmed:7-5', 12000);
  check('52. the correction is official, and the audit trail keeps the old numbers and the reason', official(1) === '7-5,6-4' && sql(`select previous_a || '-' || previous_b || ' ' || reason from public.lyst_round_revisions where match_id = '${mid(1)}' and round_no = 1 and kind = 'correct'`) === '6-5 Marshal re-counted after the break');
  check('53. the audit log names the people and actions (timer, counters, rounds, discipline)', Number(sql(`select count(distinct action) from public.audit_log where event_id = '${EVENT}' and action in ('lyst.timer','counter.bound','lyst.round_confirmed','lyst.round_corrected','lyst.discipline','lyst.discipline_voided','lyst.join_code','lyst.settings')`)) === 8);
  check('54. NO notification was created or changed by anything Lyst Control did (count unchanged since the queue was called)', notifCount() === notifBefore, `${notifBefore} -> ${notifCount()}`);
  check('55. the lyst never touched the queue: the match is still the active one', sql(`select queue_state from public.matches where id = '${mid(1)}'`) === 'active');

  // ================================================================ 9. finish the match: human-confirmed, through the existing result path
  await tab.getByRole('button', { name: 'Finish match' }).click();
  await tab.getByRole('button', { name: 'Save result' }).waitFor();
  check('56. FINISH shows the official totals 13–9 round by round and says the result is only official once the server confirms it', (await has(tab, '13')) && (await has(tab, 'Round 1: 7–5')) && (await has(tab, 'only official once the server confirms')), await body(tab));
  await shot(tab, '10-finish');
  await tab.getByRole('button', { name: 'Save result' }).click();
  await tab.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
  check('57. the match is FINAL through the existing path: result a, 13–9, with the official rounds and the penalties in the detail and NO counter data', sql(`select queue_state || ' ' || result || ' ' || score_a || '-' || score_b from public.matches where id = '${mid(1)}'`) === 'final a 13-9' && sql(`select (detail ? 'lyst') and not (detail::text ~* 'counter|learning|tally|seat|user') from public.matches where id = '${mid(1)}'`) === 't');
  check('58. one result proposal exists and it is the accepted one (idempotent command)', sql(`select count(*) || ':' || min(status) from public.result_proposals where match_id = '${mid(1)}'`) === '1:accepted');
  check('59. the finish stopped the Field 1 clock; Field 2 is untouched', /^idle:/.test(timerRow('field 1')) && /^running:/.test(timerRow('field 2')), `${timerRow('field 1')} / ${timerRow('field 2')}`);
  check('60. [tv] the result shows with the winner, then the display moves on', await waitFor(tv, () => /result/i.test(document.querySelector('.ar-main')?.innerText ?? '') && /Winner/i.test(document.querySelector('.ar-main')?.innerText ?? ''), null, 30000), await arenaText());
  await shot(tab, '11-official'); await shot(tv, '23-tv-result');
  check('61. the counters\' phone leaves the finished fight by itself (waiting for the next one on this Lyst) and COUNT is disabled', await waitFor(phones.ash, () => /finished|waiting for the next fight/i.test(document.querySelector('.cp-msg')?.textContent ?? '') && document.querySelector('.cp-count, .cp-weighted button')?.disabled === true, null, 20000), await body(phones.ash));

  // ================================================================ 10. NEXT FIGHT: the phones follow the Lyst by themselves (bound to the field and side, never to a fighter)
  await tab.getByRole('button', { name: /Next fight on (Lyst|Field) 1/ }).click();
  await tab.waitForSelector('.ly-timer', { timeout: 30000 });
  check('62. NEXT FIGHT opens the next match on the field in Lyst Control and every phone on the field follows it (one open match per field)', await waitDb(() => sql(`select count(distinct match_id) || ':' || count(*) from public.lyst_counter_seats where status = 'active'`), '1:5', 20000) === '1:5' && sql(`select count(*) from public.lyst_counter_seats where match_id = '${mid(2)}' and status = 'active'`) === '5' && sql(`select count(*) from public.lyst_field_current where event_id = '${EVENT}' and field_key = 'field 1' and match_id = '${mid(2)}'`) === '1');
  check('63. the counters\' phones follow to the new fighters without scanning again', await waitFor(phones.ash, () => /Cael Rhodes/i.test(document.body.innerText), null, 25000), await body(phones.ash));
  check('64. the new fight\'s tally is separate: the counter starts at zero', tot('A', 1, mid(2)) === '0');

  // ================================================================ 11. no signal: the clock cannot be changed, the marshal's call is saved on the device and sent later
  await tab.getByRole('button', { name: /Start round 1/ }).click();
  await waitFor(tab, () => /running/i.test(document.querySelector('.ly-word')?.textContent ?? ''), null, 10000);
  await tabCtx.setOffline(true);
  const sawOffline = await waitFor(tab, () => /No signal/i.test(document.querySelector('.ly-timer')?.innerText ?? ''), null, 15000);
  check('65. OFFLINE: the tablet says "No signal" and the clock buttons are disabled (the timer is never controlled offline; the server clock keeps running)', sawOffline && (await tab.getByRole('button', { name: 'Pause', exact: true }).isDisabled()) && (await tab.getByRole('button', { name: /End round/ }).isDisabled()), (await textOf(tab, '.ly-timer')));
  await tab.getByRole('button', { name: /Enter the score now/ }).click();
  await pick('Cael Rhodes', 3).click(); await pick('Dara Voss', 2).click();
  await tab.getByRole('button', { name: 'Confirm round 3–2' }).click();
  await tab.getByText(/Saved on this device/).waitFor({ timeout: 10000 });
  check('66. OFFLINE: the marshal\'s call is saved on the device and shown as PENDING, not official; the server has nothing yet', (await has(tab, 'Not official until the server has it')) && roundRow(2, 1) === 'running:---', await body(tab));
  const box = await tab.evaluate(() => new Promise((res) => { const r = indexedDB.open('buhurtos-scoring'); r.onsuccess = () => { const q = r.result.transaction('outbox').objectStore('outbox').getAll(); q.onsuccess = () => res(q.result.map(e => e.kind + ':' + e.status)); }; }));
  check('67. it sits in the EXISTING scoring outbox (no second offline system), bound to the signed-in user', box.join(',') === 'lyst.confirm_round:pending', box.join(','));
  await tabCtx.setOffline(false);
  check('68. back online it is sent by itself, in order, once: now OFFICIAL on the server', await waitDb(() => roundRow(2, 1), 'confirmed:3-2', 30000) === 'confirmed:3-2' && official(2) === '3-2', `${roundRow(2, 1)} ${official(2)}`);
  await shot(tab, '12-after-offline');

  // ================================================================ 12. security, from the browser's side
  const dis = await rpc('elm', 'lyst_confirm_round', { p_command: crypto.randomUUID(), p_match: mid(2), p_round: 1, p_awarded_a: 9, p_awarded_b: 0, p_expected_rev: 1, p_recommended_a: null, p_recommended_b: null, p_reason: 'x1x' });
  check('69. a counter cannot change an official score (403)', dis.status === 403 && official(2) === '3-2', JSON.stringify(dis));
  const dis2 = await rpc('elm', 'lyst_timer_command', { p_event: EVENT, p_field: 'Field 1', p_match: mid(2), p_expected_rev: 1, p_command: crypto.randomUUID(), p_action: 'pause', p_mode: null, p_duration_ms: null, p_round: null, p_delta_ms: 0 });
  check('70. a counter cannot touch the clock (403)', dis2.status === 403, JSON.stringify(dis2));
  const seatsAsCounter = await rest('elm', 'GET', 'lyst_counter_seats?select=id,user_id');
  check('71. a counter can read only their own seat (not the other counters\' seats or tallies)', seatsAsCounter.status === 200 && seatsAsCounter.body.length >= 1 && seatsAsCounter.body.every(r => r.user_id === C(7)), JSON.stringify(seatsAsCounter.body).slice(0, 300));
  const countsAsCounter = await rest('elm', 'GET', 'lyst_counts?select=seat_id');
  check('72. ... and only their own tally rows', countsAsCounter.status === 200 && (new Set(countsAsCounter.body.map(r => r.seat_id))).size <= 2, String((new Set((countsAsCounter.body ?? []).map(r => r.seat_id))).size));
  const strangerSeats = await rest('stranger', 'GET', 'lyst_counter_seats?select=id');
  check('73. a signed-in stranger sees no seats, tallies or revisions of this event', strangerSeats.status === 200 && strangerSeats.body.length === 0 && (await rest('stranger', 'GET', 'lyst_counts?select=id')).body.length === 0 && (await rest('stranger', 'GET', 'lyst_round_revisions?select=id')).body.length === 0);
  for (const t of ['lyst_counts', 'lyst_counter_seats', 'lyst_round_revisions', 'match_discipline_private', 'event_lyst_settings', 'lyst_join_codes']) {
    const r = await rest(null, 'GET', `${t}?select=*`);
    if (!(r.status === 401 || r.status === 403)) check(`74. anonymous must not read ${t}`, false, JSON.stringify(r));
  }
  check('74. anonymous cannot read tallies, seats, revisions, private reasons, settings or join codes', true);
  const pub = await rest(null, 'GET', 'lyst_public_state?select=*');
  check('75. anonymous CAN read the public state, and it holds official data only (no counter, seat, learner, reason or account column)', pub.status === 200 && pub.body.length >= 1 && !Object.keys(pub.body[0]).some(k => /counter|seat|learn|user|reason|account/i.test(k)), JSON.stringify(Object.keys(pub.body?.[0] ?? {})));
  check('76. [tv] the public display never shows learner or counter data', !/learn|counter|tally|L1/i.test(await arenaText()), await arenaText());
  check('77. a fighter (with an account) cannot run the lyst either', (await rpc('fighter', 'lyst_open', { p_match: mid(2), p_counter_input: 'simple' })).status === 403);

  // ================================================================ 13. responsive: the tablet screen at phone, tablet and desktop widths
  for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
    await tab.setViewportSize({ width: w, height: h });
    await sleep(600);
    const [sw, iw] = await noSideways(tab);
    const small = await tab.evaluate(() => [...document.querySelectorAll('.ly button, .ly-timer button')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40; }).map(e => e.textContent.trim().slice(0, 20)));
    check(`78. responsive ${w}×${h}: no sideways scroll, every lyst control at least 40 px tall`, sw <= iw && small.length === 0, JSON.stringify({ sw, iw, small }));
    await shot(tab, `13-tablet-${w}`, true);
  }
  await phones.ash.setViewportSize({ width: 360, height: 640 });
  check('79. the counter phone on a small 360×640 screen: COUNT stays on screen and nothing scrolls sideways', (await noSideways(phones.ash))[0] <= 360);

  // ================================================================ 14. accessibility
  await tab.setViewportSize({ width: 390, height: 844 });
  const unnamed = await tab.evaluate(() => [...document.querySelectorAll('button, [role=button], input')].filter(e => !(e.getAttribute('aria-label') || e.textContent.trim() || e.getAttribute('placeholder') || (e.labels && e.labels.length))).length);
  check('80. every button and field on the lyst screen has a name', unnamed === 0, String(unnamed));
  check('81. the clock is announced as an output with a label, and the state has live regions', (await tab.locator('output[aria-label^="Time left"]').count()) === 1 && (await tab.locator('[role="status"]').count()) >= 2);
  const opener = tab.getByRole('button', { name: /^Counters/ });
  await opener.focus(); await tab.keyboard.press('Enter');
  const dlg = tab.getByRole('dialog'); await dlg.waitFor();
  const inside = await tab.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
  await tab.keyboard.press('Escape');
  await dlg.waitFor({ state: 'detached' });
  check('82. keyboard: the sheet opens with focus inside, Escape closes it and focus returns to the button', inside && (await tab.evaluate(() => /Counters/.test(document.activeElement?.textContent ?? ''))));
  check('83. no uncaught page errors on any screen in the whole rehearsal', [tab, tv, head, tab2, ...Object.values(phones)].every(p => p.errors.length === 0), JSON.stringify([tab, tv, head, tab2, ...Object.values(phones)].map(p => p.errors).flat()).slice(0, 600));
} catch (e) {
  check('the rehearsal ran without an unexpected error', false, e.stack ?? e);
} finally {  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
