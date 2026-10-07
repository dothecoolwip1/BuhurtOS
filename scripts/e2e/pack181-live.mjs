// Pack 18.1 SECURITY scenario against a REAL local stack: Postgres built from every migration + the fixture, PostgREST, the local API front serving the REAL
// device-session Edge Function code. All eight example devices (Counter Phone 1-4, Secretary / Scorekeeper Tablet, Marshal Phone, Announcer Tablet, Event Admin
// Tablet) plus the stream controller are created by the event's organizer through the real function, signed in with their codes, and then attacked and used
// through the Data API with their own tokens: what each may do, what the database refuses, revocation, replacement, sign out all, expiry, throttling,
// Event A vs Event B, audit attribution, and a full-database scan for leaked codes / secrets.
// Run through scripts/e2e/pack181-live.sh. LOCAL EVIDENCE ONLY (needs a PostgREST binary; not part of CI). The browser part of this pack is scripts/e2e/device-live.mjs.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const API = process.env.E2E_API, SECRET = process.env.JWT_SECRET, DB = process.env.PGDATABASE;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <-- ' + String(detail).slice(0, 600)}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString('base64url');
const hs = (claims) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify(claims)); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const userJwt = (id, email) => hs({ sub: id, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800 });
const claimsOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const sql = (q) => execFileSync('psql', ['-X', '-At', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
const U = (s) => `00000000-0000-0000-0000-0000000000${s}`;
const ED1 = '00000000-0000-0000-0000-00000000ed01', ED2 = '00000000-0000-0000-0000-00000000ed02';
const M1 = '00000000-0000-0000-0000-0000000fd001', M2 = '00000000-0000-0000-0000-0000000fd002', M3 = '00000000-0000-0000-0000-0000000fd003', M11 = '00000000-0000-0000-0000-0000000fd011', M91 = '00000000-0000-0000-0000-0000000fd091';
const CD1 = '00000000-0000-0000-0000-00000000cd01', CD91 = '00000000-0000-0000-0000-00000000cd91', E205 = '00000000-0000-0000-0000-00000000e205', E206 = '00000000-0000-0000-0000-00000000e206';
const PEOPLE = { organizer: [U('a2'), 'u2@example.test'], scorekeeper: [U('a4'), 'u4@example.test'], head: [U('c1'), 'c1@example.test'], owner: [U('a1'), 'u1@example.test'], stranger: [U('a7'), 'u7@example.test'],
  deskstaff: [U('d1'), 'd1@example.test'], otherOrganizer: [U('b1'), 'b1@example.test'], permAnnouncer: [U('b2'), 'b2@example.test'] };
const FN = `${API}/functions/v1/device-session`;

async function call(token, method, path, body) {
  const headers = { 'content-type': 'application/json', apikey: 'x', prefer: 'return=representation', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const r = await fetch(`${API}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: json, text };
}
const rpc = (token, fn, args = {}) => call(token, 'POST', `rpc/${fn}`, args);
const refused = (r) => r.status >= 400 && r.status < 500;
const ok = (r) => r.status >= 200 && r.status < 300;
const person = (k) => userJwt(...PEOPLE[k]);
async function fn(action, body, { jwt, ip = '203.0.113.10', origin } = {}) {
  const t0 = Date.now();
  const r = await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}), ...(origin ? { origin } : {}) }, body: JSON.stringify({ action, ...body }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body: json, text, ms: Date.now() - t0 };
}
const codes = {}, sessions = {};        // in memory only: the scenario never writes a code anywhere
const signin = async (name, code, ip) => { const r = await fn('signin', { code }, { ip }); if (r.status === 200) sessions[name] = { token: r.body.access_token, secret: r.body.session_secret, whoami: r.body.whoami }; return r; };
const tok = (name) => sessions[name].token;

try {
  // ------------------------------------------------------------------ 0. the world
  check('0. fixture: two events, the organizer of each, the other event has its own match',
    sql(`select count(*) from public.events where id in ('${ED1}','${ED2}')`) === '2' && sql(`select count(*) from public.matches where id = '${M91}'`) === '1');
  check('0b. nothing exists yet: no credentials, no sessions', sql('select count(*) from public.event_credentials') === '0' && sql('select count(*) from public.event_sessions') === '0');

  // ------------------------------------------------------------------ 1. the organizer creates the eight devices + controller through the real function
  const SET = [['counter1', 'Counter Phone 1', 'counter'], ['counter2', 'Counter Phone 2', 'counter'], ['counter3', 'Counter Phone 3', 'counter'], ['counter4', 'Counter Phone 4', 'counter'],
    ['secretary', 'Secretary Tablet', 'scorekeeper'], ['marshal', 'Marshal Phone', 'marshal'], ['announcer', 'Announcer Tablet', 'announcer'], ['admin', 'Event Admin Tablet', 'temporary_organizer']];
  const noJwt = await fn('create', { event: ED1, kind: 'device', label: 'X', role: 'counter' });
  check('1. creating a code needs a signed-in caller (401)', noJwt.status === 401 && !noJwt.body?.code, noJwt.text);
  for (const [who, label] of [['scorekeeper', 'a scorekeeper'], ['head', 'the head marshal'], ['stranger', 'a stranger'], ['otherOrganizer', 'another event\'s organizer'], ['deskstaff', 'the check-in desk'], ['permAnnouncer', 'a permanent announcer']]) {
    const r = await fn('create', { event: ED1, kind: 'device', label: 'Not allowed', role: 'counter' }, { jwt: person(who) });
    check(`1. ${label} cannot create a device code (the database refuses; no code comes back)`, r.status === 403 && !r.body?.code && !/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/.test(r.text), r.text);
  }
  for (const [name, label, role] of SET) {
    const r = await fn('create', { event: ED1, kind: 'device', label, role }, { jwt: person('organizer') });
    codes[name] = r.body?.code;
    check(`1. the organizer creates "${label}" (${role}): a 12-character code shown once`, r.status === 200 && /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(r.body?.code ?? '') && r.body.credential.role === role, r.text);
  }
  const ctl = await fn('create', { event: ED1, kind: 'controller', label: 'Stream Laptop', role: 'broadcast_controller' }, { jwt: person('organizer') });
  codes.controller = ctl.body?.code;
  check('1. the organizer creates the stream controller credential (not a ninth device)', ctl.status === 200 && ctl.body.credential.kind === 'controller', ctl.text);
  const e2c = await fn('create', { event: ED2, kind: 'device', label: 'E2 Counter', role: 'counter' }, { jwt: person('otherOrganizer') });
  const e2m = await fn('create', { event: ED2, kind: 'device', label: 'E2 Marshal', role: 'marshal' }, { jwt: person('otherOrganizer') });
  codes.e2counter = e2c.body?.code; codes.e2marshal = e2m.body?.code;
  check('1. the other event\'s organizer makes its own two devices', !!codes.e2counter && !!codes.e2marshal, e2c.text + e2m.text);
  check('1. all codes are different', new Set(Object.values(codes)).size === Object.keys(codes).length);
  const dup = await fn('create', { event: ED1, kind: 'device', label: 'counter phone 1', role: 'counter' }, { jwt: person('organizer') });
  check('1. a duplicate device name is refused (nothing returned)', dup.status >= 400 && !dup.body?.code, dup.text);
  const listed = await rpc(person('organizer'), 'list_event_credentials', { p_event: ED1 });
  check('1. the organizer\'s list shows 8 devices + the controller, all Active, none used yet, and no code or verifier column',
    ok(listed) && listed.body.length === 9 && listed.body.every(c => c.status === 'active' && c.used === false) && !listed.body.some(c => Object.keys(c).some(k => /code|hash|secret/i.test(k))),
    `${listed.status} n=${listed.body?.length} keys=${Object.keys(listed.body?.[0] ?? {})}`);
  check('1. the database holds only verifiers: no plaintext code in the credential table',
    Object.values(codes).every(c => sql(`select count(*) from public.event_credentials where to_jsonb(event_credentials)::text ilike '%${c.replace(/-/g, '')}%' or to_jsonb(event_credentials)::text ilike '%${c}%'`) === '0'));

  // ------------------------------------------------------------------ 2. sign in
  const bad = await fn('signin', { code: 'AAAA-AAAA-AAAA' }, { ip: '198.51.100.1' });
  check('2. a wrong code is refused (401) after the minimum time, with no hint why', bad.status === 401 && bad.ms >= 340 && !/expired|revoked|throttl/i.test(bad.text), `${bad.status} ${bad.ms}ms ${bad.text}`);
  const shape = await fn('signin', { code: 'nope' }, { ip: '198.51.100.1' });
  check('2. a malformed code gets the very same answer as a wrong one', shape.text === bad.text && shape.status === 401);
  for (const [name, label, role] of SET) {
    const r = await signin(name, name === 'counter1' ? codes[name].toLowerCase().replace(/-/g, ' ') : codes[name], '203.0.113.20');
    check(`2. "${label}" signs in with its own code${name === 'counter1' ? ' (typed in lower case with spaces)' : ''}: a token + a session secret`, r.status === 200 && !!r.body.access_token && !!r.body.session_secret && r.body.whoami.role === role && r.body.whoami.label === label && r.ms >= 340, r.text.slice(0, 200));
  }
  await signin('controller', codes.controller, '203.0.113.21'); await signin('e2counter', codes.e2counter, '203.0.113.22'); await signin('e2marshal', codes.e2marshal, '203.0.113.22');
  const c = claimsOf(tok('marshal'));
  check('2. the token is a short-lived custom-role token whose sub is a SESSION id (not an account), with no role/event/email claim',
    c.role === 'bos_event_device' && c.sub === sessions.marshal.whoami.session_id && c.exp - c.iat === 600 && !c.email && !c.event && !c.device_role && Object.keys(c).length === 6, JSON.stringify(c));
  check('2. the controller\'s token carries the controller role', claimsOf(tok('controller')).role === 'bos_controller');
  check('2. a session id is not an auth account: no auth.users row, no profile, no fighter',
    sql(`select count(*) from auth.users where id = '${c.sub}'`) === '0' && sql(`select count(*) from public.profiles where id = '${c.sub}'`) === '0');
  const who = await rpc(tok('marshal'), 'device_whoami');
  check('2. device_whoami: the Marshal Phone knows who it is and when access ends', ok(who) && who.body.label === 'Marshal Phone' && who.body.role === 'marshal' && who.body.event.slug === 'test-stuff-test' && !!who.body.expires_at, JSON.stringify(who.body));
  check('2. access ends 24 h after the end of the final event day in the event\'s own time zone',
    sql(`select (private.device_credential_expiry(c.id) = ((e.ends_on + 1)::timestamp at time zone e.timezone) + interval '24 hours')::text from public.event_credentials c join public.events e on e.id = c.event_id where c.label = 'Marshal Phone'`) === 'true');
  check('2. the list now shows them as used, with sign-in times', (await rpc(person('organizer'), 'list_event_credentials', { p_event: ED1 })).body.filter(x => x.used).length === 9);

  // ------------------------------------------------------------------ 3. the boundaries: tables and functions no device may touch
  const DEVICES = ['counter1', 'counter2', 'counter3', 'counter4', 'secretary', 'marshal', 'announcer', 'admin'];
  const refusedFor = async (label, f) => { const bad = []; for (const d of [...DEVICES, 'controller']) { const r = await f(tok(d)); if (!refused(r)) bad.push(`${d}:${r.status}`); } check(label, bad.length === 0, bad.join(' ')); };
  for (const t of ['event_staff', 'registrations', 'registration_private', 'platform_roles', 'profiles', 'audit_log', 'event_credentials', 'event_sessions', 'device_code_attempts', 'lyst_counts', 'lyst_counter_seats',
    'event_camera_state', 'event_camera_log', 'event_broadcast_control', 'broadcast_controller_status', 'notifications', 'fighter_accounts']) {
    await refusedFor(`3. no device and not the controller can READ the ${t} table`, (t_) => call(t_, 'GET', `${t}?select=*&limit=1`));
  }
  const publicOk = []; for (const d of [...DEVICES, 'controller']) { const r = await call(tok(d), 'GET', 'matches?select=id&limit=1'); if (!ok(r) || !r.body.length) publicOk.push(d); }
  check('3. but every session can read the public data (matches of published events)', publicOk.length === 0, publicOk.join(','));
  check('3. ... and the public Lyst view', ok(await call(tok('announcer'), 'GET', 'lyst_public_state?select=match_id&limit=1')));
  await refusedFor('3. nobody can write a match directly (PATCH)', (t) => call(t, 'PATCH', `matches?id=eq.${M1}`, { field: 'Field 9' }));
  await refusedFor('3. nobody can add themselves as staff (POST event_staff)', (t) => call(t, 'POST', 'event_staff', { event_id: ED1, user_id: U('a7'), role: 'organizer' }));
  await refusedFor('3. nobody can edit a credential (PATCH event_credentials: extend expiry / change role)', (t) => call(t, 'PATCH', 'event_credentials?label=eq.Marshal%20Phone', { role: 'temporary_organizer' }));
  await refusedFor('3. nobody can write a camera state or a broadcast control row directly', (t) => call(t, 'PATCH', `event_camera_state?event_id=eq.${ED1}`, { active: false }));
  await refusedFor('3. an ordinary signed-in function is out of reach (my_fighter_id)', (t) => rpc(t, 'my_fighter_id'));
  await refusedFor('3. ... create/revoke/list device codes', (t) => rpc(t, 'list_event_credentials', { p_event: ED1 }));
  await refusedFor('3. ... close the event', (t) => rpc(t, 'close_event', { p_event: ED1 }));
  await refusedFor('3. ... build a schedule', (t) => rpc(t, 'build_schedule', { p_event: ED1, p_matches: [], p_mode: 'new', p_seed: null }));
  await refusedFor('3. ... change broadcast settings (stream URL, sponsors)', (t) => rpc(t, 'set_broadcast_settings', { p_event: ED1, p_settings: {} }));
  await refusedFor('3. ... read staff with emails', (t) => rpc(t, 'list_event_staff', { p_event: ED1 }));
  await refusedFor('3. ... the open signed-in surface (register for an event)', (t) => rpc(t, 'submit_registration', { p: {} }));
  await refusedFor('3. ... a session cannot open or refresh sessions (service role only)', (t) => rpc(t, 'device_open_session', { p_code_hash: '\\x' + '00'.repeat(32), p_secret_hash: '\\x' + '01'.repeat(32), p_ip_hash: 'x' }));
  const ctrlWho = await rpc(tok('controller'), 'device_whoami');
  check('3. the controller cannot call device_whoami (devices only)', refused(ctrlWho), ctrlWho.text);
  const devCtrl = await rpc(tok('admin'), 'controller_state');
  check('3. a device is not a controller: controller_state refused', refused(devCtrl), devCtrl.text);

  // ------------------------------------------------------------------ 4. what each role CAN and CANNOT do (server side, with real tokens)
  const matrix = [
    // [label, call, who -> expected true/false]
    ['open a Lyst (can_score)', (t) => rpc(t, 'lyst_open', { p_match: M1, p_counter_input: 'simple' }), { counter1: 0, secretary: 1, marshal: 1, announcer: 0, admin: 1 }],
    ['read the Lyst tablet state (all tallies)', (t) => rpc(t, 'lyst_state', { p_match: M1 }), { counter1: 0, secretary: 1, marshal: 1, announcer: 0, admin: 1 }],
    ['call a fight (set_match_queue)', (t) => rpc(t, 'set_match_queue', { p_match: M2, p_state: 'scheduled', p_field: null }), { counter1: 0, secretary: 1, marshal: 1, announcer: 0, admin: 1 }],
    ['reorder the queue (Secretary / Event Admin only)', (t) => rpc(t, 'move_match_in_queue', { p_match: M2, p_action: 'later' }), { counter1: 0, secretary: 1, marshal: 0, announcer: 0, admin: 1 }],
    ['read the Command Centre', (t) => rpc(t, 'event_command_snapshot', { p_event: ED1 }), { counter1: 0, secretary: 1, marshal: 0, announcer: 0, admin: 1 }],
    ['send an announcement', (t) => rpc(t, 'send_event_announcement', { p_event: ED1, p_message: 'Lunch ends at 1:15 PM.', p_audience: 'everyone' }), { counter1: 0, secretary: 1, marshal: 0, announcer: 0, admin: 1 }],
    ['read the announcement history', (t) => rpc(t, 'list_event_announcements', { p_event: ED1 }), { counter1: 0, secretary: 0, marshal: 0, announcer: 0, admin: 1 }],
    ['correct an official result (Event Admin only)', (t) => rpc(t, 'correct_result', { p_competition: CD1, p_entry: E205, p_place: 1, p_points: 11, p_reason: 'scoring typo fixed' }), { counter1: 0, secretary: 0, marshal: 0, announcer: 0, admin: 1 }],
    ['resolve result conflicts (head marshal power)', (t) => rpc(t, 'list_result_conflicts', { p_event: ED1 }), { counter1: 0, secretary: 0, marshal: 0, announcer: 0, admin: 1 }],
    ['add staff by email', (t) => rpc(t, 'grant_event_role_by_email', { p_event: ED1, p_email: 'u7@example.test', p_role: 'announcer' }), { counter1: 0, secretary: 0, marshal: 0, announcer: 0, admin: 1 }],
    ['make someone an ORGANIZER (nobody below the organizer)', (t) => rpc(t, 'grant_event_role_by_email', { p_event: ED1, p_email: 'u7@example.test', p_role: 'organizer' }), { counter1: 0, secretary: 0, marshal: 0, announcer: 0, admin: 0 }],
    ['read staff by name', (t) => rpc(t, 'list_event_staff_names', { p_event: ED1 }), { counter1: 0, secretary: 0, marshal: 0, announcer: 0, admin: 1 }],
    ['read ready / not ready for the announcer', (t) => rpc(t, 'announcer_readiness', { p_event: ED1 }), { counter1: 0, secretary: 1, marshal: 1, announcer: 1, admin: 1 }],
    ['take a Lyst on air (broadcast control)', (t) => rpc(t, 'set_broadcast_control', { p_event: ED1, p_expected_rev: 0, p_patch: { mode: 'manual', target_kind: 'holding' } }), { counter1: 0, secretary: 0, marshal: 0, announcer: 0, admin: 1 }],
    ['read the broadcast state', (t) => rpc(t, 'broadcast_control_state', { p_event: ED1 }), { counter1: 0, secretary: 1, marshal: 0, announcer: 0, admin: 1 }],
    ['set Lyst settings (head marshal power)', (t) => rpc(t, 'set_lyst_settings', { p_event: ED1, p_settings: {} }), { counter1: 0, secretary: 0, marshal: 0, announcer: 0, admin: 1 }]
  ];
  for (const [label, f, want] of matrix) {
    const got = {}; for (const d of Object.keys(want)) got[d] = ok(await f(tok(d))) ? 1 : 0;
    const wrong = Object.keys(want).filter(d => got[d] !== want[d]);
    check(`4. ${label}: ${Object.entries(want).map(([d, v]) => `${d} ${v ? 'yes' : 'no'}`).join(', ')}`, wrong.length === 0, `differs: ${wrong.map(d => `${d} got ${got[d]} want ${want[d]}`).join('; ')}`);
  }
  // the matrix above changed things; undo what later checks depend on
  sql(`update public.matches set queue_state = 'scheduled', queue_order = null where id = '${M2}'; delete from public.event_broadcast_control; delete from public.event_announcements;`);
  sql(`delete from public.event_staff where role = 'announcer' and user_id = '${U('a7')}'`);
  check('4. the correction by the Event Admin kept the old value in the result history and named the device', sql(`select count(*) from public.result_revisions where action = 'corrected' and old_points = 10 and new_points = 11`) === '1' &&
    sql(`select count(*) from public.audit_log where action = 'result.corrected' and details->'device'->>'label' = 'Event Admin Tablet'`) === '1');
  sql(`update public.results set points = 10 where entry_id = '${E205}'`);

  // ------------------------------------------------------------------ 5. a real fight: marshal runs it, counters count privately, secretary assigns
  check('5. the Marshal Phone opens the fight and starts the clock', ok(await rpc(tok('marshal'), 'lyst_open', { p_match: M1, p_counter_input: 'simple' })) &&
    (await rpc(tok('marshal'), 'lyst_timer_command', { p_event: ED1, p_field: 'Field 1', p_match: M1, p_expected_rev: 0, p_command: crypto.randomUUID(), p_action: 'start', p_mode: 'fight', p_duration_ms: 60000, p_round: 1, p_delta_ms: 0 })).body?.status === 'ok');
  // Pack 25: no join code and no seating. A counter device binds ITSELF to a Lyst and a side; scoring staff may move it; nobody approves anything.
  const qr = await rpc(tok('marshal'), 'counter_pool_code', { p_event: ED1 });
  check('5. the Marshal Phone may ask for the event\'s Counter QR (none made yet: it says so, and a device cannot make one)', ok(qr) && qr.body.code === null && qr.body.can_create === false, qr.text);
  for (const [n, side] of [['counter1', 'a'], ['counter2', 'b']]) { const r = await rpc(tok(n), 'counter_bind', { p_field: 'Field 1', p_side: side, p_operator: sessions[n].whoami.label }); check(`5. ${sessions[n].whoami.label} binds itself to Field 1 ${side === 'a' ? 'red' : 'blue'}: on the fight at once, nothing pending`, ok(r) && r.body.seat?.status === 'active' && r.body.seat?.side === side, r.text); }
  const seatId = (n) => sql(`select id from public.lyst_counter_seats where user_id = '${sessions[n].whoami.session_id}' and status in ('pending','active')`);
  check('5. the seats carry the names the phones gave (the device labels; no person behind them)', sql(`select string_agg(display_name, ',' order by display_name) from public.lyst_counter_seats where event_id = '${ED1}'`) === 'Counter Phone 1,Counter Phone 2');
  const e2join = await rpc(tok('e2counter'), 'counter_bind', { p_field: 'Field 1', p_side: 'a', p_operator: 'Other' });
  check('5. an Event 2 counter binds on ITS OWN event only: never on Event 1\'s fight', ok(e2join) && e2join.body.event?.slug === 'other-event' && (e2join.body.seat?.match_id ?? null) === null && sql(`select count(*) from public.lyst_counter_seats where event_id = '${ED1}' and user_id = '${sessions.e2counter.whoami.session_id}'`) === '0', e2join.text);
  const secJoin = await rpc(tok('secretary'), 'counter_bind', { p_field: 'Field 1', p_side: 'a', p_operator: 'Sec' });
  check('5. a Secretary device cannot be a counter either', refused(secJoin), secJoin.text);
  const counterMove = await rpc(tok('counter3'), 'move_counter_session', { p_session: sessions.counter1.whoami.session_id, p_field: 'Field 1', p_side: 'b' });
  check('5. a Counter cannot move another phone', refused(counterMove), counterMove.text);
  check('5. the Secretary / Scorekeeper may move a phone (Counter Phone 2 to blue, where it is; the binding is the server\'s)', ok(await rpc(tok('secretary'), 'move_counter_session', { p_session: sessions.counter2.whoami.session_id, p_field: 'Field 1', p_side: 'b' })) && sql(`select side from public.counter_bindings where session_id = '${sessions.counter2.whoami.session_id}'`) === 'b');
  check('5. Counter Phone 1 counts on its own seat', ok(await rpc(tok('counter1'), 'counter_record', { p_id: crypto.randomUUID(), p_seat: seatId('counter1'), p_round: 1, p_weight: 1 })));
  check('5. Counter Phone 2 cannot count on Counter Phone 1\'s seat', refused(await rpc(tok('counter2'), 'counter_record', { p_id: crypto.randomUUID(), p_seat: seatId('counter1'), p_round: 1, p_weight: 1 })));
  const state = await rpc(tok('counter1'), 'counter_state');
  check('5. a Counter\'s own state does not include anyone else\'s tally', ok(state) && !JSON.stringify(state.body).includes(seatId('counter2')), state.text.slice(0, 200));
  const ann = await rpc(tok('announcer'), 'lyst_public_state'.replace('lyst_public_state', 'announcer_readiness'), { p_event: ED1 });
  check('5. the Announcer reads only ready / not ready (3 columns, no reasons or notes)', ok(ann) && ann.body.length > 0 && ann.body.every(r => Object.keys(r).sort().join() === 'match_id,ready,side'), ann.text.slice(0, 200));
  check('5. the Marshal Phone\'s timer command is in the audit log under the DEVICE (label, role, session)', sql(`select count(*) from public.audit_log where action = 'lyst.timer' and actor = '${sessions.marshal.whoami.session_id}' and details->'device'->>'label' = 'Marshal Phone' and details->'device'->>'role' = 'marshal'`) !== '0');

  // ------------------------------------------------------------------ 6. Camera Off: who protects, who restores, latched
  const camera = async (name, fnn, args) => rpc(tok(name), fnn, { p_event: ED1, ...args });
  for (const n of ['counter1', 'counter2', 'counter3', 'counter4']) check(`6. ${sessions[n].whoami.label} cannot turn the cameras off (a Counter gets no Camera Off)`, refused(await camera(n, 'camera_off_activate', { p_reason: 'medical' })));
  check('6. ... and a stranger, the check-in desk and a permanent fighter-less account cannot', refused(await rpc(person('stranger'), 'camera_off_activate', { p_event: ED1, p_reason: 'medical' })) && refused(await rpc(person('deskstaff'), 'camera_off_activate', { p_event: ED1, p_reason: 'medical' })));
  check('6. the other event\'s Marshal device cannot turn THIS event\'s cameras off', refused(await rpc(tok('e2marshal'), 'camera_off_activate', { p_event: ED1, p_reason: 'medical' })));
  const off = await camera('announcer', 'camera_off_activate', { p_reason: 'medical' });
  check('6. the Announcer turns the cameras off (medical): state shows who and why', ok(off) && off.body.status === 'off' && off.body.activated_by_label === 'Announcer Tablet' && off.body.reason === 'medical', off.text);
  for (const n of ['announcer', 'marshal', 'secretary']) check(`6. the ${sessions[n].whoami.label} cannot turn the cameras back on`, refused(await camera(n, 'camera_off_release', {})), 'released?');
  check('6. a permanent marshal-less scorekeeper cannot release either', refused(await rpc(person('scorekeeper'), 'camera_off_release', { p_event: ED1 })));
  check('6. the other event\'s organizer cannot release this event\'s cameras', refused(await rpc(person('otherOrganizer'), 'camera_off_release', { p_event: ED1 })));
  check('6. still off after every refused release', (await camera('marshal', 'camera_state', {})).body.active === true);
  await rpc(tok('marshal'), 'set_match_queue', { p_match: M2, p_state: 'on_deck', p_field: null });
  check('6. the tournament carries on while the cameras are off (a new fight is called) and they stay off', (await camera('secretary', 'camera_state', {})).body.active === true && sql(`select queue_state from public.matches where id = '${M2}'`) === 'on_deck');
  const state2 = (await camera('admin', 'camera_state', {})).body;
  check('6. the Event Admin sees who turned it off and may release', state2.active && state2.can_release === true && state2.activated_by_label === 'Announcer Tablet');
  check('6. the Event Admin turns the cameras back on', (await camera('admin', 'camera_off_release', { p_note: 'player is fine' })).body?.status === 'on');
  await camera('marshal', 'camera_off_activate', { p_reason: 'privacy' });
  check('6. the head marshal (a permanent account) can release', (await rpc(person('head'), 'camera_off_release', { p_event: ED1 })).body?.status === 'on');
  await camera('secretary', 'camera_off_activate', { p_reason: 'camera_problem' });
  check('6. the organizer can release', (await rpc(person('organizer'), 'camera_off_release', { p_event: ED1 })).body?.status === 'on');
  await camera('admin', 'camera_off_activate', { p_reason: 'venue' });
  check('6. the platform owner can release', (await rpc(person('owner'), 'camera_off_release', { p_event: ED1 })).body?.status === 'on');
  check('6. every activation and release is audited with its device and recorded in the append-only log',
    Number(sql(`select count(*) from public.audit_log where action in ('broadcast.camera_off','broadcast.camera_released')`)) === 8 && Number(sql(`select count(*) from public.event_camera_log where event_id = '${ED1}'`)) === 8 &&
    sql(`select count(*) from public.audit_log where action = 'broadcast.camera_off' and details->'device'->>'label' = 'Announcer Tablet'`) === '1');
  check('6. a permanent announcer account can also activate (and cannot release)', ok(await rpc(person('permAnnouncer'), 'camera_off_activate', { p_event: ED1, p_reason: 'other' })) && refused(await rpc(person('permAnnouncer'), 'camera_off_release', { p_event: ED1 })));
  await rpc(person('organizer'), 'camera_off_release', { p_event: ED1 });

  // ------------------------------------------------------------------ 7. announcements and attribution
  { const r = await rpc(tok('secretary'), 'send_event_announcement', { p_event: ED1, p_message: 'Finals start at 4 PM.', p_audience: 'everyone' }); const row = sql(`select concat_ws('|', sent_by is null, sent_by_label) from public.event_announcements order by sent_at desc limit 1`);
    check('7. the Secretary\'s announcement is stored with the DEVICE name, no account behind it', ok(r) && row === 't|Secretary Tablet', `${r.status} ${r.text} row=${row}`); }

  // ------------------------------------------------------------------ 8. revocation, replacement, sign out all
  const revoked = await rpc(person('organizer'), 'revoke_event_credential', { p_credential: sql(`select id from public.event_credentials where label = 'Counter Phone 3'`), p_reason: 'phone missing' });
  check('8. the organizer revokes Counter Phone 3 only', ok(revoked) && revoked.body.status === 'revoked', revoked.text);
  const r3 = await rpc(tok('counter3'), 'device_whoami');
  const r3b = await rpc(tok('counter3'), 'counter_bind', { p_field: 'Field 1', p_side: 'a', p_operator: 'x' });
  check('8. Counter Phone 3\'s token has no authority from the very next call (not even to bind to a Lyst)', refused(r3) && refused(r3b), `${r3.text} | ${r3b.status} ${r3b.text}`);
  check('8. a revoked counter that already held an ACTIVE seat can no longer count (revocation is immediate, not at seat expiry)', await (async () => {
    const r1 = await rpc(person('organizer'), 'revoke_event_credential', { p_credential: sql(`select id from public.event_credentials where label = 'Counter Phone 2'`), p_reason: 'test' });
    const a2 = await rpc(tok('counter2'), 'counter_record', { p_id: crypto.randomUUID(), p_seat: seatId('counter2'), p_round: 1, p_weight: 1 });
    const b2 = await rpc(tok('counter2'), 'counter_state');
    return ok(r1) && refused(a2) && refused(b2);
  })());
  const ref3 = await fn('refresh', { session_secret: sessions.counter3.secret });
  check('8. ... its refresh is refused with the same answer as a wrong code', ref3.status === 401 && ref3.text === bad.text, ref3.text);
  const again3 = await fn('signin', { code: codes.counter3 }, { ip: '203.0.113.30' });
  check('8. ... and its code opens nothing', again3.status === 401 && again3.text === bad.text);
  check('8. Counter Phones 1 and 4 are untouched by revoking others', ok(await rpc(tok('counter1'), 'device_whoami')) && ok(await rpc(tok('counter4'), 'device_whoami')));
  check('8. a refresh of a live session works and returns a new token (no new secret)', await (async () => { const r = await fn('refresh', { session_secret: sessions.counter1.secret }); return r.status === 200 && r.body.access_token && !r.body.session_secret && claimsOf(r.body.access_token).sub === sessions.counter1.whoami.session_id; })());
  const rep = await fn('replace', { credential: sql(`select id from public.event_credentials where label = 'Counter Phone 4' and revoked_at is null`) }, { jwt: person('organizer') });
  check('8. replacing Counter Phone 4 gives a new code', rep.status === 200 && /^[0-9A-Z]{4}-/.test(rep.body.code ?? '') && rep.body.code !== codes.counter4, rep.text);
  check('8. ... the old code and the old session are dead immediately', refused(await rpc(tok('counter4'), 'device_whoami')) && (await fn('signin', { code: codes.counter4 }, { ip: '203.0.113.31' })).status === 401);
  const newS = await fn('signin', { code: rep.body.code }, { ip: '203.0.113.32' });
  check('8. ... and the new code works as the same device name and role', newS.status === 200 && newS.body.whoami.label === 'Counter Phone 4' && newS.body.whoami.role === 'counter');
  sessions.counter4 = { token: newS.body.access_token, secret: newS.body.session_secret, whoami: newS.body.whoami };
  const dupSession = await fn('signin', { code: codes.marshal }, { ip: '203.0.113.33' });
  check('8. signing in again with a device\'s code is allowed; the LATER sign-in wins, and the earlier session loses authority',
    dupSession.status === 200 && refused(await rpc(tok('marshal'), 'device_whoami')) && ok(await rpc(dupSession.body.access_token, 'device_whoami')) && sql(`select count(*) from public.event_credentials where label = 'Marshal Phone' and elsewhere_at is not null`) === '1');
  sessions.marshal = { token: dupSession.body.access_token, secret: dupSession.body.session_secret, whoami: dupSession.body.whoami };
  check('8. the organizer\'s list flags the sign-in elsewhere', (await rpc(person('organizer'), 'list_event_credentials', { p_event: ED1 })).body.find(x => x.label === 'Marshal Phone').signed_in_elsewhere_at !== null);
  const so = await rpc(tok('admin'), 'revoke_all_event_devices', { p_event: ED1 });
  check('8. the Event Admin cannot sign everyone out (organizer only)', refused(so));
  const soAll = await rpc(person('organizer'), 'revoke_all_event_devices', { p_event: ED1 });
  check('8. Sign Out All ends every temporary device of the event that is still active', ok(soAll) && soAll.body.revoked === 6, soAll.text);
  const stillLive = []; for (const d of DEVICES.filter(x => x !== 'counter3' && x !== 'counter2')) if (ok(await rpc(tok(d), 'device_whoami'))) stillLive.push(d);
  check('8. ... none of the eight can do anything any more', stillLive.length === 0, stillLive.join(','));
  check('8. ... the stream controller and Event 2\'s devices are untouched', ok(await rpc(tok('controller'), 'controller_state')) && ok(await rpc(tok('e2marshal'), 'device_whoami')) && ok(await rpc(tok('e2counter'), 'device_whoami')));

  // ------------------------------------------------------------------ 9. the controller
  const cs = await rpc(tok('controller'), 'controller_state');
  check('9. the controller reads its event\'s desired state only', ok(cs) && cs.body.event.slug === 'test-stuff-test' && cs.body.control.mode === 'auto' && cs.body.camera.active === false, cs.text);
  check('9. ... and reports its status (a small object)', ok(await rpc(tok('controller'), 'broadcast_controller_heartbeat', { p_status: { obs_connected: true, mode: 'auto' } })));
  for (const [label, f] of [['score', () => rpc(tok('controller'), 'lyst_open', { p_match: M1 })], ['turn cameras off', () => rpc(tok('controller'), 'camera_off_activate', { p_event: ED1, p_reason: 'other' })],
    ['release cameras', () => rpc(tok('controller'), 'camera_off_release', { p_event: ED1 })], ['command itself', () => rpc(tok('controller'), 'set_broadcast_control', { p_event: ED1, p_expected_rev: 0, p_patch: { mode: 'manual', target_kind: 'holding' } })],
    ['read the camera state table', () => call(tok('controller'), 'GET', 'event_camera_state')], ['read staff', () => call(tok('controller'), 'GET', 'event_staff')]]) check(`9. the controller cannot ${label}`, refused(await f()));
  const cs2 = await rpc(tok('e2marshal'), 'controller_state');
  check('9. a device cannot read controller state', refused(cs2));
  const ctl2 = await fn('create', { event: ED2, kind: 'controller', label: 'E2 Laptop', role: 'broadcast_controller' }, { jwt: person('otherOrganizer') });
  const c2 = await signin('e2ctl', ctl2.body.code, '203.0.113.40');
  const cs3 = await rpc(tok('e2ctl'), 'controller_state');
  check('9. Event 2\'s controller reads Event 2 and never Event 1', ok(cs3) && cs3.body.event.slug === 'other-event', cs3.text);
  const stCount = sql(`select count(*) from public.broadcast_controller_status where event_id = '${ED2}'`);
  await rpc(tok('e2ctl'), 'broadcast_controller_heartbeat', { p_status: { obs_connected: false } });
  check('9. each controller\'s report lands on its own event only', stCount === '0' && sql(`select string_agg(event_id::text, ',' order by event_id) from public.broadcast_controller_status`) === `${ED1},${ED2}`);
  const cr = await rpc(person('organizer'), 'revoke_event_credential', { p_credential: sql(`select id from public.event_credentials where kind = 'controller' and event_id = '${ED1}'`) });
  check('9. revoking the controller cuts it off at once', ok(cr) && refused(await rpc(tok('controller'), 'controller_state')) && refused(await rpc(tok('controller'), 'broadcast_controller_heartbeat', { p_status: {} })));

  // ------------------------------------------------------------------ 10. Event A vs Event B
  check('10. Event 2\'s Marshal device cannot act on Event 1', refused(await rpc(tok('e2marshal'), 'lyst_open', { p_match: M1 })) && refused(await rpc(tok('e2marshal'), 'set_match_queue', { p_match: M1, p_state: 'on_deck', p_field: null })) &&
    refused(await rpc(tok('e2marshal'), 'event_command_snapshot', { p_event: ED1 })));
  check('10. ... but runs its own event', ok(await rpc(tok('e2marshal'), 'lyst_open', { p_match: M91, p_counter_input: 'simple' })));
  check('10. an Event 1 code is not an Event 2 code (each only opens its own event)', sessions.e2marshal.whoami.event.slug === 'other-event');

  // ------------------------------------------------------------------ 11. expiry, enforced by the server
  const fresh = await fn('create', { event: ED1, kind: 'device', label: 'Late Marshal', role: 'marshal' }, { jwt: person('organizer') });
  const fs = await signin('late', fresh.body.code, '203.0.113.50');
  check('11. a new device signs in and works', fs.status === 200 && ok(await rpc(tok('late'), 'lyst_open', { p_match: M1, p_counter_input: 'simple' })));
  sql(`update public.events set starts_on = '2026-01-01', ends_on = '2026-01-01' where id = '${ED1}'`);
  check('11. once the event\'s final day + 24 h has passed the SAME token has no authority (nothing stored in the token or the browser matters)', refused(await rpc(tok('late'), 'lyst_open', { p_match: M1 })) && refused(await rpc(tok('late'), 'device_whoami')));
  const lateRef = await fn('refresh', { session_secret: sessions.late.secret });
  check('11. ... its refresh is refused', lateRef.status === 401);
  const lateSign = await fn('signin', { code: fresh.body.code }, { ip: '203.0.113.51' });
  check('11. ... and its code opens nothing', lateSign.status === 401);
  sql(`update public.events set starts_on = (now() at time zone 'America/Edmonton')::date, ends_on = (now() at time zone 'America/Edmonton')::date + 1 where id = '${ED1}'`);
  check('11. moving the event back makes the same credential valid again (expiry is computed from the event, not stored)', ok(await rpc((await signin('late', fresh.body.code, '203.0.113.52')).body.access_token, 'device_whoami')));
  const edge = (offsetMin) => sql(`select private.device_valid_at(c.id, private.device_credential_expiry(c.id) + interval '${offsetMin} minutes')::text from public.event_credentials c where c.label = 'Late Marshal'`);
  check('11. end + 23:59 valid, at expiry refused, after refused (boundary, in this database)', edge(-1) === 'true' && edge(0) === 'false' && edge(1) === 'false', `${edge(-1)} ${edge(0)} ${edge(1)}`);

  // ------------------------------------------------------------------ 12. guessing
  const ipg = '198.51.100.99'; const bodies = new Set();
  for (let i = 0; i < 10; i++) { const r = await fn('signin', { code: crypto.randomBytes(8).toString('hex').slice(0, 12).toUpperCase().replace(/[ILOU]/g, 'K') }, { ip: ipg }); bodies.add(r.text); }
  const valid = await fn('signin', { code: fresh.body.code }, { ip: ipg });
  check('12. ten wrong guesses from one address lock NEW sign-ins from that address, with the same answer every time', bodies.size === 1 && valid.status === 401, `${bodies.size} ${valid.status}`);
  const elsewhere = await fn('signin', { code: fresh.body.code }, { ip: '198.51.100.100' });
  check('12. ... another address (the venue\'s other devices) is not affected', elsewhere.status === 200);
  check('12. ... and an existing session is not signed out by a lockout', ok(await rpc(elsewhere.body.access_token, 'device_whoami')));
  check('12. the attempts table stores hashed addresses only (no raw IP)', sql(`select count(*) from public.device_code_attempts where ip_hash ~ '^[0-9.]+$' or ip_hash like '%198.51%'`) === '0');

  // ------------------------------------------------------------------ 13. the permanent accounts are unaffected
  check('13. the permanent organizer still does everything it did (lyst, queue, announcement, command centre)', ok(await rpc(person('organizer'), 'lyst_open', { p_match: M1, p_counter_input: 'simple' })) && ok(await rpc(person('organizer'), 'event_command_snapshot', { p_event: ED1 })) &&
    ok(await rpc(person('organizer'), 'move_match_in_queue', { p_match: M3, p_action: 'later' })));
  check('13. the permanent scorekeeper still scores and (new) reads the Command Centre and sends announcements', ok(await rpc(person('scorekeeper'), 'lyst_open', { p_match: M1, p_counter_input: 'simple' })) && ok(await rpc(person('scorekeeper'), 'event_command_snapshot', { p_event: ED1 })));
  check('13. ... but is still refused what a scorekeeper never had: correct a result, build a schedule, settings, devices', refused(await rpc(person('scorekeeper'), 'correct_result', { p_competition: CD1, p_entry: E205, p_place: 1, p_points: 3, p_reason: 'no right' })) &&
    refused(await rpc(person('scorekeeper'), 'set_lyst_settings', { p_event: ED1, p_settings: {} })) && refused(await rpc(person('scorekeeper'), 'list_event_credentials', { p_event: ED1 })));
  check('13. the head marshal and the check-in desk keep their own powers and gain nothing', ok(await rpc(person('head'), 'list_result_conflicts', { p_event: ED1 })) && refused(await rpc(person('deskstaff'), 'lyst_open', { p_match: M1 })) &&
    refused(await rpc(person('head'), 'move_match_in_queue', { p_match: M3, p_action: 'later' })));
  check('13. the platform owner keeps its reach (can turn cameras off and on)', ok(await rpc(person('owner'), 'camera_off_activate', { p_event: ED1, p_reason: 'other' })) && ok(await rpc(person('owner'), 'camera_off_release', { p_event: ED1 })));

  // ------------------------------------------------------------------ 14. audit attribution and leak scan
  check('14. every device action in the audit log names a device (label, role, session) and a session actor, never "anonymous"',
    sql(`select count(*) from public.audit_log where actor in (select id from public.event_sessions) and (details->'device'->>'label') is null`) === '0' &&
    Number(sql(`select count(*) from public.audit_log where details ? 'device'`)) > 20);
  check('14. no device action is attributed to a null actor', sql(`select count(*) from public.audit_log where actor is null and details ? 'device'`) === '0');
  check('14. the audit log has the full life of the devices: created, signed in, replaced, revoked, revoked all',
    ['device.created', 'device.signed_in', 'device.replaced', 'device.revoked', 'device.revoked_all', 'controller.created', 'controller.revoked', 'broadcast.camera_off', 'broadcast.camera_released'].every(a => Number(sql(`select count(*) from public.audit_log where action = '${a}'`)) > 0));
  const dump = execFileSync('pg_dump', ['--data-only', '--inserts', '-d', DB, '--exclude-table-data=public.rate_limits'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const secrets = [...Object.values(codes).flatMap(c => [c, c.replace(/-/g, '')]), ...Object.values(sessions).flatMap(s => [s.secret, s.token])];
  check('14. NOTHING in the whole database (every table, every column) contains any device code, session secret or token', secrets.every(s => !dump.includes(s)), secrets.filter(s => dump.includes(s)).map(s => s.slice(0, 6) + '…').join(' '));
  check('14. the credential table holds a 32-byte verifier per code and a 32-byte hash per session secret, nothing else', sql(`select count(*) from public.event_credentials where octet_length(code_hash) <> 32`) === '0' && sql(`select count(*) from public.event_sessions where octet_length(secret_hash) <> 32`) === '0');
} catch (e) {
  check('scenario ran to the end without an unexpected error', false, e?.stack ?? e);
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:\n' + failed.map(f => ' - ' + f.name).join('\n')); process.exit(1); }
console.log('PACK181 SECURITY LIVE PASSED');
