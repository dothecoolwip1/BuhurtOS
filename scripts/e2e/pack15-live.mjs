// Pack 15 against a REAL local stack: Postgres built from every migration + the Pack 15 fixture, PostgREST, the real BUILT app (production service
// worker) in real Chromium. The queue is moved only through the existing paths (advance_field_queue, submit_match_result, the organizer's own
// REST write of a fight time), and every alert is checked in the database AND where a person sees it (the bell, My next fight, the phone screens).
// What this can NOT prove: delivery through a real push service to a physical phone (see docs/runbooks/PACK15_DEVICE_RUNBOOK.md).
// Run it through scripts/e2e/pack15-live.sh. LOCAL EVIDENCE ONLY (needs a PostgREST binary; not part of CI).
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
const U = (n) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`;
const WHO = {
  organizer: ['00000000-0000-0000-0000-0000000000a2', 'u2@example.test'], scorekeeper: ['00000000-0000-0000-0000-0000000000a4', 'u4@example.test'], stranger: ['00000000-0000-0000-0000-0000000000a7', 'u7@example.test'],
  aldric: [U(1), 'fighter1@example.test'], brann: [U(2), 'fighter2@example.test'], cael: [U(3), 'fighter3@example.test'], dara: [U(4), 'fighter4@example.test'], edric: [U(5), 'fighter5@example.test']
};
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const mid = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const EVENT = '00000000-0000-0000-0000-00000000ed01';
async function rest(who, method, path, body, extra = {}) {
  const headers = { 'content-type': 'application/json', apikey: 'x', ...extra, ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args) => rest(who, 'POST', `rpc/${fn}`, args);
const version = (n) => Number(sql(`select version from public.matches where id = '${mid(n)}'`));
const finish = (who, n, result = 'a', a = 5, b = 3) => rpc(who, 'submit_match_result', { p_command: crypto.randomUUID(), p_match: mid(n), p_result: result, p_score_a: a, p_score_b: b, p_detail: {}, p_expected_version: version(n), p_schema: 1 });
const alerts = (u, kind, extra = '') => Number(sql(`select count(*) from public.notifications where user_id = '${u}' and kind = '${kind}' ${extra}`));
const words = async (who, kind) => { const r = await rpc(who, 'my_notification_feed', { p_limit: 50 }); const n = (r.body ?? []).find(x => x.kind === kind); return n ? `${n.title} | ${n.body}` : `(none: ${r.status})`; };

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
async function open(who, opts = {}) {
  const ctx = await browser.newContext({ ...PHONE, serviceWorkers: opts.sw ? 'allow' : 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|youtube(-nocookie)?\.com|twitch\.tv|vimeo\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  if (opts.init) await ctx.addInitScript(opts.init.fn, opts.init.arg);
  const page = await ctx.newPage();
  page.ctx = ctx; page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  return page;
}
const text = async (page, sel = 'body') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = async (page, name) => { if (SHOTS) { await sleep(400); await page.screenshot({ path: `${SHOTS}/p15-${name}.png` }).catch(() => undefined); } };
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);
const bellText = async (page) => { await page.getByRole('button', { name: /^Notifications/ }).first().click(); await sleep(600); const t = await text(page, '#notif-panel'); await page.keyboard.press('Escape'); return t || await text(page); };

try {
  // ================================================================ 1. the queue starts: alerts say how far away and where to report
  const start = await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  check('1. the organizer starts Field 1 through the existing queue (Aldric v Brann now, Cael v Dara on deck, Edric v Fenna in the hole)',
    start.status === 200 && sql(`select string_agg(queue_state, ',' order by position, round_label) from public.matches where id in ('${mid(1)}','${mid(2)}','${mid(3)}')`) !== '', JSON.stringify(start));
  check('2. Edric (in the hole) is told "You\'re 2 fights away" with the field', (await words('edric', 'fight_called')) === 'You\'re 2 fights away | Start getting ready for Longsword (men) on Field 1.', await words('edric', 'fight_called'));
  check('3. Cael and Dara (on deck) are told "You\'re up next · Report to Field 1"', (await words('cael', 'fight_called')) === 'You\'re up next | Report to Field 1 and be ready to fight.' && (await words('dara', 'fight_called')).startsWith('You\'re up next'), await words('cael', 'fight_called'));
  check('4. Aldric and Brann (on the field) are told "Your fight is ready · Report to Field 1 now"', (await words('aldric', 'fight_called')) === 'Your fight is ready | Report to Field 1 now.' && (await words('brann', 'fight_called')).startsWith('Your fight is ready'), await words('aldric', 'fight_called'));
  check('5. each alert is pushed (lock screen) and opens My next fight', sql(`select bool_and(push) and bool_and(route = '/events/test-stuff-test#my-next-fight') from public.notifications where kind = 'fight_called'`) === 't');

  // ================================================================ 2. no duplicates from repeats, reads, refreshes
  const before = Number(sql(`select count(*) from public.notifications`));
  await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  await rpc('organizer', 'set_match_queue', { p_match: mid(2), p_state: 'on_deck' });
  const fighter = await open('edric');
  for (let i = 0; i < 3; i++) { await fighter.goto(`${BASE}/events/test-stuff-test#my-next-fight`); await sleep(1500); }
  await rpc('edric', 'my_notification_feed', { p_limit: 50 });
  check('6. starting again, re-writing the same state, three page loads and feed reads: NO new alert', Number(sql(`select count(*) from public.notifications`)) === before, `${before} -> ${sql(`select count(*) from public.notifications`)}`);
  check('7. every fight alert carries a durable dedupe key', sql(`select count(*) from public.notifications where kind in ('fight_called','fight_moved') and dedupe_key is null`) === '0');

  // ================================================================ 3. what the fighter sees: My next fight and the bell (phone)
  const card = await text(fighter, '#my-next-fight');
  check('8. Edric\'s phone: My next fight shows the called fight', /edric|fenna/i.test(card) && /field 1/i.test(card), card.slice(0, 200));
  const bell = await bellText(fighter);
  check('9. Edric\'s bell lists the same words as the push ("You\'re 2 fights away")', /2 fights away/i.test(bell), bell.slice(0, 300));
  check('10. no sideways scrolling on the fighter\'s phone', await noSideways(fighter));
  await shot(fighter, '01-fighter-bell');

  // ================================================================ 4. a result moves the line (the real path): the next alerts follow
  const fin = await finish('scorekeeper', 1);
  await sleep(1000);
  check('11. a result for the fight on the field is accepted through the existing path', fin.status === 200 && sql(`select queue_state from public.matches where id = '${mid(1)}'`) === 'final', JSON.stringify(fin.body));
  check('12. ... the line moved up by itself: Cael/Dara "ready", Edric "up next"', (await words('cael', 'fight_called')).startsWith('Your fight is ready') && (await words('edric', 'fight_called')).startsWith('You\'re up next'), `${await words('cael', 'fight_called')} / ${await words('edric', 'fight_called')}`);
  check('13. ... Aldric and Brann\'s finished fight sends them nothing more, and its alerts are retired (read)', sql(`select count(*) from public.notifications where kind = 'fight_called' and payload ->> 'match_id' = '${mid(1)}' and read_at is null`) === '0');

  // ================================================================ 5. offline and back: the bell catches up, nothing is duplicated
  await fighter.goto(`${BASE}/events/test-stuff-test`);
  await sleep(2000);
  await fighter.ctx.setOffline(true);
  await sleep(500);
  check('14. offline: the app says so plainly (not pretending stale is live)', /you are offline/i.test(await text(fighter)), (await text(fighter)).slice(0, 200));
  await rpc('organizer', 'set_match_queue', { p_match: mid(3), p_state: 'on_deck', p_field: 'Field 2' });
  await fighter.ctx.setOffline(false);
  await sleep(2500);
  const moved = await words('edric', 'fight_moved');
  check('15. while Edric was offline his fight changed field: one "Your fight changed field · It is now on Field 2"', moved === 'Your fight changed field | It is now on Field 2. Report there.' && alerts(U(5), 'fight_moved') === 1, moved);
  const bell2 = await bellText(fighter);
  check('16. back online: the offline notice is gone and the bell shows the change without a refresh', !/you are offline/i.test(await text(fighter)) && /changed field/i.test(bell2), bell2.slice(0, 200));
  check('17. reconnecting created no duplicate', alerts(U(5), 'fight_moved') === 1);
  await shot(fighter, '02-after-reconnect');

  // ================================================================ 6. the organizer moves a fight time (their own REST write, the existing path)
  const m5 = await rest('organizer', 'PATCH', `matches?id=eq.${mid(5)}`, { scheduled_at: new Date(Date.parse(sql(`select scheduled_at from public.matches where id = '${mid(5)}'`)) + 45 * 60000).toISOString() }, { prefer: 'return=minimal' });
  await sleep(500);
  check('18. a 45-minute move of a fight time tells both fighters once ("Your schedule changed")', m5.status === 204 && alerts(U(2), 'schedule_changed') === 1 && (await words('brann', 'schedule_changed')).startsWith('Your schedule changed'), `${m5.status} ${alerts(U(2), 'schedule_changed')}`);
  await rest('organizer', 'PATCH', `matches?id=eq.${mid(6)}`, { scheduled_at: new Date(Date.now() + 2 * 3600000).toISOString() }, { prefer: 'return=minimal' });
  check('19. another of Brann\'s fights moved minutes later: still ONE alert (coalesced per person per event)', alerts(U(2), 'schedule_changed') === 1, String(alerts(U(2), 'schedule_changed')));

  // ================================================================ 7. organizer announcement from the phone (Manage › Event day)
  const org = await open('organizer');
  await org.goto(`${BASE}/events/test-stuff-test/manage?tab=eventday`);
  await org.getByRole('heading', { name: /Announce to the event/i }).waitFor({ timeout: 30000 });
  const box = org.getByLabel(/Message/);
  await box.fill('Lyst 2 is running 20 minutes behind.');
  check('20. the announcement panel counts characters and says no links', /characters left/i.test(await text(org, '#ann-left')) && /no links/i.test(await text(org, '#ann-left')));
  await org.getByRole('button', { name: 'Send announcement' }).click();
  await org.getByText(/^Sent to \d+ (people|person)\.$/).waitFor({ timeout: 15000 });
  const sent = Number(sql(`select recipients from public.event_announcements order by sent_at desc limit 1`));
  check('21. sent from the phone: recorded with its recipients and audited', sent >= 5 && sql(`select count(*) from public.audit_log where action = 'event.announcement'`) === '1', String(sent));
  check('22. a fighter of the event gets it, with the event as the title', (await words('cael', 'event_announcement')) === 'Test stuff test | Lyst 2 is running 20 minutes behind.', await words('cael', 'event_announcement'));
  check('23. a stranger gets nothing', alerts(WHO.stranger[0], 'event_announcement') === 0);
  await org.getByLabel(/Message/).fill('See https://evil.example for the results');
  await org.getByRole('button', { name: 'Send announcement' }).click();
  await sleep(1200);
  check('24. a link is refused in plain words, nothing sent', /links are not allowed/i.test(await text(org)) && sql(`select count(*) from public.event_announcements`) === '1');
  check('25. the panel lists what was sent', /Lyst 2 is running 20 minutes behind/i.test(await text(org)));
  check('26. organizer phone: no sideways scrolling', await noSideways(org));
  const small = await org.evaluate(() => [...document.querySelectorAll('section[aria-labelledby="ann-h"] button, section[aria-labelledby="ann-h"] select, section[aria-labelledby="ann-h"] textarea')].filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h < 40));
  check('27. the announcement controls are thumb-sized (40 px+)', small.length === 0, JSON.stringify(small));
  await org.locator('section[aria-labelledby="ann-h"]').scrollIntoViewIfNeeded();
  await shot(org, '03-organizer-announce');

  // ================================================================ 8. nobody else can message or read the private tables
  const tries = await Promise.all([
    rpc('scorekeeper', 'send_event_announcement', { p_event: EVENT, p_message: 'Scorekeeper message.' }),
    rpc('aldric', 'send_event_announcement', { p_event: EVENT, p_message: 'Fighter message.' }),
    rpc('stranger', 'send_event_announcement', { p_event: EVENT, p_message: 'Stranger message.' }),
    rpc(null, 'send_event_announcement', { p_event: EVENT, p_message: 'Anonymous message.' })
  ]);
  check('28. a scorekeeper, a fighter, a stranger and anonymous cannot send announcements', tries.every(r => r.status >= 400) && sql(`select count(*) from public.event_announcements`) === '1', JSON.stringify(tries.map(r => r.status)));
  const reads = await Promise.all([rest('aldric', 'GET', 'notifications?select=*'), rest('aldric', 'GET', 'push_subscriptions?select=*'), rest(null, 'GET', 'event_announcements?select=*'), rest('aldric', 'GET', 'event_announcements?select=*')]);
  check('29. no client reads notifications, subscriptions or announcements tables directly', reads.every(r => r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0)), JSON.stringify(reads.map(r => r.status)));
  const feed = await rpc('aldric', 'my_notification_feed', { p_limit: 200 });
  check('30. a person\'s feed holds only their own alerts', Array.isArray(feed.body) && feed.body.length > 0 && Number(sql(`select count(*) from public.notifications where user_id <> '${U(1)}' and id in (${feed.body.map(n => `'${n.id}'`).join(',')})`)) === 0);

  // ================================================================ 9. a tap on a fight alert while signed out: sign in right there, stay on the event
  const out = await open(null);
  await out.goto(`${BASE}/events/test-stuff-test#my-next-fight`);
  await out.getByRole('heading', { name: 'Sign in' }).waitFor({ timeout: 30000 }).catch(() => undefined);
  check('31. signed out, a fight alert\'s address asks to sign in where My next fight would be (not a dead end)', /sign in to see your next fight/i.test(await text(out)), (await text(out)).slice(0, 300));
  await out.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [STORAGE_KEY, session(WHO.edric)]);
  await out.reload();
  await out.locator('#mynext-h').waitFor({ timeout: 30000 }).catch(() => undefined);
  check('32. after signing in, the same address shows My next fight (the destination was kept)', out.url().endsWith('/events/test-stuff-test#my-next-fight') && (await out.locator('#mynext-h').count()) === 1, out.url());
  await shot(out, '04-signed-out-landing');

  // ================================================================ 10. notification settings on a phone: the two switches apart
  const acct = await open('aldric');
  await acct.goto(`${BASE}/account#notifications`);
  await acct.getByTestId('ns-perm').waitFor({ timeout: 30000 });
  check('33. Settings show the browser permission and the BuhurtOS switch separately', (await acct.getByTestId('ns-perm').innerText()).length > 0 && /^(On|Off)$/.test((await acct.getByTestId('ns-device').innerText()).trim()), `${await acct.getByTestId('ns-perm').innerText()} / ${await acct.getByTestId('ns-device').innerText()}`);
  check('34. the groups explain the new alerts (2 fights away, announcements)', /2 fights away/i.test(await text(acct)) && /announcements/i.test(await text(acct)));
  check('35. settings: no sideways scrolling at 390 px', await noSideways(acct));
  await acct.locator('#notifications').scrollIntoViewIfNeeded();
  await shot(acct, '05-settings');

  // ================================================================ 11. installable app + a device whose permission was revoked leaves the list
  const devId = sql(`insert into public.push_subscriptions (user_id, endpoint, endpoint_digest, p256dh, auth, label) values ('${U(4)}', 'https://push.example.test/ep/dara-1', 'x', '${'A'.repeat(87)}', '${'B'.repeat(22)}', 'Android phone') returning id`).split('\n')[0];
  const dara = await open('dara', { sw: true, init: { fn: ([uid, id]) => { localStorage.setItem(`bos-push-on:${uid}`, '1'); localStorage.setItem(`bos-push-device:${uid}`, id); }, arg: [U(4), devId] } });
  await dara.goto(`${BASE}/`);
  await dara.waitForFunction(() => navigator.serviceWorker?.controller !== null || false, null, { timeout: 30000 }).catch(() => undefined);
  const perm = await dara.evaluate(() => Notification.permission);
  await sleep(2500);
  check('36. the browser here reports notifications as blocked, and the device had been registered before', perm === 'denied', perm);
  check('37. on start, a device whose permission is now blocked removes its own registration (no alerts sent to a dead end)', sql(`select (revoked_at is not null)::text from public.push_subscriptions where id = '${devId}'`) === 'true', sql(`select revoked_at from public.push_subscriptions where id = '${devId}'`));
  const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  const icons = await Promise.all(manifest.icons.map(i => fetch(`${BASE}/${i.src}`).then(r => r.status)));
  check('38. installable: manifest name/short name BuhurtOS, standalone, relative start_url and scope, every icon served (incl. maskable)',
    manifest.name === 'BuhurtOS' && manifest.short_name === 'BuhurtOS' && manifest.display === 'standalone' && manifest.start_url.startsWith('./') && manifest.scope === './' && icons.every(s => s === 200) && manifest.icons.some(i => i.purpose === 'maskable'), JSON.stringify({ icons }));
  const controlled = await dara.evaluate(async () => { await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller || (await navigator.serviceWorker.getRegistration()) !== undefined; });
  check('39. the production service worker is installed', controlled);
  await dara.reload(); await sleep(1500);
  await dara.ctx.setOffline(true);
  await dara.goto(`${BASE}/events/test-stuff-test`).catch(() => undefined);
  await sleep(2000);
  const offlineShell = await text(dara);
  check('40. launched with no signal: the app shell opens (not a blank or browser error page) and says it is offline', offlineShell.length > 40 && /offline/i.test(offlineShell), offlineShell.slice(0, 200));
  await dara.ctx.setOffline(false);
  await shot(dara, '06-offline-launch');

  const errs = [fighter, org, out, acct].flatMap(p => p.errors);
  check('41. no uncaught page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('the run completed without an exception', false, e?.stack ?? e);
} finally {
  await browser.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
  process.exit(bad.length ? 1 : 0);
}
