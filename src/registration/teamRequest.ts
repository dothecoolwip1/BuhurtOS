import { CLAIMED_LABEL, MESSAGE_MAX, SOCIAL_NETWORKS, emptyNewTeamForm, slugFromName, validateNewTeam, type JoinStatus, type MyJoinRequest, type NewTeamForm, type SocialNetwork } from '../data/teamManager';
import type { CaptainedTeam, TeamChoice } from '../data/myTeams';

/** Pure helpers for the team manager screens. The rules mirror the database functions, which stay the authority. */
export { CLAIMED_LABEL, MESSAGE_MAX, SOCIAL_NETWORKS, emptyNewTeamForm, slugFromName, validateNewTeam };
export type FormErrors = ReturnType<typeof validateNewTeam>;

export const DESCRIPTION_MAX = 500;
export const MAX_CLAIMED = 5;

/** The address the team will get: what was typed, else one made from the name. */
export const effectiveSlug = (f: Pick<NewTeamForm, 'name' | 'slug'>) => f.slug.trim() || slugFromName(f.name);

/** Characters left for a limited field. Negative means over. */
export const charsLeft = (value: string, max: number) => max - value.trim().length;

export const descriptionCounter = (description: string) => {
  const left = charsLeft(description, DESCRIPTION_MAX);
  return left < 0 ? `${-left} too many characters` : `${left} characters left`;
};

/** Set or clear one social network. Blank removes it. */
export function setSocial(links: NewTeamForm['socialLinks'], network: SocialNetwork, value: string): NewTeamForm['socialLinks'] {
  const next = { ...links };
  if (value.trim() === '') delete next[network]; else next[network] = value;
  return next;
}

/** Claimed organizations list edits, capped at five. */
export const addClaimed = (list: string[]): string[] => (list.length >= MAX_CLAIMED ? list : [...list, '']);
export const removeClaimed = (list: string[], index: number): string[] => list.filter((_, i) => i !== index);
export const editClaimed = (list: string[], index: number, value: string): string[] => list.map((o, i) => (i === index ? value : o));

const ORDER: (keyof NewTeamForm)[] = ['name', 'slug', 'city', 'country', 'description', 'website', 'socialLinks', 'foundedYear', 'claimedOrganizations', 'colors', 'initial', 'contactEmail', 'contactPhone', 'captainReason', 'notes'];
/** The first field with a problem, in page order, so the form can focus it. */
export const firstErrorField = (e: FormErrors): keyof NewTeamForm | null => ORDER.find(k => e[k]) ?? null;

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Search approved teams by name or city, ignoring case and accents. Needs two letters so the list stays short. */
export function filterTeams(teams: TeamChoice[], query: string, limit = 20): TeamChoice[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  return teams.filter(t => fold(t.name).includes(q) || fold(t.city ?? '').includes(q)).slice(0, limit);
}
export const placeOf = (t: { city: string | null; region: string | null; country: string | null }) => [t.city, t.region, t.country].filter(Boolean).join(', ');

export const statusLabel = (s: JoinStatus): string =>
  s === 'pending' ? 'Waiting for a captain' : s === 'approved' ? 'Approved: you are on the team' : s === 'declined' ? 'Declined' : 'Cancelled';

export interface MyTeam { teamId: string; name: string; slug: string; captain: boolean; reviewing: boolean }
/** "You are on X": captained teams plus teams where a request was approved, once each. */
export function myTeams(captained: CaptainedTeam[], requests: MyJoinRequest[]): MyTeam[] {
  const out = new Map<string, MyTeam>();
  for (const c of captained) out.set(c.teamId, { teamId: c.teamId, name: c.name, slug: c.slug, captain: true, reviewing: c.status === 'pending' });
  for (const r of requests) if (r.status === 'approved' && !out.has(r.teamId)) out.set(r.teamId, { teamId: r.teamId, name: r.teamName, slug: r.teamSlug, captain: false, reviewing: false });
  return [...out.values()];
}

export const pendingTeamIds = (requests: MyJoinRequest[]) => new Set(requests.filter(r => r.status === 'pending').map(r => r.teamId));
