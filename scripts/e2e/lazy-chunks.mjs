// Screens load on first open (src/lib/lazyPage.ts). This proves, in a real Chromium against the real built app, the two ways that can go wrong:
//   [deploy]  a tab still running the old build opens a screen after a new deploy removed the old files: it reloads once onto the new build
//   [offline] after one visit the offline worker has every screen: a phone that loses signal can still open screens it has never opened
//   node scripts/e2e/lazy-chunks.mjs        (builds two versions itself; Supabase is mocked: scripts/e2e/mock-supabase.mjs)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { REF, createMock } from './mock-supabase.mjs';
import { startStaticServer } from './static-server.mjs';

const OUT = process.env.E2E_OUT ?? '/tmp/claude-0/lazy-e2e';
const build = (dir, suffix) => execSync(`npx vite build --outDir ${dir} --emptyOutDir`, { env: { ...process.env, VITE_BASE: '/', ...(suffix ? { APP_VERSION_SUFFIX: suffix } : {}) }, stdio: 'ignore' });
build(`${OUT}/a`, ''); build(`${OUT}/b`, 'second-build');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + detail}`); };
const go = (page, path) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, path);   // an in-app link, no page load
const chunks = (dir) => new Set(fs.readdirSync(`${dir}/assets`).filter((f) => f.endsWith('.js')));
const rulesChunk = [...chunks(`${OUT}/a`)].find((f) => f.startsWith('RulesPage-'));
check('the build splits screens into their own files (RulesPage has one)', !!rulesChunk, [...chunks(`${OUT}/a`)].slice(0, 5).join(', '));
check('the second build has a different RulesPage file, so the old one is gone after the deploy', !chunks(`${OUT}/b`).has(rulesChunk));

const server = await startStaticServer(`${OUT}/a`);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
try {
  // ---- [deploy] no service worker (a first visit, or a browser without one)
  {
    const mock = createMock();
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    await ctx.route(`https://${REF}.supabase.co/**`, mock.handle);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    let loads = 0; page.on('load', () => { loads += 1; });
    server.switchTo(`${OUT}/a`);
    await page.goto(server.base + '/', { waitUntil: 'networkidle' });
    const before = await page.locator('footer').innerText().catch(() => '');
    check('[deploy] the old build is running', !before.includes('second-build'), before.slice(0, 120));
    server.switchTo(`${OUT}/b`);   // the deploy: the old build's files are gone (the server now answers them with the new index page, as a host's fallback does)
    await go(page, '/rules');
    await page.waitForFunction(() => document.querySelector('footer')?.innerText.includes('second-build'), null, { timeout: 20000 }).catch(() => {});
    const after = await page.locator('footer').innerText().catch(() => '');
    check('[deploy] opening a screen the old build had not loaded reloads onto the new build', after.includes('second-build'), after.slice(0, 160));
    check('[deploy] it reloaded once, not in a loop', loads === 2, `${loads} page loads`);
    check('[deploy] the screen the person asked for is the one shown', new URL(page.url()).pathname === '/rules' && await page.getByRole('heading').first().waitFor({ timeout: 10000 }).then(() => true, () => false), page.url());
    check('[deploy] no "This screen ran into a problem"', await page.getByTestId('screen-error').count() === 0);
    await ctx.close();
  }
  // ---- [offline] with the service worker: one visit, then no signal
  {
    server.switchTo(`${OUT}/a`);
    const mock = createMock();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(`https://${REF}.supabase.co/**`, mock.handle);
    const page = await ctx.newPage();
    await page.goto(server.base + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 }).catch(() => {});
    await page.waitForFunction(async () => { const keys = await caches.keys(); const c = keys.find((k) => k.startsWith('bos-v2-')); if (!c) return false; return (await (await caches.open(c)).keys()).length > 50; }, null, { timeout: 20000 }).catch(() => {});
    check('[offline] the offline worker controls the page after the first visit', await page.evaluate(() => navigator.serviceWorker?.controller != null));
    await ctx.setOffline(true);
    for (const path of ['/rules', '/fighters', '/lyst/counter']) {
      await go(page, path);
      await page.waitForTimeout(800);
      const failed = await page.getByTestId('screen-error').count();
      const shown = (await page.locator('#root').innerText()).trim().length;
      check(`[offline] with no signal, ${path} (never opened before) still opens`, failed === 0 && shown > 20, `screen-error=${failed} text=${shown}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close(); await server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
