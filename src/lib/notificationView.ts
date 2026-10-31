import type { AppNotification } from '../data/teamManager';

/** Where a notification takes you: sign-ups to the event, team matters to the team manager. */
export const notificationLink = (n: Pick<AppNotification, 'kind' | 'payload'>): string => {
  const ev = n.payload.event_slug;
  const evOk = typeof ev === 'string' && /^[a-z0-9-]+$/.test(ev);
  if (n.kind === 'fighter_claim_requested') return '/platform/fighters';
  if (n.kind === 'fighter_claim_decided') return n.payload.decision === 'approved' && typeof n.payload.fighter_id === 'string' && /^[0-9a-f-]{36}$/.test(n.payload.fighter_id) ? `/fighters/${n.payload.fighter_id}` : '/claim-profile';
  if (n.kind === 'bug_reported') return '/platform/bugs';
  if (n.kind === 'organization_suggested') return '/platform/organizations';
  if (n.kind === 'organization_suggestion_decided') {
    const org = n.payload.organization_slug;
    return n.payload.decision === 'approved' && typeof org === 'string' && /^[a-z0-9-]+$/.test(org) ? `/organizations/${org}` : '/organizations';
  }
  if (n.kind === 'registration_submitted') return evOk ? `/events/${ev}/control?mode=setup&tool=registrations` : '/account';
  if (n.kind === 'registration_decided' || n.kind === 'event_invited') return evOk ? `/events/${ev}` : '/account';
  if (n.kind === 'registration_withdrawn') return evOk ? `/events/${ev}/control?mode=setup&tool=entrants` : '/account';
  const slug = n.payload.team_slug;
  if (n.kind === 'team_join_decided' && n.payload.decision === 'approved' && typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug)) return `/teams/${slug}`;
  return '/team-manager';
};

export const unreadCount = (list: Pick<AppNotification, 'unread'>[]) => list.filter(n => n.unread).length;
export const unreadIds = (list: Pick<AppNotification, 'id' | 'unread'>[]) => list.filter(n => n.unread).map(n => n.id);
export const badgeText = (count: number) => (count > 9 ? '9+' : String(count));
export const bellLabel = (count: number) => (count === 0 ? 'Notifications' : `Notifications, ${count} unread`);

/** "5 minutes ago" style, for a short list. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return '';
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** Which of the four groups to offer this person. Only fight alerts are role-dependent: someone with no fighter profile and no event they fight in has none to get.
 *  When the roles could not be looked up everything is offered, so a failed lookup never hides a choice. A hidden group keeps whatever it is set to. */
export function visibleCategories(roles: { known: boolean; fighter: boolean; fightsInEvent: boolean }): Array<'fights' | 'team' | 'events' | 'system'> {
  const all: Array<'fights' | 'team' | 'events' | 'system'> = ['fights', 'team', 'events', 'system'];
  return !roles.known || roles.fighter || roles.fightsInEvent ? all : all.filter(k => k !== 'fights');
}
