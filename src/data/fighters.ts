import { fitWithin, shrinkImage } from '../lib/image';
import { supabase } from '../lib/supabase';

/**
 * Fighter profiles, statistics, history, rankings, entry rosters and finishing a competition.
 * Everything is computed in the database from real matches and results (views and functions); nothing here decides rules.
 * Public data only: no account ids. Errors are thrown as-is so friendlyError can show the message.
 */

const num = (v: number | string | null | undefined): number => Number(v ?? 0);
const numOrNull = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

// ================================================================ profile
export type Gender = 'male' | 'female' | 'other';
export const GENDERS: Gender[] = ['male', 'female', 'other'];
export const BIO_MAX = 1500;
export const HIGHLIGHT_MAX = 200;
export const HIGHLIGHTS_MAX = 10;
export const DISCIPLINES_MAX = 12;

export interface FighterProfile {
  fighterId: string; displayName: string; gender: Gender | null;
  /** Public column. REAL fighters leave it null; the UI shows `age` only when it is not null. */
  birthYear: number | null; age: number | null;
  city: string | null; region: string | null; country: string | null; joinedYear: number | null;
  /** ref_categories codes, for example 'longsword', '5v5'. */
  disciplines: string[]; fightingStyle: string | null; bio: string | null; highlights: string[];
  team: { id: string; name: string; slug: string } | null;
  organization: { id: string; slug: string; name: string; enabled: boolean } | null;
  /** Storage path inside the public 'avatars' bucket, or null. Turn it into an address with avatarUrl(). */
  avatarPath: string | null;
}
type ProfileDb = {
  fighter_id: string; display_name: string; gender: Gender | null; birth_year: number | null; age: number | null; city: string | null; region: string | null; country: string | null;
  joined_year: number | null; disciplines: string[] | null; fighting_style: string | null; bio: string | null; highlights: string[] | null;
  team_id: string | null; team_name: string | null; team_slug: string | null;
  team_organization_id: string | null; team_organization_slug: string | null; team_organization_name: string | null; team_organization_enabled: boolean | null;
  avatar_path?: string | null;
};
export const toFighterProfile = (r: ProfileDb): FighterProfile => ({
  fighterId: r.fighter_id, displayName: r.display_name, gender: r.gender, birthYear: r.birth_year, age: r.age, city: r.city, region: r.region, country: r.country,
  joinedYear: r.joined_year, disciplines: r.disciplines ?? [], fightingStyle: r.fighting_style, bio: r.bio, highlights: r.highlights ?? [],
  team: r.team_id && r.team_name && r.team_slug ? { id: r.team_id, name: r.team_name, slug: r.team_slug } : null,
  organization: r.team_organization_id && r.team_organization_slug && r.team_organization_name
    ? { id: r.team_organization_id, slug: r.team_organization_slug, name: r.team_organization_name, enabled: r.team_organization_enabled ?? true } : null,
  avatarPath: r.avatar_path ?? null
});

/** Age in whole calendar years of birth (current year minus birth year), or null when the fighter gave no birth year. */
export const ageFromBirthYear = (birthYear: number | null, now: Date = new Date()): number | null => (birthYear === null ? null : now.getFullYear() - birthYear);

/** Public. Null when the fighter does not exist. */
export async function fetchFighterProfile(fighterId: string): Promise<FighterProfile | null> {
  const { data, error } = await supabase.rpc('fighter_profile', { p_fighter: fighterId });
  if (error) throw error;
  const rows = data as ProfileDb[];
  return rows.length ? toFighterProfile(rows[0]) : null;
}

export interface ProfileForm {
  gender: Gender | ''; birthYear: string; city: string; region: string; country: string; joinedYear: string;
  disciplines: string[]; fightingStyle: string; bio: string; highlights: string[];
}
export const emptyProfileForm = (): ProfileForm => ({ gender: '', birthYear: '', city: '', region: '', country: '', joinedYear: '', disciplines: [], fightingStyle: '', bio: '', highlights: [] });
export const profileToForm = (p: FighterProfile): ProfileForm => ({
  gender: p.gender ?? '', birthYear: p.birthYear?.toString() ?? '', city: p.city ?? '', region: p.region ?? '', country: p.country ?? '', joinedYear: p.joinedYear?.toString() ?? '',
  disciplines: [...p.disciplines], fightingStyle: p.fightingStyle ?? '', bio: p.bio ?? '', highlights: [...p.highlights]
});

/** Same limits as the database (which has the final say). Returns messages per field. */
export function validateProfile(f: ProfileForm, now: Date = new Date()): Record<string, string> {
  const e: Record<string, string> = {};
  const year = now.getFullYear();
  const yearOf = (s: string) => (s.trim() === '' ? null : /^\d{4}$/.test(s.trim()) ? Number(s.trim()) : NaN);
  const by = yearOf(f.birthYear);
  if (by !== null && (Number.isNaN(by) || by < 1900 || by > year)) e.birthYear = `Use a four digit year between 1900 and ${year}, or leave it empty.`;
  const jy = yearOf(f.joinedYear);
  if (jy !== null && (Number.isNaN(jy) || jy < 1990 || jy > year)) e.joinedYear = `Use a four digit year between 1990 and ${year}, or leave it empty.`;
  if (f.gender !== '' && !GENDERS.includes(f.gender)) e.gender = 'Choose male, female or other.';
  for (const k of ['city', 'region', 'country'] as const) if (f[k].trim().length > 80) e[k] = 'At most 80 characters.';
  if (f.fightingStyle.trim().length > 120) e.fightingStyle = 'At most 120 characters.';
  if (f.bio.trim().length > BIO_MAX) e.bio = `At most ${BIO_MAX} characters.`;
  if (f.disciplines.length > DISCIPLINES_MAX || new Set(f.disciplines).size !== f.disciplines.length) e.disciplines = `Pick up to ${DISCIPLINES_MAX} different disciplines.`;
  const hs = f.highlights.map(h => h.trim()).filter(Boolean);
  if (hs.length > HIGHLIGHTS_MAX || hs.some(h => h.length > HIGHLIGHT_MAX)) e.highlights = `Up to ${HIGHLIGHTS_MAX} highlights of at most ${HIGHLIGHT_MAX} characters.`;
  return e;
}

/** The jsonb for update_my_fighter_profile. Empty fields become null (cleared). Only the keys the database knows are sent. */
export function profilePayload(f: ProfileForm): Record<string, unknown> {
  const t = (s: string) => (s.trim() === '' ? null : s.trim());
  const y = (s: string) => (s.trim() === '' ? null : Number(s.trim()));
  return {
    gender: f.gender === '' ? null : f.gender, birth_year: y(f.birthYear), city: t(f.city), region: t(f.region), country: t(f.country), joined_year: y(f.joinedYear),
    disciplines: f.disciplines, fighting_style: t(f.fightingStyle), bio: t(f.bio), highlights: f.highlights.map(h => h.trim()).filter(Boolean)
  };
}
/** Only the caller's own fighter record can change; the database refuses anything else. */
export async function updateMyFighterProfile(f: ProfileForm): Promise<void> {
  const { error } = await supabase.rpc('update_my_fighter_profile', { p: profilePayload(f) });
  if (error) throw error;
}

// ================================================================ statistics (views)
export interface FighterCareerStats {
  fighterId: string; displayName: string; eventsAttended: number; matches: number; wins: number; losses: number; draws: number; winPct: number | null;
  golds: number; silvers: number; bronzes: number; podiums: number; tournamentVictories: number; points: number;
}
type CareerDb = { fighter_id: string; display_name: string; events_attended: number | string; matches: number | string; wins: number | string; losses: number | string; draws: number | string; win_pct: number | string | null;
  golds: number | string; silvers: number | string; bronzes: number | string; podiums: number | string; tournament_victories: number | string; points: number | string };
export const toFighterCareerStats = (r: CareerDb): FighterCareerStats => ({
  fighterId: r.fighter_id, displayName: r.display_name, eventsAttended: num(r.events_attended), matches: num(r.matches), wins: num(r.wins), losses: num(r.losses), draws: num(r.draws),
  winPct: numOrNull(r.win_pct), golds: num(r.golds), silvers: num(r.silvers), bronzes: num(r.bronzes), podiums: num(r.podiums), tournamentVictories: num(r.tournament_victories), points: num(r.points)
});
const CAREER_COLUMNS = 'fighter_id,display_name,events_attended,matches,wins,losses,draws,win_pct,golds,silvers,bronzes,podiums,tournament_victories,points';
export async function fetchFighterCareerStats(fighterId: string): Promise<FighterCareerStats | null> {
  const { data, error } = await supabase.from('fighter_career_stats').select(CAREER_COLUMNS).eq('fighter_id', fighterId).maybeSingle();
  if (error) throw error;
  return data ? toFighterCareerStats(data as unknown as CareerDb) : null;
}

export interface FighterMatchStats {
  fighterId: string; displayName: string; organizationId: string | null; seasonId: string | null; category: string; gender: 'open' | 'men' | 'women';
  matches: number; wins: number; losses: number; draws: number; roundsWon: number; roundsLost: number; pointsFor: number; pointsAgainst: number;
}
type MatchStatsDb = { fighter_id: string; display_name: string; organization_id: string | null; season_id: string | null; category: string; gender: 'open' | 'men' | 'women';
  matches: number | string; wins: number | string; losses: number | string; draws: number | string; rounds_won: number | string; rounds_lost: number | string; points_for: number | string; points_against: number | string };
export const toFighterMatchStats = (r: MatchStatsDb): FighterMatchStats => ({
  fighterId: r.fighter_id, displayName: r.display_name, organizationId: r.organization_id, seasonId: r.season_id, category: r.category, gender: r.gender,
  matches: num(r.matches), wins: num(r.wins), losses: num(r.losses), draws: num(r.draws), roundsWon: num(r.rounds_won), roundsLost: num(r.rounds_lost), pointsFor: num(r.points_for), pointsAgainst: num(r.points_against)
});
/** One row per organization, season, category and gender. rounds_* come from the stored match detail when there is one, else equal points_*. */
export async function fetchFighterMatchStats(fighterId: string): Promise<FighterMatchStats[]> {
  const { data, error } = await supabase.from('fighter_match_stats').select('fighter_id,display_name,organization_id,season_id,category,gender,matches,wins,losses,draws,rounds_won,rounds_lost,points_for,points_against').eq('fighter_id', fighterId);
  if (error) throw error;
  return (data as unknown as MatchStatsDb[]).map(toFighterMatchStats);
}

export interface FighterSeasonStats { fighterId: string; displayName: string; seasonId: string; organizationId: string | null; eventsAttended: number; matches: number; wins: number; losses: number; draws: number; golds: number; silvers: number; bronzes: number; podiums: number; points: number }
type SeasonDb = { fighter_id: string; display_name: string; season_id: string; organization_id: string | null; events_attended: number | string; matches: number | string; wins: number | string; losses: number | string; draws: number | string;
  golds: number | string; silvers: number | string; bronzes: number | string; podiums: number | string; points: number | string };
export const toFighterSeasonStats = (r: SeasonDb): FighterSeasonStats => ({
  fighterId: r.fighter_id, displayName: r.display_name, seasonId: r.season_id, organizationId: r.organization_id, eventsAttended: num(r.events_attended), matches: num(r.matches), wins: num(r.wins),
  losses: num(r.losses), draws: num(r.draws), golds: num(r.golds), silvers: num(r.silvers), bronzes: num(r.bronzes), podiums: num(r.podiums), points: num(r.points)
});
export async function fetchFighterSeasonStats(fighterId: string): Promise<FighterSeasonStats[]> {
  const { data, error } = await supabase.from('fighter_season_stats').select('fighter_id,display_name,season_id,organization_id,events_attended,matches,wins,losses,draws,golds,silvers,bronzes,podiums,points').eq('fighter_id', fighterId);
  if (error) throw error;
  return (data as unknown as SeasonDb[]).map(toFighterSeasonStats);
}

export interface TeamStats {
  teamId: string; teamName: string; teamSlug: string; events: number; matches: number; matches5v5: number; matches3v3: number; matchesOther: number;
  wins: number; losses: number; draws: number; winPct: number | null; golds: number; silvers: number; bronzes: number; podiums: number; tournamentWins: number; points: number;
  /** Last five final matches, most recent first, as 'W' / 'L' / 'D' letters. */
  recentForm: Array<'W' | 'L' | 'D'>;
}
type TeamStatsDb = { team_id: string; team_name: string; team_slug: string; events: number | string; matches: number | string; matches_5v5: number | string; matches_3v3: number | string; matches_other: number | string;
  wins: number | string; losses: number | string; draws: number | string; win_pct: number | string | null; golds: number | string; silvers: number | string; bronzes: number | string; podiums: number | string;
  tournament_wins: number | string; points: number | string; recent_form: string | null };
export const parseRecentForm = (s: string | null): Array<'W' | 'L' | 'D'> => [...(s ?? '')].filter((c): c is 'W' | 'L' | 'D' => c === 'W' || c === 'L' || c === 'D');
export const toTeamStats = (r: TeamStatsDb): TeamStats => ({
  teamId: r.team_id, teamName: r.team_name, teamSlug: r.team_slug, events: num(r.events), matches: num(r.matches), matches5v5: num(r.matches_5v5), matches3v3: num(r.matches_3v3), matchesOther: num(r.matches_other),
  wins: num(r.wins), losses: num(r.losses), draws: num(r.draws), winPct: numOrNull(r.win_pct), golds: num(r.golds), silvers: num(r.silvers), bronzes: num(r.bronzes), podiums: num(r.podiums),
  tournamentWins: num(r.tournament_wins), points: num(r.points), recentForm: parseRecentForm(r.recent_form)
});
const TEAM_STATS_COLUMNS = 'team_id,team_name,team_slug,events,matches,matches_5v5,matches_3v3,matches_other,wins,losses,draws,win_pct,golds,silvers,bronzes,podiums,tournament_wins,points,recent_form';
export async function fetchTeamStats(teamSlug: string): Promise<TeamStats | null> {
  const { data, error } = await supabase.from('team_stats').select(TEAM_STATS_COLUMNS).eq('team_slug', teamSlug).maybeSingle();
  if (error) throw error;
  return data ? toTeamStats(data as unknown as TeamStatsDb) : null;
}

// ================================================================ history (fighter_results / team_results)
export interface ResultRow {
  competitionId: string; competitionName: string; category: string; gender: 'open' | 'men' | 'women'; tier: string | null;
  eventId: string; eventSlug: string; eventName: string; eventType: string; startsOn: string; endsOn: string;
  seasonId: string | null; organizationId: string | null; finalPlace: number; points: number;
  /** The event is a fictional/test event (tagged by a synthetic source). Only the history lists carry it; rankings and statistics leave such events out. */
  synthetic?: boolean;
  /** Team results: the name the team used at the event, and its name today (they differ after a rename or merge). */
  teamNameAtEvent?: string | null; teamCurrentName?: string | null;
}
type ResultDb = { synthetic?: boolean; team_name_at_event?: string | null; team_current_name?: string | null; competition_id: string; competition_name: string; category: string; gender: 'open' | 'men' | 'women'; tier: string | null; event_id: string; event_slug: string; event_name: string;
  event_type: string; starts_on: string; event_ends_on: string; season_id: string | null; organization_id: string | null; final_place: number; points: number | string };
export const toResultRow = (r: ResultDb): ResultRow => ({
  competitionId: r.competition_id, competitionName: r.competition_name, category: r.category, gender: r.gender, tier: r.tier, eventId: r.event_id, eventSlug: r.event_slug, eventName: r.event_name,
  eventType: r.event_type, startsOn: r.starts_on, endsOn: r.event_ends_on, seasonId: r.season_id, organizationId: r.organization_id, finalPlace: r.final_place, points: num(r.points),
  synthetic: r.synthetic === true, teamNameAtEvent: r.team_name_at_event ?? null, teamCurrentName: r.team_current_name ?? null
});
const RESULT_COLUMNS = 'competition_id,competition_name,category,gender,tier,event_id,event_slug,event_name,event_type,starts_on,event_ends_on,season_id,organization_id,final_place,points';
/** Newest first. Includes duel entries and team entries the fighter was on the roster of (mercenaries too). */
export async function fetchFighterHistory(fighterId: string): Promise<ResultRow[]> {
  const { data, error } = await supabase.from('fighter_results_all').select(`${RESULT_COLUMNS},synthetic`).eq('fighter_id', fighterId).order('event_ends_on', { ascending: false });
  if (error) throw error;
  return (data as unknown as ResultDb[]).map(toResultRow);
}
export async function fetchTeamHistory(teamId: string): Promise<ResultRow[]> {
  const { data, error } = await supabase.from('team_results_all').select(`${RESULT_COLUMNS},synthetic,team_name_at_event,team_current_name`).eq('team_id', teamId).order('event_ends_on', { ascending: false });
  if (error) throw error;
  return (data as unknown as ResultDb[]).map(toResultRow);
}
export const placeLabel = (place: number): string => (place === 1 ? 'Gold' : place === 2 ? 'Silver' : place === 3 ? 'Bronze' : `${place}th`);

// ================================================================ rankings
/** season: per organization + season + category + gender. org_career: per organization + category + gender. org_all: per organization. career: everything. */
export type RankingScope = 'season' | 'org_career' | 'org_all' | 'career';
export interface RankingFilter { scope: RankingScope; organizationId?: string | null; seasonId?: string | null; category?: string | null; gender?: 'open' | 'men' | 'women' | null }
export interface RankingRow {
  scope: RankingScope; organizationId: string | null; seasonId: string | null; category: string | null; gender: string | null;
  subjectId: string; name: string; slug: string | null; competitions: number; golds: number; silvers: number; bronzes: number; points: number;
  /** rank() over points DESC: equal points share a rank and the next ranks are skipped (1, 2, 2, 4). */
  rank: number;
}
type RankDb = { scope: RankingScope; organization_id: string | null; season_id: string | null; category: string | null; gender: string | null; competitions: number | string; golds: number | string; silvers: number | string; bronzes: number | string; points: number | string; rank: number | string };
export const toFighterRanking = (r: RankDb & { fighter_id: string; display_name: string }): RankingRow => ({
  scope: r.scope, organizationId: r.organization_id, seasonId: r.season_id, category: r.category, gender: r.gender, subjectId: r.fighter_id, name: r.display_name, slug: null,
  competitions: num(r.competitions), golds: num(r.golds), silvers: num(r.silvers), bronzes: num(r.bronzes), points: num(r.points), rank: num(r.rank)
});
export const toTeamRanking = (r: RankDb & { team_id: string; team_name: string; team_slug: string }): RankingRow => ({
  scope: r.scope, organizationId: r.organization_id, seasonId: r.season_id, category: r.category, gender: r.gender, subjectId: r.team_id, name: r.team_name, slug: r.team_slug,
  competitions: num(r.competitions), golds: num(r.golds), silvers: num(r.silvers), bronzes: num(r.bronzes), points: num(r.points), rank: num(r.rank)
});

type Filterable<T> = { eq: (c: string, v: unknown) => T; is: (c: string, v: null) => T };
/** Applies a ranking filter. Null / undefined dimensions are matched as NULL, because every scope fixes which dimensions are set. */
export function applyRankingFilter<T extends Filterable<T>>(q: T, f: RankingFilter): T {
  const dims: Array<[string, string | null | undefined]> = [['organization_id', f.organizationId], ['season_id', f.seasonId], ['category', f.category], ['gender', f.gender]];
  let out = q.eq('scope', f.scope);
  for (const [col, v] of dims) out = v === null || v === undefined ? out.is(col, null) : out.eq(col, v);
  return out;
}
export async function fetchFighterRanking(f: RankingFilter, limit = 100): Promise<RankingRow[]> {
  const q = supabase.from('ranking_fighters').select('scope,organization_id,season_id,category,gender,fighter_id,display_name,competitions,golds,silvers,bronzes,points,rank');
  const { data, error } = await applyRankingFilter(q, f).order('rank').order('display_name').limit(limit);
  if (error) throw error;
  return (data as unknown as Array<RankDb & { fighter_id: string; display_name: string }>).map(toFighterRanking);
}
export async function fetchTeamRanking(f: RankingFilter, limit = 100): Promise<RankingRow[]> {
  const q = supabase.from('ranking_teams').select('scope,organization_id,season_id,category,gender,team_id,team_name,team_slug,competitions,golds,silvers,bronzes,points,rank');
  const { data, error } = await applyRankingFilter(q, f).order('rank').order('team_name').limit(limit);
  if (error) throw error;
  return (data as unknown as Array<RankDb & { team_id: string; team_name: string; team_slug: string }>).map(toTeamRanking);
}

// ================================================================ entry rosters (group fights)
export type RosterRole = 'fighter' | 'mercenary' | 'guest';
export interface EntryRosterRow { entryId: string; fighterId: string; displayName: string; role: RosterRole; permanentTeamId: string | null; permanentTeamName: string | null; permanentTeamSlug: string | null }
type EntryRosterDb = { entry_id: string; fighter_id: string; display_name: string; role: RosterRole; permanent_team_id: string | null; permanent_team_name: string | null; permanent_team_slug: string | null };
export const toEntryRosterRow = (r: EntryRosterDb): EntryRosterRow => ({
  entryId: r.entry_id, fighterId: r.fighter_id, displayName: r.display_name, role: r.role, permanentTeamId: r.permanent_team_id, permanentTeamName: r.permanent_team_name, permanentTeamSlug: r.permanent_team_slug
});
/** Public for a public event. A mercenary is shown with their permanent team; they are never moved to the entry's team. */
export async function fetchEntryRoster(entryId: string): Promise<EntryRosterRow[]> {
  const { data, error } = await supabase.from('entry_roster').select('entry_id,fighter_id,display_name,role,permanent_team_id,permanent_team_name,permanent_team_slug').eq('entry_id', entryId).order('display_name');
  if (error) throw error;
  return (data as unknown as EntryRosterDb[]).map(toEntryRosterRow);
}
export interface RosterSelection { fighterId: string; role?: RosterRole }
/** The jsonb for set_entry_roster. role is left out when not chosen; the database then derives fighter / mercenary / guest from the fighter's home team. */
export const rosterPayload = (rows: RosterSelection[]): Array<{ fighter_id: string; role?: RosterRole }> => rows.map(r => (r.role ? { fighter_id: r.fighterId, role: r.role } : { fighter_id: r.fighterId }));
/** Organizer only; replaces the whole roster. Returns how many fighters it holds. Refused once the competition is finished. */
export async function setEntryRoster(entryId: string, rows: RosterSelection[]): Promise<number> {
  const { data, error } = await supabase.rpc('set_entry_roster', { p_entry: entryId, p_fighters: rosterPayload(rows) });
  if (error) throw error;
  return data as number;
}

// ================================================================ finishing a competition
export type MultiplierSource = 'tournament_structure' | 'league_structure';
/**
 * Organizer only. Needs every match final. Computes final_place and league points for every entry, writes results and marks the
 * competition finished; safe to run again. Reopening a match undoes it. Returns how many entries were ranked.
 */
export async function finishCompetition(competitionId: string, source: MultiplierSource = 'tournament_structure'): Promise<number> {
  const { data, error } = await supabase.rpc('finish_competition', { p_competition: competitionId, p_multiplier_source: source });
  if (error) throw error;
  return data as number;
}

/** The signed-in person's own fighter record id, or null when they have none yet. */
export async function fetchMyFighterId(): Promise<string | null> {
  const { data, error } = await supabase.rpc('my_fighter_id');
  if (error) throw error;
  return (data as string | null) ?? null;
}

export interface CategoryOption { code: string; name: string }
/** Every discipline code the database accepts in a profile (ref_categories is public). */
export async function fetchCategoryOptions(): Promise<CategoryOption[]> {
  const { data, error } = await supabase.from('ref_categories').select('code,name').order('sort');
  if (error) throw error;
  return data as CategoryOption[];
}

// ---------------------------------------------------------------- profile photo
export const AVATAR_MAX_PX = 512;
export { fitWithin };
/** Public address of a stored photo, or null when the fighter has none. */
export const avatarUrl = (path: string | null | undefined): string | null => (path ? supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl : null);

/** Uploads the picture to the caller's own folder, points the profile at it and removes the previous photo. Returns the new path. */
export async function uploadMyAvatar(fighterId: string, file: File, previous: string | null): Promise<string> {
  const blob = await shrinkImage(file, AVATAR_MAX_PX, 'image/jpeg');
  const path = `${fighterId}/${Date.now()}.jpg`;
  const up = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (up.error) throw up.error;
  const { error } = await supabase.rpc('set_my_fighter_avatar', { p_path: path });
  if (error) { await supabase.storage.from('avatars').remove([path]); throw error; }
  if (previous) await supabase.storage.from('avatars').remove([previous]);
  return path;
}
export async function removeMyAvatar(previous: string): Promise<void> {
  const { error } = await supabase.rpc('set_my_fighter_avatar', { p_path: null });
  if (error) throw error;
  await supabase.storage.from('avatars').remove([previous]);
}
