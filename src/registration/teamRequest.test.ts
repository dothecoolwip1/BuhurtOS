import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { addClaimed, charsLeft, descriptionCounter, editClaimed, effectiveSlug, emptyNewTeamForm, filterTeams, firstErrorField, myTeams, removeClaimed, setSocial, statusLabel, validateNewTeam } from './teamRequest';
import { badgeText, bellLabel, notificationLink, timeAgo, unreadCount, unreadIds } from '../lib/notificationView';

const t = (name: string, city: string | null) => ({ id: name, slug: name.toLowerCase(), name, city, region: null, country: null });

describe('team request helpers', () => {
  it('derives the address from the name unless one is typed', () => {
    expect(effectiveSlug({ name: 'Frost Gate!', slug: '' })).toBe('frost-gate');
    expect(effectiveSlug({ name: 'X', slug: 'mine' })).toBe('mine');
  });
  it('counts description characters', () => {
    expect(charsLeft('  abc ', 500)).toBe(497);
    expect(descriptionCounter('a'.repeat(501))).toBe('1 too many characters');
    expect(descriptionCounter('')).toBe('500 characters left');
  });
  it('edits social links and claimed organizations', () => {
    expect(setSocial({ x: 'https://x.com/a' }, 'x', '  ')).toEqual({});
    expect(setSocial({}, 'discord', 'https://d.gg/a')).toEqual({ discord: 'https://d.gg/a' });
    expect(addClaimed(['a', 'b', 'c', 'd', 'e'])).toHaveLength(5);
    expect(addClaimed(['a'])).toEqual(['a', '']);
    expect(removeClaimed(['a', 'b'], 0)).toEqual(['b']);
    expect(editClaimed(['a', 'b'], 1, 'z')).toEqual(['a', 'z']);
  });
  it('finds the first problem in page order', () => {
    expect(firstErrorField(validateNewTeam(emptyNewTeamForm()))).toBe('name');
    expect(firstErrorField({})).toBeNull();
  });
  it('searches by name or city, accent blind, needing two letters', () => {
    const list = [t('Frostgate', 'Edmonton'), t('Ordre du Lys', 'Montréal'), t('Iron Wolves', null)];
    expect(filterTeams(list, 'f')).toEqual([]);
    expect(filterTeams(list, 'frost').map(x => x.name)).toEqual(['Frostgate']);
    expect(filterTeams(list, 'montreal').map(x => x.name)).toEqual(['Ordre du Lys']);
  });
  it('lists my teams once each', () => {
    const req = (teamId: string, status: 'approved' | 'pending') => ({ id: 'r', teamId, teamName: 'N' + teamId, teamSlug: 's' + teamId, status, message: null, createdAt: '', decidedAt: null });
    const out = myTeams([{ teamId: 'a', name: 'A', slug: 'a', status: 'pending' }], [req('a', 'approved'), req('b', 'approved'), req('c', 'pending')]);
    expect(out.map(x => [x.teamId, x.captain, x.reviewing])).toEqual([['a', true, true], ['b', false, false]]);
    expect(statusLabel('pending')).toMatch(/Waiting/);
  });
});

describe('notification view', () => {
  it('links approvals to the team and everything else to the manager', () => {
    expect(notificationLink({ kind: 'team_join_decided', payload: { decision: 'approved', team_slug: 'frostgate' } })).toBe('/teams/frostgate');
    expect(notificationLink({ kind: 'team_join_decided', payload: { decision: 'approved', team_slug: '../x' } })).toBe('/team-manager');
    expect(notificationLink({ kind: 'team_join_requested', payload: {} })).toBe('/team-manager');
  });
  it('counts unread and formats the badge', () => {
    const l = [{ id: '1', unread: true }, { id: '2', unread: false }];
    expect(unreadCount(l)).toBe(1);
    expect(unreadIds(l)).toEqual(['1']);
    expect(badgeText(12)).toBe('9+');
    expect(bellLabel(0)).toBe('Notifications');
    expect(bellLabel(3)).toBe('Notifications, 3 unread');
  });
  it('words time simply', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(timeAgo('2026-10-01T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-10-01T11:55:00Z', now)).toBe('5 minutes ago');
    expect(timeAgo('2026-09-29T12:00:00Z', now)).toBe('2 days ago');
  });
});
