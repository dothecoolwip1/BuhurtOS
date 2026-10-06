// Pack 18.1 ANNOUNCER view against a REAL local stack: Postgres built from every migration + the announcer fixture, PostgREST, the real built app in real Chromium
// at 390x844, 820x1180 and 1280x900. A realistic day: three Lysts (Field 1-3), several competitions, two simultaneous LIVE fights (real Pack 13 RPCs as
// authorized users: lyst_open, timer commands, round confirmation, finalization), ready / not-ready fighters from the Pack 16 desk and inspector, finished
// results (one by disqualification), warnings / cards / deductions, a permanent account holding the `announcer` event role, and a DEVICE session for an
// `announcer` (a minted bos_event_device JWT) that is attacked through the Data API.
// Run it through scripts/e2e/announcer-live.sh. LOCAL EVIDENCE ONLY (needs a PostgREST binary and a Chromium; not part of CI).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const BASE = process.env.E2E_BASE, API = process.env.E2E_API, SHOTS = process.env.E2E_SHOTS, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 900)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const hs = (claims) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify(claims)); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const userJwt = (sub, email) => hs({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 });
const U = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const uuid = () => crypto.randomUUID();
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const psqlFile = (q) => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', DB], { input: q, encoding: 'utf8' }).trim();

const EVENT = '00000000-0000-0000-0000-00000000ed01', OTHER = '00000000-0000-0000-0000-00000000ed02', DRAFT = '00000000-0000-0000-0000-00000000ed03';
const mid = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const REG = (n) => `00000000-0000-0000-0000-00000000ae${String(n).padStart(2, '0')}`;
const WHO = {
  organizer: [U('a2'), 'u2@example.test'], scorekeeper: [U('a4'), 'u4@example.test'], head: [U('c1'), 'c1@example.test'], stranger: [U('a7'), 'u7@example.test'],
  desk: [U('d1'), 'd1@example.test'], inspector: [U('d2'), 'd2@example.test'],
  announcer: [U('e1'), 'e1@example.test'], marshal: [U('e2'), 'e2@example.test'], otherAnnouncer: [U('e3'), 'e3@example.test']
};
const session = ([id, email]) => ({ access_token: userJwt(id, email), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } });
const STORAGE_KEY = 'sb-localhost-auth-token';
async function call(token, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', prefer: 'return=representation', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: json, text };
}
const tokenOf = (who) => userJwt(...WHO[who]);
const rpc = (who, fn, args = {}) => call(who ? tokenOf(who) : null, 'POST', `rpc/${fn}`, args);
const refused = (r) => r.status >= 400 && r.status < 500;
const okay = (r) => r.status >= 200 && r.status < 300;
const must = (r, what) => { if (!okay(r)) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 300)}`); return r; };

// ------------------------------------------------------------------ the day's helpers (all REAL Pack 13 / Pack 16 functions, called as the authorized people)
const timerRev = (fieldKey) => Number(sql(`select coalesce((select rev from public.lyst_timer where event_id = '${EVENT}' and field_key = '${fieldKey}'), 0)`));
const timer = (who, field, match, action, extra = {}) => rpc(who, 'lyst_timer_command', { p_event: EVENT, p_field: field, p_match: match, p_expected_rev: timerRev(field.toLowerCase()), p_command: uuid(), p_action: action, ...extra });
const roundRev = (m, r) => Number(sql(`select coalesce((select rev from public.lyst_rounds where match_id = '${m}' and round_no = ${r}), 0)`));
const open = (who, m) => rpc(who, 'lyst_open', { p_match: m, p_counter_input: 'weighted' });
const endRound = (who, m, r) => rpc(who, 'lyst_end_round', { p_match: m, p_round: r });
const confirm = (who, m, r, a, b) => rpc(who, 'lyst_confirm_round', { p_command: uuid(), p_match: m, p_round: r, p_awarded_a: a, p_awarded_b: b, p_expected_rev: roundRev(m, r) });
const finalize = (who, m, result, basis = 'score', reason = null) => rpc(who, 'lyst_finalize', { p_command: uuid(), p_match: m, p_expected_version: Number(sql(`select version from public.matches where id = '${m}'`)), p_result: result, p_basis: basis, p_reason: reason });
const startRound = (who, field, m, round, ms) => timer(who, field, m, 'start', { p_mode: 'fight', p_duration_ms: ms, p_round: round });
const discipline = (who, m, round, side, kind, extra = {}) => rpc(who, 'lyst_record_discipline', { p_command: uuid(), p_match: m, p_round: round, p_side: side, p_kind: kind, ...extra });
/** A finished match: open it, confirm each round, finish it (the existing human path). */
async function playMatch(who, m, rounds, result, basis = 'score', reason = null) {
  must(await open(who, m), `open ${m}`);
  for (let i = 0; i < rounds.length; i++) must(await confirm(who, m, i + 1, rounds[i][0], rounds[i][1]), `confirm ${m} round ${i + 1}`);
  return must(await finalize(who, m, result, basis, reason), `finalize ${m}`);
}

// ------------------------------------------------------------------ the browser
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
const VIEW = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 1 },
  desktop: { viewport: { width: 1280, height: 900 } }
};
const NET = [];   // every API response the pages made: { who, method, url, status, body }
async function openPage(kind, who) {
  const ctx = await browser.newContext({ ...VIEW[kind], serviceWorkers: 'block', locale: 'en-CA', timezoneId: 'America/Edmonton' });
  await ctx.route(/posthog\.com|maps\.googleapis\.com|youtube(-nocookie)?\.com|twitch\.tv|vimeo\.com/, r => r.abort('failed'));
  if (who) await ctx.addInitScript(([k, s]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); } catch { /* blocked frame */ } }, [STORAGE_KEY, session(WHO[who])]);
  const page = await ctx.newPage();
  page.ctx = ctx; page.errors = []; page.who = who ?? 'anonymous'; page.kind = kind; page.reqs = [];
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|net::ERR|Failed to fetch|403|401|42501/i.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('request', r => { if (r.url().startsWith(API)) page.reqs.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' }); });
  page.on('response', async r => {
    if (!r.url().startsWith(API)) return;
    let body = ''; try { body = await r.text(); } catch { /* aborted */ }
    NET.push({ who: page.who, kind: page.kind, method: r.request().method(), url: r.url(), status: r.status(), body });
  });
  return page;
}
const lower = (s) => (s ?? '').replace(/\s+/g, ' ').toLowerCase();
const bodyText = async (page) => lower(await page.evaluate(() => document.body.innerText).catch(() => ''));
const textOf = async (page, sel) => lower(await page.locator(sel).first().innerText().catch(() => ''));
const shot = async (page, name, full = true) => { if (SHOTS) { await sleep(350); await page.screenshot({ path: `${SHOTS}/ann-${name}.png`, fullPage: full }).catch(() => undefined); } };
const until = async (fn, timeout = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn()) return true; await sleep(step); } return false; };
const untilText = (page, re, timeout = 25000) => until(async () => re.test(await bodyText(page)), timeout);
const lyst = (page, key) => page.locator(`[data-lyst="${key}"]`);
const lystText = async (page, key) => lower(await lyst(page, key).innerText().catch(() => ''));
const ANN = (slug = 'test-stuff-test') => `/events/${slug}/announcer`;
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
const docH = (page) => page.evaluate(() => document.documentElement.scrollHeight);

/** Layout facts of the announcer screen at the current viewport. */
const layout = (page) => page.evaluate(() => {
  const vw = innerWidth, out = { vw, sw: document.scrollingElement.scrollWidth, over: [], clipped: [], small: [], tiny: 0, inputs: 0 };
  for (const e of document.querySelectorAll('.ann *')) {
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0)) continue;
    if (cs.position !== 'fixed' && (r.right > vw + 1 || r.left < -1)) out.over.push(`${e.tagName}.${(e.className || '').toString().slice(0, 30)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    if (e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis' && !e.classList.contains('sr-only') && !e.closest('.sr-only') && !e.classList.contains('an-info') && !e.classList.contains('an-recent')) out.clipped.push(`${e.tagName}.${(e.className || '').toString().slice(0, 30)}`);
    if (e.matches('button,a,[role=button]') && (r.height < 44 || r.width < 44) && !e.closest('.camoff-banner')) out.small.push(`${(e.textContent || '').trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (e.children.length === 0 && e.textContent.trim() && parseFloat(cs.fontSize) < 12) out.tiny++;
    if (e.matches('input,textarea,select,form')) out.inputs++;
  }
  return out;
});

const SNAP = ['matches', 'lyst_matches', 'lyst_timer', 'lyst_rounds', 'lyst_round_revisions', 'match_discipline', 'match_discipline_private', 'lyst_counts', 'lyst_counter_seats', 'lyst_counter_rounds', 'lyst_join_codes',
  'event_lyst_settings', 'event_broadcast_control', 'broadcast_controller_status', 'event_camera_state', 'event_camera_log', 'event_announcements', 'notifications', 'audit_log', 'score_events', 'match_live_scores', 'result_proposals', 'results', 'registration_checks', 'registration_inspections'];
const snapshot = () => Object.fromEntries(SNAP.filter(t => sql(`select to_regclass('public.${t}') is not null`) === 't').map(t => [t, sql(`select count(*) || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.${t} x`)]));
const diff = (a, b) => Object.keys(a).filter(k => a[k] !== b[k]);

try {
  // ================================================================== 0. the day, built through the real functions
  check('0. fixture: one event with three Lysts of fights (Field 1, 2, 3), five competitions, the announcer accounts', sql(`select count(distinct coalesce(nullif(btrim(m.field), ''), 'Field 1')) from public.matches m join public.competitions k on k.id = m.competition_id where k.event_id = '${EVENT}'`) === '3'
    && sql(`select count(*) from public.event_staff where event_id = '${EVENT}' and user_id = '${U('e1')}' and role = 'announcer'`) === '1');
  must(await rpc('head', 'set_lyst_settings', { p_event: EVENT, p_settings: { cards: [{ key: 'yellow', label: 'Yellow card' }, { key: 'red', label: 'Red card' }], deduction_amounts: [1, 2, 3] } }), 'lyst settings');

  // ---- readiness (Pack 16): the check-in desk checks people in, the inspector passes / fails armour
  const READY = [1, 2, 4, 5, 6, 7, 9, 10, 15, 16, 17, 18, 19];                  // checked in AND armour passed
  for (const n of [...READY, 3, 20]) must(await rpc('desk', 'set_attendance', { p_reg: REG(n), p_state: 'checked_in' }), `check in ${n}`);
  for (const n of READY) must(await rpc('inspector', 'record_inspection', { p_reg: REG(n), p_result: 'passed', p_issues: [], p_note: null }), `inspect ${n}`);
  must(await rpc('inspector', 'record_inspection', { p_reg: REG(20), p_result: 'conditional', p_issues: ['helmet'], p_note: 'MEDNOTE-PRIVATE strap torn, bruised neck, allergy to latex' }), 'inspect 20 conditional');
  must(await rpc('desk', 'record_weigh_in', { p_reg: REG(3), p_weight_kg: 83.5 }), 'weigh-in Cael');   // Cael: checked in, NOT inspected -> not ready; Hale (8): not checked in -> not ready
  const ready = sql(`select string_agg(full_name || ':' || ready, ',' order by full_name) from private.readiness_rows('${EVENT}', false) where registration_id in ('${REG(3)}','${REG(8)}','${REG(20)}','${REG(1)}')`);
  check('0. readiness as the desk sees it: Aldric ready; Cael (armour not inspected), Hale (not here) and Soren (armour needs correction) NOT ready', /Aldric Stone:true/.test(ready) && /Cael Rhodes:false/.test(ready) && /Hale Morrow:false/.test(ready) && /Soren Vale:false/.test(ready), ready);

  // ---- earlier fights, finished through the real Lyst functions (oldest first)
  await playMatch('scorekeeper', mid(21), [[6, 1], [5, 2]], 'a');                                        // Polearm semifinal (Field 1): Kell Arden beat Lorn Ashby
  await playMatch('scorekeeper', mid(14), [[5, 2], [4, 3]], 'a');                                        // Sword and shield (Field 2): Aldric beat Ivor
  await playMatch('scorekeeper', mid(31), [[5, 2], [3, 1]], 'a');                                        // Buckler (Field 3): Odin beat Taylor
  await playMatch('scorekeeper', mid(15), [[2, 5], [3, 4]], 'b');                                        // Sword and shield: Garrick beat Aldric
  must(await open('scorekeeper', mid(32)), 'open m32');
  must(await discipline('scorekeeper', mid(32), 1, 'b', 'dq', { p_reason: 'PRIVATE-REASON-DQ unsafe strike to the head', p_called_by: 'Marshal Mo' }), 'dq');
  must(await confirm('scorekeeper', mid(32), 1, 4, 0), 'confirm m32');
  must(await finalize('scorekeeper', mid(32), 'a', 'dq'), 'finalize m32 by DQ');                        // Buckler: Pia beat Quin by disqualification (newest result)
  check('0. five finished fights through lyst_finalize (one by disqualification)', sql(`select count(*) from public.matches where queue_state = 'final'`) === '5', sql(`select string_agg(id::text || queue_state, ',') from public.matches where queue_state = 'final'`));

  // ---- the queue (existing function) and the two simultaneous live fights
  for (const [f, start] of [[null, true], ['Field 2', true], ['Field 3', false]]) must(await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: f, p_start: start }), `queue ${f}`);
  const states = sql(`select string_agg(distinct coalesce(field, 'Field 1') || '=' || queue_state, ',' order by coalesce(field, 'Field 1') || '=' || queue_state) from public.matches where queue_state in ('active','on_deck','in_the_hole')`);
  check('0. the queue: Field 1 and Field 2 each have an ACTIVE fight; Field 3 has none (on deck only)', /Field 1=active/.test(states) && /Field 2=active/.test(states) && !/Field 3=active/.test(states), states);
  // Lyst 1: Aldric v Brann. Round 1 confirmed 5-3 with a 1-point deduction on Aldric (official 4-3); round 2 RUNNING (a long timer so the test never runs out of clock)
  must(await open('scorekeeper', mid(1)), 'open m1');
  must(await startRound('scorekeeper', 'Field 1', mid(1), 1, 180000), 'start m1 round 1');
  must(await discipline('scorekeeper', mid(1), 1, 'a', 'deduction', { p_amount: 1, p_reason: 'PRIVATE-REASON-DEDUCT unsafe conduct', p_called_by: 'Marshal Mo' }), 'deduction');
  must(await endRound('scorekeeper', mid(1), 1), 'end m1 round 1');
  must(await confirm('scorekeeper', mid(1), 1, 5, 3), 'confirm m1 round 1');
  must(await startRound('scorekeeper', 'Field 1', mid(1), 2, 1800000), 'start m1 round 2');
  must(await discipline('scorekeeper', mid(1), 2, 'b', 'card', { p_label: 'Yellow card', p_reason: 'PRIVATE-REASON-CARD', p_called_by: 'Marshal Mo' }), 'card');
  // Lyst 2: Jory Wick v Garrick Fell, round 1 running, a warning on Garrick
  must(await open('scorekeeper', mid(11)), 'open m11');
  must(await startRound('scorekeeper', 'Field 2', mid(11), 1, 1800000), 'start m11 round 1');
  must(await discipline('scorekeeper', mid(11), 1, 'b', 'warning', { p_reason: 'PRIVATE-REASON-WARN', p_called_by: 'Marshal Mo' }), 'warning');
  check('0. two fights are LIVE at the same time (Field 1 round 2 running, Field 2 round 1 running)', sql(`select string_agg(field_key || ':' || round_no || ':' || status, ',' order by field_key) from public.lyst_timer where event_id = '${EVENT}'`) === 'field 1:2:running,field 2:1:running');
  const dayShot = snapshot();
  console.log('--- the day is set; opening the announcer screens');

  // ================================================================== 1. three viewports, the permanent announcer account
  const checkViewport = async (kind) => {
    const page = await openPage(kind, 'announcer');
    await page.goto(BASE + ANN());
    await page.waitForSelector('[data-testid="announcer-main"] .an-lyst', { timeout: 40000 });
    await until(async () => (await lystText(page, 'field 1')).includes('aldric stone') && /not yet ready/.test(await bodyText(page)), 30000);
    await sleep(1500);
    const t = await bodyText(page), l = await layout(page);
    const l1 = await lystText(page, 'field 1'), l2 = await lystText(page, 'field 2'), l3 = await lystText(page, 'field 3');
    check(`1[${kind}]. three Lysts are on screen, in order: Lyst 1, Lyst 2, Lyst 3`, (await page.locator('.an-lyst').count()) === 3 && t.indexOf('lyst 1') < t.indexOf('lyst 2') && t.indexOf('lyst 2') < t.indexOf('lyst 3'), t.slice(0, 300));
    check(`1[${kind}]. NOW FIGHTING Lyst 1: Aldric Stone v Brann Oakley, competition, round 2`, /now fighting/.test(l1) && /aldric stone/.test(l1) && /brann oakley/.test(l1) && /longsword/.test(l1) && /round 2/.test(l1), l1.slice(0, 400));
    check(`1[${kind}]. NOW FIGHTING Lyst 2 (at the same time): Jory Wick v Garrick Fell, round 1`, /jory wick/.test(l2) && /garrick fell/.test(l2) && /round 1/.test(l2) && /sword and shield/.test(l2) && /fighting now/.test(l2), l2.slice(0, 400));
    const score = async (key, side) => (await lyst(page, key).locator('.an-side').nth(side).locator('.an-score').textContent().catch(() => null))?.trim();
    check(`1[${kind}]. the OFFICIAL score (marshal-confirmed, deduction applied): Lyst 1 shows 4 – 3 (not the raw 5), Lyst 2 shows 0 – 0`, (await score('field 1', 0)) === '4' && (await score('field 1', 1)) === '3' && (await score('field 2', 0)) === '0' && (await score('field 2', 1)) === '0', `${await score('field 1', 0)}/${await score('field 1', 1)}/${await score('field 2', 0)}`);
    const c1 = await lyst(page, 'field 1').locator('.an-clock-n').textContent(); await sleep(2300); const c2 = await lyst(page, 'field 1').locator('.an-clock-n').textContent();
    const secs = (s) => { const m = /^(\d+):(\d\d)$/.exec((s ?? '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
    check(`1[${kind}]. the clock TICKS (${c1} then ${c2}) and runs from the server time`, secs(c2) < secs(c1) && secs(c1) > 1200 && secs(c1) <= 1800, `${c1} -> ${c2}`);
    check(`1[${kind}]. marks as the overlay shows them: Lyst 1 "Yellow card" on Brann and "−1 point" on Aldric; Lyst 2 "Warning" on Garrick`, /yellow card/.test(l1) && /−1 point/.test(l1) && /warning/.test(l2), `${l1.slice(0, 500)} || ${l2.slice(0, 500)}`);
    const upside = (key, name) => lyst(page, key).locator('.an-up-side').filter({ hasText: name }).first();
    const cael = lower(await upside('field 1', 'Cael Rhodes').textContent()), dara = lower(await upside('field 1', 'Dara Voss').textContent());
    check(`1[${kind}]. UP NEXT Lyst 1 (Cael v Dara): Cael "Not yet ready", Dara "Ready"`, /not yet ready/.test(cael) && /ready/.test(dara) && !/not yet/.test(dara), `${cael} | ${dara}`);
    const hale = lower(await upside('field 2', 'Hale Morrow').textContent()), ivor = lower(await upside('field 2', 'Ivor Penn').textContent());
    check(`1[${kind}]. UP NEXT Lyst 2 (Hale v Ivor): Hale "Not yet ready", Ivor "Ready"`, /not yet ready/.test(hale) && /ready/.test(ivor) && !/not yet/.test(ivor), `${hale} | ${ivor}`);
    check(`1[${kind}]. Lyst 3 is between fights with nobody on it: UP NEXT Rhea Cole v Soren Vale, Soren "Not yet ready"`, /between fights/.test(l3) && /nobody on the lyst/.test(l3) && /rhea cole/.test(l3) && /soren vale/.test(l3) && /not yet ready/.test(lower(await upside('field 3', 'Soren Vale').textContent())), l3.slice(0, 400));
    const comingN = await lyst(page, 'field 1').locator('[data-testid="coming-up"]').count();
    check(`1[${kind}]. COMING UP is small (${comingN} fights, at most 5 after Up next), starting with the fight in the hole (Edric Hale v Fenna Crow)`, comingN >= 3 && comingN <= 5 && /in the hole · longsword \(men\) · round 1[\s\S]*edric hale/.test(l1), l1.slice(0, 900));
    const recent = lower(await page.locator('.an-recent').innerText());
    check(`1[${kind}]. RECENT RESULTS: five finished fights, newest first (Pia Lund by disqualification, then Garrick Fell, Odin Robson, Aldric Stone, Kell Arden)`, (await page.locator('[data-testid="recent-result"]').count()) === 5
      && recent.indexOf('pia lund') < recent.indexOf('garrick fell') && recent.indexOf('garrick fell') < recent.indexOf('odin robson') && recent.indexOf('odin robson') < recent.indexOf('kell arden') && /by disqualification/.test(recent) && /winner: pia lund/.test(recent), recent.slice(0, 600));
    check(`1[${kind}]. result lines carry the official final score, the competition and the Lyst`, /\d+ – \d+/.test(recent) && /sword and shield/.test(recent) && /lyst 2/.test(recent), recent.slice(0, 500));
    check(`1[${kind}]. no sideways scroll (scrollWidth ${l.sw} <= ${l.vw}) and nothing pokes out of the screen`, l.sw <= l.vw + 1 && l.over.length === 0, JSON.stringify(l.over.slice(0, 5)));
    check(`1[${kind}]. touch targets are at least 44 px and no text is below 12 px`, l.small.length === 0 && l.tiny === 0, JSON.stringify({ small: l.small.slice(0, 6), tiny: l.tiny }));
    check(`1[${kind}]. nothing is clipped inside a card`, l.clipped.length === 0, JSON.stringify(l.clipped.slice(0, 6)));
    check(`1[${kind}]. READ-ONLY: no input, textarea, select or form on the page; the only buttons are Camera Off, the Focus chips and the fighter cards`, l.inputs === 0 && await page.evaluate(() => {
      const ok = (b) => /camera off/i.test(b.getAttribute('aria-label') || b.textContent) || b.closest('.an-focus') || b.getAttribute('aria-haspopup') === 'dialog' || b.classList.contains('an-close');
      return [...document.querySelectorAll('.ann button, .ann a, .ann [role=button]')].every(ok);
    }));
    check(`1[${kind}]. no "undefined", "NaN", "null" or "[object" on screen, no console errors`, !/\b(undefined|nan|null)\b|\[object/.test(t) && page.errors.length === 0, page.errors.join(' | ') + t.slice(0, 100));
    await shot(page, `${kind}-01-board`);
    if (kind === 'phone') for (let i = 0; i < 5; i++) { await page.evaluate((y) => window.scrollTo(0, y), i * 780); await shot(page, `phone-01-board-part${i + 1}`, false); }
    await page.evaluate(() => window.scrollTo(0, 0));
    return page;
  };
  const tablet = await checkViewport('tablet'); const desktop = await checkViewport('desktop'); const phone = await checkViewport('phone');
  const dm = await desktop.evaluate(() => { const r = document.querySelector('.an-recent').getBoundingClientRect(), l = document.querySelector('.an-lysts').getBoundingClientRect(); return { rightOf: r.left >= l.right - 2, sticky: getComputedStyle(document.querySelector('.an-recent')).position }; });
  check('1[desktop]. on a wide screen the results sit BESIDE the Lysts (their own column), not far below', dm.rightOf, JSON.stringify(dm));
  const dcols = await desktop.evaluate(() => [...document.querySelectorAll('.an-lyst')].map(e => Math.round(e.getBoundingClientRect().left)));
  check('1[desktop]. the two live Lysts sit SIDE BY SIDE on a 1280 px screen (Lyst 1 and Lyst 2 share a row)', dcols[0] !== dcols[1] && new Set(dcols).size === 2, JSON.stringify(dcols));
  const tm = await tablet.evaluate(() => ({ cols: getComputedStyle(document.querySelector('.an-lysts')).gridTemplateColumns.split(' ').length }));
  console.log('INFO  tablet 820 px: Lyst columns =', tm.cols);
  await tablet.ctx.close(); await desktop.ctx.close();

  // ================================================================== 2. fighter info on tap (phone)
  const live1 = lyst(phone, 'field 1');
  await live1.locator('.an-side').nth(0).click();
  await phone.getByTestId('info-panel').waitFor({ timeout: 10000 });
  await until(async () => /career record/.test(await textOf(phone, '[data-testid="info-panel"]')) && !/loading/.test(await textOf(phone, '[data-testid="info-panel"]')), 10000);
  const info1 = await textOf(phone, '[data-testid="info-panel"]');
  check('2. TAP a fighter: a card with name, team, corner, competition, career record, record at this event, earlier fights', /aldric stone/.test(info1) && /iron wolves/.test(info1) && /red corner/.test(info1) && /longsword/.test(info1) && /career record/.test(info1) && /at this event/.test(info1) && /earlier fights at this event/.test(info1), info1);
  check('2. ... the earlier fights are this fighter\'s own results today (Won v Ivor Penn, Lost v Garrick Fell)', /won vs ivor penn/.test(info1) && /lost vs garrick fell/.test(info1), info1);
  check('2. ... a TEST event is labelled "Test"', /test/.test(info1), info1);
  check('2. ... the card shows no email, phone, account, note, weigh-in or medical information', !/@|medical|weigh|MEDNOTE|emergency|phone|e-?mail/i.test(info1), info1);
  await shot(phone, 'phone-02-fighter-card', false);
  await phone.getByRole('button', { name: 'Close' }).click();
  check('2. Close closes the card', await until(async () => (await phone.getByTestId('info-panel').count()) === 0, 5000));

  // ================================================================== 3. Focus Lyst changes NOTHING on the server
  const before = snapshot();
  const reqsBefore = phone.reqs.length;
  await phone.getByRole('button', { name: 'Focus Lyst 2' }).click();
  const focusOk = await until(async () => (await phone.locator('.an-lyst').first().getAttribute('data-lyst')) === 'field 2' && (await phone.getByRole('button', { name: 'Focus Lyst 2' }).getAttribute('aria-pressed')) === 'true', 5000);
  check('3. Focus Lyst 2: Lyst 2 comes first, the chip is pressed, the other Lysts are smaller', focusOk && (await phone.locator('.an-lyst.is-compact').count()) === 2, await bodyText(phone));
  await shot(phone, 'phone-03-focus-lyst-2');
  await phone.getByRole('button', { name: 'Focus Lyst 3' }).click(); await sleep(500);
  await phone.getByRole('button', { name: 'All Lysts' }).click(); await sleep(500);
  await phone.getByRole('button', { name: 'Focus Lyst 2' }).click(); await sleep(1500);
  const after = snapshot();
  const wrote = phone.reqs.slice(reqsBefore).filter(r => r.method !== 'GET' && !/\/rpc\/(announcer_readiness|camera_state|fighter_career|team_career)\b/.test(r.url));
  check('3. Focus Lyst changed NOTHING server-side: queue, timer, rounds, discipline, counters, broadcast control, camera, announcements, audit, results (25 tables diffed)', diff(before, after).length === 0, JSON.stringify(diff(before, after)));
  check('3. ... and the page sent no write: every non-GET request while focusing was a read-only function', wrote.length === 0, JSON.stringify(wrote.map(r => r.url)));
  check('3. ... the choice is local only (localStorage), nothing else', await phone.evaluate(() => Object.keys(localStorage).filter(k => /announcer-focus/.test(k)).length === 1));
  await phone.reload(); await phone.waitForSelector('.an-lyst', { timeout: 30000 });
  check('3. ... and it is remembered on this device after a reload (Lyst 2 still first)', await until(async () => (await phone.locator('.an-lyst').first().getAttribute('data-lyst')) === 'field 2', 8000));

  // ================================================================== 4. live changes update IN PLACE (a scrolled phone page, focus chosen, a fighter card open)
  await phone.waitForSelector('.an-lyst');
  const H = await docH(phone);
  const target = Math.min(Math.max(400, Math.round(H * 0.35)), H - 844 - 20);
  await phone.evaluate((y) => window.scrollTo(0, y), target); await sleep(400);
  const y0 = await scrollY(phone);
  // open Aldric's card (Lyst 1, now fighting) and remember the DOM node and the focused element
  await phone.locator('[data-lyst="field 1"] .an-side').nth(0).scrollIntoViewIfNeeded().catch(() => undefined);
  await phone.evaluate((y) => window.scrollTo(0, y), target); await sleep(300);
  await phone.locator('[data-lyst="field 1"] .an-side').nth(0).click({ force: true });
  await phone.getByTestId('info-panel').waitFor();
  const y1 = await scrollY(phone);
  await phone.evaluate(() => { window.__ann = document.querySelector('.ann'); window.__card = document.querySelector('[data-testid="info-panel"]'); window.__lyst2 = document.querySelector('[data-lyst="field 2"]'); window.__main = document.querySelector('[data-testid="announcer-main"]'); });
  const probe = async () => phone.evaluate(() => ({
    sameRoot: window.__ann === document.querySelector('.ann') && document.contains(window.__ann), sameMain: window.__main === document.querySelector('[data-testid="announcer-main"]'),
    sameCard: window.__card === document.querySelector('[data-testid="info-panel"]'), sameLyst2: window.__lyst2 === document.querySelector('[data-lyst="field 2"]'),
    y: Math.round(window.scrollY), loading: /loading/i.test(document.body.innerText) && !document.querySelector('.an-info'),
    focus2: document.querySelector('.an-focus [aria-pressed="true"]')?.textContent ?? '', firstLyst: document.querySelector('.an-lyst')?.getAttribute('data-lyst'),
    card: (document.querySelector('[data-testid="info-panel"]')?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase()
  }));
  check(`4. set up: the phone page is scrolled (scrollY ${y1}, page ${H}px tall), Lyst 2 focused, Aldric's card open`, y1 > 100, `y0 ${y0} y1 ${y1} H ${H}`);
  await shot(phone, 'phone-04-scrolled-card-open', false);
  const stable = async (label, expectText) => {
    const p = await probe();
    check(`4. ${label}: IN PLACE (same page, same cards, no "Loading"), scroll kept (${y1} -> ${p.y}), focus kept, card still open`,
      p.sameRoot && p.sameMain && p.sameCard && p.sameLyst2 && !p.loading && p.y > 0 && Math.abs(p.y - y1) <= 160 && p.focus2.toLowerCase().includes('focus lyst 2') && p.firstLyst === 'field 2' && p.card.includes('aldric stone'), JSON.stringify(p));
    return p;
  };

  // (a) a score is confirmed on Lyst 2: round 1 ends, 3-2 official
  must(await endRound('scorekeeper', mid(11), 1), 'end m11 r1'); must(await confirm('scorekeeper', mid(11), 1, 3, 2), 'confirm m11 r1');
  const gotA = await until(async () => /3\s*[\s\S]*2/.test('') || (await lyst(phone, 'field 2').locator('.an-score').allTextContents()).map(s => s.trim()).join(',') === '3,2', 30000);
  check('4a. a CONFIRMED round on Lyst 2 shows up as the official score 3 – 2 within seconds', gotA, (await lyst(phone, 'field 2').locator('.an-score').allTextContents()).join(','));
  await stable('after the score was confirmed');

  // (b) the Lyst 1 fight finishes (round 2 confirmed 6-2, match finalized: Aldric wins 10 - 5)
  must(await endRound('scorekeeper', mid(1), 2), 'end m1 r2'); must(await confirm('scorekeeper', mid(1), 2, 6, 2), 'confirm m1 r2'); must(await finalize('scorekeeper', mid(1), 'a'), 'finalize m1');
  const topResult = async () => lower(await phone.locator('[data-testid="recent-result"]').first().innerText().catch(() => ''));
  const gotB = await until(async () => /brann oakley/.test(await topResult()) && /winner: aldric stone/.test(await topResult()), 45000);
  check('4b. a fight FINISHES: the new result appears at the top of Recent results (Aldric Stone beat Brann Oakley)', gotB, await topResult());
  await stable('after a fight finished');
  const cardAfterB = await until(async () => /won vs brann oakley/.test((await probe()).card), 20000) ? (await probe()).card : (await probe()).card;
  check('4b. ... and the OPEN fighter card kept up: it now lists the new fight (Won vs Brann Oakley) without being reopened', /won vs brann oakley/.test(cardAfterB), cardAfterB);
  check('4b. ... Lyst 1 no longer shows Brann as fighting (nobody on the Lyst, or the next fight)', !/brann oakley/.test((await lystText(phone, 'field 1')).split('up next')[0]), (await lystText(phone, 'field 1')).slice(0, 300));

  // (c) the next fight starts on Lyst 1 (the existing queue function), round 1 running
  must(await rpc('organizer', 'advance_field_queue', { p_event: EVENT, p_field: null, p_start: true }), 'advance field 1');
  must(await open('scorekeeper', mid(2)), 'open m2'); must(await startRound('scorekeeper', 'Field 1', mid(2), 1, 1800000), 'start m2');
  const gotC = await until(async () => /cael rhodes/.test((await lystText(phone, 'field 1')).split('up next')[0]) && /round 1/.test((await lystText(phone, 'field 1')).split('up next')[0]), 40000);
  check('4c. ANOTHER fight STARTS: Cael Rhodes v Dara Voss is now fighting on Lyst 1 (round 1, the clock running)', gotC, (await lystText(phone, 'field 1')).slice(0, 400));
  const pc = await stable('after the next fight started');
  const nextNow = await lystText(phone, 'field 1');
  check('4c. ... "Up next" on Lyst 1 moved on (Edric Hale v Fenna Crow), and the rest of the line followed', /up next[\s\S]*edric hale/.test(nextNow), nextNow.slice(0, 500));
  await shot(phone, 'phone-05-after-live-changes', false);

  // (d) a card is given
  must(await discipline('scorekeeper', mid(2), 1, 'a', 'card', { p_label: 'Red card', p_reason: 'PRIVATE-REASON-RED' }), 'red card');
  const gotD = await until(async () => /red card/.test(await lystText(phone, 'field 1')), 30000);
  check('4d. a new CARD appears on the fighter in place (Red card on Cael Rhodes)', gotD, (await lystText(phone, 'field 1')).slice(0, 400));
  await stable('after a card');
  // close the card; the page is still where it was
  await phone.getByRole('button', { name: 'Close' }).click();
  const yEnd = await scrollY(phone);
  check('4. closing the card leaves the page where it was (scroll kept)', yEnd > 0 && Math.abs(yEnd - y1) <= 160, `${y1} -> ${yEnd}`);

  // ================================================================== 5. offline, then reconnect: last good data + the stale note
  await phone.getByRole('button', { name: 'All Lysts' }).click(); await sleep(300);
  const scoresBeforeOffline = (await lyst(phone, 'field 1').locator('.an-score').allTextContents()).map(s => s.trim()).join(',');
  await phone.ctx.setOffline(true);
  const stale = await until(async () => (await phone.getByTestId('stale-banner').count()) === 1, 60000, 500);
  const staleText = lower(await phone.getByTestId('stale-banner').textContent().catch(() => ''));
  check('5. OFFLINE: after ~20 s the page says "Not updating, last good HH:MM:SS"', stale && /not updating, last good \d\d:\d\d:\d\d/.test(staleText), staleText);
  const offBody = await bodyText(phone);
  check('5. ... the last good data stays on screen (nothing blanked, no "Loading", no error page)', (await lystText(phone, 'field 1')).includes('cael rhodes') && !/loading…|something went wrong|could not load/.test(offBody) && (await phone.getByTestId('now-fighting').count()) >= 2, offBody.slice(0, 200));
  await shot(phone, 'phone-06-offline-stale', false);
  // while offline the server moves on (a card is voided / a score is confirmed): the screen must not pretend to know
  must(await endRound('scorekeeper', mid(2), 1), 'end m2 r1'); must(await confirm('scorekeeper', mid(2), 1, 4, 4), 'confirm m2 r1 while the announcer is offline');
  await sleep(1500);
  const scoresOffline = (await lyst(phone, 'field 1').locator('.an-score').allTextContents()).map(s => s.trim()).join(',');
  check('5. ... while offline the screen keeps the last good scores (it does not guess: still the old 0,0 of round 1 of the new fight)', scoresOffline === scoresBeforeOffline, `${scoresBeforeOffline} -> ${scoresOffline}`);
  await phone.ctx.setOffline(false);
  const back = await until(async () => (await phone.getByTestId('stale-banner').count()) === 0, 45000, 500);
  check('5. RECONNECT: the stale note goes away by itself', back, await bodyText(phone));
  const caughtUp = await until(async () => (await lyst(phone, 'field 1').locator('.an-score').allTextContents()).map(s => s.trim()).join(',') === '4,4', 40000);
  check('5. ... and the page catches up with what happened meanwhile (round 1 confirmed 4 – 4 on Lyst 1), in place', caughtUp, (await lyst(phone, 'field 1').locator('.an-score').allTextContents()).join(','));
  check('5. ... same page throughout (never remounted)', (await probe()).sameRoot, JSON.stringify(await probe()));

  // ================================================================== 6. a draft event; a stranger; anonymous
  const draft = await openPage('phone', 'announcer');
  await draft.goto(BASE + ANN('draft-cup')); await draft.waitForSelector('.ann', { timeout: 30000 });
  await until(async () => /not public yet|not available/.test(await bodyText(draft)), 20000);
  const dt = await bodyText(draft);
  check('6. a DRAFT event: the screen says it is not public yet / not available (no fights, no error page)', /not public yet|not available/.test(dt) && !/now fighting/.test(dt), dt.slice(0, 300));
  check('6. ... and says what to do (ask the organizer to publish it)', /publish/.test(dt), dt.slice(0, 300));
  await shot(draft, 'phone-07-draft', false);
  const dl = await layout(draft); check('6. ... no sideways scroll on the message screen', dl.sw <= dl.vw + 1);
  await draft.ctx.close();
  const anon = await openPage('phone', null);
  await anon.goto(BASE + ANN()); await anon.waitForSelector('[data-testid="announcer-main"] .an-lyst', { timeout: 40000 });
  await sleep(2500);
  const anonText = await bodyText(anon);
  check('6. ANONYMOUS (no account): the board is public sporting data (Lysts, fights, results) but NO readiness chips and NO Camera Off button', /aldric stone|cael rhodes/.test(anonText) && !/not yet ready|✓ ready/.test(anonText) && (await anon.getByRole('button', { name: /camera off/i }).count()) === 0, anonText.slice(0, 300));
  const stranger = await openPage('phone', 'stranger');
  await stranger.goto(BASE + ANN()); await stranger.waitForSelector('[data-testid="announcer-main"] .an-lyst', { timeout: 40000 }); await sleep(2500);
  const st = await bodyText(stranger);
  check('6. a signed-in STRANGER (no role at this event): no readiness, no Camera Off button (the database says no)', !/not yet ready/.test(st) && (await stranger.getByRole('button', { name: /camera off/i }).count()) === 0, st.slice(0, 200));
  await anon.ctx.close(); await stranger.ctx.close();

  // ================================================================== 7. Camera Off
  check('7. before: the CAMERA OFF button is on the page', (await phone.getByRole('button', { name: /emergency camera off/i }).count()) === 1);
  const dayCam = sql(`select count(*) from public.event_camera_log where event_id = '${EVENT}'`);
  await phone.getByRole('button', { name: /emergency camera off/i }).click();
  await phone.getByRole('dialog').waitFor({ timeout: 8000 });
  const dlg = lower(await phone.getByRole('dialog').innerText());
  check('7. the button opens a sheet of reasons (nothing happens on the first tap)', /medical/.test(dlg) && /private moment/.test(dlg) && sql(`select count(*) from public.event_camera_log where event_id = '${EVENT}'`) === dayCam);
  const sheet = await phone.getByRole('dialog').evaluate(e => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), vw: innerWidth, over: [...e.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > innerWidth + 1).length }; });
  check('7. the reasons sheet fits the phone screen (nothing cut off at the right edge)', sheet.l >= 0 && sheet.r <= sheet.vw + 1 && sheet.over === 0, JSON.stringify(sheet));
  await shot(phone, 'phone-08-camera-sheet', false);
  await phone.keyboard.press('Escape'); await sleep(400);
  // a marshal (permanent account, event role `marshal`) activates through the RPC
  const act = await rpc('marshal', 'camera_off_activate', { p_event: EVENT, p_reason: 'camera_problem' });
  check('7. a marshal activates Camera Off through the function (200, status off)', okay(act) && act.body?.status === 'off', act.text);
  const bannerSeen = await until(async () => /cameras off/.test(await bodyText(phone)), 20000);
  const cb = await bodyText(phone);
  check('7. the CAMERAS OFF banner appears on the announcer\'s page within seconds (reason, who, when)', bannerSeen && /reason: camera problem/.test(cb) && /activated by: marsha marshal \(marshal\)/.test(cb), cb.slice(0, 400));
  check('7. ... and the CAMERA OFF button DISAPPEARS (already off)', (await phone.getByRole('button', { name: /emergency camera off/i }).count()) === 0);
  check('7. ... an announcer cannot turn the cameras back on (no release button; it says it waits for the head marshal or an event admin)', (await phone.getByRole('button', { name: /turn cameras back on/i }).count()) === 0 && /waiting for authorized release/.test(cb), cb.slice(0, 400));
  await shot(phone, 'phone-09-cameras-off', false);
  const lb = await layout(phone); check('7. ... the banner does not break the layout (no sideways scroll)', lb.sw <= lb.vw + 1 && lb.over.length === 0, JSON.stringify(lb.over.slice(0, 4)));
  const relA = await rpc('announcer', 'camera_off_release', { p_event: EVENT });
  check('7. the database refuses an announcer\'s release (4xx)', refused(relA), relA.text);
  check('7. the head marshal releases it; the announcer\'s button comes back', okay(await rpc('head', 'camera_off_release', { p_event: EVENT, p_note: 'all clear' })) && await until(async () => (await phone.getByRole('button', { name: /emergency camera off/i }).count()) === 1 && !/cameras off/.test(await bodyText(phone)), 20000));
  // the announcer's own tap works end to end
  await phone.getByRole('button', { name: /emergency camera off/i }).click(); await phone.getByRole('dialog').waitFor();
  await phone.getByRole('dialog').getByRole('button', { name: /private moment/i }).click();
  check('7. the ANNOUNCER\'s own tap (reason: private moment) turns the cameras off: banner shown, recorded as role announcer', await until(async () => /cameras off/.test(await bodyText(phone)), 15000)
    && sql(`select active || ':' || reason || ':' || activated_by_role from public.event_camera_state where event_id = '${EVENT}'`) === 'true:privacy:announcer', sql(`select * from public.event_camera_state where event_id = '${EVENT}'`));
  await rpc('head', 'camera_off_release', { p_event: EVENT });
  await until(async () => (await phone.getByRole('button', { name: /emergency camera off/i }).count()) === 1, 15000);

  // ================================================================== 8. page-level privacy: everything the browsers received
  const apiBodies = NET.filter(n => /\/rest\/v1\//.test(n.url));
  const allUsers = sql('select id from auth.users').split('\n').filter(Boolean);
  const allEmails = sql('select email from auth.users').split('\n').filter(Boolean);
  const blob = (list) => list.map(n => n.body).join('\n');
  const pubBlob = blob(apiBodies.filter(n => n.who !== 'announcer' || !/camera_state|announcer_readiness/.test(n.url)));
  const hits = (re, text) => (text.match(re) ?? []).length;
  check(`8. ${apiBodies.length} data responses captured across ${new Set(NET.map(n => n.who + n.kind)).size} browser sessions (plus ${NET.length - apiBodies.length} auth/other); none of the data responses contains an e-mail address`, hits(/[\w.+-]+@[\w-]+\.[\w.]+/g, blob(apiBodies)) === 0 && allEmails.every(e => !blob(apiBodies).includes(e)), (blob(apiBodies).match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []).slice(0, 5).join(','));
  check('8. ... none contains an account id (any auth.users id, incl. the viewer\'s own, in any REST/RPC response)', allUsers.every(u => !blob(apiBodies).includes(u)), allUsers.filter(u => blob(apiBodies).includes(u)).join(','));
  check('8. ... none contains an inspection note, a weigh-in, a medical word, a reason or a marshal\'s name for a card (MEDNOTE, 83.5, PRIVATE-REASON, "Marshal Mo")', !/MEDNOTE|83\.5|PRIVATE-REASON|Marshal Mo|allergy|latex|bruised/i.test(blob(apiBodies)), (blob(apiBodies).match(/MEDNOTE|83\.5|PRIVATE-REASON|Marshal Mo|allergy|latex|bruised/gi) ?? []).join(','));
  check('8. ... no response carries a "note", "notes", "reason" (except the camera reason), "weigh", "emergency" or "medical" KEY from a table (names only)', !/"(notes?|weight_kg|weigh\w*|emergency\w*|medical\w*|contact_\w+|phone|email)"\s*:/i.test(blob(apiBodies.filter(n => !/camera_/.test(n.url)))), (blob(apiBodies).match(/"(notes?|weight_kg|weigh\w*|emergency\w*|medical\w*|contact_\w+|phone|email)"\s*:/gi) ?? []).slice(0, 8).join(','));
  const readiness = NET.filter(n => /rpc\/announcer_readiness/.test(n.url) && n.status === 200 && n.who === 'announcer');
  const rkeys = new Set(readiness.flatMap(n => { try { return JSON.parse(n.body).flatMap(Object.keys); } catch { return ['PARSE']; } }));
  check('8. announcer_readiness returns ONLY match_id, side, ready (no reasons, no names)', readiness.length > 0 && [...rkeys].sort().join(',') === 'match_id,ready,side', [...rkeys].join(','));
  const domAll = await bodyText(phone);
  check('8. nothing private is in the page text either', !/@example|mednote|private-reason|83\.5|allergy/.test(domAll));
  const wr = NET.filter(n => n.who === 'announcer' && n.method !== 'GET' && !/rpc\/(announcer_readiness|camera_state|fighter_career|team_career)/.test(n.url));
  const wrDetail = wr.map(n => `${n.method} ${n.url.replace(API, '')} ${n.status}`);
  check('8. every non-GET call the announcer\'s browser made was a read function, or the Camera Off button (camera_off_activate is the only write)', wr.every(n => /rpc\/camera_off_activate/.test(n.url)) && wr.filter(n => /camera_off_activate/.test(n.url)).length === 1, wrDetail.join(' | '));
  const pageRpcs = new Set(NET.filter(n => n.who === 'announcer' && /rpc\//.test(n.url)).map(n => n.url.replace(/.*rpc\//, '').replace(/\?.*/, '')));
  console.log('INFO  functions the announcer page called:', [...pageRpcs].sort().join(', '));
  check('8. the page called no function that is not a read (list)', [...pageRpcs].every(f => /^(announcer_readiness|camera_state|camera_off_activate|fighter_career|team_career)$/.test(f)), [...pageRpcs].join(','));

  // ================================================================== 9. a DEVICE session as an `announcer` (minted token), against the Data API
  const labelOf = 'Announcer Tablet (e2e)';
  const dcode = crypto.randomBytes(32).toString('hex');
  const out = psqlFile(`
begin;
select set_config('request.jwt.claim.sub', '${U('a2')}', true);
select public.create_event_credential('${EVENT}', 'device', '${labelOf}', 'announcer', decode('${dcode}', 'hex'));
select set_config('request.jwt.claim.sub', '', true);
select (public.device_open_session(decode('${dcode}', 'hex'), decode('${crypto.randomBytes(32).toString('hex')}', 'hex'), 'ip-e2e') ->> 'session_id');
commit;`);
  const sid = out.split('\n').pop().trim();
  check('9. an `announcer` DEVICE credential + open session exist (created through the real functions as the organizer / the Edge Function\'s door)', /^[0-9a-f-]{36}$/.test(sid)
    && sql(`select role from public.event_credentials where label = '${labelOf}'`) === 'announcer' && sql(`select count(*) from public.event_sessions where id = '${sid}'`) === '1', out);
  const dev = hs({ role: 'bos_event_device', sub: sid, aud: 'authenticated', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const D = (fn, args) => call(dev, 'POST', `rpc/${fn}`, args);
  const G = (path) => call(dev, 'GET', path);
  const rd = await D('announcer_readiness', { p_event: EVENT });
  check('9. the announcer device CAN read announcer_readiness (200, rows of match_id / side / ready only)', okay(rd) && Array.isArray(rd.body) && rd.body.length > 0 && rd.body.every(r => Object.keys(r).sort().join() === 'match_id,ready,side'), rd.text.slice(0, 300));
  check('9. ... and the readiness matches the desk: Cael not ready, Dara ready (Lyst 1 up next)', rd.body?.some(r => r.match_id === mid(2) && r.side === 'a' && r.ready === false) && rd.body?.some(r => r.match_id === mid(2) && r.side === 'b' && r.ready === true), JSON.stringify(rd.body?.filter(r => r.match_id === mid(2))));
  const rdOther = await D('announcer_readiness', { p_event: OTHER });
  check('9. ... but not for ANOTHER event (refused)', refused(rdOther), rdOther.text);
  const cs = await D('camera_state', { p_event: EVENT });
  check('9. the announcer device can see the camera state (can_activate, cannot release)', okay(cs) && cs.body?.can_activate === true && cs.body?.can_release === false, cs.text);
  const pub = await G('lyst_public_state?select=match_id,official_a&limit=1');
  check('9. public reads work for the device (lyst_public_state 200)', okay(pub), pub.text);
  const snap0 = snapshot();
  const M1 = mid(3);   // Edric v Fenna, in the hole on Field 1 (any live-ish match)
  const denied = [
    ['lyst_state', { p_match: M1 }],
    ['record_score_event', { p_id: uuid(), p_match: M1, p_kind: 'point', p_payload: { side: 'a', points: 1 } }],
    ['lyst_timer_command', { p_event: EVENT, p_field: 'Field 1', p_match: mid(2), p_expected_rev: 99, p_command: uuid(), p_action: 'pause' }],
    ['lyst_timer_command', { p_event: EVENT, p_field: 'Field 3', p_match: mid(33), p_expected_rev: 0, p_command: uuid(), p_action: 'start', p_mode: 'fight', p_duration_ms: 60000, p_round: 1 }],
    ['set_match_queue', { p_match: mid(33), p_state: 'active', p_field: 'Field 3' }],
    ['send_event_announcement', { p_event: EVENT, p_message: 'The announcer should not be able to send this', p_audience: 'everyone' }],
    ['create_lyst_join_code', { p_event: EVENT, p_field: 'Field 1' }],
    ['correct_result', { p_competition: '00000000-0000-0000-0000-00000000cd01', p_entry: '00000000-0000-0000-0000-00000000e201', p_place: 1, p_points: 10, p_reason: 'announcer trying' }],
    ['lyst_open', { p_match: mid(33), p_counter_input: 'simple' }],
    ['lyst_confirm_round', { p_command: uuid(), p_match: mid(2), p_round: 1, p_awarded_a: 9, p_awarded_b: 0, p_expected_rev: 99 }],
    ['lyst_finalize', { p_command: uuid(), p_match: mid(2), p_expected_version: 1, p_result: 'a' }],
    ['lyst_record_discipline', { p_command: uuid(), p_match: mid(2), p_round: 1, p_side: 'a', p_kind: 'warning' }],
    ['advance_field_queue', { p_event: EVENT, p_field: 'Field 3', p_start: true }],
    ['camera_off_release', { p_event: EVENT }],
    ['set_broadcast_control', { p_event: EVENT, p_expected_rev: 0, p_patch: { mode: 'manual' } }],
    ['broadcast_control_state', { p_event: EVENT }],
    ['event_command_snapshot', { p_event: EVENT }],
    ['event_readiness', { p_event: EVENT }],
    ['set_attendance', { p_reg: REG(8), p_state: 'checked_in' }],
    ['record_inspection', { p_reg: REG(8), p_result: 'passed', p_issues: [], p_note: null }],
    ['grant_event_role_by_email', { p_event: EVENT, p_email: 'x@example.test', p_role: 'marshal' }],
    ['list_event_credentials', { p_event: EVENT }],
    ['list_event_staff', { p_event: EVENT }],
    ['counter_record', { p_seat: uuid(), p_command: uuid(), p_points: 1, p_round: 1 }],
    ['device_open_session', { p_code_hash: '\\x' + '00'.repeat(32), p_secret_hash: '\\x' + '01'.repeat(32), p_ip_hash: 'x' }]
  ];
  const cst = await D('counter_state', {});
  check('9. device announcer: counter_state (a counter\'s own seat lookup) answers with NO seat and no data (it is the caller\'s own seat; an announcer has none)', okay(cst) && cst.body?.seat === null && Object.keys(cst.body ?? {}).sort().join() === 'seat,server_now', cst.text);
  for (const [fn, args] of denied) { const r = await D(fn, args); check(`9. device announcer: ${fn} is REFUSED (${r.status})`, refused(r), r.text.slice(0, 200)); }
  const tables = ['lyst_counts', 'lyst_counter_seats', 'lyst_counter_rounds', 'lyst_join_codes', 'match_discipline_private', 'lyst_round_revisions', 'registration_checks', 'registration_inspections', 'registration_weighins', 'registration_private',
    'registrations', 'event_staff', 'event_credentials', 'event_sessions', 'audit_log', 'profiles', 'platform_roles', 'notifications', 'event_announcements', 'event_camera_log', 'fighter_accounts', 'score_events', 'results', 'match_live_scores', 'event_broadcast_control', 'broadcast_controller_status'];
  for (const t of tables) { const r = await G(`${t}?select=*&limit=1`); check(`9. device announcer: table ${t} is REFUSED or empty (${r.status}${okay(r) ? ' ' + (Array.isArray(r.body) ? r.body.length : '?') + ' rows' : ''})`, refused(r) || (okay(r) && Array.isArray(r.body) && r.body.length === 0), r.text.slice(0, 200)); }
  const writes = [['matches', 'PATCH', 'id=eq.' + mid(33), { queue_state: 'active' }], ['lyst_timer', 'PATCH', 'field_key=eq.field%201', { status: 'paused' }], ['results', 'POST', '', { competition_id: '00000000-0000-0000-0000-00000000cd01', entry_id: '00000000-0000-0000-0000-00000000e201', final_place: 1, points: 10 }],
    ['event_staff', 'POST', '', { event_id: EVENT, user_id: sid, role: 'organizer' }], ['lyst_rounds', 'DELETE', 'match_id=eq.' + mid(2), undefined]];
  for (const [t, method, q, body] of writes) { const r = await call(dev, method, `${t}${q ? '?' + q : ''}`, body); check(`9. device announcer: direct ${method} on ${t} is REFUSED (${r.status}) or changes nothing`, refused(r) || (okay(r) && (r.body ?? []).length === 0), r.text.slice(0, 200)); }
  const snap1 = snapshot();
  check('9. after every refused call the database is UNCHANGED (25 tables diffed)', diff(snap0, snap1).length === 0, JSON.stringify(diff(snap0, snap1)));
  // the one write the device may do: Camera Off (then the head marshal releases it)
  const dact = await D('camera_off_activate', { p_event: EVENT, p_reason: 'venue' });
  check('9. the announcer device CAN activate Camera Off (and only that): 200', okay(dact) && dact.body?.status === 'off', dact.text);
  check('9. ... attributed to the device in the audit trail (role announcer, device label)', sql(`select count(*) from public.audit_log where event_id = '${EVENT}' and details -> 'device' ->> 'role' = 'announcer' and details -> 'device' ->> 'label' = '${labelOf}'`) !== '0');
  const drel = await D('camera_off_release', { p_event: EVENT });
  check('9. ... and the device cannot release it (refused)', refused(drel), drel.text);
  await rpc('head', 'camera_off_release', { p_event: EVENT });
  // a revoked device session stops working at once
  sql(`update public.event_credentials set revoked_at = now() where label = '${labelOf}'`);
  const afterRevoke = await D('announcer_readiness', { p_event: EVENT });
  check('9. REVOKED: the same token stops working immediately (the database looks the session up on every call)', refused(afterRevoke) , afterRevoke.text);
  check('9. no JWT / the wrong role: anonymous callers are refused announcer_readiness', refused(await call(null, 'POST', 'rpc/announcer_readiness', { p_event: EVENT })) && refused(await call(hs({ role: 'authenticated', sub: U('e3'), aud: 'authenticated', exp: 4102444800 }), 'POST', 'rpc/announcer_readiness', { p_event: EVENT })));

  // ================================================================== done
  const errs = phone.errors; check('10. no page errors or console errors in the announcer browser session', errs.length === 0, errs.join(' | '));
  await shot(phone, 'phone-10-final');
  await browser.close();
} catch (e) {
  check('the scenario ran to the end without an unexpected error', false, e.stack ?? e);
  try { await browser.close(); } catch { /* ignore */ }
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED:\n  ` + failed.map(f => f.name).join('\n  ') : ''}`);
process.exit(failed.length ? 1 : 0);
