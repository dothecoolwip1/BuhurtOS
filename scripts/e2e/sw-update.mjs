// Version transitions with pending scoring work, in a real Chromium: a waiting service worker must not take over an active scoring session,
// can be activated safely once the work is confirmed, and an emergency update keeps queued work and still delivers it.
//   node scripts/e2e/sw-update.mjs        (builds two versions itself; Supabase is mocked: scripts/e2e/mock-supabase.mjs)
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { IDS, REF, createMock, sessionFor, storageKey } from './mock-supabase.mjs';
import { startStaticServer } from './static-server.mjs';

const OUT = process.env.E2E_OUT ?? '/tmp/claude-0/sw-e2e';
const build = (dir, suffix) => execSync(`npx vite build --outDir ${dir} --emptyOutDir`, { env: { ...process.env, VITE_BASE: '/', ...(suffix ? { APP_VERSION_SUFFIX: suffix } : {}) }, stdio: 'ignore' });
build(`${OUT}/a`, ''); build(`${OUT}/b`, 'second-build');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + detail}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(250); } return false; };
const server = await startStaticServer(`${OUT}/a`);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });

async function session(label) {
  server.switchTo(`${OUT}/a`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mock = createMock();
  await ctx.route(`https://${REF}.supabase.co/**`, mock.handle);
  await ctx.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); }, [storageKey, sessionFor(IDS.userA, 'scorer-a@example.test')]);
  const page = await ctx.newPage();
  const errors = [];
  const logs = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => logs.push(m.type() + ': ' + m.text().slice(0, 160)));
  page.on('framenavigated', f => { if (f === page.mainFrame()) logs.push('navigated: ' + f.url()); });
  const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').toLowerCase();
  const has = async (t) => (await body()).includes(t.toLowerCase());
  const version = () => page.evaluate(() => new Promise(res => {
    const c = navigator.serviceWorker.controller; if (!c) return res(null);
    const ch = new MessageChannel(); ch.port1.onmessage = e => res(e.data.buildId); c.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  }));
  const cacheNames = () => page.evaluate(() => caches.keys());
  const idb = (store) => page.evaluate((s) => new Promise((res) => {
    const r = indexedDB.open('buhurtos-scoring'); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains(s)) return res([]); const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); };
  }), store);
  const url = `${server.base}/events/test-rumble/field/Field%201`;
  await page.goto(url);
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
  const idA = await version();
  check(`[${label}] the first build installs and controls the page`, typeof idA === 'string' && idA.length > 0);
  await page.getByRole('button', { name: 'Score Iron Wolves against Ash Guard' }).click();
  await page.getByText('Head or torso +2').first().waitFor();
  const diagnose = async () => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return JSON.stringify({ active: r?.active?.state, waiting: r?.waiting?.state, installing: r?.installing?.state, hasController: !!navigator.serviceWorker.controller, footer: document.querySelector('[data-testid=app-version]')?.textContent, url: location.href }); }).catch(e => 'diagnose failed: ' + e);
  return { ctx, page, mock, body, has, version, cacheNames, idb, idA, errors, url, logs, diagnose };
}
const startUpdate = async (s) => {
  server.switchTo(`${OUT}/b`);
  await s.page.evaluate(() => window.__bosCheckUpdate());
  await s.page.getByText('A new version of BuhurtOS is ready').waitFor({ timeout: 20000 });
};

try {
  // ======== Run 1: safe activation after the work is confirmed
  let s = await session('safe');
  globalThis.__diag = async () => JSON.stringify({ state: await s.diagnose(), logs: s.logs.slice(-6) });
  globalThis.__poke = async () => { await s.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); r.waiting?.postMessage({ type: 'SKIP_WAITING' }); }); await new Promise(r => setTimeout(r, 4000)); return s.diagnose(); };
  s.mock.st.offline = true;   // the API is unreachable (no signal to the server); the page itself stays online
  await s.page.getByRole('button', { name: 'Head or torso +2' }).first().click();
  await sleep(300);
  check('[safe] a score action is waiting on the device (pending work)', (await s.idb('outbox')).length === 1);
  await startUpdate(s);
  check('[safe] a waiting build does not take over while scoring with pending work', (await s.version()) === s.idA);
  check('[safe] the banner explains why it is waiting', await s.has('will not replace this version while'));
  check('[safe] there is no plain Update now button while it is unsafe', (await s.page.getByRole('button', { name: 'Update now' }).count()) === 0);
  await sleep(4000);
  check('[safe] still the old build after waiting (no timer-based takeover)', (await s.version()) === s.idA);
  check('[safe] the old build\'s cache is still there', (await s.cacheNames()).some(n => n.endsWith(s.idA)));
  // signal returns: the queue is delivered, the match is finished and made official, the screen is left
  s.mock.st.offline = false;
  for (let i = 0; i < 2; i++) { if (i > 0) await s.page.getByRole('button', { name: 'Head or torso +2' }).first().click(); }
  // finish the match: A needs 2 rounds
  await s.page.getByRole('button', { name: 'End round' }).click();
  await s.page.getByRole('button', { name: 'Head or torso +2' }).first().click();
  await s.page.getByRole('button', { name: 'End round' }).click();
  await s.page.getByText('wins the match').first().waitFor();
  await s.page.getByRole('button', { name: 'Finish match' }).click();
  await s.page.getByRole('button', { name: 'Save result' }).click();
  await s.page.getByText('Official: saved on the server').waitFor({ timeout: 20000 });
  check('[safe] with the scoring screen still open the update still waits', (await s.version()) === s.idA && !(await s.page.getByRole('button', { name: 'Update now' }).count()));
  await s.page.getByRole('button', { name: 'Back to the queue' }).click();
  await s.page.getByRole('button', { name: 'Update now' }).waitFor({ timeout: 20000 });
  check('[safe] once scoring is finished and confirmed the banner offers Update now', await s.has('Nothing is being scored on this device'));
  check('[safe] confirmed work left nothing behind on the device', (await s.idb('outbox')).length === 0 && (await s.idb('boards')).length === 0);
  await s.page.getByRole('button', { name: 'Update now' }).click();
  await s.page.waitForFunction(() => document.querySelector('[data-testid=app-version]')?.textContent?.includes('second-build'), null, { timeout: 30000 });
  await s.page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
  const idB = await s.version();
  check('[safe] after Update now the page runs the new build', idB !== s.idA && (await s.page.getByTestId('app-version').innerText()).includes('second-build'), `${s.idA} -> ${idB}`);
  check('[safe] the old build\'s cache was cleaned up', !(await s.cacheNames()).some(n => n.endsWith(s.idA)));
  check('[safe] no uncaught page errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();

  // ======== Run 2: an older queued command survives an emergency update and is delivered by the new build
  s = await session('emergency');
  globalThis.__diag = async () => JSON.stringify({ state: await s.diagnose(), logs: s.logs.slice(-25) });
  s.mock.st.offline = true;
  await s.page.getByRole('button', { name: 'Head or torso +2' }).first().click();
  await sleep(300);
  const queued = await s.idb('outbox');
  check('[emergency] an action queued by the old build is stored with schema version 1', queued.length === 1 && queued[0].schema === 1 && queued[0].userId === IDS.userA);
  await startUpdate(s);
  await s.page.getByRole('button', { name: 'Update anyway (emergency)' }).click();
  check('[emergency] the emergency update asks for confirmation first', await s.has('only do this if an organizer told you to'));
  check('[emergency] nothing changed yet', (await s.version()) === s.idA);
  await s.page.getByRole('button', { name: 'Yes, update now' }).click();
  await s.page.waitForFunction(() => document.querySelector('[data-testid=app-version]')?.textContent?.includes('second-build'), null, { timeout: 30000 });
  await s.page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
  check('[emergency] the page now runs the new build', (await s.version()) !== s.idA);
  const kept = await s.idb('outbox');
  check('[emergency] the queued action survived the update, unchanged', kept.length === 1 && kept[0].id === queued[0].id && kept[0].schema === 1 && kept[0].status === 'pending');
  check('[emergency] and so did the half-scored board', (await s.idb('boards')).length === 1);
  s.mock.st.offline = false;
  await until(() => s.mock.st.delivered.has(queued[0].id));   // the queue retries on its own every few seconds
  check('[emergency] the new build delivers the old build\'s action exactly once', s.mock.st.delivered.get(queued[0].id) === 1, JSON.stringify([...s.mock.st.delivered]));
  check('[emergency] no uncaught page errors', s.errors.length === 0, s.errors.join('|'));
  await s.ctx.close();

  // ======== Run 3: the browser never completes the handover (SKIP_WAITING is swallowed): the app still gets onto the new build, online, without losing work
  s = await session('fallback');
  globalThis.__diag = async () => JSON.stringify({ state: await s.diagnose(), logs: s.logs.slice(-6) });
  s.mock.st.offline = true;
  await s.page.getByRole('button', { name: 'Head or torso +2' }).first().click();
  await sleep(300);
  const q3 = await s.idb('outbox');
  await startUpdate(s);
  await s.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); if (r?.waiting) r.waiting.postMessage = () => {}; });   // simulate a browser that never hands over
  await s.page.getByRole('button', { name: 'Update anyway (emergency)' }).click();
  await s.page.getByRole('button', { name: 'Yes, update now' }).click();
  await sleep(1500);
  check('[fallback] with the handover swallowed the page is still on the old build for now', (await s.version()) === s.idA);
  await s.page.waitForFunction(() => document.querySelector('[data-testid=app-version]')?.textContent?.includes('second-build'), null, { timeout: 30000 });
  check('[fallback] after the wait the app reloaded onto the new build by itself', true);
  const kept3 = await s.idb('outbox');
  check('[fallback] the queued action and the board survived', kept3.length === 1 && kept3[0].id === q3[0].id && (await s.idb('boards')).length === 1);
  await s.page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
  check('[fallback] the new build is now the one controlling the page', (await s.version()) !== s.idA);
  s.mock.st.offline = false;
  await until(() => s.mock.st.delivered.has(q3[0].id));
  check('[fallback] and it delivers the action exactly once', s.mock.st.delivered.get(q3[0].id) === 1);
  await s.ctx.close();
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 400));
  try { console.log('DIAGNOSTICS', await globalThis.__diag?.()); if (globalThis.__poke) console.log('POKE', await globalThis.__poke()); } catch { /* ignore */ }
} finally {
  await browser.close(); await server.close();
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
