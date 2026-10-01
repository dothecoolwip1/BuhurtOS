import type { AdminFighterRow, AdminTeamRow } from '../data/admin';
import { profilePayload, sportsPayload, type ProfileForm, type SportsForm } from '../data/fighters';

/** Pure view-model helpers for the platform owner's team and fighter screens. No authority lives here: the database decides every call. */

export const PAGE_SIZE = 25;
export const FETCH_CAP = 2000;
export const MEDICAL_NOTICE = 'Medical and emergency details are never shown here.';
export const FIGHTER_TEAM_NOTE = "The old membership is closed with today's date; history is kept.";

/** Reads every page of an admin list (200 at a time) up to `cap` rows. `capped` is true when more exist than were read. */
export async function collectPages<T>(fetchPage: (offset: number) => Promise<{ rows: T[]; total: number }>, cap = FETCH_CAP): Promise<{ rows: T[]; total: number; capped: boolean }> {
  const rows: T[] = [];
  let total = 0;
  for (;;) {
    const page = await fetchPage(rows.length);
    total = page.total;
    rows.push(...page.rows);
    if (page.rows.length === 0 || rows.length >= total || rows.length >= cap) break;
  }
  return { rows: rows.slice(0, cap), total, capped: total > Math.min(rows.length, cap) };
}

/** How many rows to show after `pages` clicks of "Show more". */
export const visibleCount = (pages: number, size = PAGE_SIZE): number => Math.max(1, Math.trunc(pages) || 1) * size;

// ---------------------------------------------------------------- teams
export type TeamStatusFilter = 'all' | 'pending' | 'approved';
export const STATUS_OPTIONS: ReadonlyArray<readonly [TeamStatusFilter, string]> = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved']];
export const ORG_ALL = 'all';
export const ORG_NONE = 'none';

export interface TeamFilter { status: TeamStatusFilter; org: string }
export function filterTeams(rows: AdminTeamRow[], f: TeamFilter): AdminTeamRow[] {
  return rows.filter(r => (f.status === 'all' || r.status === f.status)
    && (f.org === ORG_ALL || (f.org === ORG_NONE ? r.organization === null : r.organization?.id === f.org)));
}
/** Organizations that appear in the loaded teams, by name, for the organization filter. */
export function orgOptions(rows: AdminTeamRow[]): Array<{ id: string; name: string; enabled: boolean; count: number }> {
  const m = new Map<string, { id: string; name: string; enabled: boolean; count: number }>();
  for (const r of rows) if (r.organization) {
    const e = m.get(r.organization.id) ?? { id: r.organization.id, name: r.organization.name, enabled: r.organization.enabled, count: 0 };
    e.count += 1; m.set(r.organization.id, e);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export interface Badge { label: string; tone: 'win' | 'brass' | 'steel' | '' }
/** Clear labels: waiting for approval, and a team whose organization is switched off (hidden from the public, but the owner still sees it). */
export function teamBadges(r: AdminTeamRow): Badge[] {
  const out: Badge[] = [r.status === 'pending' ? { label: 'Pending approval', tone: 'brass' } : { label: 'Approved', tone: 'win' }];
  if (r.organization && !r.organization.enabled) out.push({ label: 'Organization disabled', tone: '' });
  return out;
}
export const placeText = (r: { city: string | null; region: string | null; country: string | null }): string => [r.city, r.region, r.country].filter(Boolean).join(', ');
export const countText = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export const MERGE_TEAMS_NOTICE = [
  'Everything that belongs to the team you remove moves onto the team you keep: roster and memberships, captains and managers, event entries and registrations, and organization links.',
  'The removed team is then deleted. This cannot be undone.',
  'The database refuses the merge when both teams have an entry in the same competition; the reason is shown here.'
];
export const MERGE_FIGHTERS_NOTICE = [
  'Everything that belongs to the duplicate moves onto the fighter you keep: event entries, roster places, registrations, team memberships, the account link and photos.',
  "The kept fighter's own profile details are never overwritten; empty ones are filled from the duplicate. The duplicate is then deleted. This cannot be undone.",
  'Refused when both fighters belong to an account, when both are in the same competition, or when together they have more than 8 photos.'
];

// ---------------------------------------------------------------- fighters
export interface FighterFilter { unclaimedOnly: boolean }
export const filterFighters = (rows: AdminFighterRow[], f: FighterFilter): AdminFighterRow[] => (f.unclaimedOnly ? rows.filter(r => !r.claimed) : rows);
export function fighterBadges(r: AdminFighterRow): Badge[] {
  const out: Badge[] = [r.claimed ? { label: 'Has account', tone: 'win' } : { label: 'Unclaimed', tone: 'brass' }];
  if (!r.profilePublic) out.push({ label: 'Private profile', tone: '' });
  return out;
}

export interface FighterEditForm { displayName: string; profile: ProfileForm; sports: SportsForm }
/** Only the keys that differ, so the audit entry names what really changed. Team moves are separate (adminSetFighterTeam). */
export function fighterEditDiff(before: FighterEditForm, after: FighterEditForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (before.displayName.trim() !== after.displayName.trim()) out.display_name = after.displayName.trim();
  const a: Record<string, unknown> = { ...profilePayload(before.profile), ...sportsPayload(before.sports) };
  const b: Record<string, unknown> = { ...profilePayload(after.profile), ...sportsPayload(after.sports) };
  for (const k of Object.keys(b)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = b[k];
  return out;
}
/** Comma separated codes to a clean, de-duplicated list. */
export const parseList = (s: string): string[] => [...new Set(s.split(',').map(x => x.trim()).filter(Boolean))];

// ---------------------------------------------------------------- overview
export interface OverviewCounts { teams: number; pendingTeams: number; fighters: number; unclaimedFighters: number; organizations: number }
export function overviewCounts(teams: AdminTeamRow[], teamsTotal: number, fighters: AdminFighterRow[], fightersTotal: number, organizations: number): OverviewCounts {
  return { teams: teamsTotal, pendingTeams: teams.filter(t => t.status === 'pending').length, fighters: fightersTotal, unclaimedFighters: fighters.filter(f => !f.claimed).length, organizations };
}

// ---------------------------------------------------------------- audit
export interface AuditEntry { id: number; at: string; action: string; details: Record<string, unknown> }
const AUDIT_LABELS: Record<string, string> = {
  'admin.team_updated': 'Team edited', 'admin.fighter_updated': 'Fighter edited', 'admin.fighter_team_set': 'Fighter moved to another team', 'admin.fighters_merged': 'Fighters merged',
  'admin.photo_removed': 'Photo removed'
};
const humanize = (a: string): string => { const s = a.replace(/[._]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
/** One plain line per entry. Field names only; the log never holds private data. */
export function auditLine(e: AuditEntry): { label: string; detail: string } {
  const fields = Array.isArray(e.details.fields) ? e.details.fields.filter((x): x is string => typeof x === 'string') : [];
  return { label: AUDIT_LABELS[e.action] ?? humanize(e.action), detail: fields.length ? `Changed: ${fields.join(', ').replace(/_/g, ' ')}` : '' };
}
