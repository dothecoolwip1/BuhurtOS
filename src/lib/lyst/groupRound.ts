/** Recover the one unsynced team round from the board and authoritative confirmed rounds, including after reload. Never guess from the overall leader. */
export function pendingGroupWinner(board: { a: number; b: number }, rounds: readonly { status: string; awarded_a: number | null; awarded_b: number | null }[]): 'a' | 'b' | null {
  const confirmed = rounds.filter(r => r.status === 'confirmed');
  const a = board.a - confirmed.reduce((n, r) => n + (r.awarded_a ?? 0), 0);
  const b = board.b - confirmed.reduce((n, r) => n + (r.awarded_b ?? 0), 0);
  return a === 1 && b === 0 ? 'a' : b === 1 && a === 0 ? 'b' : null;
}
