import { supabase } from '../lib/supabase';

/**
 * The running score of a fight still in progress (Pack 09B, public.match_live_scores). Display state for the venue screen: never a result.
 * A scorer's device reports a snapshot after each change; everyone who may see the match may read it; it disappears when the match is final.
 */
export interface LiveScore {
  matchId: string; competitionId: string; scoreA: number; scoreB: number;
  /** One short line from the board: "Round 2 of 2", "Extra round", "Round 3 · Polearm". */
  phase: string;
  /** Mode-specific summary the display may use (see LiveScoreDetail). */
  detail: LiveScoreDetail; updatedAt: string;
}
/** What a board tells the display beyond two numbers. Every field optional: the display shows what it gets. */
export interface LiveScoreDetail {
  mode?: 'group' | 'duel' | 'pro' | 'marathon' | 'series';
  /** Group fight: fighters still standing per side and rounds needed. */
  standing?: { a: number; b: number }; roundsToWin?: number;
  /** Duel / series: per-round points. */
  rounds?: Array<{ a: number; b: number; label?: string }>;
  /** The side that has already won the fight on the board (the result is not official until saved). */
  decided?: 'a' | 'b' | 'draw';
}
export type ReportStatus = 'ok' | 'older' | 'stale' | 'final';

type Row = { match_id: string; competition_id: string; score_a: number; score_b: number; phase: string; detail: LiveScoreDetail | null; updated_at: string };
const toLiveScore = (r: Row): LiveScore => ({ matchId: r.match_id, competitionId: r.competition_id, scoreA: Number(r.score_a), scoreB: Number(r.score_b), phase: r.phase ?? '', detail: r.detail ?? {}, updatedAt: r.updated_at });

/** The live scores of one competition's matches (normally zero or one row). */
export async function fetchLiveScores(competitionId: string): Promise<LiveScore[]> {
  const { data, error } = await supabase.from('match_live_scores').select('match_id,competition_id,score_a,score_b,phase,detail,updated_at').eq('competition_id', competitionId);
  // 42P01: the table does not exist yet (a database that has not had the Pack 09B update). The display then shows no running score, nothing else breaks.
  if (error && (error as { code?: string }).code === '42P01') return [];
  if (error) throw error;
  return (data as unknown as Row[]).map(toLiveScore);
}

export interface ReportInput { matchId: string; device: string; seq: number; scoreA: number; scoreB: number; phase: string; detail: LiveScoreDetail; expectedVersion: number }
/**
 * Report a snapshot. The database checks the caller may score the event, refuses a final match ('final') and a device that opened an older version of
 * the match ('stale'), and ignores a snapshot older than the one it has from the same device ('older'). Throws only on a refusal or no signal.
 */
export async function reportLiveScore(i: ReportInput): Promise<ReportStatus> {
  const { data, error } = await supabase.rpc('report_live_score', {
    p_match: i.matchId, p_device: i.device, p_seq: i.seq, p_score_a: i.scoreA, p_score_b: i.scoreB, p_phase: i.phase, p_detail: i.detail, p_expected_version: i.expectedVersion
  });
  if (error) throw error;
  return ((data as { status?: ReportStatus } | null)?.status ?? 'ok');
}
