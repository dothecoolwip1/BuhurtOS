import { describe, expect, it } from 'vitest';
import { checkinQrPath, checkinUrl, deskCounts, matchWarnings, filterDesk, filterOptions, matchesFilter, sortDesk, teamSummary, type ReadinessRow } from './readiness';

const row = (over: Partial<ReadinessRow>): ReadinessRow => ({
  registrationId: 'r', fighterId: 'f', fullName: 'Name', teamId: null, teamName: null, competitions: [], isVolunteer: false, status: 'accepted',
  attendance: 'expected', inspection: 'not_inspected', issues: [], note: null, inspectedAt: null, inspectedBy: null, reinspected: false, insuranceOk: true, feeOk: true,
  overrideActive: false, overrideReason: null, profight: false, declaredWeight: null, weightKg: null, ready: false, reasons: ['Not checked in', 'Armour inspection required'], ...over
});
const rows = [
  row({ registrationId: 'a', fullName: 'Aldric', teamName: 'Iron', competitions: ['Longsword'] }),
  row({ registrationId: 'b', fullName: 'Brann', attendance: 'arrived', competitions: ['Profight'] }),
  row({ registrationId: 'c', fullName: 'Cael', attendance: 'checked_in', inspection: 'conditional', issues: ['shield'], teamName: 'Iron' }),
  row({ registrationId: 'd', fullName: 'Dara', attendance: 'checked_in', inspection: 'passed', ready: true, reasons: [] }),
  row({ registrationId: 'e', fullName: 'Edric', status: 'withdrawn', attendance: 'withdrawn' }),
  row({ registrationId: 'v', fullName: 'Vol', isVolunteer: true, attendance: 'checked_in', inspection: 'not_needed', ready: true, reasons: [] })
];

describe('readiness desk helpers (Pack 16)', () => {
  it('counts the day at a glance', () => {
    expect(deskCounts(rows)).toEqual({ expected: 5, arrived: 4, checkedIn: 3, needsInspection: 2, issues: 1, ready: 2, missing: 1, withdrawn: 1 });
  });
  it('filters: not ready, missing, arrived, needs inspection, issues, ready (withdrawn people are never in the working lists)', () => {
    const ids = (f: Parameters<typeof matchesFilter>[1]) => rows.filter(r => matchesFilter(r, f)).map(r => r.registrationId).join('');
    expect(ids('not_ready')).toBe('abc');
    expect(ids('missing')).toBe('a');
    expect(ids('arrived')).toBe('b');
    expect(ids('needs_inspection')).toBe('ab');
    expect(ids('issues')).toBe('c');
    expect(ids('ready')).toBe('dv');
    expect(ids('all')).toBe('abcdv');
  });
  it('search finds by name, team or competition; team and competition menus narrow it', () => {
    expect(filterDesk(rows, { filter: 'all', query: 'iron', team: null, competition: null }).map(r => r.registrationId)).toEqual(['a', 'c']);
    expect(filterDesk(rows, { filter: 'all', query: 'profight', team: null, competition: null }).map(r => r.registrationId)).toEqual(['b']);
    expect(filterDesk(rows, { filter: 'not_ready', query: '', team: 'Iron', competition: null }).map(r => r.registrationId)).toEqual(['a', 'c']);
    expect(filterDesk(rows, { filter: 'all', query: '', team: null, competition: 'Longsword' }).map(r => r.registrationId)).toEqual(['a']);
    expect(filterOptions(rows)).toEqual({ teams: ['Iron'], competitions: ['Longsword', 'Profight'] });
  });
  it('alphabetical (cards do not jump when a status changes); a scanned person is pinned to the top', () => {
    expect(sortDesk(rows).map(r => r.fullName)).toEqual(rows.map(r => r.fullName).sort((x, y) => x.localeCompare(y)));
    expect(sortDesk(rows.map(r => (r.registrationId === 'a' ? { ...r, ready: !r.ready } : r))).map(r => r.registrationId)).toEqual(sortDesk(rows).map(r => r.registrationId));
    expect(sortDesk(rows, 'd')[0].registrationId).toBe('d');
  });
  it('the QR holds only the desk address and an opaque id', () => {
    expect(checkinQrPath('rumble', '00000000-0000-0000-0000-000000000001')).toBe('/events/rumble/checkin?r=00000000-0000-0000-0000-000000000001');
  });
  it('captain summary counts fighters, not volunteers', () => {
    expect(teamSummary([{ isVolunteer: false, attendance: 'checked_in', ready: true }, { isVolunteer: false, attendance: 'checked_in', ready: false }, { isVolunteer: false, attendance: 'expected', ready: false }, { isVolunteer: true, attendance: 'checked_in', ready: true }]))
      .toBe('2/3 checked in · 1/3 ready');
  });
  it('the full check-in link respects the deploy base path', () => {
    expect(checkinUrl('https://x.test', '/', 'rumble', 'id1')).toBe('https://x.test/events/rumble/checkin?r=id1');
    expect(checkinUrl('https://x.test', '/BuhurtOS/', 'rumble', 'id1')).toBe('https://x.test/BuhurtOS/events/rumble/checkin?r=id1');
  });
  it('Lyst warning: only tracked fighters who are not ready, in plain words', () => {
    expect(matchWarnings([
      { name: 'Brann Oakley', tracked: true, ready: false, reasons: ['Armour needs correction'] },
      { name: 'Ready Rae', tracked: true, ready: true, reasons: [] },
      { name: 'Added By Organizer', tracked: false, ready: false, reasons: [] },
      { name: 'Late Lou', tracked: true, ready: false, reasons: ['Not checked in', 'Armour inspection required'] }
    ])).toEqual(['Brann Oakley: armour needs correction', 'Late Lou: not checked in, Armour inspection required']);
    expect(matchWarnings([])).toEqual([]);
  });
});

describe('Pack 22: a suspension is a block, not a reason to override', () => {
  it('recognizes the database\'s suspension wording only', async () => {
    const { disciplineBlock, isDisciplineBlock } = await import('./readiness');
    expect(isDisciplineBlock('Suspended for the rest of this event')).toBe(true);
    expect(isDisciplineBlock('Suspended from Org A events until 2026-11-15')).toBe(true);
    expect(isDisciplineBlock('Armour failed inspection')).toBe(false);
    expect(disciplineBlock(['Not checked in', 'Suspended from all events (no end date)'])).toBe('Suspended from all events (no end date)');
    expect(disciplineBlock(['Not checked in'])).toBeNull();
  });
});
