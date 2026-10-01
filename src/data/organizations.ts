import { supabase } from '../lib/supabase';

/**
 * Organizations and the platform switch.
 * The database enforces everything: only the platform owner can call set_organization_enabled / admin_list_organizations, and a disabled
 * organization's staff, captains and registrations are refused there. Nothing in the UI decides authority. Errors are thrown as-is.
 *
 * NEVER select('*') from organizations: disabled_by (an account id) is not readable through the API, so a star select is refused.
 * Use ORGANIZATION_COLUMNS.
 */

export const ORGANIZATION_COLUMNS = 'id,slug,name,kind,country,website,created_at,short_name,region,description,enabled,disabled_at';
export type OrganizationKind = 'federation' | 'national' | 'regional' | 'club' | 'other';

export interface Organization {
  id: string; slug: string; name: string; shortName: string | null; kind: OrganizationKind; country: string | null; region: string | null;
  website: string | null; description: string | null; enabled: boolean; disabledAt: string | null; createdAt: string;
}
type OrganizationDb = {
  id: string; slug: string; name: string; short_name: string | null; kind: OrganizationKind; country: string | null; region: string | null;
  website: string | null; description: string | null; enabled: boolean; disabled_at: string | null; created_at: string;
};
export const toOrganization = (r: OrganizationDb): Organization => ({
  id: r.id, slug: r.slug, name: r.name, shortName: r.short_name, kind: r.kind, country: r.country, region: r.region, website: r.website,
  description: r.description, enabled: r.enabled, disabledAt: r.disabled_at, createdAt: r.created_at
});

/** What a listing shows next to an organization. Disabled organizations stay readable (history), they are only marked. */
export const organizationStatusLabel = (o: { enabled: boolean }): 'Active' | 'Inactive' => (o.enabled ? 'Active' : 'Inactive');
/** Short name when there is one, else the full name. */
export const organizationLabel = (o: { name: string; shortName: string | null }): string => o.shortName ?? o.name;

/** Public. Every organization with its `enabled` flag, so a page can show 'Inactive'. */
export async function fetchOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabase.from('organizations').select(ORGANIZATION_COLUMNS).order('name');
  if (error) throw error;
  return (data as unknown as OrganizationDb[]).map(toOrganization);
}

// ---------------------------------------------------------------- list_active_organizations (public)
export interface ActiveOrganization { id: string; slug: string; name: string; shortName: string | null; kind: OrganizationKind; country: string | null; region: string | null; website: string | null; description: string | null }
type ActiveDb = { id: string; slug: string; name: string; short_name: string | null; kind: OrganizationKind; country: string | null; region: string | null; website: string | null; description: string | null };
export const toActiveOrganization = (r: ActiveDb): ActiveOrganization => ({
  id: r.id, slug: r.slug, name: r.name, shortName: r.short_name, kind: r.kind, country: r.country, region: r.region, website: r.website, description: r.description
});
/** Public. Only organizations that are switched on. */
export async function fetchActiveOrganizations(): Promise<ActiveOrganization[]> {
  const { data, error } = await supabase.rpc('list_active_organizations');
  if (error) throw error;
  return (data as ActiveDb[]).map(toActiveOrganization);
}

// ---------------------------------------------------------------- admin_list_organizations (owner only)
export interface AdminOrganization {
  id: string; slug: string; name: string; shortName: string | null; kind: OrganizationKind; country: string | null; region: string | null;
  enabled: boolean; disabledAt: string | null; disabledBy: string | null;
  teamsCount: number; fightersCount: number; eventsCompleted: number; eventsCurrent: number; eventsUpcoming: number; adminsCount: number;
}
type AdminDb = {
  id: string; slug: string; name: string; short_name: string | null; kind: OrganizationKind; country: string | null; region: string | null;
  enabled: boolean; disabled_at: string | null; disabled_by: string | null;
  teams_count: number | string; fighters_count: number | string; events_completed: number | string; events_current: number | string; events_upcoming: number | string; admins_count: number | string;
};
/** Counts arrive as bigint (strings through some clients); they are always plain numbers here. */
export const toAdminOrganization = (r: AdminDb): AdminOrganization => ({
  id: r.id, slug: r.slug, name: r.name, shortName: r.short_name, kind: r.kind, country: r.country, region: r.region,
  enabled: r.enabled, disabledAt: r.disabled_at, disabledBy: r.disabled_by,
  teamsCount: Number(r.teams_count), fightersCount: Number(r.fighters_count), eventsCompleted: Number(r.events_completed),
  eventsCurrent: Number(r.events_current), eventsUpcoming: Number(r.events_upcoming), adminsCount: Number(r.admins_count)
});
/** Platform owner only: every organization, including disabled ones, with counts. Anyone else gets a permission error. */
export async function fetchAdminOrganizations(): Promise<AdminOrganization[]> {
  const { data, error } = await supabase.rpc('admin_list_organizations');
  if (error) throw error;
  return (data as AdminDb[]).map(toAdminOrganization);
}

export const REASON_MAX = 500;
/** Trims the reason; empty becomes null. Returns an error text when it is too long. */
export function cleanReason(raw: string): { reason: string | null; error: string | null } {
  const reason = raw.trim() === '' ? null : raw.trim();
  return { reason, error: reason !== null && reason.length > REASON_MAX ? `Keep the reason to ${REASON_MAX} characters.` : null };
}
/** The arguments for set_organization_enabled, so a test can pin them. */
export const enabledArgs = (orgId: string, enabled: boolean, reason: string | null) => ({ p_org: orgId, p_enabled: enabled, p_reason: reason });

/**
 * Platform owner only. Nothing is deleted: disabling hides upcoming events and locks the organization's staff, captains and registrations;
 * enabling restores everything. Past events and results stay public either way.
 */
export async function setOrganizationEnabled(orgId: string, enabled: boolean, reason: string | null = null): Promise<void> {
  const { error } = await supabase.rpc('set_organization_enabled', enabledArgs(orgId, enabled, reason));
  if (error) throw error;
}

// ---------------------------------------------------------------- organization admins, event and season links
export interface OrganizationStaffMember { userId: string; email: string; role: 'admin' }
type StaffDb = { user_id: string; email: string; role: 'admin' };
export const toOrganizationStaff = (r: StaffDb): OrganizationStaffMember => ({ userId: r.user_id, email: r.email, role: r.role });
/** Owner or an admin of the (enabled) organization. */
export async function fetchOrganizationStaff(orgId: string): Promise<OrganizationStaffMember[]> {
  const { data, error } = await supabase.rpc('list_organization_staff', { p_org: orgId });
  if (error) throw error;
  return (data as StaffDb[]).map(toOrganizationStaff);
}
/** Owner only. The person must have signed in once. */
export async function grantOrganizationAdmin(orgId: string, email: string): Promise<void> {
  const { error } = await supabase.rpc('grant_organization_admin', { p_org: orgId, p_email: email.trim() });
  if (error) throw error;
}
export async function removeOrganizationAdmin(orgId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_organization_admin', { p_org: orgId, p_user: userId });
  if (error) throw error;
}
/** The event's organizer who is also an admin of that organization (or the owner). null unlinks (owner only). */
export async function setEventOrganization(eventId: string, orgId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_event_organization', { p_event: eventId, p_org: orgId });
  if (error) throw error;
}
/** An organizer of the event; a season that belongs to an organization also needs an admin of it. null clears. */
export async function setEventSeason(eventId: string, seasonId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_event_season', { p_event: eventId, p_season: seasonId });
  if (error) throw error;
}
export async function createSeason(orgId: string, slug: string, name: string, startsOn: string, endsOn: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_season', { p_org: orgId, p_slug: slug, p_name: name, p_starts_on: startsOn, p_ends_on: endsOn });
  if (error) throw error;
  return data as string;
}

/** teams_active: approved/visible teams whose organization is not disabled. Use it for pickers; use `teams` for history pages. */
export async function fetchActiveTeamSlugs(): Promise<string[]> {
  const { data, error } = await supabase.from('teams_active').select('slug').order('name');
  if (error) throw error;
  return (data as { slug: string }[]).map(r => r.slug);
}
