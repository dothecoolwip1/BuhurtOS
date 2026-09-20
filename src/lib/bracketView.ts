import type { MatchRecord } from '../types';

export function groupBracketRounds(matches: MatchRecord[]): Array<{ round: number; matches: MatchRecord[] }> {
  const map = new Map<number, MatchRecord[]>();
  for (const match of matches.filter(m => m.bracketRound)) {
    const round = match.bracketRound!;
    if (!map.has(round)) map.set(round, []);
    map.get(round)!.push(match);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([round, roundMatches]) => ({ round, matches: roundMatches.sort((a, b) => a.scheduledOrder - b.scheduledOrder) }));
}
