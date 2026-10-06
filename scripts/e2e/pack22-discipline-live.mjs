// Pack 22 (official Buhurt International text, discipline desk, suspensions, eligibility) against a REAL local stack: Postgres built from every
// migration (the BI release included) + the fixture, PostgREST, the real built app in real Chromium. Phone 390x844 first; desktop where it matters.
// Every role signs in as itself (a signed JWT for that account); the database decides what each may see and do. LOCAL EVIDENCE ONLY.
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

try {
  if (REAL) check('REAL_AUTH: every role signed in through the real Supabase Auth server (password grant), sessions issued by Auth', realSessions.size === Object.keys(WHO).length && [...realSessions.values()].every(b => b.user?.aud === 'authenticated'));
  check('fixture: the BI release is in the database (42 documents), 11 published for this run, and one yellow card against Brann carries its concept',
    sql(`select count(*) from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.governing_body = 'Buhurt International'`) === '42'
    && sql(`select count(*) from public.ruleset_versions where status = 'published'`) === '11'
    && sql(`select card_key from public.match_discipline where id = '00000000-0000-0000-0000-00000000dd01'`) === 'yellow_card');

  // ================================================================ 1. the official text on a phone (anyone): search, tables, pictures, OCR
  const { page: ph } = await open('phone', null);
  await ph.goto(BASE + '/rules');
  await ph.waitForSelector('.rl-search', { timeout: 30000 });
  await waitFor(ph, () => !document.body.innerText.includes('Loading the rules'), null, 20000);
  check('1. /rules on a phone offers quick questions once the official text is in', (await ph.locator('.rl-qchip').count()) >= 6, await body(ph));
  const first = async (q) => {
    await ph.getByRole('searchbox', { name: 'Search rules' }).fill(q);
    await waitFor(ph, (w) => new URL(location.href).searchParams.get('q') === w, q, 5000); await sleep(200);
    const row = ph.locator('#rl-official ~ .rl-list .rl-row').first();
    return [(await row.locator('.rl-num').innerText().catch(() => '')).trim(), (await row.locator('.rl-doc').innerText().catch(() => '')).trim(), (await row.locator('.rl-title').innerText().catch(() => '')).trim()];
  };
  let r = await first('striking grounded fighter');
  const top3 = (await ph.locator('#rl-official ~ .rl-list .rl-row').evaluateAll(rows => rows.slice(0, 3).map(x => x.innerText.replace(/\s+/g, ' ')))).join(' || ');
  check('2. "striking grounded fighter" opens with a rule on striking grounded competitors, and Buhurt Rules 4.12 is in the first three', /grounded/i.test(r[2]) && /4\.12 BUHURT RULES/i.test(top3), top3);
  r = await first('back of knee');
  check('3. "back of knee" finds the back of the knee rule first', /back of (the )?knee/i.test(r[2]), r.join(' | '));
  r = await first('green card');
  check('4. "green card" finds the authenticity warning (green card)', /green card/i.test(r[2]), r.join(' | '));
  r = await first('marshal accreditation');
  check('5. "marshal accreditation" finds the Marshal Accreditation document', /Accreditation/i.test(r[1]), r.join(' | '));
  check('6. a change log is never offered as a rule', !(await ph.locator('#rl-official ~ .rl-list .rl-title', { hasText: /change ?log/i }).count()));
  await shot(ph, '01-search-accreditation');
  check('7. no sideways scroll on search', (await sideways(ph)) <= 0);

  await ph.goto(BASE + `/rules/r/${prov('tournament/duel-regulations', '3.2')}`);
  await ph.waitForSelector('.rl-rhead', { timeout: 20000 });
  const cells = await ph.locator('.rl-table th, .rl-table td').count();
  const spans = await ph.locator('.rl-table td[rowspan="3"], .rl-table td[rowspan="4"]').count();
  check('8. Duel Regulations 3.2 shows its table as a table, with the merged cells merged', cells === 21 && spans >= 1 && (await ph.locator('.rl-table thead th').count()) === 5, `${cells} cells, ${spans} merged`);  // 5 x 6 grid, 9 positions merged into the cells above
  check('9. a wide table scrolls inside its box, never the page', (await sideways(ph)) <= 0 && await ph.locator('.rl-tablewrap').evaluate(e => getComputedStyle(e).overflowX === 'auto'));
  await shot(ph, '02-table-phone', true);
  await ph.goto(BASE + `/rules/r/${prov('tournament/duel-regulations', '3.2')}`.replace(/r\/.*/, `doc/${sql(`select slug from public.rulesets where inventory_key = 'marshal/weapon-shield-chart'`)}`));
  await ph.waitForSelector('.rl-toc', { timeout: 20000 });
  check('10. the weapon chart is listed by its printed headings (no invented numbers)', (await has(ph, 'Bladed Weapons (Sword, Saber, Falchion, etc)')) && (await has(ph, 'Hafted Weapons')) && (await has(ph, 'Round Shields and Bucklers')));
  await ph.locator('.rl-toc a', { hasText: 'Bladed Weapons' }).first().click();
  await ph.waitForSelector('.rl-table', { timeout: 15000 });
  check('11. its weights and lengths are a real table (Type 2 Bladed: 1.7 - 2.3 kg, 100 - 140 cm)', (await ph.locator('.rl-table tr', { hasText: 'Type 2 Bladed (Longsword)' }).innerText()).includes('1.7 - 2.3'));
  const falchionPage = sql(`select p.id from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id join public.rulesets r on r.id = v.ruleset_id where r.inventory_key = 'authenticity/falchions' and p.stable_key = 'falchions:page-4'`);
  await ph.goto(BASE + `/rules/r/${falchionPage}`);
  await ph.waitForSelector('.rl-rhead', { timeout: 20000 });
  check('12. a picture-only page says so and adds no words of its own', (await has(ph, 'Pictures only.')) && (await ph.locator('.rl-body').count()) === 0);
  const ocrPic = sql(`select p.id from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id join public.rulesets r on r.id = v.ruleset_id where r.inventory_key = 'authenticity/tabards' and p.extraction = 'ocr' and p.has_figures and p.body <> '' and p.number is not null order by p.ordinal limit 1`);
  await ph.goto(BASE + `/rules/r/${ocrPic}`);
  await ph.waitForSelector('.rl-rhead', { timeout: 20000 });
  check('13. text read from an image of the page says so (OCR, checked against the page)', await has(ph, 'An image of the page'));
  check('14. a page with pictures says the pictures are not reproduced', await has(ph, 'also has pictures') || await has(ph, 'also have pictures'));
  await shot(ph, '03-ocr-rule', true);
  const tierRule = sql(`select p.id from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id join public.rulesets r on r.id = v.ruleset_id where r.inventory_key = 'tournament/league-structure' and p.stable_key = 'league-structure:3.3.2'`);
  await ph.goto(BASE + `/rules/r/${tierRule}`);
  await ph.waitForSelector('.rl-rhead', { timeout: 20000 });
  check('14b. a disagreement between official documents is shown on the rule, open and undecided (League Structure 3.3.2 vs 2.3.4/2.3.5 and Tournament Structure 4.2)',
    (await has(ph, 'Recorded conflict')) && (await has(ph, 'Points given 150 %')) && (await has(ph, 'BuhurtOS has not decided which applies')) && (await ph.locator('#rl-conf ~ .rl-banner').count()) === 2,
    await ph.locator('main').innerText().catch(() => ''));

  // ================================================================ 2. the owner publishes from the platform rules desk (desktop)
  const { page: own } = await open('desktop', 'owner');
  await own.goto(BASE + '/platform/rules');
  await waitText(own, 'Waiting to be published', 30000);
  await waitFor(own, () => document.querySelectorAll('.dd-list li').length > 10, null, 30000);
  check('15. the owner sees the 31 versions still in review, each with its reconciliation', (await own.locator('#pr-pub .mono').innerText()).trim() === '31' && await has(own, 'of the text accounted for'), (await own.locator('#pr-pub').innerText()));
  const gauntlets = own.locator('.dd-list li', { hasText: 'Gauntlets' });
  await gauntlets.getByRole('button', { name: 'Publish' }).click();
  await own.getByRole('button', { name: 'Yes, publish' }).click();
  check('16. publishing asks first, then Gauntlets 26.1 is in force', await waitDb(() => sql(`select v.status from public.ruleset_versions v join public.rulesets r on r.id = v.ruleset_id where r.inventory_key = 'authenticity/gauntlets'`), 'published') === 'published' && await waitText(own, 'Published 1 version'));
  await shot(own, '04-platform-rules');
  const { page: anonDesk } = await open('phone', null);
  await anonDesk.goto(BASE + '/platform/rules');
  await sleep(1500);
  check('17. the platform rules desk is not for anyone else', !(await has(anonDesk, 'Waiting to be published')));

  // ================================================================ 3. the Knight Marshal on a phone: a sanction outside a fight
  const { page: km } = await open('phone', 'knight');
  await km.goto(BASE + `/events/${SLUG}/discipline?tab=sanctions`);
  await waitText(km, 'Sanctions outside a fight', 30000);
  await km.getByRole('button', { name: 'Give a sanction' }).click();
  await pickPerson(km, 'Aldric Stone');
  await sheet(km).getByLabel(/^Card/).selectOption('yellow_card');
  await sheet(km).locator('textarea').fill('Ignored the stop command at the list gate');
  await sheet(km).getByRole('button', { name: 'Record it' }).click();
  check('18. a dangerous action asks twice: the first press shows what will happen', await waitText(km, 'Check before you confirm'));
  await shot(km, '05-sanction-confirm');
  await sheet(km).getByRole('button', { name: /^Yes, record it$/ }).click();
  await waitText(km, 'Ignored the stop command');
  check('19. the yellow card outside a fight is recorded, with the Knight Marshal as recorder', sql(`select count(*) from public.event_sanctions where card_key = 'yellow_card' and status = 'active'`) === '1' && await has(km, 'Aldric Stone · Yellow card'));
  check('20. no sideways scroll on the discipline desk', (await sideways(km)) <= 0);
  await km.locator('.dd-list li', { hasText: 'Aldric Stone · Yellow card' }).getByRole('button', { name: 'Withdraw' }).click();
  await sheet(km).locator('textarea').fill('Recorded against the wrong fighter');
  await sheet(km).getByRole('button', { name: 'Withdraw it' }).click();
  await sheet(km).getByRole('button', { name: /^Yes, withdraw it$/ }).click();
  check('21. withdrawing keeps the record, marked withdrawn, with the reason', await waitDb(() => sql(`select status from public.event_sanctions where card_key = 'yellow_card'`), 'withdrawn') === 'withdrawn' && await waitText(km, 'Withdrawn: Recorded against the wrong fighter'));

  // ================================================================ 4. the Authenticity Officer: an infraction and a green card
  const { page: insp } = await open('phone', 'inspector');
  await insp.goto(BASE + `/events/${SLUG}/discipline?tab=authenticity`);
  await waitText(insp, 'Record an infraction', 30000);
  await insp.getByRole('button', { name: 'Record an infraction' }).click();
  await pickPerson(insp, 'Brann Oakley');
  await sheet(insp).getByRole('radio', { name: 'Moderate' }).click();
  await sheet(insp).getByLabel('Item', { exact: true }).fill('gauntlets');
  await sheet(insp).locator('textarea').fill('modern rivets on the cuff');
  await sheet(insp).getByRole('button', { name: 'Record it' }).click();
  await waitText(insp, 'modern rivets');
  check('22. the Authenticity Officer records a moderate infraction (gauntlets) for Brann', sql(`select severity || ':' || item from public.authenticity_findings`) === 'moderate:gauntlets');
  await insp.getByRole('button', { name: 'Give a green card' }).click();
  await pickPerson(insp, 'Brann Oakley');
  await sheet(insp).locator('textarea').fill('Entered the list with the moderate infraction');
  await sheet(insp).getByRole('button', { name: 'Give the green card' }).click();
  await sheet(insp).getByRole('button', { name: /^Yes, give the green card$/ }).click();
  check('23. the green card is a green card (its own concept), one per competitor', await waitDb(() => sql(`select count(*) from public.event_sanctions where card_key = 'green_card' and status = 'active'`), '1') === '1');
  await shot(insp, '06-authenticity', true);
  const again = await rpc('inspector', 'issue_event_sanction', { p_command: crypto.randomUUID(), p_event: '00000000-0000-0000-0000-00000000ed01', p_kind: 'card', p_fighter: '00000000-0000-0000-0000-00000000f102', p_card_key: 'green_card', p_reason: 'second' });
  check('24. a second green card while one is in force is refused by the database, citing Infractions 3 (one per tournament, and it follows the competitor)', again.status >= 400 && /green card in force/.test(JSON.stringify(again.body)) && /Infractions 3/.test(JSON.stringify(again.body)), JSON.stringify(again));
  const { page: sec } = await open('phone', 'secretary');
  await sec.goto(BASE + `/events/${SLUG}/discipline?tab=authenticity`);
  await waitText(sec, 'Authenticity', 30000);
  await sleep(800);
  check('25. the Secretary (scorekeeper) reads the desk but is offered no authenticity actions', !(await sec.getByRole('button', { name: 'Record an infraction' }).count()) && !(await sec.getByRole('button', { name: 'Give a green card' }).count()));

  // ================================================================ 5. an appeal: the Secretary records it, the Knight Marshal decides it
  await sec.goto(BASE + `/events/${SLUG}/discipline?tab=appeals`);
  await waitText(sec, 'Record an appeal', 30000);
  await sec.getByRole('button', { name: 'Record an appeal' }).click();
  const target = sheet(sec).getByLabel('What it is about');
  check('25b. an appeal can be about a fight where nothing was recorded: the fought fight m2 is offered',
    (await target.locator('optgroup[label="A fight (nothing was recorded)"] option').count()) >= 1 && (await target.locator('optgroup[label="A fight (nothing was recorded)"] option', { hasText: ' v ' }).count()) >= 1);
  await target.selectOption({ label: (await target.locator('option', { hasText: 'Brann Oakley' }).first().innerText()).trim() });
  await sheet(sec).getByLabel('Who appeals').fill('Captain of Iron Wolves');
  await sheet(sec).getByRole('button', { name: 'Record it' }).click();
  await waitText(sec, 'Captain of Iron Wolves');
  check('26. the appeal is recorded with its deadline (15 minutes after the fight)', (await has(sec, 'Deadline')) && sql(`select kind from public.discipline_reviews`) === 'event_appeal');
  check('27. the Secretary is not offered the decision', !(await sec.getByRole('button', { name: 'Record the decision' }).count()));
  check('27b. the Secretary can record that the appeal was withdrawn', (await sec.getByRole('button', { name: 'Withdrawn' }).count()) === 1);
  await insp.goto(BASE + `/events/${SLUG}/discipline?tab=appeals`);
  await waitText(insp, 'Captain of Iron Wolves', 30000);
  check('27c. the Authenticity Officer reads the appeal but is not offered to withdraw or decide it', !(await insp.getByRole('button', { name: 'Withdrawn' }).count()) && !(await insp.getByRole('button', { name: 'Record the decision' }).count()));
  const sneakWithdraw = await rpc('inspector', 'withdraw_review', { p_id: sql(`select id from public.discipline_reviews`), p_reason: 'the captain changed their mind' });
  check('27d. and a direct call to withdraw it is refused', sneakWithdraw.status >= 400 && /Secretary/.test(JSON.stringify(sneakWithdraw.body)), JSON.stringify(sneakWithdraw));
  await km.goto(BASE + `/events/${SLUG}/discipline?tab=appeals`);
  await waitText(km, 'Captain of Iron Wolves', 30000);
  await km.getByRole('button', { name: 'Record the decision' }).click();
  await sheet(km).getByLabel('Decision').selectOption('cards_withdrawn');
  await sheet(km).getByLabel(/void the card from the fight/).check();
  await sheet(km).getByRole('button', { name: 'Record the decision' }).click();
  check('28. applying the decision says the card will be voided (and that a final result must be reopened first)', await waitText(km, 'will be voided'));
  await sheet(km).getByRole('button', { name: /^Yes, record the decision$/ }).click();
  check('29. the card from the fight is voided through its own path (kept, with the appeal as its reason)', await waitDb(() => sql(`select (voided_at is not null)::text from public.match_discipline where id = '00000000-0000-0000-0000-00000000dd01'`), 'true') === 'true'
    && sql(`select void_reason from public.match_discipline_private where discipline_id = '00000000-0000-0000-0000-00000000dd01'`).startsWith('appeal upheld'));
  await shot(km, '07-appeal-decided');

  // ================================================================ 6. a suspension blocks check-in; no override clears it; a lift does
  await km.goto(BASE + `/events/${SLUG}/discipline?tab=suspensions`);
  await waitText(km, 'Who may not take part', 30000);
  await km.getByRole('button', { name: 'Suspend someone' }).click();
  await pickPerson(km, 'Dara Voss');
  await sheet(km).locator('textarea').fill('Struck a grounded fighter after the stop, twice');
  await sheet(km).getByRole('button', { name: /^Suspend$/ }).click();
  await sheet(km).getByRole('button', { name: /^Yes, suspend$/ }).click();
  check('30. the Knight Marshal suspends Dara for the rest of the event', await waitDb(() => sql(`select count(*) from public.discipline_suspensions where lifted_at is null`), '1') === '1');
  const { page: desk } = await open('phone', 'desk');
  await desk.goto(BASE + `/events/${SLUG}/checkin`);
  await waitText(desk, 'Dara Voss', 30000);
  const dara = desk.locator('article.desk-card', { hasText: 'Dara Voss' });
  check('31. the check-in desk shows Dara as blocked, in plain words', (await dara.locator('.desk-block').innerText()).includes('Suspended for the rest of this event'), await dara.innerText().catch(() => ''));
  check('32. and offers no check-in button for her', !(await dara.getByRole('button', { name: 'Check in' }).count()));
  await shot(desk, '08-checkin-blocked');
  const sneak = await rpc('desk', 'set_attendance', { p_reg: '00000000-0000-0000-0000-00000000ae04', p_state: 'checked_in' });
  check('33. a direct call to check her in is refused by the database', sneak.status >= 400 && /suspen/i.test(JSON.stringify(sneak.body)), JSON.stringify(sneak));
  const { page: org } = await open('phone', 'organizer');
  await org.goto(BASE + `/events/${SLUG}/checkin`);
  await waitText(org, 'Dara Voss', 30000);
  check('34. the organizer is not offered a readiness override for a suspension', !(await org.locator('article.desk-card', { hasText: 'Dara Voss' }).getByText('Override (exception only)').count()));
  const ovr = await rpc('organizer', 'set_readiness_override', { p_reg: '00000000-0000-0000-0000-00000000ae04', p_reason: 'override attempt' });
  const stillBlocked = sql(`select ready::text from private.readiness_rows('00000000-0000-0000-0000-00000000ed01', false) where registration_id = '00000000-0000-0000-0000-00000000ae04'`);
  check('35. a direct call to override her readiness is refused, and she stays NOT READY', ovr.status >= 400 && /cannot be overridden/.test(JSON.stringify(ovr.body)) && stillBlocked === 'false', `${ovr.status} ${JSON.stringify(ovr.body)} ${stillBlocked}`);
  await km.goto(BASE + `/events/${SLUG}/discipline?tab=suspensions`);
  await waitText(km, 'Suspensions by this event', 30000);
  await km.locator('.dd-list li', { hasText: 'Dara Voss' }).last().getByRole('button', { name: 'Lift' }).click();
  await sheet(km).locator('textarea').fill('Video review: the strike came before the stop');
  await sheet(km).getByRole('button', { name: 'Lift it' }).click();
  await sheet(km).getByRole('button', { name: /^Yes, lift it$/ }).click();
  check('36. the Knight Marshal lifts it with a reason', await waitDb(() => sql(`select (lifted_at is not null)::text from public.discipline_suspensions`), 'true') === 'true');
  await desk.reload(); await waitText(desk, 'Dara Voss', 30000);
  check('37. after the lift the desk can check her in again', (await desk.locator('article.desk-card', { hasText: 'Dara Voss' }).getByRole('button', { name: 'Check in' }).count()) === 1);

  // ================================================================ 7. an organization's suspension (Org A admin); Org B cannot see it
  const { page: oa } = await open('phone', 'orgA');
  await oa.goto(BASE + '/organizations/org-a-test');
  await waitText(oa, 'Suspensions by', 30000);
  await oa.getByRole('button', { name: 'Suspend someone' }).click();
  await sheet(oa).getByRole('searchbox', { name: 'Fighter name' }).fill('Cael');
  await sheet(oa).locator('.rl-pickrow', { hasText: 'Cael Rhodes' }).first().click();
  const until = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  await sheet(oa).getByLabel('Until (last day)').fill(until);
  await sheet(oa).locator('textarea').fill('Judiciary Committee decision: temporary ban');
  await sheet(oa).getByRole('button', { name: /^Suspend$/ }).click();
  await sheet(oa).getByRole('button', { name: /^Yes, suspend$/ }).click();
  check('38. Org A\'s admin suspends Cael from Org A events for 40 days', await waitDb(() => sql(`select authority || ':' || scope from public.discipline_suspensions where fighter_id = '00000000-0000-0000-0000-00000000f103' and lifted_at is null`), 'organization:organization_events') === 'organization:organization_events');
  check('38b. "until" is the day chosen, in Edmonton time too (stored as that whole day, not shifted to the next)',
    sql(`select to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD') from public.discipline_suspensions where fighter_id = '00000000-0000-0000-0000-00000000f103' and lifted_at is null`) === until
    && await waitText(oa, `until ${until}`), `${until} | ${await body(oa)}`.slice(0, 600));
  await shot(oa, '09-org-suspension', true);
  await desk.reload(); await waitText(desk, 'Cael Rhodes', 30000);
  check('39. the event\'s desk sees Cael blocked (the label only, not the reason)', (await desk.locator('article.desk-card', { hasText: 'Cael Rhodes' }).locator('.desk-block').innerText()).includes('Suspended from Org A events until') && !(await has(desk, 'temporary ban')));
  const { page: ob } = await open('phone', 'orgB');
  await ob.goto(BASE + '/organizations/org-a-test');
  await waitText(ob, 'Org A', 30000); await sleep(1200);
  check('40. Org B\'s admin sees no suspension section on Org A\'s page', !(await has(ob, 'Suspensions by')));
  const peek = await rest('orgB', 'GET', 'discipline_suspensions?select=id');
  check('41. and reads no suspension rows directly', peek.status === 200 && Array.isArray(peek.body) && peek.body.length === 0, JSON.stringify(peek));

  // ================================================================ 8. the fighter's own record; another fighter and a stranger see nothing
  const { page: me } = await open('phone', 'aldric');
  await me.goto(BASE + '/fighters/00000000-0000-0000-0000-00000000f101');
  check('42. Aldric sees "Your discipline record" on his own page (the withdrawn card, no staff reason)', await waitText(me, 'Your discipline record', 30000) && (await has(me, 'Yellow card · withdrawn')) && !(await has(me, 'Ignored the stop command')));
  await shot(me, '10-own-record', true);
  const { page: other } = await open('phone', 'brann');
  await other.goto(BASE + '/fighters/00000000-0000-0000-0000-00000000f101');
  await waitText(other, 'Aldric Stone', 30000); await sleep(1500);
  check('43. Brann does not see Aldric\'s record', !(await has(other, 'discipline record')));
  const { page: str } = await open('phone', 'stranger');
  await str.goto(BASE + `/events/${SLUG}/discipline?tab=sanctions`);
  await waitText(str, 'Discipline', 30000); await sleep(1500);
  check('44. a stranger gets no discipline desk', !(await has(str, 'Sanctions outside a fight')) && !(await has(str, 'Ignored the stop')));
  const anonRpc = await rpc(null, 'event_discipline_overview', { p_event: '00000000-0000-0000-0000-00000000ed01' });
  check('45. anonymous callers cannot call the discipline functions', anonRpc.status >= 400, JSON.stringify(anonRpc));

  // ================================================================ 9. competition documents (organizer, desktop)
  const { page: od } = await open('desktop', 'organizer');
  await od.goto(BASE + `/events/${SLUG}/manage?tab=competitions`);
  await waitText(od, 'Longsword (men)', 30000);
  await od.getByRole('button', { name: /Use the current Buhurt International documents/ }).first().click();
  check('46. "use the current Buhurt International documents" attaches the published duels documents and the documents for every format (from the classification)',
    await waitDb(() => sql(`select string_agg(r.inventory_key, ',' order by r.inventory_key) from public.competition_rulesets cr join public.ruleset_versions v on v.id = cr.ruleset_version_id join public.rulesets r on r.id = v.ruleset_id where cr.competition_id = '00000000-0000-0000-0000-00000000cd01'`),
      'authenticity/falchions,authenticity/gauntlets,authenticity/infractions,authenticity/tabards,marshal/duels-rules,marshal/weapon-shield-chart,tournament/duel-regulations,tournament/tournament-structure')
      === 'authenticity/falchions,authenticity/gauntlets,authenticity/infractions,authenticity/tabards,marshal/duels-rules,marshal/weapon-shield-chart,tournament/duel-regulations,tournament/tournament-structure');
  check('47. and the duels rules become its primary rulebook', sql(`select r.inventory_key from public.competitions k join public.ruleset_versions v on v.id = k.ruleset_version_id join public.rulesets r on r.id = v.ruleset_id where k.id = '00000000-0000-0000-0000-00000000cd01'`) === 'marshal/duels-rules');
  await shot(od, '11-competition-documents');

  // ================================================================ 10. desktop layout of the desk
  const { page: kd } = await open('desktop', 'knight');
  await kd.goto(BASE + `/events/${SLUG}/discipline?tab=authenticity`);
  await waitText(kd, 'Green cards', 30000);
  check('48. the desk on desktop: green cards and infractions, no sideways scroll', (await has(kd, 'Brann Oakley')) && (await sideways(kd)) <= 0);
  await shot(kd, '12-desk-desktop', true);

  const errs = pageErrors.flat();
  check('49. no page errors in any browser', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('the run finished without crashing', false, e?.stack ?? String(e));
} finally {
  await browser.close();
}
const passed = results.filter(r => r.ok).length;
console.log(`\nPACK22 DISCIPLINE LIVE: ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
