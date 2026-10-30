// Pack 09B against a REAL local stack: the scorekeeper screen on a phone, the venue display (Live Arena) in a second browser context, two fields.
// Postgres built from the migrations + the Event day fixture, PostgREST, the real built app in real Chromium. Everything the screens show is checked
// against the database too. Run it through scripts/e2e/arena-live.sh (which starts the stack). Not part of CI: needs a PostgREST binary.
// The local stack offers no realtime socket, so the display is kept fresh by its 15 s polling fallback here; hosted, realtime makes it immediate.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 600)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- helpers
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const U = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const WHO = { organizer: [U(2), 'u2@example.test'], scorekeeper: [U(4), 'u4@example.test'], stranger: [U(7), 'u7@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const mid = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const EVENT = '00000000-0000-0000-0000-00000000ed01';
const state = (n) => sql(`select queue_state from public.matches where id = '${mid(n)}'`);
const states = (...ns) => ns.map(n => `${n}:${state(n)}`).join(',');
const live = (n) => sql(`select coalesce((select score_a || '-' || score_b || ' ' || phase from public.match_live_scores where match_id = '${mid(n)}'), 'none')`);
const version = (n) => Number(sql(`select version from public.matches where id = '${mid(n)}'`));
async function rest(who, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args) => rest(who, 'POST', `rpc/${fn}`, args);
const finishAsDevice = (who, n, result = 'a', a = 5, b = 3) => rpc(who, 'submit_match_result', { p_command: crypto.randomUUID(), p_match: mid(n), p_result: result, p_score_a: a, p_score_b: b, p_detail: {}, p_expected_version: version(n), p_schema: 1 });
const report = (who, n, a, b, phase = 'Round 1 of 2', seq = Date.now(), device = 'other-device') => rpc(who, 'report_live_score', { p_match: mid(n), p_device: device, p_seq: seq, p_score_a: a, p_score_b: b, p_phase: phase, p_detail: {}, p_expected_version: version(n) });

let lastPage = null;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = {
  desktop: { viewport: { width: 1280, height: 900 } }, tv: { viewport: { width: 1920, height: 1080 } }, laptop: { viewport: { width: 1366, height: 768 } },
  tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, tabletwide: { viewport: { width: 1024, height: 768 }, hasTouch: true },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
};
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.addInitScript(() => { try { localStorage.setItem('bos-lyst-mode', 'classic'); } catch { /* ignore */ } });   // these journeys drive the classic duel board; Lyst Control has its own journey (pack13-live)
  await ctx.route(/posthog\.com|maps\.googleapis\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|already final|net::ERR|Failed to fetch/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  return { ctx, page };
}
const body = async (page) => (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').toLowerCase();
const has = async (page, text) => (await body(page)).includes(text.toLowerCase());
const shot = async (page, name, full = false) => { if (SHOTS) { await sleep(700); await page.screenshot({ path: `${SHOTS}/arena-${name}.png`, fullPage: full }).catch(() => undefined); } };
const waitText = (page, sel, text, timeout = 40000) => page.waitForFunction(([s, t]) => (document.querySelector(s)?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(t), [sel, text.toLowerCase()], { timeout }).then(() => true, () => false);
const waitGone = (page, sel, text, timeout = 40000) => page.waitForFunction(([s, t]) => !(document.querySelector(s)?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(t), [sel, text.toLowerCase()], { timeout }).then(() => true, () => false);
const waitDb = async (fn, want, timeout = 8000) => { const t0 = Date.now(); let v = fn(); while (v !== want && Date.now() - t0 < timeout) { await sleep(250); v = fn(); } return v; };
const stageText = async (page) => (await page.locator('.ar-main').innerText().catch(() => '')).replace(/\s+/g, ' ').toLowerCase();
const nextText = async (page) => (await page.locator('.ar-next').innerText().catch(() => '')).replace(/\s+/g, ' ').toLowerCase();
const scores = async (page) => page.evaluate(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.replace(/\s*\(winner\)/, '').trim()));
const ARENA = '/events/test-stuff-test/arena', MANAGE = '/events/test-stuff-test/control', FIELD1 = '/events/test-stuff-test/field/Field%201';
const noSideways = (page) => page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
const tap = async (page, name) => { await page.getByRole('button', { name, exact: true }).first().click(); };

try {
  check('the live-score table and function exist in the database built from the migrations', sql(`select count(*) from pg_proc where proname = 'report_live_score'`) === '1' && sql(`select count(*) from pg_tables where tablename = 'match_live_scores'`) === '1');

  // ================================================================ 1. before anything is called: the display is honest about it
  const { ctx: tvctx, page: tv } = await open('tv', null);   // a TV in the hall: no sign-in, no storage
  await tv.goto(BASE + ARENA); await tv.waitForSelector('.arena .ar-main', { timeout: 30000 });
  await tv.waitForFunction(() => !/loading…/i.test(document.querySelector('.ar-main')?.innerText ?? ''), null, { timeout: 30000 });
  check('[tv] the display is its own page: no site header, no bottom navigation, no sign-in', (await tv.locator('header.top, nav.bottom, nav.nav').count()) === 0 && !(await has(tv, 'sign in')));
  check('[tv] with no field in the address it shows Lyst 1 (the blank default), with nothing fighting yet it says so', /^lyst 1/.test(await stageText(tv)) && /waiting for the next fight|next fight coming up|stand by/.test(await stageText(tv)), await stageText(tv));
  check('[tv] both Lysts are offered, Lyst 1 first', (await tv.locator('.ar-fields a').allTextContents()).join('|') === 'Lyst 1|Lyst 2', (await tv.locator('.ar-fields a').allTextContents()).join('|'));
  check('[tv] the status says how it is kept fresh (polling here: the local stack has no realtime socket)', /updating every few seconds|live|connecting/.test((await tv.locator('.ar-live').innerText()).toLowerCase()));
  check('[tv] no fabricated time: nothing like a countdown or a clock is shown', !/\b\d{1,2}:\d{2}\b/.test(await stageText(tv)), await stageText(tv));
  await shot(tv, '1-tv-idle');

  // ================================================================ 2. the organizer calls Field 1 from Event day, on a desktop
  const { ctx: dctx, page: org } = await open('desktop', 'organizer');
  await org.goto(BASE + MANAGE); await org.waitForSelector('section.ed-field[aria-label="Lyst 1"]', { timeout: 30000 });
  check('Live ops offers the big-screen display', (await org.getByRole('link', { name: /Live display|Big screen/ }).count()) >= 1);
  await org.locator('section.ed-field[aria-label="Lyst 1"]').getByRole('button', { name: /^(Run this fight|Run anyway)$/ }).click();
  await waitText(org, 'section.ed-field[aria-label="Lyst 1"] .ed-now', 'Aldric Stone');
  check('Field 1 is called: 1 active, 2 on deck, 3 in the hole (no field written: the default stays blank)', states(1, 2, 3) === '1:active,2:on_deck,3:in_the_hole' && sql(`select count(*) from public.matches where field is null`) === '10', states(1, 2, 3));
  const sawNow = await waitText(tv, '.ar-main', 'Now fighting');
  check('[tv] the display picks it up by itself: NOW FIGHTING Aldric Stone vs Brann Oakley', sawNow && /aldric stone.*brann oakley/.test(await stageText(tv)), await stageText(tv));
  check('[tv] On deck and In the hole follow the queue', /on deck.*cael rhodes.*dara voss.*in the hole.*edric hale.*fenna crow/.test(await nextText(tv)), await nextText(tv));
  check('[tv] no score is invented before a scorer reports one', (await scores(tv)).length === 0 && (await has(tv, 'as soon as the scorer')), JSON.stringify(await scores(tv)));
  check('[tv] the competition and round are named', /longsword \(men\).*round 1/.test(await stageText(tv)), await stageText(tv));
  await shot(tv, '2-tv-called-no-score');

  // ================================================================ 3. the scorekeeper opens the fight from Event day on a phone and scores it
  const { ctx: pctx, page: ph } = await open('phone', 'organizer');
  await ph.goto(BASE + MANAGE); await ph.waitForSelector('.ed-now', { timeout: 30000 });
  await ph.locator('.ed-field-wrap.picked').getByRole('link', { name: 'Open scoreboard' }).click();
  await ph.getByText(/^Head or torso(, two hands)? \+2$/).first().waitFor({ timeout: 30000 });
  check('[phone] Open scoreboard lands on the scoring screen for that fight', /field\/Field%201/.test(ph.url()) && (await has(ph, 'Aldric Stone')) && (await has(ph, 'Brann Oakley')), ph.url());
  check('[phone] the status strip says it is pending until saved', await has(ph, 'Pending: not official until you save'));
  const strip = await ph.locator('.sk-score').boundingBox(), hit = await ph.getByRole('button', { name: /^Head or torso(, two hands)? \+2$/ }).first().boundingBox();
  check('[phone] the two sides and the score are at the top, the scoring buttons on the first screen above the bottom bar', strip && strip.y < 400 && hit && hit.y + hit.height <= 844 - 70, JSON.stringify({ strip, hit }));
  const nums = async (p) => (await p.locator('.sk-num').allInnerTexts()).join('-');
  check('[phone] the score starts at 0-0', (await nums(ph)) === '0-0', await nums(ph));
  await shot(ph, '3-phone-scoring-start');
  await tap(ph, /^Head or torso(, two hands)? \+2$/);
  check('[phone] a hit shows at once on the big score', (await nums(ph)) === '2-0', await nums(ph));
  const l1 = await waitDb(() => live(1), '2-0 Round 1 of 2');
  check('the device reported the running score to the server (not a result: the match is still active)', l1 === '2-0 Round 1 of 2' && state(1) === 'active', l1);
  check('... with the device and a sequence recorded, and no account id anywhere in the row', sql(`select device <> '' and seq > 0 from public.match_live_scores where match_id = '${mid(1)}'`) === 't' && sql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'match_live_scores' and data_type = 'uuid'`) === 'competition_id,match_id');
  const sawScore = await tv.waitForFunction(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-').startsWith('2-0'), null, { timeout: 40000 }).then(() => true, () => false);
  check('[tv] the display shows 2-0 and the round, without anyone touching it', sawScore && /round 1 of 2/.test(await stageText(tv)), await stageText(tv));
  const scoreBox = await tv.locator('.ar-side.a .ar-score').boundingBox();
  check('[tv] the score is huge on a 1080p screen', scoreBox && scoreBox.height >= 180, JSON.stringify(scoreBox));
  await shot(tv, '3-tv-live-2-0');
  // a correction
  await tap(ph, 'Undo last strike');
  check('[phone] undo takes the hit back', (await nums(ph)) === '0-0', await nums(ph));
  check('... and the server has the correction (latest wins)', (await waitDb(() => live(1), '0-0 Round 1 of 2')) === '0-0 Round 1 of 2', live(1));
  check('[tv] the display follows the correction', await tv.waitForFunction(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-').startsWith('0-0'), null, { timeout: 40000 }).then(() => true, () => false), JSON.stringify(await scores(tv)));
  // finish the fight: two rounds, one hit each
  for (let r = 0; r < 2; r++) { await tap(ph, /^Head or torso(, two hands)? \+2$/); await tap(ph, 'End round'); }
  await ph.getByText('wins the match').first().waitFor({ timeout: 10000 });
  check('[phone] the board knows the fight is decided and says who won', await has(ph, 'Aldric Stone wins the match'), await body(ph));
  const lDecided = await waitDb(() => live(1), '4-0 Fight decided');
  check('the server has the decided-but-unsaved score as a running score only (still not a result)', lDecided === '4-0 Fight decided' && sql(`select result is null and queue_state = 'active' from public.matches where id = '${mid(1)}'`) === 't', lDecided);
  await shot(ph, '3-phone-decided');
  await tap(ph, 'Finish match');
  check('[phone] the confirm step shows both sides, the winner and that it is pending until saved', (await has(ph, 'Check before you save')) && (await has(ph, 'Save result')) && (await has(ph, 'Pending: not official until you save')));
  await shot(ph, '3-phone-confirm');
  await tap(ph, 'Save result');
  await ph.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
  check('[phone] OFFICIAL, with the winner', (await has(ph, 'Official: saved on the server')) && (await has(ph, 'Winner: Aldric Stone')), await body(ph));
  check('the database: match 1 final 4-0 to A, the queue advanced, the running score was cleared by the server', sql(`select queue_state || result || score_a || '-' || score_b from public.matches where id = '${mid(1)}'`) === 'finala4-0' && states(2, 3, 4) === '2:active,3:on_deck,4:in_the_hole' && live(1) === 'none', `${states(1, 2, 3, 4)} live=${live(1)}`);
  check('[phone] after OFFICIAL the next fight on this field is one tap away, and so is Event day', (await ph.getByRole('button', { name: /Next fight on (Lyst|Field) 1/ }).count()) === 1 && (await has(ph, 'Cael Rhodes vs Dara Voss')) && (await ph.getByRole('link', { name: /Back to (Event day|Event Control)/ }).count() + await ph.getByRole('button', { name: 'Back to the queue' }).count()) >= 1, await body(ph));
  await shot(ph, '3-phone-official');
  // the display: result, then the next fight
  const sawResult = await waitText(tv, '.ar-main', 'Winner: Aldric Stone');
  check('[tv] the result card: final score 4-0 and the winner, while the queue has already called the next pair', sawResult && (await scores(tv)).join('-') === '4-0' && (await tv.locator('.ar-side.a.won').count()) === 1 && states(2) === '2:active', await stageText(tv));
  check('[tv] ... and the footer says who is up next and who is on deck', /up next.*cael rhodes.*dara voss.*on deck.*edric hale.*fenna crow/.test(await nextText(tv)), await nextText(tv));
  await shot(tv, '3-tv-result');
  const sawNext = await waitText(tv, '.ar-main', 'Cael Rhodes', 70000);
  check('[tv] after the result hold the next fight is NOW FIGHTING (Cael Rhodes vs Dara Voss), On deck moved up', sawNext && /now fighting/.test(await stageText(tv)) && /on deck.*edric hale.*in the hole.*aldric stone/.test(await nextText(tv)), `${await stageText(tv)} || ${await nextText(tv)}`);
  check('[organizer desktop] Event day moved on without a reload', await waitText(org, 'section.ed-field[aria-label="Lyst 1"] .ed-now', 'Cael Rhodes'), await body(org));

  // ================================================================ 4. next fight from the OFFICIAL screen; a reload and a fresh screen show the server's score, not the device's
  await ph.getByRole('button', { name: /Next fight on (Lyst|Field) 1/ }).click();
  await ph.getByText(/^Head or torso(, two hands)? \+2$/).first().waitFor({ timeout: 30000 });
  check('[phone] "Next fight" opens the scoring screen for Cael Rhodes vs Dara Voss', (await has(ph, 'Cael Rhodes')) && (await has(ph, 'Dara Voss')) && (await nums(ph)) === '0-0', await body(ph));
  await tap(ph, /^Head or torso(, two hands)? \+2$/);
  check('the new fight reports on its own', (await waitDb(() => live(2), '2-0 Round 1 of 2')) === '2-0 Round 1 of 2', live(2));
  await tv.reload(); await tv.waitForSelector('.ar-main', { timeout: 30000 });
  const afterReload = await tv.waitForFunction(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-').startsWith('2-0'), null, { timeout: 40000 }).then(() => true, () => false);
  check('[tv] a reload rebuilds the display from the server: 2-0 is back at once', afterReload && /cael rhodes/.test(await stageText(tv)), await stageText(tv));
  const { ctx: fctx, page: fresh } = await open('laptop', null);
  await fresh.goto(BASE + ARENA + '/Field%201'); await fresh.waitForSelector('.ar-main', { timeout: 30000 });
  const freshScore = await fresh.waitForFunction(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-').startsWith('2-0'), null, { timeout: 40000 }).then(() => true, () => false);
  check('[laptop] a second screen opened late shows the same running score (it lives on the server, not in the scorer\'s browser)', freshScore, await stageText(fresh));
  await shot(fresh, '4-laptop-live');
  await fctx.close();

  // ================================================================ 5. the display loses its connection and recovers; the scorer loses signal and saves anyway
  await tvctx.setOffline(true);
  await sleep(1500);
  await tap(ph, /^Head or torso(, two hands)? \+2$/);
  check('the score went up while the display was offline', (await waitDb(() => live(2), '4-0 Round 1 of 2')) === '4-0 Round 1 of 2', live(2));
  await sleep(2000);
  check('[tv] offline, the display keeps showing what it last knew (no blank, no error page)', (await scores(tv)).join('-') === '2-0' && (await tv.locator('.ar-main').count()) === 1, JSON.stringify(await scores(tv)));
  await tvctx.setOffline(false);
  const recovered = await tv.waitForFunction(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-').startsWith('4-0'), null, { timeout: 60000 }).then(() => true, () => false);
  check('[tv] back online it catches up by itself', recovered, JSON.stringify(await scores(tv)));
  // the scorer loses signal
  await pctx.setOffline(true);
  await tap(ph, 'End round'); await tap(ph, /^Head or torso(, two hands)? \+2$/); await tap(ph, 'End round');
  await ph.getByText('wins the match').first().waitFor({ timeout: 10000 });
  await tap(ph, 'Finish match'); await tap(ph, 'Save result');
  await ph.getByText('Pending: NOT official yet').waitFor({ timeout: 20000 });
  check('[phone] no signal: the result is kept on the device and marked PENDING, never claimed official', (await has(ph, 'Pending: NOT official yet')) && (await ph.getByRole('button', { name: 'Try again' }).count()) === 1 && state(2) === 'active', await body(ph));
  check('the server still has the last running score it heard, and no result', live(2) === '4-0 Round 1 of 2' && sql(`select result is null from public.matches where id = '${mid(2)}'`) === 't', live(2));
  await shot(ph, '5-phone-pending');
  await pctx.setOffline(false);
  await tap(ph, 'Try again');
  await ph.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
  check('[phone] with signal back, Try again makes it OFFICIAL', (await has(ph, 'Official: saved on the server')) && sql(`select queue_state || result || score_a || '-' || score_b from public.matches where id = '${mid(2)}'`) === 'finala6-0' && live(2) === 'none', sql(`select queue_state || result || score_a || '-' || score_b from public.matches where id = '${mid(2)}'`));
  check('the queue moved on: 3 active, 4 on deck, 5 in the hole', states(3, 4, 5) === '3:active,4:on_deck,5:in_the_hole', states(3, 4, 5));
  check('[tv] the display shows the official 6-0 result (the score it last heard was 4-0: the result wins)', (await waitText(tv, '.ar-main', 'Winner: Cael Rhodes')) && (await scores(tv)).join('-') === '6-0', await stageText(tv));

  // ================================================================ 6. a result two devices disagree about: the display shows the official one, the scorer is told
  await ph.getByRole('button', { name: /Next fight on (Lyst|Field) 1/ }).click();
  await ph.getByText(/^Head or torso(, two hands)? \+2$/).first().waitFor({ timeout: 30000 });
  check('[phone] scoring Edric Hale vs Fenna Crow', (await has(ph, 'Edric Hale')) && (await has(ph, 'Fenna Crow')));
  await tap(ph, /^Head or torso(, two hands)? \+2$/);
  check('its running score is reported', (await waitDb(() => live(3), '2-0 Round 1 of 2')) === '2-0 Round 1 of 2', live(3));
  const other = await finishAsDevice('scorekeeper', 3, 'b', 3, 5);
  check('another device saves a result for the same fight first (Fenna Crow wins)', other.body?.status === 'accepted' && live(3) === 'none', JSON.stringify(other));
  await tap(ph, 'End round'); await tap(ph, /^Head or torso(, two hands)? \+2$/); await tap(ph, 'End round');
  await ph.getByText('wins the match').first().waitFor({ timeout: 10000 });
  await sleep(600);
  check('the device\'s later snapshot is refused as final and the server keeps no running score for a final match', live(3) === 'none' && state(3) === 'final', live(3));
  await tap(ph, 'Finish match'); await tap(ph, 'Save result');
  await ph.getByText('Needs review: not changed').waitFor({ timeout: 20000 });
  check('[phone] the different result is NOT applied: Needs review, in plain words', (await has(ph, 'A different result is already official')) && sql(`select result || score_a || '-' || score_b from public.matches where id = '${mid(3)}'`) === 'b3-5', await body(ph));
  await shot(ph, '6-phone-review');
  check('[tv] the display shows the official result, not the scorer\'s board: Winner Fenna Crow 3-5', (await waitText(tv, '.ar-main', 'Winner: Fenna Crow')) && (await scores(tv)).join('-') === '3-5' && (await tv.locator('.ar-side.b.won').count()) === 1, await stageText(tv));
  await shot(tv, '6-tv-official-result');
  await tap(ph, 'I have told the head marshal: back to the queue');
  await ph.waitForSelector('.field-run, .panel', { timeout: 20000 });
  check('[phone] back on the queue, the review is for the organizer (Results that need review)', await waitText(org, 'section.ed-attention', 'result needs review', 45000), await body(org));

  // ================================================================ 7. a stale screen: the match changed under the scorer
  await ph.goto(BASE + FIELD1 + `?match=${mid(4)}`);
  await ph.getByText(/^Head or torso(, two hands)? \+2$/).first().waitFor({ timeout: 30000 });
  check('[phone] a direct link opens Aldric Stone vs Cael Rhodes', (await has(ph, 'Aldric Stone')) && (await has(ph, 'Cael Rhodes')) && state(4) === 'active', states(4));
  await tap(ph, /^Head or torso(, two hands)? \+2$/);
  check('its running score is reported with the version the device opened', (await waitDb(() => live(4), '2-0 Round 1 of 2')) === '2-0 Round 1 of 2', live(4));
  sql(`update public.matches set version = version + 1 where id = '${mid(4)}'`);   // an organizer's correction while the board is open
  await tap(ph, 'Undo last strike');
  await sleep(900);
  check('a snapshot from an older version of the match is refused (the display keeps the last good one)', live(4) === '2-0 Round 1 of 2', live(4));
  await tap(ph, /^Head or torso(, two hands)? \+2$/); await tap(ph, 'End round'); await tap(ph, /^Head or torso(, two hands)? \+2$/); await tap(ph, 'End round');
  await ph.getByText('wins the match').first().waitFor({ timeout: 10000 });
  await tap(ph, 'Finish match'); await tap(ph, 'Save result');
  const staleNotice = await ph.locator('[role="alert"], .notice').first().innerText({ timeout: 20000 }).catch(() => '');
  check('[phone] saving from a stale screen is refused and explained, nothing is written', state(4) === 'active' && sql(`select result is null from public.matches where id = '${mid(4)}'`) === 't' && (/changed|stale|again|refresh|newer/i.test(staleNotice) || await has(ph, 'changed')), staleNotice || await body(ph));
  sql(`delete from public.match_live_scores where match_id = '${mid(4)}'`);

  // ================================================================ 8. two fields are two displays
  const adv2 = await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: 'Field 2', p_start: true });
  check('Field 2 is called (12 active, 13 on deck, 11 in the hole)', adv2.status === 200 && states(12, 13, 11) === '12:active,13:on_deck,11:in_the_hole', states(12, 13, 11));
  const rep12 = await report('scorekeeper', 12, 3, 1);
  check('a scorekeeper reports a running score on Field 2 (3-1)', rep12.body?.status === 'ok' && live(12) === '3-1 Round 1 of 2', JSON.stringify(rep12));
  const rep4 = await report('organizer', 4, 1, 1, 'Round 2 of 2');
  check('and the organizer reports one on Field 1 (1-1)', rep4.body?.status === 'ok', JSON.stringify(rep4));
  await tv.locator('.ar-fields a', { hasText: /Lyst 2|Field 2/ }).click();
  await tv.waitForURL(/arena\/Field%202/, { timeout: 10000 });
  const f2 = await tv.waitForFunction(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-') === '3-1', null, { timeout: 40000 }).then(() => true, () => false);
  check('[tv] Field 2: Hale Morrow vs Ivor Penn at 3-1, On deck Aldric Stone vs Hale Morrow, In the hole Aldric Stone vs Garrick Fell', f2 && /^field 2.*hale morrow.*ivor penn/.test(await stageText(tv)) && /on deck.*aldric stone.*hale morrow.*in the hole.*aldric stone.*garrick fell/.test(await nextText(tv)), `${await stageText(tv)} || ${await nextText(tv)}`);
  check('[tv] nothing from Field 1 leaks onto Field 2', !/cael rhodes|edric hale|1-1/.test((await stageText(tv)) + (await nextText(tv))), await stageText(tv));
  await shot(tv, '8-tv-field2');
  await tv.goto(BASE + ARENA + '?field=field%201'); await tv.waitForSelector('.ar-main', { timeout: 30000 });
  const f1b = await tv.waitForFunction(() => [...document.querySelectorAll('.ar-main .ar-score')].map(e => e.textContent.trim()).join('-') === '1-1', null, { timeout: 40000 }).then(() => true, () => false);
  check('[tv] back to Field 1 (case does not matter): Aldric Stone vs Cael Rhodes 1-1, Round 2 of 2, nothing from Field 2', f1b && /^field 1.*aldric stone.*cael rhodes.*round 2 of 2/.test(await stageText(tv)) && !/hale morrow|3-1/.test((await stageText(tv)) + (await nextText(tv))), await stageText(tv));
  const r12 = await finishAsDevice('organizer', 12, 'a', 5, 2);
  check('a result on Field 2 leaves Field 1 alone', r12.body?.status === 'accepted' && states(13, 11, 4, 5) === '13:active,11:on_deck,4:active,5:on_deck' && live(12) === 'none', states(13, 11, 4, 5));
  await sleep(1000);
  check('[tv] ... and the Field 1 display does not flinch', /aldric stone.*cael rhodes/.test(await stageText(tv)) && !/hale morrow/.test(await stageText(tv)), await stageText(tv));
  sql(`delete from public.match_live_scores`);

  // ================================================================ 9. public and nothing else; the right people and no one else
  const anonRows = await rest(null, 'GET', `match_live_scores?select=match_id,score_a,score_b`);
  check('anyone can read the running scores of a published event (empty right now)', anonRows.status === 200 && Array.isArray(anonRows.body), JSON.stringify(anonRows));
  const rep5 = await report('organizer', 5, 0, 0);
  const anonAll = await rest(null, 'GET', `match_live_scores?select=*`);
  check('... and a full public row holds no account id (only the match and competition ids)', rep5.body?.status === 'ok' && anonAll.status === 200 && anonAll.body.length === 1 && Object.keys(anonAll.body[0]).sort().join(',') === 'competition_id,detail,device,match_id,phase,score_a,score_b,seq,updated_at', JSON.stringify(anonAll));
  const anonWrite = await rest(null, 'POST', 'rpc/report_live_score', { p_match: mid(5), p_device: 'x', p_seq: 1, p_score_a: 9, p_score_b: 9 });
  check('no sign-in: cannot report a score', anonWrite.status >= 400, JSON.stringify(anonWrite));
  const strangerWrite = await report('stranger', 5, 9, 9);
  check('a signed-in stranger: cannot report a score', strangerWrite.status >= 400, JSON.stringify(strangerWrite));
  const direct = await rest('organizer', 'POST', 'match_live_scores', { match_id: mid(5), competition_id: '00000000-0000-0000-0000-00000000cd01', score_a: 1, score_b: 1 });
  check('even an organizer cannot write the table directly (only through the function)', direct.status >= 400, JSON.stringify(direct));
  const directDel = await rest('organizer', 'DELETE', `match_live_scores?match_id=eq.${mid(5)}`);
  check('... nor delete rows', directDel.status >= 400 || live(5) !== 'none', JSON.stringify(directDel));
  check('nothing private on the display: no e-mail, no account id, no registration or medical words', !/@example\.test|0000000000a|emergency|medical|allerg|insurance|checked in/.test((await body(tv))), (await body(tv)).slice(0, 300));
  sql(`update public.events set status = 'draft' where id = '${EVENT}'`);
  const hidden = await rest(null, 'GET', `match_live_scores?select=match_id`);
  check('an unpublished event: the running scores are not public', hidden.status === 200 && hidden.body.length === 0, JSON.stringify(hidden));
  await tv.reload(); await tv.waitForSelector('.arena', { timeout: 30000 });
  check('[tv] ... and the display says the event is not public, nothing else', await waitText(tv, '.arena', 'This event is not public', 30000) && !(await has(tv, 'Aldric')), await stageText(tv));
  sql(`update public.events set status = 'published' where id = '${EVENT}'`);
  sql(`delete from public.match_live_scores`);

  // ================================================================ 10. finished and between-fights states, fullscreen, phone and tablet layouts
  for (const n of [4, 5, 6, 21, 22]) sql(`update public.matches set queue_state = 'final', result = 'a', score_a = 1, score_b = 0, winner_entry_id = entry_a, finalized_at = now() - interval '1 minute' where id = '${mid(n)}'`);
  await tv.goto(BASE + ARENA + '/Field%201'); await tv.waitForSelector('.ar-main', { timeout: 30000 });
  check('[tv] every fight on Field 1 done (the final waits for its entrants): "Field 1 is complete" or the waiting final, no made-up fight', await waitText(tv, '.ar-main', 'complete', 30000) || await waitText(tv, '.ar-main', 'waiting', 5000), await stageText(tv));
  await shot(tv, '10-tv-complete');
  const fsBtn = tv.getByRole('button', { name: /fullscreen/i });
  if (await fsBtn.count()) { await fsBtn.click(); await sleep(500); check('[tv] the fullscreen button does not break the page when the browser refuses it', (await tv.locator('.ar-main').count()) === 1 && tv.errors.length === 0, tv.errors.join(' | ')); }
  check('[tv] no page errors', tv.errors.length === 0, tv.errors.join(' | '));
  await tvctx.close();
  sql(`update public.matches set queue_state = 'active' where id = '${mid(13)}'`);
  await report('organizer', 13, 2, 4, 'Round 2 of 2');
  for (const kind of ['phone', 'tablet', 'laptop']) {
    const { ctx, page: p } = await open(kind, null);
    await p.goto(BASE + ARENA + '/Field%202'); await p.waitForSelector('.ar-main', { timeout: 30000 });
    await p.waitForFunction(() => [...document.querySelectorAll('.ar-main .ar-score')].length === 2, null, { timeout: 40000 }).catch(() => undefined);
    const sw = await noSideways(p);
    check(`[${kind} display] no sideways scroll`, sw[0] <= sw[1], JSON.stringify(sw));
    const boxes = await p.evaluate(() => ['.ar-side.a .ar-score', '.ar-side.b .ar-score', '.ar-next'].map(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? [Math.round(r.top), Math.round(r.bottom)] : null; }));
    check(`[${kind} display] both scores and the next fights fit on one screen`, boxes.every(b => b && b[1] <= p.viewportSize().height + 1), JSON.stringify(boxes));
    const small = await p.evaluate(() => [...document.querySelectorAll('.ar-bar a, .ar-bar button')].filter(e => e.offsetParent !== null).map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h < 44));
    check(`[${kind} display] every control in the bar is at least 44px tall`, small.length === 0, JSON.stringify(small));
    await shot(p, `10-${kind}-display`);
    check(`[${kind} display] no page errors`, p.errors.length === 0, p.errors.join(' | '));
    await ctx.close();
  }
  for (const kind of ['tablet', 'tabletwide', 'phone']) {
    const { ctx, page: p } = await open(kind, 'scorekeeper');
    await p.goto(BASE + '/events/test-stuff-test/field/Field%202?match=' + mid(13));
    await p.getByText(/^Head or torso(, two hands)? \+2$/).first().waitFor({ timeout: 30000 });
    const sw = await noSideways(p);
    check(`[${kind} scoring] no sideways scroll`, sw[0] <= sw[1], JSON.stringify(sw));
    const st = await p.locator('.sk-score').boundingBox(), hit = await p.getByRole('button', { name: /^Head or torso(, two hands)? \+2$/ }).first().boundingBox();
    check(`[${kind} scoring] score at the top, the scoring buttons on the first screen`, st && st.y < 420 && hit && hit.y + hit.height <= p.viewportSize().height - (kind === 'phone' ? 70 : 0), JSON.stringify({ st, hit, vh: p.viewportSize().height }));
    const small = await p.evaluate(() => [...document.querySelectorAll('.sk .btn')].filter(e => e.offsetParent !== null).map(e => [Math.round(e.getBoundingClientRect().height), e.innerText.trim().slice(0, 20)]).filter(([h]) => h < 44));
    check(`[${kind} scoring] every button is at least 44px tall`, small.length === 0, JSON.stringify(small));
    await shot(p, `10-${kind}-scoring`);
    check(`[${kind} scoring] a scorekeeper sees it and reports (the 2-4 the organizer reported is the server's, this device has its own board)`, (await has(p, 'Hale Morrow')) && p.errors.length === 0, p.errors.join(' | '));
    await ctx.close();
  }
  check('no page errors (organizer desktop)', org.errors.length === 0, org.errors.join(' | '));
  check('no page errors (phone)', ph.errors.length === 0, ph.errors.join(' | '));
  await pctx.close(); await dctx.close();
} catch (e) {
  check('the run reached the end', false, e.stack ?? e);
  if (lastPage) { console.log('--- what the page showed:', lastPage.url()); console.log((await lastPage.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500)); console.log('--- page errors:', lastPage.errors); await shot(lastPage, 'failure', true); }
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
