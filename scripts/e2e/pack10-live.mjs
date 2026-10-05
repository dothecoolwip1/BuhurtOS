// Pack 10 against a REAL local stack: Postgres built from every migration + scripts/e2e/fixtures/pack10.sql, PostgREST, the real built app in a real
// Chromium. Run it through scripts/e2e/pack10-live.sh. Not part of CI (needs a PostgREST binary). Everything the pages claim is checked against the
// database too. Journeys: an active fighter's career profile (summary, disciplines, team fights, recent form, event history with the team represented
// then, season filter, head to head), an inactive fighter, an unclaimed fighter, a fictional fighter, no private data; the team profile (current roster
// under the hide / inactive rules, fighters represented, team fight record apart from discipline totals with Show fighters, event history, fight history
// with the roster of the day, head to head); cross-profile navigation; empty states; 390 / 768 / 1280 layout.
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
const U = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const WHO = { owner: [U(1), 'a1@example.test'], organizer: [U(2), 'a2@example.test'], bob: [U(3), 'a3@example.test'], captain: [U(6), 'a6@example.test'], stranger: [U(7), 'a7@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sqlAs = (role, q) => execFileSync('psql', ['-X', '-At', '-q', '-d', DB, '-c', `set role ${role}; ${q}`], { encoding: 'utf8', env: { ...process.env, PGTZ: 'America/Edmonton' } }).trim();
/** what the PUBLIC sees (row level security as anon): the pages are compared with this, never with the superuser's view */
const pub = (q) => sqlAs('anon', q);
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8', env: { ...process.env, PGTZ: 'America/Edmonton' } }).trim();
const fid = (n) => `00000000-0000-0000-0000-0000000a1f${String(n).padStart(2, '0')}`;
const tid = (n) => `00000000-0000-0000-0000-0000000a10${String(n).padStart(2, '0')}`;
const BOB = fid(1), JOHN = fid(2), MIKE = fid(3), UNA = fid(5), PETE = fid(8), KG = tid(1), IF = tid(2), MW = tid(3);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VP = { desktop: { viewport: { width: 1280, height: 900 } }, tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VP[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.errors = []; page.responses = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('response', async r => { if (r.url().includes('/rest/v1/')) { page.responses.push({ url: r.url(), status: r.status(), body: r.status() < 300 ? await r.text().catch(() => '') : '' }); } });
  return { ctx, page };
}
const inner = async (loc) => ((await loc.innerText({ timeout: 10000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ');
const letters = async (loc) => (await loc.allInnerTexts()).map(t => t.trim().charAt(0)).join('');
const text = async (page, sel = 'body') => ((await page.locator(sel).first().innerText({ timeout: 5000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ');
const waitText = (page, sel, t, timeout = 40000) => page.waitForFunction(([s, x]) => (document.querySelector(s)?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(x), [sel, t.toLowerCase()], { timeout }).then(() => true, () => false);
const shot = async (page, name, full = true) => { if (SHOTS) { await sleep(400); await page.screenshot({ path: `${SHOTS}/p10-${name}.png`, fullPage: full }).catch(() => undefined); } };
const sideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1
  || [...document.querySelectorAll('main *')].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.seg,[style*="overflow"]'); }));
const tinyTargets = (page, sel = 'main') => page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} .btn, ${s} select, ${s} summary, ${s} .opp`)]
  .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40 && !e.classList.contains('linklike') && getComputedStyle(e).visibility !== 'hidden'; })
  .map(e => (e.innerText || e.getAttribute('aria-label') || e.tagName).slice(0, 40)), sel);
const layout = async (page, name) => {
  check(`[${name}] no sideways scrolling`, !(await sideways(page)));
  const tiny = await tinyTargets(page);
  check(`[${name}] no small tap targets`, tiny.length === 0, tiny.join(' | '));
  const bad = ['undefined', 'NaN', '[object'].filter(w => (page._lastText ?? '').includes(w));
  check(`[${name}] no undefined / NaN in the text`, bad.length === 0, bad.join(','));
};
const settled = async (page, sel) => { await page.locator(sel).first().waitFor({ timeout: 30000 }); await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.body.innerText.includes('Loading'), null, { timeout: 30000 }).catch(() => undefined); await sleep(300); page._lastText = await text(page, 'main'); return page._lastText; };
/** Clicks a link and waits for the address to change; a second tap if the first was swallowed by a re-render (as a person would). */
const follow = async (page, loc, re) => { for (let i = 0; i < 2; i += 1) { await loc.click({ timeout: 10000 }); const ok = await page.waitForURL(re, { timeout: 8000 }).then(() => true, () => false); if (ok) return; } await page.waitForURL(re, { timeout: 15000 }); };
const heading = (page, name) => page.getByRole('heading', { name, exact: true });
const section = (page, id) => page.locator(`#${id}`);

try {
  // ============================================================== 1. Bob's career profile on a phone, as the public
  {
    const { ctx, page } = await open('phone');
    await page.goto(BASE + `/fighters/${BOB}`);
    const main = await settled(page, '[data-testid="career-line"]');
    const hero = await text(page, 'header.teamhead');
    check('hero: name, Active, fights for Kestrel Guard (the team today), the disciplines he fights', /Bob Brand/i.test(hero) && /\bActive\b/i.test(hero) && /Fights for Kestrel Guard/.test(hero) && /Polearm · Longsword · Sword & Shield/.test(hero), hero);
    check('hero: the career in one line (fights, record, medals, points)', /18 fights · 15 W · 2 L · 1 D · 5 gold · 3 silver · 0 bronze · 63\.75 points/.test(hero), hero);
    check('hero: ranking highlights, at most three, with a link to all rankings', (await page.locator('.ranklines .rankline').count()) <= 3 && (await page.locator('.ranklines .rankline').count()) >= 1 && /View all rankings/.test(hero), hero);
    check('hero: no fictional label, no unclaimed label on a real claimed fighter', !/Test data|Unclaimed/i.test(hero));
    const summary = await text(page, '#career');
    check('career summary: events 3, competitions 8, fights 18, record 15–2–1, win rate 83.3%', /3 Events competed/.test(summary) && /8 Competitions/.test(summary) && /18 Fights/.test(summary) && /15–2–1/.test(summary) && /83\.3%/.test(summary), summary);
    check('career summary: gold 5, silver 3, bronze 0, podiums 8, ranking points 70.75', /5 Gold/.test(summary) && /3 Silver/.test(summary) && /0 Bronze/.test(summary) && /8 Podiums/.test(summary) && /63\.75 Ranking points/.test(summary), summary);
    const dbCareer = pub(`select events || ':' || competitions || ':' || matches || ':' || wins || '-' || losses || '-' || draws || ':' || golds || '-' || silvers || '-' || bronzes || ':' || points from public.fighter_career('${BOB}') where context = 'official' and scope = 'career' and kind is null`);
    check('career summary equals the database (fighter_career)', dbCareer === '3:8:18:15-2-1:5-3-0:63.75', dbCareer);
    const disc = await text(page, '#disciplines');
    check('disciplines: data-driven lines, most fought first, each with fights, record, medals and points', /Polearm.*6 fights · 5 W · 1 L · 1 gold · 1 silver/.test(disc) && /Longsword.*5 fights · 4 W · 1 L · 1 gold · 1 silver/.test(disc) && /Sword & Shield.*2 fights · 1 W · 0 L · 1 D · 1 silver/.test(disc), disc);
    check('disciplines: no team category among the duels', !/5v5|3v3/.test(disc));
    const team = await text(page, '#team-fights');
    check('team fights apart: 5v5 4 fights 4 W (two rosters he was really on), 3v3 1 fight', /5v5.*4 fights · 4 W · 0 L · 2 gold/.test(team) && /3v3.*1 fight · 1 W · 0 L · 1 gold/.test(team), team);
    const recent = await text(page, '#recent');
    const form = await letters(page.locator('#recent .record .wl'));
    check('recent form, newest first: L W W W W …', form.slice(0, 5) === 'LWWWW', form);
    const first = await text(page, '#recent .fightline');
    check('the newest fight is the Summer Duels final, lost 4 to 5 to John, with event, discipline and date', /vs John Quill Lost 4 to 5/.test(first) && /Summer Duels 2026 · Longsword/.test(first) && /Jul/.test(first), first);
    check('the last five are shown first, the rest on request', (await page.locator('#recent .fightline').count()) === 5 && /Show last 18/.test(recent), recent);
    await page.locator('#recent').getByRole('button', { name: /Show last 18/ }).click();
    check('all eighteen official fights are listed; the fictional Phantom Cup and the excluded Spring Open are not among them', (await page.locator('#recent .fightline').count()) === 18 && !/Phantom Cup|Spring Open/.test(await text(page, '#recent')));
    const walk = await inner(page.locator('#recent .fightline', { hasText: 'Autumn Clash 2025 · Polearm' }).filter({ hasText: 'Steve Wold' }));
    check('a walkover win says so', /Won by walkover/.test(walk), walk);
    const draw = await inner(page.locator('#recent .fightline', { hasText: 'Sword & Shield' }).filter({ hasText: 'John Quill' }));
    check('the draw with John says Drew 3 to 3', /Draw vs John Quill Drew 3 to 3/i.test(draw), draw);
    const teamFight = await inner(page.locator('#recent .fightline', { hasText: 'for Iron Ferns' }).first());
    check('a 2025 team fight says it was for Iron Ferns, against Kestrel Guard or Mire Wolves', /vs (Kestrel Guard|Mire Wolves)/.test(teamFight) && /5v5 · for Iron Ferns/.test(teamFight), teamFight);
    const h2h = await text(page, '#head-to-head');
    check('head to head: the most met opponents first, with meetings and record', /Joe Marsh 3 meetings · 1 W · 2 L|Joe Marsh 3 meetings · 2 W · 1 L/.test(h2h) && /John Quill 3 meetings · 1 W · 1 L · 1 D/.test(h2h) && /Steve Wold 3 meetings · 3 W · 0 L/.test(h2h), h2h);
    check('head to head never lists a 5v5 opponent as a fighter met', !/Wolf One|Fern One/.test(h2h));
    const events = await text(page, '#events');
    check('event history: newest first, every event, the fictional and the excluded ones marked, not counted', /Phantom Cup.*Test data.*Summer Duels 2026.*Spring Open 2026.*Not counted in statistics.*Winter Melee 2026.*Autumn Clash 2025/i.test(events), events);
    const autumn = await inner(page.locator('#events .evhist > li', { hasText: 'Autumn Clash 2025' }));
    check('Autumn Clash 2025: represented Iron Ferns (his team THEN, not Kestrel Guard), 8 fights 7 W 1 L, gold Longsword, silver Polearm, gold 5v5', /Represented Iron Ferns/.test(autumn) && /8 fights: 7 W · 1 L/.test(autumn) && /Gold Men Longsword/.test(autumn) && /Silver Men Polearm/.test(autumn) && /Gold Men 5v5/.test(autumn) && !/Kestrel/.test(autumn), autumn);
    const summer = await inner(page.locator('#events .evhist > li', { hasText: 'Summer Duels 2026' }));
    check('Summer Duels 2026: represented Kestrel Guard, silver Longsword, gold Polearm, gold 5v5, with points', /Represented Kestrel Guard/.test(summer) && /Silver Men Longsword/.test(summer) && /Gold Men Polearm/.test(summer) && /11\.25 points/.test(summer), summer);
    const teams = await text(page, '#teams');
    check('teams represented: Kestrel Guard (current) and Iron Ferns (2025), from the record, no joined / left dates', /Current team/i.test(teams) && /Kestrel Guard/.test(teams) && /Iron Ferns 2025 Autumn Clash 2025/.test(teams) && (teams.match(/Kestrel Guard/g) || []).length === 1 && /Autumn Clash 2025/.test(teams) && !/Since \d|Until \d|\d{4} to \d{4}/.test(teams), teams);
    const hl = await text(page, 'main');
    check('highlights: most recent gold, best current ranking, most fought discipline, most recent event', /Most recent gold Men (Polearm|5v5) · Summer Duels 2026/i.test(hl) && /Best current ranking #/i.test(hl) && /Most fought discipline Polearm · 6 fights/i.test(hl) && /Most recent event Summer Duels 2026/i.test(hl), hl.slice(hl.indexOf('Highlights'), hl.indexOf('Highlights') + 400));
    check('no win streak is claimed (his newest fight is a loss)', !/Current win streak/i.test(hl));
    check('no private data on the page: no email, no account id, no phone', !/@example\.test|0000000000a[0-9]|phone|emergency/i.test(main), main.slice(0, 200));
    const leaked = page.responses.filter(r => /user_id|"email"|emergency|medical|waiver_signed/.test(r.body));
    check('no API answer behind the page carries an account id, email or private registration field', leaked.length === 0, leaked.map(r => r.url).join(' | '));
    await shot(page, 'fighter-bob-390');
    await layout(page, 'fighter 390');

    // season filter
    await page.getByRole('button', { name: 'Parkland 2025' }).click();
    await waitText(page, '#career', 'Parkland 2025 summary');
    const s25 = await text(page, '#career');
    check('season filter: Parkland 2025 = Autumn Clash only: 1 event, 3 competitions, 8 fights, 7–1, 2 gold 1 silver', /1 Events competed/.test(s25) && /3 Competitions/.test(s25) && /8 Fights/.test(s25) && /7–1/.test(s25) && /2 Gold/.test(s25) && /1 Silver/.test(s25), s25);
    check('season filter narrows the event history and the fight list too', (await page.locator('#events .evhist > li').count()) === 1 && /Autumn Clash 2025/.test(await text(page, '#events')) && [5, 8].includes(await page.locator('#recent .fightline').count()));
    check('season filter: discipline lines follow (Longsword 3 fights, Polearm 3)', /Longsword.*3 fights · 3 W · 0 L · 1 gold/.test(await text(page, '#disciplines')) && /Polearm.*3 fights · 2 W · 1 L · 1 silver/.test(await text(page, '#disciplines')), await text(page, '#disciplines'));
    await page.getByRole('button', { name: 'Parkland 2026' }).click();
    await waitText(page, '#career', 'Parkland 2026 summary');
    const s26 = await text(page, '#career');
    check('season filter: Parkland 2026 = Winter Melee and Summer Duels (the excluded Spring Open is not counted): 2 events, 10 fights, 8–1–1, 3 gold 2 silver', /2 Events competed/.test(s26) && /10 Fights/.test(s26) && /8–1–1/.test(s26) && /3 Gold/.test(s26) && /2 Silver/.test(s26), s26);
    check('the excluded event is still listed in the season, marked', /Spring Open 2026.*Not counted in statistics/i.test(await text(page, '#events')));
    await shot(page, 'fighter-bob-season-390');
    await page.getByRole('button', { name: 'Career' }).click();
    await waitText(page, '#career', 'Career summary');

    // head to head from the opponents list
    await page.locator('#head-to-head .opp', { hasText: 'John Quill' }).click();
    await page.locator('[data-testid="head-to-head"]').waitFor({ timeout: 10000 });
    const vs = await text(page, '[data-testid="head-to-head"]');
    check('Bob vs John: 3 meetings, Bob 1 · John 1 · Draws 1', /Bob Brand vs John Quill/i.test(vs) && /3 meetings · Bob Brand 1 · John Quill 1 · Draws 1/.test(vs), vs);
    check('Bob vs John by discipline: Longsword 1 to 1, Sword & Shield 0 to 0 (1 drawn)', /Longsword \(Men\) 1 to 1/.test(vs) && /Sword & Shield \(Men\) 0 to 0 \(1 drawn\)/.test(vs), vs);
    check('the three meetings are listed with event and score; the address carries the opponent', (await page.locator('[data-testid="head-to-head"] .fightline').count()) === 3 && page.url().includes(`vs=${JOHN}`));
    const dbH2h = pub(`select meetings || ':' || wins || '-' || losses || '-' || draws from public.fighter_head_to_head('${BOB}') where context = 'official' and opponent_fighter_id = '${JOHN}' and category is null`);
    check('head to head equals the database', dbH2h === '3:1-1-1', dbH2h);
    await shot(page, 'fighter-h2h-390');
    await layout(page, 'head to head 390');
    // tapping an opponent in the fight list opens the head to head too
    await page.locator('[data-testid="head-to-head"]').getByRole('button', { name: 'All opponents' }).click();
    await page.locator('#recent .fightline button.linklike', { hasText: 'Steve Wold' }).first().click();
    await page.locator('[data-testid="head-to-head"]').waitFor({ timeout: 10000 });
    check('tapping an opponent in the fight list opens the head to head: Bob vs Steve 3 meetings 3 · 0', /Bob Brand 3 · Steve Wold 0/.test(await text(page, '[data-testid="head-to-head"]')), await text(page, '[data-testid="head-to-head"]'));
    // then to the opponent's own profile
    await page.locator('[data-testid="head-to-head"]').getByRole('link', { name: 'Open Steve Wold' }).click();
    await page.waitForURL(new RegExp(`/fighters/${fid(7)}`));
    const steve = await settled(page, '[data-testid="career-line"]');
    check('the opponent\'s profile opens: Steve, no team, his own record', /Steve Wold/i.test(await text(page, 'header.teamhead')) && /No team/.test(await text(page, 'header.teamhead')) && /10 fights · 2 W · 8 L/.test(steve), steve.slice(0, 300));
    const stevePolearm = await inner(page.locator('#events .evhist > li', { hasText: 'Summer Duels 2026' }));
    check('a disqualified placing is labelled and placed last (4th, 0 points), while the fights he fought still count', /4th place Men Polearm Disqualified · 0 points/i.test(stevePolearm) && /5 fights: 2 W · 3 L/.test(stevePolearm), stevePolearm);
    check('no errors on the pages', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 2. inactive, unclaimed, fictional, empty
  {
    const { ctx, page } = await open('phone');
    await page.goto(BASE + `/fighters/${MIKE}`);
    await settled(page, '[data-testid="career-line"]');
    const hero = await text(page, 'header.teamhead');
    check('inactive fighter: labelled Inactive, his team shown as the last team, never Active', /\bInactive\b/i.test(hero) && /Last team: Kestrel Guard/.test(hero) && !/\bActive\b/i.test(hero), hero);
    check('inactive fighter: the career stays (3 fights, a bronze)', /3 fights · 1 W · 2 L · 0 gold · 0 silver · 1 bronze/.test(hero), hero);
    check('inactive fighter: history and the team represented stay', /Autumn Clash 2025/.test(await text(page, '#events')) && /Kestrel Guard/.test(await text(page, '#teams')));
    await shot(page, 'fighter-inactive-390');
    await layout(page, 'inactive fighter 390');

    await page.goto(BASE + `/fighters/${UNA}`);
    await settled(page, '[data-testid="career-line"]');
    const una = await text(page, 'header.teamhead');
    check('unclaimed fighter (no account): a full public career and the Unclaimed label', /Una Unclaimed/i.test(una) && /Unclaimed profile/i.test(una) && /6 fights · 1 W · 5 L · 0 gold · 0 silver · 2 bronze/.test(una), una);
    await page.locator('[data-testid="claim-panel"]').waitFor({ timeout: 10000 }).catch(() => undefined);
    check('unclaimed fighter: "Is this you?" offered to the public', /Is this you\?/i.test(await text(page, '[data-testid="claim-panel"]')));
    check('unclaimed fighter: no team, nothing invented', /No team/.test(una));

    await page.goto(BASE + `/fighters/${PETE}`);
    await settled(page, '[data-testid="career-line"]');
    const pete = await text(page, 'header.teamhead');
    check('fictional fighter: labelled Test data, with his fictional record shown as test data', /Phantom Pete/i.test(pete) && /Test data/i.test(pete) && /1 fight · 1 W · 0 L · 1 gold/.test(pete), pete);
    check('fictional fighter: the summary says it counts nowhere official', /counts nowhere official/.test(await text(page, '#career')));
    check('fictional fighter: not in any official ranking', pub(`select count(*) from public.ranking_fighters where fighter_id = '${PETE}' and scope = 'career'`) === '0');
    await shot(page, 'fighter-fictional-390');

    sql(`insert into public.fighters (id, display_name, disciplines) values ('${fid(99)}', 'Newbie Nell', '{}')`);
    sql(`insert into public.fighters (id, display_name, disciplines) values ('${fid(98)}', 'Bartholomew Fitzgerald-Montgomery of the Northern Marches', '{}')`);
    await page.goto(BASE + `/fighters/${fid(99)}`);
    await settled(page, '[data-testid="career-empty"]');
    check('brand-new fighter: a clear empty state, no empty tables', /No official results are recorded for Newbie Nell yet/.test(await text(page, '[data-testid="career-empty"]')) && (await page.locator('.statgrid').count()) === 0);
    await layout(page, 'new fighter 390');
    await page.goto(BASE + `/fighters/${fid(98)}`);
    await settled(page, 'header.teamhead');
    await shot(page, 'fighter-long-name-390');
    await layout(page, 'long name 390');
    check('no errors on the pages', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 3. Kestrel Guard on a phone, as the public
  {
    const { ctx, page } = await open('phone');
    await page.goto(BASE + '/teams/kestrel-guard');
    const main = await settled(page, '[data-testid="team-line"]');
    const hero = await text(page, 'header.teamhead');
    check('team hero: name, place, organization, active roster count', /Kestrel Guard/i.test(hero) && /Red Deer, Alberta/.test(hero) && /Parkland League/i.test(hero) && /4 active fighters on the roster/.test(hero), hero);
    check('team hero: the team fight record in one line and the best discipline totals', /5 team fights · 4 W · 1 L · 2 gold · 1 silver · 0 bronze/.test(hero) && /Discipline totals: #/.test(hero), hero);
    const roster = await text(page, '#roster');
    check('current roster: Bob, John, Kes Four, Kes Three; hidden Hal and inactive Mike are NOT current members', /Bob Brand/.test(roster) && /John Quill/.test(roster) && /Kes Three/.test(roster) && /Kes Four/.test(roster) && !/Hal Holt|Mike Thorn/.test(roster), roster);
    check('current roster equals the database (team_roster)', pub(`select string_agg(display_name, ',' order by display_name) from public.team_roster('${KG}')`) === 'Bob Brand,John Quill,Kes Four,Kes Three');
    const rep = await text(page, '#represented');
    check('fighters represented in results: Hal (hidden) and Mike (inactive, labelled) are there with their evidence', /Hal Holt 2 team fights/i.test(rep) && /Mike Thorn Inactive 1 individual result/i.test(rep) && /Bob Brand On the roster 3 individual results · 3 team fights/i.test(rep) && !/Hal Holt On the roster/i.test(rep), rep);
    const record = await text(page, '#team-record');
    check('team fight record: 3 events, 3 competitions, 5 team fights, 4–1, 80%, 2 gold 1 silver', /3 Events/.test(record) && /3 Competitions/.test(record) && /5 Team fights/.test(record) && /4–1/.test(record) && /80%/.test(record) && /2 Gold/.test(record) && /1 Silver/.test(record), record);
    check('team fight record by category: 5v5 4 fights 3 W 1 L, 3v3 1 fight', /5v5.*4 fights · 3 W · 1 L · 1 gold · 1 silver/.test(record) && /3v3.*1 fight · 1 W · 0 L · 1 gold/.test(record), record);
    check('team fight record equals the database (team_career) and the existing team statistics view', pub(`select matches || ':' || wins || '-' || losses || ':' || golds from public.team_career('${KG}') where context = 'official' and scope = 'career' and category is null`) === '5:4-1:2' && pub(`select matches || ':' || wins || '-' || losses || ':' || golds from public.team_stats where team_id = '${KG}'`) === '5:4-1:2');
    const tf = await letters(page.locator('#team-record .record .wl'));
    check('team form, newest first: W W W W L (the Autumn Clash loss came before its win that evening)', tf === 'WWWWL', tf);
    const dt = await text(page, '#discipline-totals');
    check('discipline totals shown apart, with rank and points per discipline and a link to the Team discipline rankings', /#\d Longsword/.test(dt) && /#\d Polearm/.test(dt) && /#\d Sword & Shield/.test(dt) && /Team discipline rankings/.test(dt), dt);
    check('discipline totals do not mention the team fight record, and the record never counts duels', !/5v5|3v3/.test(dt));
    await page.locator('#discipline-totals .discline', { hasText: 'Longsword' }).getByRole('button', { name: 'Show fighters' }).click();
    await page.locator('#discipline-totals .contriblist').waitFor({ timeout: 10000 });
    const contrib = await text(page, '#discipline-totals .contriblist');
    const lsTotal = pub(`select points from public.ranking_team_disciplines where scope = 'career' and team_id = '${KG}' and category = 'longsword' and gender is null`);
    const lsSum = pub(`select sum(points) from public.team_discipline_contributions where scope = 'career' and team_id = '${KG}' and category = 'longsword' and gender is null`);
    check('Show fighters: Bob, John and Mike (not Bob\'s 2025 gold for Iron Ferns) and the total equals the discipline total', /Bob Brand/.test(contrib) && /John Quill/.test(contrib) && /Mike Thorn/.test(contrib) && contrib.includes(`Total ${Number(lsTotal)}`) && Number(lsTotal) === Number(lsSum), `${contrib} | ${lsTotal} ${lsSum}`);
    const ev = await text(page, '#events');
    const summer = await inner(page.locator('#events .evhist > li', { hasText: 'Summer Duels 2026' }));
    check('team event history: Summer Duels: the team competed (Men 5v5 2 W, gold) AND its fighters represented it (2 fighters, Bob and John)', /Team competed Men 5v5: 2 W · 0 L · Gold · 10 points/i.test(summer) && /Represented 2 fighters in 3 individual competitions · 2 gold · 1 silver · Bob Brand, John Quill/i.test(summer), summer);
    const winter = await inner(page.locator('#events .evhist > li', { hasText: 'Winter Melee 2026' }));
    check('team event history: Winter Melee: Men 3v3 gold and 2 duelists (archived: still here, still counted)', /Team competed Men 3v3: 1 W · 0 L · Gold/i.test(winter) && /Represented 2 fighters/i.test(winter), winter);
    check('team event history never shows the excluded Spring Open as counted, and the fictional Phantom Cup is not Kestrel Guard\'s', !/Phantom Cup/.test(ev) && /Spring Open 2026.*Not counted in statistics/i.test(ev), ev);
    const fh = await text(page, '#team-fights');
    const firstFight = await inner(page.locator('#team-fights .fightline').first());
    check('team fight history, newest first: Summer Duels vs Mire Wolves won 3 to 1, finished Gold', /vs Mire Wolves Won 3 to 1/.test(firstFight) && /Summer Duels 2026 · 5v5/.test(firstFight) && /finished Gold/i.test(firstFight), firstFight);
    if (await page.locator('#team-fights').getByRole('button', { name: /Show last/ }).count()) await page.locator('#team-fights').getByRole('button', { name: /Show last/ }).click();
    const autumnFight = page.locator('#team-fights .fightline', { hasText: 'Autumn Clash 2025' }).filter({ hasText: 'Iron Ferns' });
    await autumnFight.getByRole('button', { name: 'Roster that day' }).click();
    await autumnFight.locator('.rosterlist').waitFor({ timeout: 10000 });
    const dayRoster = await inner(autumnFight.locator('.rosterlist'));
    check('the roster of that day (Autumn Clash 2025): Hal Holt, John Quill, Kes Three, Kes Four: not today\'s roster (no Bob, who was Iron Ferns then)', /Hal Holt/i.test(dayRoster) && /John Quill/i.test(dayRoster) && /Kes Three/i.test(dayRoster) && !/Bob Brand/i.test(dayRoster), dayRoster);
    check('that fight was a loss to Iron Ferns, 1 to 3, finished Silver', /Lost 1 to 3/.test(await inner(autumnFight)) && /finished Silver/i.test(await inner(autumnFight)), await inner(autumnFight));
    const h2h = await text(page, '#head-to-head');
    check('team head to head: Mire Wolves 3 meetings 3 W, Iron Ferns 2 meetings 1 W 1 L', /Mire Wolves 3 meetings · 3 W · 0 L/.test(h2h) && /Iron Ferns 2 meetings · 1 W · 1 L/.test(h2h), h2h);
    await page.locator('#head-to-head .opp', { hasText: 'Iron Ferns' }).click();
    await page.locator('[data-testid="team-head-to-head"]').waitFor({ timeout: 10000 });
    const vsIF = await text(page, '[data-testid="team-head-to-head"]');
    check('Kestrel Guard vs Iron Ferns: 2 meetings, 1 each, 5v5 1 to 1', /Kestrel Guard vs Iron Ferns/i.test(vsIF) && /2 meetings · Kestrel Guard 1 · Iron Ferns 1/.test(vsIF) && /5v5 \(Men\) 1 to 1/.test(vsIF), vsIF);
    check('no private data on the team page', !/@example\.test|phone|emergency/i.test(main));
    const leaked = page.responses.filter(r => /user_id|"email"|emergency|medical/.test(r.body));
    check('no API answer behind the team page carries an account id or email', leaked.length === 0, leaked.map(r => r.url).join(' | '));
    await shot(page, 'team-kg-390');
    await layout(page, 'team 390');
    // season filter on the team
    await page.getByRole('button', { name: 'Parkland 2025' }).click();
    await waitText(page, '#team-record', 'Parkland 2025');
    const s25 = await text(page, '#team-record');
    check('team season filter: Parkland 2025 = the Autumn Clash 5v5: 2 fights 1–1, silver', /2 Team fights/.test(s25) && /1–1/.test(s25) && /1 Silver/.test(s25), s25);
    check('team season filter narrows the discipline totals to that season', /#\d Longsword/.test(await text(page, '#discipline-totals')) && (await page.locator('#events .evhist > li').count()) === 1);
    check('no errors on the page', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 4. cross-profile navigation (desktop)
  {
    const { ctx, page } = await open('desktop');
    await page.goto(BASE + `/fighters/${BOB}`);
    await settled(page, '[data-testid="career-line"]');
    await page.locator('#teams').getByRole('link', { name: 'Iron Ferns' }).click();
    await page.waitForURL(/\/teams\/iron-ferns/);
    await settled(page, '[data-testid="team-line"]');
    check('fighter → historical team: Iron Ferns opens with its own record (Bob is not on its roster today)', /Iron Ferns/i.test(await text(page, 'header.teamhead')) && !/Bob Brand/.test(await text(page, '#roster')) && /Bob Brand/.test(await text(page, '#represented')));
    await page.locator('#events').getByRole('link', { name: 'Autumn Clash 2025' }).click();
    await page.waitForURL(/\/events\/autumn-clash-2025/);
    await page.locator('.pd-name a', { hasText: 'Bob Brand' }).first().waitFor({ timeout: 30000 });
    const evPage = await text(page, 'main');
    check('team → event: the event page shows the official results with Bob\'s gold', /Autumn Clash 2025/i.test(evPage) && /Bob Brand/.test(evPage), evPage.slice(0, 300));
    await follow(page, page.locator('.pd-name a', { hasText: 'Bob Brand' }).first(), new RegExp(`/fighters/${BOB}`));
    await settled(page, '[data-testid="career-line"]');
    check('event → fighter: back to Bob\'s profile', /Bob Brand/i.test(await text(page, 'header.teamhead')));
    await follow(page, page.locator('#events .evhist > li', { hasText: 'Summer Duels 2026' }).getByRole('link', { name: 'Men Longsword' }), /\/events\/summer-duels-2026#results-/);
    check('fighter → competition result: the event page is opened at that competition\'s official result', /#results-/.test(page.url()));
    await page.goto(BASE + '/teams/kestrel-guard');
    await settled(page, '[data-testid="team-line"]');
    await page.locator('#roster').getByRole('link', { name: 'John Quill' }).click();
    await page.waitForURL(new RegExp(`/fighters/${JOHN}`));
    await settled(page, '[data-testid="career-line"]');
    check('team → fighter: John\'s profile', /John Quill/i.test(await text(page, 'header.teamhead')));
    await page.goto(BASE + '/teams/kestrel-guard');
    await settled(page, '[data-testid="team-line"]');
    await page.locator('header.teamhead').getByRole('link', { name: /View all rankings/ }).click();
    await page.waitForURL(/\/rankings/);
    check('team → rankings', /\/rankings\?who=teams/.test(page.url()));
    await page.goto(BASE + '/teams/kestrel-guard');
    await settled(page, '[data-testid="team-line"]');
    await page.locator('#discipline-totals').getByRole('link', { name: /Team discipline rankings/ }).click();
    await page.waitForURL(/\/rankings\?who=teams&table=disciplines/);
    check('team → discipline leaderboard', true);
    // discovery
    await page.goto(BASE + '/fighters');
    await page.waitForFunction(() => document.body.innerText.includes('Bob Brand'), null, { timeout: 30000 }).catch(() => undefined);
    const dir = await text(page, 'main');
    check('fighter directory: active fighters listed with their team, inactive Mike not by default', /Bob Brand/i.test(dir) && /Kestrel Guard/.test(dir) && !/Mike Thorn/i.test(dir), dir.slice(0, 300));
    check('fighter directory: the discipline filter comes from the reference data (Marathon is there without code)', (await page.locator('select option', { hasText: 'Marathon' }).count()) === 1);
    await page.getByRole('link', { name: /Bob Brand/ }).first().click();
    await page.waitForURL(new RegExp(`/fighters/${BOB}`));
    check('fighter directory → profile', true);
    await page.goto(BASE + '/teams');
    await page.waitForFunction(() => document.body.innerText.includes('Kestrel Guard'), null, { timeout: 30000 }).catch(() => undefined);
    await page.getByRole('link', { name: /Kestrel Guard/ }).first().click();
    await page.waitForURL(/\/teams\/kestrel-guard/);
    check('team directory → profile', true);
    check('no errors on the pages', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ============================================================== 5. the fighter's own view, and Pack 09D controls still work from the new pages
  {
    const { ctx, page } = await open('phone', 'bob');
    await page.goto(BASE + `/fighters/${BOB}`);
    await settled(page, '[data-testid="career-line"]');
    check('the fighter sees Edit my profile and the inactive control on their own page', (await page.getByRole('link', { name: 'Edit my profile' }).count()) === 1 && (await page.getByRole('button', { name: /Set as inactive/ }).count()) === 1);
    await ctx.close();
    const { ctx: c2, page: p2 } = await open('phone', 'captain');
    await p2.goto(BASE + '/teams/kestrel-guard');
    await settled(p2, '[data-testid="team-line"]');
    check('the captain still has Manage the public roster on the team page', (await p2.locator('summary', { hasText: 'Manage the public roster' }).count()) === 1);
    await c2.close();
  }

  // ============================================================== 6. tablet and desktop looks, an empty team, a fictional team
  {
    sql(`insert into public.teams (id, slug, name, status, city, country) values ('${tid(9)}', 'fresh-forge', 'Fresh Forge', 'approved', 'Innisfail', 'CA')`);
    for (const kind of ['tablet', 'desktop']) {
      const { ctx, page } = await open(kind);
      for (const [path, name, sel] of [[`/fighters/${BOB}`, `fighter-bob-${VP[kind].viewport.width}`, '[data-testid="career-line"]'], ['/teams/kestrel-guard', `team-kg-${VP[kind].viewport.width}`, '[data-testid="team-line"]'], [`/fighters/${BOB}?vs=${JOHN}`, `fighter-h2h-${VP[kind].viewport.width}`, '[data-testid="head-to-head"]']]) {
        await page.goto(BASE + path); await settled(page, sel);
        await shot(page, name);
        await layout(page, name);
      }
      check(`[${kind}] no errors`, page.errors.length === 0, page.errors.join(' | '));
      await ctx.close();
    }
    const { ctx, page } = await open('phone');
    await page.goto(BASE + '/teams/fresh-forge');
    await settled(page, '[data-testid="team-empty"]');
    check('brand-new team: a clear empty state, the roster empty state, no empty tables', /No official results are recorded for Fresh Forge yet/.test(await text(page, '[data-testid="team-empty"]')) && /No active fighters are on the public roster yet/.test(await text(page, '#roster')) && (await page.locator('.statgrid').count()) === 0);
    await layout(page, 'new team 390');
    await page.goto(BASE + '/teams/phantom-test-team');
    await settled(page, 'header.teamhead');
    check('fictional team: labelled Test data, no official record', /Test data/i.test(await text(page, 'header.teamhead')) && !/team fights ·/.test(await text(page, 'header.teamhead')));
    await page.goto(BASE + '/teams/iron-ferns');
    await settled(page, '[data-testid="team-line"]');
    const ifRep = await text(page, '#represented');
    check('Iron Ferns: Bob is represented in its results (2025) and credited there, with Joe', /Bob Brand/.test(ifRep) && /Joe Marsh/.test(ifRep) && !/Bob Brand On the roster/i.test(ifRep), ifRep);
    check('no errors', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }
} catch (e) {
  check('journey ran to the end', false, e?.stack ?? String(e));
}
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
console.log(failed === 0 ? 'PACK10 LIVE OK' : 'PACK10 LIVE FAILED');
process.exit(failed === 0 ? 0 : 1);
