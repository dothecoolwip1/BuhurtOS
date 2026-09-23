import type { MatchRecord, RosterEntry, UUID } from '../types';

export interface SeededEntry {
  entry: RosterEntry;
  seed: number;
}

export interface GeneratedBracket {
  size: number;
  rounds: number;
  matches: MatchRecord[];
}

const uuid = (): UUID => globalThis.crypto?.randomUUID?.() ?? `local-${Math.random().toString(36).slice(2)}-${Date.now()}`;

function nextPowerOfTwo(value: number): number {
  let n = 1;
  while (n < value) n *= 2;
  return n;
}

function bracketSeedOrder(size: number): number[] {
  let order = [1, 2];
  for (let current = 4; current <= size; current *= 2) {
    const mirror = current + 1;
    order = order.flatMap(seed => [seed, mirror - seed]);
  }
  return order;
}

function sameTeamCost(slots: Array<SeededEntry | null>, size: number): number {
  let cost = 0;
  for (let a = 0; a < slots.length; a += 1) {
    const left = slots[a];
    if (!left?.entry.teamId) continue;
    for (let b = a + 1; b < slots.length; b += 1) {
      const right = slots[b];
      if (!right || right.entry.teamId !== left.entry.teamId) continue;
      if (Math.floor(a / 2) === Math.floor(b / 2)) cost += 100000;
      else if (Math.floor(a / Math.max(2, size / 4)) === Math.floor(b / Math.max(2, size / 4))) cost += 1000;
      else if (Math.floor(a / Math.max(2, size / 2)) === Math.floor(b / Math.max(2, size / 2))) cost += 100;
      else cost += 1;
    }
  }
  return cost;
}

export function placeSeedsAntiFratricide(entries: SeededEntry[]): Array<SeededEntry | null> {
  const size = nextPowerOfTwo(Math.max(2, entries.length));
  const slots: Array<SeededEntry | null> = Array(size).fill(null);
  const ordered = [...entries].sort((a, b) => a.seed - b.seed || a.entry.displayName.localeCompare(b.entry.displayName));
  const order = bracketSeedOrder(size);
  const targetSlot = new Map<string, number>();

  ordered.forEach((candidate, index) => {
    const bracketSeed = index + 1;
    const slot = order.indexOf(bracketSeed);
    slots[slot] = candidate;
    targetSlot.set(candidate.entry.id, slot);
  });

  const occupied = slots.map((value, index) => value ? index : -1).filter(index => index >= 0);
  const score = () => {
    const team = sameTeamCost(slots, size);
    const seedDeviation = occupied.reduce((sum, slot) => {
      const item = slots[slot];
      if (!item) return sum;
      return sum + Math.abs(slot - (targetSlot.get(item.entry.id) ?? slot));
    }, 0);
    return team + seedDeviation * 2;
  };

  for (let pass = 0; pass < Math.min(64, occupied.length * occupied.length); pass += 1) {
    const base = score();
    let best = base;
    let bestSwap: [number, number] | null = null;
    for (let i = 0; i < occupied.length; i += 1) {
      for (let j = i + 1; j < occupied.length; j += 1) {
        const a = occupied[i];
        const b = occupied[j];
        [slots[a], slots[b]] = [slots[b], slots[a]];
        const candidateScore = score();
        [slots[a], slots[b]] = [slots[b], slots[a]];
        if (candidateScore < best) {
          best = candidateScore;
          bestSwap = [a, b];
        }
      }
    }
    if (!bestSwap) break;
    [slots[bestSwap[0]], slots[bestSwap[1]]] = [slots[bestSwap[1]], slots[bestSwap[0]]];
  }

  return slots;
}

export function generateSingleElimination(params: {
  organizationId: UUID;
  seasonId: UUID;
  eventId: UUID;
  fightCardId?: UUID;
  bracketId: UUID;
  category: string;
  matchType: string;
  entries: SeededEntry[];
  scoringConfig: MatchRecord['scoringConfig'];
}): GeneratedBracket {
  if (params.entries.length < 2) throw new Error('At least two competitors are required to generate a bracket.');
  const slots = placeSeedsAntiFratricide(params.entries);
  const size = slots.length;
  const rounds = Math.log2(size);
  const matchesByRound: MatchRecord[][] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const count = size / Math.pow(2, round);
    const roundMatches: MatchRecord[] = [];
    for (let index = 0; index < count; index += 1) {
      roundMatches.push({
        id: uuid(),
        organizationId: params.organizationId,
        seasonId: params.seasonId,
        eventId: params.eventId,
        fightCardId: params.fightCardId,
        bracketId: params.bracketId,
        label: round === rounds ? 'Final' : `Round ${round} • Match ${index + 1}`,
        category: params.category,
        matchType: params.matchType,
        scoringConfig: params.scoringConfig,
        status: 'scheduled',
        stage: round === rounds ? 'final' : 'bracket',
        scheduledOrder: round * 100 + index,
        bracketRound: round,
        bracketSlot: `${round}-${index + 1}`,
        participants: [],
        rounds: []
      });
    }
    matchesByRound.push(roundMatches);
  }

  const firstRound = matchesByRound[0];
  for (let i = 0; i < firstRound.length; i += 1) {
    const a = slots[i * 2];
    const b = slots[i * 2 + 1];
    firstRound[i].participants = [
      a ? { rosterEntryId: a.entry.id, sideIndex: 1, seed: a.seed } : { sideIndex: 1, isPlaceholder: true, placeholderLabel: 'BYE' },
      b ? { rosterEntryId: b.entry.id, sideIndex: 2, seed: b.seed } : { sideIndex: 2, isPlaceholder: true, placeholderLabel: 'BYE' }
    ];
  }

  for (let roundIndex = 0; roundIndex < matchesByRound.length - 1; roundIndex += 1) {
    const round = matchesByRound[roundIndex];
    const next = matchesByRound[roundIndex + 1];
    for (let i = 0; i < round.length; i += 1) {
      const target = next[Math.floor(i / 2)];
      const slot = (i % 2 === 0 ? 1 : 2) as 1 | 2;
      round[i].winnerAdvancesToMatchId = target.id;
      round[i].winnerAdvancesToSlot = slot;
      target.participants.push({ sideIndex: slot, isPlaceholder: true, placeholderLabel: `Winner ${round[i].label}`, sourceMatchId: round[i].id, sourceSlot: slot, isWinnerSource: true });
    }
  }

  let allMatches = matchesByRound.flat();
  for (const sourceId of firstRound.map(match => match.id)) {
    const match = allMatches.find(item => item.id === sourceId)!;
    const real = match.participants.filter(p => !p.isPlaceholder && p.rosterEntryId);
    const byes = match.participants.filter(p => p.isPlaceholder && p.placeholderLabel === 'BYE');
    if (real.length === 1 && byes.length === 1) {
      const winner = real[0];
      match.status = 'finalized';
      match.resultSummary = {
        winnerSide: winner.sideIndex,
        side1Total: 0,
        side2Total: 0,
        roundsWonSide1: 0,
        roundsWonSide2: 0,
        resultType: 'bye'
      };
      allMatches = advanceWinner(allMatches, match.id, winner.rosterEntryId!);
    }
  }

  return { size, rounds, matches: allMatches };
}

function placeAdvancedParticipant(copy: MatchRecord[], source: MatchRecord, targetId: UUID | undefined, targetSlot: 1 | 2 | undefined, rosterEntryId: UUID | undefined, isWinnerSource: boolean): void {
  if (!targetId || !targetSlot || !rosterEntryId) return;
  const target = copy.find(m => m.id === targetId);
  if (!target) throw new Error('Bracket target match is missing.');
  target.participants = target.participants.filter(p => p.sideIndex !== targetSlot);
  target.participants.push({ rosterEntryId, sideIndex: targetSlot, sourceMatchId: source.id, sourceSlot: targetSlot, isWinnerSource });
}

export function advanceOutcome(matches: MatchRecord[], completedMatchId: UUID, winnerRosterEntryId: UUID, loserRosterEntryId?: UUID): MatchRecord[] {
  const copy = structuredClone(matches);
  const source = copy.find(m => m.id === completedMatchId);
  if (!source) return copy;

  if (source.bracketSlot === 'GF-1' && source.winnerAdvancesToMatchId) {
    const reset = copy.find(m => m.id === source.winnerAdvancesToMatchId);
    if (!reset) throw new Error('Grand final reset match is missing.');
    const upperChampion = source.participants.find(p => p.sideIndex === 1)?.rosterEntryId;
    if (winnerRosterEntryId === upperChampion) {
      reset.status = 'cancelled';
      return copy;
    }
    reset.status = 'scheduled';
  }

  placeAdvancedParticipant(copy, source, source.winnerAdvancesToMatchId, source.winnerAdvancesToSlot, winnerRosterEntryId, true);
  placeAdvancedParticipant(copy, source, source.loserAdvancesToMatchId, source.loserAdvancesToSlot, loserRosterEntryId, false);
  return copy;
}

export function advanceWinner(matches: MatchRecord[], completedMatchId: UUID, winnerRosterEntryId: UUID): MatchRecord[] {
  return advanceOutcome(matches, completedMatchId, winnerRosterEntryId);
}


export function generateRoundRobin(params: {
  organizationId: UUID;
  seasonId: UUID;
  eventId: UUID;
  fightCardId?: UUID;
  bracketId: UUID;
  category: string;
  matchType: string;
  entries: SeededEntry[];
  scoringConfig: MatchRecord['scoringConfig'];
  labelPrefix?: string;
  orderOffset?: number;
}): GeneratedBracket {
  if (params.entries.length < 2) throw new Error('At least two competitors are required to generate a round robin.');
  const ordered = [...params.entries].sort((a,b) => a.seed - b.seed || a.entry.displayName.localeCompare(b.entry.displayName));
  const matches: MatchRecord[] = [];
  let order = params.orderOffset ?? 0;
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      order += 1;
      matches.push({
        id: uuid(),
        organizationId: params.organizationId,
        seasonId: params.seasonId,
        eventId: params.eventId,
        fightCardId: params.fightCardId,
        bracketId: params.bracketId,
        label: (params.labelPrefix ? params.labelPrefix + ' • ' : '') + 'Match ' + order,
        category: params.category,
        matchType: params.matchType,
        scoringConfig: structuredClone(params.scoringConfig),
        status: 'scheduled',
        stage: 'pool',
        scheduledOrder: order,
        bracketRound: 1,
        bracketSlot: (params.labelPrefix || 'RR') + '-' + order,
        participants: [
          { rosterEntryId: ordered[left].entry.id, sideIndex: 1, seed: ordered[left].seed },
          { rosterEntryId: ordered[right].entry.id, sideIndex: 2, seed: ordered[right].seed }
        ],
        rounds: []
      });
    }
  }
  return { size: ordered.length, rounds: Math.max(1, ordered.length - 1), matches };
}

export interface GeneratedPools extends GeneratedBracket {
  pools: Array<{ name: string; entryIds: UUID[] }>;
}

export function generateRoundRobinPools(params: {
  organizationId: UUID;
  seasonId: UUID;
  eventId: UUID;
  fightCardId?: UUID;
  bracketId: UUID;
  category: string;
  matchType: string;
  entries: SeededEntry[];
  scoringConfig: MatchRecord['scoringConfig'];
  targetPoolSize?: number;
}): GeneratedPools {
  if (params.entries.length < 3) throw new Error('At least three competitors are required to generate pools.');
  const targetPoolSize = Math.max(3, params.targetPoolSize ?? 4);
  const poolCount = Math.max(1, Math.ceil(params.entries.length / targetPoolSize));
  const pools: SeededEntry[][] = Array.from({ length: poolCount }, () => []);
  const ordered = [...params.entries].sort((a,b) => a.seed - b.seed || a.entry.displayName.localeCompare(b.entry.displayName));

  for (const candidate of ordered) {
    const rankedPools = pools
      .map((pool,index) => ({
        index,
        sameTeam: candidate.entry.teamId ? pool.filter(item => item.entry.teamId === candidate.entry.teamId).length : 0,
        size: pool.length
      }))
      .sort((a,b) => a.sameTeam - b.sameTeam || a.size - b.size || a.index - b.index);
    pools[rankedPools[0].index].push(candidate);
  }

  const matches: MatchRecord[] = [];
  let orderOffset = 0;
  pools.forEach((pool,index) => {
    const poolName = 'Pool ' + String.fromCharCode(65 + index);
    const generated = generateRoundRobin({
      organizationId: params.organizationId,
      seasonId: params.seasonId,
      eventId: params.eventId,
      fightCardId: params.fightCardId,
      bracketId: params.bracketId,
      category: params.category,
      matchType: params.matchType,
      entries: pool,
      scoringConfig: params.scoringConfig,
      labelPrefix: poolName,
      orderOffset
    });
    generated.matches.forEach(match => {
      match.scheduledOrder = matches.length + 1;
      match.bracketSlot = poolName.replace(' ','-') + '-' + (matches.length + 1);
      matches.push(match);
    });
    orderOffset = matches.length;
  });

  return {
    size: params.entries.length,
    rounds: Math.max(...pools.map(pool => Math.max(1,pool.length - 1))),
    matches,
    pools: pools.map((pool,index) => ({ name: 'Pool ' + String.fromCharCode(65 + index), entryIds: pool.map(item => item.entry.id) }))
  };
}


export function generateDoubleElimination(params: {
  organizationId: UUID;
  seasonId: UUID;
  eventId: UUID;
  fightCardId?: UUID;
  bracketId: UUID;
  category: string;
  matchType: string;
  entries: SeededEntry[];
  scoringConfig: MatchRecord['scoringConfig'];
}): GeneratedBracket {
  if (params.entries.length < 4) throw new Error('Double elimination requires at least four competitors.');
  if (nextPowerOfTwo(params.entries.length) !== params.entries.length) throw new Error('Double elimination currently requires a power-of-two field (4, 8, 16, 32). Use pools first when the field size is uneven.');
  const upper = generateSingleElimination(params);
  const upperRounds = Math.log2(upper.size);
  const upperMatches = upper.matches;
  const upperByRound = new Map<number, MatchRecord[]>();
  for (let round = 1; round <= upperRounds; round += 1) {
    upperByRound.set(round, upperMatches.filter(match => match.bracketRound === round).sort((a,b) => (a.bracketSlot ?? '').localeCompare(b.bracketSlot ?? '')));
  }

  const lowerRounds = Math.max(2, upperRounds * 2 - 2);
  const lowerByRound: MatchRecord[][] = [];
  for (let lowerRound = 1; lowerRound <= lowerRounds; lowerRound += 1) {
    const exponent = Math.floor((lowerRound + 1) / 2) + 1;
    const count = Math.max(1, upper.size / Math.pow(2, exponent));
    const roundMatches: MatchRecord[] = [];
    for (let index = 0; index < count; index += 1) {
      roundMatches.push({
        id: uuid(),
        organizationId: params.organizationId,
        seasonId: params.seasonId,
        eventId: params.eventId,
        fightCardId: params.fightCardId,
        bracketId: params.bracketId,
        label: 'Lower Round ' + lowerRound + ' • Match ' + (index + 1),
        category: params.category,
        matchType: params.matchType,
        scoringConfig: structuredClone(params.scoringConfig),
        status: 'scheduled',
        stage: 'bracket',
        scheduledOrder: 1000 + lowerRound * 100 + index,
        bracketRound: upperRounds + lowerRound,
        bracketSlot: 'L' + lowerRound + '-' + (index + 1),
        participants: [],
        rounds: []
      });
    }
    lowerByRound.push(roundMatches);
  }

  for (let roundIndex = 0; roundIndex < lowerByRound.length - 1; roundIndex += 1) {
    const current = lowerByRound[roundIndex];
    const next = lowerByRound[roundIndex + 1];
    const lowerRound = roundIndex + 1;
    current.forEach((match,index) => {
      const targetIndex = lowerRound % 2 === 1 ? index : Math.floor(index / 2);
      const target = next[targetIndex];
      const slot = (lowerRound % 2 === 1 ? 1 : (index % 2 === 0 ? 1 : 2)) as 1 | 2;
      match.winnerAdvancesToMatchId = target.id;
      match.winnerAdvancesToSlot = slot;
      target.participants.push({ sideIndex: slot, isPlaceholder: true, placeholderLabel: 'Winner ' + match.label, sourceMatchId: match.id, sourceSlot: slot, isWinnerSource: true });
    });
  }

  const firstUpper = upperByRound.get(1) ?? [];
  const firstLower = lowerByRound[0];
  firstUpper.forEach((match,index) => {
    const target = firstLower[Math.floor(index / 2)];
    if (!target) return;
    const slot = (index % 2 === 0 ? 1 : 2) as 1 | 2;
    match.loserAdvancesToMatchId = target.id;
    match.loserAdvancesToSlot = slot;
    target.participants.push({ sideIndex: slot, isPlaceholder: true, placeholderLabel: 'Loser ' + match.label, sourceMatchId: match.id, sourceSlot: slot, isWinnerSource: false });
  });

  for (let upperRound = 2; upperRound <= upperRounds; upperRound += 1) {
    const sources = upperByRound.get(upperRound) ?? [];
    const injectionRoundIndex = upperRound * 2 - 3;
    const targets = lowerByRound[injectionRoundIndex];
    sources.forEach((match,index) => {
      const target = targets[targets.length - 1 - index];
      if (!target) return;
      match.loserAdvancesToMatchId = target.id;
      match.loserAdvancesToSlot = 2;
      target.participants = target.participants.filter(p => p.sideIndex !== 2);
      target.participants.push({ sideIndex: 2, isPlaceholder: true, placeholderLabel: 'Loser ' + match.label, sourceMatchId: match.id, sourceSlot: 2, isWinnerSource: false });
    });
  }

  const upperFinal = (upperByRound.get(upperRounds) ?? [])[0];
  const lowerFinal = lowerByRound[lowerByRound.length - 1][0];
  const grandFinal: MatchRecord = {
    id: uuid(),
    organizationId: params.organizationId,
    seasonId: params.seasonId,
    eventId: params.eventId,
    fightCardId: params.fightCardId,
    bracketId: params.bracketId,
    label: 'Grand Final',
    category: params.category,
    matchType: params.matchType,
    scoringConfig: structuredClone(params.scoringConfig),
    status: 'scheduled',
    stage: 'final',
    scheduledOrder: 9000,
    bracketRound: upperRounds + lowerRounds + 1,
    bracketSlot: 'GF-1',
    participants: [
      { sideIndex: 1, isPlaceholder: true, placeholderLabel: 'Upper Bracket Champion', sourceMatchId: upperFinal.id, sourceSlot: 1, isWinnerSource: true },
      { sideIndex: 2, isPlaceholder: true, placeholderLabel: 'Lower Bracket Champion', sourceMatchId: lowerFinal.id, sourceSlot: 2, isWinnerSource: true }
    ],
    rounds: []
  };
  const resetFinal: MatchRecord = {
    ...structuredClone(grandFinal),
    id: uuid(),
    label: 'Grand Final Reset • If Required',
    status: 'cancelled',
    scheduledOrder: 9001,
    bracketRound: grandFinal.bracketRound! + 1,
    bracketSlot: 'GF-2',
    participants: [
      { sideIndex: 1, isPlaceholder: true, placeholderLabel: 'Grand Final competitor', sourceMatchId: grandFinal.id, sourceSlot: 1, isWinnerSource: true },
      { sideIndex: 2, isPlaceholder: true, placeholderLabel: 'Grand Final competitor', sourceMatchId: grandFinal.id, sourceSlot: 2, isWinnerSource: false }
    ]
  };

  upperFinal.winnerAdvancesToMatchId = grandFinal.id;
  upperFinal.winnerAdvancesToSlot = 1;
  lowerFinal.winnerAdvancesToMatchId = grandFinal.id;
  lowerFinal.winnerAdvancesToSlot = 2;
  grandFinal.winnerAdvancesToMatchId = resetFinal.id;
  grandFinal.winnerAdvancesToSlot = 1;
  grandFinal.loserAdvancesToMatchId = resetFinal.id;
  grandFinal.loserAdvancesToSlot = 2;

  return {
    size: upper.size,
    rounds: upperRounds + lowerRounds + 2,
    matches: [...upperMatches, ...lowerByRound.flat(), grandFinal, resetFinal]
  };
}


export interface PoolStanding {
  pool: string;
  rosterEntryId: UUID;
  name: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  differential: number;
  standingPoints: number;
}

export interface PoolQualificationState {
  ready: boolean;
  incompleteMatchIds: UUID[];
  pools: Array<{ name: string; standings: PoolStanding[] }>;
  qualifiers: SeededEntry[];
}

function poolNameForMatch(match: MatchRecord): string {
  const slotMatch = match.bracketSlot?.match(/^Pool-([A-Za-z0-9]+)-/);
  if (slotMatch) return 'Pool ' + slotMatch[1];
  const labelMatch = match.label.match(/^(Pool\s+[^•]+)(?:\s*•|$)/i);
  return labelMatch?.[1]?.trim() ?? 'Pool';
}

export function computePoolQualificationState(
  matches: MatchRecord[],
  roster: RosterEntry[],
  bracketId: UUID,
  qualifiersPerPool = 2
): PoolQualificationState {
  const poolMatches = matches.filter(match => match.bracketId === bracketId && match.stage === 'pool' && match.status !== 'cancelled');
  const incompleteMatchIds = poolMatches.filter(match => match.status !== 'finalized').map(match => match.id);
  const byPool = new Map<string, MatchRecord[]>();
  for (const match of poolMatches) {
    const pool = poolNameForMatch(match);
    if (!byPool.has(pool)) byPool.set(pool, []);
    byPool.get(pool)!.push(match);
  }

  const pools = [...byPool.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([pool,poolItems]) => {
    const rows = new Map<UUID, PoolStanding>();
    const ensure = (id: UUID) => {
      if (!rows.has(id)) {
        rows.set(id, {
          pool,
          rosterEntryId: id,
          name: roster.find(entry => entry.id === id)?.displayName ?? 'Unknown competitor',
          played: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          differential: 0,
          standingPoints: 0
        });
      }
      return rows.get(id)!;
    };

    for (const match of poolItems.filter(item => item.status === 'finalized')) {
      const side1Id = match.participants.find(p => p.sideIndex === 1)?.rosterEntryId;
      const side2Id = match.participants.find(p => p.sideIndex === 2)?.rosterEntryId;
      if (!side1Id || !side2Id || !match.resultSummary || match.resultSummary.resultType === 'bye') continue;
      const left = ensure(side1Id);
      const right = ensure(side2Id);
      left.played += 1;
      right.played += 1;
      left.pointsFor += match.resultSummary.side1Total;
      left.pointsAgainst += match.resultSummary.side2Total;
      right.pointsFor += match.resultSummary.side2Total;
      right.pointsAgainst += match.resultSummary.side1Total;
      if (match.resultSummary.winnerSide === 1) {
        left.wins += 1; right.losses += 1; left.standingPoints += 3;
      } else if (match.resultSummary.winnerSide === 2) {
        right.wins += 1; left.losses += 1; right.standingPoints += 3;
      } else {
        left.draws += 1; right.draws += 1; left.standingPoints += 1; right.standingPoints += 1;
      }
    }

    const standings = [...rows.values()]
      .map(row => ({ ...row, differential: row.pointsFor - row.pointsAgainst }))
      .sort((a,b) =>
        b.standingPoints - a.standingPoints ||
        b.wins - a.wins ||
        b.differential - a.differential ||
        b.pointsFor - a.pointsFor ||
        a.name.localeCompare(b.name)
      );
    return { name: pool, standings };
  });

  const qualifiers: SeededEntry[] = [];
  let seed = 1;
  for (let rank = 0; rank < qualifiersPerPool; rank += 1) {
    for (const pool of pools) {
      const standing = pool.standings[rank];
      if (!standing) continue;
      const entry = roster.find(item => item.id === standing.rosterEntryId);
      if (entry) qualifiers.push({ entry, seed: seed++ });
    }
  }

  return { ready: poolMatches.length > 0 && incompleteMatchIds.length === 0, incompleteMatchIds, pools, qualifiers };
}
