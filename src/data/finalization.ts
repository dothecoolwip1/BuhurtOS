import { supabase } from '../lib/supabase';

/**
 * Pack 09C: making a competition's placings official, taking them back, and closing an event. Every decision is the database's: the preflight
 * says what stands in the way, finalize / reopen / close check the caller again, and the public reads the official placings from one view.
 * Errors are thrown as-is so friendlyError can show the server's own sentence.
 */

const num = (v: number | string | null | undefined): number => Number(v ?? 0);

export interface Blocker { code: string; text: string; count?: number }
export interface Warning { code: string; text: string; count?: number; entries?: Array<{ entry_id: string; fighter_id: string; name: string }> }
export type PlacementKind = 'team' | 'fighter';
export interface Placement {
  entryId: string; place: number; kind: PlacementKind; name: string; teamSlug: string | null; fighterId: string | null; status: string;
  representedTeamName: string | null; representedTeamSlug: string | null;
  poolWins: number | null; elimWins: number | null; basePoints: number | null; points: number;
}
export type ReviewState = 'official' | 'ready' | 'blocked' | 'running';
export type MultiplierSource = 'tournament_structure' | 'league_structure';
export interface FinalizePreflight {
  competition: { id: string; name: string; status: string; structure: string; tier: string | null; category: string; gender: string; finalizedAt: string | null; reopenedAt: string | null; multiplierSource: MultiplierSource | null };
  eventClosed: boolean; state: ReviewState; matches: { total: number; final: number };
  blockers: Blocker[]; warnings: Warning[]; source: MultiplierSource; multiplier: number | null; placements: Placement[];
}
type PlacementDb = { entry_id: string; place: number; kind: PlacementKind; name: string; team_slug: string | null; fighter_id: string | null; status: string; represented_team_name: string | null; represented_team_slug: string | null; pool_wins: number | null; elim_wins: number | null; base_points: number | string | null; points: number | string };
type PreflightDb = {
  competition: { id: string; name: string; status: string; structure: string; tier: string | null; category: string; gender: string; finalized_at: string | null; reopened_at: string | null; multiplier_source: MultiplierSource | null };
  event_closed: boolean; state: ReviewState; matches: { total: number; final: number }; blockers: Blocker[]; warnings: Warning[]; source: MultiplierSource; multiplier: number | string | null; placements: PlacementDb[];
};
export const toPlacement = (p: PlacementDb): Placement => ({
  entryId: p.entry_id, place: p.place, kind: p.kind, name: p.name, teamSlug: p.team_slug, fighterId: p.fighter_id, status: p.status,
  representedTeamName: p.represented_team_name, representedTeamSlug: p.represented_team_slug,
  poolWins: p.pool_wins, elimWins: p.elim_wins, basePoints: p.base_points === null ? null : num(p.base_points), points: num(p.points)
});
export const toPreflight = (d: PreflightDb): FinalizePreflight => ({
  competition: { id: d.competition.id, name: d.competition.name, status: d.competition.status, structure: d.competition.structure, tier: d.competition.tier, category: d.competition.category, gender: d.competition.gender,
    finalizedAt: d.competition.finalized_at, reopenedAt: d.competition.reopened_at, multiplierSource: d.competition.multiplier_source },
  eventClosed: d.event_closed, state: d.state, matches: d.matches, blockers: d.blockers ?? [], warnings: d.warnings ?? [],
  source: d.source, multiplier: d.multiplier === null ? null : num(d.multiplier), placements: (d.placements ?? []).map(toPlacement)
});

/** What stands between this competition and an official result, and the placings as they would be written (organizers of the event only). */
export async function fetchFinalizePreflight(competitionId: string, source: MultiplierSource = 'tournament_structure'): Promise<FinalizePreflight> {
  const { data, error } = await supabase.rpc('competition_finalize_preflight', { p_competition: competitionId, p_multiplier_source: source });
  if (error) throw error;
  return toPreflight(data as PreflightDb);
}
export interface FinalizeOutcome { status: 'official' | 'already_official'; finalizedAt: string | null; entries: number }
/** Atomic and idempotent on the server: a second tap or a stale screen gets already_official and nothing is recomputed. */
export async function finalizeCompetition(competitionId: string, source: MultiplierSource = 'tournament_structure'): Promise<FinalizeOutcome> {
  const { data, error } = await supabase.rpc('finalize_competition', { p_competition: competitionId, p_multiplier_source: source });
  if (error) throw error;
  const d = data as { status: FinalizeOutcome['status']; finalized_at: string | null; entries: number | string };
  return { status: d.status, finalizedAt: d.finalized_at, entries: num(d.entries) };
}
/** Takes an official result back for correction: organizer of the event, reason required, audited; the old placings stay in the revisions. */
export async function reopenCompetition(competitionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_competition', { p_competition: competitionId, p_reason: reason.trim() });
  if (error) throw error;
}

export interface ClosePreflight {
  event: { id: string; name: string; status: string; closedAt: string | null; reopenedAt: string | null };
  closed: boolean; ready: boolean; blockers: Blocker[]; warnings: Warning[];
  competitions: Array<{ id: string; name: string; status: string; total: number; final: number; state: 'official' | 'no_draw' | 'running' | 'ready'; finalizedAt: string | null }>;
}
type ClosePreflightDb = {
  event: { id: string; name: string; status: string; closed_at: string | null; reopened_at: string | null }; closed: boolean; ready: boolean; blockers: Blocker[]; warnings: Warning[];
  competitions: Array<{ id: string; name: string; status: string; total: number | string; final: number | string; state: ClosePreflight['competitions'][number]['state']; finalized_at: string | null }>;
};
export const toClosePreflight = (d: ClosePreflightDb): ClosePreflight => ({
  event: { id: d.event.id, name: d.event.name, status: d.event.status, closedAt: d.event.closed_at, reopenedAt: d.event.reopened_at },
  closed: d.closed, ready: d.ready, blockers: d.blockers ?? [], warnings: d.warnings ?? [],
  competitions: (d.competitions ?? []).map(c => ({ id: c.id, name: c.name, status: c.status, total: num(c.total), final: num(c.final), state: c.state, finalizedAt: c.finalized_at }))
});
export async function fetchClosePreflight(eventId: string): Promise<ClosePreflight> {
  const { data, error } = await supabase.rpc('event_close_preflight', { p_event: eventId });
  if (error) throw error;
  return toClosePreflight(data as ClosePreflightDb);
}
export async function closeEvent(eventId: string, note?: string): Promise<{ status: 'closed' | 'already_closed'; closedAt: string | null }> {
  const { data, error } = await supabase.rpc('close_event', { p_event: eventId, p_note: note?.trim() || null });
  if (error) throw error;
  const d = data as { status: 'closed' | 'already_closed'; closed_at: string | null };
  return { status: d.status, closedAt: d.closed_at };
}
export async function reopenEvent(eventId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_event', { p_event: eventId, p_reason: reason.trim() });
  if (error) throw error;
}

// ---------------------------------------------------------------- the official placings, public
export interface OfficialResult {
  competitionId: string; entryId: string; place: number; points: number; kind: PlacementKind; name: string;
  teamSlug: string | null; teamCurrentName: string | null; fighterId: string | null; entryStatus: string;
  representedTeamName: string | null; representedTeamSlug: string | null;
}
type OfficialDb = {
  competition_id: string; entry_id: string; final_place: number; points: number | string; entry_status: string; kind: PlacementKind;
  team_id: string | null; team_slug: string | null; team_name_at_event: string | null; team_current_name: string | null;
  fighter_id: string | null; fighter_name: string | null; represented_team_id: string | null; represented_team_slug: string | null; represented_team_name_at_event: string | null;
};
export const toOfficialResult = (r: OfficialDb): OfficialResult => ({
  competitionId: r.competition_id, entryId: r.entry_id, place: r.final_place, points: num(r.points), kind: r.kind,
  name: r.kind === 'team' ? r.team_name_at_event ?? 'Unnamed team' : r.fighter_name ?? 'Unnamed fighter',
  teamSlug: r.team_slug, teamCurrentName: r.team_current_name, fighterId: r.fighter_id, entryStatus: r.entry_status,
  representedTeamName: r.represented_team_name_at_event, representedTeamSlug: r.represented_team_slug
});
const OFFICIAL_COLUMNS = 'competition_id,entry_id,final_place,points,entry_status,kind,team_id,team_slug,team_name_at_event,team_current_name,fighter_id,fighter_name,represented_team_id,represented_team_slug,represented_team_name_at_event';
/** Every official placing of these competitions (none for a competition that is not official yet), best place first. */
export async function fetchOfficialResults(competitionIds: readonly string[]): Promise<OfficialResult[]> {
  if (competitionIds.length === 0) return [];
  const { data, error } = await supabase.from('competition_results').select(OFFICIAL_COLUMNS).in('competition_id', [...competitionIds]).order('final_place').limit(2000);
  if (error) throw error;
  return (data as unknown as OfficialDb[]).map(toOfficialResult);
}
