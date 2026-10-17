// Drives the REAL built app in a REAL Chromium at phone size (390x844) against a small mocked Supabase and checks the past-medals screens:
// the fighter's own "Past medals" block (list, add, remove), the medals-only tournament's results page (notice, Add my medal, podium), and
// that a stranger sees no form. It proves how the screens behave; the database rules were checked directly on hosted (docs/claude-packs/PAST_MEDALS.md).
//   VITE_BASE=/ npx vite build --outDir /tmp/e2e-dist && npx vite preview --outDir /tmp/e2e-dist --port 4181 &
//   E2E_BASE=http://localhost:4181 E2E_SHOTS=/tmp/shots node scripts/e2e/past-medals.mjs
import { chromium } from 'playwright-core';
import { REF, sessionFor, storageKey } from './mock-rest.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4181';
const SHOTS = process.env.E2E_SHOTS;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 300)}`); };

const KESTON = '00000000-0000-0000-0000-00000000f001', KESTON_USER = '00000000-0000-0000-0000-0000000000b1', STRANGER_USER = '00000000-0000-0000-0000-0000000000b2';
const TEAM = { id: '00000000-0000-0000-0000-00000000d001', name: 'Red Deer Reavers', slug: 'red-deer-reavers' };
const EV = {
  cc: { id: '00000000-0000-0000-0000-00000000e001', slug: 'coulee-clash-2026', name: 'Coulee Clash 2026', starts_on: '2026-05-30', ends_on: '2026-05-31', city: 'Lethbridge', region: 'AB', time_note: null, venue: 'Servus Sports Centre' },
  kc: { id: '00000000-0000-0000-0000-00000000e002', slug: 'kings-cup-2025', name: 'Kings Cup 2025', starts_on: '2025-01-01', ends_on: '2025-01-01', city: null, region: null, time_note: 'Exact date to be confirmed', venue: null }
};
const CATS = [
  { code: '5v5', name: '5v5', league: 'buhurt', sort: 11 }, { code: 'longsword', name: 'Longsword', league: 'duels', sort: 22 }, { code: 'buckler', name: 'Sword & Buckler', league: 'duels', sort: 21 },
  { code: 'profight', name: 'Profight', league: 'outrance', sort: 30 }, { code: 'sabre', name: 'Sabre', league: 'hacsa', sort: 40 }, { code: 'axe', name: 'Axe (short / long)', league: 'hacsa', sort: 44 }
];
let seq = 0; const uid = (p) => `00000000-0000-0000-0000-${p}${String(++seq).padStart(11 - p.length, '0')}`;
const st = { comps: [], results: [], calls: [] };
const compFor = (ev, code) => {
  let k = st.comps.find(c => c.event_id === ev.id && c.category === code);
  if (!k) { const cat = CATS.find(c => c.code === code); k = { id: uid('c'), event_id: ev.id, name: cat.name, category: code, gender: 'open', division: 'open', ruleset: null, status: 'finished', sort: cat.sort, finalized_at: `${ev.ends_on}T06:00:00Z`, reopened_at: null, structure: 'elimination', ref_categories: { league: cat.league } }; st.comps.push(k); }
  return k;
};
const record = (ev, code, place) => { const k = compFor(ev, code); const r = { result_id: uid('a'), competition_id: k.id, event_id: ev.id, entry_id: uid('b'), fighter_id: KESTON, final_place: place, status: 'unverified', note: null, reported_at: '2026-10-17T00:00:00Z' }; st.results.push(r); return r; };
record(EV.cc, 'longsword', 1); record(EV.cc, 'sabre', 2); record(EV.kc, 'profight', 1);

const eventOf = (id) => Object.values(EV).find(e => e.id === id);
const eventRow = (e) => ({ ...e, description: 'Kept for its medals.', event_type: 'tournament', status: 'published', address: null, country: 'CA', latitude: null, longitude: null, timezone: 'America/Edmonton', fee_cents: 0, fee_province: null, fee_note: null, registration_opens_at: null, registration_closes_at: null, registration_mode: 'none', external_url: null, volunteer_info: null, organization_id: null, season_id: null, closed_at: null, reopened_at: null, archived_at: null, stats_excluded_at: null, stats_excluded_reason: null, field_count: 1, medals_only: true });
const careerRow = (r) => { const k = st.comps.find(c => c.id === r.competition_id); const e = eventOf(r.event_id); return { fighter_id: KESTON, competition_id: k.id, competition_name: k.name, category: k.category, category_name: k.name, gender: 'open', tier: null, structure: 'elimination', entry_id: r.entry_id, kind: 'individual', entry_status: 'registered', team_id: TEAM.id, team_name: TEAM.name, team_slug: TEAM.slug, final_place: r.final_place, points: 0, event_id: e.id, event_slug: e.slug, event_name: e.name, event_type: 'tournament', starts_on: e.starts_on, event_ends_on: e.ends_on, season_id: null, organization_id: null, synthetic: false, stats_excluded: false }; };
const podiumRow = (r) => ({ competition_id: r.competition_id, entry_id: r.entry_id, final_place: r.final_place, points: 0, entry_status: 'registered', kind: 'fighter', team_id: null, team_slug: null, team_name_at_event: null, team_current_name: null, fighter_id: KESTON, fighter_name: 'Keston Piche', represented_team_id: TEAM.id, represented_team_slug: TEAM.slug, represented_team_name_at_event: TEAM.name });
const eq = (url, k) => { const v = url.searchParams.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
const userFrom = (route) => { const a = route.request().headers()['authorization'] ?? ''; try { return JSON.parse(Buffer.from(a.split(' ')[1].split('.')[1], 'base64url').toString()).sub; } catch { return null; } };

async function handle(route) {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname; const who = userFrom(route);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (p.startsWith('/auth/v1/')) return json({ user: null });
  if (p.startsWith('/realtime/')) return route.abort('failed');
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.split('/').pop(); let a = {}; try { a = JSON.parse(req.postData() ?? '{}'); } catch { /* none */ }
    st.calls.push({ fn, who, a });
    if (fn === 'my_fighter_id') return json(who === KESTON_USER ? KESTON : null);
    if (fn === 'fighter_profile') return json([{ fighter_id: KESTON, display_name: 'Keston Piche', gender: null, birth_year: null, age: null, city: 'Red Deer', region: 'AB', country: 'CA', joined_year: null, disciplines: ['longsword', 'sabre'], fighting_style: null, bio: null, highlights: [], team_id: TEAM.id, team_name: TEAM.name, team_slug: TEAM.slug, team_organization_id: null, team_organization_slug: null, team_organization_name: null, team_organization_enabled: null, avatar_path: null }]);
    if (fn === 'fighter_claim_states') return json([{ fighter_id: KESTON, claimed: true }]);
    if (fn === 'fighter_career') { const golds = st.results.filter(r => r.final_place === 1).length, silvers = st.results.filter(r => r.final_place === 2).length, bronzes = st.results.filter(r => r.final_place === 3).length; return json(st.results.length ? [{ context: 'official', scope: 'career', season_id: null, organization_id: null, kind: null, category: null, category_name: null, gender: null, events: new Set(st.results.map(r => r.event_id)).size, competitions: st.results.length, matches: 0, wins: 0, losses: 0, draws: 0, win_pct: null, golds, silvers, bronzes, podiums: st.results.length, points: 0, best_place: 1, first_on: '2025-01-01', last_on: '2026-05-31' }] : []); }
    if (fn === 'add_past_medal') {
      if (who !== KESTON_USER) return json({ code: '42501', message: 'you can add medals to your own profile only' }, 403);
      const ev = eventOf(a.p_event); if (!ev) return json({ code: 'P0002', message: 'tournament not found' }, 404);
      const k = compFor(ev, a.p_category); const had = st.results.find(r => r.competition_id === k.id);
      if (had && had.final_place === a.p_place) return json({ status: 'already_recorded', competition_id: k.id, entry_id: had.entry_id, result_id: had.result_id });
      if (had) return json({ code: '23505', message: 'a different placing is already recorded for this discipline at this tournament; withdraw it first, or ask the owner to correct it' }, 409);
      const r = record(ev, a.p_category, a.p_place); r.note = a.p_note ?? null;
      return json({ status: 'recorded', competition_id: k.id, entry_id: r.entry_id, result_id: r.result_id });
    }
    if (fn === 'withdraw_past_medal') {
      const i = st.results.findIndex(r => r.result_id === a.p_result);
      if (i < 0) return json({ code: 'P0002', message: 'that medal is not recorded' }, 404);
      if (who !== KESTON_USER) return json({ code: '42501', message: 'you can withdraw your own reported medals only' }, 403);
      st.results.splice(i, 1); return json({ status: 'withdrawn' });
    }
    return json(null);
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.split('/')[3];
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] ?? '');
    const out = (rows) => json(single ? (rows[0] ?? null) : rows, single && !rows.length ? 406 : 200);
    if (table === 'events') {
      if (eq(url, 'medals_only') === 'true') return out(Object.values(EV).map(eventRow));
      const slug = eq(url, 'slug'); if (slug) return out(Object.values(EV).filter(e => e.slug === slug).map(eventRow));
      return out(Object.values(EV).map(e => ({ ...eventRow(e), competitions: [] })));
    }
    if (table === 'competitions') { const ev = eq(url, 'event_id'); return out(st.comps.filter(c => !ev || c.event_id === ev)); }
    if (table === 'competition_results') { const list = (url.searchParams.get('competition_id') ?? '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean); return out(st.results.filter(r => list.includes(r.competition_id)).map(podiumRow)); }
    if (table === 'ref_categories') return out(CATS);
    if (table === 'past_medal_records') return out(st.results.filter(r => r.fighter_id === (eq(url, 'fighter_id') ?? KESTON)));
    if (table === 'career_results_all') return out(st.results.map(careerRow));
    if (table === 'fighters') return out([{ id: KESTON, social_links: {}, inactive_at: null, inactive_reason: null }]);
    return out([]);
  }
  return route.abort('failed');
}

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
await ctx.route(`https://${REF}.supabase.co/**`, handle);
await ctx.route('https://maps.googleapis.com/**', r => r.abort('failed'));
await ctx.route(/posthog\.com/, r => r.abort('failed'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
page.on('dialog', d => d.accept());
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const has = async (text) => (await body()).toLowerCase().includes(text.toLowerCase());
const signIn = async (id, email) => { await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, sessionFor(id, email)]); };
const noSideways = async (label) => { const sw = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]); check(`${label}: no sideways scroll at 390px`, sw[0] <= sw[1], JSON.stringify(sw)); };
const go = async (path) => { await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

try {
  // ---- 1. the fighter's own page lists the past medals and offers the form
  await go('/');
  await signIn(KESTON_USER, 'keston@example.test');
  await go(`/fighters/${KESTON}`);
  const block = page.getByTestId('past-medals');
  await block.waitFor({ timeout: 15000 });
  await sleep(500);
  const text = async () => (await block.innerText()).replace(/\s+/g, ' ');
  check('1. own page shows the Past medals block', /Past medals/i.test(await text()));
  check('1b. lists Coulee Clash 2026 with the gold and the silver, newest tournament first', /Coulee Clash 2026.*Gold.*Longsword.*Silver.*Sabre.*Kings Cup 2025.*Gold.*Profight/.test(await text()), await text());
  check('1c. each medal says it is reported, not verified', ((await text()).match(/reported by the fighter · not verified/gi) ?? []).length === 3, await text());
  check('1d. a placeholder date is said to be one', /Jan 1, 2025 \(exact date to be confirmed\)/.test(await text()), await text());
  check('1e. the career line counts the medals', /2 gold · 1 silver/.test(await body()), (await body()).slice(0, 400));
  await noSideways('1f. own page');
  await shot('pm-01-own-page');

  // ---- 2. add a medal
  await page.getByTestId('past-medal-add').click();
  const send = page.getByTestId('past-medal-send');
  check('2. the form opens with Add medal disabled until the choices are made', await send.isDisabled());
  await page.getByTestId('past-medal-event').selectOption(EV.cc.id);
  await page.getByTestId('past-medal-discipline').selectOption('buckler');
  check('2b. team disciplines are not offered', !(await page.getByTestId('past-medal-discipline').innerText()).includes('5v5'));
  await page.getByTestId('past-medal-place-3').click();
  await page.getByTestId('past-medal-note').fill('open division');
  check('2c. Add medal becomes possible', await send.isEnabled());
  await shot('pm-02-form');
  await send.click();
  await page.getByTestId('past-medal-done').waitFor({ timeout: 10000 });
  check('2d. says what was added', /Bronze in Sword & Buckler at Coulee Clash 2026 added/.test(await text()), await text());
  const call = st.calls.find(c => c.fn === 'add_past_medal');
  check('2e. asked the database for that medal (event, discipline, place, note)', call && call.a.p_event === EV.cc.id && call.a.p_category === 'buckler' && call.a.p_place === 3 && call.a.p_note === 'open division', JSON.stringify(call?.a));
  await sleep(600);
  check('2f. the list shows the new bronze and the career line moved to 1 bronze', /Bronze.*Sword & Buckler/.test(await text()) && /2 gold · 1 silver · 1 bronze/.test(await body()), await body().then(b => b.slice(0, 500)));
  await shot('pm-03-added');

  // ---- 3. the same medal again, and a different place in a taken discipline
  await page.getByTestId('past-medal-discipline').selectOption('buckler');
  await page.getByTestId('past-medal-place-3').click();
  await send.click();
  await sleep(600);
  check('3. the same medal again is not added twice', /already on your profile/.test(await text()) && st.results.filter(r => r.final_place === 3).length === 1, await text());
  await page.getByTestId('past-medal-discipline').selectOption('buckler');
  await page.getByTestId('past-medal-place-1').click();
  check('3b. a different place in a taken discipline is stopped before sending', await send.isDisabled() && /already have Bronze in Sword & Buckler/.test(await send.getAttribute('title') ?? ''), await send.getAttribute('title'));

  // ---- 4. remove
  const before = st.results.length;
  await block.getByRole('button', { name: /Remove Silver in Sabre/ }).click();
  await sleep(800);
  check('4. Remove takes the report back through the database', st.results.length === before - 1 && st.calls.some(c => c.fn === 'withdraw_past_medal'), `${before} -> ${st.results.length}`);
  const listed = async () => (await block.locator('ul').allInnerTexts()).join(' ').replace(/\s+/g, ' ');
  check('4b. the list no longer shows the sabre silver', !/Sabre/.test(await listed()) && /Longsword/.test(await listed()), await listed());
  await shot('pm-04-removed');

  // ---- 5. the tournament's results page
  await go(`/events/${EV.cc.slug}/results`);
  await page.getByTestId('event-medals-only').waitFor({ timeout: 15000 });
  await sleep(500);
  check('5. the results page says it is a past tournament, medals only, reported by the fighters', await has('Medals only') && await has('not verified'));
  check('5b. a signed-in fighter gets Add my medal to their own profile', (await page.getByRole('link', { name: 'Add my medal' }).getAttribute('href')) === `/fighters/${KESTON}#past-medals`);
  check('5c. the podium names Keston with gold in Longsword, no event record tabs', await has('Keston Piche') && await has('Longsword') && !(await has('Attendance')), (await body()).slice(0, 600));
  check('5d. no "Official results" closed-event notice, and the podiums are not called official', !(await page.getByTestId('event-closed').count()) && !/official/i.test(await body()) && await has('Reported by the fighters'), (await body()).slice(0, 700));
  await noSideways('5e. results page');
  await shot('pm-05-event-results');

  // ---- 6. the placeholder-dated tournament says so on its page
  await go(`/events/${EV.kc.slug}/results`);
  await page.getByTestId('event-medals-only').waitFor({ timeout: 15000 });
  check('6. Kings Cup says its date is to be confirmed', await has('Exact date to be confirmed'));

  // ---- 7. a stranger sees Keston's page without the form; signed out sees Sign in on the tournament
  await signIn(STRANGER_USER, 'someone@example.test');
  await go(`/fighters/${KESTON}`);
  await page.locator('h1').waitFor();
  await sleep(800);
  check('7. another signed-in person sees no Past medals form on Keston\'s page', (await page.getByTestId('past-medals').count()) === 0 && await has('Keston Piche'));
  await page.evaluate((k) => localStorage.removeItem(k), storageKey);
  await go(`/events/${EV.cc.slug}/results`);
  await page.getByTestId('event-medals-only').waitFor({ timeout: 15000 });
  check('7b. signed out, the tournament offers Sign in to add your medal', (await page.getByRole('link', { name: 'Sign in to add your medal' }).count()) === 1);
  check('8. no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('run completed', false, e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  await browser.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
