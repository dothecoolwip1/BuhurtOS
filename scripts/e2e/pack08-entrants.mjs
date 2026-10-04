// Drives the REAL built app in a REAL Chromium at phone size (390x844) against a mocked Supabase (scripts/e2e/mock-rest.mjs) and checks
// the Pack 08 workflows: the organizer's Add entrant flow (search, pick, create an unclaimed fighter, same-name confirmation, group fights),
// the live entrant count, the "Unclaimed profile" wording, who is refused, and the claim flow from request to platform-owner decision.
// It proves how the screens behave; supabase/tests/pack08_gate.sql proves the database rules (the mock only imitates them).
//   VITE_BASE=/ npx vite build --outDir /tmp/e2e-dist && npx vite preview --outDir /tmp/e2e-dist --port 4180 &
//   E2E_BASE=http://localhost:4180 node scripts/e2e/pack08-entrants.mjs
import { chromium } from 'playwright-core';
import { IDS, REF, createMock, sessionFor, storageKey } from './mock-rest.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4180';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 300)}`); };
const SHOTS = process.env.E2E_SHOTS;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const mock = createMock();
const db = mock.db;
await ctx.route(`https://${REF}.supabase.co/**`, mock.handle);
await ctx.route('https://maps.googleapis.com/**', r => r.abort('failed'));
await ctx.route(/posthog\.com/, r => r.abort('failed'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const has = async (text) => (await body()).toLowerCase().includes(text.toLowerCase());
const signIn = async (id, email) => { await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, sessionFor(id, email)]); };
const noSideways = async (label) => { const sw = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]); check(`${label}: no sideways scroll at 390px`, sw[0] <= sw[1], JSON.stringify(sw)); };
const go = async (path) => { await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle'); };
const rpcAs = (who, fn, args) => page.evaluate(async ([ref, token, fn, args]) => {
  const r = await fetch(`https://${ref}.supabase.co/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: 'x' }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [REF, sessionFor(who, 'x@example.test').access_token, fn, args]);
const comp = (id) => page.locator(`section[aria-label="${db.competitions.find(c => c.id === id).name}"]`);
const countChip = async (id) => ((await comp(id).locator('.chip').first().textContent()) ?? '').trim();

try {
  await go('/');
  await signIn(IDS.organizer, 'orla@example.test');
  await go('/events/red-deer-rumble/manage?tab=run');
  await comp(IDS.c1).waitFor();

  // ---- 1. the action is there, in the Run area
  const addBtn = page.getByTestId(`add-entrant-${IDS.c1}`);
  check('1. Run shows an Add entrant action for the competition', await addBtn.isVisible() && /add entrant/i.test(await addBtn.innerText()));
  check('1b. the competition starts with no entrants', /0 entrants/.test(await countChip(IDS.c1)), await countChip(IDS.c1));
  await addBtn.scrollIntoViewIfNeeded();
  await shot('p08-run-before');
  await addBtn.click();
  const panel = page.getByTestId('add-entrant-panel');
  await panel.waitFor();

  // ---- 2. search first; same names are told apart by team and place
  await page.getByTestId('entrant-search').fill('alex');
  await page.getByTestId('entrant-results').waitFor();
  const cards = page.getByTestId('entrant-results').locator('li');
  check('2. searching "alex" lists both Alex Existing records', (await cards.count()) === 2);
  const t0 = (await page.getByTestId('entrant-results').innerText()).replace(/\s+/g, ' ');
  check('2b. each result shows team or place so two people are not mixed up', /Red Deer Reavers · Red Deer, AB/.test(t0) && /Calgary, AB/.test(t0), t0);
  check('2c. unclaimed fighters say "Unclaimed profile", with no database wording', /Unclaimed profile/i.test(t0) && !/uuid|row|fighter_accounts|auth/i.test(t0));
  await noSideways('Add entrant search results');
  check('2d. the panel and its fields stay inside the card', await page.evaluate(() => { const c = document.querySelector('[data-testid=add-entrant-panel]').parentElement.getBoundingClientRect(); return [...document.querySelectorAll('[data-testid=add-entrant-panel], [data-testid=add-entrant-panel] input, [data-testid=add-entrant-panel] li, [data-testid=add-entrant-panel] button')].every(e => e.getBoundingClientRect().right <= c.right + 1); }));
  await shot('p08-search');

  // ---- 3. add an existing fighter; the count updates with no manual refresh
  await page.getByRole('button', { name: 'Add Alex Existing' }).first().click();
  await page.getByTestId('add-entrant-note').waitFor();
  await page.waitForFunction(() => /1 entrant\b/.test(document.body.innerText));
  check('3. adding an existing fighter shows a confirmation', await has('Alex Existing is in.'));
  check('3b. the entrant count went 0 → 1 without reloading the page', /1 entrant\b/.test(await countChip(IDS.c1)), await countChip(IDS.c1));
  check('3c. the entry is a normal fighter entry', db.entries.some(e => e.competition_id === IDS.c1 && e.fighter_id === IDS.fx && e.team_id === null && e.status === 'registered'));
  const anyCall = (fn) => mock.st.calls.filter(c => c.fn === fn);
  check('3d. it went through the add_entrant RPC as the organizer, not a table write', anyCall('add_entrant').length === 1 && anyCall('add_entrant')[0].who === IDS.organizer && !mock.st.calls.some(c => c.table === 'entries' && c.method === 'POST'));

  // ---- 4. a person nobody has: create an unclaimed fighter
  const authCountBefore = Object.keys(db.fighter_accounts).length;
  await page.getByTestId('entrant-search').fill('Zed Newcomer');
  await sleep(500);
  check('4. a search with no match says so', await has('No fighter found'));
  await page.getByTestId('create-new').click();
  check('4b. the form is minimal and the name is carried over', (await page.getByTestId('new-name').inputValue()) === 'Zed Newcomer' && !(await has('password')) && (await page.locator('input[type=email]').count()) === 0);
  await page.getByLabel('City (optional)').fill('Edmonton');
  await page.getByTestId('create-entrant').scrollIntoViewIfNeeded();
  await shot('p08-create');
  await page.getByTestId('create-entrant').click();
  await comp(IDS.c1).locator('.chip', { hasText: /^2 entrants$/i }).first().waitFor({ timeout: 8000 }).catch(() => {});
  const zed = db.fighters.find(f => f.display_name === 'Zed Newcomer');
  check('4c. a permanent fighter record exists and is entered', Boolean(zed) && db.entries.some(e => e.competition_id === IDS.c1 && e.fighter_id === zed.id));
  check('4d. no account was created or linked for them', Object.keys(db.fighter_accounts).length === authCountBefore && !db.fighter_accounts[zed.id]);
  check('4e. the count updated to 2 without reloading', /2 entrants\b/.test(await countChip(IDS.c1)), await countChip(IDS.c1));
  check('4f. creating was audited', db.audit_log.some(a => a.action === 'fighter.created_by_organizer' && a.subject === zed.id) && db.audit_log.some(a => a.action === 'entrant.added' && a.subject === zed.id));

  // ---- 5. same name as an existing fighter: shown, never auto-merged, needs a deliberate second tap
  await page.getByTestId('entrant-search').fill('alex existing');
  await page.getByTestId('entrant-results').waitFor();
  const fightersBefore = db.fighters.length;
  await page.getByTestId('create-new').click();
  await page.getByTestId('create-entrant').click();
  await page.getByTestId('same-name-warning').waitFor();
  check('5. a same-name create is stopped and the look-alikes are shown with context', /already exist/.test(await page.getByTestId('same-name-warning').innerText()) && db.fighters.length === fightersBefore);
  await shot('p08-same-name');
  await page.getByTestId('create-entrant').click();
  await page.waitForFunction(() => /3 entrants\b/.test(document.body.innerText));
  check('5b. after confirming, a separate fighter is created (not merged) and entered', db.fighters.length === fightersBefore + 1);
  check('5c. the look-alike pair is queued for the platform administrator', db.identity_reviews.filter(r => r.source === 'organizer_entry' && r.reason === 'same_name').length === 2);
  check('5d. the Add buttons are not hidden behind the bottom bar', await (async () => {
    await page.getByTestId('entrant-search').scrollIntoViewIfNeeded();
    return page.evaluate(() => { const b = document.querySelector('[data-testid=create-new]'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return b === top || b.contains(top); });
  })());

  // ---- 6. the entrants list shows them
  await comp(IDS.c1).locator('summary', { has: page.locator('b', { hasText: /^Entrants$/ }) }).click();
  const list = (await comp(IDS.c1).innerText()).replace(/\s+/g, ' ');
  check('6. the entrant list shows the added people', /Alex Existing/.test(list) && /Zed Newcomer/.test(list), list.slice(0, 400));
  check('6b. the list marks people without an account as Unclaimed profile', (list.match(/Unclaimed profile/gi) ?? []).length >= 3, list.slice(0, 600));
  await noSideways('Run with the Add entrant panel');
  await shot('p08-run-after');

  // ---- 7. group fights need the team they fight for
  await page.getByTestId(`add-entrant-${IDS.c2}`).scrollIntoViewIfNeeded();
  await page.getByTestId(`add-entrant-${IDS.c2}`).click();
  const mpanel = page.getByRole('group', { name: /Add entrant to Melee/ });
  await mpanel.getByTestId('entrant-search').fill('dana');
  await mpanel.getByTestId('entrant-results').waitFor();
  await mpanel.getByRole('button', { name: 'Add Dana Steel' }).click();
  await page.waitForFunction(() => /choose the team/i.test(document.body.innerText));
  check('7. a group fight asks which team before adding', await has('Choose the team this fighter fights for') && !db.entry_fighters.some(r => r.fighter_id === IDS.f7));
  await mpanel.getByTestId('entry-team').selectOption({ label: 'Red Deer Reavers' });
  await mpanel.getByRole('button', { name: 'Add Dana Steel' }).click();
  await page.waitForFunction(() => /1 entrant\b/.test(document.querySelector('section[aria-label^="Melee"]')?.innerText ?? ''));
  check('7b. she joins that team’s roster and the team counts as one entrant', db.entry_fighters.some(r => r.fighter_id === IDS.f7) && db.entries.some(e => e.competition_id === IDS.c2 && e.team_id === IDS.t1));

  // ---- 8. who is refused
  const stranger = await rpcAs(IDS.stranger, 'add_entrant', { p_competition: IDS.c1, p_fighter: IDS.f7 });
  check('8. a signed-in stranger cannot add entrants', stranger.status === 400 && stranger.body?.code === '42501');
  const strangerCreate = await rpcAs(IDS.stranger, 'create_unclaimed_fighter', { p_event: IDS.rumble, p_name: 'Nope Person', p_competition: IDS.c1 });
  check('8b. a stranger cannot create fighters', strangerCreate.body?.code === '42501' && !db.fighters.some(f => f.display_name === 'Nope Person'));
  db.event_staff.push({ event_id: IDS.spring, user_id: IDS.captain, role: 'organizer' });
  const other = await rpcAs(IDS.captain, 'add_entrant', { p_competition: IDS.c1, p_fighter: IDS.f7 });
  check('8c. an organizer of another event cannot change this event', other.body?.code === '42501' && !db.entries.some(e => e.competition_id === IDS.c1 && e.fighter_id === IDS.f7));
  const search = await rpcAs(IDS.captain, 'search_fighters_for_entry', { p_competition: IDS.c1, p_query: 'dana' });
  check('8d. nor can they search through this event’s entry tool', search.body?.code === '42501');

  // ---- 9. claiming
  await signIn(IDS.claimer, 'alexandra@example.test');
  await go(`/fighters/${zed.id}`);
  await page.getByTestId('claim-panel').waitFor();
  check('9. an unclaimed fighter page says "Unclaimed profile" and offers a claim', await has('Unclaimed profile') && await has('Is this you?'));
  await page.getByTestId(`claim-${zed.id}`).click();
  await page.getByTestId('claim-message').fill('I fought for Edmonton at Event One');
  await page.getByTestId('claim-send').click();
  await page.getByTestId('claim-sent').waitFor();
  check('9b. asking for a profile links nothing', !db.fighter_accounts[zed.id] && db.fighter_claims.length === 1 && db.fighter_claims[0].status === 'pending');
  check('9c. the person is told nothing changes until an administrator decides', await has('Nothing changes until then'));
  await noSideways('fighter page claim');
  await shot('p08-claim-request');
  await go('/claim-profile');
  check('9d. the claim page uses the invitation copy', await has('Already have fight history in BuhurtOS? Find and claim your fighter profile'));
  await page.getByTestId('claim-search').fill('alex existing');
  await page.getByTestId('claim-results').waitFor();
  check('9e. candidates show team, place and history to recognise', (await page.getByTestId('claim-results').locator('li').count()) === 3 && await has('Red Deer Reavers') && await has('Calgary'));
  await page.getByTestId(`claim-${IDS.fx}`).click();
  await page.getByTestId('claim-send').click();
  await page.getByTestId('claim-sent').waitFor();
  check('9f. a second request is recorded for a different fighter', db.fighter_claims.length === 2);
  await noSideways('claim page');
  await shot('p08-claim-page');

  // an account that already owns a fighter is routed to review, never silently given another
  await signIn(IDS.fighter, 'garrett@example.test');
  await go('/claim-profile');
  await page.getByTestId('claim-search').fill('zed');
  await page.getByTestId('claim-results').waitFor();
  check('9g. someone who already has a profile is told it will be checked, not replaced', await has('You already have a fighter profile'));
  await page.getByTestId(`claim-${zed.id}`).click();
  await page.getByTestId('claim-send').click();
  await page.getByTestId('claim-sent').waitFor();
  check('9h. their request is flagged for review', db.fighter_claims.at(-1).needs_review === true && await has('same person'));

  // ---- 10. only the platform owner decides
  const orgList = await rpcAs(IDS.organizer, 'list_fighter_claims', {});
  const orgDecide = await rpcAs(IDS.organizer, 'resolve_fighter_claim', { p_request: db.fighter_claims[0].id, p_decision: 'approve', p_note: 'organizer tries' });
  check('10. an event organizer cannot list or decide claims', orgList.body?.code === '42501' && orgDecide.body?.code === '42501' && !db.fighter_accounts[zed.id]);
  await signIn(IDS.organizer, 'orla@example.test');
  await go('/platform/fighters');
  check('10b. the organizer sees no claim controls on the platform page', !(await page.getByTestId('claim-reviews').count()));

  await signIn(IDS.owner, 'owner@example.test');
  await go('/platform/fighters');
  await page.getByTestId('claim-reviews').waitFor();
  const cardsN = await page.getByTestId('claim-card').count();
  check('10c. the administrator sees the waiting claims', cardsN === 3, String(cardsN));
  await noSideways('platform claims');
  await shot('p08-owner-claims');
  const fightersN = db.fighters.length, entriesN = db.entries.length;
  const zedCard = page.getByTestId('claim-card').filter({ hasText: 'Zed Newcomer' }).filter({ hasText: 'Alexandra Existing' });
  check('10d. a decision needs a note', await zedCard.getByTestId('claim-approve').isDisabled());
  await zedCard.getByTestId('claim-note').fill('Confirmed by email with the organizer');
  await zedCard.getByTestId('claim-approve').click();
  await page.getByTestId('claim-result').waitFor();
  check('10e. approval links the account to the SAME fighter', db.fighter_accounts[zed.id] === IDS.claimer);
  check('10f. no fighter was created or copied and every entry stayed', db.fighters.length === fightersN && db.entries.length === entriesN && db.entries.some(e => e.fighter_id === zed.id && e.competition_id === IDS.c1));
  check('10g. the person is told', db.notifications.some(n => n.user_id === IDS.claimer && n.kind === 'fighter_claim_decided' && n.payload.decision === 'approved'));
  // the garrett request for zed is now moot; the one already-owning claimant was auto-closed with the others
  check('10h. other requests for the same fighter were closed', db.fighter_claims.filter(c => c.fighter_id === zed.id && c.status === 'pending').length === 0);

  // the account that already has a fighter is never silently given another
  const alexCard = page.getByTestId('claim-card').filter({ hasText: 'Alex Existing' });
  check('10i. a claimant who already owns a profile is offered "Send to identity review", not an approval', (await alexCard.getByTestId('claim-approve').innerText()).includes('identity review') || (await alexCard.count()) === 0);
  const second = await rpcAs(IDS.claimer2, 'request_fighter_claim', { p_fighter: zed.id });
  check('10j. a second claimant cannot take an already claimed fighter', second.body?.code === '22023' && /already belongs/.test(second.body?.message ?? ''));

  // ---- 11. after approval
  await signIn(IDS.claimer, 'alexandra@example.test');
  await go(`/fighters/${zed.id}`);
  await page.getByRole('heading', { name: 'Zed Newcomer' }).waitFor();
  check('11. the claimed profile no longer says unclaimed or offers a claim', !(await has('Unclaimed profile')) && !(await page.getByTestId('claim-panel').count()));
  check('11b. the owner can edit it', await has('Edit my profile'));

  // ---- 12. nothing else broke
  check('12. no uncaught page errors in the whole run', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('script ran to the end', false, e.stack ?? e);
  await shot('p08-failure').catch(() => {});
} finally {
  await browser.close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
