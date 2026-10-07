// Team discipline totals and correcting the team a fighter represented, against a REAL local stack: Postgres built from the migrations + fixture,
// PostgREST, the real built app in a real Chromium. Run it through scripts/e2e/represented-team-live.sh (which starts the stack). Not part of CI.
// Proves: Rankings > Teams shows Discipline totals (Ankle Biters 9 = Bob 3 + John 3 + Joe 3) apart from Team fights; an organizer corrects the team
// a fighter represented in Manage > Run with a reason; the change is audited, the fighter's current team is untouched, the totals follow; a stranger,
// the public and an organizer whose role has expired cannot change it; the platform owner can. Screens at 390, 768 and 1280 px.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 500)}`); };

const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const U = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const WHO = { owner: [U(1), 'u1@example.test'], organizer: [U(2), 'u2@example.test'], stranger: [U(7), 'u7@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const id = (p) => `00000000-0000-0000-0000-00000000${p}`;
async function rpc(who, fn, args) {
  const headers = { 'content-type': 'application/json', apikey: 'x' };
  if (who) headers.authorization = `Bearer ${session(WHO[who]).access_token}`;
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const repOf = (entry) => sql(`select coalesce(t.name, 'none') || '/' || coalesce(e.represented_team_basis, 'none') from public.entries e left join public.teams t on t.id = e.represented_team_id where e.id = '${id(entry)}'`);

let lastPage = null;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { desktop: { viewport: { width: 1280, height: 900 } }, tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  lastPage = page;
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  return { ctx, page };
}
const texts = async (page, sel) => (await page.locator(sel).allInnerTexts()).map(s => s.replace(/\s+/g, ' ').trim());
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/represented-${name}.png`, fullPage: true }); };
const noSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth);
const RANKINGS = `/rankings?who=teams&org=${id('b001')}&season=${id('b101')}`;
const RUN = '/events/fall-open/control?mode=setup&tool=run';
const reprSection = (page) => page.locator('section[aria-label="Longsword (men)"] details', { hasText: 'Teams represented' });

try {
  // ================================================================ 1. the public sees Discipline totals, apart from Team fights
  for (const kind of ['phone', 'tablet', 'desktop']) {
    const { ctx, page } = await open(kind, null);
    await page.goto(BASE + RANKINGS);
    await page.getByRole('heading', { name: 'Team discipline leaders' }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    check(`[${kind}] Teams opens on Discipline totals`, (await page.getByRole('group', { name: 'Team table' }).getByRole('button', { name: 'Discipline totals' }).getAttribute('aria-pressed')) === 'true');
    const cards = await texts(page, '.topteam');
    check(`[${kind}] one card per individual discipline, no team fight category (Longsword: Red Deer Reavers 12)`, cards.length === 1 && /longsword #1 red deer reavers 12 points/i.test(cards[0]), cards);
    await page.getByRole('button', { name: /^Longsword:/ }).click();
    await page.waitForTimeout(500);
    const rows = await texts(page, '.rankcards > li');
    check(`[${kind}] full table: Red Deer Reavers 12, Ankle Biters 9`, /^1 Red Deer Reavers.*12/.test(rows[0] ?? '') && /^2 Ankle Biters.*9/.test(rows[1] ?? ''), rows);
    await page.locator('.rankcards > li', { hasText: 'Ankle Biters' }).getByRole('button', { name: 'Show fighters' }).click();
    await page.locator('.contriblist').first().waitFor();
    const lines = await texts(page, '.contriblist li');
    check(`[${kind}] Show fighters: Bob 3, Joe 3, John 3 (= 9)`, lines.join('|') === 'Bob 3|Joe 3|John 3', lines);
    const note = (await texts(page, 'section[aria-labelledby="discipline-board-h"] p.muted')).join(' ');
    check(`[${kind}] results with no recorded team are listed, not guessed (Mike 1 + Nia 4 = 5)`, /Not credited to any team: 5 points from 2 fighters .*\(Nia, Mike\)/.test(note), note);
    check(`[${kind}] no sideways scrolling`, await noSideways(page));
    await shot(page, `1-discipline-totals-${kind}`);
    await page.getByRole('group', { name: 'Team table' }).getByRole('button', { name: 'Team fights' }).click();
    await page.getByRole('heading', { name: 'Team fight leaders' }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    const fights = await texts(page, '.topteam');
    check(`[${kind}] Team fights is a separate table: 5v5 led by Ankle Biters with 50`, fights.length === 1 && /5v5 #1 ankle biters 50 points/i.test(fights[0]), fights);
    await shot(page, `2-team-fights-${kind}`);
    check(`[${kind}] no page errors`, page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ================================================================ 1b. ties, divisions and a discipline the frontend has never heard of (Coastal League)
  const COASTAL = `/rankings?who=teams&org=${id('c001')}&season=${id('c101')}`;
  for (const kind of ['phone', 'tablet', 'desktop']) {
    const { ctx, page } = await open(kind, null);
    await page.goto(BASE + COASTAL);
    await page.getByRole('heading', { name: 'Team discipline leaders' }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    const cards = await texts(page, '.topteam');
    check(`[${kind}] one leader card per individual discipline, named from the data (Dagger, Longsword, Sword & Shield)`,
      cards.length === 3 && /^dagger/i.test(cards[0]) && /^longsword/i.test(cards[1]) && /^sword (&|and) shield/i.test(cards[2]), cards);
    check(`[${kind}] a discipline no frontend code knows (Dagger) appears: Red Deer Reavers, 2 points`, /dagger #1 red deer reavers 2 points/i.test(cards[0] ?? ''), cards[0]);
    check(`[${kind}] the leader overall is the best combined total: Northern Ravens 10 (men 6 + women 4)`, /longsword #1 northern ravens 10 points/i.test(cards[1] ?? ''), cards[1]);
    check(`[${kind}] a genuine tie is shown, not decided: Ankle Biters tied with Red Deer Reavers on 5`, /sword (&|and) shield #1 ankle biters tied with red deer reavers 5 points/i.test(cards[2] ?? ''), cards[2]);
    await shot(page, `1b-ties-divisions-${kind}`);
    await page.getByRole('button', { name: /^Longsword:/ }).click();
    await page.waitForTimeout(500);
    const division = page.getByRole('group', { name: 'Division' });
    const choices = await texts(page, '[aria-label="Division"] button');
    check(`[${kind}] the divisions that exist are offered: All divisions, Men, Women`, choices.join('|') === 'All divisions|Men|Women', choices);
    let rows = await texts(page, '.rankcards > li');
    check(`[${kind}] all divisions: Northern Ravens 10 ahead of Ankle Biters 6`, /^1 Northern Ravens.*10/.test(rows[0] ?? '') && /^2 Ankle Biters.*6/.test(rows[1] ?? ''), rows);
    check(`[${kind}] the combined total explains its divisions without double counting (Men 6 · Women 4 = 10)`, /Men 6 · Women 4/.test(rows[0] ?? ''), rows[0]);
    await division.getByRole('button', { name: 'Men', exact: true }).click();
    await page.waitForTimeout(400);
    rows = await texts(page, '.rankcards > li');
    check(`[${kind}] men: a tie shares rank 1 (Ankle Biters and Northern Ravens, 6 each)`, rows.length === 2 && rows.every(r => r.startsWith('1 ') && /6\s*points?$/.test(r)), rows);
    await division.getByRole('button', { name: 'Women', exact: true }).click();
    await page.waitForTimeout(400);
    rows = await texts(page, '.rankcards > li');
    check(`[${kind}] women: only the team with women's points, Northern Ravens 4`, rows.length === 1 && /^1 Northern Ravens.*4/.test(rows[0]), rows);
    await division.getByRole('button', { name: 'All divisions' }).click();
    await page.waitForTimeout(400);
    await page.locator('.rankcards > li', { hasText: 'Northern Ravens' }).getByRole('button', { name: 'Show fighters' }).click();
    await page.locator('.contriblist').first().waitFor();
    const lines = await texts(page, '.contriblist li');
    check(`[${kind}] Show fighters: Dee 6, Eve 4 (adds up to 10)`, lines.join('|') === 'Dee 6|Eve 4', lines);
    await page.getByRole('button', { name: /^Sword (&|and) Shield:/i }).click();
    await page.waitForTimeout(500);
    rows = await texts(page, '.rankcards > li');
    check(`[${kind}] tapping the tied discipline opens its table with both teams at rank 1`, rows.length === 2 && rows.every(r => r.startsWith('1 ') && /5\s*points?$/.test(r)), rows);
    check(`[${kind}] a one-division discipline offers no division control`, await page.getByRole('group', { name: 'Division' }).count() === 0);
    await page.getByRole('button', { name: /^Dagger:/i }).click();
    await page.waitForTimeout(500);
    rows = await texts(page, '.rankcards > li');
    check(`[${kind}] the new discipline opens its own full table (Red Deer Reavers 2 points)`, rows.length === 1 && /^1 Red Deer Reavers.*2\s*points?$/.test(rows[0]), rows);
    await page.getByRole('group', { name: 'Team table' }).getByRole('button', { name: 'Team fights' }).click();
    await page.getByRole('heading', { name: 'No team rankings yet' }).waitFor({ timeout: 10000 });
    check(`[${kind}] Team fights is its own table: this league has no team fights, so it says so and shows no discipline totals`,
      await page.locator('.topteam').count() === 0 && await page.getByRole('heading', { name: 'Team discipline leaders' }).count() === 0);
    check(`[${kind}] no sideways scrolling`, await noSideways(page));
    check(`[${kind}] no page errors`, page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }

  // ================================================================ 2. the organizer corrects Mike's team in Manage > Run
  const mikeBefore = sql(`select team_id from public.fighters where id = '${id('b406')}'`);
  const membershipsBefore = sql(`select count(*) from public.team_memberships`);
  {
    const { ctx, page } = await open('phone', 'organizer');
    await page.goto(BASE + RUN);
    await page.locator('section[aria-label="Longsword (men)"]').waitFor({ timeout: 20000 });
    const details = reprSection(page);
    check('the Longsword competition offers "Teams represented"', await details.waitFor({ timeout: 15000 }).then(() => true, () => false));
    await page.locator('section[aria-label="5v5 (men)"] details', { hasText: 'Team rosters' }).waitFor({ timeout: 15000 });
    check('a team fight (5v5) does not offer it', await page.locator('section[aria-label="5v5 (men)"] details', { hasText: 'Teams represented' }).count() === 0);
    await details.locator('summary').click();
    await details.locator('.reprteams > li').first().waitFor({ timeout: 10000 });
    const list = await texts(page, 'section[aria-label="Longsword (men)"] .reprteams > li');
    check('each fighter shows the team they represented and how it is known',
      list.some(l => /^Bob Ankle Biters · Recorded with the results/.test(l)) && list.some(l => /^Mike No team · No team recorded/.test(l)), list);
    await shot(page, '3-teams-represented-phone');
    const mike = details.locator('.reprteams > li', { hasText: 'Mike' });
    await mike.getByRole('button', { name: 'Change the team Mike represented' }).click();
    const save = mike.getByRole('button', { name: 'Save team' });
    check('Save is not possible before a team and a reason are given', await save.isDisabled());
    await mike.getByLabel(/Team Mike fought for/).selectOption({ label: 'Northern Ravens · Edmonton' });
    check('Save is still not possible without a reason', await save.isDisabled());
    await mike.getByLabel(/Why is it changing/).fill('Checked the Fall Open entry list');
    check('Save becomes possible with a team and a reason', await save.isEnabled());
    await shot(page, '4-correction-form-phone');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor({ timeout: 10000 });
    const msg = (await texts(page, 'section[aria-label="Longsword (men)"] [role="status"]')).join(' ');
    check('a clear confirmation names the fighter, the competition and the team', /Saved\. Mike's points in Longsword \(men\) now count for Northern Ravens\. Their current team is unchanged\./.test(msg), msg);
    await page.waitForTimeout(400);
    check('the list now shows the correction', (await texts(page, 'section[aria-label="Longsword (men)"] .reprteams > li')).some(l => /^Mike Northern Ravens · Corrected by an organizer/.test(l)));
    check('no sideways scrolling on the phone', await noSideways(page));
    await shot(page, '5-corrected-phone');
    check('[organizer] no page errors', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }
  check('database: Mike\'s entry now represents Northern Ravens (correction)', repOf('b606') === 'Northern Ravens/correction', repOf('b606'));
  const audit = sql(`select actor || '|' || coalesce(details->>'from', 'null') || '|' || (details->>'to') || '|' || (details->>'reason') from public.audit_log where action = 'entry.represented_team_changed' and subject = '${id('b606')}'`);
  check('database: the change is audited with who, from, to and the reason', audit === `${U(2)}|null|${id('b303')}|Checked the Fall Open entry list`, audit);
  check('database: Mike\'s current team is unchanged', sql(`select team_id from public.fighters where id = '${id('b406')}'`) === mikeBefore);
  check('database: no team membership was touched', sql(`select count(*) from public.team_memberships`) === membershipsBefore);
  const nr = sql(`select points::int from public.ranking_team_disciplines where scope = 'season' and season_id = '${id('b101')}' and category = 'longsword' and gender is null and team_id = '${id('b303')}'`);
  check('the discipline totals follow: Northern Ravens now has Mike\'s 1 point', nr === '1', nr);

  // ================================================================ 2b. "No team": Joe fought independently
  {
    const joeTeamBefore = sql(`select team_id from public.fighters where id = '${id('b403')}'`);
    const { ctx, page } = await open('phone', 'organizer');
    await page.goto(BASE + RUN);
    await page.locator('section[aria-label="Longsword (men)"]').waitFor({ timeout: 20000 });
    const details = reprSection(page);
    await details.locator('summary').click();
    const joe = details.locator('.reprteams > li', { hasText: 'Joe' });
    await joe.waitFor({ timeout: 10000 });
    await joe.getByRole('button', { name: 'Change the team Joe represented' }).click();
    const save = joe.getByRole('button', { name: 'Save team' });
    check('"No team" is offered as a choice', (await joe.getByLabel(/Team Joe fought for/).locator('option').allInnerTexts()).some(o => /^No team/.test(o)));
    await joe.getByLabel(/Team Joe fought for/).selectOption({ label: 'No team (fought independently)' });
    check('"No team" still needs a reason', await save.isDisabled());
    await joe.getByLabel(/Why is it changing/).fill('Fought as an independent that day');
    await save.click();
    await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor({ timeout: 10000 });
    const msg = (await texts(page, 'section[aria-label="Longsword (men)"] [role="status"]')).join(' ');
    check('the confirmation says it now counts for no team and the current team is unchanged', /Saved\. Joe's points in Longsword \(men\) now count for no team\. Their current team is unchanged\./.test(msg), msg);
    await page.waitForTimeout(400);
    check('the list shows "Set to no team by an organizer"', (await texts(page, 'section[aria-label="Longsword (men)"] .reprteams > li')).some(l => /^Joe No team · Set to no team by an organizer/.test(l)));
    await ctx.close();
    check('database: Joe\'s entry now has no represented team (correction)', repOf('b603') === 'none/correction', repOf('b603'));
    check('database: Joe\'s current team is unchanged', sql(`select team_id from public.fighters where id = '${id('b403')}'`) === joeTeamBefore);
    const joeAudit = sql(`select actor || '|' || (details->>'from') || '|' || coalesce(details->>'to', 'null') || '|' || (details->>'reason') from public.audit_log where action = 'entry.represented_team_changed' and subject = '${id('b603')}'`);
    check('database: audited as a change from Ankle Biters to no team, with the reason', joeAudit === `${U(2)}|${id('b301')}|null|Fought as an independent that day`, joeAudit);
    const ab = sql(`select points::int from public.ranking_team_disciplines where scope = 'season' and season_id = '${id('b101')}' and category = 'longsword' and gender is null and team_id = '${id('b301')}'`);
    check('the discipline totals follow: Ankle Biters drops from 9 to 6 (Bob 3 + John 3)', ab === '6', ab);
    const { ctx: c2, page: p2 } = await open('phone', null);
    await p2.goto(BASE + RANKINGS);
    await p2.getByRole('heading', { name: 'Team discipline leaders' }).waitFor({ timeout: 20000 });
    await p2.waitForTimeout(600);
    const note = (await texts(p2, 'section[aria-labelledby="discipline-board-h"] p.muted')).join(' ');
    check('Joe\'s 3 points are shown as not credited to any team, not hidden (Nia 4 + Joe 3 = 7)', /Not credited to any team: 7 points from 2 fighters .*\(Nia, Joe\)/.test(note), note);
    await c2.close();
  }

  // ================================================================ 3. who may not change it
  {
    const { ctx, page } = await open('phone', 'stranger');
    await page.goto(BASE + RUN);
    await page.getByRole('heading', { name: 'This area is for organizers' }).waitFor({ timeout: 20000 });
    check('a signed-in non-organizer does not get the Manage screen', await page.locator('details', { hasText: 'Teams represented' }).count() === 0);
    await ctx.close();
  }
  const anon = await rpc(null, 'set_represented_team', { p_entry: id('b601'), p_team: id('b302'), p_reason: 'not allowed' });
  check('the public cannot call the correction', anon.status === 401 || anon.status === 403, JSON.stringify(anon));
  const stranger = await rpc('stranger', 'set_represented_team', { p_entry: id('b601'), p_team: id('b302'), p_reason: 'not allowed' });
  check('a signed-in non-organizer is refused by the database', stranger.status === 403 && stranger.body?.code === '42501', JSON.stringify(stranger));
  const expired = await rpc('organizer', 'set_represented_team', { p_entry: id('b611'), p_team: id('b303'), p_reason: 'role expired' });
  check('an organizer whose event ended more than 7 days ago is refused', expired.status === 403 && expired.body?.code === '42501', JSON.stringify(expired));
  check('Bob and Nia are unchanged after the refused attempts', repOf('b601') === 'Ankle Biters/recorded' && repOf('b611') === 'none/none', `${repOf('b601')} ${repOf('b611')}`);

  // ================================================================ 4. the platform owner can correct the older event, at tablet and desktop width
  for (const kind of ['tablet', 'desktop']) {
    const { ctx, page } = await open(kind, 'owner');
    await page.goto(BASE + '/events/spring-open/control?mode=setup&tool=run');
    await page.locator('section[aria-label="Longsword (men)"]').waitFor({ timeout: 20000 });
    const details = reprSection(page);
    await details.locator('summary').click();
    const nia = details.locator('.reprteams > li', { hasText: 'Nia' });
    await nia.waitFor({ timeout: 10000 });
    if (kind === 'tablet') {
      await nia.getByRole('button', { name: 'Change the team Nia represented' }).click();
      await nia.getByLabel(/Team Nia fought for/).selectOption({ label: 'Northern Ravens · Edmonton' });
      await nia.getByLabel(/Why is it changing/).fill('Confirmed with the Northern Ravens captain');
      await nia.getByRole('button', { name: 'Save team' }).click();
      await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor({ timeout: 10000 });
      check('[tablet] the platform owner corrects a result from an older event', repOf('b611') === 'Northern Ravens/correction', repOf('b611'));
    } else {
      check('[desktop] the corrected team is shown', /Nia Northern Ravens · Corrected by an organizer/.test((await nia.innerText()).replace(/\s+/g, ' ')));
    }
    check(`[${kind}] no sideways scrolling`, await noSideways(page));
    await shot(page, `6-owner-${kind}`);
    check(`[${kind}] no page errors`, page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }
  check('database: the owner\'s correction is audited too', sql(`select count(*) from public.audit_log where action = 'entry.represented_team_changed' and actor = '${U(1)}'`) === '1');
} catch (e) {
  check('the run reached the end', false, e.stack ?? e);
  if (lastPage) { console.log('--- what the page showed:', lastPage.url()); console.log((await lastPage.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500)); console.log('--- page errors:', lastPage.errors); await shot(lastPage, 'failure'); }
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
