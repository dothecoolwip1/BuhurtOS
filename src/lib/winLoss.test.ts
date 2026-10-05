import { describe, expect, it } from 'vitest';
import type { CompetitionMatch } from '../data/matches';
import type { Placement } from '../data/finalization';
import { boutLine, compareTwo, recordLine, reviewRows, winLossRecords } from './winLoss';

const E = (id: string, name: string, status = 'checked_in') => ({ id, name, status });
let t = 0;
const M = (a: string, b: string, res: 'a' | 'b' | 'draw', sa: number, sb: number, o: Partial<CompetitionMatch> = {}): CompetitionMatch => {
  t += 1;
  return {
    id: `m${t}`, competitionId: 'c', stage: 'round_robin', roundLabel: 'Round 1', position: t, pool: null, field: 'Field 1', scheduledAt: null, queueState: 'final',
    entryA: a, entryB: b, nameA: a, nameB: b, nextMatchId: null, nextSlot: null, result: res, winnerEntryId: res === 'a' ? a : res === 'b' ? b : null,
    scoreA: sa, scoreB: sb, detail: {}, version: 2, finalizedAt: `2026-11-14T10:${String(t).padStart(2, '0')}:00Z`, ...o
  };
};
const P = (entryId: string, place: number, points: number): Placement => ({ entryId, place, kind: 'fighter', name: entryId, teamSlug: null, fighterId: null, status: 'checked_in', representedTeamName: null, representedTeamSlug: null, poolWins: null, elimWins: null, basePoints: null, points });

const entries = [E('bob', 'Bob'), E('john', 'John'), E('mike', 'Mike'), E('chris', 'Chris')];
const fights = [
  M('bob', 'john', 'a', 5, 1), M('bob', 'mike', 'a', 5, 2), M('chris', 'bob', 'a', 5, 4),
  M('john', 'mike', 'draw', 3, 3), M('chris', 'john', 'a', 5, 0), M('mike', 'chris', 'a', 5, 4),
  M('bob', 'chris', 'a', 0, 0, { queueState: 'on_deck', result: null, winnerEntryId: null })   // not fought: never counted
];

describe('wins and losses', () => {
  it('counts wins, losses and ties from finished fights only', () => {
    const r = new Map(winLossRecords(entries, fights).map(x => [x.entryId, x]));
    expect(r.get('bob')).toMatchObject({ wins: 2, losses: 1, ties: 0 });
    expect(r.get('john')).toMatchObject({ wins: 0, losses: 2, ties: 1 });
    expect(r.get('mike')).toMatchObject({ wins: 1, losses: 1, ties: 1 });
    expect(r.get('chris')).toMatchObject({ wins: 2, losses: 1, ties: 0 });
    expect(recordLine(r.get('bob')!)).toBe('2 wins · 1 loss');
    expect(recordLine(r.get('john')!)).toBe('0 wins · 2 losses · 1 tie');
  });

  it('lists who they fought, who they beat and who beat them, with the score', () => {
    const bob = winLossRecords(entries, fights).find(x => x.entryId === 'bob')!;
    expect(bob.bouts.map(boutLine)).toEqual(['Won vs John 5–1', 'Won vs Mike 5–2', 'Lost vs Chris 4–5']);
  });

  it('a walkover says so instead of a score', () => {
    const r = winLossRecords([E('a', 'Ann'), E('b', 'Bea', 'withdrawn')], [M('a', 'b', 'a', 0, 0, { detail: { walkover: true } })]);
    expect(boutLine(r[0].bouts[0])).toBe('Won vs Bea (walkover)');
  });

  it('orders by the server placing and shows the points that would be recorded', () => {
    const rows = reviewRows(winLossRecords(entries, fights), [P('chris', 1, 10), P('bob', 2, 7), P('mike', 3, 5), P('john', 4, 2)]);
    expect(rows.map(r => `${r.name}:${r.placeText}:${r.points}`)).toEqual(['Chris:1st:10', 'Bob:2nd:7', 'Mike:3rd:5', 'John:4th:2']);
  });

  it('a shared place is marked (a tie the organizer may need to decide)', () => {
    const rows = reviewRows(winLossRecords(entries, fights), [P('chris', 1, 10), P('bob', 1, 10), P('mike', 3, 5), P('john', 4, 2)]);
    expect(rows.filter(r => r.shared).map(r => r.name).sort()).toEqual(['Bob', 'Chris']);
    expect(rows[0].placeText).toBe('1st, shared');
  });

  it('compares two competitors head to head', () => {
    const r = winLossRecords(entries, fights);
    const bob = r.find(x => x.entryId === 'bob')!, chris = r.find(x => x.entryId === 'chris')!, john = r.find(x => x.entryId === 'john')!;
    expect(compareTwo(bob, chris).line).toBe('Head to head: Bob 0 – 1 Chris.');
    expect(compareTwo(john, chris).meetings).toHaveLength(1);
  });

  it('bracket fights count the same way (elimination, third place)', () => {
    const r = winLossRecords([E('a', 'A'), E('b', 'B'), E('c', 'C'), E('d', 'D')], [
      M('a', 'd', 'a', 5, 0, { stage: 'elimination', roundLabel: 'Semifinal' }), M('b', 'c', 'b', 1, 5, { stage: 'elimination', roundLabel: 'Semifinal' }),
      M('a', 'c', 'a', 5, 3, { stage: 'final', roundLabel: 'Final' }), M('d', 'b', 'a', 5, 4, { stage: 'third_place', roundLabel: 'Third place' })
    ]);
    expect(r.map(x => `${x.name}${x.wins}-${x.losses}`)).toEqual(['A2-0', 'B0-2', 'C1-1', 'D1-1']);
  });
});
