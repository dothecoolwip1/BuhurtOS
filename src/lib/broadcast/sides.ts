import type { CrestDivision, Team } from '../../data/types';

/**
 * One side of a fight as the broadcast presents it. Everything comes from records that already exist and are public (entries, teams, fighters, the career
 * functions): nothing is copied into broadcast tables and nothing is invented. A field with no data is simply left out.
 */
export interface SideSource {
  entryId: string;
  kind: 'team' | 'fighter';
  name: string;
  /** The team the fighter belongs to (or the entry's own team), for the crest and the sub-line. */
  team: { id: string; name: string; colors: [string, string]; division: CrestDivision; initial: string; emblemUrl: string | null; city: string | null; region: string | null; country: string | null } | null;
  avatarUrl: string | null;
  record: { wins: number; losses: number; draws: number; test: boolean } | null;
}

export type CornerScheme = 'red_blue' | 'team_colors';
export interface Corner { color: string; ink: string; label: string }
export interface SidePresentation {
  side: 'a' | 'b';
  name: string;
  /** Team name under a fighter's name, or the place under a team's name. */
  subtitle: string | null;
  place: string | null;
  avatarUrl: string | null;
  crest: Team | null;
  record: string | null;
  recordNote: string | null;
  corner: Corner;
}

export const RED = '#D7263D';
export const BLUE = '#1F6FEB';
const INK_ON = (hex: string): string => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? '#10151D' : '#FFFFFF';
};

export function cornerFor(side: 'a' | 'b', scheme: CornerScheme, team: SideSource['team']): Corner {
  if (scheme === 'team_colors' && team) { const c = team.colors[0]; return { color: c, ink: INK_ON(c), label: side === 'a' ? 'A' : 'B' }; }
  const color = side === 'a' ? RED : BLUE;
  return { color, ink: '#FFFFFF', label: side === 'a' ? 'RED' : 'BLUE' };
}

export const formatRecord = (r: { wins: number; losses: number; draws: number }): string => `${r.wins}-${r.losses}${r.draws > 0 ? `-${r.draws}` : ''}`;

const placeOf = (t: NonNullable<SideSource['team']>): string | null => [t.city, t.region, t.country].filter(Boolean).slice(0, 2).join(', ') || null;

export function presentSide(src: SideSource | null, side: 'a' | 'b', fallbackName: string, opts: { scheme: CornerScheme; records: boolean; photos: boolean }): SidePresentation {
  const team = src?.team ?? null;
  const crest: Team | null = team ? {
    id: team.id, name: team.name, place: placeOf(team) ?? '', colors: team.colors, division: team.division, initial: team.initial || team.name.slice(0, 1).toUpperCase(),
    emblemUrl: team.emblemUrl, points: 0, record: [0, 0]
  } : null;
  const isFighter = src?.kind === 'fighter';
  return {
    side, name: src?.name ?? fallbackName,
    subtitle: isFighter ? team?.name ?? null : team ? placeOf(team) : null,
    place: team ? placeOf(team) : null,
    avatarUrl: opts.photos && isFighter ? src?.avatarUrl ?? null : null,
    crest,
    record: opts.records && src?.record ? formatRecord(src.record) : null,
    recordNote: opts.records && src?.record?.test ? 'test record' : null,
    corner: cornerFor(side, opts.scheme, team)
  };
}
