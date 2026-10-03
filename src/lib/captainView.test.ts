import { describe, expect, it } from 'vitest';
import { captainRows } from './captainView';
import type { InboxRequest } from '../data/teamManager';

const req = (id: string, teamId: string): InboxRequest => ({ id, teamId, teamName: 'x', teamSlug: 'x', requesterName: 'Jo', message: null, createdAt: '2026-01-01T00:00:00Z' });

describe('captainRows', () => {
  const teams = [
    { teamId: 'b', name: 'Bears', slug: 'bears', status: 'approved' as const },
    { teamId: 'a', name: 'Aurochs', slug: 'aurochs', status: 'pending' as const }
  ];
  it('counts waiting requests per captained team only', () => {
    const rows = captainRows(teams, [req('1', 'b'), req('2', 'b'), req('3', 'other')]);
    expect(rows.find(r => r.teamId === 'b')?.waiting).toBe(2);
  });
  it('marks a proposed team as awaiting approval with no requests', () => {
    const a = captainRows(teams, [req('1', 'a')]).find(r => r.teamId === 'a');
    expect(a?.awaitingApproval).toBe(true);
    expect(a?.waiting).toBe(0);
  });
  it('is sorted by name and handles an empty inbox', () => {
    expect(captainRows(teams, []).map(r => r.name)).toEqual(['Aurochs', 'Bears']);
  });
});
