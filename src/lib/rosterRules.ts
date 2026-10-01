import type { RosterRole } from '../data/fighters';

/** Roster rules for group-fight (team) entries. The database allows at most 40; each format has its own starting size. */
export const DB_ROSTER_MAX = 40;

/** How many fight at once: "5v5" -> 5, "3v3" -> 3, "12v12" -> 12. Null when the category is not a team format. */
export function formatSize(category: string): number | null {
  const m = /^(\d{1,2})\s*v\s*(\d{1,2})$/i.exec(category.trim());
  return m && m[1] === m[2] ? Number(m[1]) : null;
}

export interface RosterPerson { fighterId: string; role: RosterRole }

/** `errors` block saving; `notes` are worth knowing and do not. */
export interface RosterCheck { ok: boolean; errors: string[]; notes: string[] }

/** Check a roster before saving. Fewer than the format size is allowed (the team may still be filling it) but is noted. */
export function validateRoster(roster: readonly RosterPerson[], size: number | null): RosterCheck {
  const errors: string[] = [];
  const notes: string[] = [];
  if (new Set(roster.map(r => r.fighterId)).size !== roster.length) errors.push('A fighter is listed twice.');
  if (roster.length > DB_ROSTER_MAX) errors.push(`A roster can have at most ${DB_ROSTER_MAX} fighters.`);
  if (size !== null) {
    const diff = Math.abs(roster.length - size);
    if (roster.length < size) notes.push(`${size} fighters take the field. This roster has ${roster.length}, so ${diff} more ${diff === 1 ? 'is' : 'are'} needed.`);
    else if (roster.length > size) notes.push(`${size} take the field; the other ${diff} ${diff === 1 ? 'is a substitute' : 'are substitutes'}.`);
  }
  return { ok: errors.length === 0, errors, notes };
}

/** Whether a fighter can be added right now, and why not. */
export function canAdd(roster: readonly RosterPerson[], fighterId: string): { ok: true } | { ok: false; reason: string } {
  if (roster.some(r => r.fighterId === fighterId)) return { ok: false, reason: 'Already on this roster.' };
  if (roster.length >= DB_ROSTER_MAX) return { ok: false, reason: `A roster can have at most ${DB_ROSTER_MAX} fighters.` };
  return { ok: true };
}

export interface Candidate { fighterId: string; homeTeamId: string | null; homeTeamName: string | null }

/** Members of the entry's own team are 'fighter'. Someone from another team is a 'mercenary' (default) or a 'guest'. Someone with no team is a 'guest'. */
export function roleChoices(c: Candidate, entryTeamId: string | null): RosterRole[] {
  if (c.homeTeamId && c.homeTeamId === entryTeamId) return ['fighter'];
  return c.homeTeamId ? ['mercenary', 'guest'] : ['guest'];
}

/** What to tell the organizer before adding someone from outside the team. */
export function homeTeamNotice(c: Candidate, role: RosterRole, entryTeamName: string): string | null {
  if (role === 'fighter') return null;
  const home = c.homeTeamName ? `stays on ${c.homeTeamName}` : 'has no home team and stays that way';
  return `${role === 'mercenary' ? 'Fights' : 'Joins'} for ${entryTeamName} at this event only. Their own team does not change: they ${home}.`;
}

/** Turns a database refusal into plain words; null when the message is not a known one. */
export function rosterRefusal(message: string | undefined | null): string | null {
  const m = (message ?? '').toLowerCase();
  if (!m) return null;
  if (m.includes('already on another entry')) return 'That fighter is already on another team in this competition. A fighter can only fight for one entry per competition.';
  if (m.includes('is finished')) return 'This competition is finished. Reopen a match before changing a roster.';
  if (m.includes('only team entries')) return 'Only team entries have a roster. A duel entry is one fighter.';
  if (m.includes('at most 40')) return `A roster can have at most ${DB_ROSTER_MAX} fighters.`;
  if (m.includes('listed twice')) return 'A fighter is listed twice.';
  if (m.includes('mercenary must belong')) return 'A mercenary needs a home team other than this one. Add them as a guest instead.';
  if (m.includes('another team must be')) return 'That fighter belongs to another team. Add them as a mercenary or a guest.';
  if (m.includes('only an organizer')) return 'Only an organizer of this event can change a roster.';
  if (m.includes('fighter not found')) return 'That fighter could not be found.';
  return null;
}
