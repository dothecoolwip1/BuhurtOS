import { describe, expect, it } from 'vitest';
import type { AdminOrganization } from '../data/organizations';
import { countDistinct, DISABLE_NOTICE, disableTitle, pendingText, platformGate, rankingsPath, splitOrgEvents, switchChecked, TOGGLE_IDLE, toggleBusy, toggleReducer, toOrgAdminRow, type ToggleAction, type ToggleState } from './platformOrgs';

const org = (p: Partial<AdminOrganization> = {}): AdminOrganization => ({
  id: 'o1', slug: 'nacl', name: 'North American Combat League', shortName: 'NACL', kind: 'regional', country: 'CA', region: null,
  enabled: true, disabledAt: null, disabledBy: null, teamsCount: 4, fightersCount: 40, eventsCompleted: 3, eventsCurrent: 1, eventsUpcoming: 2, adminsCount: 2, ...p
});

describe('toOrgAdminRow', () => {
  it('maps status, labels and the six counts in order', () => {
    const r = toOrgAdminRow(org());
    expect(r.statusLabel).toBe('Active');
    expect(r.shortLabel).toBe('NACL');
    expect(r.counts.map(c => c.label)).toEqual(['Teams', 'Fighters', 'Completed events', 'Current events', 'Upcoming events', 'Admins']);
    expect(r.counts.map(c => c.value)).toEqual([4, 40, 3, 1, 2, 2]);
  });
  it('marks disabled and drops a redundant or missing short name', () => {
    expect(toOrgAdminRow(org({ enabled: false })).statusLabel).toBe('Disabled');
    expect(toOrgAdminRow(org({ shortName: null })).shortLabel).toBeNull();
    expect(toOrgAdminRow(org({ shortName: 'North American Combat League' })).shortLabel).toBeNull();
  });
});

describe('toggle state machine', () => {
  const run = (s: ToggleState, ...a: ToggleAction[]) => a.reduce(toggleReducer, s);
  it('disabling asks first, then goes pending with the cleaned reason', () => {
    const s1 = run(TOGGLE_IDLE, { type: 'request', enabled: true });
    expect(s1).toEqual({ phase: 'confirm-disable', reason: '' });
    expect(run(s1, { type: 'reason', reason: 'abuse' })).toEqual({ phase: 'confirm-disable', reason: 'abuse' });
    expect(run(s1, { type: 'confirm', reason: 'abuse' })).toEqual({ phase: 'pending', target: false, reason: 'abuse' });
  });
  it('cancel returns to idle without calling anything', () => {
    expect(run(TOGGLE_IDLE, { type: 'request', enabled: true }, { type: 'cancel' })).toEqual(TOGGLE_IDLE);
  });
  it('enabling is one step: straight to pending, no dialog', () => {
    expect(run(TOGGLE_IDLE, { type: 'request', enabled: false })).toEqual({ phase: 'pending', target: true, reason: null });
  });
  it('ignores taps while pending or while the dialog is open', () => {
    const p = run(TOGGLE_IDLE, { type: 'request', enabled: false });
    expect(run(p, { type: 'request', enabled: false })).toBe(p);
    const c = run(TOGGLE_IDLE, { type: 'request', enabled: true });
    expect(run(c, { type: 'request', enabled: true })).toBe(c);
    expect(toggleBusy(p)).toBe(true);
  });
  it('a refusal becomes a failed state with the message, and can be dismissed', () => {
    const f = run(TOGGLE_IDLE, { type: 'request', enabled: true }, { type: 'confirm', reason: null }, { type: 'fail', message: 'You do not have permission to do that.' });
    expect(f).toEqual({ phase: 'failed', target: false, message: 'You do not have permission to do that.' });
    expect(run(f, { type: 'dismiss' })).toEqual(TOGGLE_IDLE);
  });
  it('done only ends a pending call', () => {
    expect(run(TOGGLE_IDLE, { type: 'done' })).toEqual(TOGGLE_IDLE);
    expect(run(TOGGLE_IDLE, { type: 'request', enabled: false }, { type: 'done' })).toEqual(TOGGLE_IDLE);
  });
  it('is never optimistic: the switch shows the server value in every phase', () => {
    const phases: ToggleState[] = [TOGGLE_IDLE, { phase: 'pending', target: false, reason: null }, { phase: 'failed', target: true, message: 'x' }];
    for (const s of phases) {
      expect(switchChecked(true, s)).toBe(true);
      expect(switchChecked(false, s)).toBe(false);
    }
    expect(pendingText({ phase: 'pending', target: false, reason: null })).toBe('Disabling…');
  });
  it('dialog wording', () => {
    expect(disableTitle('NACL')).toBe('Disable NACL?');
    expect(DISABLE_NOTICE).toContain('preserving teams, fighters, tournament history, rankings, statistics, and records');
  });
});

describe('splitOrgEvents', () => {
  const ev = (id: string, startsOn: string, endsOn: string, status = 'published') => ({ id, slug: id, name: id, startsOn, endsOn, status, city: null, region: null });
  const list = [ev('old', '2026-01-01', '2026-01-02'), ev('older', '2025-05-01', '2025-05-02'), ev('now', '2026-10-01', '2026-10-02'), ev('soon', '2026-12-01', '2026-12-02'), ev('draft', '2026-12-05', '2026-12-06', 'draft'), ev('x', '2027-01-01', '2027-01-02', 'cancelled')];
  it('enabled: upcoming ascending (including running), past newest first, no drafts or cancelled', () => {
    const v = splitOrgEvents(list, '2026-10-01', true);
    expect(v.upcoming.map(e => e.id)).toEqual(['now', 'soon']);
    expect(v.past.map(e => e.id)).toEqual(['old', 'older']);
  });
  it('disabled: history only', () => {
    const v = splitOrgEvents(list, '2026-10-01', false);
    expect(v.upcoming).toEqual([]);
    expect(v.past.map(e => e.id)).toEqual(['old', 'older']);
  });
});

describe('small helpers', () => {
  it('counts fighters once', () => { expect(countDistinct(['a', 'b'], ['b', 'c'])).toBe(3); });
  it('rankings link carries the slug', () => { expect(rankingsPath('hacsa')).toBe('/rankings?org=hacsa'); });
  it('platform gate never lets a non-owner through', () => {
    expect(platformGate(true, false, false, false)).toBe('loading');
    expect(platformGate(false, true, true, false)).toBe('loading');
    expect(platformGate(false, false, false, true)).toBe('denied');
    expect(platformGate(false, true, false, false)).toBe('denied');
    expect(platformGate(false, true, false, true)).toBe('owner');
  });
});
