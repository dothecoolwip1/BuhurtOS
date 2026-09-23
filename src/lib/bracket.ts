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

export function advanceWinner(matches: MatchRecord[], completedMatchId: UUID, winnerRosterEntryId: UUID): MatchRecord[] {
  const copy = structuredClone(matches);
  const source = copy.find(m => m.id === completedMatchId);
  if (!source?.winnerAdvancesToMatchId || !source.winnerAdvancesToSlot) return copy;
  const target = copy.find(m => m.id === source.winnerAdvancesToMatchId);
  if (!target) throw new Error('Bracket target match is missing.');
  const slot = source.winnerAdvancesToSlot;
  target.participants = target.participants.filter(p => p.sideIndex !== slot);
  target.participants.push({ rosterEntryId: winnerRosterEntryId, sideIndex: slot, sourceMatchId: source.id, sourceSlot: slot, isWinnerSource: true });
  return copy;
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
