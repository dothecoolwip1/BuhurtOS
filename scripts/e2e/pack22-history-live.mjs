// Pack 22 HISTORICAL editions (earlier versions from Buhurt International's archive) against a REAL local stack: Postgres built from every
// migration (current release + history) + the discipline fixture, PostgREST, the real built app in real Chromium. Phone 390x844 first.
// It proves the current rules stay the default everywhere, and earlier editions are reachable only on purpose and always labelled. LOCAL EVIDENCE ONLY.
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
const U = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const WHO = {
  owner: [U('a1'), 'u1@example.test'], organizer: [U('a2'), 'u2@example.test'], secretary: [U('a4'), 'u4@example.test'], stranger: [U('a7'), 'u7@example.test'],
  knight: [U('c1'), 'c1@example.test'], desk: [U('d1'), 'd1@example.test'], inspector: [U('d2'), 'd2@example.test'], captain: [U('d3'), 'd3@example.test'],
  aldric: ['00000000-0000-0000-0000-000000000101', 'fighter1@example.test'], brann: ['00000000-0000-0000-0000-000000000102', 'fighter2@example.test'],
  orgA: [U('e1'), 'e1@example.test'], orgB: [U('e2'), 'e2@example.test']
};
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
// REAL_AUTH: each role signs in through the real Supabase Auth server (password grant) and the browser keeps the session Auth issued.
const REAL = !!process.env.AUTH_URL;
const realSessions = new Map();
if (REAL) {
  for (const [who, [, email]] of Object.entries(WHO)) {
    const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x' }, body: JSON.stringify({ email, password: 'Fixture-pass-22' }) });
    const b = await r.json().catch(() => ({}));
    if (r.status !== 200 || !b.access_token) { console.error(`REAL_AUTH sign-in failed for ${who}: ${r.status} ${JSON.stringify(b).slice(0, 200)}`); process.exit(2); }
    realSessions.set(who, b);
  }
}
const sessionOf = (who) => (REAL ? realSessions.get(who) : session(WHO[who]));
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const SLUG = 'test-stuff-test';
async function rest(who, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', ...(who ? { authorization: `Bearer ${sessionOf(who).access_token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args) => rest(who, 'POST', `rpc/${fn}`, args);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { desktop: { viewport: { width: 1280, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };
const pageErrors = [];
async function open(kind, who) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, sessionOf(who)]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|net::ERR|Failed to fetch|403|42501|\[BuhurtOS\]/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  pageErrors.push(page.errors);
  return { ctx, page };
}
const body = async (page) => (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ');
const has = async (page, text) => (await body(page)).toLowerCase().includes(text.toLowerCase());
const shot = async (page, name, full = false) => { if (SHOTS) { await sleep(350); await page.screenshot({ path: `${SHOTS}/p22d-${name}.png`, fullPage: full }).catch(() => undefined); } };
const waitFor = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const waitText = (page, text, timeout = 15000) => waitFor(page, (t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text, timeout);
const waitDb = async (fn, want, timeout = 10000) => { const t0 = Date.now(); let v = fn(); while (v !== want && Date.now() - t0 < timeout) { await sleep(250); v = fn(); } return v; };
const sideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
const prov = (doc, number) => sql(`select p.id from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id join public.rulesets r on r.id = v.ruleset_id where r.inventory_key = '${doc}' and v.status = 'published' and p.number = '${number}' and p.kind <> 'appendix'`);
const sheet = (page) => page.locator('.dlg[role="dialog"]').last();
async function pickPerson(page, name) {
  const s = sheet(page);
  await s.getByRole('searchbox', { name: /Find the (fighter|team)/ }).fill(name.split(' ')[0]);
  await s.locator('.rl-pickrow', { hasText: name }).first().click();
}

const docSlug = (key) => sql(`select slug from public.rulesets where governing_body = 'Buhurt International' and inventory_key = '${key}'`);
const verId = (key, label) => sql(`select v.id from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.inventory_key = '${key}' and v.version = '${label}'`);
const provId = (key, label, num) => sql(`select p.id from public.rule_provisions p where p.ruleset_version_id = '${verId(key, label)}' and p.number = '${num}' order by p.ordinal limit 1`);
const officialRows = (page) => page.locator('#rl-official ~ .rl-list .rl-row');

try {
  check('fixture: current release (42) and history (37 earlier editions, in review) are both in the database; 11 current versions published',
    sql(`select count(*) filter (where not historical) || '/' || count(*) filter (where historical and status = 'in_review') || '/' || count(*) filter (where status = 'published') from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.governing_body = 'Buhurt International'`) === '42/37/11');
  const fp0 = sql(`select md5(string_agg(r.inventory_key || '=' || v.version || '=' || v.content_sha256 || '=' || v.status, ',' order by r.inventory_key)) from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.governing_body = 'Buhurt International' and not v.historical`);

  // ================================================================ 1. anyone: the current rules are the default; history in review is invisible
  const { page: an } = await open('phone');
  await an.goto(BASE + '/rules?q=combatant');
  await an.waitForSelector('.rl-head', { timeout: 30000 }); await sleep(1500);
  check('H1. anon: a word only earlier editions use ("combatant") finds no official rule by default', (await officialRows(an).count()) === 0, await body(an));
  check('H2. anon: nothing in review leaks (no "Include older versions and earlier editions" while no earlier edition is published)', !(await has(an, 'earlier editions')));
  await an.goto(BASE + `/rules/doc/${docSlug('tournament/duel-regulations')}`);
  await waitText(an, 'Duel', 30000); await sleep(800);
  check('H3. anon: Duel Regulations opens on the version in force (26.4) and shows no earlier edition', (await has(an, '26.4 · In force')) && !(await has(an, 'Earlier edition')));

  // ================================================================ 2. the owner (sees editions in review): history only on purpose, always labelled
  const { ctx: ownCtx, page: own } = await open('phone', 'owner');
  await own.goto(BASE + '/rules?q=combatant');
  await own.waitForSelector('.rl-head', { timeout: 30000 }); await sleep(1500);
  check('H4. owner: by default, search still shows current text only (no earlier edition among the official results)', (await officialRows(own).count()) === 0, await body(own));
  const toggle = own.getByLabel('Include older versions and earlier editions');
  check('H5. owner: the explicit choice is offered: "Include older versions and earlier editions"', (await toggle.count()) === 1);
  await toggle.check(); await sleep(800);
  const histRows = await officialRows(own).allInnerTexts();
  check('H6. with it, earlier editions are found, and every one of those results says "Earlier edition"', histRows.length >= 3 && histRows.every(t => /Earlier edition/i.test(t)) && histRows.some(t => /Duel Regulations · 2024\.12/i.test(t)), histRows.join(' || '));
  await shot(own, 'h01-search-history');
  check('H7. no sideways scroll with earlier editions in the results', (await sideways(own)) <= 0);

  await own.goto(BASE + `/rules/doc/${docSlug('tournament/duel-regulations')}`);
  await waitText(own, 'Earlier editions', 30000);
  check('H8. the document opens on the version in force; earlier editions are listed apart, newest first (26.1, 2025.03, 2024.12)',
    /26\.4 · In force/i.test(await own.locator('.rl-vbtn[aria-pressed="true"]').innerText())
    && (await own.locator('[role="group"][aria-label^="Earlier editions"] .rl-vbtn').allInnerTexts()).map(t => t.split(' · ')[0]).join(',') === '26.1,2025.03,2024.12');
  await own.locator('[role="group"][aria-label^="Earlier editions"] .rl-vbtn', { hasText: '2024.12' }).click();
  await waitText(own, 'not the rules in force');
  check('H9. opening an earlier edition says plainly it is not the rules in force, with a way back to the current version',
    (await has(own, 'Earlier edition 2024.12: not the rules in force')) && (await own.getByRole('button', { name: /Open the current version \(26\.4\)/ }).count()) === 1);
  await own.getByText('How BuhurtOS knows this edition').click();
  check('H10. its provenance: why it is this edition, and both archive file names of the byte-identical pair, imported once',
    (await has(own, 'Duels Regulations V2024.12.pdf')) && (await has(own, 'Duels Regulations V2024.12(1).pdf')) && (await has(own, 'same edition (identical files), imported once')) && (await has(own, 'VER. 2024.12')));
  check('H11. its contents flag what still needs checking against the archived page', (await own.locator('.rl-toc .chip', { hasText: 'Check' }).count()) >= 1);
  await shot(own, 'h02-earlier-edition', true);
  check('H12. no sideways scroll on the earlier edition', (await sideways(own)) <= 0);

  // a rule in an earlier edition: labelled, linked to the current wording, comparable
  await own.goto(BASE + `/rules/r/${provId('tournament/duel-regulations', '2024.12', '5.2')}`);
  await own.waitForSelector('.rl-rhead', { timeout: 20000 });
  check('H13. a rule from an earlier edition says it is not the rule in force and links to the current wording (26.4 5.2)',
    (await has(own, 'Earlier edition (2024.12): not the rule in force')) && (await own.getByRole('link', { name: 'open 5.2' }).count()) === 1);
  await own.getByLabel('Compare with').selectOption({ index: 1 });
  await own.waitForSelector('.rl-diff', { timeout: 10000 });
  check('H14. comparing with the current version shows what changed, oldest to newest, as reading help only',
    (await has(own, 'From 2024.12')) && (await has(own, 'to 26.4')) && ((await own.locator('.rl-diff ins, .rl-diff del').count()) > 0 || (await has(own, 'The wording is the same'))) && (await has(own, 'the version in force is the one that applies')));
  await shot(own, 'h03-compare', true);
  check('H15. no sideways scroll on the comparison', (await sideways(own)) <= 0);

  // the same phone after the owner signs out: the library saved for the owner (with versions in review) is never shown to the next person
  const saved = await ownCtx.storageState();
  check('H15b. the owner\'s phone saved the library, stamped with the owner\'s account', saved.origins.some(o => o.localStorage.some(x => x.name === 'bos-rules-cache-v3' && JSON.parse(x.value).viewer === WHO.owner[0])));
  saved.origins = saved.origins.map(o => ({ ...o, localStorage: o.localStorage.filter(x => x.name !== STORAGE_KEY) }));
  const nextCtx = await browser.newContext({ ...VIEW.phone, serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton', storageState: saved });
  const nx = await nextCtx.newPage(); nx.errors = []; nx.on('pageerror', e => nx.errors.push(String(e).slice(0, 300))); pageErrors.push(nx.errors);
  await nx.goto(BASE + '/rules?q=combatant&old=1');
  await nx.waitForSelector('.rl-head', { timeout: 30000 }); await sleep(2500);
  check('H15c. signed out on that phone: no edition in review shows up, even with "older versions" asked for in the address (the saved copy is read again for the visitor)',
    (await officialRows(nx).count()) === 0 && !(await has(nx, 'Earlier edition')) && !(await has(nx, 'in review')), await body(nx));
  await nx.goto(BASE + `/rules/doc/${docSlug('tournament/duel-regulations')}`);
  await waitText(nx, 'Duel', 30000); await sleep(1000);
  check('H15d. … and its documents show no earlier edition in review', !(await has(nx, 'Earlier edition')) && (await has(nx, '26.4 · In force')));
  await nextCtx.close();

  // ================================================================ 3. the platform rules desk keeps current and history apart
  const { page: desk } = await open('desktop', 'owner');
  await desk.goto(BASE + '/platform/rules');
  await waitText(desk, 'Earlier editions (historical)', 30000);
  await waitFor(desk, () => document.querySelector('#pr-pub .mono')?.textContent?.trim() === '31' && document.querySelector('#pr-hist .mono')?.textContent?.trim() === '37', null, 20000);
  check('H16. the desk lists the 31 current versions still waiting and, apart, the 37 earlier editions',
    (await desk.locator('#pr-pub .mono').innerText()).trim() === '31' && (await desk.locator('#pr-hist .mono').innerText()).trim() === '37');
  check('H17. "Publish all ready" never includes an earlier edition', !(await desk.locator('#pr-pub ~ .dd-list, section[aria-labelledby="pr-pub"]').innerText()).includes('earlier edition'));
  const row = desk.locator('section[aria-labelledby="pr-hist"] li', { hasText: 'Buhurt Regulations' }).filter({ hasText: 'earlier edition 26.1' });
  await row.getByRole('button', { name: 'Publish as earlier edition' }).click();
  check('H18. publishing an earlier edition asks first, and says the version in force does not change', await waitText(desk, 'The version in force does not change'));
  await desk.getByRole('button', { name: 'Yes, publish as earlier edition' }).click();
  check('H19. it is published AS HISTORICAL (an older version), and Buhurt Regulations 26.4 is still the version in force',
    await waitDb(() => sql(`select status from public.ruleset_versions where id = '${verId('tournament/buhurt-regulations', '26.1')}'`), 'superseded') === 'superseded'
    && sql(`select string_agg(version, ',') from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.inventory_key = 'tournament/buhurt-regulations' and status = 'published'`) === '26.4');
  await shot(desk, 'h04-desk');
  const direct = await rpc('owner', 'publish_ruleset_version', { p_version: verId('marshal/buhurt-rules', '2026.1.1'), p_note: 'trying the current path' });
  check('H20. a direct call to make a reviewed earlier edition (Buhurt Rules 2026.1.1, nothing open) the version in force is refused by the database', direct.status >= 400 && /historical edition is never the version in force/.test(JSON.stringify(direct.body)), JSON.stringify(direct));

  // ================================================================ 4. after publishing: anyone sees it as an earlier edition, never as current
  // a new visitor (a browser that has not saved the library a minute ago: saved copies refresh at most once a minute)
  const { page: an2 } = await open('phone');
  await an2.goto(BASE + '/rules?q=lasting');
  await an2.waitForSelector('.rl-head', { timeout: 30000 }); await sleep(1500);
  check('H21. anon: default search still does not return the published earlier edition ("lasting", which only Buhurt Regulations 26.1 uses)', (await officialRows(an2).count()) === 0, await body(an2));
  await an2.getByLabel('Include older versions and earlier editions').check(); await sleep(800);
  const anRows = await officialRows(an2).allInnerTexts();
  check('H22. anon: with the explicit choice it is found, labelled "Earlier edition"', anRows.length >= 1 && anRows.every(t => /Buhurt Regulations · 26\.1 · Earlier edition/i.test(t)), anRows.join(' || '));
  await an2.goto(BASE + `/rules/doc/${docSlug('tournament/buhurt-regulations')}`);
  await waitText(an2, 'Earlier editions', 30000);
  check('H23. anon: the document still opens on 26.4 in force; the earlier editions list shows only the published one (26.1)',
    /26\.4 · In force/i.test(await an2.locator('.rl-vbtn[aria-pressed="true"]').innerText())
    && (await an2.locator('[role="group"][aria-label^="Earlier editions"] .rl-vbtn').allInnerTexts()).map(t => t.split(' · ')[0]).join(',') === '26.1');
  await shot(an2, 'h05-anon-doc', true);

  // ================================================================ 5. the current rules did not change
  check('H24. the current release in the database is exactly as before (labels, texts, statuses)',
    sql(`select md5(string_agg(r.inventory_key || '=' || v.version || '=' || v.content_sha256 || '=' || v.status, ',' order by r.inventory_key)) from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.governing_body = 'Buhurt International' and not v.historical`) === fp0);
  // the rules an official can cite in a fight are the versions in force only
  const { page: km } = await open('phone', 'knight');
  await km.goto(BASE + `/events/${SLUG}/discipline?tab=sanctions`);
  await waitText(km, 'Give a sanction', 30000);
  await km.getByRole('button', { name: 'Give a sanction' }).click();
  await sheet(km).getByRole('button', { name: 'Add the rule (optional)' }).click();
  await sheet(km).getByLabel('Find the rule').fill('lasting'); await sleep(700);
  check('H25. the officials\' rule picker does not offer the earlier edition (versions in force only): "lasting" finds nothing',
    await waitText(km, 'No rule matches “lasting”'), await sheet(km).innerText().catch(() => ''));
  await sheet(km).getByLabel('Find the rule').fill('appeal'); await sleep(700);
  check('H25b. … while a current rule is still found there', (await sheet(km).locator('.rl-pickrow').count()) >= 1);

  const errs = pageErrors.flat();
  check('H26. no page errors in any browser', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('the run finished without crashing', false, e?.stack ?? String(e));
} finally {
  await browser.close();
}
const passed = results.filter(r => r.ok).length;
console.log(`\nPACK22 HISTORY LIVE: ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
