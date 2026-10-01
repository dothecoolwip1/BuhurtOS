import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
export const BASE = process.env.E2E_BASE ?? 'http://localhost:4173';
export const SHOTS = process.env.E2E_SHOTS ?? '/tmp/claude-0/-home-user-BuhurtOS/13abfa6e-93be-54d8-a174-67d3a3db0b7e/scratchpad/shots';
export const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};
export async function launch() { return chromium.launch(process.env.HTTPS_PROXY ? { args: ['--proxy-server=' + process.env.HTTPS_PROXY, '--proxy-bypass-list=127.0.0.1;localhost'] } : {}); }
export async function newCtx(browser, kind, init) {
  const ctx = await browser.newContext(VIEWPORTS[kind]);
  if (init) await ctx.addInitScript(init.fn, init.arg);
  const page = await ctx.newPage();
  page.issues = [];
  page.on('console', (m) => { if (m.type() === 'error') page.issues.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => page.issues.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('requestfailed', (r) => page.issues.push('reqfailed: ' + r.url().slice(0, 120) + ' ' + r.failure()?.errorText));
  page.on('response', (r) => { if (r.status() >= 400) page.issues.push('http' + r.status() + ': ' + r.url().slice(0, 140)); });
  return { ctx, page };
}
export async function measure(page) {
  return page.evaluate(() => ({
    sw: document.scrollingElement.scrollWidth, iw: innerWidth,
    text: document.body.innerText,
    small: [...document.querySelectorAll('a,button,input,select,summary,[role=button],[role=tab]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32) && getComputedStyle(e).visibility !== 'hidden'; }).length,
    tiny: [...document.querySelectorAll('p,span,td,li,a')].filter((e) => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length,
  }));
}
export async function visit(page, kind, path, name, { wait = 1800, full = true } = {}) {
  page.issues.length = 0;
  await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(wait);
  const m = await measure(page);
  const bad = ['undefined', 'NaN', 'null'].filter((w) => new RegExp('\\b' + w + '\\b').test(m.text));
  if (m.text.includes('[object')) bad.push('[object');
  await page.screenshot({ path: `${SHOTS}/${kind}-${name}.png`, fullPage: full });
  return { path, kind, hscroll: m.sw > m.iw, sw: m.sw, iw: m.iw, small: m.small, tiny: m.tiny, bad, issues: [...page.issues], text: m.text };
}
