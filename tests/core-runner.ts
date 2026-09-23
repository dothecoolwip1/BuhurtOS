const assert = {
  equal(actual: unknown, expected: unknown, message = 'values differ') { if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`); },
  ok(value: unknown, message = 'expected truthy value') { if (!value) throw new Error(message); },
  notEqual(actual: unknown, expected: unknown, message = 'values should differ') { if (actual === expected) throw new Error(message); }
};
import { validateScore } from '../src/lib/scoring';
import { checkCompliance } from '../src/lib/compliance';
import { advanceWinner, generateRoundRobin, generateRoundRobinPools, generateSingleElimination, placeSeedsAntiFratricide } from '../src/lib/bracket';
import { computeEventStandings } from '../src/lib/standings';
import { resolveStreamEmbed } from '../src/lib/stream';
import type { EventRecord, MatchRecord, RosterEntry } from '../src/types';

const roster = (id: string, name: string, teamId: string): RosterEntry => ({
  id, organizationId: 'org', eventId: 'event', teamId, entryType: 'fighter', displayName: name,
  checkedIn: true, armorCleared: true, medicalCleared: true, waiverConfirmed: true, weighInCleared: true, attendanceStatus: 'approved'
});

const duel = validateScore({ kind: 'duel', roundsRequired: 3, allowDrawRound: false, scoreCapPerRound: 10 }, [
  { roundNumber: 1, side1Score: 3, side2Score: 1 },
  { roundNumber: 2, side1Score: 2, side2Score: 4 },
  { roundNumber: 3, side1Score: 5, side2Score: 2 }
]);
assert.equal(duel.valid, true);
assert.equal(duel.result?.winnerSide, 1);
assert.equal(duel.result?.side1Total, 10);

const invalid = validateScore({ kind: 'sword_buckler', roundsRequired: 2, allowDrawRound: false, scoreCapPerRound: 5 }, [
  { roundNumber: 1, side1Score: 6, side2Score: 1 },
  { roundNumber: 2, side1Score: 2, side2Score: 2 }
]);
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.length >= 2);

const blocked = checkCompliance({ ...roster('r1', 'Blocked Fighter', 't1'), armorCleared: false });
assert.equal(blocked.eligible, false);
assert.ok(blocked.missing.includes('armor clearance'));

const entries = [
  { entry: roster('a', 'A', 'red'), seed: 1 },
  { entry: roster('b', 'B', 'red'), seed: 2 },
  { entry: roster('c', 'C', 'blue'), seed: 3 },
  { entry: roster('d', 'D', 'blue'), seed: 4 },
  { entry: roster('e', 'E', 'green'), seed: 5 }
];
const slots = placeSeedsAntiFratricide(entries);
assert.equal(slots.length, 8);
const redSlots = slots.map((v, i) => v?.entry.teamId === 'red' ? i : -1).filter(i => i >= 0);
assert.notEqual(Math.floor(redSlots[0] / 2), Math.floor(redSlots[1] / 2));

const generated = generateSingleElimination({
  organizationId: 'org', seasonId: 'season', eventId: 'event', fightCardId: 'card', bracketId: 'bracket', category: 'Mens Duel', matchType: 'duel', entries,
  scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false }
});
assert.equal(generated.size, 8);
assert.equal(generated.matches.length, 7);
assert.ok(generated.matches.some(m => m.stage === 'final'));

const roundRobin = generateRoundRobin({
  organizationId: 'org', seasonId: 'season', eventId: 'event', bracketId: 'round-robin', category: 'Longsword', matchType: 'longsword', entries: entries.slice(0,4),
  scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false }
});
assert.equal(roundRobin.matches.length, 6, 'four-person round robin should generate six matches');
assert.ok(roundRobin.matches.every(match => match.stage === 'pool'));

const pools = generateRoundRobinPools({
  organizationId: 'org', seasonId: 'season', eventId: 'event', bracketId: 'pools', category: 'Longsword', matchType: 'longsword', entries,
  scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false }, targetPoolSize: 3
});
assert.equal(pools.pools.length, 2, 'five competitors with target size three should generate two pools');
assert.equal(pools.matches.length, 4, 'three-person plus two-person pools should generate four matches');
const redPoolAssignments = pools.pools.map(pool => pool.entryIds.filter(id => id === 'a' || id === 'b').length);
assert.ok(redPoolAssignments.every(count => count <= 1), 'same-team competitors should be separated across pools when possible');
const first = generated.matches[0];
const advanced = advanceWinner(generated.matches, first.id, first.participants.find(p => p.rosterEntryId)?.rosterEntryId ?? 'a');
if (first.winnerAdvancesToMatchId) {
  const target = advanced.find(m => m.id === first.winnerAdvancesToMatchId)!;
  assert.ok(target.participants.some(p => p.rosterEntryId));
}

const fivePersonBracket = generateSingleElimination({
  organizationId: 'org', seasonId: 'season', eventId: 'event', fightCardId: 'card', bracketId: 'five', category: 'Duel', matchType: 'duel', entries,
  scoringConfig: { kind: 'duel', roundsRequired: 3, allowDrawRound: false }
});
const opening = fivePersonBracket.matches.filter(match => match.bracketRound === 1);
assert.ok(opening.every(match => match.participants.some(p => p.rosterEntryId)), 'opening round must not contain BYE vs BYE matches');
const byeMatches = opening.filter(match => match.participants.some(p => p.isPlaceholder && p.placeholderLabel === 'BYE'));
assert.equal(byeMatches.length, 3, 'five-person eight-slot bracket should have three byes');
assert.ok(byeMatches.every(match => match.status === 'finalized' && match.resultSummary?.resultType === 'bye'), 'byes must auto-finalize');
for (const bye of byeMatches) {
  const target = fivePersonBracket.matches.find(match => match.id === bye.winnerAdvancesToMatchId);
  const winnerId = bye.participants.find(p => p.rosterEntryId)?.rosterEntryId;
  assert.ok(target?.participants.some(p => p.rosterEntryId === winnerId), 'bye winner must auto-advance');
}

assert.ok(resolveStreamEmbed('https://youtu.be/dQw4w9WgXcQ')?.embedUrl.includes('youtube.com/embed/'));
assert.equal(resolveStreamEmbed('http://example.com/not-safe'), null);

const event: EventRecord = {
  id: 'event', organizationId: 'org', seasonId: 'season', name: 'Test', venue: 'Test', startsAt: new Date().toISOString(), endsAt: new Date().toISOString(),
  eventType: 'ranked_competitive', standingsMode: 'season_and_event', status: 'completed', timezone: 'UTC'
};
const m: MatchRecord = {
  id: 'm', organizationId: 'org', seasonId: 'season', eventId: 'event', label: 'M1', category: 'Duel', matchType: 'duel', scoringConfig: { kind: 'duel', roundsRequired: 1 },
  status: 'finalized', stage: 'pool', scheduledOrder: 1, participants: [{ rosterEntryId: 'a', sideIndex: 1 }, { rosterEntryId: 'c', sideIndex: 2 }], rounds: [],
  resultSummary: { winnerSide: 1, side1Total: 5, side2Total: 3, roundsWonSide1: 1, roundsWonSide2: 0, resultType: 'points' }
};
const standings = computeEventStandings(event, [m], entries.map(x => x.entry));
assert.equal(standings[0].rosterEntryId, 'a');
assert.equal(standings[0].standingPoints, 3);
assert.equal(computeEventStandings({ ...event, standingsMode: 'no_standings' }, [m], entries.map(x => x.entry)).length, 0);

console.log('BuhurtOS core rule tests passed');
