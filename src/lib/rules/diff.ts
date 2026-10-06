/**
 * Pack 22: what changed in one rule between two versions of its document, word by word (a longest-common-subsequence diff). Display only: it never
 * decides which wording applies. Long texts beyond `limit` words are not diffed (the two texts are shown whole instead).
 */
export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string };

// A token is a word with the spaces after it, so removed and added words keep their own spacing when shown side by side.
const words = (s: string) => s.match(/^\s+|\S+\s*/g) ?? [];

export function wordDiff(older: string, newer: string, limit = 2500): DiffPart[] | null {
  const a = words(older);
  const b = words(newer);
  if (a.length > limit || b.length > limit) return null;
  const n = a.length, m = b.length;
  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => { const last = out[out.length - 1]; if (last && last.kind === kind) last.text += text; else out.push({ kind, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push('removed', a[i]); i++; }
    else { push('added', b[j]); j++; }
  }
  while (i < n) push('removed', a[i++]);
  while (j < m) push('added', b[j++]);
  return out;
}

/** True when the two texts read the same (ignoring spacing). */
export const sameWords = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
