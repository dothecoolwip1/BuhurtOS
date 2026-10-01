import type { LiveEvent } from '../data/api';
import type { EventSummary, LeagueId } from '../data/types';
import { DRAFT_NOTICE } from '../lib/draftView';
import { dateBox, registrationWindow } from '../lib/dates';

/** Shapes a real event for the shared EventRow. Only facts the database holds are shown; the tier stays blank until one is set. */
export function toSummary(e: LiveEvent, now = new Date()): EventSummary {
  const box = dateBox(e.startsOn);
  const where = [e.venue, e.city && e.region ? `${e.city}, ${e.region}` : e.city ?? e.region].filter(Boolean) as string[];
  const badges: EventSummary['badges'] = [];
  if (e.status === 'draft') badges.push({ tone: '', label: DRAFT_NOTICE });
  else if (e.status === 'cancelled') badges.push({ tone: '', label: 'Cancelled' });
  else if (e.registrationMode === 'external') badges.push({ tone: 'brass', label: 'Tickets online' });
  else if (e.registrationMode === 'buhuros') {
    const w = registrationWindow(e.registrationOpensAt, e.registrationClosesAt, now);
    if (w === 'open') badges.push({ tone: 'brass', label: 'Registration open' });
    if (w === 'closed') badges.push({ tone: '', label: 'Registration closed' });
  }
  return {
    id: e.slug, month: box.month, day: box.day, year: box.year, name: e.name, meta: where, tier: null, badges, hasHub: true,
    leagues: e.leagues.filter((l): l is LeagueId => l !== 'hacsa')
  };
}
