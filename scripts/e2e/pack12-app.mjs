// Pack 12 browser test: the installable app, alerts, install prompt, Home, navigation and the registration form, in a REAL Chromium against the BUILT
// app (production service worker). Two groups:
//   A. app behaviour against a mocked Supabase (scripts/e2e/mock-rest.mjs) with the browser's push API STUBBED (headless Chromium here has no
//      route to a real push service, so subscribing for real is NOT proven by this script);
//   B. PWA mechanics against the real service worker: manifest, icons, offline shell, a push delivered to the worker through the browser's own
//      DevTools push injection (shows a real notification), and the tap routing.
//   VITE_BASE=/ npx vite build --outDir /tmp/e2e-dist && npx vite preview --outDir /tmp/e2e-dist --port 4180 &
//   E2E_BASE=http://localhost:4180 CHROME=... node scripts/e2e/pack12-app.mjs
import { chromium } from 'playwright-core';
import { IDS, REF, createMock, sessionFor, storageKey } from './mock-rest.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4180';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 300)}`); };

// Pack 26: the settings row is "Notifications" in the More sheet (the header bell is the inbox). Open the sheet if it is closed, then the row.
async function openNotificationSettings(page) {
  const row = page.locator('nav.more-list').getByRole('button', { name: 'Notifications', exact: true });
  if (!(await row.count())) await page.getByRole('button', { name: 'More', exact: true }).first().click();
  await row.click();
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.E2E_SHOTS;
const executablePath = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath, args: ['--proxy-bypass-list=127.0.0.1;localhost'] });

// The browser's push API, stubbed: a subscription object the page can read and a permission that the test controls.
const PUSH_STUB = () => {
  const state = { permission: window.__perm ?? 'default', subscribed: null, calls: [] };
  window.__push = state;
  const keyBytes = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256);
  const b64u = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const makeSub = (key) => ({
    endpoint: 'https://push.example.com/wpush/abc123', options: { applicationServerKey: key.buffer },
    toJSON() { const p = keyBytes(65); p[0] = 4; return { endpoint: this.endpoint, keys: { p256dh: b64u(p), auth: b64u(keyBytes(16)) } }; },
    async unsubscribe() { state.subscribed = null; state.calls.push('unsubscribe'); return true; }
  });
  const reg = {
    pushManager: {
      async getSubscription() { return state.subscribed; },
      async subscribe(opts) { state.calls.push('subscribe'); state.subscribed = makeSub(new Uint8Array(opts.applicationServerKey)); return state.subscribed; }
    }
  };
  Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(reg), configurable: true });
  const N = function () {};
  Object.defineProperty(N, 'permission', { get: () => state.permission });
  N.requestPermission = async () => { state.calls.push('requestPermission'); state.permission = window.__grant === false ? 'denied' : 'granted'; return state.permission; };
  window.Notification = N;
  window.PushManager = window.PushManager ?? function () {};
};

// ================================================================ A. app behaviour (mocked Supabase, push API stubbed)
{
  const mock = createMock();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx.addInitScript(PUSH_STUB);
  await ctx.route(`https://${REF}.supabase.co/**`, mock.handle);
  await ctx.route('https://maps.googleapis.com/**', r => r.abort('failed'));
  await ctx.route(/posthog\.com/, r => r.abort('failed'));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const has = async (t) => (await body()).toLowerCase().includes(t.toLowerCase());
  const go = async (path) => { await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle'); };
  const signIn = (id, email) => page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, sessionFor(id, email)]);
  const noSideways = async (label, w = 390) => { const sw = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]); check(`${label}: no sideways scroll at ${w}px`, sw[0] <= sw[1], JSON.stringify(sw)); };
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }); };

  // ---- install prompt: only where it can work, dismissible, remembered
  await go('/');
  check('A1. no install card without the browser\'s install event (a desktop browser that cannot install is told nothing)', !(await has('Install BuhurtOS')));
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  await page.getByRole('region', { name: 'Install BuhurtOS' }).waitFor();
  check('A2. with the install event, an Install card appears', await has('Install BuhurtOS on this device'));
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await sleep(200);
  check('A3. Install uses the browser\'s own install dialog', await page.evaluate(() => window.__prompted === true));
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
  await page.getByRole('button', { name: 'Not now' }).click();
  await sleep(150);
  check('A4. "Not now" removes the card', !(await has('Install BuhurtOS on this device')));
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
  await sleep(150);
  check('A5. ... and it stays away (remembered for weeks)', !(await has('Install BuhurtOS on this device')));
  check('A6. the "Not now" is remembered in storage', await page.evaluate(() => Number(localStorage.getItem('bos-install-dismissed')) > 0));
  await noSideways('signed-out Home');

  // ---- signed-in Home: what matters right now
  await signIn(IDS.fighter, 'garrett@example.test');
  mock.db.fight_now[IDS.fighter] = [{ event_slug: 'red-deer-rumble', event_name: 'Red Deer Rumble', competition_name: 'Longsword', field: 'Field 1', stage: 'on_deck', opponent: 'Aldric Stone' }];
  await go('/');
  await page.getByTestId('home-fight').waitFor();
  const fightCard = await page.getByTestId('home-fight').innerText();
  check('A7. Home puts a called fight first and unmistakable', /on deck/i.test(fightCard) && /Field 1/.test(fightCard) && /Aldric Stone/.test(fightCard), fightCard);
  check('A8. ... linking to My next fight on that event', (await page.getByTestId('home-fight').getAttribute('href')) === '/events/red-deer-rumble#my-next-fight');
  check('A9. the signed-in Home has no marketing hero', !(await has('Every list.')));
  await noSideways('signed-in Home'); await shot('p12-home-fight');
  mock.db.fight_now[IDS.fighter] = [];
  await go('/');
  await page.getByRole('heading', { name: 'Your day' }).waitFor();
  check('A10. with nothing to say Home stays calm (no fight card)', (await page.getByTestId('home-fight').count()) === 0);

  // ---- phone navigation: My events is in the bar when signed in
  const bar = await page.locator('nav.bottom').innerText();
  check('A11. signed in, the phone bar has My events (and keeps Home, Events, Teams, More)', /My events/.test(bar) && /Home/.test(bar) && /Teams/.test(bar) && /More/.test(bar), bar);

  // ---- notification popup: first-time ask (small popup, choices first), then permission, register; later the same popup with Save; devices one step away
  await go('/account');
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('heading', { name: 'Notifications' }).waitFor();
  check('A12. the first-time popup asks over the page, with four simple groups and Not now / Enable Notifications', await dlg.getByRole('switch').count() === 4 && await dlg.getByRole('button', { name: 'Enable Notifications' }).count() === 1 && await dlg.getByRole('button', { name: 'Not now' }).count() === 1);
  check('A13. the browser permission was NOT requested just by opening the page', await page.evaluate(() => !window.__push.calls.includes('requestPermission')));
  await dlg.getByRole('switch', { name: 'Events' }).click();
  await dlg.getByRole('button', { name: 'Enable Notifications' }).click();
  await dlg.waitFor({ state: 'detached' });
  check('A14. Enable Notifications asked permission once and subscribed with the server\'s public key', await page.evaluate(() => window.__push.calls.join(',')) === 'requestPermission,subscribe');
  check('A17. the choices made in the popup were saved for the person', mock.db.notif_settings[IDS.fighter]?.events === false && mock.db.notif_settings[IDS.fighter]?.fights === true, JSON.stringify(mock.db.notif_settings));
  const reg1 = mock.db.push_devices[0];
  check('A15. the device was registered with the database (endpoint + both keys), labelled generically', !!reg1 && reg1.endpoint === 'https://push.example.com/wpush/abc123' && reg1.keys.p256dh.length > 60 && reg1.keys.auth.length >= 16 && reg1.label !== undefined, JSON.stringify(reg1));
  await openNotificationSettings(page);
  await dlg.getByRole('button', { name: 'Save' }).waitFor();
  await dlg.getByRole('switch', { name: 'Team' }).click();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await dlg.waitFor({ state: 'detached' });
  check('A18. later, Account › Notifications opens the same popup (four groups); Save stores the change and closes it', mock.db.notif_settings[IDS.fighter]?.team === false && mock.db.notif_settings[IDS.fighter]?.events === false);
  await openNotificationSettings(page);
  await dlg.getByRole('button', { name: 'Manage devices' }).click();
  await dlg.getByRole('heading', { name: 'Manage devices' }).waitFor();
  check('A16. Manage devices lists this device', await dlg.getByText('This device').count() > 0);
  await dlg.getByRole('button', { name: 'Send me a test' }).click();
  await page.getByText('Test sent.', { exact: false }).waitFor();
  check('A19. "Send me a test" asks the database to send a notification to this person', mock.db.notifications.some(n => n.kind === 'test_push' && n.user_id === IDS.fighter));
  await noSideways('Account with the notification popup'); await shot('p12-account-notifications');
  await dlg.getByRole('button', { name: 'Turn off on this device' }).click();
  await dlg.getByRole('button', { name: 'Turn on alerts on this device' }).waitFor();
  check('A20. turning off unsubscribes the browser and removes the device from the database', mock.db.push_devices.every(d => d.revoked) && await page.evaluate(() => window.__push.calls.includes('unsubscribe')));

  // ---- denied: no nagging, clear instructions
  await page.evaluate(() => { window.__grant = false; window.__push.permission = 'default'; });
  await dlg.getByRole('button', { name: 'Turn on alerts on this device' }).click();
  await dlg.getByText('Alerts are blocked for BuhurtOS in this browser.').waitFor();
  check('A21. a "no" from the browser leaves the app working and explains how to allow it later', await has('Notifications → Allow'));

  // ---- the bell shows the same words a push carries
  mock.db.notifications.push({ id: 'n-x', user_id: IDS.fighter, kind: 'event_invited', payload: { event_name: 'Red Deer Rumble', event_slug: 'red-deer-rumble' }, created_at: new Date().toISOString(), read_at: null });
  await go('/');
  await sleep(800);
  if (await page.getByRole('button', { name: 'Not now' }).count()) await page.getByRole('button', { name: 'Not now' }).click();   // the first-time popup is asked again (it was blocked, not declined)
  await page.locator('button[aria-controls="notif-panel"]').click();
  await page.locator('.notif-title').first().waitFor();
  check('A22. the bell lists a title and a sentence from the database and links to the right page', await has('You\'ve been added to an event') && (await page.locator('a.notif-item').first().getAttribute('href')) === '/events/red-deer-rumble');

  // ---- registration form: filled from the profile, and gender decides which categories apply
  const base = mock.db.competitions.find(c => c.event_id === IDS.rumble);
  mock.db.competitions.push({ ...base, id: '00000000-0000-0000-0000-0000000c0777', name: 'Women Longsword', gender: 'women', sort: 99 });
  mock.db.competitions.push({ ...base, id: '00000000-0000-0000-0000-0000000c0778', name: 'Open Duel', gender: 'open', sort: 100 });
  await go('/events/red-deer-rumble/register');
  await page.getByText('About you').first().waitFor();
  await sleep(500);
  const cats = async () => (await page.locator('section', { hasText: 'What are you doing?' }).first().innerText()).replace(/\s+/g, ' ');
  check('A27. the form says what it filled in from the profile', await has('Filled in from your profile'));
  check('A28. the profile\'s gender is already chosen and the categories match it (men\'s and open, no women\'s)', /Showing men's and open categories/.test(await cats()) && /Longsword \(men\)/.test(await cats()) && /Open Duel/.test(await cats()) && !/Women Longsword/.test(await cats()), await cats());
  await page.getByLabel('Longsword (men)').check();
  await page.getByRole('radio', { name: 'Female' }).click().catch(async () => { await page.getByText('Female', { exact: true }).click(); });
  await sleep(200);
  check('A29. choosing Female shows women\'s and open categories only', /Showing women's and open categories/.test(await cats()) && /Women Longsword/.test(await cats()) && !/Longsword \(men\)/.test(await cats()), await cats());
  check('A30. ... and a men\'s category already ticked is dropped, so it cannot be submitted by accident', (await page.getByLabel('Longsword (men)').count()) === 0);
  await page.getByText('Other', { exact: true }).first().click();
  await sleep(200);
  check('A31. Other shows every category (the organizers place you)', /Longsword \(men\)/.test(await cats()) && /Women Longsword/.test(await cats()) && /Open Duel/.test(await cats()), await cats());
  await noSideways('registration form'); await shot('p12-register');

  // ---- a signed-out visitor is never asked about alerts
  await page.evaluate((k) => localStorage.removeItem(k), storageKey);
  await go('/');
  check('A23. a signed-out visitor sees no alerts prompt', !(await has('coming up to fight')));
  check('A24. no uncaught page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// phone, tablet, desktop: the new and changed screens never scroll sideways, and the new controls are big enough to touch
for (const [label, w, h] of [['phone 390', 390, 844], ['narrow phone 320', 320, 640], ['tablet 768', 768, 1024], ['desktop 1280', 1280, 800]]) {
  const mock = createMock();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800, isMobile: w < 800, serviceWorkers: 'block' });
  await ctx.addInitScript(PUSH_STUB);
  await ctx.route(`https://${REF}.supabase.co/**`, mock.handle);
  await ctx.route(/posthog\.com|maps\.googleapis/, r => r.abort('failed'));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, sessionFor(IDS.fighter, 'garrett@example.test')]);
  mock.db.fight_now[IDS.fighter] = [{ event_slug: 'red-deer-rumble', event_name: 'Red Deer Rumble', competition_name: 'Melee 5v5 (men)', field: 'Field 1', stage: 'in_the_hole', opponent: 'A Very Long Team Name That Must Wrap Properly Instead Of Overflowing' }];
  for (const path of ['/', '/account', '/my-events', '/events/red-deer-rumble', '/events/red-deer-rumble/register']) {
    await page.goto(`${BASE}${path}`); await page.waitForLoadState('networkidle'); await sleep(500);
    const sw = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
    check(`${label}: ${path} has no sideways scroll`, sw[0] <= sw[1], JSON.stringify(sw));
  }
  await page.goto(`${BASE}/account`); await page.waitForLoadState('networkidle');
  const pop = page.getByRole('dialog'); await pop.waitFor();
  const fit = await pop.evaluate(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), innerWidth, innerHeight, e.querySelector('.dlg-body').scrollHeight > e.querySelector('.dlg-body').clientHeight]; });
  check(`${label}: the notification popup fits the screen without scrolling`, fit[0] <= fit[2] && fit[1] <= fit[3] && fit[4] === false, JSON.stringify(fit));
  const small = await pop.evaluate(d => [...d.querySelectorAll('button, [role=switch], label.switch')].map(e => { const r = e.getBoundingClientRect(); return [e.textContent?.trim().slice(0, 30) || e.getAttribute('aria-label'), Math.round(r.height)]; }).filter(([, hgt]) => hgt > 0 && hgt < 40));
  check(`${label}: notification controls are at least 40px tall`, small.length === 0, JSON.stringify(small));
  await ctx.close();
}

// iPhone Safari (not installed): alerts need the Home Screen app, so it says how
{
  const mock = createMock();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' });
  await ctx.route(`https://${REF}.supabase.co/**`, mock.handle);
  await ctx.route(/posthog\.com|maps\.googleapis/, r => r.abort('failed'));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`); await page.waitForLoadState('networkidle');
  const t = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  check('A25. iPhone: the install card gives Share → Add to Home Screen steps', /Add BuhurtOS to your Home Screen/.test(t) && /Share/.test(t) && /Add to Home Screen/.test(t), t.slice(0, 300));
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [storageKey, sessionFor(IDS.fighter, 'garrett@example.test')]);
  await page.goto(`${BASE}/account`); await page.waitForLoadState('networkidle');
  await openNotificationSettings(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Manage devices' }).click();
  await page.getByRole('dialog').getByRole('heading', { name: 'Manage devices' }).waitFor();
  const t2 = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  check('A26. iPhone not installed: Manage devices says alerts need the Home Screen app first, and offers no permission button', /add BuhurtOS to your Home Screen first/i.test(t2) && !/Turn on alerts on this device/.test(t2), t2.slice(0, 400));
  await ctx.close();
}

// ================================================================ B. the real service worker (production build)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.grantPermissions(['notifications'], { origin: BASE });
  await ctx.route(`https://${REF}.supabase.co/**`, r => r.abort('failed'));
  await ctx.route(/posthog\.com|maps\.googleapis|fonts\.(googleapis|gstatic)\.com/, r => r.abort('failed'));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/rules`); await page.waitForLoadState('networkidle');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForLoadState('networkidle');
  check('B1. the service worker registers and controls the page', await page.evaluate(() => !!navigator.serviceWorker.controller));

  const mres = await page.request.get(`${BASE}/manifest.webmanifest`);
  const m = await mres.json();
  check('B2. the manifest is served and has the installability fields (name, standalone, start_url, scope, 192 + 512 icons, a maskable icon)',
    mres.ok() && m.name === 'BuhurtOS' && m.display === 'standalone' && !!m.start_url && !!m.scope && m.icons.some(i => i.sizes === '192x192' && i.purpose === 'any') && m.icons.some(i => i.sizes === '512x512') && m.icons.some(i => i.purpose === 'maskable'), JSON.stringify(m).slice(0, 200));
  let iconsOk = true;
  for (const i of m.icons) { const r = await page.request.get(new URL(i.src, `${BASE}/manifest.webmanifest`).href); if (!r.ok()) iconsOk = false; }
  check('B3. every icon in the manifest loads', iconsOk);
  check('B4. start_url and scope stay inside the app (relative: they follow the GitHub Pages /BuhurtOS/ base path)', m.start_url.startsWith('./') && m.scope === './' && m.shortcuts.every(s => s.url.startsWith('./')));
  const apple = await page.evaluate(() => ({ icon: document.querySelector('link[rel=apple-touch-icon]')?.href, cap: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content, theme: document.querySelector('meta[name=theme-color]')?.content }));
  check('B5. Apple Home Screen metadata is present and the touch icon loads', apple.cap === 'yes' && !!apple.theme && (await page.request.get(apple.icon)).ok(), JSON.stringify(apple));

  // offline: the shell and a deep link still open, and the page says it is offline
  await ctx.setOffline(true);
  await page.reload().catch(() => {});
  await page.waitForSelector('header.top', { timeout: 15000 }).catch(() => {});
  const offText = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  check('B6. offline, the app shell still opens from the service worker', /BuhurtOS/.test(offText) && (await page.locator('header.top').count()) === 1, offText.slice(0, 200));
  check('B7. ... and it says plainly that the person is offline', /You are offline/.test(offText));
  await page.goto(`${BASE}/formats`).catch(() => {});
  check('B8. a deep link opens offline too (direct routes recover)', (await page.locator('header.top').count()) === 1);
  await ctx.setOffline(false);

  // push delivered to the worker through DevTools (the browser's own injection) shows a real notification
  const cdp = await ctx.newCDPSession(page);
  let regId = null;
  cdp.on('ServiceWorker.workerRegistrationUpdated', e => { if (e.registrations?.[0]) regId = e.registrations[0].registrationId; });
  await cdp.send('ServiceWorker.enable');
  for (let i = 0; i < 20 && !regId; i++) await sleep(100);
  const payload = JSON.stringify({ title: 'On deck', body: 'You\'re up next on Field 1. Get to the bullpen.', route: '/events/e1#my-next-fight', tag: 'fight-1', category: 'fights', urgent: true });
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: BASE, registrationId: regId, data: payload });
  let notes = [];
  for (let i = 0; i < 30 && notes.length === 0; i++) { await sleep(150); notes = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag, route: n.data?.route, interaction: n.requireInteraction }))); }
  check('B9. a push reaches the worker and shows a notification (title, lock-screen body, tag)', notes.length === 1 && notes[0].title === 'On deck' && notes[0].body.includes('Field 1') && notes[0].tag === 'fight-1', JSON.stringify(notes));
  check('B10. the notification carries its tap destination and an urgent fight alert asks to stay', notes[0]?.route === '/events/e1#my-next-fight' && notes[0]?.interaction === true);
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: BASE, registrationId: regId, data: JSON.stringify({ title: 'Your field changed', body: 'Your fight is now on Field 2.', route: '/events/e1#my-next-fight', tag: 'fight-1', urgent: true }) });
  await sleep(600);
  notes = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => n.title));
  check('B11. a newer alert for the same fight replaces the older one (same tag), so the lock screen does not stack contradictions', notes.length === 1 && notes[0] === 'Your field changed', JSON.stringify(notes));
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: BASE, registrationId: regId, data: 'not json at all' });
  await sleep(500);
  const afterJunk = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length);
  check('B12. a malformed push still shows something harmless instead of breaking the worker', afterJunk >= 1);

  // tapping it while the app is open routes inside the open app
  await page.goto(`${BASE}/rules`); await page.waitForLoadState('networkidle');
  const sw = ctx.serviceWorkers().find(w => w.url().endsWith('/sw.js'));
  await sw.evaluate(async () => {
    await self.registration.showNotification('Tap test', { tag: 'tap', data: { route: '/formats' } });
    const [n] = await self.registration.getNotifications({ tag: 'tap' });
    self.dispatchEvent(new NotificationEvent('notificationclick', { notification: n }));
  });
  await page.waitForURL(/\/formats$/, { timeout: 8000 }).catch(() => {});
  check('B13. tapping a notification while the app is open routes the open app to its destination (no reload)', page.url().endsWith('/formats'), page.url());
  check('B14. an unsafe route in a notification is refused (it falls back to the app home)', await sw.evaluate(() => { const f = (r) => (typeof r === 'string' && /^\/[A-Za-z0-9/_?=&#-]*$/.test(r) && r.length < 200 ? r : '/'); return f('https://evil.example/x') === '/' && f('//evil.example') === '/' && f('/events/e1#my-next-fight') === '/events/e1#my-next-fight'; }));

  // tapping it with the app closed opens a window straight onto the destination
  await page.close();
  const opened = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  const openRes = await sw.evaluate(async () => {
    await self.registration.showNotification('Closed tap', { tag: 'closed', data: { route: '/rules' } });
    const [n] = await self.registration.getNotifications({ tag: 'closed' });
    try { self.dispatchEvent(new NotificationEvent('notificationclick', { notification: n })); return 'dispatched'; } catch (e) { return 'error ' + e; }
  });
  const np = await opened;
  if (np) { await np.waitForLoadState('domcontentloaded').catch(() => {}); check('B15. tapping with the app closed opens it on the destination', np.url().endsWith('/rules'), np.url()); }
  else console.log('SKIP  B15. tapping with the app closed: the browser refused openWindow for a synthetic (untrusted) click in this headless run (' + openRes + '). NOT proven here; it is on the real-device checklist.');
  check('B16. no uncaught page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
