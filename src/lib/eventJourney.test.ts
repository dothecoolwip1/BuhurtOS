import { describe, expect, it } from 'vitest';
import { journey, stageState, type CompetitionFact, type JourneyFacts } from './eventJourney';

const comp = (id: string, o: Partial<CompetitionFact> = {}): CompetitionFact => ({ id, name: `Comp ${id}`, active: 0, fights: 0, fightsDone: 0, record: 'no_draw', ...o });
const base: JourneyFacts = {
  status: 'draft', eventType: 'tournament', closed: false, archived: false, competitions: [], registrations: { pending: 0, accepted: 0, total: 0 },
  checkin: { ready: 0, accepted: 0 }, publishBlockers: [], eventDay: false
};

describe('event journey: one recommended action per state', () => {
  it('a brand-new tournament with nothing in it: choose what you are fighting', () => {
    const j = journey(base);
    expect(j.stage).toBe('setup');
    expect(j.primary?.label).toBe('Choose competitions');
    expect(j.headline).toMatch(/Your event is created/);
  });
  it('a draft that still needs a waiver points at the waiver', () => {
    const j = journey({ ...base, competitions: [comp('a')], publishBlockers: [{ key: 'waiver', label: 'A waiver is loaded' }] });
    expect(j.primary).toMatchObject({ label: 'Add the waiver', target: { to: 'tab', tab: 'setup', query: 'focus=waiver' } });
  });
  it('a ready draft: Open registration', () => {
    expect(journey({ ...base, competitions: [comp('a')] }).primary).toMatchObject({ label: 'Open registration', target: { to: 'publish' } });
  });
  it('registration open with people waiting: review them', () => {
    const j = journey({ ...base, status: 'published', competitions: [comp('a', { active: 3 })], registrations: { pending: 2, accepted: 3, total: 5 } });
    expect(j.stage).toBe('registration');
    expect(j.primary?.label).toBe('Review 2 registrations');
    expect(j.secondary[0].label).toBe('Build tournament');
  });
  it('registration ready: Build tournament; empty divisions are not counted', () => {
    const j = journey({ ...base, status: 'published', competitions: [comp('a', { active: 4 }), comp('b', { active: 0 }), comp('c', { active: 1 })], registrations: { pending: 0, accepted: 5, total: 5 } });
    expect(j.stage).toBe('build');
    expect(j.primary?.label).toBe('Build tournament');
    expect(j.headline).toMatch(/1 competition has enough fighters/);
  });
  it('running: Live ops, with check-in as the next thing on the day', () => {
    const j = journey({ ...base, status: 'published', eventDay: true, competitions: [comp('a', { active: 4, fights: 6, fightsDone: 2, record: 'running' })], checkin: { ready: 23, accepted: 26 } });
    expect(j.stage).toBe('run');
    expect(j.primary?.label).toBe('Open Live ops');
    expect(j.secondary[0].label).toBe('Check in 3 fighters');
    expect(j.headline).toMatch(/4 fights to go/);
  });
  it('all fights of a competition done: Review wins & losses (never made official by itself)', () => {
    const j = journey({ ...base, status: 'published', competitions: [comp('a', { active: 4, fights: 6, fightsDone: 6, record: 'ready' }), comp('b', { active: 3, fights: 3, fightsDone: 1, record: 'running' })] });
    expect(j.stage).toBe('results');
    expect(j.primary).toMatchObject({ label: 'Review wins & losses', target: { to: 'review', competitionId: 'a' } });
  });
  it('everything official: Close event; an empty offered division does not block it', () => {
    const j = journey({ ...base, status: 'published', competitions: [comp('a', { active: 4, fights: 6, fightsDone: 6, record: 'official' }), comp('b', { active: 0 })] });
    expect(j.stage).toBe('close');
    expect(j.primary?.label).toBe('Close event');
  });
  it('closed: history, with Archive offered; archived: still history', () => {
    const closed = journey({ ...base, status: 'published', closed: true });
    expect(closed.stage).toBe('history');
    expect(closed.secondary[0].label).toBe('Archive event');
    expect(journey({ ...base, status: 'published', closed: true, archived: true }).headline).toMatch(/keep counting/);
  });
  it('the stepper marks done, current and to come', () => {
    expect(stageState('build', 'setup')).toBe('done');
    expect(stageState('build', 'build')).toBe('current');
    expect(stageState('build', 'close')).toBe('todo');
  });
});
