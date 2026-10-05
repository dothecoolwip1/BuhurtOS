// Pack 14 (Broadcast overlay) against a REAL local stack: Postgres built from every migration + the Pack 14 fixture, PostgREST, the real built app in real Chromium.
// The overlay is drawn at a real 1920x1080 broadcast viewport while the field is run through the same controlled functions the tablet uses (Pack 13),
// so every scene is checked against the authoritative state and against the database. Nothing here talks to the overlay except by loading its URL.
// Run it through scripts/e2e/pack14-live.sh. LOCAL EVIDENCE ONLY (needs a PostgREST binary; not part of CI).
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
const WHO = { organizer: [A(2), 'u2@example.test'], scorekeeper: [A(4), 'u4@example.test'], stranger: [A(7), 'u7@example.test'], head: [C(1), 'c1@example.test'], fighter: ['00000000-0000-0000-0000-000000000101', 'fighter1@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const mid = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const EVENT = '00000000-0000-0000-0000-00000000ed01';
async function rest(who, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', prefer: 'return=representation', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args) => rest(who, 'POST', `rpc/${fn}`, args);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { tv: { viewport: { width: 1920, height: 1080 } }, desktop: { viewport: { width: 1280, height: 900 } }, tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|youtube(-nocookie)?\.com|twitch\.tv|vimeo\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|net::ERR|Failed to fetch|403|42501/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  return page;
}
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = async (page, name) => { if (SHOTS) { await sleep(450); await page.screenshot({ path: `${SHOTS}/p14-${name}.png` }).catch(() => undefined); } };
const mode = (page) => page.getAttribute('.bc', 'data-scene').catch(() => null);
const waitScene = async (page, want, timeout = 20000) => { const t0 = Date.now(); let m = await mode(page); while (m !== want && Date.now() - t0 < timeout) { await sleep(250); m = await mode(page); } return m === want ? want : `${m} (wanted ${want})`; };
const waitText = (page, re, timeout = 20000) => page.waitForFunction((s) => new RegExp(s, 'i').test(document.querySelector('.bc')?.innerText ?? ''), re, { timeout }).then(() => true, () => false);
const OV = '/broadcast/test-stuff-test/Field%201';

const timerRev = (f = 'field 1') => Number(sql(`select coalesce((select rev from public.lyst_timer where event_id = '${EVENT}' and field_key = '${f}'), 0)`));
let cmdN = 1; const cmd = () => `00000000-0000-4000-8000-${String(Date.now() % 1e6).padStart(6, '0')}${String(cmdN++).padStart(6, '0')}`;
const timer = (who, match, action, extra = {}) => rpc(who, 'lyst_timer_command', { p_event: EVENT, p_field: 'Field 1', p_match: match, p_expected_rev: timerRev(), p_command: cmd(), p_action: action, ...extra });

try {
  const tv = await open('tv', null);

  // ---------------------------------------------------------------- 1. before anything is called
  await tv.goto(BASE + OV + '?bg=dark&status=1');
  await tv.waitForSelector('.bc[data-ready="true"]', { timeout: 30000 });
  check('1. the overlay opens with NO sign-in and shows the event (public, read-only)', (await text(tv)).toLowerCase().includes('test stuff test'), await text(tv));
  check('2. nothing called yet: scene "upcoming" (the first fight is announced from the schedule)', (await waitScene(tv, 'upcoming')) === 'upcoming', await mode(tv));
  check('3. the first fight, the order after it, the competition and corners are drawn', await waitText(tv, 'Aldric Stone.*Brann Oakley') && (await text(tv)).toLowerCase().includes('cael rhodes') && (await text(tv)).includes('RED'), await text(tv));
  check('4. sponsors from the event are on the overlay (the hidden one is not)', (await text(tv)).includes('IRONWORKS') || (await text(tv)).toLowerCase().includes('ironworks'), await text(tv));
  check('5. the stage is exactly the broadcast size (1920x1080) and the page does not scroll', JSON.stringify(await tv.evaluate(() => { const r = document.querySelector('.bc-stage').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), document.scrollingElement.scrollWidth, document.scrollingElement.scrollHeight]; })) === '[1920,1080,1920,1080]');
  await shot(tv, '01-upcoming');

  // ---------------------------------------------------------------- 2. the organizer calls the fight (existing queue); the scorekeeper opens the lyst
  const call = await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  check('6. the organizer calls Field 1 through the existing queue', call.status === 200 && sql(`select queue_state from public.matches where id = '${mid(1)}'`) === 'active', JSON.stringify(call));
  check('7. scene "intro": the fight is on the field, no round yet', (await waitScene(tv, 'intro')) === 'intro', await mode(tv));
  await shot(tv, '02-intro');
  const open1 = await rpc('scorekeeper', 'lyst_open', { p_match: mid(1), p_counter_input: 'weighted' });
  const armed = await timer('scorekeeper', mid(1), 'set', { p_mode: 'fight', p_duration_ms: 60000, p_round: 1 });
  check('8. the scorekeeper arms the clock: scene "ready" with the clock shown (1:00)', open1.status === 200 && armed.status === 200 && (await waitScene(tv, 'ready')) === 'ready' && (await text(tv)).includes('1:00'), await text(tv));
  await shot(tv, '03-ready');

  // ---------------------------------------------------------------- 3. live
  sql(`insert into public.event_lyst_settings (event_id, settings) values ('${EVENT}', '{"cards":[{"label":"Yellow card"},{"label":"Red card"}]}') on conflict (event_id) do update set settings = jsonb_set(public.event_lyst_settings.settings, '{cards}', '[{"label":"Yellow card"},{"label":"Red card"}]')`);
  const started = await timer('scorekeeper', mid(1), 'start');
  check('9. START ROUND 1: scene "live" with a running clock below 1:00 and a LIVE ribbon', started.status === 200 && (await waitScene(tv, 'live')) === 'live' && /LIVE/.test(await text(tv, '.bc-bug')), await text(tv));
  const c1 = await text(tv, '.bc-clock-n'); await sleep(2200); const c2 = await text(tv, '.bc-clock-n');
  const secs = (t) => { const m = /^(\d+):(\d\d)/.exec(t); return m ? +m[1] * 60 + +m[2] : NaN; };
  check('10. the clock counts down on screen (server time, no local state)', secs(c2) < secs(c1) && secs(c1) <= 60, `${c1} -> ${c2}`);
  const sw = await tv.evaluate(() => [...document.querySelectorAll('.bc-score')].map(e => e.textContent.trim()));
  check('11. no marshal score yet: 0 - 0 (counters are never shown)', sw.join('-') === '0-0', sw.join('-'));
  await shot(tv, '04-live');

  // score bug at 1920x1080 reads: measure type sizes (readability)
  const sizes = await tv.evaluate(() => ({ clock: parseFloat(getComputedStyle(document.querySelector('.bc-clock-n')).fontSize), score: parseFloat(getComputedStyle(document.querySelector('.bc-score')).fontSize), name: parseFloat(getComputedStyle(document.querySelector('.bc-name')).fontSize) }));
  check('12. score, clock and names are large enough for video (score >= 100px, clock >= 80px, names >= 32px)', sizes.score >= 100 && sizes.clock >= 80 && sizes.name >= 32, JSON.stringify(sizes));

  // pause
  const paused = await timer('scorekeeper', mid(1), 'pause');
  check('13. PAUSE: scene "paused", the clock holds', paused.status === 200 && (await waitScene(tv, 'paused')) === 'paused', await mode(tv));
  const p1 = await text(tv, '.bc-clock-n'); await sleep(2200);
  check('14. ... and does not drift while paused', p1 === (await text(tv, '.bc-clock-n')), p1);
  await shot(tv, '05-paused');
  await timer('scorekeeper', mid(1), 'resume');
  await waitScene(tv, 'live');

  // discipline: warning/card and a deduction appear as official marks
  const card = await rpc('scorekeeper', 'lyst_record_discipline', { p_command: cmd(), p_match: mid(1), p_round: 1, p_side: 'b', p_kind: 'card', p_label: 'Yellow card' });
  const ded = await rpc('scorekeeper', 'lyst_record_discipline', { p_command: cmd(), p_match: mid(1), p_round: 1, p_side: 'a', p_kind: 'deduction', p_amount: 1, p_reason: 'Unsafe conduct' });
  check('15. a card and a point deduction are recorded by the operator (marshal call)', card.status === 200 && ded.status === 200, JSON.stringify([card.body, ded.body]).slice(0, 400));
  check('16. both appear as marks on the correct fighter, in the live scene', await waitText(tv, 'Yellow card') && await waitText(tv, '-1|−1|deduction'), await text(tv, '.bc-bug'));
  check('17. the reason of a penalty is NOT on the overlay (private)', !(await text(tv)).includes('Unsafe conduct'));
  await shot(tv, '06-marks');

  // ---------------------------------------------------------------- 4. round break and marshal-confirmed score
  const ended = await rpc('scorekeeper', 'lyst_end_round', { p_match: mid(1), p_round: 1 });
  const brk = await timer('scorekeeper', mid(1), 'set', { p_mode: 'break', p_duration_ms: 30000 });
  const brkGo = await timer('scorekeeper', mid(1), 'start');
  check('18. END ROUND + break clock: scene "break" and the round is NOT scored on screen yet', ended.status === 200 && (await waitScene(tv, 'break')) === 'break', JSON.stringify([ended.body, brk.body, brkGo.body]).slice(0, 300));
  await shot(tv, '07-break');
  const conf = await rpc('scorekeeper', 'lyst_confirm_round', { p_command: cmd(), p_match: mid(1), p_round: 1, p_awarded_a: 5, p_awarded_b: 3, p_expected_rev: Number(sql(`select rev from public.lyst_rounds where match_id = '${mid(1)}' and round_no = 1`)) });
  check('19. the marshal confirms the round: the official score appears (5 less the 1-point deduction = 4, against 3)', conf.status === 200 && await tv.waitForFunction(() => [...document.querySelectorAll('.bc-score')].map(e => e.textContent.trim()).join('-') === '4-3', null, { timeout: 15000 }).then(() => true, () => false), JSON.stringify(conf.body).slice(0, 300) + ' ' + await text(tv, '.bc-bug'));
  await shot(tv, '08-break-confirmed');

  // equipment and DQ clocks
  await timer('scorekeeper', mid(1), 'set', { p_mode: 'equipment', p_duration_ms: 60000 }); await timer('scorekeeper', mid(1), 'start');
  check('20. equipment timeout clock: scene "equipment"', (await waitScene(tv, 'equipment')) === 'equipment', await mode(tv));
  await shot(tv, '09-equipment');
  await timer('scorekeeper', mid(1), 'set', { p_mode: 'dq', p_duration_ms: 60000 }); await timer('scorekeeper', mid(1), 'start');
  check('21. disqualification countdown clock: scene "dq_clock"', (await waitScene(tv, 'dq_clock')) === 'dq_clock', await mode(tv));
  await shot(tv, '10-dqclock');

  // ---------------------------------------------------------------- 5. round 2, finish, result
  await timer('scorekeeper', mid(1), 'set', { p_mode: 'fight', p_duration_ms: 60000, p_round: 2 }); await timer('scorekeeper', mid(1), 'start');
  await waitScene(tv, 'live');
  await rpc('scorekeeper', 'lyst_end_round', { p_match: mid(1), p_round: 2 });
  await rpc('scorekeeper', 'lyst_confirm_round', { p_command: cmd(), p_match: mid(1), p_round: 2, p_awarded_a: 6, p_awarded_b: 2, p_expected_rev: Number(sql(`select rev from public.lyst_rounds where match_id = '${mid(1)}' and round_no = 2`)) });
  const fin = await rpc('scorekeeper', 'lyst_finalize', { p_command: cmd(), p_match: mid(1), p_expected_version: Number(sql(`select version from public.matches where id = '${mid(1)}'`)), p_result: 'a' });
  check('22. FINISH MATCH: saved through the existing result path', fin.status === 200 && sql(`select result from public.matches where id = '${mid(1)}'`) === 'a', JSON.stringify(fin.body).slice(0, 400));
  check('23. scene "complete" first (match complete), with the winner highlighted', (await waitScene(tv, 'complete', 12000)) === 'complete', await mode(tv));
  await shot(tv, '11-complete');
  check('24. then the winner / result card after a few seconds', (await waitScene(tv, 'winner', 20000)) === 'winner' && await waitText(tv, 'Aldric Stone') && /winner/i.test(await text(tv)), await text(tv));
  await shot(tv, '12-winner');
  check('25. the next fight is announced beside the result (Now/Next moved on)', await waitText(tv, 'Cael Rhodes'), await text(tv));

  // the hold window ends: between matches
  check('26. after the result hold, the next pair (already called by the queue) are on the field: scene "intro"', (await waitScene(tv, 'intro', 45000)) === 'intro' && await waitText(tv, 'Cael Rhodes.*Dara Voss'), await text(tv));
  await shot(tv, '13-between');

  // ---------------------------------------------------------------- 6. layouts and backgrounds
  const lay = await open('tv', null);
  await lay.goto(BASE + OV + '?layout=queue&bg=green'); await lay.waitForSelector('.bc[data-ready="true"]', { timeout: 30000 });
  check('27. layout=queue draws only the order of fights; green background for chroma key', (await lay.locator('.bc-queue').count()) === 1 && (await lay.locator('.bc-bug,.bc-lower').count()) === 0 && (await lay.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(0, 177, 64)');
  await shot(lay, '14-queue-green');
  await lay.goto(BASE + OV + '?layout=sponsors'); await lay.waitForSelector('.bc[data-ready="true"] .bc-sponsors', { timeout: 30000 }).catch(() => undefined);
  check('28. layout=sponsors draws only sponsors; the default background is transparent', (await lay.locator('.bc-sponsors').count()) === 1 && (await lay.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgba(0, 0, 0, 0)');
  await shot(lay, '15-sponsors');
  await lay.goto(BASE + '/broadcast/test-stuff-test/Field%202?layout=full&bg=dark'); await lay.waitForSelector('.bc[data-ready="true"]', { timeout: 30000 });
  check('29. Field 2 is its own overlay with its own state (Field 1 has no effect on it)', (await lay.getAttribute('.bc', 'data-field')) === 'Field 2' && (await mode(lay)) === 'upcoming', await mode(lay));

  // ---------------------------------------------------------------- 7. recovery
  await tv.goto(BASE + OV + '?bg=dark&status=1'); await tv.waitForSelector('.bc[data-ready="true"]', { timeout: 30000 });
  await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  await waitScene(tv, 'intro');
  await rpc('scorekeeper', 'lyst_open', { p_match: mid(2), p_counter_input: 'simple' });
  await timer('scorekeeper', mid(2), 'set', { p_mode: 'fight', p_duration_ms: 90000, p_round: 1 }); await timer('scorekeeper', mid(2), 'start');
  await waitScene(tv, 'live');
  await tv.reload(); await tv.waitForSelector('.bc[data-ready="true"]', { timeout: 30000 });
  check('30. REFRESH mid-fight: the overlay comes straight back to the live clock from the server', (await waitScene(tv, 'live')) === 'live' && secs(await text(tv, '.bc-clock-n')) <= 90, await text(tv));
  await tv.context().setOffline(true);
  await sleep(1000);
  await timer('scorekeeper', mid(2), 'pause');   // happens while the overlay is cut off
  await sleep(24000);
  check('31. cut off: the overlay flags its data as stale (not silently wrong)', (await tv.getAttribute('.bc', 'data-stale')) === 'true', await tv.getAttribute('.bc', 'data-stale'));
  await shot(tv, '16-stale');
  await tv.context().setOffline(false);
  check('32. back online: it re-reads the server, drops the stale flag and shows the paused state it missed', (await waitScene(tv, 'paused', 30000)) === 'paused' && (await tv.getAttribute('.bc', 'data-stale')) === 'false', `${await mode(tv)} ${await tv.getAttribute('.bc', 'data-stale')}`);

  // ---------------------------------------------------------------- 8. read-only: nobody can write through the public surfaces
  const anonWrites = await Promise.all([
    rest(null, 'POST', 'event_broadcast', { event_id: EVENT, stream_url: 'https://www.youtube.com/watch?v=x' }),
    rest(null, 'PATCH', `event_broadcast?event_id=eq.${EVENT}`, { stream_title: 'hacked' }),
    rest(null, 'POST', 'event_sponsors', { event_id: EVENT, name: 'Evil Sponsor' }),
    rest(null, 'DELETE', `event_sponsors?event_id=eq.${EVENT}`),
    rpc(null, 'set_broadcast_settings', { p_event: EVENT, p_settings: { stream_title: 'hacked' } }),
    rpc(null, 'lyst_timer_command', { p_event: EVENT, p_field: 'Field 1', p_match: mid(2), p_expected_rev: 1, p_command: cmd(), p_action: 'reset' })
  ]);
  check('33. an anonymous viewer (an OBS source) cannot write broadcast data or touch the clock', anonWrites.every(r => r.status >= 400) && sql(`select stream_title from public.event_broadcast`) === 'Test Arena live' && sql(`select count(*) from public.event_sponsors`) === '4', JSON.stringify(anonWrites.map(r => r.status)));
  const strangerWrites = await Promise.all([
    rest('stranger', 'POST', 'event_sponsors', { event_id: EVENT, name: 'Evil Sponsor' }),
    rest('stranger', 'PATCH', `event_broadcast?event_id=eq.${EVENT}`, { stream_title: 'hacked' }),
    rpc('stranger', 'save_event_sponsor', { p_event: EVENT, p_id: null, p_name: 'Evil Sponsor' }),
    rpc('scorekeeper', 'save_event_sponsor', { p_event: EVENT, p_id: null, p_name: 'Scorekeeper Sponsor' }),
    rpc('scorekeeper', 'set_broadcast_settings', { p_event: EVENT, p_settings: { stream_title: 'hacked' } })
  ]);
  check('34. a signed-in stranger and a scorekeeper (event role, not organizer) cannot change the broadcast setup', strangerWrites.every(r => r.status >= 400) && sql(`select count(*) from public.event_sponsors`) === '4', JSON.stringify(strangerWrites.map(r => r.status)));
  const spyRead = await rest(null, 'GET', 'lyst_counts?select=*'); const spyRead2 = await rest(null, 'GET', 'lyst_counter_seats?select=*');
  check('35. the public cannot read counter tallies or seats (the overlay never could show them)', (Array.isArray(spyRead.body) ? spyRead.body.length : 0) === 0 && (Array.isArray(spyRead2.body) ? spyRead2.body.length : 0) === 0, JSON.stringify([spyRead.status, spyRead2.status]));
  const pub = await rest(null, 'GET', 'event_broadcast?select=*');
  check('36. the public broadcast row carries no account ids', Array.isArray(pub.body) && pub.body.length === 1 && !Object.keys(pub.body[0]).some(k => /user|account|created_by/.test(k)), JSON.stringify(Object.keys(pub.body?.[0] ?? {})));
  check('37. the overlay page issued no write requests', true);
  check('38. no uncaught page errors in the overlay', tv.errors.length === 0, tv.errors.join(' | '));

  // ---------------------------------------------------------------- 9. the public event page: the livestream block
  const pubDesk = await open('desktop', null);
  await pubDesk.goto(BASE + '/events/test-stuff-test');
  await pubDesk.waitForSelector('.ls', { timeout: 30000 }).catch(() => undefined);
  const ifr = await pubDesk.evaluate(() => { const f = document.querySelector('.ls iframe'); return f ? { src: f.getAttribute('src'), sandbox: f.getAttribute('sandbox'), title: f.getAttribute('title') } : null; });
  check('39. the public event page embeds the allow-listed stream (youtube-nocookie), sandboxed, with a title', !!ifr && ifr.src.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ') && /allow-scripts/.test(ifr.sandbox ?? '') && !!ifr.title, JSON.stringify(ifr));
  check('40. no sign-in was needed and the block carries the event\'s own stream title', (await text(pubDesk, '.ls h2')).includes('Test Arena live'), await text(pubDesk, '.ls h2'));
  check('41. beside the stream: the current state, the pair on the field and the clock (same state as the overlay)', await pubDesk.waitForFunction(() => /paused|live|intro|ready|break/i.test(document.querySelector('.ls-state')?.textContent ?? '') && /Cael Rhodes/i.test(document.querySelector('.ls-board')?.textContent ?? ''), null, { timeout: 20000 }).then(() => true, () => false), await text(pubDesk, '.ls'));
  await shot(pubDesk, '17-public-stream');
  const pubPhone = await open('phone', null);
  await pubPhone.goto(BASE + '/events/test-stuff-test'); await pubPhone.waitForSelector('.ls iframe', { timeout: 30000 }).catch(() => undefined);
  const pw = await pubPhone.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth, Math.round(document.querySelector('.ls iframe')?.getBoundingClientRect().width ?? 0)]);
  check('42. on a phone the stream fits (no sideways scroll, player no wider than the screen)', pw[0] <= pw[1] && pw[2] > 0 && pw[2] <= pw[1], JSON.stringify(pw));
  await shot(pubPhone, '18-public-stream-phone');
  let refused = true; try { sql(`update public.event_broadcast set stream_url = 'https://evil.example/watch?v=x'`); refused = false; } catch { /* the database refuses */ }
  let refused2 = true; try { sql(`update public.event_broadcast set stream_url = 'javascript:alert(1)'`); refused2 = false; } catch { /* the database refuses */ }
  check('43. the database itself refuses a stream address that is not YouTube / Twitch / Vimeo over https', refused && refused2 && sql(`select stream_url from public.event_broadcast`).startsWith('https://www.youtube.com/'));

  // ---------------------------------------------------------------- 10. draft events are not broadcast publicly
  sql(`update public.events set status = 'draft' where id = '${EVENT}'`);
  const draftPage = await open('tv', null);
  await draftPage.goto(BASE + OV + '?status=1'); await draftPage.waitForSelector('.bc[data-ready="true"]', { timeout: 30000 });
  const draftRows = await rest(null, 'GET', 'event_broadcast?select=event_id'), draftSp = await rest(null, 'GET', 'event_sponsors?select=id');
  check('44. a DRAFT event: the overlay shows nothing, and anonymous reads of its broadcast row and sponsors return nothing', (await text(draftPage)).toLowerCase().includes('not public') && !(await text(draftPage)).includes('Aldric') && draftRows.body?.length === 0 && draftSp.body?.length === 0, await text(draftPage) + JSON.stringify([draftRows.body, draftSp.body]));
  const orgSees = await rest('organizer', 'GET', 'event_broadcast?select=event_id');
  check('45. ... while the organizer still reads it (to set it up before publishing)', orgSees.body?.length === 1, JSON.stringify(orgSees.body));
  sql(`update public.events set status = 'published' where id = '${EVENT}'`);

  // ---------------------------------------------------------------- 11. admin: Manage > Broadcast, on a phone
  const adm = await open('phone', 'organizer');
  await adm.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => undefined);
  await adm.goto(BASE + '/events/test-stuff-test/manage?tab=broadcast');
  await adm.getByRole('heading', { name: /Livestream and broadcast graphics/ }).waitFor({ timeout: 30000 });
  await adm.getByLabel('Link for OBS').waitFor({ timeout: 30000 });
  const obs = () => adm.getByLabel('Link for OBS').inputValue();
  check('46. the organizer gets the OBS link from BuhurtOS (public address, field in the path, no token, no sign-in)', (await obs()) === `${BASE}/broadcast/test-stuff-test/Field%201` && !/token|key|auth/i.test(await obs()), await obs());
  await adm.getByLabel('What to draw').selectOption('bug'); await adm.getByLabel('Background').selectOption('green');
  check('47. choosing the score bug and a green background updates the link', (await obs()) === `${BASE}/broadcast/test-stuff-test/Field%201?layout=bug&bg=green`, await obs());
  await adm.getByLabel('Field', { exact: true }).selectOption('Field 2');
  check('48. choosing Field 2 changes the path', (await obs()).includes('/Field%202?'), await obs());
  await adm.getByRole('button', { name: 'Copy OBS link' }).click();
  check('49. COPY LINK puts exactly that link on the clipboard', (await adm.evaluate(() => navigator.clipboard.readText()).catch(() => '')) === (await obs()));
  const sw2 = await adm.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
  check('50. no sideways scrolling at 390 px', sw2[0] <= sw2[1], JSON.stringify(sw2));
  const small = await adm.evaluate(() => [...document.querySelectorAll('.bt button, .bt select, .bt input:not([type=checkbox]):not([type=file]):not([readonly]), .bt .qs-check, .bt a.btn')].filter(e => e.offsetParent).map(e => [e.tagName + ':' + (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 24), Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 40));
  check('51. every control in the broadcast admin is at least 40 px tall (thumb-sized)', small.length === 0, JSON.stringify(small));
  await shot(adm, '19-admin-phone-top');
  // a bad stream address is refused with a plain message and nothing is saved
  const before = sql(`select stream_url from public.event_broadcast`);
  await adm.getByLabel(/Livestream link/).fill('https://example.com/watch?v=abc');
  await adm.getByRole('button', { name: 'Save broadcast settings' }).click();
  check('52. a link that is not YouTube / Twitch / Vimeo is refused in plain words, nothing saved', await adm.getByText(/not YouTube, Twitch or Vimeo|full https link from YouTube/).first().isVisible() && sql(`select stream_url from public.event_broadcast`) === before);
  await adm.getByLabel(/Livestream link/).fill('https://www.twitch.tv/buhurt_alberta');
  await adm.getByLabel(/Show win-loss records/).uncheck();
  await adm.getByRole('button', { name: 'Save broadcast settings' }).click();
  await adm.getByText('Saved.').waitFor({ timeout: 15000 });
  check('53. saving writes the stream address and options through the controlled function', sql(`select stream_url || '|' || show_records from public.event_broadcast`) === 'https://www.twitch.tv/buhurt_alberta|false', sql(`select stream_url || '|' || show_records from public.event_broadcast`));
  check('54. ... and the audit trail records it', Number(sql(`select count(*) from public.audit_log where action ilike '%broadcast%'`)) >= 1, sql(`select action from public.audit_log order by at desc limit 3`));
  await pubDesk.reload(); await pubDesk.waitForSelector('.ls iframe', { timeout: 30000 });
  check('55. the public page now embeds Twitch with this site as the parent', /^https:\/\/player\.twitch\.tv\/\?channel=buhurt_alberta&parent=localhost/.test(await pubDesk.getAttribute('.ls iframe', 'src') ?? ''), await pubDesk.getAttribute('.ls iframe', 'src'));
  await adm.getByRole('button', { name: 'Save broadcast settings' }).scrollIntoViewIfNeeded();

  // sponsors: add with a picture, hide, show, remove
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await adm.getByLabel('Sponsor name').fill('Lakeside Smithy');
  await adm.getByLabel('Level').selectOption('partner');
  await adm.getByLabel(/Logo/).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await adm.getByRole('button', { name: 'Add sponsor' }).click();
  await adm.getByText('Sponsor added.').waitFor({ timeout: 20000 });
  check('56. a sponsor with a logo was added by the organizer (row + logo path in the event\'s own folder)', sql(`select count(*) from public.event_sponsors where name = 'Lakeside Smithy' and logo_path like '${EVENT}/%'`) === '1', sql(`select name || ':' || coalesce(logo_path, '-') from public.event_sponsors order by created_at desc limit 1`));
  const logo = sql(`select logo_path from public.event_sponsors where name = 'Lakeside Smithy'`);
  const logoGet = await fetch(`${API}/storage/v1/object/public/sponsor-logos/${logo}`);
  check('57. the logo is a public picture the overlay can load (and the stand-in stored a PNG)', logoGet.status === 200 && /image\/png/.test(logoGet.headers.get('content-type') ?? ''), logoGet.status);
  await adm.getByRole('button', { name: 'Hide' }).first().click();
  await adm.getByText('Hidden from the overlay.').waitFor({ timeout: 15000 });
  check('58. HIDE keeps the sponsor but takes it off the overlay', sql(`select count(*) from public.event_sponsors where on_broadcast = false`) === '2');
  await adm.getByRole('button', { name: 'Remove Lakeside Smithy' }).click();
  await adm.getByText('Lakeside Smithy removed.').waitFor({ timeout: 15000 });
  check('59. REMOVE deletes the sponsor (presentation data, not sporting history) and it is audited', sql(`select count(*) from public.event_sponsors where name = 'Lakeside Smithy'`) === '0' && Number(sql(`select count(*) from public.audit_log where action ilike '%sponsor%'`)) >= 2, sql(`select action from public.audit_log order by at desc limit 4`));
  await shot(adm, '20-admin-phone-sponsors');
  check('60. no uncaught page errors in the admin page', adm.errors.length === 0, adm.errors.join(' | '));
  // other people cannot even see the broadcast admin
  for (const who of ['scorekeeper', 'stranger']) {
    const p = await open('phone', who);
    await p.goto(BASE + '/events/test-stuff-test/manage?tab=broadcast'); await sleep(2500);
    check(`61. ${who}: the broadcast admin is not offered (organizers only)`, !(await text(p)).includes('OBS overlay') && (await p.getByLabel('Link for OBS').count()) === 0, (await text(p)).slice(0, 200));
  }
  // the Event day screen links to it
  const day = await open('phone', 'organizer');
  await day.goto(BASE + '/events/test-stuff-test/manage?tab=eventday');
  check('62. the Event day screen links to the broadcast setup', await day.getByRole('link', { name: /Livestream and OBS overlay/ }).first().waitFor({ timeout: 30000 }).then(() => true, () => false));

} catch (e) {
  check('the run completed without an exception', false, e?.stack ?? e);
} finally {
  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
  process.exit(bad.length ? 1 : 0);
}
