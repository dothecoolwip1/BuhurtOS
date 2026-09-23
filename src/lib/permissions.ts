import type { EventRole, UserContext, UUID } from '../types';

export type Permission =
  | 'event.view_private'
  | 'event.manage'
  | 'roster.manage'
  | 'match.manage'
  | 'match.score'
  | 'bracket.manage'
  | 'announcement.manage'
  | 'discipline.manage'
  | 'notes.team'
  | 'profile.self'
  | 'schedule.manage'
  | 'ring.manage'
  | 'result.validate'
  | 'correction.review'
  | 'ranking.manage';

const EVENT_ROLE_PERMISSIONS: Record<EventRole, Permission[]> = {
  event_organizer: ['event.view_private', 'event.manage', 'roster.manage', 'match.manage', 'match.score', 'bracket.manage', 'announcement.manage', 'discipline.manage', 'notes.team', 'schedule.manage', 'ring.manage', 'result.validate', 'correction.review', 'ranking.manage'],
  tournament_director: ['event.view_private', 'event.manage', 'roster.manage', 'match.manage', 'match.score', 'bracket.manage', 'announcement.manage', 'discipline.manage', 'notes.team', 'schedule.manage', 'ring.manage', 'result.validate', 'correction.review', 'ranking.manage'],
  scorekeeper: ['event.view_private', 'match.score', 'match.manage'],
  registration_staff: ['event.view_private', 'roster.manage'],
  armor_inspector: ['event.view_private', 'roster.manage'],
  medical_staff: ['event.view_private', 'roster.manage'],
  field_marshal: ['event.view_private', 'roster.manage', 'match.manage', 'match.score', 'announcement.manage', 'discipline.manage', 'notes.team', 'schedule.manage', 'ring.manage', 'result.validate'],
  assistant_marshal: ['event.view_private', 'roster.manage', 'match.manage', 'match.score', 'announcement.manage', 'notes.team', 'ring.manage'],
  team_captain: ['event.view_private', 'notes.team'],
  fighter: ['event.view_private', 'profile.self']
};

export function hasPermission(user: UserContext | null, permission: Permission, eventId?: UUID, organizationId?: UUID): boolean {
  if (!user) return false;
  if (user.platformRoles.includes('platform_super_admin')) return true;
  if (organizationId && user.organizationRoles.some(r => r.organizationId === organizationId && r.role === 'organization_admin')) return true;
  if (!eventId) return permission === 'profile.self';
  return user.eventRoles.some(r => r.eventId === eventId && EVENT_ROLE_PERMISSIONS[r.role].includes(permission));
}
