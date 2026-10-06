// The BuhurtOS Broadcast Companion (BUILT: tools/obs-controller/dist/companion.mjs, started by its own restart-loop script) against
//   * the OBS STAND-IN (scripts/obs-standin: a protocol stand-in, NOT OBS), and
//   * a REAL local stack: Postgres from every migration + the OBS fixture, PostgREST, localstack (the real device-session Edge Function code).
// Pack 13 is driven through its real RPCs as authorized users (head marshal, scorekeeper, organizer, a marshal DEVICE session); the Companion follows it.
// This verifies the checklist of PLAN 18.5 and 18.6 AT STAND-IN LEVEL. It says nothing about real OBS, cameras, ducking quality, firewalls or packaging.
// Run it through scripts/e2e/obs-live.sh. LOCAL EVIDENCE ONLY (needs a PostgREST binary; not part of CI). Takes several minutes: the 10 s minimum time
// on a scene, the 8 s / 25 s result windows and the 20 s stale threshold are REAL time here.
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { violations } from '../obs-standin/allowlist.mjs';
import { startStandIn } from '../obs-standin/server.mjs';

const API = process.env.E2E_API, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const TMP = process.env.E2E_TMP ?? '/tmp/ctrl-e2e';
const OBS_PORT = Number(process.env.OBS_STANDIN_PORT ?? 44655), UI_PORT = Number(process.env.COMPANION_UI_PORT ?? 47777);
const PROXY_PORT = Number(process.env.COMPANION_PROXY_PORT ?? Number(new URL(API).port) + 10);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOME = path.join(TMP, 'companion-home');
const OBS_PASSWORD = 'obs-e2e-pw-Zk3-91xQ-standin';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 900)}`); return !!ok; };
const note = (s) => console.log(`      .. ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 30000, every = 100) { const t0 = Date.now(); for (;;) { let v; try { v = await fn(); } catch { v = false; } if (v) return v; if (Date.now() - t0 > timeout) return false; await sleep(every); } }

// ---------------------------------------------------------------------------------------------------------------- users, JWTs, REST, SQL
const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (sub, email) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 })); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const U = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const WHO = { owner: [U('a1'), 'u1@example.test'], organizer: [U('a2'), 'u2@example.test'], sec: [U('a4'), 'u4@example.test'], stranger: [U('a7'), 'u7@example.test'], head: [U('c1'), 'c1@example.test'] };
const bearerOf = (who) => (typeof who === 'string' && WHO[who] ? jwt(...WHO[who]) : who);          // a known user name, or a ready bearer token (a device session)
async function rest(who, method, p, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', prefer: 'return=representation', ...(who ? { authorization: `Bearer ${bearerOf(who)}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rpc = (who, fn, args) => rest(who, 'POST', `rpc/${fn}`, args);
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const EV = '00000000-0000-0000-0000-00000000ed01';
const mid = (n) => `00000000-0000-0000-0000-0000000fd${String(n).padStart(3, '0')}`;
const fname = (k) => k.replace(/^field/, 'Field');
const cmd = () => crypto.randomUUID();

// ---------------------------------------------------------------------------------------------------------------- the Edge Function (real handler through localstack)
async function edge(body, bearer) {
  const r = await fetch(`${API}/functions/v1/device-session`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', ...(bearer ? { authorization: `Bearer ${bearerOf(bearer)}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
let deviceSession = null;
async function deviceBearer() {                                                                    // a marshal DEVICE token, refreshed with its session secret
  if (!deviceSession) return null;
  if (deviceSession.exp - Date.now() < 120_000) { const r = await edge({ action: 'refresh', session_secret: deviceSession.secret }); if (r.status === 200) deviceSession = { ...deviceSession, token: r.body.access_token, exp: r.body.expires_at * 1000 }; }
  return deviceSession.token;
}

// ---------------------------------------------------------------------------------------------------------------- a proxy we can cut: "the internet" between the Companion and BuhurtOS
function startProxy(listen, target) {
  let blocked = false; const socks = new Set();
  const server = http.createServer((req, res) => {
    if (blocked) { req.socket.destroy(); return; }
    const up = http.request({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('error', () => req.socket.destroy()); req.pipe(up);
  });
  server.on('connection', (s) => { socks.add(s); s.on('close', () => socks.delete(s)); });
  server.listen(listen, '127.0.0.1');
  return { block() { blocked = true; for (const s of socks) s.destroy(); }, unblock() { blocked = false; }, get blocked() { return blocked; }, close() { server.close(); for (const s of socks) s.destroy(); } };
}

// ---------------------------------------------------------------------------------------------------------------- the Companion process (through its own restart-loop script)
let companion = null; let companionOut = '';
function startCompanion() {
  const env = { ...process.env, BUHURTOS_COMPANION_HOME: HOME, BUHURTOS_SUPABASE_URL: `http://127.0.0.1:${PROXY_PORT}`, BUHURTOS_SUPABASE_KEY: 'local-publishable-key', OBS_PORT: String(OBS_PORT), BUHURTOS_UI_PORT: String(UI_PORT), BUHURTOS_CREDENTIAL_STORE: 'file', COMPANION_RESTART_DELAY: '1' };
  delete env.BUHURTOS_EVENT_SLUG;
  const child = spawn('bash', [path.join(ROOT, 'tools/obs-controller/start/start-broadcast.sh')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { companionOut += d; }); child.stderr.on('data', (d) => { companionOut += d; });
  companion = { child, exited: new Promise((r) => child.on('exit', (code) => r(code))) };
  return companion;
}
const ui = async (p, method = 'GET', body) => {
  const r = await fetch(`http://127.0.0.1:${UI_PORT}${p}`, { method, headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-bos-companion': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const st = async () => { try { const r = await ui('/api/state'); return r.status === 200 ? r.body : null; } catch { return null; } };
const uiUp = () => until(async () => !!(await st()), 15000, 150);

// ---------------------------------------------------------------------------------------------------------------- the stand-in OBS
const standin = await startStandIn({ port: OBS_PORT, password: OBS_PASSWORD, program: 'Lyst 3 Live' });
const prog = () => standin.state.program;
const untilScene = (name, timeout = 40000) => until(() => prog() === name, timeout, 100);
const holds = async (name, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (prog() !== name) return false; await sleep(100); } return true; };
const switches = () => standin.count('SetCurrentProgramScene');
const music = () => standin.state.inputs.get('Music');
const modeOf = async (field) => (await st())?.fields?.find((f) => f.key === field)?.mode;
const untilMode = (field, mode, timeout = 30000) => until(async () => (await modeOf(field)) === mode, timeout, 150);

// ---------------------------------------------------------------------------------------------------------------- driving Pack 13 through its real RPCs
const activeMatch = (field) => sql(`select m.id from public.matches m join public.competitions c on c.id = m.competition_id where c.event_id = '${EV}' and lower(coalesce(nullif(btrim(m.field), ''), 'Field 1')) = '${field}' and m.queue_state = 'active' limit 1`);
const timerRev = (field) => Number(sql(`select coalesce((select rev from public.lyst_timer where event_id = '${EV}' and field_key = '${field}'), 0)`));
const roundRev = (m, n = 1) => Number(sql(`select rev from public.lyst_rounds where match_id = '${m}' and round_no = ${n}`));
const version = (m) => Number(sql(`select version from public.matches where id = '${m}'`));
const L = {
  call: (who, field) => rpc(who, 'advance_field_queue', { p_event: EV, p_field: fname(field), p_start: true }),
  open: (who, m) => rpc(who, 'lyst_open', { p_match: m, p_counter_input: 'simple' }),
  timer: (who, field, m, action, o = {}) => rpc(who, 'lyst_timer_command', { p_event: EV, p_field: fname(field), p_match: m, p_expected_rev: timerRev(field), p_command: cmd(), p_action: action, p_mode: o.mode ?? null, p_duration_ms: o.dur ?? null, p_round: o.round ?? null, p_delta_ms: o.delta ?? 0 }),
  async ready(who, field) { const m = activeMatch(field); await L.open(who, m); const r = await L.timer(who, field, m, 'set', { mode: 'fight', dur: 120000 }); return { m, r }; },
  start: (who, field, m) => L.timer(who, field, m, 'start', { mode: 'fight', dur: 120000 }),
  dqMark: (who, m) => rpc(who, 'lyst_record_discipline', { p_command: cmd(), p_match: m, p_round: 1, p_side: 'a', p_kind: 'dq', p_label: null, p_amount: 0, p_reason: 'e2e: foul', p_called_by: 'Marshal E2E', p_related: null }),
  async finish(who, m, { dq = false } = {}) {
    await rpc(who, 'lyst_end_round', { p_match: m, p_round: 1 });
    const c = await rpc(who, 'lyst_confirm_round', { p_command: cmd(), p_match: m, p_round: 1, p_awarded_a: dq ? 3 : 9, p_awarded_b: dq ? 9 : 3, p_expected_rev: roundRev(m), p_recommended_a: null, p_recommended_b: null, p_reason: null });
    const f = await rpc(who, 'lyst_finalize', { p_command: cmd(), p_match: m, p_expected_version: version(m), p_result: dq ? 'b' : 'a', p_basis: dq ? 'dq' : 'score', p_reason: null });
    return { c, f };
  },
  liveScore: (who, m, a, b, seq) => rpc(who, 'report_live_score', { p_match: m, p_device: 'e2e-board', p_seq: seq, p_score_a: a, p_score_b: b, p_phase: 'Round 1', p_detail: {}, p_expected_version: version(m) })
};
const quietAll = async () => { for (const f of ['field 1', 'field 2', 'field 3']) { const m = activeMatch(f); if (m) await rpc('head', 'set_match_queue', { p_match: m, p_state: 'scheduled' }); } };
const control = async (who, patch) => {
  const s = await rpc('organizer', 'broadcast_control_state', { p_event: EV });
  return rpc(who, 'set_broadcast_control', { p_event: EV, p_expected_rev: s.body?.control?.rev ?? 0, p_patch: patch });
};
const heartbeat = () => { const j = sql(`select coalesce((select status::text from public.broadcast_controller_status where event_id = '${EV}'), '')`); return j ? JSON.parse(j) : null; };
const heartbeatAgeS = () => Number(sql(`select coalesce((select extract(epoch from clock_timestamp() - reported_at)::int from public.broadcast_controller_status where event_id = '${EV}'), -1)`));
const cameraState = async () => (await rpc('head', 'camera_state', { p_event: EV })).body;

let SCOPE = { mutable: ['Music'], music: 'Music', filter: 'Ducking', media: null };
const proxy = startProxy(PROXY_PORT, Number(new URL(API).port));
const finish = async (code) => { try { if (companion) { companion.child.kill('SIGTERM'); } } catch { /* gone */ } proxy.close(); await standin.close(); process.exit(code); };

try {
  // ================================================================================================================ 0. the stack and the credentials
  note(`stand-in OBS on ws://127.0.0.1:${OBS_PORT} (NOT OBS), Companion screen on :${UI_PORT}, BuhurtOS reached through a cuttable proxy on :${PROXY_PORT}`);
  fs.rmSync(HOME, { recursive: true, force: true });
  check('0.1 the fixture has three fields (Lysts) with fights, and no controller credential yet',
    Number(sql(`select count(distinct lower(coalesce(nullif(btrim(m.field), ''), 'Field 1'))) from public.matches m join public.competitions c on c.id = m.competition_id where c.event_id = '${EV}'`)) === 3
    && Number(sql(`select count(*) from public.event_credentials where kind = 'controller'`)) === 0);
  const refused = await edge({ action: 'create', event: EV, kind: 'controller', label: 'Rogue', role: 'broadcast_controller' }, 'sec');
  check('0.2 only the permanent organizer can create the controller credential (a scorekeeper is refused by the database)', refused.status >= 400 && !refused.body?.code, JSON.stringify(refused));
  const made = await edge({ action: 'create', event: EV, kind: 'controller', label: 'Stream Laptop', role: 'broadcast_controller' }, 'organizer');
  const CODE = made.body?.code;
  check('0.3 the organizer creates the controller credential; the code (XXXX-XXXX-XXXX) is shown once', made.status === 200 && /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(CODE ?? ''), JSON.stringify(made));
  const dev = await edge({ action: 'create', event: EV, kind: 'device', label: 'Marshal Phone', role: 'marshal' }, 'organizer');
  const dsign = await edge({ action: 'signin', code: dev.body?.code });
  deviceSession = { token: dsign.body?.access_token, secret: dsign.body?.session_secret, exp: (dsign.body?.expires_at ?? 0) * 1000 };
  check('0.4 a marshal DEVICE session is opened (role bos_event_device, a session id, not a person)', dsign.status === 200 && dsign.body?.whoami?.role === 'marshal' && JSON.parse(Buffer.from(deviceSession.token.split('.')[1], 'base64url').toString()).role === 'bos_event_device', JSON.stringify(dsign.body).slice(0, 200));

  // ================================================================================================================ 1. connect, mapping, holding
  startCompanion();
  check('1.1 the Companion starts (through its crash-safe start script) and its local screen answers on loopback', await uiUp());
  const s0 = await st();
  check('1.2 with no OBS password yet it says so in plain words, and BuhurtOS shows "no controller code"', /asks for a password|password/.test(s0?.obs?.problem ?? '') && s0?.bos?.session === 'no_code', JSON.stringify(s0?.obs));
  const cr = await ui('/api/credentials', 'POST', { obsPassword: OBS_PASSWORD, controllerCode: CODE });
  check('1.3 the OBS password and the controller code are entered on the screen (write-only)', cr.status === 200);
  check('1.4 it connects to OBS with the real challenge/salt authentication (stand-in verified)', await until(async () => (await st())?.obs?.connected === true, 15000) && standin.identifiedSessions() === 1);
  check('1.5 it signs in to BuhurtOS with the controller code and shows who it is', await until(async () => (await st())?.bos?.session === 'ok', 15000) && (await st()).bos.label === 'Stream Laptop', JSON.stringify((await st())?.bos));
  const sess = sql(`select count(*) from public.event_sessions s join public.event_credentials c on c.id = s.credential_id where c.kind = 'controller' and c.event_id = '${EV}' and s.ended_at is null`);
  check('1.6 the database holds ONE open controller session (not a person: no auth.users row for it)', sess === '1' && sql(`select count(*) from auth.users u join public.event_sessions s on s.id = u.id`) === '0');
  const m1 = await ui('/api/mapping', 'POST', { mapping: { lysts: { 'field 1': { live: 'Lyst 1 Live' }, 'field 2': { live: 'Lyst 2 Live' }, 'field 3': { live: 'Lyst 3 Live' } }, holding: 'Holding', break: 'Break', cameraOff: 'Camera Off' } });
  const a1 = await ui('/api/audio', 'POST', { audio: { musicSource: 'Music', micSource: 'Announcer Mic', duckingFilter: 'Ducking', normalLevelDb: -14, fadeMs: 600 } });
  check('1.7 the scene mapping and the audio setup are saved from the screen', m1.status === 200 && a1.status === 200);
  check('1.8 connect: OBS was on "Lyst 3 Live" and nothing is on, so it is reconciled to Holding (once)', await untilScene('Holding', 15000), prog());
  check('1.9 no mapping problems: every mapped scene exists in OBS', await until(async () => (await st())?.mapping?.problems?.length === 0, 8000), JSON.stringify((await st())?.mapping?.problems));
  const hb0 = await until(() => heartbeat()?.obs_connected === true && heartbeat()?.on_air?.kind === 'holding', 15000);
  check('1.10 the heartbeat reaches BuhurtOS every few seconds (controller role) with OBS connected, mode, on-air and version', !!hb0 && heartbeat().controller_version === '0.1.0' && heartbeat().mode === 'auto' && heartbeat().obs_version === '32.0.0', JSON.stringify(heartbeat()));
  check('1.11 Command Centre view: the organizer sees the controller as alive (broadcast_control_state)', ((await rpc('organizer', 'broadcast_control_state', { p_event: EV })).body?.controller?.age_seconds ?? 99) < 15);
  check('1.12 files on the laptop: owner-only, and neither settings nor state nor the log hold the OBS password, the code or a token',
    (() => { const files = fs.readdirSync(HOME); let ok = files.includes('credentials.json') && (fs.statSync(path.join(HOME, 'credentials.json')).mode & 0o077) === 0; for (const f of files) { if (f === 'credentials.json') continue; const t = fs.readFileSync(path.join(HOME, f), 'utf8'); if (t.includes(OBS_PASSWORD) || t.includes(CODE) || t.includes(CODE.replace(/-/g, '')) || /eyJ[A-Za-z0-9_-]{8,}\./.test(t)) ok = false; } return ok; })());

  // ================================================================================================================ 2. a fight on Lyst 1: ready, live, timer and score changes, pause, equipment, DQ, complete, winner
  await sleep(1500);
  const sw0 = switches();
  await L.call('head', 'field 1');
  check('2.1 a fight is called to Field 1 (fighters walking on): the camera goes to Lyst 1 (AUTO follows an armed Lyst, after the minimum time on a scene)', await untilScene('Lyst 1 Live', 30000), prog());
  check('2.2 the scene mode the Companion derives from the REAL public data is "Now on the field" (intro)', await untilMode('field 1', 'intro', 5000));
  const ready1 = await L.ready('sec', 'field 1');
  check('2.3 the clock is armed ("Get ready")', ready1.r.status === 200 && (await untilMode('field 1', 'ready', 8000)));
  const live1 = await L.start('sec', 'field 1', ready1.m);
  check('2.4 the round starts: Live', live1.status === 200 && (await untilMode('field 1', 'live', 8000)));
  check('2.5 the music fades out and mutes for the fight (stand-in: a stepped fade then SetInputMute)', await until(() => music().muted === true, 12000) && standin.requests('SetInputVolume').length >= 3);
  const swLive = switches();
  // score / timer / penalty changes: ZERO SetCurrentProgramScene
  for (let i = 1; i <= 6; i++) { await L.liveScore('sec', ready1.m, i, i - 1, i); await L.timer('sec', 'field 1', ready1.m, 'adjust', { delta: 5000 }); await sleep(250); }
  await L.timer('sec', 'field 1', ready1.m, 'pause'); check('2.6 pause: "Clock paused"', await untilMode('field 1', 'paused', 8000));
  await L.timer('sec', 'field 1', ready1.m, 'resume'); check('2.7 resume: Live again', await untilMode('field 1', 'live', 8000));
  await L.timer('sec', 'field 1', ready1.m, 'start', { mode: 'equipment', dur: 30000 }); check('2.8 equipment timeout', await untilMode('field 1', 'equipment', 8000));
  await L.start('sec', 'field 1', ready1.m); await untilMode('field 1', 'live', 8000);
  await L.timer('sec', 'field 1', ready1.m, 'start', { mode: 'dq', dur: 30000 }); check('2.9 DQ countdown', await untilMode('field 1', 'dq_clock', 8000));
  await L.start('sec', 'field 1', ready1.m); await untilMode('field 1', 'live', 8000);
  await L.timer('sec', 'field 1', ready1.m, 'start', { mode: 'break', dur: 30000 }); check('2.10 round break ("scores being confirmed")', await untilMode('field 1', 'break', 8000));
  check('2.11 music stays off through pause, equipment, DQ countdown and the round break (still the fight)', music().muted === true);
  await L.dqMark('sec', ready1.m); check('2.12 a disqualification on record: "Disqualification"', await untilMode('field 1', 'disqualified', 8000));
  check('2.13 score changes, clock changes, pause, resume, equipment, DQ and break: ZERO SetCurrentProgramScene calls', switches() === swLive && prog() === 'Lyst 1 Live', `${switches()} vs ${swLive}`);
  const fin1 = await L.finish('sec', ready1.m, { dq: true });
  check('2.14 the fight is finished by disqualification and made official through lyst_finalize', fin1.f.body?.status === 'accepted', JSON.stringify(fin1.f));
  check('2.15 the result: "Match complete" first', await untilMode('field 1', 'complete', 8000));
  check('2.16 complete stays on the camera, then the winner card stays on the camera (still Lyst 1, music still off)', (await holds('Lyst 1 Live', 3000)) && (await untilMode('field 1', 'winner', 12000)) && prog() === 'Lyst 1 Live' && music().muted === true);
  check('2.17 from the first call to the winner card the camera moved exactly ONCE (to Lyst 1)', switches() - sw0 === 1, `${switches() - sw0}`);

  // ================================================================================================================ 3. next fight on the same Lyst; two Lysts live at once; next fight on another Lyst
  check('3.1 the next fight is already called on Lyst 1 when the winner card ends: the camera stays (armed Lyst)', (await untilMode('field 1', 'intro', 40000)) && prog() === 'Lyst 1 Live');
  const r2 = await L.ready('sec', 'field 1'); await L.start('sec', 'field 1', r2.m);
  check('3.2 the next fight on the same Lyst goes live: still Lyst 1', (await untilMode('field 1', 'live', 8000)) && prog() === 'Lyst 1 Live');
  await sleep(1200);
  await L.call('head', 'field 2'); const f2 = await L.ready('head', 'field 2'); await L.start('head', 'field 2', f2.m);
  check('3.3 Lyst 2 goes live while Lyst 1 is live: AUTO STAYS on Lyst 1', (await untilMode('field 2', 'live', 8000)) && (await holds('Lyst 1 Live', 3000)));
  await sleep(1200);
  await L.call('head', 'field 3'); const f3 = await L.ready('head', 'field 3'); await L.start('head', 'field 3', f3.m);
  const s3 = await until(async () => { const s = await st(); return (s?.alsoLive ?? []).length === 2 ? s : false; }, 10000);
  check('3.4 the other two Lysts are shown as "also live", each with its fight', !!s3 && s3.alsoLive.map((a) => a.field).sort().join() === 'field 2,field 3' && s3.alsoLive.every((a) => /vs/.test(a.summary)), JSON.stringify(s3?.alsoLive));
  const hbAlso = await until(() => (heartbeat()?.also_live ?? []).length === 2, 12000);
  check('3.5 BuhurtOS gets "also live" and the fight in the heartbeat', !!hbAlso && heartbeat().fight?.field === 'field 1', JSON.stringify(heartbeat()));
  check('3.6 the fights\' first-live times come from the database (lyst_rounds), in the order they started', (() => { const a = sql(`select extract(epoch from created_at) from public.lyst_rounds where match_id = '${r2.m}' and round_no = 1`), b = sql(`select extract(epoch from created_at) from public.lyst_rounds where match_id = '${f2.m}' and round_no = 1`); return Number(a) < Number(b); })());
  const swBefore3 = switches();
  const fin2 = await L.finish('sec', r2.m);
  check('3.7 Lyst 1\'s fight ends: complete and winner stay on Lyst 1 even though two other Lysts are live', fin2.f.body?.status === 'accepted' && (await holds('Lyst 1 Live', 4000)) && switches() === swBefore3);
  check('3.8 when Lyst 1\'s winner card is over (it is armed again with the next fight), the camera moves to the Lyst that has been live LONGEST: Lyst 2', await untilScene('Lyst 2 Live', 50000), prog());
  check('3.9 Lyst 3 is still shown as also live', ((await st())?.alsoLive ?? []).some((a) => a.field === 'field 3'));

  // ================================================================================================================ 4. manual control from BuhurtOS (Take, Holding, Break, Return to Auto)
  let sw = switches();
  const t3 = await control('organizer', { mode: 'manual', target_kind: 'lyst', target_field: 'Field 3' });
  check('4.1 an authorized organizer takes Lyst 3 (set_broadcast_control): the camera follows within seconds and it is MANUAL', t3.body?.status === 'ok' && (await untilScene('Lyst 3 Live', 15000)) && (await st()).mode.effective === 'manual');
  const bad = await control('stranger', { mode: 'manual', target_kind: 'holding' });
  const bad2 = await rpc('organizer', 'set_broadcast_control', { p_event: EV, p_expected_rev: 0, p_patch: { mode: 'manual', target_kind: 'break' } });
  check('4.2 a stranger cannot control the broadcast; a stale revision changes nothing (the database says "stale")', bad.status >= 400 && bad2.body?.status === 'stale' && prog() === 'Lyst 3 Live');
  await L.timer('sec', 'field 2', f2.m, 'pause');
  check('4.3 manual means nothing automatic moves it (a timer change on Lyst 2): still Lyst 3', await holds('Lyst 3 Live', 3500));
  await control('organizer', { target_kind: 'holding', target_field: null }); check('4.4 Holding', await untilScene('Holding', 15000));
  check('4.5 holding is between fights: music comes back on (faded up from silence to the normal level)', await until(() => music().muted === false && Math.abs(music().volumeDb - -14) < 0.6, 15000), `${music().muted} ${music().volumeDb}`);
  await control('organizer', { target_kind: 'break', target_field: null }); check('4.6 Break', await untilScene('Break', 15000));
  check('4.7 a scheduled break keeps the music on', music().muted === false);
  await L.timer('sec', 'field 2', f2.m, 'resume');
  sw = switches();
  const auto = await control('organizer', { mode: 'auto' });
  check('4.8 Return to Auto: a FRESH decision from the current state (Lyst 2 has been live longest), with no replay: one switch only', auto.body?.status === 'ok' && (await untilScene('Lyst 2 Live', 15000)) && (await holds('Lyst 2 Live', 1500)) && switches() - sw === 1, `${switches() - sw}`);
  check('4.9 the screen agrees: AUTO, locked on Lyst 2, Lyst 3 also live', (await st()).mode.effective === 'auto' && (await st()).onAir.lock === 'field 2' && (await st()).alsoLive.some((a) => a.field === 'field 3'));
  check('4.10 Return to Auto never touched the music rule for a live fight: music off again', await until(() => music().muted === true, 12000));

  // ================================================================================================================ 5. Camera Off (a marshal DEVICE activates it): latched through everything
  const tok = await deviceBearer();
  const act = await rpc(tok, 'camera_off_activate', { p_event: EV, p_reason: 'medical' });
  check('5.1 a marshal device activates Camera Off (reason: medical) through the database function it is allowed to call', act.status === 200 && act.body?.active === true, JSON.stringify(act));
  check('5.2 the cameras are cut: the Camera Off scene is on air within seconds, and the heartbeat says so', (await untilScene('Camera Off', 12000)) && !!(await until(() => heartbeat()?.camera_off === true, 12000)));
  check('5.3 music stays muted (and a medical hold locks it)', music().muted === true && !!(await until(async () => (await st())?.audio?.music?.locked === true, 8000)));
  // a fight ends, a new fight starts, AUTO would change, a manual Take is made: still Camera Off
  const finf2 = await L.finish('sec', f2.m);
  await sleep(1000);
  await control('organizer', { mode: 'manual', target_kind: 'lyst', target_field: 'Field 1' }); await sleep(3500);
  check('5.4 a fight ends, a manual Take is made: Camera Off still on air (it beats AUTO and manual)', finf2.f.body?.status === 'accepted' && prog() === 'Camera Off');
  await control('organizer', { mode: 'auto' }); await sleep(3000);
  check('5.5 Return to Auto does not release it either', prog() === 'Camera Off');
  await L.call('head', 'field 2'); const n2 = await L.ready('head', 'field 2'); await L.start('head', 'field 2', n2.m); await sleep(3500);
  check('5.6 a NEW fight starts on another Lyst: Camera Off still on air', prog() === 'Camera Off');
  standin.dropConnections();
  check('5.7 OBS connection drops and comes back: Camera Off is still on air', (await until(async () => !(await st())?.obs?.connected, 8000)) && (await until(async () => (await st())?.obs?.connected, 15000)) && (await holds('Camera Off', 1500)));
  await standin.restart({ downMs: 800 });
  check('5.8 OBS restarts (it comes back on its first scene, Holding): the Companion re-asserts Camera Off', (await until(async () => (await st())?.obs?.connected, 20000)) && (await untilScene('Camera Off', 10000)), prog());
  standin.setProgramByHand('Lyst 1 Live');                                              // someone switches OBS by hand to a camera while Camera Off is latched
  check('5.9 someone switches OBS to a camera by hand: Camera Off is put back at once', await untilScene('Camera Off', 8000), prog());
  const pid0 = (await st()).pid;
  process.kill(pid0, 'SIGKILL'); standin.setProgramByHand('Lyst 2 Live');
  check('5.10 the Companion crashes (kill -9): the start script restarts it, it reads its saved files and puts Camera Off back', (await until(async () => { const s = await st(); return s && s.pid !== pid0 && s.obs.connected; }, 25000)) && (await untilScene('Camera Off', 15000)), prog());
  proxy.block();
  check('5.11 the internet (BuhurtOS) is cut: Camera Off stays on air, the screen says BuhurtOS is not reachable', (await holds('Camera Off', 2500)) && !!(await until(async () => { const s = await st(); return s?.bos?.controllerError || s?.bos?.dataError; }, 12000)));
  const pid1 = (await st()).pid; process.kill(pid1, 'SIGKILL'); standin.setProgramByHand('Holding');
  check('5.12 the Companion restarts WITH NO INTERNET: "unknown = still off": Camera Off goes back on air', (await until(async () => { const s = await st(); return s && s.pid !== pid1; }, 25000)) && (await untilScene('Camera Off', 20000)), prog());
  const rel = await rpc('head', 'camera_off_release', { p_event: EV, p_note: 'e2e: all clear' });
  check('5.13 an authorized head marshal releases Camera Off in BuhurtOS WHILE the Companion cannot hear it: it stays off (unknown)', rel.status === 200 && rel.body?.active === false && (await holds('Camera Off', 3500)));
  const swRel = switches();
  proxy.unblock();
  check('5.14 the internet returns: it learns of the release and returns to what AUTO shows NOW (no replay)', (await until(() => prog() !== 'Camera Off', 45000)) && ['Lyst 2 Live', 'Lyst 3 Live', 'Lyst 1 Live', 'Holding'].includes(prog()), prog());
  note(`program after release: ${prog()} (${switches() - swRel} switch)`);
  check('5.15 the medical hold keeps the music OFF after the cameras are released (a person must resume it)', music().muted === true && (await st()).audio.music.locked === true);
  // finish what is live so the rest of the audio checks happen in a quiet period
  for (const m of [n2.m, f3.m]) await L.finish('head', m);
  await quietAll();                                                                       // the next fights are not called yet: between fights
  check('5.16 every Lyst is quiet (results over, nothing called): AUTO goes to Holding', (await until(async () => ['between', 'idle'].includes(await modeOf('field 1')) && ['between', 'idle'].includes(await modeOf('field 2')) && ['between', 'idle'].includes(await modeOf('field 3')), 70000, 500)) && (await untilScene('Holding', 30000)), prog());

  // ================================================================================================================ 6. the local Camera Off button (this laptop), with no internet at all
  proxy.block();
  const loc = await ui('/api/camera-off', 'POST', {});
  check('6.1 the big local button cuts to Camera Off at once even with no internet', loc.status === 200 && (await untilScene('Camera Off', 5000)) && (await st()).camera.local === true);
  check('6.2 it is saved to disk before anything else (survives a crash)', JSON.parse(fs.readFileSync(path.join(HOME, 'state.json'), 'utf8')).cameraOffLocal === true);
  const pid2 = (await st()).pid; process.kill(pid2, 'SIGKILL'); standin.setProgramByHand('Holding');
  check('6.3 crash + restart with no internet: the local latch is back and Camera Off is on air', (await until(async () => { const s = await st(); return s && s.pid !== pid2 && s.obs.connected; }, 25000)) && (await untilScene('Camera Off', 15000)) && (await st()).camera.local === true);
  proxy.unblock();
  await sleep(4000);
  check('6.4 the server has no Camera Off (it was released) but the local latch still holds: only the local button clears it', !!(await until(async () => (await st())?.camera?.server === false, 20000)) && (await holds('Camera Off', 1500)));
  await ui('/api/camera-off/clear', 'POST', {});
  check('6.5 the local clear releases it: back to AUTO (holding: nothing is live)', await untilScene('Holding', 15000), prog());

  // ================================================================================================================ 6b. the local screen in a REAL browser (the one UI workflow this tool has)
  const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (!fs.existsSync(CHROME)) note('6b skipped: no Chromium found (set CHROME)');
  else {
    const { chromium } = createRequire(import.meta.url)('playwright-core');
    const browser = await chromium.launch({ executablePath: CHROME, args: ['--proxy-bypass-list=127.0.0.1;localhost'] });
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200))); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
      page.on('dialog', (d) => { void d.accept(); });
      await page.goto(`http://127.0.0.1:${UI_PORT}/`);
      await page.waitForSelector('#lights .light', { timeout: 10000 });
      await page.waitForFunction(() => document.querySelectorAll('#tests button').length >= 6, null, { timeout: 10000 });
      const lights = (await page.locator('#lights').innerText()).replace(/\s+/g, ' ');
      check('6b.1 the local screen renders in a real browser with its connection lights, no script errors, one button per OBS scene to test', /OBS/.test(lights) && /BuhurtOS/.test(lights) && /Scenes OK/.test(lights) && errors.length === 0, `${lights} ${errors.join(' | ')}`);
      check('6b.2 it shows what is on air in plain words', /Holding/.test(await page.locator('#onair').innerText()), await page.locator('#onair').innerText());
      await page.locator('details', { hasText: 'Scene mapping' }).locator('summary').click();
      check('6b.3 the mapping wizard lists the OBS scenes for each Lyst', (await page.locator('#mapping select').count()) >= 8 && /Lyst 1 Live/.test(await page.locator('#mapping').innerHTML()));
      await page.screenshot({ path: path.join(TMP, 'companion-screen.png'), fullPage: true });
      await page.locator('#camoff').click();
      check('6b.4 clicking the big CAMERA OFF button cuts to the Camera Off scene and the screen says the cameras are off', (await untilScene('Camera Off', 8000)) && !!(await until(async () => /CAMERAS ARE OFF/.test(await page.locator('#banners').innerText()), 6000)));
      await page.waitForFunction(() => !document.getElementById('camclear').hidden, null, { timeout: 6000 });
      await page.screenshot({ path: path.join(TMP, 'companion-screen-camera-off.png'), fullPage: true });
      await page.locator('#clear').click();                                             // the confirm dialog is accepted by the handler above
      check('6b.5 the confirmed local clear brings the cameras back (AUTO: holding)', await untilScene('Holding', 10000), prog());
      await page.close();
      const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
      await phone.goto(`http://127.0.0.1:${UI_PORT}/`); await phone.waitForSelector('#lights .light');
      check('6b.6 on a phone-sized window there is no sideways scrolling (the operator may use a tablet)', await phone.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1));
    } finally { await browser.close(); }
  }

  // ================================================================================================================ 7. audio policy in a quiet period
  check('7.1 the medical hold from 5.x is STILL in force (the cameras are back, the music is not): muted and locked', music().muted === true && (await st()).audio.music.locked === true);
  await control('organizer', { music_mode: 'muted' }); await sleep(1500);
  const resumed = await control('organizer', { music_mode: 'auto' });
  check('7.2 a person with broadcast control deliberately resumes (Muted, then Auto): the medical hold is lifted and the music returns', resumed.body?.status === 'ok' && (await until(() => music().muted === false && Math.abs(music().volumeDb - -14) < 0.6, 15000)) && (await st()).audio.music.locked === false, `${music().muted} ${music().volumeDb}`);
  check('7.3 the ducking filter is on (OBS ducks the music under the announcer microphone; the Companion only checks)', standin.state.inputs.get('Music').filters[0].filterEnabled === true && (await st()).audio.presence.keyedToMic === true);
  await control('organizer', { auto_duck: false });
  check('7.4 Auto Duck OFF (from BuhurtOS): the ducking filter is switched off and a warning is shown', (await until(() => standin.state.inputs.get('Music').filters[0].filterEnabled === false, 12000)) && !!(await until(async () => ((await st())?.audio?.plan?.warnings ?? []).some((w) => w.code === 'auto_duck_off'), 8000)));
  await control('organizer', { auto_duck: true }); check('7.5 Auto Duck on again', await until(() => standin.state.inputs.get('Music').filters[0].filterEnabled === true, 12000));
  const volN = standin.count('SetInputVolume'), muteN = standin.count('SetInputMute'), filtN = standin.count('SetSourceFilterEnabled') + standin.count('SetSourceFilterSettings');
  standin.injectMeter('Announcer Mic', { db: -12, ms: 6000 });
  check('7.6 the announcer speaks: the status says "speaking" (summarised from meters; raw levels never leave the laptop)', !!(await until(async () => (await st())?.audio?.music?.mic === 'speaking', 6000)) && !!(await until(() => heartbeat()?.music?.mic === 'speaking', 8000)), JSON.stringify(heartbeat()?.music));
  for (let i = 0; i < 10; i++) { standin.injectMeter('Announcer Mic', { db: -10, ms: 150 }); await sleep(200); standin.injectMeter('Announcer Mic', { db: -70, ms: 150 }); await sleep(200); }
  check('7.7 speech causes NO volume, mute or filter commands (ducking is done inside OBS, not per word)', standin.count('SetInputVolume') === volN && standin.count('SetInputMute') === muteN && standin.count('SetSourceFilterEnabled') + standin.count('SetSourceFilterSettings') === filtN);
  check('7.8 and then "quiet" again', !!(await until(async () => (await st())?.audio?.music?.mic === 'quiet', 8000)));
  standin.removeInput('Announcer Mic');
  check('7.9 the microphone goes missing: music is muted (it could not be ducked) and the problem is reported', (await until(() => music().muted === true, 25000)) && !!(await until(async () => ((await st())?.audio?.plan?.warnings ?? []).some((w) => w.code === 'mic_missing'), 25000)) && !!(await until(() => heartbeat()?.music?.mic === 'missing', 12000)));
  standin.addInput('Announcer Mic', 'wasapi_input_capture', { filters: [{ filterName: 'Gate', filterKind: 'noise_gate_filter', filterEnabled: true, filterIndex: 0, filterSettings: {} }] });
  check('7.10 the microphone comes back: music returns', await until(() => music().muted === false, 25000));
  standin.removeInput('Music');
  check('7.11 the music source goes missing: reported, and the Companion sends no audio command for it', !!(await until(async () => ((await st())?.audio?.plan?.warnings ?? []).some((w) => w.code === 'music_source_missing'), 25000)));
  await sleep(500); const cmdsBefore = standin.count('SetInputMute') + standin.count('SetInputVolume');
  await sleep(1500);
  check('7.12 ...for as long as it is missing', standin.count('SetInputMute') + standin.count('SetInputVolume') === cmdsBefore);
  standin.addInput('Music', 'ffmpeg_source', { filters: [{ filterName: 'Ducking', filterKind: 'compressor_filter', filterEnabled: true, filterIndex: 0, filterSettings: { sidechain_source: 'Announcer Mic' } }] });
  check('7.13 the music source returns: it is controlled again', !!(await until(async () => (await st())?.audio?.presence?.music === true, 25000)));
  check('7.14 it is on its reported state in BuhurtOS', !!(await until(() => ['on', 'muted'].includes(heartbeat()?.music?.state), 10000)));
  // the audio policy survives a restart of the Companion and of OBS
  const pid3 = (await st()).pid; process.kill(pid3, 'SIGKILL');
  check('7.15 the Companion restarts: the audio policy is restored (music on between fights)', (await until(async () => { const s = await st(); return s && s.pid !== pid3 && s.obs.connected; }, 25000)) && (await until(() => music().muted === false, 15000)));

  // ================================================================================================================ 8. missing mapping, missing scene
  const MAP_ALL = { lysts: { 'field 1': { live: 'Lyst 1 Live' }, 'field 2': { live: 'Lyst 2 Live' }, 'field 3': { live: 'Lyst 3 Live' } }, holding: 'Holding', break: 'Break', cameraOff: 'Camera Off' };
  await ui('/api/mapping', 'POST', { mapping: { ...MAP_ALL, lysts: { 'field 1': MAP_ALL.lysts['field 1'], 'field 2': MAP_ALL.lysts['field 2'] } } });
  await L.call('head', 'field 3'); const g3 = await L.ready('head', 'field 3'); await L.start('head', 'field 3', g3.m);
  check('8.1 a Lyst with NO camera scene goes live: it is NOT taken (the stream stays on Holding) and it is reported "no camera scene"', (await untilMode('field 3', 'live', 10000)) && (await holds('Holding', 12000)) && !!(await until(async () => ((await st())?.mapping?.problems ?? []).some((p) => p.code === 'live_scene_unmapped' && p.field === 'field 3'), 8000)));
  check('8.2 ...and it is listed as "also live (no scene yet)"', ((await st())?.alsoLive ?? []).some((a) => a.field === 'field 3' && a.mapped === false));
  await ui('/api/mapping', 'POST', { mapping: MAP_ALL });
  check('8.3 the mapping is completed on the screen: the camera goes to Lyst 3', await untilScene('Lyst 3 Live', 30000), prog());
  standin.removeScene('Lyst 3 Live');
  check('8.4 the Lyst 3 scene is DELETED in OBS while on air: OBS falls back; the Companion shows Holding (never throws) and REPORTS the missing scene', !!(await until(async () => ((await st())?.mapping?.problems ?? []).some((p) => p.code === 'live_scene_missing' && p.field === 'field 3'), 12000)) && (await untilScene('Holding', 10000)), prog());
  check('8.5 the report reaches BuhurtOS in the heartbeat', !!(await until(() => (heartbeat()?.mapping_problems ?? []).some((p) => p.code === 'live_scene_missing'), 12000)));
  standin.addScene('Lyst 3 Live');
  check('8.6 the scene comes back: the camera returns to Lyst 3', await untilScene('Lyst 3 Live', 30000), prog());

  // ================================================================================================================ 9. OBS disconnect / reconnect / restart and Companion restart in the middle of a fight
  sw = switches(); standin.dropConnections();
  check('9.1 OBS drops mid-fight and reconnects: still Lyst 3, and no unnecessary switch', (await until(async () => (await st())?.obs?.connected, 15000)) && (await holds('Lyst 3 Live', 2500)) && switches() === sw);
  await standin.exit();
  check('9.2 OBS closes mid-fight: "OBS not connected" (heartbeat to BuhurtOS says so); the tournament is unchanged', (await until(async () => (await st())?.obs?.connected === false, 10000)) && !!(await until(() => heartbeat()?.obs_connected === false, 12000)));
  await sleep(2500); await standin.start(); standin.setProgramByHand('Holding');
  check('9.3 OBS reopens (on another scene): re-identified, scene list read, reconciled to Lyst 3', (await until(async () => (await st())?.obs?.connected, 20000)) && (await untilScene('Lyst 3 Live', 15000)), prog());
  await standin.restart({ downMs: 600 });
  check('9.4 OBS restarts (resets to its first scene): reconciled to Lyst 3 again', (await until(async () => (await st())?.obs?.connected, 20000)) && (await untilScene('Lyst 3 Live', 15000)), prog());
  sw = switches(); const pid4 = (await st()).pid; process.kill(pid4, 'SIGKILL');
  check('9.5 the Companion is killed mid-fight: OBS keeps its scene; the restarted Companion reconciles ONCE (already right: no switch)', (await until(async () => { const s = await st(); return s && s.pid !== pid4 && s.obs.connected && !s.awaitingData; }, 25000)) && (await holds('Lyst 3 Live', 3000)) && switches() === sw, `${switches() - sw}`);

  // ================================================================================================================ 10. BuhurtOS stale, then reconnect (no replay)
  proxy.block(); sw = switches();
  await L.finish('head', g3.m); await quietAll();                                          // the fight finishes while the Companion cannot hear (and the next one is not called)
  check('10.1 BuhurtOS is unreachable: the scene is KEPT (no fall to holding), the screen warns once the data is old (20 s)', !!(await until(async () => (await st())?.bos?.stale === true, 40000, 500)) && prog() === 'Lyst 3 Live' && switches() === sw);
  check('10.2 the heartbeat stops reaching BuhurtOS: the organizer\'s view shows the controller silent', (await until(() => heartbeatAgeS() >= 15, 40000, 1000)));
  proxy.unblock();
  check('10.3 BuhurtOS returns: fresh data, the stale warning clears, heartbeats resume (with stale: false)', !!(await until(async () => (await st())?.bos?.stale === false, 20000)) && !!(await until(() => heartbeatAgeS() >= 0 && heartbeatAgeS() < 8 && heartbeat()?.stale === false, 20000)));
  check('10.4 it lands on the CURRENT truth (Lyst 3\'s fight is over): the scene leaves Lyst 3 only after the result window, never replaying what was missed', !!(await until(() => prog() !== 'Lyst 3 Live', 60000)), prog());

  // ================================================================================================================ 11. the Companion, OBS and BuhurtOS are all optional for Pack 13
  await ui('/api/quit', 'POST', {});
  const exit = await Promise.race([companion.exited, sleep(10000).then(() => 'timeout')]);
  check('11.1 Quit from the screen stops the Companion AND the start script (exit code 64 means "a person quit")', exit === 0, String(exit));
  await standin.exit(); proxy.close();
  check('11.2 nothing is listening: no Companion, no OBS', !(await st()) && standin.identifiedSessions() === 0);
  await L.call('head', 'field 2');                                                       // (one Lyst only: a fighter cannot be on two Lysts at once, the queue refuses)
  const pm = activeMatch('field 2'); await L.open('sec', pm);
  const setT = await L.timer('sec', 'field 2', pm, 'set', { mode: 'fight', dur: 60000 }); const startT = await L.start('sec', 'field 2', pm);
  const adj = await L.timer('sec', 'field 2', pm, 'adjust', { delta: -5000 }); const pauseT = await L.timer('sec', 'field 2', pm, 'pause');
  const finPm = await L.finish('sec', pm);
  const camAct = await rpc(await deviceBearer(), 'camera_off_activate', { p_event: EV, p_reason: 'venue' }); const camRel = await rpc('head', 'camera_off_release', { p_event: EV, p_note: 'e2e' });
  const ctl = await control('organizer', { mode: 'manual', target_kind: 'break' }); const ctl2 = await control('organizer', { mode: 'auto' });
  check('11.3 with no controller and no OBS: the timer, rounds, finalize, queue, Camera Off and broadcast control all work through the database',
    [setT, startT, adj, pauseT].every((r) => r.body?.status === 'ok') && finPm.f.body?.status === 'accepted' && camAct.body?.active === true && camRel.body?.active === false && ctl.body?.status === 'ok' && ctl2.body?.status === 'ok',
    JSON.stringify([setT.status, startT.status, adj.status, pauseT.status, finPm.f, camAct.status, camRel.status]));
  check('11.4 Pack 13 results are official in the database and nothing in them refers to the controller', sql(`select queue_state from public.matches where id = '${pm}'`) === 'final');

  // ================================================================================================================ 12. final evidence
  const bad12 = standin.violations(SCOPE);
  check('12.1 EVERY request the Companion sent to the stand-in OBS (this whole run) was on the allow-list and within its configured sources', bad12.length === 0, JSON.stringify(bad12.slice(0, 3)));
  check('12.2 the stream was never started, stopped or asked for its key; no recording; nothing dangerous executed', standin.state.everStreamStarted === false && standin.state.everRecordStarted === false && standin.state.dangerousSeen.length === 0, JSON.stringify(standin.state.dangerousSeen));
  check('12.3 the stand-in saw only these request types', (() => { const types = [...new Set(standin.requests().map((r) => r.type))].sort(); note(types.join(', ')); return types.every((t) => violations([{ type: t }]).length === 0); })());
  const logTxt = companionOut + fs.readFileSync(path.join(HOME, 'companion.log'), 'utf8');
  const sessionSecret = JSON.parse(fs.readFileSync(path.join(HOME, 'credentials.json'), 'utf8')).session_secret;
  check('12.4 the Companion\'s own output and log file (a whole run) never contain the OBS password, the controller code, the session secret or a token', !logTxt.includes(OBS_PASSWORD) && !logTxt.includes(CODE) && !logTxt.includes(CODE.replace(/-/g, '')) && !(sessionSecret && logTxt.includes(sessionSecret)) && !/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(logTxt));
  check('12.5 the heartbeat the database holds contains no secret, scene list or raw level', !/obs-e2e-pw|session_secret|password|inputLevels/i.test(JSON.stringify(heartbeat() ?? {})));
  check('12.6 the audit trail recorded the controller connecting (and Camera Off with who and when)', Number(sql(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'broadcast.camera_off'`)) >= 2 && Number(sql(`select count(*) from public.audit_log where event_id = '${EV}' and action = 'broadcast.controller_status'`)) >= 1);
} catch (e) {
  check('the scenario ran to the end without an unexpected error', false, e?.stack ?? e);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (stand-in verified; this is NOT a real-OBS result)`);
if (failed.length) console.log('FAILED:\n' + failed.map((f) => '  - ' + f.name).join('\n'));
await finish(failed.length ? 1 : 0);
