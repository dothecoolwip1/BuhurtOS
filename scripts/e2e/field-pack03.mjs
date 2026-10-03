// Drives the REAL built app in a REAL Chromium against a mocked Supabase (scripts/e2e/mock-supabase.mjs) and checks the scoring-resilience behaviour:
// IndexedDB outbox bound to the user, pending vs official, no signal, reconnect, no replay under another account, conflict, review, paper entry.
//   VITE_BASE=/ npx vite build --outDir /tmp/e2e-dist && npx vite preview --outDir /tmp/e2e-dist --port 4180 &
//   E2E_BASE=http://localhost:4180 node scripts/e2e/field-pack03.mjs
import { chromium } from 'playwright-core';
import { IDS, REF, createMock, sessionFor, storageKey } from './mock-supabase.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4180';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + detail}`); };
const SHOTS = process.env.E2E_SHOTS;
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const mock = createMock();
await ctx.route(`https://${REF}.supabase.co/**`, mock.handle);
const sessA = sessionFor(IDS.userA, 'scorer-a@example.test'), sessB = sessionFor(IDS.userB, 'scorer-b@example.test'), sessHead = sessionFor(IDS.head, 'head@example.test');
await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [storageKey, sessA]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
const url = `${BASE}/events/test-rumble/field/Field%201`;
const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').toLowerCase();
const has = async (text) => (await body()).includes(text.toLowerCase());
const idb = (store) => page.evaluate((s) => new Promise((res) => {
  const r = indexedDB.open('buhurtos-scoring'); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains(s)) return res([]); const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); }; r.onerror = () => res(null);
}), store);
const setSession = (s) => page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, s]);
const goOffline = async () => { mock.st.offline = true; await ctx.setOffline(true); };
const goOnline = async () => { mock.st.offline = false; await ctx.setOffline(false); };
const openMatch = async () => { await page.getByRole('button', { name: 'Score Iron Wolves against Ash Guard' }).click(); await page.getByText('Head or torso +2').first().waitFor(); };
const winMatchAsA = async () => {
  for (let r = 0; r < 2; r++) { await page.getByRole('button', { name: 'Head or torso +2' }).first().click(); await page.getByRole('button', { name: 'End round' }).click(); }
  await page.getByText('wins the match').first().waitFor();
};

try {
  // ---- 1. open, score while online
  await page.goto(url);
  await openMatch();
  check('field screen opens for a scorekeeper and shows the match as Pending until saved', await has('Pending: not official until you save'));

  // ---- 2. short loss of signal while the screen stays open
  await goOffline();
  await winMatchAsA();
  await sleep(500);
  let box = await idb('outbox');
  check('score actions are saved in IndexedDB while offline', box.length >= 4, `got ${box.length}`);
  check('each queued action is bound to the signed-in user, the event and has a schema version', box.every(e => e.userId === IDS.userA && e.eventId === IDS.event && e.schema === 1 && e.status === 'pending'));
  check('the screen says Pending, not synced', /pending: \d+ score actions? saved on this device/.test(await body()));

  // ---- 3. finalization needs signal: stays pending, never official
  await page.getByRole('button', { name: 'Finish match' }).click();
  await page.getByRole('button', { name: 'Save result' }).click();
  await page.getByText('Pending: NOT official yet').waitFor({ timeout: 20000 });
  await shot('pack03-pending');
  const sw = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
  check('the pending screen does not scroll sideways on a phone', sw[0] <= sw[1], JSON.stringify(sw));
  let t = await body();
  check('offline finalization shows Pending: NOT official', t.includes('pending: not official yet') && !t.includes('official: saved on the server'));
  check('it tells the operator to use the paper sheet', t.includes('paper score sheet'));
  check('no result reached the server', !mock.st.calls.some(c => c.fn === 'submit_match_result'));
  const boards = await idb('boards');
  check('the half-scored board is kept on the device, bound to the user and event', boards.length === 1 && boards[0].userId === IDS.userA && boards[0].eventId === IDS.event, JSON.stringify(boards));

  // ---- 4. user B on the same device cannot replay A's queue
  await setSession(sessB);
  await goOnline();
  await page.reload();
  await page.getByRole('button', { name: 'Score Iron Wolves against Ash Guard' }).waitFor();
  await sleep(10000);   // longer than the 8 s flush interval
  check('another account signed in on this device does not deliver the first account\'s work', !mock.st.calls.some(c => c.fn === 'record_score_event'), JSON.stringify(mock.st.calls.map(c => c.fn)));
  check('the first account\'s work is still on the device, untouched', (await idb('outbox')).filter(e => e.userId === IDS.userA).length >= 4);
  check('the screen explains that those actions belong to another account', await has('belong to another account'));

  // ---- 5. back to A: reconnect sends each action exactly once; the board survives the reload
  await setSession(sessA);
  await page.reload();
  await page.getByRole('button', { name: 'Score Iron Wolves against Ash Guard' }).waitFor();
  await sleep(2500);
  const counts = [...mock.st.delivered.values()];
  check('on reconnect every queued action is delivered exactly once', counts.length >= 4 && counts.every(c => c === 1), JSON.stringify(counts));
  check('the outbox is empty after delivery', (await idb('outbox')).filter(e => e.userId === IDS.userA).length === 0);
  await openMatch();
  check('the half-scored board came back from the device after a reload', await has('wins the match'));

  // ---- 6. finalize with signal; the reply is lost once; retrying re-sends the SAME command and still makes exactly one result
  mock.st.dropReplyOnce = true;
  await page.getByRole('button', { name: 'Finish match' }).click();
  await page.getByRole('button', { name: 'Save result' }).click();
  await page.getByText('Pending: NOT official yet').waitFor({ timeout: 20000 });
  check('when the reply is lost the screen stays Pending (it cannot know the result is official)', !(await has('Official: saved on the server')));
  const stored = (await idb('boards'))[0];
  check('the command id was stored on the device before it was sent', typeof stored?.finalizeCommandId === 'string');
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
  const sub = mock.st.calls.filter(c => c.fn === 'submit_match_result');
  check('both attempts carried the same command id, the opened version and schema 1', sub.length === 2 && sub[0].args.p_command === sub[1].args.p_command && sub[0].args.p_command === stored.finalizeCommandId && sub.every(x => x.args.p_expected_version === 3 && x.args.p_schema === 1), JSON.stringify(sub.map(s => s.args.p_command)));
  check('the server applied it exactly once', mock.st.applied === 1, String(mock.st.applied));
  check('only now does the screen say Official', await has('Official: saved on the server'));

  // ---- 7. a conflicting result from this device is kept, not made official
  mock.st.matches[0].queue_state = 'active'; mock.st.matches[0].result = null; mock.st.submit = 'conflict';
  await page.goto(url);
  await openMatch();
  await winMatchAsA();
  await page.getByRole('button', { name: 'Finish match' }).click();
  await page.getByRole('button', { name: 'Save result' }).click();
  await page.getByText('Needs review: not changed').waitFor({ timeout: 20000 });
  await shot('pack03-needs-review');
  t = await body();
  check('a conflict shows Needs review, says nothing was overwritten and does not claim Official', t.includes('nothing was overwritten') && !t.includes('official: saved on the server'));
  check('this device keeps its result for the head marshal', (await idb('boards')).some(b => b.review === 'conflict'));

  // ---- 8. the head marshal resolves it
  await setSession(sessHead);
  await page.goto(url);
  await page.getByRole('region', { name: 'Results that need review' }).waitFor({ timeout: 20000 });
  check('the head marshal sees the conflict with both results', (await has('Official now:')) && (await has('Other device (Scorer A)')));
  await shot('pack03-head-marshal');
  const keep = page.getByRole('button', { name: "Use the other device's result" });
  check('a decision needs a note first', await keep.isDisabled());
  await page.getByPlaceholder('e.g. checked against paper sheet 14').fill('checked against paper sheet 3');
  await keep.click();
  await sleep(800);
  check('the decision and its note are sent to the audited function', mock.st.resolved.length === 1 && mock.st.resolved[0].p_decision === 'use_proposal' && mock.st.resolved[0].p_note === 'checked against paper sheet 3', JSON.stringify(mock.st.resolved));

  // ---- 9. paper recovery
  await page.getByRole('button', { name: 'Enter a result from the score sheet' }).click();
  await page.getByLabel('Match').selectOption(IDS.m1);
  await page.getByLabel('Where does this come from?').fill('paper sheet 7');
  await page.getByRole('button', { name: 'Make this the official result' }).click();
  await sleep(800);
  check('paper recovery calls the audited official-result function with the note', mock.st.paper.length === 1 && mock.st.paper[0].p_note === 'paper sheet 7' && mock.st.paper[0].p_match === IDS.m1, JSON.stringify(mock.st.paper));

  // ---- 10. a scorekeeper does not get the review or paper tools
  await setSession(sessA);
  await page.goto(url);
  await page.getByRole('button', { name: 'Score Iron Wolves against Ash Guard' }).waitFor();
  check('a plain scorekeeper does not see Needs review or the paper form', !(await has('Enter official result from paper')));
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
} finally {
  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
