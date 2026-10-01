import type { BoardMode, BoardState } from './fieldScoring';

/** The board for a match is kept on the device, so a refresh or a dropped tab does not lose a half-scored fight. */
const key = (matchId: string) => `bos-board-v1:${matchId}`;

export function loadBoard(matchId: string, mode: BoardMode): BoardState | null {
  try {
    const raw = localStorage.getItem(key(matchId));
    if (!raw) return null;
    const v = JSON.parse(raw) as BoardState;
    return v && v.mode === mode && v.s ? v : null;
  } catch { return null; }
}
export function saveBoard(matchId: string, board: BoardState): void {
  try { localStorage.setItem(key(matchId), JSON.stringify(board)); } catch { /* blocked or full: the screen still works */ }
}
export function clearBoard(matchId: string): void {
  try { localStorage.removeItem(key(matchId)); } catch { /* ignore */ }
}
