/** A drop puts the moving fight in the target's place; buttons use the same operation. */
export function moveLineup<T extends { id: string }>(rows: readonly T[], from: string, to: string): T[] {
  const a = rows.findIndex(r => r.id === from), b = rows.findIndex(r => r.id === to);
  if (a < 0 || b < 0 || a === b) return [...rows];
  const next = [...rows];
  next.splice(b, 0, ...next.splice(a, 1));
  return next;
}
