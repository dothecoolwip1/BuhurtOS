import type { ScopedPermissionGrant, UserContext } from '../types';
import { supabase } from './supabase';

function mapPermissionRows(rows: Array<Record<string, unknown>> | null | undefined): ScopedPermissionGrant[] {
  return (rows ?? []).map(row => ({
    permission: String(row.permission_key),
    organizationId: row.organization_id ? String(row.organization_id) : undefined,
    eventId: row.event_id ? String(row.event_id) : undefined,
    teamId: row.team_id ? String(row.team_id) : undefined
  }));
}

export async function loadUserContext(userId: string, displayName: string): Promise<UserContext> {
  if (!supabase) {
    return { userId, displayName, platformRoles: [], organizationRoles: [], eventRoles: [], permissionGrants: [] };
  }

  const [platform, org, event, permissions] = await Promise.all([
    supabase.from('platform_memberships').select('role').eq('user_id', userId),
    supabase.from('organization_memberships').select('organization_id,role').eq('user_id', userId),
    supabase.from('event_memberships').select('event_id,role,team_id').eq('user_id', userId),
    supabase.rpc('current_user_permissions')
  ]);

  const legacyError = platform.error || org.error || event.error;
  if (legacyError) throw legacyError;

  // During rolling deployments the permission RPC may not exist yet. Legacy memberships
  // remain a safe compatibility source until the database migration lands.
  const permissionGrants = permissions.error ? [] : mapPermissionRows(permissions.data as Array<Record<string, unknown>> | null);

  return {
    userId,
    displayName,
    platformRoles: (platform.data ?? []).map(row => row.role),
    organizationRoles: (org.data ?? []).map(row => ({ organizationId: row.organization_id, role: row.role })),
    eventRoles: (event.data ?? []).map(row => ({ eventId: row.event_id, role: row.role, teamId: row.team_id ?? undefined })),
    permissionGrants
  } as UserContext;
}
