import type { AppNotification } from '../data/teamManager';

/** Where a notification takes you. Everything else is handled on the team manager. */
export const notificationLink = (n: Pick<AppNotification, 'kind' | 'payload'>): string => {
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
