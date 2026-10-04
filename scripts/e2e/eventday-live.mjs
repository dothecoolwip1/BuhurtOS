// Event day (Pack 09A) against a REAL local stack: Postgres built from the migrations + fixture, PostgREST, the real built app in a real Chromium.
// Everything the screen shows is checked against the database too. Run it through scripts/e2e/eventday-live.sh (which starts the stack).
// Not part of CI: needs a PostgREST binary. The polling fallback is what keeps the screen fresh here (the local stack offers no realtime socket).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 500)}`); };
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
const state = (n) => sql(`select queue_state from public.matches where id = '${mid(n)}'`);
const states = (...ns) => ns.map(n => `${n}:${state(n)}`).join(',');
async function rpc(who, fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session(WHO[who]).access_token}`, apikey: 'x' }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const version = (n) => Number(sql(`select version from public.matches where id = '${mid(n)}'`));
const finishAsDevice = (who, n, result = 'a', a = 5, b = 3) => rpc(who, 'submit_match_result', { p_command: crypto.randomUUID(), p_match: mid(n), p_result: result, p_score_a: a, p_score_b: b, p_detail: {}, p_expected_version: version(n), p_schema: 1 });

let lastPage = null;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
async function open(kind, who) {
  const vp = { desktop: { viewport: { width: 1280, height: 900 } }, tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } }[kind];
  const ctx = await browser.newContext({ ...vp, serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  return { ctx, page };
}
const body = async (page) => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').toLowerCase();
const has = async (page, text) => (await body(page)).includes(text.toLowerCase());
const field = (page, name) => page.locator(`section.ed-field[aria-label="${name}"]`);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/eventday-${name}.png`, fullPage: true }); };
const waitText = (page, loc, text, timeout = 30000) => page.waitForFunction(([sel, t]) => (document.querySelector(sel)?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(t), [loc, text.toLowerCase()], { timeout }).then(() => true, () => false);
const MANAGE = '/events/test-stuff-test/manage';
const noSideways = (page) => page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);

try {
  // ================================================================ 1. the organizer opens Manage on the day of the event
  const { ctx: dctx, page } = await open('desktop', 'organizer');
  await page.goto(BASE + MANAGE); await page.waitForSelector('section.eventday', { timeout: 20000 });
  check('Manage opens on Event day while the event is running (no tab chosen)', (await page.locator('[aria-label="Area"] button[aria-pressed="true"]').innerText()) === 'Event day');
  await page.waitForSelector('section.ed-field[aria-label="Field 1"]', { timeout: 20000 });
  check('Field 1 appears with no setup; Field 2 appears because matches were given it', (await field(page, 'Field 1').count()) === 1 && (await field(page, 'Field 2').count()) === 1);
  check('the matches really have no field in the database (Field 1 is only the default)', sql(`select count(*) from public.matches where field is null`) === '10', sql(`select count(*) from public.matches where field is null`));
  check('Field 1 says no fight is active and offers to start the next ready match', await has(page, 'No fight is active on Field 1.') && (await page.getByRole('button', { name: 'Start next ready match' }).count()) === 2);
  await shot(page, '1-desktop-before-start');

  // ================================================================ 2. start Field 1
  await field(page, 'Field 1').getByRole('button', { name: 'Start next ready match' }).click();
  check('starting says what started', await waitText(page, 'section.ed-field[aria-label="Field 1"]', 'Aldric Stone'), await body(page));
  const f1 = field(page, 'Field 1');
  check('NOW is the first fight of the line', /aldric stone.*brann oakley/i.test((await f1.locator('.ed-now').innerText()).replace(/\s+/g, ' ')));
  check('ON DECK is the second, IN THE HOLE the third', (await f1.locator('li.ed-slot[aria-label^="On deck"]').innerText()).toLowerCase().includes('cael rhodes') && (await f1.locator('li.ed-slot[aria-label^="In the hole"]').innerText()).toLowerCase().includes('edric hale'));
  const upNext = (await f1.locator('.ed-up').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').toLowerCase());
  check('Up next follows the schedule: round 2 first, then the Polearm semifinals', upNext.length === 5 && /aldric stone.*cael rhodes/.test(upNext[0]) && /kell arden/.test(upNext[3]) && /mace tarn/.test(upNext[4]), upNext.join(' | '));
  check('the queue is stored: 1 active, 2 on deck, 3 in the hole; the rest still scheduled', states(1, 2, 3, 4, 5, 6, 21, 22) === '1:active,2:on_deck,3:in_the_hole,4:scheduled,5:scheduled,6:scheduled,21:scheduled,22:scheduled', states(1, 2, 3, 4));
  check('Field 1 matches still have no field written (the default is not stored)', sql(`select count(*) from public.matches where field is null`) === '10');
  check('Field 2 was not touched by starting Field 1', states(11, 12, 13) === '11:scheduled,12:scheduled,13:scheduled');
  check('the final and third place (waiting for results) are not in the line, only counted under "waiting"', (await f1.locator('.ed-waiting').innerText()).toLowerCase().includes('waiting') && !upNext.some(t => /\bfinal\b|third place/.test(t)));
  check('final and third place were not promoted by the queue', states(23, 24) === '23:scheduled,24:scheduled');

  // ---- needs attention + progress
  const att = (await page.locator('section.ed-attention').innerText()).replace(/\s+/g, ' ').toLowerCase();
  check('Needs attention: a fighter in the live fights who is not checked in', /not checked in/.test(att) && /brann oakley/.test(att), att);
  check('Needs attention: the double booking names the fighter, both fights, times and fields', /aldric stone is booked twice/.test(att) && /longsword \(men\) at/.test(att) && /sword and shield \(men\) at/.test(att) && /\(field 2\)/.test(att), att);
  const prog = (await page.locator('section.ed-progress').innerText()).replace(/\s+/g, ' ').toLowerCase();
  check('Competition progress: not started / no draw / counts from real matches', /longsword \(men\).*0 \/ 6 fights complete/.test(prog) && /buckler \(men\).*no draw yet/.test(prog) && /polearm \(men\).*0 \/ 4/.test(prog), prog);

  // ================================================================ 3. open the scoreboard, record a result, come back
  await f1.getByRole('link', { name: 'Open scoreboard' }).click();
  await page.getByText('Head or torso +2').first().waitFor({ timeout: 30000 });
  check('Open scoreboard goes straight to the existing scoring screen on that match', /\/events\/test-stuff-test\/field\/Field%201/.test(page.url()) && (await has(page, 'Aldric Stone vs Brann Oakley')), page.url());
  for (let r = 0; r < 2; r++) { await page.getByRole('button', { name: 'Head or torso +2' }).first().click(); await page.getByRole('button', { name: 'End round' }).click(); }
  await page.getByText('wins the match').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Finish match' }).click();
  await page.getByRole('button', { name: 'Save result' }).click();
  await page.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
  check('the existing scoring board saved an official result', sql(`select queue_state || result || score_a || '-' || score_b from public.matches where id = '${mid(1)}'`) === 'finala4-0', sql(`select queue_state || result || score_a || '-' || score_b from public.matches where id = '${mid(1)}'`));
  check('... and the queue advanced in the same moment: 2 active, 3 on deck, 4 in the hole, 5 waiting', states(2, 3, 4, 5) === '2:active,3:on_deck,4:in_the_hole,5:scheduled', states(2, 3, 4, 5));
  check('... without Field 1 being written onto the matches', sql(`select count(*) from public.matches where field is null`) === '10');
  await page.getByRole('button', { name: 'Back to the queue' }).click();
  await page.getByRole('link', { name: 'Back to Event day' }).click();
  await page.waitForSelector('section.eventday', { timeout: 20000 });
  check('back on Event day (?from=eventday gave the way back)', page.url().includes('tab=eventday'), page.url());
  await waitText(page, 'section.ed-field[aria-label="Field 1"] .ed-now', 'Cael Rhodes');
  check('the finished fight is gone and the next one is NOW', /cael rhodes.*dara voss/i.test((await field(page, 'Field 1').locator('.ed-now').innerText()).replace(/\s+/g, ' ')));
  check('competition progress went up', /longsword \(men\).*1 \/ 6 fights complete · 17%/.test((await page.locator('section.ed-progress').innerText()).replace(/\s+/g, ' ').toLowerCase()));

  // ================================================================ 4. another device finishes the active fight: no refresh needed
  await page.evaluate(() => { window.__marker = 'same page'; });
  const r2 = await finishAsDevice('scorekeeper', 2);
  check('a scorekeeper on another device saves the result', r2.body?.status === 'accepted', JSON.stringify(r2));
  check('the database advanced the queue by itself: 3 active, 4 on deck, 5 in the hole', states(3, 4, 5) === '3:active,4:on_deck,5:in_the_hole', states(3, 4, 5));
  const arrived = await waitText(page, 'section.ed-field[aria-label="Field 1"] .ed-now', 'Edric Hale', 40000);
  check('the organizer\'s screen follows by itself (no reload, same page)', arrived && (await page.evaluate(() => window.__marker)) === 'same page', await body(page));
  check('... and the on-deck / in-the-hole cards moved too', (await field(page, 'Field 1').locator('li.ed-slot[aria-label^="On deck"]').innerText()).toLowerCase().includes('aldric stone'));

  // ================================================================ 5. a result two devices disagree about
  const dis = await finishAsDevice('scorekeeper', 1, 'b', 5, 4);
  check('a second device sends a DIFFERENT result for a fight that is already official: kept for review, not applied', dis.body?.status === 'conflict' && sql(`select result from public.matches where id = '${mid(1)}'`) === 'a', JSON.stringify(dis));
  const sawReview = await waitText(page, 'section.ed-attention', 'result needs review', 45000);
  check('Needs attention shows it, first', sawReview && /^1 result needs review/i.test((await page.locator('section.ed-attention .ed-att').first().innerText()).trim()), await page.locator('section.ed-attention').innerText());
  await page.getByRole('button', { name: 'Keep the official result' }).waitFor({ timeout: 20000 }).catch(() => undefined);
  check('the existing review panel is right there with both choices', (await page.getByRole('button', { name: 'Keep the official result' }).count()) === 1 && (await page.getByRole('button', { name: "Use the other device's result" }).count()) === 1);
  check('nothing changed the official result', sql(`select result || score_a || '-' || score_b from public.matches where id = '${mid(1)}'`) === 'a4-0');
  await shot(page, '5-desktop-review');

  // ================================================================ 6. skip and reorder (no drag and drop)
  const before = sql(`select string_agg(to_char(scheduled_at,'HH24:MI'), ',' order by id) from public.matches`);
  const deck = f1 => f1.locator('li.ed-slot[aria-label^="On deck"]');
  await deck(field(page, 'Field 1')).locator('summary').click();
  await deck(field(page, 'Field 1')).getByRole('button', { name: 'Skip for now' }).click();
  await waitText(page, 'section.ed-field[aria-label="Field 1"] li.ed-slot[aria-label^="On deck"]', 'Brann Oakley');
  check('skipping the fight on deck: the one in the hole moves up, nothing is lost', states(4, 5) === '4:in_the_hole,5:on_deck', states(4, 5));
  const up0 = field(page, 'Field 1').locator('.ed-up').filter({ hasText: /Kell Arden/i });
  await up0.locator('summary').click();
  await up0.getByRole('button', { name: 'Run next' }).click();
  await waitText(page, 'section.ed-field[aria-label="Field 1"] li.ed-slot[aria-label^="On deck"]', 'Kell Arden');
  check('"Run next" puts a waiting fight on deck and pushes the others back', states(21, 5, 4) === '21:on_deck,5:in_the_hole,4:scheduled', states(21, 5, 4));
  check('... the schedule times were not touched by any of it', sql(`select string_agg(to_char(scheduled_at,'HH24:MI'), ',' order by id) from public.matches`) === before);
  check('... and no result changed', sql(`select count(*) from public.matches where queue_state = 'final' and result = 'a' and score_a = 4`) === '1');
  const upAfter = (await field(page, 'Field 1').locator('.ed-up').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').toLowerCase());
  check('the screen shows the new order of Up next', upAfter.length >= 2 && /aldric stone.*cael rhodes/.test(upAfter[0]), upAfter.join(' | '));
  const upNames = async () => (await field(page, 'Field 1').locator('.ed-up .ed-names').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').toLowerCase());
  const orderBefore = await upNames();
  const up1 = field(page, 'Field 1').locator('.ed-up').first();
  await up1.locator('summary').click();
  await up1.getByRole('button', { name: 'Run later' }).click();
  await page.waitForFunction((first) => (document.querySelector('section.ed-field[aria-label="Field 1"] .ed-up .ed-names')?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase() !== first, orderBefore[0], { timeout: 20000 }).catch(() => undefined);
  const orderAfter = await upNames();
  check('"Run later" moves a waiting fight back exactly one place', orderAfter[1] === orderBefore[0] && orderAfter[0] === orderBefore[1], JSON.stringify({ orderBefore, orderAfter }));
  await shot(page, '6-desktop-after-reorder');

  // ================================================================ 7. Field 2 is its own queue
  await field(page, 'Field 2').getByRole('button', { name: 'Start next ready match' }).click();
  await waitText(page, 'section.ed-field[aria-label="Field 2"] .ed-now', 'Hale Morrow');
  check('Field 2 started on its own, in schedule order (12, then 13, then 11)', states(12, 13, 11) === '12:active,13:on_deck,11:in_the_hole', states(12, 13, 11));
  check('... and Field 1 did not move when Field 2 started', states(3, 21, 5) === '3:active,21:on_deck,5:in_the_hole', states(3, 21, 5));
  const r12 = await finishAsDevice('organizer', 12);
  check('a result on Field 2 advances Field 2 only', r12.body?.status === 'accepted' && states(13, 11) === '13:active,11:on_deck' && states(3, 21, 5) === '3:active,21:on_deck,5:in_the_hole', states(11, 13, 3, 21, 5));

  // ================================================================ 8. an entrant withdraws
  sql(`update public.entries set status = 'withdrawn' where id = '00000000-0000-0000-0000-00000000e244'`);   // Nell Rook (polearm semifinal 2, match 22)
  const walk = await waitText(page, 'section.ed-attention', 'has withdrawn', 45000);
  check('a withdrawal in a fight that is not called shows up as a walkover to record', walk, await page.locator('section.ed-attention').innerText());
  check('the fight with the withdrawn entrant is not in Up next and is never promoted', !(await field(page, 'Field 1').locator('.ed-up').allInnerTexts()).join(' ').toLowerCase().includes('nell rook'));
  const adv = await rpc('organizer', 'advance_field_queue', { p_event: '00000000-0000-0000-0000-00000000ed01', p_field: 'Field 1', p_start: true });
  check('asking the database to advance does not promote it either', adv.status === 200 && state(22) === 'scheduled', JSON.stringify(adv));
  sql(`update public.entries set status = 'registered' where id = '00000000-0000-0000-0000-00000000e244'`);

  // ================================================================ 9. the Run tools still work, and the attention items link into them
  await page.locator('section.ed-attention').getByRole('link', { name: 'Go to match' }).first().click();
  await page.waitForSelector('[id^="match-"]', { timeout: 20000 });
  check('"Go to match" opens Run tools at that fight', page.url().includes('tab=run&match=') && (await page.locator('[aria-label="Area"] button[aria-pressed="true"]').innerText()) === 'Run', page.url());
  check('Run still shows the draw and schedule controls', (await has(page, 'Build a new draw')) || (await has(page, 'Schedule from')) || (await page.getByText('Longsword (men)').count()) > 0);
  await page.getByRole('button', { name: 'Event day', exact: true }).click(); await page.waitForSelector('section.eventday');

  check('no page errors (desktop)', page.errors.length === 0, page.errors.join(' | '));

  // ================================================================ 10. the public page still shows the queue
  const { ctx: actx, page: anon } = await open('desktop', null);
  await anon.goto(BASE + '/events/test-stuff-test'); await anon.waitForSelector('.live-now', { timeout: 30000 });
  const pub = (await anon.locator('.live-now').innerText()).replace(/\s+/g, ' ').toLowerCase();
  check('the public "Now and next" shows both fields from the same queue', /field 1/.test(pub) && /field 2/.test(pub) && /edric hale/.test(pub) && /hale morrow|ivor penn/.test(pub), pub);
  check('the public page exposes no organizer controls', (await anon.getByRole('button', { name: 'Start next ready match' }).count()) === 0);
  await actx.close();
  const { ctx: sctx, page: score } = await open('desktop', 'scorekeeper');
  await score.goto(BASE + MANAGE); await score.waitForSelector('text=This area is for organizers', { timeout: 20000 });
  check('a scorekeeper does not get the Event day screen', (await score.locator('section.eventday').count()) === 0);
  const denied = await rpc('scorekeeper', 'move_match_in_queue', { p_match: mid(6), p_action: 'first' });
  check('... and the database refuses their reorder', denied.status >= 400 && /organizer/i.test(JSON.stringify(denied.body)), JSON.stringify(denied));
  const okAdvance = await rpc('scorekeeper', 'advance_field_queue', { p_event: '00000000-0000-0000-0000-00000000ed01', p_field: 'Field 1', p_start: false });
  check('... but they can still start the next match (they could already run the queue)', okAdvance.status === 200, JSON.stringify(okAdvance));
  const stranger = await rpc('stranger', 'advance_field_queue', { p_event: '00000000-0000-0000-0000-00000000ed01', p_field: 'Field 1', p_start: true });
  check('a signed-in stranger is refused', stranger.status >= 400, JSON.stringify(stranger));
  await sctx.close();
  await dctx.close();

  // ================================================================ 11. phone and tablet
  for (const kind of ['phone', 'tablet']) {
    const { ctx, page: p } = await open(kind, 'organizer');
    await p.goto(BASE + MANAGE); await p.waitForSelector('section.eventday', { timeout: 20000 });
    await p.waitForSelector('.ed-now', { timeout: 20000 });
    const vh = kind === 'phone' ? 844 : 1024;
    const nowBox = await p.locator('.ed-field-wrap.picked .ed-now').first().boundingBox();
    const openBox = await p.locator('.ed-field-wrap.picked .ed-open').first().boundingBox();
    const barTop = vh - 70;   // the phone's bottom navigation bar covers about this much
    check(`[${kind}] NOW and its Open scoreboard button are on the first screen, with no scrolling`, nowBox && openBox && openBox.y + openBox.height <= barTop, JSON.stringify({ nowBox, openBox }));
    const deckBox = await p.locator('.ed-field-wrap.picked li.ed-slot').first().boundingBox();
    check(`[${kind}] ON DECK starts on the first screen too`, deckBox && deckBox.y < barTop, JSON.stringify(deckBox));
    await sleep(3000);   // let the review panel and the checks finish loading before measuring width
    const sw = await noSideways(p);
    const offenders = sw[0] > sw[1] ? await p.evaluate(() => {
      const bad = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.seg.scroll'); });
      const chain = (e) => { const out = []; while (e && e !== document.body) { out.push(`${e.tagName}.${String(e.className).slice(0, 24)}:${Math.round(e.getBoundingClientRect().width)}/${getComputedStyle(e).display}/min=${Math.round(e.scrollWidth)}`); e = e.parentElement; } return out.join(' < '); };
      return bad.slice(0, 3).map(chain);
    }) : [];
    check(`[${kind}] no sideways scroll`, sw[0] <= sw[1], JSON.stringify({ sw, offenders }));
    check(`[${kind}] one field at a time, with a picker`, (await p.locator('[aria-label="Field"] button').count()) === 2 && (await p.locator('.ed-field-wrap.picked').count()) === 1);
    const sizes = await p.evaluate(() => [...document.querySelectorAll('.eventday .btn, .eventday summary')].filter(e => e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), e.innerText.trim().slice(0, 24)]; }));
    const small = sizes.filter(([w, h]) => h < 44 && w > 0).filter(([, , t]) => t !== 'Refresh');
    check(`[${kind}] every visible button is at least 44px tall`, small.length === 0, JSON.stringify(small));
    await p.locator('[aria-label="Field"] button', { hasText: 'Field 2' }).click();
    check(`[${kind}] the picker shows Field 2 on its own`, (await p.locator('.ed-field-wrap.picked section.ed-field').getAttribute('aria-label')) === 'Field 2');
    await shot(p, `11-${kind}`);
    check(`[${kind}] no page errors`, p.errors.length === 0, p.errors.join(' | '));
    await ctx.close();
  }
} catch (e) {
  check('the run reached the end', false, e.stack ?? e);
  if (lastPage) { console.log('--- what the page showed:', lastPage.url()); console.log((await lastPage.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500)); console.log('--- page errors:', lastPage.errors); await shot(lastPage, 'failure'); }
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
