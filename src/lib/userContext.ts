import type { UserContext } from '../types';
import { supabase } from './supabase';

export async function loadUserContext(userId: string, displayName: string): Promise<UserContext> {
  if (!supabase) return { userId, displayName, platformRoles: [], organizationRoles: [], eventRoles: [] };
  const [platform, org, event] = await Promise.all([
    supabase.from('platform_memberships').select('role').eq('user_id', userId),
    supabase.from('organization_memberships').select('organization_id,role').eq('user_id', userId),
    supabase.from('event_memberships').select('event_id,role,team_id').eq('user_id', userId)
  ]);
  const error = platform.error || org.error || event.error;
  if (error) throw error;
  return {
    userId,
    displayName,
    platformRoles: (platform.data ?? []).map(r => r.role),
    organizationRoles: (org.data ?? []).map(r => ({ organizationId: r.organization_id, role: r.role })),
    eventRoles: (event.data ?? []).map(r => ({ eventId: r.event_id, role: r.role, teamId: r.team_id ?? undefined }))
  } as UserContext;
}
