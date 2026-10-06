// PRODUCTION smoke test for the Red Deer Reavers AGM concerns / topics and executive nominations, driven in real Chromium against the LIVE club
// website and the LIVE Supabase project. Run only by hand (.github/workflows/reavers-production-smoke.yml with suite = agm-extras).
//
// FIXED, PRE-CONFIRMED TEST ACCOUNTS ONLY (set up with scripts/e2e/smoke-accounts.sql; arm them before a run, disarm after). This script never signs anyone up and never triggers an email. It signs in with three accounts that
// already exist (SMOKE_X_*, SMOKE_Y_*, SMOKE_Z_* environment variables, set from repository secrets): X and Y are approved voting TEST members,
// Z is a pending TEST applicant (cannot vote). If any is missing it refuses to run. It never touches any real person's data and never changes an
// officer. At the end it withdraws the test candidacies it created (the records stay as history; nothing is deleted).
// The executive screens are NOT driven here (no executive account is used); they are checked separately and by the local browser suite.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const SITE = process.env.SITE ?? 'https://dothecoolwip1.github.io/Red-deer-reavers/members.html';
const API = process.env.SUPABASE_URL ?? 'https://mvbxlebznlgroptwwdsm.supabase.co';
const KEY = process.env.SUPABASE_KEY ?? 'sb_publishable_u76M-dggKSsdsyhUQKveJg_5fPJ5Nan';
const TAG = (process.env.TAG ?? String(Date.now())).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
const WAIT = Number(process.env.WAIT_MINUTES ?? 20) * 60_000;
const SHOTS = process.env.SHOTS ?? '/tmp/smoke-shots';
mkdirSync(SHOTS, { recursive: true });

const who = (k) => { const K = k.toUpperCase(); return { email: process.env[`SMOKE_${K}_EMAIL`], password: process.env[`SMOKE_${K}_PASSWORD`], name: process.env[`SMOKE_${K}_NAME`] ?? `Smoke Test ${K}` }; };
const X = who('x'), Y = who('y'), Z = who('z');
if (![X, Y, Z].every(w => w.email && w.password)) {
  console.error('REFUSING TO RUN: no fixed pre-confirmed test accounts are configured (SMOKE_X_EMAIL/PASSWORD, SMOKE_Y_*, SMOKE_Z_*). This suite never creates accounts and never sends email.');
  process.exit(2);
}
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 700)}`); };
const note = (s) => console.log(`NOTE  ${s}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, timeout = 20000, every = 300) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn().catch(() => false)) return true; await sleep(every); } return false; };
const refused = (r) => r.status >= 400 && r.status < 500;

async function token(email, password) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY }, body: JSON.stringify({ email, password }) });
  const b = await r.json().catch(() => ({}));
  return { ok: !!b.access_token, token: b.access_token, user: b.user?.id, code: b.error_code ?? b.code, msg: b.msg ?? b.error_description };
}
async function rpc(tok, fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY, authorization: `Bearer ${tok}` }, body: JSON.stringify(args) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function table(tok, method, path, body) {
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers: { 'content-type': 'application/json', apikey: KEY, authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const pages = [];
async function open(kind = 'phone') {
  const ctx = await browser.newContext(kind === 'phone' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'en-CA', timezoneId: 'America/Edmonton' }
    : { viewport: { width: 1280, height: 900 }, locale: 'en-CA', timezoneId: 'America/Edmonton' });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(String(e).slice(0, 300)));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|40[0-9]|42501|AuthApiError|posthog|\[BuhurtOS\]|WebSocket|realtime/i.test(m.text())) p.errors.push(m.text().slice(0, 300)); });
  p.on('response', r => { if (r.status() >= 400) console.log(`HTTP ${r.status()}  ${r.url().slice(0, 160)}`); });
  p.on('requestfailed', r => console.log(`REQUEST FAILED  ${r.url().slice(0, 160)}  ${r.failure()?.errorText ?? ''}`));
  p.on('pageerror', e => console.log(`PAGE ERROR  ${String(e).slice(0, 200)}`));
  pages.push(p);
  return p;
}
const text = async (p, sel = 'body') => (await p.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => undefined);
const noSideways = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const tab = (p, name) => p.locator('#tabs').getByRole('button', { name, exact: true }).click();
async function siteSignIn(p, w) {
  await p.goto(SITE);
  await p.locator('#email').fill(w.email); await p.locator('#password').fill(w.password); await p.locator('#password-btn').click();
  await until(async () => !(await p.locator('#signed-in').isHidden()) && (await text(p, '#view')).length > 20, 30000);
}
// Sign in on the club website with a FIXED test account that is already a member (or an applicant). It never fills the profile step and never
// applies to join: if the account is not already in that state the run stops and says so.
async function enter(w, kind = 'phone') {
  const p = await open(kind);
  await siteSignIn(p, w);
  const ready = await until(async () => (await p.locator('[data-testid=my-membership]').count()) > 0, 30000);
  if (!ready) {
    await shot(p, `enter-${w.email.split('@')[0]}`);
    throw new Error(`fixed test account ${w.email} is not already a member/applicant on the live site; page says: ${(await text(p, '#view')).slice(0, 200)} | ${await text(p, '#status')}`);
  }
  const jl = p.locator('[data-testid=bylaws-link-join]');
  p.joinBylawsHref = (await jl.count()) ? await jl.getAttribute('href') : null;
  return p;
}
const openAgm = async (p) => { await tab(p, '2026 AGM'); await until(async () => (await p.locator('[data-testid=agm-nominations]').count()) > 0, 30000); };

try {
  // ================================================================ 00. what the live club website is serving right now
  const base = SITE.replace(/members\.html$/, ''); const live = {};
  for (const f of ['members.html', 'assets/js/buhurtos-config.js', 'assets/js/member-portal.js', 'assets/js/vendor/supabase-js-2.117.2.umd.js']) {
    const r = await fetch(base + f, { cache: 'no-store' }).catch(e => ({ status: 0, text: async () => String(e) }));
    const body = await r.text();
    live[f] = body;
    note(`live ${f}: HTTP ${r.status}, ${body.length} bytes${f.endsWith('member-portal.js') ? `, has the new AGM concern/nomination code: ${body.includes('club_agm_member_view')}` : ''}${f.endsWith('config.js') ? `, defines window.BUHURTOS: ${body.includes('window.BUHURTOS')}` : ''}`);
  }
  // ================================================================ 0. the three fixed TEST accounts sign in (no sign-up, no email)
  const tx = await token(X.email, X.password), ty = await token(Y.email, Y.password), tz = await token(Z.email, Z.password);
  check('0 the three fixed test accounts can sign in on the live Supabase Auth', tx.ok && ty.ok && tz.ok, `${tx.code} ${ty.code} ${tz.code}`);
  if (!(tx.ok && ty.ok && tz.ok)) throw new Error('fixed test accounts could not sign in');
  const team = (await (await fetch(`${API}/rest/v1/teams?slug=eq.red-deer-reavers&select=id`, { headers: { apikey: KEY } })).json())[0].id;

  // ================================================================ 1. join (the existing flow), then wait for the operator to approve X and Y
  const px = await enter(X), py = await enter(Y), pz = await enter(Z);
  const mine = async (t) => (await rpc(t, 'club_membership_overview', { p_team: team })).body?.memberships?.find(m => m.year === 2026);
  check('1 the fixed test accounts are in the expected state (X and Y approved members, Z a pending applicant)', (await mine(tx.token))?.status === 'active' && (await mine(ty.token))?.status === 'active' && (await mine(tz.token))?.status === 'pending');
  const mx = await mine(tx.token), my = await mine(ty.token), mz = await mine(tz.token);
  check('2 X and Y are Active and ELIGIBLE TO VOTE (2026 fee waived); Z is pending and cannot vote', mx?.eligible === true && my?.eligible === true && mz?.eligible === false, JSON.stringify([mx?.status, my?.status, mz?.status]));

  const view = async (t) => { const g = await rpc(t, 'club_meeting_member_view', { p_team: team }); return g.body; };
  const meeting = (await view(tx.token)).meeting.id;
  const board0 = (await rpc(tx.token, 'club_agm_member_view', { p_meeting: meeting })).body.board;
  const officers0 = JSON.stringify(board0.map(b => [b.office, b.current_officer]));
  note(`current officers before: ${officers0}`);

  // ================================================================ 2. the AGM page: existing RSVP kept, concern box and nominations added
  await px.reload(); await until(async () => !(await px.locator('#signed-in').isHidden()), 30000);
  await openAgm(px);
  const page0 = await text(px, '#view');
  check('3 the live AGM page keeps the RSVP and proxy choices and adds the concern box and Executive Nominations',
    page0.includes('In Person') && page0.includes('Voting by Proxy') && page0.includes('Something you want discussed?') && page0.includes('Submit AGM Concern / Topic') && page0.includes('Executive Nominations') && page0.includes('Nominate Myself') && page0.includes('Nominate Another Member'), page0.slice(0, 500));
  check('3b the nominations section names the current officers from the officer records, never an e-mail address', /Current Officer: /.test(page0) && !/@/.test(await text(px, '[data-testid=agm-nominations]')));
  await shot(px, 'n03-agm-page-x');
  // ---- "How the AGM Works" (member help) on the live page
  const helpTitles = await px.locator('[data-testid=agm-help] summary').allInnerTexts();
  check('3c the live AGM tab has "How the AGM Works" with six headings, closed until tapped', helpTitles.join('|') === 'Who can vote?|How to join|Executive roles|How nominations work|Submit an AGM topic|RSVP and proxy voting' && (await px.locator('[data-testid=agm-help] details[open]').count()) === 0, helpTitles.join('|'));
  await shot(px, 'n03a-help-closed-x');
  await px.evaluate(() => document.querySelectorAll('.help-item').forEach(d => { d.open = true; }));
  const ht = await text(px, '[data-testid=agm-help]');
  check('3d live executive roles: President shows "Kedrixx (account not currently linked)"', /President Helps lead the society and meetings\. Currently: Kedrixx \(account not currently linked\)/.test(ht), ht.slice(ht.indexOf('Executive roles'), ht.indexOf('Executive roles') + 500));
  check('3e live executive roles: Secretary shows Garrett Robson (from the officer records)', /Secretary Helps keep society records, meeting information and official paperwork organized\. Currently: Garrett Robson/.test(ht));
  check('3f live executive roles: Treasurer shows "Carmalee (account not currently linked)"', /Treasurer Helps manage the society's money and financial records\. Currently: Carmalee \(account not currently linked\)/.test(ht));
  check('3g live: the 2026 fee is waived (normal $20), an account alone is not enough, same account never two', ht.includes('Membership fees are waived for 2026. You do not need to pay the normal $20 fee to vote this year.') && ht.includes('Making an account is not enough on its own.') && ht.includes('You never need two.'));
  check('3h live: the date and place come from the AGM record', ht.includes('AGM: Sunday, October 18, 2026 at 5:30 PM'), ht.slice(ht.indexOf('AGM:'), ht.indexOf('AGM:') + 120));
  const outside = live['assets/js/member-portal.js'].split('function agmHelp()')[0] + live['assets/js/member-portal.js'].split('// ---- concerns / topics')[1] + live['members.html'];
  const quoted = [...new Set([...ht.matchAll(/“([^”]+)”/g)].map(x => x[1]))];
  const missing = quoted.filter(n => !(outside.includes(n) || outside.includes(n.replace(/'/g, "\\'"))));
  check(`3i live: every button or heading quoted in the help (${quoted.length}) is a real label on the live site`, quoted.length >= 14 && missing.length === 0, missing.join(' | '));
  check('3j live: the help, fully open, fits a 390px phone', await noSideways(px));
  await shot(px, 'n03b-help-open-x');
  const pd = await open('desktop');
  await siteSignIn(pd, X); await openAgm(pd);
  await pd.evaluate(() => document.querySelectorAll('.help-item').forEach(d => { d.open = true; }));
  check('3k live: the help is readable on desktop (no sideways scroll)', await noSideways(pd) && (await text(pd, '[data-testid=agm-help]')).includes('How to join'));
  await shot(pd, 'n03c-help-open-desktop');
  // ---- bylaws link, footer buttons and Admin Sign In on the live site
  const BYLAWS = 'https://drive.google.com/file/d/1R9EDu7BpUZ1KM790BDNN0iIaXZYtUtCE/view?usp=drivesdk';
  check('3l live: the Join form is built with the bylaws link (the fixed accounts are already members, so the form is checked in the live code and config)', live['assets/js/member-portal.js'].includes("'bylaws-link-join'") && live['assets/js/buhurtos-config.js'].includes(BYLAWS));
  const so = await open('phone');
  await so.goto(SITE);
  await so.locator('[data-auth-tab=signup]').click();
  const sl = so.locator('[data-testid=bylaws-link-signup]');
  check('3m live: the Create account page links to the bylaws PDF (new tab) and says an account does not make you a member', (await sl.getAttribute('href')) === BYLAWS && (await sl.getAttribute('target')) === '_blank' && (await text(so, '[data-auth-panel=signup]')).includes('Creating an account does not make you a member.'));
  await shot(so, 'n03d-create-account-bylaws');
  for (const pg of ['index.html', 'programs.html', 'contact.html', 'agm.html', 'members.html']) {
    const fp = await open('phone');
    await fp.goto(SITE.replace('members.html', pg));
    const m1 = fp.locator('footer .footer-signin a', { hasText: 'Member Sign In' }), a1 = fp.locator('footer .footer-signin a', { hasText: 'Admin Sign In' });
    check(`3n live: ${pg} has Member Sign In and Admin Sign In footer buttons that fit a 390px phone`, (await m1.getAttribute('href')) === 'members.html' && (await a1.getAttribute('href')) === 'members.html?view=agm-admin' && await noSideways(fp));
    if (pg === 'index.html') { await m1.scrollIntoViewIfNeeded(); await shot(fp, 'n03e-footer-buttons'); }
  }
  const ap = await open('phone');
  await ap.goto(SITE + '?view=agm-admin');
  check('3o live: Admin Sign In shows the same sign-in and says there is no separate admin login', (await text(ap, '#admin-note')).includes('There is no separate admin login.'));
  await ap.locator('#email').fill(X.email); await ap.locator('#password').fill(X.password); await ap.locator('#password-btn').click();
  await until(async () => !(await ap.locator('#signed-in').isHidden()) && (await text(ap, '#view')).length > 20, 30000);
  check('3p live: a regular member using Admin Sign In gets no admin tools, a clear note, and their own member page', !(await text(ap, '#tabs')).includes('AGM admin') && (await text(ap, '#status')).includes('not a current executive'), `${await text(ap, '#tabs')} | ${await text(ap, '#status')}`);
  for (const [btn, shown] of [['Video Call', 'Attending by Video Call'], ['Not Attending', 'Not Attending']]) {
    await px.getByRole('button', { name: btn, exact: true }).click();
    check(`4 the existing RSVP "${btn}" still works`, await until(async () => (await text(px, '[data-testid=rsvp-now]')).includes(shown), 20000));
  }

  // ================================================================ 3. concerns / topics
  await px.getByRole('button', { name: 'Submit AGM Concern / Topic' }).click();
  await px.locator('#topic-subject').fill(`[SMOKE TEST ${TAG}] Hall rental costs`);
  await px.locator('#topic-details').fill('Automated production smoke test. Please ignore.\nCan we talk about a second location?');
  await px.getByRole('button', { name: 'Submit for AGM' }).click();
  await until(async () => (await px.locator('[data-testid=topic-received]').count()) > 0, 30000);
  check('5 an eligible member submits a topic and is told it was received', (await text(px, '[data-testid=topic-received]')).includes('Received'), await text(px, '#agm-topics'));
  const mineTopic = await text(px, '[data-testid=my-topic]');
  check('6 the member sees their own submission with subject, submitted date and status Submitted', mineTopic.includes('Hall rental costs') && mineTopic.includes('Submitted') && /Submitted \w+ \d+, \d{4}/.test(mineTopic), mineTopic);
  await px.getByRole('button', { name: 'Edit', exact: true }).click();
  await px.locator('#topic-subject').fill(`[SMOKE TEST ${TAG}] Hall rental costs (edited)`);
  await px.getByRole('button', { name: 'Save changes' }).click();
  check('7 the member can edit their own submission', await until(async () => (await text(px, '[data-testid=my-topic]')).includes('(edited)'), 30000));
  const topicId = (await table(tx.token, 'GET', 'club_meeting_topics?select=id', null));
  check('8 nobody can read the topic table directly (everything goes through the checked functions)', refused(topicId), JSON.stringify(topicId.body));
  // the id of X's topic is read through the member's own view
  const tv = (await rpc(tx.token, 'club_agm_member_view', { p_meeting: meeting })).body.my_topics;
  const tid = tv?.[0]?.id;
  check('9 another member cannot edit or withdraw it', !!tid && refused(await rpc(ty.token, 'update_club_agm_topic', { p_topic: tid, p_subject: 'Changed by Y', p_details: 'x' })) && refused(await rpc(ty.token, 'withdraw_club_agm_topic', { p_topic: tid })), tid);
  check('10 another member does not see it in their own list', ((await rpc(ty.token, 'club_agm_member_view', { p_meeting: meeting })).body.my_topics ?? []).length === 0);
  check('11 a regular member cannot open the executive concern list or set a status', refused(await rpc(tx.token, 'club_agm_topics_admin', { p_meeting: meeting })) && refused(await rpc(tx.token, 'set_club_agm_topic_status', { p_topic: tid, p_status: 'addressed' })));
  px.once('dialog', d => d.accept());
  await px.getByRole('button', { name: 'Withdraw', exact: true }).click();
  check('12 the member can withdraw their own submission (it stays, marked Withdrawn, no longer editable)', await until(async () => (await text(px, '[data-testid=my-topic]')).includes('Withdrawn') && (await px.getByRole('button', { name: 'Edit', exact: true }).count()) === 0, 30000));

  // ================================================================ 4. nominations
  const nf = px.locator('[data-testid=nominate-form]');
  const role = (p, r) => p.locator('[data-testid=nominate-form]').getByRole('button', { name: r, exact: true }).click();
  await nf.getByRole('button', { name: 'Nominate Myself' }).click();
  await role(px, 'President');
  const conf = await text(px, '[data-testid=nomination-confirm]');
  check('13 nominating yourself asks to confirm: "You are nominating yourself for President at the 2026 Red Deer Reavers AGM."', conf.includes('You are nominating yourself for President at the 2026 Red Deer Reavers AGM.'), conf);
  await shot(px, 'n13-nominate-confirm-x');
  await px.getByRole('button', { name: 'Confirm Nomination' }).click();
  check('14 self-nomination for President: accepted at once, listed as an accepted candidate', await until(async () => (await text(px, '[data-testid=office-president]')).includes(`Accepted Candidates: ${X.name}`), 30000), await text(px, '[data-testid=office-president]'));
  for (const r of ['Secretary', 'Treasurer']) {
    await px.locator('[data-testid=nominate-form]').getByRole('button', { name: 'Nominate Myself' }).click();
    await role(px, r);
    await px.getByRole('button', { name: 'Confirm Nomination' }).click();
    check(`15 self-nomination for ${r} works`, await until(async () => (await text(px, `[data-testid=office-${r.toLowerCase()}]`)).includes(X.name), 30000));
  }
  // nominate another member
  await px.locator('[data-testid=nominate-form]').getByRole('button', { name: 'Nominate Another Member' }).click();
  const offered = await px.locator('#nominee option').allInnerTexts();
  check('16 only members who can currently vote are offered (Y yes; pending Z and yourself no)', offered.includes(Y.name) && !offered.includes(Z.name) && !offered.includes(X.name), offered.join(' | '));
  await px.locator('#nominee').selectOption({ label: Y.name });
  await role(px, 'Secretary');
  check('17 nominating someone else says who, for what, and that they must accept', (await text(px, '[data-testid=nomination-confirm]')).includes(`You are nominating ${Y.name} for Secretary`) && (await text(px, '[data-testid=nomination-confirm]')).includes('must accept'));
  await px.getByRole('button', { name: 'Confirm Nomination' }).click();
  await until(async () => (await text(px, '[data-testid=nomination-notice]')).includes('Nomination sent'), 30000);
  const ov = (await rpc(tx.token, 'club_agm_member_view', { p_meeting: meeting })).body;
  const secBoard = ov.board.find(b => b.office === 'secretary').candidates;
  check('18 the nominee is listed as awaiting acceptance, not as a confirmed candidate', secBoard.some(c => c.name === Y.name && c.status === 'awaiting_acceptance') && !secBoard.some(c => c.name === Y.name && c.status === 'accepted'), JSON.stringify(secBoard));
  const yv = (await rpc(ty.token, 'club_agm_member_view', { p_meeting: meeting })).body;
  const nomId = yv.to_respond?.[0]?.id;
  check('19 the nominator cannot accept or decline for the nominee', !!nomId && refused(await rpc(tx.token, 'respond_to_club_nomination', { p_nomination: nomId, p_response: 'accept' })) && refused(await rpc(tx.token, 'respond_to_club_nomination', { p_nomination: nomId, p_response: 'decline' })), nomId);
  // duplicate nomination for the same member/office/AGM = one candidacy
  const dup = await rpc(tx.token, 'nominate_for_club_office', { p_meeting: meeting, p_office: 'secretary', p_nominee: (await mine(ty.token)).id });
  const yv2 = (await rpc(ty.token, 'club_agm_member_view', { p_meeting: meeting })).body;
  check('20 nominating the same member for the same office again makes no second candidacy', dup.status < 300 && String(dup.body).replaceAll('"', '') === nomId && (yv2.to_respond ?? []).length === 1, JSON.stringify(dup.body));

  // ================================================================ 5. the nominee signs in, sees it, accepts one, declines another
  await py.reload(); await until(async () => !(await py.locator('#signed-in').isHidden()), 30000);
  await until(async () => (await py.locator('[data-testid=nominated-banner]').count()) > 0, 30000);
  const ban = await text(py, '[data-testid=nominated-banner]');
  check("21 signing in, the nominee sees \"You've Been Nominated\" for the role", ban.includes("You've Been Nominated") && ban.includes('You have been nominated for Secretary for the 2026 Red Deer Reavers AGM.'), ban);
  await shot(py, 'n21-nominated-banner-y');
  await openAgm(py);
  const card = await text(py, '[data-testid=nominated-card]');
  check('22 the nomination shows who nominated them, the role and the date, with Accept and Decline', card.includes(`Nominated by ${X.name}`) && card.includes('Role Secretary') && /Date \w+ \d+, \d{4}/.test(card) && (await py.getByRole('button', { name: 'Accept Nomination' }).count()) === 1 && (await py.getByRole('button', { name: 'Decline Nomination' }).count()) === 1, card);
  check('23 the nominee page fits a 390px phone', await noSideways(py));
  await shot(py, 'n22-nominated-card-y');
  await py.getByRole('button', { name: 'Accept Nomination' }).click();
  check('24 Accept: the nominee becomes an accepted candidate', await until(async () => { const t = await text(py, '[data-testid=office-secretary]'); return t.includes('Accepted Candidates') && t.includes(X.name) && t.includes(Y.name) && !t.includes('awaiting acceptance'); }, 30000), await text(py, '[data-testid=office-secretary]'));
  const sec2 = (await rpc(ty.token, 'club_agm_member_view', { p_meeting: meeting })).body.board.find(b => b.office === 'secretary').candidates;
  check('25 each member is listed once however many people nominated them', sec2.filter(c => c.name === X.name).length === 1 && sec2.filter(c => c.name === Y.name).length === 1 && sec2.every(c => c.status === 'accepted'), JSON.stringify(sec2));
  const n2 = await rpc(tx.token, 'nominate_for_club_office', { p_meeting: meeting, p_office: 'treasurer', p_nominee: (await mine(ty.token)).id });
  await py.reload(); await until(async () => !(await py.locator('#signed-in').isHidden()), 30000);
  await until(async () => (await py.locator('[data-testid=nominated-banner]').count()) > 0, 30000);
  await openAgm(py);
  py.once('dialog', d => d.accept());
  await py.getByRole('button', { name: 'Decline Nomination' }).click();
  check('26 Decline: recorded as declined, and Y is not shown as a Treasurer candidate', n2.status < 300 && await until(async () => (await py.locator('[data-testid=nominated-card]').count()) === 0, 30000)
    && !((await rpc(ty.token, 'club_agm_member_view', { p_meeting: meeting })).body.board.find(b => b.office === 'treasurer').candidates.some(c => c.name === Y.name)));

  // ================================================================ 6. a member who cannot vote
  await pz.reload(); await until(async () => !(await pz.locator('#signed-in').isHidden()), 30000);
  await openAgm(pz);
  const zt = await text(pz, '[data-testid=agm-nominations]');
  check('27 a pending member can read the nominations but cannot nominate, and is told why', (await pz.locator('[data-testid=nominate-form]').count()) === 0 && zt.includes('Only members who can currently vote can nominate') && zt.includes('Membership pending approval'), zt.slice(0, 400));
  check('28 the live database refuses a non-voting member (and an invalid role or nominee)', refused(await rpc(tz.token, 'nominate_for_club_office', { p_meeting: meeting, p_office: 'president' }))
    && refused(await rpc(tx.token, 'nominate_for_club_office', { p_meeting: meeting, p_office: 'director' })) && refused(await rpc(tx.token, 'nominate_for_club_office', { p_meeting: meeting, p_office: 'president', p_nominee: mz?.id })));
  check('29 nobody can write nominations directly', refused(await table(tx.token, 'POST', 'club_meeting_nominations', { meeting_id: meeting, office: 'president', nominee_membership_id: mz?.id, status: 'accepted' })) && refused(await table(tx.token, 'GET', 'club_meeting_nominations?select=id')));
  check('29b the pending member can still read Executive Nominations and the AGM page fits a 390px phone', await noSideways(pz));
  await shot(pz, 'n27-pending-z');

  // ================================================================ 7. nothing here changes an officer; the old features still work
  const board1 = (await rpc(tx.token, 'club_agm_member_view', { p_meeting: meeting })).body.board;
  check('30 NOMINATIONS DID NOT CHANGE ANY OFFICER (same current officers as before)', JSON.stringify(board1.map(b => [b.office, b.current_officer])) === officers0, JSON.stringify(board1.map(b => [b.office, b.current_officer])));
  await px.reload(); await until(async () => !(await px.locator('#signed-in').isHidden()), 30000); await openAgm(px);
  await px.getByRole('button', { name: 'Voting by Proxy', exact: true }).click();
  await until(async () => (await px.locator('[data-testid=proxy-form]').count()) > 0, 20000);
  await px.locator('#proxy-holder').selectOption({ label: Y.name }); await px.locator('label.check', { hasText: 'I authorize the selected member' }).click();
  await px.getByRole('button', { name: 'Save my proxy' }).click();
  check('31 proxy voting still works: "Your Proxy" shows the chosen member', await until(async () => (await text(px, '[data-testid=proxy-holder]')) === Y.name, 20000));
  px.once('dialog', d => d.accept());
  await px.getByRole('button', { name: 'Cancel proxy' }).click();
  check('32 cancelling the proxy still works', await until(async () => (await text(px, '[data-testid=agm-member]')).includes('How will you participate?'), 20000));
  check('33 the member AGM page fits a 390px phone', await noSideways(px));
  await shot(px, 'n33-agm-page-x-end');
  // ---- leave nothing live: the test accounts withdraw the accepted candidacies this run created (the records stay as history; nothing is deleted)
  let withdrawn = 0;
  for (const t of [tx, ty]) {
    const cands = ((await rpc(t.token, 'club_agm_member_view', { p_meeting: meeting })).body.my_candidacies ?? []).filter(c => c.status === 'accepted');
    for (const c of cands) { if ((await rpc(t.token, 'respond_to_club_nomination', { p_nomination: c.id, p_response: 'withdraw' })).status < 300) withdrawn++; }
  }
  const live2 = ((await rpc(tx.token, 'club_agm_member_view', { p_meeting: meeting })).body.board ?? []).flatMap(b => b.candidates).filter(c => [X.name, Y.name].includes(c.name));
  check(`35 cleanup: the test candidacies were withdrawn (${withdrawn}) and none of the fixed test accounts is still shown as a candidate`, live2.length === 0, JSON.stringify(live2));
} catch (e) {
  check('no unexpected error', false, e?.stack ?? String(e));
}
check('34 no page errors on the live site', pages.every(x => x.errors.length === 0), pages.flatMap(x => x.errors).join(' | '));
console.log(`TEST ACCOUNTS  X=${X.email}  Y=${Y.email}  Z=${Z.email}   (tag ${TAG})`);
await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
console.log(failed ? 'PRODUCTION AGM EXTRAS SMOKE FAILED' : 'PRODUCTION AGM EXTRAS SMOKE PASSED');
process.exit(failed ? 1 : 0);
