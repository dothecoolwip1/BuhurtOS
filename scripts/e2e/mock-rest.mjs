/**
 * A small in-memory stand-in for the parts of Supabase the Pack 07 screens use (PostgREST reads with embeds and filters, a few RPCs,
 * Storage uploads and public URLs). It is a TEST DOUBLE that proves how the built app behaves in a real browser at phone size; it proves
 * nothing about the real database, which supabase/tests/*.sql covers. Nothing here ever talks to a hosted project.
 */
export const REF = 'mvbxlebznlgroptwwdsm';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const jwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: 4102444800 })}.sig`;
export const sessionFor = (id, email) => ({
  access_token: jwt(id), refresh_token: 'r-' + id, token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: 4102444800,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
});
export const storageKey = `sb-${REF}-auth-token`;

const U = (n) => `00000000-0000-0000-0000-0000000000${n}`;
export const IDS = {
  owner: U('a1'), organizer: U('a2'), fighter: U('a3'), stranger: U('a4'), captain: U('a8'),
  rumble: '00000000-0000-0000-0000-0000000e0001', fake: '00000000-0000-0000-0000-0000000e0009', spring: '00000000-0000-0000-0000-0000000e0002', other: '00000000-0000-0000-0000-0000000e0003',
  c1: '00000000-0000-0000-0000-0000000c0001', c2: '00000000-0000-0000-0000-0000000c0002', c9: '00000000-0000-0000-0000-0000000c0009', cs: '00000000-0000-0000-0000-0000000c0002',
  f3: '00000000-0000-0000-0000-0000000f0003', f7: '00000000-0000-0000-0000-0000000f0007', f9: '00000000-0000-0000-0000-0000000f0009', f9b: '00000000-0000-0000-0000-0000000f0010', f9c: '00000000-0000-0000-0000-0000000f0011',
  t1: '00000000-0000-0000-0000-0000000d0001', w1: '00000000-0000-0000-0000-0000000a0001', org: '00000000-0000-0000-0000-0000000b0001'
};
const today = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
const plus = (days) => iso(new Date(today.getTime() + days * 86400000));
let seq = 0; const uid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`;

export function createMock() {
  const db = {
    events: [
      { id: IDS.rumble, slug: 'red-deer-rumble', name: 'Red Deer Rumble', description: 'The big one.', event_type: 'tournament', status: 'published', venue: 'Horse In Hand Ranch', address: null, city: 'Blackfalds', region: 'AB', country: 'CA', latitude: null, longitude: null, starts_on: plus(20), ends_on: plus(21), fee_cents: 0, fee_province: null, fee_note: null, registration_opens_at: null, registration_closes_at: null, registration_mode: 'buhuros', external_url: null, time_note: null, volunteer_info: null, organization_id: IDS.org, season_id: null },
      { id: IDS.fake, slug: 'central-alberta-steel-open-test', name: 'Central Alberta Steel Open-test', description: '', event_type: 'tournament', status: 'published', venue: null, address: null, city: 'Red Deer', region: 'AB', country: 'CA', latitude: null, longitude: null, starts_on: plus(-40), ends_on: plus(-39), fee_cents: 0, fee_province: null, fee_note: null, registration_opens_at: null, registration_closes_at: null, registration_mode: 'buhuros', external_url: null, time_note: null, volunteer_info: null, organization_id: null, season_id: null },
      { id: IDS.spring, slug: 'spring-open', name: 'Spring Open', description: '', event_type: 'tournament', status: 'published', venue: 'Arena', address: null, city: 'Calgary', region: 'AB', country: 'CA', latitude: null, longitude: null, starts_on: plus(-90), ends_on: plus(-90), fee_cents: 0, fee_province: null, fee_note: null, registration_opens_at: null, registration_closes_at: null, registration_mode: 'buhuros', external_url: null, time_note: null, volunteer_info: null, organization_id: IDS.org, season_id: null },
      { id: IDS.other, slug: 'saskatoon-clinic', name: 'Saskatoon Clinic', description: '', event_type: 'clinic', status: 'published', venue: null, address: null, city: 'Saskatoon', region: 'SK', country: 'CA', latitude: null, longitude: null, starts_on: plus(45), ends_on: plus(45), fee_cents: 0, fee_province: null, fee_note: null, registration_opens_at: null, registration_closes_at: null, registration_mode: 'none', external_url: null, time_note: null, volunteer_info: null, organization_id: null, season_id: null }
    ],
    competitions: [
      { id: IDS.c1, event_id: IDS.rumble, name: 'Longsword (men)', category: 'longsword', gender: 'men', tier: 'Classic', ruleset: 'Duels V.26.4', structure: 'round_robin', rounds_to_win: null, sort: 1, status: 'setup' },
      { id: IDS.c2, event_id: IDS.rumble, name: 'Melee 5v5 (men)', category: '5v5', gender: 'men', tier: 'Classic', ruleset: null, structure: 'pools_elimination', rounds_to_win: 2, sort: 2, status: 'setup' },
      { id: IDS.c9, event_id: IDS.fake, name: 'Fake Longsword (men)', category: 'longsword', gender: 'men', tier: 'Classic', ruleset: null, structure: 'round_robin', rounds_to_win: null, sort: 1, status: 'finished' }
    ],
    ref_categories: [{ code: '5v5', name: '5v5', league: 'buhurt', sort: 11 }, { code: 'longsword', name: 'Longsword', league: 'duels', sort: 22 }, { code: 'sabre', name: 'Sabre', league: 'hacsa', sort: 40 }],
    ref_tiers: [{ name: 'Exhibition', sort: 0 }, { name: 'Classic', sort: 2 }],
    organizations: [{ id: IDS.org, slug: 'hacsa', name: 'HACSA', short_name: null, enabled: true, kind: 'federation', country: 'CA', region: 'AB', website: null, description: null }],
    seasons: [],
    synthetic_records: [{ entity_type: 'event', entity_id: IDS.fake, slug: 'central-alberta-steel-open-test' }, { entity_type: 'fighter', entity_id: IDS.f9, slug: null }],
    fighters: [
      { id: IDS.f3, display_name: 'Garrett Robson', team_id: IDS.t1, gender: 'male', city: 'Red Deer', region: 'AB', disciplines: ['longsword'], social_links: {}, avatar_path: null },
      { id: IDS.f7, display_name: 'Dana Steel', team_id: null, gender: 'female', city: null, region: 'AB', disciplines: [], social_links: {}, avatar_path: null },
      { id: IDS.f9, display_name: 'Fake Fighter', team_id: null, gender: 'male', city: null, region: null, disciplines: [], social_links: {}, avatar_path: null },
      { id: IDS.f9b, display_name: 'Fake Second', team_id: null, gender: 'male', city: null, region: null, disciplines: [], social_links: {}, avatar_path: null },
      { id: IDS.f9c, display_name: 'Fake Third', team_id: null, gender: 'male', city: null, region: null, disciplines: [], social_links: {}, avatar_path: null }
    ],
    fighter_accounts: { [IDS.f3]: IDS.fighter },
    teams: [{ id: IDS.t1, slug: 'red-deer-reavers', name: 'Red Deer Reavers', city: 'Red Deer', region: 'AB', country: 'CA', status: 'approved', colors: ['#2C4A8C', '#E9ECEF'], crest_division: 'pale', initial: 'R', emblem_path: null, description: 'A club in Red Deer that trains hard.', website: null, social_links: {}, founded_year: 2019, claimed_organizations: [] }],
    team_affiliations: [], record_sources: [], team_memberships: [], team_roles: [{ team_id: IDS.t1, user_id: IDS.captain, role: 'captain' }],
    entries: [
      { id: '00000000-0000-0000-0000-0000000e9a01', competition_id: IDS.c9, team_id: null, fighter_id: IDS.f9, status: 'registered' },
      { id: '00000000-0000-0000-0000-0000000e9a02', competition_id: IDS.c9, team_id: null, fighter_id: IDS.f9b, status: 'registered' },
      { id: '00000000-0000-0000-0000-0000000e9a03', competition_id: IDS.c9, team_id: null, fighter_id: IDS.f9c, status: 'registered' }
    ],
    entry_fighters: [],
    fighter_participation: [{ event_id: IDS.fake, fighter_id: IDS.f9, entry_id: '00000000-0000-0000-0000-0000000e9a01' }, { event_id: IDS.fake, fighter_id: IDS.f9b, entry_id: '00000000-0000-0000-0000-0000000e9a02' }, { event_id: IDS.fake, fighter_id: IDS.f9c, entry_id: '00000000-0000-0000-0000-0000000e9a03' }],
    result_rows_all: [1, 2, 3].map(n => ({ competition_id: IDS.c9, competition_name: 'Fake Longsword (men)', category: 'longsword', gender: 'men', entry_id: `00000000-0000-0000-0000-0000000e9a0${n}`, final_place: n, points: [20, 15, 12][n - 1], team_id: null, entry_fighter_id: [IDS.f9, IDS.f9b, IDS.f9c][n - 1], event_id: IDS.fake, event_slug: 'central-alberta-steel-open-test', event_name: 'Central Alberta Steel Open-test', event_type: 'tournament', starts_on: plus(-40), event_ends_on: plus(-39), season_id: null, organization_id: null, synthetic: true, team_name_at_event: null, team_current_name: null, tier: 'Classic', structure: 'round_robin' })),
    result_rows: [],   // the official view: the fictional event never appears
    fighter_results_all: [], ranking_fighters: [], fighter_career_stats: [], fighter_match_stats: [], fighter_season_stats: [], fighter_match_rows: [], match_sides: [], team_stats: [], ranking_teams: [], team_results_all: [], matches: [],
    waiver_versions: [{ id: IDS.w1, event_id: IDS.rumble, version: 1, title: 'Waiver and release', body: 'The full waiver text of the Red Deer Rumble, which is long enough for the test.', kind: 'text', document_path: null, source: 'pasted', created_at: '2026-09-01T00:00:00Z' }],
    event_staff: [{ event_id: IDS.rumble, user_id: IDS.organizer, role: 'organizer' }, { event_id: IDS.spring, user_id: IDS.organizer, role: 'organizer' }],
    platform_roles: { [IDS.owner]: ['owner'], [IDS.organizer]: ['organizer'] },
    registrations: [], registration_competitions: [], registration_private: [], registration_checks: [],
    event_invitations: [], event_invitation_competitions: [],
    notifications: [], fighter_gallery: [], profiles: [[IDS.fighter, 'Garrett Robson'], [IDS.organizer, 'Orla Organizer'], [IDS.owner, 'The Owner'], [IDS.captain, 'Cap Tain'], [IDS.stranger, 'Someone Else']].map(([id, display_name]) => ({ id, display_name, interests: ['fighter'], city: null, region: null, country: null, onboarded_at: '2026-01-01T00:00:00Z' })),
    organization_staff: [], audit_log: []
  };
  const storage = new Map();   // "bucket/path" -> { type, bytes }
  const st = { calls: [], uploads: [], offline: false, db, storage };
  const isOrganizer = (who, eventId) => who === IDS.owner || db.event_staff.some(s => s.event_id === eventId && s.user_id === who && s.role === 'organizer');
  const myFighter = (who) => Object.entries(db.fighter_accounts).find(([, u]) => u === who)?.[0] ?? null;
  const fail = (code, message, status = 400) => ({ error: { code, message, details: null, hint: null }, status });

  // ---------------------------------------------------------------- embeds (which tables hang off which)
  const REL = {
    events: { competitions: (r) => db.competitions.filter(c => c.event_id === r.id) },
    competitions: { ref_categories: (r) => db.ref_categories.find(c => c.code === r.category) ?? null, events: (r) => db.events.find(e => e.id === r.event_id) ?? null, entries: (r) => db.entries.filter(e => e.competition_id === r.id) },
    entries: { teams: (r) => db.teams.find(t => t.id === r.team_id) ?? null, fighters: (r) => db.fighters.find(f => f.id === r.fighter_id) ?? null, competitions: (r) => db.competitions.find(c => c.id === r.competition_id) ?? null },
    entry_fighters: { entries: (r) => db.entries.find(e => e.id === r.entry_id) ?? null },
    fighters: { teams: (r) => db.teams.find(t => t.id === r.team_id) ?? null },
    team_roles: { teams: (r) => db.teams.find(t => t.id === r.team_id) ?? null },
    team_memberships: { teams: (r) => db.teams.find(t => t.id === r.team_id) ?? null },
    team_affiliations: { organizations: (r) => db.organizations.find(o => o.id === r.organization_id) ?? null },
    record_sources: { sources: () => null },
    registrations: { teams: (r) => db.teams.find(t => t.id === r.team_id) ?? null, registration_private: (r) => db.registration_private.filter(p => p.registration_id === r.id), registration_competitions: (r) => db.registration_competitions.filter(c => c.registration_id === r.id), registration_checks: (r) => db.registration_checks.filter(c => c.registration_id === r.id) },
    registration_competitions: { competitions: (r) => db.competitions.find(c => c.id === r.competition_id) ?? null },
    event_invitations: { event_invitation_competitions: (r) => db.event_invitation_competitions.filter(c => c.invitation_id === r.id) },
    event_invitation_competitions: { competitions: (r) => db.competitions.find(c => c.id === r.competition_id) ?? null }
  };
  // "id,name,competitions(ref_categories(league)),entries(count)" -> [{name, alias, inner, children}]
  function parseSelect(s) {
    const out = []; let depth = 0, cur = '';
    const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
    for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { push(); continue; } cur += ch; }
    push();
    return out.map(item => {
      const m = /^(?:([a-z_]+):)?([a-z_]+)(!inner)?(?:\((.*)\))?$/s.exec(item);
      if (!m) return { name: item, alias: item, inner: false, children: null };
      return { name: m[2], alias: m[1] ?? m[2], inner: Boolean(m[3]), children: m[4] !== undefined ? parseSelect(m[4]) : null };
    });
  }
  function project(table, row, fields) {
    if (!fields || (fields.length === 1 && fields[0].name === '*' && !fields[0].children)) return { ...row };
    const out = {};
    for (const f of fields) {
      if (f.name === '*') { Object.assign(out, row); continue; }
      if (f.children) {
        const rel = REL[table]?.[f.name];
        const v = rel ? rel(row) : null;
        if (f.children.length === 1 && f.children[0].name === 'count') { out[f.alias] = [{ count: Array.isArray(v) ? v.length : v ? 1 : 0 }]; continue; }
        out[f.alias] = Array.isArray(v) ? v.map(x => project(f.name, x, f.children)) : v ? project(f.name, v, f.children) : null;
      } else out[f.alias] = row[f.name] === undefined ? null : row[f.name];
    }
    return out;
  }
  const matchOp = (val, op) => {
    const [kind, ...rest] = op.split('.'); const arg = rest.join('.');
    if (kind === 'eq') return String(val) === arg;
    if (kind === 'neq') return String(val) !== arg;
    if (kind === 'is') return arg === 'null' ? val === null || val === undefined : String(val) === arg;
    if (kind === 'in') return arg.slice(1, -1).split(',').map(x => x.replace(/^"|"$/g, '')).includes(String(val));
    if (kind === 'ilike') { const re = new RegExp('^' + arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i'); return re.test(String(val ?? '')); }
    if (kind === 'cs') { try { const want = JSON.parse(arg.replace(/^\{/, '[').replace(/\}$/, ']')); return want.every(w => (val ?? []).includes(w)); } catch { return false; } }
    if (kind === 'gte') return String(val) >= arg; if (kind === 'lte') return String(val) <= arg; if (kind === 'gt') return String(val) > arg; if (kind === 'lt') return String(val) < arg;
    return true;
  };
  function read(table, q, who) {
    let rows = Array.isArray(db[table]) ? [...db[table]] : [];
    // visibility that matters for the tests: own rows only
    if (table === 'event_staff') rows = rows.filter(r => r.user_id === who);
    if (table === 'platform_roles') rows = (db.platform_roles[who] ?? []).map(role => ({ user_id: who, role }));
    if (table === 'team_roles') rows = rows.filter(r => r.user_id === who);
    if (table === 'registrations') rows = rows.filter(r => r.user_id === who || isOrganizer(who, r.event_id));
    if (table === 'event_invitations') rows = rows.filter(r => isOrganizer(who, r.event_id) || r.fighter_id === myFighter(who));
    if (table === 'events') rows = rows.filter(r => r.status === 'published' || db.event_staff.some(s => s.event_id === r.id && s.user_id === who) || who === IDS.owner);
    if (table === 'profiles') rows = rows.filter(r => r.id === who);
    const fields = parseSelect(q.get('select') ?? '*');
    for (const [k, v] of q.entries()) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (k.includes('.')) { const [emb, col] = k.split('.'); rows = rows.filter(r => { const rel = REL[table]?.[emb]; const v2 = rel ? rel(r) : null; const list = Array.isArray(v2) ? v2 : v2 ? [v2] : []; return list.some(x => matchOp(x[col], v)); }); continue; }
      rows = rows.filter(r => matchOp(r[k], v));
    }
    for (const f of fields) if (f.inner) rows = rows.filter(r => { const v = REL[table]?.[f.name]?.(r); return Array.isArray(v) ? v.length > 0 : Boolean(v); });
    const order = q.get('order');
    if (order) for (const part of order.split(',').reverse()) { const [col, dir] = part.split('.'); rows.sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
    const total = rows.length;
    const offset = Number(q.get('offset') ?? 0); const limit = q.get('limit') ? Number(q.get('limit')) : undefined;
    rows = rows.slice(offset, limit !== undefined ? offset + limit : undefined);
    return { rows: rows.map(r => project(table, r, fields)), total };
  }

  // ---------------------------------------------------------------- rpc
  function rpc(fn, a, who) {
    const ev = (id) => db.events.find(e => e.id === id);
    switch (fn) {
      case 'my_fighter_id': return myFighter(who);
      case 'my_notifications': return db.notifications.filter(n => n.user_id === who).sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, a.p_limit ?? 50).map(({ user_id: _u, ...n }) => n);
      case 'mark_notifications_read': { let n = 0; for (const x of db.notifications) if (x.user_id === who && !x.read_at && (!a.p_ids || a.p_ids.includes(x.id))) { x.read_at = new Date().toISOString(); n++; } return n; }
      case 'my_event_relations': {
        const out = []; const fid = myFighter(who);
        for (const s of db.event_staff) if (s.user_id === who) out.push({ event_id: s.event_id, role: s.role });
        for (const r of db.registrations) if (r.user_id === who && ['pending', 'accepted'].includes(r.status)) out.push({ event_id: r.event_id, role: r.is_volunteer ? 'volunteer' : 'fighter' });
        for (const i of db.event_invitations) if (fid && i.fighter_id === fid && i.status === 'invited') out.push({ event_id: i.event_id, role: 'invited' });
        for (const tr of db.team_roles) if (tr.user_id === who) for (const e of db.entries) if (e.team_id === tr.team_id) out.push({ event_id: db.competitions.find(c => c.id === e.competition_id)?.event_id, role: 'captain' });
        return out;
      }
      case 'my_team_ids': return db.team_roles.filter(r => r.user_id === who).map(r => r.team_id);
      case 'can_edit_team': return db.team_roles.some(r => r.user_id === who && r.team_id === a.p_team) || who === IDS.owner;
      case 'can_rename_team': return who === IDS.owner;
      case 'team_roster': return [];
      case 'my_event_entries': return [];
      case 'team_clearance': return [];
      case 'list_event_staff': return db.event_staff.filter(s => s.event_id === a.p_event).map(s => ({ user_id: s.user_id, email: 'x@example.test', role: s.role }));
      case 'fighter_profile': { const f = db.fighters.find(x => x.id === a.p_fighter); if (!f) return []; const t = db.teams.find(x => x.id === f.team_id); return [{ fighter_id: f.id, display_name: f.display_name, gender: f.gender, birth_year: null, age: null, city: f.city, region: f.region, country: null, joined_year: null, disciplines: f.disciplines, fighting_style: null, bio: null, highlights: [], team_id: t?.id ?? null, team_name: t?.name ?? null, team_slug: t?.slug ?? null, team_organization_id: null, team_organization_slug: null, team_organization_name: null, team_organization_enabled: null, avatar_path: f.avatar_path }]; }
      case 'update_my_fighter_profile': { const fid = myFighter(who); if (!fid) return fail('42501', 'you have no fighter profile yet'); const f = db.fighters.find(x => x.id === fid); for (const [k, v] of Object.entries(a.p)) { if (k === 'social_links') { for (const [n, u] of Object.entries(v)) if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(u)) return fail('22023', `the ${n} link must be a full https:// address`); f.social_links = v; } else f[k] = v; } return null; }
      case 'update_team_profile': { if (!db.team_roles.some(r => r.user_id === who && r.team_id === a.p_team)) return fail('42501', 'only the team captain or an organizer can edit this team'); const t = db.teams.find(x => x.id === a.p_team); for (const [k, v] of Object.entries(a.p)) { if (k === 'social_links') for (const [n, u] of Object.entries(v)) if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(u)) return fail('22023', `the ${n} link must be a full https:// address`); t[k] = v; } return null; }
      case 'create_event': { if (!['owner', 'organizer'].some(r => (db.platform_roles[who] ?? []).includes(r))) return fail('42501', 'only approved organizers can create events'); const id = uid(); db.events.push({ id, slug: a.p_slug, name: a.p_name, description: '', event_type: 'tournament', status: 'draft', venue: a.p_venue, address: a.p_address, city: null, region: null, country: null, latitude: null, longitude: null, starts_on: a.p_starts_on, ends_on: a.p_ends_on, fee_cents: 0, fee_province: null, fee_note: null, registration_opens_at: null, registration_closes_at: null, registration_mode: 'buhuros', external_url: null, time_note: null, volunteer_info: null, organization_id: null, season_id: null }); db.event_staff.push({ event_id: id, user_id: who, role: 'organizer' }); return id; }
      case 'add_waiver_version': { if (!isOrganizer(who, a.p_event)) return fail('42501', 'only an organizer of this event can change its waiver'); if (a.p_kind === 'text' && (a.p_body ?? '').length < 20) return fail('22023', 'paste the full waiver text (at least 20 characters)'); if (a.p_kind === 'pdf' && !storage.has(`waiver-documents/${a.p_document_path}`)) return fail('22023', 'the waiver document was not uploaded'); const v = Math.max(0, ...db.waiver_versions.filter(w => w.event_id === a.p_event).map(w => w.version)) + 1; const id = uid(); db.waiver_versions.push({ id, event_id: a.p_event, version: v, title: a.p_title, body: a.p_body, kind: a.p_kind, document_path: a.p_document_path, source: a.p_source, created_at: new Date().toISOString() }); return id; }
      case 'list_event_invitations': return isOrganizer(who, a.p_event) ? db.event_invitations.filter(i => i.event_id === a.p_event).map(i => { const f = db.fighters.find(x => x.id === i.fighter_id); const reg = db.registrations.find(r => r.id === i.registration_id); return { invitation_id: i.id, fighter_id: i.fighter_id, display_name: f.display_name, team_name: db.teams.find(t => t.id === f.team_id)?.name ?? null, status: i.status, has_account: Boolean(db.fighter_accounts[i.fighter_id]), note: i.note, competitions: db.event_invitation_competitions.filter(c => c.invitation_id === i.id).map(c => ({ id: c.competition_id, name: db.competitions.find(x => x.id === c.competition_id)?.name })), registration_id: i.registration_id, registration_status: reg?.status ?? null, created_at: i.created_at, decided_at: i.decided_at }; }) : [];
      case 'invite_fighter_to_event': {
        if (!isOrganizer(who, a.p_event)) return fail('42501', 'only an organizer of this event can add fighters');
        if (!a.p_competitions?.length) return fail('22023', 'choose at least one competition');
        if (db.event_invitations.some(i => i.event_id === a.p_event && i.fighter_id === a.p_fighter && i.status === 'invited')) return fail('22023', 'this fighter has already been added and is still pending');
        const id = uid(); db.event_invitations.push({ id, event_id: a.p_event, fighter_id: a.p_fighter, status: 'invited', note: a.p_note ?? null, registration_id: null, created_at: new Date().toISOString(), decided_at: null });
        for (const c of a.p_competitions) db.event_invitation_competitions.push({ invitation_id: id, competition_id: c });
        const user = db.fighter_accounts[a.p_fighter] ?? null;
        if (user) db.notifications.push({ id: uid(), user_id: user, kind: 'event_invited', payload: { invitation_id: id, event_name: ev(a.p_event).name, event_slug: ev(a.p_event).slug, competitions: a.p_competitions.map(c => db.competitions.find(x => x.id === c)?.name).join(', '), note: a.p_note ?? null }, created_at: new Date().toISOString(), read_at: null });
        return { invitation_id: id, notified: Boolean(user) };
      }
      case 'cancel_invitation': { const i = db.event_invitations.find(x => x.id === a.p_invitation); if (!i || !isOrganizer(who, i.event_id)) return fail('42501', 'only an organizer of this event can cancel this'); i.status = 'cancelled'; i.decided_at = new Date().toISOString(); return null; }
      case 'withdraw_my_invitation': { const i = db.event_invitations.find(x => x.id === a.p_invitation); if (!i || i.fighter_id !== myFighter(who)) return fail('42501', 'only the fighter who was added can withdraw'); if (i.status !== 'invited') return fail('22023', 'this invitation is no longer pending'); i.status = 'withdrawn'; i.decided_at = new Date().toISOString(); for (const u of db.event_staff.filter(s => s.event_id === i.event_id && s.role === 'organizer')) db.notifications.push({ id: uid(), user_id: u.user_id, kind: 'registration_withdrawn', payload: { event_name: ev(i.event_id).name, event_slug: ev(i.event_id).slug, person_name: db.fighters.find(f => f.id === i.fighter_id).display_name }, created_at: new Date().toISOString(), read_at: null }); return null; }
      case 'withdraw_registration': { const r = db.registrations.find(x => x.id === a.p_reg); if (!r || (r.user_id !== who && !isOrganizer(who, r.event_id))) return fail('42501', 'only the person who registered, or an organizer, can withdraw it'); r.status = 'withdrawn'; for (const i of db.event_invitations) if (i.registration_id === r.id) i.status = 'withdrawn'; return null; }
      case 'submit_registration': {
        const e = ev(a.p_event); if (!e || e.status !== 'published') return fail('P0002', 'this event is not open for registration');
        if (!a.p_data.waiver_agree) return fail('22023', 'the waiver must be accepted to take part');
        const fid = myFighter(who); const inv = db.event_invitations.find(i => i.event_id === a.p_event && i.fighter_id === fid && i.status === 'invited');
        const id = uid(); db.registrations.push({ id, event_id: a.p_event, user_id: who, fighter_id: fid, status: inv ? 'accepted' : 'pending', full_name: a.p_data.full_name, gender: a.p_data.gender, organization: a.p_data.organization, province: a.p_data.province, team_id: a.p_data.team_id, team_name: null, shares_equipment: false, days: a.p_data.days, availability_notes: null, bi_profile: null, insurance: a.p_data.insurance, is_volunteer: Boolean(a.p_data.is_volunteer), volunteer_roles: [], mercenary: false, notes: null, fee_due_cents: 0, fee_paid: false, waiver_version_id: a.p_data.waiver_version_id, waiver_signed_name: a.p_data.waiver_signed_name, created_at: new Date().toISOString() });
        for (const c of a.p_data.competitions ?? []) db.registration_competitions.push({ registration_id: id, competition_id: c.competition_id, team_id: c.team_id, details: c.details ?? {} });
        db.registration_private.push({ registration_id: id, email: a.p_data.private?.email ?? '', emergency_name: a.p_data.private?.emergency_name, emergency_relationship: '', emergency_phone: a.p_data.private?.emergency_phone, medical_note: null });
        if (inv) { inv.status = 'registered'; inv.registration_id = id; for (const n of db.notifications) if (n.kind === 'event_invited' && n.payload.invitation_id === inv.id) n.read_at = new Date().toISOString(); }
        return id;
      }
      case 'decide_registration': { const r = db.registrations.find(x => x.id === a.p_reg); if (!r || !isOrganizer(who, r.event_id)) return fail('42501', 'only an organizer can decide registrations'); r.status = a.p_status; return null; }
      case 'add_my_gallery_photo': { const fid = myFighter(who); if (!fid) return fail('42501', 'you have no fighter profile yet'); if (!a.p_path.startsWith(fid + '/')) return fail('42501', 'that photo is not in your folder'); if (!storage.has(`fighter-gallery/${a.p_path}`)) return fail('22023', 'the photo was not uploaded'); if (db.fighter_gallery.filter(g => g.fighter_id === fid).length >= 10) return fail('22023', 'a gallery holds at most 10 photos'); const id = uid(); db.fighter_gallery.push({ id, fighter_id: fid, storage_path: a.p_path, sort_order: db.fighter_gallery.filter(g => g.fighter_id === fid).length, created_at: new Date().toISOString() }); return id; }
      case 'remove_my_gallery_photo': { const fid = myFighter(who); const i = db.fighter_gallery.findIndex(g => g.id === a.p_id && g.fighter_id === fid); if (i < 0) return fail('42501', 'that photo is not in your gallery'); const [g] = db.fighter_gallery.splice(i, 1); return g.storage_path; }
      case 'reorder_my_gallery': { const fid = myFighter(who); const mine = db.fighter_gallery.filter(g => g.fighter_id === fid); if (a.p_ids.length !== mine.length || !a.p_ids.every(id => mine.some(g => g.id === id))) return fail('22023', 'the order must list each of your photos once'); a.p_ids.forEach((id, n) => { mine.find(g => g.id === id).sort_order = n; }); return null; }
      case 'set_my_fighter_avatar': { const fid = myFighter(who); db.fighters.find(f => f.id === fid).avatar_path = a.p_path; return null; }
      default: return null;
    }
  }

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    if (st.offline) return route.abort('internetdisconnected');
    const H = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
    const json = (body, status = 200, extra = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...H, ...extra }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...H, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const p = url.pathname; const headers = req.headers();
    const who = (() => { const auth = headers['authorization'] ?? ''; try { return JSON.parse(Buffer.from(auth.split(' ')[1].split('.')[1], 'base64url').toString()).sub; } catch { return null; } })();
    if (p.startsWith('/auth/v1/')) return json({ user: null }, 200);
    if (p.startsWith('/storage/v1/')) {
      const parts = p.replace('/storage/v1/', '').split('/');
      if (parts[0] === 'object' && parts[1] === 'public') { const key = parts.slice(2).join('/'); const o = storage.get(key); return o ? route.fulfill({ status: 200, headers: { ...H, 'content-type': o.type }, body: o.bytes }) : route.fulfill({ status: 404, headers: H, body: 'missing' }); }
      if (parts[0] === 'object' && parts[1] === 'sign' && req.method() === 'POST') { return json({ signedURL: `/object/sign/${parts.slice(2).join('/')}?token=t` }); }
      if (parts[0] === 'object' && req.method() === 'POST') {
        const bucket = parts[1]; const path = parts.slice(2).join('/');
        const fid = myFighter(who);
        if (bucket === 'fighter-gallery' && !path.startsWith(`${fid}/`)) return json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 403);
        if (bucket === 'waiver-documents' && !isOrganizer(who, path.split('/')[0])) return json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 403);
        // supabase-js sends the file as one multipart part; keep its real type and bytes so public URLs serve a real image back.
        let type = headers['content-type'] ?? 'application/octet-stream'; let bytes = req.postDataBuffer() ?? Buffer.alloc(0);
        if (/^multipart\/form-data/i.test(type)) {
          const text = bytes.toString('latin1');
          const tm = /content-type:\s*([^\r\n;]+)/i.exec(text);
          const start = text.indexOf('\r\n\r\n'); const end = text.lastIndexOf('\r\n--');
          if (tm && start >= 0 && end > start) { type = tm[1].trim(); bytes = bytes.slice(start + 4, end); }
        }
        storage.set(`${bucket}/${path}`, { type, bytes });
        st.uploads.push({ bucket, path, who, type, size: bytes.length });
        return json({ Key: `${bucket}/${path}`, Id: uid() });
      }
      if (parts[0] === 'object' && req.method() === 'DELETE') { const bucket = parts[1]; let body = {}; try { body = JSON.parse(req.postData() ?? '{}'); } catch { /* none */ } for (const pr of body.prefixes ?? []) storage.delete(`${bucket}/${pr}`); return json([]); }
      return json([]);
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.split('/').pop(); let a = {}; try { a = JSON.parse(req.postData() ?? '{}'); } catch { /* none */ }
      st.calls.push({ fn, who, args: a });
      const r = rpc(fn, a, who);
      if (r && typeof r === 'object' && 'error' in r && 'status' in r) return json(r.error, r.status);
      return json(r ?? null);
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/').pop(); const q = url.searchParams; const method = req.method();
      const single = (headers['accept'] ?? '').includes('vnd.pgrst.object');
      st.calls.push({ table, method, who, q: q.toString() });
      if (method === 'GET' || method === 'HEAD') {
        const { rows, total } = read(table, q, who);
        const extra = { 'content-range': `0-${Math.max(0, rows.length - 1)}/${total}` };
        if (single) return rows.length ? json(rows[0], 200, extra) : json({ code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, 406, extra);
        return method === 'HEAD' ? route.fulfill({ status: 200, headers: { ...H, ...extra, 'content-type': 'application/json' }, body: '' }) : json(rows, 200, extra);
      }
      let body = {}; try { body = JSON.parse(req.postData() ?? '{}'); } catch { /* none */ }
      if (method === 'POST' && table === 'competitions') {
        if (!isOrganizer(who, body.event_id)) return json({ code: '42501', message: 'new row violates row-level security policy for table "competitions"' }, 403);
        const row = { id: uid(), status: 'setup', ...body }; db.competitions.push(row); return json(single ? row : [row], 201);
      }
      if (method === 'PATCH' && table === 'events') {
        const rows = db.events.filter(e => matchOp(e.id, q.get('id') ?? 'eq.none') && isOrganizer(who, e.id));
        for (const e of rows) Object.assign(e, body);
        return json(rows.map(e => ({ id: e.id })));
      }
      if (method === 'PATCH' && table === 'competitions') { const rows = db.competitions.filter(c => matchOp(c.id, q.get('id') ?? 'eq.none') && isOrganizer(who, c.event_id)); for (const c of rows) Object.assign(c, body); return json(rows.map(c => ({ id: c.id }))); }
      if (method === 'DELETE' && table === 'competitions') {
        const rows = db.competitions.filter(c => matchOp(c.id, q.get('id') ?? 'eq.none') && isOrganizer(who, c.event_id));
        if (rows.some(c => db.entries.some(e => e.competition_id === c.id))) return json({ code: '22023', message: 'this competition already has entrants, matches, results or registrations; it cannot be deleted' }, 400);
        db.competitions = db.competitions.filter(c => !rows.includes(c)); return json(rows.map(c => ({ id: c.id })));
      }
      return json([]);
    }
    return route.continue();
  }
  return { st, handle, db };
}

/** A real PNG (solid colour), made here so createImageBitmap and the canvas pipeline run for real in the browser. */
import zlib from 'node:zlib';
export function makePng(width = 64, height = 48, rgb = [200, 60, 40]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; for (let x = 0; x < width; x++) { const o = y * (width * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const TINY_PNG = makePng();
