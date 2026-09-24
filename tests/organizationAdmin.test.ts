import { expect, test } from 'vitest';
import { allowedInviteRoles, membershipInvitePath } from '../src/lib/organizationAdmin';

const none = {
  platformAdmin: false,
  organizationAdmin: false,
  clubAdmin: false,
  teamAdmin: false,
  captain: false
};

test('invite role options preserve delegation boundaries', () => {
  expect(allowedInviteRoles('club', { ...none, clubAdmin: true })).toEqual(['coach', 'member']);
  expect(allowedInviteRoles('club', { ...none, organizationAdmin: true })).toEqual(['club_admin', 'coach', 'member']);
  expect(allowedInviteRoles('team', { ...none, captain: true })).toEqual(['coach', 'fighter', 'support']);
  expect(allowedInviteRoles('team', { ...none, teamAdmin: true })).toEqual(['captain', 'coach', 'fighter', 'support']);
  expect(allowedInviteRoles('team', { ...none, organizationAdmin: true })).toContain('team_admin');
  expect(allowedInviteRoles('team', none)).toEqual([]);
});

test('membership invitation route safely encodes its token', () => {
  expect(membershipInvitePath('abc/123?x=1')).toBe('/ops/invite?token=abc%2F123%3Fx%3D1');
});
