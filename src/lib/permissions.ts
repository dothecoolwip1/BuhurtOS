import type { EventRole, UserContext, UUID } from '../types';

export type Permission =
  | 'platform.admin'
  | 'organization.manage'
  | 'season.manage'
  | 'ruleset.manage'
  | 'division.manage'
  | 'club.manage'
  | 'team.manage'
  | 'fighter.manage'
  | 'fighter.claim.review'
  | 'duplicate.merge'
  | 'roles.manage'
  | 'event.view_private'
  | 'event.manage'
  | 'roster.manage'
  | 'registration.manage'
  | 'armor.inspect'
  | 'medical.manage'
  | 'match.manage'
  | 'match.score'
  | 'bracket.manage'
  | 'announcement.manage'
  | 'discipline.manage'
  | 'notes.team'
  | 'profile.self';

const ALL_NON_PLATFORM_PERMISSIONS: readonly Permission[] = [
  'organization.manage','season.manage','ruleset.manage','division.manage','club.manage','team.manage','fighter.manage',
  'fighter.claim.review','duplicate.merge','roles.manage','event.view_private','event.manage','roster.manage',
  'registration.manage','armor.inspect','medical.manage','match.manage','match.score','bracket.manage',
  'announcement.manage','discipline.manage','notes.team','profile.self'
];

export const EVENT_ROLE_PERMISSIONS: Record<EventRole, readonly Permission[]> = {
  tournament_director: ['event.view_private','event.manage','roster.manage','registration.manage','armor.inspect','medical.manage','match.manage','match.score','bracket.manage','announcement.manage','discipline.manage','notes.team'],
  event_organizer: ['event.view_private','event.manage','roster.manage','registration.manage','armor.inspect','medical.manage','match.manage','match.score','bracket.manage','announcement.manage','discipline.manage','notes.team'],
  field_marshal: ['event.view_private','roster.manage','armor.inspect','match.manage','match.score','announcement.manage','discipline.manage','notes.team'],
  assistant_marshal: ['event.view_private','roster.manage','armor.inspect','match.manage','match.score','announcement.manage','notes.team'],
  scorekeeper: ['event.view_private','match.score'],
  registration_staff: ['event.view_private','registration.manage','roster.manage'],
  armor_inspector: ['event.view_private','armor.inspect'],
  medical_staff: ['event.view_private','medical.manage'],
  team_captain: ['event.view_private','team.manage','notes.team'],
  fighter: ['event.view_private','profile.self']
};

function grantMatches(
  grant: UserContext['permissionGrants'][number],
  permission: Permission,
  eventId?: UUID,
  organizationId?: UUID,
  teamId?: UUID
): boolean {
  if (grant.permission !== permission) return false;
  if (grant.organizationId && grant.organizationId !== organizationId) return false;
  if (grant.eventId && grant.eventId !== eventId) return false;
  if (grant.teamId && grant.teamId !== teamId) return false;
  return true;
}

export function hasPermission(
  user: UserContext | null,
  permission: Permission,
  eventId?: UUID,
  organizationId?: UUID,
  teamId?: UUID
): boolean {
  if (!user) return false;
  if (user.platformRoles.includes('platform_super_admin')) return true;

  if (user.permissionGrants.some(grant => grantMatches(grant, permission, eventId, organizationId, teamId))) {
    return true;
  }

  if (
    organizationId
    && user.organizationRoles.some(role => role.organizationId === organizationId && role.role === 'organization_admin')
    && ALL_NON_PLATFORM_PERMISSIONS.includes(permission)
  ) {
    return true;
  }

  if (
    organizationId
    && user.organizationRoles.some(role => role.organizationId === organizationId && role.role === 'organization_staff')
    && (permission === 'event.view_private' || permission === 'profile.self')
  ) {
    return true;
  }

  if (permission === 'profile.self') return true;
  if (!eventId) return false;

  return user.eventRoles.some(role =>
    role.eventId === eventId
    && (!role.teamId || !teamId || role.teamId === teamId)
    && EVENT_ROLE_PERMISSIONS[role.role].includes(permission)
  );
}
