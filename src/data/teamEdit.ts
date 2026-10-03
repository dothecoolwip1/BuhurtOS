import { shrinkImage } from '../lib/image';
import { supabase } from '../lib/supabase';
import type { DirectoryEntry } from './teamDirectory';
import type { SocialNetwork } from './teamManager';
import { cleanSocialLinks, socialLinkErrors } from '../lib/social';

/** Editing an existing team. The database decides who may (captain, owner, organizer, organization admin) and checks every value again. */

export const EMBLEM_MAX_PX = 256;
export const TEAM_DESCRIPTION_MAX = 500;
export const CREST_PATTERNS: ReadonlyArray<readonly [string, string]> = [
  ['pale', 'Vertical stripe'], ['fess', 'Horizontal band'], ['bend', 'Diagonal'], ['chevron', 'Chevron'], ['quarterly', 'Quarters'], ['saltire', 'Cross']
];

export interface TeamEditForm {
  name: string; city: string; region: string; country: string; description: string; website: string; foundedYear: string;
  socialLinks: Partial<Record<SocialNetwork, string>>; claimedOrganizations: string[];
  colors: [string, string]; crestDivision: string; initial: string;
}
export const teamToForm = (t: DirectoryEntry): TeamEditForm => ({
  name: t.name, city: t.city ?? '', region: t.region ?? '', country: t.country ?? '', description: t.description ?? '', website: t.website ?? '',
  foundedYear: t.foundedYear?.toString() ?? '', socialLinks: { ...t.socialLinks }, claimedOrganizations: [...t.claimedOrganizations],
  colors: [...t.colors] as [string, string], crestDivision: t.crestDivision, initial: t.initial
});

const HTTPS_URL = /^https:\/\/[^\s/]+\.[^\s/]+([/?#]\S*)?$/;

/** Mirrors the database rules so the form can say what is wrong before sending. The database stays the authority. */
export function validateTeamEdit(f: TeamEditForm, canRename: boolean, now = new Date()): Partial<Record<keyof TeamEditForm, string>> {
  const e: Partial<Record<keyof TeamEditForm, string>> = {};
  if (canRename && (f.name.trim().length < 2 || f.name.trim().length > 80)) e.name = 'The team name must be 2 to 80 characters.';
  if (!f.city.trim()) e.city = 'City is required.';
  if (!f.country.trim()) e.country = 'Country is required.';
  if ([f.city, f.region, f.country].some(v => v.trim().length > 80)) e.city = 'City, region and country are at most 80 characters.';
  const d = f.description.trim().length;
  if (d > 0 && (d < 10 || d > TEAM_DESCRIPTION_MAX)) e.description = `Describe the team in 10 to ${TEAM_DESCRIPTION_MAX} characters, or leave it empty.`;
  if (f.website.trim() && (f.website.trim().length > 300 || !HTTPS_URL.test(f.website.trim()))) e.website = 'Use a full https:// address.';
  const social = socialLinkErrors(f.socialLinks);
  const firstBad = Object.values(social)[0];
  if (firstBad) e.socialLinks = firstBad;
  if (f.foundedYear.trim() && (!/^\d{4}$/.test(f.foundedYear.trim()) || Number(f.foundedYear) < 1900 || Number(f.foundedYear) > now.getFullYear())) e.foundedYear = `Use a four digit year from 1900 to ${now.getFullYear()}.`;
  const orgs = f.claimedOrganizations.map(o => o.trim()).filter(Boolean);
  if (orgs.length > 5 || orgs.some(o => o.length < 2 || o.length > 120)) e.claimedOrganizations = 'Name up to 5 organizations, 2 to 120 characters each.';
  if (f.initial.trim().length > 2) e.initial = 'The crest initial is one or two letters.';
  return e;
}

/** The jsonb for update_team_profile. Every field is sent, empty optional ones as null (cleared). The name is sent only when the person may rename. */
export function teamEditPayload(f: TeamEditForm, canRename: boolean): Record<string, unknown> {
  const t = (s: string) => (s.trim() === '' ? null : s.trim());
  const social = cleanSocialLinks(f.socialLinks);
  return {
    ...(canRename ? { name: f.name.trim() } : {}),
    city: f.city.trim(), region: t(f.region), country: f.country.trim(), description: t(f.description), website: t(f.website),
    founded_year: t(f.foundedYear) === null ? null : Number(f.foundedYear), social_links: social, claimed_organizations: f.claimedOrganizations.map(o => o.trim()).filter(Boolean),
    colors: f.colors, crest_division: f.crestDivision, initial: t(f.initial)
  };
}

export async function updateTeamProfile(teamId: string, f: TeamEditForm, canRename: boolean): Promise<void> {
  const { error } = await supabase.rpc('update_team_profile', { p_team: teamId, p: teamEditPayload(f, canRename) });
  if (error) throw error;
}

/** What the signed-in person may do on this team. Only decides what to show. */
export async function fetchTeamEditRights(teamId: string): Promise<{ edit: boolean; rename: boolean }> {
  const [edit, rename] = await Promise.all([supabase.rpc('can_edit_team', { p_team: teamId }), supabase.rpc('can_rename_team', { p_team: teamId })]);
  if (edit.error) throw edit.error;
  if (rename.error) throw rename.error;
  return { edit: edit.data === true, rename: rename.data === true };
}

/** Shrinks the picture (a PNG keeps transparency), stores it in the team's folder, points the team at it and removes the previous one. Returns the new path. */
export async function uploadTeamEmblem(teamId: string, file: File, previous: string | null): Promise<string> {
  const blob = await shrinkImage(file, EMBLEM_MAX_PX, 'image/png');
  const path = `${teamId}/${Date.now()}.png`;
  const up = await supabase.storage.from('team-emblems').upload(path, blob, { contentType: 'image/png', cacheControl: '31536000' });
  if (up.error) throw up.error;
  const { error } = await supabase.rpc('set_team_emblem', { p_team: teamId, p_path: path });
  if (error) { await supabase.storage.from('team-emblems').remove([path]); throw error; }
  if (previous) await supabase.storage.from('team-emblems').remove([previous]);
  return path;
}
export async function removeTeamEmblem(teamId: string, previous: string): Promise<void> {
  const { error } = await supabase.rpc('set_team_emblem', { p_team: teamId, p_path: null });
  if (error) throw error;
  await supabase.storage.from('team-emblems').remove([previous]);
}
