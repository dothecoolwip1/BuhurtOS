import type {
  Club,
  ClubMembership,
  ClubRole,
  EntityVisibility,
  MembershipRequest,
  MembershipScope,
  Organization,
  OrganizationKind,
  OrganizationRelationship,
  OrganizationRelationshipKind,
  Team,
  TeamMembership,
  TeamRole,
  TeamStatus
} from '../types';
import { supabase } from './supabase';

export interface GovernanceSnapshot {
  organizations: Organization[];
  relationships: OrganizationRelationship[];
  clubs: Club[];
  teams: Team[];
  clubMemberships: ClubMembership[];
  teamMemberships: TeamMembership[];
  requests: MembershipRequest[];
}

export interface GovernanceAuthority {
  platformAdmin: boolean;
  organizationAdmin: boolean;
  clubAdmin: boolean;
  teamAdmin: boolean;
  captain: boolean;
}

const demoKey = (kind: string, organizationId: string) => 'buhurtos-demo-pack4-' + kind + '-' + organizationId;
const foundationClubKey = (organizationId: string) => 'buhurtos-demo-foundation-clubs-' + organizationId;

function readDemo<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeDemo<T>(key: string, value: T): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
}

function demoBaseOrganization(organizationId: string): Organization {
  return {
    id: organizationId,
    name: organizationId === 'org-hacsa' ? 'HACSA' : 'Current Organization',
    shortName: organizationId === 'org-hacsa' ? 'HACSA' : 'ORG',
    region: organizationId === 'org-hacsa' ? 'Canada' : 'Current region',
    status: 'active',
    kind: 'regional_organization',
    visibility: 'public'
  };
}

function rowToOrganization(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    region: row.region,
    status: row.status,
    kind: row.kind ?? undefined,
    visibility: row.visibility ?? undefined,
    countryCode: row.country_code ?? undefined,
    websiteUrl: row.website_url ?? undefined,
    publicContactEmail: row.public_contact_email ?? undefined
  };
}

function rowToRelationship(row: any): OrganizationRelationship {
  return {
    id: row.id,
    parentOrganizationId: row.parent_organization_id,
    childOrganizationId: row.child_organization_id,
    relationshipKind: row.relationship_kind,
    startsOn: row.starts_on,
    endsOn: row.ends_on ?? undefined
  };
}

function rowToClub(row: any): Club {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    shortName: row.short_name ?? undefined,
    region: row.region ?? undefined,
    websiteUrl: row.website_url ?? undefined,
    isActive: row.is_active,
    visibility: row.visibility ?? undefined,
    publicDescription: row.public_description ?? undefined,
    logoPath: row.logo_path ?? undefined,
    publicContactEmail: row.public_contact_email ?? undefined,
    deletedAt: row.deleted_at ?? undefined
  };
}

function rowToTeam(row: any): Team {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clubId: row.club_id ?? undefined,
    name: row.name,
    shortName: row.short_name ?? undefined,
    cityOrRegion: row.city_or_region ?? undefined,
    status: row.status ?? undefined,
    isActive: row.is_active,
    visibility: row.visibility ?? undefined,
    publicDescription: row.public_description ?? undefined,
    websiteUrl: row.website_url ?? undefined,
    publicContactEmail: row.public_contact_email ?? undefined,
    foundedOn: row.founded_on ?? undefined,
    deletedAt: row.deleted_at ?? undefined
  };
}

function rowToClubMembership(row: any): ClubMembership {
  return {
    id: row.id,
    clubId: row.club_id,
    userId: row.user_id,
    role: row.role,
    displayName: row.display_name,
    startsOn: row.starts_on,
    endsOn: row.ends_on ?? undefined
  };
}

function rowToTeamMembership(row: any): TeamMembership {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    fighterIdentityId: row.fighter_identity_id ?? undefined,
    role: row.role,
    displayName: row.display_name,
    startsOn: row.starts_on,
    endsOn: row.ends_on ?? undefined
  };
}

function rowToRequest(row: any): MembershipRequest {
  return {
    id: row.id,
    scope: row.scope,
    requestKind: row.request_kind,
    status: row.status,
    clubId: row.club_id ?? undefined,
    teamId: row.team_id ?? undefined,
    requestedClubRole: row.requested_club_role ?? undefined,
    requestedTeamRole: row.requested_team_role ?? undefined,
    requesterUserId: row.requester_user_id ?? undefined,
    inviteEmail: row.invite_email ?? undefined,
    inviteToken: row.invite_token ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    message: row.message ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at
  };
}

export function allowedInviteRoles(scope: MembershipScope, authority: GovernanceAuthority): Array<ClubRole | TeamRole> {
  if (scope === 'club') {
    if (authority.platformAdmin || authority.organizationAdmin) return ['club_admin', 'coach', 'member'];
    if (authority.clubAdmin) return ['coach', 'member'];
    return [];
  }

  if (authority.platformAdmin || authority.organizationAdmin || authority.clubAdmin) {
    return ['team_admin', 'captain', 'coach', 'fighter', 'support'];
  }
  if (authority.teamAdmin) return ['captain', 'coach', 'fighter', 'support'];
  if (authority.captain) return ['coach', 'fighter', 'support'];
  return [];
}

export function membershipInvitePath(token: string): string {
  return '/ops/invite?token=' + encodeURIComponent(token);
}

export async function loadGovernanceSnapshot(organizationId: string): Promise<GovernanceSnapshot> {
  if (!supabase) {
    const organizations = readDemo<Organization[]>(demoKey('organizations', organizationId), [demoBaseOrganization(organizationId)]);
    const clubs = readDemo<Club[]>(foundationClubKey(organizationId), []).filter(row => !row.deletedAt);
    return {
      organizations,
      relationships: readDemo<OrganizationRelationship[]>(demoKey('relationships', organizationId), []),
      clubs,
      teams: readDemo<Team[]>(demoKey('teams', organizationId), []).filter(row => !row.deletedAt),
      clubMemberships: readDemo<ClubMembership[]>(demoKey('club-memberships', organizationId), []).filter(row => !row.endsOn),
      teamMemberships: readDemo<TeamMembership[]>(demoKey('team-memberships', organizationId), []).filter(row => !row.endsOn),
      requests: readDemo<MembershipRequest[]>(demoKey('requests', organizationId), [])
    };
  }

  const [organizations, relationships, clubs, teams, clubMemberships, teamMemberships, requests] = await Promise.all([
    supabase.from('organizations').select('id,name,short_name,region,status,kind,visibility,country_code,website_url,public_contact_email').order('name'),
    supabase.from('organization_relationships').select('id,parent_organization_id,child_organization_id,relationship_kind,starts_on,ends_on').order('starts_on', { ascending: false }),
    supabase.from('clubs').select('id,organization_id,name,short_name,region,website_url,is_active,visibility,public_description,logo_path,public_contact_email,deleted_at').eq('organization_id', organizationId).is('deleted_at', null).order('name'),
    supabase.from('teams').select('id,organization_id,club_id,name,short_name,city_or_region,status,is_active,visibility,public_description,website_url,public_contact_email,founded_on,deleted_at').eq('organization_id', organizationId).is('deleted_at', null).order('name'),
    supabase.from('club_memberships').select('id,club_id,user_id,role,display_name,starts_on,ends_on').is('ends_on', null).order('display_name'),
    supabase.from('team_memberships').select('id,team_id,user_id,fighter_identity_id,role,display_name,starts_on,ends_on').is('ends_on', null).order('display_name'),
    supabase.from('membership_requests').select('id,scope,request_kind,status,club_id,team_id,requested_club_role,requested_team_role,requester_user_id,invite_email,invite_token,expires_at,message,created_by,created_at').order('created_at', { ascending: false })
  ]);

  const error = organizations.error || relationships.error || clubs.error || teams.error || clubMemberships.error || teamMemberships.error || requests.error;
  if (error) throw error;

  return {
    organizations: (organizations.data ?? []).map(rowToOrganization),
    relationships: (relationships.data ?? []).map(rowToRelationship),
    clubs: (clubs.data ?? []).map(rowToClub),
    teams: (teams.data ?? []).map(rowToTeam),
    clubMemberships: (clubMemberships.data ?? []).map(rowToClubMembership),
    teamMemberships: (teamMemberships.data ?? []).map(rowToTeamMembership),
    requests: (requests.data ?? []).map(rowToRequest)
  };
}

export async function createSubordinateOrganization(
  rootOrganizationId: string,
  input: { name: string; shortName: string; region: string; kind: OrganizationKind; visibility: EntityVisibility }
): Promise<string> {
  if (!input.name.trim() || !input.shortName.trim() || !input.region.trim()) throw new Error('Name, short name, and region are required.');

  if (!supabase) {
    const key = demoKey('organizations', rootOrganizationId);
    const rows = readDemo<Organization[]>(key, [demoBaseOrganization(rootOrganizationId)]);
    const id = crypto.randomUUID();
    rows.push({
      id,
      name: input.name.trim(),
      shortName: input.shortName.trim(),
      region: input.region.trim(),
      status: 'active',
      kind: input.kind,
      visibility: input.visibility
    });
    writeDemo(key, rows);

    const relKey = demoKey('relationships', rootOrganizationId);
    const rels = readDemo<OrganizationRelationship[]>(relKey, []);
    rels.push({
      id: crypto.randomUUID(),
      parentOrganizationId: rootOrganizationId,
      childOrganizationId: id,
      relationshipKind: 'governs',
      startsOn: new Date().toISOString().slice(0, 10)
    });
    writeDemo(relKey, rels);
    return id;
  }

  const { data, error } = await supabase.rpc('create_subordinate_organization', {
    p_parent_organization_id: rootOrganizationId,
    p_name: input.name.trim(),
    p_short_name: input.shortName.trim(),
    p_region: input.region.trim(),
    p_kind: input.kind,
    p_visibility: input.visibility
  });
  if (error) throw error;
  return data as string;
}

export async function createOrganizationRelationship(
  rootOrganizationId: string,
  parentId: string,
  childId: string,
  kind: OrganizationRelationshipKind
): Promise<string> {
  if (parentId === childId) throw new Error('Choose two different organizations.');

  if (!supabase) {
    const key = demoKey('relationships', rootOrganizationId);
    const rows = readDemo<OrganizationRelationship[]>(key, []);
    if (rows.some(row => !row.endsOn && row.parentOrganizationId === parentId && row.childOrganizationId === childId && row.relationshipKind === kind)) {
      throw new Error('That organization relationship is already active.');
    }
    const row: OrganizationRelationship = {
      id: crypto.randomUUID(),
      parentOrganizationId: parentId,
      childOrganizationId: childId,
      relationshipKind: kind,
      startsOn: new Date().toISOString().slice(0, 10)
    };
    writeDemo(key, [row, ...rows]);
    return row.id;
  }

  const { data, error } = await supabase.rpc('create_organization_relationship', {
    p_parent: parentId,
    p_child: childId,
    p_kind: kind,
    p_starts_on: new Date().toISOString().slice(0, 10)
  });
  if (error) throw error;
  return data as string;
}

export async function endOrganizationRelationship(rootOrganizationId: string, relationshipId: string): Promise<void> {
  if (!supabase) {
    const key = demoKey('relationships', rootOrganizationId);
    const rows = readDemo<OrganizationRelationship[]>(key, []);
    writeDemo(key, rows.map(row => row.id === relationshipId ? { ...row, endsOn: new Date().toISOString().slice(0, 10) } : row));
    return;
  }
  const { error } = await supabase.rpc('end_organization_relationship', {
    p_relationship: relationshipId,
    p_ends_on: new Date().toISOString().slice(0, 10)
  });
  if (error) throw error;
}

export async function createGovernanceClub(
  organizationId: string,
  input: { name: string; shortName?: string; region?: string; visibility: EntityVisibility; description?: string; websiteUrl?: string }
): Promise<string> {
  if (!input.name.trim()) throw new Error('Club name is required.');

  if (!supabase) {
    const key = foundationClubKey(organizationId);
    const rows = readDemo<Club[]>(key, []);
    if (rows.some(row => !row.deletedAt && row.name.toLowerCase() === input.name.trim().toLowerCase())) throw new Error('An active club with that name already exists.');
    const id = crypto.randomUUID();
    rows.push({
      id,
      organizationId,
      name: input.name.trim(),
      shortName: input.shortName?.trim() || undefined,
      region: input.region?.trim() || undefined,
      websiteUrl: input.websiteUrl?.trim() || undefined,
      visibility: input.visibility,
      publicDescription: input.description?.trim() || undefined,
      isActive: true
    });
    writeDemo(key, rows);
    return id;
  }

  const { data, error } = await supabase.rpc('create_club', {
    p_organization: organizationId,
    p_name: input.name.trim(),
    p_short_name: input.shortName?.trim() || null,
    p_region: input.region?.trim() || null,
    p_visibility: input.visibility,
    p_description: input.description?.trim() || null,
    p_website: input.websiteUrl?.trim() || null
  });
  if (error) throw error;
  return data as string;
}

export async function updateGovernanceClub(
  organizationId: string,
  clubId: string,
  input: { name: string; shortName?: string; region?: string; visibility: EntityVisibility; description?: string; websiteUrl?: string }
): Promise<void> {
  if (!input.name.trim()) throw new Error('Club name is required.');

  if (!supabase) {
    const key = foundationClubKey(organizationId);
    const rows = readDemo<Club[]>(key, []);
    writeDemo(key, rows.map(row => row.id === clubId ? {
      ...row,
      name: input.name.trim(),
      shortName: input.shortName?.trim() || undefined,
      region: input.region?.trim() || undefined,
      websiteUrl: input.websiteUrl?.trim() || undefined,
      visibility: input.visibility,
      publicDescription: input.description?.trim() || undefined
    } : row));
    return;
  }

  const { error } = await supabase.rpc('update_club', {
    p_club: clubId,
    p_name: input.name.trim(),
    p_short_name: input.shortName?.trim() || null,
    p_region: input.region?.trim() || null,
    p_visibility: input.visibility,
    p_description: input.description?.trim() || null,
    p_website: input.websiteUrl?.trim() || null
  });
  if (error) throw error;
}

export async function archiveGovernanceClub(organizationId: string, clubId: string): Promise<void> {
  if (!supabase) {
    const key = foundationClubKey(organizationId);
    const rows = readDemo<Club[]>(key, []);
    const deletedAt = new Date().toISOString();
    writeDemo(key, rows.map(row => row.id === clubId ? { ...row, isActive: false, deletedAt } : row));
    return;
  }
  const { error } = await supabase.rpc('archive_club', { p_club: clubId });
  if (error) throw error;
}

export async function createGovernanceTeam(
  organizationId: string,
  input: { clubId?: string; name: string; shortName?: string; region?: string; visibility: EntityVisibility; description?: string }
): Promise<string> {
  if (!input.name.trim()) throw new Error('Team name is required.');

  if (!supabase) {
    const key = demoKey('teams', organizationId);
    const rows = readDemo<Team[]>(key, []);
    if (rows.some(row => !row.deletedAt && row.name.toLowerCase() === input.name.trim().toLowerCase())) throw new Error('An active or pending team with that name already exists.');
    const id = crypto.randomUUID();
    rows.push({
      id,
      organizationId,
      clubId: input.clubId || undefined,
      name: input.name.trim(),
      shortName: input.shortName?.trim() || undefined,
      cityOrRegion: input.region?.trim() || undefined,
      status: 'active',
      isActive: true,
      visibility: input.visibility,
      publicDescription: input.description?.trim() || undefined
    });
    writeDemo(key, rows);
    return id;
  }

  const { data, error } = await supabase.rpc('create_team', {
    p_organization: organizationId,
    p_club: input.clubId || null,
    p_name: input.name.trim(),
    p_short_name: input.shortName?.trim() || null,
    p_region: input.region?.trim() || null,
    p_visibility: input.visibility,
    p_description: input.description?.trim() || null
  });
  if (error) throw error;
  return data as string;
}

export async function updateGovernanceTeam(
  organizationId: string,
  teamId: string,
  input: { clubId?: string; name: string; shortName?: string; region?: string; visibility: EntityVisibility; description?: string }
): Promise<void> {
  if (!input.name.trim()) throw new Error('Team name is required.');

  if (!supabase) {
    const key = demoKey('teams', organizationId);
    const rows = readDemo<Team[]>(key, []);
    writeDemo(key, rows.map(row => row.id === teamId ? {
      ...row,
      clubId: input.clubId || undefined,
      name: input.name.trim(),
      shortName: input.shortName?.trim() || undefined,
      cityOrRegion: input.region?.trim() || undefined,
      visibility: input.visibility,
      publicDescription: input.description?.trim() || undefined
    } : row));
    return;
  }

  const { error } = await supabase.rpc('update_team', {
    p_team: teamId,
    p_club: input.clubId || null,
    p_name: input.name.trim(),
    p_short_name: input.shortName?.trim() || null,
    p_region: input.region?.trim() || null,
    p_visibility: input.visibility,
    p_description: input.description?.trim() || null
  });
  if (error) throw error;
}

export async function setGovernanceTeamStatus(organizationId: string, teamId: string, status: TeamStatus): Promise<void> {
  if (!supabase) {
    const key = demoKey('teams', organizationId);
    const rows = readDemo<Team[]>(key, []);
    writeDemo(key, rows.map(row => row.id === teamId ? { ...row, status, isActive: status === 'active' } : row));
    return;
  }
  const { error } = await supabase.rpc('set_team_status', { p_team: teamId, p_status: status });
  if (error) throw error;
}

export async function archiveGovernanceTeam(organizationId: string, teamId: string): Promise<void> {
  if (!supabase) {
    const key = demoKey('teams', organizationId);
    const rows = readDemo<Team[]>(key, []);
    const deletedAt = new Date().toISOString();
    writeDemo(key, rows.map(row => row.id === teamId ? { ...row, status: 'archived', isActive: false, deletedAt } : row));
    return;
  }
  const { error } = await supabase.rpc('archive_team', { p_team: teamId });
  if (error) throw error;
}

export async function createMembershipInvitation(
  organizationId: string,
  input: { scope: MembershipScope; targetId: string; email: string; clubRole?: ClubRole; teamRole?: TeamRole; message?: string }
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('A valid invitation email is required.');

  if (!supabase) {
    const key = demoKey('requests', organizationId);
    const rows = readDemo<MembershipRequest[]>(key, []);
    const token = crypto.randomUUID();
    const row: MembershipRequest = {
      id: crypto.randomUUID(),
      scope: input.scope,
      requestKind: 'invitation',
      status: 'pending',
      clubId: input.scope === 'club' ? input.targetId : undefined,
      teamId: input.scope === 'team' ? input.targetId : undefined,
      requestedClubRole: input.scope === 'club' ? input.clubRole : undefined,
      requestedTeamRole: input.scope === 'team' ? input.teamRole : undefined,
      inviteEmail: email,
      inviteToken: token,
      expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      message: input.message?.trim() || undefined,
      createdBy: 'demo-admin',
      createdAt: new Date().toISOString()
    };
    writeDemo(key, [row, ...rows]);
    return token;
  }

  const { data, error } = await supabase.rpc('create_membership_invitation', {
    p_scope: input.scope,
    p_target: input.targetId,
    p_email: email,
    p_club_role: input.clubRole || null,
    p_team_role: input.teamRole || null,
    p_message: input.message?.trim() || null
  });
  if (error) throw error;
  return data as string;
}

export async function requestMembership(
  organizationId: string,
  input: { scope: MembershipScope; targetId: string; clubRole?: ClubRole; teamRole?: TeamRole; message?: string; userId?: string; displayName?: string }
): Promise<string> {
  if (!supabase) {
    const key = demoKey('requests', organizationId);
    const rows = readDemo<MembershipRequest[]>(key, []);
    const row: MembershipRequest = {
      id: crypto.randomUUID(),
      scope: input.scope,
      requestKind: 'application',
      status: 'pending',
      clubId: input.scope === 'club' ? input.targetId : undefined,
      teamId: input.scope === 'team' ? input.targetId : undefined,
      requestedClubRole: input.scope === 'club' ? input.clubRole : undefined,
      requestedTeamRole: input.scope === 'team' ? input.teamRole : undefined,
      requesterUserId: input.userId || 'demo-admin',
      message: input.message?.trim() || undefined,
      createdBy: input.userId || 'demo-admin',
      createdAt: new Date().toISOString()
    };
    if (rows.some(existing => existing.status === 'pending' && existing.requestKind === 'application' && existing.scope === row.scope && existing.clubId === row.clubId && existing.teamId === row.teamId && existing.requesterUserId === row.requesterUserId)) {
      throw new Error('A matching membership request is already pending.');
    }
    writeDemo(key, [row, ...rows]);
    return row.id;
  }

  const { data, error } = await supabase.rpc('request_membership', {
    p_scope: input.scope,
    p_target: input.targetId,
    p_club_role: input.clubRole || null,
    p_team_role: input.teamRole || null,
    p_message: input.message?.trim() || null
  });
  if (error) throw error;
  return data as string;
}

function activateDemoMembership(
  organizationId: string,
  request: MembershipRequest,
  userId: string,
  displayName: string
): string {
  const now = new Date().toISOString().slice(0, 10);
  if (request.scope === 'club') {
    const key = demoKey('club-memberships', organizationId);
    const rows = readDemo<ClubMembership[]>(key, []);
    const existing = rows.find(row => !row.endsOn && row.clubId === request.clubId && row.userId === userId && row.role === request.requestedClubRole);
    if (existing) return existing.id;
    const row: ClubMembership = {
      id: crypto.randomUUID(),
      clubId: request.clubId!,
      userId,
      role: request.requestedClubRole!,
      displayName,
      startsOn: now
    };
    writeDemo(key, [row, ...rows]);
    return row.id;
  }

  const key = demoKey('team-memberships', organizationId);
  const rows = readDemo<TeamMembership[]>(key, []);
  const existing = rows.find(row => !row.endsOn && row.teamId === request.teamId && row.userId === userId && row.role === request.requestedTeamRole);
  if (existing) return existing.id;
  const row: TeamMembership = {
    id: crypto.randomUUID(),
    teamId: request.teamId!,
    userId,
    role: request.requestedTeamRole!,
    displayName,
    startsOn: now
  };
  writeDemo(key, [row, ...rows]);
  return row.id;
}

export async function acceptMembershipInvitation(
  organizationId: string,
  token: string,
  demoUser?: { userId: string; displayName: string }
): Promise<string> {
  if (!supabase) {
    const key = demoKey('requests', organizationId);
    const rows = readDemo<MembershipRequest[]>(key, []);
    const request = rows.find(row => row.inviteToken === token && row.requestKind === 'invitation');
    if (!request) throw new Error('Invitation not found.');
    if (request.status !== 'pending') throw new Error('Invitation is no longer pending.');
    if (request.expiresAt && new Date(request.expiresAt).getTime() <= Date.now()) throw new Error('Invitation has expired.');
    const actor = demoUser || { userId: 'demo-admin', displayName: 'Demo Event Organizer' };
    const membershipId = activateDemoMembership(organizationId, request, actor.userId, actor.displayName);
    writeDemo(key, rows.map(row => row.id === request.id ? { ...row, status: 'accepted', requesterUserId: actor.userId } : row));
    return membershipId;
  }

  const { data, error } = await supabase.rpc('accept_membership_invitation', { p_token: token });
  if (error) throw error;
  return data as string;
}

export async function reviewMembershipApplication(
  organizationId: string,
  requestId: string,
  decision: 'accept' | 'reject',
  demoDisplayName = 'Demo Member'
): Promise<void> {
  if (!supabase) {
    const key = demoKey('requests', organizationId);
    const rows = readDemo<MembershipRequest[]>(key, []);
    const request = rows.find(row => row.id === requestId && row.requestKind === 'application');
    if (!request) throw new Error('Membership application not found.');
    if (request.status !== 'pending') throw new Error('Membership application is no longer pending.');
    if (decision === 'accept') activateDemoMembership(organizationId, request, request.requesterUserId || 'demo-member', demoDisplayName);
    writeDemo(key, rows.map(row => row.id === requestId ? { ...row, status: decision === 'accept' ? 'accepted' : 'rejected' } : row));
    return;
  }

  const { error } = await supabase.rpc('review_membership_application', {
    p_request_id: requestId,
    p_decision: decision
  });
  if (error) throw error;
}

export async function cancelMembershipRequest(organizationId: string, requestId: string): Promise<void> {
  if (!supabase) {
    const key = demoKey('requests', organizationId);
    const rows = readDemo<MembershipRequest[]>(key, []);
    writeDemo(key, rows.map(row => row.id === requestId ? { ...row, status: 'cancelled' } : row));
    return;
  }
  const { error } = await supabase.rpc('cancel_membership_request', { p_request_id: requestId });
  if (error) throw error;
}

export async function endMembership(
  organizationId: string,
  scope: MembershipScope,
  membershipId: string
): Promise<void> {
  if (!supabase) {
    const key = demoKey(scope === 'club' ? 'club-memberships' : 'team-memberships', organizationId);
    const today = new Date().toISOString().slice(0, 10);
    if (scope === 'club') {
      const rows = readDemo<ClubMembership[]>(key, []);
      writeDemo(key, rows.map(row => row.id === membershipId ? { ...row, endsOn: today } : row));
    } else {
      const rows = readDemo<TeamMembership[]>(key, []);
      writeDemo(key, rows.map(row => row.id === membershipId ? { ...row, endsOn: today } : row));
    }
    return;
  }
  const { error } = await supabase.rpc('end_membership', {
    p_scope: scope,
    p_membership: membershipId,
    p_ends_on: new Date().toISOString().slice(0, 10)
  });
  if (error) throw error;
}

export async function changeMembershipRole(
  organizationId: string,
  scope: MembershipScope,
  membershipId: string,
  role: ClubRole | TeamRole
): Promise<void> {
  if (!supabase) {
    const key = demoKey(scope === 'club' ? 'club-memberships' : 'team-memberships', organizationId);
    const today = new Date().toISOString().slice(0, 10);
    if (scope === 'club') {
      const rows = readDemo<ClubMembership[]>(key, []);
      const current = rows.find(row => row.id === membershipId);
      if (!current) throw new Error('Active club membership not found.');
      const next: ClubMembership = { ...current, id: crypto.randomUUID(), role: role as ClubRole, startsOn: today, endsOn: undefined };
      writeDemo(key, [next, ...rows.map(row => row.id === membershipId ? { ...row, endsOn: today } : row)]);
    } else {
      const rows = readDemo<TeamMembership[]>(key, []);
      const current = rows.find(row => row.id === membershipId);
      if (!current) throw new Error('Active team membership not found.');
      const next: TeamMembership = { ...current, id: crypto.randomUUID(), role: role as TeamRole, startsOn: today, endsOn: undefined };
      writeDemo(key, [next, ...rows.map(row => row.id === membershipId ? { ...row, endsOn: today } : row)]);
    }
    return;
  }

  const { error } = await supabase.rpc('change_membership_role', {
    p_scope: scope,
    p_membership: membershipId,
    p_club_role: scope === 'club' ? role : null,
    p_team_role: scope === 'team' ? role : null
  });
  if (error) throw error;
}
