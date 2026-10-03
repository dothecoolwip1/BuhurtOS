/**
 * A one-line, factual explanation of a finished match, built ONLY from the recorded result and score detail with fixed templates. No model is asked
 * why someone won: this restates what the scorekeeper recorded. Returns null when there is nothing safe to say.
 */
import type { CompetitionMatch } from '../data/matches';

const rounds = (n: number) => `${n} round${n === 1 ? '' : 's'}`;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function explainResult(m: Pick<CompetitionMatch, 'queueState' | 'result' | 'nameA' | 'nameB' | 'scoreA' | 'scoreB' | 'detail' | 'stage'>): string | null {
  if (m.queueState !== 'final' || !m.result || m.scoreA === null || m.scoreB === null) return null;
  const a = m.nameA ?? 'Side A', b = m.nameB ?? 'Side B';
  const winner = m.result === 'a' ? a : m.result === 'b' ? b : null;
  const hi = Math.max(m.scoreA, m.scoreB), lo = Math.min(m.scoreA, m.scoreB);
  const d = isObj(m.detail) ? m.detail : {};
  if (m.result === 'draw') return `Level at ${m.scoreA}–${m.scoreB}: a draw${m.stage === 'pool' || m.stage === 'round_robin' ? ', which counts as neither a win nor a loss in the standings' : ''}.`;
  if (!winner) return null;
  if (d.kind === 'group') {
    const toWin = typeof d.roundsToWin === 'number' ? d.roundsToWin : null;
    return `${winner} won ${rounds(hi)} to ${lo}${toWin ? ` (first to ${toWin})` : ''}.`;
  }
  if (d.kind === 'duel') {
    const r = isObj(d.rounds) && Array.isArray(d.rounds.a) ? d.rounds.a.length : null;
    return `${winner} won on points, ${hi}–${lo}${r ? ` over ${rounds(r)}` : ''}.`;
  }
  if (d.kind === 'pro') return `${winner} won on the judges' round scores, ${hi}–${lo}.`;
  return `${winner} won ${hi}–${lo}.`;
}
