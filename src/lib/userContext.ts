import type { UserContext } from '../types';
import { supabase } from './supabase';

export async function loadUserContext(userId: string, displayName: string): Promise<UserContext> {
  if (!supabase) {
    return {
      userId,
      displayName,
      platformRoles: [],
      organizationRoles: [],
      eventRoles: [],
      clubRoles: [],
      teamRoles: []
    };
  }

  const [platform, org, event, club, team] = await Promise.all([
    supabase.from('platform_memberships').select('role').eq('user_id', userId),
    supabase.from('organization_memberships').select('organization_id,role').eq('user_id', userId),
    supabase.from('event_memberships').select('event_id,role,team_id').eq('user_id', userId),
    supabase.from('club_memberships').select('club_id,role').eq('user_id', userId).is('ends_on', null),
    supabase.from('team_memberships').select('team_id,role').eq('user_id', userId).is('ends_on', null)
  ]);

  const error = platform.error || org.error || event.error || club.error || team.error;
  if (error) throw error;

  return {
    userId,
    displayName,
    platformRoles: (platform.data ?? []).map(row => row.role),
    organizationRoles: (org.data ?? []).map(row => ({
      organizationId: row.organization_id,
      role: row.role
    })),
    eventRoles: (event.data ?? []).map(row => ({
      eventId: row.event_id,
      role: row.role,
      teamId: row.team_id ?? undefined
    })),
    clubRoles: (club.data ?? []).map(row => ({
      clubId: row.club_id,
      role: row.role
    })),
    teamRoles: (team.data ?? []).map(row => ({
      teamId: row.team_id,
      role: row.role
    }))
  } as UserContext;
}
