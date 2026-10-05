// Pack 09D against a REAL local stack: Postgres built from every migration + scripts/e2e/fixtures/pack09d.sql, PostgREST, the real built app in a real
// Chromium. Run it through scripts/e2e/pack09d-live.sh. Not part of CI (needs a PostgREST binary). No realtime socket here: the screens' polling carries
// live updates. Everything the screens claim is checked against the database too.
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
const U = (n) => `00000000-0000-0000-0000-0000000000b${n}`;
const WHO = { owner: [U(1), 'b1@example.test'], organizer: [U(2), 'b2@example.test'], scorekeeper: [U(4), 'b4@example.test'], captain: [U(6), 'b6@example.test'], stranger: [U(7), 'b7@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8', env: { ...process.env, PGTZ: 'America/Edmonton' } }).trim();
const BUILD = '00000000-0000-0000-0000-00000000b201', SHORT = '00000000-0000-0000-0000-00000000b202', OLD = '00000000-0000-0000-0000-00000000b203';
const C = (n) => `00000000-0000-0000-0000-00000000c9${String(n).padStart(2, '0')}`;
const fid = (n) => `00000000-0000-0000-0000-00000000f9${String(n).padStart(2, '0')}`;
const mid = (n) => `00000000-0000-0000-0000-0000000fd9${String(n).padStart(2, '0')}`;
const BOB = fid(1);
async function rpc(who, fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}), apikey: 'x' }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const finish = (who, matchId, result = 'a', a = 5, b = 3) => rpc(who, 'submit_match_result', {
  p_command: crypto.randomUUID(), p_match: matchId, p_result: result, p_score_a: a, p_score_b: b, p_detail: {}, p_expected_version: Number(sql(`select version from public.matches where id = '${matchId}'`)), p_schema: 1
});
// every official aggregate that can carry Bob, as one text (equal text = equal statistics)
const bobStats = () => sql(`select coalesce((select string_agg(scope || ':' || competitions || ':' || golds || ':' || points, ',' order by scope, organization_id, season_id, category, gender) from public.ranking_fighters where fighter_id = '${BOB}'), '-')
  || '|' || coalesce((select golds || ':' || matches || ':' || events_attended from public.fighter_career_stats where fighter_id = '${BOB}'), '-')
  || '|' || coalesce((select string_agg(scope || ':' || points, ',' order by scope, category, gender) from public.ranking_team_disciplines where team_id = '00000000-0000-0000-0000-00000000b301'), '-')`);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VP = { desktop: { viewport: { width: 1280, height: 900 } }, tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VP[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('dialog', d => d.accept());   // window.confirm (Open registration) is accepted like a person would
  return { ctx, page };
}
const text = async (page, sel = 'body') => ((await page.locator(sel).first().innerText({ timeout: 5000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ');
const waitText = (page, sel, t, timeout = 40000) => page.waitForFunction(([s, x]) => (document.querySelector(s)?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(x), [sel, t.toLowerCase()], { timeout }).then(() => true, () => false);
const shot = async (page, name, full = true) => { if (SHOTS) { await sleep(400); await page.screenshot({ path: `${SHOTS}/p9d-${name}.png`, fullPage: full }).catch(() => undefined); } };
// the page itself, and any element that sticks out past the right edge of the screen (an overflowing button would not always widen the page)
const sideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1
  || [...document.querySelectorAll('main *')].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.seg,.eh-steps,[style*="overflow"]'); }));
// visible interactive controls smaller than 40 px in height (44 is the target; a few inline links in sentences are allowed)
const tinyTargets = (page, sel = 'main') => page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} .btn, ${s} input[type=checkbox], ${s} select, ${s} summary`)]
  .filter(e => { const t = e.matches('input') && e.closest('label') ? e.closest('label') : e; const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40 && !e.classList.contains('linklike') && getComputedStyle(e).visibility !== 'hidden'; })
  .map(e => (e.innerText || e.getAttribute('aria-label') || e.tagName).slice(0, 40)), sel);
const layout = async (page, name) => {
  const side = await sideways(page);
  check(`[${name}] no sideways scrolling`, !side);
  const tiny = await tinyTargets(page);
  check(`[${name}] no small tap targets`, tiny.length === 0, tiny.join(' | '));
};

try {
  // ============================================================== 1. Quick Setup (phone, a first-time organizer, never opens Advanced)
  {
    const { ctx, page } = await open('phone', 'organizer');
    await page.goto(BASE + '/events/new'); await page.getByLabel('Event name').waitFor({ timeout: 30000 });
    await page.getByRole('checkbox').first().waitFor({ timeout: 30000 });
    await page.getByLabel('Event name').fill('Red Deer Rumble 2027');
    const d1 = sql(`select to_char(current_date + 40, 'YYYY-MM-DD')`), d2 = sql(`select to_char(current_date + 41, 'YYYY-MM-DD')`);
    await page.getByLabel('First day').fill(d1); await page.getByLabel('Last day').fill(d2);
    await page.getByLabel('Venue').fill('Horse in Hand Ranch').catch(() => undefined);
    const ticked = await page.locator('.qs-cat input[type=checkbox]:checked').count();
    const all = await page.locator('.qs-cat input[type=checkbox]').count();
    check('standard disciplines are already ticked (the normal set on, large melees off)', ticked === 10 && all === 13, `${ticked}/${all}`);
    check('the web address is made from the name without asking', await page.getByText('/events/red-deer-rumble-2027').count() > 0);
    await page.getByRole('button', { name: 'One field more' }).click();
    check('number of fields is one tap', (await page.locator('output[aria-label="Fields"]').innerText()) === '2');
    await shot(page, 'quick-setup-390');
    await layout(page, 'quick setup 390');
    await page.locator('.qs-cat', { hasText: 'Profight' }).locator('input[type=checkbox]').uncheck();
    await page.locator('.qs-cat', { hasText: 'Marathon' }).locator('input[type=checkbox]').uncheck();
    check('turning two off updates the count', (await text(page, '.qs-actions')).includes('15 competitions · 2 fields'), await text(page, '.qs-actions'));
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Check your setup' }).waitFor();
    const review = await text(page, 'main');
    check('the review shows the defaults it chose (divisions, team vs individual, ruleset)', /Longsword.*Men · Women · Individual.*Buhurt International: Duels rules V\.26\.4/.test(review) && /5v5.*Men · Women · Team competition/.test(review), review.slice(0, 400));
    check('the review says what happens to empty divisions', /Divisions with nobody registered are simply not run/.test(review));
    check('Profight and Marathon are not offered', !/Profight|Marathon/i.test(review));
    await shot(page, 'quick-review-390');
    await layout(page, 'quick review 390');
    await page.getByRole('button', { name: 'Create event' }).click();
    await page.waitForURL(/manage\?tab=home/, { timeout: 30000 });
    await page.locator('section[aria-label="Event home"]').waitFor({ timeout: 30000 });
    const ev = sql(`select id || '|' || status || '|' || field_count || '|' || (select count(*) from public.competitions k where k.event_id = e.id) from public.events e where slug = 'red-deer-rumble-2027'`).split('|');
    check('the event exists as a draft with 2 fields and 15 competitions', ev[1] === 'draft' && ev[2] === '2' && ev[3] === '15', ev.join('|'));
    check('no competition got a draw or an entrant', sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${ev[0]}'`) === '0');
    check('the competitions carry the defaults (ruleset from the reference data, none invented for HACSA)', sql(`select string_agg(distinct coalesce(ruleset, '-'), ',' order by coalesce(ruleset, '-')) from public.competitions where event_id = '${ev[0]}'`) === '-,Buhurt International: Buhurt Regulations V.26.4,Buhurt International: Duels rules V.26.4');
    await waitText(page, '#eh-next-h', 'almost ready');
    const home = await text(page, 'section[aria-label="Event home"]');
    check('a first-time screen, not an empty dashboard: "Your event is created" and one next step', /Your event is created/.test(home) && (await page.locator('.eh-primary').count()) === 1, home.slice(0, 300));
    check('the one next step is the waiver (needed before registration opens)', /Add the waiver/.test(await text(page, '.eh-next')));
    check('the journey stepper shows where the event is', (await page.locator('.eh-step.current').innerText()).includes('Set up'));
    await shot(page, 'home-created-390');
    await layout(page, 'event home 390');
    // the organizer loads the waiver (the waiver screen is Pack 07's; this journey is about what comes next)
    sql(`insert into public.waiver_versions (event_id, version, title, body) values ('${ev[0]}', 1, 'Waiver', 'Fictional waiver text for the local Pack 09D test.')`);
    await page.reload(); await page.locator('section[aria-label="Event home"]').waitFor();
    await waitText(page, '.eh-next', 'open registration');
    check('with the waiver in, the next step is Open registration', /Open registration/.test(await text(page, '.eh-primary')));
    await page.locator('.eh-primary').click();
    await waitText(page, '.eh-next', 'nobody has registered yet', 30000);
    check('Open registration publishes the event', sql(`select status from public.events where id = '${ev[0]}'`) === 'published');
    check('then: registration is open, share the page', /Registration is open/i.test(await text(page, '.eh-next')), await text(page, 'main'));
    check('no errors on the page', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 2. Build tournament (desktop, then a look at phone)
  let built = {};
  {
    const { ctx, page } = await open('desktop', 'organizer');
    await page.goto(BASE + '/events/build-rumble/manage?tab=home'); await page.locator('section[aria-label="Event home"]').waitFor({ timeout: 30000 });
    await waitText(page, '.eh-next', 'build tournament');
    check('registration ready: the one next step is Build tournament', /Build tournament/.test(await text(page, '.eh-primary')), await text(page, '.eh-next'));
    await page.locator('.eh-primary').click();
    await page.waitForURL(/tab=build/); await page.locator('section[aria-label="Build tournament"]').waitFor({ timeout: 30000 });
    await waitText(page, 'section[aria-label="Build tournament"]', 'tournament plan ready');
    const plan = await text(page, 'section[aria-label="Build tournament"]');
    check('the plan names fighters, competitions, fights and fields', /Tournament plan ready/i.test(plan) && /\b4\b competitions/.test(plan) && /\b2\b fields/.test(plan), plan.slice(0, 500));
    check('the rest target and how many fights meet it are stated', /Preferred rest: 3 fights between appearances/.test(plan) && /fights ready to plan meet it/.test(plan));
    check('Sam (only here tomorrow) is reported, not silently planned', /wait for someone who is not here on/.test(plan));
    check('empty and one-entrant divisions are not built', /Not built:.*Women Polearm \(nobody entered\).*Men Polearm \(1 entrant\)/.test(plan));
    check('the withdrawn Longsword entrant is not counted', /Men Longsword.*4 entrants/.test(plan));
    check('Sabre (8) is proposed as pools from the existing advice', /Men Sabre.*8 entrants · Pools, then a bracket \(2 pools\)/.test(plan));
    // the organizer changes one thing (Sabre to a bracket with a third-place fight) to see the bracket automation later
    const sabre = page.locator('.bt-list li', { hasText: 'Men Sabre' });
    await sabre.locator('summary').click();
    await sabre.getByLabel('Format').selectOption('single_elimination');
    check('a bracket gets a third-place fight by default', await sabre.getByLabel('Third-place fight').isChecked());
    check('the change shows in the plan at once', /Single elimination.*8 fights/.test(await text(page, '.bt-list li:has-text("Men Sabre")')), await text(page, '.bt-list li:has-text("Men Sabre")'));
    await page.getByRole('button', { name: 'Review plan' }).click();
    check('Review plan shows the fight order on each field', (await page.locator('.bt-lanes > div').count()) === 2 && /vs/.test(await text(page, '.bt-lanes')));
    await shot(page, 'build-plan-1280');
    await layout(page, 'build plan 1280');
    await page.getByRole('button', { name: /Use this plan/ }).click();
    await waitText(page, 'main', 'tournament built', 60000);
    const counts = sql(`select string_agg(k.name || '=' || (select count(*) from public.matches m where m.competition_id = k.id), ',' order by k.sort) from public.competitions k where k.event_id = '${BUILD}'`);
    check('draws built for exactly the four competitions with entrants', counts === 'Men Longsword=6,Men Sword & Shield=6,Men Sabre=8,Women Polearm=0,Men Polearm=0,Men 5v5=1', counts);
    check('the draws went through build_schedule with a saved draw number', sql(`select count(*) from public.competitions where event_id = '${BUILD}' and draw_seed is not null and drawn_at is not null`) === '4');
    const fields = sql(`select string_agg(distinct coalesce(m.field, '(Field 1)'), ',') from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${BUILD}'`);
    check('competitions were spread over both fields (Field 1 stored as empty)', fields === '(Field 1),Field 2', fields);
    check('the fight order was saved (plan_order on waiting fights)', Number(sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${BUILD}' and m.plan_order is not null`)) >= 10);
    check("Sam's fights are held back today", sql(`select count(*) from public.matches m join public.entries e on e.id in (m.entry_a, m.entry_b) where e.fighter_id = '${fid(6)}' and m.plan_hold`) === '3');
    check('nothing was called or started by building', sql(`select count(*) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${BUILD}' and m.queue_state <> 'scheduled'`) === '0');
    built = { ok: true };
    await shot(page, 'build-done-1280');
    await page.getByRole('link', { name: /Open Event day/ }).click();
    await page.waitForURL(/tab=eventday/);
    check('Plan accepted → Event day', page.url().includes('tab=eventday'));
    check('no errors on the page', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 3. Event day: recommended next fight, run it, results, stability, re-planning, override
  {
    const { ctx, page } = await open('desktop', 'organizer');
    await page.goto(BASE + '/events/build-rumble/manage?tab=eventday'); await page.locator('section.eventday').waitFor({ timeout: 30000 });
    const card1 = page.locator('article[aria-label="Next recommended on Field 1"]');
    await card1.waitFor({ timeout: 30000 });
    const c1 = await text(page, 'article[aria-label="Next recommended on Field 1"]');
    check('one obvious recommended fight per field, with plain reasons', /Next recommended/i.test(c1) && /vs/.test(c1) && /(first fight today|since last appearance)/i.test(c1), c1);
    check('the recommendation says whether people are ready', /Ready to fight|Not checked in/.test(c1));
    check('Field 2 has its own recommendation', await page.locator('article[aria-label="Next recommended on Field 2"]').count() === 1);
    check('a held fight is explained (someone is only here another day)', /held back.*Sam Saturday/.test(await text(page, '.ed-held')), await text(page, '.ed-held'));
    check('offered competitions with no draw are one line, not cards', /Not built: Women Polearm, Men Polearm/.test(await text(page, 'section.ed-progress')));
    await shot(page, 'eventday-1280');
    await layout(page, 'event day 1280');
    await card1.getByRole('button', { name: /Run this fight|Run anyway/ }).click();
    await page.locator('article[aria-label="Now on Field 1"]').waitFor({ timeout: 30000 });
    const active1 = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${BUILD}' and m.queue_state = 'active' and coalesce(m.field, 'Field 1') = 'Field 1'`);
    check('Run this fight made it the fight on Field 1', active1.length === 36);
    await sleep(2500);
    const deck1 = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${BUILD}' and m.queue_state = 'on_deck' and coalesce(m.field, 'Field 1') = 'Field 1'`);
    check('the queue behind it was filled (on deck)', deck1.length === 36, deck1);
    // the scorekeeper finishes the fight on their own device
    const r = await finish('scorekeeper', active1);
    check('the fight is scored the normal way (Pack 09B command)', r.status === 200 && /accepted/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
    const now1 = sql(`select m.id from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${BUILD}' and m.queue_state = 'active' and coalesce(m.field, 'Field 1') = 'Field 1'`);
    check('called fights stay stable: the fight on deck is the one that started', now1 === deck1, `${now1} vs ${deck1}`);
    await waitText(page, 'article[aria-label="Now on Field 1"]', '', 20000);
    // bracket: the Sabre quarterfinals are fought (whichever field they are on), the semifinal appears by itself
    const qf = sql(`select string_agg(id::text, ',' order by position) from public.matches where competition_id = '${C(3)}' and round_label = 'Quarterfinal'`).split(',');
    check('Sabre built as a bracket of 8 (4 quarterfinals)', qf.length === 4);
    for (const id of qf.slice(0, 2)) await finish('scorekeeper', id, 'a', 5, 1);
    const semi = sql(`select id || '|' || (entry_a is not null and entry_b is not null) from public.matches where competition_id = '${C(3)}' and round_label = 'Semifinal' order by position limit 1`).split('|');
    check('winners advanced automatically: the first semifinal has both fighters', semi[1] === 'true', semi.join('|'));
    let plannedSemi = '';
    for (let i = 0; i < 30; i++) { plannedSemi = sql(`select coalesce(plan_order::text, queue_state) from public.matches where id = '${semi[0]}'`); if (plannedSemi && plannedSemi !== 'scheduled') break; await sleep(1500); }
    check('the newly ready semifinal entered the plan without a rebuild (Event day re-planned it)', plannedSemi !== 'scheduled' && plannedSemi !== '', plannedSemi);
    check('the semifinal of the other half still waits (not planned before both sides are known)', sql(`select coalesce(plan_order::text, '-') from public.matches where competition_id = '${C(3)}' and round_label = 'Semifinal' order by position desc limit 1`) === '-');
    // manual override: choose another fight on Field 2
    const card2 = page.locator('article[aria-label="Next recommended on Field 2"]');
    if (await card2.count()) {
      const rec = await text(page, 'article[aria-label="Next recommended on Field 2"] .ed-next-vs');
      await card2.getByRole('button', { name: 'Choose another fight' }).click();
      const dlg = page.locator('[role="dialog"]');
      await dlg.waitFor();
      check('Choose another fight lists the other ready fights with their rest', (await dlg.locator('.ed-choose li').count()) > 0 && /rest|fresh|back-to-back/i.test(await text(page, '[role="dialog"]')));
      await shot(page, 'choose-another-1280', false);
      const pick = (await dlg.locator('.ed-choose li b').first().innerText()).trim();
      await dlg.getByRole('button', { name: 'Run this instead' }).first().click();
      await page.locator('article[aria-label="Now on Field 2"]').waitFor({ timeout: 30000 });
      const now2 = await text(page, 'article[aria-label="Now on Field 2"]');
      check('the organizer’s choice runs instead of the recommendation', now2.toLowerCase().includes(pick.split(' vs ')[0].toLowerCase()) && pick.toLowerCase() !== rec.toLowerCase(), `${pick} / ${rec} / ${now2.slice(0, 120)}`);
    } else check('Field 2 card present for the override', false);
    // rest across fields: never the same person in two fights at once
    check('nobody is in two live fights at once (event-wide)', sql(`select count(*) from (select coalesce(e.fighter_id, ef.fighter_id) f, count(*) from public.matches m join public.competitions k on k.id = m.competition_id
      join public.entries e on e.id in (m.entry_a, m.entry_b) left join public.entry_fighters ef on ef.entry_id = e.id where k.event_id = '${BUILD}' and m.queue_state = 'active' group by 1 having count(*) > 1) x`) === '0');
    check('no errors on the page', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 4. Short rest is said out loud (phone), then Review wins & losses and Confirm results
  {
    const { ctx, page } = await open('phone', 'organizer');
    await page.goto(BASE + '/events/short-rest-cup/manage?tab=eventday'); await page.locator('section.eventday').waitFor({ timeout: 30000 });
    const card = page.locator('article[aria-label="Next recommended on Field 1"]');
    await card.waitFor({ timeout: 30000 });
    const t = await text(page, 'article[aria-label="Next recommended on Field 1"]');
    check('SHORT REST warning when nothing better is possible (never claims the target was met)', /Short rest\./.test(t) && /No better ready matchup is available/.test(t) && !/3\+ fights of rest/.test(t), t);
    check('the warning offers Run anyway and Choose another fight', await card.getByRole('button', { name: 'Run anyway' }).count() === 1 && await card.getByRole('button', { name: 'Choose another fight' }).count() === 1);
    await shot(page, 'short-rest-390');
    await layout(page, 'short rest 390');
    await card.getByRole('button', { name: 'Run anyway' }).click();
    await page.locator('article[aria-label="Now on Field 1"]').waitFor({ timeout: 30000 });
    const a = sql(`select id from public.matches where competition_id = '${C(11)}' and queue_state = 'active'`);
    await finish('scorekeeper', a, 'a', 5, 2);
    const b = sql(`select id from public.matches where competition_id = '${C(11)}' and queue_state <> 'final' limit 1`);
    await finish('scorekeeper', b, 'a', 5, 4);
    check('every fight is done', sql(`select count(*) from public.matches where competition_id = '${C(11)}' and queue_state <> 'final'`) === '0');
    await waitText(page, 'section.ed-progress', 'review wins & losses', 45000);
    check('the competition no longer asks for another fight; it asks for review', await page.getByRole('button', { name: 'Review wins & losses' }).count() === 1);
    check('not official by itself', sql(`select status from public.competitions where id = '${C(11)}'`) !== 'finished');
    await page.getByRole('button', { name: 'Review wins & losses' }).click();
    const sheet = page.locator('[role="dialog"]');
    await sheet.waitFor(); await waitText(page, '[role="dialog"]', 'confirm results', 30000);
    const s1 = await text(page, '[role="dialog"]');
    check('each competitor with wins and losses, the calculated place and points', /Ann Ash.*2 wins · 0 losses.*1st/.test(s1) && /Cat Cedar.*0 wins · 2 losses/.test(s1) && /pts/.test(s1), s1.slice(0, 400));
    await sheet.locator('.rw-main', { has: page.locator('.rw-who b', { hasText: /^Ann Ash$/ }) }).click();
    check('expanding shows who they beat, with the score', /Won vs Bea Birch 5–2/.test(await text(page, '[role="dialog"]')));
    const row = (name) => sheet.locator('.rw-row', { has: page.locator('.rw-who b', { hasText: new RegExp(`^${name}$`) }) });
    await row('Ann Ash').getByText('Compare').click();
    await row('Bea Birch').getByText('Compare').click();
    check('compare two side by side, head to head', /Head to head: Ann Ash 1 – 0 Bea Birch/.test(await text(page, '[role="dialog"]')));
    await shot(page, 'review-sheet-390');
    check('[review sheet 390] no sideways scrolling', !(await sideways(page)));
    await sheet.getByRole('button', { name: 'Confirm results' }).click();
    check('Confirm names the champion before it is official', /Ann Ash is the champion/.test(await text(page, '[role="alertdialog"]')));
    await sheet.getByRole('button', { name: 'Yes, confirm results' }).click();
    await waitText(page, '[role="dialog"]', 'is official', 30000);
    check('Confirm results used Pack 09C finalization (status, audit, results)', sql(`select status || '|' || (select count(*) from public.results where competition_id = '${C(11)}') || '|' || (select count(*) from public.audit_log where action = 'competition.finished' and subject = '${C(11)}') from public.competitions where id = '${C(11)}'`) === 'finished|3|1');
    const anon = await open('phone', null);
    await anon.page.goto(BASE + '/events/short-rest-cup'); await waitText(anon.page, 'main', 'ann ash', 30000);
    check('the official podium is on the public page', /Ann Ash/i.test(await text(anon.page, 'main')));
    await anon.ctx.close();
    check('no errors on the page', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 5. Archive and statistics (desktop, Old Cup)
  {
    const base = bobStats();
    check('baseline: the closed Old Cup counts for Bob', /career:1:1/.test(base), base);
    const { ctx, page } = await open('desktop', 'owner');
    await page.goto(BASE + '/events/old-cup/manage?tab=setup'); await page.locator('#lifecycle').waitFor({ timeout: 30000 });
    check('the lifecycle actions are in Event settings, not on Event day', /Archive and statistics/i.test(await text(page, '#lifecycle')));
    await shot(page, 'lifecycle-1280');
    await page.getByRole('button', { name: 'Archive event…' }).click();
    check('Archive explains its effect before confirming', /still count|stay exactly as they are/.test(await text(page, '[role="dialog"]')));
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Archive event' }).click();
    await waitText(page, '#lifecycle', 'archived.');
    check('archived in the database', sql(`select archived_at is not null from public.events where id = '${OLD}'`) === 't');
    check('ARCHIVE CHANGES NO STATISTIC', bobStats() === base, bobStats());
    const anon = await open('desktop', null);
    await anon.page.goto(BASE + '/events?when=past'); await sleep(2500);
    check('archived event disappears from the normal event list', !(await text(anon.page, 'main')).toLowerCase().includes('old cup'));
    await anon.page.goto(BASE + '/events?when=past&archived=1'); await waitText(anon.page, 'main', 'old cup', 20000);
    check('it is there with Show archived events', (await text(anon.page, 'main')).toLowerCase().includes('old cup'));
    await anon.page.goto(BASE + '/events/old-cup'); await waitText(anon.page, 'main', 'this event is archived', 20000); await waitText(anon.page, 'main', 'bob brand', 20000);
    check('the historical page stays reachable and says it is archived', /This event is archived/i.test(await text(anon.page, 'main')) && /Bob Brand/i.test(await text(anon.page, 'main')));
    await page.getByRole('button', { name: 'Restore from archive' }).click();
    await waitText(page, '#lifecycle', 'restored from the archive');
    check('restore from archive', sql(`select archived_at is null from public.events where id = '${OLD}'`) === 't' && bobStats() === base);
    // a plain organizer is refused by the database
    const org = await open('desktop', 'organizer');
    await org.page.goto(BASE + '/events/old-cup/manage?tab=setup'); await org.page.locator('#lifecycle').waitFor({ timeout: 30000 });
    await org.page.getByRole('button', { name: 'Exclude from statistics…' }).click();
    await org.page.getByLabel('Reason (required)').fill('trying it');
    await org.page.locator('[role="dialog"]').getByRole('button', { name: 'Exclude from statistics' }).click();
    await sleep(1500);
    check('an event organizer cannot exclude (the database refuses; the screen says why)', /only the platform administrator/i.test(await text(org.page, 'body')) && sql(`select stats_excluded_at is null from public.events where id = '${OLD}'`) === 't');
    await org.ctx.close();
    await page.getByRole('button', { name: 'Exclude from statistics…' }).click();
    check('Exclude explains its effect before confirming', /stay stored and visible/.test(await text(page, '[role="dialog"]')));
    await page.getByLabel('Reason (required)').fill('Imported twice by mistake');
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Exclude from statistics' }).click();
    await waitText(page, '#lifecycle', 'excluded from official statistics.');
    const excluded = bobStats();
    check('EXCLUDE removes exactly the event’s contribution (Bob has no other results)', excluded === '-|-|-' || /^-\|/.test(excluded), excluded);
    check('the event, its fights and results stay stored', sql(`select (select count(*) from public.results where competition_id = '${C(21)}') || '|' || (select count(*) from public.matches where competition_id = '${C(21)}')`) === '3|3');
    await anon.page.goto(BASE + '/events/old-cup'); await waitText(anon.page, 'main', 'not counted in official statistics', 20000);
    check('the event page says it is not counted', /not counted in official statistics/i.test(await text(anon.page, 'main')));
    await anon.page.goto(BASE + `/fighters/${BOB}`); await waitText(anon.page, 'main', 'old cup', 20000);
    check('Bob’s history still lists it, marked Not counted in statistics', /Old Cup.*Not counted in statistics/i.test(await text(anon.page, 'main')));
    await page.getByRole('button', { name: 'Count it again…' }).click();
    await page.getByLabel('Reason (required)').fill('It was the only copy');
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Count it again' }).click();
    await waitText(page, '#lifecycle', 'counted in official statistics again');
    check('RESTORE returns exactly the baseline (no double counting)', bobStats() === base, bobStats());
    check('delete is not offered for an event with history', (await page.getByRole('button', { name: 'Delete event…' }).count()) === 0 && /cannot be deleted because/.test(await text(page, '#lifecycle')));
    check('audit: archived, unarchived, excluded, restored', sql(`select string_agg(action, ',' order by id) from public.audit_log where event_id = '${OLD}' and action like 'event.%' and action <> 'event.closed'`) === 'event.archived,event.unarchived,event.stats_excluded,event.stats_restored');
    await anon.ctx.close();
    check('no errors on the page', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 6. Fighter and roster lifecycle (phone, the captain)
  {
    const { ctx, page } = await open('phone', 'captain');
    await page.goto(BASE + '/teams/kestrel-guard'); await page.locator('#roster').waitFor({ timeout: 30000 });
    await waitText(page, '#roster', 'bob brand');
    await page.getByText('Manage the public roster').click();
    await shot(page, 'roster-manage-390');
    await page.getByRole('button', { name: 'Hide Bob Brand from the public roster' }).click();
    await waitText(page, '.lc-roster', 'hidden');
    const anon = await open('phone', null);
    await anon.page.goto(BASE + '/teams/kestrel-guard'); await anon.page.locator('#roster').waitFor({ timeout: 30000 }); await sleep(1500);
    check('hidden: the public team page no longer lists Bob as current', !(await text(anon.page, '#roster')).toLowerCase().includes('bob brand') && (await text(anon.page, '#roster')).toLowerCase().includes('john quill'));
    check('history unchanged: Bob still represented Kestrel Guard at Old Cup', sql(`select t.name from public.entries e join public.teams t on t.id = e.represented_team_id where e.id = '00000000-0000-0000-0000-00000000e961'`) === 'Kestrel Guard');
    await anon.page.goto(BASE + '/events/old-cup'); await waitText(anon.page, 'main', 'bob brand', 20000);
    check('the historical event still shows Bob with his team', /Bob Brand[^.]*Kestrel Guard|Kestrel Guard[^.]*Bob Brand/i.test(await text(anon.page, 'main')), (await text(anon.page, 'main')).slice(0, 600));
    await page.getByRole('button', { name: 'Show Bob Brand on the public roster' }).click();
    await sleep(1500);
    await anon.page.goto(BASE + '/teams/kestrel-guard'); await waitText(anon.page, '#roster', 'bob brand', 20000);
    check('show again restores the current listing', (await text(anon.page, '#roster')).toLowerCase().includes('bob brand'));
    // inactive
    await page.goto(BASE + `/fighters/${BOB}`); await page.getByRole('button', { name: 'Set as inactive…' }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Set as inactive…' }).click();
    check('inactive explains that history stays', /Every past result, medal, ranking point and team history stays/.test(await text(page, '[role="dialog"]')));
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Set as inactive' }).click();
    await waitText(page, 'main', 'is not competing at the moment');
    check('inactive in the database, same identity', sql(`select (inactive_at is not null) || '|' || (select count(*) from public.fighters where display_name = 'Bob Brand') from public.fighters where id = '${BOB}'`) === 'true|1');
    await shot(page, 'fighter-inactive-390');
    await layout(page, 'fighter page 390');
    await anon.page.goto(BASE + '/fighters?q=Bob'); await sleep(2500);
    check('the fighter directory leaves the inactive fighter out by default', !(await text(anon.page, 'main')).toLowerCase().includes('bob brand'));
    await anon.page.goto(BASE + `/fighters/${BOB}`); await waitText(anon.page, 'main', 'old cup', 20000);
    check('his historical profile and results remain', /Old Cup/i.test(await text(anon.page, 'main')) && /Inactive/i.test(await text(anon.page, 'main')));
    await anon.page.goto(BASE + '/teams/kestrel-guard'); await anon.page.locator('#roster').waitFor({ timeout: 30000 }); await sleep(1200);
    check('an inactive fighter is not on the current public roster', !(await text(anon.page, '#roster')).toLowerCase().includes('bob brand'));
    const search = await rpc('organizer', 'search_fighters_for_entry', { p_competition: C(1), p_query: 'bob' });
    check('the entrant picker leaves him out', Array.isArray(search.body) && !search.body.some(r => r.display_name === 'Bob Brand'), JSON.stringify(search.body));
    await page.getByRole('button', { name: 'Make active again' }).click();
    await waitText(page, 'main', 'set as inactive', 20000);
    check('reactivated: the same fighter, active again', sql(`select inactive_at is null from public.fighters where id = '${BOB}'`) === 't');
    await anon.ctx.close();
    check('no errors on the page', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 7. Permissions, straight at the database (no screen involved)
  {
    const refuse = async (who, fn, args, label) => { const r = await rpc(who, fn, args); check(label, r.status >= 400, `${r.status} ${JSON.stringify(r.body)}`); };
    await refuse(null, 'archive_event', { p_event: OLD, p_note: null }, 'anonymous cannot archive');
    await refuse('stranger', 'archive_event', { p_event: OLD, p_note: null }, 'a stranger cannot archive');
    await refuse('scorekeeper', 'save_queue_plan', { p_event: BUILD, p_order: [], p_hold: [] }, 'a scorekeeper cannot save a plan');
    await refuse('organizer', 'restore_event_stats', { p_event: OLD, p_reason: 'nope' }, 'an organizer cannot change statistics eligibility');
    await refuse('organizer', 'delete_event', { p_event: OLD, p_confirm: 'old-cup' }, 'an event with official history cannot be deleted');
    await refuse('stranger', 'set_fighter_active', { p_fighter: BOB, p_active: false, p_reason: null }, 'a stranger cannot deactivate a fighter');
    await refuse('organizer', 'set_fighter_active', { p_fighter: BOB, p_active: false, p_reason: null }, 'an event organizer cannot deactivate a fighter');
    await refuse('stranger', 'set_roster_visibility', { p_team: '00000000-0000-0000-0000-00000000b301', p_fighter: BOB, p_visible: false }, 'a stranger cannot hide a roster member');
    const ok = await rpc('organizer', 'delete_event', { p_event: sql(`select id from public.events where slug = 'red-deer-rumble-2027'`), p_confirm: 'red-deer-rumble-2027' });
    check('a published event (even with no fights) is not deletable', ok.status >= 400, JSON.stringify(ok.body));
  }

  // ============================================================== 8. Tablet look at the main new screens
  {
    const { ctx, page } = await open('tablet', 'organizer');
    for (const [path, name, sel] of [['/events/new', 'quick-setup-768', '.qs-cats'], ['/events/build-rumble/manage?tab=home', 'home-768', 'section[aria-label="Event home"]'], ['/events/build-rumble/manage?tab=eventday', 'eventday-768', 'section.eventday'], ['/events/old-cup/manage?tab=setup', 'settings-768', '#lifecycle']]) {
      await page.goto(BASE + path); await page.locator(sel).first().waitFor({ timeout: 30000 }).catch(() => undefined); await sleep(1500);
      await shot(page, name);
      check(`[${name}] no sideways scrolling`, !(await sideways(page)));
    }
    await ctx.close();
  }
} catch (e) {
  check('journey ran to the end', false, e?.stack ?? String(e));
}
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
console.log(failed === 0 ? 'PACK09D LIVE OK' : 'PACK09D LIVE FAILED');
process.exit(failed === 0 ? 0 : 1);
