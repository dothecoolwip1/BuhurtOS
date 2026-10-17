import { describe, expect, it } from 'vitest';
import type { CareerResult } from '../data/careerProfile';
import { alreadyReported, draftProblem, eventWhen, medalsAtPastTournaments, placeName, reportableDisciplines, sortPastMedalEvents, type DisciplineOption, type PastMedalEvent, type PastMedalRecord } from './pastMedals';

const events: PastMedalEvent[] = [
  { id: 'e-kc', slug: 'kings-cup-2025', name: 'Kings Cup 2025', startsOn: '2025-01-01', endsOn: '2025-01-01', city: null, region: null, timeNote: 'Exact date to be confirmed' },
  { id: 'e-cc', slug: 'coulee-clash-2026', name: 'Coulee Clash 2026', startsOn: '2026-05-30', endsOn: '2026-05-31', city: 'Lethbridge', region: 'AB', timeNote: null },
  { id: 'e-ss', slug: 'strathmore-summer-siege-2025', name: 'Strathmore Summer Siege 2025', startsOn: '2025-08-22', endsOn: '2025-08-24', city: 'Strathmore', region: 'AB', timeNote: null }
];
const disciplines: DisciplineOption[] = [
  { code: '5v5', name: '5v5', league: 'buhurt', sort: 11 }, { code: 'longsword', name: 'Longsword', league: 'duels', sort: 22 },
  { code: 'sabre', name: 'Sabre', league: 'hacsa', sort: 40 }, { code: 'profight', name: 'Profight', league: 'outrance', sort: 30 }, { code: 'axe', name: 'Axe (short / long)', league: 'hacsa', sort: 44 }
];
const result = (eventId: string, category: string, finalPlace: number, competitionId = `${eventId}-${category}`): CareerResult => ({
  competitionId, competitionName: category, category, categoryName: category, gender: 'open', tier: null, entryId: `en-${competitionId}`, kind: 'individual', entryStatus: 'registered',
  teamId: 't1', teamName: 'Red Deer Reavers', teamSlug: 'red-deer-reavers', finalPlace, points: 0,
  eventId, eventSlug: eventId, eventName: eventId, startsOn: '2025-01-01', endsOn: '2025-01-01', seasonId: null, organizationId: null, synthetic: false, statsExcluded: false
});

describe('past medals: the form', () => {
  it('offers individual disciplines only, in order', () => {
    expect(reportableDisciplines(disciplines).map(d => d.code)).toEqual(['longsword', 'profight', 'sabre', 'axe']);
  });
  it('needs a tournament, a discipline and a medal, in that order', () => {
    expect(draftProblem({ eventId: '', category: '', place: 0, note: '' }, events, disciplines)).toBe('Choose the tournament.');
    expect(draftProblem({ eventId: 'nope', category: '', place: 0, note: '' }, events, disciplines)).toMatch(/not one that takes/);
    expect(draftProblem({ eventId: 'e-cc', category: '', place: 0, note: '' }, events, disciplines)).toBe('Choose the discipline.');
    expect(draftProblem({ eventId: 'e-cc', category: '5v5', place: 1, note: '' }, events, disciplines)).toMatch(/Team medals/);
    expect(draftProblem({ eventId: 'e-cc', category: 'longsword', place: 4, note: '' }, events, disciplines)).toBe('Choose gold, silver or bronze.');
    expect(draftProblem({ eventId: 'e-cc', category: 'longsword', place: 1, note: 'x'.repeat(301) }, events, disciplines)).toMatch(/under 300/);
    expect(draftProblem({ eventId: 'e-cc', category: 'longsword', place: 1, note: '' }, events, disciplines)).toBeNull();
  });
  it('refuses a second, different medal in the same discipline at the same tournament, and accepts the same one again', () => {
    const mine = [result('e-cc', 'longsword', 1)];
    expect(draftProblem({ eventId: 'e-cc', category: 'longsword', place: 2, note: '' }, events, disciplines, mine)).toMatch(/already have Gold in Longsword/);
    expect(draftProblem({ eventId: 'e-cc', category: 'longsword', place: 1, note: '' }, events, disciplines, mine)).toBeNull();
    expect(alreadyReported(mine, 'e-cc', 'sabre')).toBeUndefined();
  });
  it('names the medal', () => {
    expect([1, 2, 3, 4].map(placeName)).toEqual(['Gold', 'Silver', 'Bronze', '4th place']);
  });
});

describe('past medals: the lists', () => {
  it('shows the newest tournament first and says when a date is a placeholder', () => {
    expect(sortPastMedalEvents(events).map(e => e.slug)).toEqual(['coulee-clash-2026', 'strathmore-summer-siege-2025', 'kings-cup-2025']);
    expect(eventWhen(events[0])).toBe('Jan 1, 2025 (exact date to be confirmed)');
    expect(eventWhen(events[1])).toBe('May 30-31, 2026');
  });
  it('groups a fighter\'s placings by medals-only tournament, best medal first, with the report status, and ignores other events', () => {
    const results = [result('e-cc', 'sabre', 2), result('e-cc', 'longsword', 1), result('e-ss', 'longsword', 2), result('rumble', 'longsword', 1)];
    const records: PastMedalRecord[] = [{ resultId: 'r1', competitionId: 'e-cc-longsword', eventId: 'e-cc', finalPlace: 1, status: 'unverified', note: null, reportedAt: '2026-10-17T00:00:00Z' }];
    const g = medalsAtPastTournaments(results, events, records);
    expect(g.map(x => x.event.slug)).toEqual(['coulee-clash-2026', 'strathmore-summer-siege-2025']);
    expect(g[0].medals.map(m => [m.result.category, m.result.finalPlace, m.record?.status ?? null])).toEqual([['longsword', 1, 'unverified'], ['sabre', 2, null]]);
  });
});
