import type { EventRecord, MatchRecord, RosterEntry } from '../types';

export interface StandingRow {
  rosterEntryId: string;
  name: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  differential: number;
  standingPoints: number;
}

export function computeEventStandings(event: EventRecord, matches: MatchRecord[], roster: RosterEntry[]): StandingRow[] {
  if (event.standingsMode === 'no_standings') return [];
  const rows = new Map<string, StandingRow>();
  const names = new Map(roster.map(r => [r.id, r.displayName]));

  for (const match of matches.filter(m => m.eventId === event.id && m.status === 'finalized' && m.resultSummary && m.resultSummary.resultType !== 'bye')) {
    const sides = match.participants.filter(p => !p.isPlaceholder && p.rosterEntryId);
    if (sides.length < 2) continue;
    for (const p of sides) {
      const id = p.rosterEntryId!;
      if (!rows.has(id)) rows.set(id, { rosterEntryId: id, name: names.get(id) ?? 'Unknown', matches: 0, wins: 0, losses: 0, draws: 0, pointsFor: 0, pointsAgainst: 0, differential: 0, standingPoints: 0 });
    }
    const side1 = sides.find(p => p.sideIndex === 1)?.rosterEntryId;
    const side2 = sides.find(p => p.sideIndex === 2)?.rosterEntryId;
    if (!side1 || !side2) continue;
    const r1 = rows.get(side1)!;
    const r2 = rows.get(side2)!;
    const result = match.resultSummary!;
    r1.matches += 1;
    r2.matches += 1;
    r1.pointsFor += result.side1Total;
    r1.pointsAgainst += result.side2Total;
    r2.pointsFor += result.side2Total;
    r2.pointsAgainst += result.side1Total;
    if (result.winnerSide === 1) { r1.wins += 1; r2.losses += 1; r1.standingPoints += 3; }
    else if (result.winnerSide === 2) { r2.wins += 1; r1.losses += 1; r2.standingPoints += 3; }
    else { r1.draws += 1; r2.draws += 1; r1.standingPoints += 1; r2.standingPoints += 1; }
  }

  return [...rows.values()].map(r => ({ ...r, differential: r.pointsFor - r.pointsAgainst })).sort((a, b) =>
    b.standingPoints - a.standingPoints || b.differential - a.differential || b.pointsFor - a.pointsFor || a.name.localeCompare(b.name)
  );
}
