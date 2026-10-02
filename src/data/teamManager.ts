import { supabase } from '../lib/supabase';

/**
 * Team manager: join an existing team (a captain decides), request a new team (an organizer reviews), public rosters, notifications.
 * Every call is a database function that checks its own authority. Errors are thrown as-is so friendlyError can show the message.
 * Nothing here ever carries an email or an account id: people appear by display name only.
 */

export type JoinStatus = 'pending' | 'approved' | 'declined' | 'cancelled';
export type JoinDecision = 'approved' | 'declined';
export type NotificationKind = 'team_join_requested' | 'team_join_decided' | 'team_proposed';
export type SocialNetwork = 'facebook' | 'instagram' | 'youtube' | 'tiktok' | 'x' | 'discord' | 'twitch' | 'other';

export const MESSAGE_MAX = 500;
export const SOCIAL_NETWORKS: SocialNetwork[] = ['facebook', 'instagram', 'youtube', 'tiktok', 'x', 'discord', 'twitch', 'other'];

// ---------------------------------------------------------------- roster
export interface RosterMember { fighterId: string; displayName: string; role: string; isCaptain: boolean; mercenary: boolean; since: string | null }
type RosterDb = { fighter_id: string; display_name: string; role: string; is_captain: boolean; mercenary: boolean; since: string | null };
export const toRosterMember = (r: RosterDb): RosterMember => ({ fighterId: r.fighter_id, displayName: r.display_name, role: r.role, isCaptain: r.is_captain, mercenary: r.mercenary, since: r.since });

/** Public for approved teams. A pending team's roster is only returned to its captain, members and organizers; others get an empty list. */
export async function fetchTeamRoster(teamId: string): Promise<RosterMember[]> {
  const { data, error } = await supabase.rpc('team_roster', { p_team: teamId });
  if (error) throw error;
  return (data as RosterDb[]).map(toRosterMember);
}

// ---------------------------------------------------------------- join requests
export interface MyJoinRequest { id: string; teamId: string; teamName: string; teamSlug: string; status: JoinStatus; message: string | null; createdAt: string; decidedAt: string | null }
type MyJoinDb = { id: string; team_id: string; team_name: string; team_slug: string; status: JoinStatus; message: string | null; created_at: string; decided_at: string | null };
export const toMyJoinRequest = (r: MyJoinDb): MyJoinRequest => ({ id: r.id, teamId: r.team_id, teamName: r.team_name, teamSlug: r.team_slug, status: r.status, message: r.message, createdAt: r.created_at, decidedAt: r.decided_at });

export interface InboxRequest { id: string; teamId: string; teamName: string; teamSlug: string; requesterName: string; message: string | null; createdAt: string }
type InboxDb = { id: string; team_id: string; team_name: string; team_slug: string; requester_name: string; message: string | null; created_at: string };
export const toInboxRequest = (r: InboxDb): InboxRequest => ({ id: r.id, teamId: r.team_id, teamName: r.team_name, teamSlug: r.team_slug, requesterName: r.requester_name, message: r.message, createdAt: r.created_at });

/** Trims the message; empty becomes null. Returns an error text when it is too long. */
export function cleanJoinMessage(raw: string): { message: string | null; error: string | null } {
  const message = raw.trim() === '' ? null : raw.trim();
  return { message, error: message !== null && message.length > MESSAGE_MAX ? `Keep your message to ${MESSAGE_MAX} characters.` : null };
}

/** Returns the new request id. Refused for a team you are already part of, a second pending request, or a profile with no name. */
export async function requestTeamJoin(teamId: string, message: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('request_team_join', { p_team: teamId, p_message: message });
  if (error) throw error;
  return data as string;
}
export async function cancelTeamJoin(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_team_join', { p_request: requestId });
  if (error) throw error;
}
/** Callable by that team's captain, the owner or a platform organizer. Approving adds the person to the roster and notifies them. */
export async function decideTeamJoin(requestId: string, decision: JoinDecision): Promise<void> {
  const { error } = await supabase.rpc('decide_team_join', { p_request: requestId, p_decision: decision });
  if (error) throw error;
}
export async function fetchMyTeamRequests(): Promise<MyJoinRequest[]> {
  const { data, error } = await supabase.rpc('my_team_requests');
  if (error) throw error;
  return (data as MyJoinDb[]).map(toMyJoinRequest);
}
export async function fetchTeamRequestsInbox(): Promise<InboxRequest[]> {
  const { data, error } = await supabase.rpc('team_requests_inbox');
  if (error) throw error;
  return (data as InboxDb[]).map(toInboxRequest);
}

// ---------------------------------------------------------------- notifications
export interface AppNotification { id: string; kind: NotificationKind; payload: Record<string, unknown>; createdAt: string; readAt: string | null; unread: boolean }
type NotificationDb = { id: string; kind: NotificationKind; payload: Record<string, unknown> | null; created_at: string; read_at: string | null };
export const toNotification = (r: NotificationDb): AppNotification => ({ id: r.id, kind: r.kind, payload: r.payload ?? {}, createdAt: r.created_at, readAt: r.read_at, unread: r.read_at === null });

const text = (v: unknown, fallback: string) => (typeof v === 'string' && v !== '' ? v : fallback);

/** One plain sentence for a notification, built only from the safe fields the database puts in the payload. */
export function notificationText(n: Pick<AppNotification, 'kind' | 'payload'>): string {
  const team = text(n.payload.team_name, 'a team');
  switch (n.kind) {
    case 'team_join_requested': return `${text(n.payload.requester_name, 'Someone')} asked to join ${team}.`;
    case 'team_join_decided': return n.payload.decision === 'approved' ? `You are now on the roster of ${team}.` : `${team} declined your request to join.`;
    case 'team_proposed': return `${team} was proposed and is waiting for review.`;
    default: return 'You have a new notification.';
  }
}

export async function fetchMyNotifications(limit = 50): Promise<AppNotification[]> {
  const { data, error } = await supabase.rpc('my_notifications', { p_limit: limit });
  if (error) throw error;
  return (data as NotificationDb[]).map(toNotification);
}
/** Omit `ids` to mark every notification read. Returns how many changed. */
export async function markNotificationsRead(ids?: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null });
  if (error) throw error;
  return data as number;
}

// ---------------------------------------------------------------- new team request (the whole form)
export interface NewTeamForm {
  name: string; slug: string; city: string; region: string; country: string; description: string;
  website: string; socialLinks: Partial<Record<SocialNetwork, string>>; foundedYear: string; claimedOrganizations: string[];
  colors: [string, string] | null; crestDivision: string; initial: string;
  // Reviewer-only: stored apart from the team and never shown publicly.
  contactEmail: string; contactPhone: string; captainReason: string; notes: string;
}
export const emptyNewTeamForm = (): NewTeamForm => ({
  name: '', slug: '', city: '', region: '', country: '', description: '', website: '', socialLinks: {}, foundedYear: '', claimedOrganizations: [],
  colors: null, crestDivision: 'pale', initial: '', contactEmail: '', contactPhone: '', captainReason: '', notes: ''
});

const HTTPS_URL = /^https:\/\/[^\s/]+\.[^\s/]+([/?#]\S*)?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;

export const slugFromName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Mirrors the database rules so the form can say what is wrong before sending. The database stays the authority. */
export function validateNewTeam(f: NewTeamForm, now = new Date()): Partial<Record<keyof NewTeamForm, string>> {
  const e: Partial<Record<keyof NewTeamForm, string>> = {};
  const name = f.name.trim();
  if (name.length < 2 || name.length > 80) e.name = 'The team name must be 2 to 80 characters.';
  const slug = f.slug.trim() || slugFromName(name);
  if (!SLUG.test(slug) || slug.length > 60) e.slug = 'Use lowercase letters, numbers and dashes.';
  if (!f.city.trim()) e.city = 'City is required.';
  if (!f.country.trim()) e.country = 'Country is required.';
  if ([f.city, f.region, f.country].some(v => v.trim().length > 80)) e.city = 'City, region and country are at most 80 characters.';
  const d = f.description.trim().length;
  if (d < 10 || d > 500) e.description = 'Describe the team in 10 to 500 characters.';
  if (f.website.trim() && (f.website.trim().length > 300 || !HTTPS_URL.test(f.website.trim()))) e.website = 'Use a full https:// address.';
  for (const [k, v] of Object.entries(f.socialLinks)) {
    if (v && v.trim() && (!SOCIAL_NETWORKS.includes(k as SocialNetwork) || v.trim().length > 300 || !HTTPS_URL.test(v.trim()))) { e.socialLinks = `The ${k} link must be a full https:// address.`; break; }
  }
  if (f.foundedYear.trim()) {
    const y = Number(f.foundedYear);
    if (!/^\d{4}$/.test(f.foundedYear.trim()) || y < 1900 || y > now.getFullYear()) e.foundedYear = `Use a four digit year from 1900 to ${now.getFullYear()}.`;
  }
  const orgs = f.claimedOrganizations.map(o => o.trim()).filter(Boolean);
  if (orgs.length > 5 || orgs.some(o => o.length < 2 || o.length > 120)) e.claimedOrganizations = 'Name up to 5 organizations, 2 to 120 characters each.';
  if (f.colors && !f.colors.every(c => HEX.test(c))) e.colors = 'Colours must look like #2C4A8C.';
  if (f.initial.trim().length > 2) e.initial = 'The crest initial is one or two letters.';
  if (!EMAIL.test(f.contactEmail.trim()) || f.contactEmail.trim().length > 200) e.contactEmail = 'Give an email the reviewers can reach you on.';
  if (f.contactPhone.trim().length > 40) e.contactPhone = 'The phone number is at most 40 characters.';
  const r = f.captainReason.trim().length;
  if (r < 10 || r > 1000) e.captainReason = 'Say in 10 to 1000 characters why you are the captain.';
  if (f.notes.trim().length > 2000) e.notes = 'Notes are at most 2000 characters.';
  return e;
}

/** The jsonb the database function takes. Empty optional fields are left out. */
export function newTeamPayload(f: NewTeamForm): Record<string, unknown> {
  const opt = (v: string) => (v.trim() === '' ? undefined : v.trim());
  const social = Object.fromEntries(Object.entries(f.socialLinks).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, (v as string).trim()]));
  const orgs = f.claimedOrganizations.map(o => o.trim()).filter(Boolean);
  const p: Record<string, unknown> = {
    name: f.name.trim(), slug: opt(f.slug), city: f.city.trim(), region: opt(f.region), country: f.country.trim(), description: f.description.trim(),
    website: opt(f.website), social_links: Object.keys(social).length ? social : undefined, founded_year: opt(f.foundedYear) ? Number(f.foundedYear) : undefined,
    claimed_organizations: orgs.length ? orgs : undefined, colors: f.colors ?? undefined, crest_division: opt(f.crestDivision), initial: opt(f.initial),
    contact_email: f.contactEmail.trim(), contact_phone: opt(f.contactPhone), captain_reason: f.captainReason.trim(), notes: opt(f.notes)
  };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
}

/** Creates a pending team with the caller as captain. Returns the team id. */
export async function requestNewTeam(f: NewTeamForm): Promise<string> {
  const { data, error } = await supabase.rpc('request_new_team', { p_payload: newTeamPayload(f) });
  if (error) throw error;
  return data as string;
}

/** Reviewer-only (any organizer). */
export interface NewTeamRequestDetails { teamId: string; requestedByName: string | null; contactEmail: string; contactPhone: string | null; captainReason: string; notes: string | null; createdAt: string }
type DetailsDb = { team_id: string; requested_by_name: string | null; contact_email: string; contact_phone: string | null; captain_reason: string; notes: string | null; created_at: string };
export const toNewTeamRequestDetails = (r: DetailsDb): NewTeamRequestDetails => ({ teamId: r.team_id, requestedByName: r.requested_by_name, contactEmail: r.contact_email, contactPhone: r.contact_phone, captainReason: r.captain_reason, notes: r.notes, createdAt: r.created_at });

/** Null when the team has no request on file (for example a team made by create_team). */
export async function fetchNewTeamRequestDetails(teamId: string): Promise<NewTeamRequestDetails | null> {
  const { data, error } = await supabase.rpc('new_team_request_details', { p_team: teamId });
  if (error) throw error;
  const rows = data as DetailsDb[];
  return rows.length ? toNewTeamRequestDetails(rows[0]) : null;
}

// ---------------------------------------------------------------- public team profile
export interface TeamProfileExtras { description: string | null; website: string | null; socialLinks: Partial<Record<SocialNetwork, string>>; foundedYear: number | null; claimedOrganizations: string[] }
type ExtrasDb = { description: string | null; website: string | null; social_links: Record<string, string> | null; founded_year: number | null; claimed_organizations: string[] | null };
export const toTeamProfileExtras = (r: ExtrasDb): TeamProfileExtras => ({
  description: r.description, website: r.website, socialLinks: (r.social_links ?? {}) as Partial<Record<SocialNetwork, string>>, foundedYear: r.founded_year, claimedOrganizations: r.claimed_organizations ?? []
});
export const CLAIMED_LABEL = 'claimed, unverified';

export async function fetchTeamProfileExtras(slug: string): Promise<TeamProfileExtras | null> {
  const { data, error } = await supabase.from('teams').select('description,website,social_links,founded_year,claimed_organizations').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data ? toTeamProfileExtras(data as ExtrasDb) : null;
}

// ---------------------------------------------------------------- already on a team? / naming captains
/** Ids of the teams the signed-in person is already part of (captain, roster, or marked as their team). Empty when signed out. */
export async function fetchMyTeamIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc('my_team_ids');
  if (error) throw error;
  return (data as string[] | null) ?? [];
}

/** True when the person administers at least one organization. A person can always read their own staff rows. Only decides what to show. */
export async function fetchIsOrgAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('organization_staff').select('organization_id').eq('user_id', userId).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export interface TeamCaptain { userId: string; name: string | null; email: string }
type CaptainDb = { user_id: string; name: string | null; email: string };
/** Owner, platform organizer, or an admin of an organization the team belongs to. Anyone else gets a permission error. */
export async function fetchTeamCaptains(teamId: string): Promise<TeamCaptain[]> {
  const { data, error } = await supabase.rpc('list_team_captains', { p_team: teamId });
  if (error) throw error;
  return (data as CaptainDb[]).map(r => ({ userId: r.user_id, name: r.name, email: r.email }));
}
/** The person must have signed in once. Same authority as fetchTeamCaptains. */
export async function assignTeamCaptain(teamId: string, email: string): Promise<void> {
  const { error } = await supabase.rpc('assign_team_captain', { p_team: teamId, p_email: email.trim() });
  if (error) throw error;
}
export async function removeTeamCaptain(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_team_captain', { p_team: teamId, p_user: userId });
  if (error) throw error;
}
