// Pack 22 (rules library, search, rule detail, versions, citing a rule on a marshal's call, discipline log) against a REAL local stack: Postgres built
// from every migration + the Pack 22 fixture, PostgREST, the real built app in real Chromium. Phone 390x844 first; tablet and desktop where it matters.
// The rules used are the INVENTED example rulesets (rules-library/_example-body), NOT real rules. The Buhurt International entries are the real
// document directory (no rule text). Run it through scripts/e2e/pack22-live.sh. LOCAL EVIDENCE ONLY (needs a PostgREST binary; not part of CI).
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
const A = (n) => `00000000-0000-0000-0000-0000000000a${n}`;
const C = (n) => `00000000-0000-0000-0000-0000000000c${n}`;
const WHO = { owner: [A(1), 'u1@example.test'], organizer: [A(2), 'u2@example.test'], scorekeeper: [A(4), 'u4@example.test'], stranger: [A(7), 'u7@example.test'], head: [C(1), 'c1@example.test'] };
const session = ([id, email]) => ({ access_token: jwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const EVENT = '00000000-0000-0000-0000-00000000ed01';
async function rest(who, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', ...(who ? { authorization: `Bearer ${session(WHO[who]).access_token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args) => rest(who, 'POST', `rpc/${fn}`, args);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = { desktop: { viewport: { width: 1280, height: 900 } }, tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true }, phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };
async function open(kind, who, { sample = false } = {}) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [STORAGE_KEY, session(WHO[who])]);
  if (sample) await ctx.addInitScript(() => { localStorage.setItem('bos-sample', '1'); });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|net::ERR|Failed to fetch|403|42501/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  return { ctx, page };
}
const body = async (page) => (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ');
const has = async (page, text) => (await body(page)).toLowerCase().includes(text.toLowerCase());
const shot = async (page, name, full = false) => { if (SHOTS) { await sleep(350); await page.screenshot({ path: `${SHOTS}/p22-${name}.png`, fullPage: full }).catch(() => undefined); } };
const waitDb = async (fn, want, timeout = 10000) => { const t0 = Date.now(); let v = fn(); while (v !== want && Date.now() - t0 < timeout) { await sleep(250); v = fn(); } return v; };
const waitFor = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const sideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
const resultNumbers = (page) => page.locator('#rl-official ~ .rl-list .rl-row .rl-num').allInnerTexts().then(a => a.map(s => s.trim()));
const resultTitles = (page) => page.locator('#rl-official ~ .rl-list .rl-row .rl-title').allInnerTexts().then(a => a.map(s => s.trim()));
async function search(page, q) {
  const box = page.getByRole('searchbox', { name: 'Search rules' });
  await box.fill(q);
  await waitFor(page, (want) => new URL(location.href).searchParams.get('q') === want, q, 5000);
  await sleep(120);
}
const prov = (version, number) => sql(`select p.id from public.rule_provisions p join public.ruleset_versions v on v.id = p.ruleset_version_id where v.version = '${version}' and p.number = '${number}' and p.kind <> 'appendix'`);
const pageErrors = [];

try {
  const exSlug = sql(`select slug from public.rulesets where inventory_key = 'marshal/example-combat-rules'`);
  const biSlug = sql(`select slug from public.rulesets where inventory_key = 'marshal/buhurt-rules'`);
  check('fixture: the Buhurt International directory (45 entries) and the example rulesets (V.1.0 superseded, V.1.1 and V.2.0 published) are in the database',
    sql(`select count(*) from public.rulesets where governing_body = 'Buhurt International'`) === '45' && sql(`select string_agg(version || ':' || status, ',' order by version) from public.ruleset_versions`) === 'V.1.0:superseded,V.1.1:published,V.2.0:published');

  // ================================================================ 1. anonymous visitor on a phone, sample mode OFF: the real directory, no test rules
  const { page: anon } = await open('phone', null);
  pageErrors.push(anon.errors);
  await anon.goto(BASE + '/rules');
  await anon.waitForSelector('#rl-docs', { timeout: 30000 });
  check('1. /rules opens on a phone with one search box and the official documents by committee', (await anon.getByRole('searchbox', { name: 'Search rules' }).count()) === 1 && (await anon.locator('#rl-docs ~ .rl-groups > details.rl-group').count()) === 4, await body(anon));
  check('2. it says plainly that the official text is not imported yet, and that search covers the summaries only', await has(anon, 'The official rule text is not in BuhurtOS yet'));
  check('3. the four Buhurt International committees are listed with their document counts (8, 6, 5, 23)', (await anon.locator('#rl-docs ~ .rl-groups summary .rl-count').allInnerTexts()).map(s => s.trim()).sort().join(',') === '23,5,6,8', (await anon.locator('#rl-docs ~ .rl-groups summary').allInnerTexts()).join(' | '));
  check('4. test rulesets are hidden outside sample mode', !(await has(anon, 'Example Combat Rules')));
  check('5. no sideways scroll at 390 px', (await sideways(anon)) <= 0, String(await sideways(anon)));
  await shot(anon, '01-rules-phone-anon', true);
  const marshalGroup = anon.locator('details.rl-group', { hasText: 'Marshal Committee' });
  check('5b. committees follow the official page order and the committee with the bout rules opens first', (await anon.locator('#rl-docs ~ .rl-groups > details.rl-group > summary > span:first-child').allInnerTexts()).map(t => t.split('·').pop().trim().toLowerCase()).join(',').startsWith('executive') && await marshalGroup.evaluate(e => e.open), (await anon.locator('#rl-docs ~ .rl-groups summary').allInnerTexts()).join(' | '));
  await marshalGroup.getByRole('link', { name: /Buhurt Rules/ }).click();
  await anon.waitForSelector('.rl-notext', { timeout: 15000 });
  const official = await anon.getByRole('link', { name: /Open the official document/ }).getAttribute('href');
  check('6. a document without imported text says so and links to the official file on the governing body\'s own host (new tab)', official === 'https://drive.google.com/file/d/1peAGsMBV8ldNkSlgR-U33V0JqCFYL8ja/view?usp=drive_link' && (await anon.getByRole('link', { name: /Open the official document/ }).getAttribute('target')) === '_blank' && anon.url().endsWith(`/rules/doc/${biSlug}`), official);
  check('7. the document page names the issuing committee and the format it applies to', (await has(anon, 'Buhurt International · Marshal Committee')) && (await has(anon, 'Group fight')));
  await shot(anon, '02-doc-no-text');
  await anon.goto(BASE + '/rules?q=grounded');
  await anon.waitForSelector('#rl-sum', { timeout: 15000 });
  check('8. a search with no official text still finds the BuhurtOS summaries, labelled as summaries (not official wording)', (await anon.locator('.rl-summary').count()) >= 1 && (await has(anon, 'not the official wording')) && (await anon.locator('#rl-official').count()) === 0);

  // ================================================================ 2. sample mode ON (test rules visible): search like a referee at the list
  const { page: ph, ctx: phCtx } = await open('phone', null, { sample: true });
  pageErrors.push(ph.errors);
  await ph.goto(BASE + '/rules');
  await ph.waitForSelector('.rl-search', { timeout: 30000 });
  await waitFor(ph, () => !document.body.innerText.includes('Loading the rules'), null, 15000);
  const cases = [['back of knee', '2.1', 'Prohibited targets'], ['two handed weapon', '2.3', 'Two-handed weapons'], ['helmet', '4.1', 'Helmet'], ['yellow card', '3.2', 'Cards'], ['grounded fighter', '1.2', 'Grounded fighter'], ['grappling', '2.2', 'Grappling'], ['protest', '2.1', 'Protests']];
  for (const [q, n, t] of cases) {
    await search(ph, q);
    const nums = await resultNumbers(ph), titles = await resultTitles(ph);
    check(`9. "${q}" puts ${n} ${t} first`, nums[0] === n && titles[0] === t, `${nums.slice(0, 4)} / ${titles.slice(0, 4)}`);
  }
  await search(ph, 'shield');
  check('10. "shield" finds the two-handed rule (which mentions the shield); V.1.1 has no shield-size rule', (await resultTitles(ph)).includes('Two-handed weapons'), (await resultTitles(ph)).join('|'));
  check('11. a result shows its rule number, document and version, and marks the matched words', (await ph.locator('.rl-row').first().locator('.rl-doc').textContent()).includes('Example Combat Rules · V.1.1') && (await ph.locator('.rl-row mark').count()) > 0, await ph.locator('.rl-row').first().textContent());
  await search(ph, '3.2');
  check('12. typing a rule number finds that rule', (await resultNumbers(ph))[0] === '3.2' && (await resultTitles(ph))[0] === 'Cards');
  await search(ph, '4');
  check('13. a section number lists the rules under it, in order', (await resultNumbers(ph)).slice(0, 2).join(',') === '4.1,4.2' || (await resultNumbers(ph)).slice(0, 2).join(',') === '4,4.1', (await resultNumbers(ph)).join(','));
  await search(ph, 'zebra');
  check('14. a word in no rule says "Nothing matches" with what to try, and shows no false results', (await has(ph, 'Nothing matches “zebra”')) && (await ph.locator('.rl-row').count()) === 0);
  await shot(ph, '03-no-results');
  await search(ph, 'helmet zebra');
  check('15. when no rule has every word, the closest are offered and called that', (await has(ph, 'These are the closest')) && (await resultNumbers(ph))[0] === '4.1');
  await search(ph, 'back of knee');
  check('16. search results never show the older version by default', !(await ph.locator('.rl-row .rl-doc', { hasText: 'V.1.0' }).count()));
  await ph.getByRole('checkbox', { name: /Include older versions/ }).check();
  await sleep(150);
  check('17. "Include older versions" adds V.1.0, labelled as an older version', (await ph.locator('.rl-row .rl-doc', { hasText: 'V.1.0 · Older version' }).count()) >= 1);
  await search(ph, 'shield');
  check('17b. with older versions, "shield" also finds V.1.0 4.2 Shield sizes', (await resultTitles(ph)).includes('Shield sizes'), (await resultTitles(ph)).join('|'));
  await ph.getByRole('checkbox', { name: /Include older versions/ }).uncheck();
  await search(ph, 'back of knee');
  await ph.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'Profight' }).click();
  await sleep(150);
  check('18. the format filter narrows to documents for that format (the duel rules disappear under Profight)', (await ph.locator('.rl-row .rl-doc', { hasText: 'Example Combat Rules' }).count()) === 0);
  await ph.getByRole('group', { name: 'Format' }).getByRole('button', { name: 'All' }).click();
  await search(ph, 'back of knee');
  check('19. still no sideways scroll at 390 px with results', (await sideways(ph)) <= 0, String(await sideways(ph)));
  await shot(ph, '04-search-back-of-knee');

  // ---------------------------------------------------------------- rule detail: what it says, where it comes from, whether it is in force
  await ph.locator('.rl-row').first().click();
  await ph.waitForSelector('.rl-rule', { timeout: 10000 });
  const detail = (await body(ph)).toLowerCase();
  check('20. the rule page shows the number, the title and the full text', (await ph.locator('.rl-bignum').innerText()) === '2.1' && (await ph.locator('.rl-rhead h1').innerText()).toLowerCase() === 'prohibited targets' && detail.includes('strikes to the back of the knee, the neck, the groin and the feet are prohibited.'), detail.slice(0, 400));
  check('21. it shows its source: governing body and committee, document, version in force, section and page', detail.includes('example body (test) · example marshal committee') && detail.includes('v.1.1 · in force') && /rule 2\.1 in 2 prohibited actions · page 1/.test(detail) && detail.includes('applies to duels'), detail);
  check('22. it says how it was checked and links to the official document at the page', detail.includes('imported from the official file; not yet compared line by line') && (await ph.getByRole('link', { name: /Open the official document at page 1/ }).getAttribute('href')) === 'https://example.invalid/files/example-combat-rules.pdf#page=1');
  check('23. it links to the rules it refers to (1.2) and to the same rule in the older version', (await ph.locator('.rl-block', { hasText: 'Rules it refers to' }).locator('.rl-num').textContent()) === '1.2' && (await ph.locator('.rl-block', { hasText: 'This rule in other versions' }).locator('.rl-doc').textContent()).includes('V.1.0 · Older version'));
  check('24. the breadcrumb leads back to the document and its section', (await ph.locator('.rl-crumbs a').allInnerTexts()).join(' > ').startsWith('Rules > Example Combat Rules > 2'));
  check('25. no sideways scroll on the rule page', (await sideways(ph)) <= 0);
  await shot(ph, '05-rule-detail', true);
  await ph.locator('.rl-block', { hasText: 'This rule in other versions' }).locator('.rl-row').first().click();
  await ph.waitForSelector('.rl-banner', { timeout: 10000 });
  check('26. the older version opens with its own wording and a banner: older version, the wording in force is elsewhere, past results keep this wording', (await has(ph, 'Older version (V.1.0).')) && (await has(ph, 'Results decided under V.1.0 keep this wording')) && (await has(ph, 'Strikes to the back of the knee, the neck and the feet are prohibited.')));
  await ph.getByRole('link', { name: /^open 2\.1$/ }).click();
  await waitFor(ph, () => document.body.innerText.includes('V.1.1 · In force'), null, 8000);
  check('27. "open the wording in force" goes to the same rule in V.1.1', ph.url().endsWith(`/rules/r/${prov('V.1.1', '2.1')}`));
  await ph.goto(BASE + `/rules/r/${prov('V.1.1', '4.1')}`);
  await ph.waitForSelector('.rl-rule', { timeout: 10000 });
  await waitFor(ph, () => document.body.innerText.includes('Corrected in BuhurtOS'), null, 8000);
  check('28. a corrected rule says so, with the reason, and can show the earlier text', (await has(ph, 'Corrected in BuhurtOS')) && (await has(ph, 'the import dropped the last words (test)')));
  await ph.getByRole('button', { name: 'Show the earlier text' }).click();
  check('29. the earlier text is shown on request', await has(ph, 'Every fighter wears a helmet that covers the whole head and the neck.'));

  // ---------------------------------------------------------------- long content and the document page
  await ph.goto(BASE + `/rules/r/${prov('V.1.0', '3.3')}`);
  await ph.waitForSelector('.rl-body', { timeout: 10000 });
  const longH = await ph.evaluate(() => document.querySelector('.rl-body').scrollHeight);
  await ph.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(200);
  check('30. a long rule (9 paragraphs) reads on a phone: wraps, scrolls, no sideways scroll, prev/next at the end', longH > 1200 && (await sideways(ph)) <= 0 && (await ph.getByRole('link', { name: /4 →/ }).count()) === 1, `${longH} ${await sideways(ph)}`);
  await shot(ph, '06-long-rule', true);
  await ph.goto(BASE + `/rules/doc/${exSlug}`);
  await ph.waitForSelector('.rl-toc', { timeout: 10000 });
  check('31. the document page lists its contents in reading order with numbers (V.1.1: 13 provisions incl. the title page)', (await ph.locator('.rl-toc li').count()) === 13 && (await ph.locator('.rl-toc .rl-num').allInnerTexts()).slice(1, 4).join(',') === '1,1.1,1.2');
  check('32. it shows both versions; the one in force is selected', (await ph.getByRole('group', { name: 'Versions' }).getByRole('button').count()) === 2 && (await ph.locator('.rl-vbtn[aria-pressed="true"]').innerText()).includes('V.1.1'));
  await ph.getByRole('searchbox', { name: /Search in Example Combat Rules/ }).fill('helmet');
  await sleep(150);
  check('33. search inside one document', (await ph.locator('.rl-list .rl-num').first().innerText()) === '4.1');
  await ph.locator('.rl-vbtn', { hasText: 'V.1.0' }).click();
  await sleep(200);
  await ph.getByRole('searchbox', { name: /Search in Example Combat Rules/ }).fill('');
  check('34. choosing V.1.0 shows its own contents (15 provisions) and says it is an older version', (await ph.locator('.rl-toc li').count()) === 15 && (await has(ph, 'This is an older version.')));
  await shot(ph, '07-document-page', true);
  await phCtx.close();

  // ================================================================ 3. keyboard on a desktop
  const { page: kb, ctx: kbCtx } = await open('desktop', null, { sample: true });
  pageErrors.push(kb.errors);
  await kb.goto(BASE + '/rules');
  await kb.waitForSelector('.rl-search', { timeout: 30000 });
  await kb.getByRole('searchbox', { name: 'Search rules' }).focus();
  await kb.keyboard.type('helmet');
  await kb.keyboard.press('Enter');
  await sleep(200);
  const afterEnter = await kb.evaluate(() => ({ active: document.activeElement?.tagName, q: new URL(location.href).searchParams.get('q'), path: location.pathname }));
  check('35. keyboard: type in the search box and press Enter: the page stays, the query is kept (the phone keyboard closes)', afterEnter.q === 'helmet' && afterEnter.path === '/rules' && afterEnter.active !== 'INPUT', JSON.stringify(afterEnter));
  await kb.getByRole('searchbox', { name: 'Search rules' }).focus();
  let reached = false;
  for (let i = 0; i < 25 && !reached; i++) { await kb.keyboard.press('Tab'); reached = await kb.evaluate(() => document.activeElement?.classList.contains('rl-row')); }
  const ring = await kb.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  check('36. keyboard: Tab reaches the first result, which shows a focus ring', reached && ring !== 'none', ring);
  await kb.keyboard.press('Enter');
  await kb.waitForSelector('.rl-rule', { timeout: 10000 }).catch(() => undefined);
  check('37. keyboard: Enter opens the rule', (await kb.locator('.rl-bignum').innerText().catch(() => '')) === '4.1');
  await kb.goto(BASE + '/rules?q=helmet');
  await kb.waitForSelector('.rl-clear');
  await kb.getByRole('button', { name: 'Clear search' }).click();
  check('38. the clear button empties the search and returns to the documents', !(new URL(kb.url()).searchParams.get('q')) && (await kb.locator('#rl-docs').count()) === 1);
  await shot(kb, '08-desktop', true);
  await kbCtx.close();

  // ================================================================ 4. officiating: the tablet keeps the fight open while looking up and citing a rule
  const queue = await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true });
  check('39. Field 1 is called through the existing queue', queue.status === 200, JSON.stringify(queue));
  const { page: tab } = await open('phone', 'scorekeeper', { sample: true });
  pageErrors.push(tab.errors);
  await tab.goto(BASE + '/events/test-stuff-test/field/Field%201');
  await tab.getByRole('button', { name: /Score Aldric Stone against Brann Oakley/ }).click();
  await tab.waitForSelector('.ly-timer', { timeout: 30000 });
  await tab.getByRole('button', { name: /Start round 1/ }).click();
  await waitFor(tab, () => /running/i.test(document.querySelector('.ly-word')?.textContent ?? ''), null, 10000);
  const matchId = '00000000-0000-0000-0000-0000000fd001';   // Aldric Stone v Brann Oakley, the fight just opened
  const before = sql(`select queue_state || ':' || version from public.matches where id = '${matchId}'`);
  await tab.getByRole('button', { name: 'Rules', exact: true }).click();
  const rs = tab.getByRole('dialog');
  await rs.waitFor();
  await rs.getByRole('searchbox', { name: 'Search the rules' }).fill('helmet');
  await sleep(200);
  await rs.locator('.rl-pickrow').first().click();
  check('40. the Rules sheet on the lyst screen finds and opens a rule (4.1 Helmet) without leaving the fight', (await rs.innerText()).includes('Every fighter wears a helmet') && (await tab.locator('.ly-timer').count()) === 1);
  await shot(tab, '09-lyst-rules-sheet');
  await rs.getByRole('button', { name: /Back to results/ }).click();
  await rs.getByRole('button', { name: /Close/ }).first().click().catch(async () => { await tab.keyboard.press('Escape'); });
  await rs.waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
  check('41. looking up a rule changed nothing on the match (state and version unchanged) and the clock keeps running', sql(`select queue_state || ':' || version from public.matches where id = '${matchId}'`) === before && /running/i.test(await tab.locator('.ly-word').innerText()));
  await tab.getByRole('button', { name: /^Marshal's call/ }).click();
  const sheet = tab.getByRole('dialog');
  await sheet.waitFor();
  await sheet.getByRole('button', { name: /^Warning/ }).click();
  await sheet.getByRole('group', { name: 'Against which fighter' }).getByRole('button', { name: /^Brann Oakley/ }).click();
  await sheet.getByRole('button', { name: 'Add the rule (optional)' }).click();
  await sheet.getByRole('searchbox', { name: 'Find the rule' }).fill('back of knee');
  await sleep(200);
  await sheet.locator('.rl-pickrow').first().click();
  check('42. the marshal\'s-call sheet lets the operator pick the rule (2.1 Prohibited targets)', (await sheet.locator('.rl-picked .chip').innerText()).includes('2.1 · Prohibited targets'));
  await shot(tab, '10-call-with-rule');
  await sheet.getByRole('button', { name: /^Record warning · Brann Oakley/ }).click();
  await sheet.waitFor({ state: 'detached' });
  const discId = await waitDb(() => sql(`select id from public.match_discipline where match_id = '${matchId}' and kind = 'warning'`), sql(`select id from public.match_discipline where match_id = '${matchId}' and kind = 'warning'`) || 'x');
  check('43. the warning is recorded through the outbox and the rule cited on it (V.1.1 rule 2.1), by the scorekeeper', await waitDb(() => sql(`select p.number || ':' || v.version || ':' || (r.set_by = '${WHO.scorekeeper[0]}') from public.match_discipline_rules r join public.rule_provisions p on p.id = r.provision_id join public.ruleset_versions v on v.id = p.ruleset_version_id where r.discipline_id = '${discId}'`), '2.1:V.1.1:true') === '2.1:V.1.1:true');
  check('44. the citation is audited', await waitDb(() => sql(`select count(*) from public.audit_log where action = 'lyst.discipline_rule' and subject = '${matchId}'`), '1') === '1');
  await tab.getByRole('button', { name: 'Record', exact: true }).click();
  const log = tab.getByRole('dialog');
  await log.waitFor();
  await waitFor(tab, () => document.querySelector('[role=dialog]')?.textContent.includes('Rule 2.1'), null, 8000);
  check('45. the match record shows the rule cited on the warning', (await log.innerText()).includes('Rule 2.1 · Prohibited targets (Example Combat Rules V.1.1)'), await log.innerText());
  await log.getByRole('button', { name: 'Change the rule' }).click();
  await log.getByRole('searchbox', { name: 'Find the rule' }).fill('grappling');
  await sleep(200);
  await log.locator('.rl-pickrow').first().click();
  check('46. changing the rule adds a new citation; the first one is kept (append-only)', await waitDb(() => sql(`select string_agg(p.number, '>' order by r.created_at, r.id) from public.match_discipline_rules r join public.rule_provisions p on p.id = r.provision_id where r.discipline_id = '${discId}'`), '2.1>2.2') === '2.1>2.2');
  await waitFor(tab, () => document.querySelector('[role=dialog]')?.textContent.includes('Rule 2.2'), null, 8000);
  check('47. the record shows the new rule', (await log.innerText()).includes('Rule 2.2 · Grappling'));
  check('48. no sideways scroll on the lyst screen at 390 px', (await sideways(tab)) <= 0);
  await shot(tab, '11-record-with-rule');

  // ================================================================ 5. the discipline log and who may read it
  const { page: hm } = await open('phone', 'head', { sample: true });
  pageErrors.push(hm.errors);
  await hm.goto(BASE + '/events/test-stuff-test/discipline');
  await hm.waitForSelector('.dl-page', { timeout: 20000 });
  await waitFor(hm, () => document.querySelector('.dl-person') !== null, null, 10000);
  const dl = await body(hm);
  check('49. the head marshal\'s discipline log lists the warning against Brann Oakley with the reason chain and the rule cited (now 2.2), noting it changed', dl.includes('Brann Oakley') && dl.includes('Warning · round 1') && dl.includes('Rule cited: 2.2 Grappling') && dl.includes('changed since first recorded'), dl.slice(0, 600));
  check('50. totals count only records in force', (await hm.locator('.dl-sum > div').nth(1).locator('b').innerText()) === '1');
  check('51. no sideways scroll on the discipline log at 390 px', (await sideways(hm)) <= 0);
  await shot(hm, '12-discipline-log', true);
  await hm.locator('.dl-items').getByRole('link', { name: /2\.2 Grappling/ }).click();
  await hm.waitForSelector('.rl-rule', { timeout: 10000 });
  check('52. the cited rule opens from the log', (await hm.locator('.rl-bignum').innerText()) === '2.2');
  const { page: st } = await open('phone', 'stranger');
  pageErrors.push(st.errors);
  await st.goto(BASE + '/events/test-stuff-test/discipline');
  await waitFor(st, () => document.body.innerText.includes("Only this event's officials can read its discipline log"), null, 15000);
  check('53. a signed-in stranger is refused the discipline log by the database (and sees no records)', (await has(st, "Only this event's officials can read its discipline log")) && !(await has(st, 'Brann Oakley')));

  // ================================================================ 6. permission boundaries through the real API
  const anonCite = await rpc(null, 'lyst_cite_rule', { p_command: crypto.randomUUID(), p_discipline: discId, p_provision: null });
  const strangerCite = await rpc('stranger', 'lyst_cite_rule', { p_command: crypto.randomUUID(), p_discipline: discId, p_provision: null });
  check('54. anonymous and stranger cannot cite a rule (refused by the database)', anonCite.status >= 400 && strangerCite.status >= 400 && sql(`select count(*) from public.match_discipline_rules where discipline_id = '${discId}'`) === '2', `${anonCite.status} ${strangerCite.status}`);
  const anonLog = await rpc(null, 'event_discipline_log', { p_event: EVENT });
  check('55. anonymous cannot read the discipline log', anonLog.status >= 400, String(anonLog.status));
  const setBy = await rest(null, 'GET', 'match_discipline_rules?select=set_by');
  const pubCite = await rest(null, 'GET', 'match_discipline_rules?select=discipline_id,provision_id');
  check('56. the public may see which rule a published event\'s call cited, never who cited it', setBy.status >= 400 && pubCite.status === 200 && pubCite.body.length === 2, `${setBy.status} ${pubCite.status}`);
  const orgPublish = await rpc('organizer', 'publish_ruleset_version', { p_version: sql(`select id from public.ruleset_versions where version = 'V.1.0'`) });
  const orgCorrect = await rpc('organizer', 'correct_rule_provision', { p_provision: prov('V.1.1', '2.1'), p_title: 'x', p_body: 'x', p_reason: 'x x x' });
  check('57. an organizer cannot publish or correct rules', orgPublish.status >= 400 && orgCorrect.status >= 400, `${orgPublish.status} ${orgCorrect.status}`);
  const draftInsert = await rest('owner', 'POST', 'rule_provisions', { ruleset_version_id: sql(`select id from public.ruleset_versions where version = 'V.1.1'`), ordinal: 99, kind: 'rule', body: 'x', stable_key: 'x:1', content_sha256: '0'.repeat(64) });
  check('58. nobody (not even the owner) writes rule text through the API', draftInsert.status >= 400, String(draftInsert.status));

  // ================================================================ 7. the organizer links a competition to the version it is fought under
  const { page: org } = await open('phone', 'organizer', { sample: true });
  pageErrors.push(org.errors);
  await org.goto(BASE + '/events/test-stuff-test/manage?tab=competitions');
  await waitFor(org, () => document.body.innerText.includes('Official ruleset in BuhurtOS'), null, 20000);
  const picker = org.getByRole('combobox', { name: /Official ruleset in BuhurtOS/ }).first();
  const optionTexts = await picker.locator('option').allInnerTexts();
  check('59. Manage › Competitions offers the published rules versions for the format (and not the superseded one)', optionTexts.some(t => t.includes('Example Combat Rules · V.1.1')) && !optionTexts.some(t => t.includes('V.1.0')), optionTexts.join(' | '));
  const compName = sql(`select k.name from public.competitions k join public.ref_categories c on c.code = k.category where k.event_id = '${EVENT}' and c.league = 'duels' order by k.sort limit 1`);
  const compPicker = org.locator('li', { hasText: compName }).getByRole('combobox', { name: /Official ruleset in BuhurtOS/ }).first();
  await compPicker.selectOption({ label: optionTexts.find(t => t.includes('Example Combat Rules · V.1.1')) });
  check('60. choosing it links the competition in the database, audited', await waitDb(() => sql(`select v.version from public.competitions k join public.ruleset_versions v on v.id = k.ruleset_version_id where k.event_id = '${EVENT}' and k.name = '${compName.replace(/'/g, "''")}'`), 'V.1.1') === 'V.1.1' && sql(`select count(*) from public.audit_log where action = 'competition.ruleset_version'`) === '1');
  check('61. no sideways scroll on Manage › Competitions at 390 px', (await sideways(org)) <= 0);
  await shot(org, '13-competition-ruleset');

  const errs = pageErrors.flat();
  check('62. no page errors in any browser', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('the scenario ran to the end', false, e?.stack ?? String(e));
} finally {
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\nPACK22 LIVE: ${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
