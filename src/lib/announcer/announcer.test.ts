import { describe, expect, it } from 'vitest';
import type { CompetitionMatch } from '../../data/matches';
import type { LystPublic } from '../../data/lyst';
import type { CareerLine } from '../../data/careerProfile';
import type { SideSource } from '../broadcast/sides';
import {
  COMING_LIMIT, RECENT_LIMIT, basisOf, buildAnnouncerView, lystLabel, orderLysts, phaseWord, resolveFocus, slotWord,
  type AnnouncerInput, type AnnFight
} from './viewModel';
import { STALE_AFTER_MS, formatHms, latest, staleLine, staleness } from './stale';
import { focusStorageKey, loadFocus, saveFocus } from './focus';
import { buildEntryInfo, careerTotal, earlierFights } from './info';

const m = (n: number, over: Partial<CompetitionMatch> = {}): CompetitionMatch => ({
  id: `m${String(n).padStart(3, '0')}`, competitionId: 'ls', stage: 'round_robin', roundLabel: 'Round 1', position: n, pool: null, field: 'Field 1', scheduledAt: null, queueState: 'scheduled',
  entryA: `e${n}a`, entryB: `e${n}b`, nameA: `Fighter ${n}A`, nameB: `Fighter ${n}B`, nextMatchId: null, nextSlot: null, result: null, winnerEntryId: null,
  scoreA: null, scoreB: null, detail: {}, version: 0, finalizedAt: null, queueOrder: null, ...over
});
const COMPS = [{ id: 'ls', name: 'Longsword (men)', sort: 1 }, { id: 'ss', name: 'Sword and shield', sort: 2 }];
const lyst = (id: string, over: Partial<LystPublic> = {}): LystPublic => ({
  match_id: id, event_id: 'ev', field_key: 'field 1', queue_state: 'active', timer_mode: 'fight', timer_status: 'running', timer_duration_ms: 60000, timer_remaining_ms: 41000, timer_started_at: '2026-10-06T10:00:00Z',
  timer_rev: 3, timer_round: 2, round_no: 2, round_status: 'running', official_a: 7, official_b: 4, rounds_confirmed: 1, discipline: [], server_now: '2026-10-06T10:00:01Z', ...over
});
const input = (matches: CompetitionMatch[], over: Partial<AnnouncerInput> = {}): AnnouncerInput => ({ matches, competitions: COMPS, lyst: [], sides: {}, readiness: null, focus: null, ...over });
const fighter = (entryId: string, name: string, over: Partial<SideSource> = {}): SideSource => ({
  entryId, kind: 'fighter', name, team: { id: 't1', name: 'Iron Wolves', colors: ['#112233', '#ffffff'], division: 'pale', initial: 'I', emblemUrl: null, city: 'Halifax', region: 'NS', country: 'CA' },
  avatarUrl: 'https://img.test/a.png', record: { wins: 5, losses: 2, draws: 0, test: false }, ...over
});

describe('words', () => {
  it('Field N is Lyst N; other names are kept', () => {
    expect(lystLabel('Field 2')).toBe('Lyst 2');
    expect(lystLabel('field 10')).toBe('Lyst 10');
    expect(lystLabel('Main Lyst')).toBe('Main Lyst');
    expect(lystLabel('  ')).toBe('Lyst 1');
  });
  it('slot and phase words never rely on colour', () => {
    expect(slotWord('on_deck')).toBe('On deck');
    expect(slotWord('fighting')).toBe('Fighting now');
    expect(phaseWord(lyst('x', { round_status: 'confirming' }))).toBe('Scores being confirmed…');
    expect(phaseWord(lyst('x', { round_status: 'running', round_no: 3 }))).toBe('Round 3');
    expect(phaseWord(lyst('x', { round_status: 'confirmed', round_no: 2 }))).toBe('After round 2');
    expect(phaseWord(undefined)).toBeNull();
  });
});

describe('result basis wording (official record only)', () => {
  it('score, dq, technical, walkover', () => {
    expect(basisOf({ lyst: { basis: 'score' } })).toBe('on score');
    expect(basisOf({ lyst: { basis: 'dq' } })).toBe('by disqualification');
    expect(basisOf({ lyst: { basis: 'technical', reason: 'Opponent unable to continue' } })).toBe('technical result');
    expect(basisOf({ walkover: true, reason: 'withdrawn', automatic: true })).toBe('walkover');
  });
  it('nothing to say without a known basis', () => {
    expect(basisOf({})).toBeNull();
    expect(basisOf(null)).toBeNull();
    expect(basisOf({ lyst: { basis: 'something-else' } })).toBeNull();
    expect(basisOf({ lyst: { basis: '__proto__' } })).toBeNull();
    expect(basisOf({ lyst: 'x' })).toBeNull();
  });
});

describe('NOW FIGHTING', () => {
  const matches = [m(1, { queueState: 'active' }), m(2, { queueState: 'on_deck' }), m(3, { queueState: 'in_the_hole' }), m(4), m(5), m(6, { competitionId: 'ss' })];
  it('shows the official lyst score, round, clock and marks of the active fight', () => {
    const v = buildAnnouncerView(input(matches, { lyst: [lyst('m001', { discipline: [{ round: 2, side: 'a', kind: 'card', label: 'Yellow', amount: 0 }, { round: 2, side: 'b', kind: 'deduction', label: null, amount: 2 }, { round: 1, side: 'b', kind: 'warning', label: null, amount: 0 }] })] }));
    const c = v.lysts[0];
    expect(c.live).toBe(true);
    expect(c.now).toMatchObject({ id: 'm001', slot: 'fighting', competition: 'Longsword (men)', round: 2, phase: 'Round 2', timer: { mode: 'fight', status: 'running', remainingMs: 41000, startedAt: '2026-10-06T10:00:00Z' } });
    expect(c.now?.a).toMatchObject({ corner: 'RED', name: 'Fighter 1A', score: 7 });
    expect(c.now?.b).toMatchObject({ corner: 'BLUE', name: 'Fighter 1B', score: 4 });
    expect(c.now?.a.marks).toEqual([{ side: 'a', text: 'Yellow', kind: 'card' }]);
    expect(c.now?.b.marks.map(x => x.text)).toEqual(['−2 points', 'Warning']);
  });
  it('a dq mark and the "scores being confirmed" phase are words', () => {
    const v = buildAnnouncerView(input(matches, { lyst: [lyst('m001', { round_status: 'confirming', discipline: [{ round: 2, side: 'b', kind: 'dq', label: null, amount: 0 }] })] }));
    expect(v.lysts[0].now?.phase).toBe('Scores being confirmed…');
    expect(v.lysts[0].now?.b.marks[0].text).toBe('Disqualified');
  });
  it('an active fight with no lyst state yet has no score at all (never a counter, never the classic board snapshot)', () => {
    const v = buildAnnouncerView(input(matches));
    expect(v.lysts[0].now?.a.score).toBeNull();
    expect(v.lysts[0].now?.b.score).toBeNull();
    expect(v.lysts[0].now?.timer).toBeNull();
    expect(v.lysts[0].now?.phase).toBeNull();
  });
  it('lyst rows of other fights are never shown on the active one', () => {
    const v = buildAnnouncerView(input(matches, { lyst: [lyst('m002', { official_a: 99, official_b: 98 })] }));
    expect(v.lysts[0].now?.a.score).toBeNull();
  });
  it('no active fight: the card is not live and has no NOW', () => {
    const v = buildAnnouncerView(input([m(2, { queueState: 'on_deck' }), m(3)]));
    expect(v.lysts[0]).toMatchObject({ live: false, now: null });
    expect(v.lysts[0].next?.id).toBe('m002');
  });
  it('two fights marked active on one Lyst: the first shows, the card says there is another', () => {
    const v = buildAnnouncerView(input([m(1, { queueState: 'active', position: 1 }), m(2, { queueState: 'active', position: 2 })]));
    expect(v.lysts[0].now?.id).toBe('m001');
    expect(v.lysts[0].alsoActive).toBe(1);
  });
});

describe('UP NEXT and COMING UP', () => {
  it('queue order is on deck, in the hole, then waiting in running order; a small list, not the bracket', () => {
    const many = [m(1, { queueState: 'active' }), m(2, { queueState: 'in_the_hole' }), m(3, { queueState: 'on_deck' }), ...[4, 5, 6, 7, 8, 9, 10, 11].map(n => m(n))];
    const c = buildAnnouncerView(input(many)).lysts[0];
    expect(c.next).toMatchObject({ id: 'm003', slot: 'on_deck' });
    expect(c.coming.map(f => f.id)).toEqual(['m002', 'm004', 'm005', 'm006', 'm007']);
    expect(c.coming).toHaveLength(COMING_LIMIT);
    expect(c.coming[0].slot).toBe('in_the_hole');
    expect(c.more).toBe(4);
  });
  it('the waiting fights follow the organizer\'s manual order, then time, like the database', () => {
    const c = buildAnnouncerView(input([m(1, { queueOrder: 2 }), m(2, { queueOrder: 1 }), m(3, { scheduledAt: '2026-10-06T09:00:00Z' })])).lysts[0];
    expect([c.next?.id, ...c.coming.map(f => f.id)]).toEqual(['m002', 'm001', 'm003']);
  });
  it('fights whose sides are not decided are not announced', () => {
    const c = buildAnnouncerView(input([m(1, { queueState: 'active' }), m(2, { entryB: null, nameB: null }), m(3)])).lysts[0];
    expect([c.next?.id, ...c.coming.map(f => f.id)]).toEqual(['m003']);
  });
  it('readiness: Ready / Not yet ready per side for the fights coming up; none for the fight being fought', () => {
    const matches = [m(1, { queueState: 'active' }), m(2, { queueState: 'on_deck' }), m(3)];
    const readiness = [{ match_id: 'm002', side: 'a', ready: true }, { match_id: 'm002', side: 'b', ready: false }, { match_id: 'm003', side: 'a', ready: true }, { match_id: 'm001', side: 'a', ready: false }];
    const c = buildAnnouncerView(input(matches, { readiness })).lysts[0];
    expect(c.next?.a.ready).toBe(true);
    expect(c.next?.b.ready).toBe(false);
    expect(c.next?.notReady).toBe(true);
    expect(c.coming[0].a.ready).toBe(true);
    expect(c.coming[0].b.ready).toBeNull();       // no row: unknown, not "ready"
    expect(c.coming[0].notReady).toBe(false);
    expect(c.now?.a.ready).toBeNull();
  });
  it('without readiness rows (a viewer that cannot read them) nothing says ready or not', () => {
    const c = buildAnnouncerView(input([m(2, { queueState: 'on_deck' })])).lysts[0];
    expect(c.next?.a.ready).toBeNull();
    expect(c.next?.notReady).toBe(false);
  });
  it('team, crest, photo and record come from the public side records; test records are labelled', () => {
    const c = buildAnnouncerView(input([m(2, { queueState: 'on_deck' })], { sides: { e2a: fighter('e2a', 'Fighter 2A'), e2b: fighter('e2b', 'Fighter 2B', { record: { wins: 1, losses: 0, draws: 0, test: true } }) } })).lysts[0];
    expect(c.next?.a).toMatchObject({ teamName: 'Iron Wolves', photoUrl: 'https://img.test/a.png', record: '5-2', recordIsTest: false, kind: 'fighter' });
    expect(c.next?.a.crest?.name).toBe('Iron Wolves');
    expect(c.next?.b).toMatchObject({ record: '1-0', recordIsTest: true });
  });
  it('a team entry shows no separate team line', () => {
    const c = buildAnnouncerView(input([m(2, { queueState: 'on_deck' })], { sides: { e2a: { ...fighter('e2a', 'Iron Wolves'), kind: 'team', avatarUrl: null } } })).lysts[0];
    expect(c.next?.a.teamName).toBeNull();
    expect(c.next?.a.kind).toBe('team');
    expect(c.next?.a.photoUrl).toBeNull();
  });
  it('entry ids to look up are exactly the fighters shown in the cards', () => {
    const v = buildAnnouncerView(input([m(1, { queueState: 'active' }), m(2, { queueState: 'on_deck' }), m(3)]));
    expect(v.entryIds.sort()).toEqual(['e1a', 'e1b', 'e2a', 'e2b', 'e3a', 'e3b']);
  });
});

describe('multiple Lysts', () => {
  const two = [
    m(1, { field: 'Field 1', queueState: 'active' }), m(2, { field: 'Field 1' }),
    m(3, { field: 'Field 2', queueState: 'active', competitionId: 'ss' }), m(4, { field: 'Field 2', competitionId: 'ss' }),
    m(5, { field: 'Field 3' })
  ];
  it('one card per Lyst with something left, Field 1 first, regardless of who is live', () => {
    const v = buildAnnouncerView(input(two));
    expect(v.lysts.map(l => [l.label, l.live])).toEqual([['Lyst 1', true], ['Lyst 2', true], ['Lyst 3', false]]);
    expect(v.lysts[1].now?.competition).toBe('Sword and shield');
  });
  it('the order does not change when a fight starts or ends on another Lyst', () => {
    const before = buildAnnouncerView(input(two)).lysts.map(l => l.key);
    const after = buildAnnouncerView(input(two.map(x => (x.id === 'm001' ? { ...x, queueState: 'final' as const, result: 'a' as const } : x)))).lysts.map(l => l.key);
    expect(after).toEqual(before);
  });
  it('a Lyst whose fights are all final drops off; one with a fight on it stays even when nothing else is left', () => {
    const v = buildAnnouncerView(input([m(1, { field: 'Field 1', queueState: 'final', result: 'a', winnerEntryId: 'e1a' }), m(3, { field: 'Field 2', queueState: 'active' })]));
    expect(v.lysts.map(l => l.label)).toEqual(['Lyst 2']);
  });
  it('different Lysts never share a queue', () => {
    const v = buildAnnouncerView(input(two));
    expect(v.lysts[0].next?.id).toBe('m002');
    expect(v.lysts[1].next?.id).toBe('m004');
    expect(v.lysts[2].next?.id).toBe('m005');
  });
  it('focus is a local choice: it picks an existing Lyst, never invents one, and only changes the order', () => {
    const v = buildAnnouncerView(input(two, { focus: 'Field 2' }));
    expect(v.focus).toBe('field 2');
    expect(resolveFocus(v.lysts, 'lyst 2')).toBe('field 2');
    expect(resolveFocus(v.lysts, 'FIELD 3')).toBe('field 3');
    expect(resolveFocus(v.lysts, 'Field 9')).toBeNull();
    expect(resolveFocus(v.lysts, null)).toBeNull();
    expect(orderLysts(v.lysts, v.focus).map(l => l.label)).toEqual(['Lyst 2', 'Lyst 1', 'Lyst 3']);
    expect(orderLysts(v.lysts, null).map(l => l.label)).toEqual(['Lyst 1', 'Lyst 2', 'Lyst 3']);
    // the focus does not change any content
    expect(buildAnnouncerView(input(two, { focus: 'Field 2' })).lysts).toEqual(buildAnnouncerView(input(two)).lysts);
  });
  it('a stored focus that no longer exists falls back to all Lysts', () => {
    expect(buildAnnouncerView(input(two, { focus: 'Field 7' })).focus).toBeNull();
  });
});

describe('RECENT RESULTS', () => {
  const finals = [...Array(11).keys()].map(i => m(i + 1, {
    queueState: 'final', result: 'a', winnerEntryId: `e${i + 1}a`, scoreA: 10, scoreB: i, finalizedAt: `2026-10-06T10:${String(i).padStart(2, '0')}:00Z`,
    detail: { lyst: { basis: 'score', reason: null } }
  }));
  it('the last 8 finalized, newest first, across Lysts', () => {
    const r = buildAnnouncerView(input([...finals.slice(0, 5).map(f => ({ ...f, field: 'Field 2' })), ...finals.slice(5), m(50)])).recent;
    expect(r).toHaveLength(RECENT_LIMIT);
    expect(r.map(x => x.id)).toEqual(['m011', 'm010', 'm009', 'm008', 'm007', 'm006', 'm005', 'm004']);
    expect(r[0]).toMatchObject({ winnerName: 'Fighter 11A', drawn: false, scoreText: '10 – 10', basis: 'on score', fieldLabel: 'Lyst 1', competition: 'Longsword (men)' });
    expect(r[7].fieldLabel).toBe('Lyst 2');
  });
  it('a draw has no winner; a walkover has no score; dq and technical are named; a bye is not a fight', () => {
    const r = buildAnnouncerView(input([
      m(1, { queueState: 'final', result: 'draw', scoreA: 3, scoreB: 3, finalizedAt: '2026-10-06T10:01:00Z', detail: { lyst: { basis: 'score' } } }),
      m(2, { queueState: 'final', result: 'b', winnerEntryId: 'e2b', scoreA: 0, scoreB: 0, finalizedAt: '2026-10-06T10:02:00Z', detail: { walkover: true, reason: 'withdrawn' } }),
      m(3, { queueState: 'final', result: 'a', winnerEntryId: 'e3a', scoreA: 8, scoreB: 2, finalizedAt: '2026-10-06T10:03:00Z', detail: { lyst: { basis: 'dq' } } }),
      m(4, { queueState: 'final', result: 'a', winnerEntryId: 'e4a', scoreA: 5, scoreB: 4, finalizedAt: '2026-10-06T10:04:00Z', detail: { lyst: { basis: 'technical', reason: 'private words' } } }),
      m(5, { queueState: 'final', result: 'a', winnerEntryId: 'e5a', entryB: null, nameB: null, finalizedAt: '2026-10-06T10:05:00Z' })
    ])).recent;
    expect(r.map(x => x.id)).toEqual(['m004', 'm003', 'm002', 'm001']);
    expect(r[3]).toMatchObject({ drawn: true, winnerName: null, scoreText: '3 – 3' });
    expect(r[2]).toMatchObject({ winnerName: 'Fighter 2B', scoreText: null, basis: 'walkover' });
    expect(r[1].basis).toBe('by disqualification');
    expect(r[0].basis).toBe('technical result');
  });
  it('finalized_at ties break by id so the list does not shuffle between refreshes', () => {
    const t = '2026-10-06T10:00:00Z';
    const a = buildAnnouncerView(input([m(2, { queueState: 'final', finalizedAt: t }), m(1, { queueState: 'final', finalizedAt: t })])).recent.map(x => x.id);
    const b = buildAnnouncerView(input([m(1, { queueState: 'final', finalizedAt: t }), m(2, { queueState: 'final', finalizedAt: t })])).recent.map(x => x.id);
    expect(a).toEqual(['m001', 'm002']);
    expect(b).toEqual(a);
  });
});

describe('empty states', () => {
  it('no matches at all', () => {
    expect(buildAnnouncerView(input([]))).toEqual({ lysts: [], recent: [], focus: null, entryIds: [] });
  });
  it('everything finished: no Lyst cards, results still listed', () => {
    const v = buildAnnouncerView(input([m(1, { queueState: 'final', result: 'a', winnerEntryId: 'e1a', finalizedAt: '2026-10-06T10:00:00Z' })]));
    expect(v.lysts).toEqual([]);
    expect(v.recent).toHaveLength(1);
  });
  it('a Lyst with nothing in the queue yet and nothing on: still no NOW and no NEXT', () => {
    const v = buildAnnouncerView(input([m(1, { entryA: null, nameA: null })]));
    expect(v.lysts[0]).toMatchObject({ now: null, next: null, coming: [], live: false });
  });
});

// ------------------------------------------------------------------------------------------------ privacy
const PRIVATE_KEYS = ['email', 'phone', 'user_id', 'auth_user_id', 'owner_user_id', 'inspection_notes', 'weigh_in', 'medical', 'emergency_contact', 'admin_note', 'reason', 'counter_a', 'tally', 'readiness_reason', 'notes'];
const SECRETS = ['SECRET-EMAIL@leak.test', '+1-555-0100', 'uuid-account-9999', 'INSPECTION-NOTE-LEAK', 'MEDICAL-LEAK', 'ADMIN-NOTE-LEAK', 'REASON-LEAK', 'COUNTER-LEAK', 'WEIGH-LEAK'];
const dirty = <T extends object>(o: T): T => ({
  ...o, email: SECRETS[0], phone: SECRETS[1], user_id: SECRETS[2], auth_user_id: SECRETS[2], owner_user_id: SECRETS[2], inspection_notes: SECRETS[3], medical: SECRETS[4], emergency_contact: SECRETS[1],
  admin_note: SECRETS[5], reason: SECRETS[6], counter_a: SECRETS[7], tally: SECRETS[7], weigh_in: SECRETS[8], readiness_reason: SECRETS[6], notes: SECRETS[3]
});
const leaked = (v: unknown) => {
  const s = JSON.stringify(v);
  return [...SECRETS.filter(x => s.includes(x)), ...PRIVATE_KEYS.filter(k => s.includes(`"${k}"`))];
};

describe('no private field can appear', () => {
  const matches = [
    m(1, { queueState: 'active' }), m(2, { queueState: 'on_deck' }), m(3),
    m(4, { queueState: 'final', result: 'a', winnerEntryId: 'e4a', scoreA: 9, scoreB: 1, finalizedAt: '2026-10-06T10:00:00Z', detail: { lyst: { basis: 'technical', reason: SECRETS[6], discipline: [{ reason: SECRETS[6] }] }, notes: SECRETS[3], counter: SECRETS[7], admin_note: SECRETS[5] } })
  ].map(x => dirty(x));
  const view = buildAnnouncerView(input(matches, {
    lyst: [dirty(lyst('m001', { discipline: [dirty({ round: 1, side: 'a' as const, kind: 'card' as const, label: 'Yellow', amount: 0 })] }))],
    sides: Object.fromEntries(['e1a', 'e1b', 'e2a', 'e2b', 'e3a', 'e3b'].map(id => [id, dirty({ ...fighter(id, `N ${id}`), team: dirty(fighter(id, 'x').team!) })])),
    readiness: [dirty({ match_id: 'm002', side: 'a', ready: false })]
  }));
  it('the whole view carries none of them', () => {
    expect(leaked(view)).toEqual([]);
    expect(view.lysts[0].now?.a.marks).toHaveLength(1);       // the data did flow through...
    expect(view.recent[0].basis).toBe('technical result');    // ...including the basis, but not the reason beside it
    expect(view.lysts[0].next?.a.ready).toBe(false);
  });
  it('fighter info carries none of them', () => {
    const side = view.lysts[0].next!.a;
    const info = buildEntryInfo({ side, competition: 'Longsword (men)', matches, competitions: COMPS, career: [dirty({ context: 'official', scope: 'career', kind: null, category: null, wins: 3, losses: 1, draws: 0, matches: 4, events: 2 })] as unknown as CareerLine[] });
    expect(leaked(info)).toEqual([]);
    expect(info.career?.text).toBe('3-1');
    const earlierInfo = buildEntryInfo({ side: { ...side, entryId: 'e4a' }, competition: null, matches, competitions: COMPS, career: null });
    expect(leaked(earlierInfo)).toEqual([]);
    expect(earlierInfo.earlier[0].basis).toBe('technical result');
  });
  it('only whitelisted keys exist on a fight side', () => {
    const f = view.lysts[0].now as AnnFight;
    expect(Object.keys(f.a).sort()).toEqual(['corner', 'crest', 'entryId', 'kind', 'marks', 'name', 'photoUrl', 'ready', 'record', 'recordIsTest', 'score', 'side', 'teamName']);
    expect(Object.keys(f).sort()).toEqual(['a', 'b', 'competition', 'field', 'id', 'notReady', 'phase', 'round', 'slot', 'stage', 'timer']);
    expect(Object.keys(view.recent[0]).sort()).toEqual(['a', 'b', 'basis', 'competition', 'drawn', 'field', 'fieldLabel', 'finalizedAt', 'id', 'scoreText', 'stage', 'winnerName']);
    expect(Object.keys(view.lysts[0].now!.a.marks[0]).sort()).toEqual(['kind', 'side', 'text']);
  });
});

// ------------------------------------------------------------------------------------------------ stale, focus, info
describe('stale logic', () => {
  const T = new Date(2026, 9, 6, 14, 3, 22).getTime();
  it('not stale before the first answer, nor within 20 seconds, stale after', () => {
    expect(staleness(null, T)).toEqual({ stale: false, ageSeconds: null, lastGood: null });
    expect(staleness(T, T + STALE_AFTER_MS).stale).toBe(false);
    expect(staleness(T, T + STALE_AFTER_MS + 1).stale).toBe(true);
    expect(staleness(T, T - 5000).ageSeconds).toBe(0);     // a clock that stepped back is not "stale"
  });
  it('the banner words carry the last good time', () => {
    expect(formatHms(T)).toBe('14:03:22');
    expect(staleLine(staleness(T, T + 60_000))).toBe('Not updating, last good 14:03:22');
    expect(staleLine(staleness(T, T + 1000))).toBeNull();
    expect(staleLine(staleness(null, T))).toBeNull();
  });
  it('latest ignores missing times', () => {
    expect(latest(null, undefined, 5, 9, 3)).toBe(9);
    expect(latest(null, undefined)).toBeNull();
  });
});

describe('focus storage', () => {
  const store = () => { const d = new Map<string, string>(); return { d, getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => { d.set(k, v); }, removeItem: (k: string) => { d.delete(k); } }; };
  it('round-trips per event and clears', () => {
    const s = store();
    saveFocus('ev1', 'field 2', s);
    expect(loadFocus('ev1', s)).toBe('field 2');
    expect(loadFocus('ev2', s)).toBeNull();
    expect(s.d.has(focusStorageKey('ev1'))).toBe(true);
    saveFocus('ev1', null, s);
    expect(loadFocus('ev1', s)).toBeNull();
  });
  it('works without storage, and when storage throws', () => {
    const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => saveFocus('ev', 'x', boom)).not.toThrow();
    expect(loadFocus('ev', boom)).toBeNull();
    expect(() => saveFocus('ev', 'x', null)).not.toThrow();
    expect(loadFocus('ev', null)).toBeNull();
  });
});

describe('fighter / team info', () => {
  const fights = [
    m(1, { queueState: 'final', result: 'a', winnerEntryId: 'X', entryA: 'X', nameA: 'Xavier', entryB: 'Y', nameB: 'Yara', scoreA: 9, scoreB: 3, finalizedAt: '2026-10-06T09:00:00Z', detail: { lyst: { basis: 'score' } } }),
    m(2, { queueState: 'final', result: 'b', winnerEntryId: 'Z', entryA: 'X', nameA: 'Xavier', entryB: 'Z', nameB: 'Zed', scoreA: 2, scoreB: 6, finalizedAt: '2026-10-06T10:00:00Z', competitionId: 'ss' }),
    m(3, { queueState: 'final', result: 'draw', entryA: 'W', nameA: 'Wren', entryB: 'X', nameB: 'Xavier', scoreA: 4, scoreB: 4, finalizedAt: '2026-10-06T11:00:00Z' }),
    m(4, { queueState: 'final', result: 'a', winnerEntryId: 'X', entryA: 'X', nameA: 'Xavier', entryB: 'V', nameB: 'Vic', finalizedAt: '2026-10-06T12:00:00Z', detail: { walkover: true } }),
    m(5, { queueState: 'scheduled', entryA: 'X', nameA: 'Xavier' })
  ];
  it('earlier fights at this event, oldest first, from that fighter\'s side', () => {
    const e = earlierFights('X', fights, COMPS);
    expect(e.map(x => [x.opponent, x.outcome, x.scoreText, x.basis, x.competition])).toEqual([
      ['Yara', 'Won', '9 – 3', 'on score', 'Longsword (men)'],
      ['Zed', 'Lost', '2 – 6', null, 'Sword and shield'],
      ['Wren', 'Drew', '4 – 4', null, 'Longsword (men)'],
      ['Vic', 'Won', null, 'walkover', 'Longsword (men)']
    ]);
    expect(earlierFights('nobody', fights, COMPS)).toEqual([]);
  });
  it('event record and career record; test data is labelled Test', () => {
    const side = buildAnnouncerView(input([m(2, { queueState: 'on_deck', entryA: 'X', nameA: 'Xavier' })], { sides: { X: fighter('X', 'Xavier') } })).lysts[0].next!.a;
    const info = buildEntryInfo({ side, competition: 'Longsword (men)', matches: fights, competitions: COMPS, career: null });
    expect(info).toMatchObject({ name: 'Xavier', kind: 'fighter', teamName: 'Iron Wolves', corner: 'RED', category: 'Longsword (men)', career: null, test: false });
    expect(info.event).toMatchObject({ wins: 2, losses: 1, draws: 1, text: '2-1-1' });
    const line = (o: Partial<CareerLine>) => ({ context: 'official', scope: 'career', kind: null, category: null, wins: 12, losses: 4, draws: 1, matches: 17, events: 5, ...o }) as CareerLine;
    expect(buildEntryInfo({ side, competition: null, matches: fights, competitions: COMPS, career: [line({ context: 'test', wins: 1 }), line({})] }).career).toEqual({ text: '12-4-1', matches: 17, events: 5 });
    const t = buildEntryInfo({ side, competition: null, matches: fights, competitions: COMPS, career: [line({ context: 'test' })] });
    expect(t.test).toBe(true);
    expect(buildEntryInfo({ side, competition: null, matches: [], competitions: COMPS, career: null, eventIsTest: true }).test).toBe(true);
    expect(buildEntryInfo({ side, competition: null, matches: [], competitions: COMPS, career: null }).event.text).toBe('No fights finished yet');
  });
  it('a fighter entered in two competitions: the card shows the whole day (all that fighter\'s entries), not just the entry on screen', () => {
    // X fights longsword as entry X and sword-and-shield as entry X2: the fights of X2 are X's earlier fights too
    const two = [
      m(1, { queueState: 'final', result: 'a', winnerEntryId: 'X2', entryA: 'X2', nameA: 'Xavier', entryB: 'Y', nameB: 'Yara', scoreA: 9, scoreB: 3, finalizedAt: '2026-10-06T09:00:00Z', competitionId: 'ss' }),
      m(2, { queueState: 'final', result: 'b', winnerEntryId: 'Z', entryA: 'Q', nameA: 'Quin', entryB: 'Z', nameB: 'Zed', scoreA: 1, scoreB: 6, finalizedAt: '2026-10-06T10:00:00Z' }),
      m(3, { queueState: 'final', result: 'b', winnerEntryId: 'Z', entryA: 'W', nameA: 'Wren', entryB: 'Z', nameB: 'Zed', scoreA: 1, scoreB: 6, finalizedAt: '2026-10-06T11:00:00Z' })
    ];
    expect(earlierFights('X', two, COMPS)).toEqual([]);
    expect(earlierFights(['X', 'X2'], two, COMPS).map(x => [x.opponent, x.outcome])).toEqual([['Yara', 'Won']]);
    const side = buildAnnouncerView(input([m(2, { queueState: 'on_deck', entryA: 'X', nameA: 'Xavier' })], { sides: { X: fighter('X', 'Xavier') } })).lysts[0].next!.a;
    const info = buildEntryInfo({ side, competition: 'Longsword (men)', matches: two, competitions: COMPS, career: null, entryIds: ['X2'] });
    expect(info.event).toMatchObject({ wins: 1, losses: 0, text: '1-0' });
    expect(buildEntryInfo({ side, competition: null, matches: two, competitions: COMPS, career: null }).event.text).toBe('No fights finished yet');
  });
  it('career total ignores per-discipline lines', () => {
    expect(careerTotal([{ context: 'official', scope: 'career', kind: 'individual', category: 'longsword', wins: 9, losses: 9, draws: 9, matches: 27, events: 1 }])).toBeNull();
    expect(careerTotal(null)).toBeNull();
  });
});
