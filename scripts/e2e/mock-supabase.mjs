/**
 * A tiny in-memory stand-in for the Supabase REST API, enough to drive the real built app in a real browser (Playwright route handlers).
 * It is a TEST DOUBLE: it proves how the app behaves (queueing, pending, offline, review screens). It proves nothing about the real
 * database; that is covered by supabase/tests/*.sql. Nothing here ever talks to a hosted project.
 */
export const REF = 'mvbxlebznlgroptwwdsm';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const jwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: 4102444800 })}.sig`;
export const sessionFor = (id, email) => ({
  access_token: jwt(id), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
});
export const storageKey = `sb-${REF}-auth-token`;

export const IDS = {
  event: '00000000-0000-0000-0000-00000000e101', comp: '00000000-0000-0000-0000-00000000b101', entryA: '00000000-0000-0000-0000-00000000e1a1', entryB: '00000000-0000-0000-0000-00000000e1b1',
  m1: '00000000-0000-0000-0000-0000000f0001', m2: '00000000-0000-0000-0000-0000000f0002', userA: '00000000-0000-0000-0000-0000000000a4', userB: '00000000-0000-0000-0000-0000000000a5', head: '00000000-0000-0000-0000-0000000000a3'
};

export function createMock(opts = {}) {
  const st = {
    offline: false, calls: [], commands: new Map(), applied: 0, dropReplyOnce: false, roles: opts.roles ?? { [IDS.userA]: ['scorekeeper'], [IDS.userB]: ['scorekeeper'], [IDS.head]: ['head_marshal'] },
    submit: 'accepted',            // what submit_match_result answers: accepted | conflict | stale | error500
    delivered: new Map(),          // score event id -> count
    conflicts: [], paper: [], resolved: [],
    matches: [
      { id: IDS.m1, competition_id: IDS.comp, stage: 'round_robin', round_label: 'Round 1', position: 0, pool: null, field: 'Field 1', scheduled_at: null, queue_state: 'active', entry_a: IDS.entryA, entry_b: IDS.entryB, next_match_id: null, next_slot: null, result: null, winner_entry_id: null, score_a: null, score_b: null, detail: {}, version: 3, finalized_at: null,
        a: { teams: { name: 'Iron Wolves' }, fighters: null }, b: { teams: { name: 'Ash Guard' }, fighters: null } }
    ],
    bodyOf: (req) => { try { return JSON.parse(req.postData() ?? '{}'); } catch { return {}; } }
  };
  const event = { id: IDS.event, slug: 'test-rumble', name: 'Test Rumble', description: 'x', event_type: 'tournament', status: 'published', venue: null, address: null, city: 'Red Deer', region: 'AB', starts_on: '2026-11-14', ends_on: '2026-11-15', fee_cents: 0, fee_province: null, fee_note: null, registration_opens_at: null, registration_closes_at: null, registration_mode: 'none', external_url: null, time_note: null, volunteer_info: null };
  const comp = { id: IDS.comp, name: 'Longsword', category: 'longsword', gender: 'open', ruleset: null, status: 'running', rounds_to_win: null, sort: 0, ref_categories: { league: 'duels' } };
  const userFrom = (route) => { const a = route.request().headers()['authorization'] ?? ''; try { return JSON.parse(Buffer.from(a.split(' ')[1].split('.')[1], 'base64url').toString()).sub; } catch { return null; } };

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    if (st.offline) return route.abort('internetdisconnected');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const p = url.pathname;
    const who = userFrom(route);
    if (p.startsWith('/auth/v1/')) return json({ user: null }, 200);
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.split('/').pop();
      const a = st.bodyOf(req);
      st.calls.push({ fn, who, args: a });
      if (fn === 'record_score_event') { st.delivered.set(a.p_id, (st.delivered.get(a.p_id) ?? 0) + 1); return json(true); }
      if (fn === 'submit_match_result') {
        if (st.submit === 'error500') return json({ code: 'XX000', message: 'boom' }, 500);
        const m = st.matches[0];
        if (st.commands.has(a.p_command)) return json({ ...st.commands.get(a.p_command), repeat: true });   // the server de-duplicates on the command id
        if (st.submit === 'accepted') {
          m.queue_state = 'final'; m.result = a.p_result; m.score_a = a.p_score_a; m.score_b = a.p_score_b; m.version += 1; st.applied += 1;
          const reply = { status: 'accepted', version: m.version };
          st.commands.set(a.p_command, reply);
          if (st.dropReplyOnce) { st.dropReplyOnce = false; return route.abort('connectionreset'); }   // the server did the work, the phone never heard back
          return json(reply);
        }
        if (st.submit === 'conflict') { st.conflicts.push({ proposal_id: a.p_command, match_id: a.p_match, competition_name: 'Longsword', round_label: 'Round 1', side_a: 'Iron Wolves', side_b: 'Ash Guard', official_result: 'b', official_score_a: 1, official_score_b: 4, proposed_result: a.p_result, proposed_score_a: a.p_score_a, proposed_score_b: a.p_score_b, proposed_detail: {}, proposed_by_name: 'Scorer A', created_at: new Date().toISOString() }); return json({ status: 'conflict', version: m.version }); }
        return json({ status: 'stale', version: m.version + 1 });
      }
      if (fn === 'set_match_queue') return json(null);
      if (fn === 'list_result_conflicts') return json(st.conflicts);
      if (fn === 'resolve_result_conflict') { st.resolved.push(a); st.conflicts = st.conflicts.filter(c => c.proposal_id !== a.p_proposal); return json(null); }
      if (fn === 'enter_official_result') { st.paper.push(a); return json({ status: 'entered', version: 9 }); }
      return json(null);
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/').pop();
      const q = url.searchParams;
      if (table === 'events') return json(q.get('slug') === 'eq.test-rumble' ? [event] : [event]);
      if (table === 'competitions') return json([comp]);
      if (table === 'event_staff') return json((st.roles[who] ?? []).map(role => ({ role })));
      if (table === 'matches') return json(st.matches);
      if (table === 'profiles') return json([{ display_name: 'Test Person' }]);
      return json([]);
    }
    return route.continue();
  }
  return { st, handle, event, comp };
}
