import { describe, expect, it } from 'vitest';
import { toClosePreflight, toOfficialResult, toPreflight, type OfficialResult } from '../data/finalization';
import { blockerLine, buildPodium, closeoutSummary, finalizeAction, nextReady, placeWord, pointsText, reasonOk, recordState, representedLine, unattributedFighters } from './finalization';

// The sums, placings and blockers are the database's (supabase/tests/pack09c_gate.sql proves them). These tests cover what the screens do with them.
const m = (queueState: 'final' | 'active' | 'scheduled') => ({ queueState });
const row = (o: Partial<OfficialResult> & { place: number; name: string }): OfficialResult => ({
  competitionId: 'k', entryId: o.name, points: 0, kind: 'fighter', teamSlug: null, teamCurrentName: null, fighterId: o.name, entryStatus: 'checked_in',
  representedTeamName: null, representedTeamSlug: null, ...o
});

describe('the record state of a competition', () => {
  it('is official only when the status says so, whatever the fights', () => {
    expect(recordState({ status: 'finished', reopenedAt: null }, [m('final')])).toBe('official');
    expect(recordState({ status: 'finished', reopenedAt: '2026-10-04' }, [])).toBe('official');
  });
  it('is ready when every fight is final and the competition is still running', () => {
    expect(recordState({ status: 'running', reopenedAt: null }, [m('final'), m('final')])).toBe('ready');
    expect(recordState({ status: 'running', reopenedAt: null }, [m('final'), m('active')])).toBe('running');
    expect(recordState({ status: 'running', reopenedAt: null }, [m('scheduled')])).toBe('running');
  });
  it('has no draw without fights, and says reopened after a reopen while fights are open again', () => {
    expect(recordState({ status: 'registration', reopenedAt: null }, [])).toBe('no_draw');
    expect(recordState({ status: 'running', reopenedAt: '2026-10-04' }, [m('scheduled')])).toBe('reopened');
    expect(recordState({ status: 'running', reopenedAt: '2026-10-04' }, [m('final')])).toBe('ready');
  });
});

describe('the podium', () => {
  it('puts champion, silver and bronze on steps and the rest in the list', () => {
    const p = buildPodium([row({ place: 1, name: 'Bob' }), row({ place: 2, name: 'John' }), row({ place: 3, name: 'Joe' }), row({ place: 4, name: 'Mike' })]);
    expect(p.steps.map(s => `${s.place}:${s.label}:${s.entries.map(e => e.name).join('+')}`)).toEqual(['1:Champion:Bob', '2:Silver:John', '3:Bronze:Joe']);
    expect(p.rest.map(r => `${r.place}:${r.entries.map(e => e.name).join('+')}`)).toEqual(['4:Mike']);
    expect(p.total).toBe(4);
  });
  it('shows a shared bronze on one step (both semifinal losers), by name', () => {
    const p = buildPodium([row({ place: 1, name: 'Hal' }), row({ place: 2, name: 'Kim' }), row({ place: 3, name: 'Jon' }), row({ place: 3, name: 'Ida' })]);
    expect(p.steps[2]).toMatchObject({ place: 3, shared: true });
    expect(p.steps[2].entries.map(e => e.name)).toEqual(['Ida', 'Jon']);
  });
  it('never invents a bronze: two entrants make two steps', () => {
    const p = buildPodium([row({ place: 1, name: 'Ankle Biters', kind: 'team' }), row({ place: 2, name: 'Red Deer Reavers', kind: 'team' })]);
    expect(p.steps.map(s => s.place)).toEqual([1, 2]);
    expect(p.rest).toEqual([]);
  });
  it('keeps shared places below the podium together and in order', () => {
    const p = buildPodium([row({ place: 1, name: 'A' }), row({ place: 5, name: 'E' }), row({ place: 5, name: 'D' }), row({ place: 2, name: 'B' }), row({ place: 7, name: 'G' })]);
    expect(p.rest.map(r => `${r.place}${r.shared ? '=' : ''}:${r.entries.map(e => e.name).join('+')}`)).toEqual(['5=:D+E', '7:G']);
  });
  it('words a place, shared or not', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(n => placeWord(n))).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
    expect(placeWord(3, true)).toBe('3rd, shared');
  });
  it('shows the team a fighter represented, or that none is recorded, and nothing for a team entry', () => {
    expect(representedLine({ kind: 'fighter', representedTeamName: 'Ankle Biters' })).toBe('Ankle Biters');
    expect(representedLine({ kind: 'fighter', representedTeamName: null })).toBe('No recorded team');
    expect(representedLine({ kind: 'team', representedTeamName: null })).toBeNull();
  });
  it('formats points', () => { expect([pointsText(9), pointsText(12.5), pointsText(7.25)]).toEqual(['9', '12.5', '7.25']); });
});

describe('the review screen', () => {
  it('enables Finalize only when the server says ready, and explains otherwise', () => {
    expect(finalizeAction({ state: 'ready', eventClosed: false })).toMatchObject({ enabled: true });
    expect(finalizeAction({ state: 'running', eventClosed: false })).toMatchObject({ enabled: false, reason: 'Every fight needs a result first.' });
    expect(finalizeAction({ state: 'blocked', eventClosed: false })).toMatchObject({ enabled: false, reason: 'Settle what is listed above first.' });
    expect(finalizeAction({ state: 'official', eventClosed: false })).toMatchObject({ enabled: false, label: 'Official' });
    expect(finalizeAction({ state: 'ready', eventClosed: true }).reason).toMatch(/event is closed/);
  });
  it('names the fighters with no recorded team from the warning', () => {
    const pre = toPreflight({ competition: { id: 'k', name: 'L', status: 'running', structure: 'round_robin', tier: 'Classic', category: 'longsword', gender: 'men', finalized_at: null, reopened_at: null, multiplier_source: null },
      event_closed: false, state: 'ready', matches: { total: 6, final: 6 }, blockers: [], source: 'tournament_structure', multiplier: '1',
      warnings: [{ code: 'no_represented_team', text: 'x', count: 1, entries: [{ entry_id: 'e', fighter_id: 'f', name: 'Mike' }] }],
      placements: [{ entry_id: 'e', place: 4, kind: 'fighter', name: 'Mike', team_slug: null, fighter_id: 'f', status: 'checked_in', represented_team_name: null, represented_team_slug: null, pool_wins: 0, elim_wins: 0, base_points: '0', points: '0' }] });
    expect(unattributedFighters(pre)).toEqual([{ entryId: 'e', fighterId: 'f', name: 'Mike' }]);
    expect(pre.multiplier).toBe(1);
    expect(pre.placements[0]).toMatchObject({ points: 0, basePoints: 0, name: 'Mike' });
    expect(blockerLine(pre)).toBeNull();
    expect(blockerLine({ blockers: [{ code: 'open_matches', text: '1 fight has no result yet.' }] })).toBe('1 fight has no result yet.');
  });
  it('requires a few real characters for a reason', () => { expect(reasonOk('  ')).toBe(false); expect(reasonOk('ok')).toBe(false); expect(reasonOk('contested')).toBe(true); });
});

describe('event closeout', () => {
  const pre = toClosePreflight({ event: { id: 'e', name: 'Open', status: 'published', closed_at: null, reopened_at: null }, closed: false, ready: false,
    blockers: [{ code: 'competitions_open', text: '1 competition is not official yet: Polearm.' }], warnings: [{ code: 'never_ran', text: 'Buckler never ran' }],
    competitions: [{ id: 'a', name: 'Longsword', status: 'finished', total: '6', final: '6', state: 'official', finalized_at: '2026-10-04' }, { id: 'b', name: 'Polearm', status: 'running', total: '3', final: '3', state: 'ready', finalized_at: null },
      { id: 'c', name: 'Buckler', status: 'registration', total: '0', final: '0', state: 'no_draw', finalized_at: null }] });
  it('counts official, open and never-ran competitions and points at the next one to finalize', () => {
    expect(closeoutSummary(pre)).toMatchObject({ official: 1, open: 1, neverRan: 1, canClose: false });
    expect(closeoutSummary(pre).nextToFinalize?.id).toBe('b');
    expect(nextReady(pre.competitions, 'a')).toBe('b');
    expect(nextReady(pre.competitions, 'b')).toBeNull();
  });
  it('maps counts and dates', () => { expect(pre.competitions[0]).toMatchObject({ total: 6, final: 6, finalizedAt: '2026-10-04' }); });
});

describe('the official results view', () => {
  it('names a team as it was at the event and a fighter with the team they represented', () => {
    const base = { competition_id: 'k', entry_id: 'e', final_place: 1, points: '9.00', entry_status: 'checked_in', team_id: null, team_slug: null, team_name_at_event: null, team_current_name: null, fighter_id: null, fighter_name: null, represented_team_id: null, represented_team_slug: null, represented_team_name_at_event: null };
    expect(toOfficialResult({ ...base, kind: 'team', team_id: 't', team_slug: 'ab', team_name_at_event: 'Ankle Biters', team_current_name: 'Ankle Biters FC' })).toMatchObject({ kind: 'team', name: 'Ankle Biters', teamCurrentName: 'Ankle Biters FC', points: 9 });
    expect(toOfficialResult({ ...base, kind: 'fighter', fighter_id: 'f', fighter_name: 'Bob', represented_team_name_at_event: 'Ankle Biters', represented_team_slug: 'ab' })).toMatchObject({ kind: 'fighter', name: 'Bob', representedTeamName: 'Ankle Biters', fighterId: 'f' });
  });
});
