import { supabase } from '../lib/supabase';
import { cleanSocialLinks, type SocialNetwork } from './fighters';

/**
 * Platform owner only: list and edit ALL teams and fighters. Every call is a database function that refuses anyone who is not the platform owner
 * (organizers, org admins, captains, marshals and fighters get an error), so hiding the screen is a convenience, not the protection.
 * Lists include pending teams, teams of a disabled organization and unclaimed fighters. No account ids are returned. Errors are thrown as-is.
 */

const num = (v: number | string | null | undefined): number => Number(v ?? 0);
export const ADMIN_PAGE_MAX = 200;
export const clampLimit = (n: number): number => Math.min(Math.max(Math.trunc(n) || 50, 1), ADMIN_PAGE_MAX);

// ================================================================ lists
export interface AdminTeamRow {
  teamId: string; slug: string; name: string; status: 'approved' | 'pending'; city: string | null; region: string | null; country: string | null; logoPath: string | null; createdAt: string;
  organization: { id: string; slug: string; name: string; enabled: boolean } | null; rosterCount: number; captainCount: number; total: number;
}
type AdminTeamDb = {
  team_id: string; slug: string; name: string; status: 'approved' | 'pending'; city: string | null; region: string | null; country: string | null; logo_path: string | null; created_at: string;
  organization_id: string | null; organization_slug: string | null; organization_name: string | null; organization_enabled: boolean | null;
  roster_count: number | string; captain_count: number | string; total_count: number | string;
};
export const toAdminTeamRow = (r: AdminTeamDb): AdminTeamRow => ({
  teamId: r.team_id, slug: r.slug, name: r.name, status: r.status, city: r.city, region: r.region, country: r.country, logoPath: r.logo_path, createdAt: r.created_at,
  organization: r.organization_id && r.organization_slug && r.organization_name ? { id: r.organization_id, slug: r.organization_slug, name: r.organization_name, enabled: r.organization_enabled ?? true } : null,
  rosterCount: num(r.roster_count), captainCount: num(r.captain_count), total: num(r.total_count)
});
/** query matches name or slug. Returns the page and how many teams match in total (0 when the page is empty). */
export async function adminListTeams(query: string | null, limit = 50, offset = 0): Promise<{ rows: AdminTeamRow[]; total: number }> {
  const { data, error } = await supabase.rpc('admin_list_teams', { p_query: query && query.trim() !== '' ? query.trim() : null, p_limit: clampLimit(limit), p_offset: Math.max(0, Math.trunc(offset) || 0) });
  if (error) throw error;
  const rows = (data as AdminTeamDb[]).map(toAdminTeamRow);
  return { rows, total: rows.length ? rows[0].total : 0 };
}

export interface AdminFighterRow {
  fighterId: string; displayName: string; teamId: string | null; teamName: string | null; teamSlug: string | null; claimed: boolean;
  city: string | null; region: string | null; country: string | null; photoPath: string | null; profilePublic: boolean; createdAt: string; total: number;
}
type AdminFighterDb = {
  fighter_id: string; display_name: string; team_id: string | null; team_name: string | null; team_slug: string | null; claimed: boolean; city: string | null; region: string | null; country: string | null;
  photo_path: string | null; profile_public: boolean; created_at: string; total_count: number | string;
};
export const toAdminFighterRow = (r: AdminFighterDb): AdminFighterRow => ({
  fighterId: r.fighter_id, displayName: r.display_name, teamId: r.team_id, teamName: r.team_name, teamSlug: r.team_slug, claimed: r.claimed, city: r.city, region: r.region, country: r.country,
  photoPath: r.photo_path, profilePublic: r.profile_public, createdAt: r.created_at, total: num(r.total_count)
});
/** query matches the name; teamId keeps fighters currently on that team. Includes unclaimed fighters (claimed = false). */
export async function adminListFighters(query: string | null, teamId: string | null, limit = 50, offset = 0): Promise<{ rows: AdminFighterRow[]; total: number }> {
  const { data, error } = await supabase.rpc('admin_list_fighters', { p_query: query && query.trim() !== '' ? query.trim() : null, p_team: teamId, p_limit: clampLimit(limit), p_offset: Math.max(0, Math.trunc(offset) || 0) });
  if (error) throw error;
  const rows = (data as AdminFighterDb[]).map(toAdminFighterRow);
  return { rows, total: rows.length ? rows[0].total : 0 };
}

// ================================================================ edit a team
export interface TeamEditForm {
  name: string; slug: string; city: string; region: string; country: string; description: string; website: string; socialLinks: Partial<Record<SocialNetwork, string>>;
  colors: [string, string]; crestDivision: string; initial: string; status: 'approved' | 'pending'; foundedYear: string; claimedOrganizations: string[];
}
export const CREST_DIVISIONS = ['pale', 'fess', 'bend', 'chevron', 'quarterly', 'saltire'] as const;
const HTTPS_URL = /^https:\/\/[^\s/]+\.[^\s/]+([/?#]\S*)?$/;
export const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Same limits as the database (which has the final say; it also checks the slug is unique). */
export function validateTeamEdit(f: TeamEditForm, now: Date = new Date()): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2 || f.name.trim().length > 80) e.name = '2 to 80 characters.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.slug.trim()) || f.slug.trim().length > 60) e.slug = 'Lowercase letters, numbers and dashes only (at most 60).';
  for (const k of ['city', 'region', 'country'] as const) if (f[k].trim().length > 80) e[k] = 'At most 80 characters.';
  if (f.description.trim().length > 500) e.description = 'At most 500 characters.';
  if (f.website.trim() !== '' && (f.website.trim().length > 300 || !HTTPS_URL.test(f.website.trim()))) e.website = 'Use a full https:// address.';
  if (!f.colors.every(c => /^#[0-9A-Fa-f]{6}$/.test(c))) e.colors = 'Two colours like #2C4A8C.';
  if (!(CREST_DIVISIONS as readonly string[]).includes(f.crestDivision)) e.crestDivision = 'Unknown crest pattern.';
  if (f.initial.trim().length > 2) e.initial = 'One or two letters.';
  if (f.status !== 'approved' && f.status !== 'pending') e.status = 'Approved or pending.';
  const y = f.foundedYear.trim();
  if (y !== '' && (!/^\d{4}$/.test(y) || Number(y) < 1900 || Number(y) > now.getFullYear())) e.foundedYear = `A four digit year between 1900 and ${now.getFullYear()}.`;
  if (f.claimedOrganizations.length > 5 || f.claimedOrganizations.some(o => o.trim().length < 2 || o.trim().length > 120)) e.claimedOrganizations = 'Up to 5 names of 2 to 120 characters.';
  const links = Object.entries(f.socialLinks).filter(([, v]) => (v ?? '').trim() !== '');
  if (links.length > 8 || links.some(([, v]) => !HTTPS_URL.test((v ?? '').trim()))) e.socialLinks = 'At most 8 links, each a full https:// address.';
  return e;
}
/** The jsonb for admin_update_team: every editable field (the database ignores nothing and refuses unknown keys). */
export function teamEditPayload(f: TeamEditForm): Record<string, unknown> {
  const t = (s: string) => (s.trim() === '' ? null : s.trim());
  const links: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.socialLinks)) if ((v ?? '').trim() !== '') links[k] = (v ?? '').trim();
  return {
    name: f.name.trim(), slug: f.slug.trim(), city: t(f.city), region: t(f.region), country: t(f.country), description: t(f.description), website: t(f.website), social_links: links,
    colors: [...f.colors], crest_division: f.crestDivision, initial: f.initial.trim(), status: f.status, founded_year: f.foundedYear.trim() === '' ? null : Number(f.foundedYear.trim()),
    claimed_organizations: f.claimedOrganizations.map(o => o.trim()).filter(Boolean)
  };
}
/** Only the fields that differ from `before`, so an audit entry names what really changed. */
export function teamEditDiff(before: TeamEditForm, after: TeamEditForm): Record<string, unknown> {
  const a = teamEditPayload(before); const b = teamEditPayload(after);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(b)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = b[k];
  return out;
}
/** Team columns the owner reads from the public teams table to fill the edit form. */
export const TEAM_EDIT_COLUMNS = 'id,slug,name,status,city,region,country,description,website,social_links,colors,crest_division,initial,founded_year,claimed_organizations,logo_path,banner_path';
type TeamEditDb = {
  id: string; slug: string; name: string; status: 'approved' | 'pending'; city: string | null; region: string | null; country: string | null; description: string | null; website: string | null;
  social_links: Record<string, unknown> | null; colors: string[] | null; crest_division: string | null; initial: string | null; founded_year: number | null; claimed_organizations: string[] | null;
};
export const toTeamEditForm = (r: TeamEditDb): TeamEditForm => ({
  name: r.name, slug: r.slug, city: r.city ?? '', region: r.region ?? '', country: r.country ?? '', description: r.description ?? '', website: r.website ?? '', socialLinks: cleanSocialLinks(r.social_links),
  colors: [r.colors?.[0] ?? '#2C4A8C', r.colors?.[1] ?? '#E9ECEF'], crestDivision: r.crest_division ?? 'pale', initial: r.initial ?? '', status: r.status, foundedYear: r.founded_year?.toString() ?? '',
  claimedOrganizations: [...(r.claimed_organizations ?? [])]
});
/** Loads one team (any status; the owner can read pending teams) as an edit form. Null when it does not exist. */
export async function fetchTeamEditForm(teamId: string): Promise<TeamEditForm | null> {
  const { data, error } = await supabase.from('teams').select(TEAM_EDIT_COLUMNS).eq('id', teamId).maybeSingle();
  if (error) throw error;
  return data ? toTeamEditForm(data as unknown as TeamEditDb) : null;
}
/** patch holds only the keys to change (a full teamEditPayload also works). logo_path / banner_path must be teams/<team id>/... objects that were uploaded. */
export async function adminUpdateTeam(teamId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc('admin_update_team', { p_team: teamId, p: patch });
  if (error) throw error;
}

// ================================================================ edit a fighter
/** The jsonb for admin_update_fighter: display_name, team_id (moves the fighter; the old membership is closed, never deleted), photo_path (one of their photos or null) and any profile key. */
export interface FighterAdminPatch { display_name?: string; team_id?: string | null; photo_path?: string | null; [profileKey: string]: unknown }
export function validateFighterAdminPatch(p: FighterAdminPatch): Record<string, string> {
  const e: Record<string, string> = {};
  if (p.display_name !== undefined && (typeof p.display_name !== 'string' || p.display_name.trim().length < 2 || p.display_name.trim().length > 80)) e.display_name = '2 to 80 characters.';
  if (p.team_id !== undefined && p.team_id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(p.team_id))) e.team_id = 'Pick a team.';
  return e;
}
export async function adminUpdateFighter(fighterId: string, patch: FighterAdminPatch): Promise<void> {
  const { error } = await supabase.rpc('admin_update_fighter', { p_fighter: fighterId, p: patch });
  if (error) throw error;
}
/** Moves a fighter (null = leaves every team). The old membership gets an end date, a new one starts today; history is kept. */
export async function adminSetFighterTeam(fighterId: string, teamId: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_set_fighter_team', { p_fighter: fighterId, p_team: teamId });
  if (error) throw error;
}
/** Merges the duplicate `remove` into `keep` (entries, rosters, registrations, memberships, account link and photos move). Refused on conflicts. */
export async function adminMergeFighters(keepId: string, removeId: string): Promise<void> {
  if (keepId === removeId) throw new Error('Choose two different fighters.');
  const { error } = await supabase.rpc('admin_merge_fighters', { p_keep: keepId, p_remove: removeId });
  if (error) throw error;
}
