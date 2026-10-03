// Drives the REAL built app in a REAL Chromium at phone size (390x844) against a mocked Supabase (scripts/e2e/mock-rest.mjs) and checks
// the Pack 07 workflows: a synthetic event's own results, the publish checklist's Add competition path, waiver choices, organizer-added
// fighters (notification, pending, complete, withdraw), team and fighter social links, the gallery, the Calendar / My events views,
// test-data hiding, and the venue picker's manual fallback. It proves the app's behaviour; supabase/tests/pack07_gate.sql proves the database.
//   VITE_BASE=/ npx vite build --outDir /tmp/e2e-dist && npx vite preview --outDir /tmp/e2e-dist --port 4180 &
//   E2E_BASE=http://localhost:4180 node scripts/e2e/pack07-ux.mjs
// Optional: E2E_PLACES_BASE points at a second build made with VITE_GOOGLE_MAPS_BROWSER_KEY set, to prove the manual fallback when Google is unreachable.
import { chromium } from 'playwright-core';
import { IDS, REF, TINY_PNG, createMock, sessionFor, storageKey } from './mock-rest.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4180';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 300)}`); };
const SHOTS = process.env.E2E_SHOTS;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const mock = createMock();
await ctx.route(`https://${REF}.supabase.co/**`, mock.handle);
await ctx.route('https://maps.googleapis.com/**', r => r.abort('failed'));
await ctx.route(/posthog\.com/, r => r.abort('failed'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const has = async (text) => (await body()).toLowerCase().includes(text.toLowerCase());
const inc = (t, ...parts) => parts.every(x => t.toLowerCase().includes(x.toLowerCase()));
const signIn = async (id, email) => { await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, sessionFor(id, email)]); };
const signOut = async () => { await page.evaluate((k) => localStorage.removeItem(k), storageKey); };
const noSideways = async (label) => { const sw = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]); check(`${label}: no sideways scroll at 390px`, sw[0] <= sw[1], JSON.stringify(sw)); };
const go = async (path) => { await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle'); };

try {
  // ---- 15/19. anonymous: Calendar opens, test event hidden by default
  const rumbleMonth = mock.db.events.find(e => e.id === IDS.rumble).starts_on.slice(0, 7);
  await go('/calendar?month=' + rumbleMonth);
  await page.getByTestId('month-calendar').waitFor();
  check('15. an anonymous visitor can open the Calendar', await has('Calendar'));
  check('19a. the fictional event is hidden from the public calendar by default', !(await has('Steel Open-test')));
  check('15b. a real upcoming event is in the month agenda', await has('Red Deer Rumble'));
  await noSideways('calendar');
  await shot('p07-calendar');
  await page.locator('.cal-day:not([disabled])').first().click();
  check('15c. tapping a day lists that day', await has('Everything in'));

  // ---- 16. calendar search and filter (the same rules as the Events list)
  await page.getByTestId('event-search').fill('saskatoon');
  await sleep(300);
  check('16a. calendar search drops events that do not match', !(await has('Red Deer Rumble')));
  await page.getByTestId('event-search').fill('');
  await page.getByTestId('toggle-filters').click();
  await page.getByLabel('Province or state').selectOption('SK');
  await sleep(300);
  check('16b. the province filter keeps only Saskatchewan events', !(await has('Red Deer Rumble')));
  check('16c. the filter is in the address bar (shareable)', page.url().includes('province=SK'));
  check('16d. anonymous visitors are not offered the test-data toggle', (await page.getByTestId('show-test').count()) === 0);
  await go('/events?when=all&q=saskatoon');
  await page.getByTestId('event-list').waitFor();
  check('16e. the Events list shares the search: only the Saskatoon clinic matches', await has('Saskatoon Clinic') && !(await has('Red Deer Rumble')));

  // ---- 19/20. events list: test data hidden, toggle shows it for signed-in people
  await go('/events');
  await page.getByTestId('event-list').waitFor();
  check('19b. the Events list hides the fictional event by default', !(await has('Steel Open-test')) && await has('Red Deer Rumble'));
  await signIn(IDS.fighter, 'garrett@example.test');
  await go('/events?when=all');
  await page.getByTestId('event-list').waitFor();
  await page.getByTestId('toggle-filters').click();
  await page.getByTestId('show-test').click();
  await page.waitForURL(/test=1/);
  await sleep(400);
  check('20. the Show test data toggle reveals the fictional event, labelled Test data', await has('Steel Open-test') && await has('Test data'));
  check('20b. the toggle lives in the address bar', page.url().includes('test=1'));

  // ---- 1/2. the synthetic event's own results, and nothing official
  await go('/events/central-alberta-steel-open-test');
  await page.getByText('Event record').waitFor();
  check('1a. the fictional event page is marked as a test event', await has('fictional test event'));
  await page.getByRole('tab', { name: 'Results' }).click();
  await page.getByTestId('results-test-data').waitFor();
  const t1 = await body();
  check('1b. its Results tab shows its own placings instead of "No final placings"', inc(t1, 'Fake Fighter') && inc(t1, '1st') && !inc(t1, 'No final placings'));
  check('1c. the placings carry the TEST DATA / synthetic label', inc(t1, 'Test data / synthetic event'));
  check('1d. the page read the all-results view, not the official one', mock.st.calls.some(c => c.table === 'result_rows_all') && !mock.st.calls.some(c => c.table === 'result_rows'));
  await shot('p07-synthetic-results');
  await go('/fighters/' + IDS.f9);
  await page.getByText('Fake Fighter').first().waitFor();
  await sleep(500);
  const t2 = await body();
  check('2a. the fictional fighter\'s career statistics and tournament history stay empty (official views)', !/Events attended/.test(t2) && !inc(t2, 'Gold') && !inc(t2, 'Steel Open-test'));
  check('2b. rankings and statistics were read from the official views only', mock.st.calls.some(c => c.table === 'fighter_career_stats') && mock.st.calls.some(c => c.table === 'ranking_fighters'));
  await go('/rankings');
  await sleep(500);
  check('2c. the rankings page never reads an all-results view', !mock.st.calls.some(c => c.table === 'fighter_results_all' && c.q.includes('ranking')) && mock.st.calls.filter(c => c.table === 'result_rows_all').every(c => c.q.includes('event_id')));

  // ---- 3/4/21. organizer: create event -> blocked -> Add competition -> requirement clears; venue fallback
  await signIn(IDS.organizer, 'orla@example.test');
  await go('/events/new');
  await page.getByText('Create an event').first().waitFor();
  check('21a. without a Google key the venue fields are plain text and say so', await has('Address search is not switched on') && (await page.getByLabel('Venue').count()) === 1);
  await page.getByLabel('Event name').fill('Red Deer Rumble Winter');
  await page.getByLabel('First day').fill('2027-01-16');
  await page.getByLabel('Last day').fill('2027-01-17');
  await page.getByLabel('Venue').fill('Blackfalds Arena');
  await page.getByLabel('City').fill('Blackfalds');
  await page.getByLabel('Province or state').fill('AB');
  await page.getByRole('button', { name: 'Create event' }).click();
  await page.waitForURL(/manage\?tab=setup/);
  await page.getByText('This event is a draft').waitFor();
  await page.getByTestId('fix-competitions').waitFor();
  const t3 = await body();
  check('3a. a new tournament lands in Setup and publication is blocked on a competition', inc(t3, 'Publish is off until') && inc(t3, 'competition'));
  check('3b. an obvious "+ Add competition" button sits beside the requirement', (await page.getByTestId('fix-competitions').count()) === 1);
  check('21b. the venue typed by hand was saved with the draft', mock.db.events.some(e => e.slug === 'red-deer-rumble-winter' && e.venue === 'Blackfalds Arena' && e.city === 'Blackfalds'));
  await noSideways('setup');
  await page.getByTestId('fix-competitions').click();
  await page.getByLabel('Category').waitFor();
  await page.getByLabel('Category').selectOption('longsword');
  await page.getByLabel('Division').selectOption('women');
  check('4a. the competition name is suggested from category and division', (await page.getByLabel('Name (as fighters will see it)').inputValue()) === 'Longsword (women)');
  await page.getByTestId('save-competition').click();
  await page.getByTestId('competition-row').first().waitFor();
  await sleep(500);
  const t4 = await body();
  check('4b. the competition is saved and listed', inc(t4, 'Longsword (women)') && mock.db.competitions.some(c => c.name === 'Longsword (women)'));
  check('4c. the competition requirement is now ticked and Publish is no longer blocked by it', inc(t4, '✓ At least one competition is set up') && !inc(t4, 'at least one competition is set up.'));
  await shot('p07-setup-after-competition');

  // ---- 2 (waiver choices) on the new draft
  check('waiver: the three choices are obvious', (await page.getByTestId('waiver-template').count()) === 1 && (await page.getByTestId('waiver-upload').count()) === 1 && (await page.getByTestId('waiver-paste').count()) === 1);
  await page.getByTestId('waiver-template').click();
  const t5 = await body();
  check('waiver: the starter template says it is not legal advice', inc(t5, 'does not give legal advice'));
  await page.getByTestId('save-waiver').click();
  await sleep(300);
  check('waiver: the template cannot be saved with placeholders left in', await has('Replace [EVENT NAME]'));
  const ta = page.getByLabel('Full text people agree to');
  await ta.fill((await ta.inputValue()).replace(/\[[A-Z][A-Z /]+\]/g, 'Red Deer Rumble Winter'));
  await page.getByTestId('save-waiver').click();
  await page.getByTestId('waiver-upload').waitFor();
  await page.waitForFunction(() => document.body.innerText.includes('✓ A waiver is loaded'), null, { timeout: 10000 }).catch(() => {});
  const newEvent = mock.db.events.find(e => e.slug === 'red-deer-rumble-winter');
  check('waiver: saving made version 1 through the database function, from the template', mock.db.waiver_versions.some(w => w.event_id === newEvent.id && w.version === 1 && w.source === 'template'));
  check('waiver: the publish checklist is now satisfied', await has('✓ A waiver is loaded'));
  await page.getByTestId('waiver-upload').click();
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({ name: 'hacsa-waiver.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await page.getByTestId('save-waiver').click();
  await page.getByTestId('waiver-upload').waitFor();
  await page.waitForFunction(() => document.body.innerText.includes('version 2 · PDF'), null, { timeout: 10000 });
  check('waiver: an uploaded PDF became version 2 and version 1 is kept', mock.st.uploads.some(u => u.bucket === 'waiver-documents' && u.path.startsWith(newEvent.id + '/')) && mock.db.waiver_versions.filter(w => w.event_id === newEvent.id).length === 2);

  // ---- 5. organizer adds a fighter on the Rumble
  await go('/events/red-deer-rumble/manage?tab=fighters');
  await page.getByTestId('add-fighter').waitFor();
  await noSideways('fighters tab');
  await page.getByTestId('add-fighter').click();
  await page.getByLabel('Search BuhurtOS fighters by name').fill('garr');
  await page.getByRole('button', { name: /Garrett Robson/ }).click();
  await page.getByLabel('Longsword (men)').check();
  await page.getByTestId('confirm-add-fighter').click();
  await page.getByTestId('invitation-row').first().waitFor();
  await sleep(300);
  const t6 = await body();
  check('5a. the organizer added a known fighter to a competition', mock.db.event_invitations.some(i => i.fighter_id === IDS.f3 && i.event_id === IDS.rumble));
  check('5b. the fighter is NOT registered and NOT staff just by being added', mock.db.registrations.length === 0 && !mock.db.event_staff.some(s => s.user_id === IDS.fighter));
  check('7a. the organizer sees Pending fighter confirmation with form and waiver outstanding', /pending fighter confirmation/i.test(t6) && inc(t6, 'Pending form submission') && inc(t6, 'Pending waiver') && inc(t6, 'Added by organizer'), await page.getByTestId('invitation-row').first().innerText());
  await page.getByTestId('add-fighter').click();
  await page.getByLabel('Search BuhurtOS fighters by name').fill('dana');
  await page.getByRole('button', { name: /Dana Steel/ }).click();
  await page.getByLabel('Longsword (men)').check();
  await page.getByTestId('confirm-add-fighter').click();
  await sleep(400);
  check('5c. an unclaimed record can be added, with no faked notification and a clear "no linked account" state', await has('no BuhurtOS account') && await has('no linked account') && !mock.db.notifications.some(n => n.kind === 'event_invited' && n.user_id !== IDS.fighter));
  await shot('p07-fighters-tab');

  // ---- 6. the fighter sees the notification and the event page explains
  await signIn(IDS.fighter, 'garrett@example.test');
  await go('/events/red-deer-rumble');
  await page.getByTestId('invitation-card').waitFor();
  check('6a. the bell shows an unread notification', /Notifications, 1 unread/.test(await page.getByRole('button', { name: /Notifications/ }).getAttribute('aria-label')));
  await page.getByRole('button', { name: /Notifications/ }).click();
  check('6b. the notification says the organizers added them', await has('organizers added you to Red Deer Rumble'));
  await page.keyboard.press('Escape');
  check('6c. the event page says "The organizers added you" with the competition and a Complete button', await has('The organizers added you to this event') && await has('Longsword (men)') && (await page.getByTestId('complete-registration').count()) === 1);
  await noSideways('event page with invitation');

  // ---- 7. still pending until the form and waiver are done; then Ready
  await page.getByTestId('complete-registration').click();
  await page.getByTestId('invited-note').waitFor();
  check('7b. the form says the organizers added them and pre-ticks their competition', await page.getByLabel('Longsword (men)').isChecked());
  await page.getByLabel('Full name', { exact: true }).fill('Garrett Robson');
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await page.getByRole('button', { name: 'HACSA' }).click();
  await page.getByLabel('Where are you from?').selectOption('AB');
  await page.getByText('Saturday', { exact: false }).click();
  await page.getByRole('button', { name: 'No', exact: true }).click();
  await page.getByText('Yes, I am a HACSA member', { exact: false }).click();
  await page.getByLabel('Emergency contact name').fill('Pat Robson');
  await page.getByLabel('Emergency contact phone').fill('4035550100');
  await page.getByText('I declare that I am medically fit').click();
  await page.getByText('I have read and agree to the waiver').click();
  await page.getByLabel('Type your full name to sign').fill('Garrett Robson');
  await page.getByRole('button', { name: 'Submit registration' }).click();
  await page.getByText('Thank you, you are in').waitFor();
  check('7c. completing the form and waiver registers them: the invitation is linked and the registration accepted', mock.db.event_invitations.find(i => i.fighter_id === IDS.f3).status === 'registered' && mock.db.registrations.some(r => r.user_id === IDS.fighter && r.status === 'accepted' && r.waiver_version_id === IDS.w1));
  await signIn(IDS.organizer, 'orla@example.test');
  await go('/events/red-deer-rumble/manage?tab=fighters');
  await page.getByTestId('invitation-row').first().waitFor();
  check('7d. the organizer now sees Ready for that fighter', /ready/i.test(await page.getByTestId('invitation-row').first().innerText()));

  // ---- 8. the fighter can withdraw (a fresh invitation on another event of this organizer)
  mock.db.events.find(e => e.id === IDS.spring).starts_on = '2027-03-01'; mock.db.events.find(e => e.id === IDS.spring).ends_on = '2027-03-01';
  mock.db.competitions.push({ id: '00000000-0000-0000-0000-0000000c0022', event_id: IDS.spring, name: 'Sabre (open)', category: 'sabre', gender: 'open', tier: null, ruleset: null, structure: 'round_robin', rounds_to_win: null, sort: 1, status: 'setup' });
  await go('/events/spring-open/manage?tab=fighters');
  await page.getByTestId('add-fighter').click();
  await page.getByLabel('Search BuhurtOS fighters by name').fill('garr');
  await page.getByRole('button', { name: /Garrett Robson/ }).click();
  await page.getByLabel('Sabre (open)').check();
  await page.getByTestId('confirm-add-fighter').click();
  await page.getByTestId('invitation-row').first().waitFor();
  await signIn(IDS.fighter, 'garrett@example.test');
  await go('/events/spring-open');
  await page.getByTestId('invitation-card').waitFor();
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page.getByTestId('confirm-withdraw').click();
  await sleep(500);
  check('8a. the fighter withdrew: the card is gone and the organizers were told', (await page.getByTestId('invitation-card').count()) === 0 && mock.db.event_invitations.find(i => i.event_id === IDS.spring).status === 'withdrawn' && mock.db.notifications.some(n => n.kind === 'registration_withdrawn' && n.user_id === IDS.organizer));

  // ---- 17/18. My events and My calendar: relationships only, never "owner of everything"
  await go('/my-events');
  await page.getByTestId('event-list').waitFor();
  const t7 = await body();
  check('17a. My events lists the event the fighter is registered for, with the role', inc(t7, 'Red Deer Rumble') && inc(t7, 'Fighter'));
  check('17b. and not the events they have nothing to do with', !inc(t7, 'Saskatoon Clinic') && !inc(t7, 'Spring Open'));
  await go('/calendar?mine=1&month=' + mock.db.events.find(e => e.id === IDS.rumble).starts_on.slice(0, 7));
  await page.getByTestId('month-calendar').waitFor();
  const t8 = await body();
  check('17c. My calendar shows only the relevant event in its month', inc(t8, 'Red Deer Rumble') && !inc(t8, 'Saskatoon Clinic'));
  await signIn(IDS.owner, 'owner@example.test');
  await go('/my-events');
  await sleep(600);
  const t9 = await body();
  check('18a. the platform owner\'s My events does not dump every event in', inc(t9, 'not part of any event yet') && !inc(t9, 'Red Deer Rumble'));
  check('18b. the owner is pointed to Platform → Events for everything', inc(t9, 'Platform'));
  await go('/platform/events');
  await page.getByTestId('event-list').waitFor();
  const t10 = await body();
  check('18c. Platform → Events lists every event, test data included', inc(t10, 'Red Deer Rumble') && inc(t10, 'Steel Open-test') && inc(t10, 'Saskatoon Clinic'));
  await noSideways('platform events');

  // ---- 9. team social link: saves and displays publicly
  await signIn(IDS.captain, 'cap@example.test');
  await go('/teams/red-deer-reavers/edit');
  await page.getByText('Social links').first().waitFor();
  await page.getByLabel('Add a link').selectOption('instagram');
  const ig = page.locator('#team-social-instagram');
  await ig.fill('instagram.com/reavers.ab');
  await ig.blur();
  check('9a. a bare "instagram.com/…" typed on a phone is completed to https://', (await ig.inputValue()) === 'https://instagram.com/reavers.ab');
  await page.getByRole('button', { name: 'Save team' }).click();
  await page.waitForURL(/\/teams\/red-deer-reavers$/);
  check('9b. the saved payload carries the link', mock.db.teams[0].social_links.instagram === 'https://instagram.com/reavers.ab');
  await signOut();
  await go('/teams/red-deer-reavers');
  const link = page.locator('.sociallink[data-network="instagram"]');
  await link.waitFor();
  check('9c. after reload the public team page shows an Instagram button near the name with the right address', (await link.getAttribute('href')) === 'https://instagram.com/reavers.ab' && (await link.getAttribute('target')) === '_blank');
  check('9d. the link row sits under the team identity, not buried in About', await page.evaluate(() => { const l = document.querySelector('.sociallink'); const about = [...document.querySelectorAll('h3')].find(h => h.textContent === 'About'); return Boolean(l && about && l.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  await noSideways('team page');
  await shot('p07-team-links');

  // ---- 10. fighter social link
  await signIn(IDS.fighter, 'garrett@example.test');
  await go('/fighters/' + IDS.f3 + '/edit');
  await page.getByText('Social links').first().waitFor();
  await page.getByLabel('Add a link').selectOption('x');
  await page.locator('#fighter-social-x').fill('Https://x.com/garrett');
  await page.locator('#fighter-social-x').blur();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.waitForURL(new RegExp(`/fighters/${IDS.f3}$`));
  await page.locator('.sociallink[data-network="x"]').waitFor();
  check('10. a fighter saves a social link (auto-capitalised scheme fixed) and the public profile shows it', mock.db.fighters.find(f => f.id === IDS.f3).social_links.x === 'https://x.com/garrett' && (await page.locator('.sociallink[data-network="x"]').getAttribute('href')) === 'https://x.com/garrett');
  check('10b. a profile with no links shows no empty link row', (await page.evaluate(() => document.querySelectorAll('.sociallinks').length)) === 1);

  // ---- 11/12/13/14. gallery
  await go('/fighters/' + IDS.f3 + '/edit');
  await page.getByTestId('gallery-add').waitFor();
  check('14a. with no photos the public page shows no gallery placeholder', !(await (await (async () => { await page.goto(`${BASE}/fighters/${IDS.f3}`); await page.getByText('Garrett Robson').first().waitFor(); return page; })()).getByTestId('fighter-gallery').count()));
  await go('/fighters/' + IDS.f3 + '/edit');
  await page.getByTestId('gallery-add').waitFor();
  const files = (n) => Array.from({ length: n }, (_, i) => ({ name: `photo${i}.png`, mimeType: 'image/png', buffer: TINY_PNG }));
  await page.getByTestId('gallery-input').setInputFiles(files(3));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=gallery-item]').length === 3, null, { timeout: 20000 });
  check('11a. three photos were shrunk in the browser and uploaded into the fighter\'s own folder', mock.st.uploads.filter(u => u.bucket === 'fighter-gallery').length === 3 && mock.st.uploads.filter(u => u.bucket === 'fighter-gallery').every(u => u.path.startsWith(IDS.f3 + '/') && /image\/(webp|jpeg)/.test(u.type)), JSON.stringify(mock.st.uploads));
  check('11b. each upload was recorded through the owner-only function', mock.db.fighter_gallery.filter(g => g.fighter_id === IDS.f3).length === 3);
  await page.getByTestId('gallery-input').setInputFiles(files(8));
  await page.waitForFunction(() => document.body.innerText.includes('Gallery full'), null, { timeout: 30000 });
  check('12a. the eleventh photo is refused: ten are kept and the button says Gallery full', mock.db.fighter_gallery.filter(g => g.fighter_id === IDS.f3).length === 10 && (await has('at most 10 photos')));
  check('12b. the app never asked the server to add an eleventh', mock.st.calls.filter(c => c.fn === 'add_my_gallery_photo').length === 10);
  await page.getByRole('button', { name: 'Move photo 2 earlier' }).click();
  await sleep(400);
  check('11c. reordering is saved through the database function', mock.st.calls.some(c => c.fn === 'reorder_my_gallery' && c.args.p_ids.length === 10));
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Remove photo 10' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=gallery-item]').length === 9, null, { timeout: 10000 });
  check('11d. removing a photo deletes the row and the file', mock.db.fighter_gallery.filter(g => g.fighter_id === IDS.f3).length === 9 && [...mock.st.storage.keys()].filter(k => k.startsWith('fighter-gallery/')).length === 9);
  await noSideways('gallery editor');
  await shot('p07-gallery-edit');
  // 13. another fighter's gallery
  await signIn(IDS.captain, 'cap@example.test');
  await go('/fighters/' + IDS.f3 + '/edit');
  await sleep(500);
  check('13. another person cannot open the fighter\'s gallery editor', await has('This is not your profile') && (await page.getByTestId('gallery-add').count()) === 0);
  // 14. public gallery
  await signOut();
  await go('/fighters/' + IDS.f3);
  await page.getByTestId('fighter-gallery').waitFor();
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.gallerygrid')).gridTemplateColumns.split(' ').length);
  check('14b. the public page shows the gallery in two columns on a phone', cols === 2 && (await page.locator('.gallerygrid .thumb').count()) === 9, `columns ${cols}`);
  await page.locator('.gallerygrid .thumb').first().click();
  await page.getByTestId('lightbox').waitFor();
  check('14c. tapping a thumbnail opens the full-screen viewer', await has('1 / 9'));
  await page.getByRole('button', { name: 'Next photo' }).click();
  check('14d. the viewer moves to the next photo', await has('2 / 9'));
  await page.keyboard.press('Escape');
  check('14e. Escape closes it', (await page.getByTestId('lightbox').count()) === 0);
  await noSideways('public fighter page');
  await shot('p07-fighter-public');

  // ---- phone checks: tabs and bottom bar
  await signIn(IDS.organizer, 'orla@example.test');
  await go('/events/red-deer-rumble/manage?tab=setup');
  await page.getByText('Event details').waitFor();
  const seg = await page.evaluate(() => { const s = document.querySelector('.seg.scroll'); return s ? [s.scrollWidth, s.clientWidth, getComputedStyle(s).overflowX] : null; });
  check('phone: the Manage areas stay on one swipeable line instead of clipping', seg !== null && seg[2] === 'auto', JSON.stringify(seg));
  const covered = await page.evaluate(() => { const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Save changes')); btn.scrollIntoView({ block: 'center' }); const r = btn.getBoundingClientRect(); const bar = document.querySelector('nav.bottom').getBoundingClientRect(); return r.bottom <= bar.top; });
  check('phone: the sticky bottom bar does not cover a scrolled-to control', covered);
  // ---- 21c. a build WITH a Google key whose script cannot load: the picker says so and the plain fields still work
  if (process.env.E2E_PLACES_BASE) {
    await page.goto(`${process.env.E2E_PLACES_BASE}/events/new`);   // another origin: sign in there too
    await signIn(IDS.organizer, 'orla@example.test');
    await page.reload();
    await page.getByLabel('Find the venue or address').waitFor();
    await page.getByLabel('Find the venue or address').fill('Horse In Hand');
    await page.waitForFunction(() => document.body.innerText.includes('Address search is not available right now'), null, { timeout: 15000 });
    check('21c. with a key but Google unreachable, the picker says search is unavailable and keeps the plain fields', (await page.getByLabel('Venue', { exact: true }).count()) === 1 && (await page.getByLabel('City', { exact: true }).count()) === 1);
    await page.getByLabel('Venue', { exact: true }).fill('Typed By Hand Hall');
    check('21d. manual entry still works', (await page.getByLabel('Venue', { exact: true }).inputValue()) === 'Typed By Hand Hall');
    const list = await page.evaluate(() => document.querySelector('.venuelist'));
    check('21e. no dropdown is left hanging over the page', list === null);
  }
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 400));
} finally {
  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
