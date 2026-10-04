import { supabase } from '../lib/supabase';

/** A fighter the organizer might add, with enough context to tell two people with the same name apart. */
export interface EntrantCandidate { fighterId: string; name: string; team: string | null; city: string | null; region: string | null; gender: string | null; claimed: boolean; inCompetition: boolean; inEvent: boolean }
export interface NewEntrant { name: string; homeTeamId: string | null; city: string; region: string; gender: string }
export interface AddResult { entryId: string | null; kind: 'fighter' | 'team' | null; already: boolean }
export interface CreatedEntrant extends AddResult { fighterId: string; flagged: boolean }

type CandidateDb = { fighter_id: string; display_name: string; team_name: string | null; city: string | null; region: string | null; gender: string | null; claimed: boolean; in_competition: boolean; in_event: boolean };

/** Search before creating: existing fighters in this competition's reach, never auto-matched. */
export async function searchEntrants(competitionId: string, query: string): Promise<EntrantCandidate[]> {
  const { data, error } = await supabase.rpc('search_fighters_for_entry', { p_competition: competitionId, p_query: query });
  if (error) throw error;
  return ((data ?? []) as CandidateDb[]).map(r => ({
    fighterId: r.fighter_id, name: r.display_name, team: r.team_name, city: r.city, region: r.region, gender: r.gender,
    claimed: r.claimed, inCompetition: r.in_competition, inEvent: r.in_event
  }));
}

const result = (d: unknown): AddResult => {
  const r = (d ?? {}) as { entry_id?: string | null; kind?: 'fighter' | 'team' | null; already?: boolean };
  return { entryId: r.entry_id ?? null, kind: r.kind ?? null, already: r.already === true };
};

/** Put an existing fighter into the competition. For team competitions `teamId` is the team entry they join. */
export async function addEntrant(competitionId: string, fighterId: string, teamId: string | null): Promise<AddResult> {
  const { data, error } = await supabase.rpc('add_entrant', { p_competition: competitionId, p_fighter: fighterId, p_team: teamId });
  if (error) throw error;
  return result(data);
}

/**
 * Create a permanent fighter record with no account and enter them, in one step. A same-name fighter needs `confirmedDistinct`;
 * the database then also queues the pair for the platform administrator's identity review.
 */
export async function createUnclaimedEntrant(eventId: string, competitionId: string, person: NewEntrant, entryTeamId: string | null, confirmedDistinct: boolean): Promise<CreatedEntrant> {
  const { data, error } = await supabase.rpc('create_unclaimed_fighter', {
    p_event: eventId, p_name: person.name.trim(), p_home_team: person.homeTeamId, p_city: person.city.trim() || null, p_region: person.region.trim() || null,
    p_gender: person.gender || null, p_confirmed_distinct: confirmedDistinct, p_competition: competitionId, p_entry_team: entryTeamId
  });
  if (error) throw error;
  const d = (data ?? {}) as { fighter_id: string; flagged?: boolean; entry?: unknown };
  return { fighterId: d.fighter_id, flagged: d.flagged === true, ...result(d.entry) };
}

/** Which of these fighters have an account behind them. Yes/no only; the account itself is never exposed. */
export async function fetchClaimStates(ids: string[]): Promise<Map<string, boolean>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc('fighter_claim_states', { p_ids: ids });
  if (error) throw error;
  return new Map(((data ?? []) as Array<{ fighter_id: string; claimed: boolean }>).map(r => [r.fighter_id, r.claimed]));
}
