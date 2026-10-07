// Pack 09C (finalize, reopen, close) against a REAL local stack: Postgres built from the migrations + scripts/e2e/fixtures/finalize.sql, PostgREST,
// the real built app in a real Chromium. Everything the screens show is checked against the database too. Run it through scripts/e2e/finalize-live.sh.
// Not part of CI: needs a PostgREST binary. No realtime socket here, so the polling fallbacks (LiveSync 15 s, the record watch 20 s) carry the
// two-browser checks: a second, anonymous browser must follow every change without a reload.
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
const WHO = { owner: [U(1), 'u1@example.test'], organizer: [U(2), 'u2@example.test'], scorekeeper: [U(4), 'u4@example.test'], stranger: [U(7), 'u7@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const EV = '00000000-0000-0000-0000-00000000a201', SLUG = 'closeout-open';
const C = (n) => `00000000-0000-0000-0000-00000000c00${n}`;
const mid = (n) => `00000000-0000-0000-0000-0000000fd6${String(n).padStart(2, '0')}`;
const fid = (n) => `00000000-0000-0000-0000-00000000f4${String(n).padStart(2, '0')}`;
async function rpc(who, fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}), apikey: 'x' }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function rest(who, path) {
  const r = await fetch(`${API}/rest/v1/${path}`, { headers: { ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}), apikey: 'x' } });
  const text = await r.text().catch(() => '');
  let parsed = null; try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: r.status, body: parsed, text };
}
const version = (n) => Number(sql(`select version from public.matches where id = '${mid(n)}'`));
const finishAsDevice = (who, n, result = 'a', a = 5, b = 3) => rpc(who, 'submit_match_result', { p_command: crypto.randomUUID(), p_match: mid(n), p_result: result, p_score_a: a, p_score_b: b, p_detail: {}, p_expected_version: version(n), p_schema: 1 });
const comp = (n) => sql(`select status || '/' || coalesce(finalized_at::text, '-') || '/' || coalesce(reopened_at::text, '-') from public.competitions where id = '${C(n)}'`);
const status = (n) => sql(`select status from public.competitions where id = '${C(n)}'`);
const resultsOf = (n) => sql(`select string_agg(coalesce(fighter_name, team_name_at_event) || ':' || final_place || ':' || (points::numeric)::text, ',' order by final_place, coalesce(fighter_name, team_name_at_event)) from public.competition_results where competition_id = '${C(n)}'`);
const placesOf = (n) => sql(`select string_agg(coalesce(fighter_name, team_name_at_event) || ':' || final_place, ',' order by final_place, coalesce(fighter_name, team_name_at_event)) from public.competition_results where competition_id = '${C(n)}'`);
const pointsOf = (n) => sql(`select string_agg((points::numeric)::text, ',' order by final_place, coalesce(fighter_name, team_name_at_event)) from public.competition_results where competition_id = '${C(n)}'`);
const uiPoints = (page) => page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby="rv-h"] .pd-pts')].map(e => e.innerText.replace(/\s*pts/i, '').trim()));
const nResults = (n) => Number(sql(`select count(*) from public.results where competition_id = '${C(n)}'`));
const audits = (action, target) => Number(sql(`select count(*) from public.audit_log where action = '${action}' and subject = '${target}'`));
const lastAudit = (action, target) => sql(`select details::text from public.audit_log where action = '${action}' and subject = '${target}' order by id desc limit 1`);
const errText = (r) => String(r.body?.message ?? r.body?.hint ?? JSON.stringify(r.body)).toLowerCase();

let lastPage = null;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
async function open(kind, who) {
  const vp = { desktop: { viewport: { width: 1280, height: 900 } }, large: { viewport: { width: 1920, height: 1080 } }, tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } }[kind];
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
const body = async (page, sel = 'body') => ((await page.locator(sel).first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').toLowerCase();
const has = async (page, text, sel = 'body') => (await body(page, sel)).includes(text.toLowerCase());
const shot = async (page, name, full = true) => { if (SHOTS) { await sleep(500); await page.screenshot({ path: `${SHOTS}/finalize-${name}.png`, fullPage: full }).catch(() => undefined); } };
const waitText = (page, sel, text, timeout = 40000) => page.waitForFunction(([s, t]) => (document.querySelector(s)?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(t), [sel, text.toLowerCase()], { timeout }).then(() => true, () => false);
// The review panel re-keys itself after a change (once right away, once more when the event re-reads), so wait until the text holds for a while.
const settled = async (page, sel, text, timeout = 40000) => { for (let i = 0; i < 3; i++) { if (!(await waitText(page, sel, text, timeout))) return false; await sleep(1200); } return waitText(page, sel, text, timeout); };
const waitGone = (page, sel, text, timeout = 40000) => page.waitForFunction(([s, t]) => !(document.querySelector(s)?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(t), [sel, text.toLowerCase()], { timeout }).then(() => true, () => false);
const MANAGE = `/events/${SLUG}/control`;
const REVIEW = 'section[aria-labelledby="rv-h"]';
const progressRow = (page, name) => page.locator('section.ed-progress li', { has: page.locator('b', { hasText: name }) }).first();
const rowText = async (page, name) => (await progressRow(page, name).innerText().catch(() => '')).replace(/\s+/g, ' ').toLowerCase();
const noSideways = (page) => page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
const dialog = (page) => page.locator('[role="dialog"]');
const podiumNames = async (page, sel) => (await page.locator(`${sel} ol.podium .pd-step`).allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());

try {
  // ================================================================ 1. the organizer opens Event day: each competition says where it stands
  const { ctx: octx, page } = await open('desktop', 'organizer');
  await page.goto(BASE + MANAGE); await page.waitForSelector('section.ed-progress', { timeout: 30000 });
  await waitText(page, 'section.ed-progress', 'ready to finalize', 40000);
  await sleep(1500);   // the per-competition checks (preflights) finish
  const ls0 = await rowText(page, 'Longsword (men)'), ss0 = await rowText(page, 'Sword and shield (men)'), po0 = await rowText(page, 'Polearm (men)'), tv0 = await rowText(page, '5v5 (men)'), bu0 = await rowText(page, 'Buckler (men)');
  check('Longsword, one fight still on: in progress 5 / 6, not ready', /5 \/ 6 fights complete/.test(ls0) && !/ready to finalize/.test(ls0), ls0);
  check('Sword and shield, every fight final but a three-way tie: Needs review, with the tie named', /needs review/.test(ss0) && /tie for a medal place/.test(ss0) && /review wins & losses/.test(ss0), ss0);
  check('Polearm bracket complete: Ready to finalize with a Review wins & losses button', /ready to finalize/.test(po0) && /review wins & losses/.test(po0), po0);
  check('5v5 final done: Ready to finalize', /ready to finalize/.test(tv0), tv0);
  // Pack 09D: a competition with no draw is one "Not built" line on Event day, never a card with a finalize offer
  const notBuilt = await body(page, 'section.ed-progress');
  check('Buckler never drawn: listed as not built, no finalize offer', bu0 === '' && /not built: buckler \(men\)/.test(notBuilt), notBuilt);
  check('finished fights are NOT official results: nothing in results, every competition still running', sql(`select count(*) from public.results where competition_id in ('${C(1)}','${C(2)}','${C(3)}','${C(4)}')`) === '0' && [1, 2, 3, 4].every(n => status(n) === 'running'));
  await shot(page, '01-eventday-before');

  // ================================================================ 2. the last Longsword fight finishes on another device: Ready to finalize, no reload
  await page.evaluate(() => { window.__marker = 'same page'; });
  const r6 = await finishAsDevice('scorekeeper', 6, 'a', 5, 2);   // John beats Joe
  check('the scorekeeper saves the last Longsword result from another device', r6.body?.status === 'accepted', JSON.stringify(r6));
  check('... the competition is still running: a finished draw is not an official result', status(1) === 'running' && nResults(1) === 0, comp(1));
  const ready = await page.waitForFunction(() => [...document.querySelectorAll('section.ed-progress li')].some(li => /Longsword \(men\)/.test(li.innerText) && /Ready to finalize/.test(li.innerText)), null, { timeout: 45000 }).then(() => true, () => false);
  check('Event day turns Longsword to Ready to finalize by itself (same page, no reload)', ready && (await page.evaluate(() => window.__marker)) === 'same page', await rowText(page, 'Longsword (men)'));
  check('... with 6 / 6 fights and a Review wins & losses button', /6 \/ 6 fights complete.*review wins & losses/.test(await rowText(page, 'Longsword (men)')), await rowText(page, 'Longsword (men)'));
  await shot(page, '02-eventday-ready');

  // ================================================================ 3. the public page, in a second browser with no account, before anything is official
  const { ctx: actx, page: anon } = await open('desktop');
  await anon.goto(BASE + `/events/${SLUG}`); await anon.waitForSelector('section.live-results', { timeout: 30000 });
  await waitText(anon, 'section.live-results', 'longsword (men)');
  check('the public page shows the Longsword standings as "not official yet" and no podium', (await has(anon, 'not official yet', 'section.live-results')) && (await anon.locator('ol.podium').count()) === 0, await body(anon, 'section.live-results'));
  await anon.evaluate(() => { window.__marker = 'same page'; });

  // ================================================================ 4. Review results: the review screen
  // Pack 09D: Event day opens the Review wins & losses sheet; the full Results tab (Pack 09C review) is still one tap away and is what this run goes on to test
  await progressRow(page, 'Longsword (men)').getByRole('button', { name: 'Review wins & losses' }).click();
  check('Review wins & losses opens the review sheet with Confirm results', await waitText(page, '[role="dialog"]', 'confirm results', 30000), await body(page, '[role="dialog"]'));
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Close' }).click().catch(() => page.keyboard.press('Escape'));
  await page.goto(BASE + MANAGE + `?mode=results&competition=${C(1)}`);   // Pack 25: Results mode (the old ?tab=finalize)
  await page.waitForSelector(REVIEW, { timeout: 30000 }); await waitText(page, REVIEW, 'ready to finalize');
  check('the Results tab opens on Longsword', /mode=results/.test(page.url()) && /competition=00000000-0000-0000-0000-00000000c001/.test(page.url()) && (await page.locator('[aria-label="Area"] button[aria-pressed="true"]').innerText()) === 'Results', page.url());
  check('the state leads: Ready to finalize, 6 of 6 fights have a result', /ready to finalize.*6 of 6 fights have a result/.test(await body(page, `${REVIEW} .fz-state`)), await body(page, `${REVIEW} .fz-state`));
  const steps = await podiumNames(page, REVIEW);
  check('the podium preview: Bob champion, John silver, Joe bronze; Mike 4th below', steps.length === 3 && /champion.*bob stone/i.test(steps[0]) && /silver.*john oakley/i.test(steps[1]) && /bronze.*joe rhodes/i.test(steps[2]) && /4.*mike voss/i.test(await body(page, `${REVIEW} ol.pd-list`)), JSON.stringify(steps));
  check('the represented team is shown under each fighter; Mike has none', /bob stone ankle biters/.test(steps[0].toLowerCase()) && /joe rhodes red deer reavers/.test(steps[2].toLowerCase()) && /mike voss no recorded team/.test(await body(page, `${REVIEW} ol.pd-list`)), JSON.stringify(steps));
  check('a warning (not a blocker) names the fighter with no recorded team and points at Teams represented', (await has(page, 'good to know (does not stop the result)', REVIEW)) && (await has(page, 'no team recorded for: mike voss', REVIEW)) && (await page.locator(`${REVIEW} a`, { hasText: 'Teams represented' }).count()) === 1, await body(page, REVIEW));
  check('the points line names the tier, the multiplier and says the formula is not edited here', /tier classic, multiplier \d.*formula is the league.s and is not edited here/.test(await body(page, REVIEW)), await body(page, REVIEW));
  const dbPre = execFileSync('psql', ['-X', '-At', '-d', DB, '-c', `select set_config('request.jwt.claims', '{"sub":"${U(2)}","role":"authenticated"}', false)`, '-c', 'set role authenticated', '-c', `select string_agg((e ->> 'name') || ':' || (e ->> 'place') || ':' || (e ->> 'points'), ',' order by (e ->> 'place')::int) from jsonb_array_elements(public.competition_finalize_preflight('${C(1)}', 'tournament_structure') -> 'placements') e`], { encoding: 'utf8' }).trim().split('\n').pop();
  const uiPts = await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby="rv-h"] .pd-pts')].map(e => e.innerText.replace(/\s*pts/i, '').trim()));
  check('the points on the preview are the database\'s (same preflight)', dbPre.split(',').map(x => Number(x.split(':')[2])).join(',') === uiPts.map(Number).join(','), `${dbPre} vs ${uiPts}`);
  const finBtn = page.locator(`${REVIEW} button`, { hasText: 'Finalize competition' });
  check('the Finalize button is enabled only now that the server says ready', (await finBtn.count()) === 1 && (await finBtn.isEnabled()));
  await shot(page, '03-review-ready');

  // ================================================================ 5. finalize: a confirm, then it is official, atomically
  await finBtn.click();
  await dialog(page).waitFor({ timeout: 10000 });
  check('a confirm dialog names the champion and what becomes the record', /make longsword \(men\) official\?.*bob stone is the champion; 4 placings/.test(await body(page, '[role="dialog"]')), await body(page, '[role="dialog"]'));
  check('the dialog is accessible: role dialog, modal, focus inside it', (await dialog(page).getAttribute('aria-modal')) === 'true' && (await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))));
  await shot(page, '04-finalize-dialog', false);
  await dialog(page).getByRole('button', { name: 'Yes, make it official' }).click();
  await settled(page, `${REVIEW} .fz-state`, 'competition official');
  const offers = [await page.locator(`${REVIEW} a`, { hasText: 'View official results' }).count(), await page.locator(`${REVIEW} a`, { hasText: 'Back to Event day' }).count(), await page.locator(`${REVIEW} button`, { hasText: 'Finalize the next competition' }).count(), await page.locator(`${REVIEW} button`, { hasText: 'Reopen' }).count()];
  check('the screen says Competition official with when, and offers View official results / Back to Event day / next / Reopen', /competition official.*official since/.test(await body(page, `${REVIEW} .fz-state`)) && offers.join(',') === '1,1,1,1', `${offers} ${await body(page, `${REVIEW} .fz-state`)}`);
  check('status text: Official. 4 placings are now the record.', await has(page, 'official. 4 placings are now the record.', REVIEW), await body(page, REVIEW));
  check('database: finished, finalized_at set, 4 result rows, placings Bob 1 John 2 Joe 3 Mike 4', /^finished\/20/.test(comp(1)) && resultsOf(1) === 'Bob Stone:1:9.00,John Oakley:2:6.00,Joe Rhodes:3:3.00,Mike Voss:4:0.00', `${comp(1)} ${resultsOf(1)}`);
  check('database: one competition.finished audit row by the organizer, with the multiplier source', audits('competition.finished', C(1)) === 1 && sql(`select actor from public.audit_log where action = 'competition.finished' and subject = '${C(1)}'`) === U(2) && /tournament_structure/.test(lastAudit('competition.finished', C(1))), lastAudit('competition.finished', C(1)));
  check('database: the fighter ranking counts it (Bob 1 gold, 9 points) and the team discipline total follows (Ankle Biters 15)', sql(`select golds || '/' || points::int from public.ranking_fighters where scope = 'season' and season_id = '00000000-0000-0000-0000-00000000a101' and category = 'longsword' and gender = 'men' and fighter_id = '${fid(1)}'`) === '1/9' && sql(`select team_name || ':' || points::int from public.ranking_team_disciplines where scope = 'season' and season_id = '00000000-0000-0000-0000-00000000a101' and category = 'longsword' and gender = 'men' order by rank limit 1`) === 'Ankle Biters:15');
  check('no official result sits on the rankings as a running competition: Polearm (not official) contributes nothing', sql(`select count(*) from public.ranking_fighters where scope = 'season' and category = 'polearm'`) === '0');
  await shot(page, '05-review-official');

  // ---- the anonymous page follows, without a reload
  const podiumArrived = await anon.waitForFunction((id) => !!document.querySelector(`#results-${id} ol.podium`), C(1), { timeout: 60000 }).then(() => true, () => false);
  check('the public page gets the podium by itself (no reload, same page)', podiumArrived && (await anon.evaluate(() => window.__marker)) === 'same page', await body(anon, 'section.live-results'));
  const pub = await podiumNames(anon, `#results-${C(1)}`);
  check('public podium: Official chip, Bob / John / Joe on the steps with their represented teams and points', (await has(anon, 'official', `#results-${C(1)} .ofc-head`)) && pub.length === 3 && /bob stone ankle biters 9 pts/i.test(pub[0]) && /joe rhodes red deer reavers 3 pts/i.test(pub[2]), JSON.stringify(pub));
  check('public full results: Mike 4th with "No recorded team" and 0 points; fighter names link to their pages', /4 mike voss no recorded team 0/.test(await body(anon, `#results-${C(1)} .ofc-rest`)) && (await anon.locator(`#results-${C(1)} a[href$="/fighters/${fid(1)}"]`).count()) === 1, await body(anon, `#results-${C(1)} .ofc-rest`));
  check('the other competitions still read "not official yet" below, under Still being fought', (await has(anon, 'still being fought', 'section.live-results')) && (await anon.locator('section.live-results .live-comp h3', { hasText: 'Polearm (men)' }).innerText()).toLowerCase().includes('not official yet'));
  await shot(anon, '06-public-first-podium');

  // ================================================================ 6. idempotent, permissions, locks (server side, through the API)
  const again = await rpc('organizer', 'finalize_competition', { p_competition: C(1), p_multiplier_source: 'tournament_structure' });
  const fz1 = comp(1);
  check('finalizing again is a no-op: already_official, nothing recomputed, same finalized_at', again.body?.status === 'already_official' && nResults(1) === 4 && audits('competition.finished', C(1)) === 1 && comp(1) === fz1, JSON.stringify(again));
  const sk = await rpc('scorekeeper', 'finalize_competition', { p_competition: C(3), p_multiplier_source: 'tournament_structure' });
  const st = await rpc('stranger', 'finalize_competition', { p_competition: C(3), p_multiplier_source: 'tournament_structure' });
  const an = await rpc(null, 'finalize_competition', { p_competition: C(3), p_multiplier_source: 'tournament_structure' });
  check('a scorekeeper, a stranger and an anonymous caller cannot finalize (server refuses; Polearm still running)', sk.status >= 400 && st.status >= 400 && an.status >= 400 && status(3) === 'running', `${sk.status}/${st.status}/${an.status} ${errText(sk)}`);
  const skPre = await rpc('scorekeeper', 'competition_finalize_preflight', { p_competition: C(3), p_multiplier_source: 'tournament_structure' });
  check('the review itself is the organizer\'s: a scorekeeper is refused with a sporting message', skPre.status === 403 && /only an organizer of this event can review its results/.test(errText(skPre)), JSON.stringify(skPre).slice(0, 200));
  const tie = await rpc('organizer', 'record_tie_decision', { p_competition: C(1), p_part: '', p_order: [`00000000-0000-0000-0000-00000000e501`, `00000000-0000-0000-0000-00000000e502`], p_note: 'late change' });
  check('an official competition is locked: a tie decision is refused with a sporting message', tie.status >= 400 && /official/.test(errText(tie)), JSON.stringify(tie));
  const re1 = await finishAsDevice('scorekeeper', 6, 'b', 5, 4);
  check('a second result for a fight of an official competition does not change it', (re1.body?.status === 'conflict' || re1.status >= 400) && sql(`select result || score_a || score_b from public.matches where id = '${mid(6)}'`) === 'a52', JSON.stringify(re1));
  const anonView = await rest(null, `competition_results?competition_id=eq.${C(1)}&select=*&order=final_place`);
  check('anyone can read competition_results: 4 rows, sporting identities only, no account ids', anonView.status === 200 && anonView.body?.length === 4 && !/0000000000a[1-7]/.test(anonView.text) && !('user_id' in (anonView.body[0] ?? {})), JSON.stringify(anonView.body?.[0]));
  const anonComp = await rest(null, `competitions?id=eq.${C(1)}&select=status,finalized_at,reopened_at,multiplier_source`);
  check('anyone can see that it is official and since when; who did it stays in the audit log', anonComp.status === 200 && anonComp.body?.[0]?.status === 'finished' && !!anonComp.body?.[0]?.finalized_at, JSON.stringify(anonComp.body));
  const audAnon = await rest(null, `audit_log?select=id&limit=1`);
  check('the audit log is not public', audAnon.status >= 400 || (Array.isArray(audAnon.body) && audAnon.body.length === 0), JSON.stringify(audAnon.body).slice(0, 100));

  // ---- reload: the state reconstructs from the server
  await page.reload(); await page.waitForSelector(REVIEW, { timeout: 30000 }); await waitText(page, REVIEW, 'competition official');
  check('after a reload the review screen still says Competition official with the same podium', (await podiumNames(page, REVIEW)).length === 3 && (await has(page, 'official placings', REVIEW)), await body(page, REVIEW));
  check('the competition picker marks Longsword done and Polearm ready', /longsword \(men\) ✓/.test(await body(page, '[aria-label="Competition"]')) && /polearm \(men\) ●/.test(await body(page, '[aria-label="Competition"]')), await body(page, '[aria-label="Competition"]'));

  // ================================================================ 7. reopen with a reason, re-score, finalize again (supersede, never delete)
  await page.locator(`${REVIEW} button`, { hasText: 'Reopen…' }).click();
  await dialog(page).waitFor({ timeout: 10000 });
  const reopenBtn = dialog(page).getByRole('button', { name: 'Reopen the result' });
  check('Reopen asks why and will not go without a reason', (await dialog(page).innerText()).includes('Why is it being reopened?') && !(await reopenBtn.isEnabled()));
  await dialog(page).locator('input[type="text"]').fill('the last fight was scored for the wrong fighter');
  await shot(page, '07-reopen-dialog', false);
  await reopenBtn.click();
  await waitText(page, REVIEW, 'reopened. the placings are no longer official');
  await settled(page, `${REVIEW} .fz-state`, 'needs review');
  check('the screen says it is reopened; the disputed result from the other device now needs review before it can be official again', /needs review.*6 of 6.*reopened/.test(await body(page, `${REVIEW} .fz-state`)) && /1 result needs review: two devices disagreed/.test(await body(page, REVIEW)) && (await page.locator(`${REVIEW} a`, { hasText: 'Review on Event day' }).count()) === 1, await body(page, REVIEW));
  const proposal = sql(`select p.id from public.result_proposals p join public.matches m on m.id = p.match_id where m.competition_id = '${C(1)}' and p.status = 'conflict'`);
  const kept = await rpc('organizer', 'resolve_result_conflict', { p_proposal: proposal, p_decision: 'keep_official', p_note: 'the board was right' });
  check('the organizer keeps the official fight result; the review is cleared', kept.status < 300 && sql(`select count(*) from public.result_proposals p join public.matches m on m.id = p.match_id where m.competition_id = '${C(1)}' and p.status = 'conflict'`) === '0', JSON.stringify(kept));
  await page.reload(); await page.waitForSelector(REVIEW, { timeout: 30000 }); await waitText(page, REVIEW, 'ready to finalize');
  check('... and the competition is Ready to finalize again (every fight is still final), with when it was reopened', /ready to finalize.*6 of 6.*reopened/.test(await body(page, `${REVIEW} .fz-state`)), await body(page, `${REVIEW} .fz-state`));
  check('database: running again, finalized_at cleared, reopened_at set, no live results', /^running\/-\/20/.test(comp(1)) && nResults(1) === 0, comp(1));
  check('database: the four official rows were superseded into result_revisions (nothing deleted silently)', sql(`select count(*) from public.result_revisions where competition_id = '${C(1)}' and action = 'superseded'`) === '4', sql(`select action, count(*) from public.result_revisions where competition_id = '${C(1)}' group by 1`));
  check('database: audit competition.reopened by the organizer with the reason', audits('competition.reopened', C(1)) === 1 && /wrong fighter/.test(lastAudit('competition.reopened', C(1))) && sql(`select actor from public.audit_log where action = 'competition.reopened' and subject = '${C(1)}'`) === U(2), lastAudit('competition.reopened', C(1)));
  check('database: Bob leaves the fighter ranking until it is finalized again', sql(`select count(*) from public.ranking_fighters where scope = 'season' and category = 'longsword' and fighter_id = '${fid(1)}'`) === '0');
  const podiumGone = await anon.waitForFunction((id) => !document.querySelector(`#results-${id}`), C(1), { timeout: 60000 }).then(() => true, () => false);
  check('the public page drops the podium by itself: Longsword is "not official yet" again', podiumGone && (await anon.locator('section.live-results .live-comp h3', { hasText: 'Longsword (men)' }).innerText()).toLowerCase().includes('not official yet'), await body(anon, 'section.live-results'));

  // ---- the organizer reopens the fight itself and the scorekeeper re-scores it: Joe beats John this time
  const rm = await rpc('organizer', 'reopen_match', { p_match: mid(6), p_reason: 'scored for the wrong fighter' });
  check('with the competition reopened, the fight can be reopened too', rm.status < 300 && sql(`select queue_state from public.matches where id = '${mid(6)}'`) !== 'final', JSON.stringify(rm));
  const r6b = await finishAsDevice('scorekeeper', 6, 'b', 3, 5);
  check('the scorekeeper records the corrected result (Joe wins)', r6b.body?.status === 'accepted' && sql(`select result from public.matches where id = '${mid(6)}'`) === 'b', JSON.stringify(r6b));
  const swapped = await page.waitForFunction(() => /silver[^]*joe rhodes/i.test(document.querySelector('section[aria-labelledby="rv-h"] ol.podium')?.innerText ?? ''), null, { timeout: 60000 }).then(() => true, () => false);
  check('the preview follows the corrected fight: Joe silver, John bronze', swapped, JSON.stringify(await podiumNames(page, REVIEW)));
  await page.locator(`${REVIEW} button`, { hasText: 'Finalize competition' }).click();
  await dialog(page).getByRole('button', { name: 'Yes, make it official' }).click();
  await waitText(page, REVIEW, 'competition official');
  check('finalized again: official with the corrected placings', /^finished\/20/.test(comp(1)) && resultsOf(1) === 'Bob Stone:1:9.00,Joe Rhodes:2:6.00,John Oakley:3:3.00,Mike Voss:4:0.00', resultsOf(1));
  check('the record keeps every version: 4 superseded revisions, one competition.reopened and two competition.finished audits', sql(`select count(*) from public.result_revisions where competition_id = '${C(1)}' and action = 'superseded'`) === '4' && audits('competition.reopened', C(1)) === 1 && audits('competition.finished', C(1)) === 2, lastAudit('competition.finished', C(1)));

  // ================================================================ 8. closeout: blocked, then the medal tie, then the rest
  const CO = '#closeout';
  await page.locator(CO).scrollIntoViewIfNeeded(); await waitText(page, CO, 'not official yet');
  const co0 = await body(page, CO);
  check('the closeout card lists every competition: Longsword official, Sword and shield in progress... and names what stops it', /longsword \(men\) · official/.test(co0) && /polearm \(men\) · ready to finalize/.test(co0) && /buckler \(men\) · never ran \(no draw\)/.test(co0) && /3 competitions are not official yet/.test(co0), co0);
  const closeBtn = page.locator(`${CO} button`, { hasText: 'Close event' });
  check('Close event is not available while competitions are open', !(await closeBtn.isEnabled()));
  const coApi = await rpc('organizer', 'close_event', { p_event: EV, p_note: null });
  check('... and the server refuses it too, not just the button', coApi.status >= 400 && /not official/.test(errText(coApi)) && sql(`select closed_at is null from public.events where id = '${EV}'`) === 't', JSON.stringify(coApi));
  await shot(page, '08-closeout-blocked');

  // ---- the medal tie: decided on the review screen itself
  await page.locator('[aria-label="Competition"] button', { hasText: 'Sword and shield (men)' }).click();
  await waitText(page, REVIEW, 'needs review');
  check('Sword and shield: Needs review, the tie for a medal place is the blocker', /a tie for a medal place in the standings is not decided yet/.test(await body(page, REVIEW)), await body(page, REVIEW));
  check('the Finalize button is disabled and says why', !(await page.locator(`${REVIEW} button`, { hasText: 'Finalize competition' }).isEnabled()) && (await has(page, 'settle what is listed above first', REVIEW)));
  const tieBox = page.locator(`${REVIEW} [role="group"][aria-label^="Tie for place"]`);
  await tieBox.waitFor({ timeout: 20000 });
  check('the three level fighters can be put in order right here, with a note on how it was decided', /these 3 are level for place 1/.test(await body(page, `${REVIEW} [role="group"]`)) && /ann hale.*bea crow.*cat fell/.test(await body(page, `${REVIEW} [role="group"] ol`)), await body(page, `${REVIEW} [role="group"]`));
  await tieBox.getByRole('button', { name: 'Move Cat Fell up' }).click();   // Ann, Cat, Bea
  await tieBox.locator('input[type="text"]').fill('head marshal drew lots');
  await shot(page, '09-medal-tie', false);
  await tieBox.getByRole('button', { name: 'Save this order' }).click();
  await waitText(page, REVIEW, 'ready to finalize');
  check('with the order recorded the blocker is gone: Ready to finalize, podium Ann / Cat / Bea', (await podiumNames(page, REVIEW)).map(s => s.toLowerCase()).join('|').replace(/\s+/g, ' ').match(/champion ann hale.*silver cat fell.*bronze bea crow/) !== null, JSON.stringify(await podiumNames(page, REVIEW)));
  check('database: the tie decision is stored with who and why', Number(sql(`select count(*) from public.pool_tie_decisions where competition_id = '${C(2)}' and note = 'head marshal drew lots'`)) >= 1);
  const ssPreview = await uiPoints(page);
  await page.locator(`${REVIEW} button`, { hasText: 'Finalize competition' }).click();
  await dialog(page).getByRole('button', { name: 'Yes, make it official' }).click();
  await waitText(page, REVIEW, 'competition official');
  check('Sword and shield official: Ann 1, Cat 2, Bea 3', placesOf(2) === 'Ann Hale:1,Cat Fell:2,Bea Crow:3', placesOf(2));
  check('... with exactly the points the preview showed (the league formula, wins included)', pointsOf(2).split(',').map(Number).join(',') === ssPreview.map(Number).join(','), `${pointsOf(2)} vs ${ssPreview}`);

  // ---- the next: Polearm (a bracket with a third-place match), then 5v5 (two teams)
  await page.locator(`${REVIEW} button`, { hasText: 'Finalize the next competition' }).click();
  await waitText(page, REVIEW, 'polearm (men)'); await waitText(page, REVIEW, 'ready to finalize');
  check('"Finalize the next competition" moves to Polearm, ready', /competition=00000000-0000-0000-0000-00000000c003/.test(page.url()) && (await podiumNames(page, REVIEW)).length === 3);
  check('Polearm preview: Dan champion, Fay silver, Gus bronze (third-place match), Eli 4th; the long name wraps rather than overflowing', /champion dan morrow/.test((await podiumNames(page, REVIEW))[0].toLowerCase()) && /bronze gus arden-whitfield-montgomery/.test((await podiumNames(page, REVIEW))[2].toLowerCase()) && /4 eli penn/.test(await body(page, `${REVIEW} ol.pd-list`)) && (await noSideways(page))[0] <= (await noSideways(page))[1], JSON.stringify(await podiumNames(page, REVIEW)));
  await page.locator(`${REVIEW} button`, { hasText: 'Finalize competition' }).click();
  await dialog(page).getByRole('button', { name: 'Yes, make it official' }).click();
  await waitText(page, REVIEW, 'competition official');
  check('Polearm official: Dan 1, Fay 2, Gus 3, Eli 4', placesOf(3) === 'Dan Morrow:1,Fay Wick:2,Gus Arden-Whitfield-Montgomery:3,Eli Penn:4', placesOf(3));
  const poPoints = pointsOf(3);
  await page.locator(`${REVIEW} button`, { hasText: 'Finalize the next competition' }).click();
  await waitText(page, REVIEW, '5v5 (men)'); await waitText(page, REVIEW, 'ready to finalize');
  const tv = await podiumNames(page, REVIEW);
  check('5v5 preview: two teams, two steps, no invented bronze; teams say Team, not a represented team', tv.length === 2 && /champion ankle biters team/.test(tv[0].toLowerCase().replace(/\s+/g, ' ')) && /silver red deer reavers team/.test(tv[1].toLowerCase().replace(/\s+/g, ' ')), JSON.stringify(tv));
  await page.locator(`${REVIEW} button`, { hasText: 'Finalize competition' }).click();
  await dialog(page).getByRole('button', { name: 'Yes, make it official' }).click();
  await waitText(page, REVIEW, 'competition official');
  check('5v5 official: Ankle Biters 1, Red Deer Reavers 2 (team entries, team_id kept)', placesOf(4) === 'Ankle Biters:1,Red Deer Reavers:2' && sql(`select count(*) from public.competition_results where competition_id = '${C(4)}' and kind = 'team' and team_id is not null`) === '2', resultsOf(4));
  check('no "Finalize the next competition" is offered when nothing is left', (await page.locator(`${REVIEW} button`, { hasText: 'Finalize the next competition' }).count()) === 0);

  // ================================================================ 9. close the event
  await waitText(page, 'section[aria-label="Results and closeout"]', 'every competition is official');
  await page.locator(CO).scrollIntoViewIfNeeded();
  check('the closeout card is ready: Buckler is a warning (never ran), nothing blocks; Close event is enabled', /buckler.*never ran/.test(await body(page, CO)) && (await page.locator(`${CO} [aria-label="What stops the closeout"]`).count()) === 0 && (await closeBtn.isEnabled()), await body(page, CO));
  await shot(page, '10-closeout-ready');
  await closeBtn.click();
  await dialog(page).waitFor({ timeout: 10000 });
  check('the Close dialog repeats the warning and takes an optional note', /close closeout open\?/.test(await body(page, '[role="dialog"]')) && /buckler/.test(await body(page, '[role="dialog"]')));
  await dialog(page).locator('input[type="text"]').fill('paper sheets filed with the league');
  await shot(page, '11-close-dialog', false);
  await dialog(page).getByRole('button', { name: 'Yes, close the event' }).click();
  await page.locator('[aria-label="Event closed"]').waitFor({ timeout: 30000 });
  check('the Results tab shows Event closed · official results, with View the results page and Reopen the event…', /event closed.*official results/.test(await body(page, '[aria-label="Event closed"]')) && (await page.locator('[aria-label="Event closed"] a', { hasText: 'View the results page' }).count()) === 1 && (await page.locator('[aria-label="Event closed"] button', { hasText: 'Reopen the event…' }).count()) === 1, await body(page, '[aria-label="Event closed"]'));
  check('the closeout card itself is gone (nothing to close any more)', (await page.locator(CO).count()) === 0);
  check('database: closed_at set, audit event.closed by the organizer with the note, 4 official competitions and the never-ran warning', sql(`select closed_at is not null from public.events where id = '${EV}'`) === 't' && audits('event.closed', EV) === 1 && /paper sheets filed/.test(lastAudit('event.closed', EV)) && /"official_competitions": ?4/.test(lastAudit('event.closed', EV)) && /never_ran/.test(lastAudit('event.closed', EV)), lastAudit('event.closed', EV));
  await shot(page, '12-event-closed');

  // ---- locks after closing (server side)
  const lateFz = await rpc('organizer', 'reopen_competition', { p_competition: C(1), p_reason: 'second thoughts' });
  check('a closed event locks its competitions: reopening one is refused until the event is reopened', lateFz.status >= 400 && /closed/.test(errText(lateFz)) && status(1) === 'finished', JSON.stringify(lateFz));
  const lateTie = await rpc('organizer', 'record_tie_decision', { p_competition: C(5), p_part: '', p_order: ['00000000-0000-0000-0000-00000000e518', '00000000-0000-0000-0000-00000000e519'], p_note: 'late' });
  check('... and nothing operational can change (a tie decision on the never-run competition is refused)', lateTie.status >= 400 && /closed|official/.test(errText(lateTie)), JSON.stringify(lateTie));
  const closeAgain = await rpc('organizer', 'close_event', { p_event: EV, p_note: null });
  check('closing again is a no-op: already_closed', closeAgain.body?.status === 'already_closed' && audits('event.closed', EV) === 1, JSON.stringify(closeAgain));
  const skClose = await rpc('scorekeeper', 'reopen_event', { p_event: EV, p_reason: 'not mine to do' });
  check('a scorekeeper cannot reopen the event', skClose.status >= 400 && sql(`select closed_at is not null from public.events where id = '${EV}'`) === 't', JSON.stringify(skClose));

  // ---- the public page, the Arena and Event day follow
  const closedSeen = await anon.waitForSelector('[data-testid="event-closed"]', { timeout: 60000 }).then(() => true, () => false);
  check('the public page says the event is complete, by itself (same page, no reload)', closedSeen && (await anon.evaluate(() => window.__marker)) === 'same page', await body(anon));
  await anon.waitForFunction(() => document.querySelectorAll('ol.podium').length >= 4, null, { timeout: 60000 }).catch(() => undefined);
  check('the public results page shows four podiums and no live standings', (await anon.locator('ol.podium').count()) === 4 && !(await has(anon, 'not official yet')) && !(await has(anon, 'still being fought')), await body(anon));
  const tvPub = `#results-${C(4)}`;
  check('the team competition podium has two steps, Ankle Biters then Red Deer Reavers, each linking to the team page', (await anon.locator(`${tvPub} .pd-step`).count()) === 2 && (await anon.locator(`${tvPub} a[href$="/teams/ankle-biters"]`).count()) === 1, await body(anon, tvPub));
  await anon.locator(`${tvPub} .pd-step.gold button`, { hasText: 'Roster at this event' }).click();
  await anon.locator(`${tvPub} .pd-step.gold ul[aria-label="Ankle Biters: roster at this event"]`).waitFor({ timeout: 20000 });
  check('the roster that stood on the field is shown on request: Lee Ashby, Max Tarn, Ned Rook', /lee ashby.*max tarn.*ned rook/.test(await body(anon, `${tvPub} .pd-step.gold ul`)), await body(anon, `${tvPub} .pd-step.gold ul`));
  check('the Polearm podium shows the long name in full and a 4th place below', /gus arden-whitfield-montgomery/.test(await body(anon, `#results-${C(3)}`)) && /4 eli penn/.test(await body(anon, `#results-${C(3)} .ofc-rest`)), await body(anon, `#results-${C(3)}`));
  check('the public page has no sideways scroll on desktop', (await noSideways(anon))[0] <= (await noSideways(anon))[1]);
  await shot(anon, '13-public-closed');

  const { ctx: arctx, page: arena } = await open('large');
  await arena.goto(BASE + `/events/${SLUG}/arena`); await arena.waitForSelector('.ar-center', { timeout: 30000 });
  await waitText(arena, '.ar-center', 'event complete');
  check('the Arena shows Event complete, the event name, "Every competition is official." and a View results link', /event complete.*closeout open.*every competition is official/.test(await body(arena, '.ar-center')) && (await arena.locator('.ar-center a', { hasText: 'View results' }).count()) === 1, await body(arena, '.ar-center'));
  await shot(arena, '14-arena-complete', false);
  await arctx.close();

  await page.goto(BASE + MANAGE + '?mode=live'); await page.waitForSelector('section.ed-progress', { timeout: 30000 });
  await waitText(page, 'section.ed-progress', 'this event is closed');
  const edClosed = await body(page, 'section.ed-progress');
  check('Event day says the event is closed and every competition Official, with Official results links', /this event is closed/.test(edClosed) && (await page.locator('section.ed-progress .ed-phase-official').count()) === 4 && (await page.locator('section.ed-progress a', { hasText: 'Official results' }).count()) === 4, edClosed);
  check('no Start / Open scoreboard controls are offered on a closed event', (await page.getByRole('button', { name: /^(Run this fight|Run anyway)$/ }).count()) === 0, await body(page, 'section.eventday'));
  await shot(page, '15-eventday-closed');

  // ================================================================ 10. reopen the event (audited), then close it again
  await page.goto(BASE + MANAGE + '?mode=results'); await page.locator('[aria-label="Event closed"]').waitFor({ timeout: 30000 });
  await page.locator('[aria-label="Event closed"] button', { hasText: 'Reopen the event…' }).click();
  await dialog(page).waitFor({ timeout: 10000 });
  await dialog(page).locator('input[type="text"]').fill('a result was contested after closing');
  await dialog(page).getByRole('button', { name: 'Reopen the event' }).click();
  await page.locator(CO).waitFor({ timeout: 30000 });
  check('the event is open again: the closeout card is back and ready', (await has(page, 'every competition is official', 'section[aria-label="Results and closeout"]')) && sql(`select closed_at is null and reopened_at is not null from public.events where id = '${EV}'`) === 't');
  check('database: audit event.reopened by the organizer with the reason and when it had been closed', audits('event.reopened', EV) === 1 && /contested after closing/.test(lastAudit('event.reopened', EV)) && /was_closed_at/.test(lastAudit('event.reopened', EV)), lastAudit('event.reopened', EV));
  const reopenComp = await rpc('organizer', 'reopen_competition', { p_competition: C(3), p_reason: 'the final was contested' });
  check('with the event open, a competition can be reopened again (and leaves the rankings)', reopenComp.status < 300 && status(3) === 'running' && sql(`select count(*) from public.ranking_fighters where scope = 'season' and category = 'polearm'`) === '0', JSON.stringify(reopenComp));
  const coBlocked = await rpc('organizer', 'close_event', { p_event: EV, p_note: null });
  check('... and the event cannot be closed again until it is official once more', coBlocked.status >= 400 && /polearm/.test(errText(coBlocked)), JSON.stringify(coBlocked));
  const fzAgain = await rpc('organizer', 'finalize_competition', { p_competition: C(3), p_multiplier_source: 'tournament_structure' });
  const coAgain = await rpc('organizer', 'close_event', { p_event: EV, p_note: 'closed again after the contested final was reviewed' });
  check('finalized and closed again through the same functions: official, closed, two event.closed audits', fzAgain.body?.status === 'official' && coAgain.body?.status === 'closed' && audits('event.closed', EV) === 2 && placesOf(3) === 'Dan Morrow:1,Fay Wick:2,Gus Arden-Whitfield-Montgomery:3,Eli Penn:4' && pointsOf(3) === poPoints, `${JSON.stringify(fzAgain)} ${JSON.stringify(coAgain)}`);
  await page.locator('[aria-label="Event closed"]').waitFor({ timeout: 40000 }).catch(() => undefined);
  check('the Results tab follows the API closing without a reload', (await page.locator('[aria-label="Event closed"]').count()) === 1);
  check('no page errors in the organizer\'s browser', page.errors.length === 0, page.errors.join(' | '));
  check('no page errors in the public browser', anon.errors.length === 0, anon.errors.join(' | '));
  await actx.close(); await octx.close();

  // ================================================================ 11. phone, tablet, desktop and large screens
  for (const kind of ['phone', 'tablet', 'desktop', 'large']) {
    const { ctx, page: p } = await open(kind, 'organizer');
    await p.goto(BASE + MANAGE + `?mode=results&competition=${C(1)}`); await p.waitForSelector(REVIEW, { timeout: 30000 }); await waitText(p, REVIEW, 'competition official');
    await p.locator('[aria-label="Event closed"]').waitFor({ timeout: 30000 });
    await sleep(1200);
    const sw = await noSideways(p);
    check(`[${kind}] Results tab: no sideways scroll`, sw[0] <= sw[1], JSON.stringify(sw));
    check(`[${kind}] an official competition on a closed event shows no "before this can be official" list, only that the event is closed`, !(await has(p, 'before this can be official', REVIEW)) && (await has(p, 'the event is closed. reopen the event before changing this result.', REVIEW)), await body(p, REVIEW));
    const small = await p.evaluate(() => [...document.querySelectorAll('section[aria-label="Results and closeout"] .btn, section[aria-label="Results and closeout"] button')].filter(e => e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), e.innerText.trim().slice(0, 24)]; }).filter(([w, h]) => w > 0 && h < 44));
    check(`[${kind}] every visible button on the Results tab is at least 44px tall`, small.length === 0, JSON.stringify(small));
    const stepsBox = await p.evaluate(() => [...document.querySelectorAll('section[aria-labelledby="rv-h"] ol.podium .pd-step')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.width)]; }));
    check(`[${kind}] the podium ${kind === 'phone' ? 'stacks' : 'stands in three columns'}`, kind === 'phone' ? stepsBox.every(b => b[0] === stepsBox[0][0]) : new Set(stepsBox.map(b => b[0])).size === 3, JSON.stringify(stepsBox));
    await shot(p, `16-${kind}-results-tab`);
    await p.goto(BASE + `/events/${SLUG}`); await p.waitForSelector('[data-testid="event-closed"]', { timeout: 30000 });
    await p.waitForFunction(() => document.querySelectorAll('ol.podium').length >= 4, null, { timeout: 40000 }).catch(() => undefined);
    await sleep(800);
    const sw2 = await noSideways(p);
    check(`[${kind}] public results page: four podiums, no sideways scroll`, (await p.locator('ol.podium').count()) === 4 && sw2[0] <= sw2[1], JSON.stringify(sw2));
    await shot(p, `17-${kind}-public-results`);
    await p.goto(BASE + MANAGE + '?mode=live'); await p.waitForSelector('section.ed-progress', { timeout: 30000 }); await waitText(p, 'section.ed-progress', 'this event is closed');
    await sleep(800);
    check(`[${kind}] the closed Event day says the never-run competition was closed as not held, and no longer asks for a draw`, (await has(p, 'closed as not held', 'section.ed-progress')) && !(await has(p, 'build a draw', 'section.ed-progress')), await body(p, 'section.ed-progress'));
    await shot(p, `18-${kind}-eventday-closed`);
    check(`[${kind}] no page errors`, p.errors.length === 0, p.errors.join(' | '));
    await ctx.close();
  }
} catch (e) {
  check('the run reached the end', false, e.stack ?? e);
  if (lastPage) { console.log('--- what the page showed:', lastPage.url()); console.log((await lastPage.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 2000)); console.log('--- page errors:', lastPage.errors); await shot(lastPage, 'failure'); }
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
