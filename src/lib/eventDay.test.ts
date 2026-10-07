import { describe, expect, it } from 'vitest';
import { toMatch, type CompetitionMatch } from '../data/matches';
import {
  DEFAULT_FIELD, attentionItems, blockedReason, buildFieldBoards, checkinGaps, competitionProgress, competitionSorts, compareRunOrder, eventIsRunning, fieldKey, fieldName,
  isRunnable, planAdvance, planAfterResult, roundRank, withdrawnEntryIds, type FieldBoard, type RegistrationFlag
, fightingNow, fieldLabel } from './eventDay';

const NONE = new Set<string>();
const m = (n: number, over: Partial<CompetitionMatch> = {}): CompetitionMatch => ({
  id: `m${String(n).padStart(3, '0')}`, competitionId: 'alpha', stage: 'round_robin', roundLabel: 'Round 1', position: n, pool: null, field: 'Field 1', scheduledAt: null,
  queueState: 'scheduled', entryA: `e${n}a`, entryB: `e${n}b`, nameA: `Team ${n}A`, nameB: `Team ${n}B`, nextMatchId: null, nextSlot: null, result: null, winnerEntryId: null,
  scoreA: null, scoreB: null, detail: {}, version: 0, finalizedAt: null, queueOrder: null, ...over
});
const SORTS = competitionSorts([{ id: 'alpha', sort: 1 }, { id: 'bravo', sort: 2 }, { id: 'knockout', sort: 3 }]);
const ids = (list: readonly CompetitionMatch[]) => list.map(x => Number(x.id.slice(1)));
const board = (matches: CompetitionMatch[], key = 'field 1', withdrawn: ReadonlySet<string> = NONE): FieldBoard => buildFieldBoards(matches, SORTS, withdrawn).find(b => b.key === key)!;

describe('Field 1 is the default and fields never mix', () => {
  it('names and keys a field: blank is Field 1, case and spaces do not matter', () => {
    expect(fieldName(null)).toBe(DEFAULT_FIELD);
    expect(fieldName('  ')).toBe('Field 1');
    expect(fieldKey(' FIELD 1 ')).toBe('field 1');
    expect(fieldKey(undefined)).toBe('field 1');
    expect(fieldKey('Arena A')).toBe('arena a');
  });
  it('a match the data layer returned with no field lands on Field 1 without writing anything', () => {
    const row = { id: '1', competition_id: 'c', stage: 'pool' as const, round_label: 'Round 1', position: 0, pool: null, field: null, scheduled_at: null, queue_state: 'scheduled' as const,
      entry_a: 'a', entry_b: 'b', next_match_id: null, next_slot: null, result: null, winner_entry_id: null, score_a: null, score_b: null, detail: null, version: 0, finalized_at: null, a: null, b: null };
    expect(toMatch(row).field).toBe('Field 1');
    expect(toMatch({ ...row, field: '   ' }).field).toBe('Field 1');
    expect(toMatch({ ...row, field: 'Field 2' }).field).toBe('Field 2');
    expect(toMatch({ ...row, field: 'Arena A' }).field).toBe('Arena A');
  });
  it('one board per field, Field 1 first, natural order after it', () => {
    const boards = buildFieldBoards([m(1, { field: 'Field 10' }), m(2, { field: 'Field 2' }), m(3, { field: 'field 1' }), m(4, { field: 'Arena A' })], SORTS, NONE);
    expect(boards.map(b => b.name)).toEqual(['field 1', 'Arena A', 'Field 2', 'Field 10']);
  });
  it('a single-field tournament needs no setup: every match is on the one default board', () => {
    const boards = buildFieldBoards([m(1), m(2), m(3)].map(x => ({ ...x, field: 'Field 1' })), SORTS, NONE);
    expect(boards).toHaveLength(1);
    expect(boards[0].name).toBe('Field 1');
    expect(ids(boards[0].upcoming)).toEqual([1, 2, 3]);
  });
  it('Field 1 and Field 2 have independent states', () => {
    const f1 = [m(1, { queueState: 'active' }), m(2, { queueState: 'on_deck' }), m(3)];
    const f2 = [m(11, { field: 'Field 2', queueState: 'on_deck' }), m(12, { field: 'Field 2' })];
    const boards = buildFieldBoards([...f1, ...f2], SORTS, NONE);
    const [one, two] = boards;
    expect([ids(one.now), ids(one.onDeck), ids(one.upcoming)]).toEqual([[1], [2], [3]]);
    expect([ids(two.now), ids(two.onDeck), ids(two.upcoming)]).toEqual([[], [11], [12]]);
    expect([one.state, two.state]).toEqual(['running', 'ready']);
  });
});

describe('can a match run?', () => {
  it('needs both sides', () => {
    expect(isRunnable(m(1), NONE)).toBe(true);
    expect(blockedReason(m(1, { entryB: null, nameB: null }), NONE)?.code).toBe('unknown_side');
    expect(blockedReason(m(1, { entryA: null, entryB: null, stage: 'third_place' }), NONE)?.text).toBe('Waiting for the semifinals to finish');
  });
  it('is blocked when an entrant has withdrawn or been disqualified, and says who', () => {
    const w = withdrawnEntryIds([{ id: 'e1a', status: 'withdrawn' }, { id: 'e2b', status: 'disqualified' }, { id: 'e3a', status: 'registered' }, { id: 'e4a', status: 'checked_in' }]);
    expect([...w].sort()).toEqual(['e1a', 'e2b']);
    expect(blockedReason(m(1), w)).toMatchObject({ code: 'withdrawn', entryId: 'e1a' });
    expect(blockedReason(m(1), w)?.text).toContain('Team 1A has withdrawn');
    expect(isRunnable(m(2), w)).toBe(false);
    expect(isRunnable(m(3), w)).toBe(true);
  });
});

describe('the running order', () => {
  // The same scenario as supabase/tests/pack09a_gate.sql, section 1: expected line 22,1,2,3,4,5,6,21 with 7 left out.
  const scenario = [
    m(1), m(2), m(3), m(4, { roundLabel: 'Round 2', position: 0 }), m(5, { roundLabel: 'Round 2', position: 1 }), m(6, { roundLabel: 'Round 2', position: 2 }),
    m(7, { roundLabel: 'Round 3', entryB: null, nameB: null }),
    m(21, { competitionId: 'bravo' }), m(22, { competitionId: 'bravo', scheduledAt: '2026-10-04T08:00:00+00:00', position: 1 })
  ].map((x, i) => (i < 3 ? { ...x, position: i } : x));
  it('puts the timed match first, then competitions in order, rounds in order, and leaves a match with an unknown side out', () => {
    expect(ids(board(scenario).upcoming)).toEqual([22, 1, 2, 3, 4, 5, 6, 21]);
    expect(board(scenario).waiting.map(w => Number(w.match.id.slice(1)))).toEqual([7]);
  });
  it('a withdrawn entrant takes a match out of the line', () => {
    expect(ids(board(scenario, 'field 1', new Set(['e6b'])).upcoming)).toEqual([22, 1, 2, 3, 4, 5, 21]);
  });
  it('the organizer\'s manual order beats the schedule, and no manual order goes after those with one', () => {
    const timed = [m(12, { scheduledAt: '2026-10-04T09:00:00+00:00' }), m(13, { scheduledAt: '2026-10-04T09:10:00+00:00' }), m(14, { scheduledAt: '2026-10-04T09:20:00+00:00' })];
    expect(ids(board(timed).upcoming)).toEqual([12, 13, 14]);
    const moved = [timed[0], { ...timed[2], queueOrder: 2 }, { ...timed[1], queueOrder: 3 }].map((x, i) => (i === 0 ? { ...x, queueOrder: 1 } : x));
    expect(ids(board(moved).upcoming)).toEqual([12, 14, 13]);
    expect(moved.find(x => x.id === 'm014')!.scheduledAt).toBe('2026-10-04T09:20:00+00:00');   // moving never rewrites a scheduled time
    expect(ids(board([...moved, m(15)]).upcoming)).toEqual([12, 14, 13, 15]);
  });
  it('stage then round then pool then position when nothing else decides', () => {
    const list = [
      m(1, { stage: 'final', roundLabel: 'Final', position: 0 }), m(2, { stage: 'third_place', roundLabel: 'Third place' }), m(3, { stage: 'elimination', roundLabel: 'Semifinal' }),
      m(4, { stage: 'elimination', roundLabel: 'Quarterfinal' }), m(5, { stage: 'elimination', roundLabel: 'Round of 16' }), m(6, { stage: 'pool', pool: 'B', roundLabel: 'Round 1', position: 0 }),
      m(7, { stage: 'pool', pool: 'A', roundLabel: 'Round 2', position: 0 }), m(8, { stage: 'pool', pool: 'A', roundLabel: 'Round 10', position: 0 }), m(9, { stage: 'pool', pool: 'A', roundLabel: 'Round 1', position: 1 }),
      m(10, { stage: 'pool', pool: 'A', roundLabel: 'Round 1', position: 0 })
    ].map(x => ({ ...x, competitionId: 'knockout' }));
    // Round 1 of every pool runs before Round 2 (round, then pool, then position), so nobody waits a whole pool for their first fight.
    expect(ids(board(list).upcoming)).toEqual([10, 9, 6, 7, 8, 5, 4, 3, 2, 1]);
    expect(roundRank('elimination', 'Round of 32')).toBeLessThan(roundRank('elimination', 'Round of 16'));
  });
  it('is stable: equal matches fall back to their id', () => {
    const a = m(1, { position: 0 }), b = { ...m(2, { position: 0 }) };
    expect(compareRunOrder(a, b, SORTS)).toBeLessThan(0);
    expect(compareRunOrder(b, a, SORTS)).toBeGreaterThan(0);
    expect(compareRunOrder(a, a, SORTS)).toBe(0);
  });
});

describe('advancing a field (mirrors the database)', () => {
  const six = () => [1, 2, 3, 4, 5, 6].map(n => m(n));
  it('starts a quiet field: first three of the line become active, on deck, in the hole', () => {
    const p = planAdvance(board(six()), NONE, SORTS, { start: true });
    expect(p.promote).toEqual([{ matchId: 'm001', to: 'active' }, { matchId: 'm002', to: 'on_deck' }, { matchId: 'm003', to: 'in_the_hole' }]);
  });
  it('"fill the queue" without start leaves the field with nothing active', () => {
    expect(planAdvance(board(six()), NONE, SORTS, { start: false }).promote).toEqual([{ matchId: 'm001', to: 'on_deck' }, { matchId: 'm002', to: 'in_the_hole' }]);
  });
  it('is idempotent: a settled queue has nothing to do', () => {
    const settled = [m(1, { queueState: 'active' }), m(2, { queueState: 'on_deck' }), m(3, { queueState: 'in_the_hole' }), m(4), m(5)];
    expect(planAdvance(board(settled), NONE, SORTS, { start: true })).toEqual({ promote: [], demote: [] });
  });
  it('a result on the active match shifts everything up one place', () => {
    const live = [m(1, { queueState: 'active' }), m(2, { queueState: 'on_deck' }), m(3, { queueState: 'in_the_hole' }), m(4), m(5)];
    expect(planAfterResult(board(live), 'm001', true, NONE, SORTS).promote).toEqual([{ matchId: 'm002', to: 'active' }, { matchId: 'm003', to: 'on_deck' }, { matchId: 'm004', to: 'in_the_hole' }]);
  });
  it('a result on the match on deck leaves the active one alone', () => {
    const live = [m(1, { queueState: 'active' }), m(2, { queueState: 'on_deck' }), m(3, { queueState: 'in_the_hole' }), m(4), m(5)];
    expect(planAfterResult(board(live), 'm002', false, NONE, SORTS).promote).toEqual([{ matchId: 'm003', to: 'on_deck' }, { matchId: 'm004', to: 'in_the_hole' }]);
  });
  it('a result on the match in the hole only refills the hole', () => {
    const live = [m(1, { queueState: 'active' }), m(2, { queueState: 'on_deck' }), m(3, { queueState: 'in_the_hole' }), m(4)];
    expect(planAfterResult(board(live), 'm003', false, NONE, SORTS).promote).toEqual([{ matchId: 'm004', to: 'in_the_hole' }]);
  });
  it('never promotes a match that cannot run: a missing side, or a withdrawn entrant', () => {
    const live = [m(1, { queueState: 'active' }), m(2, { entryB: null, nameB: null }), m(3, { entryA: 'gone' }), m(4), m(5)];
    const p = planAfterResult(board(live, 'field 1', new Set(['gone'])), 'm001', true, new Set(['gone']), SORTS);
    expect(p.promote).toEqual([{ matchId: 'm004', to: 'active' }, { matchId: 'm005', to: 'on_deck' }]);
    expect(p.promote.map(x => x.matchId)).not.toContain('m002');
    expect(p.promote.map(x => x.matchId)).not.toContain('m003');
  });
  it('an exhausted line leaves the field empty rather than inventing a fight', () => {
    const last = [m(1, { queueState: 'active' }), m(2, { entryB: null, nameB: null })];
    expect(planAfterResult(board(last), 'm001', true, NONE, SORTS)).toEqual({ promote: [], demote: [] });
    expect(board([m(1, { queueState: 'final' }), m(2, { entryB: null, nameB: null })].map(x => ({ ...x }))).state).toBe('stalled');
  });
  it('an on-deck match that can no longer run goes back to the line and is not promoted', () => {
    const live = [m(1, { queueState: 'on_deck' }), m(2, { queueState: 'in_the_hole' }), m(3)];
    const p = planAdvance(board(live, 'field 1', new Set(['e1a'])), new Set(['e1a']), SORTS, { start: false });
    expect(p.demote).toEqual(['m001']);
    expect(p.promote).toEqual([{ matchId: 'm002', to: 'on_deck' }, { matchId: 'm003', to: 'in_the_hole' }]);
  });
  it('an unrunnable ACTIVE match is left alone (it is being fought)', () => {
    const live = [m(1, { queueState: 'active' }), m(2)];
    expect(planAdvance(board(live, 'field 1', new Set(['e1a'])), new Set(['e1a']), SORTS, { start: true }).demote).toEqual([]);
  });
  it('advancing Field 1 says nothing about Field 2', () => {
    const f2 = [m(11, { field: 'Field 2', queueState: 'on_deck' }), m(12, { field: 'Field 2' })];
    const boards = buildFieldBoards([m(1, { queueState: 'active' }), m(2), ...f2], SORTS, NONE);
    const p1 = planAfterResult(boards[0], 'm001', true, NONE, SORTS);
    expect(p1.promote.every(x => !x.matchId.startsWith('m01'))).toBe(true);
    expect(p1.promote).toEqual([{ matchId: 'm002', to: 'active' }]);
  });
  it('a knockout: the next round is picked up once both sides are known', () => {
    const f = (n: number, over: Partial<CompetitionMatch>) => m(n, { competitionId: 'knockout', ...over });
    const before = [f(41, { stage: 'elimination', roundLabel: 'Semifinal', queueState: 'active' }), f(42, { stage: 'elimination', roundLabel: 'Semifinal', queueState: 'on_deck' }),
      f(43, { stage: 'final', roundLabel: 'Final', entryA: 'w1', entryB: null }), f(44, { stage: 'third_place', roundLabel: 'Third place', entryA: 'l1', entryB: null })];
    expect(board(before).waiting).toHaveLength(2);
    expect(planAfterResult(board(before), 'm041', true, NONE, SORTS).promote).toEqual([{ matchId: 'm042', to: 'active' }]);
    // semifinal 2 is saved: both later matches are ready; third place runs before the final
    const after = [f(42, { stage: 'elimination', roundLabel: 'Semifinal', queueState: 'active' }), f(43, { stage: 'final', roundLabel: 'Final', entryA: 'w1', entryB: 'w2' }), f(44, { stage: 'third_place', roundLabel: 'Third place', entryA: 'l1', entryB: 'l2' })];
    expect(planAfterResult(board(after), 'm042', true, NONE, SORTS).promote).toEqual([{ matchId: 'm044', to: 'active' }, { matchId: 'm043', to: 'on_deck' }]);
  });
});

describe('competition progress', () => {
  const comp = { id: 'alpha', name: 'Longsword' };
  const final = (n: number, over: Partial<CompetitionMatch> = {}) => m(n, { queueState: 'final', ...over });
  it('says there is no draw, not started, in progress, all scored', () => {
    expect(competitionProgress(comp, []).label).toBe('No draw yet');
    expect(competitionProgress(comp, [m(1), m(2)])).toMatchObject({ phase: 'not_started', label: 'Not started', percent: 0 });
    expect(competitionProgress(comp, [final(1), m(2), m(3)])).toMatchObject({ phase: 'in_progress', final: 1, total: 3, percent: 33, detail: '1 of 3 fights scored' });
    expect(competitionProgress(comp, [final(1), final(2)])).toMatchObject({ phase: 'all_scored', label: 'All matches scored', percent: 100 });
  });
  it('a started queue counts as in progress even before the first result', () => {
    expect(competitionProgress(comp, [m(1, { queueState: 'active' }), m(2)]).phase).toBe('in_progress');
  });
  it('7 of 12', () => {
    const list = Array.from({ length: 12 }, (_, i) => (i < 7 ? final(i + 1) : m(i + 1)));
    expect(competitionProgress(comp, list)).toMatchObject({ final: 7, total: 12, percent: 58 });
  });
  it('pool play, pools finished with no bracket, bracket underway, final underway', () => {
    const pool = (n: number, s: CompetitionMatch['queueState']) => m(n, { stage: 'pool', pool: 'A', queueState: s });
    expect(competitionProgress(comp, [pool(1, 'final'), pool(2, 'scheduled')])).toMatchObject({ phase: 'pool_play', label: 'Pool play' });
    const done = competitionProgress(comp, [pool(1, 'final'), pool(2, 'final')]);
    expect(done).toMatchObject({ phase: 'all_scored' });
    const needs = competitionProgress({ id: 'k', name: 'K' }, [pool(1, 'final'), pool(2, 'final'), m(3, { stage: 'elimination', queueState: 'final' })].slice(0, 2).concat([]));
    expect(needs.phase).toBe('all_scored');   // every existing match is scored: nothing says a bracket was ever planned until it exists
    const bracketNeeded = competitionProgress(comp, [pool(1, 'final'), pool(2, 'final'), m(9, { stage: 'round_robin', queueState: 'scheduled' })]);
    expect(bracketNeeded.phase).not.toBe('pools_done');
    const bracket = competitionProgress(comp, [pool(1, 'final'), m(2, { stage: 'elimination', queueState: 'scheduled' }), m(3, { stage: 'final', queueState: 'scheduled' })]);
    expect(bracket).toMatchObject({ phase: 'bracket', label: 'Bracket underway' });
    expect(competitionProgress(comp, [m(1, { stage: 'elimination', queueState: 'final' }), m(2, { stage: 'final', queueState: 'active' })]).phase).toBe('final_underway');
  });
  it('does not claim a competition is complete from dates or status, only from matches', () => {
    expect(competitionProgress({ ...comp, ...{ status: 'finished' } } as typeof comp, [final(1), m(2)]).phase).not.toBe('all_scored');
  });
});

describe('who is not checked in, only where it matters', () => {
  const entries = [
    { id: 'e1a', fighterId: 'f1', teamId: null, name: 'Ann' }, { id: 'e1b', fighterId: 'f2', teamId: null, name: 'Ben' },
    { id: 'e2a', fighterId: null, teamId: 't1', name: 'Iron Wolves' }, { id: 'e2b', fighterId: 'f9', teamId: null, name: 'Zed' },
    { id: 'e5a', fighterId: 'f5', teamId: null, name: 'Far Away' }, { id: 'e5b', fighterId: 'f6', teamId: null, name: 'Also Far' }
  ];
  const roster = [{ entryId: 'e2a', fighterId: 'f3', displayName: 'Cal' }, { entryId: 'e2a', fighterId: 'f4', displayName: 'Dee' }];
  const reg = (fighterId: string, over: Partial<RegistrationFlag> = {}): RegistrationFlag => ({ id: `r-${fighterId}`, fighterId, fullName: fighterId, status: 'accepted', isVolunteer: false, checkedIn: true, ...over });
  const boards = () => buildFieldBoards([
    m(1, { queueState: 'active', entryA: 'e1a', entryB: 'e1b' }), m(2, { queueState: 'on_deck', entryA: 'e2a', entryB: 'e2b' }),
    m(3, { entryA: 'e1a', entryB: 'e2b' }), m(4, { entryA: 'e1a', entryB: 'e2b' }), m(5, { entryA: 'e1a', entryB: 'e2b' }), m(6, { entryA: 'e1a', entryB: 'e2b' }),
    m(7, { entryA: 'e5a', entryB: 'e5b' })
  ], SORTS, NONE);
  it('reports accepted people who are not checked in, for the live matches and the next few', () => {
    const gaps = checkinGaps(boards(), entries, roster, [reg('f1'), reg('f2', { checkedIn: false }), reg('f3', { checkedIn: false }), reg('f4'), reg('f9', { checkedIn: false })]);
    expect(gaps.map(g => `${g.name}:${g.slot}`)).toEqual(['Ben:now', 'Cal:on_deck', 'Zed:on_deck']);
    expect(gaps.find(g => g.name === 'Cal')?.teamName).toBe('Iron Wolves');
  });
  it('ignores people whose only match is far down the line, and people with no registration', () => {
    const gaps = checkinGaps(boards(), entries, roster, [reg('f5', { checkedIn: false }), reg('f6', { checkedIn: false })]);
    expect(gaps).toEqual([]);
    expect(checkinGaps(boards(), entries, roster, [])).toEqual([]);
  });
  it('flags a registration that is not accepted, and reports each person once for their most urgent match', () => {
    const gaps = checkinGaps(boards(), entries, roster, [reg('f1', { status: 'withdrawn', checkedIn: false })]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ name: 'Ann', problem: 'registration_not_accepted', slot: 'now' });
  });
});

describe('needs attention', () => {
  const base = { progress: [], clashes: [], gaps: [], resultConflicts: 0, withdrawn: NONE, competitionNames: new Map([['alpha', 'Longsword'], ['bravo', 'Sabre']]), timeZone: 'America/Edmonton', now: new Date('2026-10-04T16:00:00Z') };
  it('says nothing when nothing needs a person, and ignores ordinary future placeholders', () => {
    const boards = buildFieldBoards([m(1, { queueState: 'active' }), m(2, { entryB: null, nameB: null, scheduledAt: '2026-10-04T20:00:00Z' })], SORTS, NONE);
    expect(attentionItems({ ...base, boards })).toEqual([]);
  });
  it('flags a waiting match once it is due (or overdue), not before', () => {
    const waitingAt = (iso: string) => buildFieldBoards([m(2, { entryB: null, nameB: null, scheduledAt: iso })], SORTS, NONE);
    expect(attentionItems({ ...base, boards: waitingAt('2026-10-04T16:10:00Z') })[0]).toMatchObject({ kind: 'due_but_blocked', urgency: 'soon' });
    expect(attentionItems({ ...base, boards: waitingAt('2026-10-04T15:00:00Z') })).toHaveLength(1);
    expect(attentionItems({ ...base, boards: waitingAt('2026-10-04T17:00:00Z') })).toEqual([]);
  });
  it('flags result reviews first, then two active fights, then a withdrawn entrant in a live slot', () => {
    const boards = buildFieldBoards([m(1, { queueState: 'active' }), m(2, { queueState: 'active' }), m(3, { queueState: 'on_deck', entryA: 'gone' })], SORTS, NONE);
    const items = attentionItems({ ...base, boards, resultConflicts: 2, withdrawn: new Set(['gone']) });
    expect(items.map(i => i.kind)).toEqual(['result_review', 'two_active', 'withdrawn_in_live']);
    expect(items[0].title).toBe('2 results need review');
    expect(items.every(i => i.urgency === 'now')).toBe(true);
  });
  it('flags a withdrawn entrant in a match that has not been called, as a walkover to record', () => {
    const boards = buildFieldBoards([m(1, { queueState: 'active' }), m(5, { entryA: 'gone' })], SORTS, new Set(['gone']));
    const items = attentionItems({ ...base, boards, withdrawn: new Set(['gone']) });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'walkover_needed', targetLabel: 'Open in Draws and schedule' });
  });
  it('turns a double booking into fighter, both matches, times and fields', () => {
    const boards = buildFieldBoards([m(1, { field: 'Field 1' }), m(2, { field: 'Field 2', competitionId: 'bravo' })], SORTS, NONE);
    const [item] = attentionItems({ ...base, boards, clashes: [{ fighterId: 'f1', displayName: 'Aldric', matchA: 'm001', matchB: 'm002', scheduledA: '2026-10-04T16:15:00Z', scheduledB: '2026-10-04T16:20:00Z', competitionA: 'alpha', competitionB: 'bravo', overlapMinutes: 10 }] });
    expect(item).toMatchObject({ kind: 'double_booked', title: 'Aldric is booked twice', target: { to: 'run', matchId: 'm001' } });
    expect(item.detail).toContain('Longsword at');
    expect(item.detail).toContain('(Field 2)');
    expect(item.detail).toContain('overlap by 10 min');
  });
  it('groups check-in gaps into one item and ranks them by how soon the match is', () => {
    const boards = buildFieldBoards([m(1, { queueState: 'on_deck' })], SORTS, NONE);
    const gaps = ['A', 'B', 'C', 'D'].map((n, i) => ({ fighterId: n, name: `Fighter ${n}`, problem: 'not_checked_in' as const, matchId: 'm001', field: 'Field 1', slot: (i === 0 ? 'on_deck' : 'next') as 'on_deck' | 'next', teamName: null, registrationStatus: 'accepted' as const }));
    const [item] = attentionItems({ ...base, boards, gaps });
    expect(item).toMatchObject({ kind: 'not_checked_in', urgency: 'now', title: '4 fighters not checked in', target: { to: 'checkin' } });
    expect(item.detail).toContain('and 1 more');
  });
  it('points at the next step when pools are finished', () => {
    const boards = buildFieldBoards([], SORTS, NONE);
    const progress = [{ id: 'alpha', name: 'Longsword', total: 6, final: 6, percent: 100, phase: 'pools_done' as const, label: 'x', detail: null, needsBracket: true }];
    expect(attentionItems({ ...base, boards, progress })[0]).toMatchObject({ kind: 'bracket_needed', urgency: 'soon', targetLabel: 'Build bracket' });
  });
});

describe('when the event is running', () => {
  it('is running only inside its dates, in the event time zone', () => {
    expect(eventIsRunning('2026-10-03', '2026-10-04', 'America/Edmonton', new Date('2026-10-04T05:30:00Z'))).toBe(true);   // 23:30 on the 3rd in Edmonton
    expect(eventIsRunning('2026-10-04', '2026-10-05', 'America/Edmonton', new Date('2026-10-04T05:30:00Z'))).toBe(false);  // still the 3rd there
    expect(eventIsRunning('2026-10-03', '2026-10-04', 'America/Edmonton', new Date('2026-10-05T12:00:00Z'))).toBe(false);
  });
});



describe('fightingNow (Pack 11)', () => {
  it('names every person in an active fight with the field they are on, blank field = Field 1', () => {
    const sides = new Map<string, string[]>([['ea', ['p1']], ['eb', ['p2', 'p3']], ['ec', ['p4']], ['ed', ['p5']]]);
    const now = fightingNow([
      { queueState: 'active', entryA: 'ea', entryB: 'eb', field: null },
      { queueState: 'on_deck', entryA: 'ec', entryB: 'ed', field: 'Field 2' },
    ], sides);
    expect([...now.entries()]).toEqual([['p1', 'Lyst 1'], ['p2', 'Lyst 1'], ['p3', 'Lyst 1']]);
  });
});

describe('fieldLabel (Pack 26): the word a person reads for a field', () => {
  it('shows the stored default and a bare or lowercase number as Lyst N', () => {
    expect(fieldLabel('Field 1')).toBe('Lyst 1');
    expect(fieldLabel(null)).toBe('Lyst 1');
    expect(fieldLabel('  ')).toBe('Lyst 1');
    expect(fieldLabel('field 2')).toBe('Lyst 2');
    expect(fieldLabel('10')).toBe('Lyst 10');
    expect(fieldLabel('lyst 3')).toBe('Lyst 3');
    expect(fieldLabel('Field 07')).toBe('Lyst 7');
  });
  it('keeps a custom name exactly as the organizer wrote it', () => {
    expect(fieldLabel('Arena A')).toBe('Arena A');
    expect(fieldLabel('Main Lyst')).toBe('Main Lyst');
    expect(fieldLabel('Ring 2 (north)')).toBe('Ring 2 (north)');
  });
});
