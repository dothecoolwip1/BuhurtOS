/** A name reduced to what makes two team names "the same": case, punctuation, spacing and a leading "the" ignored. */
export const normalizeTeamName = (name: string): string =>
  name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');

/** Groups of teams whose names collapse to the same text, for the organizer to review. Only groups of two or more are returned. */
export function likelyDuplicates<T extends { id: string; name: string }>(teams: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const t of teams) {
    const key = normalizeTeamName(t.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

/** Why a merge cannot be offered, or null when the pair is fine to send to the database (which re-checks everything). */
export function mergeProblem(keep: { id: string; status: string } | undefined, remove: { id: string; status: string } | undefined): string | null {
  if (!keep || !remove) return 'Choose the team to keep and the team to merge into it.';
  if (keep.id === remove.id) return 'Choose two different teams.';
  if (keep.status !== 'approved' && remove.status === 'approved') return 'Keep the approved team, or approve the other one first.';
  return null;
}
