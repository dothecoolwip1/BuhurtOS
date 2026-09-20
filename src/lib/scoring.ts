import type { MatchResultSummary, ScoreRound, ScoringConfig } from '../types';

export interface ScoreValidation {
  valid: boolean;
  errors: string[];
  result?: MatchResultSummary;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function validateScore(config: ScoringConfig, rounds: ScoreRound[], forfeit?: { side: 1 | 2; reason: string }): ScoreValidation {
  const errors: string[] = [];

  if (forfeit) {
    if (config.requireReasonOnForfeit && !forfeit.reason.trim()) errors.push('A forfeit reason is required.');
    if (errors.length) return { valid: false, errors };
    return {
      valid: true,
      errors,
      result: {
        winnerSide: forfeit.side === 1 ? 2 : 1,
        side1Total: 0,
        side2Total: 0,
        roundsWonSide1: 0,
        roundsWonSide2: 0,
        resultType: 'forfeit',
        forfeitReason: forfeit.reason.trim()
      }
    };
  }

  if (rounds.length !== config.roundsRequired) {
    errors.push(`Exactly ${config.roundsRequired} round${config.roundsRequired === 1 ? '' : 's'} must be submitted.`);
  }

  const seen = new Set<number>();
  for (const round of rounds) {
    if (!Number.isInteger(round.roundNumber) || round.roundNumber < 1 || round.roundNumber > config.roundsRequired) {
      errors.push(`Round ${round.roundNumber} is outside the configured range.`);
    }
    if (seen.has(round.roundNumber)) errors.push(`Round ${round.roundNumber} is duplicated.`);
    seen.add(round.roundNumber);

    if (!finiteNonNegative(round.side1Score) || !finiteNonNegative(round.side2Score)) {
      errors.push(`Round ${round.roundNumber} contains an invalid score.`);
    }
    if (config.scoreCapPerRound !== undefined && (round.side1Score > config.scoreCapPerRound || round.side2Score > config.scoreCapPerRound)) {
      errors.push(`Round ${round.roundNumber} exceeds the score cap of ${config.scoreCapPerRound}.`);
    }
    if (!config.allowDrawRound && round.side1Score === round.side2Score) {
      errors.push(`Round ${round.roundNumber} cannot end tied.`);
    }
  }

  if (errors.length) return { valid: false, errors };

  const ordered = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  const side1Total = ordered.reduce((sum, r) => sum + r.side1Score, 0);
  const side2Total = ordered.reduce((sum, r) => sum + r.side2Score, 0);
  const roundsWonSide1 = ordered.filter(r => r.side1Score > r.side2Score).length;
  const roundsWonSide2 = ordered.filter(r => r.side2Score > r.side1Score).length;

  let winnerSide: 1 | 2 | null = null;
  let resultType: MatchResultSummary['resultType'] = 'points';

  if (config.kind === 'team_fight' || config.winsRequired !== undefined) {
    resultType = 'rounds';
    const winsRequired = config.winsRequired ?? Math.floor(config.roundsRequired / 2) + 1;
    if (roundsWonSide1 >= winsRequired) winnerSide = 1;
    else if (roundsWonSide2 >= winsRequired) winnerSide = 2;
    else if (roundsWonSide1 !== roundsWonSide2) winnerSide = roundsWonSide1 > roundsWonSide2 ? 1 : 2;
  } else {
    if (side1Total > side2Total) winnerSide = 1;
    if (side2Total > side1Total) winnerSide = 2;
  }

  if (winnerSide === null) resultType = 'draw';

  return {
    valid: true,
    errors: [],
    result: { winnerSide, side1Total, side2Total, roundsWonSide1, roundsWonSide2, resultType }
  };
}
