import type { EntrantCandidate } from '../data/entrants';

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** "Team One · Calgary, AB": what lets an organizer tell two people with the same name apart. */
export function candidateContext(c: Pick<EntrantCandidate, 'team' | 'city' | 'region'>): string {
  const place = [c.city, c.region].filter(Boolean).join(', ');
  return [c.team, place].filter(Boolean).join(' · ') || 'No team or location on record';
}

/** Existing fighters whose name is the same as what is being typed. Never merged automatically; the organizer decides. */
export function sameNameCandidates(found: EntrantCandidate[], name: string): EntrantCandidate[] {
  const n = norm(name);
  return n.length < 2 ? [] : found.filter(c => norm(c.name) === n);
}

export function newEntrantProblem(name: string): string | null {
  const n = norm(name);
  if (n.length < 2) return 'Enter the fighter\'s name (at least 2 characters).';
  if (n.length > 80) return 'The name is at most 80 characters.';
  return null;
}

/** The database refuses a same-name create until the organizer confirms it is a different person. */
export const isLookAlikeRefusal = (e: unknown): boolean => /already exist/i.test((e as { message?: string } | null)?.message ?? '');

export interface TeamOption { id: string; name: string }
/** Group fights: the team the fighter stands on, only when their own team is known. Never guesses another team; empty means "ask the organizer". */
export function defaultEntryTeam(candidateTeam: string | null, entered: TeamOption[], all: TeamOption[]): string {
  const byName = (list: TeamOption[]) => (candidateTeam ? list.find(t => norm(t.name) === norm(candidateTeam)) : undefined);
  return (byName(entered) ?? byName(all))?.id ?? '';
}

/** What to tell the organizer right after an add. */
export function addedMessage(name: string, already: boolean, drawExists: boolean): string {
  if (already) return `${name} is already in this competition.`;
  return `${name} is in.${drawExists ? ' A draw already exists: build a new draw to include them.' : ''}`;
}
