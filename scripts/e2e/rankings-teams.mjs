// Drives the REAL built app in a REAL Chromium against a small in-script stand-in for the REST API (organizations, seasons, ranking views) and checks the
// Rankings page: Fighters keep their categories; Teams offer only categories teams rank in; the "Top teams" overview shows the leader of each; tapping a
// leader opens that category's full ranking; a division is offered only where one really exists; an organization with no team results shows a plain empty state.
//   VITE_BASE=/ npx vite build --outDir /tmp/e2e-dist && npx vite preview --outDir /tmp/e2e-dist --port 4181 &
//   E2E_BASE=http://localhost:4181 node scripts/e2e/rankings-teams.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4181';
const REF = 'mvbxlebznlgroptwwdsm';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 400)}`); };

const OA = '00000000-0000-0000-0000-0000000000a1', OB = '00000000-0000-0000-0000-0000000000b1';
const SA = '00000000-0000-0000-0000-0000000005a1', SB = '00000000-0000-0000-0000-0000000005b1';
const orgs = [
  { id: OA, slug: 'alberta', name: 'Alberta League', kind: 'regional', country: 'CA', website: null, created_at: '2026-01-01T00:00:00Z', short_name: null, region: null, description: null, enabled: true, disabled_at: null },
  { id: OB, slug: 'empty', name: 'Zeta League', kind: 'regional', country: 'CA', website: null, created_at: '2026-01-02T00:00:00Z', short_name: null, region: null, description: null, enabled: true, disabled_at: null }
];
const seasons = [
  { id: SA, slug: 'a-2026', name: 'Alberta 2026', organization_id: OA, starts_on: '2026-01-01', ends_on: '2026-12-31' },
  { id: SB, slug: 'b-2026', name: 'Zeta 2026', organization_id: OB, starts_on: '2026-01-01', ends_on: '2026-12-31' }
];
const T = (n, name, category, gender, points, rank, scope, extra = {}) => ({ scope, organization_id: scope === 'career' ? null : OA, season_id: scope === 'season' ? SA : null, category, gender, team_id: `t${n}`, team_name: name, team_slug: `team-${n}`, competitions: 3, golds: 2, silvers: 1, bronzes: 0, points, rank, ...extra });
const teamRows = [];
for (const scope of ['season', 'org_career']) {
  teamRows.push(
    T(1, 'Red Deer Reavers', '5v5', 'men', 1240, 1, scope), T(2, 'Calgary Wolves', '5v5', 'men', 900, 2, scope),
    T(3, 'Edmonton Shield Maidens', '5v5', 'women', 640, 1, scope),
    T(4, 'Lynx Company', '3v3', 'open', 980, 1, scope), T(5, 'Banff Hawks', '3v3', 'open', 500, 2, scope),
    T(6, 'Big Melee Club', '12v12', 'open', 760, 1, scope));
}
teamRows.push(T(1, 'Red Deer Reavers', null, null, 2100, 1, 'org_all'), T(4, 'Lynx Company', null, null, 1500, 2, 'org_all'), T(1, 'Red Deer Reavers', null, null, 2100, 1, 'career'));
const F = (n, name, category, gender, points, rank) => ({ scope: 'season', organization_id: OA, season_id: SA, category, gender, fighter_id: `f${n}`, display_name: name, competitions: 2, golds: 1, silvers: 0, bronzes: 0, points, rank });
const fighterRows = [F(1, 'Aldric Stone', 'longsword', 'men', 300, 1), F(2, 'Bran Oak', 'sword_shield', 'men', 200, 1), F(3, 'Cal Reed', '5v5', 'men', 150, 1)];
const tables = { organizations: orgs, seasons, ranking_teams: teamRows, ranking_fighters: fighterRows, fighters: [], team_memberships: [] };

function matches(row, [k, v]) {
  if (['select', 'order', 'limit', 'offset'].includes(k)) return true;
  if (v === 'is.null') return row[k] === null || row[k] === undefined;
  if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
  if (v.startsWith('in.')) return v.slice(4, -1).split(',').includes(String(row[k]));
  return true;
}
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const calls = [];
async function open(viewport) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
  await ctx.route(`https://${REF}.supabase.co/**`, route => {
    const u = new URL(route.request().url());
    const table = u.pathname.replace('/rest/v1/', '');
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (!(table in tables)) return route.fulfill({ status: 200, headers, body: '[]' });
    calls.push(`${table}?${u.searchParams.toString()}`);
    return route.fulfill({ status: 200, headers, body: JSON.stringify(tables[table].filter(r => [...u.searchParams].every(p => matches(r, p)))) });
  });
  await ctx.route('https://maps.googleapis.com/**', r => r.abort('failed'));
  await ctx.route(/posthog\.com/, r => r.abort('failed'));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 200)));
  return { ctx, page };
}
const go = async (page, path) => { await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle'); await page.waitForTimeout(250); };
const text = async (page) => (await page.locator('main, #root').first().innerText()).replace(/\s+/g, ' ');
const categoryOptions = (page) => page.locator('select').filter({ has: page.locator('option', { hasText: /5v5/ }) }).first().locator('option').allInnerTexts();
// innerText follows CSS text-transform (the small labels are upper case), so the comparisons below ignore case.
const cards = (page) => page.locator('.topteam').allInnerTexts().then(a => a.map(t => t.replace(/\s+/g, ' ').toLowerCase()));
const SHOTS = process.env.E2E_SHOTS;

try {
  const { ctx, page } = await open({ width: 1280, height: 800 });
  // ---- Fighters
  await go(page, `/rankings?who=fighters&scope=season&org=${OA}&season=${SA}`);
  const fighterCats = await categoryOptions(page);
  check('Fighters: the category list still offers the duel categories', ['Longsword', 'Sword and shield', 'Polearm', '5v5'].every(c => fighterCats.includes(c)), fighterCats.join(','));
  check('Fighters: no "Top teams" overview', (await page.locator('.topteam').count()) === 0);
  await page.locator('select').filter({ has: page.locator('option', { hasText: /Sword and shield/ }) }).selectOption('sword_shield');
  await page.waitForTimeout(500);
  check('Fighters: choosing Sword and shield shows that ranking', (await text(page)).includes('Bran Oak'), await text(page));

  // ---- Teams, season scope
  await go(page, `/rankings?who=teams&scope=season&org=${OA}&season=${SA}&category=sword_shield&division=men`);
  const teamCats = await categoryOptions(page);
  check('Teams: only team categories are offered, in natural order', JSON.stringify(teamCats) === JSON.stringify(['3v3', '5v5', '12v12']), teamCats.join(','));
  check('Teams: Sword and shield / Longsword / Polearm are not offered', !teamCats.some(c => /sword|longsword|polearm|sabre/i.test(c)), teamCats.join(','));
  const ov = await cards(page);
  check('Teams: the overview shows the #1 team of each category and division', ov.length === 4
    && ov.some(t => /3v3/.test(t) && /lynx company/.test(t) && /980/.test(t))
    && ov.some(t => /5v5 · men/.test(t) && /red deer reavers/.test(t) && /1240/.test(t))
    && ov.some(t => /5v5 · women/.test(t) && /edmonton shield maidens/.test(t))
    && ov.some(t => /12v12/.test(t) && /big melee club/.test(t)), ov.join(' | '));
  check('Teams: a duel category left in the address falls back to the first team category (3v3), not an empty table', (await page.locator('select').filter({ has: page.locator('option', { hasText: /5v5/ }) }).first().inputValue()) === '3v3');
  check('Teams: 3v3 has one division, so no Men / Women / Open choice is forced on it', (await page.locator('[aria-label="Division"]').count()) === 0);
  let t = await text(page);
  check('Teams: the full 3v3 ranking shows rank, name, points and medals', (await page.locator('.rankcard').allInnerTexts()).map(x => x.replace(/\s+/g, ' ')).join(' | ') === '1 Lynx Company 3 competitions · 2 gold, 1 silver, 0 bronze 980 points | 2 Banff Hawks 3 competitions · 2 gold, 1 silver, 0 bronze 500 points', (await page.locator('.rankcard').allInnerTexts()).join(' | '));

  // tapping a leader opens that category's ranking
  await page.locator('.topteam', { hasText: /5v5 · Women/ }).click(); await page.waitForTimeout(500);
  t = await text(page);
  check('Tapping the 5v5 Women leader opens the 5v5 Women full ranking', (await page.locator('.rankcard').count()) === 1 && /Edmonton Shield Maidens/.test(await page.locator('.rankcard').innerText()) && page.url().includes('category=5v5') && page.url().includes('division=women'), page.url());
  check('... and marks that card as the one being shown', /women/i.test(await page.locator('.topteam[aria-current="true"]').innerText()));
  check('Teams: 5v5 has two divisions, so the division choice appears with only those two', JSON.stringify(await page.locator('[aria-label="Division"] button').allInnerTexts()) === JSON.stringify(['Men', 'Women']));
  await page.locator('[aria-label="Division"] button', { hasText: /^Men$/ }).click(); await page.waitForTimeout(500);
  check('Switching division shows the men\'s 5v5 table', (await page.locator('.rankcard').allInnerTexts()).map(x => x.split('\n')[1] ?? x).join('|').includes('Red Deer Reavers') && (await page.locator('.rankcard').count()) === 2);

  // ---- Teams, whole organization and all time
  await page.locator('[aria-label="Scope"] button', { hasText: 'Whole organization' }).click(); await page.waitForTimeout(500);
  check('Whole organization: the overview is still there (per category, from the organization career)', (await page.locator('.topteam').count()) === 4);
  check('Whole organization: the overall table shows', (await page.locator('.rankcard').count()) === 2 && /2100/.test(await page.locator('.rankcard').first().innerText()));
  await page.locator('.topteam', { hasText: /12v12/ }).click(); await page.waitForTimeout(500);
  check('Whole organization: tapping a leader opens that category in the organization career table', page.url().includes('scope=org_career') && page.url().includes('category=12v12') && (await page.locator('.rankcard').count()) === 1 && /Big Melee Club/.test(await page.locator('.rankcard').innerText()), page.url());
  await page.locator('[aria-label="Scope"] button', { hasText: 'All time' }).click(); await page.waitForTimeout(500);
  check('All time: no per-category overview exists, the single table shows', (await page.locator('.topteam').count()) === 0 && (await page.locator('.rankcard').count()) === 1);

  // ---- an organization without team results
  await go(page, `/rankings?who=teams&scope=season&org=${OB}&season=${SB}`);
  t = await text(page);
  check('An organization with no team results says so plainly, with no category choices', /no team rankings yet/i.test(t) && (await page.locator('select').filter({ has: page.locator('option', { hasText: /5v5/ }) }).count()) === 0 && (await page.locator('.topteam').count()) === 0, t.slice(0, 500));

  check('no page errors (desktop)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();

  // ---- phone
  const m = await open({ width: 390, height: 844 });
  await go(m.page, `/rankings?who=teams&scope=season&org=${OA}&season=${SA}`);
  const sw = await m.page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
  check('Phone 390px: no sideways scroll', sw[0] <= sw[1], JSON.stringify(sw));
  const box = await m.page.locator('.topteam').first().boundingBox();
  check('Phone 390px: leader cards are comfortable tap targets', box && box.height >= 80 && box.width >= 150, JSON.stringify(box));
  if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/rankings-teams-phone.png`, fullPage: true });
  check('no page errors (phone)', m.page.errors.length === 0, m.page.errors.join(' | '));
  await m.ctx.close();
} catch (e) { check('script ran to the end', false, e.stack ?? e); }
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
