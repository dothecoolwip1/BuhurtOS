import type { LeagueId } from '../data/types';

export function LeagueIcon({ id, size = 30 }: { id: LeagueId; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 48 48', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const, 'aria-hidden': true };
  if (id === 'buhurt') return <svg {...common}><path d="M4 16h11v9c0 5-3 8-5.5 9C7 33 4 30 4 25Z" /><path d="M18.5 10h11v11c0 6-3 9.5-5.5 10.5-2.5-1-5.5-4.5-5.5-10.5Z" /><path d="M33 16h11v9c0 5-3 8-5.5 9-2.5-1-5.5-4-5.5-9Z" /></svg>;
  if (id === 'duels') return <svg {...common}><path d="M9 39 35 13M35 13l5-1-1 5M39 39 13 13M13 13 8 12l1 5M7 41l5-5M41 41l-5-5" /></svg>;
  return <svg {...common}><path d="M16 6h16l10 10v16L32 42H16L6 32V16Z" /><path d="M17 20l7 7 7-7" /></svg>;
}
