import { useEffect, useRef } from 'react';
import { reportLiveScore } from '../data/liveScores';
import type { BoardState } from './fieldScoring';
import { snapshotOf } from './liveScoreSnapshot';

/** One id per browser tab, so two tabs scoring the same match are two devices to the server. */
export function deviceId(): string {
  try {
    const k = 'bos-device';
    let v = sessionStorage.getItem(k);
    if (!v) { v = crypto.randomUUID().slice(0, 32); sessionStorage.setItem(k, v); }
    return v;
  } catch { return 'no-storage'; }
}

export const REPORT_DEBOUNCE_MS = 350;

/**
 * Sends the board's running score to the server for the venue display, a little after each change, latest wins. Fire and forget: no signal
 * means no report (nothing is lost; the next change sends the current state), and a refusal is logged, never shown as a scoring problem.
 * `seq` is the clock, so a reload of the same tab keeps counting up and a late packet can never overwrite a newer one.
 */
export function useLiveScoreReporter(opts: { matchId: string; version: number; stage: string; board: BoardState | null | undefined; active: boolean }) {
  const { matchId, version, stage, board, active } = opts;
  const timer = useRef<number | undefined>(undefined);
  const stopped = useRef(false);
  useEffect(() => { stopped.current = false; return () => { stopped.current = true; }; }, [matchId]);
  useEffect(() => {
    if (!active || !board || stopped.current) return;
    window.clearTimeout(timer.current);
    const snap = snapshotOf(board, stage);
    timer.current = window.setTimeout(() => {
      reportLiveScore({ matchId, device: deviceId(), seq: Date.now(), scoreA: snap.scoreA, scoreB: snap.scoreB, phase: snap.phase, detail: snap.detail, expectedVersion: version })
        .then(status => { if (status === 'final' || status === 'stale') stopped.current = true; })
        .catch(() => { /* no signal or refused: the display keeps its last snapshot; the official result still comes through the normal path */ });
    }, REPORT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer.current);
  }, [matchId, version, stage, board, active]);
}
